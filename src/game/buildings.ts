import { BUILDING_TYPES, ROAD_TYPES, type BuildingKind } from "../config";
import { type V2, add, angleOf, cubicTangent, dist, dot, norm, rectCorners, rectDistance, right, scale, sub, wrapAngle } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { cubicClosest } from "../roads/planner";
import type { Access } from "../sim/router";
import type { ZoneId } from "./zones";
import type { PlantState } from "./industry";
import { GATE_REACH, GATE_SETBACK, siteFrame } from "./sites";

export interface Lot {
  block: string; // zone block key
  col0: number; // first column
  w: number; // columns
  d: number; // rows
}

export interface Building {
  id: number;
  /** the town it belongs to (homes and shops: the town whose streets it fronts) */
  town?: number;
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
  stock: number; // goods in stock (cargo units)
  prodT: number;
  visits: number; // decaying count of customers
  /** shops: customers so far today, and over the last full day */
  custToday?: number;
  custDay?: number;
  born: number; // sim time it appeared
  /** One of the company's extractors or plants (see game/industry.ts). */
  plant?: PlantState;
  /** Placed by the player (see game/placed.ts), not grown on zoned land. */
  placed?: boolean;
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
  /** Zoned buildings the new one would replace (placed buildings clear growables, as in CS2). */
  clears?: number[];
  /** A site standing free, with no road at its gate yet (it waits for one). */
  free?: boolean;
  /** The road its gate faces, by type (when it has one). */
  faces?: string;
}

/** How the player has a placed building turned. */
export interface PlaceOpts {
  /** turn (radians) added with , and . : a turned site stands free where the cursor is */
  turn?: number;
  /** the way the bottom of the screen points: a site with no road near faces its gate there */
  down?: V2;
}

/** Where a site's gate would join a road: the access, the kerb point, and its pose put the road's way round. */
export interface GateAccess { access: Access; front: V2; side: 1 | -1; rot: number; type: string }

