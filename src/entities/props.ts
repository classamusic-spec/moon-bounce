import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GROUND_Y } from '../core/constants';
import { rockMat, organicMat, crystalMat, metalMat, glowMat, signalMat, sharedGeo, radialTex } from '../systems/materials';
import type { Palette } from '../systems/materials';

// ---------------------------------------------------------------------------
// WORLD PROP KIT
//
// The worlds used to be ground bumps + hemispheres + one orb. This module is
// the scenery layer that turns them into places: fourteen authored props built
// from 2-5 construction layers each (base form -> detail -> trim/accent ->
// soft light pocket) plus a genuinely layered background skyline.
//
// ART DIRECTION (from CLAUDE.md — non-negotiable)
//   * Sensory-safe: rounded, soft, no spikes that read as hazards, nothing
//     menacing. This game has NO fail state, so the world must never *look*
//     dangerous. Silhouettes taper and round off; "shards" are blunt crystals.
//   * Calm: no flashing. The only motion is slow (0.2-0.5 Hz) sway/bob, and it
//     obeys `propMotion` so Calm Mode can slow or stop it.
//   * Fiction: the Sun fell asleep and its light scattered. Every world carries
//     pockets of warm stray light — crystals, light pods, lit mushroom gills,
//     glowing grooves. That single warm hue (`tones().gem/.glow`) is the visual
//     through-line across all eight planets.
//
// BUDGET (low-end phones — props are scattered in the dozens)
//   * Every prop is < ~400 triangles (measured 98-314); skyline pieces < 150,
//     and the whole skyline bakes down to ~5 meshes / ~1000 triangles.
//   * Geometry is shared through sharedGeo() — a handful of cached primitives
//     and 4 pre-jittered "variant" geometries per organic shape, so a scattered
//     field is varied but costs almost no GPU memory.
//   * Materials come from the cached roles in materials.ts, keyed off a small
//     per-palette tone set, so the whole kit adds only a few shader programs.
//   * NO castShadow / receiveShadow anywhere: props are decoration.
//   * Static children are matrix-frozen (matrixAutoUpdate = false) so dozens of
//     props cost nothing per frame on the CPU.
//
// CONVENTIONS
//   * Every prop's origin is its GROUND CONTACT POINT: put the group at
//     (x, groundAt(x), z) and it stands correctly. (floatingIsle hovers above
//     its origin; that is the point of it.)
//   * Props face +Z, the camera side of the 2.5D stage.
// ---------------------------------------------------------------------------

export type PropKind =
  | 'spire' | 'arch' | 'boulder' | 'crystalCluster' | 'flora' | 'monolith'
  | 'mushroomTree' | 'iceShelf' | 'vent' | 'ruinPillar' | 'floatingIsle' | 'duneRipple'
  | 'lightPod' | 'bannerStone'
  | 'pineTree' | 'leafTree' | 'mountain';

/** Global motion control for self-animating props (banner sway, isle bob,
 *  light-pod breathing). Set `speed` to ~0.55 in Calm Mode, or `enabled=false`
 *  for a full motion-reduction setting. Props animate themselves, so no
 *  per-frame integration is required from the game loop. */
export const propMotion = { speed: 1, enabled: true };

const TAU = Math.PI * 2;

// ---------------------------------------------------------------------------
// deterministic randomness
// ---------------------------------------------------------------------------

/** mulberry32 — tiny, fast, deterministic. Same seed => same silhouette. */
function mulberry(seed: number): () => number {
  let a = (Math.floor(Math.abs(seed) * 0xffffffff) ^ 0x9e3779b9) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function rr(rnd: () => number, a: number, b: number): number { return a + (b - a) * rnd(); }

function hashName(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 100003) / 100003;
}

// ---------------------------------------------------------------------------
// self-driven clock (so props sway without the game loop knowing about them)
// ---------------------------------------------------------------------------

let _t = 0;
let _last = -1;
/** Telescoping accumulator: called once per animated prop per frame, the sum of
 *  the deltas still equals real elapsed time, so N props do not run N times fast. */
function propClock(): number {
  const now = typeof performance !== 'undefined' ? performance.now() : Date.now();
  if (_last < 0) _last = now;
  const dt = Math.min(0.1, Math.max(0, (now - _last) / 1000));
  _last = now;
  _t += dt * propMotion.speed;
  return _t;
}

/** Drive `target`'s transform from `driver`'s render hook. Off-screen props are
 *  frustum-culled, so their animation pauses for free. */
function animate(driver: THREE.Mesh, target: THREE.Object3D, fn: (t: number) => void): void {
  target.userData.anim = true;
  driver.onBeforeRender = () => { if (propMotion.enabled) fn(propClock()); };
}

// ---------------------------------------------------------------------------
// colour tones — one small, cached set per planet palette
// ---------------------------------------------------------------------------

const _cA = new THREE.Color();
const _cB = new THREE.Color();
function mix(a: number, b: number, k: number): number {
  return _cA.setHex(a).lerp(_cB.setHex(b), k).getHex();
}

/** Pull a colour toward its own grey. Rock is desaturated so it reads as stone
 *  next to the (saturated) planet ground instead of one flat monochrome wash. */
function desat(hex: number, k: number): number {
  const c = _cA.setHex(hex);
  const l = c.r * 0.30 + c.g * 0.59 + c.b * 0.11;
  return c.lerp(_cB.setRGB(l, l, l), k).getHex();
}

interface Tones {
  stone: number; stoneDeep: number; stoneLight: number; soil: number;
  leaf: number; gem: number; glow: number; trim: number; ice: number; sky: number;
}

const toneCache = new Map<string, Tones>();

/** Derive the prop colour roles from a planet palette. Keeping this to ~10
 *  colours per planet is what keeps the cached material count small. */
function tones(pal: Palette): Tones {
  const key = `${pal.ground}|${pal.hill}|${pal.sky0}|${pal.sky1}|${pal.accent}`;
  const hit = toneCache.get(key);
  if (hit) return hit;
  // NOTE the rock roles are lifted ~20% and desaturated: rockMat multiplies the
  // colour by a noise map that averages ~0.7, so raw palette values render much
  // darker than the untextured terrain they stand on.
  const t: Tones = {
    stone: desat(mix(pal.ground, pal.light, 0.34), 0.30),
    stoneDeep: desat(mix(pal.deep, pal.ground, 0.55), 0.24),
    stoneLight: desat(mix(pal.hill, pal.light, 0.80), 0.26),
    soil: mix(mix(pal.hill, pal.ground, 0.5), pal.light, 0.2),
    // foliage keeps the planet's own hue (pal.accent is a pale dust tone and
    // would wash every world's plants out to grey)
    leaf: mix(pal.hill, pal.light, 0.46),
    // the stray-light motif: warm gold, tinted a little toward the planet
    gem: mix(0xffd28a, pal.accent, 0.40),
    glow: mix(0xffce7d, pal.accent, 0.22),
    trim: mix(pal.light, 0xfff1d6, 0.45),
    ice: mix(pal.light, 0xffffff, 0.45),
    sky: pal.sky1,
  };
  toneCache.set(key, t);
  return t;
}

// ---------------------------------------------------------------------------
// geometry bank
// ---------------------------------------------------------------------------

/** Weld-safe vertex jitter: identical positions get identical offsets, so seams
 *  and non-indexed polyhedra (Icosahedron etc.) do not tear apart. */
function jitter(geo: THREE.BufferGeometry, amt: number, rnd: () => number): THREE.BufferGeometry {
  const p = geo.attributes.position as THREE.BufferAttribute;
  const seen = new Map<string, [number, number, number]>();
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i), z = p.getZ(i);
    const k = `${x.toFixed(3)},${y.toFixed(3)},${z.toFixed(3)}`;
    let o = seen.get(k);
    if (!o) { o = [(rnd() - 0.5) * amt, (rnd() - 0.5) * amt, (rnd() - 0.5) * amt]; seen.set(k, o); }
    p.setXYZ(i, x + o[0], y + o[1], z + o[2]);
  }
  p.needsUpdate = true;
  geo.computeVertexNormals();
  return geo;
}

/** One of four pre-baked, pre-jittered variants of a shape — shared forever. */
function vGeo(key: string, v: number, make: (rnd: () => number) => THREE.BufferGeometry): THREE.BufferGeometry {
  return sharedGeo(`prop:${key}:${v}`, () => make(mulberry(0.171 + v * 0.2237)));
}

