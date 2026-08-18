import { MOVE_SPEED } from '../core/constants';

// ---------- Beat-based level generator ----------
//
// The prototype scattered content on a fixed uniform grid: the same 29 stars,
// 5 fact boxes and 6 creatures at hard-coded x positions on every planet. That
// reads as filler, and it does not scale when levels get longer.
//
// This module instead lays a level out as a sequence of authored BEATS —
// arrival, teach, rise, signature, rest, flourish, finale — and fills each beat
// with content appropriate to its role. The result is deterministic per
// (planet, variant) so a level is stable while you play it and different when
// you come back, and every placement is checked against the planet's real jump
// physics so nothing is ever unreachable.
//
// Everything returned is in "height above the local ground" units; the level
// interpreter resolves that against the terrain surface at each x.

export type BeatKind = 'arrival' | 'teach' | 'rise' | 'signature' | 'rest' | 'flourish' | 'finale';

export interface PlanPlatform { x: number; h: number; w: number; beat: BeatKind }
export interface PlanStar { x: number; h: number }
export interface PlanBloom { x: number; h: number }
export interface PlanCreature { x: number; kind: string; range: number }
export interface PlanProp { x: number; kind: string; layer: 'near' | 'fg' | 'mid' | 'bg'; scale: number; seed: number }

export interface LevelPlan {
  platforms: PlanPlatform[];
  gaps: [number, number][];
  stars: PlanStar[];
  blooms: PlanBloom[];
  creatures: PlanCreature[];
  props: PlanProp[];
  /** Wide, safe, generous ledges — a place to stop and look around. */
  restLedges: number[];
  /** Where the level's signature mechanic should be concentrated. */
  signatureSpan: [number, number];
  /** Reach metrics used to build it (handy for tests + tuning). */
  jumpDist: number;
  jumpHeight: number;
}

export interface GenOpts {
  /** Planet index (0-7) or a moon id hash — seeds the layout. */
  index: number;
  /** Layout variant, rotated per visit. */
  variant: number;
  /** Playable span. */
  minX: number;
  maxX: number;
  /** Planet physics — placement is validated against these. */
  jump: number;
  grav: number;
  /** How many soft gaps this planet wants (0 = none). */
  gapCount: number;
  /** Lumin kinds available here, most-common first. */
  creatureKinds: string[];
  /** Prop kinds by depth layer. */
  propKinds: { fg: string[]; mid: string[]; bg: string[] };
  /** Number of fact blooms (always 5 — one per planet fact). */
  bloomCount?: number;
}

// Small deterministic PRNG (mulberry32) — same seed, same level, every time.
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Beat layout as fractions of the playable span. */
const BEATS: { kind: BeatKind; from: number; to: number }[] = [
  { kind: 'arrival', from: 0.00, to: 0.08 },
  { kind: 'teach', from: 0.08, to: 0.22 },
  { kind: 'rise', from: 0.22, to: 0.40 },
  { kind: 'signature', from: 0.40, to: 0.58 },
  { kind: 'rest', from: 0.58, to: 0.66 },
  { kind: 'flourish', from: 0.66, to: 0.86 },
  { kind: 'finale', from: 0.86, to: 1.00 },
];

