import { loadCompany, makeCompany, type Company } from "./company";
import {
  BUILDING_TYPES, DEMOLISH_PER_LEVEL, ROAD_TYPES, SIDEWALK, SIGNAL_COST, SIM, isHighway, roadGroup, roadWidth, takesGate,
  type RoadTypeId,
} from "../config";
import { add, dist, dist2, pointSegDist2, rectCorners, rectDistance, scale, sub, type V2 } from "../core/math";
import { mulberry32 } from "../core/noise";
import { RoadNetwork, type ChangeSet, type Op, type SignalPlan } from "../roads/network";
import {
  applyPave, applyTrim, chainPoints, cubicClosest, planRoad, snap, strokeProfile, commitRoundabout, commitStrokes, removalRefund, segCost, upgradeCost, type BuildWorld, type LanePlan, type Plan, type PlanError,
} from "../roads/planner";
import { fromLot, Traffic, type TrafficSave, type Trip, type Vehicle } from "../sim/traffic";
import { SITE_LEVELS, siteFrame } from "./sites";
import { Terrain } from "../world/terrain";
import { Buildings, TOWN_STREET, obbOverlap, type Building, type BuildingMove } from "./buildings";
import { LEVEL_LV, ZONE_GROUP, ZONE_LOTS, capacity, modelFit, wallLots, type LotTemplate } from "./growables";
import { Progress, levelBy, levelCap, type Feature, type Milestone, type ProgressView } from "./progression";
import { DAY, HOUR, Society } from "./society";
import { PLACED, SHORE_REACH, type PlacedKind } from "./placed";
import { buildStep } from "./construction";
import { Industry, MIN_DEPOSIT, PLANTS, PRODUCTS, isPlantKind, perishable, type Delivery, type Product } from "./industry";
import { TRUCK_CLASS_ORDER, type TruckClass } from "./trucks";
import { PARTS_FOR, SQUARE_INSET, TownSystem, type Spawned } from "./settlements";
import { BLOCK, CARS_PER_LOAD, blockOf, demandPerDay, gridPt, isHall, needsOf, smokeReach } from "./towns";
import { F } from "../world/gen";
import { Transit } from "./transit";
import { Utilities } from "./utilities";
import { START_YDAY, fieldLook, seasonMult, setYearStart } from "./calendar";
import { BIG_NAME, Convoys, TURBINE_BOOST, type BigKind } from "./convoys";
import { isMega, megaBlock, megaStage, piecesLeft, townAt } from "./megaprojects";
import { PARK_SMOKE, Parks } from "./parks";
import { sizeOf } from "./towns";
import { OrderSystem } from "./orders";
import { CIVICS, isCivic, type CivicKind } from "./civics";
import type { PlaceOpts, Placement } from "./buildings";
import type { BuildingKind } from "../config";
import { CELL, DEPTH, MIN_LOT_DEPTH, ZoneMap, zoneEdge, type Block, type Cell, type ZoneGroup, type ZoneId } from "./zones";

interface UndoEntry {
  label: string;
  ops: Op[];
  money: number; // money spent (negative = refunded)
  added: Building[];
  removed: Building[];
  moved?: BuildingMove[]; // lots pushed back by a road widening
}

export type GameEvent =
  | { t: "roads"; cs: ChangeSet }
  | { t: "buildings" }
  | { t: "zones" }
  | { t: "milestone"; m: Milestone; towns?: number[] }
  /** a fresh town sprang up (a milestone's reward): where, against the nearest town before it */
  | { t: "townSpawned"; town: number; from: number | null; dist: number; dir: string }
  | { t: "money" }
  | { t: "toast"; msg: string }
  /** a town has grown into a new size */
  | { t: "townSize"; town: number; size: number }
  /** one of the company's landmarks is finished (its banner) */
  | { t: "landmark"; b: number }
  /** an oversized-load convoy set off ("out") or got there ("in") */
  | { t: "convoy"; phase: "out" | "in"; kind: BigKind; from: number; to: number }
  /** a town order opened, was filled (its building going up: b, and its grant) or lapsed (orders.ts) */
  | { t: "order"; phase: "open" | "done" | "lapsed"; town: number; kind: CivicKind; b?: number; grant?: number }
  /** a load was handed over (the map pops its money; a perishable shows how fresh it came, cars arrive in town) */
  | { t: "delivery"; d: Delivery }
  /** a by-product left a plant for another plant, as its own cargo */
  | { t: "shipped"; from: Building; to: Building; p: Product; n: number };

/** The company's books for an hour. Income comes only from loads delivered to towns (and bus fares). */
export interface Budget {
  income: Record<"sales" | "transit", number>;
  expense: Record<"roads" | "wages" | "upkeep" | "fuel" | "transit" | "loans", number>;
}

/** Save format: 4 = the industrial company (plants, towns that grow themselves, no player zoning); 5 = tier 2,
 * building sites, company power and the milestone ladder. */
export const SAVE_V = 5;

/** Money a new company starts with: the first chain and plenty of road, room to try things (owner, 2026-11-08: $250k). */
/** Households the company's first hamlet has when the game starts (about 2.5 people each). */
export const START_HAMLET_HH = 30;
export const START_MONEY = 250000;
/** A new site's street starts this far out of its gate (where a road drawn to the gate ends too)... */
export const GATE_LINK_OUT = 7;
/** ...and joins a road at most this far away (m); further out the site waits for the player's road. */
export const GATE_LINK_REACH = 400;
/**
 * Further out, the game offers a dirt road from the gate to the nearest road it can reach within this (m): drawn
 * dashed with its price while the site is placed and while it waits, built with one click (review 2026-11-10).
 */
export const ROAD_TO_REACH = 6000;

