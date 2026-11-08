// Chunked, endless terrain. Fields come from WorldGen at a 16 m node grid, cached per 1 km chunk as bytes, and
// are read back with a cubic B-spline. The ground shader does the exact same B-spline on the same bytes, so the
// water/mountain edge drawn on screen is the edge the rules use.

import type { V2 } from "../core/math";
import { F, MOUNTAIN_STEPS, NF, WorldGen, riverWater, riverWidth, RIVER_K, RIVER_S } from "./gen";

export { F, MOUNTAIN_STEPS, NF, riverWater, waterOf } from "./gen";

export const RES = 16; // metres between field nodes
export const CH = 64; // nodes per chunk side (chunk = 1024 m)
export const CHUNK_M = RES * CH;
const MAX_CHUNKS = 2600;

const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);
/** hint bits: no water, no mountain (bit 4: worked out) */
const DRY = 1, LOW = 2;

/** Cubic B-spline weights for fraction t. */
export function bspline(t: number, w: Float64Array | number[]) {
  const t2 = t * t, t3 = t2 * t;
  w[0] = (1 - 3 * t + 3 * t2 - t3) / 6;
  w[1] = (4 - 6 * t2 + 3 * t3) / 6;
  w[2] = (1 + 3 * t + 3 * t2 - 3 * t3) / 6;
  w[3] = t3 / 6;
}

export class Terrain {
  readonly gen: WorldGen;
  private chunks = new Map<number, Uint8Array>();
  /** per chunk node: what the fields round it rule out (see hint) */
  private hints = new Map<number, Uint8Array>();
  private wx = new Float64Array(4);
  private wy = new Float64Array(4);
  private buf = new Float32Array(NF);

  constructor(readonly seed: number) {
    this.gen = new WorldGen(seed);
  }

  /** Field bytes of chunk (ci, cj): node (i, j) field f at [(j * CH + i) * NF + f]. Generated on first use. */
  chunk(ci: number, cj: number): Uint8Array {
    const k = key(ci, cj);
    let c = this.chunks.get(k);
    if (c) return c;
    c = new Uint8Array(CH * CH * NF);
    const o = this.buf;
    for (let j = 0; j < CH; j++) {
      for (let i = 0; i < CH; i++) {
        this.gen.at((ci * CH + i) * RES, (cj * CH + j) * RES, o);
        const b = (j * CH + i) * NF;
        for (let f = 0; f < NF; f++) c[b + f] = Math.round(o[f] * 255);
      }
    }
    if (this.chunks.size >= MAX_CHUNKS) {
      const old = this.chunks.keys().next().value!;
      this.chunks.delete(old);
      this.hints.delete(old);
    }
    this.chunks.set(k, c);
    return c;
  }

  hasChunk(ci: number, cj: number): boolean {
    return this.chunks.has(key(ci, cj));
  }

  /** Raw byte of field f at global node (gi, gj). */
  node(f: number, gi: number, gj: number): number {
    const ci = Math.floor(gi / CH), cj = Math.floor(gj / CH);
    return this.chunk(ci, cj)[((gj - cj * CH) * CH + (gi - ci * CH)) * NF + f];
  }

  /** Field value 0..1 at world point. */
  sample(f: number, x: number, y: number): number {
    const u = x / RES, v = y / RES;
    const i = Math.floor(u), j = Math.floor(v);
    bspline(u - i, this.wx);
    bspline(v - j, this.wy);
    const ci = Math.floor((i - 1) / CH), cj = Math.floor((j - 1) / CH);
    let s = 0;
    if (Math.floor((i + 2) / CH) === ci && Math.floor((j + 2) / CH) === cj) {
      // whole 4x4 footprint in one chunk (the common case)
      const c = this.chunk(ci, cj);
      for (let b = 0; b < 4; b++) {
        const row = (j - 1 + b - cj * CH) * CH;
        let r = 0;
        for (let a = 0; a < 4; a++) r += c[(row + (i - 1 + a - ci * CH)) * NF + f] * this.wx[a];
        s += r * this.wy[b];
      }
    } else {
      for (let b = 0; b < 4; b++) {
        let r = 0;
        for (let a = 0; a < 4; a++) r += this.node(f, i - 1 + a, j - 1 + b) * this.wx[a];
        s += r * this.wy[b];
      }
    }
    return s / 255;
  }

