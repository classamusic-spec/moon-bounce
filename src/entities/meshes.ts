import * as THREE from 'three';
import { CHAR_R } from '../core/constants';
import type { HatKind } from '../data/cosmetics';

// All procedural mesh factories. Ported verbatim from the prototype.
// Each returns a fresh Object3D; callers add it to a scene and position it.

export function makeCharacter(): THREE.Group {
  const char = new THREE.Group();
  const bodyMat = new THREE.MeshStandardMaterial({ color: 0xa8e0ff, roughness: 0.35, emissive: 0x223344, emissiveIntensity: 0.25 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(CHAR_R, 40, 32), bodyMat);
  body.scale.set(1, 0.92, 1); char.add(body); char.userData.body = body; char.userData.bodyMat = bodyMat;
  const visor = new THREE.Mesh(new THREE.SphereGeometry(0.46, 32, 24, 0, Math.PI * 2, 0, Math.PI * 0.62), new THREE.MeshStandardMaterial({ color: 0x16243a, roughness: 0.1, metalness: 0.3, emissive: 0x0a1830, emissiveIntensity: 0.4 }));
  visor.position.set(0, 0.1, 0.42); visor.rotation.x = 0.3; char.add(visor);
  const eyeMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.5 });
  const pup = new THREE.MeshStandardMaterial({ color: 0x223044 });
  [-0.15, 0.15].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.1, 20, 16), eyeMat); e.position.set(x, 0.15, 0.78); char.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(0.05, 16, 12), pup); p.position.set(x, 0.13, 0.85); char.add(p); });
  const smile = new THREE.Mesh(new THREE.TorusGeometry(0.13, 0.03, 12, 24, Math.PI), new THREE.MeshStandardMaterial({ color: 0x223044 }));
  smile.position.set(0, -0.02, 0.78); smile.rotation.z = Math.PI; char.add(smile);
  // Antenna + bulb live in a group so a hat can hide them when worn.
  const antenna = new THREE.Group();
  const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.3, 8), new THREE.MeshStandardMaterial({ color: 0xcccccc }));
  ant.position.set(0, 0.8, 0); antenna.add(ant);
  const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.09, 16, 12), new THREE.MeshStandardMaterial({ color: 0xff7a7a, emissive: 0xff4444, emissiveIntensity: 0.8 }));
  bulb.position.set(0, 0.97, 0); antenna.add(bulb);
  char.add(antenna); char.userData.antenna = antenna; char.userData.bulb = bulb;
  // Holder for the equipped hat (filled by applyBlobCosmetics).
  const hatHolder = new THREE.Group(); hatHolder.position.set(0, 0.5, 0.05); char.add(hatHolder); char.userData.hatHolder = hatHolder;
  return char;
}

function disposeObject(o: THREE.Object3D): void {
  o.traverse(n => {
    const m = n as THREE.Mesh;
    if (m.geometry) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach(x => x.dispose()); else if (mat) mat.dispose();
  });
}

