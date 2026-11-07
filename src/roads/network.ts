import { LANE_W, ROAD_TYPES, SHOULDER, SIM, roadWidth, type RoadTypeId } from "../config";
import {
  type Cubic, type Polyline, type V2,
  add, angleOf, clamp, cubicTangent, dist, dot, lineIntersect, makePolyline, minRadius, norm, offsetPolyline,
  polyAt, polyClosest, polyDir, right, sampleCubic, scale, segIntersect, signedAngle, smoothstep, splitCubic, sub, trimPolyline, hermiteCubic,
  cubicAt,
} from "../core/math";

// ---------------------------------------------------------------------------------------------
// Persistent data (what gets saved and undone)
// ---------------------------------------------------------------------------------------------

export interface SignalPhase {
  arms: number[]; // seg ids whose approach is green in this phase
  dur: number; // green seconds
}

export interface SignalPlan {
  phases: SignalPhase[];
}

export interface RNode {
  id: number;
  p: V2;
  h: number; // metres above ground
  signal: SignalPlan | null;
}

export interface RSeg {
  id: number;
  a: number;
  b: number;
  type: RoadTypeId;
  c: Cubic; // p0 at node a, p3 at node b
  ring: number; // roundabout id (0 = none); ring roads have priority at their junctions
  /** turn pockets: extra lanes for the traffic arriving at that end, opening out of the road before the junction */
  pk?: { a?: Pocket; b?: Pocket };
}

/**
 * A turn pocket's lengths (metres of full-width lane before the stop line; 0 = none): `r` an extra lane on the
 * right of the traffic arriving (it takes the right turns), `l` one on its left (the left turns and U-turns; the
 * through lanes swing over to the right to make room, as on a real road).
 */
export interface Pocket { r: number; l: number }

/** How long a pocket's taper is on a road of this type (where its lane opens out of the road). */
export function pocketTaper(type: RoadTypeId): number {
  return clamp(ROAD_TYPES[type].speed * 1.2, 12, 24);
}

// ---------------------------------------------------------------------------------------------
// Derived data (rebuilt for touched parts only)
// ---------------------------------------------------------------------------------------------

/** Anything a vehicle can drive along: a lane on a road, or a connector through a junction. */
export interface Edge {
  kind: "lane" | "conn";
  uid: number; // unique per object instance
  pl: Polyline;
  hs: Float32Array; // height at each polyline point
  speed: number;
  occ: unknown[]; // vehicles on this edge sorted by s ascending (owned by the sim)
}

export interface Lane extends Edge {
  kind: "lane";
  key: string; // `${seg}:${dir}:${idx}` stable across rebuilds
  seg: number;
  dir: 1 | -1; // 1 = a->b
  idx: number; // 0 = kerb-side (rightmost) lane; a turn pocket's is -1 (right of the kerb lane) or count (left of the inner one)
  count: number; // lanes in this direction (turn pockets not counted)
  /** a turn pocket's lane: only so long, before the junction */
  pocket?: "r" | "l";
  /** the stretch of the road's centreline (arc length from a) it runs beside */
  c0: number;
  c1: number;
  from: number; // node id at start
  to: number; // node id at end
  offset: number; // lateral offset from centreline (relative to a->b right)
  outs: Connector[];
  ins: Connector[];
}

export interface Conflict {
  c: Connector;
  sSelf: number;
  sOther: number;
  merge: boolean;
  /** Merges: where each path comes within a car's width of the other (from there on they're one lane). */
  jSelf?: number;
  jOther?: number;
}

export interface Connector extends Edge {
  kind: "conn";
  node: number;
  from: Lane;
  to: Lane;
  turn: "L" | "S" | "R" | "U";
  conflicts: Conflict[];
  armIn: number; // seg id of approach
  prio: number; // priority rank of the approach
  holders: unknown[]; // vehicles that reserved this connector (owned by the sim)
  /** at a split: true = never yields (the carriageway's own traffic at a weave); false = yields even going straight on */
  free?: boolean;
}

export interface Arm {
  seg: number;
  end: "a" | "b";
  dir: V2; // leaving the node
  angle: number;
  halfW: number;
  trim: number;
  /** extra width on the arm's left (seen from the junction): the turn pockets of the traffic arriving on it */
  wL?: number;
}

/**
 * end = dead end; cont = straight run-on; bend = the same road carrying on round a corner; junction = real crossing;
 * split = a one-way carriageway dividing in two or two joining (motorway exits and slip roads), drawn as lanes that
 * run on with the side road glued alongside before it peels off; lane = a one-way road gaining or losing lanes.
 */
export type JunctionKind = "end" | "cont" | "bend" | "junction" | "split" | "lane";

/** How a one-way road's end is shaped where it meets a split or a lane change (derived from the network, not saved). */
export interface EndShape {
  /** centreline moved sideways at this end (+ = right of travel), easing back over the road's first stretch */
  shift: number;
  /** run beside road `seg` at `d` metres from its centreline (+ = its right) before peeling off on our own line.
   *  line: that road's centreline and the carriageway it runs on as (set when shaped); full: this road runs beside it
   *  all the way to its other end (a slip lane), rather than peeling off */
  glue: { seg: number; d: number; line?: Polyline; full?: boolean } | null;
  /** surface pulled in from one edge at the node, widening to full over clipLen (a taper) */
  clip: number;
  clipSide: 1 | -1;
  clipLen: number;
  /** per lane idx: how far from the node the lane starts (or ends); a connector carries cars across the taper */
  laneTrim: number[];
  /** turn pockets for the traffic arriving at this end (at a junction only), lengths as built */
  pocket?: Pocket;
}

export const NO_SHAPE: EndShape = { shift: 0, glue: null, clip: 0, clipSide: 1, clipLen: 0, laneTrim: [] };

/**
 * Carry a road's centreline (`pts`, arc lengths `cum`, length L) out beside `main` near its `end`, `d` metres from
 * main's centreline (+ = main's right). An offset that eases away along the road (so a ramp drawn peeling off keeps
 * its own smooth curve, only wider), and never closer than beside it (so one drawn running along it stays glued
 * there): a smooth max, exactly x above k and 0 below -k, with k growing from 0 at the node. `otherShaped`: the far
 * end is shaped too, so this end keeps to its own part of the road.
 */
export function glueRun(pts: V2[], cum: number[], L: number, end: "a" | "b", main: Polyline, d: number, otherShaped: boolean): V2[] {
  const D = Math.abs(d), sg = Math.sign(d) || 1;
  const win = Math.min(L * (otherShaped ? 0.6 : 0.85), 260), fade = Math.min(25, win * 0.4);
  const ease = Math.min(win * 0.8, 90);
  const f = (x: number, k: number) => (x >= k ? x : x <= -k ? 0 : (x + k) ** 2 / (4 * k));
  const out = pts.slice();
  for (let i = 0; i < pts.length; i++) {
    const sd = end === "a" ? cum[i] : L - cum[i];
    if (sd > win) continue;
    const w = 1 - smoothstep(clamp((sd - (win - fade)) / fade, 0, 1));
    const p = pts[i];
    const c = polyClosest(main, p);
    const foot = polyAt(main, c.s), nrm = right(polyDir(main, c.s));
    const lat = dot(sub(p, foot), nrm) * sg;
    const push = D * (1 - smoothstep(clamp(sd / ease, 0, 1)));
    const want = D + f(lat + push - D, Math.max(0.01, 3 * Math.min(1, sd / ease)));
    out[i] = add(p, scale(nrm, sg * (want - lat) * w));
  }
  return out;
}

/** How far a ramp of type `ramp` runs from the centreline of the carriageway `main` it is glued beside. */
export const glueGap = (main: RoadTypeId, ramp: RoadTypeId): number => (roadWidth(ROAD_TYPES[main]) + roadWidth(ROAD_TYPES[ramp])) / 2 - 0.42;

/** A value given per point of `line`, at arc length `sc` along it. */
function atLen(line: Polyline, vs: ArrayLike<number>, sc: number): number {
  const cum = line.cum, n = cum.length;
  if (n === 0) return 0;
  if (sc <= 0 || n === 1) return vs[0];
  if (sc >= cum[n - 1]) return vs[n - 1];
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (cum[m] <= sc) lo = m; else hi = m; }
  const f = (sc - cum[lo]) / ((cum[hi] - cum[lo]) || 1);
  return vs[lo] + (vs[hi] - vs[lo]) * f;
}

/** Lateral offset of `p` from `line` (+ = its right), and whether its foot falls inside the line rather than past an end. */
function lateral(line: Polyline, p: V2): { lat: number; s: number; inside: boolean } {
  const c = polyClosest(line, p);
  const lat = dot(sub(p, polyAt(line, c.s)), right(polyDir(line, c.s)));
  return { lat, s: c.s, inside: c.s > 0.5 && c.s < line.length - 0.5 };
}

/** A road whose far end already sits beside `line` at `d` (a slip lane drawn along the carriageway, not peeling off it). */
function besideAll(pts: V2[], line: Polyline, d: number, end: "a" | "b"): boolean {
  if (pts.length < 2) return false;
  const far = lateral(line, end === "a" ? pts[pts.length - 1] : pts[0]);
  return far.inside && Math.abs(far.lat - d) < 1.2;
}

/**
 * A slip lane: the whole road runs beside `line` at exactly `d` (+ = its right), the way the carriageway runs. Only at
 * the far end does it ease onto its own node, which the planner put there anyway.
 */
