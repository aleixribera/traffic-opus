// The company's industry: extractors on deposits, plants that turn one product into another, and each building's
// own trucks, which carry every load over the player's roads (see docs/design.md, "Chains" and "Freight").
// Nothing here draws a route: a loaded truck goes to the customer worth most to the company, own plants short of
// an input first, then the shops of towns that still need the product today (see towns.ts), nearest and neediest
// first. The company is paid only for loads delivered to a town.

import type { V2 } from "../core/math";
import type { Building, Buildings } from "./buildings";
import { BUILDING_TYPES, type BuildingKind } from "../config";
import type { PendingSpawn, Trip, Vehicle } from "../sim/traffic";
import { F } from "../world/gen";
import { GROW_DECAY, GROW_NEED, SITE_LEVELS, levelMult } from "./sites";

export type Product =
  | "crops" | "logs" | "food" | "planks" | "ore" | "coal" | "lime" | "steel" | "cement"
  | "crude" | "sand" | "fuel" | "plastics" | "glass" | "goods" | "parts";

export interface ProductDef {
  name: string;
  /** what a town pays for one truckload (0: only plants use it) */
  price: number;
  /** cargo tint on the trucks */
  color: number;
}

export const PRODUCTS: Record<Product, ProductDef> = {
  crops: { name: "Crops", price: 0, color: 0xd9b44a },
  logs: { name: "Logs", price: 0, color: 0x8a5a33 },
  food: { name: "Food", price: 700, color: 0xe2704a },
  planks: { name: "Planks", price: 650, color: 0xe8cf8f },
  ore: { name: "Iron ore", price: 0, color: 0x93603f },
  coal: { name: "Coal", price: 0, color: 0x3a3a3e },
  lime: { name: "Limestone", price: 0, color: 0xd9d3bd },
  // (steel goes to the construction plants: no town buys it)
  steel: { name: "Steel", price: 0, color: 0x8a96a3 },
  cement: { name: "Cement", price: 1000, color: 0xb9b6ae },
  // tier 3: fuel and household goods for towns of Town size, construction parts for the blocks they put up
  crude: { name: "Crude oil", price: 0, color: 0x2e2a26 },
  sand: { name: "Sand", price: 0, color: 0xe0c78e },
  fuel: { name: "Fuel", price: 1500, color: 0xd99a2b },
  // (plastics wait for the electronics works of tier 4: until then the refinery flares what it can't store)
  plastics: { name: "Plastics", price: 0, color: 0x6fb7c9 },
  glass: { name: "Glass", price: 0, color: 0x9fd3d6 },
  goods: { name: "Household goods", price: 1600, color: 0xb0603e },
  parts: { name: "Construction parts", price: 1800, color: 0x7f8b6a },
};

export type PlantKind =
  | "farm" | "loggingcamp" | "foodplant" | "sawmill"
  | "ironmine" | "coalmine" | "quarry" | "smelter" | "cementworks" | "coalplant"
  | "oilwell" | "sandpit" | "refinery" | "glassworks" | "furniture" | "constructionplant";

export interface PlantDef {
  kind: PlantKind;
  tier: number;
  /** extractors: the deposit (world field) the footprint must cover */
  deposit?: { field: number; name: string };
  inputs: Partial<Record<Product, number>>;
  outputs: Partial<Record<Product, number>>;
  /** sim seconds per batch, fully staffed (on a full deposit) */
  cycle: number;
  cost: number;
  /** per hour */
  upkeep: number;
  /** trucks it starts with */
  trucks: number;
  /** loads each store holds (each input and each output) */
  store: number;
  /** power it draws at full work (MW); without it, it works at UNPOWERED of its pace (tier 2 on) */
  power?: number;
  /** a power plant: what it makes at full staff (MW) while it has coal to burn, and how far it reaches (m) */
  makes?: number;
  reach?: number;
  /** what its construction site waits for, trucked in (tier 2 on); tier 1 costs money only */
  site?: Partial<Record<Product, number>>;
  blurb: string;
}

const HOUR = 40;