// Build a hat sized to sit on the head (base at local y=0, facing +z).
export function makeHat(kind: HatKind): THREE.Group {
  const g = new THREE.Group();
  if (kind === 'party') {
    const cone = new THREE.Mesh(new THREE.ConeGeometry(0.3, 0.58, 18), new THREE.MeshStandardMaterial({ color: 0xff6fae, roughness: 0.5 }));
    cone.position.y = 0.29; g.add(cone);
    const pom = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), new THREE.MeshStandardMaterial({ color: 0xfff0a0, emissive: 0xffd34d, emissiveIntensity: 0.4 }));
    pom.position.y = 0.6; g.add(pom);
  } else if (kind === 'bow') {
    const mat = new THREE.MeshStandardMaterial({ color: 0xff7aa8, roughness: 0.5, emissive: 0x551133, emissiveIntensity: 0.15 });
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 10), mat); knot.position.y = 0.12; g.add(knot);
    [-1, 1].forEach(s => { const w = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.26, 10), mat); w.position.set(s * 0.2, 0.12, 0); w.rotation.z = s * Math.PI / 2; g.add(w); });
  } else if (kind === 'cap') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x5a8fff, roughness: 0.5 });
    const dome = new THREE.Mesh(new THREE.SphereGeometry(0.36, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), mat); dome.position.y = 0.06; g.add(dome);
    const brim = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.06, 0.34), mat); brim.position.set(0, 0.06, 0.34); g.add(brim);
  } else if (kind === 'crown') {
    const mat = new THREE.MeshStandardMaterial({ color: 0xffd34d, metalness: 0.5, roughness: 0.3, emissive: 0x6a4a00, emissiveIntensity: 0.25 });
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.22, 16, 1, true), mat); band.position.y = 0.16; g.add(band);
    for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; const spike = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 8), mat); spike.position.set(Math.cos(a) * 0.32, 0.32, Math.sin(a) * 0.32); g.add(spike); }
  } else if (kind === 'tophat') {
    const mat = new THREE.MeshStandardMaterial({ color: 0x2a2a3a, roughness: 0.4 });
    const brim = new THREE.Mesh(new THREE.CylinderGeometry(0.44, 0.44, 0.06, 24), mat); brim.position.y = 0.03; g.add(brim);
    const top = new THREE.Mesh(new THREE.CylinderGeometry(0.27, 0.27, 0.5, 24), mat); top.position.y = 0.3; g.add(top);
    const band = new THREE.Mesh(new THREE.CylinderGeometry(0.275, 0.275, 0.1, 24), new THREE.MeshStandardMaterial({ color: 0xff6fae, roughness: 0.5 })); band.position.y = 0.12; g.add(band);
  }
  return g;
}

// Apply the equipped color + hat to a character built by makeCharacter().
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

export function makeStarMesh(scale: number, sun: boolean): THREE.Mesh {
  const shape = new THREE.Shape(); const sp = 5, o = 0.3 * scale, inr = 0.13 * scale;
  for (let i = 0; i < sp * 2; i++) { const r = i % 2 === 0 ? o : inr; const a = (i / (sp * 2)) * Math.PI * 2 - Math.PI / 2; const x = Math.cos(a) * r, y = Math.sin(a) * r; i === 0 ? shape.moveTo(x, y) : shape.lineTo(x, y); }
  const geo = new THREE.ExtrudeGeometry(shape, { depth: 0.1 * scale, bevelEnabled: true, bevelThickness: 0.03, bevelSize: 0.03, bevelSegments: 2 }); geo.center();
  const mat = new THREE.MeshStandardMaterial({ color: sun ? 0xfff0a0 : 0xffe082, emissive: sun ? 0xffb300 : 0xffc94d, emissiveIntensity: sun ? 1.1 : 0.7, roughness: 0.25 });
  return new THREE.Mesh(geo, mat);
}

export function makeFactBox(): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffc861, roughness: 0.4, emissive: 0xff9d22, emissiveIntensity: 0.45, metalness: 0.1 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); g.add(cube); g.userData.cube = cube; g.userData.mat = mat;
  const qMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff2c0, emissiveIntensity: 0.5 });
  [0.51, -0.51].forEach(z => { const hook = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.05, 10, 16, Math.PI * 1.4), qMat); hook.position.set(0, 0.08, z); g.add(hook); const stem = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.14, 8), qMat); stem.position.set(0.02, -0.12, z); g.add(stem); const dot = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), qMat); dot.position.set(0.02, -0.26, z); g.add(dot); });
  return g;
}

