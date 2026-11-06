import {
  BUILDING_TYPES, BULLDOZE_REFUND, MAP, ROAD_TYPES, SIGNAL_COST, SIM, roadWidth, type BuildingKind, type Cargo, type RoadTypeId,
} from "../config";
import { dist, type V2 } from "../core/math";
import { mulberry32 } from "../core/noise";
import { RoadNetwork, type ChangeSet, type Op, type SignalPlan } from "../roads/network";
import {
  commitRoundabout, commitStrokes, removalRefund, segCost, upgradeCost, type BuildWorld, type Plan, type PlanError,
} from "../roads/planner";
import { Traffic, type Trip, type Vehicle } from "../sim/traffic";
import { Terrain } from "../world/terrain";
import { Buildings, type Building, type BuildingMove, type Placement } from "./buildings";
import { levelDef } from "./levels";

export interface Resident {
  id: number;
  home: number;
  job: number; // building id, -1 = none
  state: "home" | "out" | "away" | "back";
  t: number; // timer for the current state
  trips: number; // completed outbound trips
  at: number; // building id while away
  lastWorkOk: number; // time of the last successful commute
}

interface UndoEntry {
  label: string;
  ops: Op[];
  money: number; // money spent (negative = refunded)
  added: Building[];
  removed: Building[];
  moved?: BuildingMove[]; // lots pushed back by a road widening
}

export interface Objective {
  id: "placed" | "trips" | "sat" | "flow";
  label: string;
  done: boolean;
  value: string; // "14 to go" / "93.4%"
  good: boolean;
  sub?: { label: string; value: string }; // biggest satisfaction drag
}

export const FACTOR_LABEL: Record<string, string> = {
  commercial: "Access to nearby commercial",
  work: "Access to nearby workplaces",
  staff: "Access to workers/customers",
  input: "Access to input resources",
  pollution: "Air pollution",
  noise: "Road noise",
};

export type GameEvent =
  | { t: "roads"; cs: ChangeSet }
  | { t: "buildings" }
  | { t: "level"; level: number; note?: string }
  | { t: "money" }
  | { t: "tiles" }
  | { t: "toast"; msg: string };