export function glueAll(pts: V2[], cum: number[], L: number, end: "a" | "b", line: Polyline, d: number): V2[] {
  const farLat = lateral(line, end === "a" ? pts[pts.length - 1] : pts[0]).lat;
  return pts.map((p, i) => {
    const sd = end === "a" ? cum[i] : L - cum[i];
    const c = polyClosest(line, p);
    const foot = polyAt(line, c.s), nrm = right(polyDir(line, c.s));
    const k = smoothstep(clamp((sd - (L - 20)) / 20, 0, 1));
    return add(foot, scale(nrm, d + (farLat - d) * k));
  });
}

/** Who is who at a split or lane change (see JunctionKind). */
export interface SplitRoles {
  trunk: Arm; // the single carriageway on one side
  main: Arm; // carries straight on from it
  ramp: Arm | null; // the slip road (none at a lane change)
  diverge: boolean; // trunk comes in (and splits); false = branches come in and join
  side: 1 | -1; // ramp / extra lanes on this side of travel
  /** a weave: an entry's slip lane running straight on into the next exit's (trunk in, main out, rampIn in, ramp out) */
  rampIn?: Arm;
}

/** How far a shifted centreline takes to ease back onto its own line. */
const SHIFT_LEN = 90;

export interface NodeGeom {
  kind: JunctionKind;
  arms: Arm[];
  poly: V2[] | null; // junction surface
  kerbs: V2[][]; // kerb lines (fillets) for outlines
  conns: Connector[];
  radius: number;
  /** bend only: centre line of the curved piece joining the two trimmed ends, drawn as ordinary road */
  curve?: { pts: V2[]; hs: number[]; lanes: [number, number]; halfW: number; median: number };
}

export interface SegGeom {
  center: Polyline; // full a->b centreline
  hs: Float32Array; // height per centre point
  trimA: number;
  trimB: number;
  width: number;
  lanes: Lane[];
  minR: number;
  bbox: { x0: number; y0: number; x1: number; y1: number };
  ends: { a: EndShape; b: EndShape };
}

// ---------------------------------------------------------------------------------------------
// Edit log (undo/redo)
// ---------------------------------------------------------------------------------------------

export type Op =
  | { t: "addNode"; node: RNode }
  | { t: "delNode"; node: RNode }
  | { t: "addSeg"; seg: RSeg }
  | { t: "delSeg"; seg: RSeg }
  | { t: "setType"; id: number; from: RoadTypeId; to: RoadTypeId }
  | { t: "flip"; id: number }
  | { t: "setSignal"; id: number; from: SignalPlan | null; to: SignalPlan | null }
  | { t: "setPocket"; id: number; end: "a" | "b"; from: Pocket | null; to: Pocket | null };

/** Splits recorded during a transaction, so vehicles can be carried over to the new pieces. */
export interface SplitInfo {
  old: number;
  parts: { seg: number; from: number; to: number }[]; // centreline arc-length range of the old seg
}

export interface ChangeSet {
  dirtySegs: Set<number>;
  dirtyNodes: Set<number>; // nodes whose junction geometry / connectors were rebuilt
  removedSegs: Set<number>;
  removedNodes: Set<number>;
  splits: SplitInfo[];
  oldLanes: Map<string, Lane>;
  oldConns: Map<number, Connector[]>;
}

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

let edgeUid = 1;

export class RoadNetwork {
  nodes = new Map<number, RNode>();
  segs = new Map<number, RSeg>();
  nextId = 1;
  version = 0;

  segGeom = new Map<number, SegGeom>();
  nodeGeom = new Map<number, NodeGeom>();
  lanes = new Map<string, Lane>();

  // spatial hash over segment bboxes
  private cell = 64;
  private grid = new Map<number, Set<number>>();
  private segCells = new Map<number, number[]>();

  // pending changes since the last rebuild
  private dirtyNodes = new Set<number>();
  private removedSegs = new Set<number>();
  private removedNodes = new Set<number>();
  private splits: SplitInfo[] = [];
  private tx: Op[] | null = null;

  // ---------------- transactions ----------------

  begin() {
    this.tx = [];
  }

  /** Ends the transaction and returns its ops (for the undo stack). */
  commit(): Op[] {
    const ops = this.tx ?? [];
    this.tx = null;
    return ops;
  }

  private log(op: Op) {
    this.tx?.push(op);
  }

  /** Apply the inverse of a recorded transaction. */
  undo(ops: Op[]) {
    for (let i = ops.length - 1; i >= 0; i--) this.applyOp(invert(ops[i]));
  }

  redo(ops: Op[]) {
    for (const op of ops) this.applyOp(op);
  }

  private applyOp(op: Op) {
    switch (op.t) {
      case "addNode": this.insertNode(clone(op.node)); break;
      case "delNode": this.eraseNode(op.node.id); break;
      case "addSeg": this.insertSeg(clone(op.seg)); break;
      case "delSeg": this.eraseSeg(op.seg.id); break;
      case "setType": this.segs.get(op.id)!.type = op.to; this.touchSeg(op.id); break;
      case "flip": this.flipRaw(op.id); break;
      case "setSignal": this.nodes.get(op.id)!.signal = op.to ? clone(op.to) : null; this.dirtyNodes.add(op.id); break;
      case "setPocket": this.pocketRaw(op.id, op.end, op.to); break;
    }
  }

  private pocketRaw(id: number, end: "a" | "b", p: Pocket | null) {
    const s = this.segs.get(id);
    if (!s) return;
    const pk = { ...(s.pk ?? {}) };
    if (p && (p.r > 0 || p.l > 0)) pk[end] = { r: Math.max(0, p.r), l: Math.max(0, p.l) };
    else delete pk[end];
    if (pk.a || pk.b) s.pk = pk;
    else delete s.pk;
    this.touchSeg(id);
  }

  // ---------------- raw mutations ----------------

  private insertNode(n: RNode) {
    this.nodes.set(n.id, n);
    this.nextId = Math.max(this.nextId, n.id + 1);
    this.dirtyNodes.add(n.id);
    this.removedNodes.delete(n.id);
  }

  private eraseNode(id: number) {
    this.nodes.delete(id);
    this.dirtyNodes.delete(id);
    this.removedNodes.add(id);
  }

  private insertSeg(s: RSeg) {
    this.segs.set(s.id, s);
    this.nextId = Math.max(this.nextId, s.id + 1);
    this.dirtyNodes.add(s.a);
    this.dirtyNodes.add(s.b);
    this.removedSegs.delete(s.id);
  }

  private eraseSeg(id: number) {
    const s = this.segs.get(id);
    if (!s) return;
    this.segs.delete(id);
    if (this.nodes.has(s.a)) this.dirtyNodes.add(s.a);
    if (this.nodes.has(s.b)) this.dirtyNodes.add(s.b);
    this.removedSegs.add(id);
  }

  private touchSeg(id: number) {
    const s = this.segs.get(id);
    if (!s) return;
    this.dirtyNodes.add(s.a);
    this.dirtyNodes.add(s.b);
  }

  private flipRaw(id: number) {
    const s = this.segs.get(id)!;
    const a = s.a;
    s.a = s.b;
    s.b = a;
    s.c = { p0: s.c.p3, p1: s.c.p2, p2: s.c.p1, p3: s.c.p0 };
    // the traffic now arrives at the other ends: pockets go with the junctions they sit before
    if (s.pk) s.pk = { a: s.pk.b, b: s.pk.a };
    // signal plans reference seg ids, unaffected
    this.removedSegs.add(id); // lanes change direction: treat as replaced
    this.touchSeg(id);
  }

  // ---------------- public edits (logged) ----------------

  addNode(p: V2, h: number): number {
    const node: RNode = { id: this.nextId++, p: { x: p.x, y: p.y }, h, signal: null };
    this.insertNode(node);
    this.log({ t: "addNode", node: clone(node) });
    return node.id;
  }

  addSeg(a: number, b: number, type: RoadTypeId, c: Cubic, ring = 0): number {
    const na = this.nodes.get(a)!, nb = this.nodes.get(b)!;
    const seg: RSeg = {
      id: this.nextId++, a, b, type, ring,
      c: { p0: { ...na.p }, p1: { ...c.p1 }, p2: { ...c.p2 }, p3: { ...nb.p } },
    };
    this.insertSeg(seg);
    this.log({ t: "addSeg", seg: clone(seg) });
    return seg.id;
  }

  removeSeg(id: number, pruneNodes = true) {
    const s = this.segs.get(id);
    if (!s) return;
    this.log({ t: "delSeg", seg: clone(s) });
    this.eraseSeg(id);
    if (pruneNodes) {
      for (const nid of [s.a, s.b]) {
        if (this.nodes.has(nid) && this.segsAt(nid).length === 0) this.removeNode(nid);
      }
    }
  }

  removeNode(id: number) {
    const n = this.nodes.get(id);
    if (!n) return;
    for (const s of this.segsAt(id)) this.removeSeg(s.id, false);
    this.log({ t: "delNode", node: clone(n) });
    this.eraseNode(id);
  }

  setType(id: number, type: RoadTypeId) {
    const s = this.segs.get(id)!;
    if (s.type === type) return;
    this.log({ t: "setType", id, from: s.type, to: type });
    s.type = type;
    this.touchSeg(id);
  }

  flip(id: number) {
    this.log({ t: "flip", id });
    this.flipRaw(id);
  }

