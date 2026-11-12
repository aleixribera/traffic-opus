// A town's green laid out as a park (game/settlements.ts Green; render/greens3d.ts draws it): gravel paths in from
// the middle of each street side to a round walk in the middle, benches along them, and in the middle of the town
// green (across the main street from the hall) a flower bed round a flagpole; a bigger park now and then a fountain.
// The ground round the hall's own square gets a walk round the hall's lot with benches on it facing the hall. The
// lay-bys behind the pavements hold the town's parked cars: about one in two at a hamlet, most in a city. The paths,
// the walk and the benches have townspeople on them.
//
// Everything here is the map's plane (x, y), as the game has it; the 3D layers turn it into the scene's (x, z).

import type { V2 } from "../core/math";
import { LAYBY_W, type Green } from "../game/settlements";

/** A gravel path: a straight piece from a to b, w wide. */
export interface GreenPath { a: V2; b: V2; w: number }
/** A piece of furniture (render/townlife.ts LIFE_MODELS): its front turned to (sin rot, cos rot) on the map. */
export interface GreenProp { model: string; x: number; y: number; rot: number }
/** Someone in the park: standing, turned to (sin rot, cos rot), or walking from a to b and back. */
export interface GreenFolk { a: V2; b?: V2; rot: number }
/** A lay-by's bay that keeps a car: where, which way its nose points, and whether it is a home's car (in at night). */
export interface GreenBay { p: V2; dir: V2; look: number; home: boolean }

export interface GreenPlan {
  paths: GreenPath[];
  /** round gravel plazas (the middle of a park, inside its walk) */
  discs: { c: V2; r: number }[];
  /** the lay-bys' asphalt: each run as its strip's two edges (back of the pavement, and the lawn's side) */
  laybys: { inner: V2[]; outer: V2[] }[];
  /** the white lines between the bays: each a short segment across the lay-by */
  ticks: { a: V2; b: V2 }[];
  props: GreenProp[];
  folk: GreenFolk[];
  bays: GreenBay[];
  /** the green's trees, less those a path, the walk or the middle would stand under */
  trees: { p: V2; r: number }[];
}

/** A path's width (m): the ways in, and the round walk in the middle. */
const PATH_W = 2.2, RING_W = 2.6;
/** How far out from the hall's lot its walk runs (m). */
const HALL_WALK = 6;
/** A bay's length along the lay-by (m). */
export const BAY_LEN = 6.2;
/** The share of a lay-by's bays that keep a car, by the town's size. */
const BAY_TAKEN = [0.45, 0.6, 0.7, 0.8];
/** How many of the town's people are in its parks, by its size: a hamlet has a couple, a city a crowd. */
const FOLK_PER = [0.5, 0.8, 1.1, 1.4];

