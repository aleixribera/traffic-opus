// The towns on the map (docs/design.md, "Towns"; the pure rules are in towns.ts). A town is founded on a spot and
// from then on looks after itself: it lays its own streets on a grid when it needs room for homes, zones the land
// along them (shops round the centre, homes beyond), and grows or shrinks toward a target number of households
// that moves once a day with how well the company supplied its needs. Homes and shops belong to the town whose
// streets they front (Building.town).

import { ROAD_TYPES, SIDEWALK, roadWidth } from "../config";
import { angleOf, cubicTangent, dist, dot, norm, right, sub, type V2 } from "../core/math";
import { cubicClosest, planRoad, snap, type Plan, type Snap } from "../roads/planner";
import { cityName } from "../world/gen";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP, ZONE_LOTS } from "./growables";
import type { Product } from "./industry";
import { DAY } from "./society";
import {
  BLOCK, HALLS, REDEV_SHARE, SEED_EDGES, TOWN_SIZES, demandPerDay, edgeKey, gridPt, growthPerDay, needsOf, nextEdge, redevPerDay, ringZone, sizeOf,
  supplyShare, townRadius, type GridEdge,
} from "./towns";
import { DEPTH, ZONE_RANK, type Cell, type ZoneId } from "./zones";

/** What founding a town costs. */
export const TOWN_COST = 20000;
/** Closest a new town may be to another town's centre (m). */
export const TOWN_SPACING = 1200;
/** A town needs one of the company's roads this close (m), or it starts cut off. */
export const TOWN_ROAD_REACH = 300;
/** Households a new town starts out wanting. */
const START_HOUSEHOLDS = 24;
/** How many times its needs a town's shops will buy in a day. */
export const MARKET = 3;
/** Households per shop the town keeps open. */
const HH_PER_SHOP = 25;
/** Cells this close (m) to a grid line a street may still be laid on stay empty, so the street never has to clear homes. */
const CORRIDOR = 10;
/** How far the town square keeps from the grid lines round it (m): half a street, its pavement and a margin. */
const SQUARE_INSET = roadWidth(ROAD_TYPES.street) / 2 + SIDEWALK.small + 1.5;
/** History kept per town: hourly people (ten days) and daily supply and deliveries (sixty days). */
export const HIST_HOURS = 240, HIST_DAYS = 60;

/** A town's day in its history. */
export interface TownDay {
  /** game day it records */
  day: number;
  pop: number;
  households: number;
  /** share of each need supplied */
  supply: Partial<Record<Product, number>>;
  /** loads delivered, per product */
  loads: Partial<Record<Product, number>>;
}

/** What a town remembers of its past, for its panel (saved). */
export interface TownHistory {
  /** people and households at the end of each game hour */
  pop: number[];
  households: number[];
  days: TownDay[];
}

export interface Town {
  id: number;
  name: string;
  c: V2;
  /** turn of its street grid */
  ang: number;
  /** grid edges it has laid, and ones it tried and couldn't */
  built: Set<string>;
  failed: Set<string>;
  /** households it is growing (or shrinking) toward */
  target: number;
  /** loads delivered to its shops today and over the last full day, per product */
  today: Partial<Record<Product, number>>;
  yesterday: Partial<Record<Product, number>>;
  /** share of each need supplied over the last full day */
  supply: Partial<Record<Product, number>>;
  /** households its target moved by at the last day's end */
  trend: number;
  founded: number;
  /** the biggest size it has reached: its zoning and its hall follow it (a town that shrinks keeps its buildings) */
  size: number;
  /** its town hall (building id; 0: none) */
  hall: number;
  /** the quadrant beside the centre cross that is its square: signs along the grid's two axes */
  sq: [number, number];
  hist: TownHistory;
  /** sim time it last started pulling down an old building for a denser one, and how many it has today */
  redevAt: number;
  redevToday: number;
  // counted every tick (not saved)
  pop: number;
  households: number;
  /** homes it has room for (built or building) */
  homes: number;
  shops: number;
  /** how far from the centre its land reaches (m) */
  reach: number;
}

