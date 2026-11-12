import {
  LANE_W, CLEARANCE, ELEVATED_COST_MULT, LEVEL_H, MAX_GRADE, MAX_LEVEL, MIN_ARM_ANGLE, MIN_SEG_LEN, NODE_SNAP_PX, ROAD_SNAP_PX,
  ROAD_TYPES, ROUNDABOUT_COST, WATER_BRIDGE_MULT, BULLDOZE_REFUND, PAVED_DECK, roadWidth, isHighway, type RoadTypeId,
} from "../config";
import {
  type Cubic, type V2, add, angleOf, arcCubics, arcThenLine, rampCurve, rampCurves, clamp, cubicAt, cubicTangent, dist, dot, fromAngle, hermiteCubic,
  lerpV, makePolyline, minRadius, norm, polyAt, polyClosest, polyDir, quadCubic, right, sampleCubic, scale, segIntersect, signedAngle, smoothstep,
  splitCubic, straightCubic, sub, tangentArc, pointSegDist2, len, cross, rectDistance,
} from "../core/math";
import { glueGap, glueRun, pocketTaper, type Pocket, type RoadNetwork, type RSeg } from "./network";

// ---------------------------------------------------------------------------------------------
// World queries the planner needs (terrain, buildings)
// ---------------------------------------------------------------------------------------------

export interface BuildWorld {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
  inBounds(p: V2): boolean;
  /** Buildings whose footprint comes within `hw` of any of the points. */
  buildingsHit(pts: V2[], hw: number): number[];
  money(): number;
  /** Where a building is (to point at one in the way). */
  buildingAt?(id: number): V2 | undefined;
  /** Where along a road (centreline arc-lengths) buildings and stops have their way in: a stretch with one is used. */
  servedOn?(seg: number): number[];
}

