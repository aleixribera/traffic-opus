// The pre-built motorway (CS2 starts you next to one): from the nearest gateway city, past the start, on to a
// gateway on the far side. Routed over the terrain with A* (hills are expensive, rivers are bridged), simplified
// to long straights joined by large-radius curves, then laid as two one-way carriageways.

import { LEVEL_H, ROAD_TYPES, roadWidth, type RoadTypeId } from "../config";
import { add, angleOf, arcCubics, dist, dot, norm, right, scale, straightCubic, sub, v2, type Cubic, type V2 } from "../core/math";
import { F, waterOf, type Gateway, type WorldGen } from "./gen";

const CELL = 80;
const MEDIAN = 4; // gap between the carriageways' edges
export const MOTORWAY_TYPE: RoadTypeId = "hw2";

type Prim = { k: "line"; a: V2; b: V2 } | { k: "arc"; c: V2; r: number; a0: number; sweep: number };

export interface MotorwayPlan {
  from: Gateway;
  to: Gateway;
  centre: V2[]; // simplified centreline corners
  prims: Prim[];
  /** Arc-length intervals [s0, s1] along the centreline that must be bridges. */
  bridges: [number, number][];
}

/** Cost of driving a metre over ground (1 = open land). */
function groundCost(gen: WorldGen, p: V2, o: Float32Array): number {
  gen.at(p.x, p.y, o);
  let c = 1;
  const m = o[F.mtn];
  if (m > 0.4) c += (m - 0.4) * 260; // hills: cut through only when the detour is long
  if (waterOf(o) >= 0.5) c += 7; // bridges are dear, so cross rivers square-on and lakes not at all
  if (o[F.forest] >= 0.5) c += 0.15;
  return c;
}

/** Grid A* between two points; returns the cell-centre path. */
function astar(gen: WorldGen, a: V2, b: V2): V2[] {
  const o = new Float32Array(8);
  const pad = 9000;
  const x0 = Math.min(a.x, b.x) - pad, y0 = Math.min(a.y, b.y) - pad;
  const W = Math.ceil((Math.max(a.x, b.x) + pad - x0) / CELL), H = Math.ceil((Math.max(a.y, b.y) + pad - y0) / CELL);
  const idx = (i: number, j: number) => j * W + i;
  const cost = new Float32Array(W * H).fill(-1);
  const g = new Float32Array(W * H).fill(Infinity);
  const from = new Int32Array(W * H).fill(-1);
  const closed = new Uint8Array(W * H);
  const cellCost = (k: number) => {
    if (cost[k] < 0) cost[k] = groundCost(gen, v2(x0 + ((k % W) + 0.5) * CELL, y0 + (Math.floor(k / W) + 0.5) * CELL), o);
    return cost[k];
  };
  const si = Math.floor((a.x - x0) / CELL), sj = Math.floor((a.y - y0) / CELL);
  const ti = Math.floor((b.x - x0) / CELL), tj = Math.floor((b.y - y0) / CELL);
  const start = idx(si, sj), goal = idx(ti, tj);
  // binary heap of [f, k]
  const hf: number[] = [], hk: number[] = [];
  const push = (f: number, k: number) => {
    let i = hf.length;
    hf.push(f); hk.push(k);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (hf[p] <= hf[i]) break;
      [hf[p], hf[i]] = [hf[i], hf[p]]; [hk[p], hk[i]] = [hk[i], hk[p]];
      i = p;
    }
  };
  const pop = () => {
    const k = hk[0];
    const lf = hf.pop()!, lk = hk.pop()!;
    if (hf.length) {
      hf[0] = lf; hk[0] = lk;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < hf.length && hf[l] < hf[m]) m = l;
        if (r < hf.length && hf[r] < hf[m]) m = r;
        if (m === i) break;
        [hf[m], hf[i]] = [hf[i], hf[m]]; [hk[m], hk[i]] = [hk[i], hk[m]];
        i = m;
      }
    }
    return k;
  };
  const hdist = (k: number) => Math.hypot((k % W) - ti, Math.floor(k / W) - tj) * CELL;
  g[start] = 0;
  push(hdist(start), start);
  const D = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1], [2, 1], [1, 2], [-2, 1], [-1, 2], [2, -1], [1, -2], [-2, -1], [-1, -2]];
  while (hf.length) {
    const k = pop();
    if (k === goal) break;
    if (closed[k]) continue;
    closed[k] = 1;
    const i = k % W, j = Math.floor(k / W);
    const ck = cellCost(k);
    for (const [di, dj] of D) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W || nj >= H) continue;
      const n = idx(ni, nj);
      if (closed[n]) continue;
      let c = (ck + cellCost(n)) * 0.5;
      if (Math.abs(di) + Math.abs(dj) === 3) c = Math.max(c, cellCost(idx(i + Math.sign(di), j + Math.sign(dj))));
      const ng = g[k] + Math.hypot(di, dj) * CELL * c;
      if (ng < g[n]) {
        g[n] = ng;
        from[n] = k;
        push(ng + hdist(n), n);
      }
    }
  }
  const path: V2[] = [];
  for (let k = goal; k >= 0; k = from[k]) path.push(v2(x0 + ((k % W) + 0.5) * CELL, y0 + (Math.floor(k / W) + 0.5) * CELL));
  path.reverse();
  path[0] = a;
  path[path.length - 1] = b;
  return path;
}

