// Chunked, endless terrain. Fields come from WorldGen at a 16 m node grid, cached per 1 km chunk as bytes, and
// are read back with a cubic B-spline. The ground shader does the exact same B-spline on the same bytes, so the
// water/mountain edge drawn on screen is the edge the rules use.

import type { V2 } from "../core/math";
import { F, MOUNTAIN_STEPS, NF, WorldGen, riverWater } from "./gen";

export { F, MOUNTAIN_STEPS, NF, riverWater, waterOf } from "./gen";

export const RES = 16; // metres between field nodes
export const CH = 64; // nodes per chunk side (chunk = 1024 m)
export const CHUNK_M = RES * CH;
const MAX_CHUNKS = 2600;

const key = (ci: number, cj: number) => (ci + 32768) * 65536 + (cj + 32768);

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
    if (this.chunks.size >= MAX_CHUNKS) this.chunks.delete(this.chunks.keys().next().value!);
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
    return this.water(p) >= 0.5;
  }

  mountainLevel(p: V2): number {
    const m = this.sample(F.mtn, p.x, p.y);
    let lvl = 0;
    for (let i = 0; i < MOUNTAIN_STEPS.length; i++) if (m >= MOUNTAIN_STEPS[i]) lvl = i + 1;
    return lvl;
  }

  isMountain(p: V2): boolean {
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
