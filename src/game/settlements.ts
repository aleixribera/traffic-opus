// The towns on the map (docs/design.md, "Towns"; the pure rules are in towns.ts). A town is founded on a spot and
// from then on looks after itself: it lays its own streets on a plan of its own (townplan.ts) when it needs room
// for homes, zones the land along them (shops round the centre, homes beyond), widens its busiest streets, in time
// builds one road out of town, and grows or shrinks toward a target number of households that moves once a day
// with how well the company supplied its needs. Homes and shops belong to the town whose streets they front
// (Building.town).

import { BUILDING_TYPES, ROAD_TYPES, SIDEWALK, ZONE_SETBACK, roadWidth, type BuildingKind } from "../config";
import { angleOf, cubicTangent, dist, dot, fromAngle, norm, right, scale, sub, type V2 } from "../core/math";
import { chainPoints, cubicClosest, planRoad, snap, type Plan, type Snap } from "../roads/planner";
import type { RSeg } from "../roads/network";
import { dkey } from "../sim/router";
import { mulberry32 } from "../core/noise";
import { F, MOUNTAIN_STEPS } from "../world/gen";
import { townName } from "./names";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP, ZONE_LOTS } from "./growables";
import type { Product } from "./industry";
import { townBoost } from "./megaprojects";
import { PARK_SMOKE } from "./parks";
import { DAY, HOUR } from "./society";
import { deliveredLately, dipIn, landedGrace, rollGrace, type Grace } from "./supply";
import {
  BLOCK, CAR_SCRAP, HALLS, HIGH_STREET, NOISE, NUISANCE_HOMES, NUISANCE_SHOPS, NUISANCE_STREET, REDEV_SHARE, SEED_EDGES, TOWN_SIZES, buys, comfortOf,
  demandPerDay, edgeKey, gridPt, growthPerDay, highLine, highStreetReach, motoring, needsOf, nextEdge, nuisanceAt, redevPerDay, ringZone, sizeOf,
  smokeReach, supplyShare, townRadius, type GridEdge, type Nuisance,
  HOLD_FROM, PER_HOME, SETTLING, SHRINK_AFTER, SHRINK_RATE, SUPPLY_HOURS, averageSupply, countsForShrinking, growthShare, supplyLevel, supportOf,
} from "./towns";
import { LEAN_N as LEAN_DIRS, PLAN_GRID, PLAN_TOWN, TownPlan, type EdgeHit } from "./townplan";
import { CELL, DEPTH, ZONE_RANK, zoneEdge, type Cell, type ZoneId } from "./zones";

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

/** A town's green (a block of its plan kept as a park): the lawn's outline and its trees (crown radius, m). */
export interface Green {
  town: number;
  pts: V2[];
  trees: { p: V2; r: number }[];
}

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
/** Households a day a settlement still filling its first streets grows by, supplied or not. */
const SETTLE_RATE = 6;
/** How many times its needs a town's shops will buy in a day. */
export const MARKET = 3;
/** Households per shop the town keeps open. */
const HH_PER_SHOP = 25;
/**
 * Cells this close (m) to a street of the town's plan still to be laid stay empty, so the street never has to clear
 * homes (a bent street is laid within a metre or two of where its plan has it).
 */
const CORRIDOR = 12;
/**
 * How far the town square keeps from the grid lines round it (m): half a street, its pavement and a margin, and at
 * least the setback homes keep, so the streets round it can be upgraded as theirs can.
 */
export const SQUARE_INSET = Math.max(roadWidth(ROAD_TYPES.street) / 2 + SIDEWALK.small, ZONE_SETBACK) + 1.5;
/**
 * A town widens one of its own streets (docs/design.md, "Towns run themselves") when the day's busiest hours put at
 * least this many cars on each 100 m of its lanes, as its traffic is watched every eighth of an hour, smoothed over
 * about two hours. A street at capacity carries about 3.5.
 */