export const PLANTS: Record<PlantKind, PlantDef> = {
  farm: {
    kind: "farm", tier: 1, deposit: { field: F.fert, name: "fertile soil" }, inputs: {}, outputs: { crops: 1 },
    cycle: HOUR * 1.5, cost: 8000, upkeep: 12, trucks: 2, store: 8,
    blurb: "Grows crops on fertile soil. Its trucks take them to your food plants.",
  },
  loggingcamp: {
    kind: "loggingcamp", tier: 1, deposit: { field: F.forest, name: "forest" }, inputs: {}, outputs: { logs: 1 },
    cycle: HOUR * 1.5, cost: 7000, upkeep: 10, trucks: 2, store: 8,
    blurb: "Fells timber in the forest. Its trucks take the logs to your sawmills.",
  },
  foodplant: {
    kind: "foodplant", tier: 1, inputs: { crops: 1 }, outputs: { food: 1 },
    cycle: HOUR, cost: 15000, upkeep: 25, trucks: 2, store: 8,
    blurb: "Turns crops into food. Its trucks sell the food to the towns' shops.",
  },
  sawmill: {
    kind: "sawmill", tier: 1, inputs: { logs: 1 }, outputs: { planks: 1 },
    cycle: HOUR, cost: 14000, upkeep: 22, trucks: 2, store: 8,
    blurb: "Saws logs into planks. Its trucks sell the planks to the towns and take them to your building sites.",
  },
  ironmine: {
    kind: "ironmine", tier: 2, deposit: { field: F.ore, name: "iron ore" }, inputs: {}, outputs: { ore: 1 },
    cycle: HOUR * 1.5, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 6 },
    blurb: "Digs iron ore. Its trucks take it to your smelters.",
  },
  coalmine: {
    kind: "coalmine", tier: 2, deposit: { field: F.coal, name: "coal" }, inputs: {}, outputs: { coal: 1 },
    cycle: HOUR * 1.2, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 6 },
    blurb: "Digs coal for your smelters, cement works and power plants.",
  },
  quarry: {
    kind: "quarry", tier: 2, deposit: { field: F.lime, name: "limestone" }, inputs: {}, outputs: { lime: 1 },
    cycle: HOUR * 1.5, cost: 20000, upkeep: 26, trucks: 4, store: 8, power: 6, site: { planks: 6 },
    blurb: "Quarries limestone. Its trucks take it to your cement works.",
  },
  smelter: {
    kind: "smelter", tier: 2, inputs: { ore: 1, coal: 1 }, outputs: { steel: 1 },
    cycle: HOUR * 1.5, cost: 45000, upkeep: 50, trucks: 2, store: 8, power: 14, site: { planks: 10 },
    blurb: "Smelts iron ore with coal into steel, for the construction plants to come.",
  },
  cementworks: {
    kind: "cementworks", tier: 2, inputs: { lime: 1, coal: 1 }, outputs: { cement: 1 },
    cycle: HOUR, cost: 40000, upkeep: 45, trucks: 3, store: 8, power: 10, site: { planks: 10 },
    blurb: "Burns limestone with coal into cement. Its trucks sell it to villages that are building in concrete.",
  },
  coalplant: {
    kind: "coalplant", tier: 2, inputs: { coal: 1 }, outputs: {},
    cycle: HOUR * 3, cost: 32000, upkeep: 35, trucks: 0, store: 8, makes: 40, reach: 4000, site: { planks: 8 },
    blurb: "Burns coal for power. It powers your tier 2 buildings on its roads within 4 km; without power they work at 40%.",
  },
  // tier 3: the building sites wait for planks and cement
  oilwell: {
    kind: "oilwell", tier: 3, deposit: { field: F.oil, name: "oil" }, inputs: {}, outputs: { crude: 1 },
    cycle: HOUR * 1.2, cost: 28000, upkeep: 30, trucks: 4, store: 8, site: { planks: 6, cement: 4 },
    blurb: "Pumps crude oil. Its tankers take it to your refineries.",
  },
  sandpit: {
    kind: "sandpit", tier: 3, deposit: { field: F.sand, name: "sand" }, inputs: {}, outputs: { sand: 1 },
    cycle: HOUR * 1.2, cost: 22000, upkeep: 24, trucks: 4, store: 8, site: { planks: 6, cement: 4 },
    blurb: "Digs sand by the water. Its tippers take it to your glassworks.",
  },
  refinery: {
    kind: "refinery", tier: 3, inputs: { crude: 1 }, outputs: { fuel: 1, plastics: 1 },
    cycle: HOUR, cost: 60000, upkeep: 60, trucks: 4, store: 8, power: 16, site: { planks: 12, cement: 10 },
    blurb: "Splits crude oil into fuel and plastics. Its tankers sell the fuel to the towns' filling stations.",
  },
  glassworks: {
    kind: "glassworks", tier: 3, inputs: { sand: 1, coal: 1 }, outputs: { glass: 1 },
    cycle: HOUR, cost: 48000, upkeep: 50, trucks: 3, store: 8, power: 12, site: { planks: 10, cement: 8 },
    blurb: "Melts sand with coal into glass for your furniture factories.",
  },
  furniture: {
    kind: "furniture", tier: 3, inputs: { planks: 1, glass: 1 }, outputs: { goods: 1 },
    cycle: HOUR, cost: 42000, upkeep: 45, trucks: 3, store: 8, site: { planks: 10, cement: 6 },
    blurb: "Builds furniture and fittings from planks and glass: household goods for the towns' shops.",
  },
  constructionplant: {
    kind: "constructionplant", tier: 3, inputs: { steel: 1, cement: 1 }, outputs: { parts: 1 },
    cycle: HOUR, cost: 52000, upkeep: 55, trucks: 3, store: 8, power: 14, site: { planks: 10, cement: 10 },
    blurb: "Casts steel and cement into construction parts: towns put up their blocks and towers from them.",
  },
};