type Counted = "pop" | "households" | "homes" | "shops" | "reach";
/** As saved (saves from before the town halls lack the newer fields: the town gets them on load). */
export type TownJSON = Omit<Town, "built" | "failed" | Counted | "size" | "hall" | "sq" | "hist" | "redevAt" | "redevToday"> & {
  built: string[]; failed: string[]; size?: number; hall?: number; sq?: [number, number]; hist?: TownHistory; redevToday?: number;
};

export class TownSystem {
  list: Town[] = [];
  byId = new Map<number, Town>();
  private nextId = 1;
  /** zone-map version the town zoning was last brought up to date with */
  private zonedAt = -1;
  /** each town's size when it was last zoned (zoning changes with size) */
  private zonedSize = new Map<number, number>();
  /** the towns as zone() last saw them, and a number for each new state (see Cell.want) */
  private wantKey = "";
  private wantEpoch = 0;

  constructor(private g: Game) {}

  // ------------------------------------------------------------------ queries

  /** The town whose land p is on (the nearest centre within its reach), or null. */
  townAt(p: V2): Town | null {
    let best: Town | null = null, bd = Infinity;
    for (const t of this.list) {
      const d = dist(p, t.c);
      if (d <= t.reach && d < bd) { bd = d; best = t; }
    }
    return best;
  }

  /**
   * Loads of a product a town will still buy today; -Infinity when it doesn't use it at its size. Its shops buy
   * up to MARKET times what it needs to grow, so more supply always sells (docs/design.md, pillar 5).
   */
  want(id: number, p: Product): number {
    const t = this.byId.get(id);
    if (!t || !needsOf(t.pop).includes(p)) return -Infinity;
    return demandPerDay(p, t.pop) * MARKET - (t.today[p] ?? 0);
  }

  /** Loads a town still needs today to grow (0 when its needs are met or it doesn't use the product). */
  short(id: number, p: Product): number {
    const t = this.byId.get(id);
    if (!t || !needsOf(t.pop).includes(p)) return 0;
    return Math.max(0, demandPerDay(p, t.pop) - (t.today[p] ?? 0));
  }

  /** A load reached one of the town's shops. */
  sold(id: number, p: Product, n: number) {
    const t = this.byId.get(id);
    if (t) t.today[p] = (t.today[p] ?? 0) + n;
  }

  sizeName(t: Town): string {
    return TOWN_SIZES[sizeOf(t.pop)].name;
  }

  // ------------------------------------------------------------------ founding

  /** Why a town can't be founded at p, or null. `free`: the game's own starting town (no cost). */
  foundBlock(p: V2, free = false): string | null {
    const w = this.g.world;
    if (!w.inBounds(p)) return "Outside the map";
    for (const [i, j] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = { x: p.x + i * BLOCK * 0.5, y: p.y + j * BLOCK * 0.5 };
      if (w.isWater(q)) return "Too close to water";
      if (w.isMountain(q)) return "Too close to the mountains";
    }
    for (const t of this.list) {
      const d = dist(p, t.c);
      if (d < TOWN_SPACING) return `Too close to ${t.name} (${(d / 1000).toFixed(1)} km; needs ${(TOWN_SPACING / 1000).toFixed(1)} km)`;
    }
    if (!free && this.list.length >= this.g.townSlots) return `You can run ${this.g.townSlots} towns for now: milestones add more`;
    if (!free && this.g.money < TOWN_COST) return "Not enough money";
    return null;
  }

  /** No road of the company's within reach: the town would start cut off. */
  cutOff(p: V2): boolean {
    const r = TOWN_ROAD_REACH;
    for (const id of this.g.net.segsNear(p.x - r, p.y - r, p.x + r, p.y + r)) {
      const s = this.g.net.segs.get(id)!;
      if (s.town) continue;
      const g = this.g.net.segGeom.get(id);
      if (g && g.center.pts.some((q) => dist(q, p) < r)) return false;
    }
    return true;
  }

