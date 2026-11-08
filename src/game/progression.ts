// Milestones (docs/design.md, "Milestones"): concrete achievements in a rough ladder, never accumulated XP. A few
// are open at once (the first OPEN_AT_ONCE not yet reached, in ladder order), so there is always a choice of what
// next; reaching one opens the next. Each unlocks something concrete: a building, a road type or tool, a fresh
// town that springs up by itself (the player never founds one), bigger truck classes, the next level for named kinds
// of site, or a grant. There is no land to buy: the company builds anywhere its roads reach, and the deposits of each
// tier, kilometres apart, are what open the map up. The company starts with tier 1 (farms, logging camps, food plants,
// sawmills), its first hamlet and the basic roads. The new towns come as the towns there are grow (a hamlet of 150,
// two villages, a big village, a Town, a Town supplied, a market town, a City...), each further out than the last.

import type { RoadTypeId } from "../config";
import { PLANTS, type PlantKind, type Product } from "./industry";
import type { PlacedKind } from "./placed";
import { needsOf, sizeOf } from "./towns";
import type { TruckClass } from "./trucks";

export type Feature = "roundabout" | "signals" | "parallel" | "transit";

export interface Unlocks {
  roads?: RoadTypeId[];
  features?: Feature[];
  buildings?: PlacedKind[];
  /** fresh towns that spring up when it is reached (far from the others, unconnected: settlements.ts spawn) */
  towns?: number;
  /**
   * The level these kinds of site may now grow to (a site grows itself, up to the level its kind is cleared for: see
   * levelCap). Fleets and loads come from a site's level and the truck classes, never from a milestone.
   */
  levels?: { kinds: PlantKind[]; to: number };
  /** truck classes the buildings may run (see trucks.ts) */
  trucks?: TruckClass[];
  /** money paid on reaching it */
  grant?: number;
}

/** What a milestone is measured on (kept by Progress and the game). */
export interface ProgressView {
  towns: { pop: number; supply: Partial<Record<Product, number>> }[];
  /** loads made, all time */
  made: Partial<Record<Product, number>>;
  /** loads delivered to towns: all time, and the best single day (today included) */
  sold: Partial<Record<Product, number>>;
  bestDay: Partial<Record<Product, number>>;
  /** sales: the best day's takings (today included) */
  bestEarned: number;
  /** buildings that need power and get all of it */
  powered: number;
  /** oversized pieces delivered by convoy, all time, and landmarks finished (convoys.ts, megaprojects.ts) */
  pieces?: number;
  landmarks?: number;
}

export interface Milestone {
  id: string;
  name: string;
  /** what to do, as a sentence */
  goal: string;
  /** how far along: [have, need] */
  measure(v: ProgressView): [number, number];
  /** the measure is money */
  money?: boolean;
  unlocks: Unlocks;
}

/** What a company has before any milestone. */
export const BASE: Required<Pick<Unlocks, "roads" | "features">> = {
  // (the one- and two-lane highways too: hauls between deposits kilometres apart want them from the start)
  roads: ["street", "one1", "hw1", "hw2"],
  features: ["parallel"],
};

/** The level a site of a kind some milestone clears for more may grow to before that milestone. */
export const FIRST_CAP = 2;

/** How many milestones are open at once. */
export const OPEN_AT_ONCE = 3;

/** Every need of a town's size supplied over the last full day (at least 80% of each). */
/** A town gets at least 80% of each of its needs (of only these products, when given). */
export const fullySupplied = (t: ProgressView["towns"][number], only?: Product[]) =>
  needsOf(t.pop).every((p) => (only && !only.includes(p)) || (t.supply[p] ?? 0) >= 0.8);

const n = (o: Partial<Record<Product, number>>, p: Product) => o[p] ?? 0;
const biggest = (v: ProgressView) => v.towns.reduce((a, t) => Math.max(a, t.pop), 0);
const allSold = (v: ProgressView) => Object.values(v.sold).reduce((a: number, k) => a + (k ?? 0), 0);
/** Towns of at least this size (TOWN_SIZES index). */
const ofSize = (v: ProgressView, size: number) => v.towns.filter((t) => sizeOf(t.pop) >= size).length;

