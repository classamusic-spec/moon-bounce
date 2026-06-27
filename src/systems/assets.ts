import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// ---------- Asset pipeline (Step 3 / Phase E) ----------
//
// A drop-in seam for swapping procedural meshes for real GLTF art with ZERO
// gameplay changes. The MANIFEST below is intentionally EMPTY: with no models
// declared, `preload()` resolves instantly and every `getModel()` returns null,
// so the mesh factories fall back to their hand-built shapes — the game is
// byte-for-byte the procedural prototype.
//
// To add art later: drop a GLTF url under MANIFEST.models keyed by the seam name
// the factory already asks for (e.g. 'bush', 'bird', 'cloud'). No other code
// changes — the factory clones the model instead of building procedurally, and
// the loading screen shows real progress while it downloads.

export interface AssetManifest {
  /** seam key → model url (relative to the app root, served as a static asset) */
  models: Record<string, string>;
}

// EMPTY by default → identical to the procedural prototype. Add entries to opt in.
export const MANIFEST: AssetManifest = {
  models: {},
};

export type ProgressFn = (loaded: number, total: number) => void;

export class AssetStore {
  private models = new Map<string, THREE.Object3D>();
  private loader = new GLTFLoader();
  loaded = false;

  /** Load every declared model. Resolves instantly when the manifest is empty.
   *  Never rejects: a broken/missing model just falls back to procedural art. */
  async preload(onProgress?: ProgressFn): Promise<void> {
    const entries = Object.entries(MANIFEST.models);
    const total = entries.length;
    onProgress?.(0, total);
    if (total === 0) {
      this.loaded = true;
      return;
    }
    let done = 0;
    await Promise.all(
      entries.map(async ([key, url]) => {
        try {
          const gltf = await this.loader.loadAsync(url);
          this.models.set(key, gltf.scene);
        } catch (e) {
          // Fallback-safe: keep the procedural mesh if the asset can't load.
          console.warn('[assets] could not load model', key, '→ using procedural fallback', e);
        }
        done++;
        onProgress?.(done, total);
      })
    );
    this.loaded = true;
  }

  /** A fresh clone of a loaded model, or null to fall back to procedural art. */
  getModel(key: string): THREE.Object3D | null {
    const src = this.models.get(key);
    return src ? src.clone(true) : null;
  }

  /** True if a model is registered for this seam (i.e. art will be used). */
  has(key: string): boolean {
    return this.models.has(key);
  }
}

// The single shared store the mesh factories consult for optional art.
export const assets = new AssetStore();
