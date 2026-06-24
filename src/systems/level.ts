import * as THREE from 'three';
import { LEVEL_LEN, GROUND_Y, CHAR_R } from '../core/constants';
import type { Planet } from '../core/types';
import { makeStarMesh, makeFactBox, makeEnemy, makePowerBox, makeGapCushion } from '../entities/meshes';
import { buildDynamics } from './dynamics';
import { powerTint } from './powers';
import type { Game } from '../main_game';

export const CATCH_DROP = 3.0; // how far below ground the gap catch cushion sits

// Stage: owns the Three.js scene/camera/renderer/clock, the parallax layers,
// and the gradient sky background. Ported from the prototype's init() + helpers.
export class Stage {
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  renderer: THREE.WebGLRenderer;
  clock: THREE.Clock;

  parallaxFar!: THREE.Points;
  parallaxMid: THREE.Group;
  dustPts!: THREE.Points;

  skyTop = new THREE.Color();
  skyBot = new THREE.Color();
  tSkyTop = new THREE.Color();
  tSkyBot = new THREE.Color();

  private skyCanvas: HTMLCanvasElement | null = null;
  private skyCtx: CanvasRenderingContext2D | null = null;
  private skyTex: THREE.CanvasTexture | null = null;

  constructor(container: HTMLElement) {
    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(0x0a0a1f, 0.016);
    this.camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 200);
    this.camera.position.set(0, 1.2, 12);
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.78));
    const key = new THREE.DirectionalLight(0xfff0e0, 0.85); key.position.set(4, 8, 6); this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x88aaff, 0.35); rim.position.set(-5, 3, -4); this.scene.add(rim);
    this.parallaxMid = new THREE.Group();
    this.buildParallax();
    this.clock = new THREE.Clock();
  }

  private buildParallax(): void {
    const fg = new THREE.BufferGeometry(), fp: number[] = [];
    for (let i = 0; i < 500; i++) fp.push((Math.random() - 0.5) * 160, Math.random() * 30, -40 - Math.random() * 20);
    fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3));
    this.parallaxFar = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.22, transparent: true, opacity: 0.85 }));
    this.scene.add(this.parallaxFar);
    this.scene.add(this.parallaxMid);
    const dg = new THREE.BufferGeometry(), dp: number[] = [];
    for (let i = 0; i < 70; i++) dp.push((Math.random() - 0.5) * 100, Math.random() * 10 - 1, -4 - Math.random() * 8);
    dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3));
    this.dustPts = new THREE.Points(dg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.13, transparent: true, opacity: 0.5 }));
    this.scene.add(this.dustPts);
  }

  setSkyBg(): void {
    if (!this.skyCanvas) {
      const c = document.createElement('canvas'); c.width = 16; c.height = 256;
      this.skyCanvas = c; this.skyCtx = c.getContext('2d');
      this.skyTex = new THREE.CanvasTexture(c); this.scene.background = this.skyTex;
    }
    const ctx = this.skyCtx!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#' + this.skyTop.getHexString());
    g.addColorStop(1, '#' + this.skyBot.getHexString());
    ctx.fillStyle = g; ctx.fillRect(0, 0, 16, 256);
    this.skyTex!.needsUpdate = true; this.scene.background = this.skyTex!;
    (this.scene.fog as THREE.FogExp2).color.copy(this.skyBot).multiplyScalar(0.55);
  }

  onResize(): void {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
}

