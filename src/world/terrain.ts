import { MAP } from "../config";
import { Noise2D } from "../core/noise";
import type { V2 } from "../core/math";

/** Terrace thresholds of the mountain field. Level k is solid where m >= MOUNTAIN_STEPS[k-1]. */
export const MOUNTAIN_STEPS = [0.5, 0.6, 0.7, 0.8];
export const WATER_STEP = 0.5;
export const RES = 4; // metres per field cell

export class Terrain {
  readonly size = MAP.size;
  readonly n: number; // cells per side (+1 samples)
  readonly mountain: Float32Array;
  readonly water: Float32Array;
  readonly grass: Float32Array;
  readonly sand: Float32Array;

  constructor(readonly seed: number) {
    this.n = Math.round(this.size / RES) + 1;
    const N = this.n * this.n;
    this.mountain = new Float32Array(N);
    this.water = new Float32Array(N);
    this.grass = new Float32Array(N);
    this.sand = new Float32Array(N);
    this.generate();
  }

  private generate() {
    const nm = new Noise2D(this.seed * 7 + 1);
    const nw = new Noise2D(this.seed * 7 + 2);
    const ng = new Noise2D(this.seed * 7 + 3);
    const ns = new Noise2D(this.seed * 7 + 4);
    const nwarp = new Noise2D(this.seed * 7 + 5);
    const c = this.size / 2;
    for (let j = 0; j < this.n; j++) {
      for (let i = 0; i < this.n; i++) {
        const x = i * RES, y = j * RES;
        const k = j * this.n + i;
        // domain warp gives the soft, blobby shapes
        const wx = x + nwarp.fbm(x / 420, y / 420, 2) * 120;
        const wy = y + nwarp.fbm(x / 420 + 31, y / 420 + 17, 2) * 120;
        const dc = Math.hypot(x - c, y - c);
        const clearCentre = Math.min(1, Math.max(0, (dc - 140) / 220)); // keep the very middle buildable
        let m = nm.fbm(wx / 520, wy / 520, 4, 2.1, 0.5) * 0.85 + 0.38;
        m = m * (0.55 + 0.45 * clearCentre);
        // ridges: sharpen highs so terraces stack
        if (m > 0.45) m = 0.45 + (m - 0.45) * 1.35;
        this.mountain[k] = m;
        let w = nw.fbm(wx / 380 + 9, wy / 380 + 4, 3) * 0.9 + 0.32;
        w = w * (0.6 + 0.4 * clearCentre);
        if (m > MOUNTAIN_STEPS[0] - 0.08) w = Math.min(w, 0.3); // no lakes on mountains
        this.water[k] = w;
        this.grass[k] = ng.fbm(wx / 230, wy / 230, 3) * 0.9 + 0.5;
        this.sand[k] = ns.fbm(wx / 300 + 3, wy / 300 + 8, 3) * 0.9 + 0.32 + Math.max(0, w - 0.38) * 1.6;
      }
    }
  }

  sample(field: Float32Array, x: number, y: number): number {
    const fx = Math.min(Math.max(x / RES, 0), this.n - 1.001);
    const fy = Math.min(Math.max(y / RES, 0), this.n - 1.001);
    const i = Math.floor(fx), j = Math.floor(fy);
    const tx = fx - i, ty = fy - j;
    const k = j * this.n + i;
    const a = field[k], b = field[k + 1], c = field[k + this.n], d = field[k + this.n + 1];
    return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
  }

  isWater(p: V2): boolean {
    return this.sample(this.water, p.x, p.y) >= WATER_STEP;
  }

  mountainLevel(p: V2): number {
    const m = this.sample(this.mountain, p.x, p.y);
    let lvl = 0;
    for (let i = 0; i < MOUNTAIN_STEPS.length; i++) if (m >= MOUNTAIN_STEPS[i]) lvl = i + 1;
    return lvl;
  }

  isMountain(p: V2): boolean {
    return this.sample(this.mountain, p.x, p.y) >= MOUNTAIN_STEPS[0];
  }

  inBounds(p: V2, margin = 0): boolean {
    return p.x >= margin && p.y >= margin && p.x <= this.size - margin && p.y <= this.size - margin;
  }

