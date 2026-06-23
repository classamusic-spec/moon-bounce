import { PLANETS } from '../data/planets';

// Persistent save. Versioned so features can extend the shape without wiping a
// child's progress. localStorage may be unavailable (private mode, embedded
// webview), so every access is guarded and falls back to in-memory defaults.
//
// v1: { lastPlanet, highestUnlocked }
// v2: + factsFound[planet][fact] (the Space Journal) and stickers[] (the
//     Sticker book). v1 saves migrate forward, preserving progress.

const KEY = 'moonbounce.save.v1'; // stable key across versions
const MAX = PLANETS.length - 1;
const FACTS_PER = 5;

/** Sticker id for completing a planet's 5 facts. */
export function planetStickerId(i: number): string { return 'planet-' + i; }
/** Sticker id for completing every planet. */
export const SOLAR_STICKER = 'solar-system';

export interface SaveV2 {
  v: 2;
  lastPlanet: number;
  highestUnlocked: number;
  /** factsFound[planetIndex][factIndex] — which of the 5 facts are discovered. */
  factsFound: boolean[][];
  /** Earned sticker ids. */
  stickers: string[];
}

function clampIndex(n: unknown): number {
  const i = typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : 0;
  return Math.max(0, Math.min(MAX, i));
}

function emptyFacts(): boolean[][] {
  return PLANETS.map(() => new Array<boolean>(FACTS_PER).fill(false));
}

/** Coerce any stored facts array into the exact [PLANETS.length][5] shape. */
function normalizeFacts(input: unknown): boolean[][] {
  const out = emptyFacts();
  if (Array.isArray(input)) {
    for (let p = 0; p < out.length; p++) {
      const row = input[p];
      if (Array.isArray(row)) {
        for (let f = 0; f < FACTS_PER; f++) out[p]![f] = row[f] === true;
      }
    }
  }
  return out;
}

function makeDefault(): SaveV2 {
  return { v: 2, lastPlanet: 0, highestUnlocked: 0, factsFound: emptyFacts(), stickers: [] };
}

function read(): SaveV2 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return makeDefault();
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!d || (d.v !== 1 && d.v !== 2)) return makeDefault();
    // v1 and v2 share these two fields; v1 simply lacks facts/stickers.
    return {
      v: 2,
      lastPlanet: clampIndex(d.lastPlanet),
      highestUnlocked: clampIndex(d.highestUnlocked),
      factsFound: normalizeFacts(d.factsFound),
      stickers: Array.isArray(d.stickers) ? (d.stickers as unknown[]).filter((s): s is string => typeof s === 'string') : [],
    };
  } catch {
    return makeDefault();
  }
}

export class Storage {
  private data: SaveV2;

  constructor() {
    this.data = read();
    // Re-derive sticker awards in case facts were migrated or hand-edited.
    this.refreshStickers();
  }

  get lastPlanet(): number { return this.data.lastPlanet; }
  get highestUnlocked(): number { return this.data.highestUnlocked; }

  resumePlanet(): number { return clampIndex(this.data.lastPlanet); }

  unlock(i: number): void {
    const idx = clampIndex(i);
    let changed = false;
    if (idx > this.data.highestUnlocked) { this.data.highestUnlocked = idx; changed = true; }
    if (idx !== this.data.lastPlanet) { this.data.lastPlanet = idx; changed = true; }
    if (changed) this.persist();
  }

  setLastPlanet(i: number): void {
    const idx = clampIndex(i);
    if (idx !== this.data.lastPlanet) { this.data.lastPlanet = idx; this.persist(); }
  }

  isUnlocked(i: number): boolean { return i <= this.data.highestUnlocked; }

  // ---- Space Journal ----
  /** Mark one fact of a planet as discovered. Returns true if it was new. */
  markFact(planet: number, factIndex: number): boolean {
    const p = clampIndex(planet);
    if (factIndex < 0 || factIndex >= FACTS_PER) return false;
    const row = this.data.factsFound[p]!;
    if (row[factIndex]) return false;
    row[factIndex] = true;
    this.refreshStickers();
    this.persist();
    return true;
  }

  factsFor(planet: number): boolean[] { return this.data.factsFound[clampIndex(planet)]!.slice(); }
  factsFoundCount(planet: number): number { return this.data.factsFound[clampIndex(planet)]!.filter(Boolean).length; }
  allFactsFound(planet: number): boolean { return this.factsFoundCount(planet) >= FACTS_PER; }

  // ---- Sticker book ----
  stickers(): string[] { return this.data.stickers.slice(); }
  hasSticker(id: string): boolean { return this.data.stickers.includes(id); }

  /** Award any stickers the current progress has earned. */
  private refreshStickers(): void {
    let changed = false;
    const add = (id: string) => { if (!this.data.stickers.includes(id)) { this.data.stickers.push(id); changed = true; } };
    let allPlanets = true;
    for (let p = 0; p <= MAX; p++) {
      if (this.data.factsFound[p]!.every(Boolean)) add(planetStickerId(p)); else allPlanets = false;
    }
    if (allPlanets) add(SOLAR_STICKER);
    if (changed) this.persist();
  }

  private persist(): void {
    try { localStorage.setItem(KEY, JSON.stringify(this.data)); } catch { /* storage unavailable */ }
  }
}