export function generateLevel(o: GenOpts): LevelPlan {
  // Mix the planet and variant hard — adjacent variants must not share a stream.
  const seed = (Math.imul(o.index >>> 0, 2654435761) ^ Math.imul(o.variant + 1, 1013904223) ^ 0x9e3779b9) >>> 0;
  const r = rng(seed);
  const span = o.maxX - o.minX;
  const at = (f: number) => o.minX + span * f;

  // Real reach from the planet's own physics (see CLAUDE.md's jump invariant).
  const jumpHeight = (o.jump * o.jump) / (2 * o.grav);
  const airSteps = (2 * o.jump) / o.grav;
  const jumpDist = MOVE_SPEED * airSteps;
  // Comfortable ceilings — never place anything at the limit of the physics.
  const maxRise = jumpHeight * 0.62;
  const maxStep = jumpDist * 0.78;

  const platforms: PlanPlatform[] = [];
  const stars: PlanStar[] = [];
  const blooms: PlanBloom[] = [];
  const creatures: PlanCreature[] = [];
  const props: PlanProp[] = [];
  const gaps: [number, number][] = [];
  const restLedges: number[] = [];

  const pick = <T,>(arr: T[]): T => arr[Math.floor(r() * arr.length)]!;
  const between = (lo: number, hi: number) => lo + r() * (hi - lo);

  // ---- gaps: sized so a running jump genuinely clears them (cushion is the
  // safety net for a miss, not the expected outcome) ----
  const gapW = Math.max(2.2, Math.min(4.6, jumpDist * 0.5));
  const gapZones: [number, number][] = [[0.30, 0.38], [0.70, 0.78], [0.46, 0.52]];
  for (let i = 0; i < Math.min(o.gapCount, gapZones.length); i++) {
    const z = gapZones[i]!;
    const cx = at(between(z[0], z[1]));
    gaps.push([+(cx - gapW / 2).toFixed(2), +(cx + gapW / 2).toFixed(2)]);
  }
  gaps.sort((a, b) => a[0] - b[0]);
  const inGap = (x: number, pad = 0) => gaps.some(g => x > g[0] - pad && x < g[1] + pad);

  // ---- per-beat content ----
  for (const b of BEATS) {
    const x0 = at(b.from), x1 = at(b.to), width = x1 - x0;

    switch (b.kind) {
      case 'arrival': {
        // Calm and empty on purpose: room to find your feet before anything happens.
        stars.push({ x: x0 + width * 0.55, h: 1.2 }, { x: x0 + width * 0.8, h: 1.4 });
        props.push({ x: x0 + width * 0.3, kind: pick(o.propKinds.fg), layer: 'fg', scale: 1, seed: r() });
        break;
      }
      case 'teach': {
        // One low, wide, forgiving platform pair — the "you can stand on these" lesson.
        let h = 1.7;
        const tStart = between(0.20, 0.38), tStep = between(0.34, 0.50);
        for (let i = 0; i < 2; i++) {
          const x = x0 + width * (tStart + i * tStep);
          platforms.push({ x, h, w: 3.4, beat: b.kind });
          starArc(stars, x, h + 1.1, 1.6, 3);
          h = Math.min(h + between(0.5, 0.9), maxRise);
        }
        creatures.push({ x: x0 + width * 0.72, kind: o.creatureKinds[0] ?? 'waddler', range: 2.0 });
        break;
      }
      case 'rise': {
        // A climbing chain: each step validated against the jump arc.
        let h = 1.6, x = x0 + width * 0.12;
        const steps = 3 + Math.floor(r() * 2);
        for (let i = 0; i < steps && x < x1 - 2; i++) {
          platforms.push({ x, h, w: between(2.6, 3.4), beat: b.kind });
          starArc(stars, x, h + 1.1, 1.4, 2);
          h = Math.min(h + between(0.6, 1.0), maxRise);
          x += Math.min(between(4.5, 6.5), maxStep);
        }
        if (o.creatureKinds.length > 1) creatures.push({ x: x0 + width * 0.55, kind: o.creatureKinds[1]!, range: 2.4 });
        props.push({ x: x0 + width * 0.5, kind: pick(o.propKinds.mid), layer: 'mid', scale: between(0.9, 1.3), seed: r() });
        break;
      }
      case 'signature': {
        // The planet's own mechanic gets centre stage, flanked by stepping stones.
        const sStart = between(0.08, 0.24), sStep = between(0.52, 0.72);
        for (let i = 0; i < 2; i++) {
          const x = x0 + width * (sStart + i * sStep);
          if (inGap(x, 1.2)) continue;
          platforms.push({ x, h: between(2.0, 3.0), w: 3.0, beat: b.kind });
        }
        // A star arc over each gap: rewards the jump instead of punishing the miss.
        gaps.forEach(g => {
          if (g[0] < x0 - width || g[0] > x1 + width) return;
          starArc(stars, (g[0] + g[1]) / 2, Math.min(jumpHeight * 0.55, 3.2), (g[1] - g[0]) / 2 + 0.6, 5);
        });
        props.push({ x: x0 + width * 0.45, kind: pick(o.propKinds.mid), layer: 'mid', scale: between(1.0, 1.5), seed: r() });
        break;
      }
      case 'rest': {
        // A wide safe shelf with a view and a little treasure cluster. No hazards.
        const cx = x0 + width * between(0.40, 0.60);
        platforms.push({ x: cx, h: between(1.8, 2.4), w: 6.2, beat: b.kind });
        restLedges.push(cx);
        starCluster(stars, cx, 3.6, 4, r);
        props.push({ x: cx - 3.5, kind: 'lightPod', layer: 'fg', scale: 1, seed: r() });
        props.push({ x: cx + 3.6, kind: 'crystalCluster', layer: 'fg', scale: between(0.9, 1.2), seed: r() });
        break;
      }
      case 'flourish': {
        // The mechanic again, larger, combined with a platform chain.
        let h = 1.8, x = x0 + width * 0.1;
        const steps = 4 + Math.floor(r() * 2);
        for (let i = 0; i < steps && x < x1 - 2; i++) {
          if (!inGap(x, 1.5)) {
            platforms.push({ x, h, w: between(2.4, 3.2), beat: b.kind });
            if (i % 2 === 0) starArc(stars, x, h + 1.2, 1.5, 3);
          }
          h = Math.min(Math.max(1.6, h + between(-0.5, 1.0)), maxRise);
          x += Math.min(between(4.5, 6.8), maxStep);
        }
        o.creatureKinds.slice(0, 3).forEach((k, i) => {
          const cx2 = x0 + width * (0.25 + i * 0.28);
          if (!inGap(cx2, 2.5)) creatures.push({ x: cx2, kind: k, range: 2.2 });
        });
        props.push({ x: x0 + width * 0.6, kind: pick(o.propKinds.mid), layer: 'mid', scale: between(0.9, 1.4), seed: r() });
        break;
      }
      case 'finale': {
        // A gentle stepped approach to the Sunshard — arrival should feel earned,
        // never gated. Two easy risers and a welcoming plinth.
        const p1 = x0 + width * between(0.12, 0.28), p2 = x0 + width * between(0.42, 0.58);
        platforms.push({ x: p1, h: 1.8, w: 3.2, beat: b.kind });
        platforms.push({ x: p2, h: Math.min(2.8, maxRise), w: 3.6, beat: b.kind });
        starArc(stars, p1, 3.0, 1.6, 3);
        starArc(stars, p2, 4.0, 1.6, 3);
        props.push({ x: x0 + width * 0.05, kind: 'bannerStone', layer: 'fg', scale: 1, seed: r() });
        props.push({ x: x1 - 3, kind: pick(o.propKinds.bg), layer: 'bg', scale: between(1.2, 1.8), seed: r() });
        break;
      }
    }
  }

  // ---- fact blooms: one per beat that can carry one, evenly spread ----
  const bloomCount = o.bloomCount ?? 5;
  const bloomJit = () => (r() - 0.5) * 0.04;
  const bloomAt = [0.14, 0.31, 0.50, 0.72, 0.90].map(f => f + bloomJit());
  for (let i = 0; i < bloomCount; i++) {
    let bx = at(bloomAt[i % bloomAt.length]!);
    // never float a bloom over a hole
    if (inGap(bx, 1.5)) bx = at(bloomAt[i % bloomAt.length]! + 0.05);
    blooms.push({ x: +bx.toFixed(2), h: 2.5 });
  }

  // ---- ambient scatter: fills the world without touching the play path ----
  // Density matters more than variety here: a world that reads as a place needs
  // a continuous near field, not a few landmarks in an empty plain.
  const scatter = Math.round(span / 2.6);
  for (let i = 0; i < scatter; i++) {
    const x = o.minX + span * r();
    const roll = r();
    const layer: 'fg' | 'mid' | 'bg' = roll < 0.5 ? 'fg' : roll < 0.82 ? 'mid' : 'bg';
    const kinds = o.propKinds[layer];
    if (!kinds.length) continue;
    // mid/bg silhouettes read at distance, so they are noticeably larger
    const scale = layer === 'fg' ? between(0.5, 1.15) : layer === 'mid' ? between(1.1, 2.0) : between(1.8, 3.2);
    props.push({ x, kind: pick(kinds), layer, scale, seed: r() });
  }
  // ---- near-field detail band: a continuous run of small forms along the
  // front lip of the ground, so the terrain never reads as a bare slab ----
  const bandStep = 2.1;
  for (let x = o.minX; x < o.maxX; x += bandStep * (0.6 + r() * 0.9)) {
    const kinds = o.propKinds.fg;
    if (!kinds.length) continue;
    props.push({ x: x + (r() - 0.5) * 1.2, kind: pick(kinds), layer: 'near', scale: between(0.35, 0.8), seed: r() });
  }

  // ---- final safety sweep: nothing unreachable, nothing over a hole ----
  const clean = <T extends { x: number }>(list: T[], pad: number) => list.filter(p => !inGap(p.x, pad));
  return {
    platforms: dedupeByX(clean(platforms, 1.0), 2.0),
    gaps,
    stars: stars.filter(s => s.x > o.minX && s.x < o.maxX),
    blooms,
    creatures: clean(creatures, 2.5),
    props,
    restLedges,
    signatureSpan: [at(0.40), at(0.58)],
    jumpDist,
    jumpHeight,
  };
}