export class Game {
  seed: number;
  terrain: Terrain;
  net = new RoadNetwork();
  traffic: Traffic;
  buildings: Buildings;
  zones: ZoneMap;
  people: Society;
  transit: Transit;
  utilities: Utilities;
  industry: Industry;
  /** oversized pieces from the machine works, shipped by convoy (convoys.ts) */
  convoys: Convoys;
  /** conveyors and pipes between neighbouring plants (parks.ts) */
  parks: Parks;
  towns: TownSystem;
  /** each town's orders: the civic buildings it asks the company for (orders.ts) */
  orders: OrderSystem;
  money = 0;
  time = 0;
  playtime = 0;
  /** The day of the year its clock started on (calendar.yearStart while it is the game in play). */
  calStart = START_YDAY;
  speed = 1;
  paused = false;
  readonly dt = SIM.dt;
  /** milestones reached and the tallies they are measured on */
  progress = new Progress();
  cityName = "Larkfield";
  /** The company: its name and herald (generated from the seed; the player may rename it). */
  company: Company;
  /** Per game hour: last complete hour, and the one being counted. */
  budget: Budget = emptyBudget();
  private budgetNow: Budget = emptyBudget();
  /** the books of the last day's hours (deliveries come in lumps: the average says more than one hour) */
  budgetLog: Budget[] = [];
  /** Money at the end of each of the last 48 hours. */
  history: { money: number; pop: number; jobs: number }[] = [];
  rng: () => number;
  private acc = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];
  private tickT = 0;
  private lvPart = 0; // which eighth of the buildings the next tick values (see landValue)
  private hourT = 0;
  /** the day number the shops and towns last closed their books on */
  private dayN = -1;
  failedTrips = 0;
  readonly world: BuildWorld;
  private comp = new Map<number, number>(); // node id -> connected component
  private compVersion = -1;
  private shopCache: Building[] | null = null;
  /** empty zoned front-row cells where a lot could start, per town and group ("town:group") */
  private candCache = new Map<string, Cell[]>();
  private freeCache = new Map<string, number>();
  private midRebuilds: ChangeSet[] = []; // rebuilds part-way through the edit being applied (see autoLights)
  private candVersion = -1;
  /** Roads whose use is blocked (no route); shown as notifications. */
  noRouteAt = new Map<number, number>();

  constructor(seed = 7) {
    this.seed = seed;
    setYearStart(this.calStart);
    this.rng = mulberry32(seed * 31 + 5);
    this.company = makeCompany(seed);
    this.terrain = new Terrain(seed);
    this.buildings = new Buildings(this.net);
    this.traffic = new Traffic(this.net, {
      arrive: (v, now) => this.onArrive(v, now),
      fail: (trip, reason) => this.onFail(trip, reason),
      busAt: (v) => this.transit.busAt(v),
    });
    this.traffic.whereIs = (id) => {
      const b = this.buildings.byId.get(id);
      return b?.access ? { ...b.access, side: b.side } : null;
    };
    this.money = START_MONEY;
    const t = this.terrain;
    // (towns grow on any land, never inside the fence of one of the company's sites)
    this.zones = new ZoneMap(this.net, { isWater: (p) => t.isWater(p), isMountain: (p) => t.isMountain(p), taken: (p) => this.inSite(p), landKey: () => this.buildings.sites.map((b) => b.id).join() });
    this.people = new Society(this);
    this.transit = new Transit(this);
    this.utilities = new Utilities(this);
    this.towns = new TownSystem(this);
    this.orders = new OrderSystem(this, (e) => this.emit(e));
    const game = this;
    this.industry = new Industry({
      get time() { return game.time; },
      buildings: this.buildings,
      has: (f, p) => t.has(f, p),
      connected: (a, b) => this.connected(a, b),
      workersAt: (id) => this.people.workersAt(id),
      get shops() { return game.shops; },
      townOf: (b) => b.town ?? null,
      want: (town, p) => this.towns.want(town, p),
      short: (town, p) => this.towns.short(town, p),
      dipIn: (town, p, arriving) => this.towns.dipIn(town, p, arriving),
      sold: (town, p, n) => { this.towns.sold(town, p, n); this.progress.onSold(p, n); this.orders.onSold(town, p, n); },
      request: (sp) => this.traffic.request(sp),
      trips: () => this.trips(),
      held: () => this.heldTrips(),
      queued: () => this.gateQueues(),
      supply: (t, p) => this.towns.byId.get(t)?.supply[p] ?? 0,
      earn: (v) => { this.money += v; this.budgetNow.income.sales += v; this.progress.onEarned(v); },
      spend: (v, what) => { this.money -= v; this.budgetNow.expense[what] += v; },
      levelCap: (kind, at) => {
        const level = levelCap(this.progress.unlocked, kind, SITE_LEVELS);
        // (a site loaded above its kind's cap waits for the goal of the level after its own)
        const next = Math.max(level, at) + 1;
        return { level, goal: next <= SITE_LEVELS ? levelBy(kind, next)?.name : undefined };
      },
      truckClass: () => this.bestTruck(),
      power: (b) => this.utilities.supplyOf(b),
      wanted: (b) => this.utilities.wanted(b),
      made: (p, n) => this.progress.onMade(p, n),
      madeAt: (b, _p, n) => this.convoys.made(b, n),
      season: (k) => seasonMult(k, this.time),
      // a supply (fertilizer, explosives, machinery) is only asked of sites once a plant that makes it is unlocked
      canMake: (p) => [...this.progress.unlocked.buildings].some((k) => isPlantKind(k) && !!PLANTS[k].outputs[p]),
      delivered: (d) => this.delivered(d),
      shipped: (from, to, p, n) => this.emit({ t: "shipped", from, to, p, n }),
      grew: (b, level) => { this.toast(`${BUILDING_TYPES[b.kind].name} grew to level ${level}: more output, jobs and trucks`); this.emit({ t: "buildings" }); },
    });
    this.convoys = new Convoys({
      get time() { return game.time; },
      buildings: this.buildings,
      connected: (a, b) => this.connected(a, b),
      request: (sp) => this.traffic.request(sp),
      trips: () => this.trips(),
      piecesLeft: (b) => piecesLeft(b, isPlantKind(b.kind) ? PLANTS[b.kind] : undefined),
      pieceIn: (b) => {
        const L = (b.plant!.landmark ??= { pieces: 0 });
        L.pieces++;
        Industry.finishSite(b);
      },
      delivered: (kind, to) => {
        this.progress.onPiece();
        this.checkMilestones();
        const name = BUILDING_TYPES[to.kind].name;
        const mega = isMega(to.kind);
        this.toast(mega
          ? `${BIG_NAME[kind]} delivered to the ${name} site`
          : `${BIG_NAME[kind]} installed at the ${name}: +${Math.round(TURBINE_BOOST * 100)}% power for good`);
        this.emit({ t: "convoy", phase: "in", kind, from: -1, to: to.id });
      },
      departed: (kind, from, to) => {
        this.toast(`Oversized load: a ${BIG_NAME[kind].toLowerCase()} leaves the ${BUILDING_TYPES[from.kind].name} for the ${BUILDING_TYPES[to.kind].name}, under escort`);
        this.emit({ t: "convoy", phase: "out", kind, from: from.id, to: to.id });
      },
      toast: (msg) => this.toast(msg),
    });
    this.parks = new Parks({
      buildings: this.buildings,
      pay: (v) => { this.money -= v; this.budgetNow.expense.upkeep += v; },
    });
    this.world = {
      isWater: (p) => t.isWater(p),
      isMountain: (p) => t.isMountain(p),
      inBounds: (p) => t.inBounds(p, 2),
      buildingsHit: (pts, hw) => this.buildings.hit(pts, hw).filter((id) => !this.buildings.byId.get(id)?.zone),
      money: () => this.money,
      buildingAt: (id) => this.buildings.byId.get(id)?.c,
    };
    this.zones.rebuildAll();
  }

  /**
   * A new company: one hamlet founded near the start, on open land with fertile soil within reach and its grid
   * turned toward it, and a few hundred metres of road leading out of it toward the farmland.
   */
  start() {
    const t = this.terrain;
    const fert = (p: V2) => t.has(F.fert, p);
    const clear = (p: V2) => this.towns.foundBlock(p) === null;
    // the nearest open spot to the origin with fertile soil 300 m - 1 km away (and none under the town itself)
    let site: V2 | null = null, fallback: V2 | null = null, toward = { x: 1, y: 0 };
    for (let r = 0; r <= 1400 && !site; r += 80) {
      const n = Math.max(1, Math.round((2 * Math.PI * r) / 160));
      for (let k = 0; k < n && !site; k++) {
        const a = (k / n) * Math.PI * 2;
        const p = { x: Math.cos(a) * r, y: Math.sin(a) * r };
        if (!clear(p) || fert(p)) continue;
        fallback ??= p;
        let best: V2 | null = null, bd = Infinity;
        for (let d = 300; d <= 1000; d += 100) for (let q = 0; q < 16; q++) {
          const b = (q / 16) * Math.PI * 2;
          const f = { x: p.x + Math.cos(b) * d, y: p.y + Math.sin(b) * d };
          if (fert(f) && d < bd) { bd = d; best = f; }
        }
        if (best) { site = p; toward = { x: best.x - p.x, y: best.y - p.y }; }
      }
    }
    // (no farmland near anywhere open: the nearest open spot, however far out, so a company always has its town)
    site ??= fallback;
    for (let r = 1400; !site && r <= 6000; r += 80) {
      for (let k = 0; k < 64; k++) {
        const p = { x: Math.cos((k / 64) * Math.PI * 2) * r, y: Math.sin((k / 64) * Math.PI * 2) * r };
        if (clear(p)) { site = p; break; }
      }
    }
    site ??= { x: 0, y: 0 };
    const ang = Math.atan2(toward.y, toward.x);
    const town = this.towns.found(site, { ang });
    if (typeof town === "string") return;
    this.cityName = town.name;
    // (owner, 2026-11-08: "a bit bigger, to have more employees for the early factories": about 60-80 people, hands
    // for a first farm, sawmill and food plant, still a Hamlet well short of the 150 goal)
    town.target = START_HAMLET_HH;
    // the road out of town, from the end of its main street
    const bk = blockOf(town), a = gridPt(town.c, ang, 1, 0, bk), b = gridPt(town.c, ang, 1 + 320 / bk, 0, bk);
    const plan = planRoad(this.net, this.world, { start: { p: a, h: 0, guides: [], node: this.nodeAt(a) }, end: { p: b, h: 0, guides: [] }, mode: "straight", type: "street" });
    if (!plan.errors.length) this.buildFree(plan);
    // it has stood a while: its first homes and its shop are up and lived in
    for (let k = 0; k < 60 && (k < 10 || town.households < town.target); k++) {
      this.towns.tick();
      for (const b of this.buildings.list) b.built = 1;
    }
    this.undoStack = [];
    this.redoStack = [];
  }

  private nodeAt(p: V2): number | undefined {
    for (const [id, n] of this.net.nodes) if (dist(n.p, p) < 0.5) return id;
    return undefined;
  }

  /** Every trip asked for: vehicles on the road and ones waiting to set off. */
  *trips(): Iterable<Trip> {
    for (const v of this.traffic.vehicles) yield v.trip;
    for (const p of this.traffic.pending) yield p.trip;
  }

  /**
   * The trips held up now: standing in traffic 30 s+ ("road"), or in a yard whose first truck out has waited 20 s+
   * for a gap in the traffic ("gate": a yard just sending a lot of long trucks one after another isn't one).
   */
  private heldTrips(): Map<Trip, "gate" | "road"> {
    const m = new Map<Trip, "gate" | "road">();
    // (standing in traffic half a minute and more; at lights, that much longer than a red lasts)
    for (const v of this.traffic.vehicles) if (v.trip.haul && v.stuck > 30 && v.stuck > 30 + this.traffic.redTime(v)) m.set(v.trip, "road");
    const blocked = new Set<number>();
    for (const p of this.traffic.pending) if (p.trip.haul && p.wait > 20) blocked.add(p.trip.from);
    if (blocked.size) for (const p of this.traffic.pending) if (p.trip.haul && blocked.has(p.trip.from)) m.set(p.trip, "gate");
    return m;
  }

  /** Per building, the company's trucks waiting in its yard to pull out of its gate (convoys keep their own count). */
  private gateQueues(): Map<number, number> {
    const m = new Map<number, number>();
    for (const p of this.traffic.pending) if (p.trip.haul && !p.trip.haul.big && fromLot(p)) m.set(p.trip.from, (m.get(p.trip.from) ?? 0) + 1);
    return m;
  }

  /** Truck classes the company may run now. */
  truckUnlocked(c: TruckClass): boolean { return this.progress.unlocked.trucks.has(c); }

  /** The class every fleet runs: the best one unlocked (trucks already out finish their run as they are). */
  bestTruck(): TruckClass {
    let best: TruckClass = "light";
    for (const c of TRUCK_CLASS_ORDER) if (this.truckUnlocked(c)) best = c;
    return best;
  }

  /**
   * A warehouse's settings for one product: whether it takes it at all, and whether it is a feeder for it (sent
   * there before the towns and plants farther away). Null when set, else why not.
   */
  setWarehouse(id: number, p: Product, o: { take?: boolean; feed?: boolean }): string | null {
    const b = this.buildings.byId.get(id);
    if (!b?.plant || Industry.logisticsOf(b) !== "warehouse") return "Not a warehouse";
    if (!(p in PRODUCTS)) return "No such product";
    const P = b.plant;
    if (o.take !== undefined) {
      const all = Object.keys(PRODUCTS) as Product[];
      const takes = new Set(P.takes ?? all);
      if (o.take) takes.add(p); else takes.delete(p);
      if (takes.size === all.length) delete P.takes; else P.takes = all.filter((k) => takes.has(k));
      // (a feeder for a product it no longer takes is no feeder)
      if (!o.take && P.feeds) { P.feeds = P.feeds.filter((k) => k !== p); if (!P.feeds.length) delete P.feeds; }
    }
    if (o.feed !== undefined) {
      const feeds = new Set(P.feeds ?? []);
      if (o.feed) feeds.add(p); else feeds.delete(p);
      if (feeds.size) P.feeds = (Object.keys(PRODUCTS) as Product[]).filter((k) => feeds.has(k)); else delete P.feeds;
      // (feeding it means taking it)
      if (o.feed && P.takes && !P.takes.includes(p)) {
        const all = Object.keys(PRODUCTS) as Product[];
        if (P.takes.length + 1 >= all.length) delete P.takes; else P.takes = all.filter((k) => k === p || P.takes!.includes(k));
      }
    }
    return null;
  }

  /** Pay for something that isn't part of the hourly books (a building, a new town). */
  charge(v: number) {
    this.money -= v;
    this.emit({ t: "money" });
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    for (const f of this.listeners) f(e);
  }

  // ---------------------------------------------------------------- unlocks

  get roadsUnlocked(): Set<RoadTypeId> { return this.progress.unlocked.roads; }
  featureUnlocked(f: Feature): boolean { return this.progress.unlocked.features.has(f); }
  placedUnlocked(k: PlacedKind): boolean { return this.progress.unlocked.buildings.has(k); }
  /** Every milestone reached (for tools and tests that need everything unlocked; no grants). */
  unlockAll() { this.progress.completeAll(); }

  /** What the milestones are measured on, now. */
  progressView(): ProgressView {
    const v = this.progress.view(this.towns.list.map((t) => ({ pop: t.pop, supply: t.supply })), this.utilities.powered);
    v.landmarks = this.buildings.sites.filter((b) => b.plant?.landmark?.done !== undefined).length;
    return v;
  }

  /**
   * Reach any open milestone whose goal is met: pay its grant, have the fresh towns it brings spring up, and say
   * so (the milestone first, then each new town's arrival).
   */
  checkMilestones() {
    for (const m of this.progress.check(this.progressView())) {
      this.money += m.unlocks.grant ?? 0;
      const towns: Spawned[] = [];
      for (let k = 0; k < (m.unlocks.towns ?? 0); k++) {
        const s = this.towns.spawn();
        if (s) towns.push(s);
      }
      if (towns.length) this.progress.spawned[m.id] = towns.map((s) => s.town.id);
      this.emit({ t: "milestone", m, ...(towns.length ? { towns: towns.map((s) => s.town.id) } : {}) });
      for (const s of towns) {
        this.emit({ t: "townSpawned", town: s.town.id, from: s.from?.id ?? null, dist: s.dist, dir: s.dir });
        const where = s.from ? `${(s.dist / 1000).toFixed(1)} km ${s.dir} of ${s.from.name}` : "on the map";
        this.toast(`A new town: ${s.town.name} has sprung up ${where}. Join it to your roads and keep it fed.`);
      }
      if (towns.length) { this.emit({ t: "zones" }); this.emit({ t: "buildings" }); }
      this.emit({ t: "money" });
    }
  }

  toast(msg: string) {
    this.emit({ t: "toast", msg });
  }

  /** When each plant last had a spoiled load called out, and each town new cars (the ticker says so once an hour). */
  private calledOut = new Map<string, number>();
  /**
   * A load was handed over: the map pops it, and the ticker calls out what is special about it: perishables that
   * spoiled on the way (and what it cost), and a town taking delivery of the Motor Works' cars.
   */
  private delivered(d: Delivery) {
    this.emit({ t: "delivery", d });
    const once = (key: string) => {
      if (this.time - (this.calledOut.get(key) ?? -1e12) < HOUR) return false;
      this.calledOut.set(key, this.time);
      return true;
    };
    const money = (v: number) => `$${Math.round(v).toLocaleString("en-US")}`;
    const name = PRODUCTS[d.product].name.toLowerCase();
    const town = d.to.town !== undefined ? this.towns.byId.get(d.to.town) : undefined;
    const where = town?.name ?? `the ${BUILDING_TYPES[d.to.kind].name}`;
    if (d.lost >= 1 && d.from && once(`spoiled:${d.from.id}`)) {
      this.toast(`Spoiled on the way: ${name} from the ${BUILDING_TYPES[d.from.kind].name} reached ${where} at ${Math.round(d.fresh * 100)}% (${money(d.lost)} lost). A nearer buyer or a quicker road keeps it fresh.`);
    }
    if (d.product === "cars" && town && once(`cars:${town.id}`)) {
      this.toast(`${town.name} took delivery of ${d.n * CARS_PER_LOAD} new Motor Works cars: watch for them on its streets`);
    }
  }

  // ---------------------------------------------------------------- road edits

  private applyRoads(fn: () => void): Op[] {
    // which way each junction's roads went before the edit (see autoLights)
    const before = new Map<number, V2[]>();
    if (this.featureUnlocked("signals")) for (const [id, ng] of this.net.nodeGeom) if (ng.kind === "junction") before.set(id, ng.arms.map((a) => a.dir));
    this.net.begin();
    fn();
    const cs = this.net.rebuild();
    // new crossings of bigger roads get lights, as in CS2 (part of the same edit, so undo takes them away too)
    const lit = this.autoLights([...this.midRebuilds, cs], before);
    this.midRebuilds = [];
    const cs2 = lit ? this.net.rebuild() : null;
    const ops = this.net.commit();
    this.afterRoads(cs);
    if (cs2) this.afterRoads(cs2);
    return ops;
  }

  /**
   * Traffic lights where two bigger roads now meet (CS2 places them by itself): a junction whose approaches just
   * gained a road, with at least three arms of avenue size or more (an avenue going on through it is two of them; motorway
   * ramps and roundabouts don't count), gets the default plan for free, unless the player took its lights away
   * before. Returns how many it lit.
   */
  private autoLights(css: ChangeSet[], before: Map<number, V2[]>): number {
    let lit = 0;
    const ids = new Set<number>();
    for (const cs of css) for (const id of cs.dirtyNodes) ids.add(id);
    for (const id of ids) {
      const n = this.net.nodes.get(id), ng = this.net.nodeGeom.get(id);
      // a road joining a junction that has lights gets a green too
      const fixed = this.planWithAllArms(id);
      if (fixed) { this.net.setSignal(id, fixed); lit++; continue; }
      if (!this.featureUnlocked("signals")) continue;
      if (!n || !ng || n.signal || n.noAutoLights || ng.kind !== "junction" || ng.arms.length < 3) continue;
      let big = 0, ring = false;
      for (const a of ng.arms) {
        const s = this.net.segs.get(a.seg);
        if (!s) continue;
        if (s.ring) ring = true;
        const T = ROAD_TYPES[s.type];
        if (!isHighway(T) && T.rank >= 2) big++;
      }
      if (ring || big < 3) continue;
      // only a new junction, or one a road was just added to: one the player has left unsignalled stays that way,
      // whatever happens further along its roads (a split elsewhere renumbers its arms but doesn't turn them)
      const was = before.get(id);
      if (was && ng.arms.every((a) => was.some((d) => a.dir.x * d.x + a.dir.y * d.y > 0.985))) continue;
      const plan = this.defaultSignal(id);
      if (plan) { this.net.setSignal(id, plan); lit += 1 + this.lightCluster(id, true).length; }
    }
    return lit;
  }

  /**
   * Lights on one junction of a cluster (close links, see CLOSE_LINK) cover all of it: the others get the default
   * plan too (they run on its clock: Traffic.syncClusters). Returns the junctions it lit. Lights at one end only
   * let cars into a link that a free-for-all at the other end then left them standing on.
   */
  private lightCluster(id: number, auto: boolean): number[] {
    const lit: number[] = [];
    for (const m of this.unlitSiblings(id, auto)) { this.net.setSignal(m, this.defaultSignal(m)); lit.push(m); }
    return lit;
  }

  /** The junctions of `id`'s cluster that lights on it would light too (`auto`: not those the player took lights from). */
  private unlitSiblings(id: number, auto: boolean): number[] {
    return this.net.clusterOf(id).filter((m) => {
      const n = this.net.nodes.get(m);
      return m !== id && !!n && !n.signal && !(auto && n.noAutoLights) && !!this.defaultSignal(m);
    });
  }

  /** What putting lights on junction `id` costs: it and the rest of its cluster still without (see lightCluster). */
  lightsCost(id: number): number {
    return (1 + this.unlitSiblings(id, false).length) * SIGNAL_COST;
  }

  /**
   * The plan of junction `id`'s lights with every approach in it, or null when none is missing: a road that joined
   * it since goes with the road straight across from it, or gets a phase of its own (otherwise it would never see
   * green). Arms that are gone are dropped.
   */
  planWithAllArms(id: number): SignalPlan | null {
    const n = this.net.nodes.get(id), ng = this.net.nodeGeom.get(id);
    if (!n?.signal || !ng || ng.kind !== "junction") return null;
    const sig = n.signal;
    // (a left-turn phase alone doesn't count: the rest of that road's traffic would never go)
    const missing = ng.arms.filter((a) => ng.conns.some((c) => c.armIn === a.seg) && !sig.phases.some((p) => !p.left && p.arms.includes(a.seg)));
    if (!missing.length) return null;
    const live = new Set(ng.arms.map((a) => a.seg));
    const plan: SignalPlan = { phases: sig.phases.map((p) => ({ ...p, arms: p.arms.filter((x) => live.has(x)) })) };
    for (const a of missing) {
      const across = ng.arms.find((b) => b.seg !== a.seg && b.dir.x * a.dir.x + b.dir.y * a.dir.y < -0.8 && plan.phases.some((p) => !p.left && p.arms.includes(b.seg)));
      const ph = across && plan.phases.find((p) => !p.left && p.arms.includes(across.seg));
      if (ph) ph.arms.push(a.seg);
      else plan.phases.push({ arms: [a.seg] });
    }
    return plan;
  }

  /**
   * Do a site's roads lead anywhere: from its gate to a town's streets or another works' gate? A stub of road at its
   * gate that ends in the fields is not that (tips.ts cutOff). `buyer`: only somewhere that takes what it makes counts,
   * for the toast that says its trucks can start (play-test 2026-11-10: a Sawmill joined only to its Logging Camp was
   * told "its trucks can start", its planks with no town to go to): a works that uses it, a warehouse that stores it
   * (industry.ts dispatch), or a town's streets if towns buy it (priced).
   */
  roadsLeadOut(b: Building, buyer = false): boolean {
    const s0 = b.access ? this.net.segs.get(b.access.seg) : undefined;
    if (!s0) return false;
    // (a works that makes nothing to send, a power plant, is joined up by any road to a works or a town)
    const makes = isPlantKind(b.kind) ? (Object.keys(PLANTS[b.kind].outputs) as Product[]) : [];
    const any = !buyer || !makes.length;
    const town = any || makes.some((p) => PRODUCTS[p].price > 0);
    const takes = (o: Building): boolean => {
      if (any) return true;
      if (!isPlantKind(o.kind)) return false;
      const D = PLANTS[o.kind], alts = Object.values(D.alt ?? {});
      if (D.logistics === "warehouse") return makes.some((p) => !perishable(p) && (!o.plant!.takes || o.plant!.takes.includes(p)));
      return makes.some((p) => !!D.inputs[p] || alts.includes(p));
    };
    const gates = new Set<number>();
    for (const o of this.buildings.list) if (o.plant && o !== b && o.access && takes(o)) gates.add(o.access.seg);
    const seen = new Set([s0.a, s0.b]), q = [s0.a, s0.b];
    while (q.length) {
      for (const s of this.net.segsAt(q.pop()!)) {
        if ((town && s.town !== undefined) || gates.has(s.id)) return true;
        for (const m of [s.a, s.b]) if (!seen.has(m)) { seen.add(m); q.push(m); }
      }
    }
    return false;
  }

  /**
   * Works with a road at the gate whose trucks can't start yet: "loose", the road leads nowhere yet (play-test
   * 2026-11-10: "Farm connected: its trucks can start" came when the first leg of a road out to it reached the
   * gate, still ending in the fields), or "joined" to other roads with nobody on them to take what it makes. Told
   * again as that changes. Not saved: after a load nobody is waiting for the word.
   */
  private dangling = new Map<number, "loose" | "joined">();

  /**
   * What a works whose gate just got a road is told: its trucks can start (its roads reach somewhere that takes what
   * it makes), connected but with nobody on its roads to sell to yet (an Iron Mine before any steel works), or that
   * the road leads nowhere yet. `turned`: its gate was turned to the road. Not yet able to start, it is watched and
   * told again when it can.
   */
  private sayJoined(b: Building, turned = false) {
    const name = BUILDING_TYPES[b.kind].name;
    if (!b.plant || this.roadsLeadOut(b, true)) {
      this.dangling.delete(b.id);
      this.toast(`${name} connected${turned ? ", its gate turned to the road" : ""}: its trucks can start`);
    } else if (this.roadsLeadOut(b)) {
      this.dangling.set(b.id, "joined");
      this.toast(`${name} connected${turned ? ", its gate turned to the road" : ""}. Nothing on your roads takes its ${this.makesSay(b)} yet`);
    } else {
      this.dangling.set(b.id, "loose");
      this.toast(turned
        ? `${name}'s gate turned to the road. Join that road to your others and its trucks can start`
        : `${name} has a road at its gate. Join it to your other roads and its trucks can start`);
    }
  }

  /** What a works makes, in words: "planks", "steel and slag". */
  private makesSay(b: Building): string {
    const ps = isPlantKind(b.kind) ? (Object.keys(PLANTS[b.kind].outputs) as Product[]).map((p) => PRODUCTS[p].name.toLowerCase()) : [];
    return ps.length > 1 ? `${ps.slice(0, -1).join(", ")} and ${ps[ps.length - 1]}` : ps[0] ?? "goods";
  }

  /** Works waiting on their roads: told once their roads join up, and again once they reach a buyer. */
  private recheckDangling() {
    for (const [id, was] of this.dangling) {
      const b = this.buildings.byId.get(id);
      if (!b?.access) { if (!b) this.dangling.delete(id); continue; }
      if (this.roadsLeadOut(b, true)) {
        this.dangling.delete(id);
        this.toast(`${BUILDING_TYPES[b.kind].name} connected: its trucks can start`);
      } else if (was === "loose" && this.roadsLeadOut(b)) this.sayJoined(b);
    }
  }

  private afterRoads(cs: ChangeSet) {
    for (const b of this.buildings.reattach()) this.sayJoined(b);
    this.recheckDangling();
    this.faceRoads();
    this.transit.afterRoads();
    this.traffic.onNetworkChange(cs);
    this.rezone(cs);
    this.emit({ t: "roads", cs });
    this.emit({ t: "zones" });
  }

  /**
   * A site with no road at its gate, and a road now at the back of its plot (it ends there, or runs past): the gate
   * goes to that side, the site turned half round where it stands (docs/playtest-2026-11-09.md, C1: a road drawn to
   * the back of a mine was refused, "its gate faces the other way: draw the road round to it"). Half round is the
   * same plot. A site that has a road keeps its gate.
   */
  private faceRoads() {
    let any = false;
    for (const b of this.buildings.sites) {
      if (b.access) continue;
      for (const rot of this.buildings.turnsOf(b)) {
        const ga = this.buildings.gateAccess(b.c, rot, b.side, b.hd, isPlantKind(b.kind));
        if (!ga) continue;
        for (const c of this.lotCells(b)) if (c.lot === b.id) c.lot = 0;
        this.buildings.turn(b, ga);
        for (const c of this.lotCells(b)) c.lot ||= b.id;
        this.candVersion = -1;
        this.sayJoined(b, true);
        any = true;
        break;
      }
    }
    if (any) this.emit({ t: "buildings" });
  }

  /** The zone map after a road edit, and the lots of the buildings whose street was laid out again. */
  private rezone(cs: ChangeSet) {
    this.zones.onNetworkChange(cs);
    this.refreshLots();
  }

  /**
   * A block is laid out afresh when its street changes shape (a junction splits it, a bend moves), and its columns
   * shift: each building's lot is read again off the cells it stands on (redevelopment works along a block by column).
   */
  private refreshLots() {
    for (const b of this.buildings.list) {
      const L = b.lot;
      if (!L) continue;
      const blk = this.zones.blocks.get(L.block);
      if (blk && L.col0 + L.w <= blk.cols && blk.cells[L.col0 * DEPTH].lot === b.id && blk.cells[(L.col0 + L.w - 1) * DEPTH].lot === b.id) continue;
      // its front cells, on the block most of them are on
      const span = new Map<Block, [number, number, number]>();
      for (const c of this.lotCells(b)) {
        if (c.lot !== b.id || c.row !== 0) continue;
        const s = span.get(c.block);
        if (s) { s[0] = Math.min(s[0], c.col); s[1] = Math.max(s[1], c.col + 1); s[2]++; } else span.set(c.block, [c.col, c.col + 1, 1]);
      }
      let best: Block | null = null, bs: [number, number, number] = [0, 0, 0];
      for (const [k, s] of span) if (s[2] > bs[2]) { best = k; bs = s; }
      // (none left: its land was cut from under it; it stands, but no longer counts as on a block)
      b.lot = best ? { block: best.key, col0: bs[0], w: bs[1] - bs[0], d: L.d } : undefined;
    }
  }

  private pushUndo(e: UndoEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  /** Zoned buildings a planned road would clear (shown before building, like CS2). */
  lotsUnder(plan: Plan): Building[] {
    const out = new Set<Building>();
    for (const st of [...plan.strokes, ...(plan.ghosts ?? [])]) {
      if (st.h0 > 6 && st.h1 > 6 && !st.hj) continue; // bridges pass over
      // (only where it is low enough to need the ground: a bridge's deck passes over, its ramps don't)
      const prof = strokeProfile(this.net, st, 2);
      const pts = prof.pts.filter((_, i) => prof.hs[i] <= 6);
      if (!pts.length) continue;
      const lim = roadWidth(ROAD_TYPES[st.type]) / 2 - 0.5;
      for (const id of this.buildings.hit(pts, lim)) {
        const b = this.buildings.byId.get(id);
        if (b?.zone) out.add(b);
      }
    }
    return [...out];
  }

  /** What the owners of these homes and shops are paid when a road clears them. */
  demolishCost(lots: Building[]): number {
    return lots.reduce((s, b) => s + DEMOLISH_PER_LEVEL * Math.max(1, b.level), 0);
  }

  /** Zoned buildings a new lane's outline (a closed polygon) would clear. */
  lotsUnderOutline(outline: V2[]): Building[] {
    if (outline.length < 3) return [];
    const ids = this.buildings.hit([...outline, outline[0]], 1);
    return ids.map((id) => this.buildings.byId.get(id)).filter((b): b is Building => !!b?.zone);
  }

  /** Zoned buildings standing where a road now runs: demolished (CS2 clears growables in a road's path). */
  private clearRoadsOverLots(ops?: Op[]): Building[] {
    const gone = this.roadsOverLots(ops);
    for (const b of gone) this.removeBuildingRaw(b);
    return gone;
  }

  /** Zoned buildings standing where a road now runs (only round the edits `ops` made, when given). */
  private roadsOverLots(ops?: Op[]): Building[] {
    const gone: Building[] = [];
    // only the area a set of road edits touched (a town laying a street shouldn't scan a whole city's lots)
    let box: [number, number, number, number] | null = null;
    if (ops) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      const take = (p: V2) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); };
      const seg = (id: number) => {
        const s = this.net.segs.get(id);
        if (!s) return;
        for (const n of [s.a, s.b]) { const nd = this.net.nodes.get(n); if (nd) take(nd.p); }
        const g = this.net.segGeom.get(id);
        if (g) for (const p of g.center.pts) take(p);
      };
      for (const op of ops) {
        if (op.t === "addSeg" || op.t === "delSeg") {
          seg(op.seg.id);
          for (const n of [op.seg.a, op.seg.b]) { const nd = this.net.nodes.get(n); if (nd) take(nd.p); }
        }
        else if (op.t === "addNode" || op.t === "delNode") take(op.node.p);
        else if (op.t === "setType" || op.t === "setPocket") seg(op.id);
      }
      if (x0 > x1) return gone;
      // (a junction's neighbours change shape too: pockets, wider mouths)
      const pad = 60;
      box = [x0 - pad, y0 - pad, x1 + pad, y1 + pad];
    }
    for (const b of [...this.buildings.list]) {
      if (!b.zone) continue;
      if (box && (b.c.x < box[0] || b.c.x > box[2] || b.c.y < box[1] || b.c.y > box[3])) continue;
      const pts = rectCorners(b.c, b.hw - 1, b.hd - 1, b.rot);
      pts.push(b.c);
      let hit = false;
      for (const id of this.net.segsNear(b.c.x - b.hw - b.hd, b.c.y - b.hw - b.hd, b.c.x + b.hw + b.hd, b.c.y + b.hw + b.hd)) {
        const g = this.net.segGeom.get(id)!;
        const lim = g.width / 2 - 0.5;
        // walk the centreline in short steps (a straight road has only two vertices)
        const P = g.center.pts;
        for (let i = 0; i < P.length && !hit; i++) {
          if (g.hs[i] > 6 && (i + 1 >= P.length || g.hs[i + 1] > 6)) continue;
          const q = P[i], r = P[i + 1] ?? q;
          const n = Math.max(1, Math.ceil(dist(q, r) / 2));
          for (let k = 0; k <= n && !hit; k++) {
            const t = k / n;
            if (pointInRect({ x: q.x + (r.x - q.x) * t, y: q.y + (r.y - q.y) * t }, b, lim)) hit = true;
          }
        }
        // a turn pocket widens the road before a junction: its lanes (and the through lanes moved over for it)
        if (!hit && (g.ends.a.pocket || g.ends.b.pocket)) {
          for (const l of g.lanes) {
            const Q = l.pl.pts;
            for (let i = 0; i < Q.length && !hit; i++) {
              const q = Q[i], r = Q[i + 1] ?? q;
              const n = Math.max(1, Math.ceil(dist(q, r) / 2));
              for (let k = 0; k <= n && !hit; k++) if (pointInRect({ x: q.x + (r.x - q.x) * (k / n), y: q.y + (r.y - q.y) * (k / n) }, b, 1.4)) hit = true;
            }
            if (hit) break;
          }
        }
        if (hit) break;
      }
      if (hit) gone.push(b);
    }
    return gone;
  }

  build(plan: Plan): boolean {
    if (plan.errors.length) return false;
    // (the homes and shops it clears are paid for: the ones the preview showed, before anything is built)
    const owed = this.demolishCost(this.lotsUnder(plan));
    if (plan.cost + owed > this.money + 0.5) return false;
    if (plan.kind === "roundabout") {
      const cut = this.ringStrands(plan);
      if (cut) {
        this.toast(`Not built: a roundabout there would leave the ${BUILDING_TYPES[cut.kind].name} with no road to its gate. Try it a little further from the gate`);
        return false;
      }
    }
    const was = new Set(this.buildings.sites.filter((b) => b.access).map((b) => b.id));
    const ops = this.applyRoads(() => {
      if (plan.kind === "roundabout") commitRoundabout(this.net, plan);
      // drawn over a dirt road: paved in place (the upgrade path, a stretch at a time)
      else if (plan.pave) applyPave(this.net, plan.pave);
      else {
        // a parallel pair turning a corner: cut the old twin back first
        if (plan.trim) {
          applyTrim(this.net, plan.trim);
          const cs = this.net.rebuild();
          this.midRebuilds.push(cs);
          this.traffic.onNetworkChange(cs);
          this.rezone(cs);
          this.emit({ t: "roads", cs });
        }
        // a slip lane redrawn longer: the old one goes first
        for (const id of plan.removeSegs ?? []) this.net.removeSeg(id, true);
        for (const st of plan.strokes) {
          commitStrokes(this.net, [st]);
          // later strokes of a grid must see earlier ones
          if (plan.strokes.length > 1) {
            const cs = this.net.rebuild();
            this.midRebuilds.push(cs);
            this.traffic.onNetworkChange(cs);
            // (the zone map too: each rebuild hands over only what changed since the last)
            this.rezone(cs);
            this.emit({ t: "roads", cs });
          }
        }
      }
    });
    // a works whose gate street the ring took, with the ring out of its gate's reach, gets the street laid again to
    // the ring (the company's own street: no charge, and one Undo takes ring and street away together)
    if (plan.kind === "roundabout") for (const b of this.buildings.sites) {
      if (b.access || !was.has(b.id)) continue;
      const link = this.gateLink(b.kind as PlacedKind, b.c, b.rot, b.side);
      if (link) ops.push(...this.applyRoads(() => { for (const st of link.strokes) commitStrokes(this.net, [st]); }));
    }
    const gone = this.clearRoadsOverLots(ops);
    const moved = this.setBackJoined(was);
    const paid = plan.cost + owed;
    this.money -= paid;
    this.pushUndo({ label: plan.pave ? "upgrade" : plan.kind, ops, money: paid, added: [], removed: gone, moved: moved.length ? moved : undefined });
    this.emit({ t: "money" });
    if (gone.length || moved.length) this.emit({ t: "buildings" });
    return true;
  }

  /**
   * A works a roundabout would cut off its road for good (docs/playtest-2026-11-09.md, A2: a Small one on the
   * sawmill's gate junction left it with "No road to the gate", and only Undo saved it). A ring that takes the road
   * at a gate is tried on the network and taken back, nothing else told of it: the gate is fine if the ring itself, or
   * what is left of its street, passes in front of it, or if its street can be laid again to the ring. Null: no works
   * is left stranded.
   */
  private ringStrands(plan: Plan): Building | null {
    const cut = new Set(plan.removeSegs ?? []);
    const at = this.buildings.sites.filter((b) => b.access && cut.has(b.access.seg));
    if (!at.length) return null;
    const net = this.net;
    net.begin();
    commitRoundabout(net, plan);
    net.rebuild();
    const bad = at.find((b) => !this.buildings.gateAccess(b.c, b.rot, b.side, b.hd, isPlantKind(b.kind)) && !this.gateLink(b.kind as PlacedKind, b.c, b.rot, b.side)) ?? null;
    net.undo(net.commit());
    this.afterRoads(net.rebuild());
    return bad;
  }

  /**
   * Sites a new road just reached (not in `was`) that it runs past inside their front strip: each steps back behind
   * the strip (Buildings.siteSetback) where the land behind it is free, so the road can be widened later without
   * touching them. A site with no room stays where it is (an upgrade later names it).
   */
  private setBackJoined(was: Set<number>): BuildingMove[] {
    const out: BuildingMove[] = [];
    for (const b of this.buildings.sites) {
      if (!b.access || was.has(b.id) || this.buildings.stripShort(b) < 0.05) continue;
      const g = this.net.segGeom.get(b.access.seg)!;
      const r = this.buildings.pushBack(b.access.seg, g.width / 2, [b.id], this.world);
      if (!r.moves.length) continue;
      this.moveBuildings(r.moves, true);
      out.push(...r.moves);
    }
    if (out.length) this.buildings.reattach();
    return out;
  }

  /** Move buildings to one end of their moves (`to`: the new spots), and the zone cells they cover with them. */
  private moveBuildings(moves: BuildingMove[], to: boolean) {
    const bs = moves.map((m) => this.buildings.byId.get(m.id)).filter((b): b is Building => !!b);
    for (const b of bs) for (const c of this.lotCells(b)) if (c.lot === b.id) c.lot = 0;
    this.buildings.applyMoves(moves, to);
    for (const b of bs) for (const c of this.lotCells(b)) c.lot ||= b.id;
    this.candVersion = -1;
  }

  /**
   * Build a plan for free and with no undo entry: a town's own street (town = its id: the new pieces are tagged as
   * the town's) or the start's road. Undo entries that the edit invalidated (they touch a road or junction it
   * changed) are dropped, with everything older than them.
   */
  buildFree(plan: Plan, town?: number): boolean {
    if (plan.errors.length) return false;
    const ops = this.applyRoads(() => {
      // (a town street laid along a dirt road paves it in place; the road stays whoever's it was)
      if (plan.pave) applyPave(this.net, plan.pave);
      for (const st of plan.strokes) {
        const laid = commitStrokes(this.net, [st]);
        // the streets it laid are the town's (the pieces of a road it split keep whose road it was)
        if (town) for (const id of laid) { const sg = this.net.segs.get(id); if (sg) sg.town = town; }
        if (plan.strokes.length > 1) {
          const cs = this.net.rebuild();
          this.midRebuilds.push(cs);
          this.traffic.onNetworkChange(cs);
          this.rezone(cs);
          this.emit({ t: "roads", cs });
        }
      }
    });
    if (!ops.length) return false;
    this.dropUndoOf(ops);
    this.clearRoadsOverLots(ops);
    this.emit({ t: "buildings" });
    return true;
  }

  /**
   * A town widens one of its own streets (free, and no undo entry: the town's doing, not the player's). It never
   * pulls anything down nor pushes anything back: when the wider road, or the wider mouths of its junctions, would
   * touch any building, it is left as it was and this returns false.
   */
  upgradeFree(segId: number, to: RoadTypeId): boolean {
    const s = this.net.segs.get(segId), g = this.net.segGeom.get(segId);
    if (!s || !g || s.type === to) return false;
    // (a curve too tight for it, or anything in its way: homes and shops too, which a player's upgrade would clear)
    const u = upgradeCost(this.net, { ...this.world, money: () => Infinity }, segId, to);
    if (u.errors.length) return false;
    if (this.buildings.hit(g.center.pts, roadWidth(ROAD_TYPES[to]) / 2 + 0.5).length) return false;
    const from = s.type;
    const ops = this.applyRoads(() => this.net.setType(segId, to));
    if (!ops.length) return false;
    // (the junctions at its ends reshape too: if a lot is now under any of it, it goes back as it was)
    const back = this.roadsOverLots(ops).length > 0;
    if (back) ops.push(...this.applyRoads(() => this.net.setType(segId, from)));
    this.dropUndoOf(ops);
    return !back;
  }

  /**
   * Drop the undo entries an edit the player didn't make invalidated (they touch a road or junction it changed),
   * with everything older than them; and the redo entries.
   */
  private dropUndoOf(ops: Op[]) {
    // ids the edit removed or changed (a road it split, a junction it joined)
    const hit = new Set<number>();
    for (const op of ops) {
      if (op.t === "delSeg") hit.add(op.seg.id);
      // (a new street on an existing junction: undoing the road that made the junction would take it from under it)
      else if (op.t === "addSeg") { hit.add(-op.seg.a - 1); hit.add(-op.seg.b - 1); }
      else if (op.t === "delNode") hit.add(-op.node.id - 1);
      else if (op.t !== "addNode") hit.add(op.t === "setType" || op.t === "flip" || op.t === "setPocket" ? op.id : -op.id - 1);
    }
    const touches = (e: UndoEntry) => e.ops.some((op) =>
      op.t === "addSeg" || op.t === "delSeg" ? hit.has(op.seg.id) || hit.has(-op.seg.a - 1) || hit.has(-op.seg.b - 1)
      : op.t === "addNode" || op.t === "delNode" ? hit.has(-op.node.id - 1)
      : op.t === "setType" || op.t === "flip" || op.t === "setPocket" ? hit.has(op.id) : hit.has(-op.id - 1));
    let last = -1;
    for (let i = 0; i < this.undoStack.length; i++) if (touches(this.undoStack[i])) last = i;
    if (last >= 0) this.undoStack.splice(0, last + 1);
    this.redoStack = [];
  }

  /** Add lane: a turn pocket set (or taken away) before a junction, or a motorway slip lane lengthened. */
  addLane(lp: LanePlan): boolean {
    if (lp.errors.length) return false;
    if (lp.road) return this.build(lp.road);
    const pk = lp.pocket;
    if (!pk || !this.net.segs.has(pk.seg)) return false;
    const ops = this.applyRoads(() => this.net.setPocket(pk.seg, pk.end, pk.to));
    if (!ops.length) return false;
    const gone = this.clearRoadsOverLots(ops);
    this.money -= lp.cost;
    this.pushUndo({ label: "lane", ops, money: lp.cost, added: [], removed: gone });
    this.emit({ t: "money" });
    if (gone.length) this.emit({ t: "buildings" });
    return true;
  }

  /** Remove roads and/or buildings. Roads refund 75%. */
  bulldoze(segs: number[], bIds: number[]): number {
    const refund = removalRefund(this.net, this.world, segs);
    const removed: Building[] = [];
    for (const id of bIds) {
      const b = this.buildings.byId.get(id);
      if (!b || isHall(b.kind) || isCivic(b.kind)) continue; // (a town's hall and its civic buildings are the town's: they can't be pulled down)
      removed.push(b);
      this.removeBuildingRaw(b);
    }
    let ops: Op[] = [];
    if (segs.length) ops = this.applyRoads(() => { for (const id of segs) this.net.removeSeg(id, true); });
    this.money += refund;
    this.pushUndo({ label: "bulldoze", ops, money: -refund, added: [], removed });
    this.emit({ t: "money" });
    if (removed.length) this.emit({ t: "buildings" });
    return refund;
  }

  /**
   * Cost and problems of changing a road's type. A company site stands behind its road's front strip, so a wider road
   * misses it; one that doesn't (an old save's, or one hemmed in) and that a wider road would cover is pushed back to
   * behind the strip, and when it can't move the problem names it.
   */
  upgradePlan(segId: number, to: RoadTypeId): { cost: number; errors: PlanError[]; moves: BuildingMove[] } {
    const u = upgradeCost(this.net, this.world, segId, to);
    const hit = u.errors.find((e) => e.buildings?.length);
    if (!hit) return { ...u, moves: [] };
    const r = this.buildings.pushBack(segId, roadWidth(ROAD_TYPES[to]) / 2, hit.buildings!, this.world);
    if (!r.stuck.length) return { cost: u.cost, errors: u.errors.filter((e) => e !== hit), moves: r.moves };
    const n = r.stuck.length;
    const one = this.buildings.byId.get(r.stuck[0]);
    const msg = n === 1 ? `${one ? BUILDING_TYPES[one.kind].name : "Building"} in the way` : `${n} buildings in the way`;
    const errors = u.errors.map((e) => (e === hit ? { ...e, msg, buildings: r.stuck } : e));
    return { cost: u.cost, errors, moves: [] };
  }

  upgrade(segId: number, to: RoadTypeId): boolean {
    const s = this.net.segs.get(segId);
    if (!s || s.type === to) return false;
    const u = this.upgradePlan(segId, to);
    if (u.errors.length) return false;
    this.moveBuildings(u.moves, true);
    const ops = this.applyRoads(() => this.net.setType(segId, to));
    const gone = this.clearRoadsOverLots(ops);
    this.money -= u.cost;
    this.pushUndo({ label: "upgrade", ops, money: u.cost, added: [], removed: gone, moved: u.moves.length ? u.moves : undefined });
    this.emit({ t: "money" });
    if (u.moves.length || gone.length) this.emit({ t: "buildings" });
    return true;
  }

  flip(segId: number): boolean {
    const s = this.net.segs.get(segId);
    if (!s || ROAD_TYPES[s.type].bwd > 0) return false;
    const ops = this.applyRoads(() => this.net.flip(segId));
    this.pushUndo({ label: "reverse", ops, money: 0, added: [], removed: [] });
    return true;
  }

  setSignal(nodeId: number, plan: SignalPlan | null): boolean {
    const n = this.net.nodes.get(nodeId);
    if (!n) return false;
    // lights the player takes away stay away (they aren't put back when the junction changes)
    if (!plan && n.signal) n.noAutoLights = true;
    // (the rest of its cluster with it, when lights go up or come down: lights on part of one cover all of it, see
    // lightCluster. A change to the plan of lights already up is just that)
    const adding = !!plan && !n.signal;
    const lit = !plan && n.signal ? this.net.clusterOf(nodeId).filter((m) => m !== nodeId && this.net.nodes.get(m)?.signal) : [];
    const cost = adding ? this.lightsCost(nodeId) : 0;
    if (cost > this.money) return false;
    const ops = this.applyRoads(() => {
      this.net.setSignal(nodeId, plan);
      if (adding) this.lightCluster(nodeId, false);
      for (const m of lit) { this.net.setSignal(m, null); this.net.nodes.get(m)!.noAutoLights = true; }
    });
    this.money -= cost;
    this.pushUndo({ label: "signal", ops, money: cost, added: [], removed: [] });
    this.emit({ t: "money" });
    return true;
  }

  /** Stop signs on these arms of a junction (free; none: empty). Undoable. */
  setStops(nodeId: number, arms: number[]): boolean {
    if (!this.net.nodes.has(nodeId)) return false;
    const ops = this.applyRoads(() => this.net.setStops(nodeId, arms));
    if (!ops.length) return false;
    this.pushUndo({ label: "stops", ops, money: 0, added: [], removed: [] });
    return true;
  }

  /** Default signal plan: opposite arms share a phase. */
  defaultSignal(nodeId: number): SignalPlan | null {
    const g = this.net.nodeGeom.get(nodeId);
    if (!g || g.kind !== "junction" || g.arms.length < 3) return null;
    const arms = [...g.arms];
    const used = new Set<number>();
    const phases: SignalPlan["phases"] = [];
    for (const a of arms) {
      if (used.has(a.seg)) continue;
      used.add(a.seg);
      const group = [a.seg];
      let best: (typeof arms)[number] | null = null, bd = -0.7;
      for (const b of arms) {
        if (used.has(b.seg)) continue;
        const d = -(a.dir.x * b.dir.x + a.dir.y * b.dir.y);
        if (d > bd) { bd = d; best = b; }
      }
      if (best) { used.add(best.seg); group.push(best.seg); }
      // two big roads facing each other: their left turns cut across the oncoming traffic, so (as CS2 does on
      // avenues) they get a short arrow of their own. After the road's green, not before: by then whatever went
      // straight on ahead of a left turn in its lane has gone, and the turn waits at the line for its arrow
      const big = group.length === 2 && group.every((x) => {
        const T = ROAD_TYPES[this.net.segs.get(x)!.type];
        return T.rank >= 2 && !isHighway(T);
      });
      phases.push({ arms: group });
      if (big && g.conns.some((c) => group.includes(c.armIn) && c.turn === "L")) phases.push({ arms: [...group], left: true });
    }
    // in a cluster (close links, see CLOSE_LINK) the road along the link goes first, at each junction alike: their
    // lights run on one clock, so that traffic has green at both ends together
    const k = phases.findIndex((p) => !p.left && p.arms.some((x) => this.net.closeLink(x)));
    if (k > 0) phases.push(...phases.splice(0, k));
    return { phases };
  }

  // ---------------------------------------------------------------- zoning (done by the towns)

  /** Set the zone of cells (zone = null clears it). Buildings standing on cells of another zone are demolished. */
  zoneCells(cells: Iterable<Cell>, zone: ZoneId | null): number {
    const ch = this.zones.paint(cells, zone);
    if (!ch.length) return 0;
    let removed = false;
    for (const { cell } of ch) {
      if (!cell.lot) continue;
      const b = this.buildings.byId.get(cell.lot);
      if (b && !b.placed && b.zone !== zone) { this.removeBuildingRaw(b); removed = true; }
    }
    this.emit({ t: "zones" });
    if (removed) this.emit({ t: "buildings" });
    return ch.length;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.moved) this.moveBuildings(e.moved, false);
    if (e.ops.length) {
      this.net.undo(e.ops);
      this.afterRoads(this.net.rebuild());
    }
    this.money += e.money; // undo refunds 100%
    for (const b of e.added) this.removeBuildingRaw(this.buildings.byId.get(b.id) ?? b);
    for (const b of e.removed) this.restoreBuilding(b);
    this.redoStack.push(e);
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
    this.emit({ t: "zones" });
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.moved) this.moveBuildings(e.moved, true);
    if (e.ops.length) {
      this.net.redo(e.ops);
      this.afterRoads(this.net.rebuild());
    }
    this.money -= e.money;
    for (const b of e.added) {
      if (b.placed) {
        // zoned buildings that grew on the spot after the undo make way again, as when it was first placed
        for (const o of [...this.buildings.list]) {
          if (o.zone && !e.removed.some((r) => r.id === o.id) && obbOverlap(b.c, b.hw, b.hd, b.rot, o.c, o.hw, o.hd, o.rot)) {
            e.removed.push(o);
            this.removeBuildingRaw(o);
          }
        }
      }
      this.restoreBuilding(b);
    }
    for (const b of e.removed) this.removeBuildingRaw(this.buildings.byId.get(b.id) ?? b);
    if (e.ops.length) this.clearRoadsOverLots();
    this.undoStack.push(e);
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
    this.emit({ t: "zones" });
  }

  // ---------------------------------------------------------------- buildings

  /** Where a placed building would go near p, and what it would cost and replace. */
  placedPlan(kind: PlacedKind, p: V2, opts?: PlaceOpts): (Placement & { cost: number; deposit?: { name: string; share: number }; link?: Plan }) | null {
    const pl0 = this.buildings.placement(kind, p, this.world, (o) => !!o.zone, opts);
    if (!pl0) return null;
    const D = PLACED[kind];
    let pl: Placement & { link?: Plan } = pl0, cost = D.cost;
    if (pl.ok && !this.placedUnlocked(kind)) return { ...pl, ok: false, reason: "Not unlocked yet", cost };
    if (pl.ok && D.unique && this.buildings.list.some((b) => b.kind === kind)) return { ...pl, ok: false, reason: "Only one per city", cost };
    if (pl.ok && this.onTownSquare(pl.c, pl.rot, BUILDING_TYPES[kind].w / 2, BUILDING_TYPES[kind].d / 2)) return { ...pl, ok: false, reason: "On a town's square: that's for its hall", cost };
    if (pl.ok && D.shore && !this.nearWater(pl.c, pl.rot, BUILDING_TYPES[kind].w / 2, BUILDING_TYPES[kind].d / 2)) return { ...pl, ok: false, reason: "Has to be on a shore", cost };
    // (a landmark has its own rules: a tower in a City, the fair beside a town)
    const why = pl.ok && isMega(kind) ? megaBlock(kind, pl.c, this.towns.list, sizeOf, this.buildings.list) : null;
    if (why) return { ...pl, ok: false, reason: why, cost };
    const dep = isPlantKind(kind) ? PLANTS[kind].deposit : undefined;
    let deposit: { name: string; share: number } | undefined;
    if (dep) {
      const T = BUILDING_TYPES[kind];
      deposit = { name: dep.name, share: this.industry.depositShare(dep.field, pl.c, pl.rot, T.w / 2, T.d / 2) };
      if (pl.ok && deposit.share < MIN_DEPOSIT) return { ...pl, ok: false, reason: `Needs ${dep.name.toLowerCase()}: ${Math.round(deposit.share * 100)}% here, ${Math.round(MIN_DEPOSIT * 100)}% at least`, cost, deposit };
    }
    // a site with no road at its gate gets a street laid from its gate to the nearest road, as part of placing it
    // (planned last: it is the dear part, and a spot refused anyway needs none)
    const link = pl.ok && pl.free ? this.gateLink(kind, pl.c, pl.rot, pl.side) ?? undefined : undefined;
    if (link) { pl = { ...pl, link }; cost += link.cost; }
    if (pl.ok && this.money < cost) return { ...pl, ok: false, reason: "Not enough money", cost, deposit };
    return { ...pl, cost, deposit };
  }

  /**
   * The street the game lays from a new site's gate to the nearest road it can reach: out of the gate square to its
   * fence, then curving round to meet the road at a right angle. Never through the site's own fence, and never
   * through other buildings. Null: no road within reach can be joined that way (the site waits for one).
   */
  gateLink(kind: PlacedKind, c: V2, rot: number, side: 1 | -1, o: { reach?: number; type?: RoadTypeId; tries?: number } = {}): Plan | null {
    const T = BUILDING_TYPES[kind], hw = T.w / 2, hd = T.d / 2;
    const f = siteFrame(c, rot, side, hd);
    const out = scale(f.into, -1);
    const S = add(f.gate, scale(out, GATE_LINK_OUT));
    const ahead = add(f.gate, scale(out, 30));
    const net = this.net, R = o.reach ?? GATE_LINK_REACH, type = o.type ?? "street";
    // (a town's own street counts half as far again as the company's roads: the works' trucks go by the main road
    // rather than through the back streets a little nearer)
    const cands: { p: V2; d: number; k: number }[] = [];
    for (const id of net.segsNear(S.x - R, S.y - R, S.x + R, S.y + R)) {
      const s = net.segs.get(id)!;
      if (!takesGate(ROAD_TYPES[s.type])) continue; // (a boulevard too: the street meets it at a junction)
      const r = cubicClosest(s.c, ahead);
      if (net.heightOnSeg(id, r.t) > 0.5) continue;
      const d = dist(r.p, S), k = s.town ? TOWN_STREET : 1;
      if (d <= R) cands.push({ p: r.p, d: d * k, k });
    }
    cands.sort((a, b) => a.d - b.d);
    const world: BuildWorld = { ...this.world, money: () => Infinity };
    let best: Plan | null = null, bestCost = Infinity;
    for (const cd of cands.slice(0, o.tries ?? 6)) {
      const end = snap(net, cd.p, { mpp: 0.4, level: 0, type });
      if (end.seg === undefined && end.node === undefined) continue;
      const plan = planRoad(net, world, { start: { p: S, h: 0, guides: [] }, end, mode: "curve", squareEnd: true, type, startTangent: out });
      if (plan.errors.length || !plan.strokes.length) continue;
      const pts = plan.strokes.flatMap((st) => chainPoints(st.chain, 3));
      if (pts.some((q) => rectDistance(q, c, hw, hd, rot) < 6)) continue;
      // (never through a town's homes and shops: the company's street goes round them, or waits for the player)
      if (this.lotsUnder(plan).length) continue;
      if (plan.cost * cd.k < bestCost) { best = plan; bestCost = plan.cost * cd.k; }
    }
    return best;
  }

  /**
   * The road the game offers a site with no road to its gate, too far out for its own street (ROAD_TO_REACH): a dirt
   * road from the gate to the nearest road it can be laid to. Worked out again only when the roads or the company's
   * works change (a works placed on its way); a town's new homes are checked when it is built (buildRoadTo).
   */
  roadTo(b: Building): Plan | null {
    if (b.access || !b.placed || !this.buildings.byId.has(b.id)) return null;
    const s = this.buildings.sites, v = `${this.net.version}|${s.length}|${s[s.length - 1]?.id ?? 0}`;
    const m = this.roadToMemo.get(b.id);
    if (m && m.v === v) return m.plan;
    const plan = this.gateLink(b.kind as PlacedKind, b.c, b.rot, b.side, { reach: ROAD_TO_REACH, type: "dirt", tries: 3 });
    this.roadToMemo.set(b.id, { v, plan });
    return plan;
  }
  private roadToMemo = new Map<number, { v: string; plan: Plan | null }>();

  /**
   * Lay the offered road (one Undo takes it away), worked out afresh so it goes round whatever stands on its way
   * now: the plan laid, or null if there is none or it can't be paid for.
   */
  buildRoadTo(b: Building): Plan | null {
    if (b.access || !b.placed || !this.buildings.byId.has(b.id)) return null;
    this.roadToMemo.delete(b.id);
    const plan = this.roadTo(b);
    return plan && this.build(plan) ? plan : null;
  }

  /** Would a lot (centre c, turned rot, half sizes hw x hd) cover any of a town's square (kept for its hall)? */
  onTownSquare(c: V2, rot: number, hw: number, hd: number): boolean {
    const near = this.towns.list.filter((t) => dist(t.c, c) < Math.hypot(hw, hd) + blockOf(t) * 1.5);
    if (!near.length) return false;
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y, y: u.x };
    // every ~10 m over the lot (a square is a whole block, so none slips between)
    const na = Math.max(1, Math.ceil((2 * hw) / 10)), nb = Math.max(1, Math.ceil((2 * hd) / 10));
    for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
      const a = -hw + (2 * hw * i) / na, b = -hd + (2 * hd * j) / nb;
      const p = { x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b };
      if (near.some((t) => this.towns.onSquare(t, p))) return true;
    }
    return false;
  }

  /** Is there water within SHORE_REACH of a lot (centre c, turned rot, half sizes hw x hd)? */
  nearWater(c: V2, rot: number, hw: number, hd: number): boolean {
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y, y: u.x };
    // rings round the lot, 6 m to SHORE_REACH out, sampled every ~6 m (a narrow stream still shows up)
    for (let d = 6; d <= SHORE_REACH; d += 6) {
      const A = hw + d, B = hd + d;
      const na = Math.ceil((2 * A) / 6), nb = Math.ceil((2 * B) / 6);
      for (let k = 0; k <= na; k++) {
        const a = -A + (2 * A * k) / na;
        for (const b of [-B, B]) if (this.world.isWater({ x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b })) return true;
      }
      for (let k = 1; k < nb; k++) {
        const b = -B + (2 * B * k) / nb;
        for (const a of [-A, A]) if (this.world.isWater({ x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b })) return true;
      }
    }
    return false;
  }

  /** Place a building (a power plant...). Zoned buildings in the way are cleared. */
  place(kind: PlacedKind, p: V2, opts?: PlaceOpts): Building | null {
    const pl = this.placedPlan(kind, p, opts);
    if (!pl || !pl.ok) return null;
    const removed: Building[] = [];
    for (const id of pl.clears ?? []) {
      const o = this.buildings.byId.get(id);
      if (o) { removed.push(o); this.removeBuildingRaw(o); }
    }
    // the street to its gate first (one undo takes the site and its street away together)
    const link = pl.link;
    const ops = link ? this.applyRoads(() => { for (const st of link.strokes) commitStrokes(this.net, [st]); }) : [];
    const b = this.buildings.add(kind, pl, this.time);
    b.placed = true;
    this.buildings.version++;
    if (link) this.buildings.reattach();
    if (isPlantKind(kind)) {
      this.industry.init(b, kind, pl.deposit ? Math.min(1, pl.deposit.share / 0.8) : 1);
      // (a works with no materials to wait for, a first-tier one, goes up at once over its crew time: construction.ts
      // buildTime, a first farm under a minute and a half at 1x; one that waits for materials starts once they are in)
      if (!b.plant!.site && !b.plant!.landmark) b.built = 0;
    }
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.candVersion = -1;
    this.money -= pl.cost;
    this.pushUndo({ label: "place", ops, money: pl.cost, added: [b], removed });
    // (a works waiting for somewhere to send its goods may have just got it)
    if (isPlantKind(kind)) this.recheckDangling();
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
    return b;
  }

  private removeBuildingRaw(b: Building) {
    if (!this.buildings.byId.has(b.id)) return;
    this.buildings.remove(b.id);
    this.people.onBuildingRemoved(b.id);
    // (a zoned lot took its cells by row and column, which can reach a little past its footprint, so every cell
    // round it that still names it is freed: a cell left naming a building that's gone could never be built on again)
    if (b.zone || b.placed || isHall(b.kind) || isCivic(b.kind)) for (const c of this.zones.inPoly(rectCorners(b.c, b.hw + 16, b.hd + 16, b.rot))) if (c.lot === b.id) c.lot = 0;
    this.shopCache = null;
    this.candVersion = -1;
  }

  private restoreBuilding(b: Building) {
    if (this.buildings.byId.has(b.id)) return;
    // (the town has since built a hall or a civic building on its land: that stays, and this isn't put back)
    for (const c of this.lotCells(b)) {
      const o = c.lot && c.lot !== b.id ? this.buildings.byId.get(c.lot) : undefined;
      if (o && (isHall(o.kind) || isCivic(o.kind))) return;
    }
    this.buildings.insert(b);
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.buildings.reattach();
    this.shopCache = null;
    this.candVersion = -1;
  }

  /** Is p inside the fence of one of the company's sites? */
  inSite(p: V2): boolean {
    for (const b of this.buildings.sites) if (rectDistance(p, b.c, b.hw, b.hd, b.rot) < 0.5) return true;
    return false;
  }

  /** Zone cells under a building's lot. */
  lotCells(b: Building): Cell[] {
    if (!b.zone && !b.placed && !isHall(b.kind) && !isCivic(b.kind)) return [];
    return this.zones.inPoly(rectCorners(b.c, b.hw - 0.5, b.hd - 0.5, b.rot));
  }

  get shops(): Building[] {
    if (!this.shopCache) this.shopCache = this.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "com");
    return this.shopCache;
  }

  /** The town a zoned roadside cell belongs to: the one whose street it fronts (or whose land it is on). */
  private cellTown(c: Cell): number | null {
    return this.net.segs.get(c.block.seg)?.town ?? this.towns.townAt(c.c)?.id ?? null;
  }

  /** How many places a town has where a lot of a group could still start (0: it needs more streets). */
  freeLots(town: number, group: ZoneGroup): number {
    const key = `${town}:${group}`;
    const cands = this.candidates(key);
    const hit = this.freeCache.get(key);
    if (hit !== undefined) return hit;
    let n = 0;
    for (const c of cands) {
      if (!c.zone) continue;
      // (a front of the street wall can be a single cell wide)
      if (group === "com" && this.towns.wallCell(c)) { if (this.wallFits(c.block, c.col, 1, 3)) n++; continue; }
      const t = ZONE_LOTS[c.zone][ZONE_LOTS[c.zone].length - 1]; // (the smallest)
      for (let shift = 0; shift < t.w; shift++) {
        const col0 = c.col - shift;
        if (col0 >= 0 && col0 + t.w <= c.block.cols && this.lotFits(c.block, col0, t, c.zone)) { n++; break; }
      }
    }
    this.freeCache.set(key, n);
    return n;
  }

  /** Empty, zoned front-row cells where a new lot could start, per "town:group". */
  private candidates(key: string): Cell[] {
    if (this.candVersion !== this.zones.version) {
      this.candCache.clear();
      this.freeCache.clear();
      this.zones.eachFront((c) => {
        if (!c.ok || !c.zone || c.lot) return;
        const t = this.cellTown(c);
        if (t === null) return;
        const k = `${t}:${ZONE_GROUP[c.zone]}`;
        let L = this.candCache.get(k);
        if (!L) this.candCache.set(k, (L = []));
        L.push(c);
      });
      this.candVersion = this.zones.version;
    }
    return this.candCache.get(key) ?? [];
  }

  /** inside tick(): what towns grow is announced once, at its end (a rebuild of every building per new home is slow) */
  private ticking = false;
  private grew = false;

  /** A town grows a home or a shop on its zoned land (a given building, such as its filling station, when asked). */
  growIn(town: number, group: ZoneGroup, model?: BuildingKind): Building | null {
    const only = model ? [lotFor(model)] : undefined;
    const b = this.grow(this.candidates(`${town}:${group}`), false, only);
    if (b) { b.town = town; if (this.ticking) this.grew = true; else this.emit({ t: "buildings" }); }
    return b;
  }

  /** Up to n households move into a town's homes with room. */
  moveInto(town: number, n: number): number {
    const homes = this.buildings.list.filter((b) => b.town === town && b.zone && ZONE_GROUP[b.zone] === "res" && b.built >= 1 && !b.abandoned && b.access && this.people.householdsIn(b.id) < b.cap);
    let moved = 0;
    while (moved < n && homes.length) {
      const i = (this.rng() * homes.length) | 0, h = homes[i];
      this.people.moveIn(h);
      moved++;
      if (this.people.householdsIn(h.id) >= h.cap) homes.splice(i, 1);
    }
    return moved;
  }

  /** A household leaves a town (one in a home on its outskirts, so the centre stays full). */
  moveOutOf(town: number): boolean {
    const t = this.towns.byId.get(town);
    let best: { hh: ReturnType<Society["moveIn"]>; d: number } | null = null;
    for (const b of this.buildings.list) {
      if (b.town !== town || !b.zone || ZONE_GROUP[b.zone] !== "res") continue;
      const L = this.people.hhAt.get(b.id);
      if (!L?.length) continue;
      const d = t ? dist(b.c, t.c) : 0;
      if (!best || d > best.d) best = { hh: L[L.length - 1], d };
    }
    if (!best) return false;
    this.people.moveOut(best.hh);
    return true;
  }

  /** Buildings pulled down for a town (redevelopment, its hall): households move to the town's other homes, or wait. */
  private clearForTown(town: number, list: Building[]): Cell[] {
    let moved = 0;
    const cells: Cell[] = [];
    for (const b of list) {
      cells.push(...this.lotCells(b));
      if (b.zone && ZONE_GROUP[b.zone] === "res") moved += this.people.householdsIn(b.id);
      this.removeBuildingRaw(b);
    }
    // (the rest wait for a home: the town's target still counts them, so they move in as homes go up)
    if (moved) this.moveInto(town, moved);
    return cells.filter((c) => !c.lot);
  }

  /**
   * Redevelopment: pull down a town's old buildings on one stretch of street (columns lo..hi of a zone block) and
   * grow one building of a denser zone there, a building site first. The new building, or null if none fits (the land
   * is left zoned for the town to grow on).
   */
  rebuildLots(town: number, ids: number[], zone: ZoneId, block: string, lo: number, hi: number, model?: BuildingKind): Building | null {
    const blk = this.zones.blocks.get(block);
    const old = ids.map((id) => this.buildings.byId.get(id)).filter((b): b is Building => !!b);
    const freed = this.clearForTown(town, old);
    if (blk) for (let k = lo; k < hi; k++) for (let r = 0; r < DEPTH; r++) {
      const c = blk.cells[k * DEPTH + r];
      if (c.ok && !c.lot) freed.push(c);
    }
    this.zones.paint(freed, zone);
    const fronts = blk ? freed.filter((c) => c.block === blk && c.row === 0 && c.col >= lo && c.col < hi) : [];
    const nb = this.grow(fronts, true, model ? [lotFor(model)] : undefined);
    if (nb) { nb.town = town; nb.redev = true; }
    this.emit({ t: "zones" });
    if (this.ticking) this.grew = true; else this.emit({ t: "buildings" });
    return nb;
  }

  /** A town's hall on its square (see TownSystem.buildHall): whatever of the town stands there makes way. */
  addHall(town: number, kind: BuildingKind, c: V2, rot: number, side: 1 | -1, front: V2, half: number): Building {
    const gone = this.buildings.list.filter((o) => o.zone && obbOverlap(c, half, half, rot, o.c, o.hw - 0.5, o.hd - 0.5, o.rot));
    this.clearForTown(town, gone);
    const b: Building = {
      id: this.buildings.nextId++, town, kind, c: { ...c }, rot, hw: half, hd: half, front: { ...front }, access: null, side,
      level: 1, cap: 0, fit: 1, tall: 1, built: 0, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, prodT: 0, visits: 0, born: this.time,
    };
    this.buildings.insert(b);
    for (const cc of this.lotCells(b)) { cc.lot = b.id; cc.zone = null; }
    this.buildings.reattach();
    this.zones.version++;
    this.candVersion = -1;
    if (this.ticking) this.grew = true; else this.emit({ t: "buildings" });
    return b;
  }

  /**
   * A town's civic building, an order filled (orders.ts): a building site on a straight stretch of the town's own
   * streets, as near its centre as can be, on land it has zoned. Free land is preferred; homes and shops standing
   * there make way when the best spot needs it (their households move to the town's other homes, or wait for new
   * ones). Null when no stretch of its streets is long and deep enough (it tries again as the town grows).
   */
  addCivic(town: number, kind: CivicKind): Building | null {
    const t = this.towns.byId.get(town);
    if (!t) return null;
    const C = CIVICS[kind];
    if (C.d > DEPTH) return null;
    const spots: { blk: Block; col0: number; gone: Set<number>; c: V2; score: number }[] = [];
    for (const blk of this.zones.blocks.values()) {
      const seg = this.net.segs.get(blk.seg);
      if (!seg || seg.town !== town || blk.cols < C.w) continue;
      for (let col0 = 0; col0 + C.w <= blk.cols; col0++) {
        const r0 = blk.cells[col0 * DEPTH].rot;
        const gone = new Set<number>();
        let ok = true, cx = 0, cy = 0, n = 0;
        for (let k = col0; k < col0 + C.w && ok; k++) {
          if (Math.abs(Math.cos(blk.cells[k * DEPTH].rot - r0)) < 0.97) { ok = false; break; } // (too curved)
          for (let r = 0; r < C.d; r++) {
            const c = blk.cells[k * DEPTH + r];
            // (land the town zoned, or a home or shop of its own standing on it: never a street still to come, its
            // square or greens, nor anything else's lot)
            if (!c?.ok) { ok = false; break; }
            if (c.lot) {
              const o = this.buildings.byId.get(c.lot);
              if (!o?.zone || o.town !== town) { ok = false; break; }
              gone.add(o.id);
            } else if (!c.zone) { ok = false; break; }
            cx += c.c.x; cy += c.c.y; n++;
          }
        }
        if (!ok || !n) continue;
        const c = { x: cx / n, y: cy / n };
        let homes = 0;
        for (const id of gone) homes += this.people.householdsIn(id);
        spots.push({ blk, col0, gone, c, score: dist(c, t.c) + gone.size * 24 + homes * 8 });
      }
    }
    spots.sort((a, b) => a.score - b.score);
    for (const s of spots.slice(0, 24)) {
      const { blk, col0 } = s;
      const g = this.net.segGeom.get(blk.seg);
      if (!g) continue;
      const cells: Cell[] = [];
      let ux = 0, uy = 0;
      for (let k = col0; k < col0 + C.w; k++) for (let r = 0; r < C.d; r++) {
        const c = blk.cells[k * DEPTH + r];
        cells.push(c);
        ux += Math.cos(c.rot); uy += Math.sin(c.rot);
      }
      const rot = Math.atan2(uy, ux), hw = (C.w * CELL) / 2, hd = (C.d * CELL) / 2;
      // (nothing else of the town's or the company's in the way: a hall, another civic building, a site's fence)
      if (this.buildings.list.some((o) => !o.zone && !s.gone.has(o.id) && dist(o.c, s.c) < hw + hd + o.hw + o.hd && obbOverlap(s.c, hw - 0.5, hd - 0.5, rot, o.c, o.hw, o.hd, o.rot))) continue;
      // (and a home or shop on a neighbouring block whose lot reaches over it, round a corner, makes way too; one of
      // another town's rules the spot out)
      const over = this.buildings.list.filter((o) => o.zone && !s.gone.has(o.id) && dist(o.c, s.c) < hw + hd + o.hw + o.hd && obbOverlap(s.c, hw - 0.5, hd - 0.5, rot, o.c, o.hw - 0.5, o.hd - 0.5, o.rot));
      if (over.some((o) => o.town !== town)) continue;
      for (const o of over) s.gone.add(o.id);
      const away = { x: -Math.sin(rot) * blk.side, y: Math.cos(rot) * blk.side };
      const front = add(s.c, scale(away, -(hd + zoneEdge(g.width) - g.width / 2)));
      this.clearForTown(town, [...s.gone].map((id) => this.buildings.byId.get(id)).filter((b): b is Building => !!b));
      const b: Building = {
        id: this.buildings.nextId++, town, kind, c: s.c, rot, hw, hd, front, access: null, side: blk.side,
        level: 1, cap: 0, fit: 1, tall: 1, built: 0, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, prodT: 0, visits: 0, born: this.time,
      };
      this.buildings.insert(b);
      for (const cc of cells) { cc.lot = b.id; cc.zone = null; }
      this.buildings.reattach();
      this.zones.version++;
      this.candVersion = -1;
      this.shopCache = null;
      // (the town built on land the redo history may still mean to put a site on: that history is gone)
      this.redoStack = [];
      this.orders.invalidate();
      this.emit({ t: "zones" });
      if (this.ticking) this.grew = true; else this.emit({ t: "buildings" });
      return b;
    }
    return null;
  }

  /** A town's hall is rebuilt for its new size: the old one makes way for a building site. */
  rebuildHall(b: Building, kind: BuildingKind) {
    b.kind = kind;
    b.built = 0;
    b.born = this.time;
    if (this.ticking) this.grew = true; else this.emit({ t: "buildings" });
  }

  /**
   * Debug and tests: run a town's own growth for some game hours without the traffic, every need met. Construction,
   * streets, zoning, redevelopment, households and its history all run as in play; trips and the plants don't.
   * `pace`: it grows that many times faster than in play (a test that wants a Town without a month of game time).
   */
  fastForward(town: number, hours: number, ample = 1, pace = 1) {
    const AMPLE = ample;
    const t = this.towns.byId.get(town);
    if (!t) return;
    const TICK = HOUR / 8;
    this.ticking = true;
    this.grew = false;
    this.towns.pace = pace;
    try {
      for (let k = 0; k < hours * 8; k++) {
        this.time += TICK;
        this.traffic.time = this.time;
        // (every need met: the parts a town building site waits for come in at once)
        for (const b of this.buildings.list) {
          if (b.site) { delete b.site; b.problem = null; }
          if (b.built < 1 && !b.plant?.site) b.built = Math.min(1, b.built + buildStep(b, TICK));
        }
        for (const b of this.shops) { b.stock = Math.max(b.stock, 4); b.badT = 0; }
        // every need met, `ample` times over (at 1, exactly what it uses: it grows, slowly, a step behind its own
        // supply, as a town grows only on a supply that has run ahead of it for two days): deliveries come in through
        // the day
        for (const p of needsOf(t.pop)) t.today[p] = Math.max(t.today[p] ?? 0, AMPLE * demandPerDay(p, t.pop) * ((k % 192) + 1) / 192);
        this.towns.tick();
        // (and an hour's worth of each need came in this hour, for the supply that rolls hour by hour)
        if (k % 8 === 7) { t.hourNow = Object.fromEntries(needsOf(t.pop).map((p) => [p, (AMPLE * demandPerDay(p, t.pop)) / 24])); this.towns.hourly(); }
        const day = Math.floor(this.time / DAY);
        if (day !== this.dayN) { this.towns.daily(); this.dayN = day; }
      }
    } finally { this.ticking = false; this.towns.pace = 1; }
    this.towns.census();
    this.emit({ t: "zones" });
    this.emit({ t: "buildings" });
  }

  /**
   * A landmark whose construction is over is finished: it serves the town it stands in or beside, and the company
   * gets its banner. True when one was.
   */
  private lookWas = "";
  /** What the buildings look like beyond their level: each landmark's stage, and the season. */
  private lookSig(): string {
    let s = fieldLook(this.time) as string;
    for (const b of this.buildings.sites) if (isMega(b.kind) && isPlantKind(b.kind)) s += `|${b.id}:${megaStage(b, PLANTS[b.kind])}`;
    return s;
  }

  private landmarks(): boolean {
    let any = false;
    for (const b of this.buildings.sites) {
      const L = b.plant?.landmark;
      if (!L || L.done !== undefined || !Industry.running(b) || !isMega(b.kind)) continue;
      L.done = this.time;
      const t = townAt(b.c, this.towns.list, b.kind === "exposition" ? 800 : 0);
      if (t) L.town = t.id;
      // (its opening is the HUD's banner, the camera and the fireworks: no toast underneath them)
      this.emit({ t: "landmark", b: b.id });
      this.checkMilestones();
      any = true;
    }
    return any;
  }

  /** A town has grown into a new size (its banner). */
  townGrew(t: { id: number }, size: number) {
    this.emit({ t: "townSize", town: t.id, size });
  }

  /** Try to grow a building on one of these candidate cells. */
  private grow(cands: Cell[], biggest = false, only?: LotTemplate[]): Building | null {
    if (!cands.length) return null;
    // (a town's Main Street fills first, its wall from the hall outward: growWall)
    const wall = cands.filter((c) => c.ok && !c.lot && c.zone && ZONE_GROUP[c.zone] === "com" && this.towns.wallCell(c));
    if (!only && wall.length) {
      const w = this.growWall(wall, biggest);
      if (w) return w;
    }
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = cands[(this.rng() * cands.length) | 0];
      // (the wall's land grows only fronts of the wall, or its filling station)
      if (!only && wall.includes(c)) continue;
      const b = this.growAt(c, biggest, only);
      if (b) return b;
    }
    return null;
  }

  /**
   * The street wall (docs/design.md "Main Street"): from a Town on, the stretch of Main Street by the hall is built to
   * the pavement, each front as wide as its lot, on the free front nearest the centre, so the wall grows outward
   * from the hall with no gaps in it. A lot takes one to four cells of the free run it starts in, never leaving a
   * single cell over where it can help it. Where the street bends too much for neighbours to share a wall, a
   * detached building goes up instead. `free`: the town's free cells of its wall (TownSystem.wallCell).
   */
  private growWall(free: Cell[], biggest: boolean): Building | null {
    const tid = this.cellTown(free[0]);
    const town = tid === null ? undefined : this.towns.byId.get(tid);
    if (!town) return null;
    const d2 = (c: Cell) => (c.c.x - town.c.x) ** 2 + (c.c.y - town.c.y) ** 2;
    free = [...free].sort((p, q) => d2(p) - d2(q));
    let tries = 0;
    for (const c of free) {
      if (c.lot) continue;
      if (++tries > 80) break;
      const b = c.block;
      if (!this.net.segs.get(b.seg)) continue;
      // the free run of the street's front it stands in
      const open = (k: number) => k >= 0 && k < b.cols && this.wallFits(b, k, 1, 1) && this.towns.wallCell(b.cells[k * DEPTH]);
      if (!open(c.col)) {
        // (a bend: a detached building)
        const o = this.growAt(c, biggest);
        if (o) return o;
        continue;
      }
      let lo = c.col, hi = c.col + 1;
      while (hi - lo < 9 && open(lo - 1)) lo--;
      while (hi - lo < 9 && open(hi)) hi++;
      const temps = wallLots(c.zone!)!;
      // the widths that leave no single cell over, the widest first for a rebuild, else a mix
      const all = [...new Set(temps.map((t) => t.w))].filter((w) => w <= hi - lo);
      const good = all.filter((w) => hi - lo - w !== 1);
      const widths = good.length ? good : all;
      const order = biggest ? widths : shuffleWeighted(widths, this.rng);
      // (built from the end of the run nearer the centre)
      const nearLo = d2(b.cells[lo * DEPTH]) <= d2(b.cells[(hi - 1) * DEPTH]);
      for (const w of order) {
        const col0 = nearLo ? lo + Math.floor((c.col - lo) / w) * w : hi - w - Math.floor((hi - 1 - c.col) / w) * w;
        if (col0 < lo || col0 + w > hi) continue;
        // (where the land is too shallow for one front, another of the same width)
        const fits = temps.filter((t) => t.w === w && this.wallFits(b, col0, w, t.d));
        if (!fits.length) continue;
        const made = this.placeWall(b, col0, fits[(this.rng() * fits.length) | 0], c.zone!);
        if (made) return made;
      }
      // (land too shallow for any front of the wall: a small detached building, rather than a gap for good)
      const o = this.growAt(c, biggest);
      if (o) return o;
    }
    return null;
  }

  /** Can a wall lot of w x d cells stand at col0: free shop land on a straight stretch of street, clear of every building? */
  private wallFits(b: Block, col0: number, w: number, d: number): boolean {
    if (col0 < 0 || col0 + w > b.cols || d > DEPTH) return false;
    const r0 = b.cells[col0 * DEPTH].rot;
    for (let k = col0; k < col0 + w; k++) {
      for (let r = 0; r < d; r++) {
        const c = b.cells[k * DEPTH + r];
        if (!c.ok || c.lot || !c.zone || ZONE_GROUP[c.zone] !== "com") return false;
      }
      if (Math.cos(b.cells[k * DEPTH].rot - r0) < WALL_STRAIGHT) return false;
    }
    // (straight on to its neighbours' columns too, or the walls beside it would not meet)
    for (const k of [col0 - 1, col0 + w]) {
      if (k >= 0 && k < b.cols && Math.cos(b.cells[k * DEPTH].rot - r0) < WALL_STRAIGHT) return false;
    }
    return this.sideClear(b, col0, w, d) && this.lotRect(b, col0, w, d) !== null;
  }

  /**
   * Is a wall lot of w x d cells at col0 clear of every other street by as much as the widest street a lot can face
   * takes up, pavement included? A front of the wall is built to its lot's edges, so one at a corner would otherwise
   * be pulled down when the side street is widened.
   */
  private sideClear(b: Block, col0: number, w: number, d: number): boolean {
    const corners: V2[] = [];
    for (const k of [col0, col0 + w - 1]) for (const r of [0, d - 1]) {
      const c = b.cells[k * DEPTH + r];
      const u = { x: Math.cos(c.rot), y: Math.sin(c.rot) }, v = { x: -u.y, y: u.x };
      const su = k === col0 ? -1 : 1;
      for (const sv of [-1, 1]) corners.push({ x: c.c.x + (u.x * su + v.x * sv) * CELL / 2, y: c.c.y + (u.y * su + v.y * sv) * CELL / 2 });
    }
    const R = CELL * Math.max(w, d) + SIDE_CLEAR + 10, m = b.cells[col0 * DEPTH].c;
    for (const id of this.net.segsNear(m.x - R, m.y - R, m.x + R, m.y + R)) {
      if (id === b.seg) continue;
      const pts = this.net.segGeom.get(id)?.center.pts;
      if (!pts) continue;
      for (let i = 0; i < pts.length - 1; i++) for (const p of corners) if (pointSegDist2(p, pts[i], pts[i + 1]).d2 < SIDE_CLEAR * SIDE_CLEAR) return false;
    }
    return true;
  }

  /** Could a front of the street wall stand where this building does: its street straight there, its land deep enough? */
  wallCould(b: Building): boolean {
    const blk = b.lot && this.zones.blocks.get(b.lot.block);
    if (!b.lot || !blk || b.lot.col0 + b.lot.w > blk.cols) return false;
    const r0 = blk.cells[b.lot.col0 * DEPTH].rot;
    for (let k = b.lot.col0 - 1; k <= b.lot.col0 + b.lot.w; k++) {
      if (k < 0 || k >= blk.cols) continue;
      if (Math.cos(blk.cells[k * DEPTH].rot - r0) < WALL_STRAIGHT) return false;
      if (k < b.lot.col0 || k >= b.lot.col0 + b.lot.w) continue;
      for (let r = 0; r < 3; r++) {
        const c = blk.cells[k * DEPTH + r];
        if (!c.ok || (c.lot && c.lot !== b.id)) return false;
      }
    }
    return true;
  }

  /** Stand a wall lot of template t at col0 (as deep as the shop land behind it reaches). */
  private placeWall(b: Block, col0: number, t: LotTemplate, zone: ZoneId): Building | null {
    let depth = t.d;
    while (depth < DEPTH && this.wallFits(b, col0, t.w, depth + 1)) depth++;
    for (; depth >= t.d; depth--) {
      const rect = this.lotRect(b, col0, t.w, depth);
      if (rect) return this.placeLot(b, col0, t, depth, zone, rect, true);
    }
    return null;
  }

  /** Try to grow a building of the cell's zone (or one of the templates given) on a lot that takes in the cell. */
  private growAt(c: Cell, biggest = false, only?: LotTemplate[]): Building | null {
    {
      if (c.lot || !c.ok || !c.zone) return null;
      const b = c.block;
      const seg = this.net.segs.get(b.seg);
      if (!seg) return null;
      const temps = only ?? ZONE_LOTS[c.zone];
      // (some variety between the two main sizes; the small ones only where nothing bigger fits)
      const order = !biggest && this.rng() < 0.35 && temps.length > 1 ? [temps[1], temps[0], ...temps.slice(2)] : temps;
      for (const t of order) {
        // where along the free run to put it: snug against a neighbour or the block's end if it can, so no strip too
        // narrow for any lot is left beside it; one that can't be avoided goes to the lot as extra yard (CS2 lots fill
        // the block)
        let best: { x0: number; w: number; snug: boolean } | null = null;
        for (let shift = 0; shift < t.w; shift++) {
          const col0 = c.col - shift;
          if (col0 < 0 || col0 + t.w > b.cols || !this.lotFits(b, col0, t, c.zone)) continue;
          const lot = this.snugLot(b, col0, t, c.zone) ?? { x0: col0, w: t.w, snug: false };
          if (lot && (!best || (lot.snug && !best.snug))) best = lot;
          if (best?.snug) break;
        }
        if (best) {
          const tt = best.w === t.w ? t : { ...t, w: best.w };
          // (as deep as the zoned cells behind it reach, short of a building already standing there)
          for (let d = this.lotDepth(b, best.x0, tt, c.zone); d >= tt.d; d--) {
            const rect = this.lotRect(b, best.x0, tt.w, d);
            if (rect) return this.placeLot(b, best.x0, tt, d, c.zone, rect);
          }
        }
      }
    }
    return null;
  }

  /**
   * A lot of template `t` at `col0`, widened over any free strip beside it too narrow for the zone's smallest lot.
   * `snug`: it needed no widening. Null if the widened lot won't fit (too curved).
   */
  private snugLot(b: Block, col0: number, t: LotTemplate, zone: ZoneId): { x0: number; w: number; snug: boolean } | null {
    const minW = Math.min(...ZONE_LOTS[zone].map((x) => x.w));
    const one = { ...t, w: 1 };
    let gl = 0, gr = 0;
    while (gl < minW && col0 - gl - 1 >= 0 && this.lotFits(b, col0 - gl - 1, one, zone)) gl++;
    while (gr < minW && col0 + t.w + gr < b.cols && this.lotFits(b, col0 + t.w + gr, one, zone)) gr++;
    const xl = gl < minW ? gl : 0, xr = gr < minW ? gr : 0;
    if (!xl && !xr) return { x0: col0, w: t.w, snug: true };
    const x0 = col0 - xl, w = t.w + xl + xr;
    return this.lotFits(b, x0, { ...t, w }, zone) ? { x0, w, snug: false } : null;
  }

  private lotFits(b: Block, col0: number, t: LotTemplate, zone: ZoneId): boolean {
    if (t.d > DEPTH) return false;
    const r0 = b.cells[col0 * DEPTH].rot;
    for (let k = col0; k < col0 + t.w; k++) {
      for (let r = 0; r < t.d; r++) {
        const c = b.cells[k * DEPTH + r];
        if (!c.ok || c.zone !== zone || c.lot) return false;
      }
      if (Math.abs(Math.cos(b.cells[k * DEPTH].rot - r0)) < 0.97) return false; // too curved
    }
    return this.lotRect(b, col0, t.w, t.d) !== null;
  }

  /**
   * Where a lot of w x depth cells at col0 stands: the rectangle over its cells (centred on them, turned the way they
   * run on average), kept clear of every building already standing. Its cells only roughly say where the land is
   * free: a street laid out again shifts its columns under the buildings already on it, the rectangle of a lot on a
   * bend overhangs its fanned cells, and an older and a newer block's cells may overlap a little where they meet. So a
   * lot standing in the way trims the new one off its side or its back (never its front, on the street), by up to
   * LOT_TRIM; null if more would be needed.
   */
  private lotRect(b: Block, col0: number, w: number, depth: number): LotRect | null {
    let cx = 0, cy = 0, ux = 0, uy = 0, n = 0;
    for (let k = col0; k < col0 + w; k++) for (let r = 0; r < depth; r++) {
      const c = b.cells[k * DEPTH + r];
      cx += c.c.x; cy += c.c.y; ux += Math.cos(c.rot); uy += Math.sin(c.rot); n++;
    }
    const c = { x: cx / n, y: cy / n }, rot = Math.atan2(uy, ux);
    // the lot's own frame: x along the street (the way its road runs), y away from the street into the lot
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y * b.side, y: u.x * b.side };
    const hw = (w * CELL) / 2, hd = (depth * CELL) / 2;
    let x0 = -hw, x1 = hw, y1 = hd;
    const y0 = -hd;
    for (const o of this.buildings.near(c, Math.hypot(hw, hd) + LOT_GIVE)) {
      const q = rectCorners(o.c, o.hw, o.hd, o.rot).map((p) => ({ x: (p.x - c.x) * u.x + (p.y - c.y) * u.y, y: (p.x - c.x) * v.x + (p.y - c.y) * v.y }));
      if (!lotsOverlap(x0, x1, y0, y1, q)) continue;
      // the least trim that clears it: its side nearer the street's start or end, or its back
      const across = clipTo(q, "y", y0, y1), deep = clipTo(q, "x", x0, x1);
      const opts: [number, () => void][] = [];
      if (across.length) {
        const hi = Math.max(...across.map((p) => p.x)), lo = Math.min(...across.map((p) => p.x));
        if (hi + hw <= LOT_TRIM && hi < x1) opts.push([hi - x0, () => { x0 = hi; }]);
        if (hw - lo <= LOT_TRIM && lo > x0) opts.push([x1 - lo, () => { x1 = lo; }]);
      }
      if (deep.length) {
        const lo = Math.min(...deep.map((p) => p.y));
        if (hd - lo <= LOT_TRIM && lo > y0) opts.push([y1 - lo, () => { y1 = lo; }]);
      }
      if (!opts.length) return null;
      opts.sort((p, q) => p[0] - q[0])[0][1]();
    }
    const mx = (x0 + x1) / 2, my = (y0 + y1) / 2;
    return { c: { x: c.x + u.x * mx + v.x * my, y: c.y + u.y * mx + v.y * my }, rot, hw: (x1 - x0) / 2, hd: (y1 - y0) / 2, along: mx };
  }

  /** How deep a lot can reach: the template's depth, then on through the zoned cells behind it (CS2 lots take the block's depth, the rest is yard). */
  private lotDepth(b: Block, col0: number, t: LotTemplate, zone: ZoneId): number {
    let d = t.d;
    while (d < DEPTH) {
      for (let k = col0; k < col0 + t.w; k++) {
        const c = b.cells[k * DEPTH + d];
        if (!c || !c.ok || c.zone !== zone || c.lot) return d;
      }
      d++;
    }
    return d;
  }

  private placeLot(b: Block, col0: number, t: LotTemplate, depth: number, zone: ZoneId, rect: LotRect, wall = false): Building | null {
    const g = this.net.segGeom.get(b.seg);
    if (!g) return null;
    const cells: Cell[] = [];
    for (let k = col0; k < col0 + t.w; k++) for (let r = 0; r < depth; r++) cells.push(b.cells[k * DEPTH + r]);
    const { c, rot, hw, hd } = rect;
    const sMid = (b.colS[col0] + b.colS[col0 + t.w - 1]) / 2 + rect.along;
    // kerb point in front of the lot's middle
    const away = { x: -Math.sin(rot) * b.side, y: Math.cos(rot) * b.side };
    // (the kerb: the lot starts behind the front strip its driveway crosses)
    const front = add(c, scale(away, -(hd + zoneEdge(g.width) - g.width / 2)));
    const M = BUILDING_TYPES[t.model];
    const tall = t.tall ? t.tall[0] + this.rng() * (t.tall[1] - t.tall[0]) : 1;
    const seg = this.net.segs.get(b.seg);
    // (a lot trimmed clear of its neighbours fits its model to what is left)
    // (a front in the street wall is exactly as wide as its lot: it shares a wall with its neighbours)
    const fit = wall ? (2 * hw) / M.w : Math.min(modelFit(t, M.w, M.d), (2 * hw - 1.5) / M.w, (2 * hd - 3) / M.d);
    const bl: Building = {
      id: this.buildings.nextId++, town: seg?.town ?? this.towns.townAt(c)?.id, kind: t.model, c, rot, hw, hd, front,
      access: { seg: b.seg, s: sMid, p: front }, side: b.side, zone, lot: { block: b.key, col0, w: t.w, d: depth },
      // deeper lots hold a bit more (the back is yard, parking or storage)
      level: 1, cap: capacity(zone, t.w, t.d + (depth - t.d) * 0.5, 1, tall), fit, tall, built: 0, abandoned: 0, lv: 0, upT: 0, badT: 0,
      problem: null, stock: ZONE_GROUP[zone] === "com" ? 2 : 0, prodT: 0, visits: 0, born: this.time,
    };
    // (from the moment the company can make construction parts, a town's blocks and towers are put up from them)
    const parts = PARTS_FOR[t.model];
    if (parts && this.placedUnlocked("constructionplant")) bl.site = { need: { parts }, got: {} };
    if (wall) bl.wall = true;
    this.buildings.insert(bl);
    for (const cc of cells) cc.lot = bl.id;
    this.buildings.reattach();
    if (!bl.access) { this.removeBuildingRaw(bl); return null; }
    this.shopCache = null;
    this.candVersion = -1;
    return bl;
  }

  // ---------------------------------------------------------------- network connectivity

  /** Whether two segs are joined by roads (ignoring one-way direction). */
  connected(a: number, b: number): boolean {
    if (this.compVersion !== this.net.version) this.rebuildComponents();
    const sa = this.net.segs.get(a), sb = this.net.segs.get(b);
    if (!sa || !sb) return false;
    return this.comp.get(sa.a) === this.comp.get(sb.a);
  }

  private rebuildComponents() {
    const parent = new Map<number, number>();
    const find = (x: number): number => {
      let r = x;
      while (parent.get(r) !== r) r = parent.get(r)!;
      let y = x;
      while (parent.get(y) !== r) { const nx = parent.get(y)!; parent.set(y, r); y = nx; }
      return r;
    };
    for (const id of this.net.nodes.keys()) parent.set(id, id);
    for (const s of this.net.segs.values()) {
      const ra = find(s.a), rb = find(s.b);
      if (ra !== rb) parent.set(ra, rb);
    }
    this.comp.clear();
    for (const id of this.net.nodes.keys()) this.comp.set(id, find(id));
    this.compVersion = this.net.version;
  }

  noRoute(b: Building | null) {
    if (b) this.noRouteAt.set(b.id, this.time);
  }

  /**
   * Real trips per simulated car. The clock runs ~90x faster than the cars drive, so if every trip were a car a
   * commute would keep a worker on the road for a good part of the day and a town would have nearly as many cars
   * out as people. One car per trip in a hamlet, rising gently so a town of 1000 has some 130 cars about (CS-like).
   */
  get tripScale(): number {
    const p = this.people.stats.population;
    return Math.max(1, Math.sqrt(p) / 10);
  }

  // ---------------------------------------------------------------- simulation

  update(realDt: number) {
    if (this.paused) return;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= SIM.dt && steps < 24) {
      this.step(SIM.dt);
      this.acc -= SIM.dt;
      steps++;
    }
    if (steps >= 24) this.acc = 0; // fell behind: drop time rather than spiral
    this.playtime += realDt;
  }

  /** Interpolation factor between the last two sim steps (for smooth rendering). */
  get alpha() {
    return this.acc / SIM.dt;
  }

  get hour() { return this.people.hourOf(); }
  get day() { return this.people.dayOf(); }

  step(dt: number) {
    this.time += dt;
    this.traffic.step(dt);
    this.people.step();
    this.tickT += dt;
    const TICK = HOUR / 8;
    if (this.tickT >= TICK) {
      this.tickT -= TICK;
      this.tick(TICK);
    }
    this.hourT += dt;
    if (this.hourT >= HOUR) {
      this.hourT -= HOUR;
      this.hourly();
    }
  }

  /** Every 1/8 game hour: construction, the towns, the company's plants and trucks, businesses. */
  private tick(span: number) {
    // a new day: shops close the books on yesterday's customers, the towns on yesterday's deliveries
    const day = Math.floor(this.time / DAY);
    if (day !== this.dayN) {
      if (this.dayN >= 0) { this.towns.daily(); this.orders.daily(); this.checkMilestones(); this.progress.daily(); }
      this.dayN = day;
      for (const b of this.shops) { b.custDay = b.custToday ?? 0; b.custToday = 0; }
    }
    let changed = false;
    for (const b of this.buildings.list) {
      // (a building site goes up only once every material it waits for has been trucked in)
      if (b.site) { b.problem = siteWaiting(b.site); continue; }
      if (b.built < 1 && !b.plant?.site) {
        if (b.zone && b.problem?.startsWith("Building site")) b.problem = null;
        b.built = Math.min(1, b.built + buildStep(b, span));
        if (b.built >= 1) changed = true;
      }
    }
    this.ticking = true;
    this.grew = false;
    try { this.towns.tick(); } finally { this.ticking = false; }
    if (this.grew) changed = true;
    // (the conveyors first, so the trucks carry only what they can't; then the convoys, and the landmarks' news)
    this.parks.tick(span);
    this.industry.tick(span);
    this.convoys.tick();
    if (this.landmarks()) changed = true;
    // (a landmark's site rising to its next stage, or a new season on the farms' fields, is drawn anew)
    const look = this.lookSig();
    if (look !== this.lookWas) { this.lookWas = look; changed = true; }
    this.utilities.tick(span);
    this.transit.tick();
    for (const b of [...this.buildings.list]) this.stepBuilding(b, span);
    // land value: an eighth of the buildings a tick, so each is valued once an hour without a big town's whole lot at once
    this.landValue((this.lvPart = (this.lvPart + 1) % 8));
    this.checkMilestones();
    if (changed) { this.orders.invalidate(); this.emit({ t: "buildings" }); }
  }

  private stepBuilding(b: Building, span: number) {
    // (the company's plants report their own trouble: see Industry)
    if (b.plant || b.placed) return;
    if (!b.zone || b.built < 1) return;
    const grp = ZONE_GROUP[b.zone];
    // shops count their customers over a day (an evening rush and a quiet morning even out); parks over a few hours
    b.visits *= Math.exp(-span / (grp === "com" ? DAY : HOUR * 6));
    if (b.abandoned) {
      // cleared after a day; the land can grow something new
      if (this.time - b.abandoned > DAY) { this.removeBuildingRaw(b); this.emit({ t: "buildings" }); }
      return;
    }
    let health = 1;
    let problem: string | null = null;
    if (!b.access) { health = 0; problem = "No road access"; }
    else if (grp === "res") {
      // (homes stay as long as they have a road)
    } else {
      const staff = b.cap ? this.people.workersAt(b.id) / b.cap : 1;
      health = Math.min(1, staff * 1.25);
      if (staff < 0.5) problem = "Not enough workers";
      const T = BUILDING_TYPES[b.kind];
      if (grp === "com" && T.shelves && b.stock <= 0) { health *= 0.5; problem = "Out of food"; }
      // (a filling station lives on passing traffic, not on shoppers)
      if (grp === "com" && !T.fuel) {
        // judged on a whole day's custom (yesterday's, or today's once it's caught up): a quiet morning is no sign
        const customers = Math.max(b.custDay ?? 0, b.custToday ?? 0) / Math.max(1, b.cap * 3.2);
        if (this.time - b.born > DAY * 2 && customers < 0.2) { health *= 0.6 + customers * 2; problem ??= "Not enough customers"; }
      }
    }
    if (this.noRouteAt.has(b.id) && this.time - this.noRouteAt.get(b.id)! < HOUR * 2) problem ??= "Trips can't find a route";
    b.problem = problem;
    (b as Building & { health?: number }).health = health;
    // failing for two days: abandoned
    if (health < 0.35 && this.time - b.born > HOUR * 12) b.badT += span;
    else b.badT = Math.max(0, b.badT - span * 2);
    if (b.badT > DAY * 2) {
      b.abandoned = this.time;
      this.people.onBuildingRemoved(b.id);
      this.emit({ t: "buildings" });
      return;
    }
    // level up when land value holds above the next threshold for a day
    if (b.level < 5 && b.lv >= LEVEL_LV[b.level + 1] && (grp === "res" ? this.people.householdsIn(b.id) >= b.cap : health > 0.8)) {
      b.upT += span;
      if (b.upT > DAY) {
        b.level++;
        b.upT = 0;
        const t = ZONE_LOTS[b.zone].find((x) => x.model === b.kind) ?? ZONE_LOTS[b.zone][0];
        const d = b.lot?.d ?? t.d;
        // (its own width: the columns of its lot shift when its street is laid out again)
        b.cap = capacity(b.zone, Math.round((b.hw * 2) / CELL), Math.min(d, t.d) + Math.max(0, d - t.d) * 0.5, b.level, b.tall);
        this.emit({ t: "buildings" });
      }
    } else b.upT = Math.max(0, b.upT - span);
  }

  /** A shopper bought something. */
  sale(b: Building) {
    b.prodT += 1;
    if (b.prodT >= 8) { b.prodT = 0; b.stock = Math.max(0, b.stock - 1); }
  }

  private onArrive(v: Vehicle, now: number) {
    const trip = v.trip;
    if (trip.bus) { this.transit.onGone(trip.bus, { x: v.x, y: v.y }); return; }
    this.traffic.recordTrip(trip.freeFlow, now - trip.startT);
    if (trip.haul?.big) { this.convoys.arrive(v); return; }
    if (trip.haul) { this.industry.onArrive(v); return; }
    if (trip.kind === "cargo" || trip.kind === "empty") return;
    this.people.onArrive(v);
  }

  private onFail(trip: Trip, reason: string) {
    if (trip.bus) { this.transit.onGone(trip.bus); return; }
    this.failedTrips++;
    if (trip.haul) {
      if (trip.haul.big) this.convoys.fail(trip);
      else this.industry.onFail(trip);
      const from = this.buildings.byId.get(trip.from), to = this.buildings.byId.get(trip.to);
      // (held up in traffic is not "no road there": that warning is for real dead ends)
      if (reason === "no route" || reason === "missed its turn" || reason === "road removed") this.noRoute(from ?? to ?? null);
      return;
    }
    if (trip.kind === "cargo" || trip.kind === "empty") return;
    this.people.onFail(trip);
  }

  // ---------------------------------------------------------------- hourly: economy, land value, milestones

  private hourly() {
    const st = this.people.stats;
    const B = this.budgetNow;
    // wages, plant upkeep and the plants' books (deliveries and fuel are booked as they happen)
    this.industry.hourly();
    this.parks.hourly();
    // the company keeps up its own roads; the towns look after their streets
    let roads = 0;
    for (const s of this.net.segs.values()) {
      if (s.town) continue;
      const g = this.net.segGeom.get(s.id);
      if (g) roads += g.center.length * ROAD_TYPES[s.type].costPerM * 0.002;
    }
    B.expense.roads += roads;
    const tr = this.transit.hourly();
    B.income.transit += tr.fares;
    B.expense.transit += tr.upkeep;
    // (sales, wages, upkeep and fuel have already moved the money)
    this.money += B.income.transit - B.expense.roads - B.expense.transit - B.expense.loans;
    this.budget = B;
    this.budgetLog.push(B);
    if (this.budgetLog.length > 24) this.budgetLog.shift();
    this.budgetNow = emptyBudget();
    let jobs = 0;
    for (const b of this.buildings.list) if ((b.placed || (b.zone && ZONE_GROUP[b.zone] !== "res")) && !b.abandoned) jobs += b.cap;
    this.history.push({ money: this.money, pop: st.population, jobs });
    this.towns.hourly();
    this.orders.hourly();
    if (this.history.length > 72) this.history.shift();
    for (const [id, t] of this.noRouteAt) if (this.time - t > HOUR * 3) this.noRouteAt.delete(id);
    this.emit({ t: "money" });
  }

  /** Land value from road access and nearby shops, minus the company's dirty plants nearby (the buildings whose id is `part` mod 8). */
  private landValue(part: number) {
    const all = this.buildings.list.filter((b) => b.zone && !b.abandoned);
    const list = all.filter((b) => b.id % 8 === part);
    // dirty plants, with how far from their middle they can reach (a home farther off is untouched: no need to measure)
    const ind = this.buildings.list.filter((b) => b.plant && !b.plant.site && BUILDING_TYPES[b.kind].pollution > 0).map((o) => {
      // (plants packed into a park pollute together: each one's smoke reaches further, see parks.ts)
      const r = smokeReach(BUILDING_TYPES[o.kind].pollution, this.parks.isLinked(o.id) ? PARK_SMOKE : 1), R = r + Math.hypot(o.hw, o.hd);
      return { o, r, R2: R * R };
    });
    // shops in 320 m squares (a home looks only in the nine round it)
    const R = 320, cellOf = (x: number, y: number) => (Math.floor(x / R) + 4096) * 8192 + Math.floor(y / R) + 4096;
    const shops = new Map<number, Building[]>();
    for (const b of all) if (ZONE_GROUP[b.zone!] === "com") {
      const k = cellOf(b.c.x, b.c.y), L = shops.get(k);
      if (L) L.push(b); else shops.set(k, [b]);
    }
    const pop = this.people.stats.population;
    for (const b of list) {
      let lv = 18 + Math.min(12, pop / 600);
      if (b.access) {
        const s = this.net.segs.get(b.access.seg);
        if (s) lv += ROAD_TYPES[s.type].rank === 2 ? 4 : 0;
      }
      const grp = ZONE_GROUP[b.zone!];
      if (grp === "res") {
        // (four shops near is as good as it gets)
        let near = 0;
        const k0 = cellOf(b.c.x, b.c.y);
        for (let i = -1; i <= 1 && near < 4; i++) for (let j = -1; j <= 1 && near < 4; j++) {
          for (const o of shops.get(k0 + i * 8192 + j) ?? []) if (dist(o.c, b.c) < R && ++near >= 4) break;
        }
        lv += Math.min(12, near * 3);
        for (const { o, r, R2 } of ind) {
          if (dist2(b.c, o.c) >= R2) continue;
          // (from the fence of a site, not its middle)
          const d = rectDistance(b.c, o.c, o.hw, o.hd, o.rot);
          if (d < r) lv -= 22 * (1 - d / r);
        }
      } else if (grp === "com") lv += Math.min(10, b.visits / Math.max(1, b.cap * 4));
      lv += this.utilities.landValueOf(b);
      // (a town's civic buildings make the streets round them nicer to live and shop on: orders.ts)
      lv += this.orders.landValueAt(b.c);
      b.lv = Math.max(0, Math.min(100, lv));
    }
  }

  // ---------------------------------------------------------------- save / load

  serialize() {
    return {
      v: SAVE_V,
      seed: this.seed,
      net: this.net.toJSON(),
      buildings: this.buildings.list.map((b) => ({ ...b, access: null })),
      // every vehicle on the road and every trip waiting to set off, with its load (see Traffic.toJSON). Saves from
      // before v0.0.83 have none: there a load out on delivery had gone back to its plant's yard, and the roads
      // started empty
      traffic: this.traffic.toJSON() as TrafficSave | undefined,
      // the clock as the player had it: the speed, and stopped or not
      speed: this.speed as number | undefined,
      paused: this.paused as boolean | undefined,
      nextBuilding: this.buildings.nextId,
      zones: [...this.zones.allCells()].filter((c) => c.zone).map((c) => [Math.round(c.c.x * 10) / 10, Math.round(c.c.y * 10) / 10, c.zone]),
      zoneAges: this.zones.agesJSON(),
      people: this.people.toJSON(),
      transit: this.transit.toJSON(),
      money: this.money,
      progress: this.progress.toJSON(),
      towns: this.towns.toJSON(),
      orders: this.orders.toJSON() as ReturnType<OrderSystem["toJSON"]> | undefined,
      budget: this.budget as Budget | undefined,
      // the last day's hours, which the bar's income per hour is the average of (review 2026-11-10, B9: with only the
      // last hour saved, +$1,698/h read -$154/h after a quickload, one quiet hour standing for the whole day)
      budgetLog: this.budgetLog as Budget[] | undefined,
      time: this.time,
      playtime: this.playtime,
      calStart: this.calStart,
      cityName: this.cityName,
      company: this.company as Company | undefined,
    };
  }

  static load(data: ReturnType<Game["serialize"]>): Game {
    if ((data as { v?: number }).v !== SAVE_V) throw new Error("Save from an older version of the game: it can't be loaded");
    const g = new Game(data.seed);
    g.net.load(data.net);
    // (saves from before land was dropped carry a `tiles` list: ignored)
    g.progress.load(data.progress);
    g.money = data.money;
    const full = (b: Budget): Budget => { const e = emptyBudget(); return { income: { ...e.income, ...b.income }, expense: { ...e.expense, ...b.expense } }; };
    if (data.budget) {
      g.budget = full(data.budget);
      // (saves from before the log was kept have the last hour only)
      g.budgetLog = data.budgetLog?.length ? data.budgetLog.slice(-24).map(full) : [g.budget];
    }
    g.time = data.time;
    g.dayN = Math.floor(g.time / DAY); // (a loaded city carries on with the day it was saved in)
    g.traffic.time = data.time;
    g.playtime = data.playtime;
    // (a save from before games started in late spring counts its year from day 1: it keeps its season and day)
    g.calStart = (data as { calStart?: number }).calStart ?? 0;
    setYearStart(g.calStart);
    g.cityName = data.cityName ?? g.cityName;
    // (saves from before companies had names get one from their seed)
    g.company = loadCompany(data.company, data.seed);
    const cs = g.net.rebuildAll();
    g.traffic.onNetworkChange(cs);
    // (saves from before lights took in roads added to their junction)
    g.net.begin();
    let fixed = 0;
    for (const id of g.net.nodes.keys()) {
      const p = g.planWithAllArms(id);
      if (p) { g.net.setSignal(id, p); fixed++; }
    }
    g.net.commit();
    if (fixed) g.traffic.onNetworkChange(g.net.rebuild());
    if (data.zoneAges) g.zones.loadAges(data.zoneAges);
    g.zones.rebuildAll();
    g.zones.paintAt(data.zones.map(([x, y, z]) => ({ p: { x: x as number, y: y as number }, zone: z as ZoneId })));
    g.buildings.list = [];
    g.buildings.byId.clear();
    g.buildings.version++;
    for (const d of data.buildings) {
      const b = d as Building;
      // (saves from before sites grew: every plant starts at level 1)
      if (b.plant) {
        b.plant.level ??= 1;
        b.plant.grow ??= 0;
        b.plant.upAt ??= -1e9;
      }
      g.buildings.insert({ ...b, access: null });
      for (const c of g.lotCells(b)) c.lot = b.id;
    }
    g.buildings.nextId = data.nextBuilding;
    g.moveBehindStrips();
    g.buildings.reattach();
    g.refreshLots();
    // (saves from before shops kept daily books: a day's custom from how busy they were)
    for (const b of g.shops) if (b.custDay === undefined) b.custDay = Math.round(b.visits * 4);
    g.people.load(data.people);
    g.transit.load(data.transit);
    g.towns.load(data.towns);
    // (a save from before the town orders has none: its towns are dealt their sets and start rolling them)
    g.orders.load(data.orders);
    g.utilities.tick(0);
    if (data.traffic) {
      // the traffic it was saved with: the people driving are on their way again (everyone else is at home), each
      // bus is its line's again (its riders are among those at home), then every vehicle goes back on its lane
      const trips = [...data.traffic.vehicles, ...data.traffic.pending].map((x) => x.trip);
      g.people.onRoad(trips);
      for (const t of trips) if (t.bus) { t.bus.pax = []; g.transit.runs.add(t.bus); }
      g.traffic.load(data.traffic);
    }
    g.speed = data.speed ?? 1;
    g.paused = !!data.paused;
    return g;
  }

  /**
   * Saves from before the front strips (v0.0.65 and older) had their homes and shops right at the kerb and each town
   * hall's square a pavement from it. On load each home and shop moves back onto its block's cells behind the strip,
   * as deep as its block has room for (its old depth at most, its model refitted to it), and each square shrinks to
   * the inset squares keep now, so upgrading their streets keeps them as it keeps newer ones. A building with no
   * room behind the strip (its block cut short) stays where it stood. Returns how many moved.
   */
  moveBehindStrips(): number {
    const B = this.buildings;
    for (const h of B.list) {
      if (!isHall(h.kind) || h.zone) continue;
      const t = h.town === undefined ? undefined : this.towns.byId.get(h.town);
      const half = (t ? blockOf(t) : BLOCK) / 2 - SQUARE_INSET;
      if (h.hw <= half + 0.25) continue;
      for (const c of this.lotCells(h)) if (c.lot === h.id) c.lot = 0;
      h.hw = h.hd = half;
      for (const c of this.lotCells(h)) c.lot = h.id;
    }
    // a home or shop whose lot starts in front of its block's first row: it stands in the strip
    const cellsOf = (b: Building, blk: Block, rows: number) => {
      const out: Cell[] = [];
      for (let k = b.lot!.col0; k < b.lot!.col0 + b.lot!.w; k++) for (let r = 0; r < rows; r++) out.push(blk.cells[k * DEPTH + r]);
      return out;
    };
    const old: { b: Building; blk: Block }[] = [];
    for (const b of B.list) {
      const L = b.lot;
      const blk = L && this.zones.blocks.get(L.block);
      if (!b.zone || !L || !blk || L.col0 + L.w > blk.cols) continue;
      const k = L.col0 + (L.w >> 1);
      const c0 = blk.cells[k * DEPTH].c, c1 = blk.cells[k * DEPTH + 1].c;
      const into = scale(sub(c1, c0), 1 / CELL);
      const edge = sub(c0, scale(into, CELL / 2));
      const gap = (b.c.x - b.hd * into.x - edge.x) * into.x + (b.c.y - b.hd * into.y - edge.y) * into.y;
      if (gap < -1) old.push({ b, blk });
    }
    if (!old.length) return 0;
    for (const { b } of old) for (const c of this.lotCells(b)) if (c.lot === b.id) c.lot = 0;
    // rows free behind the strip, all along its columns (none of them under a hall or a building that stays)
    const room = (b: Building, blk: Block) => {
      let d = 0;
      for (; d < Math.min(DEPTH, b.lot!.d); d++) {
        let free = true;
        for (let k = b.lot!.col0; k < b.lot!.col0 + b.lot!.w && free; k++) { const c = blk.cells[k * DEPTH + d]; free = c.ok && !c.lot; }
        if (!free) break;
      }
      return d;
    };
    const stay = old.filter(({ b, blk }) => room(b, blk) < MIN_LOT_DEPTH);
    for (const { b } of stay) for (const c of this.lotCells(b)) c.lot ||= b.id;
    let moved = 0;
    for (const { b, blk } of old) {
      if (stay.some((x) => x.b === b)) continue;
      const d = room(b, blk);
      if (d < MIN_LOT_DEPTH) { for (const c of this.lotCells(b)) c.lot ||= b.id; continue; }
      const cells = cellsOf(b, blk, d);
      let cx = 0, cy = 0, ux = 0, uy = 0;
      for (const c of cells) { cx += c.c.x; cy += c.c.y; ux += Math.cos(c.rot); uy += Math.sin(c.rot); }
      const c = { x: cx / cells.length, y: cy / cells.length };
      const rot = Math.atan2(uy, ux);
      const away = { x: -Math.sin(rot) * blk.side, y: Math.cos(rot) * blk.side };
      const g = this.net.segGeom.get(blk.seg);
      const strip = g ? zoneEdge(g.width) - g.width / 2 : 0;
      Object.assign(b, { c, rot, side: blk.side, hd: (d * CELL) / 2, front: add(c, scale(away, -((d * CELL) / 2 + strip))), access: null });
      b.lot = { ...b.lot!, d };
      // (a model too deep for the shallower lot is fitted to it, as a new one would be)
      const M = BUILDING_TYPES[b.kind];
      b.fit = Math.min(b.fit, (d * CELL - 3) / M.d);
      for (const cc of cells) { cc.lot = b.id; cc.zone ??= b.zone!; }
      moved++;
    }
    B.version++;
    this.zones.version++;
    return moved;
  }

  segCost(id: number) {
    return segCost(this.net, id, this.world);
  }

  /** The average hour's books over the last day (or as many hours as have passed). */
  get budgetAvg(): Budget {
    const L = this.budgetLog.length ? this.budgetLog : [this.budget];
    const out = emptyBudget();
    for (const b of L) {
      for (const k in b.income) out.income[k as keyof Budget["income"]] += b.income[k as keyof Budget["income"]] / L.length;
      for (const k in b.expense) out.expense[k as keyof Budget["expense"]] += b.expense[k as keyof Budget["expense"]] / L.length;
    }
    return out;
  }

  /** Net income per hour, averaged over the last day. */
  get netIncome(): number {
    const B = this.budgetAvg;
    return sum(B.income) - sum(B.expense);
  }
}

