import * as THREE from 'three';
import {
  crystalMat, glowMat, metalMat, noiseTex, organicMat, rockMat, sharedGeo, signalMat,
} from '../systems/materials';

// ---------- The Lumins: gentle native life of the solar system ----------
//
// WORLD FICTION: the Sun drifted off to sleep and its light scattered. The
// Lumins are the shy, kindly creatures that found stray light and have been
// keeping it safe. Every Lumin visibly CARRIES a piece of that light — a shard,
// a lantern, a bulb, a glowing seam or snout. A soft bop makes one cheerfully
// hand its light over as a Glimmer. They are custodians, never adversaries:
//   * nothing here chases, threatens, lunges, snaps, strobes or startles;
//   * every motion is sine-based, 0.4–1.1 Hz, low amplitude, fully eased;
//   * Calm Mode halves amplitude, motion-reduction damps to ~35%.
//
// ART DIRECTION: each Lumin is built from 4–5 authored layers (body mass →
// features → trim/plates → light pocket → halo card) drawn from the shared
// material roles in systems/materials.ts, so the whole roster reads as one
// family while each silhouette stays instantly distinguishable at small size.
//
// BUDGET: every Lumin is under ~900 triangles and shares its geometry through
// sharedGeo(); only the skin material is unique per creature (the ice power
// recolours it at runtime). Nothing casts shadows — there are many on screen.
//
// INTEGRATION CONTRACT (the game owns everything else):
//   userData.kind  — the LuminKind
//   userData.body  — the Mesh the game squashes on the Y axis when bopped
//   userData.mat   — the UNIQUE MeshStandardMaterial the ice power recolours
// animateLumin() only ever touches an inner rig, so the game keeps full
// ownership of the group's world position (patrol movement, ground snapping).

export type LuminKind = 'waddler' | 'hopper' | 'drifter' | 'roller' | 'glider' | 'burrower';

// ---------- palette ----------

/** The stray sunlight every Lumin carries — one hue across the whole roster,
 *  so "that glow means light to collect" is learnable in a single level. */
const GLIMMER = 0xffe6a8;
const GLIMMER_CORE = 0xfff4d6;

function shade(hex: number, f: number): number {
  return new THREE.Color(hex).multiplyScalar(f).getHex();
}
function tint(hex: number, f: number): number {
  return new THREE.Color(hex).lerp(new THREE.Color(0xffffff), f).getHex();
}

// ---------- shared geometry (built once, reused by every Lumin) ----------

/** A unit sphere with its ellipsoid shape BAKED IN, so meshes keep scale 1 and
 *  their children live in clean local space (and the game's squash — which
 *  overwrites body.scale — still lands on a sensible pancake). */
function sph(key: string, w: number, h: number, sx = 1, sy = 1, sz = 1): THREE.SphereGeometry {
  return sharedGeo(`lum.${key}`, () => {
    const g = new THREE.SphereGeometry(1, w, h);
    if (sx !== 1 || sy !== 1 || sz !== 1) g.scale(sx, sy, sz);
    return g;
  });
}

const G = {
  /** round body mass (216 tris) */
  bodyRound: () => sph('bodyRound', 12, 9, 1, 0.84, 0.94),
  /** upright body mass (108) */
  bodyTall: () => sph('bodyTall', 9, 7, 0.86, 1.06, 0.84),
  /** flat lozenge body (108) */
  bodyFlat: () => sph('bodyFlat', 9, 7, 1.12, 0.5, 0.8),
  /** roller shell — perfectly round in the roll plane so it never wobbles (216) */
  shell: () => sph('shell', 12, 9, 1, 1, 0.9),
  /** head mass (108) */
  head: () => sph('head', 9, 7),
  /** wing membrane (90) */
  wing: () => sph('wing', 9, 6, 1, 0.16, 0.62),
  /** small blob: feet, paws, eye whites (64) */
  blobS: () => sph('blobS', 8, 5),
  /** tiny blob: pupils, beads, ears (36) */
  blobXS: () => sph('blobXS', 6, 4),
  /** carapace dome (96) */
  dome: () => sharedGeo('lum.dome', () => new THREE.SphereGeometry(1, 12, 5, 0, Math.PI * 2, 0, Math.PI * 0.58)),
  /** jellyfish bell, lathed profile (120) */
  bell: () => sharedGeo('lum.bell', () => new THREE.LatheGeometry([
    new THREE.Vector2(0.80, -0.26),
    new THREE.Vector2(0.88, -0.04),
    new THREE.Vector2(0.78, 0.22),
    new THREE.Vector2(0.56, 0.48),
    new THREE.Vector2(0.28, 0.62),
    new THREE.Vector2(0.02, 0.66),
  ], 12)),
  /** cap disc for the bell underside (12) */
  disc: () => sharedGeo('lum.disc', () => new THREE.CircleGeometry(1, 12)),
  /** soft cone: snouts, tails (16) */
  cone: () => sharedGeo('lum.cone', () => new THREE.ConeGeometry(1, 1, 8)),
  /** open tube: tendril segments, whiskers, wing spars (16) */
  tube: () => sharedGeo('lum.tube', () => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)),
  /** faceted glimmer shard (20) */
  shard: () => sharedGeo('lum.shard', () => new THREE.IcosahedronGeometry(1, 0)),
  /** tiny glow bead (8) */
  spot: () => sharedGeo('lum.spot', () => new THREE.OctahedronGeometry(1, 0)),
  /** friendly smile arc (64) */
  smile: () => sharedGeo('lum.smile', () => new THREE.TorusGeometry(1, 0.16, 4, 8, Math.PI)),
  /** rim trim ring (100) */
  rim: () => sharedGeo('lum.rim', () => new THREE.TorusGeometry(1, 0.2, 5, 10)),
  /** armour rib (80) */
  rib: () => sharedGeo('lum.rib', () => new THREE.TorusGeometry(1, 0.13, 4, 10)),
  /** glowing seam (80) */
  seam: () => sharedGeo('lum.seam', () => new THREE.TorusGeometry(1, 0.055, 4, 10)),
  /** halo card (2) */
  card: () => sharedGeo('lum.card', () => new THREE.PlaneGeometry(1, 1)),
};