  /** Turn pockets before the junction at `end` of road `id` (null or zero lengths: none). */
  setPocket(id: number, end: "a" | "b", p: Pocket | null) {
    const s = this.segs.get(id);
    if (!s) return;
    const from = s.pk?.[end] ?? null;
    const to = p && (p.r > 0 || p.l > 0) ? { r: Math.max(0, p.r), l: Math.max(0, p.l) } : null;
    if (JSON.stringify(from) === JSON.stringify(to)) return;
    this.log({ t: "setPocket", id, end, from: from && clone(from), to: to && clone(to) });
    this.pocketRaw(id, end, to);
  }

  setSignal(id: number, plan: SignalPlan | null) {
    const n = this.nodes.get(id)!;
    this.log({ t: "setSignal", id, from: n.signal ? clone(n.signal) : null, to: plan ? clone(plan) : null });
    n.signal = plan ? clone(plan) : null;
    this.dirtyNodes.add(id);
  }

  /** Split segment at curve parameter t. Returns the new node id. */
  splitSeg(id: number, t: number): number {
    const s = this.segs.get(id)!;
    const g = this.segGeom.get(id);
    const [c1, c2] = splitCubic(s.c, t);
    const h = this.heightOnSeg(id, t);
    const nid = this.addNode(c1.p3, h);
    const total = g ? g.center.length : dist(s.c.p0, s.c.p3);
    this.removeSeg(id, false);
    const s1 = this.addSeg(s.a, nid, s.type, c1, s.ring);
    const s2 = this.addSeg(nid, s.b, s.type, c2, s.ring);
    // turn pockets stay before their junctions
    if (s.pk?.a) this.setPocket(s1, "a", s.pk.a);
    if (s.pk?.b) this.setPocket(s2, "b", s.pk.b);
    const cut = total * this.arcFraction(id, t, g);
    this.splits.push({ old: id, parts: [{ seg: s1, from: 0, to: cut }, { seg: s2, from: cut, to: total }] });
    // carry signal arms over: a signal at either end referencing the old seg now references the new piece
    for (const [end, piece] of [[s.a, s1], [s.b, s2]] as const) {
      const n = this.nodes.get(end)!;
      if (n.signal && n.signal.phases.some((p) => p.arms.includes(id))) {
        const plan = clone(n.signal);
        for (const ph of plan.phases) ph.arms = ph.arms.map((a) => (a === id ? piece : a));
        this.setSignal(end, plan);
      }
    }
    return nid;
  }

  private arcFraction(_id: number, t: number, g?: SegGeom): number {
    if (!g) return t;
    // cubic is sampled evenly by arc length, so find t via the sampled points' nearest parameter
    // (approximation good to well under a metre)
    const s = this.segs.get(_id);
    if (!s) return t;
    const [c1] = splitCubic(s.c, t);
    const pts = sampleCubic(c1, 2);
    const pl = makePolyline(pts);
    return clamp(pl.length / g.center.length, 0, 1);
  }

  // ---------------- queries ----------------

  segsAt(nodeId: number): RSeg[] {
    const out: RSeg[] = [];
    for (const s of this.segs.values()) if (s.a === nodeId || s.b === nodeId) out.push(s);
    return out;
  }

  heightOnSeg(id: number, t: number): number {
    const s = this.segs.get(id)!;
    const ha = this.nodes.get(s.a)!.h, hb = this.nodes.get(s.b)!.h;
    return ha + (hb - ha) * smoothstep(clamp(t, 0, 1));
  }

  heightOnSegRaw(ha: number, hb: number, t: number): number {
    return ha + (hb - ha) * smoothstep(clamp(t, 0, 1));
  }

  /** Height along a seg by centre arc-length. */
  heightAtS(id: number, s: number): number {
    const g = this.segGeom.get(id)!;
    const seg = this.segs.get(id)!;
    const ha = this.nodes.get(seg.a)!.h, hb = this.nodes.get(seg.b)!.h;
    return ha + (hb - ha) * smoothstep(clamp(s / (g.center.length || 1), 0, 1));
  }

  segsNear(x0: number, y0: number, x1: number, y1: number): Set<number> {
    const out = new Set<number>();
    const c = this.cell;
    for (let gy = Math.floor(y0 / c); gy <= Math.floor(y1 / c); gy++)
      for (let gx = Math.floor(x0 / c); gx <= Math.floor(x1 / c); gx++) {
        const set = this.grid.get(gx * 100003 + gy);
        if (set) for (const id of set) out.add(id);
      }
    return out;
  }

  nodesNear(p: V2, r: number): RNode[] {
    const out: RNode[] = [];
    const ids = this.segsNear(p.x - r, p.y - r, p.x + r, p.y + r);
    const seen = new Set<number>();
    for (const id of ids) {
      const s = this.segs.get(id);
      if (!s) continue; // removed earlier in this transaction (the index catches up on rebuild)
      for (const nid of [s.a, s.b]) {
        if (seen.has(nid)) continue;
        seen.add(nid);
        const n = this.nodes.get(nid)!;
        if (dist(n.p, p) <= r) out.push(n);
      }
    }
    // isolated nodes (no segs) are never kept, so this is complete
    return out;
  }

  // ---------------- rebuild derived data ----------------

  get hasPending(): boolean {
    return this.dirtyNodes.size > 0 || this.removedSegs.size > 0 || this.removedNodes.size > 0;
  }

  rebuild(): ChangeSet {
    const dirtyNodes = new Set([...this.dirtyNodes].filter((id) => this.nodes.has(id)));
    const removedSegs = new Set(this.removedSegs);
    const removedNodes = new Set(this.removedNodes);
    const splits = this.splits;
    this.dirtyNodes.clear();
    this.removedSegs.clear();
    this.removedNodes.clear();
    this.splits = [];

    const oldLanes = new Map<string, Lane>();
    const oldConns = new Map<number, Connector[]>();

    // drop geometry of removed things
    for (const id of removedSegs) {
      const g = this.segGeom.get(id);
      if (g) for (const l of g.lanes) { oldLanes.set(l.key, l); this.lanes.delete(l.key); }
      if (!this.segs.has(id)) this.segGeom.delete(id);
      this.unindexSeg(id);
    }
    for (const id of removedNodes) {
      const ng = this.nodeGeom.get(id);
      if (ng) oldConns.set(id, ng.conns);
      this.nodeGeom.delete(id);
    }

    // segs touching dirty nodes need new trims/lanes
    const dirtySegs = new Set<number>();
    const segsByNode = new Map<number, RSeg[]>();
    for (const s of this.segs.values()) {
      for (const nid of [s.a, s.b]) {
        let arr = segsByNode.get(nid);
        if (!arr) segsByNode.set(nid, (arr = []));
        arr.push(s);
      }
      if (dirtyNodes.has(s.a) || dirtyNodes.has(s.b) || removedSegs.has(s.id)) dirtySegs.add(s.id);
    }

    // 1) centrelines
    for (const id of dirtySegs) {
      const s = this.segs.get(id)!;
      const pts = sampleCubic(s.c, 1.5);
      const center = makePolyline(pts);
      const hs = new Float32Array(pts.length);
      const ha = this.nodes.get(s.a)!.h, hb = this.nodes.get(s.b)!.h;
      for (let i = 0; i < pts.length; i++) hs[i] = ha + (hb - ha) * smoothstep(center.cum[i] / (center.length || 1));
      const prev = this.segGeom.get(id);
      const w = roadWidth(ROAD_TYPES[s.type]);
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
      const pad = w / 2 + 1;
      this.segGeom.set(id, {
        center, hs, width: w,
        trimA: prev?.trimA ?? 0, trimB: prev?.trimB ?? 0,
        lanes: prev?.lanes ?? [],
        ends: prev?.ends ?? { a: NO_SHAPE, b: NO_SHAPE },
        minR: minRadius(pts),
        bbox: { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad },
      });
      this.indexSeg(id);
    }

    // 2) arms + trims at dirty nodes
    const armsByNode = new Map<number, Arm[]>();
    for (const nid of dirtyNodes) {
      const arms = this.computeArms(nid, segsByNode.get(nid) ?? []);
      armsByNode.set(nid, arms);
      const shapes = this.shapeEnds(arms, segsByNode.get(nid) ?? []);
      for (const [i, arm] of arms.entries()) {
        const g = this.segGeom.get(arm.seg)!;
        if (arm.end === "a") g.trimA = arm.trim;
        else g.trimB = arm.trim;
        const pk = arm.wL ? this.segs.get(arm.seg)!.pk?.[arm.end] : undefined;
        g.ends = { ...g.ends, [arm.end]: pk ? { ...shapes[i], pocket: { ...pk } } : shapes[i] };
      }
    }

    // 2b) shifted and glued centrelines (glued ones last: they follow the road they're glued to)
    const shaped = [...dirtySegs].filter((id) => { const e = this.segGeom.get(id)!.ends; return !!(e.a.shift || e.b.shift || e.a.glue || e.b.glue); });
    shaped.sort((x, y) => Number(this.hasGlue(x)) - Number(this.hasGlue(y)));
    for (const id of shaped) this.shapeCenter(id);

    // keep trims from eating a whole segment
    for (const id of dirtySegs) {
      const g = this.segGeom.get(id)!;
      const L = g.center.length;
      const sum = g.trimA + g.trimB;
      if (sum > L * 0.9) {
        const k = (L * 0.9) / sum;
        g.trimA *= k;
        g.trimB *= k;
      }
    }

    // 3) lanes of dirty segs
    for (const id of dirtySegs) {
      const g = this.segGeom.get(id)!;
      for (const l of g.lanes) { if (!oldLanes.has(l.key)) oldLanes.set(l.key, l); this.lanes.delete(l.key); }
      g.lanes = this.buildLanes(this.segs.get(id)!, g);
      for (const l of g.lanes) this.lanes.set(l.key, l);
    }

    // 4) junction geometry + connectors at every endpoint of a dirty seg
    const connNodes = new Set<number>(dirtyNodes);
    for (const id of dirtySegs) {
      const s = this.segs.get(id)!;
      connNodes.add(s.a);
      connNodes.add(s.b);
    }
    for (const nid of connNodes) {
      if (!this.nodes.has(nid)) continue;
      const prev = this.nodeGeom.get(nid);
      if (prev) oldConns.set(nid, prev.conns);
      const arms = armsByNode.get(nid) ?? this.computeArms(nid, segsByNode.get(nid) ?? []);
      this.nodeGeom.set(nid, this.buildJunction(nid, arms));
    }
    // reset lane in/out lists for lanes at rebuilt nodes
    for (const nid of connNodes) {
      const ng = this.nodeGeom.get(nid);
      if (!ng) continue;
      for (const arm of ng.arms) {
        const g = this.segGeom.get(arm.seg)!;
        for (const l of g.lanes) {
          if (l.to === nid) l.outs = [];
          if (l.from === nid) l.ins = [];
        }
      }
    }
    for (const nid of connNodes) {
      const ng = this.nodeGeom.get(nid);
      if (!ng) continue;
      for (const c of ng.conns) {
        c.from.outs.push(c);
        c.to.ins.push(c);
      }
    }

    this.version++;
    return { dirtySegs, dirtyNodes: connNodes, removedSegs, removedNodes, splits, oldLanes, oldConns };
  }

