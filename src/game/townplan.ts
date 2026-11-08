// A town's street plan (docs/design.md, "Towns": "a cool layout, not just squared", owner 2026-11-08). Every town
// still grows on a lattice of nodes (i, j) and lays the edges between neighbours one at a time (towns.ts nextEdge),
// but the lattice is bent into a plan of its own, seeded per town: a straight main street through the hall's
// crossroads, side streets that curve with the land, rings and spokes round the centre in some towns and long
// American blocks in others, streets pulled back from water and mountain so they run along the shore, some streets
// left out (bigger, uneven blocks, T-junctions and closes), and greens kept open among the homes. The crossroads and
// the four blocks round it stay square: the hall's square and the town's first streets are the same in every town.
//
// Towns from saves before this keep the plain grid (style 0: no bending, nothing left out).

import { dist, dot, norm, pointSegDist2, sub, type V2 } from "../core/math";
import { Noise2D, mulberry32 } from "../core/noise";
import { chainPoints, makeChain } from "../roads/planner";
import { BLOCK, edgeKey, type GridEdge } from "./towns";

/** The plain square grid (towns from older saves). */
export const PLAN_GRID = 0;
/** The organic plan every new town gets. */
export const PLAN_ORGANIC = 1;

/** What a plan needs to know of the land. */
export interface PlanLand {
  isWater(p: V2): boolean;
  isMountain(p: V2): boolean;
}

/** One stretch of a planned street's centreline, for the zoning's lookups. */
interface Piece { k: string; e: GridEdge; a: V2; b: V2; s0: number; len: number }

/** A planned street near a point: the edge, where on it, and its direction there. */
export interface EdgeHit { e: GridEdge; k: string; foot: V2; dir: V2; d: number; along: number }

/** Spokes-and-rings radius of lattice ring k (blocks): a little over k, so the rings keep the spokes a block apart. */
const RHO = 1.12;
/** How far land must be clear round a node for a junction there (m). */
const NODE_CLEAR = 14;
/** Buckets of the zoning's lookups (m). */
const CELL = 32;

const smooth = (t: number) => { const k = Math.max(0, Math.min(1, t)); return k * k * (3 - 2 * k); };

/** A town's plan: where each lattice node and street lies, which streets and greens it has. */
export class TownPlan {
  /** how far toward spokes and rings (0: a grid) */
  readonly polar: number;
  /** blocks along the main street are this much longer than across it (from the second ring out) */
  readonly stretch: number;
  /** how far the noise bends the side streets (blocks) */
  readonly bend: number;
  /** a slow swirl of the outer streets round the centre (radians per block out) */
  readonly swirl: number;
  /** share of the outer streets left out */
  readonly prune: number;
  /** share of blocks kept as greens, and of street fronts left as gardens */
  readonly parks: number;
  readonly gardens: number;
  private nx: Noise2D;
  private ny: Noise2D;
  private salt: number;
  private nodes = new Map<string, V2 | null>();
  private edges = new Map<string, boolean>();
  private shapes = new Map<string, { a: V2; b: V2; ta?: V2 }>();
  private u: V2;
  /** the square's quadrant: the green faces it across the main street */
  sq: [number, number] = [1, 1];

  constructor(readonly c: V2, readonly ang: number, readonly style: number, seed: number, private land: PlanLand) {
    const rnd = mulberry32(seed);
    this.salt = (rnd() * 0x7fffffff) | 0;
    this.nx = new Noise2D(seed * 3 + 1);
    this.ny = new Noise2D(seed * 3 + 2);
    this.u = { x: Math.cos(ang), y: Math.sin(ang) };
    if (style === PLAN_GRID) {
      this.polar = 0; this.stretch = 1; this.bend = 0; this.swirl = 0; this.prune = 0; this.parks = 0; this.gardens = 0;
      return;
    }
    // each town its own character: from a market town of long straight blocks to a round town of rings and spokes
    const kind = rnd();
    this.polar = kind < 0.3 ? rnd() * 0.25 : kind < 0.65 ? 0.35 + rnd() * 0.3 : 0.7 + rnd() * 0.25;
    this.stretch = 1 + rnd() * 0.3 * (1 - this.polar);
    this.bend = 0.16 + rnd() * 0.14;
    this.swirl = (rnd() - 0.5) * 0.12 * this.polar;
    this.prune = 0.1 + rnd() * 0.1;
    this.parks = 0.08 + rnd() * 0.05;
    this.gardens = 0.14 + rnd() * 0.08;
  }

