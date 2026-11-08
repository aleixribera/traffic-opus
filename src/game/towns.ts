// Towns (docs/design.md, "Towns"): founded on a spot, they lay out their own streets on a grid turned to suit the
// site and grow outward in a rough circle. What they need climbs with their size, and they grow only while the
// company keeps those needs supplied. Pure model here; city.ts builds the streets and counts the deliveries.

import type { BuildingKind } from "../config";
import { rectDistance, type V2 } from "../core/math";
import type { Product } from "./industry";
import type { ZoneId } from "./zones";

/** Metres between neighbouring parallel streets of a town grid. */
export const BLOCK = 96;

// ------------------------------------------------------------------ smoke and noise

/**
 * How far a dirty plant's smoke reaches into the towns' land value past its fence (m): its pollution radius, half
 * again and more, further when it is linked into a park (parks.ts, PARK_SMOKE).
 */
export const smokeReach = (pollution: number, parkSmoke = 1) => pollution * 1.6 * parkSmoke;
/** How much further a plant's noise carries than its smoke (m): towns keep their homes clear of both. */
export const NOISE = 60;
/** A dirty plant as the towns see it: its fence, and how far its smoke and noise reach past it. */
export interface Nuisance { c: V2; hw: number; hd: number; rot: number; reach: number }
/**
 * Towns keep away from the company's dirty plants (docs/design.md, "Towns": they grow the other way): no new street
 * where a plant's smoke and noise are worse than NUISANCE_STREET, no new homes past NUISANCE_HOMES, no new shops past
 * NUISANCE_SHOPS. Land a town gives up this way stays open ground, a green belt between the works and the homes.
 */
export const NUISANCE_STREET = 0.35, NUISANCE_HOMES = 0.12, NUISANCE_SHOPS = 0.9;

/** How badly the worst plant's smoke and noise reach p: 1 at its fence, 0 at its reach and beyond. */
export function nuisanceAt(p: V2, list: readonly Nuisance[]): number {
  let worst = 0;
  for (const o of list) {
    const far = o.reach + Math.max(o.hw, o.hd) * 1.42;
    const dx = p.x - o.c.x, dy = p.y - o.c.y;
    if (dx * dx + dy * dy >= far * far) continue;
    const d = rectDistance(p, o.c, o.hw, o.hd, o.rot);
    if (d < o.reach) worst = Math.max(worst, 1 - d / o.reach);
  }
  return worst;
}

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
  { name: "Town", pop: 1500, adds: ["goods", "fuel"] },
  { name: "City", pop: 6000, adds: ["electronics", "machinery"] },
  // (later tiers hook in here: a Metropolis adds no needs of its own yet, and keeps a City's at its own scale)
  { name: "Metropolis", pop: 20000, adds: [] },
];

/**
 * Needs that open at their own population rather than with their size: a hamlet of 100 starts building in timber
 * (so the second chain comes early, docs/design.md "Pacing"), a village of 600 in concrete.
 */
export const NEED_FROM: Partial<Record<Product, number>> = { planks: 100, cement: 600 };

export function sizeOf(pop: number): number {
  let s = 0;
  for (let i = 0; i < TOWN_SIZES.length; i++) if (pop >= TOWN_SIZES[i].pop) s = i;
  return s;
}

/** Population a town needs a product from. */
export const needFrom = (p: Product): number => NEED_FROM[p] ?? TOWN_SIZES.find((s) => s.adds.includes(p))?.pop ?? Infinity;

/** Everything a town of this population needs. */
export function needsOf(pop: number): Product[] {
  // (a need opens at its own population, which may come before the size that adds it: planks at 100)
  return TOWN_SIZES.flatMap((s) => s.adds).filter((p) => needFrom(p) <= pop);
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
  return Math.max(1, pop * perHead(p) * Math.pow(1.6, sizeOf(pop)));
}

/** Loads a day of a product each resident of a Hamlet uses (each size up uses 1.6 times as much a head). */
function perHead(p: Product): number {
  // (a new need starts lighter per resident than the old staples: a Town wants about 64 loads a day of goods and of
  // fuel, a City several hundred; a new City about 250 of electronics and 175 of machinery)
  const per: Partial<Record<Product, number>> = {
    food: 1 / 8, planks: 1 / 20, cement: 1 / 30, goods: 1 / 60, fuel: 1 / 60, electronics: 1 / 100, machinery: 1 / 140,
    // (the extras: a Village of 300 takes ~24 loads of milk a day and ~10 of cheese; a new Town ~25 of cars)
    milk: 1 / 20, cheese: 1 / 50, cars: 1 / 150,
  };
  return per[p] ?? 1 / 24;
}

// ------------------------------------------------------------------ extras and cars (docs/design.md "Perishables", "Motor Works")

/**
 * Products a town buys from a population on without needing them to grow: fresh milk and cheese from a Village, motor
 * cars from a Town. They sell like needs (up to MARKET times a day's use) and each one supplied adds a little to the
 * town's growth (COMFORT_BONUS), but none holds it back.
 */
