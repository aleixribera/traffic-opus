import {
  CLEARANCE, ELEVATED_COST_MULT, LEVEL_H, MAX_GRADE, MIN_ARM_ANGLE, MIN_SEG_LEN, NODE_SNAP_PX, ROAD_SNAP_PX,
  ROAD_TYPES, ROUNDABOUT_COST, WATER_BRIDGE_MULT, BULLDOZE_REFUND, roadWidth, type RoadTypeId,
} from "../config";
import {
  type Cubic, type V2, add, angleOf, arcCubics, clamp, cubicAt, cubicTangent, dist, dot, fromAngle, hermiteCubic,
  lerpV, makePolyline, minRadius, norm, quadCubic, right, sampleCubic, scale, segIntersect, signedAngle, smoothstep,
  splitCubic, straightCubic, sub, tangentArc, pointSegDist2, len, cross,
} from "../core/math";
import type { RoadNetwork, RSeg } from "./network";

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
  from?: { p: V2; tangent?: V2 }; // the point we are drawing from
  angleStep?: boolean; // shift held: 15 degree steps
  grid?: number; // grid size in metres (0 = off)
  type: RoadTypeId;
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
  const rs = ringSnap(net, raw, o);
  if (rs) return rs;
  // 1) nodes
  const nr = NODE_SNAP_PX * o.mpp;
  let bestN: { id: number; d: number } | null = null;
  for (const n of net.nodesNear(raw, nr + 12)) {
    const d = dist(n.p, raw);
    const tol = nr + (net.segsAt(n.id).length === 1 ? 4 : 2);
    if (d < tol && (!bestN || d < bestN.d)) bestN = { id: n.id, d };
  }
  if (bestN) {
    const n = net.nodes.get(bestN.id)!;
    return { p: { ...n.p }, h: n.h, node: n.id, tangent: deadEndTangent(net, n.id), guides };
  }
  // 2) roads (centreline), only at a matching height
  const rr = ROAD_SNAP_PX * o.mpp;
  let bestS: { seg: RSeg; t: number; p: V2; d: number } | null = null;
  for (const id of net.segsNear(raw.x - 40, raw.y - 40, raw.x + 40, raw.y + 40)) {
    const s = net.segs.get(id)!;
    const g = net.segGeom.get(id);
    if (!g) continue;
    const r = cubicClosest(s.c, raw);
    const hw = g.width / 2;
    if (r.d < hw + rr && (!bestS || r.d < bestS.d)) bestS = { seg: s, t: r.t, p: r.p, d: r.d };
  }
  if (bestS) {
    const hs = net.heightOnSeg(bestS.seg.id, bestS.t);
    // don't snap onto a road at a different level unless we are free (then take its level)
    if (Math.abs(hs - h) < 0.5 || !o.from) {
      return { p: bestS.p, h: hs, seg: bestS.seg.id, t: bestS.t, guides };
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
      } else {
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
    // parallel to a nearby road at a clean offset
    const par = parallelSnap(net, p, o);
    if (par) { p = par.p; label = "Parallel"; guides.push(...par.guides); }
  }
  // alignment with nearby node coordinates
  const at = 6 * o.mpp;
  let ax: number | null = null, ay: number | null = null;
  for (const n of net.nodesNear(p, 400)) {
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

export type CurveMode = "straight" | "arc" | "smooth";

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

/**
 * Turn the user's input into a stroke.
 * straight: line; arc: circular arc tangent to the start direction (or 3-click quadratic);
 * smooth: S-curve that matches both the start and end direction.
 */
export function makeChain(mode: CurveMode, a: V2, b: V2, ta?: V2, tb?: V2, ctrl?: V2): Cubic[] {
  if (dist(a, b) < 0.5) return [];
  if (mode === "straight") return [straightCubic(a, b)];
  if (mode === "arc") {
    if (ctrl) return [quadCubic(a, ctrl, b)];
    if (ta) {
      const arc = tangentArc(a, ta, b);
      if (arc.length) return arc;
    }
    return [straightCubic(a, b)];
  }
  // smooth
  const t0 = ta ?? norm(sub(b, a));
  const t1 = tb ?? t0;
  const d = dist(a, b);
  const c = hermiteCubic(a, t0, b, t1, 0.42);
  // keep the handles sane when the end tangent points back at the start
  if (dot(t0, t1) < -0.2) return [quadCubic(a, add(a, scale(t0, d * 0.6)), b)];
  return [c];
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
function findCrossings(net: RoadNetwork, pts: V2[], cum: number[], hsPlan: number[], ignore: { segs: Set<number>; nodes: Set<number> }) {
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
}

/** Build and validate a single road stroke. */
export function planRoad(net: RoadNetwork, world: BuildWorld, inp: PlanInput): Plan {
  const { start, end, type } = inp;
  const ta = inp.startTangent ?? start.tangent;
  let tb: V2 | undefined;
  if (inp.mode === "smooth") {
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
  const chain = makeChain(inp.mode, start.p, end.p, ta, tb, inp.ctrl);
  const stroke: Stroke = { chain, h0: start.h, h1: end.h, type };
  const plan = validateStrokes(net, world, [stroke], "road", [
    { p: start.p, node: start.node, seg: start.seg },
    { p: end.p, node: end.node, seg: end.seg },
  ]);
  if (chain.length) {
    const last = chain[chain.length - 1];
    plan.endTangent = norm(cubicTangent(last, 1));
    const t0 = norm(cubicTangent(chain[0], 0));
    const ref = ta ?? { x: 1, y: 0 };
    plan.angleDeg = Math.abs((signedAngle(ref, ta ? plan.endTangent : t0) * 180) / Math.PI);
  }
  return plan;
}

interface AnchorHint { p: V2; node?: number; seg?: number }

/** Validate strokes against the current network and world. */
export function validateStrokes(net: RoadNetwork, world: BuildWorld, strokes: Stroke[], kind: Plan["kind"], anchors: AnchorHint[] = [], exempt?: { segs: Set<number>; nodes: Set<number> }): Plan {
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
  for (const st of strokes) {
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
    if (water) errors.push({ msg: "Needs a bridge here: raise it with R", p: mid });
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
    const cx = findCrossings(net, pts, pl.cum, hs, ignore);
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
    if (cx.crossings.length && L - cx.crossings[cx.crossings.length - 1].sPlan < 10 && anchors[1] && anchors[1].node === undefined && anchors[1].seg === undefined) {
      errors.push({ msg: "Too close to a junction", p: pts[pts.length - 1] });
    }
    // overlaps: running along an existing road at the same level
    const ov = overlapCheck(net, pts, hs, w, cx.crossings.map((c) => c.p), anchors.map((a) => a.p), ignore);
    if (ov) errors.push({ msg: "Overlaps an existing road", p: ov });
    // arm angles at anchors
    for (const [ai, a] of anchors.entries()) {
      if (strokes.length !== 1) break;
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

function overlapCheck(net: RoadNetwork, pts: V2[], hs: number[], w: number, crossPts: V2[], anchors: V2[], ignore: { segs: Set<number> }): V2 | null {
  for (let i = 0; i < pts.length; i += 2) {
    const p = pts[i];
    for (const id of net.segsNear(p.x - 30, p.y - 30, p.x + 30, p.y + 30)) {
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
  const near = (n: number) => isRingFiller(net, n) && dist(net.nodes.get(n)!.p, p) < 12;
  const prevSeg = (n: number) => net.segsAt(n).find((x) => x.b === n && x.ring === seg.ring);
  const nextSeg = (n: number) => net.segsAt(n).find((x) => x.a === n && x.ring === seg.ring);
  // widen [X..Y] along the ring past every filler node crowding the new junction
  const drop = new Set<number>([seg.id]);
  let X = seg.a, Y = seg.b;
  for (let k = 0; k < 8 && near(X); k++) { const s = prevSeg(X); if (!s) return null; drop.add(s.id); X = s.a; }
  for (let k = 0; k < 8 && near(Y); k++) { const s = nextSeg(Y); if (!s) return null; drop.add(s.id); Y = s.b; }
  if (drop.size === 1 || X === Y) return null;
  const ang = (q: V2) => Math.atan2(q.y - R.c.y, q.x - R.c.x);
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const pa = net.nodes.get(seg.a)!.p, pb = net.nodes.get(seg.b)!.p;
  const dirSign = Math.sign(wrap(ang(pb) - ang(pa))) || 1;
  const sweepTo = (a0: number, a1: number) => { let sw = wrap(a1 - a0); if (Math.sign(sw) !== dirSign || sw === 0) sw += dirSign * Math.PI * 2; return sw; };
  const aN = ang(p);
  if (Math.abs(sweepTo(ang(net.nodes.get(X)!.p), aN)) >= Math.abs(sweepTo(ang(net.nodes.get(X)!.p), ang(net.nodes.get(Y)!.p)))) return null;
  const { type, ring } = seg;
  const h = net.nodes.get(seg.a)!.h;
  const orphans = new Set<number>();
  for (const id of drop) { const s = net.segs.get(id)!; orphans.add(s.a); orphans.add(s.b); net.removeSeg(id, false); }
  for (const n of orphans) if (n !== X && n !== Y && net.segsAt(n).length === 0) net.removeNode(n);
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
  arc(X, N);
  arc(N, Y);
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

export const ROUNDABOUT_R = { 1: 15, 2: 21 } as const;

/** Plan a roundabout centred at c. Roads crossing its circle get connected; their inside parts are removed. */
export function planRoundabout(net: RoadNetwork, world: BuildWorld, c: V2, lanes: 1 | 2, level: number): Plan {
  const R = ROUNDABOUT_R[lanes];
  const h = level * LEVEL_H;
  const type: RoadTypeId = lanes === 1 ? "one1" : "one2";
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
    return { strokes, cost: 0, length: 0, errors: [{ msg: "Drag a bigger area", p: b }], crossings: [], kind: "grid" };
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
    if (hit.length) errors.push({ msg: "Building in the way", p: mid, buildings: hit });
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
