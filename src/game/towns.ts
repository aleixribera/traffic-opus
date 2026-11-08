// Towns (docs/design.md, "Towns"): founded on a spot, they lay out their own streets on a grid turned to suit the
// site and grow outward in a rough circle. What they need climbs with their size, and they grow only while the
// company keeps those needs supplied. Pure model here; city.ts builds the streets and counts the deliveries.

import type { BuildingKind } from "../config";
import type { V2 } from "../core/math";
import type { Product } from "./industry";
import type { ZoneId } from "./zones";

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
  { name: "Village", pop: 300, adds: ["planks", "cement"] },
  { name: "Town", pop: 1500, adds: [] },
  { name: "City", pop: 6000, adds: [] },
  { name: "Metropolis", pop: 20000, adds: [] },
];

/** Needs a size adds only once the town has grown further into it: a village builds in timber, then in concrete. */
export const NEED_FROM: Partial<Record<Product, number>> = { cement: 600 };

export function sizeOf(pop: number): number {
  let s = 0;
  for (let i = 0; i < TOWN_SIZES.length; i++) if (pop >= TOWN_SIZES[i].pop) s = i;
  return s;
}

/** Population a town needs a product from. */
export const needFrom = (p: Product): number => NEED_FROM[p] ?? TOWN_SIZES.find((s) => s.adds.includes(p))?.pop ?? Infinity;

/** Everything a town of this population needs. */
export function needsOf(pop: number): Product[] {
  return TOWN_SIZES.slice(0, sizeOf(pop) + 1).flatMap((s) => s.adds).filter((p) => needFrom(p) <= pop);
}

/** The next need a town of this population will have, and the population it starts at (null: none for now). */
export function nextNeed(pop: number): { p: Product; pop: number } | null {
  let best: { p: Product; pop: number } | null = null;
  for (const s of TOWN_SIZES) for (const p of s.adds) {
    const at = needFrom(p);
    if (at > pop && (!best || at < best.pop)) best = { p, pop: at };
  }
  return best;
}

/**
 * Truckloads of a product a town uses per day. Each size uses more per resident than the last (x1.6), on top of
 * there being more residents: demand climbs exponentially through the sizes, as the design asks.
 */
export function demandPerDay(p: Product, pop: number): number {
  const per: Partial<Record<Product, number>> = { food: 1 / 8, planks: 1 / 20, cement: 1 / 30 };
  const base = per[p] ?? 1 / 24;
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
  // well supplied: a hamlet or village grows ~30% a day, slowing to ~12% for a city
  if (worst >= 0.8) return Math.max(4, pop * [0.09, 0.08, 0.06, 0.045, 0.035][sizeOf(pop)] * (0.5 + worst));
  if (worst >= 0.5) return 2;
  if (worst >= 0.2) return 0;
  return -Math.max(1, pop * 0.02);
}

// ------------------------------------------------------------------ town hall and the eras of building

/** The hall a town of each size has at its centre (docs/design.md, "Towns grow into cities"). */
export const HALLS: BuildingKind[] = ["hamlethall", "villagehall", "townhall", "cityhall", "cityhall"];
export const isHall = (k: BuildingKind) => HALLS.includes(k);

/**
 * The rings of a town's land at each size, from the centre out: [outer radius in blocks, zone]. Past the last ring
 * the edge grows houses. Each size brings its own era into the middle: shop-houses and terraces in a village, 1960s
 * blocks, stores and offices in a town, malls, office towers, modern flats and apartment towers in a city, glass
 * towers in a metropolis core.
 */
export const RINGS: [number, ZoneId][][] = [
  [[0.75, "comLow"]],
  [[1.5, "comLow"], [3.5, "resRow"]],
  [[1.5, "comMid"], [3, "resMed"], [4.5, "resRow"]],
  [[1.5, "comHigh"], [2.25, "resTower"], [3.25, "resHigh"], [4.25, "resMed"], [5.25, "resRow"]],
  [[1.5, "comTower"], [2, "comHigh"], [3.25, "resTower"], [4.5, "resHigh"], [5.5, "resMed"], [6.5, "resRow"]],
];

/** The zone of a town's land r blocks from its centre, at a size. */
export function ringZone(size: number, r: number): ZoneId {
  for (const [out, z] of RINGS[Math.max(0, Math.min(RINGS.length - 1, size))]) if (r < out) return z;
  return "resLow";
}

/**
 * A town's high streets, from a Village on: shops and offices along the centre cross, and from a City along every
 * fourth grid line too, out as far as the town wants shops (highStreetReach), so its commerce keeps pace with its
 * homes instead of stopping at the centre ring. The zone along them at each size (none for a hamlet).
 */
export const HIGH_STREET: (ZoneId | null)[] = [null, "comLow", "comMid", "comMid", "comHigh"];
/** Does grid line k (counted from the centre cross) carry a high street at a size? */
export const highLine = (size: number, k: number) => k === 0 || (size >= 3 && k % 4 === 0);
/** Shops on a block's length of high street, both sides (a lot is two to four cells wide, less the junctions). */
export const SHOPS_PER_BLOCK = 6;
/** Shops the centre ring holds at a size, about (the high streets take the rest). */
const CORE_SHOPS = [2, 12, 18, 22, 26];

/**
 * How far out (blocks from the centre) a town's high streets run for the shops it wants: their frontage, every
 * high-street line inside that radius, holds what the centre ring can't. Grows in half blocks; 0 for a hamlet.
 */
export function highStreetReach(size: number, shopsWanted: number): number {
  const s = Math.max(0, Math.min(HIGH_STREET.length - 1, size));
  if (!HIGH_STREET[s]) return 0;
  const core = RINGS[s][0][0];
  const need = shopsWanted - CORE_SHOPS[s];
  let R = core;
  for (; R < 16; R += 0.5) {
    // street length (blocks) of every high-street line inside R, both ways, outside the centre ring
    let len = 0;
    for (let k = 0; k < R; k++) {
      if (!highLine(s, k)) continue;
      const half = Math.sqrt(R * R - k * k), inner = k < core ? Math.sqrt(core * core - k * k) : 0;
      len += (k === 0 ? 2 : 4) * 2 * (half - inner); // both axes; lines k and -k
    }
    if (len * SHOPS_PER_BLOCK >= need) break;
  }
  return R;
}

/** Old buildings a town pulls down for denser ones each day, at most (a few, more in a bigger town). */
export const redevPerDay = (size: number, buildings: number) => 2 + size + Math.floor(buildings / 60);
/** Share of a town's homes that may be building sites for redevelopment at once. */
export const REDEV_SHARE = 0.05;

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
