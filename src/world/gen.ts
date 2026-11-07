// Endless procedural world: deterministic fields from the seed, evaluated at any point.
// Large-scale structure (tens of km): mountain ranges, river valleys with fertile plains, forest belts.
// Small-scale (hundreds of m): hills, lakes, patches. The start sits at (0, 0) on open buildable land.
// Mineral deposits are placed by tier (docs/design.md, "The map"): the further a chain is in the game, the further
// from the start its deposits lie, and two kinds are never next to each other.

import { Noise2D, mulberry32 } from "../core/noise";

/**
 * Field indices, all 0..1. Most use 0.5 as the "present" threshold. Two are special:
 * - river holds the signed river noise s as 0.5 + 4s. Rivers are thin (|s| < RIVER_S) but s itself is smooth, so a
 *   coarse grid of s still draws a crisp river at any zoom. Water is max(lake, riverWater(river)).
 * - flow (0..1) is how much river runs there: rivers taper out where it falls, so they start and end instead of
 *   forming closed loops.
 */
export const F = { mtn: 0, lake: 1, river: 2, flow: 3, fert: 4, forest: 5, ore: 6, oil: 7, coal: 8, lime: 9, sand: 10, copper: 11 } as const;
export const NF = 12;

export type DepositKey = "ore" | "coal" | "lime" | "oil" | "sand" | "copper";
export interface DepositDef {
  key: DepositKey;
  field: number;
  name: string;
  tier: number;
  /** a first deposit of this kind is always found this far from the start (m) */
  ring: [number, number];
  /** further ones recur from this distance on */
  from: number;
}

/** Mined deposits, by tier. Fertile soil and forest (tier 1) are natural fields and are everywhere. */
export const DEPOSITS: DepositDef[] = [
  { key: "ore", field: F.ore, name: "Iron ore", tier: 2, ring: [3400, 6500], from: 3000 },
  { key: "coal", field: F.coal, name: "Coal", tier: 2, ring: [3400, 6500], from: 3000 },
  { key: "lime", field: F.lime, name: "Limestone", tier: 2, ring: [3400, 6500], from: 3000 },
  { key: "oil", field: F.oil, name: "Oil", tier: 3, ring: [7000, 11500], from: 6000 },
  { key: "sand", field: F.sand, name: "Sand", tier: 3, ring: [7000, 11500], from: 6000 },
  { key: "copper", field: F.copper, name: "Copper ore", tier: 4, ring: [11000, 16000], from: 10000 },
];

/** A deposit blob: centre and radius (m, world coordinates), and which field it raises. */
interface Site { x: number; y: number; r: number; field: number }
/** Size of the cells further deposits are scattered in (one deposit at most per cell, near its middle). */
const CELL = 2600;
export const RIVER_S = 0.0095;
export const RIVER_K = 30;
/** Water value (0.5 = shore) of the river and flow field values. */
export const riverWater = (enc: number, flow: number) => 0.5 + (RIVER_S * riverWidth(flow) - Math.abs((enc - 0.5) / 4)) * RIVER_K;
/** River width factor from the flow field: rivers taper out instead of thinning to hairlines. */
export const riverWidth = (flow: number) => ss(0.3, 0.75, flow);
/** Water value of a field sample (lake or river). */
export const waterOf = (o: ArrayLike<number>) => Math.max(o[F.lake], riverWater(o[F.river], o[F.flow]));

