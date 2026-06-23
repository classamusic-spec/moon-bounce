// Cosmetic catalog for the blob. Purely visual — no gameplay effect (stays
// no-fail / fair). Bought with stars collected while exploring.

export type HatKind = 'none' | 'party' | 'bow' | 'cap' | 'crown' | 'tophat';

export interface ColorCosmetic {
  id: string;
  label: string;
  hex: number;
  cost: number;
}

export interface HatCosmetic {
  id: string;
  label: string;
  kind: HatKind;
  emoji: string;
  cost: number;
}

// Soft, sensory-safe palette. Two free starters so there's an immediate choice.
export const COLORS: ColorCosmetic[] = [
  { id: 'color-blue',   label: 'Sky',    hex: 0xa8e0ff, cost: 0 },
  { id: 'color-mint',   label: 'Mint',   hex: 0xa8f0c8, cost: 0 },
  { id: 'color-orange', label: 'Peach',  hex: 0xffc08a, cost: 10 },
  { id: 'color-green',  label: 'Leaf',   hex: 0x9ae0a0, cost: 10 },
  { id: 'color-pink',   label: 'Bubble', hex: 0xffb3d1, cost: 10 },
  { id: 'color-gold',   label: 'Sunny',  hex: 0xffe08a, cost: 15 },
  { id: 'color-purple', label: 'Grape',  hex: 0xc9a8ff, cost: 15 },
  { id: 'color-red',    label: 'Berry',  hex: 0xff9a9a, cost: 20 },
];

export const HATS: HatCosmetic[] = [
  { id: 'hat-none',   label: 'No hat', kind: 'none',   emoji: '🚫', cost: 0 },
  { id: 'hat-party',  label: 'Party',  kind: 'party',  emoji: '🎉', cost: 10 },
  { id: 'hat-bow',    label: 'Bow',    kind: 'bow',    emoji: '🎀', cost: 15 },
  { id: 'hat-cap',    label: 'Cap',    kind: 'cap',    emoji: '🧢', cost: 20 },
  { id: 'hat-tophat', label: 'Top hat', kind: 'tophat', emoji: '🎩', cost: 25 },
  { id: 'hat-crown',  label: 'Crown',  kind: 'crown',  emoji: '👑', cost: 30 },
];

const DEFAULT_COLOR = COLORS[0]!;
const DEFAULT_HAT = HATS[0]!;

export function colorById(id: string): ColorCosmetic { return COLORS.find(c => c.id === id) || DEFAULT_COLOR; }
export function hatById(id: string): HatCosmetic { return HATS.find(h => h.id === id) || DEFAULT_HAT; }

/** Ids of everything that is free (owned from the start). */
export function freeOwnedIds(): string[] {
  return [...COLORS, ...HATS].filter(c => c.cost === 0).map(c => c.id);
}