  /** Found a town at p (its streets are laid at once). Returns the town, or why it can't be. */
  found(p: V2, o: { free?: boolean; name?: string; ang?: number } = {}): Town | string {
    const why = this.foundBlock(p, o.free);
    if (why) return why;
    const id = this.nextId++;
    const t: Town = {
      id, name: o.name ?? this.newName(), c: { ...p }, ang: o.ang ?? this.siteAngle(p), built: new Set(), failed: new Set(),
      target: START_HOUSEHOLDS, today: {}, yesterday: {}, supply: {}, trend: 0, founded: this.g.time,
      size: 0, hall: 0, sq: [1, 1], hist: { pop: [], households: [], days: [] }, redevAt: -Infinity, redevToday: 0,
      pop: 0, households: 0, homes: 0, shops: 0, reach: BLOCK,
    };
    this.list.push(t);
    this.byId.set(id, t);
    if (!o.free) this.g.charge(TOWN_COST);
    for (const e of SEED_EDGES) this.layEdge(t, e);
    t.sq = this.pickSquare(t);
    this.buildHall(t);
    return t;
  }

  private newName(): string {
    const rnd = this.g.rng;
    for (let k = 0; k < 20; k++) {
      const n = cityName(rnd);
      if (!this.list.some((t) => t.name === n)) return n;
    }
    return cityName(rnd) + " " + (this.list.length + 1);
  }