function emptyBudget(): Budget {
  return { income: { sales: 0, transit: 0 }, expense: { roads: 0, wages: 0, upkeep: 0, fuel: 0, transit: 0, loans: 0 } };
}

function sum(o: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(o)) s += v;
  return s;
}

/** A lot's rectangle: its centre, heading and half sizes, and how far its middle moved along the street off its cells'. */
type LotRect = { c: V2; rot: number; hw: number; hd: number; along: number };
/** How far a new lot may overlap a building already standing (m): touching, give or take rounding. */
const LOT_GIVE = 0.05;
/**
 * How far a new lot may be trimmed off one side or its back to stand clear of one already there (m). Under half a
 * cell, so each of its cells still has its centre on it (Game.lotCells).
 */
const LOT_TRIM = 3;
/** Neighbours in a street wall share a wall: the street may turn by this little (cosine) from one lot to the next. */
const WALL_STRAIGHT = Math.cos(0.03);
/** How far a front of the wall keeps from any street but its own (m): the widest a street a lot faces can be, pavement
 * included, and a hand's width (Game.sideClear). */
const SIDE_CLEAR = Math.max(...Object.values(ROAD_TYPES).filter((t) => t.allowsAccess).map((t) => roadWidth(t) / 2 + SIDEWALK[roadGroup(t)])) + 0.3;

