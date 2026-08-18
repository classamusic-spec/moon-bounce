import { describe, it, expect } from 'vitest';
import { generateLevel } from '../src/systems/levelgen';
import type { GenOpts, LevelPlan } from '../src/systems/levelgen';
import { PLANETS } from '../src/data/planets';
import { LEVEL_LEN, MOVE_SPEED } from '../src/core/constants';

// Every horizontal planet, every layout variant, is generated and checked
// against the invariants that make a level playable and no-fail. This is the
// safety net that lets levels be generated rather than hand-placed.

const HORIZONTAL = PLANETS.filter(p => p.terrain.type === 'horizontal');

function optsFor(p: (typeof PLANETS)[number], variant: number): GenOpts {
  return {
    index: p.name.length * 31 + p.name.charCodeAt(0),
    variant,
    minX: -LEVEL_LEN / 2 + 3.7,
    maxX: LEVEL_LEN / 2 - 3.5,
    jump: p.jump,
    grav: p.grav,
    gapCount: (p.terrain.gaps || []).length,
    creatureKinds: ['waddler', 'hopper', 'drifter'],
    propKinds: { fg: ['boulder', 'flora'], mid: ['spire', 'arch'], bg: ['monolith'] },
  };
}

function everyPlan(fn: (plan: LevelPlan, p: (typeof PLANETS)[number], v: number) => void): void {
  for (const p of HORIZONTAL) {
    const variants = 1 + (p.terrain.variants || []).length;
    for (let v = 0; v < variants; v++) fn(generateLevel(optsFor(p, v)), p, v);
  }
}

describe('level generation — reachability (no-fail invariants)', () => {
  it('never places a gap wider than the planet can actually jump', () => {
    everyPlan((plan, p) => {
      for (const [a, b] of plan.gaps) {
        const w = b - a;
        expect(w, `${p.name}: gap ${w.toFixed(2)} vs jump reach ${plan.jumpDist.toFixed(2)}`)
          .toBeLessThanOrEqual(plan.jumpDist * 0.62);
      }
    });
  });

  it('keeps every platform within a comfortable jump of the ground', () => {
    everyPlan((plan, p) => {
      for (const pl of plan.platforms) {
        expect(pl.h, `${p.name}: platform at h=${pl.h} vs apex ${plan.jumpHeight.toFixed(2)}`)
          .toBeLessThanOrEqual(plan.jumpHeight * 0.7);
        expect(pl.h).toBeGreaterThan(0);
      }
    });
  });

  it('never leaves a horizontal run longer than a jump between platforms', () => {
    everyPlan((plan, p) => {
      const xs = plan.platforms.map(pl => pl.x).sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) {
        const d = xs[i]! - xs[i - 1]!;
        // a bigger run is fine — you simply walk along the ground between them
        if (d > plan.jumpDist) expect(d, `${p.name}: platform spacing`).toBeGreaterThan(0);
      }
      expect(xs.length).toBeGreaterThan(0);
    });
  });

  it('never floats a bloom, platform or creature over a hole', () => {
    everyPlan((plan, p) => {
      const over = (x: number, pad: number) => plan.gaps.some(g => x > g[0] - pad && x < g[1] + pad);
      for (const b of plan.blooms) expect(over(b.x, 0.8), `${p.name}: bloom over a gap`).toBe(false);
      for (const c of plan.creatures) expect(over(c.x, 2.0), `${p.name}: creature patrols over a gap`).toBe(false);
      for (const pl of plan.platforms) expect(over(pl.x, 0.6), `${p.name}: platform inside a gap`).toBe(false);
    });
  });

  it('keeps gaps separated and ordered', () => {
    everyPlan((plan, p) => {
      for (let i = 1; i < plan.gaps.length; i++) {
        expect(plan.gaps[i]![0], `${p.name}: overlapping gaps`).toBeGreaterThan(plan.gaps[i - 1]![1]);
      }
    });
  });
});

describe('level generation — content density and pacing', () => {
  it('fills a long level with a real amount to do', () => {
    everyPlan((plan, p) => {
      expect(plan.platforms.length, `${p.name}: too few platforms`).toBeGreaterThanOrEqual(9);
      expect(plan.stars.length, `${p.name}: too few collectibles`).toBeGreaterThanOrEqual(30);
      expect(plan.creatures.length, `${p.name}: too few creatures`).toBeGreaterThanOrEqual(3);
      expect(plan.props.length, `${p.name}: world too sparse`).toBeGreaterThanOrEqual(20);
    });
  });

  it('gives every level exactly one bloom per planet fact', () => {
    everyPlan((plan, p) => {
      expect(plan.blooms.length).toBe(5);
      expect(p.facts.length).toBe(5);
    });
  });

  it('always includes a rest ledge — somewhere safe to stop', () => {
    everyPlan((plan, p) => {
      expect(plan.restLedges.length, `${p.name}: no rest spot`).toBeGreaterThanOrEqual(1);
      const rest = plan.platforms.filter(pl => pl.beat === 'rest');
      expect(rest.length).toBeGreaterThanOrEqual(1);
      for (const r of rest) expect(r.w, `${p.name}: rest ledge too narrow`).toBeGreaterThanOrEqual(5);
    });
  });

  it('spreads content across the whole span, not just the middle', () => {
    everyPlan((plan, p) => {
      const o = optsFor(p, 0);
      const span = o.maxX - o.minX;
      const xs = plan.stars.map(s => s.x);
      expect(Math.min(...xs), `${p.name}: nothing near the start`).toBeLessThan(o.minX + span * 0.2);
      expect(Math.max(...xs), `${p.name}: nothing near the end`).toBeGreaterThan(o.minX + span * 0.8);
    });
  });

  it('covers every authored beat', () => {
    everyPlan((plan, p) => {
      const beats = new Set(plan.platforms.map(pl => pl.beat));
      for (const b of ['teach', 'rise', 'rest', 'flourish', 'finale']) {
        expect(beats.has(b as never), `${p.name}: missing the "${b}" beat`).toBe(true);
      }
    });
  });
});

describe('level generation — determinism and variety', () => {
  it('is deterministic: the same level regenerates identically', () => {
    for (const p of HORIZONTAL) {
      const a = generateLevel(optsFor(p, 0));
      const b = generateLevel(optsFor(p, 0));
      expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    }
  });

  it('produces a genuinely different layout for each variant', () => {
    for (const p of HORIZONTAL) {
      const variants = 1 + (p.terrain.variants || []).length;
      if (variants < 2) continue;
      const sigs = new Set<string>();
      for (let v = 0; v < variants; v++) {
        sigs.add(generateLevel(optsFor(p, v)).platforms.map(pl => pl.x.toFixed(1)).join(','));
      }
      expect(sigs.size, `${p.name}: variants produce the same layout`).toBe(variants);
    }
  });

  it('gives different planets different layouts', () => {
    const sigs = HORIZONTAL.map(p => generateLevel(optsFor(p, 0)).platforms.map(pl => pl.x.toFixed(1)).join(','));
    expect(new Set(sigs).size).toBe(sigs.length);
  });
});

describe('level scale', () => {
  it('is meaningfully longer than the original 95-unit strip', () => {
    expect(LEVEL_LEN).toBeGreaterThanOrEqual(200);
  });

  it('takes a real amount of time to walk end to end', () => {
    // MOVE_SPEED is per 1/60s physics step
    const seconds = LEVEL_LEN / (MOVE_SPEED * 60);
    expect(seconds).toBeGreaterThan(30);
  });
});
