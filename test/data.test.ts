import { describe, it, expect } from 'vitest';
import { PLANETS } from '../src/data/planets';
import { MOONS } from '../src/data/moons';
import { COLORS, HATS, freeOwnedIds } from '../src/data/cosmetics';
import { LEVEL_LEN } from '../src/core/constants';

const POWERS = ['flame', 'ice', 'bubble', 'spark'];

describe('PLANETS integrity', () => {
  it('has 8 planets with required fields', () => {
    expect(PLANETS).toHaveLength(8);
    for (const p of PLANETS) {
      expect(p.name).toBeTruthy();
      expect(p.sky).toHaveLength(2);
      expect(p.facts).toHaveLength(5);
      expect(p.grav).toBeGreaterThan(0);
      expect(p.jump).toBeGreaterThan(0);
      expect(p.terrain.type === 'horizontal' || p.terrain.type === 'vertical').toBe(true);
    }
  });

  it('has valid power / powerBox / powerCache where present', () => {
    for (const p of PLANETS) {
      if (p.power) {
        expect(POWERS).toContain(p.power);
        expect(typeof p.powerBox).toBe('number'); // a power needs a box to grant it
      }
      if (p.powerCache) {
        const [x] = p.powerCache;
        expect(Math.abs(x)).toBeLessThanOrEqual(LEVEL_LEN / 2);
      }
    }
  });

  it('has well-formed, non-overlapping gaps (base + variants)', () => {
    const checkGaps = (gaps: [number, number][]) => {
      for (const [a, b] of gaps) {
        expect(b).toBeGreaterThan(a);
        expect(b - a).toBeLessThanOrEqual(9); // sanity: not absurdly wide
      }
      const sorted = [...gaps].sort((x, y) => x[0] - y[0]);
      for (let i = 1; i < sorted.length; i++) expect(sorted[i]![0]).toBeGreaterThanOrEqual(sorted[i - 1]![1]);
    };
    for (const p of PLANETS) {
      checkGaps(p.terrain.gaps || []);
      for (const v of p.terrain.variants || []) {
        checkGaps(v.gaps || []);
        for (const [x, h] of v.platforms || []) { expect(Math.abs(x)).toBeLessThanOrEqual(LEVEL_LEN / 2 + 2); expect(h).toBeGreaterThan(0); }
      }
    }
  });

  it('only varies platforms/movers (not the level type) in variants', () => {
    for (const p of PLANETS) {
      for (const v of p.terrain.variants || []) {
        expect(v.type).toBeUndefined(); // variants must not change horizontal/vertical
        expect((v.platforms || v.movingPlats)).toBeTruthy(); // a variant should change something
      }
    }
  });

  // CLAUDE.md invariant: vertical climb gaps must stay below jump height.
  it('keeps every vertical climb step below the jump height', () => {
    for (const p of PLANETS) {
      if (p.terrain.type !== 'vertical' || !p.terrain.climb) continue;
      const jumpHeight = (p.jump * p.jump) / (2 * p.grav);
      const ys = p.terrain.climb.map(c => c[1]);
      for (let i = 1; i < ys.length; i++) {
        const rise = ys[i]! - ys[i - 1]!;
        expect(rise).toBeLessThanOrEqual(jumpHeight * 0.95);
      }
    }
  });
});

describe('MOONS integrity', () => {
  it('has parent-keyed moons with unique ids and 5 facts each', () => {
    const ids = new Set<string>();
    for (const m of MOONS) {
      expect(m.parent).toBeGreaterThanOrEqual(0);
      expect(m.parent).toBeLessThan(PLANETS.length);
      expect(m.facts).toHaveLength(5);
      expect(m.sticker).toBeTruthy();
      expect(ids.has(m.id)).toBe(false);
      ids.add(m.id);
    }
  });

  it('only attaches a moon to planets that exist', () => {
    const parents = MOONS.map(m => m.parent);
    expect(new Set(parents).size).toBe(parents.length); // one moon per planet
  });
});

describe('Cosmetics integrity', () => {
  it('has unique ids and at least one free starter per slot', () => {
    const all = [...COLORS, ...HATS];
    const ids = new Set(all.map(c => c.id));
    expect(ids.size).toBe(all.length);
    for (const c of all) expect(c.cost).toBeGreaterThanOrEqual(0);
    expect(freeOwnedIds().length).toBeGreaterThanOrEqual(2);
    expect(COLORS.some(c => c.cost === 0)).toBe(true);
    expect(HATS.some(h => h.cost === 0)).toBe(true);
  });
});
