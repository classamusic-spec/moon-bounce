import * as THREE from 'three';
import { CHAR_R } from '../core/constants';
import type { HatKind } from '../data/cosmetics';
import { assets } from '../systems/assets';
import {
  contactShadow, crystalMat, disposeObject, glowMat, metalMat, noiseTex,
  organicMat, rockMat, sharedGeo, signalMat,
} from '../systems/materials';
import type { Palette } from '../systems/materials';

// ---------------------------------------------------------------------------
// Procedural model factories.
//
// WORLD FICTION: the Sun fell asleep and its light scattered. Light is the
// precious substance of this solar system — it hides inside crystal, inside
// blooms, inside friendly creatures. Every object below is built from the same
// four-layer recipe so the whole game reads as one art direction:
//
//   1. BASE FORM      a readable silhouette (never a bare primitive)
//   2. DETAIL PASS    a second layer of construction: shells, plates, lobes
//   3. TRIM / ACCENT  thin rings, seams, rims, studs — implies scale & function
//   4. LIGHT SIGNAL   a small authored emissive: the light hiding inside
//
// PERFORMANCE: this ships to low-end phones. Geometry is cached and shared via
// sharedGeo() at UNIT size and scaled per mesh; materials come from the shared
// role library in systems/materials.ts. Segment counts stay low (5-18) —
// faceted is the house style, so cheap geometry is also the good-looking one.
//
// MATERIAL RULE: anything whose material colour/opacity is MUTATED at runtime
// gets its OWN material instance (marked "unique — mutated at runtime" below).
// Everything else shares a cached role so shader programs stay few.
// ---------------------------------------------------------------------------

const TAU = Math.PI * 2;

// ---------- shared unit geometry (scale the mesh, never re-tessellate) ----------

