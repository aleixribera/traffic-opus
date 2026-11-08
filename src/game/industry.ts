// The company's industry: extractors on deposits, plants that turn one product into another, and each building's
// own trucks, which carry every load over the player's roads (see docs/design.md, "Chains" and "Freight").
// Nothing here draws a route: a loaded truck goes to the customer worth most to the company, own plants short of
// an input first, then the shops of towns that still need the product today (see towns.ts), nearest and neediest
// first. The company is paid only for loads delivered to a town.

import type { V2 } from "../core/math";
import type { Building, Buildings } from "./buildings";
import type { BuildingKind } from "../config";
import type { PendingSpawn, Trip, Vehicle } from "../sim/traffic";
import { F } from "../world/gen";

export type Product = "crops" | "logs" | "food" | "planks" | "ore" | "coal" | "lime" | "steel" | "cement";

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
  food: { name: "Food", price: 450, color: 0xe2704a },
  planks: { name: "Planks", price: 400, color: 0xe8cf8f },
  ore: { name: "Iron ore", price: 0, color: 0x93603f },
  coal: { name: "Coal", price: 0, color: 0x3a3a3e },
  lime: { name: "Limestone", price: 0, color: 0xd9d3bd },
  // (steel goes to the construction plants of tier 3: no town buys it)
  steel: { name: "Steel", price: 0, color: 0x8a96a3 },
  cement: { name: "Cement", price: 650, color: 0xb9b6ae },
};

export type PlantKind = "farm" | "loggingcamp" | "foodplant" | "sawmill" | "ironmine" | "coalmine" | "quarry" | "smelter" | "cementworks" | "coalplant";

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
    cycle: HOUR * 1.5, cost: 12000, upkeep: 12, trucks: 2, store: 8,
    blurb: "Grows crops on fertile soil. Its trucks take them to your food plants.",
  },
  loggingcamp: {
    kind: "loggingcamp", tier: 1, deposit: { field: F.forest, name: "forest" }, inputs: {}, outputs: { logs: 1 },
    cycle: HOUR * 1.5, cost: 10000, upkeep: 10, trucks: 2, store: 8,
    blurb: "Fells timber in the forest. Its trucks take the logs to your sawmills.",
  },
  foodplant: {
    kind: "foodplant", tier: 1, inputs: { crops: 1 }, outputs: { food: 1 },
    cycle: HOUR, cost: 25000, upkeep: 25, trucks: 2, store: 8,
    blurb: "Turns crops into food. Its trucks sell the food to the towns' shops.",
  },
  sawmill: {
    kind: "sawmill", tier: 1, inputs: { logs: 1 }, outputs: { planks: 1 },
    cycle: HOUR, cost: 22000, upkeep: 22, trucks: 2, store: 8,
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
};