// Unit primitives (all scaled per-instance). Triangle counts in comments.
const gBlob = (): THREE.BufferGeometry => sharedGeo('prop:blob', () => new THREE.SphereGeometry(1, 5, 3));              // 20
const gBall = (): THREE.BufferGeometry => sharedGeo('prop:ball', () => new THREE.SphereGeometry(1, 8, 5));              // 64
const gCap = (): THREE.BufferGeometry => sharedGeo('prop:cap', () => new THREE.SphereGeometry(1, 9, 4, 0, TAU, 0, Math.PI * 0.56)); // 63
const gCup = (): THREE.BufferGeometry => sharedGeo('prop:cup', () => new THREE.SphereGeometry(1, 9, 4, 0, TAU, Math.PI * 0.42, Math.PI * 0.58)); // 63
const gPetal = (): THREE.BufferGeometry => sharedGeo('prop:petal', () => new THREE.SphereGeometry(1, 4, 3, 0, Math.PI * 0.55, Math.PI * 0.06, Math.PI * 0.44)); // 24
const gTube = (): THREE.BufferGeometry => sharedGeo('prop:tube', () => new THREE.CylinderGeometry(1, 1, 1, 6, 1));      // 24
const gRingWall = (): THREE.BufferGeometry => sharedGeo('prop:ringWall', () => new THREE.CylinderGeometry(1, 1, 1, 8, 1, true)); // 16
const gFlare = (): THREE.BufferGeometry => sharedGeo('prop:flare', () => new THREE.CylinderGeometry(0.78, 1, 1, 9, 1, true)); // 18
const gCone = (): THREE.BufferGeometry => sharedGeo('prop:cone', () => new THREE.ConeGeometry(1, 1, 7));                // 14
const gBox = (): THREE.BufferGeometry => sharedGeo('prop:box', () => new THREE.BoxGeometry(1, 1, 1));                   // 12
const gOcta = (): THREE.BufferGeometry => sharedGeo('prop:octa', () => new THREE.OctahedronGeometry(1, 0));             // 8
const gPlane = (): THREE.BufferGeometry => sharedGeo('prop:plane', () => new THREE.PlaneGeometry(1, 1));                // 2
const gRing = (): THREE.BufferGeometry => sharedGeo('prop:ring', () => new THREE.RingGeometry(0.42, 1, 12));            // 24
const gDisc = (): THREE.BufferGeometry => sharedGeo('prop:disc', () => new THREE.CircleGeometry(1, 10));                // 10
const gDiscBig = (): THREE.BufferGeometry => sharedGeo('prop:discBig', () => new THREE.CircleGeometry(1, 22));          // 22
const gRingThin = (): THREE.BufferGeometry => sharedGeo('prop:ringThin', () => new THREE.RingGeometry(0.9, 1, 48));      // 96
const gArch = (): THREE.BufferGeometry => sharedGeo('prop:arch', () => new THREE.TorusGeometry(1, 0.19, 4, 9, Math.PI)); // 72

// Seeded variant banks (4 each).
const vTaper = (v: number): THREE.BufferGeometry => vGeo('taper', v, r => jitter(new THREE.CylinderGeometry(0.60, 1, 1, 7, 1), 0.055, r));   // 28
const vPillar = (v: number): THREE.BufferGeometry => vGeo('pillar', v, r => jitter(new THREE.CylinderGeometry(0.88, 1, 1, 8, 1), 0.030, r)); // 32
const vRock = (v: number): THREE.BufferGeometry => vGeo('rock', v, r => jitter(new THREE.IcosahedronGeometry(1, 1), 0.17, r));               // 80
const vPebble = (v: number): THREE.BufferGeometry => vGeo('pebble', v, r => jitter(new THREE.IcosahedronGeometry(1, 0), 0.24, r));           // 20
// blunt-topped, never needle-sharp: a gem, not a spike (sensory-safe silhouette)
const vShard = (v: number): THREE.BufferGeometry => vGeo('shard', v, r => jitter(new THREE.CylinderGeometry(0.42, 1, 1, 5, 1), 0.05, r));    // 20
const vDome = (v: number): THREE.BufferGeometry => vGeo('dome', v, r => jitter(new THREE.SphereGeometry(1, 10, 3, 0, TAU, 0, Math.PI * 0.5), 0.06, r)); // 50
const vSlab = (v: number): THREE.BufferGeometry => vGeo('slab', v, r => jitter(new THREE.CylinderGeometry(1, 0.93, 1, 6, 1), 0.05, r));      // 24

/** A rounded standing slab (headstone silhouette) — authored, not a box. ~96 */
const vMonolith = (v: number): THREE.BufferGeometry => vGeo('mono', v, r => {
  const w = rr(r, 0.26, 0.34), h = rr(r, 1.35, 1.75), lean = rr(r, -0.04, 0.04);
  const sh = new THREE.Shape();
  sh.moveTo(-w, 0);
  sh.lineTo(-w * 0.84 + lean, h);
  sh.quadraticCurveTo(lean, h + w * 1.05, w * 0.84 + lean, h);
  sh.lineTo(w, 0);
  sh.closePath();
  const g = new THREE.ExtrudeGeometry(sh, {
    depth: 0.22, bevelEnabled: true, bevelSize: 0.035, bevelThickness: 0.035,
    bevelSegments: 1, curveSegments: 4, steps: 1,
  });
  g.translate(0, 0, -0.11);
  return g;
});

/** A pre-curved cloth panel: hangs from y=0 down to y=-1, bellied toward +Z. ~40 */
const vBanner = (v: number): THREE.BufferGeometry => vGeo('banner', v, r => {
  const g = new THREE.PlaneGeometry(1, 1, 4, 5);
  const p = g.attributes.position as THREE.BufferAttribute;
  const belly = rr(r, 0.12, 0.24), curl = rr(r, 0.06, 0.16), flare = rr(r, 0.1, 0.3);
  for (let i = 0; i < p.count; i++) {
    const x = p.getX(i), y = p.getY(i);
    const v0 = 0.5 - y;                       // 0 at top, 1 at bottom
    p.setZ(i, Math.cos(x * Math.PI) * belly * v0 + Math.sin(v0 * 3.1) * curl * 0.4);
    p.setX(i, x * (1 + flare * v0));          // widens toward the hem, like hung cloth
    p.setY(i, y - 0.5 - Math.sin(x * Math.PI * 1.6) * curl * v0 * 1.6); // wavy hem
  }
  p.needsUpdate = true;
  g.computeVertexNormals();
  return g;
});

// ---------------------------------------------------------------------------
// small build helpers
// ---------------------------------------------------------------------------

function put(
  parent: THREE.Object3D, geo: THREE.BufferGeometry, mat: THREE.Material,
  pos: [number, number, number], scl: [number, number, number], rot?: [number, number, number],
): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scl[0], scl[1], scl[2]);
  if (rot) m.rotation.set(rot[0], rot[1], rot[2]);
  parent.add(m);
  return m;
}

/** A soft additive light card — the "stray light" pocket every prop family
 *  carries. Radial falloff, no depth write, never flashes. */
function lightPocket(parent: THREE.Object3D, color: number, size: number, pos: [number, number, number], opacity = 0.26): THREE.Mesh {
  const m = put(parent, gPlane(), glowMat(color, opacity, true), pos, [size, size, 1]);
  m.renderOrder = 2;
  return m;
}

/** Freeze static children's matrices — dozens of props then cost ~0 CPU/frame. */
function freeze(g: THREE.Group): void {
  g.traverse(o => {
    if (o === g || o.userData.anim) return;
    o.updateMatrix();
    o.matrixAutoUpdate = false;
  });
}

type Build = (g: THREE.Group, t: Tones, rnd: () => number, v: number) => void;

// ---------------------------------------------------------------------------
// THE 14 PROPS
// ---------------------------------------------------------------------------

/** SPIRE ~150 tris — a tall tapered needle of banded rock. Three nested
 *  segments give it a gentle organic kink and lean (never a sharp spike); a
 *  small crystal at the tip catches stray light. */
const buildSpire: Build = (g, t, rnd, v) => {
  const stone = rockMat(t.stone, { flat: true, strata: true });
  const band = rockMat(t.stoneDeep, { flat: true });
  const lean = rr(rnd, -0.11, 0.11);
  // base skirt (layer 1) — grounds the needle so it doesn't look stuck in
  put(g, vPebble(v), rockMat(t.stoneDeep, { flat: true }), [0, 0.07, 0], [rr(rnd, 0.42, 0.56), 0.20, 0.40]);

  let node: THREE.Object3D = g;
  let r = rr(rnd, 0.26, 0.34);
  let tipY = 0;
  const hs = [rr(rnd, 1.0, 1.35), rr(rnd, 0.8, 1.05), rr(rnd, 0.6, 0.85)];
  for (let i = 0; i < 3; i++) {
    const seg = new THREE.Group();
    seg.position.y = i === 0 ? 0 : hs[i - 1]! * 0.95;
    seg.rotation.z = i === 0 ? lean * 0.4 : lean;
    node.add(seg);
    const h = hs[i]!;
    put(seg, vTaper((v + i) % 4), i === 1 ? rockMat(t.stoneLight, { flat: true, strata: true }) : stone,
      [0, h / 2, 0], [r, h, r * 0.9]);
    // banding trim (layer 3)
    if (i < 2) put(seg, gRingWall(), band, [0, h * rr(rnd, 0.35, 0.6), 0], [r * 0.99, h * 0.07, r * 0.92]);
    node = seg;
    r *= 0.63;
    tipY = h;
  }
  // crystal tip + light pocket (layers 4-5)
  put(node, gOcta(), crystalMat(t.gem), [0, tipY + 0.06, 0], [0.11, 0.17, 0.11], [0, 0.4, 0]);
  lightPocket(node, t.glow, 0.7, [0, tipY + 0.06, 0.02], 0.22);
};

/** ARCH ~200 tris — a natural stone archway with a REAL hole through it
 *  (half-torus lintel + two splayed legs), a keystone and a lit underside. */
const buildArch: Build = (g, t, rnd, v) => {
  const stone = rockMat(t.stone, { flat: true, strata: true });
  const deep = rockMat(t.stoneDeep, { flat: true });
  const span = rr(rnd, 0.85, 1.25);
  const legH = rr(rnd, 0.45, 0.85);
  const thick = rr(rnd, 0.24, 0.34);
  const rise = span * rr(rnd, 0.80, 1.15);
  for (const s of [-1, 1] as const) {
    // legs flare outward at the bottom (taper geo is wide-bottomed)
    put(g, vTaper((v + (s > 0 ? 1 : 2)) % 4), stone, [s * span, legH / 2, 0], [thick * 1.25, legH + 0.05, thick * 1.15], [0, 0, -s * 0.05]);
    put(g, vPebble((v + (s > 0 ? 3 : 0)) % 4), deep, [s * span * 1.06, 0.08, 0.04], [thick * 1.5, 0.22, thick * 1.3]);
  }
  // lintel: half torus => you can see the sky through it
  put(g, gArch(), stone, [0, legH, 0], [span, rise, thick / 0.19 * 0.62]);
  // keystone trim + a pocket of light held under the crown
  put(g, vPebble((v + 1) % 4), rockMat(t.stoneLight, { flat: true }), [0, legH + rise - thick * 0.1, 0], [thick * 0.95, thick * 0.7, thick * 0.9], [0, rnd() * 3, rr(rnd, -0.12, 0.12)]);
  put(g, gOcta(), crystalMat(t.gem), [0, legH + rise - thick * 0.55, 0.02], [0.09, 0.13, 0.09]);
  lightPocket(g, t.glow, span * 1.5, [0, legH + rise * 0.55, 0.05], 0.16);
};

