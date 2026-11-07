import {
  BUILDING_TYPES, BULLDOZE_REFUND, START_TILES, TILE, ROAD_TYPES, SIGNAL_COST, SIM, roadWidth, type RoadTypeId,
} from "../config";
import { add, dist, polyClosest, rectCorners, scale, sub, type V2 } from "../core/math";
import { mulberry32 } from "../core/noise";
import { RoadNetwork, type ChangeSet, type Op, type SignalPlan } from "../roads/network";
import {
  applyTrim, chainPoints, commitRoundabout, commitStrokes, removalRefund, segCost, upgradeCost, type BuildWorld, type Plan, type PlanError,
} from "../roads/planner";
import { Traffic, type Trip, type Vehicle } from "../sim/traffic";
import { Terrain } from "../world/terrain";
import type { Gateway } from "../world/gen";
import { MOTORWAY_TYPE, carriageways, centrePoints, planMotorway, type MotorwayPlan } from "../world/motorway";
import { Buildings, obbOverlap, type Building, type BuildingMove } from "./buildings";
import { LEVEL_LV, ZONE_GROUP, ZONE_LOTS, capacity, modelFit, type LotTemplate } from "./growables";
import { MILESTONES, milestoneFor, tilePrice, tileSlots, unlockedFeature, unlockedRoads, unlockedZones, type Milestone } from "./progression";
import { DAY, HOUR, Society, estTime, type Port } from "./society";
import { SERVICES, Services, type ServiceKind } from "./services";
import type { Placement } from "./buildings";
import { CELL, DEPTH, ZoneMap, type Block, type Cell, type ZoneGroup, type ZoneId } from "./zones";

interface UndoEntry {
  label: string;
  ops: Op[];
  money: number; // money spent (negative = refunded)
  added: Building[];
  removed: Building[];
  moved?: BuildingMove[]; // lots pushed back by a road widening
  zones?: { p: V2; from: ZoneId | null; to: ZoneId | null }[];
}

export type GameEvent =
  | { t: "roads"; cs: ChangeSet }
  | { t: "buildings" }
  | { t: "zones" }
  | { t: "milestone"; index: number }
  | { t: "money" }
  | { t: "tiles" }
  | { t: "toast"; msg: string };

export interface DemandFactor { label: string; v: number }
export interface Demand { v: number; factors: DemandFactor[] }

export interface Budget {
  income: Record<"res" | "com" | "ind" | "off", number>;
  expense: Record<"roads" | "services" | "loans", number>;
}

/** A truck load not simulated as a vehicle, arriving at a set time. */
interface VirtualCargo { t: number; to: number; cargo: "goods" | "materials" }

const GROUPS: ZoneGroup[] = ["res", "com", "ind", "off"];

export class Game {
  seed: number;
  terrain: Terrain;
  net = new RoadNetwork();
  traffic: Traffic;
  buildings: Buildings;
  zones: ZoneMap;
  people: Society;
  services: Services;
  money = 0;
  tiles = new Set<string>();
  time = 0;
  playtime = 0;
  speed = 1;
  paused = false;
  readonly dt = SIM.dt;
  milestone = 0;
  cityName = "Larkfield";
  tax: Record<ZoneGroup, number> = { res: 10, com: 10, ind: 10, off: 10 };
  demand: Record<ZoneGroup, Demand> = { res: { v: 0, factors: [] }, com: { v: 0, factors: [] }, ind: { v: 0, factors: [] }, off: { v: 0, factors: [] } };
  /** Per game hour: last complete hour, and the one being counted. */
  budget: Budget = emptyBudget();
  private budgetNow: Budget = emptyBudget();
  /** Money at the end of each of the last 48 hours. */
  history: { money: number; pop: number; jobs: number }[] = [];
  rng: () => number;
  private acc = 0;
  private undoStack: UndoEntry[] = [];
  private redoStack: UndoEntry[] = [];
  private listeners: ((e: GameEvent) => void)[] = [];
  private tickT = 0;
  private hourT = 0;
  private cargoQ: VirtualCargo[] = [];
  private ordered = new Map<number, number>(); // building id -> loads on their way
  failedTrips = 0;
  readonly world: BuildWorld;
  gateways: Gateway[] = [];
  motorway: MotorwayPlan | null = null;
  /** Points where traffic enters (entries) and leaves (exits) the region. */
  entries: Port[] = [];
  exits: Port[] = [];
  private borderPts: { gateIn: number; gateOut: number; inP: V2; outP: V2 }[] = [];
  private comp = new Map<number, number>(); // node id -> connected component
  private compVersion = -1;
  private shopCache: Building[] | null = null;
  private candCache = new Map<ZoneGroup, Cell[]>();
  private candVersion = -1;
  /** Roads whose use is blocked (no route); shown as notifications. */
  noRouteAt = new Map<number, number>();

