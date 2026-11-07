import {
  CLEARANCE, ELEVATED_COST_MULT, LANE_W, LEVEL_H, MAX_GRADE, MIN_ARM_ANGLE, MIN_SEG_LEN, NODE_SNAP_PX, ROAD_SNAP_PX,
  ROAD_TYPES, ROUNDABOUT_COST, WATER_BRIDGE_MULT, BULLDOZE_REFUND, roadWidth, isHighway, type RoadTypeId,
} from "../config";
import {
  type Cubic, type V2, add, angleOf, arcCubics, arcThenLine, rampCurve, rampCurves, clamp, cubicAt, cubicTangent, dist, dot, fromAngle, hermiteCubic,
  lerpV, makePolyline, minRadius, norm, polyAt, polyClosest, polyDir, quadCubic, right, sampleCubic, scale, segIntersect, signedAngle, smoothstep,
  splitCubic, straightCubic, sub, tangentArc, pointSegDist2, len, cross,
} from "../core/math";
import { glueGap, glueRun, type RoadNetwork, type RSeg } from "./network";

// ---------------------------------------------------------------------------------------------
// World queries the planner needs (terrain, buildings, locked tiles)
// ---------------------------------------------------------------------------------------------

export interface BuildWorld {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
  inBounds(p: V2): boolean;
  unlocked(p: V2): boolean;
  /** Buildings whose footprint comes within `hw` of any of the points. */
  buildingsHit(pts: V2[], hw: number): number[];
  money(): number;
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
}

export interface Guide {
  a: V2;
  b: V2;
}

