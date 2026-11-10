// A town hall's square (src/render/civic.ts) grows more civic with the hall: more of it paved, more trees, and every
// tree standing on the square, off the hall and clear of the path to its door.

import { describe, expect, it } from "vitest";
import { squarePlan, type SquarePlan } from "../src/render/civic";

const HALF = 40.8; // a square's lot, half across (BLOCK / 2 less the street and its pavement)
/** The halls' models, half across and half deep (their bounds in the game's models). */
const HALLS: [number, number][] = [[10, 9], [14, 12], [20, 18], [30, 25]];

function plan(tier: number, seed = 5, kerbX = 0): SquarePlan {
  const [mx, mz] = HALLS[tier];
  return squarePlan(tier, HALF, { x0: -mx, x1: mx, z0: -mz, z1: mz }, { x: 0, z: mz }, { x: kerbX, z: HALF + 3 }, seed);
}

/** Paved share of the square (pieces don't overlap but for the path, which crosses what's under it). */
function paved(p: SquarePlan): number {
  const H = HALF - 0.4, all = 4 * H * H;
  let lawn = 0, pave = 0;
  for (const r of p.rects) if (r.kind === "lawn") lawn += r.w * r.d; else if (r.kind === "pave") pave += r.w * r.d;
  return p.base === "pave" ? (all - lawn) / all : pave / all;
}