  constructor(seed = 7) {
    this.seed = seed;
    this.rng = mulberry32(seed * 31 + 5);
    this.terrain = new Terrain(seed);
    this.gateways = this.terrain.gen.gateways();
    this.motorway = planMotorway(this.terrain.gen, this.gateways);
    if (this.motorway) {
      this.mwPts = centrePoints(this.motorway.prims, 40);
      this.terrain.gen.corridors.add(this.mwPts);
    }
    this.buildings = new Buildings(this.net);
    this.traffic = new Traffic(this.net, {
      arrive: (v, now) => this.onArrive(v, now),
      fail: (trip, reason) => this.onFail(trip, reason),
      exits: () => this.exits.map((p) => p.a),
    });
    for (const [i, j] of START_TILES) this.tiles.add(`${i},${j}`);
    this.money = 60000;
    const t = this.terrain;
    this.zones = new ZoneMap(this.net, { isWater: (p) => t.isWater(p), isMountain: (p) => t.isMountain(p), owned: (p) => this.unlocked(p) });
    this.people = new Society(this);
    this.services = new Services(this);
    this.world = {
      isWater: (p) => t.isWater(p),
      isMountain: (p) => t.isMountain(p),
      inBounds: (p) => t.inBounds(p, 2),
      unlocked: () => true, // roads can go anywhere (CS2: building needs owned land, roads don't)
      buildingsHit: (pts, hw) => this.buildings.hit(pts, hw).filter((id) => !this.buildings.byId.get(id)?.zone),
      money: () => this.money,
    };
    if (this.motorway) this.layMotorway(this.motorway);
    this.zones.rebuildAll();
    this.updateOutside();
  }

  /** Build the pre-built motorway's two carriageways (not undoable; free). */
  private layMotorway(plan: MotorwayPlan) {
    const cws = carriageways(plan);
    this.applyRoads(() => {
      for (const cw of cws) {
        let prev = -1;
        for (const pc of cw.pieces) {
          const a = prev >= 0 ? prev : this.net.addNode(pc.c.p0, pc.h0);
          const b = this.net.addNode(pc.c.p3, pc.h1);
          this.net.addSeg(a, b, MOTORWAY_TYPE, pc.c);
          prev = b;
        }
      }
    });
    // border points: where each carriageway crosses a ring round the start (the region's simulated edge)
    const R = 2400;
    cws.forEach((cw, k) => {
      const pts: V2[] = [];
      for (const pc of cw.pieces) for (let i = 0; i <= 8; i++) {
        const u = i / 8, w = 1 - u, c = pc.c;
        pts.push({ x: w * w * w * c.p0.x + 3 * w * w * u * c.p1.x + 3 * w * u * u * c.p2.x + u * u * u * c.p3.x, y: w * w * w * c.p0.y + 3 * w * w * u * c.p1.y + 3 * w * u * u * c.p2.y + u * u * u * c.p3.y });
      }
      const first = pts.findIndex((p) => Math.hypot(p.x, p.y) < R);
      let last = -1;
      for (let i = pts.length - 1; i >= 0; i--) if (Math.hypot(p0(pts[i]), p1(pts[i])) < R) { last = i; break; }
      if (first < 0 || last < 0) return;
      const near = (p: V2) => this.gateways.reduce((b, g) => (dist(g.p, p) < dist(b.p, p) ? g : b), this.gateways[0]);
      this.borderPts.push({ gateIn: near(pts[0]).id, gateOut: near(pts[pts.length - 1]).id, inP: pts[first], outP: pts[last] });
      void k;
    });
  }

  /** Find the motorway segs at the border points (they change when the player builds ramps). */
  private updateOutside() {
    const at = (p: V2, gate: number): Port | null => {
      for (const id of this.net.segsNear(p.x - 30, p.y - 30, p.x + 30, p.y + 30)) {
        const s = this.net.segs.get(id)!;
        if (ROAD_TYPES[s.type].bwd > 0) continue;
        const g = this.net.segGeom.get(id)!;
        const c = polyClosest(g.center, p);
        if (c.d < 4) return { gate, a: { seg: id, s: c.s, p }, side: 1 };
      }
      return null;
    };
    this.entries = [];
    this.exits = [];
    for (const bp of this.borderPts) {
      const i = at(bp.inP, bp.gateIn), o = at(bp.outP, bp.gateOut);
      if (i) this.entries.push(i);
      if (o) this.exits.push(o);
    }
  }

  /** The entry point that reaches `seg`, if any. */
  entryFor(seg: number): Port | null {
    return this.entries.find((p) => this.connected(p.a.seg, seg)) ?? null;
  }

  exitFor(seg: number): Port | null {
    return this.exits.find((p) => this.connected(p.a.seg, seg)) ?? null;
  }

  get hasOutside(): boolean {
    return this.entries.length > 0;
  }

  on(fn: (e: GameEvent) => void) {
    this.listeners.push(fn);
  }

  private emit(e: GameEvent) {
    for (const f of this.listeners) f(e);
  }

  // ---------------------------------------------------------------- tiles

  tileOf(p: V2): [number, number] {
    return [Math.floor(p.x / TILE + 0.5), Math.floor(p.y / TILE + 0.5)];
  }

  unlocked(p: V2): boolean {
    const [i, j] = this.tileOf(p);
    return this.tiles.has(`${i},${j}`);
  }

  get tileSlotsLeft(): number {
    return tileSlots(this.milestone) - this.tiles.size;
  }

  get nextTilePrice(): number {
    return tilePrice(this.tiles.size);
  }

