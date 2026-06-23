import * as THREE from 'three';
import { GROUND_Y, CHAR_R, LEVEL_LEN, MOVE_SPEED } from './core/constants';
import { PLANETS } from './data/planets';
import type {
  Mode, Flight, Platform, StarItem, FactBox, Enemy, Mover, Roller, Bubble,
  BouncePad, WindZone, MovingPlat, SunPiece, Fx, GustState, TerrainType,
} from './core/types';
import { makeCharacter, makeStarMesh } from './entities/meshes';
import { AudioSystem } from './systems/audio';
import { Stage, loadLevel } from './systems/level';
import { updateDynamics } from './systems/dynamics';
import { startFlight, flightShoot, updateFlight } from './systems/flight';
import { Storage } from './systems/storage';
import { UI } from './ui/ui';

// The Game: owns all mutable state, input, the physics step, and the main loop.
// Ported faithfully from the prototype's globals + animate()/physics functions.
export class Game {
  readonly stage: Stage;
  readonly audio: AudioSystem;
  readonly ui: UI;
  readonly storage: Storage;
  char!: THREE.Group;

  // progress / flags
  pIndex = 0;
  smallStars = 0;
  boxesFound = 0;
  calm = false;
  started = false;
  paused = false;
  mode: Mode = 'platformer';
  flight: Flight | null = null;

  // character physics
  charPos = { x: 0, y: 0 };
  vel = { x: 0, y: 0 };
  onGround = true;
  squash = 1;
  facing = 1;

  // level entities
  groundGroup: THREE.Group | null = null;
  platforms: Platform[] = [];
  starItems: StarItem[] = [];
  factBoxes: FactBox[] = [];
  enemies: Enemy[] = [];
  sunPiece: SunPiece | null = null;
  fx: Fx[] = [];
  windZones: WindZone[] = [];
  bouncePads: BouncePad[] = [];
  movers: Mover[] = [];
  rollers: Roller[] = [];
  bubbles: Bubble[] = [];
  decor: THREE.Object3D[] = [];
  windParticles: THREE.Points | null = null;
  movingPlats: MovingPlat[] = [];

  // level meta
  levelType: TerrainType = 'horizontal';
  levelHeight = 34;
  levelMinX = -LEVEL_LEN / 2 + 2.2;
  levelMaxX = LEVEL_LEN / 2 + 1;
  groundAt: (x: number) => number = () => GROUND_Y;

  // dynamic-element state
  gustState: GustState = { active: 0, dir: 1, timer: 0 };
  slippery = false;
  charSlide = 0;
  boostTimer = 0;
  windActive = false;
  windStrength = 0.05;

