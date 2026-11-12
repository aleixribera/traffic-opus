import { describe, expect, it } from "vitest";
import { ringCut } from "../src/render/preview3d";

// A roundabout's preview marks only what it takes away: the road inside the ring, not the whole road it trims
// (road play 2026-11-10: the whole road washed red read as an error).
describe("ringCut", () => {
  const line = (x0: number, x1: number, step = 2) => {
    const pts = [];
    for (let x = x0; x <= x1 + 1e-9; x += step) pts.push({ x, y: 0 });
    return pts;
  };

  it("keeps only the stretch inside the circle, cut on the circle", () => {
    const pts = line(-100, 100);
    const runs = ringCut(pts, pts.map(() => 0), { x: 0, y: 0 }, 25);
    expect(runs.length).toBe(1);
    const r = runs[0];
    expect(r.pts[0].x).toBeCloseTo(-25, 6);
    expect(r.pts[r.pts.length - 1].x).toBeCloseTo(25, 6);
  });

  it("a road through the ring off-centre gives one run per pass inside", () => {
    // a U past the circle: in, out, in again
    const pts = [...line(-60, 0).map((p) => ({ x: p.x, y: 10 })), { x: 40, y: 60 }, ...line(-60, 0).reverse().map((p) => ({ x: p.x, y: -10 }))];
    const runs = ringCut(pts, pts.map(() => 0), { x: -30, y: 0 }, 20);
    expect(runs.length).toBe(2);
  });

  it("a dropped dead end is marked out to its end", () => {
    const pts = line(-100, 32);
    const runs = ringCut(pts, pts.map(() => 0), { x: 0, y: 0 }, 25, false, true);
    expect(runs.length).toBe(1);
    expect(runs[0].pts[0].x).toBeCloseTo(-25, 6);
    expect(runs[0].pts[runs[0].pts.length - 1].x).toBe(32);
  });

  it("heights follow the road at the cut", () => {
    const pts = line(-50, 50, 10);
    const runs = ringCut(pts, pts.map((p) => p.x / 10), { x: 0, y: 0 }, 25);
    expect(runs[0].hs[0]).toBeCloseTo(-2.5, 6);
  });

  it("a road that misses the circle leaves nothing", () => {
    const pts = line(-100, 100).map((p) => ({ x: p.x, y: 40 }));
    expect(ringCut(pts, pts.map(() => 0), { x: 0, y: 0 }, 25)).toEqual([]);
  });
});