function gSphere(w: number, h: number): THREE.SphereGeometry {
  return sharedGeo(`sph|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h));
}
/** Upper half of a sphere — mounds, domes, caps, cushions. */
function gDome(w: number, h: number): THREE.SphereGeometry {
  return sharedGeo(`dome|${w}|${h}`, () => new THREE.SphereGeometry(1, w, h, 0, TAU, 0, Math.PI * 0.5));
}
function gIco(detail: number): THREE.IcosahedronGeometry {
  return sharedGeo(`ico|${detail}`, () => new THREE.IcosahedronGeometry(1, detail));
}
function gOcta(): THREE.OctahedronGeometry {
  return sharedGeo('octa', () => new THREE.OctahedronGeometry(1, 0));
}
function gCyl(seg: number, topR = 1): THREE.CylinderGeometry {
  return sharedGeo(`cyl|${seg}|${topR}`, () => new THREE.CylinderGeometry(topR, 1, 1, seg));
}
function gCone(seg: number): THREE.ConeGeometry {
  return sharedGeo(`cone|${seg}`, () => new THREE.ConeGeometry(1, 1, seg));
}
function gBox(): THREE.BoxGeometry {
  return sharedGeo('box', () => new THREE.BoxGeometry(1, 1, 1));
}
function gPlane(): THREE.PlaneGeometry {
  return sharedGeo('plane', () => new THREE.PlaneGeometry(1, 1));
}
/** Unit-radius torus; `tube` is a fraction of the radius so uniform scaling works. */
function gRing(tube: number, radial: number, tubular: number, arc = TAU): THREE.TorusGeometry {
  return sharedGeo(`tor|${tube}|${radial}|${tubular}|${arc.toFixed(3)}`,
    () => new THREE.TorusGeometry(1, tube, radial, tubular, arc));
}
/** A lathed profile (x = radius, y = height) — pods, petals, shards, nozzles. */
function gLathe(key: string, pts: [number, number][], seg: number): THREE.LatheGeometry {
  return sharedGeo(`lathe|${key}`, () => new THREE.LatheGeometry(pts.map(p => new THREE.Vector2(p[0], p[1])), seg));
}

/** A merged fan of tapered light blades, built in TWO perpendicular planes so a
 *  spinning corona never turns fully edge-on. One geometry, one draw call. */
function gCorona(key: string, n: number, rIn: number, rOut: number, w: number): THREE.BufferGeometry {
  return sharedGeo(`corona|${key}`, () => {
    const p: number[] = [];
    const v = (a: THREE.Vector3) => { p.push(a.x, a.y, a.z); };
    const tri = (a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3) => {
      v(a); v(b); v(c);          // both windings — soft double-sided without
      v(a); v(c); v(b);          // touching the shared material's `side`
    };
    for (let plane = 0; plane < 2; plane++) {
      for (let i = 0; i < n; i++) {
        const ang = (i / n) * TAU + (plane ? Math.PI / n : 0);
        const ca = Math.cos(ang), sa = Math.sin(ang);
        const P = (r: number, o: number): THREE.Vector3 => plane === 0
          ? new THREE.Vector3(ca * r - sa * o, sa * r + ca * o, 0)
          : new THREE.Vector3(0, sa * r + ca * o, ca * r - sa * o);
        const mid = (rIn + rOut) * 0.5;
        tri(P(rIn, 0), P(mid, w), P(rOut, 0));
        tri(P(rIn, 0), P(rOut, 0), P(mid, -w));
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
    return g;
  });
}

// ---------- tiny build helpers ----------

function mk(geo: THREE.BufferGeometry, mat: THREE.Material, sx = 1, sy = sx, sz = sx): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.scale.set(sx, sy, sz);
  return m;
}
function pos<T extends THREE.Object3D>(o: T, x: number, y: number, z = 0): T {
  o.position.set(x, y, z);
  return o;
}
/** A speck of loose light. Cheap, shared, additive — used everywhere as accent. */
function mote(color: number, r: number, opacity = 0.6): THREE.Mesh {
  return mk(gIco(0), glowMat(color, opacity), r);
}
function shade(color: number, k: number): number {
  return new THREE.Color(color).multiplyScalar(k).getHex();
}
function lighten(color: number, k: number): number {
  return new THREE.Color(color).lerp(new THREE.Color(0xffffff), k).getHex();
}

/** Free the GPU resources of an object tree (geometries + materials).
 *  Re-exported from the shared material library, which knows to skip
 *  cached/shared resources. */
export { disposeObject };

// ===========================================================================
// HERO — the astronaut blob
// ===========================================================================

/** The player: a soft blob in a little pressure suit.
 *  Layers: suit shell → collar/seam trim → life-support pack with a warm vent
 *  → crystal visor with rim + highlight → boots → face → antenna beacon.
 *  Everything that hugs the body is parented to the body mesh, so it squashes
 *  and stretches with it (main_game drives body.scale every frame). */
export function makeCharacter(): THREE.Group {
  const char = new THREE.Group();

  // 1 — SUIT SHELL. UNIQUE material: applyBlobCosmetics() recolours it.
  const bodyMat = new THREE.MeshStandardMaterial({
    color: 0xa8e0ff, roughness: 0.42, metalness: 0.04,
    bumpMap: noiseTex(), bumpScale: 0.006,          // soft woven-fabric break-up
    emissive: 0x223344, emissiveIntensity: 0.25,
  });
  const body = new THREE.Mesh(new THREE.SphereGeometry(CHAR_R, 18, 14), bodyMat);
  body.scale.set(1, 0.92, 1);
  body.castShadow = true;                            // the one hero shadow caster
  body.name = 'suitShell';
  char.add(body);
  char.userData.body = body;
  char.userData.bodyMat = bodyMat;

  // shared trim roles — neutral so they read against every cosmetic colour
  const shell = organicMat(0xeef3fb);                // soft white suit panels
  const trim = metalMat(0xb6c7dc, 0.34);             // steel rings and seams
  const bootMat = organicMat(0xc0ccdd);
  const ventMat = signalMat(0xffb86b, 0.9);          // warm life-support glow

  // 2 — COLLAR + BELLY SEAM (on the body so they squash with it)
  const collar = pos(mk(gRing(0.085, 5, 18), trim, 0.60), 0, 0.30, 0);
  collar.rotation.x = Math.PI / 2;
  body.add(collar);
  const seam = pos(mk(gRing(0.055, 4, 16), trim, 0.70), 0, -0.12, 0);
  seam.rotation.set(Math.PI / 2 + 0.12, 0, 0);
  body.add(seam);

  // 3 — LIFE SUPPORT PACK: rounded pack, twin tanks, capped, warm vent slot
  const pack = pos(mk(gSphere(12, 9), shell, 0.40, 0.34, 0.24), 0, 0.02, -0.58);
  pack.name = 'lifeSupport';
  body.add(pack);
  [-0.21, 0.21].forEach(x => {
    body.add(pos(mk(gCyl(8), shell, 0.075, 0.42, 0.075), x, 0.0, -0.72));
    const cap = pos(mk(gRing(0.22, 4, 8), trim, 0.085), x, 0.21, -0.72);
    cap.rotation.x = Math.PI / 2;
    body.add(cap);
  });
  body.add(pos(mk(gBox(), ventMat, 0.26, 0.05, 0.03), 0, -0.18, -0.78));

  // 4 — BOOTS (rounded, part of the squash)
  [-0.27, 0.27].forEach(x => body.add(pos(mk(gSphere(10, 7), bootMat, 0.25, 0.15, 0.30), x, -0.60, 0.10)));

  // 5 — VISOR: faceted crystal faceplate, steel rim, soft glass highlight
  const visor = new THREE.Group();
  visor.position.set(0, 0.10, 0.30);
  visor.rotation.x = Math.PI * 0.44;
  const glass = mk(gDome(16, 8), crystalMat(0x35547f, 0x11244a, 1), 0.47);
  glass.name = 'visorGlass';
  visor.add(glass);
  const rim = mk(gRing(0.075, 5, 20), trim, 0.475);
  rim.rotation.x = Math.PI / 2;
  visor.add(rim);
  // highlight sits just PROUD of the 0.47 dome (|p| ≈ 0.49) so it reads as glass
  visor.add(pos(mk(gSphere(8, 6), glowMat(0xffffff, 0.30), 0.13, 0.07, 0.03), -0.195, 0.415, 0.171));
  char.add(visor);

  // 6 — FACE: eyes (whites + pupils, blinked by scaling Y), smile, blush
  const eyeMat = signalMat(0xffffff, 0.4);
  const darkMat = organicMat(0x223044);
  const eyes: THREE.Mesh[] = [];
  [-0.15, 0.15].forEach(x => {
    const e = pos(new THREE.Mesh(sharedGeo('eyeWhite', () => new THREE.SphereGeometry(0.1, 10, 7)), eyeMat), x, 0.15, 0.78);
    char.add(e); eyes.push(e);
    const p = pos(new THREE.Mesh(sharedGeo('eyePupil', () => new THREE.SphereGeometry(0.05, 8, 6)), darkMat), x, 0.13, 0.85);
    char.add(p); eyes.push(p);
  });
  char.userData.eyes = eyes;
  const smile = pos(mk(gRing(0.22, 5, 12, Math.PI), darkMat, 0.13), 0, -0.02, 0.78);
  smile.rotation.z = Math.PI;
  char.add(smile);
  // blush sits on the shell surface (|p| ≈ 0.71 vs the 0.7 body radius)
  [-0.37, 0.37].forEach(x => char.add(pos(mk(gSphere(8, 6), glowMat(0xff9ec4, 0.22), 0.09, 0.06, 0.04), x, 0.02, 0.60)));

  // 7 — ANTENNA BEACON (hidden when a hat is worn)
  const antenna = new THREE.Group();
  antenna.add(pos(mk(gCyl(6), trim, 0.02, 0.3, 0.02), 0, 0.8, 0));
  const base = pos(mk(gRing(0.3, 4, 8), trim, 0.06), 0, 0.64, 0);
  base.rotation.x = Math.PI / 2;
  antenna.add(base);
  // UNIQUE material: main_game pulses bulb emissiveIntensity every frame.
  const bulbMat = new THREE.MeshStandardMaterial({ color: 0xff7a7a, emissive: 0xff4444, emissiveIntensity: 0.8, roughness: 0.3 });
  const bulb = pos(new THREE.Mesh(gIco(1), bulbMat), 0, 0.97, 0);
  bulb.scale.setScalar(0.09);
  antenna.add(bulb);
  antenna.add(pos(mote(0xff8a8a, 0.17, 0.22), 0, 0.97, 0));
  char.add(antenna);
  char.userData.antenna = antenna;
  char.userData.bulb = bulb;

  // 8 — hat socket (filled by applyBlobCosmetics)
  const hatHolder = new THREE.Group();
  hatHolder.position.set(0, 0.5, 0.05);
  char.add(hatHolder);
  char.userData.hatHolder = hatHolder;

  return char;
}

/** Build a hat sized to sit on the head (base at local y=0, facing +z). */
export function makeHat(kind: HatKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'party') {
    const cone = pos(mk(gCone(14), organicMat(0xff6fae), 0.30, 0.58, 0.30), 0, 0.29, 0);
    g.add(cone);
    [0.16, 0.34].forEach((y, i) => {                       // candy stripe trim
      const band = pos(mk(gRing(0.14, 4, 12), organicMat(0xfff0a0), 0.30 - i * 0.10), 0, y, 0);
      band.rotation.x = Math.PI / 2;
      g.add(band);
    });
    g.add(pos(mk(gIco(1), signalMat(0xfff0a0, 0.5), 0.09), 0, 0.60, 0));
  } else if (kind === 'bow') {
    const silk = organicMat(0xff7aa8, 0x551133, 0.15);
    g.add(pos(mk(gIco(1), silk, 0.1), 0, 0.12, 0));
    [-1, 1].forEach(s => {
      const w = pos(mk(gCone(8), silk, 0.16, 0.26, 0.12), s * 0.2, 0.12, 0);
      w.rotation.z = s * Math.PI / 2;
      g.add(w);
      const tail = pos(mk(gBox(), silk, 0.07, 0.20, 0.03), s * 0.12, -0.05, 0.02);
      tail.rotation.z = s * 0.4;
      g.add(tail);
    });
  } else if (kind === 'cap') {
    const cloth = organicMat(0x5a8fff);
    g.add(pos(mk(gDome(18, 8), cloth, 0.36), 0, 0.06, 0));
    g.add(pos(mk(gBox(), cloth, 0.5, 0.06, 0.34), 0, 0.06, 0.34));
    const band = pos(mk(gRing(0.06, 4, 16), organicMat(0x2f5fc0), 0.365), 0, 0.09, 0);
    band.rotation.x = Math.PI / 2;
    g.add(band);
    g.add(pos(mk(gIco(0), organicMat(0x2f5fc0), 0.05), 0, 0.42, 0));
  } else if (kind === 'crown') {
    const gold = metalMat(0xffd34d, 0.28);
    g.add(pos(mk(gCyl(16), gold, 0.32, 0.22, 0.32), 0, 0.16, 0));
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * TAU;
      g.add(pos(mk(gCone(6), gold, 0.075, 0.2, 0.075), Math.cos(a) * 0.32, 0.34, Math.sin(a) * 0.32));
      if (i % 2 === 0) g.add(pos(mk(gIco(0), signalMat(0xa8f0ff, 0.7), 0.05), Math.cos(a) * 0.32, 0.20, Math.sin(a) * 0.34));
    }
  } else if (kind === 'tophat') {
    const felt = organicMat(0x2a2a3a);
    g.add(pos(mk(gCyl(20), felt, 0.44, 0.06, 0.44), 0, 0.03, 0));
    g.add(pos(mk(gCyl(20), felt, 0.27, 0.5, 0.27), 0, 0.3, 0));
    g.add(pos(mk(gCyl(20), organicMat(0xff6fae), 0.278, 0.1, 0.278), 0, 0.12, 0));
    g.add(pos(mk(gBox(), signalMat(0xffe7a8, 0.5), 0.09, 0.07, 0.02), 0, 0.12, 0.28));
  }
  return g;
}

/** Apply the equipped colour + hat to a character built by makeCharacter(). */
export function applyBlobCosmetics(char: THREE.Group, hex: number, hatKind: HatKind): void {
  const bodyMat = char.userData.bodyMat as THREE.MeshStandardMaterial | undefined;
  if (bodyMat) bodyMat.color.setHex(hex);
  const holder = char.userData.hatHolder as THREE.Group | undefined;
  const antenna = char.userData.antenna as THREE.Group | undefined;
  if (holder) {
    while (holder.children.length) { const c = holder.children[0]!; holder.remove(c); disposeObject(c); }
    if (hatKind !== 'none') holder.add(makeHat(hatKind));
  }
  if (antenna) antenna.visible = (hatKind === 'none');
}

// ===========================================================================
// REWARD — the Glimmer / Sunshard (was: a generic extruded 5-point star)
// ===========================================================================

/** A shard of the scattered sunlight.
 *
 *  sun=false → GLIMMER: a faceted crystal teardrop with a bright core burning
 *  inside it and one thin ring of light orbiting the waist.
 *  sun=true  → SUNSHARD: bigger, warmer, jagged, wrapped in a corona of light
 *  petals — the Piece of the Sun the whole level is aiming at.
 *
 *  Returns the shard Mesh (ring/core/corona are its children) and keeps a
 *  UNIQUE MeshStandardMaterial so level.ts can recolour the secret cluster. */
export function makeStarMesh(scale: number, sun: boolean): THREE.Mesh {
  const k = scale;
  const key = k.toFixed(2);

  if (!sun) {
    // faceted teardrop: wide crystal waist, drawn to a point top and bottom
    const geo = gLathe(`glimmer|${key}`, [
      [0, -0.62 * k], [0.15 * k, -0.34 * k], [0.26 * k, -0.06 * k],
      [0.30 * k, 0.10 * k], [0.19 * k, 0.36 * k], [0, 0.62 * k],
    ], 7);
    const mat = new THREE.MeshStandardMaterial({
      color: 0xffe082, emissive: 0xffc94d, emissiveIntensity: 0.7,
      roughness: 0.22, metalness: 0.14, flatShading: true,
      transparent: true, opacity: 0.78,                 // the core burns through
    });
    const shard = new THREE.Mesh(geo, mat);
    shard.name = 'glimmerShard';
    shard.add(mk(gIco(0), signalMat(0xfff6de, 1.3), 0.14 * k));
    const ring = mk(gRing(0.05, 3, 14), signalMat(0xffeab0, 0.8), 0.44 * k);
    ring.rotation.set(1.15, 0, 0.35);
    shard.add(ring);
    return shard;
  }

  // SUNSHARD — jagged profile, warm, with a turning corona of light petals
  const geo = gLathe(`sunshard|${key}`, [
    [0, -0.78 * k], [0.14 * k, -0.50 * k], [0.30 * k, -0.28 * k], [0.21 * k, -0.10 * k],
    [0.34 * k, 0.08 * k], [0.23 * k, 0.32 * k], [0.13 * k, 0.52 * k], [0, 0.80 * k],
  ], 9);
  const mat = new THREE.MeshStandardMaterial({
    color: 0xfff0a0, emissive: 0xffb300, emissiveIntensity: 1.1,
    roughness: 0.2, metalness: 0.1, flatShading: true,
    transparent: true, opacity: 0.92,
  });
  const shard = new THREE.Mesh(geo, mat);
  shard.name = 'sunshard';
  shard.castShadow = true;
  shard.add(mk(gIco(1), signalMat(0xfff8e0, 1.6), 0.22 * k));
  shard.add(new THREE.Mesh(gCorona(key, 6, 0.55 * k, 1.15 * k, 0.16 * k), glowMat(0xffcf80, 0.26)));
  const ring = mk(gRing(0.035, 3, 16), signalMat(0xffe6a8, 0.9), 0.62 * k);
  ring.rotation.set(1.25, 0, 0.3);
  shard.add(ring);
  const ring2 = mk(gRing(0.03, 3, 14), signalMat(0xfff2cc, 0.7), 0.46 * k);
  ring2.rotation.set(-0.9, 0.4, -0.2);
  shard.add(ring2);
  return shard;
}

// ===========================================================================
// INTERACTABLE — the Wonder Bloom (was: a floating "?" cube)
// ===========================================================================

/** A WONDER BLOOM: a closed crystal seed-pod holding one fact-sized piece of
 *  light. Layers: ribbed tapered stalk → calyx cup → five faceted crystal petal
 *  shells closed around → a warm glowing heart → motes drifting around it.
 *
 *  userData: cube = the bud group (spun by main_game), mat = the heart material
 *  (UNIQUE — dimmed and drained to a husk colour when spent), petals = the five
 *  animatable pivots, core = the heart mesh. See openBloom(). */
export function makeFactBox(): THREE.Group {
  const g = new THREE.Group();

  const stalkMat = organicMat(0x93a9a2);
  const ribMat = metalMat(0xb9c8d6, 0.4);

  // 1 — STALK: lathed taper + a rib ring + the calyx cup the bud sits in
  g.add(pos(new THREE.Mesh(gLathe('bloomStalk', [
    [0, -0.58], [0.085, -0.50], [0.13, -0.30], [0.105, -0.16], [0.17, -0.08],
  ], 7), stalkMat), 0, 0, 0));
  const rib = pos(mk(gRing(0.22, 4, 9), ribMat, 0.125), 0, -0.40, 0);
  rib.rotation.x = Math.PI / 2;
  g.add(rib);
  g.add(pos(mk(gDome(9, 4), stalkMat, 0.27, 0.17, 0.27), 0, -0.11, 0));

  // 2 — BUD: the group main_game spins. Petals + heart + orbiting motes.
  const bud = new THREE.Group();
  bud.position.y = 0.10;
  g.add(bud);
  g.userData.cube = bud;

  // heart — UNIQUE material (popBox drains it; openBloom dims it further)
  const mat = new THREE.MeshStandardMaterial({
    color: 0xffd98a, emissive: 0xffb43a, emissiveIntensity: 1.25,
    roughness: 0.3, metalness: 0.05,
  });
  const core = new THREE.Mesh(sharedGeo('bloomCore', () => new THREE.IcosahedronGeometry(0.2, 1)), mat);
  core.name = 'bloomCore';
  bud.add(core);
  g.userData.mat = mat;
  g.userData.core = core;

  // petals — nested pivots: yaw distributes, lean opens (see openBloom)
  const petalGeo = gLathe('bloomPetal', [
    [0, 0], [0.10, 0.10], [0.15, 0.26], [0.11, 0.42], [0, 0.50],
  ], 5);
  const petalMat = crystalMat(0xbfe3ff, 0x2a5a80, 0.82);
  const petals: THREE.Object3D[] = [];
  for (let i = 0; i < 5; i++) {
    const yaw = new THREE.Group();
    yaw.rotation.y = (i / 5) * TAU;
    const pivot = new THREE.Group();
    pivot.position.set(0, -0.08, 0.11);
    pivot.rotation.x = -0.30;                       // closed: tips leaning inward
    pivot.userData.lean = -0.30;
    const petal = mk(petalGeo, petalMat, 0.78, 1, 1.06);
    petal.castShadow = true;
    pivot.add(petal);
    yaw.add(pivot);
    bud.add(yaw);
    petals.push(pivot);
  }
  g.userData.petals = petals;

  // 3 — LOOSE LIGHT: two motes circling with the bud, one drifting up above it
  for (let i = 0; i < 2; i++) {
    const a = i * Math.PI;
    bud.add(pos(mote(0xfff0c0, 0.05), Math.cos(a) * 0.42, 0.02 + i * 0.16, Math.sin(a) * 0.42));
  }
  g.add(pos(mote(0xbfe3ff, 0.045, 0.5), 0.07, 0.62, 0.05));

  // 4 — soft halo (reads as "bump me") + a contact disc to seat it in the air
  g.add(pos(mk(gSphere(10, 7), glowMat(0xbfe3ff, 0.13), 0.46), 0, 0.10, 0));
  g.add(pos(contactShadow(0.34), 0, -0.62, 0));

  return g;
}

/** Unfurl a spent bloom: t 0..1 swings the petals outward and down while the
 *  heart lifts and fades, so a used bloom reads as an opened flower that has
 *  given its light away — never as a dead box. Safe to call every frame. */
export function openBloom(g: THREE.Group, t: number): void {
  const k = Math.max(0, Math.min(1, t));
  const e = 1 - Math.pow(1 - k, 3);                  // easeOutCubic — gentle
  const petals = g.userData.petals as THREE.Object3D[] | undefined;
  if (petals) {
    petals.forEach((p, i) => {
      const lean = (p.userData.lean as number | undefined) ?? -0.3;
      p.rotation.x = lean + e * (1.45 + (i % 2) * 0.12);
      p.position.y = -0.08 - e * 0.05;
      p.position.z = 0.11 + e * 0.07;
    });
  }
  const core = g.userData.core as THREE.Mesh | undefined;
  const mat = g.userData.mat as THREE.MeshStandardMaterial | undefined;
  if (core) {
    core.position.y = e * 0.34;
    core.scale.setScalar(1 - e * 0.4);
  }
  if (mat) {
    // capture whatever brightness the bloom had when opening started, so this
    // never brightens a bloom that popBox already drained
    if (g.userData.emBase === undefined) g.userData.emBase = mat.emissiveIntensity;
    mat.emissiveIntensity = (g.userData.emBase as number) * (1 - e * 0.85);
  }
}

// ===========================================================================
// CREATURE — friendly alien
// ===========================================================================

/** A round, googly-eyed alien with light caught under its shell.
 *  Layers: soft body → slate carapace with crystal studs → cream belly →
 *  big eyes with highlights → stubby feet → two antennae with light buds. */
export function makeEnemy(color: number): THREE.Group {
  const g = new THREE.Group();

  // UNIQUE material — an ice puff recolours this creature.
  const mat = new THREE.MeshStandardMaterial({
    color, roughness: 0.5, metalness: 0.02,
    bumpMap: noiseTex(), bumpScale: 0.006,
    emissive: 0x111318, emissiveIntensity: 0.35,
  });
  const body = new THREE.Mesh(sharedGeo('alienBody', () => new THREE.SphereGeometry(0.5, 16, 12)), mat);
  body.scale.set(1, 0.8, 1);                          // main_game overwrites on squish
  body.castShadow = true;
  body.name = 'alienBody';
  g.add(body);
  g.userData.body = body;
  g.userData.mat = mat;

  const slate = organicMat(0x3d4a5e);
  // carapace + three little crystal studs: the light hiding inside a creature
  g.add(pos(mk(gDome(12, 4), slate, 0.52, 0.34, 0.52), 0, 0.10, -0.02));
  // studs ride ON the carapace surface (r ≈ 0.42 at that height, not inside it)
  [-0.75, 0, 0.75].forEach(a => {
    g.add(pos(mk(gIco(0), signalMat(0xbfe8ff, 0.55), 0.06), Math.sin(a) * 0.42, 0.29, Math.cos(a) * 0.42 - 0.02));
  });
  // cream belly plate
  g.add(pos(mk(gSphere(10, 7), organicMat(0xfff1dd), 0.30, 0.22, 0.12), 0, -0.12, 0.36));

  // eyes: white + pupil + a small highlight so they read as friendly, not blank
  const eyeMat = signalMat(0xffffff, 0.4);
  const darkMat = organicMat(0x222233);
  [-0.16, 0.16].forEach(x => {
    g.add(pos(mk(gSphere(12, 8), eyeMat, 0.15), x, 0.12, 0.40));
    g.add(pos(mk(gSphere(8, 6), darkMat, 0.07), x, 0.10, 0.52));
    g.add(pos(mk(gIco(0), glowMat(0xffffff, 0.55), 0.028), x - 0.04, 0.17, 0.53));
  });

  // feet + antennae with light buds
  [-0.22, 0.22].forEach(x => g.add(pos(mk(gSphere(10, 7), slate, 0.15, 0.09, 0.19), x, -0.42, 0.02)));
  [-0.12, 0.12].forEach(x => {
    const stalk = pos(mk(gCyl(5), slate, 0.016, 0.24, 0.016), x, 0.5, 0);
    stalk.rotation.z = -Math.sign(x) * 0.35;
    g.add(stalk);
    g.add(pos(mk(gIco(0), signalMat(0xffd9a8, 0.7), 0.06), x * 1.7, 0.62, 0));
  });

  return g;
}

// ===========================================================================
// WORLD PROP KIT
// ===========================================================================

/** A standable cloud: bright crown puffs, a darker shelf underneath so it has
 *  a bottom, and a couple of light motes resting inside it. */
export function makeCloud(tint?: number): THREE.Group {
  const g = new THREE.Group();
  const model = assets.getModel('cloud');
  if (model) { g.add(model); return g; }

  const base = tint || 0xffffff;
  const top = organicMat(base, 0x223344, 0.06);
  const under = organicMat(shade(base, 0.72));
  ([[-0.9, 0.0, 0.80], [0.0, 0.16, 1.00], [0.9, 0.0, 0.85], [0.42, -0.08, 0.70], [-0.42, -0.04, 0.75]] as [number, number, number][])
    .forEach(p => g.add(pos(mk(gSphere(12, 9), top, p[2], p[2] * 0.66, p[2]), p[0], p[1], 0)));
  ([[-0.5, -0.30, 0.62], [0.55, -0.30, 0.58]] as [number, number, number][])
    .forEach(p => g.add(pos(mk(gSphere(10, 7), under, p[2], p[2] * 0.42, p[2] * 0.8), p[0], p[1], 0)));
  g.add(pos(mote(0xfff3d0, 0.07, 0.45), -0.2, 0.34, 0.35));
  return g;
}

/** A far-background bird. NOTE: dynamics.ts sets rotation.z on EVERY top-level
 *  child (+ on child 0, − on the rest), so the body pivot's contents are
 *  pre-rotated to cancel that constant and keep only the gentle flap bob. */
export function makeBird(): THREE.Group {
  const g = new THREE.Group();
  const model = assets.getModel('bird');
  if (model) { g.add(model); return g; }

  const dark = organicMat(0x445566);
  const edge = organicMat(0x8fa3b8);
  [-0.18, 0.18].forEach(x => {
    const wing = new THREE.Group();
    wing.position.x = x;
    wing.add(pos(mk(gCone(4), dark, 0.17, 0.5, 0.05), 0, 0.25, 0));
    wing.add(pos(mk(gCone(4), edge, 0.05, 0.44, 0.055), Math.sign(x) * 0.07, 0.28, 0.01));
    g.add(wing);
  });
  const bodyPivot = new THREE.Group();
  const bodyIn = new THREE.Group();
  bodyIn.rotation.z = Math.PI / 2.4;                  // cancels the runtime constant
  bodyPivot.add(bodyIn);
  bodyIn.add(mk(gSphere(10, 7), dark, 0.22, 0.15, 0.15));
  bodyIn.add(pos(mk(gSphere(8, 6), dark, 0.11), 0.22, 0.05, 0));
  bodyIn.add(pos(mk(gCone(4), signalMat(0xffc06a, 0.4), 0.05, 0.12, 0.05), 0.32, 0.04, 0));
  g.add(bodyPivot);
  return g;
}

/** A rolling boulder with chipped facets and a seam of trapped light. */
export function makeRock(): THREE.Group {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  g.userData.rock = spin;

  const stone = rockMat(0x9c4a2e, { flat: true });
  const chip = rockMat(0x7a3721, { flat: true, rough: 1 });
  const core = mk(gIco(0), stone, 0.45);
  core.castShadow = true;
  core.name = 'rockCore';
  spin.add(core);
  ([[0.32, 0.22, 0.1, 0.19], [-0.3, -0.15, 0.18, 0.15], [0.05, -0.3, -0.2, 0.13]] as [number, number, number, number][])
    .forEach(c => spin.add(pos(mk(gIco(0), chip, c[3]), c[0], c[1], c[2])));
  // trapped sunlight in the mineral seam
  spin.add(pos(mk(gIco(0), crystalMat(0xffd9a0, 0x8a4a10, 0.92), 0.12), -0.18, 0.3, 0.26));
  spin.add(pos(mk(gIco(0), crystalMat(0xffd9a0, 0x8a4a10, 0.92), 0.08), 0.3, -0.06, 0.3));
  g.add(pos(contactShadow(0.42), 0, -0.42, 0));
  return g;
}

/** A bounce geyser: stone collar, glowing throat, and a soft vapour column
 *  (the jet's material is UNIQUE — dynamics.ts pulses its opacity). */
export function makeGeyser(): THREE.Group {
  const g = new THREE.Group();
  g.add(mk(gCyl(12, 0.82), rockMat(0xa87f4e), 0.85, 0.5, 0.85));
  const collar = pos(mk(gRing(0.13, 5, 14), metalMat(0xd8c39a, 0.5), 0.72), 0, 0.22, 0);
  collar.rotation.x = Math.PI / 2;
  g.add(collar);
  g.add(pos(mk(gCyl(10), signalMat(0xffd9a0, 0.65), 0.5, 0.06, 0.5), 0, 0.26, 0));

  const jetMat = new THREE.MeshStandardMaterial({
    color: 0xffe6bf, transparent: true, opacity: 0.45,
    emissive: 0xffcf66, emissiveIntensity: 0.4, roughness: 0.4,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const jet = pos(new THREE.Mesh(
    sharedGeo('geyserJet', () => new THREE.CylinderGeometry(0.3, 0.5, 1.4, 12, 1, true)), jetMat), 0, 0.9, 0);
  jet.name = 'geyserJet';
  [-0.35, 0.15, 0.55].forEach((y, i) => jet.add(pos(mote(0xfff0cc, 0.09 - i * 0.015, 0.5), (i - 1) * 0.1, y, 0)));
  g.add(jet);
  g.userData.jet = jet;
  g.add(pos(contactShadow(0.95), 0, -0.24, 0));
  return g;
}

/** A drifting slab of ring-ice: faceted body, frosted standable top plate,
 *  rim shards, and a cool glow underneath. */
export function makeIceChunk(): THREE.Group {
  const g = new THREE.Group();
  const ice = crystalMat(0xd8eeff, 0x5a86ad, 0.9);
  const slab = mk(gIco(0), ice, 1.43, 0.55, 1.1);
  slab.castShadow = true;
  slab.name = 'iceSlab';
  g.add(slab);
  const top = pos(mk(gCyl(9), crystalMat(0xf2fbff, 0x9ecfe8, 0.95), 1.12, 0.1, 0.86), 0, 0.26, 0);
  top.receiveShadow = true;
  g.add(top);
  ([[-1.0, 0.1, 0.2, 0.2], [0.95, 0.08, -0.15, 0.17], [0.1, 0.12, 0.7, 0.14]] as [number, number, number, number][])
    .forEach(c => g.add(pos(mk(gIco(0), ice, c[3]), c[0], c[1], c[2])));
  g.add(pos(mk(gSphere(10, 6), glowMat(0x9fd8ff, 0.15), 1.2, 0.4, 0.9), 0, -0.2, 0));
  return g;
}

/** A lifting bubble: faceted skin, an inner light ring, and a glass highlight
 *  (children ride the pulse that dynamics.ts applies to userData.b). */
export function makeBubble(): THREE.Group {
  const g = new THREE.Group();
  const b = new THREE.Mesh(sharedGeo('bubbleShell', () => new THREE.SphereGeometry(0.7, 14, 10)),
    crystalMat(0xbcd0ff, 0x6688cc, 0.42));
  b.name = 'bubbleSkin';
  g.add(b);
  g.userData.b = b;
  const swirl = mk(gRing(0.045, 3, 14), glowMat(0xdcecff, 0.35), 0.52);
  swirl.rotation.set(1.0, 0.4, 0);
  b.add(swirl);
  b.add(pos(mk(gSphere(8, 6), glowMat(0xffffff, 0.4), 0.13, 0.09, 0.05), -0.28, 0.39, 0.54));
  b.add(pos(mote(0xdff0ff, 0.05, 0.5), 0.18, -0.1, 0.2));
  return g;
}

/** A rolling sun-flare: a molten faceted core in a cage of light rings. */
export function makeFlare(): THREE.Group {
  const g = new THREE.Group();
  const spin = new THREE.Group();
  g.add(spin);
  g.userData.rock = spin;

  const core = mk(gIco(0), signalMat(0xffc06a, 1.0), 0.42);
  core.name = 'flareCore';
  spin.add(core);
  [[0.9, 0, 0.3], [-0.5, 0.7, -0.2]].forEach((r, i) => {
    const ring = mk(gRing(0.05, 3, 14), glowMat(0xffb055, 0.35), 0.58 - i * 0.08);
    ring.rotation.set(r[0]!, r[1]!, r[2]!);
    spin.add(ring);
  });
  ([[0.5, 0.28, 0.1], [-0.4, -0.3, 0.25]] as [number, number, number][])
    .forEach(p => spin.add(pos(mote(0xffd9a0, 0.07, 0.55), p[0], p[1], p[2])));
  g.add(mk(gSphere(12, 8), glowMat(0xffaa44, 0.22), 0.62));
  return g;
}

/** The Power Box → a POWER LANTERN: a faceted crystal cell in a metal frame
 *  with the element's light burning inside it. */
export function makePowerBox(tint: number): THREE.Group {
  const g = new THREE.Group();

  // UNIQUE material (per-level tint, and reserved for runtime state changes)
  const mat = new THREE.MeshStandardMaterial({
    color: tint, roughness: 0.18, metalness: 0.15, flatShading: true,
    transparent: true, opacity: 0.85, emissive: tint, emissiveIntensity: 0.7,
  });
  const cage = new THREE.Group();
  g.add(cage);
  g.userData.cube = cage;
  g.userData.mat = mat;

  const shell = mk(gOcta(), mat, 0.66, 0.78, 0.66);
  shell.castShadow = true;
  shell.name = 'lanternCell';
  cage.add(shell);

  const frame = metalMat(0xd9c48f, 0.32);
  const band = mk(gRing(0.09, 5, 16), frame, 0.62);
  band.rotation.x = Math.PI / 2;
  cage.add(band);
  cage.add(pos(mk(gCone(6), frame, 0.2, 0.26, 0.2), 0, 0.72, 0));
  const foot = pos(mk(gCone(6), frame, 0.2, 0.26, 0.2), 0, -0.72, 0);
  foot.rotation.z = Math.PI;
  cage.add(foot);

  cage.add(mk(gIco(1), signalMat(0xfff3c8, 1.5), 0.22));   // the burning heart
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU;
    cage.add(pos(mote(lighten(tint, 0.5), 0.055), Math.cos(a) * 0.8, (i - 1) * 0.22, Math.sin(a) * 0.8));
  }
  g.add(mk(gSphere(10, 7), glowMat(tint, 0.16), 0.95));
  g.add(pos(contactShadow(0.6), 0, -0.9, 0));
  return g;
}

/** A soft elemental puff projectile: bright core, halo, and a tilted ripple
 *  ring so its spin reads. Core material is UNIQUE (powers.ts flickers it). */
export function makePuff(color: number): THREE.Group {
  const g = new THREE.Group();
  const coreMat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 });
  const core = mk(gIco(1), coreMat, 0.22);
  core.name = 'puffCore';
  g.add(core);
  g.userData.core = core;
  g.add(mk(gSphere(10, 7), glowMat(color, 0.3), 0.42));
  const ring = mk(gRing(0.09, 4, 10), glowMat(lighten(color, 0.35), 0.4), 0.30);
  ring.rotation.set(1.1, 0.3, 0);
  g.add(ring);
  return g;
}

/** The no-fail gap catch: a wide bed of glowing moss. This is a WELCOME, not a
 *  hazard — soft rounded mound, pillowy tufts, and a warm pool of light on top
 *  so a missed jump lands somewhere that looks safe and inviting. */
export function makeGapCushion(width: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const halfW = width / 2 + 0.6;

  const mound = mk(gDome(16, 6), organicMat(color, color, 0.16), halfW, 0.5, 1.4);
  mound.receiveShadow = true;
  mound.name = 'cushionBed';
  g.add(mound);

  const tuft = organicMat(lighten(color, 0.35), color, 0.2);
  const n = Math.max(3, Math.min(6, Math.round(width / 1.3)));
  for (let i = 0; i < n; i++) {
    const f = (i + 0.5) / n - 0.5;
    const r = 0.34 + (i % 2) * 0.12;
    g.add(pos(mk(gSphere(10, 7), tuft, r, r * 0.62, r * 0.9), f * halfW * 1.65, 0.42, 0.2 - (i % 3) * 0.25));
  }

  // a warm pool of light lying on the bed — the "you are safe here" signal
  const pool = pos(mk(gPlane(), glowMat(0xffe9b8, 0.16, true), width + 1.6, 3.0, 1), 0, 0.56, 0);
  pool.rotation.x = -Math.PI / 2;
  g.add(pool);
  for (let i = 0; i < 3; i++) {
    g.add(pos(mote(0xffe9b8, 0.06, 0.45), (i - 1) * halfW * 0.55, 0.85 + (i % 2) * 0.35, 0.1));
  }
  return g;
}

/** A freezable vapour spout. Nozzle + rim + rivets, and the jet whose UNIQUE
 *  material dynamics.ts pulses. */
export function makeSpout(height: number): THREE.Group {
  const g = new THREE.Group();
  const key = height.toFixed(2);

  g.add(pos(mk(gCyl(14, 0.73), rockMat(0x6a86b8), 0.75, 0.4, 0.75), 0, 0.2, 0));
  const lip = pos(mk(gRing(0.16, 5, 14), metalMat(0xa9c0dc, 0.4), 0.58), 0, 0.38, 0);
  lip.rotation.x = Math.PI / 2;
  g.add(lip);
  [-0.5, 0.5].forEach(x => g.add(pos(mk(gIco(0), metalMat(0xa9c0dc, 0.4), 0.07), x, 0.24, 0.3)));
  g.add(pos(mk(gCyl(10), signalMat(0xbfe3ff, 0.6), 0.42, 0.05, 0.42), 0, 0.4, 0));

  const jetMat = new THREE.MeshStandardMaterial({
    color: 0xbfe3ff, transparent: true, opacity: 0.5,
    emissive: 0x9fd0ff, emissiveIntensity: 0.35, roughness: 0.35,
    side: THREE.DoubleSide, depthWrite: false,
  });
  const jet = pos(new THREE.Mesh(
    sharedGeo(`spoutJet|${key}`, () => new THREE.CylinderGeometry(0.28, 0.48, height, 14, 1, true)), jetMat),
    0, height / 2 + 0.2, 0);
  jet.name = 'spoutJet';
  [0.25, 0.6].forEach((f, i) => jet.add(pos(mote(0xdff0ff, 0.08 - i * 0.02, 0.5), (i ? 0.1 : -0.1), (f - 0.5) * height, 0)));
  g.add(jet);
  g.userData.jet = jet;
  g.add(pos(contactShadow(0.85), 0, 0.04, 0));       // clear of the ground plane
  return g;
}

/** A solidified platform (frozen spout / puffed cloud). Standable top stays at
 *  +0.25 so the physics contract is unchanged; everything else is trim. */
export function makeSolidPlat(width: number, tint: number): THREE.Mesh {
  const plat = new THREE.Mesh(
    sharedGeo(`solidPlat|${width.toFixed(2)}`, () => new THREE.BoxGeometry(width, 0.5, 2.4)),
    crystalMat(tint, tint, 0.88));
  plat.receiveShadow = true;
  plat.castShadow = true;
  plat.name = 'solidPlat';

  const deck = pos(mk(gBox(), crystalMat(lighten(tint, 0.4), tint, 0.95), width - 0.24, 0.06, 2.2), 0, 0.24, 0);
  deck.receiveShadow = true;
  plat.add(deck);
  [-1, 1].forEach(s => {
    plat.add(pos(mk(gBox(), metalMat(0xbcd8ea, 0.3), 0.1, 0.44, 2.3), s * (width / 2 - 0.04), 0, 0));
    plat.add(pos(mk(gIco(0), crystalMat(lighten(tint, 0.25), tint, 0.9), 0.13), s * (width / 2 - 0.45), 0.26, s * 1.0));
  });
  const underglow = pos(mk(gPlane(), glowMat(tint, 0.18, true), width * 1.1, 1.8, 1), 0, -0.3, 0);
  underglow.rotation.x = -Math.PI / 2;
  plat.add(underglow);
  return plat;
}

/** A standable ledge — the single most-used gameplay surface in the game, so it
 *  gets a real authored form rather than a bare slab.
 *  Layers: rock underbody with taper → lighter standable deck with overhang →
 *  edge trim + corner studs → two support struts → a warm light bead underneath
 *  so the ledge reads clearly against dark terrain.
 *  `pal` keeps every ledge made of the world it sits in. */
export function makePlatform(width: number, pal: Palette, seed = 0.5): THREE.Group {
  const g = new THREE.Group();
  const w = Math.max(1.6, width);
  const bodyC = shade(pal.hill, 0.86);
  const deckC = lighten(pal.hill, 0.30);

  // 1 — underbody: a slightly tapered block, flat-shaded so edges catch light
  const under = mk(gCyl(6, 0.86), rockMat(bodyC, { rough: 0.95, flat: true }), w * 0.5, 0.52, 1.15);
  under.rotation.y = Math.PI / 6;
  under.castShadow = true;
  g.add(pos(under, 0, -0.06, 0));

  // 2 — deck: the surface you actually stand on, overhanging the body a little
  const deck = mk(gBox(), rockMat(deckC, { rough: 0.8 }), w, 0.22, 2.34);
  deck.receiveShadow = true; deck.castShadow = true;
  g.add(pos(deck, 0, 0.2, 0));

  // 3 — trim: a bright lip along the front edge + corner studs
  g.add(pos(mk(gBox(), rockMat(lighten(pal.hill, 0.5), { rough: 0.7 }), w * 0.99, 0.07, 0.16), 0, 0.31, 1.16));
  [-1, 1].forEach(s => {
    g.add(pos(mk(gIco(0), metalMat(pal.light, 0.35), 0.11), s * (w / 2 - 0.22), 0.3, 1.06));
    // 4 — support struts
    const strut = mk(gCyl(5), rockMat(shade(pal.hill, 0.7), { rough: 1, flat: true }), 0.13, 0.5, 0.13);
    strut.rotation.z = s * 0.12;
    g.add(pos(strut, s * (w * 0.28), -0.5, 0));
  });

  // 5 — light signal: a soft bead underneath, so ledges read at a glance
  const bead = mote(pal.accent, 0.13, 0.5);
  g.add(pos(bead, (seed - 0.5) * w * 0.5, -0.16, 0.9));
  const halo = pos(mk(gPlane(), glowMat(pal.accent, 0.12, true), w * 0.9, 1.1, 1), 0, -0.22, 0.5);
  halo.rotation.x = -Math.PI / 2;
  g.add(halo);
  return g;
}

/** A springy bush: mossy base, leaf lobes, and blossoms holding little lights
 *  (this is a bounce pad — it should look like it WANTS to be jumped on). */
export function makeBush(): THREE.Group {
  const g = new THREE.Group();
  const model = assets.getModel('bush');
  if (model) { g.add(model); return g; }

  const moss = organicMat(0x3f8f5d);
  const leaf = organicMat(0x4fae6d, 0x224422, 0.1);
  const leafTop = organicMat(0x63c67f, 0x224422, 0.1);
  const mound = pos(mk(gDome(14, 6), moss, 0.66, 0.42, 0.5), 0, -0.28, 0);
  mound.castShadow = true;
  g.add(mound);
  ([[0, 0.1, 0.5, 0], [-0.4, -0.05, 0.4, 0], [0.4, -0.05, 0.4, 0], [0, 0.32, 0.4, 1]] as [number, number, number, number][])
    .forEach(p => g.add(pos(mk(gSphere(12, 9), p[3] ? leafTop : leaf, p[2], p[2] * 0.8, p[2]), p[0], p[1], 0)));
  ([[-0.3, 0.3], [0.3, 0.35], [0, 0.58]] as [number, number][])
    .forEach(p => g.add(pos(mk(gIco(0), signalMat(0xff9ec4, 0.55), 0.1), p[0], p[1], 0.48)));
  const stem = pos(mk(gCyl(5), moss, 0.02, 0.3, 0.02), 0.24, 0.62, 0.15);
  stem.rotation.z = -0.3;
  g.add(stem);
  g.add(pos(mote(0xfff0c0, 0.07, 0.5), 0.32, 0.8, 0.15));
  g.add(pos(contactShadow(0.6), 0, -0.32, 0));       // clear of the ground plane
  return g;
}
