import { BUILDING_TYPES, ROAD_TYPES, type BuildingKind, type Cargo } from "../config";
import { type V2, add, angleOf, cubicTangent, dist, dot, norm, rectCorners, rectDistance, right, scale, sub } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { cubicClosest } from "../roads/planner";
import type { Access } from "../sim/router";
import type { ZoneId } from "./zones";

export interface Lot {
  block: string; // zone block key
  col0: number; // first column
  w: number; // columns
  d: number; // rows
}

export interface Building {
  id: number;
  kind: BuildingKind; // model
  c: V2; // footprint centre
  rot: number; // angle of the frontage (road tangent)
  hw: number; // half frontage
  hd: number; // half depth
  front: V2; // driveway meets the kerb here
  access: Access | null; // null = cut off from the road network
  side: 1 | -1; // building side relative to the access seg's a->b direction
  /** Zoned building (grown by demand); undefined for placed ones. */
  zone?: ZoneId;
  lot?: Lot;
  level: number; // 1-5
  cap: number; // households (residential) or jobs
  fit: number; // model scale
  tall: number; // model height multiplier
  built: number; // construction progress 0..1
  abandoned: number; // sim time it was abandoned (0 = in use)
  lv: number; // land value 0..100
  upT: number; // seconds the land value has supported the next level
  badT: number; // seconds the place has been failing
  problem: string | null; // what's wrong, for the inspector and icons
  // simulation state
  stock: number; // goods or materials in stock (cargo units)
  out: number; // produced cargo waiting to ship
  prodT: number;
  visits: number; // decaying count of customers
  born: number; // sim time it appeared
  // city services (see game/services.ts)
  /** A placed service building (fire station, school...). */
  svc?: boolean;
  /** Service vehicles out on a call (service buildings). */
  busy?: number;
  /** Students or patients (schools, clinics). */
  users?: number;
  /** Garbage waiting for collection (any building in use). */
  garbage?: number;
  /** Crime build-up. */
  crime?: number;
  /** Sim time a fire broke out; 0 = not burning. */
  fire?: number;
}

export interface BuildingMove {
  id: number;
  c0: V2; f0: V2; // before
  c1: V2; f1: V2; // after
}

export interface Placement {
  ok: boolean;
  reason?: string;
  c: V2;
  rot: number;
  front: V2;
  access: Access | null;
  side: 1 | -1;
  blockers: number[];
  /** Zoned buildings the new one would replace (service buildings clear growables, as in CS2). */
  clears?: number[];
}

export interface PlaceWorld {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
  unlocked(p: V2): boolean;
  inBounds(p: V2): boolean;
}

export class Buildings {
  list: Building[] = [];
  byId = new Map<number, Building>();
  nextId = 1;

  constructor(private net: RoadNetwork) {}

  footprint(b: { c: V2; hw: number; hd: number; rot: number }, pad = 0): V2[] {
    return rectCorners(b.c, b.hw + pad, b.hd + pad, b.rot);
  }

