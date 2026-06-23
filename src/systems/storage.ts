import { PLANETS } from '../data/planets';

// Persistent save. Versioned from day one so later phases (journal, stickers,
// blob customization, settings) can extend SaveV1 without wiping a child's
// progress. localStorage may be unavailable (private mode, embedded webview),
// so every access is guarded and falls back to in-memory defaults.

const KEY = 'moonbounce.save.v1';
const MAX = PLANETS.length - 1;

export interface SaveV1 {
  v: 1;
  /** Planet index to resume on Play. */
  lastPlanet: number;
  /** Highest planet index the player has unlocked by travelling there. */
  highestUnlocked: number;
}

function clampIndex(n: unknown): number {
  const i = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, Math.min(MAX, i));
}

function makeDefault(): SaveV1 {
  return { v: 1, lastPlanet: 0, highestUnlocked: 0 };
}

function read(): SaveV1 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return makeDefault();
    const d = JSON.parse(raw) as Partial<SaveV1>;
    if (!d || d.v !== 1) return makeDefault();
    return { v: 1, lastPlanet: clampIndex(d.lastPlanet), highestUnlocked: clampIndex(d.highestUnlocked) };
  } catch {
    return makeDefault();
  }
}

export class Storage {
  private data: SaveV1;

  constructor() { this.data = read(); }

  get lastPlanet(): number { return this.data.lastPlanet; }
  get highestUnlocked(): number { return this.data.highestUnlocked; }

  /** Where Play should resume — the last planet visited. */
  resumePlanet(): number { return clampIndex(this.data.lastPlanet); }

  /** Record arrival at a planet: remembers it and unlocks it (and any below). */
  unlock(i: number): void {
    const idx = clampIndex(i);
    let changed = false;
    if (idx > this.data.highestUnlocked) { this.data.highestUnlocked = idx; changed = true; }
    if (idx !== this.data.lastPlanet) { this.data.lastPlanet = idx; changed = true; }
    if (changed) this.persist();
  }

  /** Remember the current planet without changing unlock state. */
  setLastPlanet(i: number): void {
    const idx = clampIndex(i);
    if (idx !== this.data.lastPlanet) { this.data.lastPlanet = idx; this.persist(); }
  }

  isUnlocked(i: number): boolean { return i <= this.data.highestUnlocked; }

  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }
}