describe("a town hall's square", () => {
  it("is paved more, and planted more, as the hall grows", () => {
    const ps = [0, 1, 2, 3].map((t) => plan(t));
    const share = ps.map(paved);
    for (let t = 1; t < 4; t++) expect(share[t], `tier ${t}`).toBeGreaterThan(share[t - 1]);
    expect(share[0]).toBeLessThan(0.2); // a green
    expect(share[3]).toBeGreaterThan(0.6); // a plaza
    for (const p of ps) expect(p.trees.length).toBeGreaterThanOrEqual(8);
    expect(ps[3].trees.length).toBeGreaterThan(ps[0].trees.length);
  });

  it("keeps its trees on the square, off the hall, off the path and apart", () => {
    for (let tier = 0; tier < 4; tier++) for (const seed of [1, 7, 42]) for (const kerbX of [0, -6, 9]) {
      const [mx, mz] = HALLS[tier];
      const p = plan(tier, seed, kerbX);
      const path = p.rects.find((r) => r.kind === "path")!;
      expect(path).toBeTruthy();
      for (const t of p.trees) {
        const where = `tier ${tier} seed ${seed} kerb ${kerbX} tree at ${t.x.toFixed(1)},${t.z.toFixed(1)}`;
        expect(Math.max(Math.abs(t.x), Math.abs(t.z)) + t.r * 0.8, where).toBeLessThanOrEqual(HALF);
        expect(Math.abs(t.x) >= mx + t.r * 0.75 || Math.abs(t.z) >= mz + t.r * 0.75, where).toBe(true);
        // distance from the path's centre line (from the door to the kerb)
        const ux = Math.sin(path.rot), uz = Math.cos(path.rot);
        const along = (t.x - path.x) * ux + (t.z - path.z) * uz, across = Math.abs((t.x - path.x) * uz - (t.z - path.z) * ux);
        if (Math.abs(along) <= path.d / 2) expect(across, where).toBeGreaterThanOrEqual(path.w / 2 + t.r * 0.8 - 1e-9);
        for (const o of p.trees) if (o !== t) expect(Math.hypot(o.x - t.x, o.z - t.z), where).toBeGreaterThanOrEqual((o.r + t.r) * 0.8 - 1e-9);
      }
      // every piece lies on the lot
      for (const r of p.rects) if (r.rot === 0) {
        expect(Math.abs(r.x) + r.w / 2).toBeLessThanOrEqual(HALF);
        expect(Math.abs(r.z) + r.d / 2).toBeLessThanOrEqual(HALF);
      }
    }
  });

  it("runs its path from the door to the kerb, however the kerb lies", () => {
    const p = plan(2, 3, 8);
    const path = p.rects.find((r) => r.kind === "path")!;
    const ux = Math.sin(path.rot), uz = Math.cos(path.rot);
    const a = { x: path.x - ux * path.d / 2, z: path.z - uz * path.d / 2 }, b = { x: path.x + ux * path.d / 2, z: path.z + uz * path.d / 2 };
    expect(a.x).toBeCloseTo(0, 6);
    expect(a.z).toBeCloseTo(18, 6);
    expect(b.z).toBeCloseTo(HALF - 0.4, 6);
    expect(b.x).toBeGreaterThan(0);
  });

  it("is furnished as it grows: a memorial on the green, a market on the village's square, fountains in a city's", () => {
    const ps = [0, 1, 2, 3].map((t) => plan(t));
    const has = (p: SquarePlan, m: string) => p.props.filter((q) => q.model === m).length;
    expect(has(ps[0], "life_memorial")).toBe(1);
    expect(has(ps[1], "life_stall_a") + has(ps[1], "life_stall_b")).toBeGreaterThanOrEqual(4);
    expect(has(ps[2], "life_fountain") + has(ps[2], "life_memorial")).toBeGreaterThanOrEqual(1);
    expect(has(ps[3], "life_fountain")).toBeGreaterThanOrEqual(1);
    for (const p of ps) {
      expect(has(p, "life_bench")).toBeGreaterThanOrEqual(2);
      expect(p.folk.length).toBeGreaterThanOrEqual(3);
      expect(p.folk.some((f) => f.to)).toBe(true);
    }
  });

  it("keeps its furniture and its people off the hall, the path and the trees, and on the square", () => {
    // (a deep front strip: the open ground runs on past the lot to the pavement)
    for (let tier = 0; tier < 4; tier++) for (const seed of [1, 7, 42]) for (const [kerbX, front] of [[0, HALF - 0.4], [-6, HALF + 20], [9, HALF + 4]]) {
      const [mx, mz] = HALLS[tier];
      const p = squarePlan(tier, HALF, { x0: -mx, x1: mx, z0: -mz, z1: mz }, { x: 0, z: mz }, { x: kerbX, z: front + 3 }, seed, front);
      const path = p.rects.find((r) => r.kind === "path")!;
      const F = Math.max(HALF - 0.4, front);
      const ux = Math.sin(path.rot), uz = Math.cos(path.rot);
      for (const q of p.props) {
        const where = `tier ${tier} seed ${seed} kerb ${kerbX} front ${front}: ${q.model} at ${q.x.toFixed(1)},${q.z.toFixed(1)}`;
        expect(Math.abs(q.x), where).toBeLessThan(HALF);
        expect(q.z, where).toBeLessThan(F);
        expect(Math.abs(q.x) >= mx + 1.5 || Math.abs(q.z) >= mz + 1.5, where).toBe(true);
        const along = (q.x - path.x) * ux + (q.z - path.z) * uz, across = Math.abs((q.x - path.x) * uz - (q.z - path.z) * ux);
        if (Math.abs(along) <= path.d / 2) expect(across, where).toBeGreaterThan(path.w / 2);
        for (const t of p.trees) expect(Math.hypot(t.x - q.x, t.z - q.z), where).toBeGreaterThan(1);
        for (const o of p.props) if (o !== q) expect(Math.hypot(o.x - q.x, o.z - q.z), where).toBeGreaterThan(1.2);
      }
      for (const f of p.folk) {
        const where = `tier ${tier} seed ${seed} kerb ${kerbX}: someone at ${f.x.toFixed(1)},${f.z.toFixed(1)}`;
        for (const e of [f, f.to ?? f]) {
          expect(Math.abs(e.x) >= mx || Math.abs(e.z) >= mz, where).toBe(true);
          expect(Math.abs(e.x), where).toBeLessThan(HALF);
          expect(e.z, where).toBeLessThanOrEqual(F + 1e-9);
        }
        if (!f.to) for (const q of p.props) expect(Math.hypot(q.x - f.x, q.z - f.z), where).toBeGreaterThan(0.5);
      }
    }
  });
});