export function clearLevel(game: Game): void {
  const s = game.stage.scene;
  if (game.groundGroup) s.remove(game.groundGroup);
  game.platforms.forEach(p => s.remove(p.mesh)); game.platforms = [];
  game.starItems.forEach(st => s.remove(st.mesh)); game.starItems = [];
  game.factBoxes.forEach(b => s.remove(b.group)); game.factBoxes = [];
  game.enemies.forEach(e => s.remove(e.group)); game.enemies = [];
  game.bouncePads.forEach(b => s.remove(b.mesh)); game.bouncePads = [];
  game.movers.forEach(m => s.remove(m.mesh)); game.movers = [];
  game.rollers.forEach(r => s.remove(r.mesh)); game.rollers = [];
  game.bubbles.forEach(b => s.remove(b.mesh)); game.bubbles = [];
  game.movingPlats.forEach(m => s.remove(m.mesh)); game.movingPlats = [];
  game.decor.forEach(d => s.remove(d)); game.decor = [];
  game.windZones = [];
  game.gaps = [];
  game.puffs.forEach(p => s.remove(p.mesh)); game.puffs = []; game.puffCd = 0;
  game.freezables.forEach(f => { if (!f.frozen) s.remove(f.mesh); }); game.freezables = [];
  if (game.powerBox) { s.remove(game.powerBox.group); game.powerBox = null; }
  if (game.windParticles) { s.remove(game.windParticles); game.windParticles = null; }
  if (game.sunPiece) { s.remove(game.sunPiece.group); game.sunPiece = null; }
  const mid = game.stage.parallaxMid;
  while (mid.children.length) mid.remove(mid.children[0]!);
}