export const PLANT_KINDS = Object.keys(PLANTS) as PlantKind[];
export const isPlantKind = (k: BuildingKind | string): k is PlantKind => k in PLANTS;
/** What each worker is paid per hour. */
export const WAGE = 1;
/** Least share of an extractor's lot that must sit on its deposit. */
export const MIN_DEPOSIT = 0.35;
/** Fuel and wear per km a truck drives (both ways), charged when it sets off. */
export const FUEL_PER_KM = 4;
/** A truck bought for a plant: its price, its upkeep per hour, and how many a plant may buy. */
export const TRUCK_COST = 4000, TRUCK_UPKEEP = 4, MAX_BOUGHT = 8;
/** Pace of a building that needs power and has none (it scales up to 1 with the share of power it gets). */
export const UNPOWERED = 0.4;
/** Time to put a building up once its site has every material (and a tier 1 building, from the start). */
export const BUILD_TIME = HOUR * 1.5;
/** Pace from the share of power a building gets. */
export const powerPace = (share: number) => UNPOWERED + (1 - UNPOWERED) * Math.max(0, Math.min(1, share));

/** A plant's working state (kept on its Building, so it saves with it). */
export interface PlantState {
  /** input stores, in loads */
  stock: Partial<Record<Product, number>>;
  /** output waiting for a truck, in loads */
  out: Partial<Record<Product, number>>;
  /** progress through the current batch, 0..1 */
  prog: number;
  /** share of the lot on its deposit (1 for plants) */
  yld: number;
  /** trucks it owns (on top of the bays every building gains from milestones), bought ones included */
  trucks: number;
  /** how many of those the player bought */
  bought?: number;
  /** a construction site: the materials it waits for, and what has arrived */
  site?: { need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>> };
  /** this hour's and the last full hour's books */
  now: PlantBooks;
  last: PlantBooks;
  /** the site's level (1-4, docs/design.md "Industry sites"): output, jobs and trucks grow with it */
  level: number;
  /** working time (s) toward the next level */
  grow: number;
  /** sim time it last grew (its new buildings go up for a while after) */
  upAt: number;
  /** what keeps it from growing now (null: it is growing, or at the top level) */
  why?: string | null;
}

export interface PlantBooks { made: number; sent: number; earned: number; spent: number }
const books = (): PlantBooks => ({ made: 0, sent: 0, earned: 0, spent: 0 });

/** What a truck of the company's is doing (on Trip.haul). */
export interface HaulRun {
  plant: number;
  leg: "out" | "back";
  product: Product;
  n: number;
  /** the building it delivers to (out) or came from (back) */
  dest: number;
  /** the leg ended (arrived or failed): traffic can report a trip twice */
  done?: boolean;
}

/** What the industry needs from the game. */
export interface IndustryHost {
  readonly time: number;
  readonly buildings: Buildings;
  /** has the world field `f` at p (a deposit) */
  has(f: number, p: V2): boolean;
  connected(segA: number, segB: number): boolean;
  workersAt(id: number): number;
  /** buildings that sell to a town's residents */
  readonly shops: Building[];
  /** the town a shop belongs to (null: none) */
  townOf(b: Building): number | null;
  /** loads of a product a town still wants today (0 or less: it has enough; -Infinity: it doesn't use it) */
  want(town: number, p: Product): number;
  /** loads a town still needs today to grow (its shops buy more than that; this part comes first), 0 if none */
  short?(town: number, p: Product): number;
  /** a load reached one of a town's shops */
  sold(town: number, p: Product, n: number): void;
  request(p: PendingSpawn): void;
  /** vehicles on the road and trips waiting to set off */
  trips(): Iterable<Trip>;
  earn(v: number): void;
  spend(v: number, what: "wages" | "upkeep" | "fuel"): void;
  /** truck bays every building has gained from milestones, on top of its own trucks */
  bays?(): number;
  /** loads one truck carries */
  load?(): number;
  /** share of the power a building needs that it gets (0..1) */
  power?(b: Building): number;
  /** a power plant has buildings within reach that want its power (it only burns coal then) */
  wanted?(b: Building): boolean;
  /** a plant made loads of a product (the company's tallies) */
  made?(p: Product, n: number): void;
  /** a site grew a level */
  grew?(b: Building, level: number): void;
}