// ---------- materials ----------

/** The one UNIQUE material per Lumin: the ice power recolours it at runtime,
 *  so it must never be a cached/shared instance. Mirrors the organic role. */
function skinMat(color: number): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color, roughness: 0.52, metalness: 0.0,
    map: noiseTex(), bumpMap: noiseTex(), bumpScale: 0.012,
    emissive: 0x141a22, emissiveIntensity: 0.6,
  });
}

/** Cached role materials shared by every Lumin of a given palette. */
interface Kit {
  skin: THREE.MeshStandardMaterial;   // unique
  plate: THREE.MeshStandardMaterial;  // carapace, ribs, soil
  trimM: THREE.MeshStandardMaterial;  // rims, spars, whiskers
  soft: THREE.MeshStandardMaterial;   // membranes, tendrils, ears
  dark: THREE.MeshStandardMaterial;   // feet, paws
  gem: THREE.MeshStandardMaterial;    // the carried Glimmer
  core: THREE.MeshStandardMaterial;   // bulbs, seams, snout tips
  halo: THREE.MeshBasicMaterial;      // soft light card
  eyeW: THREE.MeshStandardMaterial;
  eyeP: THREE.MeshStandardMaterial;
}

function kitFor(color: number, accent: number): Kit {
  return {
    skin: skinMat(color),
    plate: rockMat(shade(accent, 0.86), { rough: 0.78 }),
    trimM: metalMat(tint(accent, 0.4), 0.36),
    soft: organicMat(tint(color, 0.28)),
    dark: organicMat(shade(color, 0.42)),
    gem: crystalMat(GLIMMER, GLIMMER_CORE, 0.92),
    core: signalMat(GLIMMER_CORE, 1.15),
    halo: glowMat(GLIMMER, 0.3, true),
    eyeW: signalMat(0xffffff, 0.35),
    eyeP: organicMat(0x232a38),
  };
}

// ---------- build helpers ----------

function mk(g: THREE.BufferGeometry, m: THREE.Material, x = 0, y = 0, z = 0): THREE.Mesh {
  const me = new THREE.Mesh(g, m);
  me.position.set(x, y, z);
  return me;
}

