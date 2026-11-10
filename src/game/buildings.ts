import { BUILDING_TYPES, ROAD_TYPES, ZONE_SETBACK, takesGate, type BuildingKind, type RoadType } from "../config";
import { type V2, add, angleOf, cubicAt, cubicTangent, dist, dot, norm, polyAt, polyDir, rectCorners, rectDistance, right, scale, sub, wrapAngle } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { cubicClosest, type SiteTarget } from "../roads/planner";
import type { Access } from "../sim/router";
import type { ZoneId } from "./zones";
import type { PlantState, Product } from "./industry";
import { GATE_CLEAR, GATE_ENTRY, GATE_REACH, GATE_SETBACK, siteFrame } from "./sites";
import { isPlantKind } from "./industry";
import { isHall } from "./towns";
import { isCivic } from "./civics";

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
  /** Built where a town pulled down older buildings for a denser one (see TownSystem.redevelop). */
  redev?: boolean;
  /**
   * A town building site waiting for materials the company trucks in (a block or tower from Town size is put up
   * from construction parts: see settlements.ts PARTS_FOR). It doesn't go up until every load is in.
   */
  site?: { need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>> };
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
  /**
   * The way the player has the site turned (radians, absolute): it stands where the cursor is, turned so, with no
   * snapping to roads (the game lays a street to its gate instead).
   */
  rot?: number;
  /** the way the bottom of the screen points: a site with no road near faces its gate there */
  down?: V2;
}

/** Where a site's gate would join a road: the access, the kerb point, and its pose put the road's way round. */
export interface GateAccess { access: Access; front: V2; side: 1 | -1; rot: number; type: string }

/** Size of the squares Buildings.near files buildings under (m). */
const NEAR_CELL = 32;

/** How far round a placed site looks for a road to turn its gate toward (m). */
const FACE_REACH = 300;

export interface PlaceWorld {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
  inBounds(p: V2): boolean;
}

export class Buildings {
  list: Building[] = [];
  byId = new Map<number, Building>();
  nextId = 1;
  /** bumped whenever a building comes or goes */
  version = 0;
  private sitesAt = -1;
  private sitesCache: Building[] = [];
  /** the road geometry each building was last attached to (see reattach) */
  private attachedTo = new WeakMap<Building, unknown>();
  /** buildings by NEAR_CELL square their footprint reaches, as they stood at `gridAt` (see near) */
  private grid = new Map<number, Building[]>();
  private gridAt = "";
  private moved = 0;

  constructor(private net: RoadNetwork) {}

  /** Buildings whose footprint may reach within r of p (a quick first pass: test their footprints yourself). */
  near(p: V2, r: number): Building[] {
    const key = `${this.version}:${this.moved}`;
    if (key !== this.gridAt) {
      this.grid.clear();
      for (const b of this.list) this.file(b);
      this.gridAt = key;
    }
    const out = new Set<Building>();
    for (let i = Math.floor((p.x - r) / NEAR_CELL); i <= Math.floor((p.x + r) / NEAR_CELL); i++) {
      for (let j = Math.floor((p.y - r) / NEAR_CELL); j <= Math.floor((p.y + r) / NEAR_CELL); j++) {
        for (const b of this.grid.get((i + 32768) * 65536 + (j + 32768)) ?? []) if (this.byId.get(b.id) === b) out.add(b);
      }
    }
    return [...out];
  }

  /** File a building in the squares its footprint reaches (or take it out of them). */
  private file(b: Building, out = false) {
    const R = Math.hypot(b.hw, b.hd);
    for (let i = Math.floor((b.c.x - R) / NEAR_CELL); i <= Math.floor((b.c.x + R) / NEAR_CELL); i++) {
      for (let j = Math.floor((b.c.y - R) / NEAR_CELL); j <= Math.floor((b.c.y + R) / NEAR_CELL); j++) {
        const k = (i + 32768) * 65536 + (j + 32768);
        const L = this.grid.get(k);
        if (out) { const n = L ? L.indexOf(b) : -1; if (n >= 0) L!.splice(n, 1); } else if (L) L.push(b); else this.grid.set(k, [b]);
      }
    }
  }

  /** The placed buildings (company sites, power plants...): few, so loops over them stay cheap. */
  get sites(): Building[] {
    if (this.sitesAt !== this.version) { this.sitesCache = this.list.filter((b) => b.placed); this.sitesAt = this.version; }
    return this.sitesCache;
  }