// Build a level from a level definition (a Planet or a Moon — same shape).
export function loadLevel(game: Game, P: Planet, instant: boolean): void {
  clearLevel(game);
  game.level = P;
  game.currentPower = P.power ?? null;
  game.powerActive = false;
  game.ui.setPuffVisible(false);
  const stage = game.stage;
  const scene = stage.scene;
  const T = P.terrain || { type: 'horizontal' as const };
  game.levelType = T.type || 'horizontal';
  game.levelHeight = T.height || 34;
  game.ui.setPlanetName(P.name);
  stage.tSkyTop.setHex(P.sky[0]); stage.tSkyBot.setHex(P.sky[1]);
  if (instant) { stage.skyTop.copy(stage.tSkyTop); stage.skyBot.copy(stage.tSkyBot); }

  game.groundGroup = new THREE.Group();
  const groundGroup = game.groundGroup;
  const gmat = new THREE.MeshStandardMaterial({ color: P.ground, roughness: 0.95 });
  const bmat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 0.95 });
  const platMat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 0.8, emissive: 0x111111, emissiveIntensity: 0.1 });

  // returns the ground surface height (top Y) at a given x for this terrain
  function groundAt(x: number): number {
    if (T.steps) { for (const s of T.steps) { if (x >= s[0] && x < s[1]) return GROUND_Y + s[2]; } return GROUND_Y; }
    if (T.shape === 'dunes') return GROUND_Y + Math.max(0, Math.sin(x * 0.18) * 0.5 + Math.cos(x * 0.07) * 0.35);
    if (T.shape === 'hills') return GROUND_Y + Math.max(0, Math.sin(x * 0.12)) * 1.1;
    return GROUND_Y;
  }
  game.groundAt = groundAt;

  if (game.levelType === 'vertical') {
    // small base ground; the level goes UP
    const slab = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 6), gmat); slab.position.set(0, GROUND_Y - 2, -0.5); groundGroup.add(slab);
    for (let x = -10; x <= 10; x += 2.2) { const bump = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), bmat); bump.position.set(x, GROUND_Y, -0.3); bump.scale.y = 0.4; groundGroup.add(bump); }
    game.levelMinX = -9; game.levelMaxX = 9;
    scene.add(groundGroup);

    // climb platforms
    (T.climb || []).forEach((c, idx) => { const w = 2.6 + (idx % 2) * 0.4; const plat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 2.2), platMat); plat.position.set(c[0], GROUND_Y + c[1], 0); if (T.tilt) plat.rotation.z = (idx % 2 ? 1 : -1) * 0.12; scene.add(plat); game.platforms.push({ mesh: plat, x: c[0], y: GROUND_Y + c[1], w: w, top: GROUND_Y + c[1] + 0.25 }); });

    // stars beside climb platforms + a column up the middle the full height
    (T.climb || []).forEach((c, idx) => { const m = makeStarMesh(1, false); m.position.set(c[0] + (idx % 2 ? 1.6 : -1.6), GROUND_Y + c[1] + 0.9, 0); m.userData.bob = Math.random() * 6; scene.add(m); game.starItems.push({ mesh: m, base: m.position.y, alive: true }); });
    for (let yy = 2; yy <= game.levelHeight - 2; yy += 2.5) { const m = makeStarMesh(1, false); m.position.set((Math.random() - 0.5) * 9, GROUND_Y + yy, 0); m.userData.bob = Math.random() * 6; scene.add(m); game.starItems.push({ mesh: m, base: m.position.y, alive: true }); }

    // fact boxes spread evenly up the climb (5 boxes across the whole height)
    const climb = T.climb || []; const N = climb.length;
    const boxIdx = [0.12, 0.30, 0.50, 0.70, 0.88].map(f => Math.min(N - 1, Math.max(1, Math.round(f * (N - 1)))));
    boxIdx.forEach((k, idx) => { const c = climb[k]!; const g = makeFactBox(); const bx = c[0] + (idx % 2 ? 2.0 : -2.0); const by = GROUND_Y + c[1] + 1.6; g.position.set(bx, by, 0); scene.add(g); game.factBoxes.push({ group: g, x: bx, baseY: by, used: false, fact: P.facts[idx]!, factIndex: idx, bounce: 0 }); });

    // enemies on ledges spread up the climb
    [0.18, 0.40, 0.62, 0.82].map(f => Math.min(N - 1, Math.max(1, Math.round(f * (N - 1))))).forEach(k => { const c = climb[k]!; const g = makeEnemy(P.enemy); g.position.set(c[0], GROUND_Y + c[1] + 0.5, 0); scene.add(g); game.enemies.push({ group: g, baseY: GROUND_Y + c[1] + 0.5, dir: Math.random() < 0.5 ? -1 : 1, range: 1.2, home: c[0], alive: true, squish: 1, onPlat: c[0] }); });

  } else {
    // soft gaps: holes in the ground with a catch cushion below (no fail)
    const gaps = T.gaps || [];
    game.gaps = gaps.map(g => ({ x0: g[0], x1: g[1] }));
    game.catchY = GROUND_Y - CATCH_DROP;
    const inGap = (x: number) => gaps.some(g => x >= g[0] && x <= g[1]);

    // horizontal ground built from steps or a shaped strip
    if (T.steps) {
      // sub-intervals of [a,b] not covered by any gap (so gaps become real holes)
      const splitOut = (a: number, b: number): [number, number][] => {
        const within = gaps.filter(g => g[1] > a && g[0] < b).map(g => [Math.max(a, g[0]), Math.min(b, g[1])] as [number, number]).sort((x, y) => x[0] - y[0]);
        const out: [number, number][] = []; let cur = a;
        for (const g of within) { if (g[0] > cur) out.push([cur, g[0]]); cur = Math.max(cur, g[1]); }
        if (cur < b) out.push([cur, b]);
        return out;
      };
      T.steps.forEach(s => {
        splitOut(s[0], s[1]).forEach(([a, b]) => { const w = b - a; const seg = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 4, 6), gmat); seg.position.set((a + b) / 2, GROUND_Y + s[2] - 2, -0.5); groundGroup.add(seg); });
        for (let x = s[0]; x < s[1]; x += 2.4) { if (inGap(x + 1)) continue; const bump = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), bmat); bump.position.set(x + 1, GROUND_Y + s[2], -0.3); bump.scale.y = 0.4; groundGroup.add(bump); }
      });
    } else {
      // build the base slab in segments so gaps are real holes you can see through
      const minE = -LEVEL_LEN / 2 - 3, maxE = LEVEL_LEN / 2 + 3;
      const segs: [number, number][] = [];
      if (gaps.length) {
        const sorted = [...gaps].sort((a, b) => a[0] - b[0]);
        let cursor = minE;
        for (const g of sorted) { if (g[0] > cursor) segs.push([cursor, g[0]]); cursor = Math.max(cursor, g[1]); }
        if (cursor < maxE) segs.push([cursor, maxE]);
      } else { segs.push([minE, maxE]); }
      segs.forEach(([a, b]) => { const w = b - a; const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 6), gmat); slab.position.set((a + b) / 2, GROUND_Y - 2, -0.5); groundGroup.add(slab); });
      for (let x = -LEVEL_LEN / 2; x <= LEVEL_LEN / 2; x += 2.2) { if (inGap(x)) continue; const gy = groundAt(x); const bump = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 0.4, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), bmat); bump.position.set(x + Math.random() * 0.5, gy, -0.3); bump.scale.y = 0.4; groundGroup.add(bump); }
    }
    // dark pit recess behind each gap (anchored to the gap's step height so it
    // reads as a real hole on stepped terrain too) + a catch cushion at the bottom
    const pitColor = new THREE.Color(P.ground).multiplyScalar(0.26).getHex();
    const pitMat = new THREE.MeshBasicMaterial({ color: pitColor });
    gaps.forEach(g => {
      const w = g[1] - g[0]; const center = (g[0] + g[1]) / 2;
      const topY = groundAt(g[0] - 0.3);        // surface height of the step this gap sits in
      const botY = game.catchY - 1.0;
      const pit = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, topY - botY, 2.6), pitMat);
      pit.position.set(center, (topY + botY) / 2, -1.4); scene.add(pit); game.decor.push(pit);
      const cu = makeGapCushion(w, P.hill); cu.position.set(center, game.catchY - 0.4, 0); scene.add(cu); game.decor.push(cu);
    });
    // mesas (optional)
    (T.mesas || []).forEach(m => { const mesa = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 5), bmat); mesa.position.set(m[0], GROUND_Y + m[1], -0.3); groundGroup.add(mesa); game.platforms.push({ mesh: mesa, x: m[0], y: GROUND_Y + m[1], w: 6, top: GROUND_Y + m[1] + 0.7 }); });
    game.levelMinX = -LEVEL_LEN / 2 + 2.2; game.levelMaxX = LEVEL_LEN / 2 + 1;
    scene.add(groundGroup);

    // platforms from terrain data
    (T.platforms || []).forEach(d => { const w = 2.6 + Math.random() * 0.6; const plat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.5, 2.2), platMat); plat.position.set(d[0], GROUND_Y + d[1], 0); scene.add(plat); game.platforms.push({ mesh: plat, x: d[0], y: GROUND_Y + d[1], w: w, top: GROUND_Y + d[1] + 0.25 }); });

    // stars follow ground height
    [-42, -39, -36, -33, -30, -27, -24, -21, -18, -15, -12, -9, -6, -3, 0, 3, 6, 9, 12, 15, 18, 21, 24, 27, 30, 33, 36, 39, 42].forEach((sx, idx) => { const high = idx % 3 === 0; const gy = groundAt(sx); const sy = gy + (high ? 2.6 : 1.1) + Math.random() * 0.9; const m = makeStarMesh(1, false); m.position.set(sx, sy, 0); m.userData.bob = Math.random() * Math.PI * 2; scene.add(m); game.starItems.push({ mesh: m, base: sy, alive: true }); });

    // fact boxes above ground
    [-34, -17, 0, 17, 34].forEach((bx, idx) => { const by = groundAt(bx) + 2.5; const g = makeFactBox(); g.position.set(bx, by, 0); scene.add(g); game.factBoxes.push({ group: g, x: bx, baseY: by, used: false, fact: P.facts[idx]!, factIndex: idx, bounce: 0 }); });

    // enemies on ground (skip any that would float over a gap)
    [-38, -24, -10, 6, 22, 38].forEach(ex => { if (inGap(ex)) return; const ey = groundAt(ex) + 0.5; const g = makeEnemy(P.enemy); g.position.set(ex, ey, 0); scene.add(g); game.enemies.push({ group: g, baseY: ey, dir: Math.random() < 0.5 ? -1 : 1, range: 2.0, home: ex, alive: true, squish: 1 }); });
  }

  // mid-parallax hills + background orb (both level types)
  const hmat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 1, transparent: true, opacity: 0.55 });
  for (let k = 0; k < 16; k++) { const r = 3 + Math.random() * 3; const hill = new THREE.Mesh(new THREE.SphereGeometry(r, 18, 12, 0, Math.PI * 2, 0, Math.PI * 0.5), hmat); hill.position.set(-LEVEL_LEN / 2 + k * 6 + Math.random() * 3, GROUND_Y - 1, -14 - Math.random() * 4); hill.scale.y = 0.5; stage.parallaxMid.add(hill); }
  const orb = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 24), new THREE.MeshStandardMaterial({ color: P.sky[1], emissive: P.sky[1], emissiveIntensity: 0.15, roughness: 0.8, transparent: true, opacity: 0.6 })); orb.position.set(game.levelType === 'vertical' ? -9 : 8, game.levelType === 'vertical' ? game.levelHeight * 0.6 : 9, -30); stage.parallaxMid.add(orb);
  if (P.rings) { const ring = new THREE.Mesh(new THREE.RingGeometry(7, 10, 48), new THREE.MeshBasicMaterial({ color: 0xf0e0b0, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })); ring.position.copy(orb.position); ring.rotation.x = Math.PI * 0.42; stage.parallaxMid.add(ring); }

  // moving platforms (travel mechanic)
  (T.movingPlats || []).forEach(mp => { const w = 2.8; const plat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, 2.2), new THREE.MeshStandardMaterial({ color: P.hill, roughness: 0.7, emissive: 0x223344, emissiveIntensity: 0.15, metalness: 0.2 })); const py = GROUND_Y + mp.y; plat.position.set(mp.x, py, 0); scene.add(plat); game.movingPlats.push({ mesh: plat, baseX: mp.x, baseY: py, axis: mp.axis, range: mp.range, speed: mp.speed, phase: Math.random() * 6, w: w, top: py + 0.22 }); });

  buildDynamics(game, P);

  // Power Box — grants this level's elemental power when bumped
  if (P.power && P.powerBox !== undefined) {
    const bx = P.powerBox;
    // horizontal: float above the ground at bx; vertical: just above the start base
    const by = game.levelType === 'vertical' ? GROUND_Y + 1.9 : groundAt(bx) + 2.5;
    const g = makePowerBox(powerTint(P.power)); g.position.set(bx, by, 0); scene.add(g);
    game.powerBox = { group: g, x: bx, baseY: by, used: false, bounce: 0 };
  }

  // Piece of the Sun — at far right (horizontal) or top (vertical)
  const sg = new THREE.Group(); const sunMesh = makeStarMesh(2.2, true); sg.add(sunMesh);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 18), new THREE.MeshBasicMaterial({ color: 0xffd24d, transparent: true, opacity: 0.22 })); sg.add(glow);
  sg.add(new THREE.PointLight(0xffcf66, 1.2, 12));
  let sunX: number, sunY: number;
  if (game.levelType === 'vertical') { const top = (T.climb || []).slice(-1)[0] || [0, game.levelHeight - 4]; sunX = top[0]; sunY = GROUND_Y + top[1] + 2.2; }
  else { sunX = LEVEL_LEN / 2 - 2; sunY = groundAt(sunX) + 2.4; }
  sg.position.set(sunX, sunY, 0); scene.add(sg);
  game.sunPiece = { group: sg, mesh: sunMesh, glow: glow, y: sunY };

  // Secret power cache — a glowing reward placed where the power can reach it.
  if (P.powerCache) {
    const [cx, cy] = P.powerCache; const cyAbs = GROUND_Y + cy;
    const cg = new THREE.Group();
    cg.add(makeStarMesh(1.5, true));
    const cglow = new THREE.Mesh(new THREE.SphereGeometry(1.1, 18, 14), new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0.25 })); cg.add(cglow);
    cg.position.set(cx, cyAbs, 0); cg.userData.bob = 0; scene.add(cg);
    game.starItems.push({ mesh: cg, base: cyAbs, alive: true, cache: true });
  }

  // place player at start
  if (game.levelType === 'vertical') { game.charPos.x = 0; game.charPos.y = GROUND_Y + CHAR_R; }
  else { game.charPos.x = game.levelMinX + 0.8; game.charPos.y = groundAt(game.charPos.x) + CHAR_R; }
  game.vel.x = 0; game.vel.y = 0; game.onGround = true;
  game.gustState = { active: 0, dir: 1, timer: 0 }; game.slippery = !!(P.dyn && P.dyn.slippery); game.charSlide = 0; game.boostTimer = 0; game.windActive = false;
  game.smallStars = 0; game.boxesFound = 0; game.bonusShown = false; game.updateHUD(); game.updatePlanetDots();
}