/** The widths in a random order that favours the wider ones. */
function shuffleWeighted(ws: number[], rng: () => number): number[] {
  return ws.map((w) => ({ w, k: Math.pow(rng(), 1 / (w + 0.5)) })).sort((p, q) => q.k - p.k).map((x) => x.w);
}

/** Whether the box [x0, x1] x [y0, y1] and the rectangle q (its corners in order) overlap by more than LOT_GIVE. */
function lotsOverlap(x0: number, x1: number, y0: number, y1: number, q: V2[]): boolean {
  const box = [{ x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 }];
  const e1 = sub(q[1], q[0]), e2 = sub(q[2], q[1]);
  for (const ax of [{ x: 1, y: 0 }, { x: 0, y: 1 }, e1, e2]) {
    const L = Math.hypot(ax.x, ax.y);
    if (L < 1e-9) continue;
    const pr = (p: V2) => (p.x * ax.x + p.y * ax.y) / L;
    const a = box.map(pr), b = q.map(pr);
    if (Math.min(Math.max(...a), Math.max(...b)) - Math.max(Math.min(...a), Math.min(...b)) <= LOT_GIVE) return false;
  }
  return true;
}

/** The part of a convex polygon with `k` between lo and hi. */
function clipTo(poly: V2[], k: "x" | "y", lo: number, hi: number): V2[] {
  const cut = (pts: V2[], inside: (p: V2) => boolean, at: number) => {
    const out: V2[] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if (inside(a)) out.push(a);
      if (inside(a) !== inside(b)) {
        const t = (at - a[k]) / (b[k] - a[k]);
        out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
      }
    }
    return out;
  };
  return cut(cut(poly, (p) => p[k] >= lo, lo), (p) => p[k] <= hi, hi);
}

