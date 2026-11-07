// Endless procedural world: deterministic fields from the seed, evaluated at any point.
// Large-scale structure (tens of km): mountain ranges, river valleys with fertile plains, forest belts, rare oil
// fields. Small-scale (hundreds of m): hills, lakes, patches. The start sits at (0, 0) on open buildable land.

import { Noise2D, mulberry32 } from "../core/noise";
import { dist, type V2 } from "../core/math";

/**
 * Field indices, all 0..1. Most use 0.5 as the "present" threshold. Two are special:
 * - river holds the signed river noise s as 0.5 + 4s. Rivers are thin (|s| < RIVER_S) but s itself is smooth, so a
 *   coarse grid of s still draws a crisp river at any zoom. Water is max(lake, riverWater(river)).
 * - flow (0..1) is how much river runs there: rivers taper out where it falls, so they start and end instead of
 *   forming closed loops.
 */
export const F = { mtn: 0, lake: 1, river: 2, flow: 3, fert: 4, forest: 5, ore: 6, oil: 7 } as const;
export const NF = 8;
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

export type GatewayKind = "port" | "capital" | "industry" | "farm" | "mining" | "tech";

export interface Gateway {
  id: number;
  name: string;
  kind: GatewayKind;
  p: V2; // where roads end (the city's edge)
  r: number; // radius of the city blob
}

const ss = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

/** Corridors carved through hills (pre-built motorways): spatial hash of polyline points. */
class Corridors {
  private cells = new Map<string, V2[]>();
  private readonly C = 400;
  add(pts: V2[]) {
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const n = Math.max(1, Math.ceil(dist(a, b) / 40));
      for (let k = 0; k <= n; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n };
        const key = `${Math.floor(p.x / this.C)},${Math.floor(p.y / this.C)}`;
        const l = this.cells.get(key);
        if (l) l.push(p); else this.cells.set(key, [p]);
      }
    }
  }
  /** Distance to the nearest corridor point (capped at the cell size). */
  near(x: number, y: number): number {
    if (!this.cells.size) return Infinity;
    const ci = Math.floor(x / this.C), cj = Math.floor(y / this.C);
    let best = Infinity;
    for (let i = ci - 1; i <= ci + 1; i++) for (let j = cj - 1; j <= cj + 1; j++) {
      const l = this.cells.get(`${i},${j}`);
      if (l) for (const p of l) { const d = (p.x - x) ** 2 + (p.y - y) ** 2; if (d < best) best = d; }
    }
    return Math.sqrt(best);
  }
}

export class WorldGen {
  private N: Noise2D[];
  /** Offset from world coordinates to noise space (moves the chosen start spot to the origin). */
  ox = 0;
  oy = 0;
  readonly corridors = new Corridors();
  private tmp = new Float32Array(NF);

  constructor(readonly seed: number) {
    this.N = Array.from({ length: 16 }, (_, i) => new Noise2D(seed * 131 + i * 7 + 3));
    this.findStart();
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
    // corridors of pre-built roads: hills cut back so the road never sits on a cliff
    const dc = this.corridors.near(x, y);
    if (dc < 260) out[F.mtn] = lerp(Math.min(out[F.mtn], 0.44), out[F.mtn], ss(90, 260, dc));
    return out;
  }

  /** Fields in noise space, before the start clearing and corridors. */
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
    // ore in the foothills of ranges (mines dig into the slope behind them)
    const ore = 0.5 + N[10].fbm(X / 1700, Y / 1700, 3) * 0.9 + range * 0.75 - 0.72 - ss(0.48, 0.53, m) * 0.6;
    // oil: rare fields on dry plains far from rivers
    const dry = ss(0.05, 0.4, N[11].fbm(X / 30000 - 9.1, Y / 30000 + 4.4, 2)) * valley;
    const oil = 0.5 + N[12].fbm(X / 2100, Y / 2100, 3) * 0.9 + dry * 0.85 - 0.98;
    if (water >= 0.5) forest = Math.min(forest, 0.3);
    out[F.mtn] = clamp01(m);
    out[F.lake] = clamp01(lakeW);
    out[F.river] = clamp01(0.5 + sr * 4);
    out[F.flow] = flow;
    out[F.fert] = clamp01(fert);
    out[F.forest] = clamp01(forest);
    out[F.ore] = clamp01(ore);
    out[F.oil] = clamp01(oil);
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

  /** Gateway cities within `reach` of the start, deterministic per 24 km grid cell. */
  gateways(reach = 45000): Gateway[] {
    const C = 24000;
    const out: Gateway[] = [];
    const n = Math.ceil(reach / C);
    const o = new Float32Array(NF);
    for (let i = -n; i <= n; i++) for (let j = -n; j <= n; j++) {
      const rnd = mulberry32(this.seed * 1009 + (i + 500) * 7919 + (j + 500) * 104729);
      let p = { x: (i + 0.5 + (rnd() - 0.5) * 0.7) * C, y: (j + 0.5 + (rnd() - 0.5) * 0.7) * C };
      const d0 = Math.hypot(p.x, p.y);
      if (d0 < 9000 || d0 > reach) continue;
      // settle on open, dry land nearby
      let found = false;
      for (let t = 0; t < 60 && !found; t++) {
        const q = t === 0 ? p : { x: p.x + (rnd() - 0.5) * 6000, y: p.y + (rnd() - 0.5) * 6000 };
        let ok = true;
        for (let a = 0; a < 8 && ok; a++) {
          const s = this.at(q.x + Math.cos(a) * 700, q.y + Math.sin(a) * 700, o);
          if (s[F.mtn] >= 0.47 || waterOf(s) >= 0.5) ok = false;
        }
        const c = this.at(q.x, q.y, o);
        if (ok && c[F.mtn] < 0.47 && waterOf(c) < 0.5) { p = q; found = true; }
      }
      if (!found) continue;
      // character from the land around it, with variety: each kind already used counts against itself
      let ore = 0, fert = 0, water = 0, oil = 0, forest = 0;
      for (let a = 0; a < 24; a++) {
        const R = 1500 + (a % 3) * 1500;
        const s = this.at(p.x + Math.cos(a * 2.4) * R, p.y + Math.sin(a * 2.4) * R, o);
        ore += s[F.ore] >= 0.5 || s[F.mtn] >= 0.5 ? 1 : 0;
        fert += s[F.fert] >= 0.5 ? 1 : 0;
        water += waterOf(s) >= 0.5 ? 1 : 0;
        oil += s[F.oil] >= 0.5 ? 1 : 0;
        forest += s[F.forest] >= 0.5 ? 1 : 0;
      }
      const used = (k: GatewayKind) => out.filter((g) => g.kind === k).length * 2.2;
      const score: Record<GatewayKind, number> = {
        port: water * 0.9 - 1.5,
        mining: ore * 0.8,
        farm: fert * 0.45,
        industry: oil * 0.8 + forest * 0.15,
        capital: 2.6,
        tech: 2.0,
      };
      let kind: GatewayKind = "capital", best = -Infinity;
      for (const k of Object.keys(score) as GatewayKind[]) {
        const v = score[k] - used(k) + rnd() * 1.5;
        if (v > best) { best = v; kind = k; }
      }
      let name = cityName(rnd);
      for (let t = 0; t < 20 && out.some((g) => g.name === name); t++) name = cityName(rnd);
      out.push({ id: out.length, name, kind, p, r: kind === "capital" ? 1000 + rnd() * 300 : 650 + rnd() * 350 });
    }
    return out;
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