/** How far round a placed site looks for a road to turn its gate toward (m). */
const FACE_REACH = 300;

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

  /**
   * Where a building of `kind` would go near p. Beside a road that allows driveways it faces that road (as before);
   * with none in reach, or turned by the player, it stands free with the cursor at its centre, its gate turned toward
   * the nearest road (else toward the bottom of the screen), and waits for a road to its gate.
   */
  placement(kind: BuildingKind, p: V2, world: PlaceWorld, soft?: (o: Building) => boolean, opts: PlaceOpts = {}): Placement | null {
    const T = BUILDING_TYPES[kind];
    const turned = Math.abs(wrapAngle(opts.turn ?? 0)) > 1e-3;
    const snap = turned ? null : this.snapPose(kind, p);
    if (snap) {
      const pl = this.check(T, snap.c, snap.rot, snap.side, snap.front, world, soft);
      if (!pl.ok) return pl;
      // driveway must leave the road clear of junction mouths
      const s = this.net.segs.get(snap.seg)!, g = this.net.segGeom.get(snap.seg)!;
      const sC = g.center.length * arcFrac(s.c, snap.t, g.center.pts);
      if (sC < g.trimA + 4 || sC > g.center.length - g.trimB - 4) return { ...pl, ok: false, reason: "Too close to a junction" };
      pl.access = { seg: snap.seg, s: sC, p: snap.front };
      pl.faces = ROAD_TYPES[s.type].name;
      return pl;
    }
    if (T.zone !== "placed") return null;
    const pose = this.freePose(kind, p, opts);
    const pl = this.check(T, p, pose.rot, 1, pose.front, world, soft);
    pl.free = true;
    if (!pl.ok) return pl;
    // a road already runs past where its gate would be: it is connected straight away
    const ga = this.gateAccess(p, pose.rot, 1, T.d / 2);
    if (ga) Object.assign(pl, { access: ga.access, front: ga.front, side: ga.side, rot: ga.rot, free: false, faces: ga.type });
    return pl;
  }

  /** Facing the closest road that allows driveways, set back from it (null: none in reach). */
  private snapPose(kind: BuildingKind, p: V2): { c: V2; rot: number; side: 1 | -1; front: V2; seg: number; t: number } | null {
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
    const setback = g.width / 2 + GATE_SETBACK; // driveway length before the lot starts
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
    return { c, rot, side, front, seg: best.seg, t: best.t };
  }

  /** A free-standing site at p: its gate toward the nearest road (or the bottom of the screen), then turned. */
  private freePose(kind: BuildingKind, p: V2, opts: PlaceOpts): { rot: number; front: V2 } {
    const T = BUILDING_TYPES[kind];
    const net = this.net;
    let gd = opts.down ?? { x: 0, y: 1 };
    let near: { d: number; seg: number; t: number; q: V2 } | null = null;
    const R = FACE_REACH + T.d / 2;
    for (const id of net.segsNear(p.x - R, p.y - R, p.x + R, p.y + R)) {
      const s = net.segs.get(id)!;
      if (!ROAD_TYPES[s.type].allowsAccess) continue;
      const r = cubicClosest(s.c, p);
      if (r.d < R && (!near || r.d < near.d)) near = { d: r.d, seg: id, t: r.t, q: r.p };
    }
    if (near) {
      // square to the road, gate on the side toward it
      const n = right(norm(cubicTangent(net.segs.get(near.seg)!.c, near.t)));
      gd = dot(sub(near.q, p), n) >= 0 ? n : scale(n, -1);
    }
    const t = opts.turn ?? 0, cs = Math.cos(t), sn = Math.sin(t);
    gd = norm({ x: gd.x * cs - gd.y * sn, y: gd.x * sn + gd.y * cs });
    // side 1: the gate looks along -right(fromAngle(rot))
    const rot = Math.atan2(gd.x, -gd.y);
    return { rot, front: add(p, scale(gd, T.d / 2 + GATE_SETBACK)) };
  }

  /** Can a lot stand here: land, water, mountains, other buildings and roads. */
  private check(T: (typeof BUILDING_TYPES)[BuildingKind], c: V2, rot: number, side: 1 | -1, front: V2, world: PlaceWorld, soft?: (o: Building) => boolean): Placement {
    const hw = T.w / 2, hd = T.d / 2;
    const pl: Placement = { ok: true, c, rot, front, access: null, side, blockers: [] };
    const fail = (reason: string, blockers: number[] = []) => ({ ...pl, ok: false, reason, blockers });
    // the land under it, every ~24 m (a stream through a big site shows up)
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y, y: u.x };
    const na = Math.max(2, Math.ceil((2 * hw) / 24)), nb = Math.max(2, Math.ceil((2 * hd) / 24));
    const samples: V2[] = [];
    for (let i = 0; i <= na; i++) for (let j = 0; j <= nb; j++) {
      const a = -hw + (2 * hw * i) / na, b = -hd + (2 * hd * j) / nb;
      samples.push({ x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b });
    }
    samples.push(c);
    // (a site claims its whole plot from the tile its middle stands on: a big plot needn't own every tile it spills over)
    if (T.zone === "placed" && world.inBounds(c) && !world.unlocked(c)) return fail("Not your land: buy the tile under its middle first (M)");
    for (const k of samples) {
      if (!world.inBounds(k)) return fail("Outside the map");
      if (T.zone !== "placed" && !world.unlocked(k)) return fail("Not your land: buy this tile first (M)");
      if (world.isWater(k)) return fail("Can't build on water");
    }
    // mountains
    for (const k of samples) if (world.isMountain(k)) return fail("Mountain in the way");
    // other buildings
    const over = this.list.filter((o) => obbOverlap(c, hw + 0.3, hd + 0.3, rot, o.c, o.hw, o.hd, o.rot));
    const hard = over.filter((o) => !soft?.(o));
    if (hard.length) return fail(hard.some((o) => o.placed) && T.zone === "placed" ? "Another site is here" : "Another building is here", hard.map((o) => o.id));
    pl.clears = over.filter((o) => soft?.(o)).map((o) => o.id);
    // roads (any level below clearance): the lot must not cover a road surface, bar the way up to a site's gate
    const gate = T.zone === "placed" ? siteFrame(c, rot, side, hd).gate : null;
    const net = this.net;
    for (const id of net.segsNear(c.x - hw - hd, c.y - hw - hd, c.x + hw + hd, c.y + hw + hd)) {
      const gg = net.segGeom.get(id)!;
      const P = gg.center.pts;
      for (let i = 0; i < P.length; i++) {
        if (gg.hs[i] > 6 && (i + 1 >= P.length || gg.hs[i + 1] > 6)) continue;
        // (in short steps: a straight road has only its two ends)
        const q = P[i], r = P[i + 1] ?? q;
        const n = i + 1 < P.length ? Math.max(1, Math.ceil(dist(q, r) / 3)) : 1;
        for (let k = 0; k < n; k++) {
          const x = { x: q.x + ((r.x - q.x) * k) / n, y: q.y + ((r.y - q.y) * k) / n };
          const rd = rectDistance(x, c, hw, hd, rot);
          if (rd >= gg.width / 2 + 0.4) continue;
          if (gate && rd > 0.8 && dist(x, gate) < GATE_REACH + 4) continue;
          return fail("Road in the way");
        }
      }
    }
    return pl;
  }

  /**
   * The road a site's gate joins: one that passes in front of the gate, or ends there, within GATE_REACH of it.
   * Null: none (the site waits for one).
   */
  gateAccess(c: V2, rot: number, side: 1 | -1, hd: number): GateAccess | null {
    const net = this.net;
    const f = siteFrame(c, rot, side, hd);
    const G = f.gate, out = scale(f.into, -1);
    const R = GATE_REACH + 14;
    let best: { seg: number; t: number; q: V2; edge: number } | null = null;
    for (const id of net.segsNear(G.x - R, G.y - R, G.x + R, G.y + R)) {
      const s = net.segs.get(id)!;
      if (!ROAD_TYPES[s.type].allowsAccess) continue;
      const g = net.segGeom.get(id)!;
      const r = cubicClosest(s.c, G);
      if (net.heightOnSeg(id, r.t) > 0.5) continue;
      const edge = r.d - g.width / 2;
      const rel = sub(r.p, G);
      // in front of the gate: outside the fence, and not off to one side of it
      if (edge > GATE_REACH || dot(rel, out) < 0.5 || Math.abs(dot(rel, f.along)) > GATE_REACH + g.width / 2) continue;
      if (!best || edge < best.edge) best = { seg: id, t: r.t, q: r.p, edge };
    }
    if (!best) return null;
    const s = net.segs.get(best.seg)!, g = net.segGeom.get(best.seg)!;
    const to = sub(G, best.q), L = Math.hypot(to.x, to.y) || 1;
    const front = add(best.q, scale(to, Math.min(g.width / 2, L) / L));
    let sC = g.center.length * arcFrac(s.c, best.t, g.center.pts);
    // (kept off the junction mouths, where a car can't stop)
    const lo = g.trimA + 2, hi = g.center.length - g.trimB - 2;
    if (hi > lo) sC = Math.max(lo, Math.min(hi, sC));
    const rs = sideOf(s.c, best.t, c);
    // (rot, side) and (rot + PI, -side) are the same plot: keep its gate where it is
    return { access: { seg: best.seg, s: sC, p: front }, front, side: rs, rot: rs === side ? rot : wrapAngle(rot + Math.PI), type: ROAD_TYPES[s.type].name };
  }

  add(kind: BuildingKind, pl: Placement, now = 0): Building {
    const T = BUILDING_TYPES[kind];
    return this.insert({
      id: this.nextId++, kind, c: pl.c, rot: pl.rot, hw: T.w / 2, hd: T.d / 2, front: pl.front, access: pl.access, side: pl.side,
      level: 1, cap: T.jobs, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null,
      stock: T.shelves ? 1 : 0, prodT: 0, visits: 0, born: now,
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
      // a road may come right up to a site's gate (not through its fence)
      const gate = b.placed ? siteFrame(b.c, b.rot, b.side, b.hd).gate : null;
      for (const p of pts) {
        const d = rectDistance(p, b.c, b.hw, b.hd, b.rot);
        if (d >= hw) continue;
        if (gate && d > 0.8 && dist(p, gate) < GATE_REACH + 4) continue;
        out.push(b.id);
        break;
      }
    }
    return out;
  }

  at(p: V2): Building | null {
    for (const b of this.list) if (rectDistance(p, b.c, b.hw, b.hd, b.rot) < 0.5) return b;
    return null;
  }

  /**
   * After road edits: re-attach driveways to whatever road now runs past them. A site whose gate has no road looks
   * for one passing in front of it. Returns the sites that just got a road to their gate.
   */
  reattach(): Building[] {
    const net = this.net;
    const joined: Building[] = [];
    for (const b of this.list) {
      const a = b.access;
      if (a && net.segs.has(a.seg) && ROAD_TYPES[net.segs.get(a.seg)!.type].allowsAccess) {
        // seg may have been rebuilt (new trims): refresh the arc-length
        const g = net.segGeom.get(a.seg)!;
        const s = net.segs.get(a.seg)!;
        const r = cubicClosest(s.c, b.front);
        if (r.d < g.width / 2 + 1.5) {
          a.s = g.center.length * arcFrac(s.c, r.t, g.center.pts);
          const side = sideOf(s.c, r.t, b.c);
          // (a site keeps its gate where it is whichever way the road now runs)
          if (b.placed && side !== b.side) b.rot = wrapAngle(b.rot + Math.PI);
          b.side = side;
          continue;
        }
      }
      const had = !!b.access;
      b.access = null;
      if (b.placed) {
        const ga = this.gateAccess(b.c, b.rot, b.side, b.hd);
        if (ga) {
          Object.assign(b, { access: ga.access, front: ga.front, side: ga.side, rot: ga.rot });
          if (!had) joined.push(b);
        } else {
          const f = siteFrame(b.c, b.rot, b.side, b.hd);
          b.front = add(f.gate, scale(f.into, -GATE_SETBACK));
        }
        continue;
      }
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
    return joined;
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
      if (b.access?.seg !== segId) { stuck.push(id); continue; }
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