  // input
  move = { left: false, right: false, up: false, down: false, shoot: false };
  hitCooldown = 0;
  factQueue: 'box' | 'sun' | null = null;
  bonusShown = false;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.audio = new AudioSystem();
    this.ui = new UI();
    this.storage = new Storage();
  }

  init(): void {
    this.char = makeCharacter();
    this.stage.scene.add(this.char);
    this.ui.buildPlanetDots();
    // Resume where the player left off (defaults to Mercury on a fresh save).
    const resume = this.storage.resumePlanet();
    this.pIndex = resume; this.audio.pIndex = resume;
    this.loadLevel(resume, true);
    addEventListener('resize', () => this.stage.onResize());
    this.ui.bind(this);
    this.animate();
  }

  // ---- system wrappers ----
  loadLevel(i: number, instant: boolean): void { loadLevel(this, i, instant); }
  startFlight(): void { startFlight(this); }
  flightShoot(): void { flightShoot(this); }

  // ---- HUD / dots ----
  updateHUD(): void { this.ui.setHUD(this.smallStars, this.boxesFound); }
  updatePlanetDots(): void { this.ui.updatePlanetDots(this.pIndex, this.storage.highestUnlocked); }

  // ---- player actions ----
  doJump(): void {
    if (this.paused || !this.started) return;
    if (this.onGround) { this.vel.y = PLANETS[this.pIndex]!.jump; this.onGround = false; this.squash = 0.7; this.audio.sJump(); }
  }

  toggleCalm(): void { this.calm = !this.calm; this.audio.calm = this.calm; if (this.calm) this.audio.stopSpeak(); }

  goToPlanet(i: number): void {
    this.audio.resume();
    // make sure we're cleanly in platformer mode
    if (this.mode === 'flight') {
      if (this.flight) { try { this.flight.fscene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry && m.geometry.dispose) m.geometry.dispose(); }); } catch (e) { /* ignore */ } this.flight = null; }
      this.stage.scene.visible = true; this.mode = 'platformer';
      this.ui.byId('flightHud').classList.remove('show');
      this.ui.byId('flightControls').style.display = 'none';
      this.ui.byId('platControls').style.display = 'flex';
      this.ui.bySel('.top-bar').style.display = '';
      this.ui.byId('planets').style.display = '';
    }
    this.ui.byId('select').classList.remove('show');
    this.ui.byId('menu').classList.remove('show');
    this.ui.byId('fact').classList.remove('show');
    this.pIndex = i; this.audio.pIndex = i; this.storage.setLastPlanet(i); this.loadLevel(i, true); this.paused = false; this.started = true;
  }

  // ---- rewards / interactions ----
  collectStar(s: StarItem): void {
    s.alive = false; this.audio.sStar(); this.spawnFx(s.mesh.position, 0xffe9a8); this.stage.scene.remove(s.mesh); this.smallStars++; this.updateHUD();
  }

  spawnFx(pos: THREE.Vector3, color: number, n?: number): void {
    n = n || 10;
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.copy(pos); this.stage.scene.add(m);
      this.fx.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 0.16, (Math.random() - 0.05) * 0.2, (Math.random() - 0.5) * 0.16), life: 1 });
    }
  }

  popBox(b: FactBox): void {
    if (b.used) return; b.used = true; b.bounce = 0.2; this.boxesFound++; this.updateHUD(); this.audio.sBox(); this.spawnFx(b.group.position, 0xfff0a0, 8);
    (b.group.userData.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.12; (b.group.userData.mat as THREE.MeshStandardMaterial).color.setHex(0xb9905a);
    this.storage.markFact(this.pIndex, b.factIndex); // record in the Space Journal (+ award stickers)
    this.factQueue = 'box';
    this.ui.prepBoxFact(PLANETS[this.pIndex]!.name, b.fact, !this.audio.ttsSupported || this.calm);
    this.paused = true; setTimeout(() => this.ui.showFact(), 250); this.audio.speak(b.fact);
  }

  showBonus(): void {
    if (this.bonusShown) return; this.bonusShown = true; this.audio.sSun();
    for (let i = 0; i < 3; i++) setTimeout(() => this.spawnFx(new THREE.Vector3(this.charPos.x, this.charPos.y + 1, 0), 0xffe082, 14), i * 180);
    this.ui.triggerBonusToast();
  }

  squishEnemy(e: Enemy): void {
    e.alive = false; e.squish = 0.15; this.audio.sBop(); this.spawnFx(e.group.position, 0xfff0c0, 9);
    const m = makeStarMesh(1, false); m.position.copy(e.group.position); m.position.y += 0.3; this.stage.scene.add(m);
    this.starItems.push({ mesh: m, base: m.position.y, alive: true, reward: true, vy: 0.18 });
  }

  bumpBack(): void {
    if (this.hitCooldown > 0) return; this.hitCooldown = 40; this.audio.sBump(); this.vel.y = Math.max(this.vel.y, 0.22); this.vel.x = -this.facing * 0.18; this.onGround = false;
  }

  reachSun(): void {
    if (this.paused) return; this.paused = true; this.audio.sSun(); this.spawnFx(this.sunPiece!.group.position, 0xffd24d, 16);
    this.factQueue = 'sun'; this.ui.byId('factCard').classList.remove('factbox');
    if (this.pIndex >= PLANETS.length - 1) {
      setTimeout(() => this.ui.showWin(), 700);
      this.audio.speak('You collected every Piece of the Sun! You traveled across the whole solar system!');
      return;
    }
    const nxt = PLANETS[this.pIndex + 1]!;
    this.ui.prepSunFact(nxt.emoji, 'Next: ' + nxt.name, nxt.fact, !this.audio.ttsSupported || this.calm);
    setTimeout(() => this.ui.showFact(), 650);
    this.audio.speak('You found a Piece of the Sun! Next planet: ' + nxt.name + '. ' + nxt.fact);
  }

  onFactBtn(): void {
    this.audio.stopSpeak(); this.ui.hideFact();
    if (this.factQueue === 'sun') { this.startFlight(); }
    else { this.paused = false; if (this.factQueue === 'box' && this.boxesFound >= 5) setTimeout(() => this.showBonus(), 200); }
    this.factQueue = null;
  }

  // ---- main loop ----
  private animate = (): void => {
    requestAnimationFrame(this.animate);
    this.audio.calm = this.calm; this.audio.pIndex = this.pIndex;
    if (this.mode === 'flight') { updateFlight(this); return; }

    const stage = this.stage;
    const scene = stage.scene;
    const camera = stage.camera;
    const clock = stage.clock;
    clock.getDelta(); const sp = this.calm ? 0.55 : 1;
    stage.skyTop.lerp(stage.tSkyTop, 0.05); stage.skyBot.lerp(stage.tSkyBot, 0.05); stage.setSkyBg();
    if (this.hitCooldown > 0) this.hitCooldown--;

    if (this.started && !this.paused) {
      let dir = 0; if (this.move.left) dir -= 1; if (this.move.right) dir += 1;
      let targetVx = dir * MOVE_SPEED * (this.calm ? 0.7 : 1);

      // --- wind zones (Venus) & ice friction (Uranus): horizontal push / slide ---
      let onIce = false, windPush = 0;
      this.windZones.forEach(z => { if (this.charPos.x >= z.x0 && this.charPos.x <= z.x1) { if (z.ice) { onIce = true; } else { windPush -= (this.windStrength || 0.05) * (this.calm ? 0.5 : 1); if (this.windActive !== true) { this.windActive = true; if (Math.random() < 0.05) this.audio.sWind(); } } } });
      if (!this.windZones.some(z => !z.ice && this.charPos.x >= z.x0 && this.charPos.x <= z.x1)) this.windActive = false;
      // wind makes forward travel slower and idle drift backward, but never overpowers active forward push
      if (windPush !== 0) { if (dir > 0) { targetVx = Math.max(0.02, targetVx + windPush); } else if (dir < 0) { targetVx += windPush; } else { targetVx = windPush; } }

      // --- Neptune gusts: alternating push (capped so forward walking always progresses) ---
      if (this.gustState.strength) { this.gustState.timer++; const ph = Math.sin(this.gustState.timer / (this.gustState.period || 240) * Math.PI * 2); this.gustState.active = ph; const g = ph * this.gustState.strength * (this.calm ? 0.5 : 1); if (dir > 0) { targetVx = Math.max(0.02, targetVx + g); } else if (dir < 0) { targetVx += g; } else { targetVx += g * 0.6; } }

      // --- Mercury solar boost: brief speed shimmer ---
      if (PLANETS[this.pIndex]!.dyn && PLANETS[this.pIndex]!.dyn!.boost) { this.boostTimer++; if (this.boostTimer % 420 < 60) { targetVx *= 1.35; } }

      if (this.hitCooldown < 30) {
        if (onIce) { this.charSlide += (targetVx - this.charSlide) * 0.04; this.vel.x = this.charSlide; } // slippery: slow to change
        else if (this.slippery) { this.charSlide += (targetVx - this.charSlide) * 0.10; this.vel.x = this.charSlide; }
        else { this.vel.x = targetVx; this.charSlide = targetVx; }
        if (dir !== 0) this.facing = dir;
      }
      this.charPos.x += this.vel.x; this.charPos.x = Math.max(this.levelMinX, Math.min(this.levelMaxX, this.charPos.x));
      this.vel.y -= PLANETS[this.pIndex]!.grav * (this.calm ? 0.7 : 1); this.charPos.y += this.vel.y * (this.calm ? 0.7 : 1);

      // ground height: vertical levels have a tiny base only near the middle; horizontal use groundAt
      let groundTop: number;
      if (this.levelType === 'vertical') { groundTop = (Math.abs(this.charPos.x) <= 10) ? GROUND_Y + CHAR_R : -999; }
      else { groundTop = this.groundAt(this.charPos.x) + CHAR_R; }
      let landed = false; const footY = groundTop;
      if (this.charPos.y <= footY) { this.charPos.y = footY; if (!this.onGround) this.squash = 1.25; this.vel.y = 0; this.onGround = true; landed = true; }
      if (this.vel.y <= 0) { this.platforms.forEach(pl => { if (Math.abs(this.charPos.x - pl.x) < pl.w / 2 + CHAR_R * 0.6) { const top = pl.top + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5 && this.charPos.y > footY - 0.1) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.25; this.onGround = true; landed = true; } } }); }
      // moving platforms: stand on top AND get carried
      if (this.vel.y <= 0) { this.movingPlats.forEach(mp => { if (Math.abs(this.charPos.x - mp.mesh.position.x) < mp.w / 2 + CHAR_R * 0.5) { const top = mp.mesh.position.y + 0.22 + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.2; this.onGround = true; landed = true; if (mp.axis === 'x') { this.charPos.x += mp.dx || 0; } } } }); }
      // mover platforms (clouds, ice chunks)
      if (this.vel.y <= 0) { this.movers.forEach(mv => { if (Math.abs(this.charPos.x - mv.mesh.position.x) < mv.w / 2 + CHAR_R * 0.5) { const top = mv.mesh.position.y + 0.3 + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.2; this.onGround = true; landed = true; } } }); }
      this.factBoxes.forEach(b => { if (Math.abs(this.charPos.x - b.x) < 0.5 + CHAR_R * 0.6) { const top = b.baseY + 0.5 + CHAR_R; if (this.vel.y <= 0 && this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; this.onGround = true; landed = true; if (!b.used) this.popBox(b); } const bottom = b.baseY - 0.5 - CHAR_R; if (this.vel.y > 0 && this.charPos.y >= bottom && this.charPos.y < bottom + 0.5) { if (!b.used) this.popBox(b); this.vel.y = -0.05; } } });

      // bounce pads / geysers: launch high
      this.bouncePads.forEach(bp => { if (Math.abs(this.charPos.x - bp.x) < 1.0 && this.charPos.y <= bp.y + CHAR_R + 0.4 && this.vel.y <= 0.05) { this.vel.y = PLANETS[this.pIndex]!.jump * bp.power + 0.2; this.onGround = false; this.squash = 0.6; this.audio.sBoing(); } });

      // bubbles: gentle upward bob when touched
      this.bubbles.forEach(bb => { if (Math.hypot(this.charPos.x - bb.mesh.position.x, this.charPos.y - bb.mesh.position.y) < CHAR_R + 0.7) { if (this.vel.y < 0.1) { this.vel.y = PLANETS[this.pIndex]!.jump * 0.55; this.onGround = false; this.audio.sBoing(); this.spawnFx(bb.mesh.position, 0xbcd0ff, 5); } } });

      if (!landed && this.charPos.y > footY + 0.05) this.onGround = false;
      // vertical safety net: if you fall below the base, gently set down on the base ground (no death)
      if (this.levelType === 'vertical' && this.charPos.y < GROUND_Y - 1) { this.charPos.x += (0 - this.charPos.x) * 0.2; this.charPos.y = GROUND_Y + CHAR_R; this.vel.y = 0; this.vel.x = 0; this.onGround = true; landed = true; this.squash = 1.25; }

      // rolling rocks: bop to pop, side-touch = gentle bump
      this.rollers.forEach(r => { if (!r.alive) return; const dx = this.charPos.x - r.mesh.position.x, dy = this.charPos.y - r.mesh.position.y; if (Math.abs(dx) < CHAR_R + 0.4 && dy < CHAR_R + 0.5 && dy > -0.2) { if (this.vel.y < 0 && this.charPos.y > r.mesh.position.y + 0.25) { r.alive = false; scene.remove(r.mesh); this.audio.sRock(); this.spawnFx(r.mesh.position, 0xc4623d, 9); const m = makeStarMesh(1, false); m.position.copy(r.mesh.position); m.position.y += 0.3; scene.add(m); this.starItems.push({ mesh: m, base: m.position.y, alive: true, reward: true, vy: 0.18 }); this.vel.y = PLANETS[this.pIndex]!.jump * 0.7; } else { this.bumpBack(); } } });

      this.enemies.forEach(e => { if (!e.alive) return; const dx = this.charPos.x - e.group.position.x, dy = this.charPos.y - e.group.position.y; if (Math.abs(dx) < CHAR_R + 0.45 && dy < CHAR_R + 0.6 && dy > -0.2) { if (this.vel.y < 0 && this.charPos.y > e.group.position.y + 0.3) { this.squishEnemy(e); this.vel.y = PLANETS[this.pIndex]!.jump * 0.7; this.onGround = false; } else { this.bumpBack(); } } });

      if (this.sunPiece && Math.hypot(this.charPos.x - this.sunPiece.group.position.x, this.charPos.y - this.sunPiece.group.position.y) < CHAR_R + 1.1) this.reachSun();
    }

    this.char.position.set(this.charPos.x, this.charPos.y, 0);
    this.squash += (1 - this.squash) * 0.15;
    const stretch = this.vel.y > 0 ? 1 + this.vel.y * 0.25 : 1;
    (this.char.userData.body as THREE.Mesh).scale.set(this.squash, (2 - this.squash) * 0.92 * stretch, this.squash);
    this.char.rotation.y = this.facing > 0 ? 0.25 : -0.25;
    ((this.char.userData.bulb as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 2) * 0.3;

    if (this.levelType === 'vertical') {
      // follow upward; keep x centered, pull camera back a touch so the climb reads
      camera.position.x += (0 - camera.position.x) * 0.06;
      const targetY = this.charPos.y + 1.5; camera.position.y += (targetY - camera.position.y) * 0.07;
      camera.position.z += (15 - camera.position.z) * 0.04;
      camera.lookAt(0, this.charPos.y + 0.5, 0);
    } else {
      const camMinX = -LEVEL_LEN / 2 + 5, camMaxX = LEVEL_LEN / 2 - 5;
      const tx = Math.max(camMinX, Math.min(camMaxX, this.charPos.x));
      camera.position.x += (tx - camera.position.x) * 0.08;
      camera.position.z += (12 - camera.position.z) * 0.04;
      camera.position.y += ((1.2 + Math.max(0, this.charPos.y - GROUND_Y - 1) * 0.25) - camera.position.y) * 0.06;
      camera.lookAt(camera.position.x, 0.6, 0);
    }

    if (stage.parallaxFar) stage.parallaxFar.position.x = camera.position.x * 0.6;
    if (stage.dustPts) { stage.dustPts.position.x = camera.position.x * 0.85; stage.dustPts.rotation.y += 0.0004 * sp; }
    stage.parallaxMid.position.x = camera.position.x * 0.25;
    stage.parallaxMid.position.y = this.levelType === 'vertical' ? camera.position.y * 0.2 : 0;

    this.starItems.forEach(s => { if (!s.alive) return; s.mesh.rotation.y += 0.02 * sp; s.mesh.rotation.z += 0.008 * sp; if (s.reward) { s.vy! -= 0.012; s.mesh.position.y += s.vy!; if (s.mesh.position.y <= s.base) { s.vy = 0; s.mesh.position.y = s.base; } } else { s.mesh.position.y = s.base + Math.sin(clock.elapsedTime * 0.9 + s.mesh.userData.bob) * 0.2 * (this.calm ? 0.4 : 1); } if (Math.hypot(this.charPos.x - s.mesh.position.x, this.charPos.y - s.mesh.position.y) < CHAR_R + 0.45) this.collectStar(s); });

    this.factBoxes.forEach(b => { b.bounce *= 0.85; b.group.position.y = b.baseY + (b.used ? 0 : Math.sin(clock.elapsedTime * 1.5 + b.x) * 0.06 * (this.calm ? 0.4 : 1)) + b.bounce; (b.group.userData.cube as THREE.Mesh).rotation.y += 0.005 * sp; });

    this.enemies.forEach(e => { if (e.alive) { e.group.position.x += e.dir * 0.012 * sp * (this.calm ? 0.6 : 1); if (Math.abs(e.group.position.x - e.home) > e.range) e.dir *= -1; e.group.rotation.y = e.dir > 0 ? 0.3 : -0.3; e.group.position.y = e.baseY + Math.abs(Math.sin(clock.elapsedTime * 4 + e.home)) * 0.08 * (this.calm ? 0.4 : 1); } else { e.squish += (0.1 - e.squish) * 0.2; (e.group.userData.body as THREE.Mesh).scale.set(1.4, Math.max(0.1, e.squish), 1.4); e.group.position.y = e.baseY - 0.3; } });

    if (this.sunPiece) {
      this.sunPiece.mesh.rotation.y += 0.02 * sp; this.sunPiece.group.position.y = this.sunPiece.y + Math.sin(clock.elapsedTime * 1.1) * 0.18 * (this.calm ? 0.4 : 1); this.sunPiece.glow.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2) * 0.08);
      const arrow = this.ui.byId('sunArrow'); const tip = arrow.querySelector('.arrow-tip') as HTMLElement | null;
      if (this.levelType === 'vertical') { const gapY = this.sunPiece.group.position.y - this.charPos.y; if (this.started && !this.paused && gapY > 4) { arrow.classList.add('show'); arrow.classList.remove('flip'); if (tip) tip.textContent = '▲'; } else { arrow.classList.remove('show'); } }
      else { if (tip) tip.textContent = '▶'; const gap = this.sunPiece.group.position.x - this.charPos.x; if (this.started && !this.paused && Math.abs(gap) > 6) { arrow.classList.add('show'); arrow.classList.toggle('flip', gap < 0); } else { arrow.classList.remove('show'); } }
    }

    // --- animate dynamic elements ---
    updateDynamics(this, sp);

    // particle FX — faithful to the prototype, which only filters this array
    // (spawnFx particles keep life=1, so this never actually culls them).
    this.fx = this.fx.filter(f => f.life > 0);

    if (stage.parallaxFar) stage.parallaxFar.rotation.y += 0.00005 * sp;
    stage.renderer.render(scene, camera);
  };
}