/** Cost of the straight line a-b, sampled every 40 m. */
function lineCost(gen: WorldGen, a: V2, b: V2, o: Float32Array): number {
  const L = dist(a, b), n = Math.max(1, Math.ceil(L / 40));
  let c = 0;
  for (let k = 0; k < n; k++) {
    const t = (k + 0.5) / n;
    c += groundCost(gen, v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t), o);
  }
  return (c / n) * L;
}

/** String-pull the grid path: keep a straight line while it costs no more than the path it replaces. */
function simplify(gen: WorldGen, path: V2[]): V2[] {
  const o = new Float32Array(8);
  const pc: number[] = [0];
  for (let i = 1; i < path.length; i++) pc.push(pc[i - 1] + lineCost(gen, path[i - 1], path[i], o));
  const out = [path[0]];
  let i = 0;
  while (i < path.length - 1) {
    let best = i + 1;
    for (let j = i + 2; j < path.length; j++) {
      if (lineCost(gen, path[i], path[j], o) <= (pc[j] - pc[i]) * 1.04 + 30) best = j;
      else if (j - best > 40) break;
    }
    out.push(path[best]);
    i = best;
  }
  return out;
}

/** Corners -> straights and arcs. Each corner gets the largest radius (up to rMax) its neighbours allow. */
function fillet(pts: V2[], rMax: number): Prim[] {
  const prims: Prim[] = [];
  let cur = pts[0];
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], p = pts[i], b = pts[i + 1];
    const d0 = norm(sub(p, a)), d1 = norm(sub(b, p));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot(d0, d1))));
    if (turn < 0.004) continue;
    const tmax = Math.min(dist(a, p) * (i === 1 ? 1 : 0.5), dist(p, b) * (i === pts.length - 2 ? 1 : 0.5), dist(cur, p));
    const r = Math.min(rMax, tmax / Math.tan(turn / 2));
    const t = r * Math.tan(turn / 2);
    const s = sub(p, scale(d0, t)), e = add(p, scale(d1, t));
    const side = d0.x * d1.y - d0.y * d1.x > 0 ? 1 : -1; // +1 turns right (clockwise on screen)
    const c = add(s, scale(right(d0), r * side));
    if (dist(cur, s) > 0.5) prims.push({ k: "line", a: cur, b: s });
    prims.push({ k: "arc", c, r, a0: angleOf(sub(s, c)), sweep: turn * side });
    cur = e;
  }
  prims.push({ k: "line", a: cur, b: pts[pts.length - 1] });
  return prims;
}

function primLen(p: Prim) {
  return p.k === "line" ? dist(p.a, p.b) : p.r * Math.abs(p.sweep);
}

function primAt(p: Prim, s: number): V2 {
  if (p.k === "line") { const t = s / Math.max(1e-9, dist(p.a, p.b)); return v2(p.a.x + (p.b.x - p.a.x) * t, p.a.y + (p.b.y - p.a.y) * t); }
  const ang = p.a0 + Math.sign(p.sweep) * (s / p.r);
  return add(p.c, v2(Math.cos(ang) * p.r, Math.sin(ang) * p.r));
}

/** Sample the centreline every `step` metres. */
export function centrePoints(prims: Prim[], step = 20): V2[] {
  const out: V2[] = [];
  for (const p of prims) {
    const L = primLen(p), n = Math.max(1, Math.ceil(L / step));
    for (let k = out.length ? 1 : 0; k <= n; k++) out.push(primAt(p, (L * k) / n));
  }
  return out;
}

/**
 * Plan the motorway: nearest gateway -> past the start -> the gateway that lies most opposite.
 * It passes `pass` metres from the origin and runs straight for a while there, ready for a first interchange.
 */