  /** Full rebuild (after load). */
  rebuildAll(): ChangeSet {
    for (const id of this.nodes.keys()) this.dirtyNodes.add(id);
    return this.rebuild();
  }

  private indexSeg(id: number) {
    this.unindexSeg(id);
    const g = this.segGeom.get(id)!;
    const c = this.cell;
    const cells: number[] = [];
    for (let gy = Math.floor(g.bbox.y0 / c); gy <= Math.floor(g.bbox.y1 / c); gy++)
      for (let gx = Math.floor(g.bbox.x0 / c); gx <= Math.floor(g.bbox.x1 / c); gx++) {
        const k = gx * 100003 + gy;
        let set = this.grid.get(k);
        if (!set) this.grid.set(k, (set = new Set()));
        set.add(id);
        cells.push(k);
      }
    this.segCells.set(id, cells);
  }

  private unindexSeg(id: number) {
    const cells = this.segCells.get(id);
    if (!cells) return;
    for (const k of cells) this.grid.get(k)?.delete(id);
    this.segCells.delete(id);
  }

  // ---------------- geometry builders ----------------

  private computeArms(nid: number, segs: RSeg[]): Arm[] {
    const arms: Arm[] = [];
    for (const s of segs) {
      const loops = s.a === nid && s.b === nid;
      const ends: ("a" | "b")[] = loops ? ["a", "b"] : [s.a === nid ? "a" : "b"];
      for (const end of ends) {
        const t = end === "a" ? cubicTangent(s.c, 0) : scale(cubicTangent(s.c, 1), -1);
        arms.push({ seg: s.id, end, dir: t, angle: angleOf(t), halfW: roadWidth(ROAD_TYPES[s.type]) / 2, trim: 0 });
      }
    }
    arms.sort((x, y) => x.angle - y.angle);
    const kind = this.kindOf(arms, segs);
    if (kind === "bend") {
      // a circular corner at the road's design radius, tangent to both arms
      const theta = Math.acos(clamp(-dot(arms[0].dir, arms[1].dir), -1, 1)); // how far the road turns
      const R = Math.max(...segs.map((s) => Math.max(ROAD_TYPES[s.type].minRadius, roadWidth(ROAD_TYPES[s.type]) / 2 + 2)));
      const trim = Math.min(45, R * Math.tan(Math.min(theta, 2.8) / 2)) + 0.3;
      for (const a of arms) a.trim = trim;
    } else if (kind === "junction") {
      for (const a of arms) {
        const s = segs.find((x) => x.id === a.seg)!;
        const p = s.ring ? undefined : s.pk?.[a.end];
        const k = p ? (p.r > 0 ? 1 : 0) + (p.l > 0 ? 1 : 0) : 0;
        if (k && laneCounts(s, a.end).inn > 0) a.wL = k * LANE_W;
      }
      const n = arms.length;
      const trims = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const A = arms[i], B = arms[(i + 1) % n];
        if (n === 1) break;
        // gap between A's right edge and B's left edge (clockwise from A to B)
        const pa = add(scale(right(A.dir), A.halfW), { x: 0, y: 0 });
        const pb = add(scale(right(B.dir), -(B.halfW + (B.wL ?? 0))), { x: 0, y: 0 });
        const hit = lineIntersect(pa, A.dir, pb, B.dir);
        let ta = 0, tb = 0;
        if (hit && hit.t > -1 && hit.u > -1) {
          ta = Math.max(0, hit.t);
          tb = Math.max(0, hit.u);
        }
        trims[i] = Math.max(trims[i], ta);
        trims[(i + 1) % n] = Math.max(trims[(i + 1) % n], tb);
      }
      for (let i = 0; i < n; i++) {
        const base = Math.min(trims[i], 45);
        arms[i].trim = base + 2.2 + (n >= 3 ? 1.2 : 0);
      }
    }
    return arms;
  }

  private kindOf(arms: Arm[], segs: RSeg[]): JunctionKind {
    if (arms.length <= 1) return "end";
    if (arms.length === 2) {
      const [x, y] = arms;
      const sx = segs.find((s) => s.id === x.seg)!, sy = segs.find((s) => s.id === y.seg)!;
      // same lane layout in the direction of travel: the same road carrying on, however it turns
      const lanesX = laneCounts(sx, x.end), lanesY = laneCounts(sy, y.end);
      const sameLayout = lanesX.inn === lanesY.out && lanesX.out === lanesY.inn;
      // roundabout arcs keep their own geometry (the ring is drawn and trimmed as a whole)
      if (sx.ring || sy.ring) return sameLayout && dot(x.dir, y.dir) < -0.985 ? "cont" : "junction";
      if (sameLayout && x.seg !== y.seg) return dot(x.dir, y.dir) < -0.9998 ? "cont" : "bend";
    }
    const roles = this.splitRoles(arms, segs);
    if (roles) return roles.ramp ? "split" : "lane";
    return "junction";
  }

  /**
   * One-way carriageways meeting nearly in line: a diverge (one in, two out), a merge (two in, one out) or a lane
   * gain/drop (one in, one out, different lane counts). The main branch carries straight on; the ramp branch is glued
   * alongside it on `side` (+1 = right of travel).
   */
  splitRoles(arms: Arm[], segs: RSeg[]): SplitRoles | null {
    if (arms.length < 2 || arms.length > 4) return null;
    const segOf = (a: Arm) => segs.find((s) => s.id === a.seg)!;
    if (new Set(arms.map((a) => a.seg)).size !== arms.length) return null;
    for (const a of arms) {
      const s = segOf(a);
      if (!s || s.ring || ROAD_TYPES[s.type].bwd > 0) return null;
    }
    const lanes = (a: Arm) => ROAD_TYPES[segOf(a).type].fwd;
    const ins = arms.filter((a) => a.end === "b"), outs = arms.filter((a) => a.end === "a");
    if (arms.length === 2) {
      if (ins.length !== 1) return null;
      const [i, o] = [ins[0], outs[0]];
      if (dot(i.dir, o.dir) > -Math.cos((20 * Math.PI) / 180) || lanes(i) === lanes(o)) return null;
      const gain = lanes(o) > lanes(i);
      return { trunk: gain ? i : o, main: gain ? o : i, ramp: null, diverge: gain, side: 1 };
    }
    if (arms.length === 4) return this.weaveRoles(arms, segs);
    const diverge = ins.length === 1;
    if (!diverge && outs.length !== 1) return null;
    const trunk = diverge ? ins[0] : outs[0];
    const branches = diverge ? outs : ins;
    const fwd = diverge ? scale(trunk.dir, -1) : trunk.dir; // travel direction through the node
    const travel = (b: Arm) => (diverge ? b.dir : scale(b.dir, -1));
    const lim = Math.cos((32 * Math.PI) / 180);
    if (branches.some((b) => dot(travel(b), fwd) < lim)) return null;
    const dev = (b: Arm) => Math.acos(clamp(dot(travel(b), fwd), -1, 1));
    const score = (b: Arm) => (segOf(b).type === segOf(trunk).type ? 100 : 0) + lanes(b) * 10 - dev(b) * 8;
    const [main, ramp] = score(branches[0]) >= score(branches[1]) ? branches : [branches[1], branches[0]];
    // which side the ramp is on: compare where both branches are the same distance out from the node (its end
    // tangent may run exactly in line, and a long curving main line can swing further out mid-way than the ramp)
    const at = (a: Arm) => { const s = segOf(a); return a.end === "a" ? s.c.p0 : s.c.p3; };
    const walk = (a: Arm, d: number | null): { p: V2; len: number } => {
      const s = segOf(a);
      let prev = at(a), len = 0;
      for (let i = 1; i <= 48; i++) {
        const t = a.end === "a" ? i / 48 : 1 - i / 48;
        const p = cubicAt(s.c, t);
        len += dist(p, prev);
        prev = p;
        if (d !== null && len >= d) return { p, len };
      }
      return { p: prev, len };
    };
    const reach = Math.min(30, walk(ramp, null).len * 0.5, walk(main, null).len * 0.5);
    const lat = (a: Arm) => dot(sub(walk(a, reach).p, at(a)), right(fwd));
    let l = lat(ramp) - lat(main);
    if (Math.abs(l) < 0.05) l = signedAngle(fwd, travel(ramp));
    return { trunk, main, ramp, diverge, side: l >= 0 ? 1 : -1 };
  }

  /**
   * Four one-way arms nearly in line, two in and two out: a carriageway running through, with a slip lane beside it
   * that an entry feeds and the next exit leaves from (a weave). Both slip lanes on the same side.
   */
  private weaveRoles(arms: Arm[], segs: RSeg[]): SplitRoles | null {
    const segOf = (a: Arm) => segs.find((s) => s.id === a.seg)!;
    const ins = arms.filter((a) => a.end === "b"), outs = arms.filter((a) => a.end === "a");
    if (ins.length !== 2) return null;
    const lanes = (a: Arm) => ROAD_TYPES[segOf(a).type].fwd;
    // the carriageway: the in and out pair most nearly straight through (the same road first, then the wider)
    let best: [Arm, Arm] | null = null, bs = -Infinity;
    for (const i of ins) for (const o of outs) {
      const sc = (segOf(i).type === segOf(o).type ? 100 : 0) + (lanes(i) + lanes(o)) * 10 - Math.acos(clamp(-dot(i.dir, o.dir), -1, 1)) * 30;
      if (sc > bs) { bs = sc; best = [i, o]; }
    }
    const [trunk, main] = best!;
    const ramp = outs.find((o) => o !== main)!, rampIn = ins.find((i) => i !== trunk)!;
    const fwd = scale(trunk.dir, -1);
    const lim = Math.cos((32 * Math.PI) / 180);
    if (dot(main.dir, fwd) < lim || dot(ramp.dir, fwd) < lim || dot(rampIn.dir, fwd) > -lim) return null;
    // which side each slip lane is on: its middle against the nearest point of the carriageway piece beside it (a long
    // lane barely leaves the carriageway's line in its first metres)
    const off = (a: Arm, ref: Arm) => {
      const p = cubicAt(segOf(a).c, 0.5), rc = segOf(ref).c;
      let bt = 0, bd = Infinity;
      for (let k = 0; k <= 64; k++) { const d = dist(cubicAt(rc, k / 64), p); if (d < bd) { bd = d; bt = k / 64; } }
      const t = cubicTangent(rc, bt), tl = Math.hypot(t.x, t.y) || 1;
      return dot(sub(p, cubicAt(rc, bt)), right({ x: t.x / tl, y: t.y / tl }));
    };
    const lo = off(ramp, main), li = off(rampIn, trunk);
    if (Math.abs(lo) < 0.05 || Math.abs(li) < 0.05 || Math.sign(lo) !== Math.sign(li)) return null;
    return { trunk, main, ramp, diverge: true, side: lo > 0 ? 1 : -1, rampIn };
  }

  /** Lane layout across a split or lane change: centreline offsets, glue, tapers and per-lane taper lengths. */
  private shapeEnds(arms: Arm[], segs: RSeg[]): EndShape[] {
    const out = arms.map(() => NO_SHAPE);
    const roles = this.splitRoles(arms, segs);
    if (!roles) return out;
    const { trunk, main, ramp, side: sg } = roles;
    const typeOf = (a: Arm) => ROAD_TYPES[segs.find((s) => s.id === a.seg)!.type];
    const T = typeOf(trunk), M = typeOf(main), R = ramp ? typeOf(ramp) : null;
    const n = T.fwd, m = M.fwd, r = R?.fwd ?? 0;
    const tH = roadWidth(T) / 2, mH = roadWidth(M) / 2, rH = R ? roadWidth(R) / 2 : 0;
    // line the far-side lanes up: the wider of trunk and main moves over, the other stays on its line
    const Tc = n >= m ? (sg * (n - m) * LANE_W) / 2 : 0;
    const Mc = n >= m ? 0 : (sg * (m - n) * LANE_W) / 2;
    // lane positions by rank from the far side (0 = furthest from the ramp side)
    const posT = (f: number) => Tc - sg * (n / 2 - f - 0.5) * LANE_W;
    const posM = (j: number) => Mc - sg * (m / 2 - j - 0.5) * LANE_W;
    const idxOf = (f: number, count: number) => (sg > 0 ? count - 1 - f : f);
    const rate = clamp(Math.min(T.speed, M.speed) / 3, 5, 10); // tapers sized for the main line's speed
    const taper = (d: number) => (d < 0.3 ? 0 : clamp(d * rate, 12, 50));
    const mTrim = new Array(m).fill(0);
    for (let j = 0; j < m; j++) mTrim[idxOf(j, m)] = taper(Math.abs(posM(j) - posT(Math.min(j, n - 1))));
    const shape = (o: Partial<EndShape>): EndShape => ({ ...NO_SHAPE, ...o });
    const mClip = ramp ? 0 : Math.max(0, sg * (Mc + sg * mH - (Tc + sg * tH)));
    out[arms.indexOf(trunk)] = shape({ shift: Tc });
    out[arms.indexOf(main)] = shape({
      shift: Mc, laneTrim: mTrim,
      ...(mClip > 0.05 ? { clip: mClip, clipSide: sg, clipLen: Math.max(...mTrim, taper(mClip)) } : {}),
    });
    if (ramp && R) {
      const Rc = Mc + sg * (mH + rH - 0.42); // touching: the two edge lines become one
      const posR = (k: number) => Rc - sg * (r / 2 - k - 0.5) * LANE_W;
      const rTrim = new Array(r).fill(0);
      for (let k = 0; k < r; k++) rTrim[idxOf(k, r)] = taper(Math.abs(posR(k) - posT(Math.min(m + k, n - 1))));
      const clip = roles.rampIn ? 0 : Math.max(0, sg * (Rc + sg * rH - (Tc + sg * tH)));
      out[arms.indexOf(ramp)] = shape({
        glue: { seg: main.seg, d: Rc - Mc }, laneTrim: rTrim,
        ...(clip > 0.05 ? { clip, clipSide: sg, clipLen: Math.max(...rTrim, taper(clip)) } : {}),
      });
    }
    if (roles.rampIn) {
      // a weave: the entry's slip lane runs on beside the carriageway coming in, and straight on into the exit's
      const I = typeOf(roles.rampIn), iH = roadWidth(I) / 2, ri = I.fwd;
      const Ic = Tc + sg * (tH + iH - 0.42);
      const iTrim = new Array(ri).fill(0);
      for (let k = 0; k < ri; k++) iTrim[idxOf(k, ri)] = taper(Math.abs(Ic - sg * (ri / 2 - k - 0.5) * LANE_W - posT(n - 1)));
      out[arms.indexOf(roles.rampIn)] = shape({ glue: { seg: trunk.seg, d: Ic - Tc }, laneTrim: iTrim });
    }
    return out;
  }

  private hasGlue(id: number): boolean {
    const e = this.segGeom.get(id)!.ends;
    return !!(e.a.glue || e.b.glue);
  }

  /** Apply end shifts and glue to a freshly sampled centreline (then heights, bounds and the index follow). */
  private shapeCenter(id: number) {
    const s = this.segs.get(id)!, g = this.segGeom.get(id)!;
    const { a, b } = g.ends;
    const pts0 = g.center.pts, cum = g.center.cum, L = g.center.length;
    let pts = pts0.map((p) => ({ x: p.x, y: p.y }));
    let beside: { line: Polyline; hs: number[] } | null = null;
    if (a.shift || b.shift) {
      const ld = L < 2 * SHIFT_LEN || (a.shift && b.shift) ? L : SHIFT_LEN; // shifted at both ends: hold it between
      pts = pts.map((p, i) => {
        const off = a.shift * (1 - smoothstep(clamp(cum[i] / ld, 0, 1))) + b.shift * (1 - smoothstep(clamp((L - cum[i]) / ld, 0, 1)));
        if (Math.abs(off) < 1e-4) return p;
        const d = norm(sub(pts0[Math.min(i + 1, pts0.length - 1)], pts0[Math.max(i - 1, 0)]));
        return add(p, scale(right(d), off));
      });
    }
    for (const end of ["a", "b"] as const) {
      const gl = g.ends[end].glue;
      if (!gl || !this.segGeom.get(gl.seg)) continue;
      const other = g.ends[end === "a" ? "b" : "a"];
      const { line, hs: lineH } = this.glueLine(gl.seg, end === "a" ? s.a : s.b, L + 40);
      const full = !other.glue && !other.shift && besideAll(pts, line, gl.d, end);
      g.ends = { ...g.ends, [end]: { ...g.ends[end], glue: { ...gl, line, full } } };
      if (full) beside = { line, hs: lineH };
      pts = full ? glueAll(pts, cum, L, end, line, gl.d) : glueRun(pts, cum, L, end, line, gl.d, !!(other.glue || other.shift));
    }
    const center = makePolyline(pts);
    const ha = this.nodes.get(s.a)!.h, hb = this.nodes.get(s.b)!.h;
    const hs = new Float32Array(pts.length);
    for (let i = 0; i < pts.length; i++) hs[i] = ha + (hb - ha) * smoothstep(center.cum[i] / (center.length || 1));
    // a slip lane keeps level with the carriageway beside it all the way (over a rise, onto a bridge)
    if (beside) for (let i = 0; i < pts.length; i++) hs[i] = atLen(beside.line, beside.hs, polyClosest(beside.line, pts[i]).s);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of pts) { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); }
    const pad = g.width / 2 + 1;
    g.center = center;
    g.hs = hs;
    g.minR = minRadius(pts);
    g.bbox = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
    this.indexSeg(id);
  }

  /**
   * The centreline a road glued to carriageway `segId` at `node` runs beside: that piece, and the carriageway running
   * on from it away from the node (through nodes where it simply carries on), to about `len` metres.
   */
  glueLine(segId: number, node: number, len: number): { line: Polyline; hs: number[] } {
    const first = this.segs.get(segId)!;
    let pts = this.segGeom.get(segId)!.center.pts.slice();
    let hs = Array.from(this.segGeom.get(segId)!.hs);
    let total = this.segGeom.get(segId)!.center.length;
    const fwd = first.a === node; // the line grows on from b (true) or back from a
    let cur = first;
    for (let hop = 0; hop < 12 && total < len; hop++) {
      const n = fwd ? cur.b : cur.a;
      const t = norm(cubicTangent(cur.c, fwd ? 1 : 0));
      let next: RSeg | undefined, bd = 0.94;
      for (const x of this.segsAt(n)) {
        if (x.id === cur.id || x.ring || ROAD_TYPES[x.type].bwd > 0 || (fwd ? x.a !== n : x.b !== n)) continue;
        const d = dot(norm(cubicTangent(x.c, fwd ? 0 : 1)), t) + (x.type === cur.type ? 0.01 : 0);
        if (d > bd) { bd = d; next = x; }
      }
      const ng = next && this.segGeom.get(next.id);
      if (!next || !ng) break;
      pts = fwd ? pts.concat(ng.center.pts.slice(1)) : ng.center.pts.slice(0, -1).concat(pts);
      hs = fwd ? hs.concat(Array.from(ng.hs).slice(1)) : Array.from(ng.hs).slice(0, -1).concat(hs);
      total += ng.center.length;
      cur = next;
    }
    return { line: makePolyline(pts), hs };
  }

  private buildLanes(s: RSeg, g: SegGeom): Lane[] {
    const T = ROAD_TYPES[s.type];
    const lanes: Lane[] = [];
    const L = g.center.length;
    const span = (idx: number, dir: 1 | -1) => {
      // lanes of a taper start (or end) further from the node: a connector carries cars across it
      let ta = dir === 1 ? g.ends.a.laneTrim[idx] ?? 0 : 0, tb = dir === 1 ? g.ends.b.laneTrim[idx] ?? 0 : 0;
      const room = Math.max(0, L - g.trimA - g.trimB - 1);
      if (ta + tb > room * 0.8) { const k = (room * 0.8) / (ta + tb); ta *= k; tb *= k; }
      const s0 = g.trimA + ta;
      return { s0, s1: Math.max(s0 + 0.5, L - g.trimB - tb) };
    };
    const twoWay = T.bwd > 0;
    const pz = pocketZones(s, g);
    const mk = (dir: 1 | -1, idx: number, count: number, off: number | ((sc: number) => number), sp = span(idx, dir), pocket?: "r" | "l"): Lane => {
      const { s0, s1 } = sp;
      const base = trimPolyline(g.center, s0, s1);
      const basePl = makePolyline(base);
      let pts = typeof off === "number" ? offsetPolyline(base, off) : offsetVar(base, base.map((_, i) => off(s0 + (basePl.cum[i] ?? 0))));
      let hs = new Float32Array(pts.length);
      for (let i = 0; i < pts.length; i++) hs[i] = this.heightFromCenter(s, g, s0 + (basePl.cum[Math.min(i, basePl.cum.length - 1)] ?? 0));
      if (dir === -1) {
        pts = pts.slice().reverse();
        hs = hs.slice().reverse();
      }
      const pl = makePolyline(pts);
      return {
        kind: "lane", uid: edgeUid++, key: `${s.id}:${dir}:${idx}`, seg: s.id, dir, idx, count, c0: s0, c1: s1,
        ...(pocket ? { pocket } : {}),
        from: dir === 1 ? s.a : s.b, to: dir === 1 ? s.b : s.a,
        // round a roundabout nobody drives at the road's limit: cap by the ring's curvature, like a connector
        offset: typeof off === "number" ? off : off(dir === 1 ? s1 : s0), pl, hs, speed: s.ring ? Math.min(T.speed, Math.sqrt(SIM.turnLat * Math.max(2, ringR(pl)))) : T.speed, occ: [], outs: [], ins: [],
      };
    };
    const med = (T.median ?? 0) / 2; // a median pushes both directions out from the centre line
    const side = (dir: 1 | -1, n: number, offOf: (i: number) => number) => {
      const z = dir === 1 ? pz.fwd : pz.bwd;
      const sg = dir === 1 ? 1 : -1; // + offset = right of a->b: the right of this direction's travel when sg > 0
      // a left pocket: the through lanes swing over to the right to make room for it on their inside
      const sw = (sc: number) => sg * LANE_W * z.l(sc);
      for (let i = 0; i < n; i++) lanes.push(mk(dir, i, n, z.lLen > 0 ? (sc: number) => offOf(i) + sw(sc) : offOf(i)));
      const at = (len: number) => (dir === 1 ? { s0: z.stop - len, s1: z.stop } : { s0: z.stop, s1: z.stop + len });
      if (z.lLen > 0) lanes.push(mk(dir, n, n, offOf(n - 1), at(z.lLen), "l"));
      if (z.rLen > 0) lanes.push(mk(dir, -1, n, offOf(0) + sg * LANE_W * (z.lLen > 0 ? 2 : 1), at(z.rLen), "r"));
    };
    side(1, T.fwd, (i) => (twoWay ? (T.fwd - i - 0.5) * LANE_W + med : (T.fwd / 2 - i - 0.5) * LANE_W));
    side(-1, T.bwd, (j) => -(T.bwd - j - 0.5) * LANE_W - med);
    return lanes;
  }

  private heightFromCenter(_s: RSeg, g: SegGeom, sc: number): number {
    return atLen(g.center, Array.from(g.hs), sc);
  }

  private buildJunction(nid: number, arms: Arm[]): NodeGeom {
    const node = this.nodes.get(nid)!;
    const segs = arms.map((a) => this.segs.get(a.seg)!);
    const kind = this.kindOf(arms, segs);
    const geom: NodeGeom = { kind, arms, poly: null, kerbs: [], conns: [], radius: 0 };
    const c = node.p;

    // ---- surface polygon ----
    if (kind === "junction" && arms.length >= 2) {
      const poly: V2[] = [];
      const kerbs: V2[][] = [];
      const n = arms.length;
      const edgeL = (a: Arm) => add(add(c, scale(a.dir, a.trim)), scale(right(a.dir), -(a.halfW + (a.wL ?? 0))));
      const edgeR = (a: Arm) => add(add(c, scale(a.dir, a.trim)), scale(right(a.dir), a.halfW));
      for (let i = 0; i < n; i++) {
        const A = arms[i], B = arms[(i + 1) % n];
        const l = edgeL(A), r = edgeR(A);
        poly.push(l, r);
        // fillet from A's right edge to B's left edge
        const bl = edgeL(B);
        const hit = lineIntersect(r, A.dir, bl, B.dir);
        const fillet: V2[] = [];
        if (hit && hit.t < 0 && hit.u < 0) {
          const q = add(r, scale(A.dir, hit.t));
          for (let k = 1; k < 8; k++) {
            const t = k / 8;
            const u = 1 - t;
            fillet.push({
              x: u * u * r.x + 2 * u * t * q.x + t * t * bl.x,
              y: u * u * r.y + 2 * u * t * q.y + t * t * bl.y,
            });
          }
        }
        poly.push(...fillet);
        kerbs.push([r, ...fillet, bl]);
      }
      geom.poly = poly;
      geom.kerbs = kerbs;
      let rad = 0;
      for (const p of poly) rad = Math.max(rad, dist(p, c));
      geom.radius = rad;
    } else if (kind === "end" && arms.length === 1) {
      const A = arms[0];
      const s = segs[0];
      const T = ROAD_TYPES[s.type];
      if (T.bwd > 0) {
        // turning bulb so U-turns look plausible
        const r = A.halfW + 2.2;
        const poly: V2[] = [];
        const ctr = add(c, scale(A.dir, -1.5));
        for (let k = 0; k < 28; k++) {
          const a = (k / 28) * Math.PI * 2;
          poly.push({ x: ctr.x + Math.cos(a) * r, y: ctr.y + Math.sin(a) * r });
        }
        geom.poly = poly;
        geom.kerbs = [[...poly, poly[0]]];
        geom.radius = r + 1.5;
      }
    }

    // ---- connectors ----
    const laneOf = (arm: Arm, incoming: boolean) => {
      const g = this.segGeom.get(arm.seg)!;
      // incoming lanes travel to this node
      return g.lanes
        .filter((l) => (incoming ? l.to === nid : l.from === nid) && (arm.end === "a" ? (incoming ? l.dir === -1 : l.dir === 1) : (incoming ? l.dir === 1 : l.dir === -1)))
        .sort((x, y) => x.idx - y.idx);
    };
    const nodeH = node.h;
    const prioOf = (arm: Arm) => {
      const s = this.segs.get(arm.seg)!;
      return s.ring ? 10 : ROAD_TYPES[s.type].rank;
    };

    if (kind === "bend") geom.curve = this.bendCurve(node, arms, segs);
    if (geom.curve) {
      const { pts, halfW } = geom.curve;
      const side = (k: number) => pts.map((p, i) => {
        const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
        return add(p, scale(right(norm(sub(b, a))), k * halfW));
      });
      geom.poly = [...side(-1), ...side(1).reverse()];
      for (const p of geom.poly) geom.radius = Math.max(geom.radius, dist(p, c));
    }

    if (kind === "split" || kind === "lane") {
      // lanes line up from the far side: main first, then the ramp's; a short trunk fans its last lane out
      const roles = this.splitRoles(arms, segs)!;
      const { trunk, main, ramp, diverge, side } = roles;
      const byFar = (ls: Lane[]) => (side > 0 ? ls.slice().reverse() : ls); // rank 0 = furthest from the ramp side
      const tl = byFar(laneOf(trunk, diverge));
      const ml = byFar(laneOf(main, !diverge));
      const rl = ramp ? byFar(laneOf(ramp, !diverge)) : [];
      const sideTurn: Connector["turn"] = side > 0 ? "R" : "L";
      const g = (a: Arm) => this.segGeom.get(a.seg)!.ends[a.end];
      const tapered = (a: Arm, l: Lane) => (g(a).laneTrim[l.idx] ?? 0) > 0;
      const link = (t: Lane, b: Lane, arm: Arm, turn: Connector["turn"]) => {
        if (!t || !b) return;
        const tt = tapered(arm, b) ? sideTurn : turn;
        if (diverge) geom.conns.push(this.makeConn(nid, t, b, tt, nodeH, trunk.seg, prioOf(trunk)));
        else geom.conns.push(this.makeConn(nid, b, t, tt, nodeH, arm.seg, prioOf(arm)));
      };
      const n = tl.length;
      if (n) {
        ml.forEach((l, j) => link(tl[Math.min(j, n - 1)], l, main, "S"));
        rl.forEach((l, k) => link(tl[Math.min(ml.length + k, n - 1)], l, ramp!, sideTurn));
        // more trunk lanes than both branches take: the spare ones run into the outermost branch lane
        const last = rl.length ? { l: rl[rl.length - 1], arm: ramp! } : { l: ml[ml.length - 1], arm: main };
        for (let f = ml.length + rl.length; f < n; f++) link(tl[f], last.l, last.arm, sideTurn);
      }
      if (roles.rampIn) {
        // a weave: the carriageway's traffic never stops (on, or off into the slip lane); traffic in the slip lane
        // either carries on into the exit or finds a gap in the kerb lane, and gives way to both
        for (const cn of geom.conns) cn.free = true;
        const il = byFar(laneOf(roles.rampIn, true));
        const kerb = ml[ml.length - 1];
        const otherTurn: Connector["turn"] = side > 0 ? "L" : "R";
        const prio = prioOf(roles.rampIn);
        il.forEach((l, k) => {
          const to = rl[Math.min(k, rl.length - 1)];
          if (to) { const cn = this.makeConn(nid, l, to, "S", nodeH, roles.rampIn!.seg, prio); cn.free = false; geom.conns.push(cn); }
          if (kerb) { const cn = this.makeConn(nid, l, kerb, otherTurn, nodeH, roles.rampIn!.seg, prio); cn.free = false; geom.conns.push(cn); }
        });
      }
      this.computeConflicts(geom.conns);
      return geom;
    }

    if (kind === "cont" || kind === "bend") {
      // the road just carries on: 1:1 lanes (zero length when straight, a curve round a bend), nobody yields
      for (const A of arms) {
        const B = arms.find((x) => x !== A)!;
        const ins = laneOf(A, true), outs = laneOf(B, false);
        for (let i = 0; i < ins.length && i < outs.length; i++) {
          geom.conns.push(this.makeConn(nid, ins[i], outs[i], "S", nodeH, A.seg, prioOf(A)));
        }
      }
      return geom;
    }

    const deadEnd = arms.length === 1;
    for (const A of arms) {
      const arriving = laneOf(A, true);
      const ins = arriving.filter((l) => !l.pocket);
      const rp = arriving.find((l) => l.pocket === "r"), lp = arriving.find((l) => l.pocket === "l");
      if (!ins.length) continue;
      const mine: { from: Lane; to: Lane; turn: Connector["turn"] }[] = [];
      const inDir = scale(A.dir, -1);
      const exits: { arm: Arm; ang: number; outs: Lane[] }[] = [];
      // a road with a median can't be crossed mid-block, so it gets U-turns at its junctions instead
      const uTurn = deadEnd || (ROAD_TYPES[segs.find((s) => s.id === A.seg)!.type].median ?? 0) > 0;
      for (const B of arms) {
        if (B === A && !uTurn) continue;
        const outs = laneOf(B, false);
        if (!outs.length) continue;
        const ang = B === A ? Math.PI : signedAngle(inDir, B.dir);
        exits.push({ arm: B, ang, outs });
      }
      if (!exits.length) continue;
      exits.sort((x, y) => y.ang - x.ang); // rightmost first
      let main = -1;
      let best = Infinity;
      exits.forEach((e, i) => {
        if (Math.abs(e.ang) < (50 * Math.PI) / 180 && Math.abs(e.ang) < best) { best = Math.abs(e.ang); main = i; }
      });
      const n = ins.length;
      exits.forEach((e, ei) => {
        let laneIdx: number[];
        const isU = e.arm === A;
        const turn: Connector["turn"] = isU ? "U" : ei === main ? "S" : e.ang > 0 ? "R" : "L";
        const real = exits.filter((x) => x.arm !== A).length;
        if (n === 1) laneIdx = [0];
        else if (real <= 1 && !isU) laneIdx = ins.map((_, i) => i); // only one way out: every lane feeds it
        else if (isU) laneIdx = [n - 1];
        else if (main >= 0) {
          if (ei === main) laneIdx = ins.map((_, i) => i);
          else if (ei < main) laneIdx = [0];
          else laneIdx = [n - 1];
        } else {
          const half = n / 2;
          laneIdx = e.ang > 0 ? ins.map((_, i) => i).filter((i) => i < Math.ceil(half)) : ins.map((_, i) => i).filter((i) => i >= Math.floor(half));
        }
        const m = e.outs.length;
        const k = laneIdx.length;
        const leftTurn = turn === "L" || turn === "U";
        laneIdx.forEach((li, r) => {
          const targets: number[] = [];
          if (leftTurn && ei !== main) {
            targets.push(Math.max(0, m - 1 - (k - 1 - r)));
          } else {
            targets.push(Math.min(r, m - 1));
            if (r === k - 1 && m > k) for (let j = k; j < m; j++) targets.push(j);
          }
          for (const j of targets) mine.push({ from: ins[li], to: e.outs[j], turn });
        });
      });
      // turn pockets: the right one takes the right turns, the left one the left turns and U-turns, off the through
      // lanes (unless that would leave a through lane going nowhere)
      for (const [pl, turns] of [[rp, ["R"]], [lp, ["L", "U"]]] as const) {
        if (!pl) continue;
        const take = mine.filter((m) => (turns as readonly string[]).includes(m.turn));
        const exitsTo = new Map<number, typeof take[number]>();
        for (const m of take) {
          // one connector per exit road, into its lane nearest our side
          const k = m.to.seg * 2 + (m.to.dir === 1 ? 1 : 0), o = exitsTo.get(k);
          if (!o || (pl.pocket === "r" ? m.to.idx < o.to.idx : m.to.idx > o.to.idx)) exitsTo.set(k, m);
        }
        for (const m of exitsTo.values()) mine.push({ from: pl, to: m.to, turn: m.turn });
        for (const m of take) {
          const rest = mine.filter((x) => x.from === m.from && x !== m && !take.includes(x));
          if (rest.length) mine.splice(mine.indexOf(m), 1);
        }
      }
      for (const m of mine) geom.conns.push(this.makeConn(nid, m.from, m.to, m.turn, nodeH, A.seg, prioOf(A)));
    }
    this.computeConflicts(geom.conns);
    return geom;
  }

  /** Centre line of a bend: from the trimmed end of the arm whose lanes come in, round to the other one. */
  private bendCurve(node: RNode, arms: Arm[], segs: RSeg[]): NodeGeom["curve"] {
    const segOf = (a: Arm) => segs.find((s) => s.id === a.seg)!;
    let [X, Y] = arms;
    if (laneCounts(segOf(X), X.end).inn === 0) [X, Y] = [Y, X];
    const endOf = (a: Arm) => {
      const g = this.segGeom.get(a.seg)!;
      const sAt = a.end === "a" ? g.trimA : g.center.length - g.trimB;
      const p = polyAt(g.center, sAt);
      // unit direction pointing away from the node, along the trimmed road
      const q = polyAt(g.center, a.end === "a" ? Math.min(g.center.length, sAt + 0.5) : Math.max(0, sAt - 0.5));
      return { p, away: norm(sub(q, p)), h: this.heightFromCenter(segOf(a), g, sAt) };
    };
    const ex = endOf(X), ey = endOf(Y);
    const t0 = scale(ex.away, -1), t3 = ey.away;
    const th = Math.abs(signedAngle(t0, t3));
    const k = th < 1e-3 ? 1 / 3 : ((2 / 3) * Math.tan(th / 4)) / Math.sin(th / 2);
    const pts = dist(ex.p, ey.p) < 0.05 ? [ex.p, ey.p] : sampleCubic(hermiteCubic(ex.p, t0, ey.p, t3, Math.min(k, 1.2)), 1);
    const pl = makePolyline(pts);
    const hs = pts.map((_, i) => ex.h + (ey.h - ex.h) * smoothstep(pl.cum[i] / (pl.length || 1)));
    const lc = laneCounts(segOf(X), X.end);
    return { pts, hs, lanes: [lc.inn, lc.out], halfW: X.halfW, median: ROAD_TYPES[segOf(X).type].median ?? 0 };
  }

  private makeConn(nid: number, from: Lane, to: Lane, turn: Connector["turn"], h: number, armIn: number, prio: number): Connector {
    const p0 = from.pl.pts[from.pl.pts.length - 1];
    const p3 = to.pl.pts[0];
    const t0 = norm(sub(p0, from.pl.pts[Math.max(0, from.pl.pts.length - 3)]));
    const t3 = norm(sub(to.pl.pts[Math.min(2, to.pl.pts.length - 1)], p3));
    const chord = dist(p0, p3);
    let pts: V2[];
    if (chord < 0.05) pts = [p0, p3];
    else {
      const th = Math.abs(signedAngle(t0, t3));
      let k = th < 1e-3 ? 1 / 3 : ((2 / 3) * Math.tan(th / 4)) / Math.sin(th / 2);
      if (turn === "U") k = 0.9;
      const cub = hermiteCubic(p0, t0, p3, t3, Math.min(k, 1.2));
      pts = sampleCubic(cub, 1);
    }
    const pl = makePolyline(pts);
    const hs = new Float32Array(pts.length);
    const h0 = from.hs[from.hs.length - 1] ?? h, h1 = to.hs[0] ?? h;
    for (let i = 0; i < pts.length; i++) hs[i] = h0 + (h1 - h0) * (pl.cum[i] / (pl.length || 1));
    const r = minRadius(pts, 2);
    const speed = Math.min(from.speed, to.speed, Math.sqrt(SIM.turnLat * Math.max(r, 2)));
    return {
      kind: "conn", uid: edgeUid++, node: nid, from, to, turn, conflicts: [], armIn, prio,
      pl, hs, speed: Math.max(speed, 3), occ: [], holders: [],
    };
  }

  private computeConflicts(conns: Connector[]) {
    // the first point along `a` within a car's width (plus a little) of path `b`
    const joinAt = (a: Polyline, b: Polyline) => {
      for (let i = 0; i < a.pts.length; i++) if (polyClosest(b, a.pts[i]).d < 2.6) return a.cum[i];
      return Math.max(0, a.length - 1);
    };
    for (let i = 0; i < conns.length; i++) {
      const a = conns[i];
      for (let j = i + 1; j < conns.length; j++) {
        const b = conns[j];
        if (a.from === b.from) continue; // diverging from the same lane: handled by car-following
        if (a.to === b.to) {
          const ja = joinAt(a.pl, b.pl), jb = joinAt(b.pl, a.pl);
          a.conflicts.push({ c: b, sSelf: Math.max(0, a.pl.length - 1), sOther: Math.max(0, b.pl.length - 1), merge: true, jSelf: ja, jOther: jb });
          b.conflicts.push({ c: a, sSelf: Math.max(0, b.pl.length - 1), sOther: Math.max(0, a.pl.length - 1), merge: true, jSelf: jb, jOther: ja });
          continue;
        }
        const hit = polyHit(a.pl, b.pl);
        if (hit) {
          a.conflicts.push({ c: b, sSelf: hit.sa, sOther: hit.sb, merge: false });
          b.conflicts.push({ c: a, sSelf: hit.sb, sOther: hit.sa, merge: false });
        }
      }
    }
  }

  // ---------------- serialisation ----------------

  toJSON() {
    return {
      nodes: [...this.nodes.values()],
      segs: [...this.segs.values()],
      nextId: this.nextId,
    };
  }

  load(data: { nodes: RNode[]; segs: RSeg[]; nextId: number }) {
    this.nodes.clear();
    this.segs.clear();
    this.segGeom.clear();
    this.nodeGeom.clear();
    this.lanes.clear();
    this.grid.clear();
    this.segCells.clear();
    for (const n of data.nodes) this.nodes.set(n.id, clone(n));
    for (const s of data.segs) { const c = clone(s); c.ring ??= 0; this.segs.set(s.id, c); }
    this.nextId = data.nextId;
  }
}

