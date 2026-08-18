import * as THREE from 'three';

// ---------- Shared material / texture / geometry library ----------
//
// AAA look on a strict budget: every surface in the game draws from a small set
// of MATERIAL ROLES (rock, organic, crystal, metal, glow, trim) so the world
// reads as one art direction instead of a pile of unrelated colors. Materials,
// textures and hot geometries are CACHED and shared, which keeps shader program
// count, draw calls and GPU memory low on the low-end phones this game targets.
//
// Everything here is procedural (canvas-generated) — the game ships as a single
// offline HTML file and makes no network requests.

// ---------- procedural textures (generated once, shared forever) ----------

const texCache = new Map<string, THREE.Texture>();

function canvasTex(key: string, size: number, draw: (ctx: CanvasRenderingContext2D, s: number) => void, repeat = 4): THREE.Texture {
  const hit = texCache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d')!;
  draw(ctx, size);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.needsUpdate = true;
  texCache.set(key, t);
  return t;
}

/** Soft fractal noise — used as a roughness/bump break-up so nothing looks like flat plastic. */
export function noiseTex(): THREE.Texture {
  return canvasTex('noise', 256, (ctx, s) => {
    const img = ctx.createImageData(s, s);
    // cheap value-noise: 3 octaves of smoothed random
    const oct = [4, 12, 40];
    const grids = oct.map(n => Array.from({ length: (n + 1) * (n + 1) }, () => Math.random()));
    const sample = (gi: number, n: number, x: number, y: number) => {
      const g = grids[gi]!;
      const fx = x * n, fy = y * n;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const at = (a: number, b: number) => g[Math.min(n, b) * (n + 1) + Math.min(n, a)]!;
      const a = at(x0, y0), b = at(x0 + 1, y0), c2 = at(x0, y0 + 1), d = at(x0 + 1, y0 + 1);
      return (a * (1 - sx) + b * sx) * (1 - sy) + (c2 * (1 - sx) + d * sx) * sy;
    };
    for (let y = 0; y < s; y++) {
      for (let x = 0; x < s; x++) {
        const u = x / s, v = y / s;
        let n = sample(0, oct[0]!, u, v) * 0.55 + sample(1, oct[1]!, u, v) * 0.30 + sample(2, oct[2]!, u, v) * 0.15;
        n = 110 + n * 145;
        const i = (y * s + x) * 4;
        img.data[i] = img.data[i + 1] = img.data[i + 2] = n; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  });
}

/** Sparse bright speckles — frost, mineral flecks, stardust in crystal. */
export function speckleTex(): THREE.Texture {
  return canvasTex('speckle', 256, (ctx, s) => {
    ctx.fillStyle = '#8a8a8a'; ctx.fillRect(0, 0, s, s);
    for (let i = 0; i < 260; i++) {
      const r = Math.random() * 1.9 + 0.4;
      ctx.globalAlpha = 0.25 + Math.random() * 0.7;
      ctx.fillStyle = Math.random() < 0.5 ? '#ffffff' : '#d8d8d8';
      ctx.beginPath(); ctx.arc(Math.random() * s, Math.random() * s, r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
  }, 3);
}

/** Fine horizontal strata — sedimentary rock, gas-giant banding, ice shelves. */
export function strataTex(): THREE.Texture {
  return canvasTex('strata', 128, (ctx, s) => {
    ctx.fillStyle = '#9a9a9a'; ctx.fillRect(0, 0, s, s);
    let y = 0;
    while (y < s) {
      const h = 2 + Math.random() * 9;
      const v = 130 + Math.random() * 90;
      ctx.fillStyle = `rgb(${v},${v},${v})`;
      ctx.fillRect(0, y, s, h);
      y += h;
    }
  }, 2);
}

/** A soft radial falloff — reused for contact shadows, glows and light cards. */
export function radialTex(): THREE.Texture {
  const hit = texCache.get('radial');
  if (hit) return hit;
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(64, 64, 0, 64, 64, 64);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.45, 'rgba(255,255,255,0.5)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  texCache.set('radial', t);
  return t;
}

// ---------- material roles ----------

const matCache = new Map<string, THREE.Material>();

function cached<T extends THREE.Material>(key: string, make: () => T): T {
  const hit = matCache.get(key);
  if (hit) return hit as T;
  const m = make();
  m.userData.shared = true; // never disposed by clearLevel — see disposeObject()
  matCache.set(key, m);
  return m;
}

export interface RockOpts { rough?: number; strata?: boolean; flat?: boolean; emissive?: number }

/** Matte mineral surface: terrain, boulders, cliffs, structural props. */
export function rockMat(color: number, o: RockOpts = {}): THREE.MeshStandardMaterial {
  const key = `rock|${color}|${o.rough ?? 1}|${o.strata ? 1 : 0}|${o.flat ? 1 : 0}|${o.emissive ?? 0}`;
  return cached(key, () => new THREE.MeshStandardMaterial({
    color, roughness: o.rough ?? 0.92, metalness: 0.02,
    map: o.strata ? strataTex() : noiseTex(),
    bumpMap: o.strata ? strataTex() : noiseTex(),
    bumpScale: o.strata ? 0.06 : 0.035,
    flatShading: !!o.flat,
    emissive: o.emissive ?? 0x000000,
    emissiveIntensity: o.emissive ? 0.25 : 0,
  }));
}

/** Soft living surface: flora, petals, creature skin. Slight sheen, no metal. */
export function organicMat(color: number, emissive = 0x000000, intensity = 0.18): THREE.MeshStandardMaterial {
  const key = `org|${color}|${emissive}|${intensity}`;
  return cached(key, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.55, metalness: 0.0,
    map: noiseTex(), bumpMap: noiseTex(), bumpScale: 0.012,
    emissive, emissiveIntensity: intensity,
  }));
}

/** Faceted translucent gem: collectibles, blooms, frozen bridges, goal shards. */
export function crystalMat(color: number, emissive?: number, opacity = 0.82): THREE.MeshStandardMaterial {
  const em = emissive ?? color;
  const key = `cry|${color}|${em}|${opacity}`;
  return cached(key, () => new THREE.MeshStandardMaterial({
    color, roughness: 0.14, metalness: 0.16,
    transparent: opacity < 1, opacity,
    emissive: em, emissiveIntensity: 0.55,
    map: speckleTex(),
    flatShading: true,
  }));
}

/** Polished trim: rings, bands, filaments, tech accents. */
export function metalMat(color: number, rough = 0.3): THREE.MeshStandardMaterial {
  const key = `met|${color}|${rough}`;
  return cached(key, () => new THREE.MeshStandardMaterial({
    color, roughness: rough, metalness: 0.75, map: noiseTex(), bumpScale: 0.01,
  }));
}

/** Unlit halo / aura / light card. Never receives lighting, always cheap. */
export function glowMat(color: number, opacity = 0.22, useRadial = false): THREE.MeshBasicMaterial {
  const key = `glow|${color}|${opacity}|${useRadial ? 1 : 0}`;
  return cached(key, () => new THREE.MeshBasicMaterial({
    color, transparent: true, opacity, depthWrite: false,
    map: useRadial ? radialTex() : null,
    blending: THREE.AdditiveBlending,
  }));
}

/** A bright authored signal part (beacon tips, eyes, energy cores). */
export function signalMat(color: number, intensity = 1.1): THREE.MeshStandardMaterial {
  const key = `sig|${color}|${intensity}`;
  return cached(key, () => new THREE.MeshStandardMaterial({
    color, emissive: color, emissiveIntensity: intensity, roughness: 0.3, metalness: 0.1,
  }));
}

/** Soft dark contact disc that grounds a hovering object (cheap fake shadow). */
export function contactShadow(radius: number): THREE.Mesh {
  const geo = sharedGeo('contact', () => new THREE.PlaneGeometry(1, 1));
  const m = new THREE.Mesh(geo, cached('contactMat', () => new THREE.MeshBasicMaterial({
    color: 0x000000, transparent: true, opacity: 0.22, depthWrite: false, map: radialTex(), blending: THREE.NormalBlending,
  })));
  m.rotation.x = -Math.PI / 2;
  m.scale.set(radius * 2, radius * 2, 1);
  m.userData.contact = true;
  return m;
}

// ---------- shared geometry cache ----------

const geoCache = new Map<string, THREE.BufferGeometry>();

/** Cache a geometry that many objects reuse (particles, contact discs, motes). */
export function sharedGeo<T extends THREE.BufferGeometry>(key: string, make: () => T): T {
  const hit = geoCache.get(key);
  if (hit) return hit as T;
  const g = make();
  g.userData.shared = true;
  geoCache.set(key, g);
  return g;
}

// ---------- disposal ----------

/** Free an object tree's GPU resources, SKIPPING shared cached ones.
 *  (Levels are rebuilt constantly; disposing a shared material would blank
 *  every other object using it.) */
export function disposeObject(o: THREE.Object3D): void {
  o.traverse(n => {
    const m = n as THREE.Mesh;
    if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    const kill = (x: THREE.Material) => { if (!x.userData.shared) x.dispose(); };
    if (Array.isArray(mat)) mat.forEach(kill); else if (mat) kill(mat);
  });
}

/** Per-planet colour roles, derived from the planet palette so every prop,
 *  creature and effect on a world shares one coherent set of hues. */
export interface Palette {
  ground: number; hill: number; sky0: number; sky1: number;
  accent: number; deep: number; light: number;
}

export function paletteFrom(ground: number, hill: number, sky0: number, sky1: number, accent: number): Palette {
  const c = new THREE.Color(hill);
  const deep = c.clone().multiplyScalar(0.55).getHex();
  const light = c.clone().lerp(new THREE.Color(0xffffff), 0.45).getHex();
  return { ground, hill, sky0, sky1, accent, deep, light };
}