export interface Customer { b: Building; value: number; /** loads it can take */ room: number }

export class Industry {
  constructor(private h: IndustryHost) {}

  /** The company's extractors and plants. */
  plants(): Building[] {
    return this.h.buildings.list.filter((b) => b.plant);
  }

  /** Share of a lot (centre c, turned rot, half sizes) that sits on a deposit field. */
  depositShare(field: number, c: V2, rot: number, hw: number, hd: number): number {
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y, y: u.x };
    let n = 0, on = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const a = -hw + ((i + 0.5) / 5) * 2 * hw, b = -hd + ((j + 0.5) / 5) * 2 * hd;
      n++;
      if (this.h.has(field, { x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b })) on++;
    }
    return on / n;
  }

  /** Make a freshly placed building one of the company's plants (from tier 2, a site waiting for its materials). */
  init(b: Building, kind: PlantKind, yld = 1) {
    const d = PLANTS[kind];
    b.plant = { stock: {}, out: {}, prog: 0, yld, trucks: d.trucks, now: books(), last: books(), level: 1, grow: 0, upAt: -1e9 };
    if (d.site) b.plant.site = { need: { ...d.site }, got: {} };
  }

  /** Trucks a plant runs: its own (more at each site level), the ones bought for it, and the bays milestones added (a power plant has none). */
  trucksOf(b: Building): number {
    const P = b.plant!;
    if (P.trucks <= 0) return 0;
    // (the site's own trucks grow with its level; bought ones stay as many as were bought)
    const own = P.trucks - (P.bought ?? 0);
    return Math.round(own * levelMult(P.level)) + (P.bought ?? 0) + (this.h.bays?.() ?? 0);
  }

  /** Loads each of a plant's stores holds (the yard grows with the site). */
  static storeOf(b: Building): number {
    return Math.round(PLANTS[b.kind as PlantKind].store * levelMult(b.plant?.level ?? 1));
  }

  /** Jobs at a site of this kind and level. */
  static jobsAt(jobs: number, level: number): number {
    return Math.round(jobs * levelMult(level));
  }

  /** Can the player buy this plant another truck (null) or why not. */
  canBuyTruck(b: Building, money: number): string | null {
    const P = b.plant;
    if (!P || P.trucks <= 0) return "It runs no trucks";
    if ((P.bought ?? 0) >= MAX_BOUGHT) return `It has all the trucks it can load (${MAX_BOUGHT} bought)`;
    if (money < TRUCK_COST) return "Not enough money";
    return null;
  }

  /** Is it up and working (not a site, not being built)? */
  static running(b: Building): boolean {
    return !!b.plant && !b.plant.site && b.built >= 1;
  }

  /** Loads of a material a site (a plant's, or a town building's) still waits for (not counting what is on its way). */
  static siteLeft(b: Building, p: Product): number {
    const s = b.plant?.site ?? b.site;
    return s ? (s.need[p] ?? 0) - (s.got[p] ?? 0) : 0;
  }

  /** The output that stops a plant: its one output when full, or with two, the first once both are full. */
  static fullOf(b: Building, store = Industry.storeOf(b)): Product | undefined {
    const outs = entries(PLANTS[b.kind as PlantKind].outputs);
    if (!outs.length) return undefined;
    return outs.every(([p]) => (b.plant!.out[p] ?? 0) >= store) ? outs[0][0] : undefined;
  }

  /** A side product with a full store while the plant works on (flared until something uses it), if any. */
  static flaring(b: Building): Product | undefined {
    const outs = entries(PLANTS[b.kind as PlantKind].outputs);
    if (outs.length < 2 || !b.plant || Industry.fullOf(b)) return undefined;
    const store = Industry.storeOf(b);
    return outs.find(([p]) => (b.plant!.out[p] ?? 0) >= store)?.[0];
  }

  /** The tier whose plants first use a product nobody uses yet. */
  static laterTier(p: Product): number {
    return p === "plastics" ? 4 : 3;
  }

  /** The plants that take a product in, by name: "glassworks or furniture factory". */
  static takers(p: Product): string {
    return PLANT_KINDS.filter((k) => PLANTS[k].inputs[p]).map((k) => BUILDING_TYPES[k].name.toLowerCase()).join(" or ") || "plant";
  }

  /** Does any building of the company's take this product in (as an input or as a building material)? */
  static usedBy(p: Product): boolean {
    return PLANT_KINDS.some((k) => PLANTS[k].inputs[p] || PLANTS[k].site?.[p]);
  }

  /** Trucks out per plant, and loads on their way to each customer (counted fresh each tick). */
  private census() {
    const busy = new Map<number, number>(), coming = new Map<number, Map<Product, number>>();
    for (const t of this.h.trips()) {
      const r = t.haul;
      if (!r || r.done) continue;
      busy.set(r.plant, (busy.get(r.plant) ?? 0) + 1);
      if (r.leg !== "out") continue;
      let m = coming.get(r.dest);
      if (!m) coming.set(r.dest, (m = new Map()));
      m.set(r.product, (m.get(r.product) ?? 0) + r.n);
    }
    return { busy, coming };
  }

  tick(span: number) {
    const { busy, coming } = this.census();
    for (const b of this.plants()) {
      this.produce(b, span);
      this.dispatch(b, busy, coming);
    }
  }

  /**
   * Work through the current batch: staff, deposit, power and inputs on hand set the pace; a full store stops it.
   * A power plant's batch is the coal it burns, and it burns only while something within reach wants power.
   */
  produce(b: Building, span: number) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.site) {
      const left = entries(P.site.need).map(([p, n]) => [p, n - (P.site!.got[p] ?? 0)] as [Product, number]).filter(([, n]) => n > 0);
      b.problem = left.length ? `Building site: waiting for ${left.map(([p, n]) => `${n} load${n === 1 ? "" : "s"} of ${PRODUCTS[p].name.toLowerCase()}`).join(" and ")}` : null;
      return;
    }
    if (b.built < 1) { b.problem = null; return; }
    const staff = b.cap ? Math.min(1, this.h.workersAt(b.id) / b.cap) : 1;
    const pw = d.power ? (this.h.power?.(b) ?? 1) : 1;
    const idle = !!d.makes && !(this.h.wanted?.(b) ?? true);
    const store = Industry.storeOf(b);
    const short = () => entries(d.inputs).find(([p, n]) => (P.stock[p] ?? 0) < n)?.[0];
    // (a plant with two outputs stops only once both are full: a full side product is flared, the rest goes on)
    const full = () => Industry.fullOf(b, store);
    const working = !!b.access && staff > 0 && !idle && !short() && !full();
    if (working) {
      P.prog += (span * staff * P.yld * powerPace(pw) * levelMult(P.level)) / d.cycle;
      while (P.prog >= 1) {
        P.prog -= 1;
        for (const [p, n] of entries(d.inputs)) P.stock[p] = (P.stock[p] ?? 0) - n;
        for (const [p, n] of entries(d.outputs)) {
          const k = Math.min(n, Math.max(0, store - (P.out[p] ?? 0)));
          if (k <= 0) continue;
          P.out[p] = (P.out[p] ?? 0) + k; P.now.made += k; this.h.made?.(p, k);
        }
        if (short() || full()) { P.prog = 0; break; }
      }
    }
    // the most pressing thing that holds it up (the trucks may add "nobody buys" when they find no customer)
    const s = short(), f = full();
    const fname = f && PRODUCTS[f].name.toLowerCase();
    b.problem = !b.access ? (b.placed ? "No road to the gate" : "No road access")
      : f ? (PRODUCTS[f].price > 0 ? `Full of ${fname}: not enough trucks, or nobody to sell to`
        : this.used(f) ? `Full of ${fname}: not enough trucks, or no ${Industry.takers(f)} on its roads`
        : `Full of ${fname}: nothing uses it until tier ${Industry.laterTier(f)}`)
      : staff <= 0 ? "No workers"
      : s ? `Waiting for ${PRODUCTS[s].name.toLowerCase()}`
      : idle ? "Idle: no building within reach needs power"
      : staff < 0.5 ? "Not enough workers"
      : pw <= 0 ? `No power: working at ${Math.round(UNPOWERED * 100)}%`
      : pw < 0.999 ? `Short of power: working at ${Math.round(powerPace(pw) * 100)}%`
      : null;
    this.growth(b, span, working, staff, pw, store);
  }

  /**
   * A site grows a level after working near capacity for most of a few days: fully staffed (near enough), powered,
   * its inputs coming in and its output shipped. Idle time takes some of the progress back; it never shrinks.
   */
  private growth(b: Building, span: number, working: boolean, staff: number, pw: number, store: number) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.level >= SITE_LEVELS) { P.why = null; P.grow = 0; return; }
    // (a side product nothing uses yet doesn't count: the refinery flares its plastics and grows on its fuel)
    const outs = entries(d.outputs);
    const piled = outs.some(([p]) => (outs.length < 2 || Industry.useful(p)) && (P.out[p] ?? 0) > store * 0.75);
    const why = !b.access ? "No road to the gate"
      : !working ? (b.problem ?? "Not working")
      : staff < 0.8 ? "Needs more workers"
      : d.power && pw < 0.9 ? "Short of power"
      : piled ? "Output piling up: needs more trucks or buyers"
      : null;
    P.why = why;
    P.grow = why ? Math.max(0, P.grow - span * GROW_DECAY) : P.grow + span;
    if (P.grow >= GROW_NEED) this.levelUp(b);
  }

  /** Grow a site one level: more output, jobs and trucks, and its next buildings go up. */
  levelUp(b: Building) {
    const P = b.plant!;
    if (P.level >= SITE_LEVELS) return;
    P.level++;
    P.grow = 0;
    P.upAt = this.h.time;
    b.cap = Industry.jobsAt(BUILDING_TYPES[b.kind].jobs, P.level);
    this.h.grew?.(b, P.level);
  }

  /** Does any building of the company's take this product in (as an input or as a building material)? */
  private used(p: Product): boolean {
    return Industry.usedBy(p);
  }

  /** Is there a buyer for a product in the game at all: a town, or a plant that takes it? */
  static useful(p: Product): boolean {
    return PRODUCTS[p].price > 0 || Industry.usedBy(p);
  }

  /**
   * The town buildings that take a product in: fuel goes to filling stations (or, in a town with none standing yet,
   * to its shops); construction parts to no shop at all (only to building sites); everything else to the shops.
   */
  private outlets(product: Product): Building[] {
    const isStation = (o: Building) => !!BUILDING_TYPES[o.kind].fuel;
    // (construction parts go to the towns' building sites, never over a shop counter)
    if (product === "parts") return [];
    if (product !== "fuel") return this.h.shops.filter((o) => !isStation(o));
    const has = new Set<number>();
    for (const o of this.h.shops) if (isStation(o) && o.built >= 1 && !o.abandoned && o.town !== undefined) has.add(o.town);
    return this.h.shops.filter((o) => (isStation(o) ? true : o.town === undefined || !has.has(o.town)));
  }

  /** Who would take a load of `product` from `from`, best first. */
  customers(from: Building, product: Product, coming: Map<number, Map<Product, number>> = this.census().coming): Customer[] {
    const out: Customer[] = [];
    const seg = from.access?.seg;
    if (seg === undefined) return out;
    const on = (id: number) => coming.get(id)?.get(product) ?? 0;
    const km = (o: Building) => Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y) / 1000;
    const price = PRODUCTS[product].price;
    for (const o of this.h.buildings.list) {
      // a town's building site waiting for materials (a block or tower put up from construction parts): the town
      // pays for them, and its new building goes up once they are in
      if (!o.plant && o.site && price > 0) {
        if (!o.access || o.abandoned || !this.h.connected(seg, o.access.seg)) continue;
        const room = Industry.siteLeft(o, product) - on(o.id);
        if (room >= 1) out.push({ b: o, value: price + 400 - km(o) * FUEL_PER_KM * 2, room });
        continue;
      }
      if (!o.plant || o.id === from.id || !o.access || !this.h.connected(seg, o.access.seg)) continue;
      // building sites waiting for it come first: a plant that isn't built makes nothing
      if (o.plant.site) {
        const room = Industry.siteLeft(o, product) - on(o.id);
        if (room >= 1) out.push({ b: o, value: 20000 + room * 100 - km(o) * FUEL_PER_KM * 2, room });
        continue;
      }
      // own plants short of it: they keep the chain running (worth more than any sale)
      const need = PLANTS[o.kind as PlantKind].inputs[product];
      if (!need) continue;
      const room = Industry.storeOf(o) - (o.plant.stock[product] ?? 0) - on(o.id);
      if (room < 1) continue;
      out.push({ b: o, value: 10000 + room * 100 - km(o) * FUEL_PER_KM * 2, room });
    }
    // the towns' shops (and filling stations) buy finished products, as much as each town uses in a day
    if (price > 0) {
      const shops = this.outlets(product);
      // what each town still wants today, less what is already on its way to any of its shops
      const left = new Map<number, number>(), shortLeft = new Map<number, number>();
      for (const o of shops) {
        const t = this.h.townOf(o);
        if (t === null) continue;
        left.set(t, (left.get(t) ?? this.h.want(t, product)) - on(o.id));
        shortLeft.set(t, (shortLeft.get(t) ?? (this.h.short?.(t, product) ?? 0)) - on(o.id));
      }
      for (const o of shops) {
        if (!o.access || o.abandoned || o.built < 1 || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        const l = t === null ? 0 : left.get(t)!;
        if (l < 1) continue;
        // a town still short of what it needs to grow comes first (within ~50 km of extra driving), then nearest
        // first; a town further short, and a shop with emptier shelves, a little ahead
        const short = t === null ? 0 : (shortLeft.get(t) ?? 0);
        out.push({ b: o, value: price - km(o) * FUEL_PER_KM * 2 + (short >= 1 ? 400 : 0) + Math.min(3, l) * 15 - (product === "food" ? o.stock * 15 : 0), room: Math.ceil(l) });
      }
    }
    out.sort((a, b) => b.value - a.value);
    return out;
  }

  /** Send free trucks off with whatever is waiting (a truck takes as many loads as it carries and the customer takes). */
  private dispatch(b: Building, busy: Map<number, number>, coming: Map<number, Map<Product, number>>) {
    const P = b.plant!;
    if (!b.access || P.site) return;
    let free = this.trucksOf(b) - (busy.get(b.id) ?? 0);
    const load = Math.max(1, this.h.load?.() ?? 1);
    const outs = entries(PLANTS[b.kind as PlantKind].outputs);
    for (const [p] of outs) {
      // (a side product nothing uses yet stays in the yard without a word: the panel says it is flared)
      if (outs.length > 1 && !Industry.useful(p)) continue;
      while (free > 0 && (P.out[p] ?? 0) >= 1) {
        const c = this.customers(b, p, coming)[0];
        if (!c) {
          if ((P.out[p] ?? 0) >= 2 && b.access && !b.problem?.startsWith("Full of")) b.problem = this.noBuyer(b, p);
          break;
        }
        const n = Math.max(1, Math.min(load, Math.floor(P.out[p]!), c.room));
        this.send(b, c.b, p, n);
        P.out[p]! -= n;
        free--;
        busy.set(b.id, (busy.get(b.id) ?? 0) + 1);
        let m = coming.get(c.b.id);
        if (!m) coming.set(c.b.id, (m = new Map()));
        m.set(p, (m.get(p) ?? 0) + n);
      }
    }
  }

  /** Why a load has nowhere to go: no town on its roads uses it, or they all have enough for today. */
  private noBuyer(from: Building, p: Product): string {
    const name = PRODUCTS[p].name.toLowerCase();
    const seg = from.access?.seg;
    if (seg !== undefined) {
      let site = false;
      for (const o of this.h.buildings.list) {
        if (!o.plant || !o.access || !PLANTS[o.kind as PlantKind].inputs[p] || !this.h.connected(seg, o.access.seg)) continue;
        if (!o.plant.site) return `Your plants that use ${name} have all they can store, with the loads on their way`;
        site = true;
      }
      if (site) return `The plants that will use ${name} are still building sites`;
    }
    // (construction parts: towns build with them once they put up blocks, from Town size)
    if (p === "parts") return `No town on your roads is putting up a block: towns build with ${name} from Town size`;
    if (PRODUCTS[p].price > 0 && seg !== undefined) {
      for (const o of this.h.shops) {
        if (!o.access || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        if (t !== null && Number.isFinite(this.h.want(t, p))) return `Towns on your roads have all the ${name} they need today`;
      }
    }
    if (!this.used(p) && PRODUCTS[p].price <= 0) return `Nothing uses ${name} until tier ${Industry.laterTier(p)}: it stays in the yard`;
    if (PRODUCTS[p].price <= 0) return `No ${Industry.takers(p)} on your roads takes ${name}`;
    return `Nobody your roads reach buys ${name}`;
  }

  private send(from: Building, to: Building, product: Product, n: number) {
    const km = Math.hypot(to.c.x - from.c.x, to.c.y - from.c.y) / 1000;
    const fuel = km * 2 * FUEL_PER_KM;
    this.h.spend(fuel, "fuel");
    from.plant!.now.spent += fuel;
    from.plant!.now.sent += n;
    this.h.request({
      from: from.access!, fromSide: from.side, to: to.access!, toSide: to.side, truck: true, tries: 0, wait: 0,
      trip: { kind: "cargo", from: from.id, to: to.id, resident: -1, cargo: product, startT: this.h.time, freeFlow: 0, haul: { plant: from.id, leg: "out", product, n, dest: to.id } },
    });
  }

  /** A company truck arrived: unload and head home, or it is home. */
  onArrive(v: Vehicle) {
    const r = v.trip.haul!;
    if (r.done) return;
    r.done = true;
    if (r.leg === "back") return;
    const to = this.h.buildings.byId.get(r.dest);
    const home = this.h.buildings.byId.get(r.plant);
    if (to) this.deliver(to, r.product, r.n, home);
    // (the buyer was pulled down while the truck was on its way: the load goes back to the yard, to be sold elsewhere)
    else if (home?.plant) home.plant.out[r.product] = (home.plant.out[r.product] ?? 0) + r.n;
    if (to?.access && home?.access) {
      this.h.request({
        from: to.access, fromSide: to.side, to: home.access, toSide: home.side, truck: true, tries: 0, wait: 0,
        trip: { kind: "empty", from: to.id, to: home.id, resident: -1, startT: this.h.time, freeFlow: 0, haul: { plant: home.id, leg: "back", product: r.product, n: 0, dest: to.id } },
      });
    }
  }

  /** A truck gave up or lost its road: its load goes back to the yard, and the truck with it. */
  onFail(trip: Trip) {
    const r = trip.haul!;
    if (r.done) return;
    r.done = true;
    const home = this.h.buildings.byId.get(r.plant);
    if (r.leg === "out" && home?.plant) home.plant.out[r.product] = (home.plant.out[r.product] ?? 0) + r.n;
  }

  /**
   * Hand a load over: a building site takes its materials (and starts going up once it has them all), a plant
   * stocks it, a shop pays for it and its town counts it toward its need.
   */
  deliver(to: Building, product: Product, n: number, from?: Building) {
    if (to.plant) {
      const s = to.plant.site;
      if (s) {
        // (dispatch never sends more than is left; should two trucks still race, the spare load is left on the ground)
        const take = Math.min(n, Math.max(0, Industry.siteLeft(to, product)));
        s.got[product] = (s.got[product] ?? 0) + take;
        if (entries(s.need).every(([p, k]) => (s.got[p] ?? 0) >= k)) { delete to.plant.site; to.built = 0; }
        return;
      }
      to.plant.stock[product] = (to.plant.stock[product] ?? 0) + n;
      return;
    }
    // a town's building site: it takes what it still waits for (the town pays for it) and goes up once it has all
    if (to.site) {
      n = Math.min(n, Math.max(0, Industry.siteLeft(to, product)));
      to.site.got[product] = (to.site.got[product] ?? 0) + n;
      if (entries(to.site.need).every(([p, k]) => (to.site!.got[p] ?? 0) >= k)) delete to.site;
      if (n <= 0) return;
    }
    const pay = PRODUCTS[product].price * n;
    // (the shelves hold food; other products go on to the town's builders and homes)
    if (product === "food") to.stock = Math.min(6, to.stock + 3 * n);
    const t = this.h.townOf(to);
    if (t !== null) this.h.sold(t, product, n);
    this.h.earn(pay);
    if (from?.plant) from.plant.now.earned += pay;
  }

  /** Wages and upkeep, and the hour's books (a building site costs nothing to keep). */
  hourly() {
    for (const b of this.plants()) {
      const P = b.plant!;
      if (!P.site) {
        const wages = this.h.workersAt(b.id) * WAGE, up = PLANTS[b.kind as PlantKind].upkeep * levelMult(P.level) + (P.bought ?? 0) * TRUCK_UPKEEP;
        this.h.spend(wages, "wages");
        this.h.spend(up, "upkeep");
        P.now.spent += wages + up;
      }
      P.last = P.now;
      P.now = books();
    }
  }
}

function entries(o: Partial<Record<Product, number>>): [Product, number][] {
  return Object.entries(o) as [Product, number][];
}
