// A town's greens laid out as parks (src/render/greenplan.ts): paths that stay on the lawn, trees and benches off
// them, a lay-by's cars clear of where the paths come in, the hall's own lot left bare, and the same each time.

import { describe, expect, it } from "vitest";
import { LAYBY_W, type Green } from "../src/game/settlements";
import { BAY_LEN, greenPlan, inPoly } from "../src/render/greenplan";
import type { V2 } from "../src/core/math";

/** A square green 2·half m across round (0, 0), streets on all four sides, a lay-by behind each pavement. */
function green(role: Green["role"], size: number, half = 50, hole?: V2[]): Green {
  const pts = [{ x: -half, y: -half }, { x: half, y: -half }, { x: half, y: half }, { x: -half, y: half }];
  const back = half + LAYBY_W + 0.45;
  const sides: [V2, V2, V2][] = [
    [{ x: -half, y: -back }, { x: half, y: -back }, { x: 0, y: 1 }],
    [{ x: back, y: -half }, { x: back, y: half }, { x: -1, y: 0 }],
    [{ x: half, y: back }, { x: -half, y: back }, { x: 0, y: -1 }],
    [{ x: -back, y: half }, { x: -back, y: -half }, { x: 1, y: 0 }],
  ];
  const laybys = sides.map(([a, b, n]) => Array.from({ length: 11 }, (_, i) => ({ p: { x: a.x + ((b.x - a.x) * i) / 10, y: a.y + ((b.y - a.y) * i) / 10 }, n })));
  const gates = sides.map(([a, b, n]) => ({ p: { x: (a.x + b.x) / 2 + n.x * (LAYBY_W + 0.45), y: (a.y + b.y) / 2 + n.y * (LAYBY_W + 0.45) }, n }));
  const trees: Green["trees"] = [];
  for (let x = -half + 4; x < half; x += 7) for (let y = -half + 4; y < half; y += 7) trees.push({ p: { x, y }, r: 2.5 });
  return { town: 1, pts, trees, role, size, mid: { x: 0, y: 0 }, hole, laybys, gates };
}

function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x, dy = b.y - a.y, L2 = dx * dx + dy * dy || 1;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2));
  return Math.hypot(p.x - a.x - dx * t, p.y - a.y - dy * t);
}

describe("a town's greens laid out as parks", () => {
  it("the town green: a round walk with the flower bed and flagpole in it, paths in from every street, all on the lawn", () => {
    const g = green("town", 2);
    const P = greenPlan(g, 1234);
    expect(P.props.filter((p) => p.model === "life_flagbed")).toHaveLength(1);
    expect(P.discs).toHaveLength(1);
    // (a way in from each of the four sides, each from the back of the pavement to the walk)
    const spokes = P.paths.filter((w) => w.w < 2.5);
    expect(spokes).toHaveLength(4);
    for (const w of spokes) expect(Math.hypot(w.b.x, w.b.y)).toBeLessThan(8);
    // (every path's far end is on the lawn; the near end is at its edge, across the lay-by)
    for (const w of P.paths) expect(inPoly(g.pts, w.b), `${w.b.x},${w.b.y}`).toBe(true);
    for (const p of P.props) expect(inPoly(g.pts, { x: p.x, y: p.y })).toBe(true);
    expect(P.folk.length).toBeGreaterThan(6);
  });

  it("keeps the trees off its paths, its middle and its benches", () => {
    const g = green("park", 3, 60);
    const P = greenPlan(g, 77);
    expect(P.trees.length).toBeGreaterThan(20);
    expect(P.trees.length).toBeLessThan(g.trees.length);
    for (const t of P.trees) {
      for (const w of P.paths) expect(segDist(t.p, w.a, w.b)).toBeGreaterThan(w.w / 2);
      for (const d of P.discs) expect(Math.hypot(t.p.x - d.c.x, t.p.y - d.c.y)).toBeGreaterThan(d.r);
      for (const p of P.props) expect(Math.hypot(t.p.x - p.x, t.p.y - p.y)).toBeGreaterThan(1.2);
    }
  });

  it("parks cars in the lay-by's bays, along it, none where a path crosses it", () => {
    const g = green("town", 3);
    const P = greenPlan(g, 9);
    expect(P.laybys).toHaveLength(4);
    expect(P.bays.length).toBeGreaterThan(10);
    for (const b of P.bays) {
      // (in the lay-by: half its width in from the back of the pavement)
      const k = Math.max(Math.abs(b.p.x), Math.abs(b.p.y));
      expect(k).toBeCloseTo(50 + 0.45 + LAYBY_W / 2, 3);
      // (along the street)
      const along = Math.abs(b.p.x) > Math.abs(b.p.y) ? Math.abs(b.dir.y) : Math.abs(b.dir.x);
      expect(along).toBeCloseTo(1, 5);
      for (const w of P.paths) expect(segDist(b.p, w.a, w.b)).toBeGreaterThan(w.w / 2 + 2.5);
    }
    // (the bays a side, a tick between each)
    const side = Math.floor((100 - 1) / BAY_LEN);
    expect(P.ticks).toHaveLength(4 * (side + 1));
  });

  it("a city's are busier than a hamlet's, and the same each time it is laid out", () => {
    const small = greenPlan(green("park", 1), 5), big = greenPlan(green("park", 3), 5);
    expect(big.folk.length).toBeGreaterThan(small.folk.length);
    expect(big.bays.length).toBeGreaterThan(small.bays.length);
    expect(greenPlan(green("park", 3), 5)).toEqual(big);
  });

  it("the hall's grounds: a walk round its lot, benches facing it, nothing on the lot itself", () => {
    // (the hall's lot 70 m square, its forecourt running out to the -y kerb)
    const hole = [{ x: -36, y: -60 }, { x: 36, y: -60 }, { x: 36, y: 36 }, { x: -36, y: 36 }];
    const g = green("square", 2, 58, hole);
    const P = greenPlan(g, 3);
    expect(P.discs).toHaveLength(0);
    const inHole = (p: V2) => p.x > -36 && p.x < 36 && p.y > -60 && p.y < 36;
    expect(P.paths.length).toBeGreaterThanOrEqual(3);
    for (const w of P.paths) {
      expect(inHole(w.a)).toBe(false);
      expect(inHole(w.b)).toBe(false);
    }
    expect(P.props.length).toBeGreaterThan(0);
    for (const p of P.props) {
      expect(p.model).toBe("life_bench");
      expect(inHole({ x: p.x, y: p.y })).toBe(false);
      expect(inPoly(g.pts, { x: p.x, y: p.y })).toBe(true);
    }
    for (const f of P.folk) expect(inHole(f.a)).toBe(false);
  });
});