export function makeEnemy(color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.45 });
  const body = new THREE.Mesh(new THREE.SphereGeometry(0.5, 28, 22), mat); body.scale.set(1, 0.8, 1); g.add(body); g.userData.body = body; g.userData.mat = mat;
  const fmat = new THREE.MeshStandardMaterial({ color: 0x333344 });
  [-0.22, 0.22].forEach(x => { const f = new THREE.Mesh(new THREE.SphereGeometry(0.14, 14, 10), fmat); f.position.set(x, -0.42, 0); f.scale.set(1, 0.6, 1.2); g.add(f); });
  const ew = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.3 });
  const ep = new THREE.MeshStandardMaterial({ color: 0x222233 });
  [-0.16, 0.16].forEach(x => { const e = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), ew); e.position.set(x, 0.12, 0.4); g.add(e); const p = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 10), ep); p.position.set(x, 0.1, 0.52); g.add(p); });
  [-0.12, 0.12].forEach(x => { const a = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), fmat); a.position.set(x, 0.5, 0); a.rotation.z = x * 0.6; g.add(a); const b = new THREE.Mesh(new THREE.SphereGeometry(0.06, 10, 8), new THREE.MeshStandardMaterial({ color: 0xff8a8a, emissive: 0xff5a5a, emissiveIntensity: 0.6 })); b.position.set(x * 1.6, 0.62, 0); g.add(b); });
  return g;
}

export function makeCloud(tint?: number): THREE.Group {
  const g = new THREE.Group();
  const m = new THREE.MeshStandardMaterial({ color: tint || 0xffffff, roughness: 0.9, transparent: true, opacity: 0.92, emissive: 0x223344, emissiveIntensity: 0.05 });
  ([[-0.9, 0, 0.8], [0, 0.15, 1.0], [0.9, 0, 0.85], [0.4, -0.1, 0.7], [-0.4, -0.05, 0.75]] as [number, number, number][]).forEach(p => { const puff = new THREE.Mesh(new THREE.SphereGeometry(p[2], 16, 12), m); puff.position.set(p[0], p[1], 0); puff.scale.y = 0.7; g.add(puff); });
  return g;
}

export function makeBird(): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0x445566 });
  const l = new THREE.Mesh(new THREE.ConeGeometry(0.18, 0.5, 4), m); l.rotation.z = Math.PI / 2.4; l.position.x = -0.18; g.add(l);
  const r = l.clone(); r.rotation.z = -Math.PI / 2.4; r.position.x = 0.18; g.add(r);
  return g;
}

export function makeRock(): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0x9c4a2e, roughness: 1, flatShading: true });
  const rock = new THREE.Mesh(new THREE.DodecahedronGeometry(0.45, 0), m); g.add(rock); g.userData.rock = rock; return g;
}

export function makeGeyser(): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.85, 0.5, 16), new THREE.MeshStandardMaterial({ color: 0xa87f4e, roughness: 0.9 })); g.add(base);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.5, 1.4, 12), new THREE.MeshStandardMaterial({ color: 0xffe6bf, transparent: true, opacity: 0.45, emissive: 0xffcf66, emissiveIntensity: 0.4 })); jet.position.y = 0.9; g.add(jet); g.userData.jet = jet;
  return g;
}

export function makeIceChunk(): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xeaf6ff, roughness: 0.2, metalness: 0.1, transparent: true, opacity: 0.85, emissive: 0x88bbdd, emissiveIntensity: 0.25 });
  const ice = new THREE.Mesh(new THREE.IcosahedronGeometry(1.1, 0), m); ice.scale.set(1.3, 0.5, 1.0); g.add(ice); return g;
}

export function makeBubble(): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0xbcd0ff, roughness: 0.1, metalness: 0.2, transparent: true, opacity: 0.4, emissive: 0x6688cc, emissiveIntensity: 0.3 });
  const b = new THREE.Mesh(new THREE.SphereGeometry(0.7, 20, 16), m); g.add(b); g.userData.b = b; return g;
}

export function makeFlare(): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.IcosahedronGeometry(0.42, 0), new THREE.MeshStandardMaterial({ color: 0xffd27f, emissive: 0xff8a2a, emissiveIntensity: 0.9, roughness: 0.4, flatShading: true })); g.add(core); g.userData.rock = core;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.6, 16, 12), new THREE.MeshBasicMaterial({ color: 0xffaa44, transparent: true, opacity: 0.25 })); g.add(glow);
  return g;
}

