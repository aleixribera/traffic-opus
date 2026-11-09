// Town orders (docs/design.md, "Town orders"; owner, 2026-11-08: "like milestones we have to complete for each town,
// randomly appearing from time to time, getting bigger depending on the town's scale, and they add a specific special
// building to the town"). Every town has its own set of orders, five to eight civic buildings drawn from the
// catalogue (civics.ts) and seeded from the town, so a save always deals the same set. Each has a fixed grade (its
// difficulty) and opens only once the town has reached the size the building wants.
//
// Now and then (every five to ten game days, one at a time on the whole map: see the pacing constants below), one of
// them opens in a random town that can take it, the town asked last resting a turn so they spread over the map. An
// order asks for freight, sized to the town as it is when it opens and to its grade: "Millbrook wants a schoolhouse:
// 30 planks and 20 cement in 4 days", or, for a fair, that a need be kept in plenty for a few days ("Ridgefield's
// Fair: keep food at Plenty for 3 days"). Filled in time, the town gets its building (a building site first, then
// the building rising), a cash grant and a small perk for good. Missed, it costs nothing but the chance: it closes
// and asks again some days later, sized afresh.
//
// The difficulty is the freight, not the money (pillar 5): an order wants more of a product than the town takes to
// grow, every load of it driven through the player's roads.

import { mulberry32 } from "../core/noise";
import { dist, type V2 } from "../core/math";
import type { Game, GameEvent } from "./city";
import { CIVICS, CIVIC_KINDS, LV_REACH, isCivic, type CivicKind } from "./civics";
import { PLANTS, PRODUCTS, isPlantKind, type Product } from "./industry";
import { served, type Town } from "./settlements";
import { DAY } from "./society";
import { buys, demandPerDay, sizeOf } from "./towns";

// ---- pacing (owner, 2026-11-09: "one every 5-10 days, maximum 1 active whole map")
/** Most orders open at once on the whole map, and in one town. */
export const MAP_CAP = 1;
export const TOWN_CAP = 1;
/**
 * The gap before the next order, drawn evenly from GAP_MIN..GAP_MAX: counted from when the last one closed (filled
 * or missed), and for the very first from the start of the game.
 */
export const GAP_MIN = DAY * 5, GAP_MAX = DAY * 10;
/** The town whose order closed last isn't asked next while another town could be (it rests a turn). */
export const REST_A_TURN = true;
/** A town asks for orders once it has had a delivery and has this many people. */
export const ORDER_POP = 40;
/** A missed building isn't asked for again (in that town) for this long, or up to twice it. */
export const RETRY_AFTER = DAY * 6;
/** Saves made before this pacing carry an old, near next-order time: it is drawn afresh when one loads. */
const PACE = 2;
/** A fair's crowds: the town eats and drinks this much more than its usual need while one is on. */
export const FAIR = 1.25;
/** How much more than its need a delivery order asks for over its days, by grade (1-3). */
export const ORDER_K = [0, 1.15, 1.35, 1.55];
/** Share of what the loads asked for are worth that the grant pays. */
export const GRANT_SHARE = 0.6;

export type Grade = 1 | 2 | 3;

/** One of a town's orders: the building it brings, its grade, and how far it has got. */
export interface OrderSlot {
  kind: CivicKind;
  grade: Grade;
  state: "waiting" | "open" | "done";
  /** (waiting) it may open again from this time: it was missed */
  again?: number;
  /** (done) the building that stands for it, once there was room for it; and when it was filled */
  b?: number;
  at?: number;
}

/** An order open in a town. */
export interface Order {
  town: number;
  kind: CivicKind;
  grade: Grade;
  type: "deliver" | "fair";
  /** deliver: loads of each product wanted in all; fair: the products to keep in plenty */
  goods: Partial<Record<Product, number>>;
  /** deliver: loads of each delivered since it opened */
  got: Partial<Record<Product, number>>;
  /** fair: days in plenty it wants, and hours in plenty so far */
  days?: number;
  held?: number;
  opened: number;
  until: number;
  grant: number;
}

export interface OrdersJSON {
  sets: { town: number; slots: OrderSlot[] }[];
  open: Order[];
  nextAt: number | null;
  /** (from the second pacing on) the town whose order closed last */
  lastTown?: number | null;
  draws: number;
  /** the pacing the save was made under (none: the first, busier one) */
  pace?: number;
}

