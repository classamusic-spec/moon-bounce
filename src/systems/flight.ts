import * as THREE from 'three';
import { FLIGHT_SECONDS } from '../core/constants';
import { PLANETS } from '../data/planets';
import { makeStarMesh } from '../entities/meshes';
import type { Game } from '../main_game';

// The 60-second flight mini-game between levels: intro hop-in, steerable flight
// with shootable space rocks and bonus stars, then arrival. Ported verbatim.

export function startFlight(game: Game): void {
  const ui = game.ui;
  game.mode = 'flight'; game.paused = false;
  const nextP = PLANETS[game.pIndex + 1]!;
  // hide platformer-only HUD bits, show flight HUD
  ui.bySel('.top-bar').style.display = 'none';
  ui.byId('planets').style.display = 'none';
  ui.byId('platControls').style.display = 'none';
  ui.byId('flightControls').style.display = 'none';
  ui.byId('sunArrow').classList.remove('show');
  ui.byId('flightHud').classList.add('show');
  ui.byId('flightTarget').textContent = '🚀 Flying to ' + nextP.name;
  ui.byId('flightHint').textContent = 'Hop in the rocket! 🚀';
  ui.byId('flightFill').style.width = '0%';

  // hide the whole platformer scene
  game.stage.scene.visible = false;

  // build a dedicated flight scene
  const fscene = new THREE.Scene();
  fscene.fog = new THREE.FogExp2(0x05060f, 0.012);
  const fcam = new THREE.PerspectiveCamera(55, innerWidth / innerHeight, 0.1, 400);
  fcam.position.set(0, 0, 10); fcam.lookAt(0, 0, 0);
  fscene.add(new THREE.AmbientLight(0xffffff, 0.85));
  const fkey = new THREE.DirectionalLight(0xffffff, 0.7); fkey.position.set(2, 3, 5); fscene.add(fkey);

  // starfield (deep)
  const sg = new THREE.BufferGeometry(), sp: number[] = [];
  for (let i = 0; i < 900; i++) sp.push((Math.random() - 0.5) * 120, (Math.random() - 0.5) * 80, -Math.random() * 200);
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starf = new THREE.Points(sg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.4, transparent: true, opacity: 0.9 }));
  fscene.add(starf);

  // colorful nebula dust
  const ng = new THREE.BufferGeometry(), np: number[] = [], nc: number[] = [];
  const tint = new THREE.Color(nextP.sky[1]);
  for (let i = 0; i < 200; i++) { np.push((Math.random() - 0.5) * 100, (Math.random() - 0.5) * 60, -Math.random() * 180); nc.push(tint.r, tint.g, tint.b); }
  ng.setAttribute('position', new THREE.Float32BufferAttribute(np, 3));
  ng.setAttribute('color', new THREE.Float32BufferAttribute(nc, 3));
  const neb = new THREE.Points(ng, new THREE.PointsMaterial({ size: 1.6, transparent: true, opacity: 0.25, vertexColors: true }));
  fscene.add(neb);

  // the rocket (blob in a little ship)
  const rocket = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xe8eef7, roughness: 0.3, metalness: 0.2 });
  const hull = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 1.4, 20), bodyMat);
  hull.rotation.z = Math.PI / 2; rocket.add(hull);
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.5, 0.7, 20), new THREE.MeshStandardMaterial({ color: 0xff7a7a, roughness: 0.3 })); nose.rotation.z = -Math.PI / 2; nose.position.x = 1.05; rocket.add(nose);
  const finMat = new THREE.MeshStandardMaterial({ color: 0x6db8ff, roughness: 0.4 });
  ([[-0.7, 0.5, 0], [-0.7, -0.5, 0], [-0.7, 0, 0.5]] as [number, number, number][]).forEach(p => { const fin = new THREE.Mesh(new THREE.ConeGeometry(0.28, 0.6, 4), finMat); fin.position.set(p[0], p[1], p[2]); fin.rotation.z = Math.PI / 2; if (p[2]) fin.rotation.y = Math.PI / 2; rocket.add(fin); });
  // window with blob face
  const win = new THREE.Mesh(new THREE.SphereGeometry(0.34, 20, 16), new THREE.MeshStandardMaterial({ color: 0x16243a, emissive: 0x0a1830, emissiveIntensity: 0.4, roughness: 0.1 })); win.position.set(0.25, 0, 0.42); rocket.add(win);
  const eyeM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.4 });
  ([[0.3, 0.1], [0.3, -0.1]] as [number, number][]).forEach(p => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 10), eyeM); e.position.set(0.5, p[1], 0.5); rocket.add(e); });
  // flame
  const flame = new THREE.Mesh(new THREE.ConeGeometry(0.32, 0.9, 14), new THREE.MeshBasicMaterial({ color: 0xffb74d, transparent: true, opacity: 0.85 })); flame.rotation.z = Math.PI / 2; flame.position.x = -1.1; rocket.add(flame);
  // start upright on the ground for the intro hop-in
  rocket.position.set(-1.6, -1.6, 0); rocket.rotation.z = Math.PI / 2;
  fscene.add(rocket);

  // a little ground line for the intro
  const ground = new THREE.Mesh(new THREE.BoxGeometry(30, 0.6, 4), new THREE.MeshStandardMaterial({ color: PLANETS[game.pIndex]!.ground, roughness: 0.95 }));
  ground.position.set(0, -2.8, -0.5); fscene.add(ground);

  // the hopping blob (matches the player character look)
  const blob = new THREE.Group();
  const bMat = new THREE.MeshStandardMaterial({ color: PLANETS[game.pIndex]!.char || 0xa8e0ff, roughness: 0.35, emissive: 0x223344, emissiveIntensity: 0.25 });
  const bBody = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 22), bMat); bBody.scale.set(1, 0.92, 1); blob.add(bBody);
  const bVisor = new THREE.Mesh(new THREE.SphereGeometry(0.32, 24, 18, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: 0x16243a, roughness: 0.1, metalness: 0.3, emissive: 0x0a1830, emissiveIntensity: 0.4 })); bVisor.position.set(0, 0.07, 0.3); bVisor.rotation.x = 0.3; blob.add(bVisor);
  const beM = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  [-0.1, 0.1].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.07, 16, 12), beM); e.position.set(x, 0.1, 0.54); blob.add(e); });
  blob.position.set(-3.6, -2.2, 0.5); fscene.add(blob);

  // target planet ahead (grows over the flight)
  const planet = new THREE.Mesh(new THREE.SphereGeometry(4, 40, 32), new THREE.MeshStandardMaterial({ color: nextP.sky[1], emissive: nextP.sky[1], emissiveIntensity: 0.2, roughness: 0.7 }));
  planet.position.set(8, 2, -160); fscene.add(planet);
  let pRing: THREE.Mesh | null = null;
  if (nextP.rings) { pRing = new THREE.Mesh(new THREE.RingGeometry(5, 8, 48), new THREE.MeshBasicMaterial({ color: 0xf0e0b0, side: THREE.DoubleSide, transparent: true, opacity: 0.5 })); pRing.position.copy(planet.position); pRing.rotation.x = Math.PI * 0.42; fscene.add(pRing); }

  game.flight = {
    fscene, fcam, rocket, flame, planet, pRing, starf, neb, ground, blob,
    phase: 'intro', introT: 0,
    t: 0, ry: 0, vy: 0, bonusStars: [], asteroids: [], lasers: [], shootCd: 0, autoFire: 0, rocksBlasted: 0, fxList: [], spawnTimer: 0, astTimer: 0, done: false, arriving: false,
  };

  // pre-seed a few
  for (let i = 0; i < 6; i++) flightSpawnStar(game);
  for (let i = 0; i < 3; i++) flightSpawnAsteroid(game);
}