function pointInRect(p: V2, b: Building, pad: number): boolean {
  const u = { x: Math.cos(b.rot), y: Math.sin(b.rot) };
  const d = sub(p, b.c);
  const a = Math.abs(d.x * u.x + d.y * u.y), c = Math.abs(-d.x * u.y + d.y * u.x);
  return a < b.hw + pad && c < b.hd + pad;
}

/** Lots of buildings a town puts up on purpose rather than by zone (its filling stations), in cells. */
const SPECIAL_LOTS: Partial<Record<BuildingKind, LotTemplate>> = { fuelstation: { w: 3, d: 3, model: "fuelstation" } };

/** The lot a model is grown on: its own zone template, or a special one. */
const lotFor = (model: BuildingKind): LotTemplate =>
  SPECIAL_LOTS[model] ?? Object.values(ZONE_LOTS).flat().find((l) => l.model === model) ?? { w: 3, d: 3, model };

/** What a town building site still waits for, as its problem. */
export function siteWaiting(s: NonNullable<Building["site"]>): string {
  const left = (Object.entries(s.need) as [Product, number][]).map(([p, n]) => [p, n - (s.got[p] ?? 0)] as [Product, number]).filter(([, n]) => n > 0);
  return `Building site: waiting for ${left.map(([p, n]) => `${n} load${n === 1 ? "" : "s"} of ${PRODUCTS[p].name.toLowerCase()}`).join(" and ")}`;
}