/** A save's orders, or none for a save from before them (its towns are dealt their sets on load). */
export type MaybeOrdersJSON = OrdersJSON | undefined;

/**
 * A town's set of orders, dealt from its seed and its id: five to eight civic buildings, at least two a hamlet can ask
 * for, each with a grade. The same town always gets the same set.
 */
export function dealSet(seed: number, town: number): OrderSlot[] {
  const r = mulberry32(((seed * 2654435761) ^ (town * 40503 + 0x9e3779b9)) >>> 0);
  const n = 5 + Math.floor(r() * 4);
  const pool = CIVIC_KINDS.slice();
  // (shuffled, then the hamlet's own first so every town has early orders, the rest in shuffled order)
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const small = pool.filter((k) => CIVICS[k].size === 0).slice(0, 2);
  const rest = pool.filter((k) => !small.includes(k));
  const kinds = [...small, ...rest.slice(0, n - small.length)];
  kinds.sort((a, b) => CIVICS[a].size - CIVICS[b].size || CIVIC_KINDS.indexOf(a) - CIVIC_KINDS.indexOf(b));
  return kinds.map((kind) => {
    // (a hamlet's orders are gentler: grade 1 or 2; a city's run to 3)
    const top = CIVICS[kind].size === 0 ? 2 : 3;
    const grade = (1 + Math.floor(r() * top)) as Grade;
    return { kind, grade, state: "waiting" };
  });
}

/** A round number of loads: to 5 under 100, to 10 under 1,000, to 50 beyond. */
export const roundLoads = (n: number) => {
  const q = n < 20 ? 1 : n < 100 ? 5 : n < 1000 ? 10 : 50;
  return Math.max(q, Math.round(n / q) * q);
};

/** What an order of a town of `pop` asks for, and what it pays (pure: `canBring` says what the company can deliver). */
export function sizeOrder(
  kind: CivicKind, grade: Grade, pop: number, canBring: (p: Product) => boolean, r: () => number,
): Omit<Order, "town" | "opened" | "until" | "got"> & { window: number } {
  const C = CIVICS[kind];
  const size = sizeOf(pop);
  const bought = (ps: Product[]) => ps.filter((p) => buys(pop, p));
  if (C.fair) {
    // a fair: one product kept in plenty in a village, two from Town size
    let ps = bought(C.fair.products).filter(canBring);
    if (!ps.length) ps = bought(C.fair.products).slice(0, 1);
    if (!ps.length) ps = ["food"];
    ps = ps.slice(0, size >= 2 ? 2 : 1);
    const days = 1 + grade;
    const goods: Partial<Record<Product, number>> = {};
    let worth = 0;
    for (const p of ps) {
      goods[p] = Math.ceil(demandPerDay(p, pop) * FAIR);
      worth += goods[p]! * days * PRODUCTS[p].price;
    }
    return { kind, grade, type: "fair", goods, days, held: 0, grant: grant(worth, grade), window: DAY * (days + 2 + grade) };
  }
  // a delivery: one product in a hamlet, two from a village, three in a big town's hardest
  let ps = bought(C.wants).filter(canBring);
  if (!ps.length) ps = bought(C.wants).slice(0, 1);
  if (!ps.length) ps = ["food"];
  const want = size === 0 ? 1 : size === 1 || grade < 3 ? 2 : 3;
  // (which ones, when it could ask for more: the first wanted, then a draw)
  const more = ps.slice(1);
  for (let i = more.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [more[i], more[j]] = [more[j], more[i]];
  }
  const pick = [ps[0], ...more].slice(0, want);
  const days = 3 + grade;
  const goods: Partial<Record<Product, number>> = {};
  let worth = 0;
  for (const p of pick) {
    goods[p] = roundLoads(demandPerDay(p, pop) * days * ORDER_K[grade]);
    worth += goods[p]! * PRODUCTS[p].price;
  }
  return { kind, grade, type: "deliver", goods, grant: grant(worth, grade), window: DAY * days };
}

/** The grant for an order whose loads are worth `worth` (to $1,000, at least $5,000). */
const grant = (worth: number, grade: Grade) => Math.max(5000, Math.round((worth * GRANT_SHARE * (0.9 + 0.1 * grade)) / 1000) * 1000);