/** BOULDER ~170 tris — 2-3 weathered lumps of differing size, with mossy
 *  cushions and one mineral vein catching the light. */
const buildBoulder: Build = (g, t, rnd, v) => {
  const stone = rockMat(t.stone, { flat: true });
  const deep = rockMat(t.stoneDeep, { flat: true });
  const R = rr(rnd, 0.48, 0.72);
  put(g, vRock(v), stone, [0, R * 0.86, 0], [R, R * rr(rnd, 0.78, 1.0), R * 0.86]);
  const n = rnd() < 0.55 ? 2 : 1;
  for (let i = 0; i < n; i++) {
    const s = R * rr(rnd, 0.36, 0.6);
    const sx = (i === 0 ? -1 : 1) * R * rr(rnd, 0.85, 1.15);
    put(g, vPebble((v + i + 1) % 4), i === 0 ? deep : stone, [sx, s * 0.8, rr(rnd, -0.15, 0.2)], [s, s * 0.85, s * 0.85], [rnd() * 3, rnd() * 3, rnd() * 3]);
  }
  // mossy / mineral trim
  for (let i = 0; i < 3; i++) {
    const a = rr(rnd, -0.9, 0.9);
    put(g, gOcta(), organicMat(t.leaf), [Math.sin(a) * R * 0.7, R * rr(rnd, 1.0, 1.35), Math.cos(a) * R * 0.45],
      [R * 0.24, R * 0.11, R * 0.2], [0, a, 0]);
  }
  put(g, vShard((v + 2) % 4), crystalMat(t.gem), [R * 0.42, R * 0.78, R * 0.55], [0.07, 0.22, 0.07], [0.5, 0, -0.5]);
  lightPocket(g, t.glow, 0.55, [R * 0.42, R * 0.86, R * 0.6], 0.18);
};

/** CRYSTAL CLUSTER ~160 tris — the signature "stray light" motif: 3-6 blunt
 *  faceted shards of differing height on a small rock foot, softly emissive. */
const buildCrystalCluster: Build = (g, t, rnd, v) => {
  const gem = crystalMat(t.gem);
  const gem2 = crystalMat(mix(t.gem, t.ice, 0.45));
  const S = rr(rnd, 0.85, 1.15);
  put(g, vPebble(v), rockMat(t.stoneDeep, { flat: true }), [0, 0.07, 0], [0.42 * S, 0.15, 0.34 * S]);
  const n = 3 + Math.floor(rnd() * 4);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rr(rnd, -0.4, 0.4);
    const h = rr(rnd, 0.32, 0.95) * S;
    const w = rr(rnd, 0.075, 0.125) * S;
    const d = rr(rnd, 0.08, 0.26) * S;
    const m = put(g, vShard((v + i) % 4), i % 3 === 1 ? gem2 : gem,
      [Math.cos(a) * d, h * 0.5 + 0.05, Math.sin(a) * d * 0.6], [w, h, w]);
    m.rotation.z = -Math.cos(a) * rr(rnd, 0.10, 0.30);
    m.rotation.x = Math.sin(a) * rr(rnd, 0.08, 0.22);
  }
  // two loose motes + the halo
  for (let i = 0; i < 2; i++) {
    put(g, gOcta(), signalMat(t.glow, 0.9), [rr(rnd, -0.4, 0.4) * S, rr(rnd, 0.7, 1.1) * S, rr(rnd, -0.1, 0.25)], [0.04, 0.05, 0.04]);
  }
  lightPocket(g, t.glow, 1.5 * S, [0, 0.5 * S, 0.06], 0.24);
};

/** FLORA ~215 tris — a soft alien plant: a rounded rosette of fronds around a
 *  glowing bud, plus two small sprouts at the base. */
const buildFlora: Build = (g, t, rnd, v) => {
  const leaf = organicMat(t.leaf);
  const leaf2 = organicMat(mix(t.leaf, t.stoneLight, 0.35));
  const S = rr(rnd, 0.85, 1.3);
  const stalkH = rr(rnd, 0.34, 0.6) * S;
  // a low soil tuft the plant grows out of (layer 1)
  put(g, vPebble(v), organicMat(t.soil), [0, 0.04 * S, 0], [0.3 * S, 0.09 * S, 0.24 * S], [0, rnd() * 3, 0]);
  put(g, gTube(), organicMat(t.leaf), [0, stalkH * 0.5, 0], [0.075 * S, stalkH, 0.075 * S]);
  // rosette: fronds sweep UP and outward from the stalk head like a soft aloe
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const piv = new THREE.Group();
    piv.position.set(0, stalkH * 0.86, 0);
    // euler XYZ: the z tilt leans the frond out, then y swings it around
    piv.rotation.set(0, (i / n) * TAU + rr(rnd, -0.28, 0.28), rr(rnd, 0.5, 0.95));
    g.add(piv);
    const len = rr(rnd, 0.42, 0.66) * S;
    put(piv, gBlob(), i % 2 ? leaf : leaf2, [0, len * 0.52, 0], [len * 0.19, len * 0.6, len * 0.3]);
  }
  // glowing bud on top + halo
  const budY = stalkH + rr(rnd, 0.34, 0.5) * S;
  put(g, gBall(), organicMat(t.gem, t.glow, 0.5), [0, budY, 0], [0.15 * S, 0.19 * S, 0.15 * S]);
  put(g, gTube(), organicMat(t.leaf), [0, (stalkH + budY) * 0.5, 0], [0.045 * S, budY - stalkH, 0.045 * S]);
  lightPocket(g, t.glow, 1.0 * S, [0, budY, 0.05], 0.24);
  for (let i = 0; i < 2; i++) {
    const sx = (i ? 1 : -1) * rr(rnd, 0.22, 0.38) * S;
    put(g, gBlob(), leaf2, [sx, 0.12 * S, rr(rnd, -0.1, 0.12)], [0.09 * S, 0.2 * S, 0.08 * S], [0, rnd() * 3, sx > 0 ? -0.5 : 0.5]);
  }
};

/** MONOLITH ~150 tris — a tall smooth standing slab with a rounded crown, a
 *  carved groove that glows, a metal collar and a stone footing. */
const buildMonolith: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.35);
  const slab = put(g, vMonolith(v), rockMat(t.stone, { rough: 0.85, strata: true }), [0, 0, 0], [S, S, S]);
  slab.rotation.y = rr(rnd, -0.16, 0.16);
  // footing (layer 2)
  put(g, vPebble((v + 1) % 4), rockMat(t.stoneDeep, { flat: true }), [0, 0.07 * S, 0], [0.46 * S, 0.16 * S, 0.34 * S]);
  // carved groove (layer 3) — a thin inlay on the camera-facing face
  const grooveH = rr(rnd, 0.7, 1.05) * S;
  put(slab, gBox(), signalMat(t.glow, 0.85), [0, 0.30 * S + grooveH * 0.5, 0.115], [0.055, grooveH, 0.03]);
  put(slab, gDisc(), signalMat(t.glow, 0.85), [0, 0.30 * S + grooveH + 0.09, 0.115], [0.075, 0.075, 1]);
  lightPocket(slab, t.glow, 0.8, [0, 0.30 * S + grooveH * 0.6, 0.14], 0.20);
  // metal collar trim (layer 4)
  put(slab, gRingWall(), metalMat(t.trim, 0.35), [0, 0.22 * S, 0], [0.30, 0.07, 0.17]);
};

/** MUSHROOM TREE ~230 tris — a rounded canopy on a thick curved stalk, with a
 *  lit gill ring under the cap and a couple of pale cap spots. */
const buildMushroomTree: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.3);
  const stalkMat = organicMat(t.stoneLight);
  const h1 = rr(rnd, 0.42, 0.6) * S, h2 = rr(rnd, 0.34, 0.5) * S;
  const bend = rr(rnd, -0.14, 0.14);
  put(g, vTaper(v), stalkMat, [0, h1 * 0.5, 0], [0.19 * S, h1, 0.18 * S], [0, 0, bend * 0.4]);
  const upper = new THREE.Group();
  upper.position.set(-Math.sin(bend) * h1 * 0.5, h1 * 0.97, 0);
  upper.rotation.z = bend;
  g.add(upper);
  put(upper, vTaper((v + 1) % 4), stalkMat, [0, h2 * 0.5, 0], [0.145 * S, h2, 0.14 * S]);
  // canopy
  const capR = rr(rnd, 0.55, 0.8) * S;
  put(upper, gCap(), organicMat(t.leaf), [0, h2 + 0.02, 0], [capR, capR * rr(rnd, 0.5, 0.72), capR * 0.9]);
  // lit gill ring (facing down) + soft under-glow
  put(upper, gRing(), glowMat(t.glow, 0.34), [0, h2 + 0.01, 0], [capR * 0.9, capR * 0.9, 1], [Math.PI / 2, 0, 0]);
  lightPocket(upper, t.glow, capR * 1.7, [0, h2 - 0.06, capR * 0.35], 0.17);
  // cap spots
  for (let i = 0; i < 2; i++) {
    const a = rr(rnd, -1.0, 1.0);
    put(upper, gOcta(), organicMat(t.stoneLight), [Math.sin(a) * capR * 0.5, h2 + capR * rr(rnd, 0.35, 0.55), Math.cos(a) * capR * 0.4],
      [capR * 0.16, capR * 0.07, capR * 0.14]);
  }
};