export const WIDEN_LOAD = 1.6;
/** How many times in all a town widens a street, by size (Hamlet, Village, Town, City, Metropolis). */
export const WIDEN_QUOTA = [0, 1, 3, 6, 10];
/** The longest run of a street a town widens at once (m). */
const WIDEN_RUN = 700;
/** A town of this size or more builds its one road out of town, to a road within OUT_REACH of its centre (m). */
export const OUT_SIZE = 2, OUT_REACH = 2000;
/** A town's road out keeps this far from the company's sites (m). */
const OUT_SITE_CLEAR = 30;
/** How far off the player's roads, other towns and the company's sites still sway which way a town grows (m). */
const LEAN_REACH = 2500;
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
  /** loads delivered in each of the last SUPPLY_HOURS game hours, oldest first, and in the hour under way: its supply rolls on these */
  hours?: Partial<Record<Product, number>>[];
  hourNow?: Partial<Record<Product, number>>;
  /** hours in a row its supply level has been below HOLD_FROM (it shrinks after SHRINK_AFTER of them) */
  lack?: number;
  /** needs just fallen below "Enough" that it doesn't show or count yet (supply.ts GRACE) */
  grace?: Partial<Record<Product, Grace>>;
  // (worked out every hour from `hours`; not saved)
  /** loads a day of each product delivered, averaged over the last two days (averageSupply): what its growth goes on */
  rate?: Partial<Record<Product, number>>;
  /** the people that supply supports: where it would stop growing (supportOf) */
  supports?: number;
  /** the need that holds it back, while it grows at under half its full pace or not at all (its worst supplied) */
  limit?: Product;
  /** its supply level: the share of a day's use of its worst-supplied need it has been getting (towns.ts supplyLevel) */
  level?: number;
  /** its target households stay where they are put (a test's stand-in town) */
  fixed?: boolean;
  /** its street plan: PLAN_TOWN for every new town; PLAN_ORGANIC (v0.0.69) and PLAN_GRID (the old square grid) for towns from older saves */
  layout: number;
  /** streets it has widened itself (docs/design.md, "Towns run themselves") */
  widened?: number;
  /** game day it built its one road out of town, if it has */
  outward?: number;
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
export type TownJSON = Omit<Town, "built" | "failed" | Counted | "size" | "hall" | "sq" | "hist" | "redevAt" | "redevToday" | "layout" | "rate" | "supports" | "limit"> & {
  built: string[]; failed: string[]; size?: number; hall?: number; sq?: [number, number]; hist?: TownHistory; redevToday?: number; layout?: number;
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
    return demandPerDay(p, t.pop) * MARKET * townBoost(id, this.g.buildings.sites).demand * this.g.orders.boost(id).demand - (t.today[p] ?? 0);
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
    // (a need in its grace that this load puts back at the line: nothing was ever shown or counted)
    landedGrace(t, p);
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
      layout: PLAN_TOWN, pop: 0, households: 0, homes: 0, shops: 0, reach: BLOCK,
    };
    this.list.push(t);
    this.byId.set(id, t);
    for (const e of SEED_EDGES) this.layEdge(t, e);
    t.sq = this.pickSquare(t);
    this.zonedAt = -1;
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

  /** each town's street plan (not saved: it is the same every time from the town and the game's seed) */
  private plans = new Map<number, TownPlan>();

  /** A town's street plan (townplan.ts): where each street of its lattice runs. */
  /**
   * Each town's Main Street (the plan's line 0 along it), the stretch of it through the old town and on as far as
   * its high street's shops reach: the roads laid in brick, the way a 1920s town paved its main street (roads3d).
   */
  mainStreets(): Set<number> {
    const out = new Set<number>();
    const net = this.g.net;
    for (const t of this.list) {
      const P = this.planOf(t);
      P.index(t.reach / BLOCK + 1);
      const R = Math.max(1.25, this.highReach.get(t.id) ?? 0) * BLOCK;
      for (const id of net.segsNear(t.c.x - R, t.c.y - R, t.c.x + R, t.c.y + R)) {
        const pts = net.segGeom.get(id)?.center.pts;
        if (!pts || pts.length < 2) continue;
        const a = pts[0], b = pts[pts.length - 1], m = pts[pts.length >> 1];
        if (dist(m, t.c) > R || dist(a, b) < 1) continue;
        const hit = P.edgeAt(m, norm(sub(b, a)), 6, 0.9);
        if (hit && hit.e[1] === 0 && hit.e[3] === 0) out.add(id);
      }
    }
    return out;
  }

  planOf(t: Town): TownPlan {
    let P = this.plans.get(t.id);
    if (!P || P.c.x !== t.c.x || P.c.y !== t.c.y || P.ang !== t.ang || P.style !== t.layout) {
      const seed = (Math.imul(this.g.seed, 7919) + Math.imul(t.id, 104729) + Math.imul(Math.round(t.c.x), 31) + Math.round(t.c.y)) | 0;
      P = new TownPlan(t.c, t.ang, t.layout, seed, this.g.world);
      this.plans.set(t.id, P);
    }
    P.sq = t.sq;
    return P;
  }

  /** Plan one lattice edge as a street, joined to whatever already stands at its ends, bent as the town's plan has it. */
  planEdge(t: Town, e: GridEdge): Plan {
    const net = this.g.net;
    const s = this.planOf(t).shape(e);
    const sn = (p: V2): Snap => {
      const q = snap(net, p, { mpp: 0.5, level: 0, type: "street" });
      return q.node !== undefined || q.seg !== undefined ? q : { p, h: 0, guides: [] };
    };
    // (the town's own streets cost the company nothing)
    const world = { ...this.g.world, money: () => Infinity };
    const start = sn(s.a), end = sn(s.b);
    // (a bent street leaves its first node along the plan's curve; it is laid from where that node really is)
    return planRoad(net, world, s.ta && dist(start.p, s.a) < 1
      ? { start, end, mode: "curve", type: "street", startTangent: s.ta }
      : { start, end, mode: "straight", type: "street" });
  }

  /** Lay a lattice edge (free). False if it can't be built there; it is then never tried again. */
  layEdge(t: Town, e: GridEdge): boolean {
    const k = edgeKey(e);
    const plan = this.planEdge(t, e);
    if (plan.errors.length || !this.g.buildFree(plan, t.id)) { t.failed.add(k); return false; }
    t.built.add(k);
    // (the land reaches past its furthest node)
    const P = this.planOf(t);
    t.reach = Math.max(t.reach, this.reachAt(t, Math.max(P.r(e[0], e[1]), P.r(e[2], e[3]))));
    return true;
  }

  /**
   * How far a town's land reaches with its furthest node r blocks out. (A bent plan's nodes each stand at a radius of
   * their own: the reach steps a quarter block at a time, or every street laid would have the land zoned anew.)
   */
  private reachAt(t: Town, r: number): number {
    const b = r + 0.6;
    return (t.layout === PLAN_GRID ? b : Math.ceil(b * 4) / 4) * BLOCK;
  }

  private updateReach(t: Town) {
    const P = this.planOf(t);
    let r = 0;
    for (const k of t.built) for (const n of k.split("|")) {
      const [i, j] = n.split(",").map(Number);
      const d = P.r(i, j);
      if (d < Infinity) r = Math.max(r, d);
    }
    t.reach = this.reachAt(t, r);
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
    // (only the streets of its plan: townplan.ts)
    const P = this.planOf(t);
    // a town of today's plan leans: it grows further along its roads and toward open land than elsewhere, so it
    // fills out a shape of its own (its radius below is measured by how far it leans each way: TownPlan.growR)
    const lean = t.layout === PLAN_TOWN;
    if (lean) this.leanFor(t, P);
    const cost = (e: GridEdge) => {
      if (!P.has(e)) return Infinity;
      // (never past halfway to the next town, however far it leans that way)
      if (lean && P.r(e[2], e[3]) * BLOCK > room) return Infinity;
      if (!N.length) return 0;
      const a = P.at((e[0] + e[2]) / 2, (e[1] + e[3]) / 2), b = P.pt(e[2], e[3])!;
      const n = Math.max(nuisanceAt(a, N), nuisanceAt(b, N));
      return n > NUISANCE_STREET ? Infinity : n * 6;
    };
    const rOf = lean ? (i: number, j: number) => P.growR(i, j) : (i: number, j: number) => P.r(i, j);
    const cap = lean ? Infinity : room;
    const radius = (pop: number) => Math.min(townRadius(pop) * (N.length ? this.stretch(t, townRadius(pop)) : 1), cap) / BLOCK;
    // (out of land below what its households want, it reaches a little past that radius too: a bent plan puts its
    // next ring of nodes a block or so further out than a square grid would)
    return nextEdge(t.built, t.failed, radius(t.pop), jit, cost, rOf)
      ?? (wants > t.pop ? nextEdge(t.built, t.failed, Math.min(radius(wants) + 1, cap / BLOCK), jit, cost, rOf) : null);
  }

  /** the roads that aren't a town's own, as a signature, and the network version it was taken at (leanFor) */
  private roadSig = { v: -1, sig: "" };

  /**
   * How a town of today's plan leans (TownPlan.setLean), worked out again whenever what it depends on changes: the
   * roads that aren't its own, the other towns and the company's sites. Out along LEAN_DIRS directions, open flat
   * land draws it on and water, mountain, the foothills and forest put it off (the nearer, the more); the player's
   * roads and the other towns' centres within LEAN_REACH draw it toward them; the company's sites put it off.
   */
  private leanFor(t: Town, P: TownPlan) {
    const net = this.g.net;
    if (this.roadSig.v !== net.version) {
      let n = 0, ids = 0;
      for (const s of net.segs.values()) if (!s.town) { n++; ids = (ids + s.id * 2654435761) >>> 0; }
      this.roadSig = { v: net.version, sig: `${n}.${ids}` };
    }
    const sites = this.g.buildings.list.filter((b) => b.placed);
    const key = `${this.roadSig.sig}|${this.list.map((o) => o.id).join(",")}|${sites.map((b) => b.id).join(",")}`;
    if (P.leanKey === key) return;
    P.leanKey = key;
    const N = LEAN_DIRS, w = this.g.world, T = this.g.terrain, c = t.c;
    const land = new Float64Array(N).fill(1);
    const pull = new Float64Array(N), push = new Float64Array(N);
    // what lies out each way
    for (let k = 0; k < N; k++) {
      const th = (k / N) * Math.PI * 2, u = { x: Math.cos(th), y: Math.sin(th) };
      let bad = 0, all = 0, blocked = false;
      for (let s = 1; s <= 12; s++) {
        const p = { x: c.x + u.x * s * BLOCK * 0.9, y: c.y + u.y * s * BLOCK * 0.9 };
        const wt = 1 / (1 + s / 4);
        let v = 0;
        if (blocked || w.isWater(p) || w.isMountain(p)) { v = 1; blocked = true; }
        else {
          if (T.has(F.forest, p)) v = 0.35;
          if (T.sample(F.mtn, p.x, p.y) > MOUNTAIN_STEPS[0] * 0.7) v = Math.max(v, 0.5);
        }
        bad += v * wt;
        all += wt;
      }
      land[k] = Math.exp(-1.2 * (bad / all));
    }
    // what draws it, and what puts it off: a lobe round the way to each
    const lobe = (q: V2, wt: number, into: Float64Array) => {
      const d = dist(q, c);
      if (d < BLOCK * 1.5 || d > LEAN_REACH) return;
      const ang = Math.atan2(q.y - c.y, q.x - c.x);
      for (let k = 0; k < N; k++) {
        const cs = Math.cos(ang - (k / N) * Math.PI * 2);
        if (cs > 0.5) into[k] += wt * Math.exp(-d / 1400) * cs ** 4;
      }
    };
    const R = LEAN_REACH;
    for (const id of net.segsNear(c.x - R, c.y - R, c.x + R, c.y + R)) {
      const s = net.segs.get(id);
      if (!s || s.town) continue;
      const L = net.segGeom.get(id)?.center.length ?? 0;
      // (the nearest point of it: a long road passing close by draws the town as much as one ending there)
      lobe(cubicClosest(s.c, c).p, Math.min(L, 800) / 100, pull);
    }
    for (const o of this.list) if (o !== t) lobe(o.c, 3, pull);
    for (const b of sites) lobe(b.c, 1.5, push);
    for (let k = 0; k < N; k++) land[k] *= (1 + 0.6 * Math.min(1, pull[k] / 2)) * (1 - 0.4 * Math.min(1, push[k]));
    P.setLean(land);
  }

  // ------------------------------------------------------------------ greens

  /**
   * The greens of every town that its streets have grown round (three sides of the block laid at least): the lawn
   * inside the block's pavements, with the corners cut, and its trees. A block a road of the player's or a building
   * stands in is no green. `key` changes when any of them does.
   */
  greens(): { key: string; list: Green[] } {
    const list: Green[] = [];
    let key = "";
    for (const t of this.list) {
      if (t.layout === PLAN_GRID || !t.built.size) continue;
      const P = this.planOf(t);
      const K = Math.ceil(t.reach / BLOCK) + 1;
      for (let fi = -K; fi < K; fi++) for (let fj = -K; fj < K; fj++) {
        // (a loop drive's green is drawn whole, from the first block inside it)
        const loop = P.loopGreen(fi, fj);
        if (loop) {
          if (!loop.every((e) => t.built.has(edgeKey(e)))) continue;
          const g = this.greenOf(t, P, "L", fi, fj, loop, loop.map(() => false), loop.map((e) => P.pt(e[0], e[1])));
          if (g) { list.push(g); key += `${t.id}:L${fi},${fj};`; }
          continue;
        }
        if (!P.green(fi, fj) || P.inLoop(fi, fj)) continue;
        const sides = P.sidesOf(fi, fj);
        // (a PLAN_TOWN block may have a side no street will ever be laid on, by the plan or because it couldn't be:
        // its other sides laid are enough)
        if (t.layout === PLAN_TOWN) {
          const live = sides.filter((e) => this.liveSide(t, P, e));
          if (live.length < 2 || !live.every((e) => t.built.has(edgeKey(e)))) continue;
        } else if (sides.filter((e) => t.built.has(edgeKey(e))).length < 3) continue;
        const g = this.greenOf(t, P, "", fi, fj, sides, [false, false, true, true], P.faceCorners(fi, fj));
        if (!g) continue;
        list.push(g);
        key += `${t.id}:${fi},${fj};`;
      }
    }
    return { key, list };
  }

  private greenCache = new Map<string, Green | null>();

  /** A side of a PLAN_TOWN block that has, or will have, a street on it: one of the plan's, not failed to be laid. */
  private liveSide(t: Town, P: TownPlan, e: GridEdge): boolean {
    return P.has(e) && !t.failed.has(edgeKey(e));
  }

  /**
   * Will a PLAN_TOWN green never be drawn, streets round it having failed to be laid (a loop drive's, or all but one
   * of a block's)? Its land then goes to homes rather than lying bare.
   */
  private greenLost(t: Town, P: TownPlan, fi: number, fj: number): boolean {
    if (t.layout !== PLAN_TOWN || !t.failed.size) return false;
    if (P.inLoop(fi, fj)) return P.streetsRound(fi, fj).some((e) => t.failed.has(edgeKey(e)));
    return P.sidesOf(fi, fj).filter((e) => this.liveSide(t, P, e)).length < 2;
  }

  /**
   * The green inside streets `sides` (in order round it; `order` marks the ones whose lines run against that way),
   * with corners `corners`; `tag` and (fi, fj) name it (and seed its trees).
   */
  private greenOf(t: Town, P: TownPlan, tag: string, fi: number, fj: number, sides: GridEdge[], order: boolean[], corners: (V2 | null)[] | null): Green | null {
    const ck = `${t.id}:${tag}${fi},${fj}:${this.g.net.version}:${this.g.buildings.list.length}:${t.failed.size}`;
    if (this.greenCache.has(ck)) return this.greenCache.get(ck)!;
    if (this.greenCache.size > 4000) this.greenCache.clear();
    let out: Green | null = null;
    if (corners && corners.every((p) => p)) {
      const n0 = corners.length;
      const mid = { x: corners.reduce((s, p) => s + p!.x, 0) / n0, y: corners.reduce((s, p) => s + p!.y, 0) / n0 };
      // round the block: each side's line, in from the street's centreline to past its pavement, and short of the
      // corners (a lawn cut square at the street corners); as wide as the road along that side now is (one the town
      // has widened takes more of it)
      const net = this.g.net;
      const half = (e: GridEdge, line: V2[]) => {
        const m = line[Math.floor(line.length / 2)];
        let w = roadWidth(ROAD_TYPES.street);
        if (t.built.has(edgeKey(e))) for (const id of net.segsNear(m.x - 8, m.y - 8, m.x + 8, m.y + 8)) {
          const s = net.segs.get(id)!;
          if (dist(cubicClosest(s.c, m).p, m) < 6) w = Math.max(w, roadWidth(ROAD_TYPES[s.type]));
        }
        return w / 2;
      };
      const pts: V2[] = [];
      const lines = sides.map((e) => P.line(e, 6));
      const halves = sides.map((e, k) => half(e, lines[k]));
      // (a side of a PLAN_TOWN block no street will be laid on: the lawn runs on to a few metres short of its line)
      const real = sides.map((e) => t.layout !== PLAN_TOWN || this.liveSide(t, P, e));
      // (cut square at the street corners; a loop drive's corners are gentle bends, with no cut)
      const CUT = tag === "L" ? 0 : Math.max(...halves) + SIDEWALK.small + 5.5;
      sides.forEach((e, k) => {
        let line = lines[k];
        const IN = real[k] ? halves[k] + SIDEWALK.small + 1.5 : 3;
        if (order[k]) line = line.slice().reverse();
        const L = line.length;
        for (let n = 0; n < L; n++) {
          const a = line[Math.max(0, n - 1)], b = line[Math.min(L - 1, n + 1)];
          const tan = norm(sub(b, a));
          let nrm = { x: -tan.y, y: tan.x };
          if (dot(nrm, sub(mid, line[n])) < 0) nrm = { x: -nrm.x, y: -nrm.y };
          // (a side with no street stops short of its corners too: the streets beside it run on past them)
          if (dist(line[n], line[0]) < CUT || dist(line[n], line[L - 1]) < CUT) continue;
          pts.push({ x: line[n].x + nrm.x * IN, y: line[n].y + nrm.y * IN });
        }
      });
      // (nothing standing in it, and no road of anyone else's through it)
      const inside = (p: V2) => {
        let c = false;
        for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
          const a = pts[i], b = pts[j];
          if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
        }
        return c;
      };
      const R = BLOCK;
      let clear = pts.length >= 8;
      if (clear) for (const b of this.g.buildings.list) if (dist(b.c, mid) < R && inside(b.c)) { clear = false; break; }
      if (clear) {
        for (const id of net.segsNear(mid.x - R, mid.y - R, mid.x + R, mid.y + R)) {
          if (net.segGeom.get(id)!.center.pts.some(inside)) { clear = false; break; }
        }
      }
      if (clear && pts.every((p) => !this.g.world.isWater(p))) {
        // trees: a row round the edge a few metres in, with gaps, and clumps within
        const trees: { p: V2; r: number }[] = [];
        for (let i = 0; i < pts.length; i += 2) {
          const p = pts[i], q = sub(mid, p), d = Math.hypot(q.x, q.y);
          if (d < 12 || P.hash(fi, fj, i, 3) < 0.25) continue;
          trees.push({ p: { x: p.x + (q.x / d) * 4.5, y: p.y + (q.y / d) * 4.5 }, r: 3.2 + P.hash(fi, fj, i, 4) * 1.4 });
        }
        for (let a = -3; a <= 3; a++) for (let b = -3; b <= 3; b++) {
          if (P.hash(fi, fj, a, b, 5) > 0.3) continue;
          const p = { x: mid.x + a * 11 + (P.hash(fi, fj, a, b, 6) - 0.5) * 8, y: mid.y + b * 11 + (P.hash(fi, fj, a, b, 7) - 0.5) * 8 };
          if (!inside(p) || pts.some((q) => dist(p, q) < 9)) continue;
          trees.push({ p, r: 3.6 + P.hash(fi, fj, a, b, 8) * 2 });
        }
        out = { town: t.id, pts, trees };
      }
    }
    this.greenCache.set(ck, out);
    return out;
  }

  // ------------------------------------------------------------------ the town's own roads

  /** how busy each town street is (cars per 100 m of lane, smoothed) and the busiest it has been today (not saved) */
  private busy = new Map<number, { now: number; peak: number }>();

  /** Every eighth of an hour: the traffic on each town street, smoothed over about two hours. */
  watchTraffic() {
    const net = this.g.net, flow = this.g.traffic.flow;
    if (!flow.size && !this.busy.size) return;
    for (const [id, s] of net.segs) {
      if (!s.town) continue;
      const geo = net.segGeom.get(id);
      if (!geo) continue;
      const T = ROAD_TYPES[s.type];
      const cars = (flow.get(dkey(id, 1))?.n ?? 0) + (flow.get(dkey(id, -1))?.n ?? 0);
      const per = (cars / Math.max(1, T.fwd + T.bwd) / Math.max(30, geo.center.length)) * 100;
      let L = this.busy.get(id);
      if (!L) this.busy.set(id, (L = { now: 0, peak: 0 }));
      L.now += (per - L.now) / 16;
      L.peak = Math.max(L.peak, L.now);
    }
    for (const id of this.busy.keys()) if (!net.segs.has(id)) this.busy.delete(id);
  }

  /** The road a town street of this type is widened to at a size (null: it is as wide as the town makes it). */
  private widerOf(type: string, size: number): "avenue" | "avenueM" | null {
    return type === "street" ? "avenue" : type === "avenue" && size >= 3 ? "avenueM" : null;
  }

  /** Which way seg s leaves node n. */
  private leaves(s: RSeg, n: number): V2 {
    const c = s.c;
    return s.a === n ? norm(sub(dist(c.p1, c.p0) > 0.5 ? c.p1 : c.p3, c.p0)) : norm(sub(dist(c.p2, c.p3) > 0.5 ? c.p2 : c.p0, c.p3));
  }

  /**
   * A town widens its own streets (owner, 2026-11-08: "let them upgrade some roads"): once a day, the busiest of
   * them, if busy enough (WIDEN_LOAD), is widened along the run of it that carries on straight through its
   * junctions, as far as the street is its own, the same road and busy too. Never a road of the player's, and never
   * where the wider road would touch a building (the front strips leave room for it: ZONE_SETBACK).
   */
  widen(t: Town) {
    const net = this.g.net;
    const quota = WIDEN_QUOTA[Math.min(WIDEN_QUOTA.length - 1, t.size)];
    // its busiest streets today (one that can't be widened, too tight a bend say, leaves it to the next)
    const busiest: { id: number; peak: number }[] = [];
    for (const [id, L] of this.busy) {
      const s = net.segs.get(id);
      if (s && s.town === t.id && L.peak >= WIDEN_LOAD && this.widerOf(s.type, t.size)) busiest.push({ id, peak: L.peak });
    }
    busiest.sort((a, b) => b.peak - a.peak);
    if ((t.widened ?? 0) < quota) for (const { id } of busiest.slice(0, 3)) if (this.widenRun(t, id)) break;
    // (tomorrow's busiest hours are tomorrow's)
    for (const [id, L] of this.busy) if (net.segs.get(id)?.town === t.id) L.peak = L.now;
  }

  /** Widen the run of a town's street through seg `best` (see widen). True if any of it was. */
  private widenRun(t: Town, best: number): boolean {
    const net = this.g.net;
    const first = net.segs.get(best)!, from = first.type, to = this.widerOf(from, t.size)!;
    const busy = (id: number) => Math.max(this.busy.get(id)?.now ?? 0, this.busy.get(id)?.peak ?? 0) >= WIDEN_LOAD / 2;
    // the run: on from each end while the street carries on within 35° and is as busy as half the threshold
    const run = [best];
    let len = net.segGeom.get(best)?.center.length ?? 0;
    for (const end of [first.a, first.b]) {
      let at = end, cur = first;
      while (len < WIDEN_RUN) {
        const out = scale(this.leaves(cur, at), -1);
        let next: RSeg | null = null, nd = Math.cos((35 * Math.PI) / 180);
        for (const o of net.segsAt(at)) {
          if (o.id === cur.id || o.town !== t.id || o.type !== from || run.includes(o.id) || !busy(o.id)) continue;
          const d = dot(this.leaves(o, at), out);
          if (d > nd) { nd = d; next = o; }
        }
        if (!next) break;
        run.push(next.id);
        len += net.segGeom.get(next.id)?.center.length ?? 0;
        at = next.a === at ? next.b : next.a;
        cur = next;
      }
    }
    // (its name, from the line of the plan the busiest piece is on)
    const geo = net.segGeom.get(best)!;
    const mid = geo.center.pts[Math.floor(geo.center.pts.length / 2)];
    const P = this.planOf(t);
    P.index(t.reach / BLOCK + 1);
    const hit = P.edgeAt(mid, this.leaves(first, first.a), 10, 0.6);
    let n = 0;
    for (const id of run) if (this.g.upgradeFree(id, to)) n++;
    if (!n) return false;
    t.widened = (t.widened ?? 0) + 1;
    this.g.toast(`${t.name} widened ${hit ? P.nameOf(hit.e) : "one of its streets"}`);
    return true;
  }

  /**
   * A town's road out (owner, 2026-11-08: "let them eventually build an outwards road that ends up connecting to
   * maybe an external road, but don't overdo it, this is the player's job"): from Town size, once, a street from
   * the edge of town to the nearest road within OUT_REACH that isn't its own (the player's, or another town's) and
   * that it doesn't already reach that way. It goes round the company's sites, never over water or mountain, never
   * across another road nor through a home; with nothing in reach it builds nothing (daily() looks again every
   * few days).
   */
  reachOut(t: Town) {
    if (t.size < OUT_SIZE || t.outward !== undefined || !t.built.size) return;
    const net = this.g.net;
    const mine: number[] = [];
    const nodes = new Set<number>();
    for (const [id, s] of net.segs) if (s.town === t.id) { mine.push(id); nodes.add(s.a); nodes.add(s.b); }
    if (!mine.length) return;
    // the ways out of town it has already: where its streets meet roads that aren't its own
    const exits: V2[] = [];
    for (const n of nodes) {
      if (!net.segsAt(n).some((o) => o.town !== t.id)) continue;
      const p = net.nodes.get(n)!.p;
      if (dist(p, t.c) > 1) exits.push(norm(sub(p, t.c)));
    }
    const R = OUT_REACH, wide = Math.cos((60 * Math.PI) / 180);
    const cands: { id: number; p: V2; d: number; other?: number }[] = [];
    for (const id of net.segsNear(t.c.x - R, t.c.y - R, t.c.x + R, t.c.y + R)) {
      const s = net.segs.get(id)!;
      if (s.town === t.id || !ROAD_TYPES[s.type].allowsAccess || s.ring) continue;
      const r = cubicClosest(s.c, t.c);
      const d = dist(r.p, t.c);
      if (d > R || (d < t.reach * 0.75 && d < this.reachToward(t, nodes, r.p) * 0.75) || net.heightOnSeg(id, r.t) > 0.5) continue;
      // (a road it already reaches, it joins again only in a new direction)
      const dir = norm(sub(r.p, t.c));
      if (this.g.connected(mine[0], id) && exits.some((x) => dot(x, dir) > wide)) continue;
      if (cands.some((c) => dist(c.p, r.p) < 120)) continue;
      cands.push({ id, p: r.p, d, other: s.town });
    }
    cands.sort((a, b) => a.d - b.d);
    for (const cd of cands.slice(0, 6)) {
      const plan = this.outPlan(t, cd.p, nodes);
      if (!plan || !this.g.buildFree(plan, t.id)) continue;
      t.outward = this.g.day;
      const o = cd.other ? this.byId.get(cd.other) : undefined;
      this.g.toast(o ? `${t.name} built a road out to ${o.name}` : `${t.name} built a road out to the ${compassWords(t.c, cd.p)}, joining yours`);
      return;
    }
  }

  /**
   * How far a town reaches toward q (m): for a town of today's plan, which leans, its furthest junction within 35° of
   * the way to q (half its reach when it has none that way); for the older plans, which grow round, its reach.
   */
  private reachToward(t: Town, nodes: Set<number>, q: V2): number {
    if (t.layout !== PLAN_TOWN) return t.reach;
    const dir = norm(sub(q, t.c)), cone = Math.cos((35 * Math.PI) / 180);
    let far = t.reach * 0.5;
    for (const n of nodes) {
      const p = this.g.net.nodes.get(n)!.p, d = dist(p, t.c);
      if (d > far && dot(sub(p, t.c), dir) > cone * d) far = d;
    }
    return Math.min(far, t.reach);
  }

  /** The street out from the edge of town to a point on a road (null: none it would build). */
  private outPlan(t: Town, q: V2, nodes: Set<number>): Plan | null {
    const net = this.g.net, W = this.g.world;
    // set out from a junction or dead end on the edge of town that faces the road (not back through the town)
    const starts: { n: number; p: V2; d: number }[] = [];
    const edge = this.reachToward(t, nodes, q) * 0.45;
    for (const n of nodes) {
      const p = net.nodes.get(n)!.p;
      if (net.segsAt(n).length >= 4 || dist(p, t.c) < edge) continue;
      if (dot(norm(sub(p, t.c)), norm(sub(q, p))) < 0.55) continue;
      starts.push({ n, p, d: dist(p, q) });
    }
    starts.sort((a, b) => a.d - b.d);
    const end = snap(net, q, { mpp: 0.5, level: 0, type: "street" });
    if (end.seg === undefined && end.node === undefined) return null;
    const world = { ...W, money: () => Infinity };
    for (const st of starts.slice(0, 4)) {
      if (st.d > OUT_REACH) break;
      // (on along the dead end it starts from, or straight for the road)
      const at = net.segsAt(st.n);
      const ways = [norm(sub(q, st.p))];
      if (at.length === 1) ways.unshift(scale(this.leaves(at[0], st.n), -1));
      for (const tan of ways) {
        if (dot(tan, norm(sub(q, st.p))) < 0.3) continue;
        const plan = planRoad(net, world, { start: { p: st.p, h: 0, guides: [], node: st.n }, end, mode: "curve", squareEnd: true, type: "street", startTangent: tan });
        if (plan.errors.length || !plan.strokes.length || plan.crossings.length || plan.length > OUT_REACH) continue;
        if (plan.strokes.some((s) => s.h0 > 0.5 || s.h1 > 0.5)) continue;
        const pts = plan.strokes.flatMap((s) => chainPoints(s.chain, 8));
        if (pts.some((p) => W.isWater(p) || W.isMountain(p) || !W.inBounds(p))) continue;
        if (this.g.lotsUnder(plan).length) continue;
        // (clear of the company's sites, and of anything else that isn't a home or shop)
        if (this.g.buildings.hit(pts, OUT_SITE_CLEAR).some((id) => !this.g.buildings.byId.get(id)?.zone)) continue;
        return plan;
      }
    }
    return null;
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

  /** The street of a town's plan that a cell fronts (null: its road isn't one of the town's planned streets). */
  private frontOf(t: Town, c: Cell): EdgeHit | null {
    const P = this.planOf(t);
    // (a cell stays where it was laid out while its block stands: what it fronts is looked up once per plan)
    const got = this.fronts.get(c);
    if (got && got.P === P) return got.hit;
    const g = this.g.net.segGeom.get(c.block.seg);
    if (!g) return null;
    // (the point on its road's centreline straight in front of it: the cell was laid out from there)
    const u = fromAngle(c.rot);
    const foot = sub(c.c, scale(right(u), c.block.side * (zoneEdge(g.width) + (c.row + 0.5) * CELL)));
    const hit = P.edgeAt(foot, u, 6, 0.7);
    this.fronts.set(c, { P, hit });
    return hit;
  }

  /** the planned street each cell, and each building, fronts (as frontOf and redevZone found it) */
  private fronts = new WeakMap<Cell, { P: TownPlan; hit: EdgeHit | null }>();
  private bfronts = new WeakMap<Building, { P: TownPlan; hit: EdgeHit | null }>();

  /** What the town plans for a cell's land at its size (planZone, on the street the cell fronts). */
  planZoneAt(t: Town, c: Cell): ZoneId {
    this.planOf(t).index(t.reach / BLOCK + 1);
    return this.planZone(t, c.c, c.rot, t.size, this.frontOf(t, c));
  }

  /** The zone a free cell of town t gets at a size. */
  private zoneFor(t: Town, c: Cell, size: number): ZoneId | null {
    if (this.onSquare(t, c.c)) return null;
    const P = this.planOf(t);
    P.index(t.reach / BLOCK + 1);
    const own = this.frontOf(t, c);
    // keep clear of the streets still to come, so the town never has to clear a home to lay one
    if (P.nearOpen(c.c, CORRIDOR, own?.k ?? null, (k) => !t.built.has(k) && !t.failed.has(k))) return null;
    // the town's greens stay open, and here and there a garden between the houses
    const face = own ? P.faceOf(own.e, c.c, own.foot) : null;
    if (face && P.green(face[0], face[1]) && !this.greenLost(t, P, face[0], face[1])) return null;
    const z = this.planZone(t, c.c, c.rot, size, own);
    if (own && face && (z === "resLow" || z === "resRow") && P.garden(own.k, face[0] * 7919 + face[1], own.along)) return null;
    // (no new homes in a plant's smoke and noise, nor shops deep in it: the land is left open)
    const n = this.nuisanceAt(c.c);
    return n > (ZONE_GROUP[z] === "res" ? NUISANCE_HOMES : NUISANCE_SHOPS) ? null : z;
  }

  /**
   * What a town plans for land at p fronting a street that runs at angle rot: its ring for its size, or shops and
   * offices along its high streets (HIGH_STREET). `own` is the planned street it fronts, when already known.
   */
  planZone(t: Town, p: V2, rot: number, size = t.size, own?: EdgeHit | null): ZoneId {
    const r = dist(p, t.c) / BLOCK;
    const ring = ringZone(size, r);
    const hs = HIGH_STREET[Math.min(HIGH_STREET.length - 1, size)];
    if (!hs || ZONE_GROUP[ring] === "com" || r >= (this.highReach.get(t.id) ?? 0)) return ring;
    // the line of the plan the street it fronts is on (a lot is never more than half a block deep)
    if (own === undefined) {
      const P = this.planOf(t);
      P.index(t.reach / BLOCK + 1);
      own = P.edgeAt(p, fromAngle(rot), BLOCK / 2, 0.8);
    }
    if (!own) return ring;
    const line = own.e[1] === own.e[3] ? own.e[1] : own.e[0];
    return highLine(size, Math.abs(line)) ? hs : ring;
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
    const P = this.planOf(t);
    let got = this.bfronts.get(b);
    if (!got || got.P !== P) {
      P.index(t.reach / BLOCK + 1);
      this.bfronts.set(b, (got = { P, hit: P.edgeAt(b.front, fromAngle(b.rot), 10, 0.7) }));
    }
    const want = this.planZone(t, b.c, b.rot, t.size, got.hit);
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
    // (a new day's pace from its first moment: the last rebuild was on an earlier day, though the day's tallies are
    // only reset after this tick)
    if (Number.isFinite(t.redevAt) && Math.floor(t.redevAt / DAY) < Math.floor(this.g.time / DAY)) t.redevToday = 0;
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
    this.watchTraffic();
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
   * Every game hour: each town's people go into its history, its supply rolls on (the loads a day of each need
   * delivered over the last SUPPLY_HOURS, towns.ts) and it grows or shrinks by an hour's worth of it, so a well-fed
   * town grows all day long rather than once at the day's end.
   */
  hourly() {
    this.census();
    for (const t of this.list) {
      const H = t.hist;
      H.pop.push(t.pop);
      H.households.push(t.households);
      if (H.pop.length > HIST_HOURS) { H.pop.splice(0, H.pop.length - HIST_HOURS); H.households.splice(0, H.households.length - HIST_HOURS); }
      const hours = (t.hours ??= []);
      // (what each need read, and its averages, just before the roll: a need that falls below "Enough" with this hour
      // starts its grace from them)
      const before = Object.fromEntries(needsOf(t.pop).map((p) => [p, deliveredLately(t, p)]));
      // (as landed, never as held by a grace: a grace never carries over into the next one)
      const was = { rate: averageSupply(hours), day: averageSupply(hours.slice(-24)) };
      hours.push(t.hourNow ?? {});
      t.hourNow = {};
      if (hours.length > SUPPLY_HOURS) hours.splice(0, hours.length - SUPPLY_HOURS);
      t.rate = averageSupply(hours);
      const lastDay = averageSupply(hours.slice(-24));
      rollGrace(t, this.g.time, before, was, t.rate, lastDay);
      t.supply = supplyShare(t.rate, t.pop);
      this.grow(t, 1 / 24, lastDay);
    }
    this.rolledAt = this.g.time;
  }

  /** sim time the hour last rolled over (not saved: a loaded game is at most an hour out on it) */
  private rolledAt = 0;
  /** Debug and tests (Game.fastForward): every town grows this many times its pace. Never set in play. */
  pace = 1;

  /**
   * Sim seconds until what a town has landed of a need would read below "Enough", with only the loads `arriving`
   * still to come (supply.ts dipIn): what the company's plants send ahead on.
   */
  dipIn(id: number, p: Product, arriving: readonly { at: number; n: number }[]): number {
    const t = this.byId.get(id);
    if (!t) return Infinity;
    return dipIn(t, p, this.g.time, Math.min(1, Math.max(0, (this.g.time - this.rolledAt) / HOUR)), arriving);
  }

  /**
   * A town grows in bands on its supply level (towns.ts, "growth in bands"): the share of a day's use of its
   * worst-supplied need it has been getting over the last two days. From GROW_FROM it grows by `share` of a day at
   * its pace (growthPerDay, times growthShare: very little at first, all of it at 100%), from HOLD_FROM it holds,
   * and below HOLD_FROM for SHRINK_AFTER hours in a row it shrinks, slowly, never below what the supply still covers.
   * The company's landmarks make it grow faster and its extras supplied add a little; neither makes it shrink faster.
   */
  private grow(t: Town, share: number, lastDay: Partial<Record<Product, number>>) {
    if (t.fixed) return;
    const rate = t.rate ?? {};
    const S = supportOf(rate, t.pop);
    const L = supplyLevel(rate, t.pop);
    // (a shortfall is judged on the better of the last two days and the last one: a day's gap, made good since,
    // isn't held against it for the two days it stays in the average; and only on the needs of its size, so a
    // hamlet's planks, opened early, never shrink it)
    const better: Partial<Record<Product, number>> = { ...rate };
    for (const [p, n] of Object.entries(lastDay) as [Product, number][]) better[p] = Math.max(better[p] ?? 0, n);
    const low = supplyLevel(better, t.pop, (p) => countsForShrinking(p, t.pop)).level;
    // (in households: the people a household has here, on average)
    const per = t.households > 0 ? t.pop / t.households : PER_HOME;
    const floor = supportOf(better, t.pop).floor / per;
    const before = t.target;
    const pace = growthPerDay(t.pop) * townBoost(t.id, this.g.buildings.sites).growth * this.g.orders.boost(t.id).growth * comfortOf(rate, t.pop);
    const grows = pace * growthShare(L.level) * this.pace;
    if (t.pop < SETTLING) {
      // a new settlement fills its first streets regardless, faster still if supplied
      t.target += Math.max(SETTLE_RATE, grows) * share;
      t.lack = 0;
    } else {
      t.target += grows * share;
      // a shortfall that lasts: it shrinks, slowly, toward what the supply still covers (a hamlet nobody serves yet
      // holds on rather than dwindling away)
      const short = low < HOLD_FROM && t.pop >= SETTLING * 1.5;
      t.lack = short ? (t.lack ?? 0) + share * 24 : Math.max(0, (t.lack ?? 0) - share * 48);
      // (supply that has dropped for now holds it where it is: its target goes no higher, and nobody is pushed out)
      if (t.lack >= SHRINK_AFTER) {
        const to = Math.max(floor, Math.min(t.target, t.households) - Math.max(1, t.households * SHRINK_RATE) * share);
        t.target = Math.min(t.target, to);
      }
    }
    // (the target never runs far ahead of the town: a dry spell isn't banked as growth for later)
    t.target = Math.max(0, Math.min(t.target, Math.max(t.households, START_HOUSEHOLDS) * 1.4 + 6));
    t.trend = (t.target - before) / share;
    t.supports = Math.round(S.pop);
    t.level = L.level;
    // (what holds it back: its worst-supplied need, while it grows at under half its full pace)
    t.limit = L.by && growthShare(L.level) < 0.5 ? L.by : undefined;
  }

  /** A day is over: its deliveries go into the town's history, and today's tallies start again. */
  daily() {
    this.census();
    for (const t of this.list) {
      t.yesterday = t.today;
      t.today = {};
      if (t.cars) t.cars *= 1 - CAR_SCRAP;
      // (unless the new day's first rebuild started in this very tick)
      if (!Number.isFinite(t.redevAt) || Math.floor(t.redevAt / DAY) < Math.floor(this.g.time / DAY)) t.redevToday = 0;
      // (its own roads: a busy street widened, and in time one road out of town)
      this.widen(t);
      if ((this.g.day + t.id) % 3 === 0) this.reachOut(t);
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
        ...(t.spawned ? { spawned: true } : {}), hours: t.hours ?? [], hourNow: t.hourNow ?? {}, layout: t.layout,
        ...(t.widened ? { widened: t.widened } : {}), ...(t.outward !== undefined ? { outward: t.outward } : {}),
        ...(t.lack ? { lack: t.lack } : {}), ...(t.grace ? { grace: t.grace } : {}),
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
        // (a town from a save before the plans keeps its square grid)
        layout: x.layout ?? PLAN_GRID, pop: 0, households: 0, homes: 0, shops: 0, reach: BLOCK,
      };
      // (a town from a save before the two-day supply: its last day's deliveries stand for its hours so far)
      if (!t.hours?.length && Object.keys(t.yesterday).length) {
        const h = Object.fromEntries(Object.entries(t.yesterday).map(([p, n]) => [p, n / 24]));
        t.hours = Array.from({ length: 24 }, () => ({ ...h }));
      }
      t.rate = averageSupply(t.hours ?? []);
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