/** A polyline moved sideways by a different amount at each point. */
function offsetVar(pts: V2[], offs: number[]): V2[] {
  return pts.map((p, i) => {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const r = right(norm(sub(b, a)));
    return { x: p.x + r.x * offs[i], y: p.y + r.y * offs[i] };
  });
}

/** One direction's turn pockets along its road: how far open each is (0..1) at centreline arc length sc. */
export interface PocketZone { stop: number; rLen: number; lLen: number; r: (sc: number) => number; l: (sc: number) => number }

/**
 * Where a road's turn pockets open out: for the traffic one way (fwd: a->b, arriving at b) and the other (bwd),
 * each pocket full width over its length before the stop line and opening out over a taper before that.
 */
export function pocketZones(s: RSeg, g: SegGeom): { fwd: PocketZone; bwd: PocketZone } {
  const L = g.center.length, tp = pocketTaper(s.type);
  const zone = (p: Pocket | undefined, dir: 1 | -1, room: number): PocketZone => {
    const stop = dir === 1 ? L - g.trimB : g.trimA;
    const fit = (len: number) => (len > 0 ? Math.max(0, Math.min(len, room - tp)) : 0);
    const rLen = fit(p?.r ?? 0), lLen = fit(p?.l ?? 0);
    const open = (len: number) => (sc: number) => {
      if (len <= 0) return 0;
      const d = dir === 1 ? stop - sc : sc - stop; // metres back from the stop line
      return d <= len ? 1 : d >= len + tp ? 0 : smoothstep(1 - (d - len) / tp);
    };
    return { stop, rLen, lLen, r: open(rLen), l: open(lLen) };
  };
  // both ends' pockets share the road between the junctions
  const room = Math.max(0, L - g.trimA - g.trimB - 4);
  const pa = g.ends.a.pocket, pb = g.ends.b.pocket;
  const need = (p?: Pocket) => (p ? Math.max(p.r, p.l) + pocketTaper(s.type) : 0);
  const na = need(pa), nb = need(pb);
  const k = na + nb > room ? room / (na + nb) : 1;
  return { fwd: zone(pb, 1, nb * k), bwd: zone(pa, -1, na * k) };
}

