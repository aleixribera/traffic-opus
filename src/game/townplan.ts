// A town's street plan (docs/design.md, "Towns": "a cool layout, not just squared", owner 2026-11-08). Every town
// still grows on a lattice of nodes (i, j) and lays the edges between neighbours one at a time (towns.ts nextEdge),
// but the lattice is bent into a plan of its own, seeded per town: a straight main street through the hall's
// crossroads, side streets that curve with the land, rings and spokes round the centre in some towns and long
// American blocks in others, streets pulled back from water and mountain so they run along the shore, some streets
// left out (bigger, uneven blocks, T-junctions and closes), and greens kept open among the homes. The crossroads and
// the four blocks round it stay square: the hall's square and the town's first streets are the same in every town.
//
// Towns from saves before this keep the plain grid (style 0: no bending, nothing left out), and towns from v0.0.69
// saves keep that version's rings and spokes (style 1). Every town since gets PLAN_TOWN (style 2, owner 2026-11-08:
// "organic, expanding outward, less dense", not a spider web): a small American town that grew over time. Its main
// street runs straight through the old town and past it bends away with the land; a through street runs every
// fourth line of the lattice (the cross road among them), leaning its own way on each side of the main street; and
// the land between four through streets (a quarter) is filled the way one builder would have laid it out: long
// blocks along the main street with their cross streets staggered (T-junctions, not crossroads), the same turned
// across, a loose grid, a spine with closes off it, or a loop drive round a green. A quarter's streets bow together.
// The town grows out further along its roads and toward open land, other towns and the player's roads, and less
// toward water, mountain, forest and the company's works (the lean), so every town has its own lopsided outline.

import { dist, dot, norm, pointSegDist2, sub, type V2 } from "../core/math";
import { Noise2D, mulberry32 } from "../core/noise";
import { chainPoints, makeChain } from "../roads/planner";
import { BLOCK, edgeKey, type GridEdge } from "./towns";

/** The plain square grid (towns from older saves). */
export const PLAN_GRID = 0;
/** The rings-and-spokes plan of v0.0.69 (towns from its saves keep it). */
export const PLAN_ORGANIC = 1;
/** The plan every new town gets: a small American town that grew over time (see the header). */
export const PLAN_TOWN = 2;

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