/**
 * The ladder (docs/design.md "Milestones", trimmed 2026-11-08 from 54 to 20: "some goals and objectives are just
 * weird, let's trim them down a lot"). Each one is a real step: a town size, a chain's first load, a town kept
 * supplied, a landmark. What the micro-goals cut then unlocked (Market day, Lights on, Village supplied, Concrete,
 * Building boom...) comes with the step nearest where it used to (see RETIRED), and their grants with it.
 */
export const MILESTONES: Milestone[] = [
  // ---------------------------------------------------------------- tier 1: food and timber, the first hamlet
  {
    id: "food10", name: "First customers", goal: "Deliver 10 loads of food to your towns",
    measure: (v) => [n(v.sold, "food"), 10],
    unlocks: { roads: ["avenue", "one2"], grant: 5000 },
  },
  {
    // (the first new town springs up a short drive away, as the start hamlet is getting going)
    id: "hamlet150", name: "Growing hamlet", goal: "Grow a town to 150 people",
    measure: (v) => [biggest(v), 150],
    unlocks: { features: ["roundabout"], roads: ["streetM"], towns: 1 },
  },
  {
    // (tier 2 opens whole: the iron mine, coal mine, power plant and smelter of the steel chain)
    id: "village", name: "Village", goal: "Grow a town to Village size: 300 people",
    measure: (v) => [biggest(v), 300],
    unlocks: { buildings: ["ironmine", "coalmine", "coalplant", "smelter"], trucks: ["heavy"], grant: 80000 },
  },
  {
    id: "planks10", name: "Sawn timber", goal: "Saw 10 loads of planks",
    measure: (v) => [n(v.made, "planks"), 10],
    unlocks: { levels: { kinds: ["loggingcamp", "sawmill", "foodplant"], to: 3 }, features: ["signals"] },
  },
  // ---------------------------------------------------------------- tier 2: steel and cement
  {
    // (a volume of trade rather than "Village supplied", cut: that one was met the moment a well-fed hamlet grew to a
    // village, a step nobody took. This one comes a good half day after the Village, and its grant with it, which
    // pays for the coal mine and power plant the Village opened. The id is the old "Heavy haulage", which counted
    // the same; its heavy trucks now come with the Village)
    id: "heavy", name: "Steady trade", goal: "Deliver 150 loads to your towns in all",
    measure: (v) => [allSold(v), 150],
    unlocks: { buildings: ["quarry", "cementworks"], grant: 30000 },
  },
  {
    id: "steel", name: "First steel", goal: "Make your first load of steel",
    measure: (v) => [n(v.made, "steel"), 1],
    unlocks: { roads: ["one3", "avenueM"], levels: { kinds: ["coalplant"], to: 3 }, grant: 20000 },
  },
  {
    id: "cement", name: "First cement", goal: "Make your first load of cement",
    measure: (v) => [n(v.made, "cement"), 1],
    unlocks: { features: ["transit"], buildings: ["warehouse"], levels: { kinds: ["cementworks", "smelter"], to: 3 } },
  },
  {
    // (the villages buy fresh milk: the dairy opens as the second one grows)
    id: "villages2", name: "Two villages", goal: "Grow two towns to Village size: 300 people",
    measure: (v) => [ofSize(v, 1), 2],
    unlocks: { towns: 1, roads: ["boulevard", "boulevardM"], buildings: ["dairyfarm", "creamery"], grant: 10000 },
  },
  // ---------------------------------------------------------------- tier 3: fuel, household goods, construction parts
  {
    // (a town wants fuel and goods from 1,500: their chains open while it is still on its way there)
    id: "pop1000", name: "Big village", goal: "Grow a town to 1,000 people",
    measure: (v) => [biggest(v), 1000],
    unlocks: { buildings: ["oilwell", "refinery", "sandpit", "glassworks", "furniture"], towns: 1, grant: 30000 },
  },
  {
    id: "fuel1", name: "First fuel", goal: "Refine your first load of fuel",
    measure: (v) => [n(v.made, "fuel"), 1],
    unlocks: { buildings: ["fueldepot"], levels: { kinds: ["refinery"], to: 3 }, grant: 25000 },
  },
  {
    // (from here a town's new blocks wait for construction parts)
    id: "goods1", name: "Home comforts", goal: "Make your first load of household goods",
    measure: (v) => [n(v.made, "goods"), 1],
    unlocks: { buildings: ["constructionplant"], levels: { kinds: ["glassworks", "furniture"], to: 3 }, grant: 25000 },
  },
  {
    // (the chemical works' fertilizer and explosives are what farms and mines need past level 2)
    id: "town", name: "Town", goal: "Grow a town to Town size: 1,500 people",
    measure: (v) => [biggest(v), 1500],
    unlocks: { towns: 2, trucks: ["roadtrain"], roads: ["one4"], buildings: ["chemworks"], grant: 50000 },
  },
  {
    id: "townSupplied", name: "Town supplied", goal: "Keep a Town of 1,500+ in everything it needs for a day",
    measure: (v) => [v.towns.some((t) => sizeOf(t.pop) >= 2 && fullySupplied(t)) ? 1 : 0, 1],
    unlocks: { towns: 1, levels: { kinds: ["constructionplant", "chemworks", "creamery"], to: 3 }, grant: 140000 },
  },
  // ---------------------------------------------------------------- tier 4: copper, electronics and machinery
  {
    // (tier 4 opens whole while the towns are still Towns, so the chains a City needs are running when one gets
    // there; the copper deposits lie 10-20 km out in the high ranges)
    id: "pop4000", name: "Market town", goal: "Grow a town to 4,000 people",
    measure: (v) => [biggest(v), 4000],
    unlocks: { buildings: ["coppermine", "coppersmelter", "electronics", "machineworks"], towns: 2, grant: 230000 },
  },
  {
    id: "city", name: "City", goal: "Grow a town to City size: 6,000 people",
    measure: (v) => [biggest(v), 6000],
    unlocks: { towns: 2, levels: { kinds: ["coppersmelter"], to: 3 }, grant: 100000 },
  },
  {
    id: "machinery1", name: "Heavy industry", goal: "Build your first load of machinery",
    measure: (v) => [n(v.made, "machinery"), 1],
    unlocks: { levels: { kinds: ["farm", "foodplant", "loggingcamp", "sawmill", "electronics", "machineworks"], to: 4 }, grant: 80000 },
  },
  {
    id: "citySupplied", name: "City supplied", goal: "Keep a City of 6,000+ in everything it needs for a day",
    measure: (v) => [v.towns.some((t) => sizeOf(t.pop) >= 3 && fullySupplied(t)) ? 1 : 0, 1],
    unlocks: {
      towns: 2, grant: 150000,
      levels: {
        kinds: ["ironmine", "coalmine", "quarry", "smelter", "cementworks", "coalplant", "dairyfarm", "creamery", "oilwell", "sandpit", "refinery",
          "glassworks", "furniture", "constructionplant", "chemworks", "coppermine", "coppersmelter"],
        to: 4,
      },
    },
  },
  // ---------------------------------------------------------------- landmarks (docs/design.md "Landmarks"), then tier 5
  {
    // (the machine works ships its first oversized piece: the dam and the tower both take them)
    id: "bigiron", name: "Oversized load", goal: "Ship your first oversized piece by convoy",
    measure: (v) => [v.pieces ?? 0, 1],
    unlocks: { buildings: ["hydrodam", "skylinetower"], grant: 130000 },
  },
  {
    // (the fair shows off the motor age: the rubber plant and the Motor Works open with it)
    id: "worldsfair", name: "World's fair", goal: "Finish a landmark",
    measure: (v) => [v.landmarks ?? 0, 1],
    unlocks: { buildings: ["exposition", "rubberplant", "motorworks"], towns: 1, grant: 300000 },
  },
  {
    // (the top of the ladder for now: every car sold is more traffic)
    id: "cars1", name: "Motor age", goal: "Deliver your first load of cars to a town",
    measure: (v) => [n(v.sold, "cars"), 1],
    unlocks: { towns: 1, levels: { kinds: ["rubberplant", "motorworks"], to: 4 }, grant: 100000 },
  },
];

