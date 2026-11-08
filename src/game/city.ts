import {
  BUILDING_TYPES, BULLDOZE_REFUND, START_TILES, TILE, ROAD_TYPES, SIGNAL_COST, SIM, isHighway, roadWidth, type RoadTypeId,
} from "../config";
import { add, dist, rectCorners, rectDistance, scale, sub, type V2 } from "../core/math";
import { mulberry32 } from "../core/noise";
import { RoadNetwork, type ChangeSet, type Op, type SignalPlan } from "../roads/network";
import {
  applyTrim, chainPoints, planRoad, commitRoundabout, commitStrokes, removalRefund, segCost, upgradeCost, type BuildWorld, type LanePlan, type Plan, type PlanError,
} from "../roads/planner";
import { Traffic, type Trip, type Vehicle } from "../sim/traffic";
import { Terrain } from "../world/terrain";
import { Buildings, obbOverlap, type Building, type BuildingMove } from "./buildings";
import { LEVEL_LV, ZONE_GROUP, ZONE_LOTS, capacity, modelFit, type LotTemplate } from "./growables";
import { Progress, tilePrice, type Feature, type Milestone, type ProgressView } from "./progression";
import { DAY, HOUR, Society } from "./society";
import { PLACED, SHORE_REACH, type PlacedKind } from "./placed";
import { BUILD_TIME, Industry, MIN_DEPOSIT, PLANTS, isPlantKind } from "./industry";
import { TownSystem } from "./settlements";
import { BLOCK, gridPt } from "./towns";
import { F } from "../world/gen";
import { Transit } from "./transit";
import { Utilities } from "./utilities";
import type { PlaceOpts, Placement } from "./buildings";
import { CELL, DEPTH, ZoneMap, type Block, type Cell, type ZoneGroup, type ZoneId } from "./zones";

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
  | { t: "milestone"; m: Milestone }
  | { t: "money" }
  | { t: "tiles" }
  | { t: "toast"; msg: string };

/** The company's books for an hour. Income comes only from loads delivered to towns (and bus fares). */
export interface Budget {
  income: Record<"sales" | "transit", number>;
  expense: Record<"roads" | "wages" | "upkeep" | "fuel" | "transit" | "loans", number>;
}

/** Save format: 4 = the industrial company (plants, towns that grow themselves, no player zoning); 5 = tier 2,
 * building sites, company power and the milestone ladder. */
export const SAVE_V = 5;