/** Loads a day a town has had of p over the last day (fewer than a day of hours stand for the day). */
export function fairRate(t: Town, p: Product): number {
  const hours = (t.hours ?? []).slice(-24);
  let n = 0;
  for (const h of hours) n += h[p] ?? 0;
  return (n * 24) / Math.max(8, hours.length);
}

/** Loads a day a fair wants of p: the town's need, and a quarter more for the crowds. */
export const fairWant = (t: Town, p: Product) => demandPerDay(p, t.pop) * FAIR;

/** The product's name, lower case ("planks", "household goods"). */
const low = (p: Product) => PRODUCTS[p].name.toLowerCase();

/** An order in a line: "Millbrook wants a schoolhouse: 30 planks and 20 cement in 4 days". */
export function orderLine(o: Order, town: string): string {
  const C = CIVICS[o.kind];
  const ps = Object.keys(o.goods) as Product[];
  const list = (xs: string[]) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "");
  if (o.type === "fair") return `${town}'s ${C.fair?.event ?? "Fair"}: keep ${list(ps.map(low))} at Plenty for ${o.days} days`;
  const days = Math.round((o.until - o.opened) / DAY);
  return `${town} wants a ${C.name.toLowerCase()}: ${list(ps.map((p) => `${Math.round(o.goods[p]!)} ${low(p)}`))} in ${days} days`;
}

export class OrderSystem {
  /** each town's set, by town id */
  sets = new Map<number, OrderSlot[]>();
  open: Order[] = [];
  /** when the next order may open (null: not drawn yet, at the start of a game) */
  nextAt: number | null = null;
  /** the town whose order closed last (it rests a turn) */
  lastTown: number | null = null;
  /** random draws made so far (each draw seeded from the game's seed and this, so a save carries on the same) */
  private draws = 0;
  /** the land value the finished buildings add round them: building centres and how much */
  private lvSpots: { c: V2; lv: number }[] | null = null;

  constructor(private g: Game, private emit: (e: GameEvent) => void) {}

  private rnd(): number {
    return mulberry32(((this.g.seed * 7919) ^ (++this.draws * 2246822519)) >>> 0)();
  }

  /** A town's set (dealt the first time it is asked for). */
  setOf(town: number): OrderSlot[] {
    let s = this.sets.get(town);
    if (!s) this.sets.set(town, (s = dealSet(this.g.seed, town)));
    return s;
  }

  openIn(town: number): Order[] {
    return this.open.filter((o) => o.town === town);
  }

  /** How many of a town's orders are filled, of how many. */
  tally(town: number): { done: number; of: number } {
    const s = this.setOf(town);
    return { done: s.filter((x) => x.state === "done").length, of: s.length };
  }

  /** Can the company bring a product at all: a plant of its makes it, or the town has had some lately? */
  canBring(t: Town, p: Product): boolean {
    if ((t.rate?.[p] ?? 0) > 0 || (t.today[p] ?? 0) > 0 || (t.yesterday[p] ?? 0) > 0) return true;
    return this.g.buildings.sites.some((b) => isPlantKind(b.kind) && !!PLANTS[b.kind].outputs[p]);
  }

  /** Is a town ready for orders at all: it has had a delivery and has people enough? */
  canTake(t: Town): boolean {
    return served(t) && t.pop >= ORDER_POP;
  }

  /** Can a town take an order now: one that has had a delivery, with people enough, below its cap? */
  private takes(t: Town): OrderSlot[] {
    if (!this.canTake(t)) return [];
    if (this.openIn(t.id).length >= TOWN_CAP) return [];
    const now = this.g.time;
    return this.setOf(t.id).filter((s) => s.state === "waiting" && CIVICS[s.kind].size <= t.size && (s.again ?? -Infinity) <= now);
  }

