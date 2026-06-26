import { PLANETS } from '../data/planets';
import { colorById, hatById, freeOwnedIds } from '../data/cosmetics';

// Persistent save. Versioned so features can extend the shape without wiping a
// child's progress. localStorage may be unavailable (private mode, embedded
// webview), so every access is guarded and falls back to in-memory defaults.
//
// v1: { lastPlanet, highestUnlocked }
// v2: + factsFound[planet][fact] (Space Journal) and stickers[] (Sticker book)
// v3: + starsBank, owned[] cosmetics, equipped {color,hat} (Dress Up)
//     Older saves migrate forward, preserving progress.

const KEY = 'moonbounce.save.v1'; // stable key across versions
const MAX = PLANETS.length - 1;
const FACTS_PER = 5;

/** Sticker id for completing a planet's 5 facts. */
export function planetStickerId(i: number): string { return 'planet-' + i; }
/** Sticker id for finding a planet's secret power cache (Power Master). */
export function masterStickerId(i: number): string { return 'master-' + i; }
/** Sticker id for completing every planet. */
export const SOLAR_STICKER = 'solar-system';

export type CosmeticSlot = 'color' | 'hat';

export interface GameSettings {
  calm: boolean;
  speakOn: boolean;
  musicOn: boolean;
  /** Speech rate, ~0.6–1.1. */
  voiceRate: number;
  /** Master sfx/music volume, 0–1. */
  volume: number;
  /** Dampen background motion, particles, parallax. */
  reduceMotion: boolean;
  /** Gentler "Tiny Explorer" assist (slower, easier). */
  assist: boolean;
}

export type SettingKey = keyof GameSettings;

export interface SaveV4 {
  v: 4;
  lastPlanet: number;
  highestUnlocked: number;
  /** factsFound[planetIndex][factIndex] — which of the 5 facts are discovered. */
  factsFound: boolean[][];
  /** Earned sticker ids. */
  stickers: string[];
  /** Lifetime stars available to spend on cosmetics. */
  starsBank: number;
  /** Owned cosmetic ids (free items are always owned). */
  owned: string[];
  /** Currently equipped cosmetic ids. */
  equipped: { color: string; hat: string };
  /** Persisted settings. */
  settings: GameSettings;
}

function prefersReducedMotion(): boolean {
  try { return window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { return false; }
}

function defaultSettings(): GameSettings {
  return { calm: false, speakOn: true, musicOn: false, voiceRate: 0.78, volume: 1, reduceMotion: prefersReducedMotion(), assist: false };
}

function normalizeSettings(input: unknown): GameSettings {
  const d = defaultSettings();
  if (!input || typeof input !== 'object') return d;
  const s = input as Record<string, unknown>;
  const bool = (v: unknown, fb: boolean) => (typeof v === 'boolean' ? v : fb);
  const num = (v: unknown, fb: number, lo: number, hi: number) => (typeof v === 'number' && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fb);
  return {
    calm: bool(s.calm, d.calm),
    speakOn: bool(s.speakOn, d.speakOn),
    musicOn: bool(s.musicOn, d.musicOn),
    voiceRate: num(s.voiceRate, d.voiceRate, 0.5, 1.2),
    volume: num(s.volume, d.volume, 0, 1),
    reduceMotion: bool(s.reduceMotion, d.reduceMotion),
    assist: bool(s.assist, d.assist),
  };
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

function defaultEquipped(): { color: string; hat: string } {
  return { color: COLORS_DEFAULT, hat: HAT_DEFAULT };
}

function makeDefault(): SaveV4 {
  return {
    v: 4, lastPlanet: 0, highestUnlocked: 0, factsFound: emptyFacts(), stickers: [],
    starsBank: 0, owned: freeOwnedIds(), equipped: defaultEquipped(), settings: defaultSettings(),
  };
}

function stringArray(input: unknown): string[] {
  return Array.isArray(input) ? (input as unknown[]).filter((s): s is string => typeof s === 'string') : [];
}

function read(): SaveV4 {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return makeDefault();
    const d = JSON.parse(raw) as Record<string, unknown>;
    if (!d || (d.v !== 1 && d.v !== 2 && d.v !== 3 && d.v !== 4)) return makeDefault();
    // Fields are shared across versions; missing ones fall back to defaults,
    // so older saves migrate forward without losing progress.
    const eq = (d.equipped && typeof d.equipped === 'object') ? d.equipped as Record<string, unknown> : {};
    const owned = new Set<string>([...freeOwnedIds(), ...stringArray(d.owned)]);
    const equippedColor = typeof eq.color === 'string' && owned.has(eq.color) ? eq.color : COLORS_DEFAULT;
    const equippedHat = typeof eq.hat === 'string' && owned.has(eq.hat) ? eq.hat : HAT_DEFAULT;
    return {
      v: 4,
      lastPlanet: clampIndex(d.lastPlanet),
      highestUnlocked: clampIndex(d.highestUnlocked),
      factsFound: normalizeFacts(d.factsFound),
      stickers: stringArray(d.stickers),
      starsBank: typeof d.starsBank === 'number' && Number.isFinite(d.starsBank) ? Math.max(0, Math.floor(d.starsBank)) : 0,
      owned: [...owned],
      equipped: { color: equippedColor, hat: equippedHat },
      settings: normalizeSettings(d.settings),
    };
  } catch {
    return makeDefault();
  }
}

// Default cosmetic ids (free starters). Resolved through the catalog so a
// renamed/removed cosmetic can't leave the save pointing at nothing.
const COLORS_DEFAULT = colorById('color-blue').id;
const HAT_DEFAULT = hatById('hat-none').id;

export class Storage {
  private data: SaveV4;

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
  /** Grant a sticker directly (e.g. completing a moon bonus level). */
  awardSticker(id: string): void { if (!this.data.stickers.includes(id)) { this.data.stickers.push(id); this.persist(); } }

  // ---- Stars & cosmetics (Dress Up) ----
  get stars(): number { return this.data.starsBank; }
  addStars(n: number): void { if (n > 0) { this.data.starsBank += n; this.persist(); } }
  canAfford(cost: number): boolean { return this.data.starsBank >= cost; }
  owns(id: string): boolean { return this.data.owned.includes(id); }

  /** Buy a cosmetic if affordable and not already owned. Returns success. */
  buy(id: string, cost: number): boolean {
    if (this.owns(id)) return true;
    if (this.data.starsBank < cost) return false;
    this.data.starsBank -= cost;
    this.data.owned.push(id);
    this.persist();
    return true;
  }

  /** Equip an owned cosmetic into a slot. */
  equip(slot: CosmeticSlot, id: string): void {
    if (!this.owns(id)) return;
    this.data.equipped[slot] = id;
    this.persist();
  }

  get equippedColor(): string { return this.data.equipped.color; }
  get equippedHat(): string { return this.data.equipped.hat; }

  // ---- Settings ----
  get settings(): GameSettings { return { ...this.data.settings }; }
  setSetting<K extends SettingKey>(key: K, value: GameSettings[K]): void {
    this.data.settings[key] = value; this.persist();
  }

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