function flightSpawnStar(game: Game): void {
  const flight = game.flight!;
  const m = makeStarMesh(1, false);
  m.position.set(14 + Math.random() * 16, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 2);
  m.userData.spin = (Math.random() - 0.5) * 0.05;
  flight.fscene.add(m); flight.bonusStars.push(m);
}

function flightSpawnAsteroid(game: Game): void {
  const flight = game.flight!;
  const m = new THREE.Mesh(new THREE.DodecahedronGeometry(0.6 + Math.random() * 0.5, 0), new THREE.MeshStandardMaterial({ color: 0x8a8a9a, roughness: 1, flatShading: true }));
  m.position.set(16 + Math.random() * 18, (Math.random() - 0.5) * 7, (Math.random() - 0.5) * 2);
  m.userData.spin = new THREE.Vector3(Math.random() * 0.04, Math.random() * 0.04, Math.random() * 0.04);
  flight.fscene.add(m); flight.asteroids.push(m);
}

export function flightShoot(game: Game): void {
  const flight = game.flight;
  if (!flight || flight.arriving || flight.shootCd > 0) return;
  flight.shootCd = 0.22; // small cooldown
  const bolt = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 0.7, 8), new THREE.MeshBasicMaterial({ color: 0x9fe8ff }));
  bolt.rotation.z = Math.PI / 2; bolt.position.set(flight.rocket.position.x + 1.2, flight.rocket.position.y, 0);
  flight.fscene.add(bolt); flight.lasers.push({ mesh: bolt, dead: false });
  if (!game.calm) game.audio.sLaser();
}

