// Minimal browser-API polyfills so storage.ts can run under Node/Vitest.
// storage.ts only touches localStorage and window.matchMedia.

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string): string | null { return this.m.has(k) ? this.m.get(k)! : null; }
  setItem(k: string, v: string): void { this.m.set(k, String(v)); }
  removeItem(k: string): void { this.m.delete(k); }
  clear(): void { this.m.clear(); }
  key(i: number): string | null { return [...this.m.keys()][i] ?? null; }
  get length(): number { return this.m.size; }
}

const g = globalThis as unknown as Record<string, unknown>;
g.localStorage = new MemoryStorage();
g.window = { matchMedia: () => ({ matches: false }) };
