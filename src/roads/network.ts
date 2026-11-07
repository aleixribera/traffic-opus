import { LANE_W, ROAD_TYPES, SHOULDER, roadWidth, type RoadTypeId } from "../config";
import {
  type Cubic, type Polyline, type V2,
  add, angleOf, clamp, cubicTangent, dist, dot, lineIntersect, makePolyline, minRadius, norm, offsetPolyline,
  polyAt, right, sampleCubic, scale, segIntersect, signedAngle, smoothstep, splitCubic, sub, trimPolyline, hermiteCubic,
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
  idx: number; // 0 = kerb-side (rightmost) lane
  count: number; // lanes in this direction
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
}

export interface Arm {
  seg: number;
  end: "a" | "b";
  dir: V2; // leaving the node
  angle: number;
  halfW: number;
  trim: number;
}

/** end = dead end; cont = straight run-on; bend = the same road carrying on round a corner; junction = real crossing. */
export type JunctionKind = "end" | "cont" | "bend" | "junction";

export interface NodeGeom {
  kind: JunctionKind;
  arms: Arm[];
  poly: V2[] | null; // junction surface
  kerbs: V2[][]; // kerb lines (fillets) for outlines
  conns: Connector[];
  radius: number;
  /** bend only: centre line of the curved piece joining the two trimmed ends, drawn as ordinary road */
  curve?: { pts: V2[]; hs: number[]; lanes: [number, number]; halfW: number };
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
  | { t: "setSignal"; id: number; from: SignalPlan | null; to: SignalPlan | null };

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
    }
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
      for (const arm of arms) {
        const g = this.segGeom.get(arm.seg)!;
        if (arm.end === "a") g.trimA = arm.trim;
        else g.trimB = arm.trim;
      }
    }

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
      const n = arms.length;
      const trims = new Array(n).fill(0);
      for (let i = 0; i < n; i++) {
        const A = arms[i], B = arms[(i + 1) % n];
        if (n === 1) break;
        // gap between A's right edge and B's left edge (clockwise from A to B)
        const pa = add(scale(right(A.dir), A.halfW), { x: 0, y: 0 });
        const pb = add(scale(right(B.dir), -B.halfW), { x: 0, y: 0 });
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
    return "junction";
  }

  private buildLanes(s: RSeg, g: SegGeom): Lane[] {
    const T = ROAD_TYPES[s.type];
    const lanes: Lane[] = [];
    const s0 = g.trimA, s1 = Math.max(g.trimA + 0.5, g.center.length - g.trimB);
    const base = trimPolyline(g.center, s0, s1);
    // heights along the trimmed base
    const basePl = makePolyline(base);
    const hsFor = (pts: number) => {
      const out = new Float32Array(pts);
      for (let i = 0; i < pts; i++) {
        const sc = s0 + (basePl.cum[Math.min(i, basePl.cum.length - 1)] ?? 0);
        out[i] = this.heightFromCenter(s, g, sc);
      }
      return out;
    };
    const twoWay = T.bwd > 0;
    const mk = (dir: 1 | -1, idx: number, count: number, off: number): Lane => {
      let pts = offsetPolyline(base, off);
      let hs = hsFor(pts.length);
      if (dir === -1) {
        pts = pts.slice().reverse();
        hs = hs.slice().reverse();
      }
      const pl = makePolyline(pts);
      return {
        kind: "lane", uid: edgeUid++, key: `${s.id}:${dir}:${idx}`, seg: s.id, dir, idx, count,
        from: dir === 1 ? s.a : s.b, to: dir === 1 ? s.b : s.a,
        // round a roundabout nobody drives at the road's limit: cap by the ring's curvature, like a connector
        offset: off, pl, hs, speed: s.ring ? Math.min(T.speed, Math.sqrt(2.8 * Math.max(2, ringR(pl)))) : T.speed, occ: [], outs: [], ins: [],
      };
    };
    for (let i = 0; i < T.fwd; i++) {
      const off = twoWay ? (T.fwd - i - 0.5) * LANE_W : (T.fwd / 2 - i - 0.5) * LANE_W;
      lanes.push(mk(1, i, T.fwd, off));
    }
    for (let j = 0; j < T.bwd; j++) {
      const off = -(T.bwd - j - 0.5) * LANE_W;
      lanes.push(mk(-1, j, T.bwd, off));
    }
    return lanes;
  }

  private heightFromCenter(s: RSeg, g: SegGeom, sc: number): number {
    const ha = this.nodes.get(s.a)!.h, hb = this.nodes.get(s.b)!.h;
    return ha + (hb - ha) * smoothstep(clamp(sc / (g.center.length || 1), 0, 1));
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
      const edgeL = (a: Arm) => add(add(c, scale(a.dir, a.trim)), scale(right(a.dir), -a.halfW));
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
      const ins = laneOf(A, true);
      if (!ins.length) continue;
      const inDir = scale(A.dir, -1);
      const exits: { arm: Arm; ang: number; outs: Lane[] }[] = [];
      for (const B of arms) {
        if (B === A && !deadEnd) continue;
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
          for (const j of targets) geom.conns.push(this.makeConn(nid, ins[li], e.outs[j], turn, nodeH, A.seg, prioOf(A)));
        });
      });
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
    return { pts, hs, lanes: [lc.inn, lc.out], halfW: X.halfW };
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
    const speed = Math.min(from.speed, to.speed, Math.sqrt(2.8 * Math.max(r, 2)));
    return {
      kind: "conn", uid: edgeUid++, node: nid, from, to, turn, conflicts: [], armIn, prio,
      pl, hs, speed: Math.max(speed, 3), occ: [], holders: [],
    };
  }

  private computeConflicts(conns: Connector[]) {
    for (let i = 0; i < conns.length; i++) {
      const a = conns[i];
      for (let j = i + 1; j < conns.length; j++) {
        const b = conns[j];
        if (a.from === b.from) continue; // diverging from the same lane: handled by car-following
        if (a.to === b.to) {
          a.conflicts.push({ c: b, sSelf: Math.max(0, a.pl.length - 1), sOther: Math.max(0, b.pl.length - 1), merge: true });
          b.conflicts.push({ c: a, sSelf: Math.max(0, b.pl.length - 1), sOther: Math.max(0, a.pl.length - 1), merge: true });
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