/** Money a new company starts with: a farm, a food plant and some road, with a little to spare. */
export const START_MONEY = 80000;

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
  towns: TownSystem;
  money = 0;
  tiles = new Set<string>();
  time = 0;
  playtime = 0;
  speed = 1;
  paused = false;
  readonly dt = SIM.dt;
  /** milestones reached and the tallies they are measured on */
  progress = new Progress();
  cityName = "Larkfield";
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
    this.rng = mulberry32(seed * 31 + 5);
    this.terrain = new Terrain(seed);
    this.buildings = new Buildings(this.net);
    this.traffic = new Traffic(this.net, {
      arrive: (v, now) => this.onArrive(v, now),
      fail: (trip, reason) => this.onFail(trip, reason),
      busAt: (v) => this.transit.busAt(v),
    });
    for (const [i, j] of START_TILES) this.tiles.add(`${i},${j}`);
    this.money = START_MONEY;
    const t = this.terrain;
    // (towns grow on any land: only the company's own buildings need owned tiles)
    // (and never inside the fence of one of the company's sites)
    this.zones = new ZoneMap(this.net, { isWater: (p) => t.isWater(p), isMountain: (p) => t.isMountain(p), owned: () => true, taken: (p) => this.inSite(p) });
    this.people = new Society(this);
    this.transit = new Transit(this);
    this.utilities = new Utilities(this);
    this.towns = new TownSystem(this);
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
      sold: (town, p, n) => { this.towns.sold(town, p, n); this.progress.onSold(p, n); },
      request: (sp) => this.traffic.request(sp),
      trips: () => this.trips(),
      earn: (v) => { this.money += v; this.budgetNow.income.sales += v; this.progress.onEarned(v); },
      spend: (v, what) => { this.money -= v; this.budgetNow.expense[what] += v; },
      bays: () => this.progress.unlocked.bays,
      load: () => this.progress.unlocked.load,
      power: (b) => this.utilities.supplyOf(b),
      wanted: (b) => this.utilities.wanted(b),
      made: (p, n) => this.progress.onMade(p, n),
      grew: (b, level) => { this.toast(`${BUILDING_TYPES[b.kind].name} grew to level ${level}: more output, jobs and trucks`); this.emit({ t: "buildings" }); },
    });
    this.world = {
      isWater: (p) => t.isWater(p),
      isMountain: (p) => t.isMountain(p),
      inBounds: (p) => t.inBounds(p, 2),
      unlocked: () => true, // roads can go anywhere (CS2: building needs owned land, roads don't)
      buildingsHit: (pts, hw) => this.buildings.hit(pts, hw).filter((id) => !this.buildings.byId.get(id)?.zone),
      money: () => this.money,
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
    const clear = (p: V2) => this.towns.foundBlock(p, true) === null;
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
    const town = this.towns.found(site, { free: true, ang });
    if (typeof town === "string") return;
    this.cityName = town.name;
    town.target = 12; // (enough hands to crew a first farm and food plant between them)
    // the road out of town, from the end of its main street
    const a = gridPt(town.c, ang, 1, 0), b = gridPt(town.c, ang, 1 + 320 / BLOCK, 0);
    const plan = planRoad(this.net, this.world, { start: { p: a, h: 0, guides: [], node: this.nodeAt(a) }, end: { p: b, h: 0, guides: [] }, mode: "straight", type: "street" });
    if (!plan.errors.length) this.buildFree(plan);
    // it has stood a while: its first homes and its shop are up and lived in
    for (let k = 0; k < 10; k++) {
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

  // ---------------------------------------------------------------- tiles

  tileOf(p: V2): [number, number] {
    return [Math.floor(p.x / TILE + 0.5), Math.floor(p.y / TILE + 0.5)];
  }

  unlocked(p: V2): boolean {
    const [i, j] = this.tileOf(p);
    return this.tiles.has(`${i},${j}`);
  }

  get tileSlotsLeft(): number {
    return this.progress.unlocked.tiles - this.tiles.size;
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
    return this.net.segsNear(x0, y0, x0 + TILE, y0 + TILE).size > 0;
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

  get roadsUnlocked(): Set<RoadTypeId> { return this.progress.unlocked.roads; }
  featureUnlocked(f: Feature): boolean { return this.progress.unlocked.features.has(f); }
  placedUnlocked(k: PlacedKind): boolean { return this.progress.unlocked.buildings.has(k); }
  /** Towns the company may run. */
  get townSlots(): number { return this.progress.unlocked.towns; }
  /** Every milestone reached (for tools and tests that need everything unlocked; no grants). */
  unlockAll() { this.progress.completeAll(); }

  /** What the milestones are measured on, now. */
  progressView(): ProgressView {
    return this.progress.view(this.towns.list.map((t) => ({ pop: t.pop, supply: t.supply })), this.utilities.powered);
  }

  /** Reach any open milestone whose goal is met: pay its grant and say so. */
  checkMilestones() {
    for (const m of this.progress.check(this.progressView())) {
      this.money += m.unlocks.grant ?? 0;
      this.emit({ t: "milestone", m });
      this.emit({ t: "money" });
    }
  }

  toast(msg: string) {
    this.emit({ t: "toast", msg });
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
      if (plan) { this.net.setSignal(id, plan); lit++; }
    }
    return lit;
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
      else plan.phases.push({ arms: [a.seg], dur: 12 });
    }
    return plan;
  }

  private afterRoads(cs: ChangeSet) {
    for (const b of this.buildings.reattach()) this.toast(`${BUILDING_TYPES[b.kind].name} connected: its trucks can start`);
    this.transit.afterRoads();
    this.traffic.onNetworkChange(cs);
    this.zones.onNetworkChange(cs);
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

  /** Zoned buildings a new lane's outline (a closed polygon) would clear. */
  lotsUnderOutline(outline: V2[]): Building[] {
    if (outline.length < 3) return [];
    const ids = this.buildings.hit([...outline, outline[0]], 1);
    return ids.map((id) => this.buildings.byId.get(id)).filter((b): b is Building => !!b?.zone);
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
          this.midRebuilds.push(cs);
          this.traffic.onNetworkChange(cs);
          this.zones.onNetworkChange(cs);
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
            this.zones.onNetworkChange(cs);
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

  /**
   * Build a plan for free and with no undo entry: a town's own street (town = its id: the new pieces are tagged as
   * the town's) or the start's road. Undo entries that the edit invalidated (they touch a road or junction it
   * changed) are dropped, with everything older than them.
   */
  buildFree(plan: Plan, town?: number): boolean {
    if (plan.errors.length) return false;
    const ops = this.applyRoads(() => {
      for (const st of plan.strokes) {
        const laid = commitStrokes(this.net, [st]);
        // the streets it laid are the town's (the pieces of a road it split keep whose road it was)
        if (town) for (const id of laid) { const sg = this.net.segs.get(id); if (sg) sg.town = town; }
        if (plan.strokes.length > 1) {
          const cs = this.net.rebuild();
          this.midRebuilds.push(cs);
          this.traffic.onNetworkChange(cs);
          this.zones.onNetworkChange(cs);
          this.emit({ t: "roads", cs });
        }
      }
    });
    if (!ops.length) return false;
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
    this.clearRoadsOverLots();
    this.emit({ t: "buildings" });
    return true;
  }

  /** Add lane: a turn pocket set (or taken away) before a junction, or a motorway slip lane lengthened. */
  addLane(lp: LanePlan): boolean {
    if (lp.errors.length) return false;
    if (lp.road) return this.build(lp.road);
    const pk = lp.pocket;
    if (!pk || !this.net.segs.has(pk.seg)) return false;
    const ops = this.applyRoads(() => this.net.setPocket(pk.seg, pk.end, pk.to));
    if (!ops.length) return false;
    const gone = this.clearRoadsOverLots();
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
    // lights the player takes away stay away (they aren't put back when the junction changes)
    if (!plan && n.signal) n.noAutoLights = true;
    const cost = !n.signal && plan ? SIGNAL_COST : 0;
    if (cost > this.money) return false;
    const ops = this.applyRoads(() => this.net.setSignal(nodeId, plan));
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
      // avenues) they get a short phase of their own first; it is skipped when nobody is waiting to turn left
      const big = group.length === 2 && group.every((x) => {
        const T = ROAD_TYPES[this.net.segs.get(x)!.type];
        return T.rank >= 2 && !isHighway(T);
      });
      if (big && g.conns.some((c) => group.includes(c.armIn) && c.turn === "L")) phases.push({ arms: [...group], dur: 6, left: true });
      phases.push({ arms: group, dur: 12 });
    }
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
  placedPlan(kind: PlacedKind, p: V2, opts?: PlaceOpts): (Placement & { cost: number; deposit?: { name: string; share: number } }) | null {
    const world = { ...this.world, unlocked: (q: V2) => this.unlocked(q) };
    const pl = this.buildings.placement(kind, p, world, (o) => !!o.zone, opts);
    if (!pl) return null;
    const D = PLACED[kind];
    const cost = D.cost;
    if (pl.ok && !this.placedUnlocked(kind)) return { ...pl, ok: false, reason: "Not unlocked yet", cost };
    if (pl.ok && D.unique && this.buildings.list.some((b) => b.kind === kind)) return { ...pl, ok: false, reason: "Only one per city", cost };
    if (pl.ok && D.shore && !this.nearWater(pl.c, pl.rot, BUILDING_TYPES[kind].w / 2, BUILDING_TYPES[kind].d / 2)) return { ...pl, ok: false, reason: "Has to be on a shore", cost };
    const dep = isPlantKind(kind) ? PLANTS[kind].deposit : undefined;
    let deposit: { name: string; share: number } | undefined;
    if (dep) {
      const T = BUILDING_TYPES[kind];
      deposit = { name: dep.name, share: this.industry.depositShare(dep.field, pl.c, pl.rot, T.w / 2, T.d / 2) };
      if (pl.ok && deposit.share < MIN_DEPOSIT) return { ...pl, ok: false, reason: `Needs ${dep.name.toLowerCase()}: ${Math.round(deposit.share * 100)}% here, ${Math.round(MIN_DEPOSIT * 100)}% at least`, cost, deposit };
    }
    if (pl.ok && this.money < cost) return { ...pl, ok: false, reason: "Not enough money", cost, deposit };
    return { ...pl, cost, deposit };
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
    const b = this.buildings.add(kind, pl, this.time);
    b.placed = true;
    if (isPlantKind(kind)) this.industry.init(b, kind, pl.deposit ? Math.min(1, pl.deposit.share / 0.8) : 1);
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.candVersion = -1;
    this.money -= pl.cost;
    this.pushUndo({ label: "place", ops: [], money: pl.cost, added: [b], removed });
    this.emit({ t: "money" });
    this.emit({ t: "buildings" });
    return b;
  }

  private removeBuildingRaw(b: Building) {
    if (!this.buildings.byId.has(b.id)) return;
    this.buildings.remove(b.id);
    this.people.onBuildingRemoved(b.id);
    for (const c of this.lotCells(b)) if (c.lot === b.id) c.lot = 0;
    this.shopCache = null;
    this.candVersion = -1;
  }

  private restoreBuilding(b: Building) {
    if (this.buildings.byId.has(b.id)) return;
    this.buildings.insert(b);
    for (const c of this.lotCells(b)) c.lot = b.id;
    this.buildings.reattach();
    this.shopCache = null;
    this.candVersion = -1;
  }

  /** Is p inside the fence of one of the company's sites? */
  inSite(p: V2): boolean {
    for (const b of this.buildings.list) if (b.placed && rectDistance(p, b.c, b.hw, b.hd, b.rot) < 0.5) return true;
    return false;
  }

  /** Zone cells under a building's lot. */
  lotCells(b: Building): Cell[] {
    if (!b.zone && !b.placed) return [];
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
      for (const c of this.zones.allCells()) {
        if (c.row !== 0 || !c.ok || !c.zone || c.lot) continue;
        const t = this.cellTown(c);
        if (t === null) continue;
        const k = `${t}:${ZONE_GROUP[c.zone]}`;
        let L = this.candCache.get(k);
        if (!L) this.candCache.set(k, (L = []));
        L.push(c);
      }
      this.candVersion = this.zones.version;
    }
    return this.candCache.get(key) ?? [];
  }

  /** inside tick(): what towns grow is announced once, at its end (a rebuild of every building per new home is slow) */
  private ticking = false;
  private grew = false;

  /** A town grows a home or a shop on its zoned land. */
  growIn(town: number, group: ZoneGroup): Building | null {
    const b = this.grow(this.candidates(`${town}:${group}`));
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

  /** Try to grow a building on one of these candidate cells. */
  private grow(cands: Cell[]): Building | null {
    if (!cands.length) return null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const c = cands[(this.rng() * cands.length) | 0];
      if (c.lot || !c.ok || !c.zone) continue;
      const b = c.block;
      const seg = this.net.segs.get(b.seg);
      if (!seg) continue;
      const temps = ZONE_LOTS[c.zone];
      // (some variety between the two main sizes; the small ones only where nothing bigger fits)
      const order = this.rng() < 0.35 && temps.length > 1 ? [temps[1], temps[0], ...temps.slice(2)] : temps;
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
          return this.placeLot(b, best.x0, tt, this.lotDepth(b, best.x0, tt, c.zone), c.zone);
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
    const seg = this.net.segs.get(b.seg);
    const bl: Building = {
      id: this.buildings.nextId++, town: seg?.town ?? this.towns.townAt(c)?.id, kind: t.model, c, rot, hw: (t.w * CELL) / 2, hd: (depth * CELL) / 2, front,
      access: { seg: b.seg, s: sMid, p: front }, side: b.side, zone, lot: { block: b.key, col0, w: t.w, d: depth },
      // deeper lots hold a bit more (the back is yard, parking or storage)
      level: 1, cap: capacity(zone, t.w, t.d + (depth - t.d) * 0.5, 1, tall), fit: modelFit(t, M.w, M.d), tall, built: 0, abandoned: 0, lv: 0, upT: 0, badT: 0,
      problem: null, stock: ZONE_GROUP[zone] === "com" ? 2 : 0, prodT: 0, visits: 0, born: this.time,
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
  /** The connected road network a seg belongs to (null: no such seg). */
  compOf(seg: number): number | null {
    if (this.compVersion !== this.net.version) this.rebuildComponents();
    const s = this.net.segs.get(seg);
    return s ? this.comp.get(s.a) ?? null : null;
  }

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
      if (this.dayN >= 0) { this.towns.daily(); this.checkMilestones(); this.progress.daily(); }
      this.dayN = day;
      for (const b of this.shops) { b.custDay = b.custToday ?? 0; b.custToday = 0; }
    }
    let changed = false;
    for (const b of this.buildings.list) {
      // (a building site goes up only once every material it waits for has been trucked in)
      if (b.built < 1 && !b.plant?.site) {
        b.built = Math.min(1, b.built + span / BUILD_TIME);
        if (b.built >= 1) changed = true;
      }
    }
    this.ticking = true;
    this.grew = false;
    try { this.towns.tick(); } finally { this.ticking = false; }
    if (this.grew) changed = true;
    this.industry.tick(span);
    this.utilities.tick(span);
    this.transit.tick();
    for (const b of [...this.buildings.list]) this.stepBuilding(b, span);
    this.checkMilestones();
    if (changed) this.emit({ t: "buildings" });
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
      if (grp === "com" && b.stock <= 0) { health *= 0.5; problem = "Out of food"; }
      if (grp === "com") {
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

  private onArrive(v: Vehicle, now: number) {
    const trip = v.trip;
    if (trip.bus) { this.transit.onGone(trip.bus, { x: v.x, y: v.y }); return; }
    this.traffic.recordTrip(trip.freeFlow, now - trip.startT);
    if (trip.haul) { this.industry.onArrive(v); return; }
    if (trip.kind === "cargo" || trip.kind === "empty") return;
    this.people.onArrive(v);
  }

  private onFail(trip: Trip, reason: string) {
    if (trip.bus) { this.transit.onGone(trip.bus); return; }
    this.failedTrips++;
    if (trip.haul) {
      this.industry.onFail(trip);
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
    if (this.history.length > 72) this.history.shift();
    this.landValue();
    for (const [id, t] of this.noRouteAt) if (this.time - t > HOUR * 3) this.noRouteAt.delete(id);
    this.emit({ t: "money" });
  }

  /** Land value from road access and nearby shops, minus the company's dirty plants nearby. */
  private landValue() {
    const list = this.buildings.list.filter((b) => b.zone && !b.abandoned);
    const ind = this.buildings.list.filter((b) => b.plant && !b.plant.site && BUILDING_TYPES[b.kind].pollution > 0);
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
          // (from the fence of a site, not its middle)
          const r = BUILDING_TYPES[o.kind].pollution * 1.6, d = rectDistance(b.c, o.c, o.hw, o.hd, o.rot);
          if (d < r) lv -= 22 * (1 - d / r);
        }
      } else if (grp === "com") lv += Math.min(10, b.visits / Math.max(1, b.cap * 4));
      lv += this.utilities.landValueOf(b);
      b.lv = Math.max(0, Math.min(100, lv));
    }
  }

  // ---------------------------------------------------------------- save / load

  serialize() {
    return {
      v: SAVE_V,
      seed: this.seed,
      net: this.net.toJSON(),
      // (trucks on the road aren't saved: a load out on delivery goes back to its plant's yard)
      buildings: this.buildings.list.map((b) => ({ ...b, access: null, plant: b.plant && this.plantSaved(b) })),
      nextBuilding: this.buildings.nextId,
      zones: [...this.zones.allCells()].filter((c) => c.zone).map((c) => [Math.round(c.c.x * 10) / 10, Math.round(c.c.y * 10) / 10, c.zone]),
      zoneAges: this.zones.agesJSON(),
      people: this.people.toJSON(),
      transit: this.transit.toJSON(),
      money: this.money,
      progress: this.progress.toJSON(),
      tiles: [...this.tiles],
      towns: this.towns.toJSON(),
      budget: this.budget as Budget | undefined,
      time: this.time,
      playtime: this.playtime,
      cityName: this.cityName,
    };
  }

  static load(data: ReturnType<Game["serialize"]>): Game {
    if ((data as { v?: number }).v !== SAVE_V) throw new Error("Save from an older version of the game: it can't be loaded");
    const g = new Game(data.seed);
    g.net.load(data.net);
    g.tiles = new Set(data.tiles);
    g.progress.load(data.progress);
    g.money = data.money;
    if (data.budget) {
      const e = emptyBudget();
      g.budget = { income: { ...e.income, ...data.budget.income }, expense: { ...e.expense, ...data.budget.expense } };
      g.budgetLog = [g.budget];
    }
    g.time = data.time;
    g.dayN = Math.floor(g.time / DAY); // (a loaded city carries on with the day it was saved in)
    g.traffic.time = data.time;
    g.playtime = data.playtime;
    g.cityName = data.cityName ?? g.cityName;
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
    g.buildings.reattach();
    // (saves from before shops kept daily books: a day's custom from how busy they were)
    for (const b of g.shops) if (b.custDay === undefined) b.custDay = Math.round(b.visits * 4);
    g.people.load(data.people);
    g.transit.load(data.transit);
    g.towns.load(data.towns);
    g.utilities.tick(0);
    return g;
  }

  /** A plant's state as saved: loads its trucks are carrying count as still in its yard. */
  private plantSaved(b: Building) {
    const P = structuredClone(b.plant!);
    for (const t of this.trips()) {
      const r = t.haul;
      if (r && !r.done && r.leg === "out" && r.plant === b.id) P.out[r.product] = (P.out[r.product] ?? 0) + r.n;
    }
    return P;
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

function pointInRect(p: V2, b: Building, pad: number): boolean {
  const u = { x: Math.cos(b.rot), y: Math.sin(b.rot) };
  const d = sub(p, b.c);
  const a = Math.abs(d.x * u.x + d.y * u.y), c = Math.abs(-d.x * u.y + d.y * u.x);
  return a < b.hw + pad && c < b.hd + pad;
}