function laneCounts(s: RSeg, endAtNode: "a" | "b") {
  const T = ROAD_TYPES[s.type];
  // incoming to node: if node is b, fwd lanes come in
  return endAtNode === "b" ? { inn: T.fwd, out: T.bwd } : { inn: T.bwd, out: T.fwd };
}

function polyHit(a: Polyline, b: Polyline): { sa: number; sb: number } | null {
  for (let i = 0; i < a.pts.length - 1; i++) {
    const p1 = a.pts[i], p2 = a.pts[i + 1];
    for (let j = 0; j < b.pts.length - 1; j++) {
      const r = segIntersect(p1, p2, b.pts[j], b.pts[j + 1]);
      if (r) {
        return { sa: a.cum[i] + (a.cum[i + 1] - a.cum[i]) * r.t, sb: b.cum[j] + (b.cum[j + 1] - b.cum[j]) * r.u };
      }
    }
  }
  return null;
}

function invert(op: Op): Op {
  switch (op.t) {
    case "addNode": return { t: "delNode", node: op.node };
    case "delNode": return { t: "addNode", node: op.node };
    case "addSeg": return { t: "delSeg", seg: op.seg };
    case "delSeg": return { t: "addSeg", seg: op.seg };
    case "setType": return { t: "setType", id: op.id, from: op.to, to: op.from };
    case "flip": return op;
    case "setSignal": return { t: "setSignal", id: op.id, from: op.to, to: op.from };
    case "setPocket": return { t: "setPocket", id: op.id, end: op.end, from: op.to, to: op.from };
  }
}

/** Point + lateral position on a lane. */
export function lanePoint(l: Edge, s: number): V2 {
  return polyAt(l.pl, s);
}

export const SHOULDER_W = SHOULDER;

/** Radius of the circle through a lane's first, middle and last points (a ring arc). */
function ringR(pl: { pts: { x: number; y: number }[] }): number {
  const P = pl.pts, a = P[0], b = P[P.length >> 1], c = P[P.length - 1];
  const d = 2 * (a.x * (b.y - c.y) + b.x * (c.y - a.y) + c.x * (a.y - b.y));
  if (Math.abs(d) < 1e-6) return 1e3;
  const A = a.x * a.x + a.y * a.y, B = b.x * b.x + b.y * b.y, C = c.x * c.x + c.y * c.y;
  const ux = (A * (b.y - c.y) + B * (c.y - a.y) + C * (a.y - b.y)) / d;
  const uy = (A * (c.x - b.x) + B * (a.x - c.x) + C * (b.x - a.x)) / d;
  return Math.hypot(a.x - ux, a.y - uy);
}