  /** Where a building of `kind` would go near p: facing the closest road that allows driveways. */
  placement(kind: BuildingKind, p: V2, world: PlaceWorld, soft?: (o: Building) => boolean): Placement | null {
    const T = BUILDING_TYPES[kind];
    const net = this.net;
    let best: { seg: number; t: number; d: number; q: V2 } | null = null;
    const reach = T.d + 30;
    for (const id of net.segsNear(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
      const s = net.segs.get(id)!;
      const g = net.segGeom.get(id)!;
      if (!ROAD_TYPES[s.type].allowsAccess) continue;
      const r = cubicClosest(s.c, p);
      if (net.heightOnSeg(id, r.t) > 0.5) continue;
      if (r.d > g.width / 2 + T.d + 6) continue;
      if (!best || r.d < best.d) best = { seg: id, t: r.t, d: r.d, q: r.p };
    }
    if (!best) return null;
    const s = net.segs.get(best.seg)!;
    const g = net.segGeom.get(best.seg)!;
    const tan = norm(cubicTangent(s.c, best.t));
    const n = right(tan);
    const side: 1 | -1 = dot(sub(p, best.q), n) >= 0 ? 1 : -1;
    const hw = T.w / 2, hd = T.d / 2;
    const setback = g.width / 2 + 2.2; // driveway length before the lot starts
    // slide along the road so lots pack neatly against neighbours on the same side
    let q = best.q;
    let c = add(q, scale(n, side * (setback + hd)));
    let rot = angleOf(tan);
    for (const o of this.list) {
      if (dist(o.c, c) > hw + o.hw + 6 || Math.abs(Math.cos(o.rot - rot)) < 0.95) continue;
      const along = dot(sub(c, o.c), tan);
      const across = Math.abs(dot(sub(c, o.c), n));
      if (across > 3) continue;
      const need = hw + o.hw + 0.6;
      if (Math.abs(along) < need + 3.5) {
        const shift = (along >= 0 ? need : -need) - along;
        q = add(q, scale(tan, shift));
        const r = cubicClosest(s.c, q);
        q = r.p;
        const t2 = norm(cubicTangent(s.c, r.t));
        c = add(q, scale(right(t2), side * (setback + hd)));
        rot = angleOf(t2);
        best.t = r.t;
      }
    }
    const nn = right(norm(cubicTangent(s.c, best.t)));
    const front = add(q, scale(nn, side * (g.width / 2)));
    const pl: Placement = { ok: true, c, rot, front, access: null, side, blockers: [] };
    // checks
    const fail = (reason: string, blockers: number[] = []) => ({ ...pl, ok: false, reason, blockers });
    const corners = rectCorners(c, hw, hd, rot);
    const samples = [...corners, c, ...corners.map((k) => scale(add(k, c), 0.5))];
    for (const k of samples) {
      if (!world.inBounds(k)) return fail("Outside the map");
      if (!world.unlocked(k)) return fail("Area not unlocked yet");
      if (world.isWater(k)) return fail("Can't build on water");
    }
    // mountains: only mines, and their back must be dug into the slope
    const frontMid = add(c, scale(nn, -side * hd * 0.9));
    if (T.needsMountain) {
      // the shaft may start a few metres behind the lot: forgiving, so a road needn't hug the cliff
      const tan2 = norm(cubicTangent(s.c, best.t));
      const probes = [0.8, 1.15, 1.5].flatMap((k) => [-0.5, 0, 0.5].map((a) => add(add(c, scale(nn, side * hd * k)), scale(tan2, a * hw))));
      if (!probes.some((k) => world.isMountain(k))) return fail("Mines must back onto a mountain");
      if (world.isMountain(frontMid)) return fail("Entrance is inside the mountain");
    } else {
      for (const k of samples) if (world.isMountain(k)) return fail("Mountain in the way");
    }
    // other buildings
    const over = this.list.filter((o) => obbOverlap(c, hw + 0.3, hd + 0.3, rot, o.c, o.hw, o.hd, o.rot));
    const hit = over.filter((o) => !soft?.(o)).map((o) => o.id);
    if (hit.length) return fail("Another building is here", hit);
    pl.clears = over.filter((o) => soft?.(o)).map((o) => o.id);
    // roads (any level below clearance): the lot must not cover a road surface
    for (const id of net.segsNear(c.x - hw - hd, c.y - hw - hd, c.x + hw + hd, c.y + hw + hd)) {
      const gg = net.segGeom.get(id)!;
      for (let i = 0; i < gg.center.pts.length; i++) {
        if (gg.hs[i] > 6) continue;
        if (rectDistance(gg.center.pts[i], c, hw, hd, rot) < gg.width / 2 + 0.4) return fail("Road in the way");
      }
    }
    // driveway must leave the road clear of junction mouths
    const sC = g.center.length * arcFrac(s.c, best.t, g.center.pts);
    if (sC < g.trimA + 4 || sC > g.center.length - g.trimB - 4) return fail("Too close to a junction");
    pl.access = { seg: best.seg, s: sC, p: front };
    return pl;
  }

  add(kind: BuildingKind, pl: Placement, now = 0): Building {
    const T = BUILDING_TYPES[kind];
    return this.insert({
      id: this.nextId++, kind, c: pl.c, rot: pl.rot, hw: T.w / 2, hd: T.d / 2, front: pl.front, access: pl.access, side: pl.side,
      level: 1, cap: T.jobs, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null,
      stock: T.consumes ? 1 : 0, out: 0, prodT: 0, visits: 0, born: now,
    });
  }

  insert(b: Building): Building {
    this.list.push(b);
    this.byId.set(b.id, b);
    if (b.id >= this.nextId) this.nextId = b.id + 1;
    return b;
  }

  remove(id: number) {
    const b = this.byId.get(id);
    if (!b) return;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(b), 1);
  }