/** Terrace thresholds of the mountain field. Level k is solid where m >= MOUNTAIN_STEPS[k-1]. */
export const MOUNTAIN_STEPS = [0.5, 0.6, 0.7, 0.8];

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export class WorldGen {
  private N: Noise2D[];
  /** Offset from world coordinates to noise space (moves the chosen start spot to the origin). */
  ox = 0;
  oy = 0;
  private tmp = new Float32Array(NF);
  private tmp2 = new Float32Array(NF);
  /** The first deposit of each kind (and the start's forest and fertile patch), placed once per world. */
  readonly sites: (Site & { key: DepositKey | "fert" | "forest" })[] = [];
  private cells = new Map<number, Site | null>();

  constructor(readonly seed: number) {
    this.N = Array.from({ length: 16 }, (_, i) => new Noise2D(seed * 131 + i * 7 + 3));
    this.findStart();
    this.placeSites();
  }

  /** Fields at world point (x, y) into out[0..NF). */
  at(x: number, y: number, out: Float32Array = this.tmp): Float32Array {
    this.raw(x + this.ox, y + this.oy, out);
    // the start: open land, no lakes right on top of it
    const d0 = Math.hypot(x, y);
    if (d0 < 2600) {
      const k = ss(1300, 2600, d0);
      out[F.mtn] = lerp(Math.min(out[F.mtn], 0.42), out[F.mtn], k);
      const kw = ss(650, 1500, d0);
      out[F.lake] = lerp(Math.min(out[F.lake], 0.42), out[F.lake], kw);
      // keep rivers out of the start: push |s| above the river width
      const s = (out[F.river] - 0.5) / 4;
      const sMin = lerp(0.016, 0, kw);
      if (Math.abs(s) < sMin) out[F.river] = 0.5 + (s < 0 ? -sMin : sMin) * 4;
      // thin the forest so the start has room
      out[F.forest] = lerp(Math.min(out[F.forest], 0.44), out[F.forest], ss(350, 1100, d0));
    }
    this.deposits(x, y, out);
    return out;
  }

  /** Raise each deposit field inside its blobs: the guaranteed first sites, then one per cell further out. */
  private deposits(x: number, y: number, out: Float32Array) {
    for (const s of this.sites) this.blob(s, x, y, out);
    const ci = Math.floor(x / CELL), cj = Math.floor(y / CELL);
    for (let j = cj - 1; j <= cj + 1; j++) for (let i = ci - 1; i <= ci + 1; i++) {
      const s = this.cell(i, j);
      if (s) this.blob(s, x, y, out);
    }
    // never under water
    if (waterOf(out) >= 0.5) for (const d of DEPOSITS) out[d.field] = Math.min(out[d.field], 0.3);
  }

  private blob(s: Site, x: number, y: number, out: Float32Array) {
    const dx = x - s.x, dy = y - s.y;
    const R = s.r * 1.4;
    if (dx * dx + dy * dy > R * R) return;
    const d = Math.hypot(dx, dy);
    const edge = this.N[13].fbm(x / 420 + s.field * 13.1, y / 420 - s.field * 7.7, 3) * 0.55;
    const v = clamp01(0.5 + (1 - d / s.r) * 0.75 + edge);
    if (v > out[s.field]) out[s.field] = v;
  }

  /** Whether a spot is dry, flat land a deposit can sit on (sampled across radius r). */
  private usable(x: number, y: number, r: number): boolean {
    const o = this.tmp2;
    for (const [a, b] of [[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]]) {
      this.raw(x + a + this.ox, y + b + this.oy, o);
      if (o[F.mtn] >= 0.46 || waterOf(o) >= 0.45) return false;
    }
    return true;
  }

  /** The guaranteed first deposits: each tier's kinds spread round the start, in its distance band. */
  private placeSites() {
    const rnd = mulberry32(this.seed * 919 + 5);
    const put = (key: DepositKey | "fert" | "forest", field: number, ring: [number, number], ang: number, r: number) => {
      for (let k = 0; k < 40; k++) {
        const a = ang + (rnd() - 0.5) * (k < 20 ? 0.7 : 2.4);
        const R = ring[0] + rnd() * (ring[1] - ring[0]);
        const x = Math.cos(a) * R, y = Math.sin(a) * R;
        // clear of the other kinds' sites
        if (this.sites.some((s) => Math.hypot(s.x - x, s.y - y) < s.r + r + 900)) continue;
        if (k < 36 && !this.usable(x, y, r)) continue;
        this.sites.push({ key, field, x, y, r });
        return;
      }
    };
    // tier 1 near the start: a fertile patch and a forest, on opposite sides
    const a1 = rnd() * Math.PI * 2;
    put("fert", F.fert, [700, 1500], a1, 420);
    put("forest", F.forest, [1300, 2400], a1 + Math.PI, 460);
    for (const tier of [2, 3, 4]) {
      const kinds = DEPOSITS.filter((d) => d.tier === tier);
      const a0 = rnd() * Math.PI * 2;
      kinds.forEach((d, k) => put(d.key, d.field, d.ring, a0 + (k * Math.PI * 2) / kinds.length, 300 + rnd() * 110));
    }
  }

  /** The deposit of a scatter cell, if it has one: a kind whose distance band it is in, near the cell's middle. */
  private cell(i: number, j: number): Site | null {
    const k = (i + 32768) * 65536 + (j + 32768);
    if (this.cells.has(k)) return this.cells.get(k)!;
    let s: Site | null = null;
    const rnd = mulberry32((this.seed * 7919 + i * 73856093) ^ (j * 19349663));
    const x = (i + 0.5 + (rnd() - 0.5) * 0.5) * CELL, y = (j + 0.5 + (rnd() - 0.5) * 0.5) * CELL;
    const d = Math.hypot(x, y);
    const kinds = DEPOSITS.filter((dd) => d >= dd.from);
    if (kinds.length && rnd() < 0.5) {
      const kind = kinds[Math.floor(rnd() * kinds.length)];
      const r = 260 + rnd() * 130;
      const clear = this.sites.every((o) => Math.hypot(o.x - x, o.y - y) > o.r + r + 1400);
      if (clear && this.usable(x, y, r)) s = { x, y, r, field: kind.field };
    }
    if (this.cells.size > 20000) this.cells.clear();
    this.cells.set(k, s);
    return s;
  }

  /** Fields in noise space, before the start clearing. */
  raw(X: number, Y: number, out: Float32Array) {
    const N = this.N;
    const wx = X + N[0].fbm(X / 3000, Y / 3000, 3) * 900;
    const wy = Y + N[1].fbm(X / 3000 + 40.3, Y / 3000 - 17.1, 3) * 900;
    // mountain ranges: a slow mask picks where ranges run; ridged noise draws the crests
    const range = ss(0.04, 0.34, N[2].fbm(wx / 26000, wy / 26000, 3));
    const ridge = N[3].ridged(wx / 6000, wy / 6000, 4);
    const hills = N[4].fbm(wx / 1400, wy / 1400, 3);
    let m = range * (ridge * 1.1 - 0.2) + hills * 0.17 + 0.2;
    // rivers: thin channels where a slow warped noise crosses zero; they cut valleys through ranges
    const sr = N[5].fbm(wx / 9000 + 3.3, wy / 9000 - 8.8, 3);
    // only some channels carry a river; elsewhere they fade out (and so do their valleys and plains)
    const flow = ss(-0.12, 0.2, N[14].fbm(X / 32000 - 2.7, Y / 32000 + 6.1, 2));
    const r = Math.abs(sr) + (1 - flow) * 0.07;
    const valley = ss(0.012, 0.055, r);
    m = lerp(Math.min(m, 0.36), m, valley);
    if (m > 0.45) m = 0.45 + (m - 0.45) * 1.35;
    // lakes in the lowlands
    const l = N[6].fbm(wx / 2600, wy / 2600, 4);
    const lake = 0.5 + (l - 0.43) * 2.4 - range * 0.7 - (m > 0.42 ? 0.4 : 0);
    let lakeW = lake;
    if (m >= MOUNTAIN_STEPS[0] - 0.06) lakeW = Math.min(lakeW, 0.3);
    const water = Math.max(lakeW, 0.5 + (RIVER_S * riverWidth(flow) - Math.abs(sr)) * RIVER_K);
    // fertile plains along the river valleys
    const nearRiver = 1 - ss(0.0, 0.11, r);
    const fert = 0.3 + nearRiver * 0.55 + N[7].fbm(X / 3500, Y / 3500, 3) * 0.45 - range * 0.55;
    // forest belts with patchy edges
    const belt = ss(-0.12, 0.28, N[8].fbm(X / 15000 + 5.5, Y / 15000 + 2.2, 2));
    const patch = N[9].fbm(X / 900, Y / 900, 3);
    let forest = 0.5 + patch * 0.75 + belt * 0.62 - 0.5 - Math.max(0, fert - 0.5) * 0.9;
    if (water >= 0.5) forest = Math.min(forest, 0.3);
    out[F.mtn] = clamp01(m);
    out[F.lake] = clamp01(lakeW);
    out[F.river] = clamp01(0.5 + sr * 4);
    out[F.flow] = flow;
    out[F.fert] = clamp01(fert);
    out[F.forest] = clamp01(forest);
    // (mined deposits are added by deposits(), in world coordinates)
    for (const d of DEPOSITS) out[d.field] = 0;
  }

  /** Pick open land near the noise origin: no hills within 1.6 km, a river within reach, little water. */
  private findStart() {
    const o = new Float32Array(NF);
    const rnd = mulberry32(this.seed * 77 + 1);
    let best = { x: 0, y: 0, s: -Infinity };
    for (let k = 0; k < 220; k++) {
      const a = rnd() * Math.PI * 2, R = Math.sqrt(rnd()) * 40000;
      const cx = Math.cos(a) * R, cy = Math.sin(a) * R;
      let s = 0, mt = 0, wt = 0, riv = Infinity, fert = 0, fo = 0;
      for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
        const x = cx + i * 300, y = cy + j * 300;
        this.raw(x, y, o);
        const d = Math.hypot(i, j) * 300;
        if (d < 1700 && o[F.mtn] >= 0.48) mt++;
        if (d < 900 && waterOf(o) >= 0.5) wt++;
        if (d < 1000 && o[F.forest] >= 0.5) fo++;
        if (waterOf(o) >= 0.5) riv = Math.min(riv, d);
        fert += o[F.fert] + o[F.forest] * 0.5;
      }
      s = fert * 0.2 - mt * 4 - wt * 3 - fo * 1.5 - (riv < 900 ? 3 : 0) - (riv > 3000 ? 8 : 0);
      if (s > best.s) best = { x: cx, y: cy, s };
    }
    this.ox = best.x;
    this.oy = best.y;
  }
}

function clamp01(x: number) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

const SYL_A = ["Al", "Bran", "Cal", "Dor", "El", "Fen", "Gar", "Hal", "Ist", "Kel", "Lor", "Mar", "Nor", "Os", "Pell", "Quen", "Ros", "Sel", "Tor", "Val", "Wen", "Yar"];
const SYL_B = ["ford", "mere", "wick", "haven", "stead", "brook", "field", "port", "ridge", "ton", "vale", "bury", "moor", "gate", "holm"];

export function cityName(rnd: () => number): string {
  return SYL_A[Math.floor(rnd() * SYL_A.length)] + SYL_B[Math.floor(rnd() * SYL_B.length)];
}