  /** Every game hour: missed orders close, fairs count their hours, and now and then a new one opens. */
  hourly() {
    const now = this.g.time;
    for (const o of [...this.open]) {
      const t = this.g.towns.byId.get(o.town);
      if (!t) { this.open = this.open.filter((x) => x !== o); continue; }
      if (o.type === "fair") {
        if (this.fairOn(t, o)) o.held = (o.held ?? 0) + 1;
        if ((o.held ?? 0) >= (o.days ?? 1) * 24) { this.fill(o); continue; }
      }
      if (now >= o.until) this.lapse(o);
    }
    // the next order: five to ten days after the last one closed (the first, into the game), in a random town that
    // can take one (none can: it waits for one, hour by hour)
    if (this.nextAt === null) this.nextAt = now + this.gap();
    if (this.open.length >= MAP_CAP || now < this.nextAt) return;
    this.openOne();
  }

  /** A gap before the next order, drawn evenly from GAP_MIN..GAP_MAX. */
  private gap(): number {
    return GAP_MIN + this.rnd() * (GAP_MAX - GAP_MIN);
  }

  /** An order closed (filled or missed): the next comes a gap from now, and its town rests a turn. */
  private closed(o: Order) {
    this.lastTown = o.town;
    if (this.open.length < MAP_CAP) this.nextAt = this.g.time + this.gap();
  }

  /**
   * Open an order in one of these towns: one with fewer open and none for a while is likelier (`kind`: that building's,
   * for tests and the debug hook).
   */
  openOne(ready: Town[] = this.g.towns.list.filter((t) => this.takes(t).length > 0), kind?: CivicKind): Order | null {
    // (only towns that can take one now, of that building if one is named)
    ready = ready.filter((t) => this.takes(t).some((s) => !kind || s.kind === kind));
    // (the town asked last rests a turn, while another could be asked)
    if (REST_A_TURN && ready.length > 1) ready = ready.filter((t) => t.id !== this.lastTown);
    if (!ready.length || this.open.length >= MAP_CAP) return null;
    const now = this.g.time;
    const weight = (t: Town) => {
      const last = Math.max(-Infinity, ...this.setOf(t.id).map((s) => s.at ?? -Infinity), ...this.openIn(t.id).map((o) => o.opened));
      const idle = Number.isFinite(last) ? Math.min(3, Math.max(0.25, (now - last) / DAY)) : 3;
      return idle / (1 + this.openIn(t.id).length * 2);
    };
    const ws = ready.map(weight);
    let x = this.rnd() * ws.reduce((a, b) => a + b, 0), k = 0;
    while (k < ready.length - 1 && (x -= ws[k]) > 0) k++;
    const t = ready[k];
    const slots = this.takes(t).filter((x) => !kind || x.kind === kind);
    const s = slots[Math.floor(this.rnd() * slots.length)];
    const sized = sizeOrder(s.kind, s.grade, t.pop, (p) => this.canBring(t, p), () => this.rnd());
    const { window, ...rest } = sized;
    const o: Order = { ...rest, town: t.id, got: {}, opened: now, until: now + window };
    s.state = "open";
    delete s.again;
    this.open.push(o);
    this.emit({ t: "order", phase: "open", town: t.id, kind: s.kind });
    return o;
  }

  /** Is a fair's town kept in plenty: every product's last day of loads at its crowds' need? */
  fairOn(t: Town, o: Order): boolean {
    return (Object.keys(o.goods) as Product[]).every((p) => fairRate(t, p) >= fairWant(t, p) - 1e-9);
  }

  /** How far along an order is, 0..1. */
  progress(o: Order): number {
    if (o.type === "fair") return Math.min(1, (o.held ?? 0) / ((o.days ?? 1) * 24));
    let need = 0, got = 0;
    for (const [p, n] of Object.entries(o.goods) as [Product, number][]) { need += n; got += Math.min(n, o.got[p] ?? 0); }
    return need > 0 ? got / need : 1;
  }

  /** Loads reached a town: they count toward its open delivery orders. */
  onSold(town: number, p: Product, n: number) {
    for (const o of this.open) {
      if (o.town !== town || o.type !== "deliver" || o.goods[p] === undefined) continue;
      o.got[p] = (o.got[p] ?? 0) + n;
      if ((Object.entries(o.goods) as [Product, number][]).every(([q, k]) => (o.got[q] ?? 0) >= k - 1e-9)) this.fill(o);
    }
  }