  /** Buildings whose footprint is within `hw` of any point. */
  hit(pts: V2[], hw: number): number[] {
    if (!this.list.length) return [];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const out: number[] = [];
    for (const b of this.list) {
      const r = b.hw + b.hd + hw;
      if (b.c.x < x0 - r || b.c.x > x1 + r || b.c.y < y0 - r || b.c.y > y1 + r) continue;
      for (const p of pts) {
        if (rectDistance(p, b.c, b.hw, b.hd, b.rot) < hw) { out.push(b.id); break; }
      }
    }
    return out;
  }

  at(p: V2): Building | null {
    for (const b of this.list) if (rectDistance(p, b.c, b.hw, b.hd, b.rot) < 0.5) return b;
    return null;
  }

  /** After road edits: re-attach driveways to whatever road now runs past them. */
  reattach() {
    const net = this.net;
    for (const b of this.list) {
      const a = b.access;
      if (a && net.segs.has(a.seg) && ROAD_TYPES[net.segs.get(a.seg)!.type].allowsAccess) {
        // seg may have been rebuilt (new trims): refresh the arc-length
        const g = net.segGeom.get(a.seg)!;
        const s = net.segs.get(a.seg)!;
        const r = cubicClosest(s.c, b.front);
        if (r.d < g.width / 2 + 1.5) { a.s = g.center.length * arcFrac(s.c, r.t, g.center.pts); b.side = sideOf(s.c, r.t, b.c); continue; }
      }
      b.access = null;
      for (const id of net.segsNear(b.front.x - 6, b.front.y - 6, b.front.x + 6, b.front.y + 6)) {
        const s = net.segs.get(id)!;
        if (!ROAD_TYPES[s.type].allowsAccess) continue;
        const g = net.segGeom.get(id)!;
        const r = cubicClosest(s.c, b.front);
        if (r.d < g.width / 2 + 1.5 && net.heightOnSeg(id, r.t) < 0.5) {
          b.access = { seg: id, s: g.center.length * arcFrac(s.c, r.t, g.center.pts), p: b.front };
          b.side = sideOf(s.c, r.t, b.c);
          break;
        }
      }
    }
  }

