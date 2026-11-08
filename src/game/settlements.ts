// The towns on the map (docs/design.md, "Towns"; the pure rules are in towns.ts). A town is founded on a spot and
// from then on looks after itself: it lays its own streets on a grid when it needs room for homes, zones the land
// along them (shops round the centre, homes beyond), and grows or shrinks toward a target number of households
// that moves once a day with how well the company supplied its needs. Homes and shops belong to the town whose
// streets they front (Building.town).

import { BUILDING_TYPES, ROAD_TYPES, SIDEWALK, ZONE_SETBACK, roadWidth, type BuildingKind } from "../config";
import { angleOf, cubicTangent, dist, dot, norm, right, sub, type V2 } from "../core/math";
import { cubicClosest, planRoad, snap, type Plan, type Snap } from "../roads/planner";
import { mulberry32 } from "../core/noise";
import { F } from "../world/gen";
import { townName } from "./names";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP, ZONE_LOTS } from "./growables";
import type { Product } from "./industry";
import { townBoost } from "./megaprojects";
import { PARK_SMOKE } from "./parks";
import { DAY } from "./society";
import {
  BLOCK, CAR_SCRAP, HALLS, HIGH_STREET, NOISE, NUISANCE_HOMES, NUISANCE_SHOPS, NUISANCE_STREET, REDEV_SHARE, SEED_EDGES, TOWN_SIZES, buys, comfortOf,
  demandPerDay, edgeKey, gridPt, growthPerDay, highLine, highStreetReach, motoring, needsOf, nextEdge, nuisanceAt, redevPerDay, ringZone, sizeOf,
  smokeReach, supplyShare, townRadius, type GridEdge, type Nuisance,
} from "./towns";
import { DEPTH, ZONE_RANK, type Cell, type ZoneId } from "./zones";

/** Closest a town may be to another town's centre (m). */
export const TOWN_SPACING = 1200;
/**
 * Where new towns spring up (docs/design.md "Towns": they appear by themselves as the company reaches milestones,
 * never founded by the player): the first SPAWN_FIRST from the start town, each next one SPAWN_GROWTH times further
 * out, up to SPAWN_MAX, and never nearer another town than SPAWN_APART of that distance.
 */
export const SPAWN_FIRST = 1900, SPAWN_GROWTH = 1.55, SPAWN_MAX = 16000, SPAWN_APART = 0.55;
/** A new town keeps this clear of the company's roads (m): it starts cut off, and joining it up is the player's job. */
export const SPAWN_ROAD_CLEAR = 450;
/** How far the k-th town to spring up is from the start town, about (m). */
export const spawnDistance = (k: number): number => Math.min(SPAWN_MAX, SPAWN_FIRST * Math.pow(SPAWN_GROWTH, Math.max(0, k)));
/** Fields a town wants within reach to be worth serving (soil and forest first: its own first needs). */
const SPAWN_FIELDS = [F.fert, F.forest, F.ore, F.coal, F.lime, F.sand, F.oil, F.copper];

/** A town that has just sprung up: where it is against the nearest town that was there before it. */
export interface Spawned {
  town: Town;
  /** the nearest town before it, how far (m) and which way (a compass point, "north-east") */
  from: Town | null;
  dist: number;
  dir: string;
}

/** Has a town ever had a load delivered (a town that sprang up keeps its marker till then)? */
export function served(t: Town): boolean {
  return Object.keys(t.today).length > 0 || Object.keys(t.yesterday).length > 0 || t.hist.days.some((d) => Object.keys(d.loads).length > 0);
}

