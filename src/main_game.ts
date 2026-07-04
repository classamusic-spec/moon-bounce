import * as THREE from 'three';
import { GROUND_Y, CHAR_R, LEVEL_LEN, MOVE_SPEED } from './core/constants';
import { PLANETS } from './data/planets';
import type {
  Mode, Flight, Platform, StarItem, FactBox, Enemy, Mover, Roller, Bubble,
  BouncePad, WindZone, MovingPlat, SunPiece, Fx, GustState, TerrainType,
  PowerBox, Puff, Gap, PowerType, Freezable,
} from './core/types';
import { makeCharacter, makeStarMesh, applyBlobCosmetics, disposeObject } from './entities/meshes';
import { colorById, hatById } from './data/cosmetics';
import { castPuff, updatePuffs } from './systems/powers';
import type { Planet } from './core/types';
import type { Moon } from './data/moons';
import { AudioSystem } from './systems/audio';
import { Stage, loadLevel } from './systems/level';
import { updateDynamics, stepDynamics } from './systems/dynamics';
import { startFlight, flightShoot, updateFlight } from './systems/flight';
import { Storage, masterStickerId, secretStickerId } from './systems/storage';
import { UI } from './ui/ui';

// The Game: owns all mutable state, input, the physics step, and the main loop.
// Ported faithfully from the prototype's globals + animate()/physics functions.
const PHYS_STEP = 1 / 60;
// Fall-speed cap: keeps every landing inside the 0.5-unit catch window (no
// tunneling through platforms) and reads gentler — on brand for this game.
const MAX_FALL = 0.42;
// Sparkle particles share one geometry (they differ only by material color).
const FX_GEO = new THREE.SphereGeometry(0.07, 8, 6);

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

  // The currently loaded level definition (a planet or a moon). Physics reads
  // this rather than PLANETS[pIndex], so moon bonus levels just plug in.
  level: Planet = PLANETS[0]!;
  onMoon = false;
  currentMoon: Moon | null = null;

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

  // soft gaps + elemental power
  gaps: Gap[] = [];
  catchY = GROUND_Y - 3.0;
  powerBox: PowerBox | null = null;
  puffs: Puff[] = [];
  puffCd = 0;
  powerActive = false;
  currentPower: PowerType | null = null;
  freezables: Freezable[] = [];

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
  factQueue: 'box' | 'sun' | 'moon' | null = null;
  bonusShown = false;
  reduceMotion = false;
  assist = false;
  /** Paused-aware world clock (seconds); drives stepped sinusoid motion. */
  worldT = 0;
  private acc = 0;

  // ---- blob personality (all purely visual, all gentle) ----
  /** Seconds with no input while grounded — drives look-around + sleepy breathing. */
  idleT = 0;
  /** Countdown to the next blink, then a short closed-eyes phase. */
  private blinkNext = 2.5;
  private blinkHold = 0;
  /** Level-start greeting wiggle (counts down from 1.4). */
  greetT = 0;
  /** Joyful 360° spin on big rewards (counts down from 1). */
  celebrateT = 0;

  constructor(container: HTMLElement) {
    this.stage = new Stage(container);
    this.audio = new AudioSystem();
    this.ui = new UI();
    this.storage = new Storage();
  }

  init(): void {
    this.applySettings();
    this.char = makeCharacter();
    this.stage.scene.add(this.char);
    this.refreshBlob();
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
  loadLevel(i: number, instant: boolean): void { this.onMoon = false; this.currentMoon = null; loadLevel(this, PLANETS[i]!, instant); this.greetT = 1.4; this.idleT = 0; }
  loadMoon(moon: Moon): void { this.onMoon = true; this.currentMoon = moon; loadLevel(this, moon, true); this.greetT = 1.4; this.idleT = 0; }
  startFlight(): void { startFlight(this); }
  flightShoot(): void { flightShoot(this); }
  castPuff(): void { this.idleT = 0; castPuff(this); }

  /** Bumping the Power Box grants this level's elemental power. */
  grantPower(): void {
    const pb = this.powerBox; if (!pb || pb.used) return;
    pb.used = true; this.powerActive = true;
    this.audio.sBox(); this.audio.sStar(); this.spawnFx(pb.group.position, 0xffd27f, 14);
    this.stage.scene.remove(pb.group);
    this.ui.setPuffVisible(true);
  }

  // ---- HUD / dots ----
  updateHUD(): void { this.ui.setHUD(this.smallStars, this.boxesFound); }
  updatePlanetDots(): void { this.ui.updatePlanetDots(this.pIndex, this.storage.highestUnlocked); }

  // ---- player actions ----
  doJump(): void {
    if (this.paused || !this.started) return;
    this.idleT = 0;
    if (this.onGround) { this.vel.y = this.level.jump; this.onGround = false; this.squash = 0.7; this.audio.sJump(); }
  }

  toggleCalm(): void { this.calm = !this.calm; this.audio.calm = this.calm; if (this.calm) this.audio.stopSpeak(); this.storage.setSetting('calm', this.calm); }

  /** Load persisted settings into the game + audio (called on init). */
  applySettings(): void {
    const s = this.storage.settings;
    this.calm = s.calm; this.audio.calm = s.calm;
    this.audio.speakOn = s.speakOn;
    this.audio.musicOn = s.musicOn;
    this.audio.voiceRate = s.voiceRate;
    this.audio.volume = s.volume;
    this.reduceMotion = s.reduceMotion;
    this.assist = s.assist;
  }

  /** Re-apply the equipped color + hat to the player character. */
  refreshBlob(): void {
    applyBlobCosmetics(this.char, colorById(this.storage.equippedColor).hex, hatById(this.storage.equippedHat).kind);
  }

  goToPlanet(i: number): void {
    this.audio.resume(); this.ui.fadeTransition();
    // make sure we're cleanly in platformer mode
    if (this.mode === 'flight') {
      if (this.flight) { if (this.flight.arriveTimer) clearTimeout(this.flight.arriveTimer); try { disposeObject(this.flight.fscene); } catch (e) { /* ignore */ } this.flight = null; }
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
    this.pIndex = i; this.audio.pIndex = i; this.storage.setLastPlanet(i); this.loadLevel(i, true); this.storage.bumpVisit(i); this.paused = false; this.started = true;
  }

  /** Enter a moon bonus level (parent planet must be unlocked). */
  goToMoon(moon: Moon): void {
    this.audio.resume(); this.ui.fadeTransition();
    this.pIndex = moon.parent; this.audio.pIndex = moon.parent;
    this.ui.byId('select').classList.remove('show');
    this.ui.byId('menu').classList.remove('show');
    this.loadMoon(moon); this.paused = false; this.started = true;
  }

  /** Leave a moon: drop back to its parent planet and reopen the Galaxy Map. */
  exitMoon(): void {
    this.ui.fadeTransition();
    const parent = this.currentMoon ? this.currentMoon.parent : this.pIndex;
    this.pIndex = parent; this.audio.pIndex = parent;
    // hold the world still under the map (goToPlanet/goToMoon unpause on the way out)
    this.loadLevel(parent, true); this.paused = true;
    this.ui.buildGalaxyMap(this, i => this.goToPlanet(i), m => this.goToMoon(m));
    this.ui.byId('select').classList.add('show');
  }

  // ---- rewards / interactions ----
  collectStar(s: StarItem): void {
    if (s.cache) { this.collectCache(s); return; }
    s.alive = false; this.audio.sStar(); this.spawnFx(s.mesh.position, s.secret ? 0xaaccff : 0xffe9a8); this.stage.scene.remove(s.mesh); this.smallStars++; this.storage.addStars(1); this.updateHUD();
    if (s.secret && !this.starItems.some(o => o.alive && o.secret)) this.completeSecret();
  }

  /** All 4 hidden stars found: bonus stars + a Star-Finder sticker + a happy spin. */
  completeSecret(): void {
    this.audio.sSun();
    const bonus = 5; this.smallStars += bonus; this.storage.addStars(bonus); this.updateHUD();
    if (!this.onMoon) this.storage.awardSticker(secretStickerId(this.pIndex));
    this.ui.showToast('🔭', 'Hidden stars found! +' + bonus);
    this.celebrateT = 1; // the blob does a joyful spin
    this.spawnFx(new THREE.Vector3(this.charPos.x, this.charPos.y + 1, 0), 0xaaccff, 14);
  }

  /** Found a secret power cache: bonus stars + a Power-Master sticker. */
  collectCache(s: StarItem): void {
    s.alive = false; this.stage.scene.remove(s.mesh);
    this.audio.sSun(); this.spawnFx(s.mesh.position, 0xffd24d, 16);
    const bonus = 8; this.smallStars += bonus; this.storage.addStars(bonus); this.updateHUD();
    if (!this.onMoon) this.storage.awardSticker(masterStickerId(this.pIndex));
    this.ui.showToast('⭐', 'Power Master! +' + bonus);
    this.celebrateT = 1;
  }

  spawnFx(pos: THREE.Vector3, color: number, n?: number): void {
    n = Math.max(1, Math.round((n || 10) * (this.reduceMotion ? 0.4 : 1)));
    for (let i = 0; i < n; i++) {
      const m = new THREE.Mesh(FX_GEO, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 }));
      m.position.copy(pos); this.stage.scene.add(m);
      this.fx.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 0.16, (Math.random() - 0.05) * 0.2, (Math.random() - 0.5) * 0.16), life: 1 });
    }
  }

  popBox(b: FactBox): void {
    if (b.used) return; b.used = true; b.bounce = 0.2; this.boxesFound++; this.updateHUD(); this.audio.sBox(); this.spawnFx(b.group.position, 0xfff0a0, 8);
    (b.group.userData.mat as THREE.MeshStandardMaterial).emissiveIntensity = 0.12; (b.group.userData.mat as THREE.MeshStandardMaterial).color.setHex(0xb9905a);
    if (!this.onMoon) this.storage.markFact(this.pIndex, b.factIndex); // record in the Space Journal (moon facts aren't journaled)
    this.factQueue = 'box';
    this.ui.prepBoxFact(this.level.name, b.fact, !this.audio.ttsSupported || this.calm);
    this.paused = true; setTimeout(() => this.ui.showFact(), 250); this.audio.speak(b.fact);
  }

  showBonus(): void {
    if (this.bonusShown) return; this.bonusShown = true; this.audio.sSun();
    for (let i = 0; i < 3; i++) setTimeout(() => this.spawnFx(new THREE.Vector3(this.charPos.x, this.charPos.y + 1, 0), 0xffe082, 14), i * 180);
    this.ui.triggerBonusToast();
    this.celebrateT = 1; // joyful spin for finding all 5 facts
  }

  squishEnemy(e: Enemy): void {
    e.alive = false; e.squish = 0.15; this.audio.sBop(); this.spawnFx(e.group.position, 0xfff0c0, 9);
    const m = makeStarMesh(1, false); m.position.copy(e.group.position); m.position.y += 0.3; this.stage.scene.add(m);
    this.starItems.push({ mesh: m, base: m.position.y, alive: true, reward: true, vy: 0.18 });
  }

  /** Puff transform: a power gently turns a friendly alien into a reward star. */
  puffEnemy(e: Enemy): void {
    const p = this.currentPower;
    const col = p === 'ice' ? 0x9fd8ff : p === 'bubble' ? 0xbcd6ff : p === 'spark' ? 0xfff0a0 : 0xfff0c0;
    e.alive = false; e.squish = 0.15;
    if (p === 'ice') this.audio.sIce(); else if (p === 'spark') this.audio.sSpark(); else if (p === 'bubble') this.audio.sBoing(); else this.audio.sBop();
    this.spawnFx(e.group.position, col, 10);
    if (p === 'ice') (e.group.userData.mat as THREE.MeshStandardMaterial).color.setHex(0xbfe3ff);
    const m = makeStarMesh(1, false); m.position.copy(e.group.position); m.position.y += 0.3; this.stage.scene.add(m);
    this.starItems.push({ mesh: m, base: m.position.y, alive: true, reward: true, vy: 0.18 });
  }

  bumpBack(): void {
    if (this.hitCooldown > 0) return; this.hitCooldown = 40; this.audio.sBump(); this.vel.y = Math.max(this.vel.y, 0.22); this.vel.x = -this.facing * 0.18; this.onGround = false;
  }

  reachSun(): void {
    if (this.paused) return; this.paused = true; this.audio.sSun(); this.spawnFx(this.sunPiece!.group.position, 0xffd24d, 16);
    if (this.onMoon) { this.reachMoonGoal(); return; }
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

  /** Reached the treasure at the end of a moon bonus level. */
  reachMoonGoal(): void {
    const moon = this.currentMoon!;
    this.storage.awardSticker(moon.sticker);
    this.factQueue = 'moon';
    this.ui.prepMoonFact(moon, !this.audio.ttsSupported || this.calm);
    setTimeout(() => this.ui.showFact(), 650);
    this.audio.speak('You explored ' + moon.name + '! ' + moon.fact);
  }

  onFactBtn(): void {
    this.audio.stopSpeak(); this.ui.hideFact();
    if (this.factQueue === 'sun') { this.startFlight(); }
    else if (this.factQueue === 'moon') { this.exitMoon(); }
    else { this.paused = false; if (this.factQueue === 'box' && this.boxesFound >= 5) setTimeout(() => this.showBonus(), 200); }
    this.factQueue = null;
  }

  /** Advance gameplay-relevant world motion by one fixed step: moving
   *  platforms, rollers, waddling aliens, reward stars, star pickup, puffs.
   *  Lives inside the physics step so it is frame-rate independent AND holds
   *  still while a fact card or menu has the game paused. */
  private stepWorld(): void {
    const sp = this.calm ? 0.55 : 1;
    this.worldT += PHYS_STEP;
    stepDynamics(this, sp);
    // waddling aliens
    this.enemies.forEach(e => { if (!e.alive) return; e.group.position.x += e.dir * 0.012 * sp * (this.calm ? 0.6 : 1); if (Math.abs(e.group.position.x - e.home) > e.range) e.dir *= -1; });
    // reward stars pop up then settle; any touched star is collected
    this.starItems.forEach(s => {
      if (!s.alive) return;
      if (s.reward) { s.vy! -= 0.012; s.mesh.position.y += s.vy!; if (s.mesh.position.y <= s.base) { s.vy = 0; s.mesh.position.y = s.base; } }
      if (Math.hypot(this.charPos.x - s.mesh.position.x, this.charPos.y - s.mesh.position.y) < CHAR_R + 0.45) this.collectStar(s);
    });
    // elemental puffs (travel + gentle transforms)
    updatePuffs(this, sp);
  }

  /** Fixed-timestep physics: one 1/60s step (run N times per frame). */
  private stepPhysics(): void {
    const scene = this.stage.scene;
    if (this.hitCooldown > 0) this.hitCooldown--;
    if (this.started && !this.paused) {
      this.stepWorld();
      let dir = 0; if (this.move.left) dir -= 1; if (this.move.right) dir += 1;
      if (dir !== 0 || !this.onGround) this.idleT = 0; else this.idleT += PHYS_STEP;
      let targetVx = dir * MOVE_SPEED * (this.calm ? 0.7 : 1) * (this.assist ? 0.78 : 1);

      // --- wind zones (Venus) & ice friction (Uranus): horizontal push / slide ---
      let onIce = false, windPush = 0;
      this.windZones.forEach(z => { if (this.charPos.x >= z.x0 && this.charPos.x <= z.x1) { if (z.ice) { onIce = true; } else { windPush -= (this.windStrength || 0.05) * (this.calm ? 0.5 : 1); if (this.windActive !== true) { this.windActive = true; if (Math.random() < 0.05) this.audio.sWind(); } } } });
      if (!this.windZones.some(z => !z.ice && this.charPos.x >= z.x0 && this.charPos.x <= z.x1)) this.windActive = false;
      // wind makes forward travel slower and idle drift backward, but never overpowers active forward push
      if (windPush !== 0) { if (dir > 0) { targetVx = Math.max(0.02, targetVx + windPush); } else if (dir < 0) { targetVx += windPush; } else { targetVx = windPush; } }

      // --- Neptune gusts: alternating push (capped so forward walking always progresses) ---
      if (this.gustState.strength) { this.gustState.timer++; const ph = Math.sin(this.gustState.timer / (this.gustState.period || 240) * Math.PI * 2); this.gustState.active = ph; const g = ph * this.gustState.strength * (this.calm ? 0.5 : 1); if (dir > 0) { targetVx = Math.max(0.02, targetVx + g); } else if (dir < 0) { targetVx += g; } else { targetVx += g * 0.6; } }

      // --- Mercury solar boost: brief speed shimmer ---
      if (this.level.dyn && this.level.dyn!.boost) { this.boostTimer++; if (this.boostTimer % 420 < 60) { targetVx *= 1.35; } }

      if (this.hitCooldown < 30) {
        if (onIce) { this.charSlide += (targetVx - this.charSlide) * 0.04; this.vel.x = this.charSlide; } // slippery: slow to change
        else if (this.slippery) { this.charSlide += (targetVx - this.charSlide) * 0.10; this.vel.x = this.charSlide; }
        else { this.vel.x = targetVx; this.charSlide = targetVx; }
        if (dir !== 0) this.facing = dir;
      }
      const prevX = this.charPos.x;
      this.charPos.x += this.vel.x; this.charPos.x = Math.max(this.levelMinX, Math.min(this.levelMaxX, this.charPos.x));
      this.vel.y -= this.level.grav * (this.calm ? 0.7 : 1) * (this.assist ? 0.85 : 1);
      if (this.vel.y < -MAX_FALL) this.vel.y = -MAX_FALL; // gentle terminal fall (also prevents landing tunneling)
      this.charPos.y += this.vel.y * (this.calm ? 0.7 : 1);
      // pit sides are solid: while down inside a gap you can't slide out through
      // the ground (which used to teleport the blob up through the surface)
      if (this.levelType !== 'vertical') {
        for (const g of this.gaps) {
          if (prevX >= g.x0 && prevX <= g.x1 && this.charPos.y < this.groundAt(prevX) + CHAR_R - 0.4) {
            this.charPos.x = Math.max(g.x0 + 0.25, Math.min(g.x1 - 0.25, this.charPos.x));
            break;
          }
        }
      }

      // ground height: vertical levels have a tiny base only near the middle; horizontal use groundAt
      let groundTop: number;
      if (this.levelType === 'vertical') { groundTop = (Math.abs(this.charPos.x) <= 10) ? GROUND_Y + CHAR_R : -999; }
      else if (this.gaps.length > 0 && this.gaps.some(g => this.charPos.x >= g.x0 && this.charPos.x <= g.x1)) { groundTop = -Infinity; }
      else { groundTop = this.groundAt(this.charPos.x) + CHAR_R; }
      let landed = false; const footY = groundTop;
      if (this.charPos.y <= footY) { const thud = !this.onGround && this.vel.y < -0.14; this.charPos.y = footY; if (!this.onGround) this.squash = 1.25; this.vel.y = 0; this.onGround = true; landed = true; if (thud) this.spawnFx(new THREE.Vector3(this.charPos.x, footY - CHAR_R + 0.1, 0), this.level.dust, 6); }
      if (this.vel.y <= 0) { this.platforms.forEach(pl => { if (Math.abs(this.charPos.x - pl.x) < pl.w / 2 + CHAR_R * 0.6) { const top = pl.top + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5 && this.charPos.y > footY - 0.1) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.25; this.onGround = true; landed = true; } } }); }
      // moving platforms: stand on top AND get carried
      if (this.vel.y <= 0) { this.movingPlats.forEach(mp => { if (Math.abs(this.charPos.x - mp.mesh.position.x) < mp.w / 2 + CHAR_R * 0.5) { const top = mp.mesh.position.y + 0.22 + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.2; this.onGround = true; landed = true; if (mp.axis === 'x') { this.charPos.x += mp.dx || 0; } } } }); }
      // mover platforms (clouds, ice chunks)
      if (this.vel.y <= 0) { this.movers.forEach(mv => { if (Math.abs(this.charPos.x - mv.mesh.position.x) < mv.w / 2 + CHAR_R * 0.5) { const top = mv.mesh.position.y + 0.3 + CHAR_R; if (this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; if (!this.onGround) this.squash = 1.2; this.onGround = true; landed = true; } } }); }
      this.factBoxes.forEach(b => { if (Math.abs(this.charPos.x - b.x) < 0.5 + CHAR_R * 0.6) { const top = b.baseY + 0.5 + CHAR_R; if (this.vel.y <= 0 && this.charPos.y <= top && this.charPos.y > top - 0.5) { this.charPos.y = top; this.vel.y = 0; this.onGround = true; landed = true; if (!b.used) this.popBox(b); } const bottom = b.baseY - 0.5 - CHAR_R; if (this.vel.y > 0 && this.charPos.y >= bottom && this.charPos.y < bottom + 0.5) { if (!b.used) this.popBox(b); this.vel.y = -0.05; } } });

      // bounce pads / geysers: launch high
      this.bouncePads.forEach(bp => { if (Math.abs(this.charPos.x - bp.x) < 1.0 && this.charPos.y <= bp.y + CHAR_R + 0.4 && this.vel.y <= 0.05) { this.vel.y = this.level.jump * bp.power + 0.2; this.onGround = false; this.squash = 0.6; this.audio.sBoing(); } });

      // bubbles: gentle upward bob when touched
      this.bubbles.forEach(bb => { if (Math.hypot(this.charPos.x - bb.mesh.position.x, this.charPos.y - bb.mesh.position.y) < CHAR_R + 0.7) { if (this.vel.y < 0.1) { this.vel.y = this.level.jump * 0.55; this.onGround = false; this.audio.sBoing(); this.spawnFx(bb.mesh.position, 0xbcd0ff, 5); } } });

      if (!landed && this.charPos.y > footY + 0.05) this.onGround = false;
      // vertical safety net: if you fall below the base, gently set down on the base ground (no death)
      if (this.levelType === 'vertical' && this.charPos.y < GROUND_Y - 1) { this.charPos.x += (0 - this.charPos.x) * 0.2; this.charPos.y = GROUND_Y + CHAR_R; this.vel.y = 0; this.vel.x = 0; this.onGround = true; landed = true; this.squash = 1.25; }
      // soft-gap catch: miss a jump and the cushion below bounces you back up (no fail)
      if (this.gaps.length > 0 && this.levelType !== 'vertical' && this.vel.y <= 0 && this.charPos.y <= this.catchY + CHAR_R && this.gaps.some(g => this.charPos.x >= g.x0 && this.charPos.x <= g.x1)) {
        this.charPos.y = this.catchY + CHAR_R; this.vel.y = this.level.jump; this.onGround = false; this.squash = 0.6; this.audio.sBoing();
      }

      // Power Box: walk near or bump it to gain this level's elemental power (generous radius)
      if (this.powerBox && !this.powerBox.used && Math.hypot(this.charPos.x - this.powerBox.group.position.x, this.charPos.y - this.powerBox.group.position.y) < CHAR_R + 1.4) this.grantPower();

      // rolling rocks: bop to pop, side-touch = gentle bump
      this.rollers.forEach(r => { if (!r.alive) return; const dx = this.charPos.x - r.mesh.position.x, dy = this.charPos.y - r.mesh.position.y; if (Math.abs(dx) < CHAR_R + 0.4 && dy < CHAR_R + 0.5 && dy > -0.2) { if (this.vel.y < 0 && this.charPos.y > r.mesh.position.y + 0.25) { r.alive = false; scene.remove(r.mesh); this.audio.sRock(); this.spawnFx(r.mesh.position, 0xc4623d, 9); const m = makeStarMesh(1, false); m.position.copy(r.mesh.position); m.position.y += 0.3; scene.add(m); this.starItems.push({ mesh: m, base: m.position.y, alive: true, reward: true, vy: 0.18 }); this.vel.y = this.level.jump * 0.7; } else { this.bumpBack(); } } });

      this.enemies.forEach(e => { if (!e.alive) return; const dx = this.charPos.x - e.group.position.x, dy = this.charPos.y - e.group.position.y; if (Math.abs(dx) < CHAR_R + 0.45 && dy < CHAR_R + 0.6 && dy > -0.2) { if (this.vel.y < 0 && this.charPos.y > e.group.position.y + 0.3) { this.squishEnemy(e); this.vel.y = this.level.jump * 0.7; this.onGround = false; } else { this.bumpBack(); } } });

      if (this.sunPiece && Math.hypot(this.charPos.x - this.sunPiece.group.position.x, this.charPos.y - this.sunPiece.group.position.y) < CHAR_R + 1.1) this.reachSun();
    }
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
    const dt = Math.min(clock.getDelta(), 0.1); const sp = this.calm ? 0.55 : 1;
    stage.skyTop.lerp(stage.tSkyTop, 0.05); stage.skyBot.lerp(stage.tSkyBot, 0.05); stage.setSkyBg();
    // fixed-timestep physics: same number of 1/60s steps at any refresh rate
    this.acc += dt; let physSteps = 0;
    while (this.acc >= PHYS_STEP && physSteps < 6) { this.stepPhysics(); this.acc -= PHYS_STEP; physSteps++; }
    if (physSteps >= 6) this.acc = 0;

    this.char.position.set(this.charPos.x, this.charPos.y, 0);
    this.squash += (1 - this.squash) * 0.15;
    const stretch = this.vel.y > 0 ? 1 + this.vel.y * 0.25 : 1;
    // sleepy breathing after ~10s of stillness (very subtle, very slow)
    const breathe = this.idleT > 10 ? 1 + Math.sin(this.idleT * 2.0) * 0.02 : 1;
    (this.char.userData.body as THREE.Mesh).scale.set(this.squash, (2 - this.squash) * 0.92 * stretch * breathe, this.squash);

    // --- blob personality (purely visual, gentle, reduce-motion aware) ---
    // blink: soft close every few seconds
    this.blinkNext -= dt * sp;
    if (this.blinkNext <= 0) { this.blinkHold = 0.13; this.blinkNext = 2.2 + Math.random() * 3.2; }
    if (this.blinkHold > 0) this.blinkHold -= dt;
    const eyes = this.char.userData.eyes as THREE.Mesh[] | undefined;
    if (eyes) { const eyeY = this.blinkHold > 0 ? 0.12 : 1; eyes.forEach(e => { e.scale.y += (eyeY - e.scale.y) * 0.6; }); }
    // facing, joyful 360° spin on big finds, or a slow look-around when idle
    let rotY = this.facing > 0 ? 0.25 : -0.25;
    if (this.celebrateT > 0) {
      this.celebrateT = Math.max(0, this.celebrateT - dt * 1.1);
      if (!this.reduceMotion) rotY += (1 - this.celebrateT) * Math.PI * 2;
    } else if (this.idleT > 4 && !this.reduceMotion) {
      const ease = Math.min(1, (this.idleT - 4) / 1.5);
      rotY = rotY * (1 - ease * 0.5) + Math.sin((this.idleT - 4) * 0.7) * 0.5 * ease;
    }
    this.char.rotation.y = rotY;
    // greeting wiggle on level start (antenna bulb glows a touch brighter too)
    if (this.greetT > 0) { this.greetT = Math.max(0, this.greetT - dt); this.char.rotation.z = Math.sin(this.greetT * 9) * 0.1 * (this.greetT / 1.4) * (this.reduceMotion ? 0.4 : 1); }
    else this.char.rotation.z = 0;
    ((this.char.userData.bulb as THREE.Mesh).material as THREE.MeshStandardMaterial).emissiveIntensity = 0.6 + Math.sin(clock.elapsedTime * 2) * 0.3 + (this.greetT > 0 ? 0.35 : 0);

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
    if (stage.dustPts) { stage.dustPts.position.x = camera.position.x * 0.85; if (!this.reduceMotion) stage.dustPts.rotation.y += 0.0004 * sp; }
    stage.parallaxMid.position.x = camera.position.x * 0.25;
    stage.parallaxMid.position.y = this.levelType === 'vertical' ? camera.position.y * 0.2 : 0;

    // (star fall + pickup moved into the fixed physics step; this is just spin/bob)
    this.starItems.forEach(s => { if (!s.alive) return; s.mesh.rotation.y += 0.02 * sp; s.mesh.rotation.z += 0.008 * sp; if (!s.reward) { s.mesh.position.y = s.base + Math.sin(clock.elapsedTime * 0.9 + s.mesh.userData.bob) * 0.2 * (this.calm ? 0.4 : 1); } });

    this.factBoxes.forEach(b => { b.bounce *= 0.85; b.group.position.y = b.baseY + (b.used ? 0 : Math.sin(clock.elapsedTime * 1.5 + b.x) * 0.06 * (this.calm ? 0.4 : 1)) + b.bounce; (b.group.userData.cube as THREE.Mesh).rotation.y += 0.005 * sp; });

    if (this.powerBox && !this.powerBox.used) { const pb = this.powerBox; pb.group.position.y = pb.baseY + Math.sin(clock.elapsedTime * 1.6 + pb.x) * 0.12 * (this.calm ? 0.4 : 1); (pb.group.userData.cube as THREE.Mesh).rotation.y += 0.02 * sp; }

    // (alien walking moved into the fixed physics step; this is facing/bob/squish)
    this.enemies.forEach(e => { if (e.alive) { e.group.rotation.y = e.dir > 0 ? 0.3 : -0.3; e.group.position.y = e.baseY + Math.abs(Math.sin(clock.elapsedTime * 4 + e.home)) * 0.08 * (this.calm ? 0.4 : 1); } else { e.squish += (0.1 - e.squish) * 0.2; (e.group.userData.body as THREE.Mesh).scale.set(1.4, Math.max(0.1, e.squish), 1.4); e.group.position.y = e.baseY - 0.3; } });

    if (this.sunPiece) {
      this.sunPiece.mesh.rotation.y += 0.02 * sp; this.sunPiece.group.position.y = this.sunPiece.y + Math.sin(clock.elapsedTime * 1.1) * 0.18 * (this.calm ? 0.4 : 1); this.sunPiece.glow.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2) * 0.08);
      const arrow = this.ui.byId('sunArrow'); const tip = arrow.querySelector('.arrow-tip') as HTMLElement | null;
      if (this.levelType === 'vertical') { const gapY = this.sunPiece.group.position.y - this.charPos.y; if (this.started && !this.paused && gapY > 4) { arrow.classList.add('show'); arrow.classList.remove('flip'); if (tip) tip.textContent = '▲'; } else { arrow.classList.remove('show'); } }
      else { if (tip) tip.textContent = '▶'; const gap = this.sunPiece.group.position.x - this.charPos.x; if (this.started && !this.paused && Math.abs(gap) > 6) { arrow.classList.add('show'); arrow.classList.toggle('flip', gap < 0); } else { arrow.classList.remove('show'); } }
    }

    // --- animate dynamic elements (visual-only; gameplay motion is stepped) ---
    updateDynamics(this, sp);

    // particle FX: drift, settle, and fade out (collect/pop/squish sparkles)
    this.fx.forEach(f => {
      f.mesh.position.x += f.v.x * sp; f.mesh.position.y += f.v.y * sp; f.mesh.position.z += f.v.z * sp;
      f.v.y -= 0.011 * sp; f.v.multiplyScalar(0.96);
      f.life -= 0.05 * sp;
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, f.life);
      if (f.life <= 0) { scene.remove(f.mesh); (f.mesh.material as THREE.Material).dispose(); }
    });
    this.fx = this.fx.filter(f => f.life > 0);

    if (stage.parallaxFar && !this.reduceMotion) stage.parallaxFar.rotation.y += 0.00005 * sp;
    stage.renderer.render(scene, camera);
  };
}
