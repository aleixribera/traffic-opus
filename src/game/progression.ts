// Milestones (docs/design.md, "Milestones"): concrete achievements in a rough ladder, never accumulated XP. A few
// are open at once (the first OPEN_AT_ONCE not yet reached, in ladder order), so there is always a choice of what
// to chase next; reaching one opens the next. Each unlocks something concrete: a building, a road type or tool,
// town slots, truck bays, bigger loads, bigger trucks or a grant. There is no land to buy: the company builds anywhere
// its roads reach, and the deposits of each tier, kilometres apart, are what open the map up. The company starts with
// tier 1 (farms, logging camps, food plants, sawmills), founding towns and the basic roads. This ladder covers tiers 1
// to 4: copper, electronics and machinery open on the way to a City (which needs them) and its last steps reward a City
// supplied and tier 4 volume.

import type { RoadTypeId } from "../config";
import { PLANTS, type Product } from "./industry";
import type { PlacedKind } from "./placed";
import { needsOf, sizeOf } from "./towns";
import type { TruckClass } from "./trucks";

export type Feature = "roundabout" | "signals" | "parallel" | "transit";

export interface Unlocks {
  roads?: RoadTypeId[];
  features?: Feature[];
  buildings?: PlacedKind[];
  /** more towns it may run */
  towns?: number;
  /** a truck bay more at every building */
  bays?: number;
  /** a load more on every truck */
  load?: number;
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
export const BASE: Required<Pick<Unlocks, "roads" | "features" | "towns">> & { bays: number; load: number } = {
  // (the one- and two-lane highways too: hauls between deposits kilometres apart want them from the start)
  roads: ["street", "one1", "hw1", "hw2"],
  features: ["parallel"],
  towns: 2,
  bays: 0,
  load: 1,
};

/** How many milestones are open at once. */
export const OPEN_AT_ONCE = 3;

/** Every need of a town's size supplied over the last full day (at least 80% of each). */
/** A town gets at least 80% of each of its needs (of only these products, when given). */
export const fullySupplied = (t: ProgressView["towns"][number], only?: Product[]) =>
  needsOf(t.pop).every((p) => (only && !only.includes(p)) || (t.supply[p] ?? 0) >= 0.8);

const n = (o: Partial<Record<Product, number>>, p: Product) => o[p] ?? 0;
const biggest = (v: ProgressView) => v.towns.reduce((a, t) => Math.max(a, t.pop), 0);
const allSold = (v: ProgressView) => Object.values(v.sold).reduce((a: number, k) => a + (k ?? 0), 0);

export const MILESTONES: Milestone[] = [
  {
    id: "food10", name: "First customers", goal: "Deliver 10 loads of food to your towns",
    measure: (v) => [n(v.sold, "food"), 10],
    unlocks: { roads: ["avenue", "one2"], grant: 5000 },
  },
  {
    id: "town2", name: "A second town", goal: "Run two towns",
    measure: (v) => [v.towns.length, 2],
    unlocks: { features: ["roundabout"], roads: ["streetM"], towns: 1 },
  },
  {
    id: "village", name: "Village", goal: "Grow a town to Village size: 300 people",
    measure: (v) => [biggest(v), 300],
    unlocks: { buildings: ["ironmine", "coalmine", "coalplant"], grant: 15000 },
  },
  {
    id: "planks10", name: "Sawn timber", goal: "Saw 10 loads of planks",
    measure: (v) => [n(v.made, "planks"), 10],
    unlocks: { bays: 1, features: ["signals"] },
  },
  {
    id: "food20", name: "Market day", goal: "Deliver 20 loads of food in one day",
    measure: (v) => [n(v.bestDay, "food"), 20],
    unlocks: { buildings: ["smelter"], load: 1 },
  },
  {
    // (food and planks only: a village of 600 also wants cement, and this is the milestone that unlocks it)
    id: "supplied", name: "Village supplied", goal: "Keep a village in all the food and planks it needs for a day",
    measure: (v) => [v.towns.some((t) => sizeOf(t.pop) >= 1 && fullySupplied(t, ["food", "planks"])) ? 1 : 0, 1],
    unlocks: { buildings: ["quarry", "cementworks"] },
  },
  {
    id: "steel", name: "First steel", goal: "Make your first load of steel",
    measure: (v) => [n(v.made, "steel"), 1],
    unlocks: { roads: ["one3", "avenueM"], grant: 20000 },
  },
  {
    id: "powered3", name: "Lights on", goal: "Run three buildings at full power",
    measure: (v) => [v.powered, 3],
    unlocks: { bays: 1 },
  },
  {
    id: "cement", name: "First cement", goal: "Make your first load of cement",
    measure: (v) => [n(v.made, "cement"), 1],
    unlocks: { features: ["transit"] },
  },
  {
    id: "towns3", name: "Three towns", goal: "Run three towns",
    measure: (v) => [v.towns.length, 3],
    unlocks: { towns: 1, roads: ["boulevard"] },
  },
  {
    id: "cement20", name: "Concrete", goal: "Deliver 20 loads of cement to your towns",
    measure: (v) => [n(v.sold, "cement"), 20],
    unlocks: { load: 1 },
  },
  {
    id: "supplied2", name: "Two towns supplied", goal: "Supply every need of two towns of 100+ people for a day",
    measure: (v) => [v.towns.filter((t) => t.pop >= 100 && fullySupplied(t)).length, 2],
    unlocks: { roads: ["boulevardM"] },
  },
  {
    id: "trade20k", name: "Good trading day", goal: "Take $20,000 from deliveries in one day",
    measure: (v) => [Math.floor(v.bestEarned), 20000], money: true,
    unlocks: { bays: 1 },
  },
  {
    id: "pop1000", name: "Big village", goal: "Grow a town to 1,000 people",
    measure: (v) => [biggest(v), 1000],
    // (a town wants fuel from 1,500: oil opens first, while it is still on its way there)
    unlocks: { buildings: ["oilwell", "refinery"], towns: 1 },
  },
  {
    id: "planks30", name: "Building boom", goal: "Deliver 30 loads of planks in one day",
    measure: (v) => [n(v.bestDay, "planks"), 30],
    unlocks: { buildings: ["sandpit", "glassworks", "furniture"], grant: 30000 },
  },
  {
    id: "fuel1", name: "First fuel", goal: "Refine your first load of fuel",
    measure: (v) => [n(v.made, "fuel"), 1],
    unlocks: { grant: 25000 },
  },
  {
    id: "food60", name: "Feeding thousands", goal: "Deliver 60 loads of food in one day",
    measure: (v) => [n(v.bestDay, "food"), 60],
    unlocks: { roads: ["one4"] },
  },
  {
    id: "cement30", name: "Concrete age", goal: "Deliver 30 loads of cement in one day",
    measure: (v) => [n(v.bestDay, "cement"), 30],
    unlocks: { buildings: ["constructionplant"], bays: 1 },
  },
  {
    id: "goods1", name: "Home comforts", goal: "Make your first load of household goods",
    measure: (v) => [n(v.made, "goods"), 1],
    unlocks: { grant: 25000 },
  },
  {
    id: "town", name: "Town", goal: "Grow a town to Town size: 1,500 people",
    measure: (v) => [biggest(v), 1500],
    unlocks: { towns: 2, grant: 50000 },
  },
  {
    id: "parts1", name: "Prefab", goal: "Deliver your first load of construction parts to a town building site",
    measure: (v) => [n(v.sold, "parts"), 1],
    unlocks: { bays: 1 },
  },
  {
    id: "towns5", name: "Five towns", goal: "Run five towns",
    measure: (v) => [v.towns.length, 5],
    unlocks: { towns: 1 },
  },
  {
    id: "townSupplied", name: "Town supplied", goal: "Keep a Town of 1,500+ in everything it needs for a day",
    measure: (v) => [v.towns.some((t) => sizeOf(t.pop) >= 2 && fullySupplied(t)) ? 1 : 0, 1],
    unlocks: { load: 1, grant: 60000 },
  },
  {
    id: "fuel30", name: "Fuelling the roads", goal: "Deliver 30 loads of fuel in one day",
    measure: (v) => [n(v.bestDay, "fuel"), 30],
    unlocks: { bays: 1 },
  },
  {
    id: "goods30", name: "Furnished", goal: "Deliver 30 loads of household goods in one day",
    measure: (v) => [n(v.bestDay, "goods"), 30],
    unlocks: { grant: 50000 },
  },
  {
    id: "parts20", name: "Rising blocks", goal: "Deliver 20 loads of construction parts to building sites",
    measure: (v) => [n(v.sold, "parts"), 20],
    unlocks: { bays: 1 },
  },
  {
    id: "trade100k", name: "Big trading day", goal: "Take $100,000 from deliveries in one day",
    measure: (v) => [Math.floor(v.bestEarned), 100000], money: true,
    unlocks: { towns: 1 },
  },
  {
    id: "pop4000", name: "Market town", goal: "Grow a town to 4,000 people",
    measure: (v) => [biggest(v), 4000],
    unlocks: { bays: 1 },
  },
  {
    id: "towns2town", name: "Twin towns", goal: "Grow two towns to Town size",
    measure: (v) => [v.towns.filter((t) => sizeOf(t.pop) >= 2).length, 2],
    unlocks: { towns: 1, grant: 80000 },
  },
  // ---------------------------------------------------------------- tier 4: copper, electronics and machinery
  // (one block: copper opens while the towns are still Towns, so the chains a City needs are running when one gets
  // there, the way oil opens before a town wants fuel; the last ones reward a City supplied and tier 4 volume)
  {
    // (the copper deposits lie 10-20 km out in the high ranges)
    id: "parts50", name: "Prefab streets", goal: "Deliver 50 loads of construction parts to building sites",
    measure: (v) => [n(v.sold, "parts"), 50],
    unlocks: { buildings: ["coppermine"] },
  },
  {
    id: "copperore1", name: "Copper country", goal: "Mine your first load of copper ore",
    measure: (v) => [n(v.made, "copperore"), 1],
    unlocks: { buildings: ["coppersmelter"], grant: 60000 },
  },
  {
    // (the refinery's plastics finally have a buyer)
    id: "goods60", name: "Shopping streets", goal: "Deliver 60 loads of household goods in one day",
    measure: (v) => [n(v.bestDay, "goods"), 60],
    unlocks: { buildings: ["electronics"], bays: 1 },
  },
  {
    id: "copper1", name: "Red metal", goal: "Smelt your first load of copper",
    measure: (v) => [n(v.made, "copper"), 1],
    unlocks: { buildings: ["machineworks"] },
  },
  {
    id: "city", name: "City", goal: "Grow a town to City size: 6,000 people",
    measure: (v) => [biggest(v), 6000],
    unlocks: { towns: 2, grant: 100000 },
  },
  {
    id: "electronics1", name: "Circuit boards", goal: "Make your first load of electronics",
    measure: (v) => [n(v.made, "electronics"), 1],
    unlocks: { grant: 80000 },
  },
  {
    id: "machinery1", name: "Heavy industry", goal: "Build your first load of machinery",
    measure: (v) => [n(v.made, "machinery"), 1],
    unlocks: { bays: 1 },
  },
  {
    id: "citySupplied", name: "City supplied", goal: "Keep a City of 6,000+ in everything it needs for a day",
    measure: (v) => [v.towns.some((t) => sizeOf(t.pop) >= 3 && fullySupplied(t)) ? 1 : 0, 1],
    unlocks: { towns: 1, bays: 1, grant: 150000 },
  },
  {
    id: "electronics40", name: "Wired city", goal: "Deliver 40 loads of electronics in one day",
    measure: (v) => [n(v.bestDay, "electronics"), 40],
    unlocks: { bays: 1 },
  },
  {
    // (the top of the ladder for now: Metropolis needs and company projects come after)
    id: "machinery40", name: "Tooled up", goal: "Deliver 40 loads of machinery in one day",
    measure: (v) => [n(v.bestDay, "machinery"), 40],
    unlocks: { towns: 1, bays: 1 },
  },
];

/**
 * Logistics (docs/design.md, "Freight"): bigger truck classes, warehouses and fuel depots. Each goes in the ladder
 * just after the milestone named: heavy trucks once the company runs a few chains, warehouses with tier 2,
 * depots with the refinery, road trains on the way to a Town, when the roads start to fill.
 */
const LOGISTICS: (Milestone & { after: string })[] = [
  {
    after: "powered3", id: "heavy", name: "Heavy haulage", goal: "Deliver 150 loads to your towns in all",
    measure: (v) => [allSold(v), 150],
    unlocks: { trucks: ["heavy"] },
  },
  {
    after: "cement", id: "warehouse", name: "Stockpiles", goal: "Make 30 loads of coal",
    measure: (v) => [n(v.made, "coal"), 30],
    unlocks: { buildings: ["warehouse"] },
  },
  {
    after: "fuel1", id: "depot", name: "Own pumps", goal: "Refine 10 loads of fuel",
    measure: (v) => [n(v.made, "fuel"), 10],
    unlocks: { buildings: ["fueldepot"] },
  },
  {
    after: "town", id: "roadtrain", name: "Road trains", goal: "Deliver 800 loads to your towns in all",
    measure: (v) => [allSold(v), 800],
    unlocks: { trucks: ["roadtrain"] },
  },
];
/**
 * Landmarks (docs/design.md, "Landmarks" and "Freight: oversized loads"): one block at the top of the ladder, after
 * tier 4 and the City: the dam once the machine works ships its first oversized piece, the tower once convoys are a
 * habit, the world's fair once a first landmark stands.
 */
const LANDMARKS: (Milestone & { after: string })[] = [
  {
    after: "machinery40", id: "bigiron", name: "Oversized load", goal: "Ship your first oversized piece by convoy",
    measure: (v) => [v.pieces ?? 0, 1],
    unlocks: { buildings: ["hydrodam"], grant: 50000 },
  },
  {
    after: "bigiron", id: "skyline", name: "Skyline", goal: "Ship 3 oversized pieces by convoy",
    measure: (v) => [v.pieces ?? 0, 3],
    unlocks: { buildings: ["skylinetower"], grant: 80000 },
  },
  {
    after: "skyline", id: "worldsfair", name: "World's fair", goal: "Finish a landmark",
    measure: (v) => [v.landmarks ?? 0, 1],
    unlocks: { buildings: ["exposition"], towns: 1, grant: 150000 },
  },
];
for (const { after, ...m } of LANDMARKS) MILESTONES.splice(MILESTONES.findIndex((x) => x.id === after) + 1, 0, m);

for (const { after, ...m } of LOGISTICS) MILESTONES.splice(MILESTONES.findIndex((x) => x.id === after) + 1, 0, m);

/**
 * Deeper chains (docs/design.md "Supplies", "Perishables", "Motor Works"), each just after the milestone named: the
 * dairy and creamery once the villages build in concrete; the chemical works when the quarries are busy (its
 * fertilizer and explosives are what sites need past level 2, required only from then on); and tier 5 as a block
 * after tier 4 and its landmarks (the convoys and landmarks open first): the rubber plant once the refinery makes
 * plastics in volume, the Motor Works for a big City kept in electronics and machinery, and its last steps for cars
 * on the roads.
 */
const CHAINS: (Milestone & { after: string })[] = [
  {
    after: "cement", id: "dairy", name: "Milk round", goal: "Deliver 300 loads to your towns in all",
    measure: (v) => [allSold(v), 300],
    unlocks: { buildings: ["dairyfarm"], grant: 10000 },
  },
  {
    after: "dairy", id: "milk1", name: "Fresh milk", goal: "Deliver your first load of milk to a town",
    measure: (v) => [n(v.sold, "milk"), 1],
    unlocks: { buildings: ["creamery"] },
  },
  {
    after: "goods1", id: "chemworks", name: "Chemistry", goal: "Quarry 120 loads of limestone",
    measure: (v) => [n(v.made, "lime"), 120],
    unlocks: { buildings: ["chemworks"] },
  },
  {
    after: "chemworks", id: "supplies20", name: "Fed back", goal: "Make 20 loads of fertilizer",
    measure: (v) => [n(v.made, "fertilizer"), 20],
    unlocks: { bays: 1, grant: 30000 },
  },
  {
    after: "worldsfair", id: "rubber", name: "Synthetic rubber", goal: "Make 60 loads of plastics",
    measure: (v) => [n(v.made, "plastics"), 60],
    unlocks: { buildings: ["rubberplant"] },
  },
  {
    after: "rubber", id: "motorworks", name: "Assembly line", goal: "Keep a City of 8,000+ in electronics and machinery for a day",
    measure: (v) => [v.towns.some((t) => t.pop >= 8000 && fullySupplied(t, ["electronics", "machinery"])) ? 1 : 0, 1],
    unlocks: { buildings: ["motorworks"], grant: 150000 },
  },
  {
    after: "motorworks", id: "cars1", name: "Motor age", goal: "Deliver your first load of cars to a town",
    measure: (v) => [n(v.sold, "cars"), 1],
    unlocks: { grant: 100000 },
  },
  {
    // (the top of the ladder for now: every car sold is more traffic, so this one is earned on the roads)
    after: "cars1", id: "cars30", name: "Rush hour", goal: "Deliver 30 loads of cars in one day",
    measure: (v) => [n(v.bestDay, "cars"), 30],
    unlocks: { towns: 1, bays: 1 },
  },
];
for (const { after, ...m } of CHAINS) MILESTONES.splice(MILESTONES.findIndex((x) => x.id === after) + 1, 0, m);

export const milestoneById = new Map(MILESTONES.map((m) => [m.id, m]));

/** The milestone that unlocks something, if one does. */
export const unlockedBy = (test: (u: Unlocks) => boolean | undefined): Milestone | undefined => MILESTONES.find((m) => test(m.unlocks));

/** Everything a set of reached milestones adds up to, with the start's. */
export interface Unlocked {
  roads: Set<RoadTypeId>;
  features: Set<Feature>;
  buildings: Set<PlacedKind>;
  towns: number;
  bays: number;
  load: number;
  trucks: Set<TruckClass>;
}

export function unlocksOf(done: Iterable<string>): Unlocked {
  const u: Unlocked = {
    roads: new Set(BASE.roads), features: new Set(BASE.features),
    buildings: new Set((Object.keys(PLANTS) as PlacedKind[]).filter((k) => PLANTS[k].tier === 1)),
    towns: BASE.towns, bays: BASE.bays, load: BASE.load, trucks: new Set<TruckClass>(["light"]),
  };
  for (const id of done) {
    const m = milestoneById.get(id)?.unlocks;
    if (!m) continue;
    for (const r of m.roads ?? []) u.roads.add(r);
    for (const f of m.features ?? []) u.features.add(f);
    for (const b of m.buildings ?? []) u.buildings.add(b);
    for (const t of m.trucks ?? []) u.trucks.add(t);
    u.towns += m.towns ?? 0;
    u.bays += m.bays ?? 0;
    u.load += m.load ?? 0;
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
  private cache: { n: number; u: Unlocked } | null = null;

  isDone(id: string): boolean {
    return this.done.includes(id);
  }

  /** The milestones open now: the first few not yet reached, in ladder order. */
  open(): Milestone[] {
    return MILESTONES.filter((m) => !this.isDone(m.id)).slice(0, OPEN_AT_ONCE);
  }

  get unlocked(): Unlocked {
    if (this.cache?.n !== this.done.length) this.cache = { n: this.done.length, u: unlocksOf(this.done) };
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
    return { done: [...this.done], made: { ...this.made }, sold: { ...this.sold }, today: { ...this.today }, bestDay: { ...this.bestDay }, earnedToday: this.earnedToday, bestEarned: this.bestEarned, pieces: this.pieces };
  }

  load(d: ProgressJSON) {
    this.done = [...d.done];
    this.made = { ...d.made };
    this.sold = { ...d.sold };
    this.today = { ...d.today };
    this.bestDay = { ...d.bestDay };
    this.earnedToday = d.earnedToday;
    this.bestEarned = d.bestEarned;
    this.pieces = d.pieces ?? 0;
    this.cache = null;
  }
}