/** A compass point, in words, from a to b (north is -y on the map). */
export function compassWords(a: V2, b: V2): string {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  const names = ["east", "south-east", "south", "south-west", "west", "north-west", "north", "north-east"];
  return names[((Math.round(deg / 45) % 8) + 8) % 8];
}
/** Households a new town starts out wanting. */
const START_HOUSEHOLDS = 24;
/** Hours of its own deliveries a town needs before its supply rolls on them, and the hours that stand for a full day. */
const ROLL_MIN = 4, ROLL_FULL = 8;
/** How many times its needs a town's shops will buy in a day. */
export const MARKET = 3;
/** Households per shop the town keeps open. */
const HH_PER_SHOP = 25;
/** Cells this close (m) to a grid line a street may still be laid on stay empty, so the street never has to clear homes. */
const CORRIDOR = 10;
/**
 * How far the town square keeps from the grid lines round it (m): half a street, its pavement and a margin, and at
 * least the setback homes keep, so the streets round it can be upgraded as theirs can.
 */
export const SQUARE_INSET = Math.max(roadWidth(ROAD_TYPES.street) / 2 + SIDEWALK.small, ZONE_SETBACK) + 1.5;
/** A town opens its first filling station at Town size and its second at this many people. */
export const STATION2_POP = 4000;
/**
 * Loads of construction parts a town building site waits for before it goes up (docs/design.md, "Towns grow into
 * cities"): the 1960s blocks, stores and offices of a Town and everything bigger after them are put up from parts,
 * once the company can make them. Houses, terraces and high-street shops still go up on their own.
 */