/** The point of a polyline where it bends tightest. */
function tightest(pts: V2[]): V2 {
  let best = pts[Math.floor(pts.length / 2)], bk = -1;
  for (let i = 4; i < pts.length - 4; i++) {
    const a = norm(sub(pts[i], pts[i - 4])), b = norm(sub(pts[i + 4], pts[i]));
    const k = Math.abs(cross(a, b)) / (dist(pts[i - 4], pts[i + 4]) || 1);
    if (k > bk) { bk = k; best = pts[i]; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Snapping
// ---------------------------------------------------------------------------------------------

export interface Snap {
  p: V2;
  h: number;
  node?: number; // snapped onto an existing node
  seg?: number; // snapped onto an existing segment (split point)
  t?: number; // cubic parameter on `seg`
  tangent?: V2; // natural continuation direction when starting from here (dead ends)
  guides: Guide[];
  label?: string;
  ringRaw?: V2; // picked inside a roundabout: the rim point follows where the road heads
  /** picked over a company site: the road goes to (or leaves from) its gate instead (turned: to the side of its
   * fence the road comes to, where its gate will be once the road is built) */
  site?: { id: number; name: string; gate: V2; turned?: boolean };
}

/** A company site as the road tool sees it: a road drawn to or from anywhere over it connects at its gate. */
export interface SiteTarget {
  id: number;
  name: string;
  /** its plot: centre, half sizes, turn */
  c: V2; hw: number; hd: number; rot: number;
  /** the middle of its gate (on the fence), and the way out of it */
  gate: V2; out: V2;
  /** where a new road meets a site with no road yet (just outside its gate) */
  entry: V2;
  /** the road its gate is on, when it has one */
  access?: number;
  /** with no road yet: the other side its gate could be on (the site turned half round), as `gate`, `out` and `entry` above */
  turns?: { gate: V2; out: V2; entry: V2 }[];
}

export interface Guide {
  a: V2;
  b: V2;
}

export interface SnapOpts {
  mpp: number; // metres per screen pixel
  level: number;
  from?: { p: V2; tangent?: V2; on?: Snap }; // the point we are drawing from (on: what it snapped to)
  angleStep?: boolean; // angle lock: 15 degree steps off the world grid or the road we start from
  grid?: number; // grid size in metres (0 = off)
  type: RoadTypeId;
  /** Snapping switched off in the snapping menu: existing roads, guidelines/right angles, side-by-side roads. */
  off?: { geometry?: boolean; guides?: boolean; netSide?: boolean };
  /** Round free lengths to this many metres (CS2's "cell length": 8 m). */
  lengthStep?: number;
  /** Where a road ending would join a company site waiting for one (just outside its gate); ground level only. */
  gates?: V2[];
  /** The company's sites: a point over one snaps to its way in. */
  sites?: SiteTarget[];
}

export function cubicClosest(c: Cubic, p: V2): { t: number; d: number; p: V2 } {
  let bt = 0, bd = Infinity;
  const N = 48;
  for (let i = 0; i <= N; i++) {
    const t = i / N;
    const q = cubicAt(c, t);
    const d = dist(q, p);
    if (d < bd) { bd = d; bt = t; }
  }
  // refine by ternary search around the best sample
  let lo = Math.max(0, bt - 1 / N), hi = Math.min(1, bt + 1 / N);
  for (let k = 0; k < 24; k++) {
    const m1 = lo + (hi - lo) / 3, m2 = hi - (hi - lo) / 3;
    if (dist(cubicAt(c, m1), p) < dist(cubicAt(c, m2), p)) hi = m2;
    else lo = m1;
  }
  const t = (lo + hi) / 2;
  const q = cubicAt(c, t);
  return { t, d: dist(q, p), p: q };
}

/** Direction a new road would naturally continue in, from a dead-end node. */
function deadEndTangent(net: RoadNetwork, nodeId: number): V2 | undefined {
  const segs = net.segsAt(nodeId);
  if (segs.length !== 1) return undefined;
  const s = segs[0];
  return s.a === nodeId ? scale(cubicTangent(s.c, 0), -1) : cubicTangent(s.c, 1);
}

/**
 * Where a road joins a site: the end of the street out of its gate (a dead end there), else the road its gate is on,
 * in front of the gate, else (no road yet) the ground just outside its gate, leaving it square.
 */
export function siteEntry(net: RoadNetwork, t: SiteTarget): Omit<Snap, "guides"> {
  const s = t.access !== undefined ? net.segs.get(t.access) : undefined;
  if (s) {
    for (const n of [s.a, s.b]) {
      const nd = net.nodes.get(n)!;
      if (net.segsAt(n).length === 1 && Math.abs(nd.h) < 0.5 && dist(nd.p, t.gate) < 16) return { p: { ...nd.p }, h: nd.h, node: n, tangent: deadEndTangent(net, n) };
    }
    const r = cubicClosest(s.c, t.entry);
    return { p: r.p, h: net.heightOnSeg(s.id, r.t), seg: s.id, t: r.t };
  }
  return { p: { ...t.entry }, h: 0, tangent: { ...t.out } };
}

/** Roundabout rings around p: centre and radius from three of their nodes. */
export function ringsNear(net: RoadNetwork, p: V2, reach = 60): { id: number; c: V2; r: number; h: number }[] {
  const ids = new Set<number>();
  for (const id of net.segsNear(p.x - reach, p.y - reach, p.x + reach, p.y + reach)) {
    const s = net.segs.get(id)!;
    if (s.ring) ids.add(s.ring);
  }
  const out: { id: number; c: V2; r: number; h: number }[] = [];
  for (const ring of ids) {
    const nodes: V2[] = [];
    let h = 0;
    for (const s of net.segs.values()) {
      if (s.ring !== ring) continue;
      const n = net.nodes.get(s.a)!;
      nodes.push(n.p);
      h = n.h;
    }
    if (nodes.length < 3) continue;
    const a = nodes[0], b = nodes[Math.floor(nodes.length / 3)], c = nodes[Math.floor((2 * nodes.length) / 3)];
    const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
    if (Math.abs(d) < 1e-6) continue;
    const a2 = a.x * a.x + a.y * a.y, b2 = b.x * b.x + b.y * b.y, c2 = c.x * c.x + c.y * c.y;
    const ctr = { x: (a2 * (b.y - c.y) + b2 * (c.y - a.y) + c2 * (a.y - b.y)) / d, y: (a2 * (c.x - b.x) + b2 * (a.x - c.x) + c2 * (b.x - a.x)) / d };
    out.push({ id: ring, c: ctr, r: dist(ctr, a), h });
  }
  return out;
}

/**
 * Aiming into a roundabout means "connect to the ring": take the point where the road meets the
 * circle (or the nearest rim point when starting inside), reusing a plain ring node if one is close.
 */
function ringSnap(net: RoadNetwork, raw: V2, o: SnapOpts): Snap | null {
  for (const R of ringsNear(net, raw)) {
    if (dist(raw, R.c) > R.r) continue;
    let q: V2 | null = null;
    const f = o.from?.p;
    if (f && dist(f, R.c) > R.r + 1) {
      // first intersection of f -> raw with the circle
      const d = sub(raw, f), m = sub(f, R.c);
      const A = dot(d, d), B = 2 * dot(m, d), C = dot(m, m) - R.r * R.r;
      const disc = B * B - 4 * A * C;
      if (A > 1e-6 && disc >= 0) {
        const t = (-B - Math.sqrt(disc)) / (2 * A);
        if (t >= 0 && t <= 1) q = add(f, scale(d, t));
      }
    }
    if (!q) {
      const dir = len(sub(raw, R.c)) > 0.5 ? norm(sub(raw, R.c)) : f ? norm(sub(f, R.c)) : { x: 0, y: 1 };
      q = add(R.c, scale(dir, R.r));
    }
    let bestS: { seg: RSeg; t: number; p: V2; d: number } | null = null;
    for (const id of net.segsNear(q.x - 20, q.y - 20, q.x + 20, q.y + 20)) {
      const sg = net.segs.get(id)!;
      if (sg.ring !== R.id) continue;
      const r = cubicClosest(sg.c, q);
      if (!bestS || r.d < bestS.d) bestS = { seg: sg, t: r.t, p: r.p, d: r.d };
    }
    if (bestS) return { p: bestS.p, h: net.heightOnSeg(bestS.seg.id, bestS.t), seg: bestS.seg.id, t: bestS.t, guides: [], ringRaw: { ...raw } };
  }
  return null;
}

export function snap(net: RoadNetwork, raw: V2, o: SnapOpts): Snap {
  const guides: Guide[] = [];
  const h = o.level * LEVEL_H;
  const geo = !o.off?.geometry, gd = !o.off?.guides;
  const rs = geo ? ringSnap(net, raw, o) : null;
  if (rs) return rs;
  // 0) over a company site: its gate (never a road through its yard)
  if (geo && o.level === 0) for (const t of o.sites ?? []) {
    if (rectDistance(raw, t.c, t.hw, t.hd, t.rot) > 0) continue;
    let e = siteEntry(net, t), gate = t.gate, turned = false;
    // A site with no road yet, and the road comes to it from behind (the straight way to its gate would cut through
    // its yard): the gate goes to the back of the plot, and the road ends there.
    if (t.access === undefined && t.turns?.length && o.from) {
      const from = o.from.p;
      const cuts = (to: V2) => {
        const L = dist(from, to), n = Math.max(2, Math.ceil(L / 4));
        for (let k = 0; k < n; k++) if (rectDistance(lerpV(from, to, k / n), t.c, t.hw, t.hd, t.rot) < 4) return true;
        return false;
      };
      if (cuts(t.entry)) {
        let best = Infinity;
        for (const k of t.turns) {
          const d = dist(from, k.entry);
          if (d >= best || cuts(k.entry)) continue;
          best = d; gate = k.gate; turned = true;
          e = { p: { ...k.entry }, h: 0, tangent: { ...k.out } };
        }
      }
    }
    return { ...e, guides, label: turned ? `Connects to ${t.name}, turning its gate` : `Connects to ${t.name}`, site: { id: t.id, name: t.name, gate: { ...gate }, ...(turned ? { turned } : {}) } };
  }
  // 1) nodes
  const nr = NODE_SNAP_PX * o.mpp;
  let bestN: { id: number; d: number } | null = null;
  for (const n of net.nodesNear(raw, nr + 12)) {
    const d = dist(n.p, raw);
    const tol = nr + (net.segsAt(n.id).length === 1 ? 4 : 2);
    if (d < tol && (!bestN || d < bestN.d)) bestN = { id: n.id, d };
  }
  if (bestN && geo) {
    const n = net.nodes.get(bestN.id)!;
    return { p: { ...n.p }, h: n.h, node: n.id, tangent: deadEndTangent(net, n.id), guides };
  }
  // 2) roads (centreline), only at a matching height
  const rr = ROAD_SNAP_PX * o.mpp;
  type Cand = { seg: RSeg; t: number; p: V2; d: number; h: number; inside: boolean };
  let bestS: Cand | null = null, bestLvl: Cand | null = null;
  for (const id of net.segsNear(raw.x - 40, raw.y - 40, raw.x + 40, raw.y + 40)) {
    const s = net.segs.get(id)!;
    const g = net.segGeom.get(id);
    if (!g) continue;
    let r = cubicClosest(s.c, raw);
    // a slip lane is drawn from the carriageway's centre but built beside it: snap to it where it is
    if (slipLaneEnd(net, id)) {
      const q = polyAt(g.center, polyClosest(g.center, raw).s);
      r = { t: cubicClosest(s.c, q).t, d: dist(q, raw), p: q };
    }
    const hw = g.width / 2;
    if (r.d >= hw + rr) continue;
    const c = { seg: s, t: r.t, p: r.p, d: r.d, h: net.heightOnSeg(id, r.t), inside: r.d < hw };
    if (!bestS || c.d < bestS.d) bestS = c;
    if (Math.abs(c.h - h) < 0.5 && (!bestLvl || c.d < bestLvl.d)) bestLvl = c;
  }
  if (geo) {
    // a road at our level; free, the nearest road (taking its level); never onto one at another level, except...
    const pick = bestLvl ?? (!o.from ? bestS : null);
    if (pick) return { p: pick.p, h: pick.h, seg: pick.seg.id, t: pick.t, guides };
    // ...further along the carriageway a one-way stroke started on, drawn along it (lengthening a lane up a slope)
    const on = o.from?.on;
    if (bestS && on && bestS.inside && ROAD_TYPES[o.type].bwd === 0) {
      const here: Snap = { p: bestS.p, h: bestS.h, seg: bestS.seg.id, t: bestS.t, guides };
      if ((stretchBetween(net, on, here) || stretchBetween(net, here, on)) && alongCarriage(net, on, here)) return here;
    }
  }
  // 3) the gate of a site waiting for a road
  if (geo && o.level === 0) {
    const gr = NODE_SNAP_PX * o.mpp + 8;
    let best: V2 | null = null;
    for (const q of o.gates ?? []) if (dist(q, raw) < gr && (!best || dist(q, raw) < dist(best, raw))) best = q;
    if (best) return { p: { ...best }, h: 0, guides, label: "To the gate" };
  }
  // 4) free point with angle snapping / alignment guides
  let p = { ...raw };
  let label: string | undefined;
  if (o.from) {
    const f = o.from.p;
    const d = sub(p, f);
    const L = len(d);
    if (L > 1) {
      const ang = angleOf(d);
      const cands: number[] = [];
      const base = o.from.tangent ? angleOf(o.from.tangent) : 0;
      if (o.angleStep) {
        // the nearer of the steps off the road we leave and the steps off the world grid
        const step = (15 * Math.PI) / 180;
        let c = base + Math.round((ang - base) / step) * step;
        const w = Math.round(ang / step) * step;
        const off = (a: number) => Math.abs(Math.atan2(Math.sin(ang - a), Math.cos(ang - a)));
        if (o.from.tangent && off(w) < off(c) - 1e-6) c = w;
        p = add(f, scale(fromAngle(c), L));
        if (gd && Math.abs(Math.sin(2 * (c - base))) < 1e-3) guides.push({ a: add(f, scale(fromAngle(c), -2000)), b: add(f, scale(fromAngle(c), 2000)) });
      } else if (gd) {
        for (let k = 0; k < 4; k++) cands.push(k * (Math.PI / 2));
        if (o.from.tangent) for (let k = 0; k < 4; k++) cands.push(base + k * (Math.PI / 2));
        const tol = Math.min(0.06, (7 * o.mpp) / L);
        for (const c of cands) {
          const da = Math.abs(Math.atan2(Math.sin(ang - c), Math.cos(ang - c)));
          if (da < tol) {
            p = add(f, scale(fromAngle(c), L));
            guides.push({ a: add(f, scale(fromAngle(c), -2000)), b: add(f, scale(fromAngle(c), 2000)) });
            break;
          }
        }
      }
    }
    if (o.lengthStep && o.lengthStep > 0) {
      const d2 = sub(p, f), L2 = len(d2);
      if (L2 > 1) p = add(f, scale(d2, Math.max(o.lengthStep, Math.round(L2 / o.lengthStep) * o.lengthStep) / L2));
    }
    // parallel to a nearby road at a clean offset
    const par = o.off?.netSide ? null : parallelSnap(net, p, o);
    if (par) { p = par.p; label = "Parallel"; guides.push(...par.guides); }
  }
  // alignment with nearby node coordinates
  const at = 6 * o.mpp;
  let ax: number | null = null, ay: number | null = null;
  for (const n of gd ? net.nodesNear(p, 400) : []) {
    if (ax === null && Math.abs(n.p.x - p.x) < at && dist(n.p, p) > 4) { ax = n.p.x; guides.push({ a: { x: n.p.x, y: n.p.y - 2000 }, b: { x: n.p.x, y: n.p.y + 2000 } }); }
    if (ay === null && Math.abs(n.p.y - p.y) < at && dist(n.p, p) > 4) { ay = n.p.y; guides.push({ a: { x: n.p.x - 2000, y: n.p.y }, b: { x: n.p.x + 2000, y: n.p.y } }); }
  }
  if (!o.from || o.angleStep !== true) {
    if (ax !== null && !(o.from && guides.length > 2)) p.x = ax;
    if (ay !== null && !(o.from && guides.length > 2)) p.y = ay;
  }
  if (o.grid && o.grid > 0 && ax === null && ay === null) {
    p = { x: Math.round(p.x / o.grid) * o.grid, y: Math.round(p.y / o.grid) * o.grid };
  }
  return { p, h, guides, label };
}

function parallelSnap(net: RoadNetwork, p: V2, o: SnapOpts): { p: V2; guides: Guide[] } | null {
  if (!o.from) return null;
  const dir = norm(sub(p, o.from.p));
  if (len(sub(p, o.from.p)) < 20) return null;
  const w = roadWidth(ROAD_TYPES[o.type]);
  const tol = 5 * o.mpp + 0.8;
  for (const id of net.segsNear(p.x - 60, p.y - 60, p.x + 60, p.y + 60)) {
    const s = net.segs.get(id)!;
    const g = net.segGeom.get(id)!;
    // only straight-ish segments
    if (g.minR < 400) continue;
    const sd = norm(sub(s.c.p3, s.c.p0));
    if (Math.abs(dot(sd, dir)) < 0.995) continue;
    const n = right(sd);
    const off = dot(sub(p, s.c.p0), n);
    const want = (g.width + w) / 2 + 0.2; // touching kerbs -> reads as a widened road
    for (const target of [want, -want, want + 8, -want - 8]) {
      if (Math.abs(off - target) < tol) {
        const q = add(p, scale(n, target - off));
        // keep the start on the same line too, else the stroke isn't parallel
        const fo = dot(sub(o.from.p, s.c.p0), n);
        if (Math.abs(fo - target) > 0.6) continue;
        return { p: q, guides: [{ a: add(s.c.p0, scale(n, target)), b: add(s.c.p3, scale(n, target)) }] };
      }
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------------------------

/**
 * Road drawing modes, as in Transport Fever 2: straight (click the start, click the end) and curve, a freeform arc that
 * leaves its start tangentially (along the road it starts from, the piece before it, or the way the cursor first moved)
 * and bends to wherever the end is clicked. Both chain on from the end until the chain is ended.
 */
export type CurveMode = "straight" | "curve";

export interface PlanError {
  msg: string;
  p: V2;
  buildings?: number[];
}

/** A bridge the planner raised a road onto on its own (over water, or over a road it can't meet at grade). */
export interface BridgeSpan {
  /** where the deck starts and ends (over the obstacle), and the ramps' feet */
  a: V2; b: V2; footA: V2; footB: V2;
  /** deck height (m) and the deck's length (the ramps not counted); cost covers the ramps too */
  h: number; length: number;
  /** what the bridge and its ramps cost, all told */
  cost: number;
  over: "water" | "road" | "both";
}

export interface Stroke {
  chain: Cubic[];
  h0: number;
  h1: number;
  type: RoadTypeId;
  closed?: boolean;
  ring?: number;
  /** heights at the chain's joints (start, each joint, end), where they don't just run from h0 to h1 (a slip lane follows the carriageway) */
  hj?: number[];
  /** as it will look, where that isn't the chain itself (a slip lane, drawn from the carriageway's centre but built beside it) */
  show?: Cubic[];
  /** carriageway pieces it runs beside: never crossed */
  beside?: number[];
}

export interface Plan {
  strokes: Stroke[];
  cost: number;
  length: number;
  errors: PlanError[];
  crossings: V2[];
  endTangent?: V2;
  angleDeg?: number;
  /** angleDeg is to the road it starts on (0-90°), not a heading. */
  angleToRoad?: boolean;
  kind: "road" | "roundabout" | "grid";
  removeSegs?: number[]; // segments replaced (roundabout interior)
  removeNodes?: number[];
  ringCenter?: V2;
  /** Parallel road ends on the main road's start and end sides. */
  parallelEnds?: { a: V2; b: V2 };
  /** Cut the previous parallel piece back first (a pair turning a corner). */
  trim?: ParallelTrim;
  /** Shown with the preview but not built as roads. */
  ghosts?: Stroke[];
  /** Short description shown with the preview ("160 m slip lane"). */
  note?: string;
  /** Where the next stroke carries on from, when that isn't the end of the first stroke (a lane drawn along a carriageway). */
  continueAt?: { p: V2; h: number };
  /** Bridges the road was raised onto on its own (PlanInput.bridges). */
  bridges?: BridgeSpan[];
  /** What the end joins ("Joins the junction", "Joins Avenue at 90°"), for the cursor readout. */
  joins?: string;
  /** Angle the end meets the road it joins at (degrees, 0-90), when it ends on one. */
  endAngleDeg?: number;
  /** The start or end was moved by an automatic fix (onto a road it stopped just short of). */
  fixed?: string[];
  /** Short dead ends a new junction leaves sticking out past it, to remove with the road: the crossing and the end. */
  stubs?: { at: V2; drop: number }[];
  /** The company site it connects to ("Connects to Food Plant"). */
  connects?: string;
  /** Drawn over a dirt road: the stretches of it paved in place (to `type`), in order, instead of a new road. */
  pave?: { type: RoadTypeId; pieces: PavePiece[] };
}

/** A stretch of an existing road changed in place: road `seg` from curve parameter t0 to t1 (0 and 1: all of it). */
/** A stretch of dirt road to pave; `flip` when a one-way type is drawn against the way the road was built. */
export interface PavePiece { seg: number; t0: number; t1: number; flip?: boolean }

export function chainPoints(chain: Cubic[], step = 2): V2[] {
  const pts: V2[] = [];
  for (const c of chain) {
    const s = sampleCubic(c, step);
    if (pts.length) s.shift();
    pts.push(...s);
  }
  return pts;
}

/**
 * Turn the user's input into a stroke (see CurveMode). A curve with a direction to meet at its end (tb) is one smooth
 * S-bend; without, it's the circular arc leaving `a` along `ta` through `b`; with no start direction, a straight.
 */
export function makeChain(mode: CurveMode, a: V2, b: V2, ta?: V2, tb?: V2): Cubic[] {
  if (dist(a, b) < 0.5) return [];
  if (mode === "straight") return [straightCubic(a, b)];
  if (tb) {
    const t0 = ta ?? norm(sub(b, a));
    const d = dist(a, b);
    // keep the handles sane when the end tangent points back at the start
    if (dot(t0, tb) < -0.2) return [quadCubic(a, add(a, scale(t0, d * 0.6)), b)];
    return [hermiteCubic(a, t0, b, tb, 0.42)];
  }
  if (ta) {
    const arc = tangentArc(a, ta, b);
    if (arc.length) return arc;
  }
  return [straightCubic(a, b)];
}

/**
 * A cubic shifted sideways by d metres (+ = right of travel). The ends are shifted exactly and keep their
 * directions; the handle lengths are a least-squares fit to the true offset curve. Splits only where one
 * cubic can't follow it closely enough, so a parallel road is usually as few pieces as the road it follows.
 */
function offsetCubic(c: Cubic, d: number, depth = 0): Cubic[] {
  const tan = (t: number) => {
    const v = cubicTangent(c, t);
    return len(v) > 1e-9 ? norm(v) : norm(sub(c.p3, c.p0));
  };
  const t0 = tan(0), t1 = tan(1);
  const p0 = add(c.p0, scale(right(t0), d)), p3 = add(c.p3, scale(right(t1), d));
  // start from the handles scaled with the chord (exact for arcs), then fit
  const chord = dist(c.p0, c.p3);
  const k = chord > 1e-6 ? dist(p0, p3) / chord : 1;
  let ha = len(sub(c.p1, c.p0)) * k, hb = len(sub(c.p2, c.p3)) * k;
  let s11 = 0, s12 = 0, s22 = 0, r1 = 0, r2 = 0;
  for (const t of [0.15, 0.3, 0.45, 0.55, 0.7, 0.85]) {
    const u = 1 - t, B0 = u * u * u, B1 = 3 * u * u * t, B2 = 3 * u * t * t, B3 = t * t * t;
    const want = add(cubicAt(c, t), scale(right(tan(t)), d));
    const r = sub(want, add(scale(p0, B0 + B1), scale(p3, B2 + B3)));
    const v1 = scale(t0, B1), v2 = scale(t1, -B2);
    s11 += dot(v1, v1); s12 += dot(v1, v2); s22 += dot(v2, v2); r1 += dot(v1, r); r2 += dot(v2, r);
  }
  const det = s11 * s22 - s12 * s12;
  if (Math.abs(det) > 1e-9) {
    const fa = (r1 * s22 - r2 * s12) / det, fb = (s11 * r2 - s12 * r1) / det;
    if (fa > 0 && fb > 0) { ha = fa; hb = fb; }
  }
  const out: Cubic = { p0, p1: add(p0, scale(t0, ha)), p2: add(p3, scale(t1, -hb)), p3 };
  if (depth < 4) {
    // how far the fit strays from the true offset, measured as distance to the original curve
    let err = 0;
    for (let i = 1; i < 8; i++) err = Math.max(err, Math.abs(cubicClosest(c, cubicAt(out, i / 8)).d - Math.abs(d)));
    if (err > 0.25) {
      const [x, y] = splitCubic(c, 0.5);
      return [...offsetCubic(x, d, depth + 1), ...offsetCubic(y, d, depth + 1)];
    }
  }
  return [out];
}

export function offsetChain(chain: Cubic[], d: number): Cubic[] {
  return chain.flatMap((c) => offsetCubic(c, d));
}

export function reverseChain(chain: Cubic[]): Cubic[] {
  return chain.slice().reverse().map((c) => ({ p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 }));
}

/** Default centre-to-centre spacing for a parallel road: the two roads side by side with a 4 m median. */
export function parallelSpacing(type: RoadTypeId): number {
  return roadWidth(ROAD_TYPES[type]) + 4;
}

function heightAt(st: Stroke, f: number) {
  return st.h0 + (st.h1 - st.h0) * smoothstep(clamp(f, 0, 1));
}

/**
 * Heights along a stroke's points (arc lengths `cum`): from joint to joint where it has joint heights, and level with
 * the carriageway wherever it runs beside one (a slip lane).
 */
function strokeHeights(net: RoadNetwork, st: Stroke, pts: V2[], cum: number[]): number[] {
  const L = cum[cum.length - 1] || 1;
  let hs = cum.map((c) => heightAt(st, c / L));
  if (st.hj && st.hj.length === st.chain.length + 1) {
    const lens = st.chain.map((c) => makePolyline(sampleCubic(c, 2)).length);
    const tot = lens.reduce((a, b) => a + b, 0) || 1;
    hs = cum.map((c) => {
      let s = (c / L) * tot, i = 0;
      while (i < lens.length - 1 && s > lens[i]) { s -= lens[i]; i++; }
      return st.hj![i] + (st.hj![i + 1] - st.hj![i]) * smoothstep(clamp(s / (lens[i] || 1), 0, 1));
    });
  }
  if (st.beside?.length) {
    // only the slip lane's own piece (the first for an exit, the last for an entry): the ramp keeps its heights
    const segs = st.beside.map((id) => net.segs.get(id)).filter((s): s is RSeg => !!s);
    const onCw = (p: V2) => segs.some((s) => cubicClosest(s.c, p).d < 1);
    const exit = onCw(st.chain[0].p0);
    const lens = st.chain.map((c) => makePolyline(sampleCubic(c, 2)).length);
    const tot = lens.reduce((a, b) => a + b, 0) || 1;
    const lo = exit ? 0 : ((tot - lens[lens.length - 1]) / tot) * L, hi = exit ? (lens[0] / tot) * L : L;
    const reach = Math.max(...segs.map((s) => glueGap(s.type, st.type))) + 1.5;
    hs = hs.map((h, i) => {
      if (cum[i] < lo - 0.5 || cum[i] > hi + 0.5) return h;
      let bd = reach, hh = h;
      for (const s of segs) {
        const r = cubicClosest(s.c, pts[i]);
        if (r.d < bd) { bd = r.d; hh = net.heightOnSeg(s.id, r.t); }
      }
      return hh;
    });
  }
  return hs;
}

/** A stroke's points (every `step` m, as it will look) and its height at each. */
export function strokeProfile(net: RoadNetwork, st: Stroke, step = 2): { pts: V2[]; hs: number[] } {
  const pts = chainPoints(st.show ?? st.chain, step);
  if (st.show) {
    const pl = makePolyline(pts);
    return { pts, hs: pl.cum.map((c) => heightAt(st, c / (pl.length || 1))) };
  }
  return { pts, hs: strokeHeights(net, st, pts, makePolyline(pts).cum) };
}

/**
 * What a stroke's piece i is built as. A dirt road leaves the ground only on a bridge, and the bridge and its ramps
 * (every piece raised at either end) are a plain paved street.
 */
export function pieceType(st: Stroke, i: number): RoadTypeId {
  if (!ROAD_TYPES[st.type].unpaved) return st.type;
  const a = st.hj?.[i] ?? st.h0, b = st.hj?.[i + 1] ?? st.h1;
  return Math.max(a, b) > RAISED ? PAVED_DECK : st.type;
}
/** Above this (m), a dirt road's piece is off the ground (a bridge or its ramp). */
const RAISED = 0.5;

/** Does any piece of the stroke get built paved where it was drawn as dirt (it has a bridge)? */
export function pavedPieces(st: Stroke): boolean {
  return !!ROAD_TYPES[st.type].unpaved && st.chain.some((_, i) => pieceType(st, i) !== st.type);
}

/** The type of the stroke's piece at arc length s (pieces `lens` long). */
function typeAtS(st: Stroke, lens: number[], s: number): RoadTypeId {
  let i = 0;
  while (i < lens.length - 1 && s > lens[i]) { s -= lens[i]; i++; }
  return pieceType(st, i);
}

/** What a stroke costs, at the price of what each piece is built as (a dirt road's bridge is a paved street). */
function strokeCost(st: Stroke, pts: V2[], hs: number[], world: BuildWorld): number {
  if (!pavedPieces(st)) return costOfPoints(pts, hs, st.type, world);
  const lens = st.chain.map((c) => makePolyline(sampleCubic(c, 2)).length);
  const tot = lens.reduce((a, b) => a + b, 0) || 1;
  const pl = makePolyline(pts), L = pl.length || 1;
  return costOfPoints(pts, hs, st.type, world, (i) => typeAtS(st, lens, ((pl.cum[i - 1] + pl.cum[i]) / 2 / L) * tot));
}

function costOfPoints(pts: V2[], hs: number[], type: RoadTypeId, world: BuildWorld, typeAt?: (i: number) => RoadTypeId): number {
  let c = 0;
  for (let i = 1; i < pts.length; i++) {
    const T = ROAD_TYPES[typeAt ? typeAt(i) : type];
    const L = dist(pts[i - 1], pts[i]);
    const lv = clamp(hs[i] / LEVEL_H, 0, 3);
    const i0 = Math.floor(lv), i1 = Math.min(3, i0 + 1);
    let mult = ELEVATED_COST_MULT[i0] + (ELEVATED_COST_MULT[i1] - ELEVATED_COST_MULT[i0]) * (lv - i0);
    if (world.isWater(pts[i])) mult *= WATER_BRIDGE_MULT;
    c += L * T.costPerM * mult;
  }
  return c;
}

export function segCost(net: RoadNetwork, segId: number, world: BuildWorld): number {
  const s = net.segs.get(segId);
  const g = net.segGeom.get(segId);
  if (!s || !g) return 0;
  return costOfPoints(g.center.pts, Array.from(g.hs), s.type, world);
}

interface Crossing {
  seg: number;
  sPlan: number; // arc-length along the stroke
  p: V2;
  angle: number;
  hSeg: number;
}

/** All centreline crossings of a stroke with existing roads at a similar height. */
function findCrossings(net: RoadNetwork, pts: V2[], cum: number[], hsPlan: number[], ignore: { segs: Set<number>; nodes: Set<number> }, skip?: (seg: number, p: V2) => boolean) {
  const out: Crossing[] = [];
  const bad: { p: V2; msg: string; seg: number; sPlan: number; hSeg: number; angle: number }[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  for (const id of net.segsNear(x0 - 30, y0 - 30, x1 + 30, y1 + 30)) {
    const g = net.segGeom.get(id);
    const s = net.segs.get(id);
    if (!g || !s) continue;
    // (a road whose box the plan's doesn't reach can't cross it; nor can two pieces whose boxes don't meet)
    const bb = g.bbox;
    if (bb.x0 > x1 || bb.x1 < x0 || bb.y0 > y1 || bb.y1 < y0) continue;
    const cp = g.center.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const ax0 = Math.min(a.x, b.x), ax1 = Math.max(a.x, b.x), ay0 = Math.min(a.y, b.y), ay1 = Math.max(a.y, b.y);
      if (bb.x0 > ax1 || bb.x1 < ax0 || bb.y0 > ay1 || bb.y1 < ay0) continue;
      for (let j = 0; j < cp.length - 1; j++) {
        const c = cp[j], d = cp[j + 1];
        if ((c.x < ax0 && d.x < ax0) || (c.x > ax1 && d.x > ax1) || (c.y < ay0 && d.y < ay0) || (c.y > ay1 && d.y > ay1)) continue;
        const r = segIntersect(pts[i], pts[i + 1], cp[j], cp[j + 1]);
        if (!r) continue;
        const p = lerpV(pts[i], pts[i + 1], r.t);
        if (skip?.(id, p)) continue; // that part goes when this is built
        const sPlan = cum[i] + (cum[i + 1] - cum[i]) * r.t;
        const hP = hsPlan[i] + (hsPlan[i + 1] - hsPlan[i]) * r.t;
        const hS = g.hs[j] + (g.hs[j + 1] - g.hs[j]) * r.u;
        const dh = Math.abs(hP - hS);
        if (dh >= CLEARANCE) continue; // grade separated
        // crossing at an anchor we already connect to
        if (ignore.segs.has(id) && (sPlan < 3 || sPlan > cum[cum.length - 1] - 3)) continue;
        const nearNode = [s.a, s.b].find((n) => dist(net.nodes.get(n)!.p, p) < 3 && ignore.nodes.has(n));
        if (nearNode !== undefined) continue;
        const da = norm(sub(pts[i + 1], pts[i])), db = norm(sub(cp[j + 1], cp[j]));
        const angle = Math.acos(clamp(Math.abs(dot(da, db)), 0, 1));
        if (dh > 0.6) {
          bad.push({ p, msg: `Only ${dh.toFixed(1)} of ${CLEARANCE} m clearance, raise or lower it with Page Up or Down`, seg: id, sPlan, hSeg: hS, angle });
          continue;
        }
        out.push({ seg: id, sPlan, p, angle, hSeg: hS });
      }
    }
  }
  out.sort((a, b) => a.sPlan - b.sPlan);
  // a hit exactly on a shared polyline vertex is found twice: keep one
  const uniq: Crossing[] = [];
  for (const c of out) if (!uniq.some((u) => u.seg === c.seg && Math.abs(u.sPlan - c.sPlan) < 1)) uniq.push(c);
  return { crossings: uniq, bad };
}

export interface PlanInput {
  start: Snap;
  end: Snap;
  mode: CurveMode;
  type: RoadTypeId;
  startTangent?: V2;
  /** A curve always meets the road it ends on square (or runs on from a dead end), not only when aimed near that. */
  squareEnd?: boolean;
  /**
   * The player's road tool: raise the road onto bridges on its own over water and over roads it can't meet at grade,
   * and pull a free end that stops just short of (or past) a road onto it. Off for towns and scripted builds.
   */
  bridges?: boolean;
  /**
   * Also build a parallel road `offset` metres to the left (one-ways run the other way, so a one-way pair is a dual
   * carriageway). `from` is where the previous parallel piece ended, to carry on from it.
   */
  parallel?: { offset: number; from?: Snap };
}

/**
 * Travel direction of the one-way carriageway a snap lands on (on a segment, or at a node where one one-way road runs
 * on into another), if any.
 */
export function oneWayDirAt(net: RoadNetwork, sn: Snap): V2 | null {
  if (sn.seg !== undefined) {
    const s = net.segs.get(sn.seg);
    if (!s || s.ring || ROAD_TYPES[s.type].bwd > 0) return null;
    return norm(cubicTangent(s.c, sn.t ?? 0));
  }
  if (sn.node !== undefined) {
    const ss = net.segsAt(sn.node);
    if (ss.length !== 2 || ss.some((s) => s.ring || ROAD_TYPES[s.type].bwd > 0)) return null;
    const out = ss.find((s) => s.a === sn.node), inn = ss.find((s) => s.b === sn.node);
    if (!out || !inn) return null;
    const t = norm(cubicTangent(out.c, 0));
    return dot(t, norm(cubicTangent(inn.c, 1))) > 0.94 ? t : null;
  }
  return null;
}

/** Is the road at this snap a highway carriageway (or a node where only highway carriageways meet)? */
function highwayAt(net: RoadNetwork, sn: Snap): boolean {
  if (sn.seg !== undefined) { const s = net.segs.get(sn.seg); return !!s && !s.ring && isHighway(ROAD_TYPES[s.type]); }
  if (sn.node !== undefined) { const ss = net.segsAt(sn.node); return ss.length > 0 && ss.every((s) => !s.ring && isHighway(ROAD_TYPES[s.type])); }
  return false;
}

const SLIP_TOWN = Math.cos((40 * Math.PI) / 180);

/**
 * How far off a carriageway's line a one-way road can be drawn and still be a slip road onto (or off) it: nearly in
 * line for town one-ways (a sharper angle is a junction in a street grid), up to 75 degrees for a highway road off a
 * highway, which only ever takes traffic on and off by merging.
 */
function slipLimit(net: RoadNetwork, sn: Snap, type: RoadTypeId): number {
  return isHighway(ROAD_TYPES[type]) && highwayAt(net, sn) ? Math.cos((75 * Math.PI) / 180) : SLIP_TOWN;
}

/** Slip roads: a one-way road leaving or joining a one-way carriageway runs exactly along it there. */
export function slipTangents(net: RoadNetwork, start: Snap, end: Snap, type: RoadTypeId): { ta?: V2; tb?: V2 } {
  if (ROAD_TYPES[type].bwd > 0) return {};
  const d = norm(sub(end.p, start.p));
  const out: { ta?: V2; tb?: V2 } = {};
  const sa = oneWayDirAt(net, start), sb = oneWayDirAt(net, end);
  if (sa && dot(sa, d) > slipLimit(net, start, type)) out.ta = sa;
  if (sb && dot(sb, d) > slipLimit(net, end, type)) out.tb = sb;
  return out;
}

/** Radius a slip road turns on as it leaves or joins: roomy enough to read as a ramp, scaled to the road. */
export const rampRadius = (type: RoadTypeId): number => Math.max(ROAD_TYPES[type].minRadius * 3, 60);

/**
 * A slip road's shape. Candidates: the easing transition curve (preferred: it drifts off the lane with no swerve),
 * other single curves, an arc on the ramp radius then a straight, and the plain arc. Each is judged as it will be
 * built, glued in beside the carriageway; the one with the gentlest bend wins. Shapes that swing more than 110
 * degrees or arrive far steeper than drawn are out: drawn like that, it isn't a ramp. [] when nothing fits.
 */
function rampChain(net: RoadNetwork, start: Snap, end: Snap, slip: { ta?: V2; tb?: V2 }, type: RoadTypeId): Cubic[] {
  if (!slip.ta === !slip.tb) return [];
  const atStart = !!slip.ta, sn = atStart ? start : end;
  const [a, t, b] = atStart ? [start.p, slip.ta!, end.p] : [end.p, scale(slip.tb!, -1), start.p];
  const R = rampRadius(type), rMin = ROAD_TYPES[type].minRadius * 1.05;
  const pref = rampCurve(a, t, b, R);
  const cands = [pref, ...rampCurves(a, t, b).map((c) => [c]), arcThenLine(a, t, b, R, rMin), tangentArc(a, t, b, (5 * Math.PI) / 6)].filter((c) => c.length);
  const chordDir = norm(sub(b, a));
  let best: Cubic[] = [], bestScore = -1;
  for (const c of cands) {
    if (chainTurn(c) > (110 * Math.PI) / 180) continue;
    const endDir = norm(cubicTangent(c[c.length - 1], 1));
    if (Math.abs(signedAngle(chordDir, endDir)) > (55 * Math.PI) / 180) continue;
    const ch = atStart ? c : reverseChain(c);
    const r = builtMinRadius(net, ch, sn, atStart, type);
    const score = Math.min(r, R * 2) * (c === pref ? 1.2 : 1);
    if (score > bestScore) { bestScore = score; best = ch; }
  }
  return best;
}

/** The one-way carriageway a slip road leaves or joins at `sn`. */
function carriageAt(net: RoadNetwork, sn: Snap): RSeg | undefined {
  return sn.seg !== undefined ? net.segs.get(sn.seg) : sn.node !== undefined ? net.segsAt(sn.node).find((s) => isOneWayCarriage(s)) : undefined;
}

/** Total heading change along a chain (radians, unsigned sum). */
function chainTurn(ch: Cubic[]): number {
  let t = 0;
  for (const c of ch) t += Math.abs(signedAngle(norm(cubicTangent(c, 0)), norm(cubicTangent(c, 1))));
  return t;
}

/** The tightest bend of a slip road as it will be built: the piece at the carriageway glued in beside it (glueRun). */
function builtMinRadius(net: RoadNetwork, chain: Cubic[], sn: Snap, atStart: boolean, type: RoadTypeId): number {
  let r = Infinity;
  for (const [i, c] of chain.entries()) if (i !== (atStart ? 0 : chain.length - 1)) r = Math.min(r, minRadius(sampleCubic(c, 1.5), 4));
  const main = carriageAt(net, sn);
  const mg = main && net.segGeom.get(main.id);
  if (!chain.length) return r;
  // off a slip lane's gore (not on the carriageway): built as drawn
  if (!main || !mg) return Math.min(r, minRadius(sampleCubic(chain[atStart ? 0 : chain.length - 1], 1.5), 4));
  const piece = atStart ? chain[0] : chain[chain.length - 1];
  const pts = sampleCubic(piece, 1.5);
  const pl = makePolyline(pts);
  // which side of the carriageway the ramp is on: where its far end lies
  const far = atStart ? piece.p3 : piece.p0;
  const c = mg.center, at = polyClosest(c, far).s;
  const side = dot(sub(far, polyAt(c, at)), right(polyDir(c, at))) >= 0 ? 1 : -1;
  const shaped = glueRun(pts, pl.cum, pl.length, atStart ? "a" : "b", c, side * glueGap(main.type, type), false);
  return Math.min(r, minRadius(shaped, 4));
}

function isOneWayCarriage(s: RSeg): boolean { return !s.ring && ROAD_TYPES[s.type].bwd === 0; }

/** The carriageway's heading at a snap on it (a node: the one-way piece there). */
function carriageHeading(net: RoadNetwork, sn: Snap): V2 | null {
  const s = carriageAt(net, sn);
  if (!s) return null;
  const t = sn.seg !== undefined ? sn.t ?? 0 : s.a === sn.node ? 0 : 1;
  return norm(cubicTangent(s.c, t));
}

/** A straight stroke from a to b that runs along the carriageway between them (either way), not across or round from it. */
function alongCarriage(net: RoadNetwork, a: Snap, b: Snap): boolean {
  const ta = carriageHeading(net, a), tb = carriageHeading(net, b);
  const d = sub(b.p, a.p);
  if (!ta || !tb || len(d) < 1) return false;
  const m = add(ta, tb); // a chord of an arc runs along the mean of its end headings
  return len(m) > 0.5 && Math.abs(dot(norm(m), norm(d))) > Math.cos((15 * Math.PI) / 180);
}


/** Where a slip road leaves or joins a carriageway: it may run alongside those roads near there. */
interface SlipAnchor { p: V2; segs: Set<number>; r: number }

/** The carriageway piece at `node` going on (dir 1, leaving it) or back (dir -1, entering it): the main line where a slip road also meets it there. */
function carriageFrom(net: RoadNetwork, node: number, dir: 1 | -1, after?: RSeg): RSeg | undefined {
  const t = after && norm(cubicTangent(after.c, dir > 0 ? 1 : 0));
  const cands = net.segsAt(node).filter((s) => s.id !== after?.id && isOneWayCarriage(s) && (dir > 0 ? s.a === node : s.b === node)
    && (!t || dot(norm(cubicTangent(s.c, dir > 0 ? 0 : 1)), t) > 0.94));
  if (cands.length <= 1) return cands[0];
  const ng = net.nodeGeom.get(node);
  const roles = ng && net.splitRoles(ng.arms, net.segsAt(node));
  return cands.find((s) => s.id === roles?.main.seg) ?? cands.sort((x, y) => ROAD_TYPES[y.type].fwd - ROAD_TYPES[x.type].fwd)[0];
}

/** Arc length of a cubic from its start to `t`. */
const arcTo = (c: Cubic, t: number): number => (t <= 0 ? 0 : makePolyline(sampleCubic(subCubic(c, 0, Math.min(1, t)), 1)).length);

/** A stretch of carriageway walked from a point: seg param ta to tb (in walking order), at distances d0..d1 from the start; node: the node reached at tb. */
interface Walked { seg: RSeg; ta: number; tb: number; d0: number; d1: number; node?: number }

/** Walk a one-way carriageway from `sn` with its traffic (dir 1) or against it (-1), up to `max` metres, along the main line. */
function walkCarriage(net: RoadNetwork, sn: Snap, dir: 1 | -1, max: number): Walked[] {
  const out: Walked[] = [];
  let seg: RSeg | undefined, t: number;
  if (sn.seg !== undefined) { seg = net.segs.get(sn.seg); t = sn.t ?? 0; }
  else if (sn.node !== undefined) { seg = carriageFrom(net, sn.node, dir); t = dir > 0 ? 0 : 1; }
  else return out;
  let d = 0;
  while (seg && isOneWayCarriage(seg) && out.length < 40) {
    const at = arcTo(seg.c, t), full = arcTo(seg.c, 1);
    const room = dir > 0 ? full - at : at;
    if (d + room >= max) {
      out.push({ seg, ta: t, tb: tAtLength(seg.c, at + dir * (max - d)), d0: d, d1: max });
      break;
    }
    const node = dir > 0 ? seg.b : seg.a;
    out.push({ seg, ta: t, tb: dir > 0 ? 1 : 0, d0: d, d1: d + room, node });
    d += room;
    seg = carriageFrom(net, node, dir, seg);
    t = dir > 0 ? 0 : 1;
  }
  return out;
}

/** The pieces of carriageway from `from` on to `to` in its travel direction, or null if `to` isn't further along it. */
function stretchBetween(net: RoadNetwork, from: Snap, to: Snap): { seg: RSeg; t0: number; t1: number }[] | null {
  if ((from.seg === undefined && from.node === undefined) || (to.seg === undefined && to.node === undefined)) return null;
  const pieces: { seg: RSeg; t0: number; t1: number }[] = [];
  let cur = from.seg !== undefined ? net.segs.get(from.seg) : carriageFrom(net, from.node!, 1);
  let t0 = from.seg !== undefined ? from.t ?? 0 : 0;
  for (let hop = 0; cur && hop < 40; hop++) {
    if (!isOneWayCarriage(cur)) return null;
    if (to.seg === cur.id) {
      if ((to.t ?? 0) <= t0 + 1e-3) return null;
      pieces.push({ seg: cur, t0, t1: to.t ?? 1 });
      return pieces;
    }
    pieces.push({ seg: cur, t0, t1: 1 });
    if (to.node === cur.b) return pieces;
    cur = carriageFrom(net, cur.b, 1, cur);
    t0 = 0;
  }
  return null;
}

/** How long a slip lane runs beside the carriageway: before an exit (to slow down) and, a bit longer, after an entry (to speed up). */
export function slipLaneLength(main: RoadTypeId, exit: boolean): number {
  const kmh = ROAD_TYPES[main].speed * 3.6;
  return Math.round((clamp(kmh * 1.35, 100, 200) * (exit ? 1 : 1.25)) / 10) * 10;
}

/** A slip lane ending this close to the next one (an entry's, then an exit's) runs on into it as one lane (a weave). */
export const SLIP_JOIN = 250;
/** The shortest slip lane worth building. */
const SLIP_MIN = 60;

/** Which end of road `id` is a slip lane's: glued beside a carriageway all the way from the node there. null: not one. */
export function slipLaneEnd(net: RoadNetwork, id: number): "a" | "b" | null {
  const g = net.segGeom.get(id);
  return g?.ends.a.glue?.full ? "a" : g?.ends.b.glue?.full ? "b" : null;
}

/** A ramp's slip lane, planned. */
interface SlipPiece {
  /** on the carriageway: where the lane opens (an exit's) or ends (an entry's) */
  at: Snap;
  /** beside the carriageway where the ramp proper leaves it (exit) or arrives (entry) */
  gore: { p: V2; h: number };
  /** the lane's road as committed (exit: at to gore; entry: gore to at) and as it will look, beside the carriageway */
  cubic: Cubic;
  show: Cubic;
  length: number;
  joined: boolean;
  /** carriageway pieces it runs beside */
  beside: number[];
}

/**
 * Lay a slip lane beside the carriageway from the gore beside `foot` (a point on the carriageway): back against the
 * traffic for an exit's deceleration lane, on with it for an entry's acceleration lane, `want` metres. It stops short
 * of anything in the way (a junction, another ramp, the carriageway's end); and if the next ramp's lane the other way
 * round is on this side within `reach` past that (an entry's lane, before an exit; an exit's, after an entry), it runs
 * on into it: one lane between them, a weave. `pass`: carriageway nodes to look past (the lane being redrawn).
 */
function laySlip(net: RoadNetwork, foot: Snap, exit: boolean, sg: 1 | -1, type: RoadTypeId, want: number, reach: number, pass?: Set<number>): SlipPiece | null {
  const main = carriageAt(net, foot);
  if (!main || !isHighway(ROAD_TYPES[main.type]) || !isHighway(ROAD_TYPES[type])) return null;
  const dir = exit ? -1 : 1;
  const walk = walkCarriage(net, foot, dir, want + reach);
  if (!walk.length) return null;
  let dEnd = Math.min(want, walk[walk.length - 1].d1);
  let join: number | undefined;
  for (const w of walk) {
    if (w.node === undefined) break;
    if (pass?.has(w.node)) continue;
    const ng = net.nodeGeom.get(w.node);
    if (ng && (ng.kind === "cont" || ng.kind === "bend")) continue;
    const roles = ng?.kind === "split" ? net.splitRoles(ng.arms, net.segsAt(w.node)) : null;
    const lane = roles?.ramp && !roles.rampIn && roles.side === sg && roles.diverge === !exit ? slipLaneEnd(net, roles.ramp.seg) : null;
    if (lane && w.d1 >= SLIP_MIN && w.d1 <= want + reach) { join = w.node; dEnd = w.d1; break; }
    if (w.d1 - 30 < dEnd) dEnd = w.d1 - 30;
    break;
  }
  if (walk[walk.length - 1].d1 < dEnd) dEnd = walk[walk.length - 1].d1 - 30; // the carriageway turns into something else
  if (dEnd < SLIP_MIN) return null;
  // where it meets the carriageway, and the carriageway's heading there
  let at: Snap | null = null, tA: V2 | null = null;
  const beside: number[] = [];
  for (const w of walk) {
    if (w.d0 >= dEnd - 1e-6) break;
    beside.push(w.seg.id);
    if (w.d1 < dEnd - 0.5) continue;
    if (w.node !== undefined && w.d1 - dEnd < 3) {
      const nd = net.nodes.get(w.node)!;
      at = { p: { ...nd.p }, h: nd.h, node: w.node, guides: [] };
      tA = norm(cubicTangent(w.seg.c, w.tb));
    } else {
      const t = tAtLength(w.seg.c, arcTo(w.seg.c, w.ta) + dir * (dEnd - w.d0));
      at = { p: cubicAt(w.seg.c, t), h: net.heightOnSeg(w.seg.id, t), seg: w.seg.id, t, guides: [] };
      tA = norm(cubicTangent(w.seg.c, t));
    }
    break;
  }
  if (!at || !tA) return null;
  const tF = norm(cubicTangent(walk[0].seg.c, walk[0].ta));
  const D = sg * glueGap(main.type, type);
  const gore = { p: add(foot.p, scale(right(tF), D)), h: foot.h };
  const k = dEnd / 3, side = add(at.p, scale(right(tA), D));
  const cubic: Cubic = exit
    ? { p0: at.p, p1: add(at.p, scale(tA, k)), p2: sub(gore.p, scale(tF, k)), p3: gore.p }
    : { p0: gore.p, p1: add(gore.p, scale(tF, k)), p2: sub(at.p, scale(tA, k)), p3: at.p };
  const show: Cubic = exit
    ? { p0: side, p1: add(side, scale(tA, k)), p2: cubic.p2, p3: cubic.p3 }
    : { p0: cubic.p0, p1: cubic.p1, p2: sub(side, scale(tA, k)), p3: side };
  return { at, gore, cubic, show, length: dEnd, joined: join !== undefined, beside };
}

/** The slip lane (road id, its carriageway node, exit or entry) that a stroke drawn along the carriageway starts or ends at. */
function slipAt(net: RoadNetwork, sn: Snap): { seg: RSeg; node: number; exit: boolean } | null {
  const lane = (node: number) => {
    for (const s of net.segsAt(node)) {
      const e = slipLaneEnd(net, s.id);
      if (!e || (e === "a" ? s.a : s.b) !== node) continue;
      // a weave (the lane runs on into the next one) is as long as it goes
      if (net.segsAt(node).length > 3) return null;
      return { seg: s, node, exit: e === "a" };
    }
    return null;
  };
  if (sn.node !== undefined) return lane(sn.node);
  if (sn.seg === undefined) return null;
  const s = net.segs.get(sn.seg)!;
  // on the lane itself, near where it meets the carriageway
  const own = slipLaneEnd(net, s.id);
  if (own) { const n = own === "a" ? s.a : s.b; return dist(net.nodes.get(n)!.p, sn.p) < 50 ? lane(n) : null; }
  // on the carriageway just short of it
  for (const n of [s.a, s.b]) if (dist(net.nodes.get(n)!.p, sn.p) < 40) { const r = lane(n); if (r) return r; }
  return null;
}

/** The point on the carriageway beside a slip lane's gore (not the lane or its ramp, which meet there). */
function carriageFoot(net: RoadNetwork, gore: number, lane: RSeg, exit: boolean, d: number): Snap | null {
  const { p, h } = net.nodes.get(gore)!;
  // the lane's heading at the gore: its own carriageway runs the same way, with the lane on the glued side
  const lt = norm(cubicTangent(lane.c, exit ? 1 : 0));
  let best: Snap | null = null, bd = 3;
  for (const id of net.segsNear(p.x - 14, p.y - 14, p.x + 14, p.y + 14)) {
    const s = net.segs.get(id)!;
    if (!isOneWayCarriage(s) || s.a === gore || s.b === gore || slipLaneEnd(net, id)) continue;
    const r = cubicClosest(s.c, p);
    const hh = net.heightOnSeg(id, r.t);
    const tc = norm(cubicTangent(s.c, r.t));
    if (Math.abs(hh - h) >= 1 || dot(tc, lt) < 0.5) continue;
    // (a median-side lane at the usual spacing is nearly as close to the other carriageway as to its own)
    // (and the other one runs the other way: excluded above)
    const miss = Math.abs(r.d - Math.abs(d));
    if (miss < bd) { bd = miss; best = { p: r.p, h: hh, seg: id, t: r.t, guides: [] }; }
  }
  return best;
}

/** How far along the carriageway from `from` (with the traffic, or against it) `to` lies, up to `max`. null: not along it. */
function alongTo(net: RoadNetwork, from: Snap, to: Snap, dir: 1 | -1, max: number): number | null {
  for (const w of walkCarriage(net, from, dir, max)) {
    if (to.node !== undefined && w.node === to.node) return w.d1;
    if (to.seg === w.seg.id && to.t !== undefined && (to.t - w.ta) * dir >= -1e-4 && (w.tb - to.t) * dir >= -1e-4) return w.d0 + Math.abs(arcTo(w.seg.c, to.t) - arcTo(w.seg.c, w.ta));
  }
  return null;
}

/** A slip lane's road (plus the ramp from the gore, if any): heights following the carriageway, then the ramp's. */
function slipStroke(piece: SlipPiece, ramp: Cubic[], exit: boolean, far: { h: number }, type: RoadTypeId): Stroke {
  const chain = exit ? [piece.cubic, ...ramp] : [...ramp, piece.cubic];
  const show = exit ? [piece.show, ...ramp] : [...ramp, piece.show];
  const lens = ramp.map((c) => makePolyline(sampleCubic(c, 2)).length);
  const total = lens.reduce((a, b) => a + b, 0) || 1;
  // joint heights along the ramp, from the gore to its far end (exit) or from its start to the gore (entry)
  const rampH: number[] = [];
  let acc = 0;
  for (let i = 0; i <= ramp.length; i++) {
    const f = acc / total;
    rampH.push(exit ? piece.gore.h + (far.h - piece.gore.h) * smoothstep(f) : far.h + (piece.gore.h - far.h) * smoothstep(f));
    if (i < ramp.length) acc += lens[i];
  }
  const hj = exit ? [piece.at.h, ...rampH] : [...rampH, piece.at.h];
  return { chain, show, hj, h0: hj[0], h1: hj[hj.length - 1], type, beside: piece.beside };
}

/**
 * Drawing a highway road along a carriageway from a slip lane's start (or to an entry's lane end): the lane redrawn
 * that much longer. Drawn back to the lane of the ramp before (an entry's, before an exit) or on to the next one's,
 * the two run into one, a weave.
 */
function planSlipExtend(net: RoadNetwork, world: BuildWorld, start: Snap, end: Snap, type: RoadTypeId): Plan | null {
  if (!isHighway(ROAD_TYPES[type])) return null;
  for (const [here, there] of [[start, end], [end, start]] as const) {
    const sl = slipAt(net, here);
    if (!sl) continue;
    if (there.seg === undefined && there.node === undefined) return null;
    if (there.seg !== undefined && slipLaneEnd(net, there.seg)) return null;
    const s = sl.seg, gn = net.nodes.get(sl.exit ? s.b : s.a)!;
    const g = net.segGeom.get(s.id)!.ends[sl.exit ? "a" : "b"].glue!;
    const foot = carriageFoot(net, gn.id, s, sl.exit, g.d);
    if (!foot) return null;
    const dir = sl.exit ? -1 : 1;
    const want = alongTo(net, foot, there, dir, 3000);
    const now = net.segGeom.get(s.id)!.center.length;
    if (want === null || want < now + 5) return null;
    const sg = (g.d >= 0 ? 1 : -1) as 1 | -1;
    const piece = laySlip(net, foot, sl.exit, sg, s.type, want, 40, new Set([sl.node]));
    const msgP = there.p;
    if (!piece || (!piece.joined && piece.length < want - 1)) {
      return { strokes: [], cost: 0, length: 0, errors: [{ msg: "Something's in the way of the slip lane", p: msgP }], crossings: [], kind: "road" };
    }
    // the lane's road: from the new start to the gore (exit), or the gore to the new end (entry)
    const ends = { at: piece.at, gore: { p: { ...gn.p }, h: gn.h, node: gn.id, guides: [] } as Snap };
    const cubic: Cubic = sl.exit ? { ...piece.cubic, p3: gn.p } : { ...piece.cubic, p0: gn.p };
    const st: Stroke = { chain: [cubic], show: [piece.show], h0: sl.exit ? piece.at.h : gn.h, h1: sl.exit ? gn.h : piece.at.h, type: s.type, beside: piece.beside };
    const anchors: AnchorHint[] = sl.exit
      ? [{ p: ends.at.p, node: ends.at.node, seg: ends.at.seg }, { p: gn.p, node: gn.id }]
      : [{ p: gn.p, node: gn.id }, { p: ends.at.p, node: ends.at.node, seg: ends.at.seg }];
    const slips: SlipAnchor[] = [{ p: piece.at.p, segs: new Set([...piece.beside, ...(piece.at.node !== undefined ? net.segsAt(piece.at.node).map((x) => x.id) : [])]), r: piece.length + 30 }];
    const plan = validateStrokes(net, world, [st], "road", anchors, { segs: new Set([s.id]), nodes: new Set() }, undefined, (id) => id === s.id, slips);
    plan.removeSegs = [s.id];
    plan.cost = Math.max(0, plan.cost - segCost(net, s.id, world));
    plan.errors = plan.errors.filter((e) => !e.msg.startsWith("Not enough money"));
    if (plan.cost > world.money() + 0.5) plan.errors.push({ msg: `Not enough money for ${fmt(plan.cost)}`, p: msgP });
    plan.note = piece.joined ? "Slip lanes joined" : `${Math.round(piece.length)} m slip lane`;
    plan.continueAt = { p: { ...end.p }, h: end.h };
    return plan;
  }
  return null;
}

/** Build and validate a single road stroke. */
// ---------------------------------------------------------------------------------------------
// Automatic bridges (the player's road tool, like Transport Fever 2)
// ---------------------------------------------------------------------------------------------

/** Room either side of what a bridge clears before its ramp may start coming down (m). */
const BRIDGE_PAD = 4;
/** Two bridges whose ramps would come closer than this become one deck (m). */
const BRIDGE_JOIN = 24;
/** The shortest piece from a junction to the foot of a ramp off it (m): MIN_SEG_LEN and a little to trim. */
const JUNCTION_ARM = 9;
/** The lowest a humped deck over water may top out (m): high enough for piers, clear of the water. */
const HUMP_MIN = 3;

/** Can a road of type `type` cross `seg` at grade, as a junction? Motorways meet nothing at grade. */
function meetsAtGrade(net: RoadNetwork, seg: number, type: RoadTypeId): boolean {
  const s = net.segs.get(seg);
  if (!s) return true;
  const motorway = (t: RoadTypeId) => isHighway(ROAD_TYPES[t]) && t !== "hw1";
  return !motorway(s.type) && !motorway(type) && !(isHighway(ROAD_TYPES[s.type]) && !s.ring && !isHighway(ROAD_TYPES[type]));
}

/** Deck height that clears a road at height hRoad (whole levels, as Page Up builds them). */
const deckOver = (hRoad: number) => Math.ceil((hRoad + CLEARANCE - 0.05) / LEVEL_H) * LEVEL_H;

/** The chain cut at the given arc lengths (each strictly inside one of its pieces), and the arc length of every joint. */
function cutAt(chain: Cubic[], cuts: number[]): { chain: Cubic[]; joints: number[] } {
  const out: Cubic[] = [];
  const joints: number[] = [0];
  let acc = 0;
  for (const c of chain) {
    const l = makePolyline(sampleCubic(c, 1)).length;
    const inside = cuts.filter((s) => s > acc + 0.5 && s < acc + l - 0.5).sort((x, y) => x - y);
    let t0 = 0;
    for (const s of inside) {
      const t = tAtLength(c, s - acc);
      out.push(subCubic(c, t0, t));
      joints.push(s);
      t0 = t;
    }
    out.push(subCubic(c, t0, 1));
    acc += l;
    joints.push(acc);
  }
  return { chain: out, joints };
}

/**
 * Raise a stroke onto bridges wherever it needs one: over water, and over roads it crosses at the same level that it
 * can't meet as a junction there (a motorway, a crossing too shallow, too close to a junction or to the next crossing,
 * or a road part-way up a ramp). Each bridge's deck clears the obstacle with room to spare; its ramps climb at the
 * steepest grade a ramp may take. Bridges whose ramps would meet become one. Returns the stroke with joint heights
 * (hj) and the spans, or errors saying why a bridge can't fit and what to do.
 */
function autoBridge(net: RoadNetwork, world: BuildWorld, st: Stroke, ignore: { segs: Set<number>; nodes: Set<number> }): { st: Stroke; spans: BridgeSpan[]; errors: PlanError[] } {
  const none = { st, spans: [], errors: [] };
  if (st.hj || st.beside || st.closed || st.ring || !st.chain.length) return none;
  const T = ROAD_TYPES[st.type];
  const hw = roadWidth(T) / 2;
  const pts = chainPoints(st.chain, 2);
  const pl = makePolyline(pts);
  const L = pl.length, cum = pl.cum;
  if (L < MIN_SEG_LEN) return none;
  const base = strokeHeights(net, st, pts, cum);
  const baseAt = (s: number) => st.h0 + (st.h1 - st.h0) * smoothstep(clamp(s / L, 0, 1));
  // (d0, d1: where the deck would stand at full height, kept for the length shown when the ramps run out over it)
  type Ob = { s0: number; s1: number; h: number; water: boolean; road: boolean; d0?: number; d1?: number };
  const obs: Ob[] = [];
  // water, under the whole width of the road
  let run: number | null = null;
  for (let i = 0; i <= pts.length; i++) {
    let wet = false;
    if (i < pts.length && base[i] < LEVEL_H * 0.5) {
      const n = right(polyDir(pl, cum[i]));
      wet = world.isWater(pts[i]) || world.isWater(add(pts[i], scale(n, hw))) || world.isWater(add(pts[i], scale(n, -hw)));
    }
    if (wet && run === null) run = i;
    if (!wet && run !== null) {
      obs.push({ s0: cum[run] - BRIDGE_PAD, s1: cum[i - 1] + BRIDGE_PAD, h: LEVEL_H, water: true, road: false });
      run = null;
    }
  }
  // roads it can't meet at grade
  const cx = findCrossings(net, pts, cum, base, ignore);
  // (where it meets a road at grade: a junction there, so no deck over it; m: how far from it a ramp may start)
  const kept: { s: number; m: number }[] = [];
  // (from a junction to where a ramp may start: past both roads' edges at the angle they meet, and a piece long
  // enough to build and to trim the junction back from)
  const armPast = (w: number, angle: number) => Math.max(JUNCTION_ARM, w / 2 / Math.max(0.3, Math.sin(angle)) + hw / Math.max(0.3, Math.tan(Math.max(angle, 0.1))) + 1);
  const all = [...cx.crossings.map((c) => ({ ...c, grade: true })), ...cx.bad.map((b) => ({ ...b, grade: false }))].sort((a, b) => a.sPlan - b.sPlan);
  for (const [k, c] of all.entries()) {
    let lift = !c.grade || !meetsAtGrade(net, c.seg, st.type) || c.angle < MIN_ARM_ANGLE;
    if (!lift) {
      const near = (o?: { sPlan: number }) => !!o && Math.abs(o.sPlan - c.sPlan) < 14;
      if (near(all[k - 1]) || near(all[k + 1])) lift = true;
      const s = net.segs.get(c.seg)!;
      for (const n of [s.a, s.b]) {
        if (isRingFiller(net, n)) continue;
        const d = dist(net.nodes.get(n)!.p, c.p);
        if (d >= 3 && d < 12) lift = true;
      }
    }
    const sg = net.segGeom.get(c.seg);
    if (!lift) { kept.push({ s: c.sPlan, m: armPast(sg ? sg.width : 12, c.angle) }); continue; }
    // the length of this road that passes over the other: its width seen at the crossing angle
    const half = (sg ? sg.width / 2 : 6) / Math.max(0.3, Math.sin(c.angle)) + hw / Math.max(0.3, Math.tan(Math.max(c.angle, 0.1)));
    obs.push({ s0: c.sPlan - half - BRIDGE_PAD, s1: c.sPlan + half + BRIDGE_PAD, h: deckOver(c.hSeg), water: false, road: true });
  }
  if (!obs.length) return none;
  obs.sort((a, b) => a.s0 - b.s0);
  // the ramps' feet: from the ground either side up to the deck at the steepest grade allowed
  type Span = Ob & { f0: number; f1: number };
  // The foot is where a ramp at the steepest grade meets the stroke's own height there, which differs from its
  // height at the deck's end when the stroke itself climbs or falls (a raised road drawn from a street): solve
  // (h - baseAt(f)) / (s - f) = grade by iterating. A stroke that reaches the deck's height at its end runs on
  // level to that end, with no dip down and up again. A hair under the limit so cuts nudged onto joints still pass.
  const G = MAX_GRADE * 0.97;
  // (a level run to the end only where the stroke meets no road at grade on the way: that road is joined, not
  // passed over)
  const clear = (a: number, b: number) => !kept.some((k) => k.s > a && k.s < b);
  const solve = (s: number, h: number, dir: 1 | -1) => {
    let f = s + (dir * Math.max(0, h - baseAt(s))) / G;
    for (let k = 0; k < 200; k++) {
      const g = s + (dir * Math.max(0, h - baseAt(f))) / G;
      if (Math.abs(g - f) < 0.01) return g;
      f = g;
    }
    return f;
  };
  const footBack = (s: number, h: number) => (st.h0 > st.h1 + 0.1 && baseAt(0) >= h - 0.3 && clear(0, s) ? 0 : solve(s, h, -1));
  const footOn = (s: number, h: number) => (st.h1 > st.h0 + 0.1 && baseAt(L) >= h - 0.3 && clear(s, L) ? L : solve(s, h, 1));
  const feet = (o: Ob): Span => ({ ...o, f0: footBack(o.s0, o.h), f1: footOn(o.s1, o.h) });
  const join = (a: Span, b: Span): Span => feet({ s0: Math.min(a.s0, b.s0), s1: Math.max(a.s1, b.s1), h: Math.max(a.h, b.h), water: a.water || b.water, road: a.road || b.road });
  let spans: Span[] = obs.map(feet);
  // bridges whose ramps would meet become one deck (merging can push a ramp into the next one: until none overlap)
  for (let changed = true; changed;) {
    changed = false;
    const next: Span[] = [];
    for (const sp of spans) {
      const last = next[next.length - 1];
      if (last && sp.f0 < last.f1 + BRIDGE_JOIN) { next[next.length - 1] = join(last, sp); changed = true; }
      else next.push(sp);
    }
    spans = next;
  }
  const errors: PlanError[] = [];
  const maxH = MAX_LEVEL * LEVEL_H;
  // Over water only, a ramp that would run back past the stroke's end or across a road it joins at grade (a street
  // along the bank) starts just after it instead and climbs on over the water: a low deck off the bank, as a river
  // bridge leaves a quay (road play 2026-11-12, C1). Two ramps that then meet make a humped deck, lower than a level.
  // (Over a road the deck must clear it, so there the ramps keep their full length.)
  // (the foot on dry land: the water was found at samples 2 m apart, so it may begin up to 2 m before wet0)
  const EDGE = 2.5;
  const offTheBank = (sp: Span): PlanError | null => {
    const wet0 = sp.s0 + BRIDGE_PAD, wet1 = sp.s1 - BRIDGE_PAD;
    const before = kept.filter((k) => k.s < wet0).map((k) => k.s + k.m);
    const after = kept.filter((k) => k.s > wet1).map((k) => k.s - k.m);
    // (an end on a road at grade is a junction too)
    const a0 = endArm(0), a1 = endArm(L);
    if (a0) before.push(a0);
    if (a1) after.push(L - a1);
    const lo = Math.max(0, ...before), hi = Math.min(L, ...after);
    const d0 = sp.s0, d1 = sp.s1;
    if (sp.f0 < lo - 0.01) {
      if (lo > wet0 - EDGE) return before.length && lo > 0 ? { msg: "No room to ramp up between the road and the water", p: polyAt(pl, clamp(lo, 0, L)) } : { msg: `Start ${Math.max(1, Math.ceil(EDGE - wet0 + lo))} m further back to ramp up over the water`, p: pts[0] };
      sp.f0 = lo;
      sp.s0 = Math.max(sp.s0, lo + Math.max(0, sp.h - baseAt(lo)) / G);
    }
    if (sp.f1 > hi + 0.01) {
      if (hi < wet1 + EDGE) return after.length && hi < L ? { msg: "No room to ramp down between the water and the road", p: polyAt(pl, clamp(hi, 0, L)) } : { msg: `Carry on ${Math.max(1, Math.ceil(wet1 + EDGE - hi))} m to ramp down from the bridge`, p: pts[pts.length - 1] };
      sp.f1 = hi;
      sp.s1 = Math.min(sp.s1, hi - Math.max(0, sp.h - baseAt(hi)) / G);
    }
    if (sp.s0 > sp.s1) {
      // the ramps meet: a hump at the height they reach, high enough to stand on piers clear of the water
      const b0 = baseAt(sp.f0), b1 = baseAt(sp.f1);
      sp.h = ((sp.f1 - sp.f0) * G + b0 + b1) / 2;
      if (sp.h < HUMP_MIN) return { msg: "No room either side of the water to ramp up", p: polyAt(pl, clamp((d0 + d1) / 2, 0, L)) };
      sp.s0 = sp.s1 = sp.f0 + Math.max(0, sp.h - b0) / G;
    }
    if (sp.s0 !== d0 || sp.s1 !== d1) { sp.d0 = d0; sp.d1 = d1; }
    return null;
  };
  /** The arm a stroke's end needs before a ramp when it starts or ends on a road at grade (0 if it doesn't). */
  const endArm = (s: number): number => {
    const p = polyAt(pl, s), h = baseAt(s);
    let arm = 0;
    for (const id of net.segsNear(p.x - 2, p.y - 2, p.x + 2, p.y + 2)) {
      const g = net.segGeom.get(id);
      if (!g) continue;
      const c = polyClosest(g.center, p);
      if (c.d > 1.5 || Math.abs(net.heightOnSeg(id, cubicClosest(net.segs.get(id)!.c, p).t) - h) > 0.6) continue;
      const angle = Math.acos(clamp(Math.abs(dot(polyDir(g.center, c.s), polyDir(pl, s))), 0, 1));
      arm = Math.max(arm, armPast(g.width, angle));
    }
    return arm;
  };
  for (const sp of spans) {
    const what = sp.water && !sp.road ? "the water" : sp.road && !sp.water ? "the road" : "the crossing";
    if (sp.h > maxH + 0.1) { errors.push({ msg: `Too high to bridge ${what} here`, p: polyAt(pl, clamp((sp.s0 + sp.s1) / 2, 0, L)) }); continue; }
    if (sp.s0 + BRIDGE_PAD < 0.5 && baseAt(0) < sp.h - 0.3) errors.push({ msg: `Can't start on ${what}`, p: pts[0] });
    else if (sp.s1 - BRIDGE_PAD > L - 0.5 && baseAt(L) < sp.h - 0.3) errors.push({ msg: `Can't end on ${what}`, p: pts[pts.length - 1] });
    else if (sp.water && !sp.road) { const e = offTheBank(sp); if (e) errors.push(e); }
    else if (sp.f0 < -0.5) errors.push({ msg: `Start ${Math.ceil(-sp.f0)} m further back to ramp up over ${what}`, p: pts[0] });
    else if (sp.f1 > L + 0.5) errors.push({ msg: `Carry on ${Math.ceil(sp.f1 - L)} m to ramp down from the bridge`, p: pts[pts.length - 1] });
    sp.f0 = Math.max(0, sp.f0);
    sp.f1 = Math.min(L, sp.f1);
    sp.s0 = Math.max(sp.f0, sp.s0);
    sp.s1 = Math.min(sp.f1, sp.s1);
  }
  if (errors.length) return { st, spans: [], errors };
  // joint heights: the ground profile away from bridges, straight ramps up to each deck
  const prof = (s: number): number => {
    for (const sp of spans) {
      if (s < sp.f0 - 1e-6 || s > sp.f1 + 1e-6) continue;
      if (s <= sp.s0) return sp.s0 - sp.f0 < 1e-6 ? sp.h : baseAt(sp.f0) + (sp.h - baseAt(sp.f0)) * ((s - sp.f0) / (sp.s0 - sp.f0));
      if (s >= sp.s1) return sp.f1 - sp.s1 < 1e-6 ? sp.h : sp.h + (baseAt(sp.f1) - sp.h) * ((s - sp.s1) / (sp.f1 - sp.s1));
      return sp.h;
    }
    return baseAt(s);
  };
  // cut at the ramps' feet and the decks' ends; a cut within 3 m of an existing joint moves onto it
  const pieceEnds: number[] = [];
  { let acc = 0; for (const c of st.chain) { acc += makePolyline(sampleCubic(c, 1)).length; pieceEnds.push(acc); } }
  const cuts: number[] = [];
  for (const sp of spans) for (const s of [sp.f0, sp.s0, sp.s1, sp.f1]) {
    if (s < 3 || s > L - 3) continue;
    if (pieceEnds.some((e) => Math.abs(e - s) < 3)) continue;
    if (cuts.some((c) => Math.abs(c - s) < 3)) continue;
    cuts.push(s);
  }
  const { chain, joints } = cutAt(st.chain, cuts);
  const hj = joints.map((s, i) => (i === 0 ? st.h0 : i === joints.length - 1 ? st.h1 : prof(s)));
  const out: Stroke = { ...st, chain, hj };
  const outPts = chainPoints(chain, 2), outPl = makePolyline(outPts);
  const outH = strokeHeights(net, out, outPts, outPl.cum);
  const res: BridgeSpan[] = spans.map((sp) => {
    const idx: number[] = [];
    for (let i = 0; i < outPts.length; i++) if (outPl.cum[i] >= sp.f0 - 1 && outPl.cum[i] <= sp.f1 + 1) idx.push(i);
    return {
      a: polyAt(outPl, sp.d0 ?? sp.s0), b: polyAt(outPl, sp.d1 ?? sp.s1), footA: polyAt(outPl, sp.f0), footB: polyAt(outPl, sp.f1),
      // (a dirt road's bridge and its ramps are built as a paved street, at a street's price; its length, the deck's,
      // or the water and its banks where the ramps run out over it)
      h: sp.h, length: (sp.d1 ?? sp.s1) - (sp.d0 ?? sp.s0), cost: costOfPoints(idx.map((i) => outPts[i]), idx.map((i) => outH[i]), T.unpaved ? PAVED_DECK : st.type, world),
      over: sp.water && sp.road ? "both" : sp.water ? "water" : "road",
    };
  });
  return { st: out, spans: res, errors: [] };
}

/**
 * Plan a road from the player's input. With `bridges` (the player's road tool) it also fixes the obvious on its own:
 * an end on a road just short of a junction moves onto the junction, and a free end that crosses a road and stops
 * just past it ends on that road instead; and it raises the road onto bridges where it needs them (autoBridge).
 */
export function planRoad(net: RoadNetwork, world: BuildWorld, inp: PlanInput): Plan {
  if (!inp.bridges) return planRoadOnce(net, world, inp);
  const fixed: string[] = [];
  const start = ontoJunction(net, inp.start), end = ontoJunction(net, inp.end);
  if (start !== inp.start || end !== inp.end) fixed.push("Moved onto the junction");
  let plan = planRoadOnce(net, world, { ...inp, start, end });
  let used = { start, end };
  // a free end that stops just past (or before) a road it crosses: end on that road instead
  const lead = plan.strokes[0];
  if (lead && !inp.parallel && plan.crossings.length) {
    const ends: ["start" | "end", Snap][] = [["end", end], ["start", start]];
    for (const [which, sn] of ends) {
      if (sn.node !== undefined || sn.seg !== undefined || sn.ringRaw) continue;
      const near = plan.crossings.filter((c) => dist(c, sn.p) < 10).sort((a, b) => dist(a, sn.p) - dist(b, sn.p))[0];
      if (!near) continue;
      const on = roadAt(net, near, sn.h);
      if (!on) continue;
      const alt = planRoadOnce(net, world, { ...inp, start: which === "start" ? on : start, end: which === "end" ? on : end });
      if (alt.errors.length <= plan.errors.length && alt.strokes.length) {
        plan = alt;
        used = { start: which === "start" ? on : start, end: which === "end" ? on : end };
        fixed.push(which === "end" ? "Ends on the road it crossed" : "Starts on the road it crossed");
        break;
      }
    }
  }
  // A raised road joins something. Free at both ends it would stand on piers with nothing reaching it, and a raised
  // free end over water is a pier in the river. (Checked on the ends the fixes above settled on.)
  const loose = (s: Snap) => s.node === undefined && s.seg === undefined && !s.site;
  const refuse = (msg: string, p: V2): Plan => ({ strokes: [], cost: 0, length: 0, errors: [{ msg, p }], crossings: [], kind: "road" });
  if (!ROAD_TYPES[inp.type].unpaved) {
    if (loose(used.start) && loose(used.end) && Math.max(used.start.h, used.end.h) > RAISED) return refuse("Start or end a raised road on a road", used.end.p);
    for (const [sn, what] of [[used.start, "start"], [used.end, "end"]] as const) {
      if (loose(sn) && sn.h > RAISED && world.isWater(sn.p)) return refuse(`Can't ${what} on the water`, sn.p);
    }
  }
  if (!plan.errors.length && !inp.parallel) {
    const stubs = stubsLeft(net, world, plan);
    if (stubs.length) {
      plan.stubs = stubs.map(({ at, drop }) => ({ at, drop }));
      const m = Math.round(Math.max(...stubs.map((x) => x.len)));
      fixed.push(stubs.length === 1 ? `Removes the ${m} m dead end past the junction` : `Removes ${stubs.length} dead ends past the junctions`);
    }
  }
  if (fixed.length) plan.fixed = fixed;
  return plan;
}

/** A dead end shorter than this left past a new junction is a stub, not a street (road play 2026-11-10). */
export const STUB_MAX = 30;

/**
 * The dead ends a road leaves sticking out past the junctions it makes: where it crosses a street at grade a short
 * way from that street's dead end, the bit beyond (and its turning circle) serves nothing. Only a single piece with
 * nothing on it (no building's way in, no stop) and a free end that is no ring's or works' gate.
 */
function stubsLeft(net: RoadNetwork, world: BuildWorld, plan: Plan): { at: V2; drop: number; len: number }[] {
  const out: { at: V2; drop: number; len: number }[] = [];
  const ends = plan.strokes.flatMap((st) => (st.chain.length ? [st.chain[0].p0, st.chain[st.chain.length - 1].p3] : []));
  for (const c of plan.crossings) {
    for (const id of net.segsNear(c.x - 2, c.y - 2, c.x + 2, c.y + 2)) {
      const s = net.segs.get(id)!;
      const g = net.segGeom.get(id);
      if (!g || s.ring || slipLaneEnd(net, id)) continue;
      const r = cubicClosest(s.c, c);
      if (r.d > 1) continue;
      const sAt = polyClosest(g.center, r.p).s;
      // (a short road cut into two short dead ends is a road the player is still laying, not a stub)
      if (sAt < STUB_MAX && g.center.length - sAt < STUB_MAX) continue;
      for (const [end, len, lo, hi] of [[s.a, sAt, 0, sAt], [s.b, g.center.length - sAt, sAt, g.center.length]] as const) {
        if (len < 3 || len >= STUB_MAX || net.segsAt(end).length !== 1) continue;
        if (ends.some((q) => dist(q, net.nodes.get(end)!.p) < 1)) continue; // (the new road starts or ends there)
        if ((world.servedOn?.(id) ?? []).some((x) => x >= lo - 1 && x <= hi + 1)) continue;
        out.push({ at: r.p, drop: end, len });
      }
    }
  }
  return out;
}

/** Remove the stubs a plan named, once its road is built (inside the same transaction, geometry up to date). */
export function applyStubs(net: RoadNetwork, stubs: { at: V2; drop: number }[]): void {
  for (const st of stubs) {
    if (!net.nodes.has(st.drop) || net.segsAt(st.drop).length !== 1) continue;
    const x = net.segsAt(st.drop)[0];
    const other = x.a === st.drop ? x.b : x.a;
    // (only if the piece runs from the dead end to the new junction: nothing else got in between)
    if (dist(net.nodes.get(other)!.p, st.at) > 1.5 || net.segsAt(other).length < 3) continue;
    net.removeSeg(x.id, true);
  }
}

/** A snap on a road just short of a junction (closer than a junction may be to another): onto the junction. */
export function ontoJunction(net: RoadNetwork, sn: Snap): Snap {
  if (sn.seg === undefined || sn.node !== undefined || sn.ringRaw) return sn;
  const s = net.segs.get(sn.seg);
  if (!s || s.ring || slipLaneEnd(net, s.id)) return sn;
  let best: { id: number; d: number } | null = null;
  for (const n of [s.a, s.b]) {
    const nd = net.nodes.get(n)!;
    const d = dist(nd.p, sn.p);
    if (d < 12 && Math.abs(nd.h - sn.h) < 0.6 && net.segsAt(n).length < 6 && !isRingFiller(net, n) && (!best || d < best.d)) best = { id: n, d };
  }
  if (!best) return sn;
  const nd = net.nodes.get(best.id)!;
  return { p: { ...nd.p }, h: nd.h, node: best.id, tangent: deadEndTangent(net, best.id), guides: sn.guides, label: sn.label, site: sn.site };
}

/** The road whose centreline passes through p at about height h, as a snap on it. */
function roadAt(net: RoadNetwork, p: V2, h: number): Snap | null {
  let best: Snap | null = null, bd = 1.5;
  for (const id of net.segsNear(p.x - 4, p.y - 4, p.x + 4, p.y + 4)) {
    const s = net.segs.get(id)!;
    if (slipLaneEnd(net, id)) continue;
    const r = cubicClosest(s.c, p);
    const hh = net.heightOnSeg(id, r.t);
    if (r.d < bd && Math.abs(hh - h) < 0.6) { bd = r.d; best = { p: r.p, h: hh, seg: id, t: r.t, guides: [] }; }
  }
  return best ? ontoJunction(net, best) : null;
}

function planRoadOnce(net: RoadNetwork, world: BuildWorld, inp: PlanInput): Plan {
  const { type } = inp;
  let { start, end } = inp;
  // a dirt road stays on the ground (it gets over water or a road on a paved bridge of its own)
  if (ROAD_TYPES[type].unpaved && Math.max(start.h, end.h) > RAISED) {
    const p = start.h > RAISED ? start.p : end.p;
    return { strokes: [], cost: 0, length: 0, errors: [{ msg: "Dirt roads stay on the ground", p }], crossings: [], kind: "road" };
  }
  if (!inp.parallel && inp.mode === "straight") {
    const x = planSlipExtend(net, world, start, end, type);
    if (x) return x;
    // straight along a carriageway: that would be a road on top of it. The carriageway stays as it is; a slip lane is
    // lengthened by drawing on from where it leaves it.
    // (only along one connected stretch: filling a gap between two dead ends, or a link between two one-ways, is a road)
    if (carriageAt(net, start) && carriageAt(net, end) && alongCarriage(net, start, end) && (stretchBetween(net, start, end) || stretchBetween(net, end, start))) {
      const msg = isHighway(ROAD_TYPES[type]) ? "Runs along the carriageway: draw on from a slip lane's start" : "Runs along an existing road";
      return { strokes: [], cost: 0, length: 0, errors: [{ msg, p: end.p }], crossings: [], kind: "road" };
    }
  }
  // a slip lane is part of its ramp: roads join the ramp beyond the gore (or the carriageway), not the lane
  for (const sn of [start, end]) {
    if (sn.seg !== undefined && slipLaneEnd(net, sn.seg)) {
      return { strokes: [], cost: 0, length: 0, errors: [{ msg: "Can't join a slip lane: join its ramp", p: sn.p }], crossings: [], kind: "road" };
    }
  }
  let slip: { ta?: V2; tb?: V2 } = slipTangents(net, start, end, type);
  // a ramp that would have to swing right round to get there is no ramp: drawn that steeply, it's a junction
  const rch = rampChain(net, start, end, slip, type);
  if (!slip.ta !== !slip.tb && !rch.length) slip = {}; // (a link with both ends on carriageways is shaped by makeChain)
  const ta = inp.startTangent ?? slip.ta ?? start.tangent;
  let tb: V2 | undefined = slip.tb;
  if (inp.mode === "curve" && !slip.tb) {
    // the end meets the road it lands on square, or runs straight on from a dead end, when the arc arrives near that
    // (always, with squareEnd)
    let want: V2 | undefined;
    if (end.node !== undefined) {
      const t = deadEndTangent(net, end.node);
      if (t) want = scale(t, -1);
    } else if (end.seg !== undefined) {
      const s = net.segs.get(end.seg)!;
      const st = cubicTangent(s.c, end.t!);
      const n = right(norm(st));
      const side = dot(sub(start.p, end.p), n) > 0 ? 1 : -1;
      want = scale(n, -side);
    }
    if (want) {
      if (inp.squareEnd) tb = want;
      else {
        const arc = makeChain("curve", start.p, end.p, ta);
        const arrive = arc.length ? norm(cubicTangent(arc[arc.length - 1], 1)) : norm(sub(end.p, start.p));
        if (dot(arrive, want) > Math.cos((22 * Math.PI) / 180)) {
          // only when the S-bend it makes stays as roomy as the road allows
          const sb = makeChain("curve", start.p, end.p, ta, want);
          if (sb.length && minRadius(sampleCubic(sb[0], 1.5), 4) >= ROAD_TYPES[type].minRadius) tb = want;
        }
      }
    }
  }
  // a slip road is a smooth curve off (or onto) the carriageway even in straight mode
  const mode: CurveMode = (slip.ta || slip.tb) && inp.mode === "straight" ? "curve" : inp.mode;
  // a slip road with one end on the carriageway: off along it, one even turn, then straight on to the other end
  let chain: Cubic[] = [];
  const asRamp = mode === "curve" && ((slip.ta && ta === slip.ta && !tb) || (slip.tb && tb === slip.tb && !ta));
  if (asRamp) chain = rch;
  if (!chain.length) chain = makeChain(mode, start.p, end.p, ta, tb);
  // drawn right along a dirt road in a paved type: that stretch of it is paved in place
  if (!inp.parallel && !slip.ta && !slip.tb) {
    const pv = planPave(net, world, start, end, chain, type);
    if (pv) return pv;
  }
  // a highway ramp off (or onto) a highway carriageway comes with its slip lane, on whichever side it is: the ramp leaves
  // from the end of a deceleration lane running beside the carriageway, or arrives at the start of an acceleration lane.
  // The carriageway itself stays as it is.
  const exit = !!slip.ta;
  let piece: SlipPiece | null = null;
  if (chain.length > 0 && !slip.ta !== !slip.tb && !inp.parallel && isHighway(ROAD_TYPES[type])) {
    const sn = exit ? start : end, t = exit ? slip.ta! : slip.tb!;
    const inLine = dot(norm(cubicTangent(exit ? chain[0] : chain[chain.length - 1], exit ? 0 : 1)), t) > 0.995;
    const main = carriageAt(net, sn);
    if (inLine && main && highwayAt(net, sn) && !slipAt(net, sn)) {
      const far = exit ? chain[0].p3 : chain[chain.length - 1].p0;
      const sg = dot(sub(far, sn.p), right(t)) >= 0 ? 1 : -1;
      const pc = laySlip(net, sn, exit, sg, type, slipLaneLength(main.type, exit), SLIP_JOIN);
      if (pc) {
        const gore: Snap = { p: pc.gore.p, h: pc.gore.h, guides: [] };
        const [s2, e2] = exit ? [gore, end] : [start, gore];
        const ramp = asRamp ? rampChain(net, s2, e2, exit ? { ta: t } : { tb: t }, type) : makeChain(mode, s2.p, e2.p, exit ? t : ta, exit ? tb : t);
        if (ramp.length) {
          piece = pc;
          chain = exit ? [pc.cubic, ...ramp] : [...ramp, pc.cubic];
          if (exit) start = pc.at; else end = pc.at;
        }
      }
    }
  }
  const stroke: Stroke = piece ? slipStroke(piece, exit ? chain.slice(1) : chain.slice(0, -1), exit, exit ? end : start, type) : { chain, h0: start.h, h1: end.h, type };
  const strokes = [stroke];
  const anchors: AnchorHint[] = [
    { p: start.p, node: start.node, seg: start.seg },
    { p: end.p, node: end.node, seg: end.seg },
  ];
  let par: { a: V2; b: V2 } | undefined;
  let trim: ParallelTrim | undefined;
  const extra: PlanError[] = [];
  let noBridge = false;
  if (inp.parallel && chain.length) {
    const from = inp.parallel.from ?? twinEnd(net, start, inp.parallel.offset);
    const ps = parallelStroke(net, stroke, inp.parallel.offset, start, end, from);
    for (const pc of ps.pieces) {
      strokes.push(pc.stroke);
      anchors.push(...pc.anchors);
    }
    par = { a: ps.a, b: ps.b };
    trim = ps.trim;
    extra.push(...ps.errors, ...pairGap(strokes[0], ps.pieces[ps.pieces.length - 1].stroke));
  }
  // the end of the old twin that a corner cuts off doesn't count as a road in the way
  let skip: ((id: number, p: V2) => boolean) | undefined;
  if (trim) {
    const tr = trim, dp = net.nodes.get(tr.drop)!.p;
    const c = lerpV(dp, tr.at, 0.5), r = dist(dp, tr.at) / 2 + roadWidth(ROAD_TYPES[type]);
    skip = (id, p) => id === tr.seg && dist(p, c) < r;
  }
  // a slip road runs glued alongside the carriageway it leaves or joins: that's not an overlap
  const slips: SlipAnchor[] = [];
  for (const [sn, on] of [[start, slip.ta], [end, slip.tb]] as const) {
    if (!on) continue;
    const segs = new Set(sn.seg !== undefined ? [sn.seg] : net.segsAt(sn.node!).map((s) => s.id));
    if (piece) for (const id of piece.beside) segs.add(id);
    slips.push({ p: sn.p, segs, r: piece ? piece.length + 30 : 160 });
  }
  // the player's tool: up onto a bridge over water, and over roads it can't meet at grade
  const spans: BridgeSpan[] = [];
  if (inp.bridges && !piece) {
    const ignore = { segs: new Set<number>(), nodes: new Set<number>() };
    for (const a of anchors) {
      if (a.seg !== undefined) ignore.segs.add(a.seg);
      if (a.node !== undefined) { ignore.nodes.add(a.node); for (const sg of net.segsAt(a.node)) ignore.segs.add(sg.id); }
    }
    for (const [i, st] of strokes.entries()) {
      const r = autoBridge(net, world, st, ignore);
      strokes[i] = r.st;
      if (i === 0) spans.push(...r.spans);
      extra.unshift(...r.errors);
      if (r.errors.length) noBridge = true;
    }
  }
  const plan = validateStrokes(net, world, strokes, "road", anchors, undefined, par ? strokes.map((_, i) => anchors.slice(i * 2, i * 2 + 2)) : undefined, skip, slips);
  plan.errors.unshift(...extra);
  siteErrors(net, plan, start, end);
  // (a bridge that can't fit has said why and what to do: not also "raise it with Page Up")
  if (noBridge) plan.errors = plan.errors.filter((e) => !e.msg.startsWith("Needs a bridge here"));
  if (spans.length) plan.bridges = spans;
  if (asRamp && !piece && !plan.errors.length) {
    const sn = slip.ta ? start : end;
    if (builtMinRadius(net, chain, sn, !!slip.ta, type) < ROAD_TYPES[type].minRadius * 0.98) plan.errors.push({ msg: "Too tight where it merges: draw it longer", p: sn.p });
  }
  if (piece) plan.note = piece.joined ? "Slip lanes joined" : `${Math.round(piece.length)} m slip lane`;
  else if (strokes.some(pavedPieces)) plan.note = `A dirt road's bridge is built as a paved ${ROAD_TYPES[PAVED_DECK].name.toLowerCase()}`;
  if (par) plan.parallelEnds = par;
  if (trim) plan.trim = trim;
  if (chain.length) {
    const last = chain[chain.length - 1];
    plan.endTangent = norm(cubicTangent(last, 1));
    const t0 = norm(cubicTangent(chain[0], 0));
    const ref = ta ?? { x: 1, y: 0 };
    // off a road with no set start direction (a straight from mid-road or a junction): the angle to that road
    const sArms = ta ? [] : armsAt(net, start);
    plan.angleDeg = sArms.length
      ? Math.min(...sArms.map((d) => (Math.acos(clamp(Math.abs(dot(d, t0)), 0, 1)) * 180) / Math.PI))
      : Math.abs((signedAngle(ref, ta ? plan.endTangent : t0) * 180) / Math.PI);
    if (sArms.length) plan.angleToRoad = true;
    // what the end joins, and at what angle
    const arms = armsAt(net, end);
    if (arms.length) {
      const into = plan.endTangent;
      plan.endAngleDeg = Math.min(...arms.map((d) => (Math.acos(clamp(Math.abs(dot(d, into)), 0, 1)) * 180) / Math.PI));
      const on = end.seg !== undefined ? net.segs.get(end.seg) : undefined;
      plan.joins = end.node !== undefined
        ? net.segsAt(end.node).length === 1 ? "Carries on the road" : "Joins the junction"
        : on?.ring ? "Joins the roundabout" : on ? `Joins the ${ROAD_TYPES[on.type].name.toLowerCase()}` : undefined;
    }
  }
  return plan;
}

/**
 * A road from or to a site's gate that would cut back across that site: not "Building in the way" (the player meant
 * to connect it) but where its gate is, marked. Other buildings in the way still say so.
 */
function siteErrors(net: RoadNetwork, plan: Plan, start: Snap, end: Snap) {
  const own = [start.site, end.site].filter((x): x is NonNullable<Snap["site"]> => !!x);
  if (!own.length) return;
  // dragged from a gate to the road (or the roundabout) that gate is on already: there is nothing to draw, and
  // "Too short: drag further" sent the player looking for a road the works did not need
  const [at, to] = start.site ? [start, end] : [end, start];
  const ringOf = (x: Snap) => (x.seg !== undefined ? net.segs.get(x.seg)?.ring : undefined);
  if (at.seg !== undefined && to.seg !== undefined && (to.seg === at.seg || (!!ringOf(at) && ringOf(at) === ringOf(to))) && plan.errors.some((e) => e.msg.startsWith("Too short"))) {
    plan.errors = [{ msg: `${at.site!.name}'s gate is on this road already`, p: at.site!.gate }];
    return;
  }
  const out: PlanError[] = [];
  for (const e of plan.errors) {
    const mine = own.find((o) => e.buildings?.includes(o.id));
    if (!mine) { out.push(e); continue; }
    out.push({ msg: `${mine.name}'s gate faces the other way: draw the road round to it`, p: mine.gate });
    const rest = e.buildings!.filter((id) => !own.some((o) => o.id === id));
    if (rest.length) out.push({ ...e, msg: rest.length === 1 ? "Building in the way" : `${rest.length} buildings in the way`, buildings: rest });
  }
  plan.errors = out;
  const joined = (end.site ?? start.site)!;
  plan.connects = joined.turned ? `Connects to ${joined.name}, turning its gate` : `Connects to ${joined.name}`;
}

/** Directions of the roads at a snap (both ways along a road; each road out of a junction). */
export function armsAt(net: RoadNetwork, sn: Snap): V2[] {
  if (sn.node !== undefined) return net.segsAt(sn.node).map((s) => (s.a === sn.node ? norm(cubicTangent(s.c, 0)) : scale(norm(cubicTangent(s.c, 1)), -1)));
  if (sn.seg !== undefined) {
    const s = net.segs.get(sn.seg);
    if (!s) return [];
    const t = norm(cubicTangent(s.c, sn.t ?? cubicClosest(s.c, sn.p).t));
    return [t, scale(t, -1)];
  }
  return [];
}

/** The two roads of a parallel pair must not overlap (a tight curve or a narrow spacing would). */
function pairGap(a: Stroke, b: Stroke): PlanError[] {
  const pa = chainPoints(a.chain, 2), pb = chainPoints(b.chain, 2);
  const min = roadWidth(ROAD_TYPES[a.type]) + 0.2;
  for (const q of pb) {
    for (let j = 0; j < pa.length - 1; j++) {
      if (pointSegDist2(q, pa[j], pa[j + 1]).d2 < min * min) return [{ msg: "The two roads would overlap: widen the spacing", p: q }];
    }
  }
  return [];
}

/** Where a parallel road's end should attach: an existing node, a point on a road, or free. */
function attachNear(net: RoadNetwork, p: V2, h: number, dir: V2, ref: Snap): AnchorHint {
  // carry on from a node close by (the previous piece of the pair)
  let bn: { id: number; d: number } | null = null;
  for (const n of net.nodesNear(p, 4)) {
    const d = dist(n.p, p);
    if (Math.abs(n.h - h) < 0.6 && d < 3 && (!bn || d < bn.d)) bn = { id: n.id, d };
  }
  if (bn) return { p: { ...net.nodes.get(bn.id)!.p }, node: bn.id };
  // the main road starts or ends on a road: put the parallel one on that road too, along its own line
  // (a dead end is the road being carried on, not a cross street)
  const segs = ref.node !== undefined ? (net.segsAt(ref.node).length > 1 ? net.segsAt(ref.node).map((s) => s.id) : []) : ref.seg !== undefined ? [ref.seg] : [];
  let best: { seg: number; p: V2; d: number } | null = null;
  for (const id of segs) {
    const g = net.segGeom.get(id);
    if (!g) continue;
    const cp = g.center.pts;
    for (let j = 0; j < cp.length - 1; j++) {
      const r = segIntersect(add(p, scale(dir, -60)), add(p, scale(dir, 60)), cp[j], cp[j + 1]);
      if (!r) continue;
      const q = lerpV(cp[j], cp[j + 1], r.u);
      const d = dist(q, p);
      if (d < 40 && (!best || d < best.d)) best = { seg: id, p: q, d };
    }
  }
  if (best) {
    const s = net.segs.get(best.seg)!;
    const r = cubicClosest(s.c, best.p);
    // landing on one of that road's nodes: use the node
    for (const n of [s.a, s.b]) {
      const np = net.nodes.get(n)!.p;
      if (dist(np, r.p) < 3) return { p: { ...np }, node: n };
    }
    return { p: r.p, seg: best.seg };
  }
  return { p };
}

const isStraight = (c: Cubic) => {
  const L = dist(c.p0, c.p3);
  if (L < 1e-6) return true;
  const u = scale(sub(c.p3, c.p0), 1 / L);
  return Math.abs(cross(u, sub(c.p1, c.p0))) < 0.05 && Math.abs(cross(u, sub(c.p2, c.p0))) < 0.05;
};
const reverseCubic = (c: Cubic): Cubic => ({ p0: c.p3, p1: c.p2, p2: c.p1, p3: c.p0 });
/** c with its end moved to p, keeping the end direction. */
const withEnd = (c: Cubic, p: V2): Cubic => ({ ...c, p2: add(c.p2, sub(p, c.p3)), p3: p });
const withStart = (c: Cubic, p: V2): Cubic => ({ ...c, p0: p, p1: add(c.p1, sub(p, c.p0)) });

/**
 * A new stroke started on the dead end of one road of a parallel pair: the dead end of its twin, `offset` metres
 * to the left of the way the road carries on and running alongside it. Lets a pair be carried on round a corner
 * after the drawing was broken off, as if it had never stopped.
 */
export function twinEnd(net: RoadNetwork, start: Snap, offset: number): Snap | undefined {
  if (start.node === undefined || net.segsAt(start.node).length !== 1) return undefined;
  const sn = net.nodes.get(start.node)!, s = net.segsAt(start.node)[0];
  const out = norm(s.b === start.node ? cubicTangent(s.c, 1) : scale(cubicTangent(s.c, 0), -1));
  const q = add(sn.p, scale({ x: out.y, y: -out.x }, offset)); // left of the way on, the side the twin is built
  // a fixed small reach: at wide spacings an unrelated dead end must not be taken for the twin
  let best: Snap | undefined, bd = 2.5;
  for (const n of net.nodesNear(q, bd)) {
    const id = n.id;
    if (id === start.node || Math.abs(n.h - sn.h) > 0.5) continue;
    const d = dist(n.p, q);
    if (d >= bd || net.segsAt(id).length !== 1) continue;
    const t = net.segsAt(id)[0];
    const o = norm(t.b === id ? cubicTangent(t.c, 1) : scale(cubicTangent(t.c, 0), -1));
    if (dot(o, out) < Math.cos((10 * Math.PI) / 180)) continue;
    best = { p: n.p, h: n.h, node: id, guides: [] };
    bd = d;
  }
  return best;
}

/** Cut the previous parallel piece back to `at` (its dead end `drop` goes), when a pair turns a corner. */
export interface ParallelTrim { seg: number; drop: number; at: V2 }

/** Apply a ParallelTrim (inside a transaction, geometry up to date). */
export function applyTrim(net: RoadNetwork, tr: ParallelTrim): void {
  const s = net.segs.get(tr.seg);
  if (!s || !net.nodes.has(tr.drop)) return;
  const r = cubicClosest(s.c, tr.at);
  const n = net.splitSeg(s.id, r.t);
  for (const x of net.segsAt(n)) if (x.a === tr.drop || x.b === tr.drop) net.removeSeg(x.id, true);
}

/**
 * The parallel twin of `st`, `offset` metres to its left (reversed for one-ways). When it carries on from the
 * previous piece's twin round a corner, the two twins meet where their offset lines cross: on the inside of the
 * turn the old twin is cut back to that point (`trim`), on the outside a short piece of the old twin's own type
 * extends it there. The gap between the carriageways stays even all the way round.
 */
function parallelStroke(net: RoadNetwork, st: Stroke, offset: number, start: Snap, end: Snap, from?: Snap) {
  let chain = offsetChain(st.chain, -offset);
  const d0 = norm(cubicTangent(st.chain[0], 0)), d1 = norm(cubicTangent(st.chain[st.chain.length - 1], 1));
  const errors: PlanError[] = [];
  const oneWay = ROAD_TYPES[st.type].bwd === 0;
  const out: { stroke: Stroke; anchors: AnchorHint[] }[] = [];
  let trim: ParallelTrim | undefined;
  let aHint: AnchorHint | null = null;
  // `from` is the previous twin's end, across from the corner node this piece starts on
  const near = !!from && dist(from.p, start.p) < offset * 3;
  const prev = near && from!.node !== undefined && net.segsAt(from!.node).length === 1 ? net.segsAt(from!.node)[0] : null;
  if (near && prev) {
    const fromN = from!.node!;
    const pc = prev.b === fromN ? prev.c : reverseCubic(prev.c); // runs towards the dead end
    const tOut = norm(cubicTangent(pc, 1));
    const den = cross(tOut, d0);
    const P2 = chain[0].p0, w = sub(P2, from!.p);
    const sM = Math.abs(den) > 1e-6 ? cross(w, d0) / den : 0, uM = Math.abs(den) > 1e-6 ? cross(w, tOut) / den : 0;
    const M = add(from!.p, scale(tOut, sM));
    const fn = net.nodes.get(fromN)!;
    if (Math.abs(den) < Math.sin((3 * Math.PI) / 180) || Math.abs(sM) < 1.5) {
      if (dot(tOut, d0) > 0) aHint = { p: from!.p, node: fromN }; // straight on, or near enough
      else errors.push({ msg: "Corner too sharp for the parallel road", p: from!.p });
    } else if (dot(tOut, d0) < -0.5) {
      errors.push({ msg: "Corner too sharp for the parallel road", p: from!.p });
    } else if (Math.abs(fn.h - st.h0) > 0.1) {
      errors.push({ msg: "The parallel road turns corners on level ground only", p: from!.p });
    } else {
      const prevLen = net.segGeom.get(prev.id)?.center.length ?? dist(pc.p0, pc.p3);
      const firstLen = makePolyline(sampleCubic(chain[0], 2)).length;
      if (-sM > prevLen - MIN_SEG_LEN || uM > firstLen - MIN_SEG_LEN) {
        errors.push({ msg: "Corner too sharp for the parallel road", p: M });
      } else if (sM < 0) {
        // inside of the turn: cut the old twin back to M
        trim = { seg: prev.id, drop: fromN, at: M };
      } else {
        // outside of the turn: extend the old twin to M, in its own type and direction. An extension
        // shorter than a road piece may be starts further back, cutting the old twin back to make room.
        let k: AnchorHint = { p: from!.p, node: fromN };
        if (sM < MIN_SEG_LEN) {
          const back = MIN_SEG_LEN - sM + 0.5;
          if (back > prevLen - MIN_SEG_LEN) errors.push({ msg: "Corner too sharp for the parallel road", p: M });
          else {
            const K = cubicClosest(pc, add(from!.p, scale(tOut, -back))).p;
            trim = { seg: prev.id, drop: fromN, at: K };
            k = { p: K };
          }
        }
        const ext = straightCubic(k.p, M);
        const fwd = prev.b === fromN; // the old twin runs towards its dead end
        out.push({
          stroke: { chain: [fwd ? ext : reverseCubic(ext)], h0: fn.h, h1: fn.h, type: prev.type },
          anchors: fwd ? [k, { p: M }] : [{ p: M }, k],
        });
      }
      if (!aHint && !errors.length) {
        // the new twin starts at M
        if (uM > 0) {
          const r = cubicClosest(chain[0], M);
          chain = [withStart(subCubic(chain[0], r.t, 1), M), ...chain.slice(1)];
        } else if (isStraight(chain[0])) chain = [straightCubic(M, chain[0].p3), ...chain.slice(1)];
        else chain = [straightCubic(M, chain[0].p0), ...chain];
        aHint = { p: M };
      }
    }
  }
  if (!aHint) aHint = near && !prev ? { p: from!.p, node: from!.node, seg: from!.seg } : attachNear(net, chain[0].p0, st.h0, d0, start);
  if (!near && start.node !== undefined && net.segsAt(start.node).length === 1) {
    // carrying on a road that has no twin yet: the new twin can't start on top of it
    const g = net.segGeom.get(net.segsAt(start.node)[0].id);
    const q = chain[0].p0, cp = g?.center.pts ?? [];
    const lim = roadWidth(ROAD_TYPES[st.type]);
    for (let j = 0; j < cp.length - 1; j++) {
      if (pointSegDist2(q, cp[j], cp[j + 1]).d2 < lim * lim) {
        errors.push({ msg: "The parallel road would start on this road", p: q });
        break;
      }
    }
  }
  const bHint = attachNear(net, chain[chain.length - 1].p3, st.h1, d1, end);
  // move the ends onto the attach points (small shifts along the road)
  chain[0] = withStart(chain[0], aHint.p);
  chain[chain.length - 1] = withEnd(chain[chain.length - 1], bHint.p);
  // one-way twins run the other way, unless the twin this carries on was flipped: then follow its flow
  let against = oneWay;
  if (oneWay && near && prev && ROAD_TYPES[prev.type].bwd === 0) against = prev.a === from!.node;
  out.push(against
    ? { stroke: { chain: reverseChain(chain), h0: st.h1, h1: st.h0, type: st.type }, anchors: [bHint, aHint] }
    : { stroke: { chain, h0: st.h0, h1: st.h1, type: st.type }, anchors: [aHint, bHint] });
  return { pieces: out, a: aHint.p, b: bHint.p, trim, errors };
}

interface AnchorHint { p: V2; node?: number; seg?: number }

/** Validate strokes against the current network and world. */
export function validateStrokes(
  net: RoadNetwork, world: BuildWorld, strokes: Stroke[], kind: Plan["kind"], anchors: AnchorHint[] = [],
  exempt?: { segs: Set<number>; nodes: Set<number> },
  /** Each stroke's own start and end anchors, for the junction-angle checks (one stroke: `anchors`). */
  perStroke?: AnchorHint[][],
  /** Parts of the network that go when this is built: no crossings or overlaps with them. */
  skip?: (seg: number, p: V2) => boolean,
  slips: SlipAnchor[] = [],
): Plan {
  const errors: PlanError[] = [];
  const crossings: V2[] = [];
  let cost = 0, total = 0;
  const ignore = { segs: new Set<number>(exempt?.segs ?? []), nodes: new Set<number>(exempt?.nodes ?? []) };
  for (const a of anchors) {
    if (a.seg !== undefined) ignore.segs.add(a.seg);
    if (a.node !== undefined) {
      ignore.nodes.add(a.node);
      for (const s of net.segsAt(a.node)) ignore.segs.add(s.id);
    }
  }
  for (const [si, st] of strokes.entries()) {
    const own = perStroke ? perStroke[si] ?? [] : strokes.length === 1 ? anchors : [];
    if (!st.chain.length) {
      // (no road between two points well apart: a curve asked to turn back behind its start)
      const a0 = anchors[0]?.p ?? { x: 0, y: 0 }, a1 = anchors[anchors.length - 1]?.p ?? a0;
      errors.push({ msg: dist(a0, a1) > MIN_SEG_LEN ? "Too sharp a turn back, click a point on the way round" : "Too short: drag further from the start", p: a0 });
      continue;
    }
    const T = ROAD_TYPES[st.type];
    const w = roadWidth(T);
    const pts = chainPoints(st.chain, 2);
    const pl = makePolyline(pts);
    const L = pl.length;
    total += L;
    const hs = strokeHeights(net, st, pts, pl.cum);
    const mid = pts[Math.floor(pts.length / 2)];
    if (L < MIN_SEG_LEN) { errors.push({ msg: `Too short: at least ${MIN_SEG_LEN} m`, p: mid }); continue; }
    // ramp grade (piece by piece where it has joint heights: a bridge's ramps)
    const dh = Math.abs(st.h1 - st.h0);
    if (st.hj && st.hj.length === st.chain.length + 1) {
      for (const [i, c] of st.chain.entries()) {
        const d = Math.abs(st.hj[i + 1] - st.hj[i]), l = makePolyline(sampleCubic(c, 2)).length;
        if (d > 0.1 && d / l > MAX_GRADE * 1.02) { errors.push({ msg: `Ramp too short: needs ${Math.ceil(d / MAX_GRADE)} m to climb ${Math.round(d)} m`, p: cubicAt(c, 0.5) }); break; }
      }
    } else if (dh > 0.1 && dh / L > MAX_GRADE) {
      errors.push({ msg: `Ramp too short: needs ${Math.ceil(dh / MAX_GRADE)} m to climb ${Math.round(dh)} m`, p: mid });
    }
    // curvature: show where it's too tight
    const r = minRadius(pts, 4);
    if (r < T.minRadius * 0.98) errors.push({ msg: `Curve too tight: needs a ${T.minRadius} m radius`, p: tightest(pts) });
    // terrain
    let water = false, mountain = false, out = false;
    const rampy = !!st.hj && !st.beside?.length;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!world.inBounds(p)) out = true;
      if (world.isMountain(p)) mountain = true;
      // (a bridge's ramp leaving the bank climbs on over the water: autoBridge's offTheBank put its foot on land)
      if (hs[i] < LEVEL_H * 0.5 && world.isWater(p) && !(rampy && Math.abs(hs[Math.min(i + 1, pts.length - 1)] - hs[Math.max(i - 1, 0)]) > 1e-3)) water = true;
    }
    if (out) errors.push({ msg: "Outside the map", p: mid });
    if (mountain) errors.push({ msg: "Mountain in the way", p: mid });
    if (water) errors.push({ msg: "Needs a bridge here: raise it with Page Up", p: mid });
    // buildings
    // roundabout islands can't be driven through (a bridge high enough over it is fine)
    if (kind !== "roundabout") {
      const rings = ringsNear(net, mid, L / 2 + 80);
      let inIsland: V2 | null = null;
      for (const R of rings) for (let i = 0; i < pts.length && !inIsland; i++) {
        if (Math.abs(hs[i] - R.h) < CLEARANCE && dist(pts[i], R.c) < R.r - 3.2) inIsland = pts[i];
      }
      if (inIsland) errors.push({ msg: "Can't cross a roundabout's centre", p: inIsland });
    }
    // (a slip lane is checked where it will be built, beside the carriageway, not along the line it is drawn on)
    const vis = st.show ? chainPoints(st.show, 2) : pts;
    const visPl = st.show ? makePolyline(vis) : pl;
    const visH = st.show ? strokeHeights(net, st, vis, visPl.cum) : hs;
    const hit = world.buildingsHit(vis, w / 2 - 0.2);
    if (hit.length) errors.push({ msg: hit.length === 1 ? "Building in the way" : `${hit.length} buildings in the way`, p: world.buildingAt?.(hit[0]) ?? mid, buildings: hit });
    // crossings -> junctions
    const cx = findCrossings(net, pts, pl.cum, hs, ignore, skip);
    for (const b of cx.bad) errors.push({ msg: b.msg, p: b.p });
    let prevS = -Infinity;
    for (const c of cx.crossings) {
      crossings.push(c.p);
      if (c.angle < MIN_ARM_ANGLE) errors.push({ msg: `Crossing too shallow: ${Math.round((c.angle * 180) / Math.PI)}°`, p: c.p });
      if (c.sPlan - prevS < 14) errors.push({ msg: "Junctions too close together", p: c.p });
      prevS = c.sPlan;
      const s = net.segs.get(c.seg)!;
      for (const n of [s.a, s.b]) {
        if (isRingFiller(net, n)) continue; // moved to the new junction when built
        const d = dist(net.nodes.get(n)!.p, c.p);
        if (d >= 3 && d < 12) errors.push({ msg: "Too close to a junction, cross at it or 12 m away", p: c.p });
      }
    }
    if (cx.crossings.length && L - cx.crossings[cx.crossings.length - 1].sPlan < 10 && own[1] && own[1].node === undefined && own[1].seg === undefined) {
      errors.push({ msg: "Too close to a junction, end on the road or carry on past it", p: pts[pts.length - 1] });
    }
    // overlaps: running along an existing road at the same level
    const glued = (id: number, p: V2) => slips.some((sl) => sl.segs.has(id) && dist(sl.p, p) < sl.r);
    const ov = overlapCheck(net, vis, visH, w, cx.crossings.map((c) => c.p), anchors.map((a) => a.p), ignore, (id, p) => !!skip?.(id, p) || glued(id, p));
    if (ov) errors.push({ msg: "Overlaps a road", p: ov });
    // arm angles at anchors
    for (const [ai, a] of own.entries()) {
      const dirOut = ai === 0 ? norm(cubicTangent(st.chain[0], 0)) : scale(norm(cubicTangent(st.chain[st.chain.length - 1], 1)), -1);
      const arms: V2[] = [];
      const oneWayNew = T.bwd === 0;
      let oneWayAll = oneWayNew;
      if (a.node !== undefined) {
        for (const s of net.segsAt(a.node)) {
          if (exempt?.segs.has(s.id)) continue; // being replaced
          arms.push(s.a === a.node ? norm(cubicTangent(s.c, 0)) : scale(norm(cubicTangent(s.c, 1)), -1));
          if (ROAD_TYPES[s.type].bwd > 0) oneWayAll = false;
        }
      } else if (a.seg !== undefined) {
        const s = net.segs.get(a.seg)!;
        const r = cubicClosest(s.c, a.p);
        const t = norm(cubicTangent(s.c, r.t));
        arms.push(t, scale(t, -1));
        if (ROAD_TYPES[s.type].bwd > 0) oneWayAll = false;
      }
      const minA = oneWayAll ? (10 * Math.PI) / 180 : MIN_ARM_ANGLE;
      for (const d of arms) {
        const ang = Math.acos(clamp(dot(d, dirOut), -1, 1));
        if (oneWayAll && ang < 0.02) continue; // exactly in line: a slip road glued alongside, not a sharp junction
        if (ang < minA) {
          errors.push({ msg: `Angle too sharp: ${Math.round((ang * 180) / Math.PI)}°, needs ${Math.round((minA * 180) / Math.PI)}°`, p: a.p });
          break;
        }
      }
      if (a.node !== undefined && net.segsAt(a.node).length >= 6) errors.push({ msg: "Too many roads at this junction", p: a.p });
    }
    cost += strokeCost(st, pts, hs, world);
  }
  if (kind === "roundabout") cost += ROUNDABOUT_COST;
  if (cost > world.money() + 0.5) errors.push({ msg: `Not enough money for ${fmt(cost)}`, p: anchors[anchors.length - 1]?.p ?? { x: 0, y: 0 } });
  // de-duplicate messages at nearly the same place
  const seen = new Set<string>();
  const errs = errors.filter((e) => { const k = e.msg; if (seen.has(k)) return false; seen.add(k); return true; });
  return { strokes, cost, length: total, errors: errs, crossings, kind };
}

const fmt = (n: number) => "$" + Math.round(n).toLocaleString("en-US");

function overlapCheck(net: RoadNetwork, pts: V2[], hs: number[], w: number, crossPts: V2[], anchors: V2[], ignore: { segs: Set<number> }, skip?: (seg: number, p: V2) => boolean): V2 | null {
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    for (const id of net.segsNear(p.x - 30, p.y - 30, p.x + 30, p.y + 30)) {
      if (skip?.(id, p)) continue; // goes when this is built
      const g = net.segGeom.get(id)!;
      const lim = (g.width + w) / 2 - 1.0;
      // a quick bbox reject
      if (p.x < g.bbox.x0 - w || p.x > g.bbox.x1 + w || p.y < g.bbox.y0 - w || p.y > g.bbox.y1 + w) continue;
      const cp = g.center.pts;
      let best = Infinity, bj = 0, bt = 0;
      for (let j = 0; j < cp.length - 1; j++) {
        const r = pointSegDist2(p, cp[j], cp[j + 1]);
        if (r.d2 < best) { best = r.d2; bj = j; bt = r.t; }
      }
      const d = Math.sqrt(best);
      if (d >= lim) continue;
      const hS = g.hs[bj] + (g.hs[bj + 1] - g.hs[bj]) * bt;
      if (Math.abs(hS - hs[i]) >= CLEARANCE) continue;
      // near a crossing or an anchor the roads naturally overlap
      const dirP = norm(sub(pts[Math.min(pts.length - 1, i + 1)], pts[Math.max(0, i - 1)]));
      const dirS = norm(sub(cp[bj + 1], cp[bj]));
      const sin = Math.max(0.17, Math.abs(cross(dirP, dirS)));
      const zone = (g.width / 2 + w / 2) / sin + 4;
      if (crossPts.some((c) => dist(c, p) < zone)) continue;
      if (anchors.some((a) => dist(a, p) < zone + (ignore.segs.has(id) ? 6 : 0))) continue;
      return p;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Committing strokes
// ---------------------------------------------------------------------------------------------

/** Find or create a node at p (height h): reuse a node, split a seg, or add a free node. */
export function resolveAnchor(net: RoadNetwork, p: V2, h: number, tol = 0.8): number {
  for (const n of net.nodesNear(p, 3)) if (Math.abs(n.h - h) < 0.6 && dist(n.p, p) < 3) return n.id;
  for (const n of net.nodes.values()) if (dist(n.p, p) < 0.3 && Math.abs(n.h - h) < 0.6) return n.id;
  let best: { seg: RSeg; t: number; d: number } | null = null;
  for (const id of net.segsNear(p.x - 4, p.y - 4, p.x + 4, p.y + 4)) {
    const s = net.segs.get(id);
    if (!s || slipLaneEnd(net, id)) continue;
    const r = cubicClosest(s.c, p);
    if (r.d < tol && (!best || r.d < best.d) && Math.abs(net.heightOnSeg(id, r.t) - h) < 0.6) best = { seg: s, t: r.t, d: r.d };
  }
  // segments added in this transaction aren't indexed yet: scan them too
  if (!best) {
    for (const s of net.segs.values()) {
      if (net.segGeom.has(s.id)) continue;
      const r = cubicClosest(s.c, p);
      if (r.d < tol && (!best || r.d < best.d) && Math.abs(net.heightOnSeg(s.id, r.t) - h) < 0.6) best = { seg: s, t: r.t, d: r.d };
    }
  }
  if (best) {
    if (best.t < 0.002) return best.seg.a;
    if (best.t > 0.998) return best.seg.b;
    if (best.seg.ring) {
      const moved = joinRing(net, best.seg, p);
      if (moved !== null) return moved;
    }
    return net.splitSeg(best.seg.id, best.t);
  }
  return net.addNode(p, h);
}

/** A filler node of a roundabout (just two arcs of the same ring meet there). */
function isRingFiller(net: RoadNetwork, id: number): boolean {
  const ss = net.segsAt(id);
  return ss.length === 2 && ss[0].ring !== 0 && ss[0].ring === ss[1].ring;
}

/**
 * A road joining a ring close to a filler node: drop the filler and rebuild that stretch of the
 * ring as true arcs through the new junction, so the road meets the ring exactly where it was aimed.
 */
function joinRing(net: RoadNetwork, seg: RSeg, p: V2): number | null {
  const R = ringsNear(net, p, 30).find((r) => r.id === seg.ring);
  if (!R) return null;
  const prevSeg = (n: number) => net.segsAt(n).find((x) => x.b === n && x.ring === seg.ring);
  const nextSeg = (n: number) => net.segsAt(n).find((x) => x.a === n && x.ring === seg.ring);
  // widen [X..Y] along the ring past every filler node out to the neighbouring junctions: the
  // stretch is rebuilt as true arcs through the new junction, split evenly, so no filler is left
  // crowding a junction (two junction boxes overlapping on a short arc jams a wide ring)
  const drop = new Set<number>([seg.id]);
  let X = seg.a, Y = seg.b;
  let whole = false;
  for (let k = 0; k < 16 && isRingFiller(net, X); k++) {
    const s = prevSeg(X); if (!s) return null;
    if (drop.has(s.id)) { whole = true; break; }
    drop.add(s.id); X = s.a;
  }
  if (!whole) for (let k = 0; k < 16 && isRingFiller(net, Y); k++) {
    const s = nextSeg(Y); if (!s) return null;
    if (drop.has(s.id)) { whole = true; break; }
    drop.add(s.id); Y = s.b;
  }
  if (!whole && (isRingFiller(net, X) || isRingFiller(net, Y))) return null; // ran out of steps
  if (!whole && drop.size === 1) return null;
  const ang = (q: V2) => Math.atan2(q.y - R.c.y, q.x - R.c.x);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const pa = net.nodes.get(seg.a)!.p, pb = net.nodes.get(seg.b)!.p;
  const dirSign = Math.sign(wrap(ang(pb) - ang(pa))) || 1;
  const sweepTo = (a0: number, a1: number) => { let sw = wrap(a1 - a0); if (Math.sign(sw) !== dirSign || Math.abs(sw) < 1e-6) sw += dirSign * Math.PI * 2; return sw; };
  const aN = ang(p);
  if (!whole && X !== Y && Math.abs(sweepTo(ang(net.nodes.get(X)!.p), aN)) >= Math.abs(sweepTo(ang(net.nodes.get(X)!.p), ang(net.nodes.get(Y)!.p)))) return null;
  const { type, ring } = seg;
  const h = net.nodes.get(seg.a)!.h;
  const orphans = new Set<number>();
  for (const id of drop) { const s = net.segs.get(id)!; orphans.add(s.a); orphans.add(s.b); net.removeSeg(id, false); }
  for (const n of orphans) if ((whole || (n !== X && n !== Y)) && net.segsAt(n).length === 0) net.removeNode(n);
  const N = net.addNode({ x: R.c.x + Math.cos(aN) * R.r, y: R.c.y + Math.sin(aN) * R.r }, h);
  const arc = (a: number, b: number) => {
    const a0 = ang(net.nodes.get(a)!.p);
    const cs = arcCubics(R.c, R.r, a0, sweepTo(a0, ang(net.nodes.get(b)!.p)));
    let prev = a;
    cs.forEach((c, i) => {
      const next = i === cs.length - 1 ? b : net.addNode(c.p3, h);
      net.addSeg(prev, next, type, c, ring);
      prev = next;
    });
  };
  if (whole) arc(N, N); // the ring had no junction yet: one full circle through the new one
  else { arc(X, N); arc(N, Y); }
  return N;
}

/**
 * Commit strokes into the network. Must run inside net.begin()/commit(); the network geometry
 * must be up to date (rebuilt) when called. Crossings with existing roads become junctions.
 * Returns the ids of created segments.
 */
export function commitStrokes(net: RoadNetwork, strokes: Stroke[]): number[] {
  const created: number[] = [];
  for (const st of strokes) {
    if (!st.chain.length) continue;
    const pts = chainPoints(st.chain, 1);
    const pl = makePolyline(pts);
    const L = pl.length;
    const hs = strokeHeights(net, st, pts, pl.cum);
    // crossings against the network as it is now
    const startP = st.chain[0].p0, endP = st.chain[st.chain.length - 1].p3;
    const ignore = { segs: new Set<number>(), nodes: new Set<number>() };
    const { crossings } = findCrossings(net, pts, pl.cum, hs, ignore);
    // break points along the stroke: piece joints + crossings
    type Brk = { s: number; p: V2; h: number; node?: number; crossSeg?: number };
    const brks: Brk[] = [];
    const startNode = resolveAnchor(net, startP, st.h0);
    brks.push({ s: 0, p: startP, h: st.h0, node: startNode });
    // piece joints
    let acc = 0;
    const pieceLen: number[] = [];
    for (const c of st.chain) {
      const l = makePolyline(sampleCubic(c, 1)).length;
      pieceLen.push(l);
    }
    for (let i = 0; i < st.chain.length - 1; i++) {
      acc += pieceLen[i];
      brks.push({ s: acc, p: st.chain[i].p3, h: st.hj?.[i + 1] ?? heightAt(st, acc / L) });
    }
    for (const c of crossings) {
      if (c.sPlan < 2 || c.sPlan > L - 2 || st.beside?.includes(c.seg)) continue;
      brks.push({ s: c.sPlan, p: c.p, h: c.hSeg, crossSeg: c.seg });
    }
    brks.sort((a, b) => a.s - b.s);
    // drop joints that sit right next to a crossing (the crossing node replaces them)
    const merged: Brk[] = [];
    for (const b of brks) {
      const last = merged[merged.length - 1];
      if (last && b.s - last.s < 3) {
        if (b.crossSeg !== undefined && last.node === undefined) merged[merged.length - 1] = b;
        continue;
      }
      merged.push(b);
    }
    const endBrk: Brk = { s: L, p: endP, h: st.h1 };
    if (merged.length && L - merged[merged.length - 1].s < 3 && merged.length > 1) merged.pop();
    merged.push(endBrk);
    // resolve nodes
    for (let i = 1; i < merged.length; i++) {
      const b = merged[i];
      if (b.node !== undefined) continue;
      if (st.closed && i === merged.length - 1) { b.node = startNode; continue; }
      b.node = b.crossSeg !== undefined || i === merged.length - 1 ? resolveAnchor(net, b.p, b.h) : net.addNode(b.p, b.h);
    }
    // segment cubics between consecutive breaks: cut the chain at the break arc-lengths
    const cubics = cutChain(st.chain, pieceLen, merged.map((b) => b.s));
    const paved = pavedPieces(st);
    for (let i = 0; i < cubics.length; i++) {
      const a = merged[i].node!, b = merged[i + 1].node!;
      if (a === b) continue;
      const c = cubics[i];
      // snap the cubic's ends onto the actual node positions
      const na = net.nodes.get(a)!.p, nb = net.nodes.get(b)!.p;
      const fixed: Cubic = { p0: na, p1: add(c.p1, sub(na, c.p0)), p2: add(c.p2, sub(nb, c.p3)), p3: nb };
      // (a dirt road's bridge and ramps: the piece the middle of this road lies in decides)
      const type = paved ? typeAtS(st, pieceLen, (merged[i].s + merged[i + 1].s) / 2) : st.type;
      created.push(net.addSeg(a, b, type, fixed, st.ring ?? 0));
    }
  }
  return created;
}

/** Cut a chain of cubics at the given arc-lengths (sorted, including 0 and total). */
function cutChain(chain: Cubic[], pieceLen: number[], cuts: number[]): Cubic[] {
  const out: Cubic[] = [];
  // map every cut to (piece, t)
  const locate = (s: number) => {
    let acc = 0;
    for (let i = 0; i < chain.length; i++) {
      if (s <= acc + pieceLen[i] + 1e-6 || i === chain.length - 1) return { i, t: tAtLength(chain[i], clamp(s - acc, 0, pieceLen[i])) };
      acc += pieceLen[i];
    }
    return { i: chain.length - 1, t: 1 };
  };
  for (let k = 0; k < cuts.length - 1; k++) {
    const A = locate(cuts[k]), B = locate(cuts[k + 1]);
    if (A.i === B.i) out.push(subCubic(chain[A.i], A.t, B.t));
    else {
      // spans a piece joint (joint was merged away): approximate by a hermite through both ends
      const p0 = cubicAt(chain[A.i], A.t), p3 = cubicAt(chain[B.i], B.t);
      const t0 = norm(cubicTangent(chain[A.i], A.t)), t3 = norm(cubicTangent(chain[B.i], B.t));
      const th = Math.abs(signedAngle(t0, t3));
      const k2 = th < 1e-3 ? 1 / 3 : ((2 / 3) * Math.tan(th / 4)) / Math.sin(th / 2);
      out.push(hermiteCubic(p0, t0, p3, t3, Math.min(k2, 1)));
    }
  }
  return out;
}

function subCubic(c: Cubic, t0: number, t1: number): Cubic {
  if (t0 <= 1e-6 && t1 >= 1 - 1e-6) return c;
  const [, right1] = splitCubic(c, t0);
  if (t1 >= 1 - 1e-6) return right1;
  const tt = (t1 - t0) / (1 - t0 || 1);
  return splitCubic(right1, tt)[0];
}

function tAtLength(c: Cubic, s: number): number {
  const N = 64;
  let acc = 0;
  let prev = c.p0;
  for (let i = 1; i <= N; i++) {
    const t = i / N;
    const p = cubicAt(c, t);
    const d = dist(prev, p);
    if (acc + d >= s) return (i - 1) / N + ((s - acc) / (d || 1)) / N;
    acc += d;
    prev = p;
  }
  return 1;
}

// ---------------------------------------------------------------------------------------------
// Roundabouts
// ---------------------------------------------------------------------------------------------

/** Roundabout sizes 1-4: ring radius and the one-way type of the ring. */
export const ROUNDABOUTS = {
  1: { r: 16, type: "one1", name: "Small" },
  2: { r: 26, type: "one2", name: "Medium" },
  3: { r: 36, type: "one2", name: "Large" },
  4: { r: 50, type: "one3", name: "Huge" },
} as const satisfies Record<number, { r: number; type: RoadTypeId; name: string }>;
export type RoundaboutSize = keyof typeof ROUNDABOUTS;

/** Plan a roundabout centred at c. Roads crossing its circle get connected; their inside parts are removed. */
export function planRoundabout(net: RoadNetwork, world: BuildWorld, c: V2, size: RoundaboutSize, level: number): Plan {
  const R: number = ROUNDABOUTS[size].r;
  const h = level * LEVEL_H;
  const type: RoadTypeId = ROUNDABOUTS[size].type;
  // crossings of existing roads with the ring circle
  const hits: { ang: number; seg: number; p: V2 }[] = [];
  const removeSegs = new Set<number>();
  const removeNodes = new Set<number>();
  const errors: PlanError[] = [];
  for (const id of net.segsNear(c.x - R - 20, c.y - R - 20, c.x + R + 20, c.y + R + 20)) {
    const g = net.segGeom.get(id)!;
    const s = net.segs.get(id)!;
    const cp = g.center.pts;
    let inside = false;
    const first = hits.length;
    let cutAt = 0; // (how far along the road its last crossing of the circle is)
    for (let j = 0; j < cp.length; j++) {
      const dj = dist(cp[j], c);
      if (dj < R) inside = true;
      if (j === cp.length - 1) break;
      const d0 = dist(cp[j], c) - R, d1 = dist(cp[j + 1], c) - R;
      if ((d0 < 0) !== (d1 < 0)) {
        const t = d0 / (d0 - d1);
        const p = lerpV(cp[j], cp[j + 1], t);
        cutAt = g.center.cum[j] + (g.center.cum[j + 1] - g.center.cum[j]) * t;
        const hh = g.hs[j] + (g.hs[j + 1] - g.hs[j]) * t;
        if (Math.abs(hh - h) >= CLEARANCE) continue;
        if (Math.abs(hh - h) > 0.6) { errors.push({ msg: "Not enough clearance", p }); continue; }
        const dirS = norm(sub(cp[j + 1], cp[j]));
        const radial = norm(sub(p, c));
        if (Math.abs(dot(dirS, radial)) < Math.cos((60 * Math.PI) / 180)) errors.push({ msg: "Road meets the ring too shallow", p });
        hits.push({ ang: angleOf(sub(p, c)), seg: id, p });
      }
    }
    // the part inside will be removed
    const hS = g.hs[Math.floor(g.hs.length / 2)];
    if (inside && Math.abs(hS - h) < CLEARANCE) {
      removeSegs.add(id);
      for (const n of [s.a, s.b]) if (dist(net.nodes.get(n)!.p, c) < R) removeNodes.add(n);
      // a dead end that would be left sticking out of the ring shorter than a road may be (the last metres of a
      // works' gate street, say) goes too, and is no arm of the ring: what it served is on the ring itself now
      if (hits.length === first + 1) {
        const [end, left] = dist(net.nodes.get(s.a)!.p, c) >= R ? [s.a, cutAt] : [s.b, g.center.length - cutAt];
        if (left < MIN_SEG_LEN && net.segsAt(end).length === 1 && dist(net.nodes.get(end)!.p, c) >= R) { hits.pop(); removeNodes.add(end); }
      }
    }
  }
  hits.sort((a, b) => a.ang - b.ang);
  for (let i = 0; i < hits.length; i++) {
    const a = hits[i], b = hits[(i + 1) % hits.length];
    let gap = b.ang - a.ang;
    if (i === hits.length - 1) gap += Math.PI * 2;
    if (hits.length > 1 && gap * R < 11) {
      // (the fix is the next size up, where the same roads meet a longer rim: say so. Road play 2026-11-10)
      let bigger: string | null = null;
      for (let k = size + 1; k <= 4 && !bigger; k++) {
        const alt = planRoundabout(net, world, c, k as RoundaboutSize, level);
        if (!alt.errors.some((e) => e.msg.startsWith("Roads meet the ring too close"))) bigger = ROUNDABOUTS[k as RoundaboutSize].name;
      }
      errors.push({ msg: bigger ? `Roads meet the ring too close: try ${bigger}` : "Roads meet the ring too close", p: a.p });
      break;
    }
  }
  if (hits.length > 6) errors.push({ msg: "Too many roads for one roundabout", p: c });
  // ring nodes: hits + filler so arcs stay <= 80 degrees; traffic runs counter-clockwise on screen
  const angs = hits.map((x) => x.ang);
  if (!angs.length) angs.push(0);
  const all: number[] = [];
  const sorted = [...angs].sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    const a = sorted[i];
    let b = sorted[(i + 1) % sorted.length];
    if (b <= a) b += Math.PI * 2;
    all.push(a);
    const n = Math.ceil((b - a) / ((80 * Math.PI) / 180));
    for (let k = 1; k < n; k++) all.push(a + ((b - a) * k) / n);
  }
  // build arcs in decreasing angle order (counter-clockwise visually with y pointing down)
  all.sort((a, b) => b - a);
  const chain: Cubic[] = [];
  for (let i = 0; i < all.length; i++) {
    const a0 = all[i];
    let a1 = all[(i + 1) % all.length];
    if (a1 >= a0) a1 -= Math.PI * 2;
    chain.push(...arcCubics(c, R, a0, a1 - a0));
  }
  const stroke: Stroke = { chain, h0: h, h1: h, type, closed: true, ring: 1 };
  // validate: terrain/buildings/money on the ring itself; crossings are expected
  const exempt = { segs: new Set([...hits.map((x) => x.seg), ...removeSegs]), nodes: new Set(removeNodes) };
  const plan = validateStrokes(net, world, [stroke], "roundabout", [], exempt);
  plan.errors = plan.errors.filter((e) => !e.msg.startsWith("Crossing") && !e.msg.startsWith("Junctions too close") && !e.msg.startsWith("Too close") && !e.msg.startsWith("Overlaps"));
  plan.errors.push(...errors);
  plan.removeSegs = [...removeSegs];
  plan.removeNodes = [...removeNodes];
  plan.ringCenter = c;
  plan.crossings = hits.map((x) => x.p);
  return plan;
}

/** Commit a roundabout plan (inside a transaction, geometry up to date). */
export function commitRoundabout(net: RoadNetwork, plan: Plan): void {
  const c = plan.ringCenter!;
  const st = plan.strokes[0];
  const R = dist(st.chain[0].p0, c);
  const drop = new Set(plan.removeNodes ?? []);
  // cut roads at the circle and drop what's inside
  for (const id of plan.removeSegs ?? []) {
    const s = net.segs.get(id);
    if (!s) continue;
    const pts = sampleCubic(s.c, 0.5);
    // find parameter ranges outside the circle: walk the cubic and keep outside runs
    // (steps of 0.75 m at most: at 400 steps whatever its length, a road a kilometre long was cut up to 3 m short of
    // the ring, and an end that far from it was no arm of the ring, only a dead end beside it)
    const L = makePolyline(pts).length;
    const N = Math.max(400, Math.ceil(L / 0.75));
    const outside: [number, number][] = [];
    let runStart: number | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const o = dist(cubicAt(s.c, t), c) >= R;
      if (o && runStart === null) runStart = t;
      if ((!o || i === N) && runStart !== null) {
        const end = o ? 1 : (i - 1) / N;
        if (end - runStart > 0.01 || (end - runStart) * L > MIN_SEG_LEN) outside.push([runStart, end]);
        runStart = null;
      }
    }
    const na = net.nodes.get(s.a)!, nb = net.nodes.get(s.b)!;
    const type = s.type, ring = s.ring;
    net.removeSeg(id, true);
    for (const [t0, t1] of outside) {
      const sub1 = subCubic(s.c, t0, t1);
      const pa = t0 < 1e-6 ? s.a : null;
      const pb = t1 > 1 - 1e-6 ? s.b : null;
      const ha = net.heightOnSegRaw(na.h, nb.h, t0), hb = net.heightOnSegRaw(na.h, nb.h, t1);
      // (a stub the plan drops: see planRoundabout)
      if ((pa !== null && drop.has(pa)) || (pb !== null && drop.has(pb))) continue;
      const a = pa !== null && net.nodes.has(pa) ? pa : net.addNode(sub1.p0, ha);
      const b = pb !== null && net.nodes.has(pb) ? pb : net.addNode(sub1.p3, hb);
      if (!net.nodes.has(a)) continue;
      net.addSeg(a, b, type, sub1, ring, s.town); // (a town street trimmed for the ring is still the town's)
    }
  }
  for (const n of plan.removeNodes ?? []) if (net.nodes.has(n)) net.removeNode(n);
  // the ring: nodes at the cut points get reused because the outer pieces end exactly on the circle
  const ringId = net.nextId + 1000;
  const ring: Stroke = { ...st, ring: ringId };
  const nodes: number[] = [];
  for (const cb of ring.chain) nodes.push(resolveAnchorExact(net, cb.p0, ring.h0));
  for (let i = 0; i < ring.chain.length; i++) {
    const a = nodes[i], b = nodes[(i + 1) % nodes.length];
    net.addSeg(a, b, ring.type, ring.chain[i], ringId);
  }
}

function resolveAnchorExact(net: RoadNetwork, p: V2, h: number): number {
  for (const n of net.nodes.values()) if (dist(n.p, p) < 1.2 && Math.abs(n.h - h) < 0.6) return n.id;
  return net.addNode(p, h);
}

// ---------------------------------------------------------------------------------------------
// Grids
// ---------------------------------------------------------------------------------------------

/** A street grid filling the rectangle a-b (axis aligned to `axis`), with rounded outer corners. */
export function planGrid(net: RoadNetwork, world: BuildWorld, a: V2, b: V2, axis: V2, type: RoadTypeId, level: number): Plan {
  const ux = norm(axis), uy = right(ux);
  const o = a;
  const d = sub(b, a);
  let W = dot(d, ux), H = dot(d, uy);
  const sx = Math.sign(W) || 1, sy = Math.sign(H) || 1;
  W = Math.abs(W); H = Math.abs(H);
  const X = scale(ux, sx), Y = scale(uy, sy);
  const P = (x: number, y: number) => add(o, add(scale(X, x), scale(Y, y)));
  const h = level * LEVEL_H;
  const strokes: Stroke[] = [];
  if (W < 30 || H < 30) {
    return { strokes, cost: 0, length: 0, errors: [{ msg: "Make the grid bigger: at least 30 m each way", p: b }], crossings: [], kind: "grid" };
  }
  const blockW = 96, blockH = 80;
  const nx = Math.max(1, Math.round(W / blockW)), ny = Math.max(1, Math.round(H / blockH));
  const r = Math.min(14, W / 4, H / 4);
  // outline (closed): rounded rectangle traced in one direction
  const chain: Cubic[] = [];
  const corner = (cx: number, cy: number, a0: number) => {
    const ctr = P(cx, cy);
    // arc in local frame; convert angles to world
    const ang = (t: number) => angleOf(add(scale(X, Math.cos(t)), scale(Y, Math.sin(t))));
    const s0 = ang(a0), s1 = ang(a0 + Math.PI / 2);
    let sw = s1 - s0;
    while (sw > Math.PI) sw -= Math.PI * 2;
    while (sw < -Math.PI) sw += Math.PI * 2;
    chain.push(...arcCubics(ctr, r, s0, sw));
  };
  chain.push(straightCubic(P(r, 0), P(W - r, 0)));
  corner(W - r, r, -Math.PI / 2);
  chain.push(straightCubic(P(W, r), P(W, H - r)));
  corner(W - r, H - r, 0);
  chain.push(straightCubic(P(W - r, H), P(r, H)));
  corner(r, H - r, Math.PI / 2);
  chain.push(straightCubic(P(0, H - r), P(0, r)));
  corner(r, r, Math.PI);
  strokes.push({ chain, h0: h, h1: h, type, closed: true });
  for (let i = 1; i < nx; i++) {
    const x = (W * i) / nx;
    strokes.push({ chain: [straightCubic(P(x, 0), P(x, H))], h0: h, h1: h, type });
  }
  for (let j = 1; j < ny; j++) {
    const y = (H * j) / ny;
    strokes.push({ chain: [straightCubic(P(0, y), P(W, y))], h0: h, h1: h, type });
  }
  const plan = validateStrokes(net, world, strokes, "grid", []);
  // the grid's own crossings are by construction; only real problems matter
  plan.errors = plan.errors.filter((e) => !e.msg.startsWith("Too short"));
  return plan;
}

// ---------------------------------------------------------------------------------------------
// Paving a dirt road by drawing over it
// ---------------------------------------------------------------------------------------------

/** How far (m) the drawn line may stray from a dirt road's centreline and still be drawn over it. */
const PAVE_TOL = 2;

/**
 * A paved road drawn right along a dirt road (both ends on it, every point within PAVE_TOL of its centreline) is
 * that stretch of the dirt road paved in place, through the upgrade path, not a second road on top of it. Pieces
 * of it already that type are left as they are; the ends split the road where they fall mid-way along it. null: not
 * drawn over a dirt road (the road is planned as usual).
 */
export function planPave(net: RoadNetwork, world: BuildWorld, start: Snap, end: Snap, chain: Cubic[], type: RoadTypeId): Plan | null {
  const T = ROAD_TYPES[type];
  if (T.unpaved || !chain.length) return null;
  const onNet = (sn: Snap) => sn.node !== undefined || sn.seg !== undefined;
  if (!onNet(start) || !onNet(end)) return null;
  const pts = chainPoints(chain, 2);
  const pl = makePolyline(pts);
  if (pl.length < MIN_SEG_LEN) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
  const cands: RSeg[] = [];
  for (const id of net.segsNear(x0 - 10, y0 - 10, x1 + 10, y1 + 10)) {
    const sg = net.segs.get(id)!;
    // (raised roads stay in: a dirt road's bridge is a street, which a Street drawn along it simply passes over)
    if (sg.ring || !net.segGeom.get(id)) continue;
    cands.push(sg);
  }
  const ok = (sg: RSeg) => ROAD_TYPES[sg.type].unpaved || sg.type === type;
  // walk the drawn line, keeping to the road it is on while it stays on it, and moving on to the next one at a joint
  // (`back`: the line is drawn from the road's b end towards its a end)
  const path: { seg: RSeg; tLo: number; tHi: number; back: boolean }[] = [];
  let cur: { seg: RSeg; tLo: number; tHi: number; back: boolean } | null = null;
  for (let i = 0; i < pts.length; i++) {
    const q = pts[i];
    const dir = polyDir(pl, pl.cum[i]);
    const on = (sg: RSeg) => { const r = cubicClosest(sg.c, q); return r.d < PAVE_TOL ? r : null; };
    const here = cur && on(cur.seg);
    if (cur && here) { cur.tLo = Math.min(cur.tLo, here.t); cur.tHi = Math.max(cur.tHi, here.t); continue; }
    // the next road: one it runs along (not one it only crosses), nearest first
    let best: { sg: RSeg; t: number; d: number; back: boolean } | null = null;
    for (const sg of cands) {
      if (path.some((x) => x.seg.id === sg.id)) continue;
      const r = on(sg);
      if (!r) continue;
      const along = dot(norm(cubicTangent(sg.c, r.t)), dir);
      if (Math.abs(along) < 0.9) continue;
      if (!best || r.d < best.d) best = { sg, t: r.t, d: r.d, back: along < 0 };
    }
    if (!best || !ok(best.sg)) return null;
    // (each road joins the last at a junction or bend it shares)
    if (cur && cur.seg.a !== best.sg.a && cur.seg.a !== best.sg.b && cur.seg.b !== best.sg.a && cur.seg.b !== best.sg.b) return null;
    cur = { seg: best.sg, tLo: best.t, tHi: best.t, back: best.back };
    path.push(cur);
  }
  if (!path.length || !path.some((x) => ROAD_TYPES[x.seg.type].unpaved)) return null;
  // the ends: on the first and last roads (or at a node of theirs)
  const first = path[0], last = path[path.length - 1];
  const holds = (x: { seg: RSeg }, sn: Snap) => sn.seg === x.seg.id || (sn.node !== undefined && (x.seg.a === sn.node || x.seg.b === sn.node));
  if (!holds(first, start) || !holds(last, end)) return null;
  // each road's stretch: all of it between the two ends, from the snap where an end falls mid-way along it
  const pieces: PavePiece[] = [];
  let len = 0;
  const errors: PlanError[] = [];
  let cost = 0;
  for (const [k, x] of path.entries()) {
    const sg = x.seg, g = net.segGeom.get(sg.id)!;
    let t0 = 0, t1 = 1;
    const shared = (o?: { seg: RSeg }) => (o ? (o.seg.a === sg.a || o.seg.b === sg.a ? sg.a : sg.b) : undefined);
    const ends: [Snap | undefined, number | undefined][] = [[k === 0 ? start : undefined, shared(path[k - 1])], [k === path.length - 1 ? end : undefined, shared(path[k + 1])]];
    const ts: number[] = [];
    for (const [sn, node] of ends) {
      if (node !== undefined) ts.push(node === sg.a ? 0 : 1);
      else if (sn?.seg === sg.id) ts.push(sn.t ?? 0);
      else if (sn?.node !== undefined) ts.push(sn.node === sg.a ? 0 : 1);
    }
    if (ts.length === 2) { t0 = Math.min(ts[0], ts[1]); t1 = Math.max(ts[0], ts[1]); }
    // (a leftover shorter than a road can be goes too; a stretch that short is no paving)
    const L = g.center.length;
    const at = (t: number) => makePolyline(sampleCubic(splitCubic(sg.c, clamp(t, 1e-4, 1))[0], 1)).length;
    let s0 = t0 <= 1e-4 ? 0 : at(t0), s1 = t1 >= 1 - 1e-4 ? L : at(t1);
    if (s0 < MIN_SEG_LEN) { s0 = 0; t0 = 0; }
    if (L - s1 < MIN_SEG_LEN) { s1 = L; t1 = 1; }
    if (s1 - s0 < MIN_SEG_LEN) {
      if (path.length === 1) return { strokes: [], ghosts: [{ chain, h0: start.h, h1: end.h, type }], cost: 0, length: pl.length, errors: [{ msg: `Too short: pave at least ${MIN_SEG_LEN} m`, p: end.p }], crossings: [], kind: "road" };
      continue;
    }
    if (sg.type === type) continue;
    const u = upgradeCost(net, world, sg.id, type);
    const f = (s1 - s0) / (L || 1);
    cost += u.cost * f;
    len += s1 - s0;
    errors.push(...u.errors.filter((e) => e.msg !== "Not enough money"));
    // (a one-way runs the way it was drawn, whichever way the dirt road under it was built)
    pieces.push({ seg: sg.id, t0, t1, ...(T.bwd === 0 && x.back ? { flip: true } : {}) });
  }
  if (!pieces.length) return null;
  if (cost > world.money() + 0.5) errors.push({ msg: `Not enough money for ${fmt(cost)}`, p: end.p });
  const seen = new Set<string>();
  return {
    strokes: [], ghosts: [{ chain, h0: start.h, h1: end.h, type }], cost, length: pl.length, crossings: [], kind: "road",
    errors: errors.filter((e) => (seen.has(e.msg) ? false : (seen.add(e.msg), true))),
    pave: { type, pieces },
    note: `Paves ${Math.round(len)} m of dirt road`,
    endTangent: norm(cubicTangent(chain[chain.length - 1], 1)),
  };
}

/** Pave a plan's stretches in place (planPave): split where an end falls mid-way along a road, then change its type. */
export function applyPave(net: RoadNetwork, pave: NonNullable<Plan["pave"]>): void {
  for (const pc of pave.pieces) {
    const s = net.segs.get(pc.seg);
    if (!s) continue;
    let id = s.id, t0 = pc.t0;
    const a = s.a;
    if (pc.t1 < 1 - 1e-4) {
      const n = net.splitSeg(id, pc.t1);
      id = net.segsAt(n).find((x) => x.a === a || x.b === a)!.id;
      t0 = t0 / pc.t1; // (the first piece of a split cubic is the curve from 0 to t1, run at 1 / t1 the pace)
    }
    if (t0 > 1e-4) {
      const sg = net.segs.get(id)!;
      const b = sg.b;
      const n = net.splitSeg(id, t0);
      id = net.segsAt(n).find((x) => x.a === b || x.b === b)!.id;
    }
    net.setType(id, pave.type);
    if (pc.flip) net.flip(id);
  }
}

// ---------------------------------------------------------------------------------------------
// Upgrades and removal
// ---------------------------------------------------------------------------------------------

export function upgradeCost(net: RoadNetwork, world: BuildWorld, segId: number, to: RoadTypeId): { cost: number; errors: PlanError[] } {
  const s = net.segs.get(segId)!;
  const g = net.segGeom.get(segId)!;
  const errors: PlanError[] = [];
  const pts = g.center.pts;
  const hs = Array.from(g.hs);
  const now = costOfPoints(pts, hs, s.type, world);
  const next = costOfPoints(pts, hs, to, world);
  const cost = Math.max(0, next - now * BULLDOZE_REFUND);
  const T = ROAD_TYPES[to];
  const mid = pts[Math.floor(pts.length / 2)];
  if (T.unpaved) {
    // (a dirt road is only ever on the ground, with no turn lanes and no ring)
    if (hs.some((h) => h > RAISED)) errors.push({ msg: "Dirt roads stay on the ground", p: mid });
    else if (s.ring) errors.push({ msg: "Roundabouts stay paved", p: mid });
    else if (s.pk?.a || s.pk?.b) errors.push({ msg: "Take its turn lanes off first", p: mid });
  }
  if (g.minR < T.minRadius * 0.98) errors.push({ msg: `Curve too tight for ${T.name}`, p: mid });
  const w = roadWidth(T);
  if (w > g.width + 0.1) {
    const hit = world.buildingsHit(pts, w / 2 - 0.2);
    if (hit.length) errors.push({ msg: hit.length === 1 ? "Building in the way" : `${hit.length} buildings in the way`, p: world.buildingAt?.(hit[0]) ?? mid, buildings: hit });
  }
  if (cost > world.money() + 0.5) errors.push({ msg: "Not enough money", p: mid });
  return { cost, errors };
}

export function removalRefund(net: RoadNetwork, world: BuildWorld, segs: Iterable<number>): number {
  let r = 0;
  for (const id of segs) r += segCost(net, id, world) * BULLDOZE_REFUND;
  return r;
}

/** Closest segment to p within the road surface (+pad), optionally at one level. */
export function segAt(net: RoadNetwork, p: V2, pad: number, level: number | null = null): number | null {
  let best: number | null = null, bd = Infinity;
  for (const id of net.segsNear(p.x - 30, p.y - 30, p.x + 30, p.y + 30)) {
    const g = net.segGeom.get(id)!;
    const s = net.segs.get(id)!;
    const r = cubicClosest(s.c, p);
    const h = net.heightOnSeg(id, r.t);
    if (level !== null && Math.abs(h - level * LEVEL_H) > 1) continue;
    const d = r.d - g.width / 2;
    // prefer higher roads when stacked (they're drawn on top)
    const score = d - h * 0.01;
    if (d < pad && score < bd) { bd = score; best = id; }
  }
  return best;
}

// ---------------------------------------------------------------------------------------------
// Add lane: turn pockets before a junction; on a motorway, a slip lane lengthened
// ---------------------------------------------------------------------------------------------

export interface LanePlan {
  /** a turn pocket on road `seg` before the junction at its end `end`: lengths after the edit (null: none left) */
  pocket?: { seg: number; end: "a" | "b"; to: Pocket | null; side: "r" | "l"; len: number };
  /** a motorway's slip lane, lengthened up to the cursor */
  road?: Plan;
  cost: number;
  errors: PlanError[];
  /** shown with the cursor ("Left-turn lane 40 m") */
  label: string;
  /** the new lane's outline (and its taper), for the preview */
  outline: V2[];
  /** a turn lane: the ground the road widens onto at its kerb (closed), which has to be clear of buildings */
  widen?: V2[];
}

const POCKET_MIN = 15;

/**
 * Add lane at `p` (Trafficity): on a town road, a turn lane opening out of it before the junction ahead of the
 * traffic on that side, from here up to the stop line; nearer the centre a left-turn lane, nearer the kerb a
 * right-turn lane. On a motorway, the slip lane of the exit ahead (or the entry behind) drawn on to here.
 * `remove`: take the turn lane there away instead.
 */
export function planAddLane(net: RoadNetwork, world: BuildWorld, p: V2, remove = false): LanePlan | null {
  const id = segAt(net, p, 1.5);
  if (id === null) return null;
  const s = net.segs.get(id)!, g = net.segGeom.get(id)!;
  const T = ROAD_TYPES[s.type];
  const fail = (msg: string, label = ""): LanePlan => ({ cost: 0, errors: [{ msg, p }], label, outline: [] });
  const sc = polyClosest(g.center, p).s, dr = polyDir(g.center, sc);
  const lat = cross(dr, sub(p, polyAt(g.center, sc))); // + = right of a->b
  const dir: 1 | -1 = T.bwd === 0 || lat >= 0 ? 1 : -1;
  const end = dir === 1 ? "b" : "a";
  const n = dir === 1 ? T.fwd : T.bwd, med = (T.median ?? 0) / 2;
  // which half of this side's lanes the cursor is over
  let side: "r" | "l" = T.bwd === 0 ? (lat < 0 ? "l" : "r") : Math.abs(lat) - med < (n * LANE_W) / 2 ? "l" : "r";
  const prev = s.pk?.[end] ?? null;
  if (remove && prev) {
    // (with only one turn lane there, either half takes it away)
    if (!prev[side]) side = side === "r" ? "l" : "r";
    const what = side === "r" ? "right-turn lane" : "left-turn lane";
    const to = { ...prev, [side]: 0 };
    return { pocket: { seg: id, end, to: to.r || to.l ? to : null, side, len: 0 }, cost: 0, errors: [], label: `Remove ${what}`, outline: s.ring || !n ? [] : pocketOutline(net, id, dir, side, prev[side], prev).lane };
  }
  if (isHighway(T) && T.bwd === 0) return planMotorwayLane(net, world, p, id);
  if (s.ring) return fail("Not on a roundabout");
  if (T.unpaved) return fail("Pave the dirt road first: draw a street over it");
  const name = side === "r" ? "Right-turn lane" : "Left-turn lane";
  if (remove) return fail(`No ${name.toLowerCase()} here`);
  const node = dir === 1 ? s.b : s.a;
  const ng = net.nodeGeom.get(node);
  if (!ng || ng.kind !== "junction" || ng.arms.length < 3) return fail("Turn lanes go just before a junction");
  // there has to be a turn that way for it to serve
  const turns = side === "r" ? ["R"] : ["L", "U"];
  if (!ng.conns.some((c) => c.from.seg === id && c.from.dir === dir && turns.includes(c.turn))) return fail(side === "r" ? "No right turn at this junction" : "No left turn at this junction", name);
  const L = g.center.length, tp = pocketTaper(s.type);
  const stop = dir === 1 ? L - g.trimB : g.trimA;
  const other = g.ends[end === "a" ? "b" : "a"].pocket;
  const room = L - g.trimA - g.trimB - 4 - (other ? Math.max(other.r, other.l) + tp : 0) - tp;
  if (room < POCKET_MIN) return fail("Too short a road for a turn lane", name);
  let len = Math.round(Math.max(POCKET_MIN, dir === 1 ? stop - sc : sc - stop) / 5) * 5;
  const capped = len > room;
  len = Math.min(len, Math.floor(room));
  const to: Pocket = { r: prev?.r ?? 0, l: prev?.l ?? 0, [side]: len };
  const perM = T.costPerM / (T.fwd + T.bwd);
  const was = prev?.[side] ?? 0;
  const cost = Math.round(Math.max(0, len - was) * perM + (was ? 0 : tp * 0.5 * perM));
  const errors: PlanError[] = [];
  const { lane: outline, widen } = pocketOutline(net, id, dir, side, len, to);
  const hit = world.buildingsHit(widen, 0.2);
  if (hit.length) errors.push({ msg: hit.length === 1 ? "Building in the way" : `${hit.length} buildings in the way`, p, buildings: hit });
  if (cost > world.money() + 0.5) errors.push({ msg: "Not enough money", p });
  return { pocket: { seg: id, end, to, side, len }, cost, errors, label: `${name} ${len} m${capped ? " (all that fits)" : ""}`, outline, widen };
}

/**
 * A turn pocket on road `id`, for the traffic going `dir`, with lengths `pk` and its `side` lane `len` long: that
 * lane's outline (with its taper), and the ground the road widens onto at the kerb (both pockets; closed).
 */
function pocketOutline(net: RoadNetwork, id: number, dir: 1 | -1, side: "r" | "l", len: number, pk: Pocket): { lane: V2[]; widen: V2[] } {
  const s = net.segs.get(id)!, g = net.segGeom.get(id)!;
  const T = ROAD_TYPES[s.type];
  const L = g.center.length, tp = pocketTaper(s.type);
  const stop = dir === 1 ? L - g.trimB : g.trimA;
  const sg = dir === 1 ? 1 : -1;
  const n = dir === 1 ? T.fwd : T.bwd, med = (T.median ?? 0) / 2, twoWay = T.bwd > 0;
  // the side's inside edge (centre line, median or a one-way's left edge)
  const inner = twoWay ? med : -(n / 2) * LANE_W;
  const kerb = inner + n * LANE_W;
  // how open a pocket `ln` long is `back` metres back from the stop line
  const open = (ln: number, back: number) => (ln <= 0 ? 0 : back <= ln ? 1 : back < ln + tp ? smoothstep(1 - (back - ln) / tp) : 0);
  const at = (back: number) => {
    const sc = clamp(dir === 1 ? stop - back : stop + back, 0, L);
    return { q: polyAt(g.center, sc), r: right(polyDir(g.center, sc)) };
  };
  const lane0: V2[] = [], lane1: V2[] = [];
  const steps = Math.max(4, Math.ceil((len + tp) / 3));
  for (let k = 0; k <= steps; k++) {
    const back = ((len + tp) * k) / steps;
    const { q, r } = at(back);
    // a left lane opens on the inside; a right one beside the kerb lane, which moves out as the left one opens
    const a = side === "l" ? inner : kerb + LANE_W * open(pk.l, back);
    lane0.push(add(q, scale(r, sg * a)));
    lane1.push(add(q, scale(r, sg * (a + LANE_W * open(len, back)))));
  }
  const far = Math.max(pk.l, pk.r) + tp;
  const w0: V2[] = [], w1: V2[] = [];
  const ws = Math.max(4, Math.ceil(far / 3));
  for (let k = 0; k <= ws; k++) {
    const back = (far * k) / ws;
    const { q, r } = at(back);
    w0.push(add(q, scale(r, sg * kerb)));
    w1.push(add(q, scale(r, sg * (kerb + LANE_W * (open(pk.l, back) + open(pk.r, back))))));
  }
  const widen = [...w0, ...w1.reverse()];
  widen.push(widen[0]);
  return { lane: [...lane0, ...lane1.reverse()], widen };
}

/** On a motorway: lengthen the slip lane of the exit ahead (or the entry behind) to reach `p`. */
function planMotorwayLane(net: RoadNetwork, world: BuildWorld, p: V2, id: number): LanePlan {
  const s = net.segs.get(id)!;
  const fail = (msg: string): LanePlan => ({ cost: 0, errors: [{ msg, p }], label: "Slip lane", outline: [] });
  if (slipLaneEnd(net, id)) return fail("Click the motorway before this lane starts to lengthen it");
  const r = cubicClosest(s.c, p);
  const here: Snap = { p: r.p, h: net.heightOnSeg(id, r.t), seg: id, t: r.t, guides: [] };
  let best: { plan: Plan; d: number } | null = null;
  for (const dir of [1, -1] as const) {
    for (const w of walkCarriage(net, here, dir, 900)) {
      if (w.node === undefined) continue;
      const nd = net.nodes.get(w.node)!;
      const sl = slipAt(net, { p: { ...nd.p }, h: nd.h, node: w.node, guides: [] });
      // an exit's lane starts ahead of us (we're upstream of it), an entry's ends behind us
      if (!sl || sl.exit !== (dir === 1)) continue;
      const plan = planSlipExtend(net, world, { p: { ...nd.p }, h: nd.h, node: w.node, guides: [] }, here, sl.seg.type);
      if (plan && (!best || w.d1 < best.d)) best = { plan, d: w.d1 };
      break;
    }
  }
  if (!best) return fail("Motorway lanes open where a ramp leaves or joins: click just before an exit's slip lane, or just after an entry's");
  const plan = best.plan;
  const st = plan.strokes[0];
  const pts = st ? chainPoints(st.show ?? st.chain, 3) : [];
  return { road: plan, cost: plan.cost, errors: plan.errors, label: plan.note ?? `Slip lane ${Math.round(best.d)} m longer`, outline: pts.length > 1 ? stripOutline(pts, LANE_W / 2) : [] };
}

function stripOutline(pts: V2[], hw: number): V2[] {
  const l: V2[] = [], r: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const n = right(norm(sub(b, a)));
    l.push(add(pts[i], scale(n, -hw)));
    r.push(add(pts[i], scale(n, hw)));
  }
  return [...l, ...r.reverse()];
}