function flightBurst(game: Game, pos: THREE.Vector3, color: number): void {
  const flight = game.flight!;
  for (let i = 0; i < 8; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.1, 6, 5), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1 })); m.position.copy(pos); flight.fscene.add(m); flight.fxList.push({ mesh: m, v: new THREE.Vector3((Math.random() - 0.5) * 0.3, (Math.random() - 0.5) * 0.3, 0), life: 1 }); }
}

function endFlight(game: Game): void {
  const ui = game.ui;
  const flight = game.flight!;
  // arrival animation then load next level
  flight.arriving = true;
  (ui.byId('flightArrive').querySelector('.fa-emoji') as HTMLElement).textContent = PLANETS[game.pIndex + 1]!.emoji;
  const tally = flight.rocksBlasted > 0 ? ('Arriving! 🪨×' + flight.rocksBlasted + ' blasted') : 'Arriving!';
  (ui.byId('flightArrive').querySelector('.fa-text') as HTMLElement).textContent = tally;
  const fa = ui.byId('flightArrive'); fa.classList.remove('show'); void fa.offsetWidth; fa.classList.add('show');
  if (!game.calm) game.audio.sSun();
  setTimeout(() => {
    ui.byId('flightHud').classList.remove('show');
    ui.bySel('.top-bar').style.display = '';
    ui.byId('planets').style.display = '';
    ui.byId('platControls').style.display = 'flex';
    ui.byId('flightControls').style.display = 'none';
    fa.classList.remove('show');
    // tear down flight scene
    if (game.flight) { game.flight.fscene.traverse(o => { const m = o as THREE.Mesh; if (m.geometry) m.geometry.dispose && m.geometry.dispose(); }); game.flight = null; }
    game.stage.scene.visible = true;
    game.move.up = false; game.move.down = false; game.move.shoot = false;
    game.mode = 'platformer';
    game.pIndex++; game.audio.pIndex = game.pIndex; game.loadLevel(game.pIndex, false); game.paused = false;
  }, 1600);
}