export interface SnapOpts {
  mpp: number; // metres per screen pixel
  level: number;
  from?: { p: V2; tangent?: V2; on?: Snap }; // the point we are drawing from (on: what it snapped to)
  angleStep?: boolean; // shift held: 15 degree steps
  grid?: number; // grid size in metres (0 = off)
  type: RoadTypeId;
  /** Snapping switched off in the snapping menu: existing roads, guidelines/right angles, side-by-side roads. */
  off?: { geometry?: boolean; guides?: boolean; netSide?: boolean };
  /** Round free lengths to this many metres (CS2's "cell length": 8 m). */
  lengthStep?: number;
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
    const r = cubicClosest(s.c, raw);
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
  // 3) free point with angle snapping / alignment guides
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
        const step = (15 * Math.PI) / 180;
        const k = Math.round((ang - base) / step);
        p = add(f, scale(fromAngle(base + k * step), L));
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
 * Road drawing modes (as in CS2): straight (2 clicks), simple curve (start, bend point, end), complex curve
 * (start, two handles, end) and continuous (each piece carries on smoothly from the last, and meets a road it
 * ends on at a right angle).
 */
export type CurveMode = "straight" | "curve" | "complex" | "continuous";

export interface PlanError {
  msg: string;
  p: V2;
  buildings?: number[];
}

export interface Stroke {
  chain: Cubic[];
  h0: number;
  h1: number;
  type: RoadTypeId;
  closed?: boolean;
  ring?: number;
}

export interface Plan {
  strokes: Stroke[];
  cost: number;
  length: number;
  errors: PlanError[];
  crossings: V2[];
  endTangent?: V2;
  angleDeg?: number;
  kind: "road" | "roundabout" | "grid";
  removeSegs?: number[]; // segments replaced (roundabout interior)
  removeNodes?: number[];
  ringCenter?: V2;
  /** Parallel road ends on the main road's start and end sides. */
  parallelEnds?: { a: V2; b: V2 };
  /** Cut the previous parallel piece back first (a pair turning a corner). */
  trim?: ParallelTrim;
  /** Lanes added to the carriageway between two points on it: drawn along its kerb, or a ramp's slip lane. */
  widen?: Widen;
  /** Shown with the preview but not built as roads (the new lane of a Widen). */
  ghosts?: Stroke[];
  /** Short description shown with the preview ("Add lane"). */
  note?: string;
  /** Where the next stroke carries on from, when that isn't the end of the first stroke (a lane drawn along a carriageway). */
  continueAt?: { p: V2; h: number };
}

export interface Widen {
  a: V2;
  b: V2;
  ha: number;
  hb: number;
  /** lane count every piece of the stretch is brought up to */
  lanes: number;
}

export function chainPoints(chain: Cubic[], step = 2): V2[] {
  const pts: V2[] = [];
  for (const c of chain) {
    const s = sampleCubic(c, step);
    if (pts.length) s.shift();
    pts.push(...s);
  }
  return pts;
}

/** Turn the user's input into a stroke (see CurveMode). */
export function makeChain(mode: CurveMode, a: V2, b: V2, ta?: V2, tb?: V2, ctrl?: V2, ctrl2?: V2): Cubic[] {
  if (dist(a, b) < 0.5) return [];
  if (mode === "straight") return [straightCubic(a, b)];
  if (mode === "complex" && ctrl && ctrl2) return [{ p0: a, p1: ctrl, p2: ctrl2, p3: b }];
  if (mode === "curve" || mode === "complex") {
    if (ctrl) return [quadCubic(a, ctrl, b)];
    return [straightCubic(a, b)];
  }
  // continuous: an S-curve when the end has a direction to meet, else an arc on from the start direction
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

function costOfPoints(pts: V2[], hs: number[], type: RoadTypeId, world: BuildWorld): number {
  const T = ROAD_TYPES[type];
  let c = 0;
  for (let i = 1; i < pts.length; i++) {
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
  const bad: { p: V2; msg: string }[] = [];
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
  for (const id of net.segsNear(x0 - 30, y0 - 30, x1 + 30, y1 + 30)) {
    const g = net.segGeom.get(id);
    const s = net.segs.get(id);
    if (!g || !s) continue;
    const cp = g.center.pts;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let j = 0; j < cp.length - 1; j++) {
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
        if (dh > 0.6) {
          bad.push({ p, msg: `Not enough clearance (${dh.toFixed(1)} m, needs ${CLEARANCE} m)` });
          continue;
        }
        const da = norm(sub(pts[i + 1], pts[i])), db = norm(sub(cp[j + 1], cp[j]));
        const angle = Math.acos(clamp(Math.abs(dot(da, db)), 0, 1));
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
  ctrl?: V2;
  ctrl2?: V2;
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
  if (!main || !mg || !chain.length) return r;
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
interface SlipAnchor { p: V2; segs: Set<number> }

/**
 * The one-way road type like `t` with `lanes` lanes: the same family (a highway stays a highway, a town street keeps
 * its kerbside access), closest in speed. null if there's none.
 */
export function laneType(t: RoadTypeId, lanes: number): RoadTypeId | null {
  const T = ROAD_TYPES[t];
  if (T.bwd > 0) return null;
  if (T.fwd === lanes) return t;
  const c = Object.values(ROAD_TYPES).filter((x) => x.bwd === 0 && x.fwd === lanes && isHighway(x) === isHighway(T));
  c.sort((x, y) => Math.abs(x.speed - T.speed) - Math.abs(y.speed - T.speed));
  return c[0]?.id ?? null;
}

/** The one-way road type `add` lanes wider than `t`, if there is one. */
export const widerType = (t: RoadTypeId, add: number): RoadTypeId | null => laneType(t, ROAD_TYPES[t].fwd + add);

/** One-way carriageway pieces leading from node `from` to node `to` in its travel direction (in-line run-ons only). */
export function carriagewayRun(net: RoadNetwork, from: number, to: number, first?: number): number[] | null {
  const walk = (cur: RSeg, segs: number[]): number[] | null => {
    if (segs.length > 40 || cur.ring || ROAD_TYPES[cur.type].bwd > 0) return null;
    const run = [...segs, cur.id];
    if (cur.b === to) return run;
    const t = norm(cubicTangent(cur.c, 1));
    for (const s of net.segsAt(cur.b)) {
      if (s.a !== cur.b || s.id === cur.id || dot(norm(cubicTangent(s.c, 0)), t) < 0.94) continue;
      const r = walk(s, run);
      if (r) return r;
    }
    return null;
  };
  for (const s of net.segsAt(from)) {
    if (s.a !== from || (first !== undefined && s.id !== first)) continue;
    const r = walk(s, []);
    if (r) return r;
  }
  return null;
}

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

/**
 * Drawing a one-way road along a one-way carriageway, from one point on it to another: add that many lanes to the
 * stretch instead (an auxiliary lane, tapering in and out at the ends). Drawn over a stretch that already has a lane
 * more somewhere (a slip lane), the rest of it is brought up to match: that's how a slip lane is made longer, or
 * joined up with the next one.
 */
function planWiden(net: RoadNetwork, world: BuildWorld, start: Snap, end: Snap, type: RoadTypeId): Plan | null {
  const add = ROAD_TYPES[type].fwd;
  if (ROAD_TYPES[type].bwd > 0) return null;
  // either way along it: drawn against the traffic it's still the same stretch
  let from = start, to = end;
  let pieces = stretchBetween(net, from, to);
  if (!pieces) { pieces = stretchBetween(net, end, start); [from, to] = [end, start]; }
  if (!pieces || !pieces.length || !alongCarriage(net, start, end)) return null;
  const cursorIsTo = to === end;
  const lanes = Math.min(...pieces.map((pc) => ROAD_TYPES[pc.seg.type].fwd)) + add;
  // started or ended just short of a stretch that already has the lane: run on to it rather than leave a sliver between
  let meets = false;
  const reach = (sn: Snap, dir: 1 | -1): Snap => {
    const w = walkCarriage(net, sn, dir, WIDEN_REACH);
    if (!w.length) return sn;
    if (ROAD_TYPES[w[0].seg.type].fwd >= lanes) { meets = true; return sn; } // ends right where a lane is
    for (let i = 1; i < w.length; i++) {
      const n = w[i - 1].node;
      if (n !== undefined && ROAD_TYPES[w[i].seg.type].fwd >= lanes) { const nd = net.nodes.get(n)!; return { p: { ...nd.p }, h: nd.h, node: n, guides: [] }; }
    }
    return sn;
  };
  const [f2, t2] = [reach(from, -1), reach(to, 1)];
  if (f2 !== from || t2 !== to) {
    const p2 = stretchBetween(net, f2, t2);
    if (p2?.length) { pieces = p2; from = f2; to = t2; meets = true; }
  }
  const errors: PlanError[] = [];
  let cost = 0, total = 0;
  const chain: Cubic[] = [];
  for (const pc of pieces) {
    const c = subCubic(pc.seg.c, pc.t0, pc.t1);
    const L = makePolyline(sampleCubic(c, 2)).length;
    total += L;
    const T = ROAD_TYPES[pc.seg.type];
    if (T.fwd >= lanes) continue; // already has it
    const wide = laneType(pc.seg.type, lanes);
    if (!wide) {
      errors.push({ msg: `${T.name} can't take ${lanes - T.fwd > 1 ? `${lanes - T.fwd} more lanes` : "another lane"}`, p: cubicAt(c, 0.5) });
      continue;
    }
    cost += L * Math.max(0, ROAD_TYPES[wide].costPerM - T.costPerM);
    // drawn where the new lane will be: along the kerb side
    chain.push(...offsetChain([c], (lanes * LANE_W) / 2));
  }
  const mid = chain.length ? cubicAt(chain[Math.floor(chain.length / 2)], 0.5) : start.p;
  if (total < 40) errors.push({ msg: "Lane too short: needs 40 m", p: mid });
  if (cost > world.money() + 0.5) errors.push({ msg: `Not enough money (${fmt(cost)})`, p: mid });
  const longer = meets || pieces.some((pc) => ROAD_TYPES[pc.seg.type].fwd >= lanes);
  return {
    strokes: [], ghosts: [{ chain, h0: from.h, h1: to.h, type }], cost, length: total, errors, crossings: [], kind: "road",
    widen: { a: { ...from.p }, b: { ...to.p }, ha: from.h, hb: to.h, lanes },
    continueAt: cursorIsTo ? { p: { ...to.p }, h: to.h } : { p: { ...from.p }, h: from.h },
    note: longer ? "Extend lane" : add > 1 ? `Add ${add} lanes` : "Add lane",
  };
}

/** Apply a Widen (inside a transaction, geometry up to date): every piece of the stretch brought up to its lane count. */
export function commitWiden(net: RoadNetwork, w: Widen): void {
  const A = resolveAnchor(net, w.a, w.ha), B = resolveAnchor(net, w.b, w.hb);
  const run = carriagewayRun(net, A, B);
  if (!run) return;
  for (const id of run) {
    const s = net.segs.get(id)!;
    if (ROAD_TYPES[s.type].fwd >= w.lanes) continue;
    const to = laneType(s.type, w.lanes);
    if (to) net.setType(id, to);
  }
}

/** How far a widened stretch reaches on to meet a lane already there (no short gap left between them). */
const WIDEN_REACH = 60;

/** How long a slip lane runs beside the carriageway: before an exit (to slow down) and, a bit longer, after an entry (to speed up). */
export function slipLaneLength(main: RoadTypeId, exit: boolean): number {
  const kmh = ROAD_TYPES[main].speed * 3.6;
  return Math.round(clamp(kmh * 1.6, 100, 200) * (exit ? 1 : 1.25));
}

/** A slip lane ending this close to the next one (an entry, then an exit) runs on into it as one lane. */
export const SLIP_JOIN = 250;

/**
 * The slip lane that comes with a highway ramp (a parallel-type ramp): the carriageway gets an extra lane on the kerb
 * side for a stretch before the exit (the deceleration lane) or after the entry (the acceleration lane), and the ramp
 * carries on straight out of it, or into it. If another slip lane is near enough on the same side, the two become one
 * lane between them. The lane is part of the carriageway (a Widen), so it can be drawn longer later. null: no lane
 * (a town slip road, a ramp on the far side, or one placed on a stretch that already has its extra lane).
 */
function slipLane(net: RoadNetwork, sn: Snap, exit: boolean, type: RoadTypeId, far: V2, t: V2):
  { widen: Widen; ghost: Stroke; cost: number; note: string } | null {
  const main = carriageAt(net, sn);
  if (!main || !isHighway(ROAD_TYPES[main.type]) || !isHighway(ROAD_TYPES[type])) return null;
  if (dot(sub(far, sn.p), right(t)) <= 0) return null; // lanes are added on the kerb side (right) only
  const base = ROAD_TYPES[main.type].fwd, lanes = base + ROAD_TYPES[type].fwd;
  const wide = laneType(main.type, lanes);
  if (!wide) return null;
  const dir = exit ? -1 : 1;
  const L = slipLaneLength(main.type, exit);
  // already on a stretch with a lane more than the carriageway around it: the ramp leaves (or joins) that lane
  if (walkCarriage(net, sn, exit ? 1 : -1, 400).some((w) => ROAD_TYPES[w.seg.type].fwd < base)) return null;
  const walk = walkCarriage(net, sn, dir, L + SLIP_JOIN);
  if (walk.some((w) => w.d0 < L && ROAD_TYPES[w.seg.type].fwd < base)) return null;
  let dEnd = Math.min(L, walk.length ? walk[walk.length - 1].d1 : 0), joined = false;
  for (const w of walk) {
    if (ROAD_TYPES[w.seg.type].fwd >= lanes) { dEnd = w.d0; joined = true; break; } // a lane already runs on from here
    if (w.node === undefined) continue;
    const ng = net.nodeGeom.get(w.node);
    if (ng && (ng.kind === "cont" || ng.kind === "bend" || ng.kind === "lane")) continue;
    // another slip road on this side the other way round (an entry before our exit, an exit after our entry): one lane through
    const roles = ng?.kind === "split" ? net.splitRoles(ng.arms, net.segsAt(w.node)) : null;
    if (roles?.ramp && roles.side === 1 && roles.diverge === !exit) {
      const fm = ROAD_TYPES[net.segs.get(roles.main.seg)!.type].fwd, fr = ROAD_TYPES[net.segs.get(roles.ramp.seg)!.type].fwd;
      if (fm === base && fm + fr === lanes) { dEnd = w.d1; joined = true; break; }
    }
    // anything else (a junction, another exit before ours): the lane starts short of it
    if (w.d1 < L) dEnd = w.d1 - 30;
    break;
  }
  if (dEnd < 1 || (!joined && dEnd < 60)) return null;
  // where the lane starts (exit) or ends (entry), and the new lane drawn along the kerb for the preview
  let end: { p: V2; h: number } = { p: sn.p, h: sn.h };
  const ghost: Cubic[][] = [];
  let cost = 0;
  for (const w of walk) {
    if (w.d0 >= dEnd) break;
    const whole = w.d1 <= dEnd + 1e-6;
    const tb = whole ? w.tb : tAtLength(w.seg.c, arcTo(w.seg.c, w.ta) + dir * (dEnd - w.d0));
    const nd = whole && w.node !== undefined ? net.nodes.get(w.node)! : null;
    end = nd ? { p: { ...nd.p }, h: nd.h } : { p: cubicAt(w.seg.c, tb), h: net.heightOnSeg(w.seg.id, tb) };
    if (ROAD_TYPES[w.seg.type].fwd >= lanes) continue;
    const c = subCubic(w.seg.c, Math.min(w.ta, tb), Math.max(w.ta, tb));
    cost += makePolyline(sampleCubic(c, 2)).length * Math.max(0, ROAD_TYPES[wide].costPerM - ROAD_TYPES[w.seg.type].costPerM);
    ghost.push(offsetChain([c], (lanes * LANE_W) / 2));
  }
  if (exit) ghost.reverse(); // walked upstream from the gore: drawn in the traffic's direction
  const g = { p: { ...sn.p }, h: sn.h };
  const [a, b] = exit ? [end, g] : [g, end];
  return {
    widen: { a: { ...a.p }, b: { ...b.p }, ha: a.h, hb: b.h, lanes },
    ghost: { chain: ghost.flat(), h0: a.h, h1: b.h, type },
    cost,
    note: joined ? "Slip lanes joined" : `${Math.round(dEnd)} m slip lane`,
  };
}

/** Build and validate a single road stroke. */
export function planRoad(net: RoadNetwork, world: BuildWorld, inp: PlanInput): Plan {
  const { start, end, type } = inp;
  if (!inp.parallel && !inp.ctrl && inp.mode === "straight") {
    const w = planWiden(net, world, start, end, type);
    if (w) return w;
  }
  let slip: { ta?: V2; tb?: V2 } = inp.ctrl ? {} : slipTangents(net, start, end, type);
  // a ramp that would have to swing right round to get there is no ramp: drawn that steeply, it's a junction
  const rch = rampChain(net, start, end, slip, type);
  if (!slip.ta !== !slip.tb && !rch.length) slip = {}; // (a link with both ends on carriageways is shaped by makeChain)
  const ta = inp.startTangent ?? slip.ta ?? start.tangent;
  let tb: V2 | undefined = slip.tb;
  // a curve leaving (or joining) a one-way carriageway nearly in line: put its handle on the carriageway's line
  let ctrl = inp.ctrl;
  if (ctrl && inp.mode === "curve" && ROAD_TYPES[type].bwd === 0) {
    const sa = oneWayDirAt(net, start), sb = oneWayDirAt(net, end);
    if (sa && dot(sa, norm(sub(ctrl, start.p))) > SLIP_TOWN) ctrl = add(start.p, scale(sa, Math.max(4, dot(sub(ctrl, start.p), sa))));
    else if (sb && dot(sb, norm(sub(end.p, ctrl))) > SLIP_TOWN) ctrl = sub(end.p, scale(sb, Math.max(4, dot(sub(end.p, ctrl), sb))));
  }
  if (inp.mode === "continuous" && !slip.tb) {
    if (end.node !== undefined) {
      const t = deadEndTangent(net, end.node);
      if (t) tb = scale(t, -1);
    } else if (end.seg !== undefined) {
      const s = net.segs.get(end.seg)!;
      const st = cubicTangent(s.c, end.t!);
      const n = right(st);
      const side = dot(sub(start.p, end.p), n) > 0 ? 1 : -1;
      tb = scale(n, -side);
    }
  }
  // a slip road is a smooth curve off (or onto) the carriageway even in straight mode
  const mode = (slip.ta || slip.tb) && inp.mode === "straight" ? "continuous" : inp.mode;
  // a slip road with one end on the carriageway: off along it, one even turn, then straight on to the other end
  let chain: Cubic[] = [];
  const asRamp = mode === "continuous" && ((slip.ta && ta === slip.ta && !tb) || (slip.tb && tb === slip.tb && !ta));
  if (asRamp) chain = rch;
  if (!chain.length) chain = makeChain(mode, start.p, end.p, ta, tb, ctrl, inp.ctrl2);
  const stroke: Stroke = { chain, h0: start.h, h1: end.h, type };
  const strokes = [stroke];
  const anchors: AnchorHint[] = [
    { p: start.p, node: start.node, seg: start.seg },
    { p: end.p, node: end.node, seg: end.seg },
  ];
  let par: { a: V2; b: V2 } | undefined;
  let trim: ParallelTrim | undefined;
  const extra: PlanError[] = [];
  if (inp.parallel && chain.length) {
    const ps = parallelStroke(net, stroke, inp.parallel.offset, start, end, inp.parallel.from);
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
    slips.push({ p: sn.p, segs: new Set(sn.seg !== undefined ? [sn.seg] : net.segsAt(sn.node!).map((s) => s.id)) });
  }
  const plan = validateStrokes(net, world, strokes, "road", anchors, undefined, par ? strokes.map((_, i) => anchors.slice(i * 2, i * 2 + 2)) : undefined, skip, slips);
  plan.errors.push(...extra);
  if (asRamp && !plan.errors.length) {
    const sn = slip.ta ? start : end;
    if (builtMinRadius(net, chain, sn, !!slip.ta, type) < ROAD_TYPES[type].minRadius * 0.98) plan.errors.push({ msg: "Too tight where it merges: draw the slip road longer", p: sn.p });
  }
  // a highway ramp comes with its slip lane: an extra lane of the carriageway it leaves out of (or merges into).
  // (however it was drawn: on its own, or carried on from the ramp's last piece, so long as it meets it in line)
  const exit = !!slip.ta;
  const inLine = chain.length > 0 && !slip.ta !== !slip.tb && !inp.parallel
    && dot(norm(cubicTangent(exit ? chain[0] : chain[chain.length - 1], exit ? 0 : 1)), exit ? slip.ta! : slip.tb!) > 0.995;
  if (inLine) {
    const far = exit ? chain[0].p3 : chain[chain.length - 1].p0;
    const lane = slipLane(net, exit ? start : end, exit, type, far, exit ? slip.ta! : slip.tb!);
    if (lane) {
      plan.widen = lane.widen;
      plan.ghosts = [lane.ghost];
      plan.cost += lane.cost;
      plan.note = lane.note;
      if (lane.cost > 0 && plan.cost > world.money() + 0.5 && !plan.errors.length) plan.errors.push({ msg: `Not enough money (${fmt(plan.cost)})`, p: start.p });
    }
  }
  if (par) plan.parallelEnds = par;
  if (trim) plan.trim = trim;
  if (chain.length) {
    const last = chain[chain.length - 1];
    plan.endTangent = norm(cubicTangent(last, 1));
    const t0 = norm(cubicTangent(chain[0], 0));
    const ref = ta ?? { x: 1, y: 0 };
    plan.angleDeg = Math.abs((signedAngle(ref, ta ? plan.endTangent : t0) * 180) / Math.PI);
  }
  return plan;
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
        errors.push({ msg: "The parallel road would start on top of this road: turn the other way, or start the pair afresh", p: q });
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
    if (!st.chain.length) { errors.push({ msg: "Too short", p: anchors[0]?.p ?? { x: 0, y: 0 } }); continue; }
    const T = ROAD_TYPES[st.type];
    const w = roadWidth(T);
    const pts = chainPoints(st.chain, 2);
    const pl = makePolyline(pts);
    const L = pl.length;
    total += L;
    const hs = pl.cum.map((c) => heightAt(st, c / (L || 1)));
    const mid = pts[Math.floor(pts.length / 2)];
    if (L < MIN_SEG_LEN) { errors.push({ msg: "Too short", p: mid }); continue; }
    // ramp grade
    const dh = Math.abs(st.h1 - st.h0);
    if (dh > 0.1 && dh / L > MAX_GRADE) {
      errors.push({ msg: `Ramp too short: needs ${Math.ceil(dh / MAX_GRADE)} m`, p: mid });
    }
    // curvature
    const r = minRadius(pts, 4);
    if (r < T.minRadius * 0.98) errors.push({ msg: `Curve too tight for ${T.name} (needs ${T.minRadius} m radius)`, p: mid });
    // terrain + tiles
    let water = false, mountain = false, locked = false, out = false;
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (!world.inBounds(p)) out = true;
      else if (!world.unlocked(p)) locked = true;
      if (world.isMountain(p)) mountain = true;
      if (hs[i] < LEVEL_H * 0.5 && world.isWater(p)) water = true;
    }
    if (out) errors.push({ msg: "Outside the map", p: mid });
    if (locked) errors.push({ msg: "Area not unlocked yet", p: mid });
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
    const hit = world.buildingsHit(pts, w / 2 - 0.2);
    if (hit.length) errors.push({ msg: hit.length === 1 ? "Building in the way" : `${hit.length} buildings in the way`, p: mid, buildings: hit });
    // crossings -> junctions
    const cx = findCrossings(net, pts, pl.cum, hs, ignore, skip);
    for (const b of cx.bad) errors.push({ msg: b.msg, p: b.p });
    let prevS = -Infinity;
    for (const c of cx.crossings) {
      crossings.push(c.p);
      if (c.angle < MIN_ARM_ANGLE) errors.push({ msg: `Crossing too shallow (${Math.round((c.angle * 180) / Math.PI)}°)`, p: c.p });
      if (c.sPlan - prevS < 14) errors.push({ msg: "Junctions too close together", p: c.p });
      prevS = c.sPlan;
      const s = net.segs.get(c.seg)!;
      for (const n of [s.a, s.b]) {
        if (isRingFiller(net, n)) continue; // moved to the new junction when built
        const d = dist(net.nodes.get(n)!.p, c.p);
        if (d >= 3 && d < 12) errors.push({ msg: "Too close to a junction", p: c.p });
      }
    }
    if (cx.crossings.length && L - cx.crossings[cx.crossings.length - 1].sPlan < 10 && own[1] && own[1].node === undefined && own[1].seg === undefined) {
      errors.push({ msg: "Too close to a junction", p: pts[pts.length - 1] });
    }
    // overlaps: running along an existing road at the same level
    const glued = (id: number, p: V2) => slips.some((sl) => sl.segs.has(id) && dist(sl.p, p) < 160);
    const ov = overlapCheck(net, pts, hs, w, cx.crossings.map((c) => c.p), anchors.map((a) => a.p), ignore, (id, p) => !!skip?.(id, p) || glued(id, p));
    if (ov) errors.push({ msg: "Overlaps an existing road", p: ov });
    // arm angles at anchors
    for (const [ai, a] of own.entries()) {
      const dirOut = ai === 0 ? norm(cubicTangent(st.chain[0], 0)) : scale(norm(cubicTangent(st.chain[st.chain.length - 1], 1)), -1);
      const arms: V2[] = [];
      const oneWayNew = T.bwd === 0;
      let oneWayAll = oneWayNew;
      if (a.node !== undefined) {
        for (const s of net.segsAt(a.node)) {
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
          errors.push({ msg: `Angle too sharp (${Math.round((ang * 180) / Math.PI)}°, min ${Math.round((minA * 180) / Math.PI)}°)`, p: a.p });
          break;
        }
      }
      if (a.node !== undefined && net.segsAt(a.node).length >= 6) errors.push({ msg: "Too many roads at this junction", p: a.p });
    }
    cost += costOfPoints(pts, hs, st.type, world);
  }
  if (kind === "roundabout") cost += ROUNDABOUT_COST;
  if (cost > world.money() + 0.5) errors.push({ msg: `Not enough money (${fmt(cost)})`, p: anchors[anchors.length - 1]?.p ?? { x: 0, y: 0 } });
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
    if (!s) continue;
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
    const hs = pl.cum.map((c) => heightAt(st, c / (L || 1)));
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
      brks.push({ s: acc, p: st.chain[i].p3, h: heightAt(st, acc / L) });
    }
    for (const c of crossings) {
      if (c.sPlan < 2 || c.sPlan > L - 2) continue;
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
    for (let i = 0; i < cubics.length; i++) {
      const a = merged[i].node!, b = merged[i + 1].node!;
      if (a === b) continue;
      const c = cubics[i];
      // snap the cubic's ends onto the actual node positions
      const na = net.nodes.get(a)!.p, nb = net.nodes.get(b)!.p;
      const fixed: Cubic = { p0: na, p1: add(c.p1, sub(na, c.p0)), p2: add(c.p2, sub(nb, c.p3)), p3: nb };
      created.push(net.addSeg(a, b, st.type, fixed, st.ring ?? 0));
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
    for (let j = 0; j < cp.length; j++) {
      const dj = dist(cp[j], c);
      if (dj < R) inside = true;
      if (j === cp.length - 1) break;
      const d0 = dist(cp[j], c) - R, d1 = dist(cp[j + 1], c) - R;
      if ((d0 < 0) !== (d1 < 0)) {
        const t = d0 / (d0 - d1);
        const p = lerpV(cp[j], cp[j + 1], t);
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
    }
  }
  hits.sort((a, b) => a.ang - b.ang);
  for (let i = 0; i < hits.length; i++) {
    const a = hits[i], b = hits[(i + 1) % hits.length];
    let gap = b.ang - a.ang;
    if (i === hits.length - 1) gap += Math.PI * 2;
    if (hits.length > 1 && gap * R < 11) errors.push({ msg: "Roads meet the ring too close together", p: a.p });
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
  // cut roads at the circle and drop what's inside
  for (const id of plan.removeSegs ?? []) {
    const s = net.segs.get(id);
    if (!s) continue;
    const pts = sampleCubic(s.c, 0.5);
    // find parameter ranges outside the circle: walk the cubic and keep outside runs
    const N = 400;
    const outside: [number, number][] = [];
    let runStart: number | null = null;
    for (let i = 0; i <= N; i++) {
      const t = i / N;
      const o = dist(cubicAt(s.c, t), c) >= R;
      if (o && runStart === null) runStart = t;
      if ((!o || i === N) && runStart !== null) {
        const end = o ? 1 : (i - 1) / N;
        if (end - runStart > 0.01) outside.push([runStart, end]);
        runStart = null;
      }
    }
    void pts;
    const na = net.nodes.get(s.a)!, nb = net.nodes.get(s.b)!;
    const type = s.type, ring = s.ring;
    net.removeSeg(id, true);
    for (const [t0, t1] of outside) {
      const sub1 = subCubic(s.c, t0, t1);
      const pa = t0 < 1e-6 ? s.a : null;
      const pb = t1 > 1 - 1e-6 ? s.b : null;
      const ha = net.heightOnSegRaw(na.h, nb.h, t0), hb = net.heightOnSegRaw(na.h, nb.h, t1);
      const a = pa !== null && net.nodes.has(pa) ? pa : net.addNode(sub1.p0, ha);
      const b = pb !== null && net.nodes.has(pb) ? pb : net.addNode(sub1.p3, hb);
      if (!net.nodes.has(a)) continue;
      net.addSeg(a, b, type, sub1, ring);
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
  if (g.minR < T.minRadius * 0.98) errors.push({ msg: `Curve too tight for ${T.name}`, p: mid });
  const w = roadWidth(T);
  if (w > g.width + 0.1) {
    const hit = world.buildingsHit(pts, w / 2 - 0.2);
    if (hit.length) errors.push({ msg: hit.length === 1 ? "Building in the way" : `${hit.length} buildings in the way`, p: mid, buildings: hit });
  }
  if (cost > world.money() + 0.5) errors.push({ msg: "Not enough money", p: mid });
  return { cost, errors };
}

export function removalRefund(net: RoadNetwork, world: BuildWorld, segs: Iterable<number>): number {
  let r = 0;
  for (const id of segs) r += segCost(net, id, world) * BULLDOZE_REFUND;
  return r;
}

/** Segments whose centreline passes through the rectangle (axis aligned). */
export function segsInRect(net: RoadNetwork, a: V2, b: V2, level: number | null): number[] {
  const x0 = Math.min(a.x, b.x), x1 = Math.max(a.x, b.x), y0 = Math.min(a.y, b.y), y1 = Math.max(a.y, b.y);
  const out: number[] = [];
  for (const id of net.segsNear(x0, y0, x1, y1)) {
    const g = net.segGeom.get(id)!;
    const hit = g.center.pts.some((p, i) => p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1 && (level === null || Math.abs(g.hs[i] - level * LEVEL_H) < 1));
    if (hit) out.push(id);
  }
  return out;
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