export const PARTS_FOR: Partial<Record<BuildingKind, number>> = {
  apartments: 3, store: 3, office: 3, modernflats: 6, mall: 9, tower: 9, aptower: 9, glasstower: 12,
};
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
  /** households a day its target is moving by, at the last hour's pace */
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
  /** motor cars the company has sold it (in loads; a few are scrapped each day): its people drive more (motoring) */
  cars?: number;
  /** it sprang up by itself when a milestone was reached (not the start town, nor one founded in an old save) */
  spawned?: boolean;
  /** loads delivered in each of the last 24 game hours, oldest first, and in the hour under way: its supply rolls on these */
  hours?: Partial<Record<Product, number>>[];
  hourNow?: Partial<Record<Product, number>>;
  /** its target households stay where they are put (a test's stand-in town) */
  fixed?: boolean;
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
  /** How far out each town's high streets run (blocks; only ever further, see highStreetReach). */
  private highReach = new Map<number, number>();

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
    // (its extras too: milk and cheese from a Village, cars from a Town, which it buys without needing them to grow)
    if (!t || !buys(t.pop, p)) return -Infinity;
    // (a finished Skyline Tower in it: its shops and offices buy more of everything, see megaprojects.ts)
    return demandPerDay(p, t.pop) * MARKET * townBoost(id, this.g.buildings.sites).demand - (t.today[p] ?? 0);
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
    if (!t) return;
    t.today[p] = (t.today[p] ?? 0) + n;
    (t.hourNow ??= {})[p] = (t.hourNow[p] ?? 0) + n;
    // (every car it buys stays on its streets: more of its people's trips are driven, docs/design.md "Motor Works")
    if (p === "cars") t.cars = (t.cars ?? 0) + n;
  }

  /** How much more a town drives with the cars sold to it (0..MOTOR_MAX; 0 for none or no town). */
  motorOf(id: number | undefined): number {
    const t = id === undefined ? undefined : this.byId.get(id);
    return t ? motoring(t.cars ?? 0, t.households) : 0;
  }

  sizeName(t: Town): string {
    return TOWN_SIZES[sizeOf(t.pop)].name;
  }

  // ------------------------------------------------------------------ founding

  /** Why a town can't stand at p, or null. */
  foundBlock(p: V2): string | null {
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
    return null;
  }

  /** No road of the company's within r (m) of p. */
  cutOff(p: V2, r = SPAWN_ROAD_CLEAR): boolean {
    for (const id of this.g.net.segsNear(p.x - r, p.y - r, p.x + r, p.y + r)) {
      const s = this.g.net.segs.get(id)!;
      if (s.town) continue;
      const g = this.g.net.segGeom.get(id);
      if (g && g.center.pts.some((q) => dist(q, p) < r)) return false;
    }
    return true;
  }

  /** Found a town at p (its streets are laid at once): the start town, or one springing up. Returns it, or why it can't be. */
  found(p: V2, o: { name?: string; ang?: number } = {}): Town | string {
    const why = this.foundBlock(p);
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
    for (const e of SEED_EDGES) this.layEdge(t, e);
    t.sq = this.pickSquare(t);
    this.buildHall(t);
    return t;
  }

  /** A new town's name: an American place name, never one already on the map. */
  private newName(): string {
    return townName(this.g.rng, new Set(this.list.map((t) => t.name)));
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

  // ------------------------------------------------------------------ towns springing up

  /**
   * Where the next town springs up: about spawnDistance(k) from the start town (k: the towns there are besides it),
   * well apart from every other town, on open dry land clear of the company's roads and sites, with deposits around
   * it (soil and forest above all) so it is worth serving. Deterministic from the game's seed and the map as it is.
   */
  spawnSpot(): { p: V2; ang: number; rnd: () => number } | null {
    const home = this.list[0];
    const o = home?.c ?? { x: 0, y: 0 };
    const k = Math.max(0, this.list.length - 1);
    const D = spawnDistance(k);
    const rnd = mulberry32(this.g.seed * 7919 + k * 104729 + 17);
    const t0 = rnd() * Math.PI * 2;
    const w = this.g.world, T = this.g.terrain;
    const apart = Math.max(TOWN_SPACING * 1.5, D * SPAWN_APART);
    const sites = this.g.buildings.list.filter((b) => b.placed);
    // (the band round the wanted distance first, then wider ones, so a town always finds somewhere)
    for (const [lo, hi] of [[0.85, 1.2], [0.7, 1.45], [0.5, 2]]) {
      let best: { p: V2; s: number } | null = null;
      const rings = 5, n = 40;
      for (let ri = 0; ri < rings; ri++) {
        const r = D * (lo + ((hi - lo) * (ri + 0.5)) / rings);
        for (let a = 0; a < n; a++) {
          const th = t0 + ((a + (ri % 2) * 0.5) / n) * Math.PI * 2;
          const p = { x: o.x + Math.cos(th) * r, y: o.y + Math.sin(th) * r };
          if (this.foundBlock(p)) continue;
          if (this.list.some((t) => dist(t.c, p) < apart)) continue;
          // (clear of the sites, and of a dirty plant's smoke and noise by a hamlet's first streets)
          if (sites.some((b) => dist(b.c, p) < Math.max(300, this.reachOf(b) + 450) + Math.max(b.hw, b.hd))) continue;
          if (!this.cutOff(p)) continue;
          // room to grow: open dry land most of the way round, near and further out
          let dry = 0, all = 0;
          for (const R of [250, 450]) for (let q = 0; q < 12; q++) {
            const x = { x: p.x + Math.cos((q / 12) * Math.PI * 2) * R, y: p.y + Math.sin((q / 12) * Math.PI * 2) * R };
            all++;
            if (!w.isWater(x) && !w.isMountain(x)) dry++;
          }
          if (dry / all < 0.8) continue;
          // what lies round it: soil and forest within reach, and how many kinds of deposit within a couple of km
          const kinds = new Set<number>();
          let near = 0;
          for (const R of [500, 1000, 1700]) for (let q = 0; q < 10; q++) {
            const x = { x: p.x + Math.cos((q / 10) * Math.PI * 2 + R) * R, y: p.y + Math.sin((q / 10) * Math.PI * 2 + R) * R };
            for (const f of SPAWN_FIELDS) if (T.has(f, x)) { kinds.add(f); if (R <= 1000 && (f === F.fert || f === F.forest)) near |= f === F.fert ? 1 : 2; }
          }
          const under = T.has(F.fert, p) || T.has(F.forest, p) ? 0.6 : 0;
          const s = -2 * Math.abs(r - D) / D + 0.2 * kinds.size + (near & 1 ? 0.5 : 0) + (near & 2 ? 0.5 : 0) - under + rnd() * 0.3;
          if (!best || s > best.s) best = { p, s };
        }
      }
      if (best) return { p: best.p, ang: rnd() * (Math.PI / 2), rnd };
    }
    return null;
  }

  /**
   * A fresh hamlet springs up by itself (a milestone's reward): at spawnSpot, with its first few streets, hall and
   * homes, and no road to the company's network. Returns it with where it lies against the nearest town, or null
   * when there is nowhere it could go.
   */
  spawn(): Spawned | null {
    const at = this.spawnSpot();
    if (!at) return null;
    let from: Town | null = null;
    for (const t of this.list) if (!from || dist(t.c, at.p) < dist(from.c, at.p)) from = t;
    const name = townName(at.rnd, new Set(this.list.map((t) => t.name)));
    const t = this.found(at.p, { name, ang: at.ang });
    if (typeof t === "string") return null;
    t.spawned = true;
    // it has stood a little while: its first homes are up and lived in
    this.settle(t, 8);
    return { town: t, from, dist: from ? dist(from.c, t.c) : 0, dir: from ? compassWords(from.c, t.c) : "" };
  }

  /** A new town's first hours, at once: its streets, homes and shop go up finished and people move in. */
  settle(t: Town, ticks: number) {
    for (let k = 0; k < ticks; k++) {
      this.census();
      this.watchSmoke();
      this.zone();
      this.tickTown(t);
      for (const b of this.g.buildings.list) if (b.town === t.id && b.built < 1 && !b.site) b.built = 1;
    }
    this.census();
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
    // (a town out of land below the size its households want reaches as far as they would take it: by its people
    // alone, a town whose land filled up first would wait for growth that needs the land)
    const wants = t.households > 0 ? (t.target * t.pop) / t.households : t.pop;
    // the company's dirty plants put it off: no street deep in their smoke and noise, a detour round the edge of it,
    // and the land it gives up there made good the other way (the radius stretched to keep the same area)
    const N = this.nuis;
    const cost = N.length ? (e: GridEdge) => {
      const a = gridPt(t.c, t.ang, (e[0] + e[2]) / 2, (e[1] + e[3]) / 2), b = gridPt(t.c, t.ang, e[2], e[3]);
      const n = Math.max(nuisanceAt(a, N), nuisanceAt(b, N));
      return n > NUISANCE_STREET ? Infinity : n * 6;
    } : undefined;
    const radius = (pop: number) => Math.min(townRadius(pop) * (N.length ? this.stretch(t, townRadius(pop)) : 1), room) / BLOCK;
    return nextEdge(t.built, t.failed, radius(t.pop), jit, cost)
      ?? (wants > t.pop ? nextEdge(t.built, t.failed, radius(wants), jit, cost) : null);
  }

  // ------------------------------------------------------------------ smoke and noise

  /** the company's dirty plants (building sites too: they will be), as the towns see them; and a key that changes with them */
  private nuis: Nuisance[] = [];
  private nuisKey = "";

  /** How far a plant's smoke and noise reach (m; 0 for a clean one). */
  private reachOf(b: Building): number {
    const p = BUILDING_TYPES[b.kind].pollution;
    return b.plant && p > 0 ? smokeReach(p, this.g.parks.isLinked(b.id) ? PARK_SMOKE : 1) + NOISE : 0;
  }

  /** Look again at the company's dirty plants; true if they changed (a plant placed, pulled down or linked). */
  private watchSmoke(): boolean {
    const list: Nuisance[] = [];
    let key = "";
    for (const b of this.g.buildings.list) {
      const reach = this.reachOf(b);
      if (!reach) continue;
      list.push({ c: b.c, hw: b.hw, hd: b.hd, rot: b.rot, reach });
      key += `${b.id}:${Math.round(reach)},`;
    }
    this.nuis = list;
    if (key === this.nuisKey) return false;
    this.nuisKey = key;
    return true;
  }

  /** How bad the company's plants' smoke and noise are at p (0 to 1; see NUISANCE_HOMES). */
  nuisanceAt(p: V2): number {
    return this.nuis.length ? nuisanceAt(p, this.nuis) : 0;
  }

  /**
   * How much further a town reaches to make good the land plants' smoke takes from it: the radius grown so the open
   * share of the circle has the area the whole had (at most double).
   */
  private stretch(t: Town, r: number): number {
    let lost = 0;
    const n = 24;
    for (const f of [0.5, 0.8, 1]) for (let q = 0; q < n; q++) {
      const th = (q / n) * Math.PI * 2;
      if (nuisanceAt({ x: t.c.x + Math.cos(th) * r * f, y: t.c.y + Math.sin(th) * r * f }, this.nuis) > NUISANCE_STREET) lost++;
    }
    return 1 / Math.sqrt(1 - Math.min(0.75, lost / (n * 3)));
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
    // the high streets run further as a town wants more shops
    let spread = false;
    for (const t of this.list) {
      const r = Math.max(this.highReach.get(t.id) ?? 0, highStreetReach(t.size, this.shopsWanted(t)));
      if (r !== this.highReach.get(t.id)) { this.highReach.set(t.id, r); spread = true; }
    }
    if (this.zonedAt === z.version && !resized && !spread) return;
    // (what a cell's town wants for it is kept on the cell until a town's reach, size, hall, square or high streets
    // change)
    const key = this.list.map((t) => `${t.id}:${t.reach}:${t.size}:${t.hall ? 1 : 0}:${t.sq}:${this.highReach.get(t.id)}`).join() + "/" + this.nuisKey;
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
    const z = this.planZone(t, c.c, c.rot, size);
    // (no new homes in a plant's smoke and noise, nor shops deep in it: the land is left open)
    const n = this.nuisanceAt(c.c);
    return n > (ZONE_GROUP[z] === "res" ? NUISANCE_HOMES : NUISANCE_SHOPS) ? null : z;
  }

  /**
   * What a town plans for land at p fronting a street that runs at angle rot: its ring for its size, or shops and
   * offices along its high streets (HIGH_STREET).
   */
  planZone(t: Town, p: V2, rot: number, size = t.size): ZoneId {
    const { a, b } = this.gridOf(t, p);
    const r = Math.hypot(a, b);
    const ring = ringZone(size, r);
    const hs = HIGH_STREET[Math.min(HIGH_STREET.length - 1, size)];
    if (!hs || ZONE_GROUP[ring] === "com" || r >= (this.highReach.get(t.id) ?? 0)) return ring;
    // the grid line of the street it fronts (a cell is never more than half a block from its own street)
    const along = Math.abs(Math.cos(rot - t.ang));
    const line = along > 0.9 ? Math.round(b) : along < 0.44 ? Math.round(a) : NaN;
    return line === line && highLine(size, Math.abs(line)) ? hs : ring;
  }

  // ------------------------------------------------------------------ redevelopment

  /** Shops a town keeps open: about one for every HH_PER_SHOP households. */
  shopsWanted(t: Town): number {
    return t.households > 0 ? 1 + Math.floor(t.households / HH_PER_SHOP) : 0;
  }

  /** Filling stations a town keeps: none before Town size, one from it, two from STATION2_POP people. */
  stationsWanted(t: Town): number {
    return t.size < 2 ? 0 : t.pop >= STATION2_POP ? 2 : 1;
  }

  /**
   * A town that wants a filling station and has no free commercial land rebuilds one of its outer shops as one (the
   * shop furthest from the centre with a front wide enough): a station sits on the way out of the centre.
   */
  private stationOnShop(t: Town) {
    // (one of the town's rebuilds: at its pace)
    const mine = this.buildingsOf(t);
    if (!this.mayRebuild(t, mine)) return;
    let best: Building | null = null, bd = -1;
    for (const b of mine) {
      if (!b.zone || ZONE_GROUP[b.zone] !== "com" || BUILDING_TYPES[b.kind].fuel || !b.lot || b.lot.w < 3 || b.built < 1 || b.abandoned) continue;
      const d = dist(b.c, t.c);
      if (d > bd) { bd = d; best = b; }
    }
    if (!best?.lot || !best.zone) return;
    const { block, col0, w } = best.lot;
    t.redevAt = this.g.time;
    t.redevToday++;
    this.g.rebuildLots(t.id, [best.id], best.zone, block, col0, col0 + w, "fuelstation");
  }

  /** The denser zone an old building's land now has, or null when it is as dense as its ring wants. */
  redevZone(t: Town, b: Building): ZoneId | null {
    // (a filling station stays where it is: the town would only have to open another)
    if (!b.zone || BUILDING_TYPES[b.kind].fuel) return null;
    const want = this.planZone(t, b.c, b.rot);
    if (want === b.zone) return null;
    // (nobody builds denser homes in a plant's smoke)
    if (ZONE_GROUP[want] === "res" && this.nuisanceAt(b.c) > NUISANCE_HOMES) return null;
    const g0 = ZONE_GROUP[b.zone], g1 = ZONE_GROUP[want];
    if (g0 === g1) return ZONE_RANK[want] > ZONE_RANK[b.zone] ? want : null;
    // homes in a ring that is now shops make way only while the town wants more shops
    return g0 === "res" && t.shops < this.shopsWanted(t) ? want : null;
  }

  /** buildings whose last redevelopment found no room along their street, and when (not saved: they are looked at again after a load) */
  private stuck = new Map<number, number>();

  /** May the town start another rebuild now: within its pace for the day, and not too many sites at once? */
  private mayRebuild(t: Town, mine: Building[]): boolean {
    if (!t.built.size || t.trend < 0 || t.size < 1) return false;
    const perDay = redevPerDay(t.size, mine.length);
    if (t.redevToday >= perDay || this.g.time - t.redevAt < DAY / perDay / 2) return false;
    let homes = 0, sites = 0;
    for (const b of mine) {
      if (ZONE_GROUP[b.zone!] === "res") homes++;
      if (b.redev && b.built < 1) sites++;
    }
    return sites < Math.max(1, Math.floor(homes * REDEV_SHARE));
  }

  /**
   * Redevelopment (docs/design.md): the old buildings of a ring now zoned denser are pulled down and rebuilt, a lot
   * at a time, centre first, at a steady pace: a few a day, and never more than REDEV_SHARE of the town's homes
   * building at once. A small lot takes its neighbours along the street with it when the new building needs the
   * width. Only a town that lays its own streets redevelops, and only while it isn't shrinking.
   */
  private redevelop(t: Town, mine: Building[]) {
    if (!this.mayRebuild(t, mine)) return;
    const cands: { b: Building; z: ZoneId; d: number }[] = [];
    for (const b of mine) {
      if (b.built < 1 || b.abandoned || !b.lot) continue;
      const z = this.redevZone(t, b);
      if (z) cands.push({ b, z, d: dist(b.c, t.c) });
    }
    cands.sort((p, q) => p.d - q.d);
    // (a building whose street front has no room for what its land wants waits a day before it is looked at again,
    // so it never keeps the ones behind it from their turn)
    if (this.stuck.size > 4000) for (const [id, at] of this.stuck) if (this.g.time - at >= DAY) this.stuck.delete(id);
    let tried = 0;
    for (const { b, z } of cands) {
      if (this.g.time - (this.stuck.get(b.id) ?? -Infinity) < DAY) continue;
      if (++tried > 40) break;
      const run = this.redevRun(t, b, z);
      if (!run) { this.stuck.set(b.id, this.g.time); continue; }
      this.stuck.delete(b.id);
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
    if (this.watchSmoke()) this.zonedAt = -1;
    this.zone();
    for (const t of this.list) this.tickTown(t);
  }

  /** One town's eighth of an hour: streets, homes and shops, redevelopment, households moving in and out. */
  private tickTown(t: Town) {
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
    // about one shop for every HH_PER_SHOP households, and its filling stations from Town size
    if (t.shops < this.shopsWanted(t)) this.g.growIn(t.id, "com");
    const stations = this.buildingsOf(t).filter((b) => BUILDING_TYPES[b.kind].fuel).length;
    if (stations < this.stationsWanted(t) && !this.g.growIn(t.id, "com", "fuelstation")) this.stationOnShop(t);
    // old buildings in the denser rings make way for new ones
    this.redevelop(t, this.buildingsOf(t));
    // households move in while it is below its target, and out while it is above
    const gap = t.target - t.households;
    if (gap >= 1) this.g.moveInto(t.id, Math.min(3, Math.floor(gap)));
    else if (gap <= -1 && this.g.rng() < 0.3) this.g.moveOutOf(t.id);
  }

  /**
   * Every game hour: each town's people go into its history, its supply rolls on (the share of each need delivered
   * over the last 24 hours) and it grows or shrinks by an hour's worth of it, so a well-fed town grows all day long
   * rather than once at the day's end.
   */
  hourly() {
    this.census();
    for (const t of this.list) {
      const H = t.hist;
      H.pop.push(t.pop);
      H.households.push(t.households);
      if (H.pop.length > HIST_HOURS) { H.pop.splice(0, H.pop.length - HIST_HOURS); H.households.splice(0, H.households.length - HIST_HOURS); }
      const hours = (t.hours ??= []);
      hours.push(t.hourNow ?? {});
      t.hourNow = {};
      if (hours.length > 24) hours.splice(0, hours.length - 24);
      // (a few hours in, the hours so far stand for the day: until then the town goes on the last day it had)
      const delivered: Partial<Record<Product, number>> = {};
      if (hours.length >= ROLL_MIN) {
        const k = 24 / Math.max(hours.length, ROLL_FULL);
        for (const h of hours) for (const [p, n] of Object.entries(h) as [Product, number][]) delivered[p] = (delivered[p] ?? 0) + n * k;
        t.supply = supplyShare(delivered, t.pop);
      }
      this.grow(t, 1 / 24, hours.length >= ROLL_MIN ? delivered : t.yesterday);
    }
  }

  /**
   * A town grows (or shrinks) by `share` of a day at the pace its supply sets. The company's landmarks make it grow
   * faster and its extras supplied add a little; neither makes it shrink faster.
   */
  private grow(t: Town, share: number, delivered: Partial<Record<Product, number>>) {
    if (t.fixed) return;
    const g0 = growthPerDay(t.supply, t.pop);
    const perDay = g0 > 0 ? g0 * townBoost(t.id, this.g.buildings.sites).growth * comfortOf(delivered, t.pop) : g0;
    // (the target never runs far ahead of the town: a dry spell isn't banked as growth for later)
    t.target = Math.max(0, Math.min(t.target + perDay * share, Math.max(t.households, START_HOUSEHOLDS) * 1.4 + 6));
    t.trend = perDay;
  }

  /** A day is over: its deliveries go into the town's history, and today's tallies start again. */
  daily() {
    this.census();
    for (const t of this.list) {
      t.yesterday = t.today;
      t.today = {};
      // (a town without a few hours of its own figures yet, say from an older save, goes on the day's)
      if ((t.hours?.length ?? 0) < ROLL_MIN) t.supply = supplyShare(t.yesterday, t.pop);
      if (t.cars) t.cars *= 1 - CAR_SCRAP;
      t.redevToday = 0;
      t.hist.days.push({ day: this.g.day - 1, pop: t.pop, households: t.households, supply: supplyShare(t.yesterday, t.pop), loads: { ...t.yesterday } });
      if (t.hist.days.length > HIST_DAYS) t.hist.days.shift();
    }
  }

  // ------------------------------------------------------------------ save / load

  toJSON(): { towns: TownJSON[]; nextId: number } {
    return {
      towns: this.list.map((t) => ({
        id: t.id, name: t.name, c: t.c, ang: t.ang, built: [...t.built], failed: [...t.failed], target: t.target,
        today: t.today, yesterday: t.yesterday, supply: t.supply, trend: t.trend, founded: t.founded,
        size: t.size, hall: t.hall, sq: t.sq, hist: t.hist, redevToday: t.redevToday, ...(t.cars ? { cars: t.cars } : {}),
        ...(t.spawned ? { spawned: true } : {}), hours: t.hours ?? [], hourNow: t.hourNow ?? {},
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