  // ------------------------------------------------------------------ geometry

  /** Lattice point (i, j), fractional too, in the plan's own frame (blocks along and across the main street). */
  local(i: number, j: number): V2 {
    if (this.style === PLAN_GRID) return { x: i, y: j };
    const k = Math.max(Math.abs(i), Math.abs(j)), r = Math.hypot(i, j);
    // (nothing bends inside the first ring: the crossroads, the hall's square and the blocks round it stay square)
    const ramp = smooth((k - 1) / 1.5);
    if (ramp <= 0) return { x: i, y: j };
    const sx = 1 + (this.stretch - 1) * ramp;
    let x = i * sx, y = j;
    // rings and spokes: the lattice's square rings drawn out into circles
    const w = this.polar * ramp;
    if (w > 0 && r > 0) {
      const s = (k * RHO) / r;
      x += (i * s * sx - x) * w;
      y += (j * s - y) * w;
    }
    // a slow swirl round the centre (none along the main street, which stays straight)
    const side = Math.min(1, Math.abs(j) / 2);
    const th = this.swirl * Math.max(0, r - 1.5) * side;
    if (th) { const c = Math.cos(th), s = Math.sin(th); [x, y] = [x * c - y * s, x * s + y * c]; }
    // the side streets bend with the land; the main street only stretches along itself
    const L = 3.4, A = this.bend * ramp;
    x += this.nx.noise(i / L + 17.3, j / L - 4.1) * A;
    y += this.ny.noise(i / L - 9.7, j / L + 2.9) * A * Math.min(1, Math.abs(j) / 1.2);
    return { x, y };
  }

  /** Lattice point (i, j), fractional too, on the map (before any shift off water). */
  at(i: number, j: number): V2 {
    const q = this.local(i, j), u = this.u;
    return { x: this.c.x + (u.x * q.x - u.y * q.y) * BLOCK, y: this.c.y + (u.y * q.x + u.x * q.y) * BLOCK };
  }