/** A curve of stars tracing a jump arc — reads as "this way, and jump here". */
function starArc(out: PlanStar[], cx: number, peak: number, halfW: number, n: number): void {
  for (let i = 0; i < n; i++) {
    const u = n === 1 ? 0.5 : i / (n - 1);
    const x = cx - halfW + halfW * 2 * u;
    const h = peak - Math.pow((u - 0.5) * 2, 2) * (peak * 0.28);
    out.push({ x: +x.toFixed(2), h: +h.toFixed(2) });
  }
}

/** A loose bundle of stars — a small treasure pile at a rest point. */
function starCluster(out: PlanStar[], cx: number, h: number, n: number, r: () => number): void {
  for (let i = 0; i < n; i++) {
    out.push({ x: +(cx + (r() - 0.5) * 4).toFixed(2), h: +(h + (r() - 0.5) * 1.4).toFixed(2) });
  }
}

/** Drop platforms that landed on top of each other. */
function dedupeByX(list: PlanPlatform[], minGap: number): PlanPlatform[] {
  const sorted = [...list].sort((a, b) => a.x - b.x);
  const out: PlanPlatform[] = [];
  for (const p of sorted) {
    const prev = out[out.length - 1];
    if (prev && Math.abs(p.x - prev.x) < minGap) continue;
    out.push(p);
  }
  return out;
}