/** ICE SHELF ~120 tris — translucent hexagonal ice layers with frosted chips
 *  and a pocket of warm light frozen inside. */
const buildIceShelf: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.9, 1.4);
  const ice = crystalMat(t.ice, mix(t.ice, t.glow, 0.3), 0.62);
  const ice2 = crystalMat(mix(t.ice, t.stoneLight, 0.35), t.ice, 0.72);
  let y = 0;
  let r = rr(rnd, 0.62, 0.85) * S;
  for (let i = 0; i < 3; i++) {
    const h = rr(rnd, 0.11, 0.2) * S;
    const m = put(g, vSlab((v + i) % 4), i === 1 ? ice2 : ice, [rr(rnd, -0.08, 0.08), y + h * 0.5, rr(rnd, -0.06, 0.06)], [r, h, r * 0.78]);
    m.rotation.y = rr(rnd, 0, 1.1);
    m.rotation.z = rr(rnd, -0.05, 0.05);
    y += h * 0.92;
    r *= rr(rnd, 0.72, 0.9);
  }
  // frosted edge chips
  for (let i = 0; i < 3; i++) {
    const a = rr(rnd, -1.2, 1.2);
    put(g, gOcta(), ice2, [Math.sin(a) * r * 1.5, y * rr(rnd, 0.3, 0.8), Math.cos(a) * r * 0.7], [0.08 * S, 0.13 * S, 0.08 * S], [0, a, rr(rnd, -0.4, 0.4)]);
  }
  lightPocket(g, t.glow, 1.2 * S, [0, y * 0.5, r * 0.6], 0.16);
};

/** VENT ~130 tris — a low, friendly crater chimney: flared rim, dark throat,
 *  rim stones and a soft warm glow rising out. No fire, nothing hazardous. */
const buildVent: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.3);
  const r = rr(rnd, 0.5, 0.72) * S;
  const h = rr(rnd, 0.24, 0.42) * S;
  // the shallow mound the chimney sits in (layer 1)
  put(g, vDome(v), rockMat(t.stone, { rough: 0.98 }), [0, -0.05, 0], [r * 1.35, h * 0.42, r * 0.95]);
  put(g, gFlare(), rockMat(t.stone, { flat: true, strata: true }), [0, h * 0.5, 0], [r, h, r * 0.86]);
  put(g, gFlare(), rockMat(t.stoneDeep, { flat: true }), [0, h * 0.62, 0], [r * 0.72, h * 0.9, r * 0.62], [Math.PI, 0, 0]);
  // the lit mouth, tipped toward the camera so it reads from the side too
  put(g, gDisc(), glowMat(t.glow, 0.55, true), [0, h * 0.9, 0.02], [r * 0.74, r * 0.62, 1], [-Math.PI * 0.34, 0, 0]);
  // rim stones (rounded pebbles, never jagged teeth) — kept off the front lip
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * TAU + Math.PI * 0.25 + rr(rnd, -0.25, 0.25);
    put(g, vPebble((v + i) % 4), rockMat(t.stoneLight, { flat: true }), [Math.cos(a) * r * 0.98, h * rr(rnd, 0.8, 1.0), Math.sin(a) * r * 0.8],
      [0.12 * S, 0.07 * S, 0.1 * S], [0, a, rr(rnd, -0.3, 0.3)]);
  }
  // soft rising warmth (static radial cards, additive, never flickers)
  lightPocket(g, t.glow, r * 1.6, [0, h + 0.26 * S, 0], 0.16);
  lightPocket(g, t.glow, r * 3.0, [0, h + 0.05 * S, 0.05], 0.22);
};

/** RUIN PILLAR ~200 tris — a broken column from an ancient friendly people:
 *  stepped plinth, fluted shaft, metal collars, cracked crown, glowing inlay. */
const buildRuinPillar: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.3);
  const stone = rockMat(t.stone, { strata: true });
  put(g, gBox(), rockMat(t.stoneDeep, { flat: true }), [0, 0.05 * S, 0], [0.62 * S, 0.1 * S, 0.52 * S], [0, rr(rnd, -0.2, 0.2), 0]);
  put(g, gBox(), rockMat(t.stoneLight, { flat: true }), [0, 0.14 * S, 0], [0.48 * S, 0.09 * S, 0.42 * S], [0, rr(rnd, -0.2, 0.2), 0]);
  const shaftH = rr(rnd, 0.9, 1.5) * S;
  put(g, vPillar(v), stone, [0, 0.18 * S + shaftH * 0.5, 0], [0.22 * S, shaftH, 0.21 * S]);
  // collars (trim)
  put(g, gRingWall(), metalMat(t.trim, 0.32), [0, 0.28 * S, 0], [0.235 * S, 0.06 * S, 0.225 * S]);
  put(g, gRingWall(), metalMat(t.trim, 0.32), [0, 0.18 * S + shaftH * 0.82, 0], [0.215 * S, 0.05 * S, 0.205 * S]);
  // cracked crown — a short tilted broken section, not a clean cut
  const topY = 0.18 * S + shaftH;
  put(g, vPebble((v + 2) % 4), rockMat(t.stoneLight, { flat: true }), [rr(rnd, -0.05, 0.05) * S, topY + 0.05 * S, 0],
    [0.23 * S, 0.11 * S, 0.22 * S], [rr(rnd, -0.2, 0.2), rnd() * 3, rr(rnd, -0.22, 0.22)]);
  // inlaid glyph + light
  put(g, gDisc(), signalMat(t.glow, 0.8), [0, 0.18 * S + shaftH * 0.55, 0.21 * S], [0.06 * S, 0.06 * S, 1]);
  lightPocket(g, t.glow, 0.75 * S, [0, 0.18 * S + shaftH * 0.55, 0.26 * S], 0.20);
  // a fallen chunk resting beside it
  if (rnd() < 0.6) {
    put(g, vPebble((v + 3) % 4), stone, [rr(rnd, 0.42, 0.62) * S, 0.11 * S, rr(rnd, -0.15, 0.15)],
      [0.2 * S, 0.13 * S, 0.18 * S], [rnd() * 3, rnd() * 3, 1.3]);
  }
};

/** FLOATING ISLE ~190 tris — a small hovering chunk of land: mossy deck, rocky
 *  keel, crystal underside and a wisp trail. Bobs very slowly. */
const buildFloatingIsle: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.35);
  const body = new THREE.Group();
  body.position.y = rr(rnd, 0.75, 1.05) * S;
  g.add(body);
  const r = rr(rnd, 0.6, 0.95) * S;
  const deck = put(body, vSlab(v), rockMat(t.soil, { flat: true }), [0, 0, 0], [r, 0.22 * S, r * 0.8]);
  deck.rotation.y = rnd() * 1.0;
  // mossy top + a soft rounded keel (a hanging boulder, never a dark spike).
  // NOTE: X-flip only — an added Y term in the same euler tilts the disc upright.
  put(body, gDisc(), organicMat(t.leaf), [0, 0.12 * S + 0.005, 0], [r * 0.93, r * 0.74, 1], [-Math.PI / 2, 0, 0]);
  put(body, vDome((v + 1) % 4), rockMat(t.stoneLight, { flat: true }), [0, -0.08 * S, 0], [r * 0.68, r * rr(rnd, 0.5, 0.75), r * 0.56], [Math.PI, 0, 0]);
  // crystal keel — the light that keeps it up
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * TAU + rnd();
    put(body, vShard((v + i) % 4), crystalMat(t.gem),
      [Math.cos(a) * r * 0.3, -0.28 * S - rr(rnd, 0.1, 0.2) * S, Math.sin(a) * r * 0.2],
      [0.1 * S, rr(rnd, 0.22, 0.36) * S, 0.1 * S], [Math.PI + Math.sin(a) * 0.2, 0, Math.cos(a) * 0.2]);
  }
  lightPocket(body, t.glow, 1.9 * S, [0, -0.35 * S, 0.05], 0.22);
  // wisp trail below (shared material + geometry, varying scale only)
  for (let i = 0; i < 3; i++) {
    const k = 1 - i * 0.26;
    put(g, gPlane(), glowMat(t.glow, 0.16, true), [rr(rnd, -0.1, 0.1) * S, (0.44 - i * 0.16) * S, 0.02], [0.34 * S * k, 0.24 * S * k, 1]);
  }
  const phase = rnd() * TAU;
  const baseY = body.position.y;
  animate(deck, body, tt => { body.position.y = baseY + Math.sin(tt * 0.55 + phase) * 0.07 * S; });
};

/** DUNE RIPPLE ~135 tris — a low wide sculpted ridge of sand/soil for
 *  foreground layering: two overlapping crests, a lighter windward highlight
 *  and a few pebbles. */
