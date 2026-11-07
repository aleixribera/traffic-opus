// Towns (docs/design.md, "Towns"): founded on a spot, they lay out their own streets on a grid turned to suit the
// site and grow outward in a rough circle. What they need climbs with their size, and they grow only while the
// company keeps those needs supplied. Pure model here; city.ts builds the streets and counts the deliveries.

import type { V2 } from "../core/math";
import type { Product } from "./industry";

/** Metres between neighbouring parallel streets of a town grid. */
export const BLOCK = 96;

export interface TownSize {
  name: string;
  /** population it starts at */
  pop: number;
  /** what it needs from this size on (on top of the smaller sizes' needs) */
  adds: Product[];
}

/** Sizes and the needs each one adds (design: food, building materials, household goods + fuel, electronics...). */
export const TOWN_SIZES: TownSize[] = [
  { name: "Hamlet", pop: 0, adds: ["food"] },
  { name: "Village", pop: 300, adds: ["planks"] },
  { name: "Town", pop: 1500, adds: [] },
  { name: "City", pop: 6000, adds: [] },
  { name: "Metropolis", pop: 20000, adds: [] },
];

export function sizeOf(pop: number): number {
  let s = 0;
  for (let i = 0; i < TOWN_SIZES.length; i++) if (pop >= TOWN_SIZES[i].pop) s = i;
  return s;
}

/** Everything a town of this population needs. */
export function needsOf(pop: number): Product[] {
  return TOWN_SIZES.slice(0, sizeOf(pop) + 1).flatMap((s) => s.adds);
}

/**
 * Truckloads of a product a town uses per day. Each size uses more per resident than the last (x1.6), on top of
 * there being more residents: demand climbs exponentially through the sizes, as the design asks.
 */
export function demandPerDay(p: Product, pop: number): number {
  const per: Partial<Record<Product, number>> = { food: 1 / 12, planks: 1 / 30 };
  const base = per[p] ?? 1 / 40;
  return Math.max(1, pop * base * Math.pow(1.6, sizeOf(pop)));
}

/** Share of the last day's needs delivered, 0..1 per need (1 with none). */
export function supplyShare(delivered: Partial<Record<Product, number>>, pop: number): Partial<Record<Product, number>> {
  const out: Partial<Record<Product, number>> = {};
  for (const p of needsOf(pop)) out[p] = Math.min(1, (delivered[p] ?? 0) / demandPerDay(p, pop));
  return out;
}

/**
 * Households a town gains (or loses, negative) per day. A new town grows a little on its own, up to a small
 * starting size; past that it grows only with its needs met, and it shrinks when they go unmet.
 */
export function growthPerDay(supply: Partial<Record<Product, number>>, pop: number): number {
  const shares = Object.values(supply) as number[];
  const worst = shares.length ? Math.min(...shares) : 1;
  if (pop < 60) return 6; // a new settlement fills its first streets regardless
  if (worst >= 0.8) return Math.max(4, pop * 0.06 * (0.5 + worst)); // well supplied: ~6-9% a day
  if (worst >= 0.5) return 2;
  if (worst >= 0.2) return 0;
  return -Math.max(1, pop * 0.02);
}

/** Radius the streets may reach for a population. */
export function townRadius(pop: number): number {
  return Math.min(1600, 150 + 9 * Math.sqrt(pop));
}

// ------------------------------------------------------------------ street grid

/** Grid node (i, j) of a town at c turned to ang. */
export function gridPt(c: V2, ang: number, i: number, j: number): V2 {
  const u = { x: Math.cos(ang), y: Math.sin(ang) };
  return { x: c.x + (u.x * i - u.y * j) * BLOCK, y: c.y + (u.y * i + u.x * j) * BLOCK };
}

export type GridEdge = [number, number, number, number];
export const edgeKey = (e: GridEdge) => {
  const [a, b, c, d] = e;
  return a < c || (a === c && b < d) ? `${a},${b}|${c},${d}` : `${c},${d}|${a},${b}`;
};

/** The first streets: a cross through the centre. */
export const SEED_EDGES: GridEdge[] = [[0, 0, 1, 0], [0, 0, -1, 0], [0, 0, 0, 1], [0, 0, 0, -1]];

/**
 * The next street to lay: a grid edge touching the streets already built, inside the radius, not tried and
 * failed before. Edges that close a block (both ends already on a street) come first, then the ones nearest the
 * centre, so the town fills in block by block and spreads in a rough circle.
 */
export function nextEdge(built: Set<string>, failed: Set<string>, radiusBlocks: number, jitter: (k: string) => number): GridEdge | null {
  const nodes = new Set<string>();
  for (const k of built) for (const n of k.split("|")) nodes.add(n);
  let best: GridEdge | null = null, bs = Infinity;
  for (const n of nodes) {
    const [i, j] = n.split(",").map(Number);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const e: GridEdge = [i, j, i + di, j + dj];
      const k = edgeKey(e);
      if (built.has(k) || failed.has(k)) continue;
      const mx = i + di / 2, my = j + dj / 2;
      const r = Math.hypot(mx, my);
      if (Math.hypot(i + di, j + dj) > radiusBlocks) continue;
      const closes = nodes.has(`${i + di},${j + dj}`);
      const s = r - (closes ? 1.5 : 0) + jitter(k) * 0.8;
      if (s < bs) { bs = s; best = e; }
    }
  }
  return best;
}
