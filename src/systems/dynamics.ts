import * as THREE from 'three';
import { LEVEL_LEN, GROUND_Y } from '../core/constants';
import type { Planet } from '../core/types';
import { makeCloud, makeBird, makeRock, makeGeyser, makeIceChunk, makeBubble, makeFlare, makeBush } from '../entities/meshes';
import type { Game } from '../main_game';

// Builds the per-planet dynamic elements (wind, geysers, rolling rocks, ice,
// bubbles, etc.) and the per-frame animation of those elements.
// Ported verbatim from the prototype's buildDynamics() + animate() tail.

export function buildDynamics(game: Game, P: Planet): void {
  const d = P.dyn; if (!d) return;
  const scene = game.stage.scene;

  // Mercury: extra crater bumps + solar boost shimmer is handled in animate
  if (d.craters) { const cmat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 1 }); for (let k = 0; k < 14; k++) { const rim = new THREE.Mesh(new THREE.TorusGeometry(0.8 + Math.random() * 0.5, 0.18, 8, 18), cmat); rim.position.set(-LEVEL_LEN / 2 + 6 + k * 6 + Math.random() * 3, GROUND_Y + 0.02, 0.3); rim.rotation.x = Math.PI / 2; rim.scale.y = 0.5; scene.add(rim); game.decor.push(rim); } }
  // Mercury: rolling sun-flare orbs (glowing rollers you jump over or bop)
  if (d.flares) { d.flares.forEach(fx => { const r = makeFlare(); r.position.set(fx, GROUND_Y + 0.45, 0); scene.add(r); game.rollers.push({ mesh: r, x: fx, home: fx, dir: Math.random() < 0.5 ? -1 : 1, range: 5, alive: true, flare: true }); }); }

  // Venus: wind zones with drifting particles
  if (d.wind) {
    game.windZones = d.wind.zones.map(z => ({ x0: z[0], x1: z[1] })); game.windStrength = d.wind.strength;
    const wg = new THREE.BufferGeometry(), wp: number[] = []; for (let i = 0; i < 120; i++) { const z = d.wind.zones[i % d.wind.zones.length]!; wp.push(z[0] + Math.random() * (z[1] - z[0]), GROUND_Y + 0.5 + Math.random() * 4, (Math.random() - 0.5) * 2); }
    wg.setAttribute('position', new THREE.Float32BufferAttribute(wp, 3)); game.windParticles = new THREE.Points(wg, new THREE.PointsMaterial({ color: d.wind.color, size: 0.16, transparent: true, opacity: 0.55 })); scene.add(game.windParticles);
  }

  // Earth: cloud platforms + background birds + bouncy bushes
  if (d.clouds) { d.clouds.forEach(c => { const g = makeCloud(); g.position.set(c[0], GROUND_Y + c[1], 0); scene.add(g); game.movers.push({ mesh: g, x: c[0], top: GROUND_Y + c[1] + 0.3, w: 3.0, kind: 'cloud', baseY: GROUND_Y + c[1], phase: Math.random() * 6 }); }); }
  if (d.birds) { for (let i = 0; i < 4; i++) { const b = makeBird(); b.position.set(-LEVEL_LEN / 2 + i * 22, 5 + Math.random() * 3, -12 - Math.random() * 6); scene.add(b); game.decor.push(b); b.userData.spd = 0.02 + Math.random() * 0.02; } }
  if (d.springs) { d.springs.forEach(sx => { const m = makeBush(); m.position.set(sx, GROUND_Y + 0.35, 0); scene.add(m); game.bouncePads.push({ mesh: m, x: sx, y: GROUND_Y + 0.6, power: 0.78, spring: true }); }); }

  // Mars: rolling rocks + rust spires
  if (d.rocks) { d.rocks.forEach(rx => { const r = makeRock(); r.position.set(rx, GROUND_Y + 0.45, 0); scene.add(r); game.rollers.push({ mesh: r, x: rx, home: rx, dir: Math.random() < 0.5 ? -1 : 1, range: 5, alive: true }); }); }
  if (d.spires) { const smat = new THREE.MeshStandardMaterial({ color: P.hill, roughness: 1 }); [-12, 7, 26].forEach(sx => { const sp = new THREE.Mesh(new THREE.ConeGeometry(0.9, 2.4, 7), smat); sp.position.set(sx, GROUND_Y + 1.0, -1.2); scene.add(sp); game.decor.push(sp); }); }

  // Jupiter: bounce geysers + drifting storm clouds
  if (d.geysers) { d.geysers.forEach(gx => { const m = makeGeyser(); m.position.set(gx, GROUND_Y + 0.3, 0); scene.add(m); game.bouncePads.push({ mesh: m, x: gx, y: GROUND_Y + 0.6, power: 0.9 }); }); }
  if (d.stormClouds) { d.stormClouds.forEach(c => { const g = makeCloud(0xd9b98a); g.position.set(c[0], GROUND_Y + c[1], 0); scene.add(g); game.movers.push({ mesh: g, x: c[0], top: GROUND_Y + c[1] + 0.3, w: 3.0, kind: 'cloud', baseY: GROUND_Y + c[1], phase: Math.random() * 6, drift: 1 }); }); }

  // Saturn: floating ring-ice mover platforms
  if (d.ringMovers) { d.ringMovers.forEach(c => { const g = makeIceChunk(); g.position.set(c[0], GROUND_Y + c[1], 0); scene.add(g); game.movers.push({ mesh: g, x: c[0], top: GROUND_Y + c[1] + 0.3, w: 2.6, kind: 'ice', baseY: GROUND_Y + c[1], phase: Math.random() * 6, amp: 1.0 }); }); }

  // Uranus: ice patches (slippery spots) + frost
  if (d.ice) { const imat = new THREE.MeshStandardMaterial({ color: 0xcdeefb, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.7, emissive: 0x335566, emissiveIntensity: 0.2 }); d.ice.forEach(p => { const patch = new THREE.Mesh(new THREE.BoxGeometry(p[1], 0.12, 3), imat); patch.position.set(p[0], GROUND_Y + 0.07, 0.2); scene.add(patch); game.decor.push(patch); game.windZones.push({ x0: p[0] - p[1] / 2, x1: p[0] + p[1] / 2, ice: true }); }); }
  if (d.frost) { const fg = new THREE.BufferGeometry(), fp: number[] = []; for (let i = 0; i < 80; i++) fp.push((Math.random() - 0.5) * LEVEL_LEN, GROUND_Y + Math.random() * 6, (Math.random() - 0.5) * 4); fg.setAttribute('position', new THREE.Float32BufferAttribute(fp, 3)); const frost = new THREE.Points(fg, new THREE.PointsMaterial({ color: 0xffffff, size: 0.1, transparent: true, opacity: 0.6 })); scene.add(frost); game.decor.push(frost); frost.userData.frost = true; }

  // Neptune: alternating gusts + floating bubbles that bob you up
  if (d.gusts) {
    game.gustState.strength = d.gusts.strength; game.gustState.period = d.gusts.period;
    const gg = new THREE.BufferGeometry(), gp: number[] = []; for (let i = 0; i < 100; i++) gp.push((Math.random() - 0.5) * LEVEL_LEN, GROUND_Y + 0.5 + Math.random() * 5, (Math.random() - 0.5) * 3); gg.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3)); game.windParticles = new THREE.Points(gg, new THREE.PointsMaterial({ color: d.gusts.color, size: 0.14, transparent: true, opacity: 0.5 })); scene.add(game.windParticles);
  }
  if (d.bubbles) { d.bubbles.forEach(bx => { const m = makeBubble(); m.position.set(bx, GROUND_Y + 1.6, 0); scene.add(m); game.bubbles.push({ mesh: m, x: bx, y: GROUND_Y + 1.6, phase: Math.random() * 6 }); }); }
}