const buildDuneRipple: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.9, 1.5);
  const w = rr(rnd, 1.8, 2.9) * S;
  put(g, vDome(v), rockMat(t.stone, { rough: 0.98 }), [0, -0.04, 0], [w, rr(rnd, 0.26, 0.46) * S, rr(rnd, 0.55, 0.8) * S]);
  put(g, vDome((v + 1) % 4), rockMat(t.stoneLight, { rough: 0.98 }),
    [rr(rnd, -0.55, 0.55) * w, -0.05, rr(rnd, 0.1, 0.4)], [w * rr(rnd, 0.45, 0.7), rr(rnd, 0.16, 0.3) * S, rr(rnd, 0.4, 0.6) * S]);
  // crest highlight — a thin bright strip along the top
  put(g, gPlane(), glowMat(t.trim, 0.10), [0, rr(rnd, 0.2, 0.34) * S, rr(rnd, 0.2, 0.35) * S], [w * 1.1, 0.1 * S, 1]);
  for (let i = 0; i < 3; i++) {
    put(g, gOcta(), rockMat(t.stoneDeep, { flat: true }), [rr(rnd, -1, 1) * w * 0.9, 0.03 * S, rr(rnd, 0.15, 0.5)],
      [0.09 * S, 0.05 * S, 0.08 * S], [0, rnd() * 3, rnd()]);
  }
};

/** LIGHT POD ~230 tris — the fiction's signature scenery beat: a rounded
 *  translucent pod on a short stem, petals opened, holding a visible bead of
 *  captured sunlight that breathes very slowly. */
const buildLightPod: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.25);
  const shell = crystalMat(mix(t.ice, t.gem, 0.35), t.glow, 0.45);
  put(g, vPebble(v), rockMat(t.stoneDeep, { flat: true }), [0, 0.05 * S, 0], [0.26 * S, 0.1 * S, 0.22 * S], [0, rnd() * 3, 0]);
  put(g, gTube(), rockMat(t.stoneDeep, { flat: true }), [0, 0.12 * S, 0], [0.11 * S, 0.2 * S, 0.1 * S]);
  const podY = rr(rnd, 0.34, 0.5) * S;
  const R = rr(rnd, 0.26, 0.36) * S;
  put(g, gCup(), shell, [0, podY, 0], [R, R * 1.15, R * 0.92]);
  const n = 3;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * TAU + rr(rnd, -0.2, 0.2);
    const p = put(g, gPetal(), shell, [0, podY + R * 0.1, 0], [R * 1.12, R * 1.25, R * 1.05]);
    p.rotation.y = a;
    p.rotation.x = rr(rnd, -0.34, -0.18);
  }
  // the captured light
  const core = put(g, gBall(), signalMat(t.glow, 1.25), [0, podY + R * 0.3, 0], [R * 0.42, R * 0.42, R * 0.42]);
  const halo = put(g, gBall(), glowMat(t.glow, 0.2), [0, podY + R * 0.3, 0], [R * 0.95, R * 0.95, R * 0.9]);
  lightPocket(g, t.glow, R * 5.5, [0, podY + R * 0.35, R * 0.5], 0.26);
  const phase = rnd() * TAU;
  const cy = core.position.y;
  animate(core, core, tt => {
    core.position.y = cy + Math.sin(tt * 0.7 + phase) * R * 0.09;
    const s = 1 + Math.sin(tt * 0.4 + phase) * 0.04;   // 0.2 Hz, ±4% — far below any flicker threshold
    halo.scale.set(R * 0.95 * s, R * 0.95 * s, R * 0.9 * s);
  });
  halo.userData.anim = true;
};

/** BANNER STONE ~150 tris — a carved waymarker stone with a soft cloth/energy
 *  banner on a crossbar. The banner sways gently (0.3 Hz, ±5°). */
const buildBannerStone: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.85, 1.25);
  const stoneH = rr(rnd, 0.85, 1.25) * S;
  put(g, vPebble(v), rockMat(t.stoneDeep, { flat: true }), [0, 0.08 * S, 0], [0.34 * S, 0.16 * S, 0.28 * S]);
  put(g, vTaper((v + 1) % 4), rockMat(t.stone, { strata: true }), [0, stoneH * 0.5, 0], [0.21 * S, stoneH, 0.19 * S], [0, 0, rr(rnd, -0.05, 0.05)]);
  // carved mark
  put(g, gDisc(), signalMat(t.glow, 0.7), [0, stoneH * 0.62, 0.16 * S], [0.055 * S, 0.055 * S, 1]);
  lightPocket(g, t.glow, 0.6 * S, [0, stoneH * 0.62, 0.2 * S], 0.18);
  // crossbar
  const barY = stoneH * 0.98;
  const barLen = rr(rnd, 0.4, 0.6) * S;
  put(g, gTube(), metalMat(t.trim, 0.34), [barLen * 0.28, barY, 0], [0.03 * S, barLen, 0.03 * S], [0, 0, Math.PI / 2]);
  // banner
  const pivot = new THREE.Group();
  pivot.position.set(barLen * 0.42, barY - 0.02 * S, 0.02);
  g.add(pivot);
  const bw = rr(rnd, 0.34, 0.46) * S, bh = rr(rnd, 0.5, 0.78) * S;
  const cloth = put(pivot, vBanner(v), organicMat(t.gem, t.glow, 0.35), [0, 0, 0], [bw, bh, 1]);
  put(pivot, gPlane(), glowMat(t.glow, 0.22), [0, -bh * 0.97, 0.02], [bw, 0.05 * S, 1]);
  const phase = rnd() * TAU;
  animate(cloth, pivot, tt => {
    pivot.rotation.z = Math.sin(tt * 0.62 + phase) * 0.075;
    pivot.rotation.y = Math.sin(tt * 0.41 + phase * 1.3) * 0.13;
  });
};

/** PINE TREE ~120 tris — a conifer: leaning trunk + three stacked leaf cones
 *  narrowing to a tip, with a tiny warm light bud resting at the crown. */
const buildPineTree: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.9, 1.4);
  const H = rr(rnd, 1.9, 2.6) * S;
  const lean = rr(rnd, -0.06, 0.06);
  const dark = mix(t.leaf, 0x1c3a28, 0.42);
  put(g, vTaper(v), rockMat(mix(t.soil, 0x4a3320, 0.5), { flat: true }), [0, H * 0.24, 0], [0.09 * S, H * 0.5, 0.09 * S], [0, 0, lean]);
  const tiers = 3 + (v % 2);
  for (let i = 0; i < tiers; i++) {
    const f = i / tiers;
    const r = (0.62 - f * 0.38) * S * rr(rnd, 0.9, 1.1);
    const y = H * (0.34 + f * 0.6);
    put(g, gCone(), organicMat(i % 2 ? dark : mix(dark, t.leaf, 0.45)), [lean * y * 8 * 0.09, y, 0], [r, H * 0.34, r], [0, rnd() * TAU, lean]);
  }
  put(g, gBall(), signalMat(t.glow, 0.9), [lean * H * 0.7, H * 1.02, 0.02 * S], [0.05 * S, 0.05 * S, 0.05 * S]);
};

/** LEAF TREE ~150 tris — a broadleaf: curved two-part trunk, a canopy of three
 *  overlapping leaf blobs with a sunlit crown blob, and a couple of glowing
 *  fruit motes hanging in the foliage. */
const buildLeafTree: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 0.9, 1.35);
  const H = rr(rnd, 1.5, 2.1) * S;
  const bend = rr(rnd, -0.16, 0.16);
  const bark = rockMat(mix(t.soil, 0x54381f, 0.55), { flat: true });
  put(g, gTube(), bark, [0, H * 0.3, 0], [0.11 * S, H * 0.62, 0.11 * S], [0, 0, bend * 0.5]);
  put(g, gTube(), bark, [bend * H * 0.5, H * 0.68, 0], [0.08 * S, H * 0.5, 0.08 * S], [0, 0, bend]);
  const cx = bend * H * 0.8;
  const leafLo = organicMat(mix(t.leaf, 0x256b3a, 0.35));
  const leafHi = organicMat(mix(t.leaf, 0x9fdb7a, 0.4));
  put(g, vPebble(v), leafLo, [cx - 0.34 * S, H * 0.92, 0], [0.46 * S, 0.38 * S, 0.42 * S]);
  put(g, vPebble((v + 1) % 4), leafLo, [cx + 0.36 * S, H * 0.95, 0.06 * S], [0.42 * S, 0.36 * S, 0.4 * S]);
  put(g, vPebble((v + 2) % 4), leafHi, [cx + 0.02 * S, H * 1.12, 0.02 * S], [0.44 * S, 0.4 * S, 0.42 * S]);
  for (let i = 0; i < 2; i++) {
    put(g, gBall(), signalMat(t.gem, 1.0), [cx + rr(rnd, -0.4, 0.4) * S, H * rr(rnd, 0.85, 1.05), 0.3 * S], [0.045 * S, 0.045 * S, 0.045 * S]);
  }
  lightPocket(g, t.glow, 0.8 * S, [cx, H * 1.0, 0.3 * S], 0.12);
};

/** MOUNTAIN ~130 tris — a two/three-peak massif with snow caps and a foothill,
 *  built for the mid/bg layers (use scale 1.5-3 back there). */
const buildMountain: Build = (g, t, rnd, v) => {
  const S = rr(rnd, 1.2, 1.8);
  // mountains are ROCK — cool blue-grey regardless of how green the world is,
  // or on a green planet they read as giant pines
  const rock = rockMat(desat(mix(t.stoneDeep, 0x76819a, 0.62), 0.18), { flat: true, strata: true });
  const snow = organicMat(mix(t.ice, 0xffffff, 0.6));
  const peaks = 2 + (v % 2);
  let px = -0.7 * S;
  for (let i = 0; i < peaks; i++) {
    const h = rr(rnd, 1.6, 2.6) * S * (i === 1 ? 1.25 : 0.85);
    const r = rr(rnd, 0.7, 1.0) * S;
    put(g, gCone(), rock, [px, h * 0.5, rr(rnd, -0.3, 0.3) * S], [r, h, r * 0.9], [0, rnd() * TAU, 0]);
    // snow cap: a small bright cone seated on the summit
    put(g, gCone(), snow, [px, h * 0.86, 0], [r * 0.32, h * 0.3, r * 0.29], [0, rnd() * TAU, 0]);
    px += rr(rnd, 0.75, 1.15) * S;
  }
  put(g, vPebble(v), rockMat(t.stone, { flat: true }), [0.2 * S, 0.22 * S, 0.4 * S], [0.9 * S, 0.34 * S, 0.7 * S]);
};