export function updateFlight(game: Game): void {
  const flight = game.flight;
  if (!flight) return; const f = flight; const sp = game.calm ? 0.5 : 1;
  const renderer = game.stage.renderer;
  const dt = Math.min(game.stage.clock.getDelta(), 0.05);

  // ---- INTRO: blob hops into the rocket, then lift-off ----
  if (f.phase === 'intro') {
    f.introT += dt * (game.calm ? 0.7 : 1);
    const T = f.introT;
    // frame the ground action: aim camera lower at the start, ease back up
    const camEase = Math.min(1, T / 2.0);
    f.fcam.position.set(0, -1.6 + camEase * 1.6, 9); f.fcam.lookAt(0, -1.4 + camEase * 1.4, 0);
    // phase A (0 - 1.2s): blob hops in an arc from ground into the rocket window
    if (T < 1.2) {
      const u = T / 1.2;
      const sx = -3.6, ex = -1.6; // blob start -> rocket x
      const sy = -2.2, ey = -0.4; // up to the hatch
      f.blob.position.x = sx + (ex - sx) * u;
      f.blob.position.y = sy + (ey - sy) * u + Math.sin(u * Math.PI) * 1.6; // arc hop
      f.blob.position.z = 0.5 * (1 - u); // settle to center
      f.blob.scale.setScalar(1 - u * 0.55); // shrink as it enters
      f.blob.rotation.z = u * 0.6;
    } else if (T < 2.0) {
      // phase B (1.2 - 2.0s): blob gone, rocket lifts and tips to horizontal
      const u = (T - 1.2) / 0.8;
      f.blob.visible = false;
      f.rocket.position.y = -1.6 + u * 1.6; // lift to center
      f.rocket.position.x = -1.6 + u * 0.1; // settle toward flight start x
      f.rocket.rotation.z = Math.PI / 2 - u * (Math.PI / 2); // upright -> horizontal
      (f.flame.material as THREE.MeshBasicMaterial).opacity = 0.4 + u * 0.5;
      f.flame.scale.set(1 + u * 0.6, 1, 1);
      f.ground.position.y = -2.8 - u * 4; // ground drops away
      if (!game.calm && T < 1.28) game.audio.sBoing();
    } else {
      // transition to flight
      f.phase = 'fly';
      f.fcam.position.set(0, 0, 10); f.fcam.lookAt(0, 0, 0);
      f.rocket.position.set(-1.5, 0, 0); f.rocket.rotation.z = 0; f.ry = 0; f.vy = 0;
      f.fscene.remove(f.ground); f.fscene.remove(f.blob);
      game.ui.byId('flightControls').style.display = 'flex';
      game.ui.byId('flightHint').textContent = '▲ ▼ to steer • 🔫 shoot rocks • collect ⭐';
    }
    renderer.render(f.fscene, f.fcam);
    return;
  }

  if (!f.arriving) {
    f.t += dt * sp; // real seconds, frame-rate independent
    if (f.shootCd > 0) f.shootCd -= dt;
    if (game.move.shoot && f.shootCd <= 0) flightShoot(game); // hold to auto-fire
    const prog = Math.min(1, f.t / FLIGHT_SECONDS);
    game.ui.byId('flightFill').style.width = (prog * 100).toFixed(1) + '%';

    const fr = dt * 60; // frame factor: 1.0 at 60fps
    // steering: up/down buttons move rocket up/down (slower, gentler)
    let d = 0; if (game.move.up) d += 1; if (game.move.down) d -= 1;
    f.vy += d * 0.014 * sp * fr; f.vy *= 0.90; f.ry += f.vy * fr; f.ry = Math.max(-3.4, Math.min(3.4, f.ry));
    f.rocket.position.y = f.ry; f.rocket.rotation.z = f.vy * 2.0; f.rocket.rotation.x = Math.sin(f.t * 3) * 0.05;
    f.flame.scale.set(1 + Math.sin(f.t * 30) * 0.3, 1, 1); (f.flame.material as THREE.MeshBasicMaterial).opacity = 0.6 + Math.random() * 0.3;

    // scroll field toward camera (slower)
    f.starf.position.x -= 0.4 * sp * fr; if (f.starf.position.x < -60) f.starf.position.x = 0;
    f.neb.position.x -= 0.2 * sp * fr; if (f.neb.position.x < -50) f.neb.position.x = 0;

    // planet approaches (driven by progress, always correct)
    f.planet.position.z = -160 + prog * 150; f.planet.position.x = 8 - prog * 6;
    if (f.pRing) { f.pRing.position.copy(f.planet.position); }

    // bonus stars move left (slower), collect on overlap
    f.bonusStars.forEach(m => { m.position.x -= 0.11 * sp * fr; m.rotation.z += m.userData.spin; if (m.position.x > -900 && Math.hypot(m.position.x - f.rocket.position.x, m.position.y - f.rocket.position.y) < 1.2) { flightBurst(game, m.position.clone(), 0xffe9a8); m.position.x = -999; game.smallStars++; game.updateHUD(); if (!game.calm) game.audio.sStar(); } });
    f.bonusStars = f.bonusStars.filter(m => { if (m.position.x < -30) { f.fscene.remove(m); return false; } return true; });

    // lasers fly right, pop asteroids
    f.lasers.forEach(L => { L.mesh.position.x += 0.5 * fr; f.asteroids.forEach(m => { if (m.position.x > -900 && Math.hypot(L.mesh.position.x - m.position.x, L.mesh.position.y - m.position.y) < 0.9) { m.userData.dead = true; L.dead = true; f.rocksBlasted++; if (!game.calm) game.audio.sRock(); flightBurst(game, m.position.clone(), 0x9a9aaa); // popped rock -> a star reward
      const st = makeStarMesh(0.8, false); st.position.copy(m.position); f.fscene.add(st); f.bonusStars.push(st); st.userData.spin = (Math.random() - 0.5) * 0.05; } }); });
    f.lasers = f.lasers.filter(L => { if (L.dead || L.mesh.position.x > 30) { f.fscene.remove(L.mesh); return false; } return true; });

    // asteroids drift left (slower), gentle bump (nudge rocket, no fail)
    f.asteroids.forEach(m => { m.position.x -= 0.08 * sp * fr; m.rotation.x += m.userData.spin.x; m.rotation.y += m.userData.spin.y; if (!m.userData.dead && Math.hypot(m.position.x - f.rocket.position.x, m.position.y - f.rocket.position.y) < 1.3) { const push = Math.sign(f.rocket.position.y - m.position.y) || 1; f.vy += push * 0.10; if (!game.calm) game.audio.sBump(); m.userData.dead = true; } });
    f.asteroids = f.asteroids.filter(m => { if (m.userData.dead || m.position.x < -30) { f.fscene.remove(m); return false; } return true; });

    // spawn pacing (time-based)
    f.spawnTimer += dt; if (f.spawnTimer > 0.7) { f.spawnTimer = 0; flightSpawnStar(game); }
    f.astTimer += dt; if (f.astTimer > 1.9) { f.astTimer = 0; flightSpawnAsteroid(game); }

    // little flight sparkles
    f.fxList.forEach(p => { p.mesh.position.add(p.v); p.life -= 0.04; (p.mesh.material as THREE.MeshBasicMaterial).opacity = Math.max(0, p.life); if (p.life <= 0) f.fscene.remove(p.mesh); });
    f.fxList = f.fxList.filter(p => p.life > 0);

    if (prog >= 1) endFlight(game);
  }
  renderer.render(f.fscene, f.fcam);
}