  /** Why a tile can't be bought, or null if it can. */
  tileBlock(i: number, j: number): string | null {
    if (this.tiles.has(`${i},${j}`)) return "Already yours";
    if (Math.abs(i) > 120 || Math.abs(j) > 120) return "Too far away";
    if (this.tileSlotsLeft <= 0) return "Reach the next milestone to buy more land";
    if (this.nextTilePrice > this.money) return "Not enough money";
    const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([a, b]) => this.tiles.has(`${i + a},${j + b}`));
    if (!nb && !this.roadInTile(i, j)) return "Must border your land or have one of your roads";
    return null;
  }

  canUnlock(i: number, j: number): boolean {
    return this.tileBlock(i, j) === null;
  }

  private roadInTile(i: number, j: number): boolean {
    const x0 = (i - 0.5) * TILE, y0 = (j - 0.5) * TILE;
    for (const id of this.net.segsNear(x0, y0, x0 + TILE, y0 + TILE)) if (this.net.segs.get(id)!.type !== MOTORWAY_TYPE) return true;
    return false;
  }

  unlockTile(i: number, j: number): boolean {
    if (!this.canUnlock(i, j)) return false;
    this.money -= this.nextTilePrice;
    this.tiles.add(`${i},${j}`);
    this.zones.rebuildAll();
    this.emit({ t: "tiles" });
    this.emit({ t: "zones" });
    this.emit({ t: "money" });
    return true;
  }

  // ---------------------------------------------------------------- unlocks

  get roadsUnlocked(): Set<RoadTypeId> { return unlockedRoads(this.milestone); }
  get zonesUnlocked(): Set<ZoneId> { return unlockedZones(this.milestone); }
  featureUnlocked(f: Milestone["features"][number]): boolean { return unlockedFeature(this.milestone, f); }
  serviceUnlocked(k: ServiceKind): boolean { return this.milestone >= SERVICES[k].unlock; }

  toast(msg: string) {
    this.emit({ t: "toast", msg });
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
    this.zones.onNetworkChange(cs);
    this.updateOutside();
    this.emit({ t: "roads", cs });
    this.emit({ t: "zones" });
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
      if (st.h0 > 6 && st.h1 > 6) continue; // bridges pass over
      const pts = chainPoints(st.show ?? st.chain, 2);
      const lim = roadWidth(ROAD_TYPES[st.type]) / 2 - 0.5;
      for (const id of this.buildings.hit(pts, lim)) {
        const b = this.buildings.byId.get(id);
        if (b?.zone) out.add(b);
      }
    }
    return [...out];
  }

  /** Zoned buildings standing where a road now runs: demolished (CS2 clears growables in a road's path). */
  private clearRoadsOverLots(): Building[] {
    const gone: Building[] = [];
    for (const b of [...this.buildings.list]) {
      if (!b.zone) continue;
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
        if (hit) break;
      }
      if (hit) { gone.push(b); this.removeBuildingRaw(b); }
    }
    return gone;
  }

  build(plan: Plan): boolean {
    if (plan.errors.length) return false;
    const ops = this.applyRoads(() => {
      if (plan.kind === "roundabout") commitRoundabout(this.net, plan);
      else {
        // a parallel pair turning a corner: cut the old twin back first
        if (plan.trim) {
          applyTrim(this.net, plan.trim);
          const cs = this.net.rebuild();
          this.traffic.onNetworkChange(cs);
          this.emit({ t: "roads", cs });
        }
        // a slip lane redrawn longer: the old one goes first
        for (const id of plan.removeSegs ?? []) this.net.removeSeg(id, true);
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
    const gone = this.clearRoadsOverLots();
    this.money -= plan.cost;
    this.pushUndo({ label: plan.kind, ops, money: plan.cost, added: [], removed: gone });
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

  /** Cost and problems of changing a road's type. Placed buildings a wider road would cover are pushed back. */
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
    const gone = this.clearRoadsOverLots();
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

  // ---------------------------------------------------------------- zoning

  /** Paint (or clear, zone = null) cells. Buildings standing on repainted cells of another zone are demolished. */
  zonePaint(cells: Iterable<Cell>, zone: ZoneId | null): number {
    if (zone && !this.zonesUnlocked.has(zone)) return 0;
    const ch = this.zones.paint(cells, zone);
    if (!ch.length) return 0;
    const removed: Building[] = [];
    for (const { cell } of ch) {
      if (!cell.lot) continue;
      const b = this.buildings.byId.get(cell.lot);
      if (b && !b.svc && b.zone !== zone) { removed.push(b); this.removeBuildingRaw(b); }
    }
    this.pushUndo({ label: "zone", ops: [], money: 0, added: [], removed, zones: ch.map((c) => ({ p: c.cell.c, from: c.from, to: zone })) });
    this.emit({ t: "zones" });
    if (removed.length) this.emit({ t: "buildings" });
    return ch.length;
  }

  canUndo() { return this.undoStack.length > 0; }
  canRedo() { return this.redoStack.length > 0; }

  undo() {
    const e = this.undoStack.pop();
    if (!e) return;
    if (e.moved) this.buildings.applyMoves(e.moved, false);
    if (e.ops.length) {
      this.net.undo(e.ops);
      this.afterRoads(this.net.rebuild());
    }
    if (e.zones) this.zones.paintAt(e.zones.map((z) => ({ p: z.p, zone: z.from })));
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
    if (e.moved) this.buildings.applyMoves(e.moved, true);
    if (e.ops.length) {
      this.net.redo(e.ops);
      this.afterRoads(this.net.rebuild());
    }
    if (e.zones) this.zones.paintAt(e.zones.map((z) => ({ p: z.p, zone: z.to })));
    this.money -= e.money;
    for (const b of e.added) {
      if (b.svc) {
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

  /** Where a service building would go near p, and what it would cost and replace. */
  servicePlan(kind: ServiceKind, p: V2): (Placement & { cost: number }) | null {
    const world = { ...this.world, unlocked: (q: V2) => this.unlocked(q) };
    const pl = this.buildings.placement(kind, p, world, (o) => !!o.zone);
    if (!pl) return null;
    const cost = SERVICES[kind].cost;
    if (pl.ok && !this.serviceUnlocked(kind)) return { ...pl, ok: false, reason: "Not unlocked yet", cost };
    if (pl.ok && this.money < cost) return { ...pl, ok: false, reason: "Not enough money", cost };
    return { ...pl, cost };
  }

  /** Build a service building (fire station, school, park...). Zoned buildings in the way are cleared. */
  placeService(kind: ServiceKind, p: V2): Building | null {
    const pl = this.servicePlan(kind, p);
    if (!pl || !pl.ok) return null;
    const removed: Building[] = [];
    for (const id of pl.clears ?? []) {
      const o = this.buildings.byId.get(id);
      if (o) { removed.push(o); this.removeBuildingRaw(o); }
    }
    const b = this.buildings.add(kind, pl, this.time);
    b.svc = true;
    b.busy = 0;
    b.users = 0;
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.services.dirty();
    this.candVersion = -1;
    this.money -= pl.cost;
    this.pushUndo({ label: "service", ops: [], money: pl.cost, added: [b], removed });
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
    return b;
  }

  /** A fire nobody put out: the building is gone (zoned land grows something new). */
  burnDown(b: Building) {
    this.removeBuildingRaw(b);
    this.emit({ t: "buildings" });
  }

  private removeBuildingRaw(b: Building) {
    if (!this.buildings.byId.has(b.id)) return;
    this.buildings.remove(b.id);
    this.people.onBuildingRemoved(b.id);
    this.services.onBuildingRemoved(b.id);
    this.ordered.delete(b.id);
    for (const c of this.lotCells(b)) if (c.lot === b.id) c.lot = 0;
    this.shopCache = null;
    this.candVersion = -1;
  }

  private restoreBuilding(b: Building) {
    if (this.buildings.byId.has(b.id)) return;
    this.buildings.insert(b);
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.buildings.reattach();
    this.services.restored(b);
    this.services.dirty();
    this.shopCache = null;
    this.candVersion = -1;
  }

  /** Zone cells under a building's lot. */
  lotCells(b: Building): Cell[] {
    if (!b.zone && !b.svc) return [];
    return this.zones.inPoly(rectCorners(b.c, b.hw - 0.5, b.hd - 0.5, b.rot));
  }

  get shops(): Building[] {
    if (!this.shopCache) this.shopCache = this.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "com");
    return this.shopCache;
  }

  /** Empty, zoned front-row cells of a group, where a new lot could start. */
  private candidates(group: ZoneGroup): Cell[] {
    if (this.candVersion !== this.zones.version) {
      this.candCache.clear();
      for (const gp of GROUPS) this.candCache.set(gp, []);
      for (const c of this.zones.allCells()) if (c.row === 0 && c.ok && c.zone && !c.lot) this.candCache.get(ZONE_GROUP[c.zone])!.push(c);
      this.candVersion = this.zones.version;
    }
    return this.candCache.get(group)!;
  }

  /** Try to grow a building on zoned land of a group. */
  private grow(group: ZoneGroup): Building | null {
    const cands = this.candidates(group);
    if (!cands.length) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = cands[(this.rng() * cands.length) | 0];
      if (c.lot || !c.ok || !c.zone) continue;
      const b = c.block;
      const seg = this.net.segs.get(b.seg);
      if (!seg) continue;
      const temps = ZONE_LOTS[c.zone];
      const order = this.rng() < 0.35 ? [...temps].reverse() : temps;
      for (const t of order) {
        for (let shift = 0; shift < t.w; shift++) {
          const col0 = c.col - shift;
          if (col0 < 0 || col0 + t.w > b.cols) continue;
          if (this.lotFits(b, col0, t, c.zone)) return this.placeLot(b, col0, t, this.lotDepth(b, col0, t, c.zone), c.zone);
        }
      }
    }
    return null;
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
    return true;
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

  private placeLot(b: Block, col0: number, t: LotTemplate, depth: number, zone: ZoneId): Building | null {
    const g = this.net.segGeom.get(b.seg);
    if (!g) return null;
    let cx = 0, cy = 0, ux = 0, uy = 0;
    const cells: Cell[] = [];
    for (let k = col0; k < col0 + t.w; k++) for (let r = 0; r < depth; r++) {
      const c = b.cells[k * DEPTH + r];
      cells.push(c);
      cx += c.c.x; cy += c.c.y;
      ux += Math.cos(c.rot); uy += Math.sin(c.rot);
    }
    const n = cells.length;
    const c = { x: cx / n, y: cy / n };
    const rot = Math.atan2(uy, ux);
    const sMid = (b.colS[col0] + b.colS[col0 + t.w - 1]) / 2;
    // kerb point in front of the lot's middle
    const away = { x: -Math.sin(rot) * b.side, y: Math.cos(rot) * b.side };
    const front = add(c, scale(away, -(depth * CELL) / 2));
    const M = BUILDING_TYPES[t.model];
    const tall = t.tall ? t.tall[0] + this.rng() * (t.tall[1] - t.tall[0]) : 1;
    const bl: Building = {
      id: this.buildings.nextId++, kind: t.model, c, rot, hw: (t.w * CELL) / 2, hd: (depth * CELL) / 2, front,
      access: { seg: b.seg, s: sMid, p: front }, side: b.side, zone, lot: { block: b.key, col0, w: t.w, d: depth },
      // deeper lots hold a bit more (the back is yard, parking or storage)
      level: 1, cap: capacity(zone, t.w, t.d + (depth - t.d) * 0.5, 1, tall), fit: modelFit(t, M.w, M.d), tall, built: 0, abandoned: 0, lv: 0, upT: 0, badT: 0,
      problem: null, stock: ZONE_GROUP[zone] === "com" ? 2 : ZONE_GROUP[zone] === "ind" ? 2 : 0, out: 0, prodT: 0, visits: 0, born: this.time,
    };
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

  /** Whether a building can reach the outside world by road. */
  linkedOutside(b: Building): boolean {
    return !!b.access && !!this.entryFor(b.access.seg);
  }

  noRoute(b: Building | null) {
    if (b) this.noRouteAt.set(b.id, this.time);
  }

  /** Real trips per simulated car (1 in small towns). */
  get tripScale(): number {
    const p = this.people.stats.population + this.people.stats.commuters;
    return Math.max(1, p / 1600);
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
    // virtual cargo arrivals
    if (this.cargoQ.length && this.cargoQ[0].t <= this.time) {
      this.cargoQ.sort((a, b) => a.t - b.t);
      while (this.cargoQ.length && this.cargoQ[0].t <= this.time) this.deliver(this.cargoQ.shift()!.to);
    }
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

  /** Every 1/8 game hour: construction, demand, growth, move-ins, businesses. */
  private tick(span: number) {
    this.computeDemand();
    let changed = false;
    for (const b of this.buildings.list) {
      if (b.built < 1) {
        b.built = Math.min(1, b.built + span / (HOUR * 1.5));
        if (b.built >= 1) changed = true;
      }
    }
    // growth: more demand, more buildings at once
    for (const gp of GROUPS) {
      const d = this.demand[gp].v;
      if (d <= 8) continue;
      const pop = this.people.stats.population;
      let n = (d / 100) * (0.7 + Math.min(4, pop / 1500));
      while (n > 0) {
        if (this.rng() < Math.min(1, n)) { if (this.grow(gp)) changed = true; }
        n -= 1;
      }
    }
    this.moveIns();
    this.services.tick(span);
    for (const b of [...this.buildings.list]) this.stepBuilding(b, span);
    if (changed) this.emit({ t: "buildings" });
  }

  private moveIns() {
    const R = this.demand.res.v;
    if (R <= 0 || !this.entries.length) return;
    let n = Math.ceil((R / 100) * (1.5 + this.people.stats.households * 0.01));
    const homes = this.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && b.built >= 1 && !b.abandoned && b.access);
    if (!homes.length) return;
    for (let k = 0; k < homes.length * 2 && n > 0; k++) {
      const h = homes[(this.rng() * homes.length) | 0];
      if (this.people.householdsIn(h.id) >= h.cap) continue;
      if (!this.linkedOutside(h)) { h.problem = "Not connected to the highway: nobody can move in"; continue; }
      this.people.moveIn(h, this.entryFor(h.access!.seg));
      n--;
    }
  }

  private stepBuilding(b: Building, span: number) {
    if (!b.zone || b.built < 1) return;
    const grp = ZONE_GROUP[b.zone];
    b.visits *= Math.exp(-span / (HOUR * 6));
    if (b.abandoned) {
      // cleared after a day; the land can grow something new
      if (this.time - b.abandoned > DAY) { this.removeBuildingRaw(b); this.emit({ t: "buildings" }); }
      return;
    }
    let health = 1;
    let problem: string | null = null;
    if (!b.access) { health = 0; problem = "No road access"; }
    else if (grp === "res") {
      const hh = this.people.householdsIn(b.id);
      if (!this.linkedOutside(b) && hh === 0) problem = "Not connected to the highway: nobody can move in";
      // residents put up with a lot, but piled-up garbage, crime and no services for days make them leave
      if (hh > 0 && this.services.active) health = this.services.happiness(b);
    } else {
      const staff = b.cap ? this.people.workersAt(b.id) / b.cap : 1;
      health = Math.min(1, staff * 1.25);
      if (staff < 0.5) problem = "Not enough workers";
      if (grp === "com") {
        if (b.stock <= 0) { health *= 0.4; problem = "Out of goods to sell"; }
        const customers = b.visits / Math.max(1, b.cap * 0.8);
        if (this.time - b.born > DAY && customers < 0.2) { health *= 0.6 + customers * 2; problem ??= "Not enough customers"; }
        if (b.stock < 3) this.order(b, "goods");
      } else if (grp === "ind") {
        if (b.stock <= 0) { health *= 0.4; problem = "Waiting for materials"; }
        else {
          b.prodT += span * staff;
          if (b.prodT >= HOUR * 2) { b.prodT = 0; b.stock--; b.out = Math.min(6, b.out + 1); }
        }
        if (b.stock < 2) this.order(b, "materials");
        if (b.out >= 2) this.ship(b);
        if (b.out >= 6) { health *= 0.5; problem = "Can't ship its goods"; }
      }
    }
    if (this.noRouteAt.has(b.id) && this.time - this.noRouteAt.get(b.id)! < HOUR * 2) problem ??= "Trips can't find a route";
    const sp = this.services.problemOf(b);
    if (sp) {
      problem = sp === "On fire!" ? sp : problem ?? sp;
      if (grp !== "res") health *= b.fire ? 0 : 0.8;
    }
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
        b.cap = capacity(b.zone, b.lot?.w ?? t.w, Math.min(d, t.d) + Math.max(0, d - t.d) * 0.5, b.level, b.tall);
        this.emit({ t: "buildings" });
      }
    } else b.upT = Math.max(0, b.upT - span);
  }

  /** A shopper bought something. */
  sale(b: Building) {
    b.prodT += 1;
    if (b.prodT >= 8) { b.prodT = 0; b.stock = Math.max(0, b.stock - 1); }
  }

  // ---------------------------------------------------------------- cargo

  /** Order a load: goods for shops (from local industry, else imported), materials for industry (imported). */
  private order(b: Building, cargo: "goods" | "materials") {
    if ((this.ordered.get(b.id) ?? 0) > 0) return;
    let from: Building | null = null;
    if (cargo === "goods") {
      let bd = Infinity;
      for (const o of this.buildings.list) {
        if (o.out <= 0 || o.zone !== "ind" || !o.access || o.abandoned) continue;
        if (!this.connected(o.access.seg, b.access!.seg)) continue;
        const d = dist(o.c, b.c);
        if (d < bd) { bd = d; from = o; }
      }
    }
    if (from) from.out--;
    else if (!this.entryFor(b.access!.seg)) return;
    this.ordered.set(b.id, 1);
    this.truck(from, b, cargo);
  }

  /** Export goods to the outside world. */
  private ship(b: Building) {
    if (!this.exitFor(b.access!.seg)) return;
    b.out--;
    this.budgetNow.income.ind += 40 * (this.tax.ind / 10);
    this.truck(b, null, "goods");
  }

  private truck(from: Building | null, to: Building | null, cargo: "goods" | "materials") {
    const inP = !from && to ? this.entryFor(to.access!.seg) : null;
    const outP = !to && from ? this.exitFor(from.access!.seg) : null;
    const a = from ? from.access : inP?.a;
    const b = to ? to.access : outP?.a;
    if (!a || !b) { if (to) this.ordered.delete(to.id); return; }
    const real = this.rng() * Math.max(1, this.tripScale / 2) < 1;
    if (real) {
      this.traffic.request({
        from: a, fromSide: from ? from.side : inP!.side, to: b, toSide: to ? to.side : outP!.side,
        trip: { kind: "cargo", from: from ? from.id : -1, to: to ? to.id : -1, resident: -1, cargo, startT: this.time, freeFlow: 0 },
        truck: true, tries: 0, wait: 0, through: !from, exit: !to,
      });
    } else if (to) {
      this.cargoQ.push({ t: this.time + estTime(from ? from.c : a.p, to.c), to: to.id, cargo });
    }
  }

  private deliver(to: number) {
    this.ordered.delete(to);
    const b = this.buildings.byId.get(to);
    if (b) b.stock = Math.min(6, b.stock + 3);
  }

  private onArrive(v: Vehicle, now: number) {
    const trip = v.trip;
    this.traffic.recordTrip(trip.freeFlow, now - trip.startT);
    if (trip.run) { this.services.onArrive(v); return; }
    if (trip.kind === "cargo") {
      if (trip.to >= 0) this.deliver(trip.to);
      return;
    }
    this.people.onArrive(v);
  }

  private onFail(trip: Trip, _reason: string) {
    this.failedTrips++;
    if (trip.run) { this.services.onFail(trip); return; }
    if (trip.kind === "cargo") {
      if (trip.to >= 0) this.ordered.delete(trip.to);
      const from = this.buildings.byId.get(trip.from);
      if (from && from.zone === "ind") from.out = Math.min(6, from.out + 1);
      const to = this.buildings.byId.get(trip.to);
      this.noRoute(to ?? from ?? null);
      return;
    }
    this.people.onFail(trip);
  }

  // ---------------------------------------------------------------- demand

  private computeDemand() {
    const st = this.people.stats;
    const jobs: Record<ZoneGroup, number> = { res: 0, com: 0, ind: 0, off: 0 };
    let homes = 0, homesBuilding = 0, svcJobs = 0;
    for (const b of this.buildings.list) {
      if (b.svc) svcJobs += b.cap;
      if (!b.zone || b.abandoned) continue;
      const gp = ZONE_GROUP[b.zone];
      if (gp === "res") { if (b.built >= 1) homes += b.cap; else homesBuilding += b.cap; }
      else jobs[gp] += b.cap;
    }
    const totalJobs = jobs.com + jobs.ind + jobs.off + svcJobs;
    const pop = st.population;
    const workers = Math.max(1, st.workers);
    const freeJobs = totalJobs - st.employed - st.commuters;
    const vacant = homes + homesBuilding - st.households - st.movingIn;
    const unemp = st.workers ? st.unemployed / st.workers : 0;
    const taxF = (gp: ZoneGroup) => -(this.tax[gp] - 10) * 3;
    const clamp = (x: number) => Math.max(0, Math.min(100, Math.round(x)));
    // residential
    {
      const f: DemandFactor[] = [];
      f.push({ label: "Region attractiveness", v: pop < 150 ? 60 : 30 });
      if (totalJobs > 0) f.push({ label: "Available jobs", v: Math.round(Math.max(-30, Math.min(45, (freeJobs / Math.max(5, workers * 0.12)) * 25))) });
      if (unemp > 0.04) f.push({ label: "Unemployment", v: -Math.round(Math.min(60, (unemp - 0.04) * 250)) });
      if (vacant > 0) f.push({ label: "Empty homes", v: -Math.round(Math.min(50, (vacant / Math.max(3, (homes + homesBuilding) * 0.1)) * 25)) });
      if (this.tax.res !== 10) f.push({ label: "Taxes", v: taxF("res") });
      if (this.services.active) {
        let hs = 0, n = 0;
        for (const b of this.buildings.list) {
          if (!b.zone || ZONE_GROUP[b.zone] !== "res" || b.abandoned || !this.people.householdsIn(b.id)) continue;
          hs += this.services.happiness(b);
          n++;
        }
        if (n) f.push({ label: "City services", v: Math.round(Math.max(-35, Math.min(20, (hs / n - 0.64) * 140))) });
      }
      if (!this.entries.length) f.push({ label: "No highway connection", v: -100 });
      this.demand.res = { v: clamp(f.reduce((a, x) => a + x.v, 0)), factors: f };
    }
    // jobs follow the workforce (plus the households on their way): shared out between shops, industry and offices
    const offOn = this.zonesUnlocked.has("offLow");
    const share: Record<ZoneGroup, number> = { res: 0, com: 0.28, ind: offOn ? 0.5 : 0.72, off: offOn ? 0.22 : 0 };
    const labour = st.workers * 0.97 + st.movingIn * 1.2 + Math.max(0, this.demand.res.v - 30) * 0.15 + 10;
    const need = (gp: ZoneGroup, label: string) => {
      const want = labour * share[gp];
      return { label, v: Math.round(Math.max(-60, Math.min(60, ((want - jobs[gp]) / Math.max(5, want * 0.3)) * 50))) };
    };
    const lack = unemp < 0.03 && freeJobs > workers * 0.12 ? { label: "Not enough workers", v: -40 } : null;
    // commercial: shoppers
    {
      const f: DemandFactor[] = [{ label: "Base", v: 40 }, need("com", "Shoppers")];
      if (pop < 30) f.push({ label: "Too few residents", v: -60 });
      if (lack) f.push(lack);
      if (this.tax.com !== 10) f.push({ label: "Taxes", v: taxF("com") });
      this.demand.com = { v: clamp(f.reduce((a, x) => a + x.v, 0)), factors: f };
    }
    // industrial: goods for shops and export
    {
      const f: DemandFactor[] = [{ label: "Base", v: 45 }, need("ind", "Workers looking for jobs")];
      if (lack) f.push(lack);
      if (!this.entries.length) f.push({ label: "No highway connection", v: -60 });
      if (this.tax.ind !== 10) f.push({ label: "Taxes", v: taxF("ind") });
      this.demand.ind = { v: clamp(f.reduce((a, x) => a + x.v, 0)), factors: f };
    }
    // office: educated workers
    {
      const f: DemandFactor[] = offOn ? [{ label: "Base", v: 35 }, need("off", "Educated workers")] : [{ label: "Unlocks at Village", v: 0 }];
      if (offOn && st.edu[1] + st.edu[2] < 20) f.push({ label: "Few educated workers", v: -30 });
      if (lack && offOn) f.push(lack);
      if (this.tax.off !== 10) f.push({ label: "Taxes", v: taxF("off") });
      this.demand.off = { v: clamp(f.reduce((a, x) => a + x.v, 0)), factors: f };
    }
  }

  // ---------------------------------------------------------------- hourly: economy, land value, milestones

  private hourly() {
    const st = this.people.stats;
    const B = this.budgetNow;
    B.income.res += st.employed * 0.9 * (this.tax.res / 10);
    for (const b of this.buildings.list) {
      if (!b.zone || b.abandoned || b.built < 1) continue;
      const gp = ZONE_GROUP[b.zone];
      if (gp === "res") continue;
      const h = (b as Building & { health?: number }).health ?? 1;
      const w = this.people.workersAt(b.id);
      const rate = gp === "com" ? 0.8 : gp === "ind" ? 0.7 : 1.0;
      B.income[gp] += w * rate * h * (this.tax[gp] / 10);
    }
    let roads = 0;
    for (const s of this.net.segs.values()) {
      if (s.type === MOTORWAY_TYPE && this.isPrebuilt(s.id)) continue;
      const g = this.net.segGeom.get(s.id);
      if (g) roads += g.center.length * ROAD_TYPES[s.type].costPerM * 0.004;
    }
    B.expense.roads += roads;
    B.expense.services += this.services.upkeep();
    this.services.hourly();
    const net = sum(B.income) - sum(B.expense);
    this.money += net;
    this.budget = B;
    this.budgetNow = emptyBudget();
    let jobs = 0;
    for (const b of this.buildings.list) if ((b.svc || (b.zone && ZONE_GROUP[b.zone] !== "res")) && !b.abandoned) jobs += b.cap;
    this.history.push({ money: this.money, pop: st.population, jobs });
    if (this.history.length > 72) this.history.shift();
    this.landValue();
    // households with nobody working for two days leave
    for (const hh of [...this.people.households.values()]) {
      if (!hh.arrived) continue;
      const adults = hh.members.filter((c) => c.age === 1);
      if (!adults.length || adults.some((c) => c.job >= 0 || c.school >= 0)) continue;
      if (adults.every((c) => this.time - c.jobless > DAY * 2) && this.rng() < 0.15) this.people.moveOut(hh);
    }
    for (const [id, t] of this.noRouteAt) if (this.time - t > HOUR * 3) this.noRouteAt.delete(id);
    // milestones
    const m = milestoneFor(st.population);
    if (m > this.milestone) {
      for (let k = this.milestone + 1; k <= m; k++) this.money += MILESTONES[k].grant;
      this.milestone = m;
      this.zones.rebuildAll();
      this.emit({ t: "milestone", index: m });
      this.emit({ t: "zones" });
    }
    this.emit({ t: "money" });
  }

  private mwPts: V2[] = [];
  /** The pre-built motorway's upkeep is paid by the region (CS2's starting highway costs nothing to keep). */
  private isPrebuilt(id: number) {
    const g = this.net.segGeom.get(id);
    if (!g || !this.mwPts.length) return false;
    const m = g.center.pts[g.center.pts.length >> 1];
    for (const q of this.mwPts) if (Math.abs(q.x - m.x) < 40 && Math.abs(q.y - m.y) < 40) return true;
    return false;
  }

  /** Land value from road access, nearby shops and jobs, minus industrial pollution and busy-road noise. */
  private landValue() {
    const list = this.buildings.list.filter((b) => b.zone && !b.abandoned);
    const ind = list.filter((b) => b.zone === "ind");
    const shops = list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "com");
    const pop = this.people.stats.population;
    for (const b of list) {
      let lv = 18 + Math.min(12, pop / 600);
      if (b.access) {
        const s = this.net.segs.get(b.access.seg);
        if (s) lv += ROAD_TYPES[s.type].rank === 2 ? 4 : 0;
      }
      const grp = ZONE_GROUP[b.zone!];
      if (grp === "res") {
        let near = 0;
        for (const o of shops) if (dist(o.c, b.c) < 320) near++;
        lv += Math.min(12, near * 3);
        for (const o of ind) {
          const d = dist(o.c, b.c);
          if (d < 180) lv -= 22 * (1 - d / 180);
        }
      } else if (grp === "com") lv += Math.min(10, b.visits / Math.max(1, b.cap));
      lv += this.services.landValueOf(b);
      b.lv = Math.max(0, Math.min(100, lv));
    }
  }

  // ---------------------------------------------------------------- save / load

  serialize() {
    return {
      v: 2,
      seed: this.seed,
      net: this.net.toJSON(),
      buildings: this.buildings.list.map((b) => ({ ...b, access: null })),
      nextBuilding: this.buildings.nextId,
      zones: [...this.zones.allCells()].filter((c) => c.zone).map((c) => [Math.round(c.c.x * 10) / 10, Math.round(c.c.y * 10) / 10, c.zone]),
      zoneAges: this.zones.agesJSON(),
      people: this.people.toJSON(),
      money: this.money,
      milestone: this.milestone,
      tiles: [...this.tiles],
      tax: this.tax,
      time: this.time,
      playtime: this.playtime,
      cityName: this.cityName,
    };
  }

  static load(data: ReturnType<Game["serialize"]>): Game {
    if ((data as { v?: number }).v !== 2) throw new Error("Save from an older version");
    const g = new Game(data.seed);
    g.net.load(data.net);
    g.tiles = new Set(data.tiles);
    g.milestone = data.milestone;
    g.money = data.money;
    g.tax = { ...data.tax };
    g.time = data.time;
    g.traffic.time = data.time;
    g.playtime = data.playtime;
    g.cityName = data.cityName ?? g.cityName;
    const cs = g.net.rebuildAll();
    g.traffic.onNetworkChange(cs);
    if (data.zoneAges) g.zones.loadAges(data.zoneAges);
    g.zones.rebuildAll();
    g.zones.paintAt(data.zones.map(([x, y, z]) => ({ p: { x: x as number, y: y as number }, zone: z as ZoneId })));
    g.buildings.list = [];
    g.buildings.byId.clear();
    for (const d of data.buildings) {
      const b = d as Building;
      g.buildings.insert({ ...b, access: null });
      for (const c of g.lotCells(b)) c.lot = b.id;
    }
    g.buildings.nextId = data.nextBuilding;
    g.buildings.reattach();
    g.updateOutside();
    g.services.reset();
    g.people.load(data.people);
    g.computeDemand();
    return g;
  }

  segCost(id: number) {
    return segCost(this.net, id, this.world);
  }

  refundOf(segs: number[]) {
    return removalRefund(this.net, this.world, segs);
  }

  get bulldozeRate() {
    return BULLDOZE_REFUND;
  }

  /** Hourly net income (last full hour). */
  get netIncome(): number {
    return sum(this.budget.income) - sum(this.budget.expense);
  }
}

function emptyBudget(): Budget {
  return { income: { res: 0, com: 0, ind: 0, off: 0 }, expense: { roads: 0, services: 0, loans: 0 } };
}

function sum(o: Record<string, number>): number {
  let s = 0;
  for (const v of Object.values(o)) s += v;
  return s;
}

function pointInRect(p: V2, b: Building, pad: number): boolean {
  const u = { x: Math.cos(b.rot), y: Math.sin(b.rot) };
  const d = sub(p, b.c);
  const a = Math.abs(d.x * u.x + d.y * u.y), c = Math.abs(-d.x * u.y + d.y * u.x);
  return a < b.hw + pad && c < b.hd + pad;
}

const p0 = (p: V2) => p.x;
const p1 = (p: V2) => p.y;