export const milestoneById = new Map(MILESTONES.map((m) => [m.id, m]));
/** Milestones renamed since a save was made: the old id stands for the new one (towns used to be founded by slot). */
export const RENAMED: Record<string, string> = { town2: "hamlet150", towns3: "villages2", towns5: "villages3" };
/**
 * Milestones cut from the ladder (2026-11-08), each with the kept one that now carries what it unlocked. A save that
 * reached one keeps those unlocks (Progress.legacy) without being marked as having reached the kept one: that is
 * still there to reach, with its grant and its towns.
 */
export const RETIRED: Record<string, string> = {
  food20: "village", powered3: "steel", supplied: "heavy", dairy: "villages2", milk1: "villages2", warehouse: "cement",
  cement20: "cement", supplied2: "villages2", trade20k: "townSupplied", planks30: "pop1000", depot: "fuel1",
  food60: "town", cement30: "goods1", chemworks: "town", supplies20: "townSupplied", roadtrain: "town",
  parts1: "townSupplied", villages3: "townSupplied", fuel30: "fuel1", goods30: "townSupplied", parts20: "goods1",
  trade100k: "pop4000", towns2town: "pop4000", parts50: "pop4000", copperore1: "pop4000", goods60: "pop4000",
  copper1: "pop4000", electronics1: "machinery1", electronics40: "citySupplied", machinery40: "citySupplied",
  skyline: "bigiron", rubber: "worldsfair", motorworks: "worldsfair", cars30: "cars1",
};