  /** The grid's turn: along the nearest road (so the town meets it square), else a random one. */
  private siteAngle(p: V2): number {
    const net = this.g.net;
    let best: { d: number; a: number } | null = null;
    const r = 400;
    for (const id of net.segsNear(p.x - r, p.y - r, p.x + r, p.y + r)) {
      const pts = net.segGeom.get(id)?.center.pts;
      if (!pts) continue;
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = dist(pts[i], p);
        if (!best || d < best.d) best = { d, a: Math.atan2(pts[i + 1].y - pts[i].y, pts[i + 1].x - pts[i].x) };
      }
    }
    if (best) return ((best.a % (Math.PI / 2)) + Math.PI / 2) % (Math.PI / 2);
    return this.g.rng() * (Math.PI / 2);
  }

  // ------------------------------------------------------------------ streets

  /** Plan one grid edge as a street, joined to whatever already stands at its ends. */
  planEdge(t: Town, e: GridEdge): Plan {
    const net = this.g.net;
    const a = gridPt(t.c, t.ang, e[0], e[1]), b = gridPt(t.c, t.ang, e[2], e[3]);
    const sn = (p: V2): Snap => {
      const s = snap(net, p, { mpp: 0.5, level: 0, type: "street" });
      return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
    };
    // (the town's own streets cost the company nothing)
    const world = { ...this.g.world, money: () => Infinity };
    return planRoad(net, world, { start: sn(a), end: sn(b), mode: "straight", type: "street" });
  }

  /** Lay a grid edge (free). False if it can't be built there; it is then never tried again. */
  layEdge(t: Town, e: GridEdge): boolean {
    const k = edgeKey(e);
    const plan = this.planEdge(t, e);
    if (plan.errors.length || !this.g.buildFree(plan, t.id)) { t.failed.add(k); return false; }
    t.built.add(k);
    // (the land reaches past its furthest grid node)
    t.reach = Math.max(t.reach, (Math.max(Math.hypot(e[0], e[1]), Math.hypot(e[2], e[3])) + 0.6) * BLOCK);
    return true;
  }

  private updateReach(t: Town) {
    let r = 0;
    for (const k of t.built) for (const n of k.split("|")) {
      const [i, j] = n.split(",").map(Number);
      r = Math.max(r, Math.hypot(i, j));
    }
    t.reach = (r + 0.6) * BLOCK;
  }

  /** The next street the town would lay (null: none left within its radius). */
  nextStreet(t: Town): GridEdge | null {
    // a little randomness per town in which way it spreads
    const jit = (k: string) => {
      let h = t.id * 2654435761;
      for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 2246822519);
      return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
    };
    // (never past halfway to the next town, so two towns' grids don't grow into each other)
    let room = Infinity;
    for (const o of this.list) if (o !== t) room = Math.min(room, dist(o.c, t.c) / 2 - BLOCK / 2);
    return nextEdge(t.built, t.failed, Math.min(townRadius(t.pop), room) / BLOCK, jit);
  }

  // ------------------------------------------------------------------ the town hall and its square

  /** Where p lies on a town's grid, in blocks along its two axes. */
  private gridOf(t: Town, p: V2): { a: number; b: number } {
    const dx = p.x - t.c.x, dy = p.y - t.c.y;
    const u = { x: Math.cos(t.ang), y: Math.sin(t.ang) };
    return { a: (dx * u.x + dy * u.y) / BLOCK, b: (-dx * u.y + dy * u.x) / BLOCK };
  }

  /** Whether p is on a town's square (the quadrant beside the centre cross kept for its hall). */
  onSquare(t: Town, p: V2): boolean {
    if (!t.hall) return false;
    const { a, b } = this.gridOf(t, p);
    return a * t.sq[0] > 0 && a * t.sq[0] < 1 && b * t.sq[1] > 0 && b * t.sq[1] < 1;
  }

  /** The quadrant for the square: open land (no water or mountain), with the fewest buildings standing on it. */
  private pickSquare(t: Town): [number, number] {
    const w = this.g.world;
    let best: [number, number] = [1, 1], bs = Infinity;
    for (const sq of [[1, 1], [-1, 1], [-1, -1], [1, -1]] as [number, number][]) {
      let score = 0;
      for (const [i, j] of [[0.5, 0.5], [0.15, 0.15], [0.85, 0.15], [0.15, 0.85], [0.85, 0.85]]) {
        const p = gridPt(t.c, t.ang, i * sq[0], j * sq[1]);
        if (w.isWater(p) || w.isMountain(p) || !w.inBounds(p)) score += 100;
      }
      const c = gridPt(t.c, t.ang, sq[0] * 0.5, sq[1] * 0.5);
      for (const b of this.g.buildings.list) if (b.zone && dist(b.c, c) < BLOCK * 0.5) score++;
      if (score < bs) { bs = score; best = sq; }
    }
    return best;
  }

  /** The square's lot: centre, the kerb of the main street in front of it, and its half size. */
  private squareLot(t: Town): { c: V2; front: V2; half: number } {
    const [si, sj] = t.sq;
    return {
      c: gridPt(t.c, t.ang, si * 0.5, sj * 0.5),
      front: gridPt(t.c, t.ang, si * 0.5, sj * (roadWidth(ROAD_TYPES.street) / 2 / BLOCK)),
      half: BLOCK / 2 - SQUARE_INSET,
    };
  }

  /**
   * Put up the hall for the town's size on its square (a building site first, the old hall replaced). Homes and
   * shops still standing on the square (a town from before the halls) make way, their households moving to other
   * homes.
   */
  buildHall(t: Town) {
    const kind = HALLS[Math.min(HALLS.length - 1, t.size)];
    const old = t.hall ? this.g.buildings.byId.get(t.hall) : undefined;
    if (old) {
      if (old.kind !== kind) this.g.rebuildHall(old, kind);
      return;
    }
    const L = this.squareLot(t);
    // the hall faces the main street the way its kerb runs (as any lot on that street would)
    let rot = t.ang, side: 1 | -1 = t.sq[1] > 0 ? 1 : -1, bd = 12;
    const net = this.g.net;
    for (const id of net.segsNear(L.front.x - 12, L.front.y - 12, L.front.x + 12, L.front.y + 12)) {
      const s = net.segs.get(id)!;
      const r = cubicClosest(s.c, L.front);
      if (r.d >= bd) continue;
      bd = r.d;
      const tan = norm(cubicTangent(s.c, r.t));
      rot = angleOf(tan);
      side = dot(sub(L.c, r.p), right(tan)) >= 0 ? 1 : -1;
    }
    const hall = this.g.addHall(t.id, kind, L.c, rot, side, L.front, L.half);
    t.hall = hall.id;
    this.zonedAt = -1;
  }

  /** The hall of a town, if it has one standing. */
  hallOf(t: Town): Building | undefined {
    return t.hall ? this.g.buildings.byId.get(t.hall) : undefined;
  }

  // ------------------------------------------------------------------ zoning

  /** Zone every town's land that isn't yet: by rings from the centre for its size, leaving room for future streets. */
  private zone() {
    const z = this.g.zones;
    const resized = this.list.some((t) => this.zonedSize.get(t.id) !== t.size);
    if (this.zonedAt === z.version && !resized) return;
    // (what a cell's town wants for it is kept on the cell until a town's reach, size, hall or square changes)
    const key = this.list.map((t) => `${t.id}:${t.reach}:${t.size}:${t.hall ? 1 : 0}:${t.sq}`).join();
    if (key !== this.wantKey) { this.wantKey = key; this.wantEpoch++; }
    const ep = this.wantEpoch;
    const paint = new Map<ZoneId, Cell[]>();
    z.eachCell((c) => {
      if (!c.ok || c.lot) return;
      let want = c.want;
      if (c.ze !== ep) {
        const t = this.townAt(c.c);
        want = t ? this.zoneFor(t, c, t.size) : undefined; // (undefined: no town's land)
        c.want = want;
        c.ze = ep;
      }
      if (want === undefined || want === c.zone) return;
      // (built-up land is rebuilt a lot at a time, by redevelopment; empty cells follow the town as it grows)
      let L = paint.get(want ?? ("" as ZoneId));
      if (!L) paint.set(want ?? ("" as ZoneId), (L = []));
      L.push(c);
    });
    for (const [zone, cells] of paint) this.g.zoneCells(cells, (zone || null) as ZoneId | null);
    this.zonedAt = z.version;
    for (const t of this.list) this.zonedSize.set(t.id, t.size);
  }

  /** The zone a free cell of town t gets at a size. */
  private zoneFor(t: Town, c: Cell, size: number): ZoneId | null {
    if (this.onSquare(t, c.c)) return null;
    const { a, b } = this.gridOf(t, c.c);
    // the street the cell fronts runs along one grid axis: keep clear of the cross streets still to come
    const along = Math.abs(Math.cos(c.rot - t.ang));
    if (along > 0.9) { if (Math.abs(a - Math.round(a)) * BLOCK < CORRIDOR) return null; }
    else if (along < 0.44) { if (Math.abs(b - Math.round(b)) * BLOCK < CORRIDOR) return null; }
    return ringZone(size, Math.hypot(a, b));
  }

  // ------------------------------------------------------------------ redevelopment

  /** Shops a town keeps open: about one for every HH_PER_SHOP households. */
  shopsWanted(t: Town): number {
    return t.households > 0 ? 1 + Math.floor(t.households / HH_PER_SHOP) : 0;
  }

  /** The denser zone an old building's land now has, or null when it is as dense as its ring wants. */
  redevZone(t: Town, b: Building): ZoneId | null {
    if (!b.zone) return null;
    const want = ringZone(t.size, dist(b.c, t.c) / BLOCK);
    if (want === b.zone) return null;
    const g0 = ZONE_GROUP[b.zone], g1 = ZONE_GROUP[want];
    if (g0 === g1) return ZONE_RANK[want] > ZONE_RANK[b.zone] ? want : null;
    // homes in a ring that is now shops make way only while the town wants more shops
    return g0 === "res" && t.shops < this.shopsWanted(t) ? want : null;
  }

  /**
   * Redevelopment (docs/design.md): the old buildings of a ring now zoned denser are pulled down and rebuilt, a lot
   * at a time, centre first, at a steady pace: a few a day, and never more than REDEV_SHARE of the town's homes
   * building at once. A small lot takes its neighbours along the street with it when the new building needs the
   * width. Only a town that lays its own streets redevelops, and only while it isn't shrinking.
   */
  private redevelop(t: Town, mine: Building[]) {
    if (!t.built.size || t.trend < 0 || t.size < 1) return;
    const perDay = redevPerDay(t.size, mine.length);
    if (t.redevToday >= perDay || this.g.time - t.redevAt < DAY / perDay / 2) return;
    let homes = 0, sites = 0;
    for (const b of mine) {
      if (ZONE_GROUP[b.zone!] === "res") homes++;
      if (b.redev && b.built < 1) sites++;
    }
    if (sites >= Math.max(1, Math.floor(homes * REDEV_SHARE))) return;
    const cands: { b: Building; z: ZoneId; d: number }[] = [];
    for (const b of mine) {
      if (b.built < 1 || b.abandoned || !b.lot) continue;
      const z = this.redevZone(t, b);
      if (z) cands.push({ b, z, d: dist(b.c, t.c) });
    }
    cands.sort((p, q) => p.d - q.d);
    for (const { b, z } of cands.slice(0, 40)) {
      const run = this.redevRun(t, b, z);
      if (!run) continue;
      t.redevAt = this.g.time;
      t.redevToday++;
      this.g.rebuildLots(t.id, run.ids, z, run.block, run.lo, run.hi);
      return;
    }
  }

  /** The stretch of a street's front a redevelopment takes: the building, and its neighbours if the new one needs the width. */
  private redevRun(t: Town, b: Building, z: ZoneId): { ids: number[]; block: string; lo: number; hi: number } | null {
    const blk = this.g.zones.blocks.get(b.lot!.block);
    if (!blk) return null;
    const temps = ZONE_LOTS[z];
    const target = temps[0].w, minW = Math.min(target, temps[1]?.w ?? target);
    let lo = b.lot!.col0, hi = lo + b.lot!.w;
    const ids = [b.id];
    // a neighbour joins if it is waiting for the same zone; empty land beside joins too
    const take = (col: number): number | null => {
      if (col < 0 || col >= blk.cols) return null;
      const c = blk.cells[col * DEPTH];
      if (!c.ok) return null;
      if (!c.lot) return 1;
      const o = this.g.buildings.byId.get(c.lot);
      if (!o || ids.includes(o.id) || o.town !== t.id || !o.lot || o.lot.block !== blk.key || o.built < 1 || o.abandoned) return null;
      if (this.redevZone(t, o) !== z) return null;
      if (o.lot.col0 !== col && o.lot.col0 + o.lot.w - 1 !== col) return null;
      ids.push(o.id);
      return o.lot.w;
    };
    let grew = true;
    while (hi - lo < target && grew) {
      grew = false;
      const r = take(hi);
      if (r !== null) { hi += r; grew = true; }
      if (hi - lo >= target) break;
      const l = take(lo - 1);
      if (l !== null) { lo -= l; grew = true; }
    }
    return hi - lo >= minW ? { ids, block: blk.key, lo, hi } : null;
  }

  // ------------------------------------------------------------------ the clock

  /** each town's homes and shops, from the last census */
  private mine = new Map<number, Building[]>();

  /** Count each town's people, homes and shops. */
  census() {
    for (const t of this.list) { t.pop = 0; t.households = 0; t.homes = 0; t.shops = 0; }
    this.mine.clear();
    const P = this.g.people;
    for (const b of this.g.buildings.list) {
      if (!b.zone || b.town === undefined || b.abandoned) continue;
      const t = this.byId.get(b.town);
      if (!t) continue;
      let L = this.mine.get(t.id);
      if (!L) this.mine.set(t.id, (L = []));
      L.push(b);
      if (ZONE_GROUP[b.zone] === "com") { t.shops++; continue; }
      t.homes += b.cap;
      for (const hh of P.hhAt.get(b.id) ?? []) { t.households++; t.pop += hh.members.length; }
    }
  }

  /** A town's homes and shops (as of the last census). */
  buildingsOf(t: Town): Building[] {
    return this.mine.get(t.id) ?? [];
  }

  /** Every 1/8 game hour: streets, zoning, new homes and shops, redevelopment, households moving in and out. */
  tick() {
    this.census();
    // a town that has grown into a new size: its moment (a banner), its new hall, and denser zoning
    for (const t of this.list) {
      const s = sizeOf(t.pop);
      if (s <= t.size) continue;
      t.size = s;
      if (t.hall) this.buildHall(t);
      this.g.townGrew(t, s);
    }
    this.zone();
    for (const t of this.list) {
      // more homes wanted than there is land for: lay the next street
      const short = t.target - t.homes;
      if (short > 0 && this.g.freeLots(t.id, "res") * 1.5 < short + 2) {
        // (one street a tick once it is a town: a street in a big town re-zones a wide area, so they are spread out)
        for (let k = 0, n = t.size >= 2 ? 1 : 4; k < n; k++) {
          const e = this.nextStreet(t);
          if (!e || this.layEdge(t, e)) break;
        }
      }
      // homes, a few at a time
      for (let n = Math.min(3, Math.ceil(short / 2)); n > 0; n--) if (!this.g.growIn(t.id, "res")) break;
      // about one shop for every HH_PER_SHOP households
      if (t.shops < this.shopsWanted(t)) this.g.growIn(t.id, "com");
      // old buildings in the denser rings make way for new ones
      this.redevelop(t, this.buildingsOf(t));
      // households move in while it is below its target, and out while it is above
      const gap = t.target - t.households;
      if (gap >= 1) this.g.moveInto(t.id, Math.min(3, Math.floor(gap)));
      else if (gap <= -1 && this.g.rng() < 0.3) this.g.moveOutOf(t.id);
    }
  }

  /** Every game hour: each town's people go into its history. */
  hourly() {
    for (const t of this.list) {
      const H = t.hist;
      H.pop.push(t.pop);
      H.households.push(t.households);
      if (H.pop.length > HIST_HOURS) { H.pop.splice(0, H.pop.length - HIST_HOURS); H.households.splice(0, H.households.length - HIST_HOURS); }
    }
  }

  /** A day is over: its deliveries become yesterday's supply, and the towns grow (or shrink) by it. */
  daily() {
    this.census();
    for (const t of this.list) {
      t.yesterday = t.today;
      t.today = {};
      t.supply = supplyShare(t.yesterday, t.pop);
      const d = growthPerDay(t.supply, t.pop);
      // (the target never runs far ahead of the town: a dry spell isn't banked as growth for later)
      const before = t.target;
      t.target = Math.max(0, Math.min(t.target + d, Math.max(t.households, START_HOUSEHOLDS) * 1.4 + 6));
      t.trend = t.target - before;
      t.redevToday = 0;
      t.hist.days.push({ day: this.g.day - 1, pop: t.pop, households: t.households, supply: { ...t.supply }, loads: { ...t.yesterday } });
      if (t.hist.days.length > HIST_DAYS) t.hist.days.shift();
    }
  }

  // ------------------------------------------------------------------ save / load

  toJSON(): { towns: TownJSON[]; nextId: number } {
    return {
      towns: this.list.map((t) => ({
        id: t.id, name: t.name, c: t.c, ang: t.ang, built: [...t.built], failed: [...t.failed], target: t.target,
        today: t.today, yesterday: t.yesterday, supply: t.supply, trend: t.trend, founded: t.founded,
        size: t.size, hall: t.hall, sq: t.sq, hist: t.hist, redevToday: t.redevToday,
      })),
      nextId: this.nextId,
    };
  }

  load(d: ReturnType<TownSystem["toJSON"]>) {
    this.list = [];
    this.byId.clear();
    for (const x of d.towns) {
      const t: Town = {
        ...x, built: new Set(x.built), failed: new Set(x.failed), size: x.size ?? 0, hall: x.hall ?? 0, sq: x.sq ?? [1, 1],
        hist: x.hist ?? { pop: [], households: [], days: [] }, redevAt: -Infinity, redevToday: x.redevToday ?? 0,
        pop: 0, households: 0, homes: 0, shops: 0, reach: BLOCK,
      };
      this.updateReach(t);
      this.list.push(t);
      this.byId.set(t.id, t);
    }
    this.nextId = d.nextId;
    this.zonedAt = -1;
    this.census();
    // towns from before the halls: the size they have reached, and a hall (standing already) on a square of their own
    for (const t of this.list) {
      if (d.towns.find((x) => x.id === t.id)?.size === undefined) t.size = sizeOf(t.pop);
      if (t.hall && !this.g.buildings.byId.has(t.hall)) t.hall = 0;
      if (t.hall || !t.built.size) continue;
      t.sq = this.pickSquare(t);
      this.buildHall(t);
      const h = this.hallOf(t);
      if (h) h.built = 1;
    }
    this.census();
  }
}