/** Lattice lines from one PLAN_TOWN through street to the next (towns.ts highLine puts the high streets on them). */
const SB = 4;
/** How a quarter (the land between four through streets) is laid out. */
const Q_GRID = 0, Q_LONG = 1, Q_ACROSS = 2, Q_CLOSES = 3, Q_LOOP = 4;
interface Quarter {
  kind: number;
  /** which of the staggered patterns its cross streets take (brick) */
  variant: number;
  /** closes: the spine runs along i (else along j), in from local line `from` (0 or 4), on to the far side or not */
  spineH: boolean; from: number; through: boolean; flip: number;
  /** loop: the sides it is joined on (1: -i, 2: +i, 4: -j, 8: +j), and whether the land inside it is a green */
  sides: number; green: boolean;
  /** how its streets bow: the middle of the quarter shifted this far (blocks) */
  dx: number; dy: number;
}
/** Directions round the centre a town's lean is kept in. */
export const LEAN_N = 32;
/** How much further out a town grows along its main street, and along its cross road, than elsewhere. */
const RIBBON_MAIN = 1.6, RIBBON_CROSS = 1.25;
/** Staggered cross streets (the local lines of a quarter they run on), for even and odd bands: T-junctions. */
const BRICK = [[[2], [1, 3]], [[1, 3], [2]], [[1], [3]], [[3], [1]]];

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
  // (PLAN_TOWN) how the streets across the main street lean on each side of it (tan), how the main street bends
  // past the old town on each side (radians a block), how far a quarter's streets bow (blocks)
  private shearN = 0;
  private shearS = 0;
  private curveE = 0;
  private curveW = 0;
  private bow = 0;
  private quarters = new Map<string, Quarter>();
  private lines = [new Map<number, number>(), new Map<number, number>()];
  /** (PLAN_TOWN) how far it grows each way: from its own character, and from the land round it (setLean) */
  private leanBase = new Float64Array(LEAN_N).fill(1);
  private leanAll = new Float64Array(LEAN_N).fill(1);
  /** what the lean was last worked out from (settlements.ts) */
  leanKey = "";

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
    if (style === PLAN_TOWN) {
      this.polar = 0; this.stretch = 1; this.swirl = 0; this.prune = 0;
      this.bend = 0.16 + rnd() * 0.18;
      this.bow = 0.25 + rnd() * 0.3;
      // the cross road and the streets beside it lean off square on either side of the main street (or don't)
      const lean = () => (rnd() < 0.4 ? 0 : (rnd() - 0.5) * 1.2);
      this.shearN = lean();
      this.shearS = lean();
      // the main street runs straight through the old town, and past it bends gently away (or runs on straight)
      const curve = () => (rnd() < 0.3 ? 0 : (rnd() - 0.5) * 0.09);
      this.curveE = curve();
      this.curveW = curve();
      this.parks = 0.07 + rnd() * 0.05;
      this.gardens = 0.14 + rnd() * 0.08;
      // its own lopsidedness: a few slow waves round the compass
      const w: [number, number][] = [[0.18 + rnd() * 0.22, rnd() * 6.283], [0.1 + rnd() * 0.18, rnd() * 6.283], [rnd() * 0.12, rnd() * 6.283]];
      for (let k = 0; k < LEAN_N; k++) {
        const th = (k / LEAN_N) * Math.PI * 2;
        this.leanBase[k] = Math.exp(w.reduce((a, [amp, ph], n) => a + amp * Math.cos((n + 1) * (th - ph)), 0));
      }
      this.setLean(null);
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
    if (this.style === PLAN_TOWN) return this.localTown(i, j);
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

  /**
   * Where lattice line n lies across its axis (0: the lines along j, at i = n; 1: along i), in blocks. Past the
   * first ring each block has a width of its own, so blocks come in different sizes; fractional n in between.
   */
  private lineAt(axis: 0 | 1, n: number): number {
    const f = Math.floor(n), t = n - f;
    const a = this.linePos(axis, f);
    return t ? a + (this.linePos(axis, f + 1) - a) * t : a;
  }

  private linePos(axis: 0 | 1, n: number): number {
    if (Math.abs(n) <= 1) return n;
    const L = this.lines[axis];
    const got = L.get(n);
    if (got !== undefined) return got;
    const s = Math.sign(n);
    // (blocks along the main street run a little longer than across it)
    const w = axis === 0 ? 0.86 + this.hash(n, 21) * 0.42 : 0.84 + this.hash(n, 22) * 0.34;
    const p = this.linePos(axis, n - s) + s * w;
    L.set(n, p);
    return p;
  }

  /** PLAN_TOWN's lattice point (i, j), fractional too, in the plan's own frame (see the header). */
  private localTown(i: number, j: number): V2 {
    const k = Math.max(Math.abs(i), Math.abs(j));
    // (nothing moves inside the first ring: the crossroads, the hall's square and the blocks round it stay square)
    const ramp = smooth((k - 1) / 2);
    let x = this.lineAt(0, i), y = this.lineAt(1, j);
    if (ramp <= 0) return { x, y };
    // a quarter's streets bow together (its through streets, round it, don't move)
    const I = Math.floor(i / SB), J = Math.floor(j / SB);
    const q = this.quarter(I, J);
    const w = Math.sin((Math.PI * (i - I * SB)) / SB) * Math.sin((Math.PI * (j - J * SB)) / SB) * ramp;
    x += q.dx * w;
    y += q.dy * w;
    // the side streets wander a little with the land (the main street and the cross road stay true)
    const L = 4.2, A = this.bend * ramp;
    x += this.nx.noise(i / L + 17.3, j / L - 4.1) * A * Math.min(1, Math.abs(i) / 1.5);
    y += this.ny.noise(i / L - 9.7, j / L + 2.9) * A * Math.min(1, Math.abs(j) / 1.5);
    // across the main street, the streets lean off square, each side its own way (eased in past the first ring)
    const ay = Math.abs(y);
    if (ay > 1.2) x += (y > 0 ? this.shearN : this.shearS) * (ay < 2.4 ? ((ay - 1.2) * (ay - 1.2)) / 2.4 : ay - 1.8);
    // past the old town the main street bends away, and the town along it follows it round
    const sx = x >= 0 ? 1 : -1;
    const x0 = Math.abs(this.linePos(0, sx * SB));
    const kap = sx > 0 ? this.curveE : this.curveW;
    const s = Math.abs(x) - x0;
    if (s <= 0 || !kap) return { x, y };
    // (an arc of the main street, turning at most 0.6 rad, then straight on)
    const s1 = Math.min(s, 0.6 / Math.abs(kap)), th = kap * s1;
    let mx = x0 + Math.sin(th) / kap, my = (1 - Math.cos(th)) / kap;
    mx += Math.cos(th) * (s - s1);
    my += Math.sin(th) * (s - s1);
    return { x: sx * mx - sx * Math.sin(th) * y, y: my + Math.cos(th) * y };
  }

  /** A PLAN_TOWN quarter: the land between through streets I·SB..(I+1)·SB along i and J·SB..(J+1)·SB along j. */
  private quarter(I: number, J: number): Quarter {
    const key = `${I},${J}`;
    const got = this.quarters.get(key);
    if (got) return got;
    const h = (n: number) => this.hash(I, J, n, 41);
    const core = (I === 0 || I === -1) && (J === 0 || J === -1);
    const byMain = J === 0 || J === -1;
    const r = h(1);
    // the old town round the crossroads: long blocks along the main street, or a loose grid; along the main street
    // mostly the same; further out, each quarter as its builder laid it out
    const kind = core ? (r < 0.25 ? Q_GRID : Q_LONG)
      : byMain ? (r < 0.45 ? Q_LONG : r < 0.57 ? Q_GRID : r < 0.8 ? Q_ACROSS : Q_CLOSES)
      : r < 0.22 ? Q_LONG : r < 0.44 ? Q_ACROSS : r < 0.68 ? Q_CLOSES : r < 0.88 ? Q_LOOP : Q_GRID;
    // (a spine comes in from the side toward the centre; a loop is joined on that side, and maybe one more)
    const spineH = h(3) < 0.5;
    const from = spineH ? (I >= 0 ? 0 : SB) : J >= 0 ? 0 : SB;
    const inward = Math.abs(I + 0.5) >= Math.abs(J + 0.5) ? (I >= 0 ? 1 : 2) : J >= 0 ? 4 : 8;
    const other = [1, 2, 4, 8].filter((b) => b !== inward)[Math.floor(h(7) * 3)];
    const ang = h(9) * Math.PI * 2, amp = (core ? 0.3 : kind === Q_GRID ? 0.5 : 1) * this.bow;
    const q: Quarter = {
      kind, variant: Math.floor(h(2) * 4), spineH, from, through: h(4) < 0.3, flip: h(5) < 0.5 ? 0 : 1,
      sides: inward | (h(6) < 0.5 ? other : 0), green: h(8) < 0.45, dx: Math.cos(ang) * amp, dy: Math.sin(ang) * amp,
    };
    this.quarters.set(key, q);
    return q;
  }

  /**
   * Is the lattice edge from (i0, j0) to (i1, j1) (i1 >= i0, j1 >= j0) a street of a PLAN_TOWN plan, by its pattern
   * alone (the land is looked at in has)?
   */
  private planned(i0: number, j0: number, i1: number, j1: number): boolean {
    if (Math.max(Math.abs(i0), Math.abs(j0), Math.abs(i1), Math.abs(j1)) <= 1) return true;
    const along = j0 === j1;
    // the through streets: the main street, the cross road and every fourth line
    if ((along ? j0 : i0) % SB === 0) return true;
    const I = Math.floor(i0 / SB), J = Math.floor(j0 / SB);
    const a = i0 - I * SB, b = j0 - J * SB;
    const q = this.quarter(I, J);
    // (the corners of the old town's ring go on one way only, so they are T-junctions: a quarter of long blocks
    // carries on its long street, a loose grid either way)
    const cor = Math.abs(i0) === 1 && Math.abs(j0) === 1 ? [i0, j0] : Math.abs(i1) === 1 && Math.abs(j1) === 1 ? [i1, j1] : null;
    if (cor && along !== (q.kind === Q_LONG || this.hash(cor[0], cor[1], 67) < 0.5)) return false;
    const h = this.hash(i0, j0, i1, j1, 7);
    switch (q.kind) {
      case Q_GRID: return h >= 0.2;
      case Q_LONG: return along ? this.long(a, i0, j0, h) : this.brick(a, j0, q.variant, h);
      case Q_ACROSS: return along ? this.brick(b, i0, q.variant, h) : this.long(b, j0, i0, h);
      case Q_CLOSES: return q.spineH ? this.closes(q, along, a, b) : this.closes(q, !along, b, a);
      default: return this.loop(q, along, a, b);
    }
  }

  /**
   * A long street of a quarter of long blocks, its `at`-th block (0..3) from the through street before it, on lattice
   * line `line`, starting at lattice position `pos` along it. Where it meets a through street, the long street of
   * the quarter beyond mostly doesn't (one side or the other, by the junction): T-junctions, not crossroads.
   */
  private long(at: number, pos: number, line: number, h: number): boolean {
    if (at !== 0 && at !== SB - 1) return h >= 0.04;
    // (which side meets the through street at lattice position X on this line: before it, after it, or both)
    const X = at === 0 ? pos : pos + 1;
    const side = this.hash(X, line, 61);
    return at === 0 ? side >= 0.45 : side < 0.55;
  }

  /** A cross street of a quarter of long blocks: on line `at` (1..3) in band `band`, staggered from band to band. */
  private brick(at: number, band: number, variant: number, h: number): boolean {
    return BRICK[variant][band & 1].includes(at) ? h >= 0.08 : h >= 0.97;
  }

  /**
   * A quarter of closes, seen with its spine along local line 2 the first way (a: along it, b: across): the spine
   * in from its side, and short closes off it, one side then the other.
   */
  private closes(q: Quarter, along: boolean, a: number, b: number): boolean {
    const end = q.from === 0 ? SB - 1 : 1;
    if (along) return b === 2 && (q.through || (q.from === 0 ? a < SB - 1 : a > 0));
    if (b === 0 || b === SB - 1 || (!q.through && a === end)) return false;
    const up = ((a + q.flip) & 1) === 1;
    return b === 2 ? up : !up;
  }

  /** A loop quarter: a loop drive round the middle of it, joined to the through streets on its sides. */
  private loop(q: Quarter, along: boolean, a: number, b: number): boolean {
    if (along) {
      if ((b === 1 || b === 3) && (a === 1 || a === 2)) return true;
      return b === 2 && ((a === 0 && !!(q.sides & 1)) || (a === 3 && !!(q.sides & 2)));
    }
    if ((a === 1 || a === 3) && (b === 1 || b === 2)) return true;
    return a === 2 && ((b === 0 && !!(q.sides & 4)) || (b === 3 && !!(q.sides & 8)));
  }

  /** How far a PLAN_TOWN node is drawn off its lattice point (blocks): closes' heads in, a loop's corners round. */
  private nudge(i: number, j: number): [number, number] {
    const I = Math.floor(i / SB), J = Math.floor(j / SB);
    const a = i - I * SB, b = j - J * SB;
    if (!a || !b) return [0, 0];
    const q = this.quarter(I, J);
    if (q.kind === Q_LOOP) return a !== 2 && b !== 2 ? [(2 - a) * 0.24, (2 - b) * 0.24] : [0, 0];
    if (q.kind !== Q_CLOSES) return [0, 0];
    // (seen the spine's way: u along it, v across)
    const [u, v] = q.spineH ? [a, b] : [b, a];
    let du = 0, dv = 0;
    if (v !== 2) dv = (2 - v) * 0.3;
    else if (!q.through && u === (q.from === 0 ? SB - 1 : 1)) du = (q.from === 0 ? -1 : 1) * 0.25;
    return q.spineH ? [du, dv] : [dv, du];
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
    let p: V2 | null;
    if (this.style === PLAN_TOWN) {
      const [di, dj] = this.nudge(i, j);
      p = this.at(i + di, j + dj);
    } else p = this.at(i, j);
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

  /**
   * How far out node (i, j) counts when the town decides where to grow next (towns.ts nextEdge), in blocks: its
   * distance over how far the town leans that way, so a PLAN_TOWN town fills out a lopsided shape of its own rather
   * than a circle, and runs on further along its main street and cross road (ribbons of homes out of town).
   */
  growR(i: number, j: number): number {
    const p = this.pt(i, j);
    if (!p) return Infinity;
    const d = dist(p, this.c) / BLOCK;
    if (this.style !== PLAN_TOWN) return d;
    let f = this.leanAt(Math.atan2(p.y - this.c.y, p.x - this.c.x));
    if (j === 0 && Math.abs(i) >= 2) f *= RIBBON_MAIN;
    else if (i === 0 && Math.abs(j) >= 2) f *= RIBBON_CROSS;
    return d / f;
  }

  /** How far the town leans toward map angle th (1: as far as a round town would reach; about 0.55 to 1.8). */
  leanAt(th: number): number {
    const u = ((((th / (Math.PI * 2)) * LEAN_N) % LEAN_N) + LEAN_N) % LEAN_N;
    const k = Math.floor(u), t = u - k;
    const L = this.leanAll;
    return L[k % LEAN_N] * (1 - t) + L[(k + 1) % LEAN_N] * t;
  }

  /**
   * The land's say in the lean (settlements.ts: water, mountain and forest put the town off, roads and other towns
   * draw it): a factor for each of LEAN_N directions round the compass, from east turning toward +y (null: none).
   * Mixed with the town's own lopsidedness and evened out so the town still has the area its people need.
   */
  setLean(land: ArrayLike<number> | null) {
    const raw = new Float64Array(LEAN_N);
    for (let k = 0; k < LEAN_N; k++) raw[k] = this.leanBase[k] * (land ? land[k] : 1);
    // (smoothed round the compass, so the outline swells and narrows gently)
    const sm = new Float64Array(LEAN_N);
    for (let k = 0; k < LEAN_N; k++) sm[k] = (raw[(k + LEAN_N - 1) % LEAN_N] + 2 * raw[k] + raw[(k + 1) % LEAN_N]) / 4;
    // (as much land in all as a round town: the factors' mean square is one)
    const rms = Math.sqrt(sm.reduce((a, v) => a + v * v, 0) / LEAN_N) || 1;
    for (let k = 0; k < LEAN_N; k++) this.leanAll[k] = Math.max(0.55, Math.min(1.8, sm[k] / rms));
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
    if (ok && this.style === PLAN_TOWN) {
      const [i0, j0, i1, j1] = e[0] < e[2] || (e[0] === e[2] && e[1] < e[3]) ? e : [e[2], e[3], e[0], e[1]];
      ok = this.planned(i0, j0, i1, j1);
    } else if (ok && this.style !== PLAN_GRID) {
      const ring = Math.max(Math.abs(e[0]), Math.abs(e[1]), Math.abs(e[2]), Math.abs(e[3]));
      // the main street and the cross street run on; past the centre, some of the rest are left out (more toward
      // the edge of town, where they leave closes and dead ends)
      const main = (e[1] === 0 && e[3] === 0) || (e[0] === 0 && e[2] === 0 && ring <= 3);
      if (!main && ring >= 2) {
        const [i0, j0, i1, j1] = e[0] < e[2] || (e[0] === e[2] && e[1] < e[3]) ? e : [e[2], e[3], e[0], e[1]];
        ok = this.hash(i0, j0, i1, j1, 7) >= this.prune * (ring >= 4 ? 1.35 : 1);
      }
    }
    // (a street whose line crosses water or mountain is no street of the plan, so no land is kept clear for it)
    if (ok && this.style !== PLAN_GRID) {
      const s = this.shape(e);
      const pts = chainPoints(makeChain(s.ta ? "curve" : "straight", s.a, s.b, s.ta), 12);
      ok = pts.every((p) => !this.land.isWater(p) && !this.land.isMountain(p));
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
    // (the land inside a loop drive is all one green, or all homes)
    // (and only where every street round it can be laid)
    const L = this.loopOf(fi, fj);
    if (L) return L.green && this.loopRing(fi, fj).every((e) => this.has(e));
    // more parks among the inner streets, fewer at the edge
    const rate = this.parks * (ring < 5 ? 1.25 : 0.7);
    if (this.style !== PLAN_TOWN) return this.hash(fi, fj, 11) < rate;
    // (greens spread through the town, never two side by side)
    // (and with streets on two sides of it at least, so it is a green and not a field behind the houses)
    const r2 = rate * 1.2;
    return this.hash(fi, fj, 11) < r2 && this.hash(fi - 1, fj, 11) >= r2 && this.hash(fi, fj - 1, 11) >= r2
      && this.sidesOf(fi, fj).filter((e) => this.has(e)).length >= 2;
  }

  /** The four lattice edges round block (fi, fj), in order round it. */
  sidesOf(fi: number, fj: number): GridEdge[] {
    return [[fi, fj, fi + 1, fj], [fi + 1, fj, fi + 1, fj + 1], [fi, fj + 1, fi + 1, fj + 1], [fi, fj, fi, fj + 1]];
  }

  /** The PLAN_TOWN loop quarter whose loop drive block (fi, fj) lies inside, if it does. */
  private loopOf(fi: number, fj: number): Quarter | null {
    if (this.style !== PLAN_TOWN) return null;
    const I = Math.floor(fi / SB), J = Math.floor(fj / SB);
    const a = fi - I * SB, b = fj - J * SB;
    if (a < 1 || a > 2 || b < 1 || b > 2) return null;
    const q = this.quarter(I, J);
    return q.kind === Q_LOOP ? q : null;
  }

  /** Does block (fi, fj) lie inside a loop drive (its green, if it has one, is drawn whole: loopGreen)? */
  inLoop(fi: number, fj: number): boolean {
    return !!this.loopOf(fi, fj);
  }

  /**
   * The loop drive round a quarter's green, as its eight streets in order round it, when block (fi, fj) is the
   * first of the four blocks inside it and they are a green (null otherwise).
   */
  loopGreen(fi: number, fj: number): GridEdge[] | null {
    const i = Math.floor(fi / SB) * SB, j = Math.floor(fj / SB) * SB;
    if (fi - i !== 1 || fj - j !== 1 || !this.green(fi, fj)) return null;
    return this.loopRing(fi, fj);
  }

  /** The streets round block (fi, fj)'s green: its loop drive's, inside one, else its own four sides. */
  streetsRound(fi: number, fj: number): GridEdge[] {
    return this.loopOf(fi, fj) ? this.loopRing(fi, fj) : this.sidesOf(fi, fj);
  }

  /** The eight streets of the loop drive of the quarter block (fi, fj) lies in, in order round it. */
  private loopRing(fi: number, fj: number): GridEdge[] {
    const i = Math.floor(fi / SB) * SB, j = Math.floor(fj / SB) * SB;
    const R = [[1, 1], [2, 1], [3, 1], [3, 2], [3, 3], [2, 3], [1, 3], [1, 2]];
    return R.map(([a, b], k) => [i + a, j + b, i + R[(k + 1) % 8][0], j + R[(k + 1) % 8][1]]);
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
    // (the streets a builder laid inside a quarter: a drive with its courts, a circle)
    if (this.style === PLAN_TOWN && n % SB !== 0) {
      const I = Math.floor(Math.min(e[0], e[2]) / SB), J = Math.floor(Math.min(e[1], e[3]) / SB);
      const q = this.quarter(I, J);
      const tree = trees[Math.floor(this.hash(I, J, 51) * 16)];
      if (q.kind === Q_LOOP) return `${tree} Circle`;
      if (q.kind === Q_CLOSES) return along === q.spineH ? `${tree} Drive` : `${trees[Math.floor(this.hash(e[0], e[1], e[2], e[3], 52) * 16)]} Court`;
    }
    const old =["Church", "Mill", "School", "Water", "Union", "Spring", "Liberty", "Bridge", "Market", "Depot", "Railroad", "Grove", "Park", "Prospect", "Pleasant", "Washington"];
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