const BUILDERS: Record<PropKind, Build> = {
  pineTree: buildPineTree,
  leafTree: buildLeafTree,
  mountain: buildMountain,
  spire: buildSpire,
  arch: buildArch,
  boulder: buildBoulder,
  crystalCluster: buildCrystalCluster,
  flora: buildFlora,
  monolith: buildMonolith,
  mushroomTree: buildMushroomTree,
  iceShelf: buildIceShelf,
  vent: buildVent,
  ruinPillar: buildRuinPillar,
  floatingIsle: buildFloatingIsle,
  duneRipple: buildDuneRipple,
  lightPod: buildLightPod,
  bannerStone: buildBannerStone,
};

/** Build one prop. `scale` multiplies overall size; `seed` (0..1) varies the
 *  silhouette deterministically so repeated props do not look cloned. */
export function makeProp(kind: PropKind, pal: Palette, scale = 1, seed = Math.random()): THREE.Group {
  const s = ((seed % 1) + 1) % 1;
  const rnd = mulberry(0.113 + s * 0.7717);
  const v = Math.min(3, Math.floor(s * 4));
  const g = new THREE.Group();
  (BUILDERS[kind] ?? buildBoulder)(g, tones(pal), rnd, v);
  // a small yaw keeps a scattered field from reading as stamped copies
  g.rotation.y = (rnd() - 0.5) * 0.55;
  g.scale.setScalar(scale);
  g.userData.prop = kind;
  freeze(g);
  return g;
}

// ---------------------------------------------------------------------------
// per-planet prop mapping
// ---------------------------------------------------------------------------

interface PropSet { fg: PropKind[]; mid: PropKind[]; bg: PropKind[] }

// Each planet's mix is deliberately DISTINCT — bg lists share almost nothing,
// so no two worlds read as recolours of each other. Signatures: Mercury owns
// the stone arch, Venus the ruined pillars, Earth trees + snow mountains, Mars
// the strata spires and vents, Jupiter floating isles, Saturn/Uranus two
// different ice registers, Neptune monoliths in the deep.
const PLANET_PROPS: Record<string, PropSet> = {
  // cratered, rocky, quiet — the arch country
  mercury: { fg: ['duneRipple', 'boulder', 'crystalCluster', 'lightPod'], mid: ['arch', 'boulder', 'vent', 'bannerStone'], bg: ['arch', 'spire', 'boulder'] },
  // golden windswept plateaus — an ancient, wind-worn civilisation
  venus: { fg: ['duneRipple', 'boulder', 'lightPod', 'bannerStone'], mid: ['ruinPillar', 'monolith', 'duneRipple', 'bannerStone'], bg: ['monolith', 'ruinPillar', 'duneRipple'] },
  // green and alive — trees everywhere, snow mountains behind
  earth: { fg: ['flora', 'leafTree', 'boulder', 'lightPod'], mid: ['leafTree', 'pineTree', 'flora', 'mushroomTree'], bg: ['mountain', 'pineTree', 'mountain'] },
  // canyon / rust — strata needles and warm vents
  mars: { fg: ['boulder', 'duneRipple', 'vent', 'crystalCluster'], mid: ['spire', 'vent', 'boulder', 'lightPod'], bg: ['spire', 'monolith', 'spire'] },
  // gas-band cloudscape — a VERTICAL climb, so favour hovering forms
  jupiter: { fg: ['lightPod', 'crystalCluster', 'flora', 'floatingIsle'], mid: ['floatingIsle', 'lightPod', 'crystalCluster', 'bannerStone'], bg: ['floatingIsle', 'floatingIsle', 'monolith'] },
  // icy rings — flat sheets of ring-ice
  saturn: { fg: ['iceShelf', 'crystalCluster', 'lightPod', 'duneRipple'], mid: ['iceShelf', 'floatingIsle', 'iceShelf', 'bannerStone'], bg: ['iceShelf', 'crystalCluster', 'iceShelf'] },
  // tilted ice — also a VERTICAL climb; sharper crystal register than Saturn
  uranus: { fg: ['iceShelf', 'crystalCluster', 'lightPod'], mid: ['crystalCluster', 'floatingIsle', 'iceShelf', 'bannerStone'], bg: ['crystalCluster', 'iceShelf', 'spire'] },
  // deep-blue trenches — silent monoliths in the deep
  neptune: { fg: ['vent', 'flora', 'crystalCluster', 'lightPod'], mid: ['monolith', 'flora', 'vent', 'bannerStone'], bg: ['monolith', 'monolith', 'ruinPillar'] },
};

/** Sensible default for moon / bonus levels: plain rocky ground with light. */
const DEFAULT_PROPS: PropSet = {
  fg: ['boulder', 'duneRipple', 'crystalCluster', 'lightPod'],
  mid: ['spire', 'boulder', 'vent', 'bannerStone'],
  bg: ['spire', 'arch', 'monolith'],
};

/** Which props suit a planet, split by depth layer. `fg` = small detail placed
 *  near the play plane, `mid` = mid-distance silhouettes, `bg` = large far shapes. */
export function propsForPlanet(planetName: string): { fg: PropKind[]; mid: PropKind[]; bg: PropKind[] } {
  const set = PLANET_PROPS[planetName.trim().toLowerCase()] ?? DEFAULT_PROPS;
  return { fg: [...set.fg], mid: [...set.mid], bg: [...set.bg] };
}

// ---------------------------------------------------------------------------
// SKYLINE — the far background band
// ---------------------------------------------------------------------------

type Silhouette = 'peak' | 'dome' | 'arch' | 'crystal' | 'shelf' | 'tree' | 'isle' | 'mesa';
type Hero = 'arch' | 'moon' | 'ringedMoon' | 'crystal' | 'orb' | 'mesa';

interface SkyPlan { shapes: Silhouette[]; heroes: Hero[] }

const SKY_PLANS: Record<string, SkyPlan> = {
  mercury: { shapes: ['peak', 'dome', 'arch', 'mesa'], heroes: ['arch', 'moon'] },
  venus: { shapes: ['mesa', 'dome', 'arch'], heroes: ['moon', 'mesa'] },
  earth: { shapes: ['dome', 'tree', 'peak'], heroes: ['moon', 'arch'] },
  mars: { shapes: ['peak', 'mesa', 'arch'], heroes: ['arch', 'crystal'] },
  jupiter: { shapes: ['isle', 'dome', 'crystal'], heroes: ['orb', 'arch'] },
  saturn: { shapes: ['shelf', 'crystal', 'arch'], heroes: ['ringedMoon', 'crystal'] },
  uranus: { shapes: ['shelf', 'peak', 'crystal'], heroes: ['ringedMoon', 'crystal'] },
  neptune: { shapes: ['peak', 'crystal', 'mesa'], heroes: ['crystal', 'moon'] },
};
const DEFAULT_SKY: SkyPlan = { shapes: ['peak', 'dome', 'mesa'], heroes: ['arch', 'moon'] };

/** A whole ridge as ONE mesh: a smooth sum-of-sines profile closed at the
 *  bottom. ~1 triangle per sample, non-repeating across the full width. */
function ridge(width: number, height: number, mat: THREE.Material, rnd: () => number): THREE.Mesh {
  const step = 3.4;
  const n = Math.max(8, Math.ceil(width / step));
  const f1 = rr(rnd, 0.7, 1.3), f2 = rr(rnd, 2.1, 3.4), f3 = rr(rnd, 4.4, 6.6);
  const p1 = rnd() * TAU, p2 = rnd() * TAU, p3 = rnd() * TAU;
  const sh = new THREE.Shape();
  sh.moveTo(-width / 2, -height);
  for (let i = 0; i <= n; i++) {
    const u = i / n;
    const x = -width / 2 + u * width;
    const h = height * (0.5
      + 0.30 * Math.sin(u * TAU * f1 + p1)
      + 0.14 * Math.sin(u * TAU * f2 + p2)
      + 0.06 * Math.sin(u * TAU * f3 + p3));
    sh.lineTo(x, Math.max(height * 0.10, h));
  }
  sh.lineTo(width / 2, -height);
  sh.closePath();
  return new THREE.Mesh(new THREE.ShapeGeometry(sh), mat);
}