export const PLANT_KINDS = Object.keys(PLANTS) as PlantKind[];
export const isPlantKind = (k: BuildingKind | string): k is PlantKind => k in PLANTS;
/** What each worker is paid per hour. */
export const WAGE = 1;
/** Least share of an extractor's lot that must sit on its deposit. */
export const MIN_DEPOSIT = 0.35;
/** Fuel and wear per km a truck drives (both ways), charged when it sets off. */
export const FUEL_PER_KM = 4;
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
  /** trucks it owns (on top of the bays every building gains from milestones) */
  trucks: number;
  /** a construction site: the materials it waits for, and what has arrived */
  site?: { need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>> };
  /** this hour's and the last full hour's books */
  now: PlantBooks;
  last: PlantBooks;
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
    b.plant = { stock: {}, out: {}, prog: 0, yld, trucks: d.trucks, now: books(), last: books() };
    if (d.site) b.plant.site = { need: { ...d.site }, got: {} };
  }

  /** Trucks a plant runs: its own, plus the bays milestones added (a power plant has none). */
  trucksOf(b: Building): number {
    const P = b.plant!;
    return P.trucks > 0 ? P.trucks + (this.h.bays?.() ?? 0) : 0;
  }

  /** Is it up and working (not a site, not being built)? */
  static running(b: Building): boolean {
    return !!b.plant && !b.plant.site && b.built >= 1;
  }

  /** Loads of a material a site still waits for (not counting what is on its way). */
  static siteLeft(b: Building, p: Product): number {
    const s = b.plant?.site;
    return s ? (s.need[p] ?? 0) - (s.got[p] ?? 0) : 0;
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
    const short = () => entries(d.inputs).find(([p, n]) => (P.stock[p] ?? 0) < n)?.[0];
    const full = () => entries(d.outputs).find(([p]) => (P.out[p] ?? 0) >= d.store)?.[0];
    if (b.access && staff > 0 && !idle && !short() && !full()) {
      P.prog += (span * staff * P.yld * powerPace(pw)) / d.cycle;
      while (P.prog >= 1) {
        P.prog -= 1;
        for (const [p, n] of entries(d.inputs)) P.stock[p] = (P.stock[p] ?? 0) - n;
        for (const [p, n] of entries(d.outputs)) { P.out[p] = (P.out[p] ?? 0) + n; P.now.made += n; this.h.made?.(p, n); }
        if (short() || full()) { P.prog = 0; break; }
      }
    }
    // the most pressing thing that holds it up (the trucks may add "nobody buys" when they find no customer)
    const s = short(), f = full();
    const fname = f && PRODUCTS[f].name.toLowerCase();
    b.problem = !b.access ? "No road access"
      : f ? (PRODUCTS[f].price > 0 || this.used(f) ? `Full of ${fname}: not enough trucks, or nobody to sell to` : `Full of ${fname}: nothing uses it until tier 3`)
      : staff <= 0 ? "No workers"
      : s ? `Waiting for ${PRODUCTS[s].name.toLowerCase()}`
      : idle ? "Idle: no tier 2 building within reach needs power"
      : staff < 0.5 ? "Not enough workers"
      : pw <= 0 ? `No power: working at ${Math.round(UNPOWERED * 100)}%`
      : pw < 0.999 ? `Short of power: working at ${Math.round(powerPace(pw) * 100)}%`
      : null;
  }

  /** Does any building of the company's take this product in (as an input or as a building material)? */
  private used(p: Product): boolean {
    return PLANT_KINDS.some((k) => PLANTS[k].inputs[p] || PLANTS[k].site?.[p]);
  }

  /** Who would take a load of `product` from `from`, best first. */
  customers(from: Building, product: Product, coming: Map<number, Map<Product, number>> = this.census().coming): Customer[] {
    const out: Customer[] = [];
    const seg = from.access?.seg;
    if (seg === undefined) return out;
    const on = (id: number) => coming.get(id)?.get(product) ?? 0;
    const km = (o: Building) => Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y) / 1000;
    for (const o of this.h.buildings.list) {
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
      const room = PLANTS[o.kind as PlantKind].store - (o.plant.stock[product] ?? 0) - on(o.id);
      if (room < 1) continue;
      out.push({ b: o, value: 10000 + room * 100 - km(o) * FUEL_PER_KM * 2, room });
    }
    // the towns' shops buy finished products, as much as each town uses in a day
    const price = PRODUCTS[product].price;
    if (price > 0) {
      // what each town still wants today, less what is already on its way to any of its shops
      const left = new Map<number, number>();
      for (const o of this.h.shops) {
        const t = this.h.townOf(o);
        if (t !== null) left.set(t, (left.get(t) ?? this.h.want(t, product)) - on(o.id));
      }
      for (const o of this.h.shops) {
        if (!o.access || o.abandoned || o.built < 1 || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        const l = t === null ? 0 : left.get(t)!;
        if (l < 1) continue;
        // nearest first; a town further short of its need, and a shop with emptier shelves, a little ahead
        out.push({ b: o, value: price - km(o) * FUEL_PER_KM * 2 + Math.min(3, l) * 15 - (product === "food" ? o.stock * 15 : 0), room: Math.ceil(l) });
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
    for (const [p] of entries(PLANTS[b.kind as PlantKind].outputs)) {
      while (free > 0 && (P.out[p] ?? 0) >= 1) {
        const c = this.customers(b, p, coming)[0];
        if (!c) {
          if ((P.out[p] ?? 0) >= 2 && b.problem !== "No road access" && !b.problem?.startsWith("Full of")) b.problem = this.noBuyer(b, p);
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
        if (!o.plant.site) return `Your plants that use ${name} have all they can store`;
        site = true;
      }
      if (site) return `The plants that will use ${name} are still building sites`;
    }
    if (PRODUCTS[p].price > 0 && seg !== undefined) {
      for (const o of this.h.shops) {
        if (!o.access || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        if (t !== null && Number.isFinite(this.h.want(t, p))) return `Towns on your roads have all the ${name} they need today`;
      }
    }
    if (!this.used(p) && PRODUCTS[p].price <= 0) return `Nothing uses ${name} until tier 3: it stays in the yard`;
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
        const wages = this.h.workersAt(b.id) * WAGE, up = PLANTS[b.kind as PlantKind].upkeep;
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
