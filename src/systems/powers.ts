import type * as THREE from 'three';
import type { PowerType } from '../core/types';
import { makePuff, makeStarMesh } from '../entities/meshes';
import type { Game } from '../main_game';

// Elemental "puff" powers. A soft, slow projectile that gently transforms a
// friendly alien into a reward star (warm) — no harm, on-brand for the no-fail
// design. Granted per level by a Power Box.

const POWER: Record<PowerType, { tint: number }> = {
  flame: { tint: 0xff7a3a },
  ice: { tint: 0x8fd0ff },
  bubble: { tint: 0xa8e0ff },
  spark: { tint: 0xffe06a },
};

export function powerTint(p: PowerType): number { return POWER[p].tint; }

const PUFF_SPEED = 0.34;   // units per frame (matches platformer's per-frame physics)
const PUFF_LIFE = 45;      // frames (~0.75s of travel)
const PUFF_COOLDOWN = 22;  // frames between casts (keeps it calm, no mashing)

export function castPuff(game: Game): void {
  if (!game.powerActive || !game.currentPower || game.paused || !game.started) return;
  if (game.puffCd > 0) return;
  game.puffCd = PUFF_COOLDOWN;
  const m = makePuff(powerTint(game.currentPower));
  m.position.set(game.charPos.x + game.facing * 0.7, game.charPos.y + 0.1, 0);
  game.stage.scene.add(m);
  game.puffs.push({ mesh: m, vx: game.facing * PUFF_SPEED, life: PUFF_LIFE });
  game.audio.sPuff();
}

export function updatePuffs(game: Game, sp: number): void {
  if (game.puffCd > 0) game.puffCd--;
  const scene = game.stage.scene;
  game.puffs.forEach(p => {
    p.mesh.position.x += p.vx * sp;
    p.life -= 1;
    p.mesh.rotation.z += 0.25 * sp;
    const core = p.mesh.userData.core as THREE.Mesh | undefined;
    if (core) (core.material as THREE.MeshBasicMaterial).opacity = 0.7 + Math.random() * 0.3;
    // transform a friendly alien into a reward star
    game.enemies.forEach(e => {
      if (!e.alive) return;
      if (Math.hypot(p.mesh.position.x - e.group.position.x, p.mesh.position.y - e.group.position.y) < 0.95) {
        game.squishEnemy(e); p.life = 0;
      }
    });
    // pop a sun-flare roller into a star too
    game.rollers.forEach(r => {
      if (!r.alive || !r.flare) return;
      if (Math.hypot(p.mesh.position.x - r.mesh.position.x, p.mesh.position.y - r.mesh.position.y) < 0.95) {
        r.alive = false; scene.remove(r.mesh); game.audio.sRock(); game.spawnFx(r.mesh.position, 0xffd27f, 9);
        const st = makeStarMesh(1, false); st.position.copy(r.mesh.position); st.position.y += 0.3; scene.add(st);
        game.starItems.push({ mesh: st, base: st.position.y, alive: true, reward: true, vy: 0.18 });
        p.life = 0;
      }
    });
  });
  game.puffs = game.puffs.filter(p => { if (p.life <= 0) { scene.remove(p.mesh); return false; } return true; });
}