function grp(parent: THREE.Object3D, x = 0, y = 0, z = 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

/** Big friendly eyes: a pivot per eye (scaled on Y to blink) holding a soft
 *  white and a dark pupil that drifts a little toward where the Lumin walks. */
function addEyes(parent: THREE.Object3D, kit: Kit, L: LuminRig, dx: number, y: number, z: number, r: number): void {
  for (const s of [-1, 1]) {
    const p = grp(parent, s * dx, y, z);
    const white = mk(G.blobS(), kit.eyeW);
    white.scale.setScalar(r);
    p.add(white);
    const pupil = mk(G.blobXS(), kit.eyeP, 0, -0.04 * r, r * 0.62);
    pupil.scale.setScalar(r * 0.46);
    pupil.userData.r = r;
    p.add(pupil);
    L.eyes.push(p);
    L.pupils.push(pupil);
  }
}

/** The light this Lumin keeps safe: a faceted shard plus a soft halo card. */
function addGlimmer(parent: THREE.Object3D, kit: Kit, L: LuminRig, x: number, y: number, z: number, s: number): void {
  const shard = mk(G.shard(), kit.gem, x, y, z);
  shard.scale.setScalar(s);
  shard.rotation.set(0.4, 0.6, 0.2);
  parent.add(shard);
  addHalo(parent, kit, L, x, y, z + s * 0.9, s * 5.2);
}

function addHalo(parent: THREE.Object3D, kit: Kit, L: LuminRig, x: number, y: number, z: number, s: number): void {
  const card = mk(G.card(), kit.halo, x, y, z);
  card.scale.setScalar(s);
  card.userData.s = s;
  parent.add(card);
  L.glow.push(card);
}

// ---------- rig state (everything animateLumin is allowed to touch) ----------

interface LuminRig {
  kind: LuminKind;
  rig: THREE.Group;
  bodyWrap: THREE.Group;
  body: THREE.Mesh;
  phase: number;
  /** eased facing yaw + roll accumulator (delta-driven, never snaps) */
  yaw: number;
  roll: number;
  lastT: number;
  eyes: THREE.Object3D[];
  pupils: THREE.Object3D[];
  feet: THREE.Object3D[];
  legs: THREE.Object3D[];
  ears: THREE.Object3D[];
  wings: THREE.Object3D[];
  wingTips: THREE.Object3D[];
  /** chains of pivots, root first — each segment lags the one above it */
  tendrils: THREE.Object3D[][];
  glow: THREE.Object3D[];
  head?: THREE.Object3D;
  tail?: THREE.Object3D;
  snout?: THREE.Object3D;
  diver?: THREE.Group;
  mound?: THREE.Object3D;
}

function newRig(kind: LuminKind, rig: THREE.Group): LuminRig {
  return {
    kind, rig, bodyWrap: rig, body: undefined as unknown as THREE.Mesh,
    phase: Math.random() * Math.PI * 2, yaw: 0, roll: 0, lastT: 0,
    eyes: [], pupils: [], feet: [], legs: [], ears: [], wings: [], wingTips: [],
    tendrils: [], glow: [],
  };
}

// ---------- 1. WADDLER ----------
// Silhouette: a low round pebble on two stubby feet, wearing a ridged carapace
// like a rucksack with a Glimmer nested in the top of it. Widest, roundest,
// most "classic creature" shape of the six.  ~826 tris
function buildWaddler(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  const wrap = grp(rig, 0, 0.02, 0);
  wrap.scale.setScalar(0.5);
  L.bodyWrap = wrap;

  const body = mk(G.bodyRound(), kit.skin);
  wrap.add(body);
  L.body = body;

  // carapace + rim trim (children of the body, so they squash with the bop)
  const shellCap = mk(G.dome(), kit.plate, 0, 0.14, -0.16);
  shellCap.scale.set(0.94, 0.74, 0.88);
  shellCap.rotation.x = -0.24;
  body.add(shellCap);

  const rim = mk(G.rim(), kit.trimM, 0, 0.10, -0.16);
  rim.rotation.set(Math.PI / 2 - 0.24, 0, 0);
  rim.scale.set(0.98, 0.93, 0.5);
  body.add(rim);

  addEyes(body, kit, L, 0.34, 0.28, 0.80, 0.30);

  const smile = mk(G.smile(), kit.eyeP, 0, -0.04, 0.86);
  smile.rotation.z = Math.PI;
  smile.scale.setScalar(0.24);
  body.add(smile);

  // the light it keeps, riding high on the carapace so it is never occluded
  addGlimmer(body, kit, L, 0, 0.74, -0.10, 0.22);

  // stubby feet on their own pivots (they alternate as it rocks along)
  for (const s of [-1, 1]) {
    const p = grp(rig, s * 0.22, -0.38, 0.04);
    const foot = mk(G.blobS(), kit.dark);
    foot.scale.set(0.17, 0.11, 0.21);
    p.add(foot);
    L.feet.push(p);
  }
}

// ---------- 2. HOPPER ----------
// Silhouette: tall and narrow — small round head with two soft upright ears,
// slim body, long folded rear legs, and a curling tail that ends in a glowing
// bulb held up behind it like a lantern on a stick.  ~834 tris
function buildHopper(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  const wrap = grp(rig, 0, 0.10, 0);
  wrap.scale.setScalar(0.36);
  L.bodyWrap = wrap;

  const body = mk(G.bodyTall(), kit.skin);
  wrap.add(body);
  L.body = body;

  const collar = mk(G.tube(), kit.trimM, 0, 0.62, 0);
  collar.scale.set(0.78, 0.12, 0.76);
  body.add(collar);

  const head = mk(G.head(), kit.skin, 0, 1.0, 0.06);
  head.scale.setScalar(0.62);
  body.add(head);
  L.head = head;

  addEyes(head, kit, L, 0.42, 0.16, 0.80, 0.50);
  const mouth = mk(G.spot(), kit.eyeP, 0, -0.22, 0.94);
  mouth.scale.set(0.16, 0.09, 0.10);
  head.add(mouth);

  // soft rounded ears on pivots (they flop a beat behind the hop)
  for (const s of [-1, 1]) {
    const p = grp(head, s * 0.34, 0.62, -0.04);
    p.rotation.z = s * 0.18;
    const ear = mk(G.blobXS(), kit.soft, 0, 0.42, 0);
    ear.scale.set(0.17, 0.46, 0.16);
    p.add(ear);
    L.ears.push(p);
  }

  // long rear legs — pivot at the hip so they fold up at the top of a hop
  for (const s of [-1, 1]) {
    const p = grp(rig, s * 0.17, 0.12, -0.02);
    const thigh = mk(G.blobXS(), kit.skin, 0, -0.20, 0);
    thigh.scale.set(0.10, 0.24, 0.11);
    p.add(thigh);
    const foot = mk(G.blobS(), kit.dark, 0, -0.51, 0.05);
    foot.scale.set(0.16, 0.09, 0.22);
    p.add(foot);
    L.legs.push(p);
  }

  // lantern tail: two beads curling up into the bulb it carries
  const tail = grp(rig, 0, 0.30, -0.22);
  const b1 = mk(G.blobXS(), kit.soft, 0, 0.10, -0.09);
  b1.scale.setScalar(0.10);
  tail.add(b1);
  const b2 = mk(G.blobXS(), kit.soft, 0, 0.24, -0.17);
  b2.scale.setScalar(0.085);
  tail.add(b2);
  const bulb = mk(G.blobS(), kit.core, 0, 0.40, -0.23);
  bulb.scale.setScalar(0.13);
  tail.add(bulb);
  addHalo(tail, kit, L, 0, 0.40, -0.10, 0.6);
  L.tail = tail;
}

// ---------- 3. DRIFTER ----------
// Silhouette: a hovering jellyfish — a smooth lathed bell with a bright rim,
// a glowing core suspended inside it, and three long tendrils that trail and
// lag behind every drift.  ~750 tris
function buildDrifter(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  const wrap = grp(rig, 0, 0.06, 0);
  wrap.scale.setScalar(0.46);
  L.bodyWrap = wrap;

  const bell = mk(G.bell(), kit.skin);
  wrap.add(bell);
  L.body = bell;

  const cap = mk(G.disc(), kit.plate, 0, -0.26, 0);
  cap.rotation.x = Math.PI / 2;
  cap.scale.setScalar(0.8);
  bell.add(cap);

  const rim = mk(G.rim(), kit.trimM, 0, -0.14, 0);
  rim.rotation.x = Math.PI / 2;
  rim.scale.set(0.86, 0.86, 0.3);
  bell.add(rim);

  // the light it keeps, suspended inside the translucent bell
  const core = mk(G.shard(), kit.core, 0, 0.06, 0);
  core.scale.setScalar(0.3);
  bell.add(core);
  const aura = mk(G.blobS(), kit.halo, 0, 0.06, 0);
  aura.scale.setScalar(0.52);
  aura.userData.s = 0.52;
  bell.add(aura);
  L.glow.push(aura);
  addHalo(bell, kit, L, 0, 0.08, 0.5, 1.5);

  addEyes(bell, kit, L, 0.32, 0.16, 0.70, 0.26);

  // three trailing tendrils; each segment is a child of the one above it, so
  // the sway accumulates down the chain and the tips lag furthest behind.
  const roots: [number, number][] = [[-0.24, 0.10], [0.02, -0.12], [0.26, 0.05]];
  for (const r of roots) {
    const chain: THREE.Object3D[] = [];
    let parent: THREE.Object3D = rig;
    let y = -0.14;
    for (let i = 0; i < 3; i++) {
      const p = grp(parent, i === 0 ? r[0] : 0, y, i === 0 ? r[1] : 0);
      const seg = mk(G.tube(), kit.soft, 0, -0.11, 0);
      seg.scale.set(0.045 - i * 0.008, 0.22, 0.045 - i * 0.008);
      p.add(seg);
      chain.push(p);
      parent = p;
      y = -0.22;
    }
    const tip = mk(G.blobXS(), kit.soft, 0, -0.22, 0);
    tip.scale.setScalar(0.05);
    parent.add(tip);
    L.tendrils.push(chain);
  }
}

// ---------- 4. ROLLER ----------
// Silhouette: a plated ball — an armadillo/pill-bug shell banded with two
// raised ribs and one bright seam that sweeps past as it rolls, with a small
// upright head peeking out of the front so its eyes never spin.  ~838 tris
function buildRoller(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  const wrap = grp(rig, 0, 0, 0);
  wrap.scale.setScalar(0.48);
  L.bodyWrap = wrap;

  const shell = mk(G.shell(), kit.skin);
  wrap.add(shell);
  L.body = shell;

  // armour ribs perpendicular to the roll axis, so the roll is readable
  for (const x of [-0.42, 0.42]) {
    const rib = mk(G.rib(), kit.plate, x, 0, 0);
    rib.rotation.y = Math.PI / 2;
    rib.scale.set(0.83, 0.92, 1.0);
    shell.add(rib);
  }
  // the light it keeps, running as a glowing seam between the plates
  const seam = mk(G.seam(), kit.core, 0, 0, 0);
  seam.rotation.y = Math.PI / 2;
  seam.scale.set(0.93, 1.02, 1.0);
  shell.add(seam);
  // the seam's glow is parented to the rig, not the shell, so the light stays
  // put while the plates turn past it
  addHalo(rig, kit, L, 0, 0.2, 0.34, 0.62);

  // head on its own pivot — it stays upright while the shell turns
  const head = grp(rig, 0, -0.14, 0.32);
  const skull = mk(G.head(), kit.skin);
  skull.scale.setScalar(0.24);
  head.add(skull);
  addEyes(skull, kit, L, 0.42, 0.20, 0.78, 0.46);
  const snoot = mk(G.blobXS(), kit.dark, 0, -0.06, 0.96);
  snoot.scale.set(0.24, 0.18, 0.2);
  skull.add(snoot);
  L.head = head;

  // two little foot nubs so it still reads as grounded
  for (const s of [-1, 1]) {
    const p = grp(rig, s * 0.22, -0.4, 0.16);
    const nub = mk(G.blobXS(), kit.dark);
    nub.scale.set(0.13, 0.09, 0.15);
    p.add(nub);
    L.feet.push(p);
  }
}

// ---------- 5. GLIDER ----------
// Silhouette: wide and flat — a manta/leaf seen face-on, two broad membranes
// spanning left and right with bright spars and glowing spots along them, a
// small lantern in its chest and a short tail behind.  ~700 tris
function buildGlider(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  const wrap = grp(rig, 0, 0, 0);
  wrap.scale.setScalar(0.34);
  L.bodyWrap = wrap;

  const body = mk(G.bodyFlat(), kit.skin);
  wrap.add(body);
  L.body = body;

  addEyes(body, kit, L, 0.30, 0.34, 0.76, 0.36);
  // the light it keeps, worn on the chest like a lantern
  addGlimmer(body, kit, L, 0, 0.10, 0.5, 0.3);

  // broad membranes on flap pivots, each with a lagging tip section
  for (const s of [-1, 1]) {
    const p = grp(rig, s * 0.14, 0.02, 0);
    const memb = mk(G.wing(), kit.soft, s * 0.20, 0, 0);
    memb.scale.set(0.26, 0.9, 0.22);
    p.add(memb);

    const spar = mk(G.tube(), kit.trimM, s * 0.22, 0.03, 0.09);
    spar.rotation.z = Math.PI / 2;
    spar.scale.set(0.022, 0.4, 0.022);
    p.add(spar);

    const spot = mk(G.spot(), kit.core, s * 0.22, 0.05, 0.02);
    spot.scale.setScalar(0.045);
    p.add(spot);

    const tip = grp(p, s * 0.32, 0, 0);
    const tipMemb = mk(G.blobXS(), kit.soft, s * 0.09, 0, 0);
    tipMemb.scale.set(0.13, 0.045, 0.13);
    tip.add(tipMemb);
    const tipSpot = mk(G.spot(), kit.core, s * 0.12, 0.02, 0.01);
    tipSpot.scale.setScalar(0.035);
    tip.add(tipSpot);

    L.wings.push(p);
    L.wingTips.push(tip);
  }

  // short trailing tail with a soft light at its tip
  const tail = grp(rig, 0, -0.02, -0.24);
  const fin = mk(G.cone(), kit.soft, 0, 0, -0.14);
  fin.rotation.x = -Math.PI / 2;
  fin.scale.set(0.10, 0.3, 0.10);
  tail.add(fin);
  const tipGlow = mk(G.spot(), kit.core, 0, 0, -0.3);
  tipGlow.scale.setScalar(0.05);
  tail.add(tipGlow);
  L.tail = tail;
}

// ---------- 6. BURROWER ----------
// Silhouette: a soft mole shape sitting in its own ring of turned soil, with
// wide digging paws, whiskers, a glowing snout and a Glimmer on its back. It
// eases down out of sight and rises again on a slow, predictable cycle; the
// mound and its front berm hide the half that has sunk.  ~772 tris
function buildBurrower(rig: THREE.Group, kit: Kit, L: LuminRig): void {
  // the mound stays at ground level while the creature dips below it
  const mound = grp(rig, 0, 0, 0);
  const ring = mk(G.rim(), kit.plate, 0, 0.03, 0);
  ring.rotation.x = Math.PI / 2;
  ring.scale.set(0.52, 0.52, 0.14);
  mound.add(ring);
  const berm = mk(G.dome(), kit.plate, 0, -0.03, 0.27);
  berm.scale.set(0.46, 0.22, 0.24);
  mound.add(berm);
  L.mound = mound;

  const diver = grp(rig, 0, 0, 0);
  L.diver = diver;

  const wrap = grp(diver, 0, 0.34, 0);
  wrap.scale.setScalar(0.4);
  L.bodyWrap = wrap;

  const body = mk(G.bodyTall(), kit.skin);
  wrap.add(body);
  L.body = body;

  addEyes(body, kit, L, 0.34, 0.5, 0.72, 0.24);

  // glowing snout — the light it keeps, held out in front like a little lamp
  const snout = grp(body, 0, 0.24, 0.72);
  const muzzle = mk(G.cone(), kit.soft, 0, 0, 0.12);
  muzzle.rotation.x = Math.PI / 2;
  muzzle.scale.set(0.24, 0.34, 0.24);
  snout.add(muzzle);
  const nose = mk(G.blobXS(), kit.core, 0, 0, 0.32);
  nose.scale.setScalar(0.12);
  snout.add(nose);
  addHalo(snout, kit, L, 0, 0, 0.42, 0.55);
  L.snout = snout;

  // whiskers (thin, soft, slow-swaying — never twitchy)
  for (const s of [-1, 1]) {
    for (const k of [0, 1]) {
      const w = mk(G.tube(), kit.trimM, s * 0.3, 0.18 + k * 0.1, 0.6);
      w.rotation.z = s * (1.1 + k * 0.25);
      w.scale.set(0.012, 0.3, 0.012);
      body.add(w);
    }
  }

  // the Glimmer it carries, tucked on its back where the mound never hides it
  addGlimmer(body, kit, L, 0, 0.82, -0.28, 0.2);

  // wide digging paws on pivots
  for (const s of [-1, 1]) {
    const p = grp(diver, s * 0.21, 0.18, 0.2);
    const paw = mk(G.blobS(), kit.dark);
    paw.scale.set(0.16, 0.1, 0.2);
    p.add(paw);
    L.feet.push(p);
  }
}

// ---------- factory ----------

/** Build a Lumin. `color` paints its skin (the unique, recolourable material),
 *  `accent` its plates, rims and spars. The light it carries is always the
 *  same warm Glimmer hue, on every world. */
export function makeLumin(kind: LuminKind, color: number, accent: number): THREE.Group {
  const g = new THREE.Group();
  const rig = new THREE.Group();
  g.add(rig);

  const kit = kitFor(color, accent);
  const L = newRig(kind, rig);

  switch (kind) {
    case 'hopper': buildHopper(rig, kit, L); break;
    case 'drifter': buildDrifter(rig, kit, L); break;
    case 'roller': buildRoller(rig, kit, L); break;
    case 'glider': buildGlider(rig, kit, L); break;
    case 'burrower': buildBurrower(rig, kit, L); break;
    case 'waddler':
    default: buildWaddler(rig, kit, L); break;
  }

  // many of these are on screen at once: no shadow casting, ever.
  g.traverse(o => { o.castShadow = false; o.receiveShadow = false; });

  g.userData.kind = kind;
  g.userData.body = L.body;
  g.userData.mat = kit.skin;
  g.userData.lum = L;
  return g;
}

// ---------- planet assignment ----------

const ROSTER: Record<string, LuminKind[]> = {
  // rocky, cratered, dusty worlds → diggers and rollers
  mercury: ['roller', 'waddler', 'burrower'],
  mars: ['burrower', 'roller', 'waddler'],
  'the moon': ['burrower', 'waddler', 'roller'],
  phobos: ['hopper', 'roller', 'waddler'],
  // thick air and steady wind → things that ride it
  venus: ['glider', 'drifter', 'waddler'],
  titan: ['glider', 'waddler', 'drifter'],
  // green and gentle → the classic trio
  earth: ['waddler', 'hopper', 'glider'],
  // gas giant, endless updrafts → floaters
  jupiter: ['drifter', 'glider', 'hopper'],
  // ice and slippery flats → shells and floaters
  saturn: ['roller', 'drifter', 'waddler'],
  europa: ['roller', 'drifter', 'waddler'],
  titania: ['drifter', 'roller', 'hopper'],
  // cold, tilted, dreamy → drifting light-keepers
  uranus: ['drifter', 'hopper', 'glider'],
  neptune: ['drifter', 'glider', 'hopper'],
  triton: ['drifter', 'hopper', 'glider'],
};

const DEFAULT_ROSTER: LuminKind[] = ['waddler', 'hopper', 'roller'];

/** Which Lumins suit a given planet or moon, most-common first. Unknown names
 *  (new bonus levels) fall back to the friendly default trio. */
export function luminsForPlanet(planetName: string): LuminKind[] {
  const key = planetName.trim().toLowerCase();
  const hit = ROSTER[key];
  if (hit) return hit.slice();
  // tolerate "Mars — Canyon Run" style names
  for (const name of Object.keys(ROSTER)) {
    if (key.includes(name)) return ROSTER[name]!.slice();
  }
  return DEFAULT_ROSTER.slice();
}

/** Vertical offset above its ground/ledge that this kind should sit at.
 *  Grounded kinds are authored with their feet at local y ≈ -0.48 (matching the
 *  original alien); floaters hover at a height a small hop can reach. */
export function luminBaseOffset(kind: LuminKind): number {
  switch (kind) {
    // high enough that a walking blob passes underneath untouched — you have to
    // hop up to say hello, and a hop is always the player's own choice
    case 'drifter': return 1.6;
    case 'glider': return 1.6;
    case 'burrower': return 0.06; // origin sits ON the surface: its mound is there
    default: return 0.5;
  }
}

/** True if this kind hovers (so the game skips ground-snapping it). */
export function luminFloats(kind: LuminKind): boolean {
  return kind === 'drifter' || kind === 'glider';
}

// ---------- animation ----------

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/** Eased 0→1 ramp; every transition in here uses it, so nothing ever snaps. */
function ss(a: number, b: number, x: number): number {
  const u = clamp((x - a) / (b - a), 0, 1);
  return u * u * (3 - 2 * u);
}

/** A soft, occasional blink — closed for a fifth of a second, eased both ways. */
function blinkAmount(t: number, phase: number): number {
  const cycle = 4.6;
  const p = ((t + phase * 0.7) % cycle) / cycle;
  if (p > 0.06) return 1;
  return 1 - Math.sin((p / 0.06) * Math.PI) * 0.85;
}

/** Per-frame idle/locomotion animation. Pure visuals: it never touches the
 *  group's position (the game owns patrol movement) and never changes state.
 *  Everything happens on an inner rig, so world placement stays the game's. */
export function animateLumin(g: THREE.Group, t: number, dir: number, moving: boolean, calm: boolean, reduceMotion: boolean): void {
  const L = g.userData.lum as LuminRig | undefined;
  if (!L) return;

  // Calm Mode halves every amplitude; motion-reduction damps to ~35%.
  // (t arrives already calm-scaled, so frequency only gets a light extra ease.)
  const amp = reduceMotion ? 0.35 : calm ? 0.5 : 1;
  const fs = reduceMotion ? 0.6 : calm ? 0.8 : 1;
  const T = t * fs;
  const ph = L.phase;
  const face = dir >= 0 ? 1 : -1;
  const go = moving ? 1 : 0.35;

  // delta time, guarded against clock jumps when Calm Mode toggles
  const dt = clamp(T - L.lastT, 0, 0.1);
  L.lastT = T;

  // eased turn toward travel — a gentle lean, never a flip
  L.yaw += (face * 0.26 - L.yaw) * clamp(dt * 5, 0, 1);
  L.rig.rotation.y = L.yaw;

  const b = blinkAmount(T, ph);
  for (const e of L.eyes) e.scale.y = b;
  for (const p of L.pupils) {
    const r = (p.userData.r as number) || 0.2;
    p.position.x = face * r * 0.16;
  }
  for (const gl of L.glow) {
    const s = (gl.userData.s as number) || 1;
    gl.scale.setScalar(s * (1 + Math.sin(T * 1.1 + ph) * 0.13 * amp));
  }

  const wrap = L.bodyWrap;
  const base = L.kind === 'waddler' ? 0.5
    : L.kind === 'drifter' ? 0.46
      : L.kind === 'roller' ? 0.48
        : L.kind === 'burrower' ? 0.4
          : L.kind === 'hopper' ? 0.36 : 0.34;

  switch (L.kind) {
    // ---- rocks side to side, feet padding alternately ----
    case 'waddler': {
      const k = T * 6.2 + ph;              // ~1.0 Hz
      const s = Math.sin(k);
      L.rig.rotation.z = s * 0.10 * amp * go;
      L.rig.position.y = Math.abs(s) * 0.05 * amp * go + Math.sin(T * 1.5 + ph) * 0.012 * amp;
      wrap.rotation.z = -s * 0.05 * amp * go;
      wrap.scale.setScalar(base * (1 + Math.sin(T * 1.5 + ph) * 0.015 * amp));
      L.feet.forEach((f, i) => {
        const w = Math.sin(k + i * Math.PI);
        f.position.y = Math.max(0, w) * 0.07 * amp * go;
        f.position.z = 0.04 + w * 0.05 * amp * go;
      });
      break;
    }

    // ---- a slow springy hop cycle, ears and lantern tail lagging behind ----
    case 'hopper': {
      const k = T * 4.2 + ph;              // ~0.67 Hz
      const hop = Math.pow(Math.max(0, Math.sin(k)), 1.4);
      L.rig.position.y = hop * 0.26 * amp * (moving ? 1 : 0.5);
      L.rig.rotation.z = Math.sin(T * 1.2 + ph) * 0.03 * amp;
      const st = Math.cos(k) * 0.10 * amp * (moving ? 1 : 0.5);
      wrap.scale.set(base * (1 - st * 0.6), base * (1 + st), base * (1 - st * 0.6));
      L.legs.forEach((l, i) => {
        l.rotation.x = -hop * 0.55 * amp;
        l.rotation.z = Math.sin(k + i * 0.4) * 0.05 * amp;
      });
      L.ears.forEach((e, i) => {
        e.rotation.x = Math.sin(k - 0.7 + i * 0.3) * 0.22 * amp;
      });
      if (L.head) L.head.rotation.x = -hop * 0.10 * amp;
      if (L.tail) {
        L.tail.rotation.z = Math.sin(T * 2.0 + ph) * 0.13 * amp;
        L.tail.rotation.x = -hop * 0.22 * amp;
      }
      break;
    }

    // ---- hovers and pulses like a jellyfish; tendrils trail the drift ----
    case 'drifter': {
      const k = T * 3.4 + ph;              // ~0.54 Hz
      const pulse = Math.sin(k);
      L.rig.position.y = pulse * 0.14 * amp;
      L.rig.rotation.z = Math.sin(T * 1.5 + ph * 0.7) * 0.07 * amp;
      wrap.scale.set(
        base * (1 + pulse * 0.07 * amp),
        base * (1 - pulse * 0.09 * amp),
        base * (1 + pulse * 0.07 * amp),
      );
      L.tendrils.forEach((chain, c) => {
        chain.forEach((seg, i) => {
          const sway = Math.sin(k - i * 0.7 + c * 1.1) * (0.10 + i * 0.05) * amp;
          const trail = -face * 0.13 * amp * go;
          seg.rotation.z = sway + trail;
          seg.rotation.x = Math.sin(k * 0.7 - i * 0.5 + c * 0.6) * 0.06 * amp;
        });
      });
      break;
    }

    // ---- the shell turns as it goes; the head stays calmly upright ----
    case 'roller': {
      L.roll -= face * dt * (moving ? 2.2 : 0.3) * (calm ? 0.6 : 1) * (reduceMotion ? 0.5 : 1);
      L.body.rotation.z = L.roll;
      L.rig.position.y = Math.abs(Math.sin(T * 3.0 + ph)) * 0.03 * amp * go;
      L.rig.rotation.z = Math.sin(T * 1.4 + ph) * 0.04 * amp;
      wrap.scale.setScalar(base);
      if (L.head) {
        L.head.rotation.z = Math.sin(T * 1.8 + ph) * 0.07 * amp;
        L.head.position.y = -0.14 + Math.sin(T * 3.0 + ph) * 0.02 * amp;
      }
      L.feet.forEach((f, i) => {
        f.position.y = Math.max(0, Math.sin(T * 5.0 + ph + i * Math.PI)) * 0.04 * amp * go;
      });
      break;
    }

    // ---- long slow wingbeats, body sinking as the wings rise, gentle bank ----
    case 'glider': {
      const k = T * 3.4 + ph;              // ~0.54 Hz
      const flap = Math.sin(k);
      const lag = Math.sin(k - 0.7);
      L.wings.forEach((w, i) => {
        const s = i === 0 ? -1 : 1;
        w.rotation.z = s * (0.12 + flap * 0.26) * amp;
      });
      L.wingTips.forEach((w, i) => {
        const s = i === 0 ? -1 : 1;
        w.rotation.z = s * lag * 0.2 * amp;
      });
      L.rig.position.y = -flap * 0.10 * amp;
      L.rig.rotation.z = Math.sin(T * 1.3 + ph) * 0.09 * amp + face * 0.05 * amp * go;
      L.rig.rotation.x = lag * 0.05 * amp;
      wrap.scale.setScalar(base);
      if (L.tail) L.tail.rotation.x = lag * 0.14 * amp;
      break;
    }

    // ---- eases down out of sight and rises again on a slow, kindly cycle ----
    case 'burrower': {
      const p = ((T * 0.105 + ph * 0.16) % 1 + 1) % 1;   // ~9.5 s cycle
      const down = ss(0.42, 0.58, p) - ss(0.70, 0.88, p); // 0 → 1 → 0, fully eased
      const depth = 0.58 * (0.6 + 0.4 * amp);
      const up = 1 - down;
      if (L.diver) {
        L.diver.position.y = -down * depth + Math.sin(T * 2.0 + ph) * 0.03 * amp * up;
        L.diver.rotation.z = Math.sin(T * 1.2 + ph) * 0.04 * amp * up;
      }
      if (L.mound) {
        L.mound.scale.set(1 + down * 0.08, 1 + down * 0.14, 1 + down * 0.08);
      }
      if (L.snout) {
        L.snout.rotation.x = Math.sin(T * 2.4 + ph) * 0.10 * amp * up;
        L.snout.rotation.y = Math.sin(T * 1.1 + ph) * 0.12 * amp * up;
      }
      L.feet.forEach((f, i) => {
        f.position.y = 0.18 + Math.max(0, Math.sin(T * 4.6 + ph + i * Math.PI)) * 0.05 * amp * go * up;
      });
      for (const e of L.eyes) e.scale.y = b * (0.35 + 0.65 * up);
      wrap.scale.setScalar(base * (1 + Math.sin(T * 2.0 + ph) * 0.02 * amp * up));
      break;
    }
  }
}