export function planMotorway(gen: WorldGen, gws: Gateway[], pass = 560): MotorwayPlan | null {
  if (gws.length < 2) return null;
  const byDist = [...gws].sort((a, b) => Math.hypot(a.p.x, a.p.y) - Math.hypot(b.p.x, b.p.y));
  const from = byDist[0];
  const ua = norm(from.p);
  let to = byDist[1], best = -Infinity;
  for (const g of byDist.slice(1)) {
    const d = Math.hypot(g.p.x, g.p.y);
    const s = -dot(ua, norm(g.p)) * 30000 - d; // opposite side first, then near
    if (s > best) { best = s; to = g; }
  }
  // the straight past the start: perpendicular to the origin, on the side the line between the gateways lies
  const dir = norm(sub(to.p, from.p));
  let n = right(dir);
  if (dot(n, from.p) < 0) n = scale(n, -1);
  const mid = scale(n, pass);
  const runIn = sub(mid, scale(dir, 1400)), runOut = add(mid, scale(dir, 1400));
  // leave each gateway from its edge
  const ea = add(from.p, scale(norm(sub(runIn, from.p)), from.r * 0.8));
  const eb = add(to.p, scale(norm(sub(runOut, to.p)), to.r * 0.8));
  const p1 = simplify(gen, astar(gen, ea, runIn));
  const p2 = simplify(gen, astar(gen, runOut, eb));
  const corners = [...p1, ...p2];
  const prims = fillet(corners, 1400);
  // bridges: where the centreline is over water, padded for the climb
  const o = new Float32Array(8);
  const pts = centrePoints(prims, 10);
  const wet: [number, number][] = [];
  let s = 0, open = -1;
  for (let i = 0; i < pts.length; i++) {
    if (i) s += dist(pts[i - 1], pts[i]);
    const w = waterOf(gen.at(pts[i].x, pts[i].y, o)) >= 0.42;
    if (w && open < 0) open = s;
    if (!w && open >= 0) { wet.push([open, s]); open = -1; }
  }
  const bridges: [number, number][] = [];
  for (const [a, b] of wet) {
    const iv: [number, number] = [a - 110, b + 110];
    const last = bridges[bridges.length - 1];
    if (last && iv[0] < last[1] + 150) last[1] = iv[1];
    else bridges.push(iv);
  }
  return { from, to, centre: corners, prims, bridges };
}

/** Offset a primitive to the right by `off` metres (negative = left). */
function offsetPrim(p: Prim, off: number): Prim {
  if (p.k === "line") {
    const n = scale(right(norm(sub(p.b, p.a))), off);
    return { k: "line", a: add(p.a, n), b: add(p.b, n) };
  }
  // turning right (sweep > 0) the centre is on the right, so a right offset shrinks the radius
  return { ...p, r: p.r - Math.sign(p.sweep) * off };
}

function reversePrim(p: Prim): Prim {
  if (p.k === "line") return { k: "line", a: p.b, b: p.a };
  return { k: "arc", c: p.c, r: p.r, a0: p.a0 + p.sweep, sweep: -p.sweep };
}

export interface Carriageway {
  /** Pieces in driving order with the height at each end. */
  pieces: { c: Cubic; h0: number; h1: number }[];
}

/**
 * The two carriageways as cubic pieces: forward (from -> to) keeps right of the centreline, backward the other
 * way on the left. Long straights are cut into ~600 m pieces; bridge ends get their own nodes.
 */
export function carriageways(plan: MotorwayPlan): [Carriageway, Carriageway] {
  const W = roadWidth(ROAD_TYPES[MOTORWAY_TYPE]);
  const off = W / 2 + MEDIAN / 2;
  // height along the centreline: bridges at one level, with 100 m ramps at each end
  const hAt = (s: number) => {
    for (const [a, b] of plan.bridges) {
      if (s >= a + 100 && s <= b - 100) return LEVEL_H;
      if (s > a - 0.5 && s < b + 0.5) return LEVEL_H * Math.max(0, Math.min(1, Math.min(s - a, b - s) / 100));
    }
    return 0;
  };
  const marks = plan.bridges.flatMap(([a, b]) => [a, a + 100, b - 100, b]);
  /** prims in driving order, each with the centreline s where it starts and ends (s may run backwards). */
  const mk = (prims: { p: Prim; c0: number; c1: number }[]): Carriageway => {
    const pieces: Carriageway["pieces"] = [];
    for (const { p, c0, c1 } of prims) {
      const L = primLen(p);
      const toC = (t: number) => c0 + ((c1 - c0) * t) / L;
      const cuts = [0, L];
      const n = Math.max(1, Math.ceil(L / 600));
      for (let k = 1; k < n; k++) cuts.push((L * k) / n);
      for (const m of marks) {
        const t = ((m - c0) / (c1 - c0)) * L;
        if (t > 1 && t < L - 1) cuts.push(t);
      }
      cuts.sort((x, y) => x - y);
      const cs: number[] = [0];
      for (const c of cuts) if (c - cs[cs.length - 1] > 8) cs.push(c);
      cs[cs.length - 1] = L;
      for (let k = 0; k < cs.length - 1; k++) {
        const a = cs[k], b = cs[k + 1];
        const cubics = p.k === "line"
          ? [straightCubic(primAt(p, a), primAt(p, b))]
          : arcCubics(p.c, p.r, p.a0 + Math.sign(p.sweep) * (a / p.r), Math.sign(p.sweep) * ((b - a) / p.r));
        const l = (b - a) / cubics.length;
        cubics.forEach((c, q) => pieces.push({ c, h0: hAt(toC(a + l * q)), h1: hAt(toC(a + l * (q + 1))) }));
      }
    }
    return { pieces };
  };
  let acc = 0;
  const spans = plan.prims.map((p) => { const c0 = acc; acc += primLen(p); return { p, c0, c1: acc }; });
  const fwd = mk(spans.map(({ p, c0, c1 }) => ({ p: offsetPrim(p, off), c0, c1 })));
  const back = mk([...spans].reverse().map(({ p, c0, c1 }) => ({ p: offsetPrim(reversePrim(p), off), c0: c1, c1: c0 })));
  return [fwd, back];
}