// A special, glowing box that grants the level's elemental power.
export function makePowerBox(tint: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.3, metalness: 0.2, emissive: tint, emissiveIntensity: 0.6 });
  const cube = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat); cube.rotation.y = Math.PI / 4; g.add(cube); g.userData.cube = cube; g.userData.mat = mat;
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.95, 18, 14), new THREE.MeshBasicMaterial({ color: tint, transparent: true, opacity: 0.18 })); g.add(glow);
  // a little spark/star icon floating in the middle of each face
  const sparkMat = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xffffff, emissiveIntensity: 0.8 });
  const spark = new THREE.Mesh(new THREE.IcosahedronGeometry(0.18, 0), sparkMat); spark.position.set(0, 0, 0.55); g.add(spark);
  const spark2 = spark.clone(); spark2.position.set(0, 0, -0.55); g.add(spark2);
  return g;
}

// A soft glowing puff projectile (warm = flame, cool = ice, etc.).
export function makePuff(color: number): THREE.Group {
  const g = new THREE.Group();
  const core = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.95 })); g.add(g.userData.core = core);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(0.42, 14, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.3 })); g.add(glow);
  return g;
}

// A soft cushion that sits below a gap and bounces the blob back up (no fail).
export function makeGapCushion(width: number, color: number): THREE.Group {
  const g = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color, roughness: 0.85, emissive: color, emissiveIntensity: 0.12 });
  const mound = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 14, 0, Math.PI * 2, 0, Math.PI * 0.5), mat);
  mound.scale.set(width / 2 + 0.6, 0.5, 1.4); g.add(mound);
  const glow = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 10, 0, Math.PI * 2, 0, Math.PI * 0.5), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.12 }));
  glow.scale.set(width / 2 + 0.7, 0.55, 1.5); glow.position.y = 0.02; g.add(glow);
  return g;
}

// A freezable spout (water/vapor jet) that rises to `height`. Ice-puff it to
// freeze it into a solid platform.
export function makeSpout(height: number): THREE.Group {
  const g = new THREE.Group();
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.75, 0.4, 16), new THREE.MeshStandardMaterial({ color: 0x6a86b8, roughness: 0.8 }));
  base.position.y = 0.2; g.add(base);
  const jet = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.5, height, 14), new THREE.MeshStandardMaterial({ color: 0xbfe3ff, transparent: true, opacity: 0.5, emissive: 0x9fd0ff, emissiveIntensity: 0.35 }));
  jet.position.y = height / 2 + 0.2; g.add(jet); g.userData.jet = jet;
  return g;
}

// A solid, translucent platform that a spout/cloud becomes when puffed
// (tinted per element: ice = pale blue, bubble = blue, spark = warm).
export function makeSolidPlat(width: number, tint: number): THREE.Mesh {
  const m = new THREE.MeshStandardMaterial({ color: tint, roughness: 0.15, metalness: 0.2, transparent: true, opacity: 0.85, emissive: tint, emissiveIntensity: 0.25, flatShading: true });
  return new THREE.Mesh(new THREE.BoxGeometry(width, 0.5, 2.4), m);
}

export function makeBush(): THREE.Group {
  const g = new THREE.Group(); const m = new THREE.MeshStandardMaterial({ color: 0x4fae6d, roughness: 0.85, emissive: 0x224422, emissiveIntensity: 0.1 });
  ([[0, 0.1, 0.55], [-0.4, -0.05, 0.4], [0.4, -0.05, 0.4], [0, 0.32, 0.4]] as [number, number, number][]).forEach(p => { const leaf = new THREE.Mesh(new THREE.SphereGeometry(p[2], 14, 11), m); leaf.position.set(p[0], p[1], 0); leaf.scale.y = 0.8; g.add(leaf); });
  const fmat = new THREE.MeshStandardMaterial({ color: 0xff7aa8, emissive: 0xff5588, emissiveIntensity: 0.3 });
  ([[-0.3, 0.3], [0.3, 0.35], [0, 0.55]] as [number, number][]).forEach(p => { const fl = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), fmat); fl.position.set(p[0], p[1], 0.5); g.add(fl); });
  return g;
}
