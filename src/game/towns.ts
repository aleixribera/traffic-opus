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
 * How a town's use of a product climbs with its people (owner, 2026-11-10: "the lower level demands grow too much on
 * larger cities, and the focus should go instead to getting those new resources"). Each product has its own size: the
 * one that added it (an extra's: the size it is first bought at). Through that size it ramps up from `at` loads a day
 * where it opens to `top` at the next size line, faster than the town grows: the new need is the big ask of its size.
 * Past that line it is an old staple, bought in bulk, partly grown or made in town: it still climbs, but only as
 * people to the power `then` (well under 1), so it gets lighter a head at every size after.
 *
 * Loads a day it comes to (pop 300 / 1,500 / 6,000 / 15,000):
 *   food    18 / 46 / 102 / 174     planks 6 / 30 / 52 / 75     cement - / 26 / 45 / 65
 *   goods    - /  8 / 105 / 159     fuel   - /  7 / 95 / 144
 *   electronics - / - / 26 / 176    machinery - / - / 20 / 145
 * A Village of 300 wants 24 loads a day in all, a Town of 1,500 about 117, a City of 6,000 about 450 and of 15,000
 * about 940: fewer a head at every size (0.080, 0.078, 0.074, 0.062). From halfway through each size on, most of the
 * loads its growth adds are its own new needs, and by its end they are the biggest part of what it wants.
 */
interface Curve { at: number; top: number; then: number }
const CURVES: Partial<Record<Product, Curve>> = {
  // (food, a Hamlet's own need, is plain per head through the Hamlet: 0.06 a head, 18 loads at 300)
  food: { at: 0, top: 18, then: 0.58 },
  planks: { at: 2, top: 30, then: 0.4 },
  cement: { at: 6, top: 26, then: 0.4 },
  goods: { at: 8, top: 105, then: 0.45 },
  fuel: { at: 7, top: 95, then: 0.45 },
  electronics: { at: 26, top: 320, then: 0.45 },
  machinery: { at: 20, top: 270, then: 0.45 },
  // (the extras: a Village of 300 takes 5 loads of milk a day and 2 of cheese; a new Town 3 of cars, 28 by City size)
  milk: { at: 5, top: 20, then: 0.45 },
  cheese: { at: 2, top: 8, then: 0.45 },
  cars: { at: 3, top: 28, then: 0.45 },
};
/** Anything else a town buys: a mild staple. */
const OTHER: Curve = { at: 2, top: 12, then: 0.45 };

/** Where a product's curve runs: from the population it opens at to the next size line after it (its own size). */
function span(p: Product): { from: number; to: number; c: Curve } {
  const from = EXTRAS[p] ?? (Number.isFinite(needFrom(p)) ? needFrom(p) : 0);
  // (a need's own size is the one that adds it, even when it opens earlier: a hamlet's planks ramp up to 1,500)
  const added = TOWN_SIZES.findIndex((s) => s.adds.includes(p));
  const to = TOWN_SIZES[(added >= 0 ? added : sizeOf(from)) + 1]?.pop ?? from * 2;
  return { from, to, c: CURVES[p] ?? OTHER };
}

/** Loads a day of a product a town of `pop` uses, before the floor of one load. */
function useOf(p: Product, pop: number): number {
  const { from, to, c } = span(p);
  if (pop >= to) return c.top * Math.pow(pop / to, c.then);
  // (from nothing, a plain share a head; below where it opens, the same share as at its opening)
  if (from <= 0 || c.at <= 0) return (c.top * pop) / to;
  if (pop <= from) return (c.at * pop) / from;
  return c.at * Math.pow(pop / from, Math.log(c.top / c.at) / Math.log(to / from));
}

/** The population whose use of a product is `loads` a day (useOf turned round; it climbs all the way). */
function popFor(p: Product, loads: number): number {
  const { from, to, c } = span(p);
  if (loads >= c.top) return to * Math.pow(loads / c.top, 1 / c.then);
  if (from <= 0 || c.at <= 0) return (loads * to) / c.top;
  if (loads <= c.at) return (loads * from) / c.at;
  return from * Math.pow(loads / c.at, Math.log(to / from) / Math.log(c.top / c.at));
}

/** Truckloads of a product a town uses per day (at least one): see CURVES. */
export function demandPerDay(p: Product, pop: number): number {
  return Math.max(1, useOf(p, pop));
}

// ------------------------------------------------------------------ extras and cars (docs/design.md "Perishables", "Motor Works")

/**
 * Products a town buys from a population on without needing them to grow: fresh milk and cheese from a Village, motor
 * cars from a Town. They sell like needs (up to MARKET times a day's use) and each one supplied adds a little to the
 * town's growth (COMFORT_BONUS), but none holds it back.
 */
export const EXTRAS: Partial<Record<Product, number>> = { milk: 300, cheese: 300, cars: 1500 };
/** Growth a town gains for each extra it was supplied with (GROW_FROM and up) over the last day, when it grows. */
export const COMFORT_BONUS = 0.06;
/** Everything a town of this population buys that it doesn't need: its extras. */
export const extrasOf = (pop: number): Product[] => (Object.entries(EXTRAS) as [Product, number][]).filter(([, at]) => pop >= at).map(([p]) => p);
/** Does a town of this population buy the product at all (a need or an extra)? */
export const buys = (pop: number, p: Product): boolean => needsOf(pop).includes(p) || extrasOf(pop).includes(p);
/** The growth multiplier from the extras supplied over the last day (1 with none). */
export function comfortOf(delivered: Partial<Record<Product, number>>, pop: number): number {
  let k = 1;
  for (const p of extrasOf(pop)) if ((delivered[p] ?? 0) >= demandPerDay(p, pop) * GROW_FROM) k += COMFORT_BONUS;
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

// ------------------------------------------------------------------ growth in bands, on a proven supply

/**
 * How well a town is supplied decides how it grows (owner, 2026-11-10: "full resources should just be a slow daily
 * increase of population, and barely reaching it should grow very very little, and then have a wide margin for no
 * growth, and then a zone for decreasing"). Its supply level is the share of a day's use it has been getting of its
 * worst-supplied need (supplyLevel, on the two-day average), and:
 * - from GROW_FROM (85%) it grows, very little at first, rising smoothly (growthShare) to its full pace at 100%;
 * - from HOLD_FROM (60%) to GROW_FROM it holds steady: no growth, no loss;
 * - below HOLD_FROM for SHRINK_AFTER hours in a row it shrinks, slowly.
 */
export const GROW_FROM = 0.85, HOLD_FROM = 0.6;
/** The "supplied" bar of the panels and goals: where a town starts to grow. */
export const SUPPLY_COVER = GROW_FROM;

/**
 * Its full pace, with every need met in full: the share of its households a day it grows by at each size. A few
 * percent a day: a Village adds about one home in seventeen a day, a City one in thirty.
 */
const RATE = [0.1, 0.06, 0.045, 0.035, 0.025];
/** People to a household, about (to put a pace in households a day from a population). */
export const PER_HOME = 2.5;
/**
 * The early boost: a hamlet settling its first streets grows up to 21 times faster than a village, fading out by
 * EARLY_TO people, so the first hour moves (docs/design.md "Pacing": a Village in 20 to 30 minutes). Past it a town
 * grows at the plain pace of its size.
 */
export const EARLY = 20, EARLY_TO = 380;
export const earlyBoost = (pop: number): number => 1 + EARLY * Math.max(0, 1 - pop / EARLY_TO);
/** Below this many people a town is still settling: it fills its first streets whether supplied or not. */
export const SETTLING = 60;

/**
 * Households a day a town grows by with every need met in full (at least one): a hamlet of 80 by one and two thirds
 * households for every one it has (a Village in about 20 minutes at 1x), a Village of 300 by a third of its homes,
 * past 380 a Village by 6% a day, a Town 4.5%, a City 3.5% (a size in six to eight hours at 1x).
 */
export function growthPerDay(pop: number): number {
  return Math.max(1, (pop / PER_HOME) * RATE[sizeOf(pop)] * earlyBoost(pop));
}

/**
 * The share of its full pace a town grows at, on its supply level: none up to GROW_FROM, then rising as the square of
 * the way from GROW_FROM to 100% (90% supplied grows at a ninth of the pace, 95% at four ninths), all of it from 100%.
 */
export function growthShare(level: number): number {
  if (level >= 1) return 1;
  if (level <= GROW_FROM) return 0;
  const x = (level - GROW_FROM) / (1 - GROW_FROM);
  return x * x;
}

/**
 * The band a town's growth is in: "fast" at its full pace (100% supplied and over), "slow" from GROW_FROM, "hold"
 * from HOLD_FROM, and below that "hold" too until its shortfall has lasted SHRINK_AFTER hours (`shrinking`), then
 * "shrink".
 */
export type GrowthBand = "fast" | "slow" | "hold" | "shrink";
export function growthBand(level: number, shrinking = false): GrowthBand {
  return level >= 1 ? "fast" : level > GROW_FROM ? "slow" : level < HOLD_FROM && shrinking ? "shrink" : "hold";
}

/**
 * A town's growth in one plain line, with its supply level as the panel can show it: "Growing: fully supplied",
 * "Growing slowly: 92% supplied, full pace from 100%", "Holding steady: 72% supplied, grows from 85%", "Short of
 * supplies: 48% supplied, holds from 60%" and, once a shortfall has lasted (`shrinking`), "Shrinking: 48% supplied,
 * holds from 60%". A town still settling its first streets: "Settling in".
 */
export function growthLine(level: number, pop: number, shrinking = false): string {
  if (pop < SETTLING) return "Settling in";
  const pc = (x: number) => `${Math.floor(x * 100 + 1e-6)}%`;
  if (level < HOLD_FROM) return `${shrinking ? "Shrinking" : "Short of supplies"}: ${pc(level)} supplied, holds from ${pc(HOLD_FROM)}`;
  switch (growthBand(level)) {
    case "fast": return "Growing: fully supplied";
    case "slow": return `Growing slowly: ${pc(level)} supplied, full pace from 100%`;
    default: return `Holding steady: ${pc(level)} supplied, grows from ${pc(GROW_FROM)}`;
  }
}

/**
 * A town's supply level: the share of a day's use it has been getting of its worst-supplied need (loads a day,
 * averageSupply), and that need (null with none). `only` limits it to some of its needs.
 */
export function supplyLevel(
  perDay: Partial<Record<Product, number>>, pop: number, only?: (p: Product) => boolean,
): { level: number; by: Product | null } {
  let level = Infinity, by: Product | null = null;
  for (const p of needsOf(pop)) {
    if (only && !only(p)) continue;
    const x = (perDay[p] ?? 0) / demandPerDay(p, pop);
    if (x < level) { level = x; by = p; }
  }
  return { level: by ? level : 1, by };
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
 * It shrinks only after SHRINK_AFTER hours in a row of its supply level (on the better of the last two days' average
 * and the last day's) below HOLD_FROM (a day without deliveries, a jammed truck, doesn't do it), and then slowly:
 * SHRINK_RATE of its households a day at most, and never below the people its supply still covers HOLD_FROM of.
 */
export const SHRINK_AFTER = 48, SHRINK_RATE = 0.03;

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
 * The most people whose use of a product a supply (loads a day) covers `cover` of: GROW_FROM by default, where a
 * town stops growing.
 */
export function supportedPop(p: Product, perDay: number, cover = GROW_FROM): number {
  if (perDay <= 0) return 0;
  return Math.floor(popFor(p, perDay / cover) + 1e-6);
}

/** Does a shortfall of a need count toward shrinking a town of this population (not one opened ahead of its size)? */
export const countsForShrinking = (p: Product, pop: number): boolean => TOWN_SIZES.findIndex((s) => s.adds.includes(p)) <= sizeOf(pop);

/**
 * What a town's supply (loads a day of each need, averageSupply) supports at its population: `pop`, the people it
 * grows toward (where the supply would cover GROW_FROM of every need), set by the need `by`; and `floor`, the fewest
 * a lasting shortfall would shrink it to (where it would cover HOLD_FROM). A need that opens on the way up doesn't
 * hold it back before it opens (it couldn't be bought), and once open, being short of it holds the town where it is
 * rather than shrinking it below the population the need opened at; nor does a need opened ahead of the town's size
 * (a hamlet's planks) ever shrink it.
 */
export function supportOf(perDay: Partial<Record<Product, number>>, pop: number): { pop: number; floor: number; by: Product | null } {
  let cap = Infinity, floor = Infinity, by: Product | null = null;
  for (const p of needsOf(pop)) {
    const x = supportedPop(p, perDay[p] ?? 0);
    if (x < cap) { cap = x; by = p; }
    if (countsForShrinking(p, pop)) floor = Math.min(floor, Math.max(supportedPop(p, perDay[p] ?? 0, HOLD_FROM), needFrom(p)));
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