export const EXTRAS: Partial<Record<Product, number>> = { milk: 300, cheese: 300, cars: 1500 };
/** Growth a town gains for each extra it was supplied with (80%+) over the last day, when it grows. */
export const COMFORT_BONUS = 0.06;
/** Everything a town of this population buys that it doesn't need: its extras. */
export const extrasOf = (pop: number): Product[] => (Object.entries(EXTRAS) as [Product, number][]).filter(([, at]) => pop >= at).map(([p]) => p);
/** Does a town of this population buy the product at all (a need or an extra)? */
export const buys = (pop: number, p: Product): boolean => needsOf(pop).includes(p) || extrasOf(pop).includes(p);
/** The growth multiplier from the extras supplied over the last day (1 with none). */
export function comfortOf(delivered: Partial<Record<Product, number>>, pop: number): number {
  let k = 1;
  for (const p of extrasOf(pop)) if ((delivered[p] ?? 0) >= demandPerDay(p, pop) * 0.8) k += COMFORT_BONUS;
  return k;
}

/** Cars in one truckload delivered to a town. */
export const CARS_PER_LOAD = 4;
/** Most a town's motoring can add to the share of its trips driven as real cars (+50%). */
export const MOTOR_MAX = 0.5;
/** Share of its cars a town scraps each day (so it keeps buying to keep its streets full). */
export const CAR_SCRAP = 0.02;
/**
 * How much more a town drives (0..MOTOR_MAX) with the cars the company has sold it: rising with cars per household,
 * full at one new car a household. Its people drive more of their trips and walk less (Society.travel).
 */
export function motoring(cars: number, households: number): number {
  if (households <= 0 || cars <= 0) return 0;
  return MOTOR_MAX * Math.min(1, (cars * CARS_PER_LOAD) / households);
}

/** Share of the last day's needs delivered, 0..1 per need (1 with none). */
export function supplyShare(delivered: Partial<Record<Product, number>>, pop: number): Partial<Record<Product, number>> {
  const out: Partial<Record<Product, number>> = {};
  for (const p of needsOf(pop)) out[p] = Math.min(1, (delivered[p] ?? 0) / demandPerDay(p, pop));
  return out;
}

/** Growth rate (households per resident per day, well supplied) at each size: slowing as a town gets bigger. */
const RATE = [0.09, 0.08, 0.06, 0.045, 0.035];
/**
 * The early boost: a small town grows several times faster than the base rate, fading out by EARLY_TO people, so the
 * first hour moves (docs/design.md "Pacing": something new every few minutes) and the late game is as it was.
 */
export const EARLY = 7, EARLY_TO = 450;
export const earlyBoost = (pop: number): number => 1 + EARLY * Math.max(0, 1 - pop / EARLY_TO);
/** Below this many people a town is still settling: it fills its first streets whether supplied or not. */
export const SETTLING = 60;

/**
 * Households a day a town grows by while its supply supports more people than it has: a hamlet of a few dozen by
 * more than half again a day, a village past 450 by about a fifth, a city ~7%. (It slows as it nears what its supply
 * supports: TownSystem.grow.)
 */
export function growthPerDay(pop: number): number {
  return Math.max(4, pop * RATE[sizeOf(pop)] * earlyBoost(pop) * 1.5);
}

// ------------------------------------------------------------------ steady growth on a proven supply

/**
 * A town grows on the supply it has been getting, not on a lucky hour (owner, 2026-11-08: "it should be 100% sure the
 * supplies will continue before growing", "the last 48h-72h average or something"): its supply is the loads a day
 * of each need delivered over the last SUPPLY_HOURS game hours (two days, 32 minutes at 1x)...
 */
export const SUPPLY_HOURS = 48;
/**
 * ...or, for a supply that began less than two days ago, over the hours since its first load came (the hours before
 * there was any are no shortfall); but over at least SUPPLY_WARMUP hours, so a first truckload alone is never taken
 * for a supply.
 */
export const SUPPLY_WARMUP = 8;
/**
 * It grows only into the people whose needs that supply covers at least this share of (the "supplied" bar of the
 * panels and milestones). The safety is in time rather than quantity: two days of proof before growing, and a long
 * shortfall before shrinking. (Its plants are worked by its own people: a town held to well under what they can
 * make would never grow the hands to make more, measured 2026-11-08.)
 */
export const SUPPLY_COVER = 0.8;
/**
 * It shrinks only after SHRINK_AFTER hours in a row of its supply (the better of the last two days' average and the
 * last day's) covering less than SHRINK_AT of its households (a day without deliveries, a jammed truck, doesn't do
 * it), and then slowly: SHRINK_RATE of its households a day at
 * most, and never below what the supply still covers.
 */
export const SHRINK_AT = 0.85, SHRINK_AFTER = 48, SHRINK_RATE = 0.03;