/** One cheap far-background silhouette, base at y=0. All < 90 triangles. */
function silhouette(kind: Silhouette, mat: THREE.Material, accent: THREE.Material, h: number, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'peak') {
    put(g, gCone(), mat, [0, h * 0.5, 0], [h * rr(rnd, 0.3, 0.5), h, h * 0.4]);
    put(g, gCone(), mat, [h * rr(rnd, -0.55, 0.55), h * 0.28, 0.4], [h * 0.3, h * 0.56, h * 0.26]);
  } else if (kind === 'dome') {
    put(g, vDome(0), mat, [0, 0, 0], [h * rr(rnd, 1.1, 1.7), h, h * 0.8]);
    put(g, vDome(1), mat, [h * rr(rnd, -1.2, 1.2), 0, 0.5], [h * 0.9, h * 0.6, h * 0.6]);
  } else if (kind === 'mesa') {
    put(g, gTube(), mat, [0, h * 0.45, 0], [h * rr(rnd, 0.9, 1.5), h * 0.9, h * 0.7], [0, rnd(), 0]);
    put(g, vDome(2), mat, [h * rr(rnd, -1.4, 1.4), 0, 0.4], [h * 0.8, h * 0.45, h * 0.5]);
  } else if (kind === 'arch') {
    const span = h * 0.55;
    put(g, gArch(), mat, [0, h * 0.45, 0], [span, h * 0.5, span * 0.7]);
    for (const s of [-1, 1] as const) put(g, gTube(), mat, [s * span, h * 0.22, 0], [span * 0.22, h * 0.46, span * 0.2]);
  } else if (kind === 'crystal') {
    for (let i = 0; i < 3; i++) {
      put(g, vShard(i), i === 1 ? accent : mat, [h * rr(rnd, -0.4, 0.4), h * rr(rnd, 0.3, 0.5), 0],
        [h * 0.14, h * rr(rnd, 0.6, 1.0), h * 0.13], [0, 0, rr(rnd, -0.2, 0.2)]);
    }
  } else if (kind === 'shelf') {
    let y = 0;
    for (let i = 0; i < 3; i++) {
      const hh = h * rr(rnd, 0.2, 0.34);
      put(g, vSlab(i), i === 1 ? accent : mat, [h * rr(rnd, -0.2, 0.2), y + hh * 0.5, 0], [h * rr(rnd, 0.6, 1.0), hh, h * 0.55], [0, rnd(), 0]);
      y += hh * 0.9;
    }
  } else if (kind === 'tree') {
    put(g, gTube(), mat, [0, h * 0.3, 0], [h * 0.1, h * 0.6, h * 0.1]);
    put(g, gCap(), mat, [0, h * 0.58, 0], [h * 0.5, h * 0.42, h * 0.4]);
  } else { // isle
    put(g, vSlab(0), mat, [0, h * 0.8, 0], [h * 0.6, h * 0.18, h * 0.5], [0, rnd(), 0]);
    put(g, gCone(), mat, [0, h * 0.5, 0], [h * 0.5, h * 0.55, h * 0.4], [Math.PI, 0, 0]);
    put(g, vShard(1), accent, [0, h * 0.3, 0], [h * 0.09, h * 0.3, h * 0.09], [Math.PI, 0, 0]);
  }
  return g;
}

/** One large hero landmark for the far band. All < 150 triangles. */
function heroShape(kind: Hero, mat: THREE.Material, accent: THREE.Material, glow: THREE.Material, S: number, rnd: () => number): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'arch') {
    const span = S * rr(rnd, 0.9, 1.2);
    put(g, gArch(), mat, [0, S * 0.55, 0], [span, S * rr(rnd, 0.8, 1.1), span * 0.5]);
    for (const s of [-1, 1] as const) put(g, gTube(), mat, [s * span, S * 0.28, 0], [span * 0.17, S * 0.56, span * 0.15]);
    put(g, vShard(2), accent, [0, S * 1.25, 0], [S * 0.08, S * 0.22, S * 0.08]);
  } else if (kind === 'moon' || kind === 'ringedMoon') {
    const r = S * rr(rnd, 0.55, 0.8);
    put(g, gDiscBig(), accent, [0, 0, 0], [r, r, 1]);
    // a couple of small maria — barely-there tone shifts, never a face
    const maria = new THREE.MeshBasicMaterial({ color: (accent as THREE.MeshBasicMaterial).color.clone().multiplyScalar(0.93) });
    for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU, d = rr(rnd, 0.3, 0.6) * r;
      put(g, gDisc(), maria, [Math.cos(a) * d, Math.sin(a) * d, 0.02], [r * rr(rnd, 0.1, 0.2), r * rr(rnd, 0.08, 0.16), 1]);
    }
    put(g, gPlane(), glow, [0, 0, -0.05], [r * 4.0, r * 4.0, 1]);
    if (kind === 'ringedMoon') {
      const ring = new THREE.Mesh(sharedGeo('prop:skyRing', () => new THREE.RingGeometry(1.35, 1.95, 26)), accent);
      ring.scale.set(r, r, 1);
      ring.rotation.set(rr(rnd, 1.05, 1.32), 0, rr(rnd, -0.35, 0.35));
      ring.position.z = -0.02;
      g.add(ring);
    }
  } else if (kind === 'crystal') {
    for (let i = 0; i < 3; i++) {
      const hh = S * rr(rnd, 0.9, 1.7);
      put(g, vShard(i), i === 1 ? accent : mat, [S * rr(rnd, -0.5, 0.5), hh * 0.5, 0], [S * rr(rnd, 0.1, 0.18), hh, S * 0.13],
        [0, 0, rr(rnd, -0.16, 0.16)]);
    }
    put(g, gPlane(), glow, [0, S * 0.8, -0.1], [S * 3.0, S * 3.4, 1]);
  } else if (kind === 'orb') {
    const r = S * rr(rnd, 0.9, 1.25);
    put(g, gDiscBig(), accent, [0, 0, 0], [r, r, 1]);
    for (let i = 0; i < 3; i++) {
      const y = (i - 1) * r * 0.4;
      put(g, gPlane(), mat, [0, y, 0.02], [r * 2 * Math.sqrt(Math.max(0.05, 1 - (y / r) ** 2)) * 0.94, r * rr(rnd, 0.1, 0.17), 1]);
    }
    put(g, gPlane(), glow, [0, 0, -0.05], [r * 3.2, r * 3.2, 1]);
  } else { // mesa
    put(g, gTube(), mat, [0, S * 0.5, 0], [S * rr(rnd, 1.0, 1.5), S, S * 0.8], [0, rnd(), 0]);
    put(g, vDome(3), mat, [S * rr(rnd, -1.5, 1.5), 0, 0.4], [S * 0.9, S * 0.5, S * 0.6]);
    put(g, vShard(3), accent, [S * rr(rnd, -0.4, 0.4), S * 1.05, 0], [S * 0.07, S * 0.22, S * 0.07]);
  }
  return g;
}

/** Bake a pile of background meshes down to ONE mesh per material. The skyline
 *  is built as ~30 little pieces for authoring convenience and then collapsed to
 *  ~5 draw calls — the whole background costs about as much as one prop. */
function bake(src: THREE.Object3D[]): THREE.Mesh[] {
  const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
  for (const root of src) {
    root.updateMatrixWorld(true);
    root.traverse(n => {
      const m = n as THREE.Mesh;
      if (!m.isMesh) return;
      // clone/expand first: never mutate a shared cached geometry
      const geo = m.geometry.index ? m.geometry.toNonIndexed() : m.geometry.clone();
      geo.applyMatrix4(m.matrixWorld);
      const mat = m.material as THREE.Material;
      const list = byMat.get(mat);
      if (list) list.push(geo); else byMat.set(mat, [geo]);
    });
  }
  const out: THREE.Mesh[] = [];
  byMat.forEach((geos, mat) => {
    const merged = geos.length === 1 ? geos[0]! : mergeGeometries(geos, false);
    if (!merged) { // attribute mismatch — keep the pieces rather than lose them
      geos.forEach(gg => out.push(new THREE.Mesh(gg, mat)));
      return;
    }
    if (merged !== geos[0]) geos.forEach(gg => gg.dispose());
    out.push(new THREE.Mesh(merged, mat));
  });
  return out;
}

/** A far background skyline band: one wide Group of layered silhouettes, already
 *  positioned around x=0, meant to be dropped into the parallax group.
 *  `width` is the world width to cover.
 *
 *  THREE depth layers (+ heroes), each tinted further toward the sky colour so
 *  it reads as atmospheric distance, and each unlit/opaque so it is nearly free:
 *    z=-54  distant mountain / dune ridge   (~45 tris)
 *    z=-50/-44  hero landmarks (giant arch / ringed moon / colossal crystal)
 *    z=-46  second ridge
 *    z=-34  near band: ridge + 5-9 large silhouettes, each < 150 tris
 *  Authored as ~30 pieces, then baked to ~5 meshes / ~1000 triangles total. */
export function makeSkyline(planetName: string, pal: Palette, width: number): THREE.Group {
  const g = new THREE.Group();
  const parts: THREE.Object3D[] = [];
  const t = tones(pal);
  const key = planetName.trim().toLowerCase();
  const plan = SKY_PLANS[key] ?? DEFAULT_SKY;
  const rnd = mulberry(0.29 + hashName(key) * 0.61);
  const sky = pal.sky1;

  // atmospheric tints: further back = closer to the sky colour
  const mk = (c: number, k: number): THREE.MeshBasicMaterial => new THREE.MeshBasicMaterial({ color: mix(c, sky, k) });
  const farMat = mk(t.stoneDeep, 0.62);
  const midMat = mk(t.stone, 0.46);
  const nearMat = mk(t.stone, 0.26);
  const nearAccent = mk(t.gem, 0.34);
  const moonMat = mk(pal.light, 0.34);
  // radial falloff — a plain additive quad would read as a hard bright rectangle
  const heroGlow = new THREE.MeshBasicMaterial({
    color: t.glow, transparent: true, opacity: 0.30, depthWrite: false,
    map: radialTex(), blending: THREE.AdditiveBlending, fog: false,
  });

  // --- layer 1: distant ridge -------------------------------------------
  const r1 = ridge(width * 1.35, 15, farMat, rnd);
  r1.position.set(0, GROUND_Y - 3.0, -54);
  parts.push(r1);

  // --- layer 2: second ridge + hero landmarks ----------------------------
  const r2 = ridge(width * 1.18, 10, midMat, rnd);
  r2.position.set(0, GROUND_Y - 2.2, -46);
  parts.push(r2);

  const heroes = plan.heroes;
  for (let i = 0; i < heroes.length; i++) {
    const kind = heroes[i]!;
    const inSky = kind === 'moon' || kind === 'ringedMoon' || kind === 'orb';
    const h = heroShape(kind, midMat, inSky ? moonMat : midMat, heroGlow, inSky ? rr(rnd, 3.6, 5.2) : rr(rnd, 5.0, 7.5), rnd);
    h.position.set(
      (i === 0 ? -1 : 1) * width * rr(rnd, 0.12, 0.30),
      inSky ? GROUND_Y + rr(rnd, 13, 19) : GROUND_Y - rr(rnd, 0.5, 1.8),
      inSky ? -50 : -44,
    );
    parts.push(h);
  }

  // --- layer 3: near band ridge + discrete silhouettes --------------------
  const r3 = ridge(width * 1.05, 7.5, nearMat, rnd);
  r3.position.set(0, GROUND_Y - 2.0, -34);
  parts.push(r3);

  const shapes = plan.shapes;
  const count = Math.max(5, Math.min(9, Math.round(width / 24)));
  for (let i = 0; i < count; i++) {
    // even spread with a big seeded jitter so panning never shows a rhythm
    const u = (i + 0.5) / count + rr(rnd, -0.34, 0.34) / count;
    const kind = shapes[Math.floor(rnd() * shapes.length)]!;
    const s = silhouette(kind, nearMat, nearAccent, rr(rnd, 3.6, 7.6), rnd);
    s.position.set((u - 0.5) * width * 1.05, GROUND_Y - rr(rnd, 1.2, 2.4), -33 + rr(rnd, -2.5, 2.5));
    s.rotation.y = rr(rnd, -0.4, 0.4);
    parts.push(s);
  }

  // collapse ~30 authored pieces into ~5 draw calls
  bake(parts).forEach(m => { m.matrixAutoUpdate = false; g.add(m); });
  g.userData.skyline = true;
  return g;
}