/** The milestone that unlocks something, if one does. */
export const unlockedBy = (test: (u: Unlocks) => boolean | undefined): Milestone | undefined => MILESTONES.find((m) => test(m.unlocks));

/** Everything a set of reached milestones adds up to, with the start's. */
export interface Unlocked {
  roads: Set<RoadTypeId>;
  features: Set<Feature>;
  buildings: Set<PlacedKind>;
  trucks: Set<TruckClass>;
  /** the level each kind of site is cleared to grow to, for the kinds a milestone clears (see levelCap) */
  levels: Map<PlantKind, number>;
}

/**
 * Kinds of site some milestone clears for a higher level, and the level they stop at until one does: one below the
 * first level a milestone names for them. Most stop at FIRST_CAP; the farms, mines, wells and pits name only level 4,
 * as their level 3 waits on the chemical works' fertilizer or explosives (their supplies) instead.
 */
const CAPPED = new Map<PlantKind, number>();
for (const m of MILESTONES) for (const k of m.unlocks.levels?.kinds ?? []) CAPPED.set(k, Math.min(CAPPED.get(k) ?? Infinity, m.unlocks.levels!.to - 1));

/** The level a site of a kind may grow to with these unlocks (a kind no milestone names grows to the top). */
export const levelCap = (u: Unlocked, kind: PlantKind, top: number): number => {
  const floor = CAPPED.get(kind);
  return floor === undefined ? top : Math.min(top, Math.max(floor, u.levels.get(kind) ?? 0));
};

/** The milestone that clears a kind of site for a level, if one does. */
export const levelBy = (kind: PlantKind, level: number): Milestone | undefined =>
  MILESTONES.find((m) => !!m.unlocks.levels && m.unlocks.levels.to >= level && m.unlocks.levels.kinds.includes(kind));

export function unlocksOf(done: Iterable<string>): Unlocked {
  const u: Unlocked = {
    roads: new Set(BASE.roads), features: new Set(BASE.features),
    buildings: new Set((Object.keys(PLANTS) as PlacedKind[]).filter((k) => PLANTS[k].tier === 1)),
    trucks: new Set<TruckClass>(["light"]), levels: new Map(),
  };
  for (const id of done) {
    const m = milestoneById.get(id)?.unlocks;
    if (!m) continue;
    for (const r of m.roads ?? []) u.roads.add(r);
    for (const f of m.features ?? []) u.features.add(f);
    for (const b of m.buildings ?? []) u.buildings.add(b);
    for (const t of m.trucks ?? []) u.trucks.add(t);
    if (m.levels) for (const k of m.levels.kinds) u.levels.set(k, Math.max(u.levels.get(k) ?? 0, m.levels.to));
  }
  return u;
}

export interface ProgressJSON {
  done: string[];
  made: Partial<Record<Product, number>>;
  sold: Partial<Record<Product, number>>;
  today: Partial<Record<Product, number>>;
  bestDay: Partial<Record<Product, number>>;
  earnedToday: number;
  bestEarned: number;
  /** oversized pieces delivered (saves from before convoys have none) */
  pieces?: number;
  /** the towns each milestone brought (saves from before towns sprang up have none) */
  spawned?: Record<string, number[]>;
  /** kept milestones whose unlocks the save holds from goals since cut (see RETIRED) */
  legacy?: string[];
}

