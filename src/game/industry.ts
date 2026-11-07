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

export type Product = "crops" | "logs" | "food" | "planks";

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
};

export type PlantKind = "farm" | "loggingcamp" | "foodplant" | "sawmill";

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
    blurb: "Saws logs into planks. Its trucks sell the planks to the towns.",
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
  /** trucks it owns */
  trucks: number;
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
}

export interface Customer { b: Building; value: number }

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

  /** Make a freshly placed building one of the company's plants. */
  init(b: Building, kind: PlantKind, yld = 1) {
    const d = PLANTS[kind];
    b.plant = { stock: {}, out: {}, prog: 0, yld, trucks: d.trucks, now: books(), last: books() };
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

  /** Work through the current batch: staff, deposit and inputs on hand set the pace; a full store stops it. */
  produce(b: Building, span: number) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    const staff = b.cap ? Math.min(1, this.h.workersAt(b.id) / b.cap) : 1;
    const short = () => entries(d.inputs).find(([p, n]) => (P.stock[p] ?? 0) < n)?.[0];
    const full = () => entries(d.outputs).find(([p]) => (P.out[p] ?? 0) >= d.store)?.[0];
    if (b.access && staff > 0 && !short() && !full()) {
      P.prog += (span * staff * P.yld) / d.cycle;
      while (P.prog >= 1) {
        P.prog -= 1;
        for (const [p, n] of entries(d.inputs)) P.stock[p] = (P.stock[p] ?? 0) - n;
        for (const [p, n] of entries(d.outputs)) { P.out[p] = (P.out[p] ?? 0) + n; P.now.made += n; }
        if (short() || full()) { P.prog = 0; break; }
      }
    }
    // the most pressing thing that holds it up (the trucks may add "nobody buys" when they find no customer)
    const s = short(), f = full();
    b.problem = !b.access ? "No road access"
      : f ? `Full of ${PRODUCTS[f].name.toLowerCase()}: not enough trucks, or nobody to sell to`
      : staff <= 0 ? "No workers"
      : s ? `Waiting for ${PRODUCTS[s].name.toLowerCase()}`
      : staff < 0.5 ? "Not enough workers" : null;
  }

  /** Who would take a load of `product` from `from`, best first. */
  customers(from: Building, product: Product, coming: Map<number, Map<Product, number>> = this.census().coming): Customer[] {
    const out: Customer[] = [];
    const seg = from.access?.seg;
    if (seg === undefined) return out;
    const on = (id: number) => coming.get(id)?.get(product) ?? 0;
    const km = (o: Building) => Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y) / 1000;
    // own plants short of it: they keep the chain running (worth more than any sale)
    for (const o of this.h.buildings.list) {
      if (!o.plant || o.id === from.id || !o.access || !this.h.connected(seg, o.access.seg)) continue;
      const need = PLANTS[o.kind as PlantKind].inputs[product];
      if (!need) continue;
      const room = PLANTS[o.kind as PlantKind].store - (o.plant.stock[product] ?? 0) - on(o.id);
      if (room < 1) continue;
      out.push({ b: o, value: 10000 + room * 100 - km(o) * FUEL_PER_KM * 2 });
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
        out.push({ b: o, value: price - km(o) * FUEL_PER_KM * 2 + Math.min(3, l) * 15 - (product === "food" ? o.stock * 15 : 0) });
      }
    }
    out.sort((a, b) => b.value - a.value);
    return out;
  }

  /** Send free trucks off with whatever is waiting. */
  private dispatch(b: Building, busy: Map<number, number>, coming: Map<number, Map<Product, number>>) {
    const P = b.plant!;
    if (!b.access) return;
    let free = P.trucks - (busy.get(b.id) ?? 0);
    for (const [p] of entries(PLANTS[b.kind as PlantKind].outputs)) {
      while (free > 0 && (P.out[p] ?? 0) >= 1) {
        const c = this.customers(b, p, coming)[0];
        if (!c) {
          if ((P.out[p] ?? 0) >= 2 && b.problem !== "No road access") b.problem = this.noBuyer(b, p);
          break;
        }
        this.send(b, c.b, p, 1);
        P.out[p]! -= 1;
        free--;
        busy.set(b.id, (busy.get(b.id) ?? 0) + 1);
        let m = coming.get(c.b.id);
        if (!m) coming.set(c.b.id, (m = new Map()));
        m.set(p, (m.get(p) ?? 0) + 1);
      }
    }
  }

  /** Why a load has nowhere to go: no town on its roads uses it, or they all have enough for today. */
  private noBuyer(from: Building, p: Product): string {
    const name = PRODUCTS[p].name.toLowerCase();
    const seg = from.access?.seg;
    if (seg !== undefined) {
      for (const o of this.h.buildings.list) {
        if (o.plant && o.access && PLANTS[o.kind as PlantKind].inputs[p] && this.h.connected(seg, o.access.seg)) return `Your plants that use ${name} have all they can store`;
      }
    }
    if (PRODUCTS[p].price > 0 && seg !== undefined) {
      for (const o of this.h.shops) {
        if (!o.access || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        if (t !== null && Number.isFinite(this.h.want(t, p))) return `Towns on your roads have all the ${name} they need today`;
      }
    }
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

  /** Hand a load over: a plant stocks it; a shop pays for it and its town counts it toward its need. */
  deliver(to: Building, product: Product, n: number, from?: Building) {
    if (to.plant) {
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

  /** Wages and upkeep, and the hour's books. */
  hourly() {
    for (const b of this.plants()) {
      const P = b.plant!;
      const wages = this.h.workersAt(b.id) * WAGE, up = PLANTS[b.kind as PlantKind].upkeep;
      this.h.spend(wages, "wages");
      this.h.spend(up, "upkeep");
      P.now.spent += wages + up;
      P.last = P.now;
      P.now = books();
    }
  }
}

function entries(o: Partial<Record<Product, number>>): [Product, number][] {
  return Object.entries(o) as [Product, number][];
}