  /** An order filled: its grant, its building going up in the town, its perk from now on. Once only. */
  fill(o: Order) {
    if (!this.open.includes(o)) return;
    this.open = this.open.filter((x) => x !== o);
    const s = this.setOf(o.town).find((x) => x.kind === o.kind);
    if (!s || s.state === "done") return;
    s.state = "done";
    s.at = this.g.time;
    this.g.money += o.grant;
    const b = this.g.addCivic(o.town, o.kind);
    if (b) s.b = b.id;
    this.lvSpots = null;
    this.closed(o);
    this.emit({ t: "order", phase: "done", town: o.town, kind: o.kind, b: b?.id, grant: o.grant });
    this.emit({ t: "money" });
  }

  /** An order missed: it closes, and asks again some days later. */
  lapse(o: Order) {
    this.open = this.open.filter((x) => x !== o);
    const s = this.setOf(o.town).find((x) => x.kind === o.kind);
    if (s && s.state === "open") {
      s.state = "waiting";
      s.again = this.g.time + RETRY_AFTER * (1 + this.rnd());
    }
    this.closed(o);
    this.emit({ t: "order", phase: "lapsed", town: o.town, kind: o.kind });
  }

  /** Every day: buildings of filled orders that found no room yet try again (a town grows new streets). */
  daily() {
    // (town by town in the towns' order, not the order their sets were first looked at: a panel opened mustn't change
    // which building takes which id)
    for (const t of this.g.towns.list) {
      const town = t.id, slots = this.sets.get(town);
      if (!slots) continue;
      for (const s of slots) {
        if (s.state !== "done" || (s.b && this.g.buildings.byId.has(s.b))) continue;
        const b = this.g.addCivic(town, s.kind);
        if (b) { s.b = b.id; this.lvSpots = null; }
      }
    }
  }

  /** The perks of a town's filled orders, multiplied together. */
  boost(town: number): { growth: number; demand: number } {
    const s = this.sets.get(town);
    let growth = 1, demand = 1;
    if (s) for (const x of s) {
      if (x.state !== "done") continue;
      growth *= CIVICS[x.kind].perk.growth ?? 1;
      demand *= CIVICS[x.kind].perk.demand ?? 1;
    }
    return { growth, demand };
  }

  /** Land value the civic buildings add at p (the best one's, fading out to LV_REACH). */
  landValueAt(p: V2): number {
    if (!this.lvSpots) {
      this.lvSpots = [];
      for (const b of this.g.buildings.list) {
        if (!isCivic(b.kind) || b.built < 1) continue;
        const lv = CIVICS[b.kind].perk.lv;
        if (lv) this.lvSpots.push({ c: b.c, lv });
      }
    }
    let best = 0;
    for (const s of this.lvSpots) {
      const d = dist(p, s.c);
      if (d < LV_REACH) best = Math.max(best, s.lv * (1 - d / LV_REACH));
    }
    return best;
  }

  /** A building went up or came down: the land value spots are found again. */
  invalidate() {
    this.lvSpots = null;
  }

  toJSON(): OrdersJSON {
    return {
      sets: [...this.sets].sort((a, b) => a[0] - b[0]).map(([town, slots]) => ({ town, slots: slots.map((s) => ({ ...s })) })),
      open: this.open.map((o) => ({ ...o, goods: { ...o.goods }, got: { ...o.got } })),
      nextAt: this.nextAt,
      lastTown: this.lastTown,
      draws: this.draws,
      pace: PACE,
    };
  }

  /** From a save (none: a save from before the orders, whose towns are dealt their sets and start rolling them). */
  load(d: MaybeOrdersJSON) {
    this.sets.clear();
    this.open = [];
    this.nextAt = null;
    this.lastTown = null;
    this.draws = 0;
    this.lvSpots = null;
    if (!d) return;
    for (const x of d.sets) if (this.g.towns.byId.has(x.town)) this.sets.set(x.town, x.slots.filter((s) => isCivic(s.kind)).map((s) => ({ ...s })));
    this.open = d.open.filter((o) => this.g.towns.byId.has(o.town) && isCivic(o.kind));
    this.draws = d.draws;
    this.lastTown = d.lastTown ?? null;
    // (a save from the first, busier pacing: its orders still open run on, and the next one is a full gap away)
    this.nextAt = d.pace === PACE ? d.nextAt : this.g.time + this.gap();
  }
}