  /** Marching-squares contour loops of `field >= level`, in world coordinates, closed and smoothed. */
  contours(field: Float32Array, level: number): V2[][] {
    const n = this.n;
    // pad edges with "outside" so all loops close
    const val = (i: number, j: number) => (i < 0 || j < 0 || i >= n || j >= n ? -1 : field[j * n + i]);
    type Edge = { a: string; b: string; pa: V2; pb: V2 };
    const edges = new Map<string, Edge>();
    const key = (x: number, y: number) => `${Math.round(x * 100)},${Math.round(y * 100)}`;
    const interp = (i0: number, j0: number, i1: number, j1: number): V2 => {
      const v0 = val(i0, j0), v1 = val(i1, j1);
      const t = (level - v0) / (v1 - v0 || 1e-9);
      return { x: (i0 + (i1 - i0) * t) * RES, y: (j0 + (j1 - j0) * t) * RES };
    };
    for (let j = -1; j < n; j++) {
      for (let i = -1; i < n; i++) {
        const tl = val(i, j) >= level ? 1 : 0;
        const tr = val(i + 1, j) >= level ? 1 : 0;
        const br = val(i + 1, j + 1) >= level ? 1 : 0;
        const bl = val(i, j + 1) >= level ? 1 : 0;
        const code = tl * 8 + tr * 4 + br * 2 + bl;
        if (code === 0 || code === 15) continue;
        const top = () => interp(i, j, i + 1, j);
        const rightE = () => interp(i + 1, j, i + 1, j + 1);
        const bottom = () => interp(i, j + 1, i + 1, j + 1);
        const left = () => interp(i, j, i, j + 1);
        const segs: [V2, V2][] = [];
        // orientation: solid on the left when walking a->b
        switch (code) {
          case 1: segs.push([left(), bottom()]); break;
          case 2: segs.push([bottom(), rightE()]); break;
          case 3: segs.push([left(), rightE()]); break;
          case 4: segs.push([rightE(), top()]); break;
          case 5: segs.push([left(), top()], [rightE(), bottom()]); break;
          case 6: segs.push([bottom(), top()]); break;
          case 7: segs.push([left(), top()]); break;
          case 8: segs.push([top(), left()]); break;
          case 9: segs.push([top(), bottom()]); break;
          case 10: segs.push([top(), rightE()], [bottom(), left()]); break;
          case 11: segs.push([top(), rightE()]); break;
          case 12: segs.push([rightE(), left()]); break;
          case 13: segs.push([rightE(), bottom()]); break;
          case 14: segs.push([bottom(), left()]); break;
        }
        for (const [pa, pb] of segs) {
          const a = key(pa.x, pa.y), b = key(pb.x, pb.y);
          if (a === b) continue;
          edges.set(a, { a, b, pa, pb });
        }
      }
    }
    const loops: V2[][] = [];
    while (edges.size) {
      const first = edges.values().next().value as Edge;
      edges.delete(first.a);
      const loop: V2[] = [first.pa];
      let cur = first;
      let guard = 0;
      while (guard++ < 1e6) {
        const nx = edges.get(cur.b);
        if (!nx) break;
        edges.delete(nx.a);
        loop.push(nx.pa);
        cur = nx;
      }
      if (loop.length >= 6) loops.push(chaikin(simplify(loop, 1.2), 2));
    }
    return loops;
  }
}

function simplify(pts: V2[], tol: number): V2[] {
  // drop nearly collinear points (cheap Douglas-Peucker substitute for dense grids)
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = out.length ? out[out.length - 1] : pts[pts.length - 1];
    const b = pts[i], c = pts[(i + 1) % pts.length];
    const area = Math.abs((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x));
    if (area > tol * Math.hypot(c.x - a.x, c.y - a.y) * 0.5 || i % 3 === 0) out.push(b);
  }
  return out;
}

function chaikin(pts: V2[], iters: number): V2[] {
  let p = pts;
  for (let k = 0; k < iters; k++) {
    const o: V2[] = [];
    for (let i = 0; i < p.length; i++) {
      const a = p[i], b = p[(i + 1) % p.length];
      o.push({ x: a.x * 0.75 + b.x * 0.25, y: a.y * 0.75 + b.y * 0.25 });
      o.push({ x: a.x * 0.25 + b.x * 0.75, y: a.y * 0.25 + b.y * 0.75 });
    }
    p = o;
  }
  return p;
}