export function updateDynamics(game: Game, sp: number): void {
  const calm = game.calm;
  const clock = game.stage.clock;
  game.movingPlats.forEach(mp => { mp.t = (mp.t || 0) + mp.speed * sp * (calm ? 0.5 : 1); const off = Math.sin(mp.t + mp.phase) * mp.range; if (mp.axis === 'x') { const nx = mp.baseX + off; mp.dx = nx - mp.mesh.position.x; mp.mesh.position.x = nx; } else { mp.mesh.position.y = mp.baseY + off; mp.dx = 0; } });
  game.movers.forEach(mv => { const t = clock.elapsedTime; const amp = mv.amp || 0.5; mv.mesh.position.y = mv.baseY + Math.sin(t * 0.7 + mv.phase) * amp * (calm ? 0.4 : 1); if (mv.drift) { mv.mesh.position.x = mv.x + Math.sin(t * 0.3 + mv.phase) * 2.0; } mv.mesh.rotation.y += 0.003 * sp; });
  game.rollers.forEach(r => { if (!r.alive) return; r.mesh.position.x += r.dir * 0.025 * sp * (calm ? 0.5 : 1); if (Math.abs(r.mesh.position.x - r.home) > r.range) r.dir *= -1; if (r.mesh.userData.rock) r.mesh.userData.rock.rotation.z -= r.dir * 0.06 * sp; });
  game.bubbles.forEach(bb => { bb.mesh.position.y = bb.y + Math.sin(clock.elapsedTime * 1.2 + bb.phase) * 0.3 * (calm ? 0.4 : 1); bb.mesh.userData.b.scale.setScalar(1 + Math.sin(clock.elapsedTime * 2 + bb.phase) * 0.06); });
  game.bouncePads.forEach(bp => { if (bp.mesh.userData.jet) { bp.mesh.userData.jet.scale.y = 1 + Math.sin(clock.elapsedTime * 3 + bp.x) * 0.25; bp.mesh.userData.jet.material.opacity = 0.3 + Math.abs(Math.sin(clock.elapsedTime * 3 + bp.x)) * 0.25; } });
  if (game.windParticles) { const pos = game.windParticles.geometry.attributes.position as THREE.BufferAttribute; const drift = game.gustState.strength ? game.gustState.active * 0.3 : -0.12; for (let i = 0; i < pos.count; i++) { let x = pos.getX(i) + drift * sp * (calm ? 0.4 : 1); if (x < -LEVEL_LEN / 2) x = LEVEL_LEN / 2; if (x > LEVEL_LEN / 2) x = -LEVEL_LEN / 2; pos.setX(i, x); } pos.needsUpdate = true; }
  game.decor.forEach(d => { if (d.userData && d.userData.spd) { d.position.x += d.userData.spd * sp; if (d.position.x > LEVEL_LEN / 2 + 5) d.position.x = -LEVEL_LEN / 2 - 5; const t = clock.elapsedTime * 6; d.children.forEach((w, i) => { w.rotation.z = (i === 0 ? 1 : -1) * (Math.PI / 2.4 + Math.sin(t) * 0.3); }); } else if (d.userData && d.userData.frost) { const pos = (d as THREE.Points).geometry.attributes.position as THREE.BufferAttribute; for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) - 0.012 * sp * (calm ? 0.4 : 1); if (y < GROUND_Y) y = GROUND_Y + 6; pos.setY(i, y); } pos.needsUpdate = true; } });
}