// ---------------------------------------------------------------------------
// SKY SIGNATURE — the one unmistakable thing in each planet's sky
// ---------------------------------------------------------------------------
//
// The skyline gives each world a horizon; this gives each world an IDENTITY
// you can name from a single glance: Mercury's huge close sun, Venus's haze
// bands, Earth's cumulus clouds and little sun, Mars's two potato moons,
// Jupiter's gas bands and calm pale storm, Saturn's great ring arcing across
// the whole sky, Uranus's aurora ribbons and vertical ring, Neptune's deep
// slow storm spot. All unlit, all static or near-static, all cheap.

function flat(color: number, opacity: number): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, depthWrite: false, fog: false });
  return m;
}

export function makeSkyFeature(planetName: string, pal: Palette): THREE.Group {
  const g = new THREE.Group();
  const rnd = mulberry(0.4242);
  const name = planetName.trim().toLowerCase();

  if (name === 'mercury') {
    // the Sun, enormous and close — asleep, so soft and warm, never glaring
    put(g, gDiscBig(), flat(mix(0xffd9a0, pal.sky1, 0.25), 0.9), [26, 10, -2], [11, 11, 1]);
    put(g, gPlane(), glowMat(0xffca88, 0.5, true), [26, 10, -2.5], [40, 40, 1]);
    put(g, gPlane(), glowMat(0xffb46a, 0.25, true), [26, 10, -3], [70, 70, 1]);
  } else if (name === 'venus') {
    // stacked golden haze bands lying across the whole sky
    for (let i = 0; i < 4; i++) {
      const y = 6 + i * 5 + rnd() * 2;
      put(g, gPlane(), glowMat(mix(0xffe2a0, pal.sky1, 0.3 + i * 0.15), 0.10 + (3 - i) * 0.025), [rnd() * 30 - 15, y, -1 - i], [90 + i * 30, 2.2 + i * 1.1, 1]);
    }
  } else if (name === 'earth') {
    // a small warm sun + drifting cumulus clouds
    put(g, gDiscBig(), flat(0xfff2c8, 0.95), [-30, 17, -2], [2.6, 2.6, 1]);
    put(g, gPlane(), glowMat(0xfff0b8, 0.4, true), [-30, 17, -2.5], [14, 14, 1]);
    const cloud = flat(0xffffff, 0.92);
    const shadow = flat(mix(0xdfe8f2, pal.sky1, 0.3), 0.9);
    for (let c = 0; c < 4; c++) {
      const cx = -46 + c * 30 + rnd() * 12, cy = 10 + rnd() * 7, cs = 1.6 + rnd() * 1.6;
      const cl = new THREE.Group();
      put(cl, gBlob(), shadow, [0, -0.3 * cs, 0], [2.6 * cs, 0.8 * cs, 1.4 * cs]);
      put(cl, gBlob(), cloud, [-0.9 * cs, 0, 0.1], [1.3 * cs, 0.9 * cs, 1.2 * cs]);
      put(cl, gBlob(), cloud, [0.4 * cs, 0.25 * cs, 0], [1.5 * cs, 1.05 * cs, 1.3 * cs]);
      put(cl, gBlob(), cloud, [1.3 * cs, -0.1 * cs, 0.1], [1.1 * cs, 0.75 * cs, 1.1 * cs]);
      cl.position.set(cx, cy, -3 - c * 0.7);
      g.add(cl);
    }
  } else if (name === 'mars') {
    // two little potato moons, one dusty band
    put(g, vPebble(1), rockMat(desat(mix(pal.light, 0xcfae90, 0.5), 0.3), { flat: true }), [-22, 16, -2], [1.7, 1.35, 1.5], [0.4, 0.8, 0.2]);
    put(g, vPebble(2), rockMat(desat(mix(pal.ground, 0xa98168, 0.5), 0.3), { flat: true }), [18, 20, -3], [1.0, 0.8, 0.9], [0.2, 0.3, 0.5]);
    put(g, gPlane(), glowMat(mix(0xe8b48a, pal.sky1, 0.4), 0.10), [0, 7, -4], [120, 3.4, 1]);
  } else if (name === 'jupiter') {
    // broad horizontal gas bands + the great calm storm (a soft peach oval)
    const bandTones = [mix(pal.sky1, 0xf2d9b8, 0.5), mix(pal.ground, pal.sky0, 0.4), mix(pal.sky1, 0xd9a978, 0.45), mix(pal.hill, pal.sky1, 0.5)];
    for (let i = 0; i < 4; i++) {
      put(g, gPlane(), flat(bandTones[i]!, 0.30), [rnd() * 20 - 10, 6 + i * 12, -4 - i * 0.5], [140, 4.2 + rnd() * 2.4, 1]);
    }
    put(g, gDiscBig(), flat(mix(0xf0b08a, pal.sky1, 0.35), 0.5), [16, 24, -3.6], [5.2, 3.1, 1]);
    put(g, gRingThin(), flat(0xfae8d2, 0.4), [16, 24, -3.5], [6.2, 3.7, 1]);
  } else if (name === 'saturn') {
    // THE ring — a giant pale-gold band sweeping across the entire sky
    const ring = new THREE.Group();
    put(ring, gRingThin(), flat(0xf0ddae, 0.55), [0, 0, 0], [56, 56, 1]);
    put(ring, gRingThin(), flat(0xfff3d6, 0.38), [0, 0, 0], [50, 50, 1]);
    put(ring, gRingThin(), flat(0xe8cf9a, 0.30), [0, 0, 0], [61.5, 61.5, 1]);
    put(ring, gRingThin(), glowMat(0xffe9b8, 0.14), [0, 0, -0.5], [58, 58, 1]);
    ring.position.set(10, -30, -6);
    ring.rotation.z = -0.34;
    g.add(ring);
  } else if (name === 'uranus') {
    // aurora ribbons + the sideways ring (Uranus rolls on its side)
    for (let i = 0; i < 3; i++) {
      const rib = put(g, vBanner(i % 4), glowMat(i === 1 ? 0xa8ffd8 : 0x9fe8ff, 0.12), [-14 + i * 13 + rnd() * 5, 30 + rnd() * 10, -5 - i], [7 + rnd() * 4, 18 + rnd() * 8, 1]);
      rib.rotation.z = (rnd() - 0.5) * 0.3;
    }
    const vring = new THREE.Group();
    put(vring, gRingThin(), flat(0xd6f4f8, 0.4), [0, 0, 0], [24, 24, 1]);
    put(vring, gRingThin(), flat(0xeafcff, 0.25), [0, 0, 0], [20, 20, 1]);
    put(vring, gRingThin(), glowMat(0xbfeef4, 0.14), [0, 0, -0.5], [27, 27, 1]);
    vring.position.set(-16, 26, -8);
    vring.rotation.z = Math.PI * 0.46; // near-vertical: the rolled-over planet's ring
    vring.scale.x = 0.32;
    g.add(vring);
  } else if (name === 'neptune') {
    // the great dark spot — a deep slow storm with pale wisp arcs
    put(g, gDiscBig(), flat(mix(pal.sky0, 0x101c4a, 0.6), 0.55), [14, 18, -3], [5.4, 3.4, 1]);
    put(g, gDiscBig(), flat(mix(pal.sky0, 0x1a2a60, 0.5), 0.5), [14.6, 18.3, -2.9], [3.4, 2.0, 1]);
    put(g, gRingThin(), flat(0xdfe8ff, 0.22), [14, 18, -2.8], [6.6, 4.0, 1]);
    // high wind streaks
    for (let i = 0; i < 3; i++) {
      put(g, gPlane(), glowMat(0xcadcff, 0.10), [rnd() * 40 - 20, 9 + i * 8, -4], [60 + rnd() * 40, 0.7, 1]);
    }
  } else {
    // moons / unknown: a distant blue home dot — you can see where you began
    put(g, gDiscBig(), flat(0x9fc4ff, 0.85), [20, 18, -3], [1.1, 1.1, 1]);
    put(g, gPlane(), glowMat(0x9fc4ff, 0.3, true), [20, 18, -3.5], [6, 6, 1]);
  }
  freeze(g);
  return g;
}
