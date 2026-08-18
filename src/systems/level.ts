import * as THREE from 'three';
import { LEVEL_LEN, GROUND_Y, CHAR_R, sx } from '../core/constants';
import type { Planet } from '../core/types';
import { makeStarMesh, makeFactBox, makePowerBox, makeGapCushion, makePlatform, disposeObject } from '../entities/meshes';
import { makeLumin, luminsForPlanet, luminBaseOffset } from '../entities/creatures';
import type { LuminKind } from '../entities/creatures';
import { makeProp, propsForPlanet, makeSkyline } from '../entities/props';
import type { PropKind } from '../entities/props';
import { paletteFrom, rockMat, disposeObject as _disposeShared } from './materials';
import { generateLevel } from './levelgen';
import { buildDynamics } from './dynamics';
import { powerTint } from './powers';
import type { Game } from '../main_game';

void _disposeShared;

/** Stable per-level seed so a planet and its moon get different layouts. */
function planIndex(P: Planet): number {
  let h = 0;
  for (let i = 0; i < P.name.length; i++) h = (h * 31 + P.name.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Position an object and return it (keeps the builders terse). */
function pos3<T extends THREE.Object3D>(o: T, x: number, y: number, z: number): T { o.position.set(x, y, z); return o; }

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

  // lighting stack (re-tinted per planet by loadLevel)
  hemi!: THREE.HemisphereLight;
  key!: THREE.DirectionalLight;
  fill!: THREE.DirectionalLight;
  rim!: THREE.DirectionalLight;

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
    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setSize(innerWidth, innerHeight);
    // DPR capped at 2 (1.75 on phones) — the single biggest mobile fill-rate win
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, innerWidth < 900 ? 1.75 : 2));
    // Correct colour pipeline + filmic tone mapping: the base of the AAA look.
    // Exposure is tuned slightly bright — this is a warm, safe, sunny game.
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.18;
    // Soft shadows ground the hero and the big world anchors.
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    // --- lighting stack: hemisphere ambient + key (shadowed) + fill + rim ---
    this.hemi = new THREE.HemisphereLight(0xffffff, 0x444466, 0.55);
    this.scene.add(this.hemi);
    this.key = new THREE.DirectionalLight(0xfff0e0, 1.15);
    this.key.position.set(6, 12, 8);
    this.key.castShadow = true;
    this.key.shadow.mapSize.set(1024, 1024);
    this.key.shadow.camera.near = 1; this.key.shadow.camera.far = 60;
    this.key.shadow.camera.left = -18; this.key.shadow.camera.right = 18;
    this.key.shadow.camera.top = 18; this.key.shadow.camera.bottom = -18;
    this.key.shadow.bias = -0.0012; this.key.shadow.normalBias = 0.03;
    this.scene.add(this.key); this.scene.add(this.key.target);
    this.fill = new THREE.DirectionalLight(0xbfd4ff, 0.32); this.fill.position.set(-6, 4, 5); this.scene.add(this.fill);
    this.rim = new THREE.DirectionalLight(0x88aaff, 0.55); this.rim.position.set(-5, 3, -8); this.scene.add(this.rim);
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
  // remove from the scene AND free geometries/materials — levels are rebuilt
  // constantly and un-disposed GPU buffers add up fast on low-end phones
  const kill = (o: THREE.Object3D) => { s.remove(o); disposeObject(o); };
  if (game.groundGroup) kill(game.groundGroup);
  game.platforms.forEach(p => kill(p.mesh)); game.platforms = [];
  game.starItems.forEach(st => kill(st.mesh)); game.starItems = [];
  game.factBoxes.forEach(b => kill(b.group)); game.factBoxes = [];
  game.enemies.forEach(e => kill(e.group)); game.enemies = [];
  game.bouncePads.forEach(b => kill(b.mesh)); game.bouncePads = [];
  game.movers.forEach(m => kill(m.mesh)); game.movers = [];
  game.rollers.forEach(r => kill(r.mesh)); game.rollers = [];
  game.bubbles.forEach(b => kill(b.mesh)); game.bubbles = [];
  game.movingPlats.forEach(m => kill(m.mesh)); game.movingPlats = [];
  game.decor.forEach(d => kill(d)); game.decor = [];
  game.windZones = [];
  game.gaps = [];
  game.puffs.forEach(p => kill(p.mesh)); game.puffs = []; game.puffCd = 0;
  game.freezables.forEach(f => { if (!f.frozen) kill(f.mesh); }); game.freezables = [];
  // leftover sparkles from the old level (they share a geometry — material only)
  game.fx.forEach(f => { s.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); }); game.fx = [];
  game.hitCooldown = 0;
  if (game.powerBox) { kill(game.powerBox.group); game.powerBox = null; }
  if (game.windParticles) { kill(game.windParticles); game.windParticles = null; }
  if (game.sunPiece) { kill(game.sunPiece.group); game.sunPiece = null; }
  const mid = game.stage.parallaxMid;
  while (mid.children.length) { const c = mid.children[0]!; mid.remove(c); disposeObject(c); }
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
  // rotate through layout variants per visit (variant 0 = base terrain)
  const base = P.terrain || { type: 'horizontal' as const };
  const variants = base.variants || [];
  const variantCount = 1 + variants.length;
  const vIdx = variantCount > 1 ? game.storage.planetVisits(game.pIndex) % variantCount : 0;
  const T = vIdx > 0 ? { ...base, ...variants[vIdx - 1]! } : base;
  game.levelType = T.type || 'horizontal';
  game.levelHeight = T.height || 34;
  game.ui.setPlanetName(P.name);
  stage.tSkyTop.setHex(P.sky[0]); stage.tSkyBot.setHex(P.sky[1]);
  if (instant) { stage.skyTop.copy(stage.tSkyTop); stage.skyBot.copy(stage.tSkyBot); }

  game.groundGroup = new THREE.Group();
  const groundGroup = game.groundGroup;
  const gmat = new THREE.MeshStandardMaterial({ color: P.ground, roughness: 0.95 });
  const bmat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 0.95 });
  // One palette drives every prop, creature accent and effect on this world.
  const pal = paletteFrom(P.ground, P.hill, P.sky[0], P.sky[1], P.dust);
  // Re-tint the lighting stack to the planet's sky so each world has its own
  // time-of-day feel rather than one neutral studio light everywhere.
  stage.hemi.color.setHex(P.sky[1]); stage.hemi.groundColor.setHex(pal.deep); stage.hemi.intensity = 0.5;
  stage.key.color.setHex(0xfff2e2); stage.key.intensity = 1.15;
  stage.fill.color.setHex(P.sky[1]); stage.fill.intensity = 0.3;
  stage.rim.color.setHex(P.dust); stage.rim.intensity = 0.6;

  // Authored step boundaries are written in the original 95-unit space; the
  // ground mesh AND the collision height must both use the scaled version.
  const scaledSteps = T.steps ? T.steps.map(s => [sx(s[0]), sx(s[1]), s[2]] as [number, number, number]) : undefined;

  // returns the ground surface height (top Y) at a given x for this terrain
  function groundAt(x: number): number {
    if (scaledSteps) { for (const s of scaledSteps) { if (x >= s[0] && x < s[1]) return GROUND_Y + s[2]; } return GROUND_Y; }
    if (T.shape === 'dunes') return GROUND_Y + Math.max(0, Math.sin(x * 0.18) * 0.5 + Math.cos(x * 0.07) * 0.35);
    if (T.shape === 'hills') return GROUND_Y + Math.max(0, Math.sin(x * 0.12)) * 1.1;
    return GROUND_Y;
  }
  game.groundAt = groundAt;

  if (game.levelType === 'vertical') {
    // small base ground; the level goes UP
    const slab = new THREE.Mesh(new THREE.BoxGeometry(20, 4, 6), gmat); slab.position.set(0, GROUND_Y - 2, -0.5); slab.receiveShadow = true; groundGroup.add(slab);
    for (let x = -10; x <= 10; x += 2.2) { const bump = new THREE.Mesh(new THREE.SphereGeometry(1.2 + Math.random() * 0.3, 14, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), bmat); bump.position.set(x, GROUND_Y, -0.3); bump.scale.y = 0.4; groundGroup.add(bump); }
    // lit front lip so the base doesn't read as one flat slab
    groundGroup.add(pos3(new THREE.Mesh(new THREE.BoxGeometry(20, 0.3, 0.5), rockMat(new THREE.Color(pal.hill).lerp(new THREE.Color(0xffffff), 0.22).getHex(), { rough: 0.85 })), 0, GROUND_Y - 0.02, 2.72));
    game.levelMinX = -9; game.levelMaxX = 9;
    scene.add(groundGroup);

    // ---- climb scenery: props on the base and drifting alongside the ascent,
    // so a vertical world is a PLACE rather than ledges in empty sky ----
    const vKinds = propsForPlanet(P.name);
    const vr = (() => { let a = planIndex(P) + vIdx * 7717; return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; }; })();
    for (let i = 0; i < 10; i++) {
      const px = -11 + vr() * 22;
      const g = makeProp(vKinds.fg[Math.floor(vr() * vKinds.fg.length)] as PropKind, pal, 0.5 + vr() * 0.7, vr());
      g.position.set(px, GROUND_Y, 1.4 + vr() * 1.6); scene.add(g); game.decor.push(g);
    }
    const top = game.levelHeight;
    for (let i = 0; i < 26; i++) {
      const side = vr() < 0.5 ? -1 : 1;
      const layer = vr() < 0.55 ? 'mid' : 'bg';
      const kinds = vKinds[layer as 'mid' | 'bg'];
      const g = makeProp(kinds[Math.floor(vr() * kinds.length)] as PropKind, pal, 1.0 + vr() * 1.6, vr());
      g.position.set(side * (7 + vr() * 9), GROUND_Y + vr() * top, layer === 'mid' ? -7 - vr() * 5 : -16 - vr() * 8);
      stage.parallaxMid.add(g);
    }

    // climb platforms
    (T.climb || []).forEach((c, idx) => {
      const w = 2.6 + (idx % 2) * 0.4;
      const plat = makePlatform(w, pal, (idx * 0.29) % 1);
      plat.position.set(c[0], GROUND_Y + c[1], 0);
      if (T.tilt) plat.rotation.z = (idx % 2 ? 1 : -1) * 0.12;
      scene.add(plat);
      game.platforms.push({ mesh: plat as unknown as THREE.Mesh, x: c[0], y: GROUND_Y + c[1], w: w, top: GROUND_Y + c[1] + 0.31 });
    });

    // stars beside climb platforms + a column up the middle the full height
    (T.climb || []).forEach((c, idx) => { const m = makeStarMesh(1, false); m.position.set(c[0] + (idx % 2 ? 1.6 : -1.6), GROUND_Y + c[1] + 0.9, 0); m.userData.bob = Math.random() * 6; scene.add(m); game.starItems.push({ mesh: m, base: m.position.y, alive: true }); });
    for (let yy = 2; yy <= game.levelHeight - 2; yy += 2.5) { const m = makeStarMesh(1, false); m.position.set((Math.random() - 0.5) * 9, GROUND_Y + yy, 0); m.userData.bob = Math.random() * 6; scene.add(m); game.starItems.push({ mesh: m, base: m.position.y, alive: true }); }

    // fact boxes spread evenly up the climb (5 boxes across the whole height)
    const climb = T.climb || []; const N = climb.length;
    if (N >= 2) {
      const boxIdx = [0.12, 0.30, 0.50, 0.70, 0.88].map(f => Math.min(N - 1, Math.max(1, Math.round(f * (N - 1)))));
      boxIdx.forEach((k, idx) => { const c = climb[k]!; const g = makeFactBox(); const bx = c[0] + (idx % 2 ? 2.0 : -2.0); const by = GROUND_Y + c[1] + 1.6; g.position.set(bx, by, 0); scene.add(g); game.factBoxes.push({ group: g, x: bx, baseY: by, used: false, fact: P.facts[idx]!, factIndex: idx, bounce: 0 }); });

      // enemies on ledges spread up the climb
      const climbKinds = luminsForPlanet(P.name);
      [0.18, 0.40, 0.62, 0.82].map(f => Math.min(N - 1, Math.max(1, Math.round(f * (N - 1))))).forEach((k, i) => {
        const c = climb[k]!;
        const kind = climbKinds[i % climbKinds.length]!;
        const ey = GROUND_Y + c[1] + luminBaseOffset(kind);
        const g = makeLumin(kind, P.enemy, P.sky[1]); g.position.set(c[0], ey, 0); scene.add(g);
        game.enemies.push({ group: g, baseY: ey, dir: Math.random() < 0.5 ? -1 : 1, range: 1.2, home: c[0], alive: true, squish: 1, onPlat: c[0], kind });
      });
    }

  } else {
    // ---- plan the level from authored beats (see systems/levelgen.ts) ----
    // The planet supplies its physics, its signature mechanic and how many soft
    // gaps it wants; the planner lays out a full arrival->finale sequence across
    // the (much longer) span and guarantees every placement is reachable.
    game.levelMinX = -LEVEL_LEN / 2 + 2.2; game.levelMaxX = LEVEL_LEN / 2 + 1;
    const steps = scaledSteps;
    if (steps && steps.length) game.levelMaxX = Math.min(game.levelMaxX, steps[steps.length - 1]![1] - 0.3);

    const plan = generateLevel({
      index: planIndex(P), variant: vIdx,
      minX: game.levelMinX + 1.5, maxX: game.levelMaxX - 4.5,
      jump: P.jump, grav: P.grav,
      gapCount: (T.gaps || []).length,
      creatureKinds: luminsForPlanet(P.name),
      propKinds: propsForPlanet(P.name),
    });
    game.levelPlan = plan;

    // soft gaps: holes in the ground with a catch cushion below (no fail)
    const gaps = plan.gaps;
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
      steps!.forEach(s => {
        splitOut(s[0], s[1]).forEach(([a, b]) => { const w = b - a; const seg = new THREE.Mesh(new THREE.BoxGeometry(w + 0.2, 4, 6), gmat); seg.position.set((a + b) / 2, GROUND_Y + s[2] - 2, -0.5); seg.receiveShadow = true; groundGroup.add(seg); });
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
      segs.forEach(([a, b]) => { const w = b - a; const slab = new THREE.Mesh(new THREE.BoxGeometry(w, 4, 6), gmat); slab.position.set((a + b) / 2, GROUND_Y - 2, -0.5); slab.receiveShadow = true; groundGroup.add(slab); });
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
    // mesas (optional) — authored, so scaled into the current span
    (T.mesas || []).forEach(m => { const mx = sx(m[0]); const mesa = new THREE.Mesh(new THREE.BoxGeometry(6, 1.4, 5), bmat); mesa.position.set(mx, GROUND_Y + m[1], -0.3); mesa.receiveShadow = true; groundGroup.add(mesa); game.platforms.push({ mesh: mesa, x: mx, y: GROUND_Y + m[1], w: 6, top: GROUND_Y + m[1] + 0.7 }); });
    scene.add(groundGroup);

    // ---- platforms from the beat plan (rest ledges are wider and generous) ----
    plan.platforms.forEach((d, i) => {
      const py = groundAt(d.x) + d.h;
      const plat = makePlatform(d.w, pal, ((i * 0.37) % 1));
      plat.position.set(d.x, py, 0);
      scene.add(plat);
      game.platforms.push({ mesh: plat as unknown as THREE.Mesh, x: d.x, y: py, w: d.w, top: py + 0.31 });
    });

    // ---- glimmers along the planned arcs, trails and clusters ----
    plan.stars.forEach(s => {
      const sy = groundAt(s.x) + s.h;
      const m = makeStarMesh(1, false); m.position.set(s.x, sy, 0); m.userData.bob = Math.random() * Math.PI * 2;
      scene.add(m); game.starItems.push({ mesh: m, base: sy, alive: true });
    });

    // ---- wonder blooms (one per planet fact) ----
    plan.blooms.forEach((b, idx) => {
      if (idx >= P.facts.length) return;
      const by = groundAt(b.x) + b.h;
      const g = makeFactBox(); g.position.set(b.x, by, 0); scene.add(g);
      game.factBoxes.push({ group: g, x: b.x, baseY: by, used: false, fact: P.facts[idx]!, factIndex: idx, bounce: 0 });
    });

    // ---- Lumins: friendly light-keepers, varied per planet ----
    plan.creatures.forEach(c => {
      const kind = c.kind as LuminKind;
      const ey = groundAt(c.x) + luminBaseOffset(kind);
      const g = makeLumin(kind, P.enemy, P.sky[1]); g.position.set(c.x, ey, 0); scene.add(g);
      game.enemies.push({ group: g, baseY: ey, dir: Math.random() < 0.5 ? -1 : 1, range: c.range, home: c.x, alive: true, squish: 1, kind });
    });

    // ---- environment prop kit: near detail, foreground, mid silhouettes, far ----
    plan.props.forEach(pr => {
      const g = makeProp(pr.kind as PropKind, pal, pr.scale, pr.seed);
      const z = pr.layer === 'near' ? 2.5 + pr.seed * 0.7
        : pr.layer === 'fg' ? 1.6 - pr.seed * 1.2
          : pr.layer === 'mid' ? -5 - pr.seed * 5 : -15 - pr.seed * 8;
      const py = (pr.layer === 'near' || pr.layer === 'fg') ? groundAt(pr.x) : GROUND_Y - 0.4;
      g.position.set(pr.x, py, z);
      if (pr.layer === 'near' || pr.layer === 'fg') { scene.add(g); game.decor.push(g); }
      else { stage.parallaxMid.add(g); }
    });

    // ---- the ground line: a lighter trim strip along the front lip, and a
    // darker strata cliff below it. Without these the terrain reads as one
    // flat coloured slab filling the bottom of the screen. ----
    const lipMat = rockMat(new THREE.Color(pal.hill).lerp(new THREE.Color(0xffffff), 0.22).getHex(), { rough: 0.85 });
    const cliffMat = rockMat(new THREE.Color(pal.hill).lerp(new THREE.Color(0xffffff), 0.10).getHex(), { strata: true, rough: 1, flat: true });
    const lipSegs = steps ? steps.map(s => [s[0], s[1], s[2]] as [number, number, number])
      : [[game.levelMinX - 4, game.levelMaxX + 4, 0] as [number, number, number]];
    lipSegs.forEach(([a, b, dy]) => {
      const carve = (x0v: number, x1v: number) => {
        const w = x1v - x0v; if (w <= 0.2) return;
        const lip = new THREE.Mesh(new THREE.BoxGeometry(w, 0.3, 0.5), lipMat);
        lip.position.set((x0v + x1v) / 2, GROUND_Y + dy - 0.02, 2.72); lip.receiveShadow = true; groundGroup.add(lip);
        // Segment the cliff face: one long box stretches the strata texture to
        // nothing and gives a dead-straight edge. Chunks keep the rock reading
        // as rock and break the silhouette.
        const CH = 7;
        for (let cx = x0v; cx < x1v; cx += CH) {
          const cw = Math.min(CH, x1v - cx); if (cw < 0.4) break;
          const jag = 0.2 + Math.random() * 0.35;
          const hgt = 1.5 + Math.random() * 0.6;
          const cliff = new THREE.Mesh(new THREE.BoxGeometry(cw * 0.99, hgt, 0.45), cliffMat);
          cliff.position.set(cx + cw / 2, GROUND_Y + dy - jag - hgt / 2 + 0.25, 2.55 + Math.random() * 0.12);
          groundGroup.add(cliff);
        }
      };
      // keep the holes open
      let cur = a;
      for (const g of gaps.filter(g2 => g2[1] > a && g2[0] < b).sort((p2, q) => p2[0] - q[0])) {
        if (g[0] > cur) carve(cur, g[0]);
        cur = Math.max(cur, g[1]);
      }
      if (cur < b) carve(cur, b);
    });
  }

  // layered far skyline (replaces the row of identical hemisphere "hills")
  stage.parallaxMid.add(makeSkyline(P.name, pal, LEVEL_LEN * 1.4));
  const orb = new THREE.Mesh(new THREE.SphereGeometry(6, 32, 24), new THREE.MeshStandardMaterial({ color: P.sky[1], emissive: P.sky[1], emissiveIntensity: 0.15, roughness: 0.8, transparent: true, opacity: 0.6 })); orb.position.set(game.levelType === 'vertical' ? -9 : 8, game.levelType === 'vertical' ? game.levelHeight * 0.6 : 9, -30); stage.parallaxMid.add(orb);
  if (P.rings) { const ring = new THREE.Mesh(new THREE.RingGeometry(7, 10, 48), new THREE.MeshBasicMaterial({ color: 0xf0e0b0, side: THREE.DoubleSide, transparent: true, opacity: 0.4 })); ring.position.copy(orb.position); ring.rotation.x = Math.PI * 0.42; stage.parallaxMid.add(ring); }

  // moving platforms (travel mechanic)
  (T.movingPlats || []).forEach(mp => {
    const w = 2.8;
    // vertical climbs author x directly in the ±9 base; horizontal levels are scaled
    const mx = game.levelType === 'vertical' ? mp.x : sx(mp.x);
    const range = game.levelType === 'vertical' ? mp.range : (mp.axis === 'x' ? sx(mp.range) : mp.range);
    const plat = new THREE.Mesh(new THREE.BoxGeometry(w, 0.45, 2.2), new THREE.MeshStandardMaterial({ color: P.hill, roughness: 0.7, emissive: 0x223344, emissiveIntensity: 0.15, metalness: 0.2 }));
    const py = GROUND_Y + mp.y; plat.position.set(mx, py, 0); plat.castShadow = true; plat.receiveShadow = true; scene.add(plat);
    game.movingPlats.push({ mesh: plat, baseX: mx, baseY: py, axis: mp.axis, range, speed: mp.speed, phase: Math.random() * 6, w: w, top: py + 0.22 });
  });

  buildDynamics(game, P);

  // Power Box — grants this level's elemental power when bumped
  if (P.power && P.powerBox !== undefined) {
    const bx = game.levelType === 'vertical' ? P.powerBox : sx(P.powerBox);
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

  // Hidden star cluster — 4 pale-blue "hidden starlight" stars in a diamond,
  // marked by a faint shimmer ring. Collect all 4 for a Star-Finder sticker.
  if (P.secret) {
    const [hx0, hy] = P.secret; const hx = game.levelType === 'vertical' ? hx0 : sx(hx0);
    const cy = (game.levelType === 'vertical' ? GROUND_Y : groundAt(hx)) + hy;
    ([[0, 0.9], [-0.9, 0], [0.9, 0], [0, -0.9]] as [number, number][]).forEach(([ox, oy]) => {
      const m = makeStarMesh(0.85, false);
      const mat = m.material as THREE.MeshStandardMaterial;
      mat.color.setHex(0xcfe8ff); mat.emissive.setHex(0x88aaff); mat.emissiveIntensity = 0.8;
      m.position.set(hx + ox, cy + oy, 0); m.userData.bob = Math.random() * Math.PI * 2;
      scene.add(m); game.starItems.push({ mesh: m, base: cy + oy, alive: true, secret: true });
    });
    const hint = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.05, 8, 40), new THREE.MeshBasicMaterial({ color: 0xaaccff, transparent: true, opacity: 0.16 }));
    hint.position.set(hx, cy, -0.6); scene.add(hint); game.decor.push(hint);
  }

  // Secret power cache — a glowing reward placed where the power can reach it.
  if (P.powerCache) {
    const [cx0, cy] = P.powerCache; const cx = game.levelType === 'vertical' ? cx0 : sx(cx0);
    const cyAbs = (game.levelType === 'vertical' ? GROUND_Y : groundAt(cx)) + cy;
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