  /** Water value at p (0.5 = shore): the larger of lake and river. */
  water(p: V2): number {
    return Math.max(this.sample(F.lake, p.x, p.y), riverWater(this.sample(F.river, p.x, p.y), this.sample(F.flow, p.x, p.y)));
  }

  isWater(p: V2): boolean {
    if (this.hint(p.x, p.y) & DRY) return false;
    return this.water(p) >= 0.5;
  }

  /**
   * What the field nodes round p rule out, without sampling: DRY (no water anywhere in the 16 m square p is in) and
   * LOW (no mountain). A B-spline sample is a weighted average of its 4x4 nodes with weights that sum to one, so it
   * never exceeds their largest value: when even that is below the threshold, every point of the square is too.
   * Exact, and most of the map is open land, so the rules (zoning tests thousands of points a road edit) skip the
   * spline there.
   */
  private hint(x: number, y: number): number {
    const i = Math.floor(x / RES), j = Math.floor(y / RES);
    const ci = Math.floor(i / CH), cj = Math.floor(j / CH);
    const k = key(ci, cj);
    let h = this.hints.get(k);
    if (!h) this.hints.set(k, (h = new Uint8Array(CH * CH)));
    const idx = (j - cj * CH) * CH + (i - ci * CH);
    let v = h[idx];
    if (!v) {
      let mtn = 0, lake = 0, flow = 0, rlo = 255, rhi = 0;
      for (let b = -1; b <= 2; b++) for (let a = -1; a <= 2; a++) {
        mtn = Math.max(mtn, this.node(F.mtn, i + a, j + b));
        lake = Math.max(lake, this.node(F.lake, i + a, j + b));
        flow = Math.max(flow, this.node(F.flow, i + a, j + b));
        const r = this.node(F.river, i + a, j + b);
        rlo = Math.min(rlo, r); rhi = Math.max(rhi, r);
      }
      // the river is widest where the flow is greatest and nearest its middle (0.5) where the encoding comes closest
      const lo = rlo / 255, hi = rhi / 255;
      const off = lo > 0.5 ? lo - 0.5 : hi < 0.5 ? 0.5 - hi : 0;
      const river = 0.5 + (RIVER_S * riverWidth(flow / 255) - off / 4) * RIVER_K;
      const eps = 1e-6;
      v = 4;
      if (lake / 255 < 0.5 - eps && river < 0.5 - eps) v |= DRY;
      if (mtn / 255 < MOUNTAIN_STEPS[0] - eps) v |= LOW;
      h[idx] = v;
    }
    return v;
  }

  mountainLevel(p: V2): number {
    const m = this.sample(F.mtn, p.x, p.y);
    let lvl = 0;
    for (let i = 0; i < MOUNTAIN_STEPS.length; i++) if (m >= MOUNTAIN_STEPS[i]) lvl = i + 1;
    return lvl;
  }

  isMountain(p: V2): boolean {
    if (this.hint(p.x, p.y) & LOW) return false;
    return this.sample(F.mtn, p.x, p.y) >= MOUNTAIN_STEPS[0];
  }

  /** Natural resource present (deposit / fertile soil / forest) at p. */
  has(f: number, p: V2): boolean {
    return this.sample(f, p.x, p.y) >= 0.5;
  }

  /** The world is endless; this only guards against absurd coordinates. */
  inBounds(p: V2, _margin = 0): boolean {
    return Math.abs(p.x) < 4e5 && Math.abs(p.y) < 4e5;
  }
}