/** The company's record: milestones reached, in order, and the tallies they are measured on. */
export class Progress {
  done: string[] = [];
  made: Partial<Record<Product, number>> = {};
  sold: Partial<Record<Product, number>> = {};
  /** loads delivered to towns today, and the best day so far (whole days) */
  today: Partial<Record<Product, number>> = {};
  bestDay: Partial<Record<Product, number>> = {};
  earnedToday = 0;
  bestEarned = 0;
  /** oversized pieces delivered by convoy, all time */
  pieces = 0;
  /** the towns that sprang up for each milestone (town ids) */
  spawned: Record<string, number[]> = {};
  /**
   * Kept milestones not reached whose unlocks a save made before the 2026-11-08 trim already had, from a goal since
   * cut (RETIRED): they count toward what is unlocked, never as reached.
   */
  legacy: string[] = [];
  private cache: { n: number; u: Unlocked } | null = null;

  isDone(id: string): boolean {
    return this.done.includes(id);
  }

  /** The milestones open now: the first few not yet reached, in ladder order. */
  open(): Milestone[] {
    return MILESTONES.filter((m) => !this.isDone(m.id)).slice(0, OPEN_AT_ONCE);
  }

  get unlocked(): Unlocked {
    if (this.cache?.n !== this.done.length) this.cache = { n: this.done.length, u: unlocksOf([...this.done, ...this.legacy]) };
    return this.cache.u;
  }

  onMade(p: Product, k: number) {
    this.made[p] = (this.made[p] ?? 0) + k;
  }

  onSold(p: Product, k: number) {
    this.sold[p] = (this.sold[p] ?? 0) + k;
    this.today[p] = (this.today[p] ?? 0) + k;
  }

  onPiece() {
    this.pieces++;
  }

  onEarned(v: number) {
    this.earnedToday += v;
  }

  /** The view milestones measure, with today's figures counting toward the best day. */
  view(towns: ProgressView["towns"], powered: number): ProgressView {
    const bestDay: Partial<Record<Product, number>> = { ...this.bestDay };
    for (const [p, k] of Object.entries(this.today) as [Product, number][]) bestDay[p] = Math.max(bestDay[p] ?? 0, k);
    return { towns, made: this.made, sold: this.sold, bestDay, bestEarned: Math.max(this.bestEarned, this.earnedToday), powered, pieces: this.pieces };
  }

  /** Reach every open milestone whose goal is met (and any it opens that are met too). Returns those reached. */
  check(v: ProgressView): Milestone[] {
    const out: Milestone[] = [];
    for (let guard = 0; guard < MILESTONES.length; guard++) {
      const m = this.open().find((x) => { const [have, need] = x.measure(v); return have >= need; });
      if (!m) break;
      this.done.push(m.id);
      out.push(m);
    }
    return out;
  }

  /** A day is over: today's figures become a candidate for the best day. */
  daily() {
    for (const [p, k] of Object.entries(this.today) as [Product, number][]) this.bestDay[p] = Math.max(this.bestDay[p] ?? 0, k);
    this.bestEarned = Math.max(this.bestEarned, this.earnedToday);
    this.today = {};
    this.earnedToday = 0;
  }

  /** Everything reached at once (for tools and tests that need every unlock). */
  completeAll() {
    for (const m of MILESTONES) if (!this.isDone(m.id)) this.done.push(m.id);
  }

  toJSON(): ProgressJSON {
    return { done: [...this.done], made: { ...this.made }, sold: { ...this.sold }, today: { ...this.today }, bestDay: { ...this.bestDay }, earnedToday: this.earnedToday, bestEarned: this.bestEarned, pieces: this.pieces, spawned: { ...this.spawned }, ...(this.legacy.length ? { legacy: [...this.legacy] } : {}) };
  }

  load(d: ProgressJSON) {
    // (ids from before the trim: a cut goal is dropped, and what it unlocked stays unlocked through the kept one
    // that carries it now; that one is still there to reach)
    const ids = d.done.map((id) => RENAMED[id] ?? id);
    this.done = [...new Set(ids.filter((id) => milestoneById.has(id)))];
    const carried = [...(d.legacy ?? []), ...ids.map((id) => RETIRED[id]).filter((id): id is string => !!id)];
    this.legacy = [...new Set(carried)].filter((id) => milestoneById.has(id) && !this.done.includes(id));
    this.made = { ...d.made };
    this.sold = { ...d.sold };
    this.today = { ...d.today };
    this.bestDay = { ...d.bestDay };
    this.earnedToday = d.earnedToday;
    this.bestEarned = d.bestEarned;
    this.pieces = d.pieces ?? 0;
    this.spawned = { ...(d.spawned ?? {}) };
    this.cache = null;
  }
}