  private clear(p: V2, r = NODE_CLEAR): boolean {
    const L = this.land;
    if (L.isWater(p) || L.isMountain(p)) return false;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const q = { x: p.x + dx * r, y: p.y + dy * r };
      if (L.isWater(q) || L.isMountain(q)) return false;
    }
    return true;
  }

  /**
   * Where node (i, j) stands, or null where the town can't put a junction. A node on water or mountain is drawn
   * back toward the centre, up to almost half a block, so the street along the shore follows it.
   */
  pt(i: number, j: number): V2 | null {
    const key = `${i},${j}`;
    const got = this.nodes.get(key);
    if (got !== undefined) return got;
    let p: V2 | null = this.at(i, j);
    if (this.style !== PLAN_GRID && Math.max(Math.abs(i), Math.abs(j)) > 1 && !this.clear(p)) {
      const back = norm(sub(this.c, p));
      let q: V2 | null = null;
      for (let f = 0.08; f <= 0.46 && !q; f += 0.06) {
        const t = { x: p.x + back.x * f * BLOCK, y: p.y + back.y * f * BLOCK };
        if (this.clear(t)) q = t;
      }
      p = q;
    }
    this.nodes.set(key, p);
    return p;
  }

  /** How far node (i, j) is from the centre, in blocks (Infinity where it can't stand). */
  r(i: number, j: number): number {
    const p = this.pt(i, j);
    return p ? dist(p, this.c) / BLOCK : Infinity;
  }

  /** A deterministic hash of a few integers, 0..1. */
  hash(...n: number[]): number {
    let h = this.salt ^ 0x9e3779b9;
    for (const v of n) h = Math.imul(h ^ (v | 0), 2246822519) ^ (h >>> 13);
    h = Math.imul(h ^ (h >>> 15), 2654435761);
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  /** Is this edge a street of the plan (both nodes standing, not left out, its line clear of water)? */
  has(e: GridEdge): boolean {
    const k = edgeKey(e);
    const got = this.edges.get(k);
    if (got !== undefined) return got;
    let ok = !!this.pt(e[0], e[1]) && !!this.pt(e[2], e[3]);
    if (ok && this.style !== PLAN_GRID) {
      const ring = Math.max(Math.abs(e[0]), Math.abs(e[1]), Math.abs(e[2]), Math.abs(e[3]));
      // the main street and the cross street run on; past the centre, some of the rest are left out (more toward
      // the edge of town, where they leave closes and dead ends)
      const main = (e[1] === 0 && e[3] === 0) || (e[0] === 0 && e[2] === 0 && ring <= 3);
      if (!main && ring >= 2) {
        const [i0, j0, i1, j1] = e[0] < e[2] || (e[0] === e[2] && e[1] < e[3]) ? e : [e[2], e[3], e[0], e[1]];
        ok = this.hash(i0, j0, i1, j1, 7) >= this.prune * (ring >= 4 ? 1.35 : 1);
      }
      // (a street whose line crosses water or mountain is no street of the plan, so no land is kept clear for it)
      if (ok) {
        const s = this.shape(e);
        const pts = chainPoints(makeChain(s.ta ? "curve" : "straight", s.a, s.b, s.ta), 12);
        ok = pts.every((p) => !this.land.isWater(p) && !this.land.isMountain(p));
      }
    }
    this.edges.set(k, ok);
    return ok;
  }

  /**
   * How a street is laid from its first node to its second: its ends, and the direction to leave the first along so
   * it follows the plan's bend (none: straight). It is the circle through both ends and the plan's midpoint, so
   * the street is the same whichever end it is laid from.
   */
  shape(e: GridEdge): { a: V2; b: V2; ta?: V2 } {
    const k = `${e[0]},${e[1]},${e[2]},${e[3]}`;
    const got = this.shapes.get(k);
    if (got) return got;
    const a = this.pt(e[0], e[1]) ?? this.at(e[0], e[1]), b = this.pt(e[2], e[3]) ?? this.at(e[2], e[3]);
    let out: { a: V2; b: V2; ta?: V2 } = { a, b };
    if (this.style !== PLAN_GRID) {
      // the plan's midpoint, carried along with any shift of the ends off the water
      const a0 = this.at(e[0], e[1]), b0 = this.at(e[2], e[3]);
      const m0 = this.at((e[0] + e[2]) / 2, (e[1] + e[3]) / 2);
      const m = { x: m0.x + (a.x - a0.x + b.x - b0.x) / 2, y: m0.y + (a.y - a0.y + b.y - b0.y) / 2 };
      const ch = norm(sub(b, a)), am = norm(sub(m, a));
      const half = Math.atan2(ch.x * am.y - ch.y * am.x, dot(ch, am));
      // (a hair of a bend is drawn straight; the tangent is the chord turned by twice the angle to the midpoint)
      if (Math.abs(half) > 0.02) {
        const c = Math.cos(2 * half), s = Math.sin(2 * half);
        out = { a, b, ta: norm({ x: ch.x * c - ch.y * s, y: ch.x * s + ch.y * c }) };
      }
    }
    this.shapes.set(k, out);
    return out;
  }

  /** The centreline a street of the plan will have, as points. */
  line(e: GridEdge, step = 6): V2[] {
    const s = this.shape(e);
    return chainPoints(makeChain(s.ta ? "curve" : "straight", s.a, s.b, s.ta), step);
  }

  // ------------------------------------------------------------------ greens

  /** Is block (fi, fj) (the lattice square from (fi, fj) to (fi+1, fj+1)) kept as a green? */
  green(fi: number, fj: number): boolean {
    if (this.style === PLAN_GRID) return false;
    const si = this.sq[0] > 0 ? 0 : -1, sj = this.sq[1] > 0 ? 0 : -1;
    if (fi === si && fj === sj) return false; // (the square itself: the hall's)
    // the town green, across the main street from the hall
    if (fi === si && fj === (sj === 0 ? -1 : 0)) return true;
    const ring = Math.max(Math.abs(fi + 0.5), Math.abs(fj + 0.5));
    if (ring < 1.5) return false;
    // more parks among the inner streets, fewer at the edge
    const rate = this.parks * (ring < 5 ? 1.25 : 0.7);
    return this.hash(fi, fj, 11) < rate;
  }

  /** Is the stretch of street front around `along` (m from the edge's first node) left as a garden? */
  garden(k: string, side: number, along: number): boolean {
    if (this.style === PLAN_GRID || !this.gardens) return false;
    let h = 0;
    for (let i = 0; i < k.length; i++) h = Math.imul(h ^ k.charCodeAt(i), 16777619);
    return this.hash(h, side, Math.floor(along / 26), 13) < this.gardens;
  }

  /**
   * The block on one side of a street of the plan: for an edge along i (j fixed), the block toward +j or -j; for
   * an edge along j, toward +i or -i. `toward` is a point on that side.
   */
  faceOf(e: GridEdge, toward: V2, foot: V2): [number, number] {
    const [i0, j0, , j1] = e[0] < e[2] || (e[0] === e[2] && e[1] < e[3]) ? e : [e[2], e[3], e[0], e[1]];
    if (j0 === j1) {
      const dir = sub(this.at(i0 + 0.5, j0 + 0.5), this.at(i0 + 0.5, j0));
      return dot(sub(toward, foot), dir) >= 0 ? [i0, j0] : [i0, j0 - 1];
    }
    const dir = sub(this.at(i0 + 0.5, j0 + 0.5), this.at(i0, j0 + 0.5));
    return dot(sub(toward, foot), dir) >= 0 ? [i0, j0] : [i0 - 1, j0];
  }

  /** The middle of block (fi, fj), and the corners of it inside its streets, on the map. */
  faceCorners(fi: number, fj: number): V2[] | null {
    const ps = [this.pt(fi, fj), this.pt(fi + 1, fj), this.pt(fi + 1, fj + 1), this.pt(fi, fj + 1)];
    return ps.every((p) => p) ? (ps as V2[]) : null;
  }

  // ------------------------------------------------------------------ names

  /** A street's name, from the line of the plan it is on: Main Street, the cross street, then trees and numbers. */
  nameOf(e: GridEdge): string {
    const along = e[1] === e[3];
    const n = along ? e[1] : e[0];
    if (n === 0) return along ? "Main Street" : "Court Street";
    const trees = ["Elm", "Oak", "Maple", "Walnut", "Chestnut", "Cedar", "Pine", "Locust", "Hickory", "Spruce", "Willow", "Poplar", "Sycamore", "Linden", "Magnolia", "Laurel"];
    const old = ["Church", "Mill", "School", "Water", "Union", "Spring", "Liberty", "Bridge", "Market", "Depot", "Railroad", "Grove", "Park", "Prospect", "Pleasant", "Washington"];
    if (along) return `${(n > 0 ? trees : old)[(Math.abs(n) - 1) % 16]} Street`;
    const k = Math.abs(n);
    const ord = k % 10 === 1 && k % 100 !== 11 ? "st" : k % 10 === 2 && k % 100 !== 12 ? "nd" : k % 10 === 3 && k % 100 !== 13 ? "rd" : "th";
    return n > 0 ? `${k}${ord} Street` : `${k}${ord} Avenue`;
  }

  // ------------------------------------------------------------------ lookups for the zoning

  private pieces = new Map<number, Piece[]>();
  private indexed = -1;

  /** Index every planned street within `blocks` of the centre (the zoning asks about land out to the town's reach). */
  index(blocks: number) {
    const K = Math.ceil(blocks) + 2;
    if (K <= this.indexed) return;
    for (let i = -K; i <= K; i++) for (let j = -K; j <= K; j++) {
      for (const [di, dj] of [[1, 0], [0, 1]]) {
        const ring = Math.max(Math.abs(i), Math.abs(j), Math.abs(i + di), Math.abs(j + dj));
        if (ring <= this.indexed || ring > K) continue;
        const e: GridEdge = [i, j, i + di, j + dj];
        if (!this.has(e)) continue;
        // (a straight street is one piece; a bent one a piece every 10 m, close enough to its arc for a lot's front)
        const s = this.shape(e);
        const pts = s.ta ? this.line(e, 10) : [s.a, s.b];
        const k = edgeKey(e);
        let at = 0;
        for (let n = 0; n + 1 < pts.length; n++) {
          const a = pts[n], b = pts[n + 1], len = dist(a, b);
          const pc: Piece = { k, e, a, b, s0: at, len };
          at += len;
          const x0 = Math.floor(Math.min(a.x, b.x) / CELL), x1 = Math.floor(Math.max(a.x, b.x) / CELL);
          const y0 = Math.floor(Math.min(a.y, b.y) / CELL), y1 = Math.floor(Math.max(a.y, b.y) / CELL);
          for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
            const bk = (x + 32768) * 65536 + (y + 32768);
            let L = this.pieces.get(bk);
            if (!L) this.pieces.set(bk, (L = []));
            L.push(pc);
          }
        }
      }
    }
    this.indexed = K;
  }

  /** Every piece in the buckets within r of p (a piece in two buckets comes twice: harmless to both lookups). */
  private near(p: V2, r: number, f: (pc: Piece) => boolean | void): void {
    const x0 = Math.floor((p.x - r) / CELL), x1 = Math.floor((p.x + r) / CELL);
    const y0 = Math.floor((p.y - r) / CELL), y1 = Math.floor((p.y + r) / CELL);
    for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) {
      const L = this.pieces.get((x + 32768) * 65536 + (y + 32768));
      if (L) for (let n = 0; n < L.length; n++) if (f(L[n])) return;
    }
  }

  /**
   * The planned street nearest p running about along `dir` (|cos| of the angle at least `align`), within maxD:
   * the street a lot at p fronts. Null if none.
   */
  edgeAt(p: V2, dir: V2, maxD: number, align = 0.8): EdgeHit | null {
    let best: EdgeHit | null = null;
    this.near(p, maxD, (pc) => {
      const r = pointSegDist2(p, pc.a, pc.b);
      const d = Math.sqrt(r.d2);
      if (d >= maxD || (best && d >= best.d)) return;
      const tx = pc.len > 1e-6 ? (pc.b.x - pc.a.x) / pc.len : dir.x, ty = pc.len > 1e-6 ? (pc.b.y - pc.a.y) / pc.len : dir.y;
      if (Math.abs(tx * dir.x + ty * dir.y) < align) return;
      const foot = { x: pc.a.x + (pc.b.x - pc.a.x) * r.t, y: pc.a.y + (pc.b.y - pc.a.y) * r.t };
      best = { e: pc.e, k: pc.k, foot, dir: { x: tx, y: ty }, d, along: pc.s0 + pc.len * r.t };
    });
    return best;
  }

  /** Does a planned street that `open` says is still to come pass within r of p (other than street `skip`)? */
  nearOpen(p: V2, r: number, skip: string | null, open: (k: string) => boolean): boolean {
    let hit = false;
    const r2 = r * r;
    this.near(p, r, (pc) => {
      if (pc.k === skip || pointSegDist2(p, pc.a, pc.b).d2 >= r2 || !open(pc.k)) return;
      return (hit = true);
    });
    return hit;
  }
}