/** Loads a day of each product delivered, averaged over the hours given (oldest first; see SUPPLY_HOURS). */
export function averageSupply(hours: readonly Partial<Record<Product, number>>[]): Partial<Record<Product, number>> {
  const out: Partial<Record<Product, number>> = {};
  const last = hours.slice(-SUPPLY_HOURS);
  const since: Partial<Record<Product, number>> = {};
  last.forEach((h, i) => {
    for (const [p, n] of Object.entries(h) as [Product, number][]) {
      if (!n) continue;
      out[p] = (out[p] ?? 0) + n;
      since[p] ??= last.length - i;
    }
  });
  for (const p of Object.keys(out) as Product[]) out[p] = (out[p]! * 24) / Math.max(since[p]!, SUPPLY_WARMUP);
  return out;
}

/**
 * A supply that covers a size's people all the way to the next size line carries the town this far past it, on the
 * appetite it had (each size eats 1.6x a head, so without this a town would have to prove the bigger size's supply
 * before it could become it). Past that, it grows on the new size's appetite. It doesn't shrink back over the line:
 * the same supply that carried it there is still what supportOf's floor counts.
 */
export const CROSS = 1.03;

/** The most people whose needs a supply of a product (loads a day) covers SUPPLY_COVER of, each size using more a head. */
export function supportedPop(p: Product, perDay: number): number {
  const loads = perDay / SUPPLY_COVER;
  let best = 0;
  for (let s = 0; s < TOWN_SIZES.length; s++) {
    const lo = TOWN_SIZES[s].pop, hi = TOWN_SIZES[s + 1]?.pop ?? Infinity;
    const x = Math.floor(loads / (perHead(p) * Math.pow(1.6, s)) + 1e-6);
    if (x >= lo) best = Math.max(best, x >= hi ? Math.ceil(hi * CROSS) : x);
  }
  return best;
}

/**
 * What a town's supply (loads a day of each need, averageSupply) supports at its population: `pop`, the most people it
 * grows to, set by the need `by`; and `floor`, the fewest a shortfall would shrink it to. A need that opens on the
 * way up doesn't hold it back before it opens (it couldn't be bought), and once open, being short of it holds the
 * town where it is rather than shrinking it below the population the need opened at; nor does a need opened ahead
 * of the town's size (a hamlet's planks) ever shrink it.
 */
export function supportOf(perDay: Partial<Record<Product, number>>, pop: number): { pop: number; floor: number; by: Product | null } {
  let cap = Infinity, floor = Infinity, by: Product | null = null;
  const size = sizeOf(pop);
  for (const p of needsOf(pop)) {
    const x = supportedPop(p, perDay[p] ?? 0);
    if (x < cap) { cap = x; by = p; }
    if (TOWN_SIZES.findIndex((s) => s.adds.includes(p)) <= size) floor = Math.min(floor, Math.max(x, needFrom(p)));
  }
  return { pop: cap, floor, by };
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

/**
 * Radius the streets may reach for a population. Towns spread out (owner, 2026-11-08: "less dense overall, more of
 * an outward expansion"): about a third further than the old packed grids for the same people.
 */
export function townRadius(pop: number): number {
  return Math.min(2200, 200 + 12 * Math.sqrt(pop));
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
 * The next street to lay: a lattice edge touching the streets already built, inside the radius, not tried and
 * failed before. Edges that close a block (both ends already on a street) come first, then the ones nearest the
 * centre, so the town fills in block by block and spreads in a rough circle. `rOf` is how far a node is from the
 * centre in blocks, where the town's plan puts it (townplan.ts; the plain grid by default).
 */
export function nextEdge(
  built: Set<string>, failed: Set<string>, radiusBlocks: number, jitter: (k: string) => number, cost?: (e: GridEdge) => number,
  rOf: (i: number, j: number) => number = Math.hypot,
): GridEdge | null {
  const nodes = new Set<string>();
  for (const k of built) for (const n of k.split("|")) nodes.add(n);
  let best: GridEdge | null = null, bs = Infinity;
  for (const n of nodes) {
    const [i, j] = n.split(",").map(Number);
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const e: GridEdge = [i, j, i + di, j + dj];
      const k = edgeKey(e);
      if (built.has(k) || failed.has(k)) continue;
      // (how far out it is, by where the town's plan puts its nodes: blocks from the centre)
      const far = rOf(i + di, j + dj);
      if (far > radiusBlocks) continue;
      const r = (rOf(i, j) + far) / 2;
      const closes = nodes.has(`${i + di},${j + dj}`);
      // (cost: how much the land puts a town off, in blocks; Infinity where it won't build at all)
      const extra = cost ? cost(e) : 0;
      if (extra === Infinity) continue;
      const s = r - (closes ? 1.5 : 0) + jitter(k) * 0.8 + extra;
      if (s < bs) { bs = s; best = e; }
    }
  }
  return best;
}