  /**
   * Widening `segId` to half-width `halfW` covers the lots in `ids`: push each one straight back so it
   * keeps the usual driveway setback. A lot that faces another road, is a mine, or has no free land
   * behind it can't move, and is returned in `stuck`.
   */
  pushBack(segId: number, halfW: number, ids: number[], world: PlaceWorld): { moves: BuildingMove[]; stuck: number[] } {
    const net = this.net;
    const s = net.segs.get(segId)!;
    const moving = new Set(ids);
    const moves: BuildingMove[] = [];
    const stuck: number[] = [];
    for (const id of ids) {
      const b = this.byId.get(id);
      if (!b) continue;
      if (b.access?.seg !== segId || BUILDING_TYPES[b.kind].needsMountain) { stuck.push(id); continue; }
      const rc = cubicClosest(s.c, b.c);
      const n = norm(sub(b.c, rc.p));
      const mv = halfW + 2.2 + b.hd - rc.d;
      if (mv <= 0) continue;
      const rf = cubicClosest(s.c, b.front);
      const nf = norm(sub(b.front, rf.p));
      moves.push({ id, c0: b.c, f0: b.front, c1: add(b.c, scale(n, mv)), f1: add(rf.p, scale(nf, halfW)) });
    }
    const target = new Map(moves.map((m) => [m.id, m.c1]));
    for (const m of moves) {
      const b = this.byId.get(m.id)!;
      const c = m.c1;
      const corners = rectCorners(c, b.hw, b.hd, b.rot);
      const samples = [...corners, c, ...corners.map((k) => scale(add(k, c), 0.5))];
      let ok = samples.every((k) => world.inBounds(k) && world.unlocked(k) && !world.isWater(k) && !world.isMountain(k));
      if (ok) ok = !this.list.some((o) => o.id !== b.id && (!moving.has(o.id) || target.has(o.id)) &&
        obbOverlap(c, b.hw + 0.3, b.hd + 0.3, b.rot, target.get(o.id) ?? o.c, o.hw, o.hd, o.rot));
      if (ok) {
        const r = b.hw + b.hd;
        roads: for (const id of net.segsNear(c.x - r, c.y - r, c.x + r, c.y + r)) {
          const gg = net.segGeom.get(id)!;
          const w2 = id === segId ? halfW : gg.width / 2;
          for (let i = 0; i < gg.center.pts.length; i++) {
            if (gg.hs[i] > 6) continue;
            if (rectDistance(gg.center.pts[i], c, b.hw, b.hd, b.rot) < w2 + 0.4) { ok = false; break roads; }
          }
        }
      }
      if (!ok) stuck.push(m.id);
    }
    return { moves: stuck.length ? [] : moves, stuck };
  }

  /** Put buildings at one end of their moves (`to` = true: the new spots). */
  applyMoves(moves: BuildingMove[], to: boolean) {
    for (const m of moves) {
      const b = this.byId.get(m.id);
      if (!b) continue;
      b.c = to ? m.c1 : m.c0;
      b.front = to ? m.f1 : m.f0;
    }
  }

  produces(b: Building): Cargo | undefined {
    return BUILDING_TYPES[b.kind].produces;
  }
}

function sideOf(c: import("../core/math").Cubic, t: number, p: V2): 1 | -1 {
  const tan = norm(cubicTangent(c, t));
  const q = cubicClosest(c, p).p;
  return dot(sub(p, q), right(tan)) >= 0 ? 1 : -1;
}

/** Fraction of arc length at cubic parameter t, using the sampled centreline. */
function arcFrac(c: import("../core/math").Cubic, t: number, pts: V2[]): number {
  // centreline points are arc-length even; find the closest sample to cubicAt(t)
  let best = 0, bd = Infinity;
  const target = pointAt(c, t);
  for (let i = 0; i < pts.length; i++) {
    const d = dist(pts[i], target);
    if (d < bd) { bd = d; best = i; }
  }
  return pts.length > 1 ? best / (pts.length - 1) : 0;
}

function pointAt(c: import("../core/math").Cubic, t: number): V2 {
  const u = 1 - t;
  return {
    x: u * u * u * c.p0.x + 3 * u * u * t * c.p1.x + 3 * u * t * t * c.p2.x + t * t * t * c.p3.x,
    y: u * u * u * c.p0.y + 3 * u * u * t * c.p1.y + 3 * u * t * t * c.p2.y + t * t * t * c.p3.y,
  };
}

/** Separating-axis test for two oriented rectangles. */
export function obbOverlap(c1: V2, hw1: number, hd1: number, r1: number, c2: V2, hw2: number, hd2: number, r2: number): boolean {
  const A = rectCorners(c1, hw1, hd1, r1), B = rectCorners(c2, hw2, hd2, r2);
  const axes = [r1, r1 + Math.PI / 2, r2, r2 + Math.PI / 2].map((a) => ({ x: Math.cos(a), y: Math.sin(a) }));
  for (const ax of axes) {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const p of A) { const d = dot(p, ax); a0 = Math.min(a0, d); a1 = Math.max(a1, d); }
    for (const p of B) { const d = dot(p, ax); b0 = Math.min(b0, d); b1 = Math.max(b1, d); }
    if (a1 < b0 || b1 < a0) return false;
  }
  return true;
}