export class Game {
  seed: number;
  terrain: Terrain;
  net = new RoadNetwork();
  traffic: Traffic;
  buildings: Buildings;
  residents: Resident[] = [];
  private residentById = new Map<number, Resident>();
  private nextResident = 1;
  money = 0;
  level = 1;
  inventory: Partial<Record<BuildingKind, number>> = {};
  tiles = new Set<string>();
  tileTokens = 0;
  time = 0;
  playtime = 0;
  speed = 1;
  paused = false;
  private acc = 0;
  private rng: () => number;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];
  private objTimer = 0;
  private allGoodFor = 0;
  private jobTimer = 0;
  objectives: Objective[] = [];
  failedTrips = 0;
  enRoute = new Map<number, number>(); // consumer building id -> trucks heading there
  readonly world: BuildWorld;

  constructor(seed = 7) {
    this.seed = seed;
    this.rng = mulberry32(seed * 31 + 5);
    this.terrain = new Terrain(seed);
    this.buildings = new Buildings(this.net);
    this.traffic = new Traffic(this.net, {
      arrive: (v, now) => this.onArrive(v, now),
      fail: (trip, reason) => this.onFail(trip, reason),
    });
    for (const [i, j] of MAP.startTiles) this.tiles.add(`${i},${j}`);
    const L = levelDef(1);
    this.money = L.money;
    this.inventory = { ...L.give };
    this.tileTokens = L.tiles;
    const t = this.terrain;
    this.world = {
      isWater: (p) => t.isWater(p),
      isMountain: (p) => t.isMountain(p),
      inBounds: (p) => t.inBounds(p, 2),
      unlocked: (p) => this.unlocked(p),
      buildingsHit: (pts, hw) => this.buildings.hit(pts, hw),
      money: () => this.money,
    };
    this.evalObjectives();
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    for (const f of this.listeners) f(e);
  }

  // ---------------------------------------------------------------- tiles

  tileOf(p: V2): [number, number] {
    return [Math.floor(p.x / MAP.tile), Math.floor(p.y / MAP.tile)];
  }

  unlocked(p: V2): boolean {
    const [i, j] = this.tileOf(p);
    return this.tiles.has(`${i},${j}`);
  }

  canUnlock(i: number, j: number): boolean {
    const n = MAP.size / MAP.tile;
    if (i < 0 || j < 0 || i >= n || j >= n || this.tiles.has(`${i},${j}`) || this.tileTokens <= 0) return false;
    return [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => this.tiles.has(`${i + a},${j + b}`));
  }

  unlockTile(i: number, j: number): boolean {
    if (!this.canUnlock(i, j)) return false;
    this.tiles.add(`${i},${j}`);
    this.tileTokens--;
    this.emit({ t: "tiles" });
    return true;
  }

  // ---------------------------------------------------------------- road edits

  private applyRoads(fn: () => void): Op[] {
    this.net.begin();
    fn();
    const cs = this.net.rebuild();
    const ops = this.net.commit();
    this.afterRoads(cs);
    return ops;
  }

  private afterRoads(cs: ChangeSet) {
    this.buildings.reattach();
    this.traffic.onNetworkChange(cs);
    this.emit({ t: "roads", cs });
  }

  private pushUndo(e: UndoEntry) {
    this.undoStack.push(e);
    if (this.undoStack.length > 200) this.undoStack.shift();
    this.redoStack = [];
  }

  build(plan: Plan): boolean {
    if (plan.errors.length) return false;
    const before = this.net.nodes.size + this.net.segs.size;
    const ops = this.applyRoads(() => {
      if (plan.kind === "roundabout") commitRoundabout(this.net, plan);
      else {
        for (const st of plan.strokes) {
          commitStrokes(this.net, [st]);
          // later strokes of a grid must see earlier ones
          if (plan.strokes.length > 1) {
            const cs = this.net.rebuild();
            this.traffic.onNetworkChange(cs);
            this.emit({ t: "roads", cs });
          }
        }
      }
    });
    void before;
    this.money -= plan.cost;
    this.pushUndo({ label: plan.kind, ops, money: plan.cost, added: [], removed: [] });
    this.emit({ t: "money" });
    return true;
  }

  /** Remove roads and/or buildings. Roads refund 75%; buildings go back to the inventory. */
  bulldoze(segs: number[], bIds: number[]): number {
    const refund = removalRefund(this.net, this.world, segs);
    const removed: Building[] = [];
    for (const id of bIds) {
      const b = this.buildings.byId.get(id);
      if (!b) continue;
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

  /** Cost and problems of changing a road's type. Lots a wider road would cover are pushed back when there is room. */
  upgradePlan(segId: number, to: RoadTypeId): { cost: number; errors: PlanError[]; moves: BuildingMove[] } {
    const u = upgradeCost(this.net, this.world, segId, to);
    const T = ROAD_TYPES[to];
    const hit = u.errors.find((e) => e.buildings?.length);
    if (!hit || !T.allowsAccess) return { ...u, moves: [] };
    const r = this.buildings.pushBack(segId, roadWidth(T) / 2, hit.buildings!, this.world);
    if (!r.stuck.length) return { cost: u.cost, errors: u.errors.filter((e) => e !== hit), moves: r.moves };
    const n = r.stuck.length;
    const errors = u.errors.map((e) => (e === hit ? { ...e, msg: n === 1 ? "Building in the way" : `${n} buildings in the way`, buildings: r.stuck } : e));
    return { cost: u.cost, errors, moves: [] };
  }

  upgrade(segId: number, to: RoadTypeId): boolean {
    const s = this.net.segs.get(segId);
    if (!s || s.type === to) return false;
    const u = this.upgradePlan(segId, to);
    if (u.errors.length) return false;
    this.buildings.applyMoves(u.moves, true);
    const ops = this.applyRoads(() => this.net.setType(segId, to));
    this.money -= u.cost;
    this.pushUndo({ label: "upgrade", ops, money: u.cost, added: [], removed: [], moved: u.moves.length ? u.moves : undefined });
    this.emit({ t: "money" });
    if (u.moves.length) this.emit({ t: "buildings" });
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
    const cost = !n.signal && plan ? SIGNAL_COST : 0;
    if (cost > this.money) return false;
    const ops = this.applyRoads(() => this.net.setSignal(nodeId, plan));
    this.money -= cost;
    this.pushUndo({ label: "signal", ops, money: cost, added: [], removed: [] });
    this.emit({ t: "money" });
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
      // opposite arm: direction closest to -a.dir
      let best: (typeof arms)[number] | null = null, bd = -0.7;
      for (const b of arms) {
        if (used.has(b.seg)) continue;
        const d = -(a.dir.x * b.dir.x + a.dir.y * b.dir.y);
        if (d > bd) { bd = d; best = b; }
      }
      if (best) { used.add(best.seg); group.push(best.seg); }
      phases.push({ arms: group, dur: 12 });
    }
    return { phases };
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    // lots go back before the road narrows, so their driveways re-attach
    if (e.moved) this.buildings.applyMoves(e.moved, false);
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
  }

  redo() {
    const e = this.redoStack.pop();
    if (!e) return;
    if (e.moved) this.buildings.applyMoves(e.moved, true);
    if (e.ops.length) {
      this.net.redo(e.ops);
      this.afterRoads(this.net.rebuild());
    }
    this.money -= e.money;
    for (const b of e.added) this.restoreBuilding(b);
    for (const b of e.removed) this.removeBuildingRaw(this.buildings.byId.get(b.id) ?? b);
    this.undoStack.push(e);
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
  }

  // ---------------------------------------------------------------- buildings

  placement(kind: BuildingKind, p: V2): Placement | null {
    return this.buildings.placement(kind, p, this.world);
  }

  place(kind: BuildingKind, pl: Placement): Building | null {
    if (!pl.ok || (this.inventory[kind] ?? 0) <= 0) return null;
    const b = this.buildings.add(kind, pl, this.level);
    this.inventory[kind] = (this.inventory[kind] ?? 0) - 1;
    this.spawnResidents(b);
    this.pushUndo({ label: "place", ops: [], money: 0, added: [b], removed: [] });
    this.emit({ t: "buildings" });
    return b;
  }

  private spawnResidents(b: Building) {
    const T = BUILDING_TYPES[b.kind];
    for (let i = 0; i < T.residents; i++) {
      const r: Resident = { id: this.nextResident++, home: b.id, job: -1, state: "home", t: 5 + this.rng() * 60, trips: 0, at: -1, lastWorkOk: -1e9 };
      this.residents.push(r);
      this.residentById.set(r.id, r);
    }
    this.assignJobs();
  }

  private removeBuildingRaw(b: Building) {
    if (!this.buildings.byId.has(b.id)) return;
    this.buildings.remove(b.id);
    this.inventory[b.kind] = (this.inventory[b.kind] ?? 0) + 1;
    // residents of a removed home leave; workers lose their job
    this.residents = this.residents.filter((r) => {
      if (r.home === b.id) { this.residentById.delete(r.id); return false; }
      if (r.job === b.id) r.job = -1;
      if (r.at === b.id && r.state === "away") { r.state = "home"; r.t = 10; }
      return true;
    });
    this.assignJobs();
  }

  private restoreBuilding(b: Building) {
    if (this.buildings.byId.has(b.id)) return;
    this.buildings.list.push(b);
    this.buildings.byId.set(b.id, b);
    this.inventory[b.kind] = Math.max(0, (this.inventory[b.kind] ?? 0) - 1);
    this.buildings.reattach();
    this.spawnResidents(b);
  }

  /** Give unemployed residents the nearest open job. */
  private assignJobs() {
    const open: { b: Building; free: number }[] = [];
    const taken = new Map<number, number>();
    for (const r of this.residents) if (r.job >= 0) taken.set(r.job, (taken.get(r.job) ?? 0) + 1);
    for (const b of this.buildings.list) {
      const jobs = BUILDING_TYPES[b.kind].jobs;
      if (jobs > 0) open.push({ b, free: jobs - (taken.get(b.id) ?? 0) });
    }
    for (const r of this.residents) {
      if (r.job >= 0) continue;
      const home = this.buildings.byId.get(r.home);
      if (!home) continue;
      let best: { b: Building; free: number } | null = null, bd = Infinity;
      for (const o of open) {
        if (o.free <= 0) continue;
        const d = dist(o.b.c, home.c);
        if (d < bd) { bd = d; best = o; }
      }
      if (!best) break;
      r.job = best.b.id;
      best.free--;
    }
  }

  // ---------------------------------------------------------------- simulation

  update(realDt: number) {
    if (this.paused) return;
    this.acc += Math.min(realDt, 0.25) * this.speed;
    let steps = 0;
    while (this.acc >= SIM.dt && steps < 16) {
      this.step(SIM.dt);
      this.acc -= SIM.dt;
      steps++;
    }
    if (steps >= 16) this.acc = 0; // fell behind: drop time rather than spiral
    this.playtime += realDt;
  }

  /** Interpolation factor between the last two sim steps (for smooth rendering). */
  get alpha() {
    return this.acc / SIM.dt;
  }

  step(dt: number) {
    this.time += dt;
    this.traffic.step(dt);
    for (const r of this.residents) {
      if (r.state !== "home" && r.state !== "away") continue;
      r.t -= dt;
      if (r.t > 0) continue;
      if (r.state === "home") this.startOutbound(r);
      else this.startReturn(r);
    }
    for (const b of this.buildings.list) this.stepBuilding(b, dt);
    this.jobTimer += dt;
    if (this.jobTimer > 10) { this.jobTimer = 0; this.assignJobs(); }
    this.objTimer += dt;
    if (this.objTimer >= 0.5) {
      const span = this.objTimer;
      this.objTimer = 0;
      this.updateSatisfaction(span);
      this.evalObjectives();
      if (this.objectives.every((o) => o.done)) {
        this.allGoodFor += span;
        if (this.allGoodFor >= 3) this.levelUp();
      } else this.allGoodFor = 0;
    }
  }

  private startOutbound(r: Resident) {
    const home = this.buildings.byId.get(r.home);
    if (!home || !home.access) { r.t = 15; return; }
    const job = r.job >= 0 ? this.buildings.byId.get(r.job) : undefined;
    let dest: Building | undefined;
    let kind: Trip["kind"] = "shop";
    if (job && job.access && (r.trips === 0 ? this.rng() < 0.5 : this.rng() < 0.55)) { dest = job; kind = "work"; }
    else {
      dest = this.pickShop(home);
      if (!dest && job?.access) { dest = job; kind = "work"; }
    }
    if (!dest || !dest.access) { r.t = 20 + this.rng() * 20; return; }
    r.state = "out";
    r.at = dest.id;
    this.traffic.request({
      from: home.access, fromSide: home.side, to: dest.access, toSide: dest.side,
      trip: { kind, from: home.id, to: dest.id, resident: r.id, startT: this.time, freeFlow: 0 },
      truck: false, tries: 0, wait: 0,
    });
  }

  private startReturn(r: Resident) {
    const at = this.buildings.byId.get(r.at);
    const home = this.buildings.byId.get(r.home);
    if (!home) return;
    if (!at || !at.access || !home.access) { r.state = "home"; r.t = 30; return; }
    r.state = "back";
    this.traffic.request({
      from: at.access, fromSide: at.side, to: home.access, toSide: home.side,
      trip: { kind: "home", from: at.id, to: home.id, resident: r.id, startT: this.time, freeFlow: 0 },
      truck: false, tries: 0, wait: 0,
    });
  }

  /** Nearby commercial, weighted towards the closest few. */
  private pickShop(home: Building): Building | undefined {
    const shops = this.buildings.list.filter((b) => BUILDING_TYPES[b.kind].zone === "com" && b.access);
    if (!shops.length) return undefined;
    const scored = shops.map((b) => {
      const pull = b.kind === "mall" ? 2.2 : b.kind === "store" ? 1.5 : 1;
      return { b, d: dist(b.c, home.c) / pull };
    }).sort((a, b) => a.d - b.d);
    const k = Math.min(3, scored.length);
    let tot = 0;
    const w = scored.slice(0, k).map((s) => { const x = 1 / (s.d + 60); tot += x; return x; });
    let u = this.rng() * tot;
    for (let i = 0; i < k; i++) { u -= w[i]; if (u <= 0) return scored[i].b; }
    return scored[0].b;
  }

  private onArrive(v: Vehicle, now: number) {
    const trip = v.trip;
    const actual = now - trip.startT;
    this.traffic.recordTrip(trip.freeFlow, actual);
    const to = this.buildings.byId.get(trip.to);
    if (trip.kind === "cargo") {
      const n = this.enRoute.get(trip.to) ?? 1;
      this.enRoute.set(trip.to, n - 1);
      if (to) to.stock = Math.min(5, to.stock + 1);
      return;
    }
    const r = this.residentById.get(trip.resident);
    if (!r) return;
    if (trip.kind === "home") { r.state = "home"; r.t = SIM.tripInterval[0] + this.rng() * (SIM.tripInterval[1] - SIM.tripInterval[0]); return; }
    const home = this.buildings.byId.get(r.home);
    r.state = "away";
    r.trips++;
    r.at = trip.to;
    if (trip.kind === "work") {
      r.t = 50 + this.rng() * 40;
      r.lastWorkOk = now;
      if (home) home.workTime = ewma(home.workTime, actual, 0.25);
    } else {
      r.t = SIM.dwellMin + this.rng() * (SIM.dwellMax - SIM.dwellMin);
      if (home) home.shopTime = ewma(home.shopTime, actual, 0.25);
      if (to) to.visits += 1;
    }
  }

  private onFail(trip: Trip, _reason: string) {
    this.failedTrips++;
    if (trip.kind === "cargo") {
      const n = this.enRoute.get(trip.to) ?? 1;
      this.enRoute.set(trip.to, n - 1);
      const from = this.buildings.byId.get(trip.from);
      if (from) from.out = Math.min(4, from.out + 1);
      return;
    }
    const r = this.residentById.get(trip.resident);
    if (!r) return;
    const home = this.buildings.byId.get(r.home);
    if (home) {
      // a trip that couldn't happen counts as a very slow one
      if (trip.kind === "work") home.workTime = ewma(home.workTime, SIM.workTarget * 3, 0.25);
      else if (trip.kind === "shop") home.shopTime = ewma(home.shopTime, SIM.shopTarget * 3, 0.25);
    }
    r.state = "home";
    r.t = 25 + this.rng() * 25;
  }

  private stepBuilding(b: Building, dt: number) {
    const T = BUILDING_TYPES[b.kind];
    b.visits *= Math.exp(-dt / 180); // decaying customer count (~3 min memory)
    const staff = b.factors.staff ?? 1;
    if (T.produces) {
      const needsInput = !!T.consumes;
      if (!needsInput || b.stock > 0) {
        b.prodT += dt * Math.max(0.15, staff);
        if (b.prodT >= SIM.deliveryInterval) {
          b.prodT = 0;
          if (needsInput) b.stock--;
          b.out = Math.min(4, b.out + 1);
        }
      }
      if (b.out > 0 && b.access) this.dispatch(b, T.produces);
    } else if (T.consumes) {
      // shops sell their goods over time
      b.prodT += dt;
      if (b.prodT >= 150) { b.prodT = 0; if (b.stock > 0) b.stock--; }
    }
  }

  private dispatch(from: Building, cargo: Cargo) {
    let best: Building | null = null, bs = Infinity;
    for (const b of this.buildings.list) {
      if (BUILDING_TYPES[b.kind].consumes !== cargo || !b.access) continue;
      const pending = this.enRoute.get(b.id) ?? 0;
      const level = b.stock + pending;
      if (level >= 4) continue;
      const score = level * 600 + dist(b.c, from.c);
      if (score < bs) { bs = score; best = b; }
    }
    if (!best) return;
    from.out--;
    this.enRoute.set(best.id, (this.enRoute.get(best.id) ?? 0) + 1);
    this.traffic.request({
      from: from.access!, fromSide: from.side, to: best.access!, toSide: best.side,
      trip: { kind: "cargo", from: from.id, to: best.id, resident: -1, cargo, startT: this.time, freeFlow: 0 },
      truck: true, tries: 0, wait: 0,
    });
  }

  // ---------------------------------------------------------------- satisfaction + objectives

  private updateSatisfaction(_span: number) {
    const polluters = this.buildings.list.filter((b) => BUILDING_TYPES[b.kind].pollution > 0);
    const workersAt = new Map<number, number>();
    for (const r of this.residents) {
      if (r.job >= 0 && this.time - r.lastWorkOk < 420) workersAt.set(r.job, (workersAt.get(r.job) ?? 0) + 1);
    }
    const assigned = new Map<number, number>();
    for (const r of this.residents) if (r.job >= 0) assigned.set(r.job, (assigned.get(r.job) ?? 0) + 1);
    for (const b of this.buildings.list) {
      const T = BUILDING_TYPES[b.kind];
      const f: Record<string, number> = {};
      if (!b.access) {
        b.factors = { commercial: 0, work: 0 };
        b.sat = 0;
        continue;
      }
      // pollution and noise hurt homes, shops and farms
      let pol = 0;
      if (T.zone === "res" || T.zone === "com" || b.kind === "farm") {
        for (const p of polluters) {
          if (p === b) continue;
          const R = BUILDING_TYPES[p.kind].pollution;
          const d = dist(p.c, b.c);
          if (d < R) pol += 1 - d / R;
        }
      }
      if (T.zone === "res") {
        const shop = b.shopTime < 0 ? 1 : clamp01x(SIM.shopTarget / Math.max(1, b.shopTime));
        const hasJobs = this.residents.some((r) => r.home === b.id && r.job >= 0);
        const work = !hasJobs || b.workTime < 0 ? 1 : clamp01x(SIM.workTarget / Math.max(1, b.workTime));
        f.commercial = shop;
        f.work = work;
        f.noise = this.noiseAt(b);
        f.pollution = Math.min(0.6, pol * 0.45);
        b.sat = 0.5 * shop + 0.5 * work - f.noise - f.pollution;
      } else {
        const jobs = T.jobs;
        const filled = Math.min(jobs, assigned.get(b.id) ?? 0);
        const arriving = workersAt.get(b.id) ?? 0;
        // before anyone could commute, judge by filled positions only
        const placedFor = this.time - (b.factors._t ?? this.time);
        const staff = jobs ? (placedFor < 200 ? filled / jobs : Math.min(1, (arriving + 0.5) / Math.max(1, filled || jobs)) * (filled / jobs)) : 1;
        f._t = b.factors._t ?? this.time;
        if (T.zone === "com") {
          const expected = jobs * 0.5;
          const cust = Math.min(1, (b.visits * (180 / 60)) / Math.max(1, expected * 3) + (placedFor < 240 ? 1 : 0));
          f.staff = Math.min(1, 0.5 * staff + 0.5 * cust);
          f.input = b.stock > 0 ? 1 : 0.35;
          f.pollution = Math.min(0.5, pol * 0.3);
          b.sat = 0.7 * f.staff + 0.3 * f.input - f.pollution;
        } else if (T.zone === "work") {
          f.staff = staff;
          b.sat = staff;
        } else {
          f.staff = staff;
          if (T.consumes) f.input = b.stock > 0 ? 1 : 0.3;
          if (b.kind === "farm") f.pollution = Math.min(0.6, pol * 0.5);
          b.sat = T.consumes ? 0.55 * staff + 0.45 * (f.input ?? 1) : staff - (f.pollution ?? 0);
        }
      }
      b.sat = Math.max(0, Math.min(1, b.sat));
      b.factors = f;
    }
  }

  private noiseAt(b: Building): number {
    let worst = 0;
    for (const id of this.net.segsNear(b.c.x - 40, b.c.y - 40, b.c.x + 40, b.c.y + 40)) {
      const s = this.net.segs.get(id)!;
      const rank = ROAD_TYPES[s.type].rank;
      if (rank < 3) continue;
      const g = this.net.segGeom.get(id)!;
      let d = Infinity;
      for (const p of g.center.pts) d = Math.min(d, dist(p, b.c));
      d -= g.width / 2 + b.hd;
      const n = (rank >= 4 ? 0.18 : 0.12) * Math.max(0, 1 - d / 35);
      worst = Math.max(worst, n);
    }
    return worst;
  }

  /** City-wide average building satisfaction and the factor that drags it down most. */
  satisfaction(): { avg: number; drag: { key: string; loss: number } | null } {
    const L = this.buildings.list;
    if (!L.length) return { avg: 1, drag: null };
    let sum = 0;
    const loss: Record<string, number> = {};
    for (const b of L) {
      sum += b.sat;
      for (const [k, v] of Object.entries(b.factors)) {
        if (k.startsWith("_")) continue;
        const l = k === "pollution" || k === "noise" ? v : Math.max(0, 1 - v) * (BUILDING_TYPES[b.kind].zone === "res" ? 0.5 : 0.6);
        loss[k] = (loss[k] ?? 0) + l;
      }
    }
    let drag: { key: string; loss: number } | null = null;
    for (const [k, v] of Object.entries(loss)) if (!drag || v > drag.loss) drag = { key: k, loss: v / L.length };
    return { avg: sum / L.length, drag: drag && drag.loss > 0.004 ? drag : null };
  }

  remainingToPlace(): number {
    let n = 0;
    for (const v of Object.values(this.inventory)) n += v ?? 0;
    return n;
  }

  residentsWithoutTrip(): Resident[] {
    return this.residents.filter((r) => r.trips === 0);
  }

  evalObjectives() {
    const L = levelDef(this.level);
    const left = this.remainingToPlace();
    const noTrip = this.residentsWithoutTrip().length;
    const sat = this.satisfaction();
    const flow = this.traffic.flowScore();
    const pct = (x: number) => (x * 100).toFixed(1) + "%";
    this.objectives = [
      { id: "placed", label: "All buildings placed", done: left === 0, value: left ? `${left} to go` : "", good: left === 0 },
      { id: "trips", label: "Trip taken by every new resident", done: noTrip === 0 && this.residents.length > 0, value: noTrip ? `${noTrip} to go` : this.residents.length ? "" : "no residents", good: noTrip === 0 },
      {
        id: "sat", label: `${Math.round(L.satisfaction * 100)}% building satisfaction`, done: sat.avg >= L.satisfaction - 1e-9, value: pct(sat.avg), good: sat.avg >= L.satisfaction,
        sub: sat.drag ? { label: FACTOR_LABEL[sat.drag.key] ?? sat.drag.key, value: pct(sat.drag.loss) } : undefined,
      },
      { id: "flow", label: `${Math.round(L.flow * 100)}% traffic flow`, done: flow >= L.flow - 1e-9, value: pct(flow), good: flow >= L.flow },
    ];
  }

  private levelUp() {
    this.allGoodFor = 0;
    this.level++;
    const L = levelDef(this.level);
    for (const [k, v] of Object.entries(L.give)) {
      if (!v) continue;
      const kk = k as BuildingKind;
      this.inventory[kk] = (this.inventory[kk] ?? 0) + v;
    }
    this.money += L.money;
    this.tileTokens += L.tiles;
    this.evalObjectives();
    this.emit({ t: "level", level: this.level, note: L.note });
    this.emit({ t: "money" });
  }

  get levelSatTarget() {
    return levelDef(this.level).satisfaction;
  }

  // ---------------------------------------------------------------- save / load

  serialize() {
    return {
      v: 1,
      seed: this.seed,
      net: this.net.toJSON(),
      buildings: this.buildings.list.map((b) => ({ id: b.id, kind: b.kind, c: b.c, rot: b.rot, front: b.front, side: b.side, placedLevel: b.placedLevel, stock: b.stock })),
      nextBuilding: this.buildings.nextId,
      residents: this.residents.map((r) => ({ id: r.id, home: r.home, job: r.job, trips: r.trips })),
      nextResident: this.nextResident,
      money: this.money,
      level: this.level,
      inventory: this.inventory,
      tiles: [...this.tiles],
      tileTokens: this.tileTokens,
      time: this.time,
      playtime: this.playtime,
    };
  }

  static load(data: ReturnType<Game["serialize"]>): Game {
    const g = new Game(data.seed);
    g.net.load(data.net);
    g.buildings.list = [];
    g.buildings.byId.clear();
    for (const d of data.buildings) {
      const T = BUILDING_TYPES[d.kind];
      const b: Building = {
        id: d.id, kind: d.kind, c: d.c, rot: d.rot, hw: T.w / 2, hd: T.d / 2, front: d.front, access: null, side: d.side,
        placedLevel: d.placedLevel, stock: d.stock, out: 0, prodT: 0, workersPresent: 0, visits: 0, shopTime: -1, workTime: -1, sat: 1, factors: {},
      };
      g.buildings.list.push(b);
      g.buildings.byId.set(b.id, b);
    }
    g.buildings.nextId = data.nextBuilding;
    g.residents = data.residents.map((r) => ({ ...r, state: "home" as const, t: 3 + g.rng() * 40, at: -1, lastWorkOk: -1e9 }));
    for (const r of g.residents) g.residentById.set(r.id, r);
    g.nextResident = data.nextResident;
    g.money = data.money;
    g.level = data.level;
    g.inventory = { ...data.inventory };
    g.tiles = new Set(data.tiles);
    g.tileTokens = data.tileTokens;
    g.time = data.time;
    g.traffic.time = data.time;
    g.playtime = data.playtime;
    const cs = g.net.rebuildAll();
    g.buildings.reattach();
    g.traffic.onNetworkChange(cs);
    g.evalObjectives();
    return g;
  }

  segCost(id: number) {
    return segCost(this.net, id, this.world);
  }

  refundOf(segs: number[]) {
    return removalRefund(this.net, this.world, segs) ;
  }

  get bulldozeRate() {
    return BULLDOZE_REFUND;
  }
}

function ewma(prev: number, x: number, k: number) {
  return prev < 0 ? x : prev + (x - prev) * k;
}

function clamp01x(x: number) {
  return Math.max(0, Math.min(1.15, x));
}