/** A steady random number in [0, 1) for (a, b, c). */
export function ghash(a: number, b: number, c = 0): number {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul((b | 0) + 0x9e37, 668265263) ^ Math.imul((c | 0) + 0x51ed, 2246822519);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Is p inside the polygon? */
export function inPoly(pts: readonly V2[], p: V2): boolean {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
}

/** Distance from p to the segment a-b. */
function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

const lerp = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
/** The way a prop's front faces as its rot (front to (sin rot, cos rot) on the map). */
const rotTo = (d: V2) => Math.atan2(d.x, d.y);

/** The part of a-b inside the polygon (and clear of `away` by m), the longest run of it, sampled about every metre. */
function clip(pts: readonly V2[], a: V2, b: V2, ok: (p: V2) => boolean): [V2, V2] | null {
  const L = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(2, Math.ceil(L));
  let best: [number, number] | null = null, start = -1;
  for (let i = 0; i <= n + 1; i++) {
    const p = i <= n ? lerp(a, b, i / n) : null;
    const good = !!p && inPoly(pts, p) && ok(p);
    if (good && start < 0) start = i;
    if (!good && start >= 0) {
      if (!best || i - 1 - start > best[1] - best[0]) best = [start, i - 1];
      start = -1;
    }
  }
  return best && best[1] - best[0] >= 2 ? [lerp(a, b, best[0] / n), lerp(a, b, best[1] / n)] : null;
}

/** The green's park: its paths, furniture, people, parked cars and the trees left standing. `seed` keeps it its own. */
export function greenPlan(g: Green, seed: number): GreenPlan {
  const paths: GreenPath[] = [], discs: GreenPlan["discs"] = [], props: GreenProp[] = [], folk: GreenFolk[] = [], bays: GreenBay[] = [];
  const size = Math.max(0, Math.min(3, g.size | 0));
  const h = (k: number, j = 0) => ghash(seed, k, j);
  const holed = (p: V2, m: number) => {
    if (!g.hole) return false;
    const [o, u1, , v1] = g.hole;
    const ux = u1.x - o.x, uy = u1.y - o.y, vx = v1.x - o.x, vy = v1.y - o.y;
    const lu = Math.hypot(ux, uy), lv = Math.hypot(vx, vy);
    const a = ((p.x - o.x) * ux + (p.y - o.y) * uy) / lu, b = ((p.x - o.x) * vx + (p.y - o.y) * vy) / lv;
    return a > -m && a < lu + m && b > -m && b < lv + m;
  };
  /** A bench at p facing d, if it stands on the lawn and clear of the hall. */
  const bench = (p: V2, d: V2) => {
    if (inPoly(g.pts, p) && !holed(p, 1.2)) props.push({ model: "life_bench", x: p.x, y: p.y, rot: rotTo(d) });
  };
  /** Someone at a bench now and then: standing at one end of it, turned the way it faces. */
  const by = (p: V2, d: V2, k: number) => {
    if (h(k, 41) >= 0.55) return;
    const end = h(k, 42) < 0.5 ? 1.25 : -1.25;
    folk.push({ a: { x: p.x - d.y * end + d.x * 0.3, y: p.y + d.x * end + d.y * 0.3 }, rot: rotTo(d) });
  };

  // where each street side's way in starts: at the back of its pavement (across the lay-by, if it has one)
  const ins = g.gates.map((gt) => {
    let from: V2 = { x: gt.p.x - gt.n.x * 1.5, y: gt.p.y - gt.n.y * 1.5 }, near = LAYBY_W + 2;
    for (const run of g.laybys) for (const q of run) {
      const d = Math.hypot(q.p.x - gt.p.x, q.p.y - gt.p.y);
      if (d < near) { near = d; from = q.p; }
    }
    return { gate: gt, from };
  });

  if (g.role !== "square") {
    // the middle: a round walk, and in it the town green's flower bed and flagpole, or a big park's fountain
    const c = g.mid;
    const big = g.role === "town" || (size >= 2 && h(1) < 0.35);
    const R = g.role === "town" ? 7.5 : big ? 6.5 : 5;
    const n = 16;
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2;
      paths.push({ a: { x: c.x + Math.cos(a0) * R, y: c.y + Math.sin(a0) * R }, b: { x: c.x + Math.cos(a1) * R, y: c.y + Math.sin(a1) * R }, w: RING_W });
    }
    // (the middle inside the walk: gravel too, under the bed or the fountain)
    discs.push({ c, r: R });
    if (g.role === "town") props.push({ model: "life_flagbed", x: c.x, y: c.y, rot: h(2) * Math.PI * 2 });
    else if (big) props.push({ model: "life_fountain", x: c.x, y: c.y, rot: 0 });
    else for (let i = 0; i < 4; i++) {
      const a = Math.PI / 4 + (i * Math.PI) / 2;
      props.push({ model: "life_planter", x: c.x + Math.cos(a) * (R - 2.2), y: c.y + Math.sin(a) * (R - 2.2), rot: 0 });
    }
    // the ways in, from each street side's pavement to the walk
    const spokes: number[] = [];
    ins.forEach(({ from }, k) => {
      const dx = c.x - from.x, dy = c.y - from.y, L = Math.hypot(dx, dy);
      if (L < R + 4) return;
      const d = { x: dx / L, y: dy / L }, to = { x: c.x - d.x * R, y: c.y - d.y * R };
      paths.push({ a: from, b: to, w: PATH_W });
      spokes.push(Math.atan2(-d.y, -d.x));
      // a bench either side halfway in, facing the path, and someone walking it now and then
      const mid = lerp(from, to, 0.5 + (h(k, 3) - 0.5) * 0.2), side = { x: -d.y, y: d.x }, off = PATH_W / 2 + 0.9;
      if (h(k, 4) < 0.8) {
        const p = { x: mid.x + side.x * off, y: mid.y + side.y * off };
        bench(p, { x: -side.x, y: -side.y });
        by(p, { x: -side.x, y: -side.y }, k * 7 + 1);
      }
      if (h(k, 5) < 0.5) {
        const p = { x: mid.x - side.x * off, y: mid.y - side.y * off };
        bench(p, side);
        by(p, side, k * 7 + 2);
      }
      const walkers = Math.floor(FOLK_PER[size] * (g.role === "town" ? 1.6 : 1) + h(k, 6));
      for (let i = 0; i < walkers; i++) {
        const lane = (h(k, 7 + i) - 0.5) * PATH_W * 0.5;
        folk.push({ a: { x: from.x + side.x * lane, y: from.y + side.y * lane }, b: { x: to.x + side.x * lane, y: to.y + side.y * lane }, rot: 0 });
      }
    });
    // benches round the walk, between the ways in, facing the middle; people strolling round it
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      if (spokes.some((s) => Math.abs(Math.atan2(Math.sin(a - s), Math.cos(a - s))) < 0.35)) continue;
      if (h(i, 8) > (g.role === "town" ? 0.85 : 0.55)) continue;
      const out = { x: Math.cos(a), y: Math.sin(a) }, r = R + RING_W / 2 + 0.8;
      const p = { x: c.x + out.x * r, y: c.y + out.y * r };
      bench(p, { x: -out.x, y: -out.y });
      by(p, { x: -out.x, y: -out.y }, 100 + i);
    }
    const round = Math.floor(FOLK_PER[size] * (g.role === "town" ? 2 : 1) + h(9));
    for (let i = 0; i < round; i++) {
      const a = h(10, i) * Math.PI * 2, s = 0.6 + h(11, i) * 0.6;
      folk.push({ a: { x: c.x + Math.cos(a) * R, y: c.y + Math.sin(a) * R }, b: { x: c.x + Math.cos(a + s) * R, y: c.y + Math.sin(a + s) * R }, rot: 0 });
    }
    if (g.role === "town") for (let i = 0; i < 1 + size; i++) {
      // (a few stopped to look at the flowers)
      const a = h(12, i) * Math.PI * 2, r = 3.6;
      folk.push({ a: { x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r }, rot: rotTo({ x: -Math.cos(a), y: -Math.sin(a) }) });
    }
  } else if (g.hole) {
    // the hall's grounds: a walk round its lot (three sides: the fourth is its forecourt), benches on it facing the hall
    const [o, u1, v2, v1] = g.hole;
    const cx = (o.x + v2.x) / 2, cy = (o.y + v2.y) / 2;
    const grow = (p: V2) => {
      const dx = p.x - cx, dy = p.y - cy, L = Math.hypot(dx, dy) || 1, m = HALL_WALK * Math.SQRT2;
      return { x: p.x + (dx / L) * m, y: p.y + (dy / L) * m };
    };
    const C = [grow(o), grow(u1), grow(v2), grow(v1)];
    const walks: [V2, V2][] = [];
    for (let i = 0; i < 4; i++) {
      const a = C[i], b = C[(i + 1) % 4];
      // (the side along the forecourt runs on to the kerb: no walk there)
      const m = lerp(a, b, 0.5);
      if (!inPoly(g.pts, m)) continue;
      const got = clip(g.pts, a, b, (p) => !holed(p, 1.4));
      if (got) walks.push(got);
    }
    for (const [a, b] of walks) {
      paths.push({ a, b, w: PATH_W });
      const L = Math.hypot(b.x - a.x, b.y - a.y), d = { x: (b.x - a.x) / L, y: (b.y - a.y) / L };
      // the side facing the hall
      let side = { x: -d.y, y: d.x };
      const m = lerp(a, b, 0.5);
      if ((cx - m.x) * side.x + (cy - m.y) * side.y < 0) side = { x: -side.x, y: -side.y };
      const nb = Math.floor(L / 16);
      for (let i = 0; i < nb; i++) {
        const k = walks.length * 31 + i;
        if (h(k, 20) > 0.7) continue;
        const t = (i + 0.5 + (h(k, 21) - 0.5) * 0.3) / nb, q = lerp(a, b, t);
        const p = { x: q.x - side.x * (PATH_W / 2 + 0.9), y: q.y - side.y * (PATH_W / 2 + 0.9) };
        bench(p, side);
        by(p, side, k);
      }
      const walkers = Math.floor((L / 30) * FOLK_PER[size] + h(walks.length, 22));
      for (let i = 0; i < walkers; i++) {
        const t0 = h(i, 23) * 0.4, t1 = 0.6 + h(i, 24) * 0.4;
        folk.push({ a: lerp(a, b, t0), b: lerp(a, b, t1), rot: 0 });
      }
    }
    // the ways in from the side streets, to the nearest point of the walk
    ins.forEach(({ from, gate }, k) => {
      let best: V2 | null = null, bd = Infinity;
      for (const [a, b] of walks) {
        for (let t = 0; t <= 1; t += 0.05) {
          const q = lerp(a, b, t), d = Math.hypot(q.x - from.x, q.y - from.y);
          if (d < bd) { bd = d; best = q; }
        }
      }
      if (!best || bd < 4) return;
      // (only a way in that runs straight into the green)
      const dx = best.x - from.x, dy = best.y - from.y;
      if ((dx * gate.n.x + dy * gate.n.y) / bd < 0.85) return;
      paths.push({ a: from, b: best, w: PATH_W });
      if (h(k, 25) < FOLK_PER[size] * 0.6) folk.push({ a: from, b: best, rot: 0 });
    });
  }

  // the lay-bys: their asphalt, and a car in most of their bays (a gap where a path comes in)
  const laybys: GreenPlan["laybys"] = [], ticks: GreenPlan["ticks"] = [];
  const taken = BAY_TAKEN[size];
  let bayNo = 0;
  for (const run of g.laybys) {
    if (run.length < 2) continue;
    const inner = run.map((q) => q.p), outer = run.map((q) => ({ x: q.p.x + q.n.x * LAYBY_W, y: q.p.y + q.n.y * LAYBY_W }));
    laybys.push({ inner, outer });
    // walk the run, a bay every BAY_LEN
    const cum = [0];
    for (let i = 1; i < run.length; i++) cum.push(cum[i - 1] + Math.hypot(run[i].p.x - run[i - 1].p.x, run[i].p.y - run[i - 1].p.y));
    const total = cum[cum.length - 1];
    const nb = Math.floor((total - 1) / BAY_LEN);
    if (nb < 1) continue;
    const s0 = (total - nb * BAY_LEN) / 2;
    const at = (s: number) => {
      let i = 1;
      while (i < run.length - 1 && cum[i] < s) i++;
      const t = Math.max(0, Math.min(1, (s - cum[i - 1]) / Math.max(1e-6, cum[i] - cum[i - 1])));
      const a = run[i - 1], b = run[i];
      const p = lerp(a.p, b.p, t), L = Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) || 1;
      return { p, n: a.n, d: { x: (b.p.x - a.p.x) / L, y: (b.p.y - a.p.y) / L } };
    };
    for (let i = 0; i <= nb; i++) {
      const q = at(s0 + i * BAY_LEN);
      ticks.push({ a: q.p, b: { x: q.p.x + q.n.x * LAYBY_W, y: q.p.y + q.n.y * LAYBY_W } });
    }
    for (let i = 0; i < nb; i++) {
      const q = at(s0 + (i + 0.5) * BAY_LEN);
      const p = { x: q.p.x + q.n.x * (LAYBY_W / 2), y: q.p.y + q.n.y * (LAYBY_W / 2) };
      const k = bayNo++;
      if (paths.some((w) => segDist(p, w.a, w.b) < w.w / 2 + 2.6)) continue;
      if (h(k, 30) >= taken) continue;
      const back = h(k, 31) < 0.5;
      const look = (Math.imul(seed, 2654435761) ^ Math.imul(k + 1, 19349663)) >>> 3;
      // (round the hall and on the town green, cars by day; along the parks, the homes' cars, in at night)
      const home = g.role === "park" ? h(k, 32) < 0.8 : h(k, 32) < 0.25;
      bays.push({ p, dir: back ? { x: -q.d.x, y: -q.d.y } : q.d, look, home });
    }
  }

  // the trees: none on a path or a bench, nor in the middle
  const trees = g.trees.filter((t) => {
    if (paths.some((w) => segDist(t.p, w.a, w.b) < w.w / 2 + t.r * 0.55 + 0.4)) return false;
    if (discs.some((d) => Math.hypot(t.p.x - d.c.x, t.p.y - d.c.y) < d.r + t.r * 0.55 + 0.4)) return false;
    if (props.some((p) => Math.hypot(p.x - t.p.x, p.y - t.p.y) < t.r * 0.5 + 1.2)) return false;
    return true;
  });
  return { paths, discs, laybys, ticks, props, folk, bays, trees };
}