  /**
   * The placed sites as the road tool sees them: a road drawn from or to anywhere over one goes to its gate (the street
   * out of it, the road it's on, or just outside it when it has none yet).
   */
  siteTargets(): SiteTarget[] {
    return this.sites.map((b) => {
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      const out = scale(f.into, -1);
      return { id: b.id, name: BUILDING_TYPES[b.kind].name, c: b.c, hw: b.hw, hd: b.hd, rot: b.rot, gate: f.gate, out, entry: add(f.gate, scale(out, GATE_ENTRY)), access: b.access?.seg };
    });
  }

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
    const turned = Math.abs(wrapAngle(opts.turn ?? 0)) > 1e-3 || (opts.rot !== undefined && T.zone === "placed");
    const snap = turned ? null : this.snapPose(kind, p);
    let snapped: Placement | null = null;
    if (snap) {
      const pl = this.check(T, snap.c, snap.rot, snap.side, snap.front, world, soft);
      // driveway must leave the road clear of junction mouths
      const s = this.net.segs.get(snap.seg)!, g = this.net.segGeom.get(snap.seg)!;
      const sC = g.center.length * arcFrac(s.c, snap.t, g.center.pts);
      if (!pl.ok) snapped = pl;
      else if (sC < g.trimA + 4 || sC > g.center.length - g.trimB - 4) snapped = { ...pl, ok: false, reason: "Too close to a junction" };
      else {
        // (a company site's gate keeps a road train's length off the junction mouths: its drive runs along to there)
        const sG = isPlantKind(kind) ? this.gateS(snap.seg, sC, true) : sC;
        if (sG === null) return { ...pl, ok: false, reason: "Too close to a junction" };
        if (sG !== sC) pl.front = this.gateKerb(snap.seg, sC, sG, pl.front);
        pl.access = { seg: snap.seg, s: sG, p: pl.front };
        pl.faces = ROAD_TYPES[s.type].name;
        return pl;
      }
      // a site that can't face the road there may still stand free where the cursor is
      if (T.zone !== "placed") return snapped;
    }
    if (T.zone !== "placed") return null;
    const pose = this.freePose(kind, p, opts);
    let ga = this.gateAccess(p, pose.rot, 1, T.d / 2, isPlantKind(kind));
    // (a road running past where its gate would be, inside its front strip: it stands back behind the strip)
    const short = ga ? this.stripShort({ placed: true, access: ga.access, c: p, rot: pose.rot, side: 1, hd: T.d / 2 } as Building) : 0;
    if (short > 0.05) {
      p = add(p, scale(siteFrame(p, pose.rot, 1, T.d / 2).into, short));
      pose.front = add(pose.front, scale(siteFrame(p, pose.rot, 1, T.d / 2).into, short));
      ga = this.gateAccess(p, pose.rot, 1, T.d / 2, isPlantKind(kind));
    }
    const pl = this.check(T, p, pose.rot, 1, pose.front, world, soft);
    pl.free = true;
    if (!pl.ok) return snapped ?? pl;
    // a road already runs past where its gate would be: it is connected straight away
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
    // (behind the front strip, as a town's homes and shops stand: the road can widen up to a divided avenue, or a
    // boulevard's carriageway, without touching the fence; its drive crosses the strip to the gate)
    const setback = siteSetback(g.width);
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
    if (opts.rot !== undefined) {
      const f = siteFrame(p, opts.rot, 1, T.d / 2);
      return { rot: opts.rot, front: add(f.gate, scale(f.into, -GATE_SETBACK)) };
    }
    let gd = opts.down ?? { x: 0, y: 1 };
    let near: { d: number; seg: number; t: number; q: V2 } | null = null;
    const R = FACE_REACH + T.d / 2;
    for (const id of net.segsNear(p.x - R, p.y - R, p.x + R, p.y + R)) {
      const s = net.segs.get(id)!;
      if (!takesGate(ROAD_TYPES[s.type])) continue;
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
    for (const k of samples) {
      if (!world.inBounds(k)) return fail("Outside the map");
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
  gateAccess(c: V2, rot: number, side: 1 | -1, hd: number, site = true): GateAccess | null {
    const net = this.net;
    const f = siteFrame(c, rot, side, hd);
    const G = f.gate, out = scale(f.into, -1);
    const R = GATE_REACH + 14;
    type Cand = { seg: number; t: number; q: V2; edge: number; s0: number; sC: number };
    let best: Cand | null = null;
    for (const id of net.segsNear(G.x - R, G.y - R, G.x + R, G.y + R)) {
      const s = net.segs.get(id)!;
      if (!(site ? takesGate(ROAD_TYPES[s.type]) : ROAD_TYPES[s.type].allowsAccess)) continue;
      const g = net.segGeom.get(id)!;
      const r = cubicClosest(s.c, G);
      if (net.heightOnSeg(id, r.t) > 0.5) continue;
      const edge = r.d - g.width / 2;
      const rel = sub(r.p, G);
      // in front of the gate: outside the fence, and not off to one side of it
      if (edge > GATE_REACH || dot(rel, out) < 0.5 || Math.abs(dot(rel, f.along)) > GATE_REACH + g.width / 2) continue;
      if (best && edge >= best.edge) continue;
      // (a road that is all junction mouth has no room for a driveway: the next nearest in front of the gate then,
      // as where a roundabout has left a metre or two of the gate's street sticking out of its ring)
      const s0 = g.center.length * arcFrac(s.c, r.t, g.center.pts);
      const sC = this.gateS(id, s0, site);
      if (sC !== null) best = { seg: id, t: r.t, q: r.p, edge, s0, sC };
    }
    if (!best) return null;
    const s = net.segs.get(best.seg)!, g = net.segGeom.get(best.seg)!;
    const to = sub(G, best.q), L = Math.hypot(to.x, to.y) || 1;
    const front = add(best.q, scale(to, Math.min(g.width / 2, L) / L));
    const { s0, sC } = best;
    const rs = sideOf(s.c, best.t, c, side);
    // (rot, side) and (rot + PI, -side) are the same plot: keep its gate where it is
    const kerb = this.gateKerb(best.seg, s0, sC, front);
    return { access: { seg: best.seg, s: sC, p: kerb }, front: kerb, side: rs, rot: rs === side ? rot : wrapAngle(rot + Math.PI), type: ROAD_TYPES[s.type].name };
  }

  /**
   * Where along road `id` (centre arc-length) a site's gate joins it, from where it meets it (`s`): off the junction
   * mouths, by GATE_CLEAR at a junction (a long truck waiting to turn in, or to pull out, stands clear of the box) and
   * 2 m at a plain end or bend; on a road too short for that, halfway between its junctions. Null: no room at all.
   */
  private gateS(id: number, s: number, site: boolean): number | null {
    const net = this.net, g = net.segGeom.get(id)!, sg = net.segs.get(id)!, L = g.center.length;
    const lo = g.trimA + 2, hi = L - g.trimB - 2;
    if (hi <= lo) {
      // a few metres of dead end (what a roundabout leaves of a gate's street): the gate is at its end, as on the
      // street the game lays; any other road this short is all junction mouth
      const endA = net.segsAt(sg.a).length === 1, endB = net.segsAt(sg.b).length === 1;
      const l0 = g.trimA + 0.5, l1 = L - g.trimB - 0.5;
      return site && endA !== endB && l1 > l0 + 1 ? (endB ? l1 : l0) : null;
    }
    const clear = (n: number) => (site && net.segsAt(n).length >= 3 ? GATE_CLEAR : 2);
    const lo2 = g.trimA + clear(sg.a), hi2 = L - g.trimB - clear(sg.b);
    if (hi2 < lo2) return Math.max(lo, Math.min(hi, (lo2 + hi2) / 2));
    return Math.max(lo2, Math.min(hi2, s));
  }

  /** The kerb point a gate's drive meets the road at: `front` where it joins where it meets it, else moved along to `sC`. */
  private gateKerb(id: number, s0: number, sC: number, front: V2): V2 {
    if (Math.abs(sC - s0) < 0.5) return front;
    const g = this.net.segGeom.get(id)!;
    const q = polyAt(g.center, s0), r = right(polyDir(g.center, s0));
    // (the side of the road the gate is on, as where it met it)
    const k = dot(sub(front, q), r) >= 0 ? 1 : -1;
    const q2 = polyAt(g.center, sC), r2 = right(polyDir(g.center, sC));
    return add(q2, scale(r2, (k * g.width) / 2));
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
    const filed = this.gridAt === `${this.version}:${this.moved}`;
    this.list.push(b);
    this.byId.set(b.id, b);
    this.version++;
    // (the grid takes it in, rather than being filled again for every new home)
    if (filed) { this.file(b); this.gridAt = `${this.version}:${this.moved}`; }
    if (b.id >= this.nextId) this.nextId = b.id + 1;
    return b;
  }

  remove(id: number) {
    const b = this.byId.get(id);
    if (!b) return;
    const filed = this.gridAt === `${this.version}:${this.moved}`;
    this.byId.delete(id);
    this.list.splice(this.list.indexOf(b), 1);
    this.version++;
    if (filed) { this.file(b, true); this.gridAt = `${this.version}:${this.moved}`; }
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
      // (a building on a road that hasn't been rebuilt since it was last attached stays as it is: a city has thousands)
      if (a && this.attachedTo.get(b) === net.segGeom.get(a.seg) && net.segs.has(a.seg)) continue;
      if (a && net.segs.has(a.seg) && (b.placed && b.plant ? takesGate : (t: RoadType) => t.allowsAccess)(ROAD_TYPES[net.segs.get(a.seg)!.type])) {
        // seg may have been rebuilt (new trims): refresh the arc-length
        const g = net.segGeom.get(a.seg)!;
        const s = net.segs.get(a.seg)!;
        const r = cubicClosest(s.c, b.front);
        if (r.d < reach(b, g.width)) {
          a.s = g.center.length * arcFrac(s.c, r.t, g.center.pts);
          // (a home's driveway, or a hall's path, starts at the kerb, wherever an upgrade or downgrade moved it)
          if (behindStrip(b)) { b.front = kerbAt(s.c, r.t, g.width, b.c); a.p = b.front; }
          // (a site's gate stays off the junction mouths: a road that now meets the road by it moves it along)
          const sC = b.placed && b.plant ? this.gateS(a.seg, a.s, true) : a.s;
          if (sC !== null && sC !== a.s) { b.front = this.gateKerb(a.seg, a.s, sC, b.front); a.p = b.front; a.s = sC; }
          // (and its drive, across the front strip from a road running past the gate, starts at the kerb: shorter
          // when the road is widened, longer again when it is narrowed)
          if (b.placed) {
            const q = polyAt(g.center, a.s), dir = polyDir(g.center, a.s);
            if (Math.abs(dot(dir, siteFrame(b.c, b.rot, b.side, b.hd).into)) < 0.3) {
              const n = right(dir), k = dot(sub(b.c, q), n) >= 0 ? 1 : -1;
              b.front = add(q, scale(n, (k * g.width) / 2));
              a.p = b.front;
            }
          }
          const side = sideOf(s.c, r.t, b.c, b.placed ? b.side : undefined);
          // (a site keeps its gate where it is whichever way the road now runs)
          if (b.placed && side !== b.side) b.rot = wrapAngle(b.rot + Math.PI);
          b.side = side;
          this.attachedTo.set(b, g);
          continue;
        }
      }
      const had = !!b.access;
      b.access = null;
      if (b.placed) {
        const ga = this.gateAccess(b.c, b.rot, b.side, b.hd, isPlantKind(b.kind));
        if (ga) {
          Object.assign(b, { access: ga.access, front: ga.front, side: ga.side, rot: ga.rot });
          if (!had) joined.push(b);
        } else {
          const f = siteFrame(b.c, b.rot, b.side, b.hd);
          b.front = add(f.gate, scale(f.into, -GATE_SETBACK));
        }
        continue;
      }
      const look = behindStrip(b) ? ZONE_SETBACK : 6;
      for (const id of net.segsNear(b.front.x - look, b.front.y - look, b.front.x + look, b.front.y + look)) {
        const s = net.segs.get(id)!;
        if (!ROAD_TYPES[s.type].allowsAccess) continue;
        const g = net.segGeom.get(id)!;
        const r = cubicClosest(s.c, b.front);
        if (r.d < reach(b, g.width) && net.heightOnSeg(id, r.t) < 0.5) {
          if (behindStrip(b)) b.front = kerbAt(s.c, r.t, g.width, b.c);
          b.access = { seg: id, s: g.center.length * arcFrac(s.c, r.t, g.center.pts), p: b.front };
          b.side = sideOf(s.c, r.t, b.c);
          this.attachedTo.set(b, g);
          break;
        }
      }
    }
    return joined;
  }

  /**
   * Widening `segId` to half-width `halfW` covers the lots in `ids` (or they stand inside its front strip): push each
   * one straight back to behind the strip (siteSetback). A lot that faces another road, or has no free land behind
   * it, can't move, and is returned in `stuck`.
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
      // (back to behind the front strip, so the next widening needs no move)
      const mv = siteSetback(halfW * 2) + b.hd - rc.d;
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
      let ok = samples.every((k) => world.inBounds(k) && !world.isWater(k) && !world.isMountain(k));
      const gate = b.placed ? siteFrame(c, b.rot, b.side, b.hd).gate : null;
      if (ok) ok = !this.list.some((o) => o.id !== b.id && (!moving.has(o.id) || target.has(o.id)) &&
        obbOverlap(c, b.hw + 0.3, b.hd + 0.3, b.rot, target.get(o.id) ?? o.c, o.hw, o.hd, o.rot));
      if (ok) {
        const r = b.hw + b.hd;
        roads: for (const id of net.segsNear(c.x - r, c.y - r, c.x + r, c.y + r)) {
          const gg = net.segGeom.get(id)!;
          const w2 = id === segId ? halfW : gg.width / 2;
          for (let i = 0; i < gg.center.pts.length; i++) {
            if (gg.hs[i] > 6) continue;
            const d = rectDistance(gg.center.pts[i], c, b.hw, b.hd, b.rot);
            // (a road may come right up to a site's gate)
            if (gate && d > 0.8 && dist(gg.center.pts[i], gate) < GATE_REACH + 4 + w2) continue;
            if (d < w2 + 0.4) { ok = false; break roads; }
          }
        }
      }
      if (!ok) stuck.push(m.id);
    }
    return { moves: stuck.length ? [] : moves, stuck };
  }

  /**
   * How far a site's fence stands inside the front strip (siteSetback) of the road running past its gate (m). 0:
   * behind it, no road yet, or a road that ends at the gate (it widens sideways, clear of the fence).
   */
  stripShort(b: Building): number {
    const a = b.access;
    if (!a || !b.placed) return 0;
    const s = this.net.segs.get(a.seg), g = this.net.segGeom.get(a.seg);
    if (!s || !g) return 0;
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const r = cubicClosest(s.c, f.gate);
    if (Math.abs(dot(norm(cubicTangent(s.c, r.t)), f.into)) > 0.3) return 0;
    return Math.max(0, siteSetback(g.width) - r.d);
  }

  /** Put buildings at one end of their moves (`to` = true: the new spots). */
  applyMoves(moves: BuildingMove[], to: boolean) {
    for (const m of moves) {
      const b = this.byId.get(m.id);
      if (!b) continue;
      b.c = to ? m.c1 : m.c0;
      b.front = to ? m.f1 : m.f0;
      this.attachedTo.delete(b);
    }
    this.moved++;
  }
}

/**
 * Which side of the road p is on. A road that ends square-on at a site's gate has the plot straight ahead, on
 * neither side: then it keeps `keep`, so the site's driveway doesn't flip kerbs from one rebuild to the next.
 */
/** Homes, shops and the town halls' squares stand behind a front strip (config ZONE_SETBACK); their kerb point follows the kerb. */
const behindStrip = (b: Building) => !!b.zone || isHall(b.kind) || isCivic(b.kind);

/** How far a building's kerb point may be from a road's centreline and still be on it (a home: across its front strip). */
const reach = (b: Building, width: number) => (behindStrip(b) ? Math.max(width / 2, ZONE_SETBACK) : width / 2) + 1.5;

/**
 * How far a company site's fence stands from the centreline of the road at its gate (m): behind the front strip
 * (config ZONE_SETBACK) like a town's lots, and never closer than the drive (GATE_SETBACK) off the kerb of a road wider
 * than the strip allows for.
 */
export const siteSetback = (width: number) => Math.max(ZONE_SETBACK, width / 2 + GATE_SETBACK);

/** The kerb of a road at t, on the side of p. */
function kerbAt(c: import("../core/math").Cubic, t: number, width: number, p: V2): V2 {
  const q = cubicAt(c, t);
  const n = right(norm(cubicTangent(c, t)));
  const sd = dot(sub(p, q), n) >= 0 ? 1 : -1;
  return add(q, scale(n, (sd * width) / 2));
}

function sideOf(c: import("../core/math").Cubic, t: number, p: V2, keep?: 1 | -1): 1 | -1 {
  const tan = norm(cubicTangent(c, t));
  const q = cubicClosest(c, p).p;
  const rel = sub(p, q), across = dot(rel, right(tan));
  if (keep !== undefined && Math.abs(across) < 0.25 * Math.hypot(rel.x, rel.y)) return keep;
  return across >= 0 ? 1 : -1;
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
