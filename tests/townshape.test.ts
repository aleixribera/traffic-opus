// Towns that look like small American towns grown over time (docs/design.md, "Towns run themselves", owner
// 2026-11-08): a main street along the road the town began on, a loose core, quarters of long blocks, closes and
// loop drives further out, T-junctions far more than crossroads, and lopsided growth out along the roads and away
// from water, hills, woods and the company's sites; not the rings and spokes of v0.0.69 (townplan.ts, PLAN_TOWN).

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import type { Town } from "../src/game/settlements";
import { PLAN_ORGANIC, PLAN_TOWN, TownPlan } from "../src/game/townplan";
import { BLOCK, sizeOf, type GridEdge } from "../src/game/towns";
import { dist, type V2 } from "../src/core/math";

const land = { isWater: () => false, isMountain: () => false };

/** Share of a plan's streets (by length, 2..R blocks out) that run round the centre rather than out from it. */
function planTangential(P: TownPlan, R: number): number {
  let tan = 0, all = 0;
  for (let i = -R; i < R; i++) for (let j = -R; j < R; j++) for (const e of [[i, j, i + 1, j], [i, j, i, j + 1]] as GridEdge[]) {
    if (Math.max(...e.map(Math.abs)) < 2 || !P.has(e)) continue;
    const pts = P.line(e);
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], L = dist(a, b);
      const m = { x: (a.x + b.x) / 2 - P.c.x, y: (a.y + b.y) / 2 - P.c.y }, r = Math.hypot(m.x, m.y);
      if (L < 1e-6) continue;
      all += L;
      if (Math.abs(((b.x - a.x) * m.x + (b.y - a.y) * m.y) / (L * r)) < 0.25) tan += L;
    }
  }
  return tan / all;
}

/** A grown town's streets: the share running round its centre (past 150 m), junction mix, and how lopsided it is. */
function shapeOf(g: Game, t: Town) {
  let tan = 0, all = 0;
  const nodes = new Set<number>();
  const far = new Array(12).fill(0);
  for (const s of g.net.segs.values()) {
    if (s.town !== t.id) continue;
    nodes.add(s.a);
    nodes.add(s.b);
    const pts = g.net.segGeom.get(s.id)!.center.pts;
    for (let k = 0; k + 1 < pts.length; k++) {
      const a = pts[k], b = pts[k + 1], L = dist(a, b);
      const m = { x: (a.x + b.x) / 2 - t.c.x, y: (a.y + b.y) / 2 - t.c.y }, r = Math.hypot(m.x, m.y);
      if (r < 150 || L < 1e-6) continue;
      all += L;
      if (Math.abs(((b.x - a.x) * m.x + (b.y - a.y) * m.y) / (L * r)) < 0.25) tan += L;
    }
    for (const p of [s.c.p0, s.c.p3]) {
      const a = Math.atan2(p.y - t.c.y, p.x - t.c.x), k = ((Math.floor(((a + Math.PI) / (2 * Math.PI)) * 12) % 12) + 12) % 12;
      far[k] = Math.max(far[k], dist(p, t.c));
    }
  }
  let T = 0, X = 0;
  for (const n of nodes) {
    const k = g.net.segsAt(n).length;
    if (k === 3) T++;
    else if (k >= 4) X++;
  }
  const mx = Math.max(...far);
  return { tan: tan / all, T, X, lop: mx / Math.max(1, Math.min(...far)), furthest: far.indexOf(mx) };
}

describe("a PLAN_TOWN plan", () => {
  it("is the same every time for a town (nothing about it is saved)", () => {
    const a = new TownPlan({ x: 100, y: 200 }, 0.3, PLAN_TOWN, 12345, land);
    const b = new TownPlan({ x: 100, y: 200 }, 0.3, PLAN_TOWN, 12345, land);
    for (let i = -9; i <= 9; i++) for (let j = -9; j <= 9; j++) {
      expect(a.pt(i, j)).toEqual(b.pt(i, j));
      expect(a.has([i, j, i + 1, j])).toBe(b.has([i, j, i + 1, j]));
      expect(a.has([i, j, i, j + 1])).toBe(b.has([i, j, i, j + 1]));
      expect(a.growR(i, j)).toBe(b.growR(i, j));
    }
  });

  it("differs from town to town, in its streets as well as where they lie", () => {
    const a = new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, 1, land);
    const b = new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, 2, land);
    let moved = 0, other = 0;
    for (let i = -6; i <= 6; i++) for (let j = -6; j <= 6; j++) {
      if (dist(a.pt(i, j)!, b.pt(i, j)!) > 5) moved++;
      if (a.has([i, j, i + 1, j]) !== b.has([i, j, i + 1, j])) other++;
    }
    expect(moved).toBeGreaterThan(60);
    expect(other).toBeGreaterThan(20);
  });

  it("leaves the crossroads and the ring round it square, and runs the main street on straight through the centre", () => {
    const a = new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, 99, land);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) expect(dist(a.pt(i, j)!, { x: i * BLOCK, y: j * BLOCK })).toBeLessThan(1e-6);
    for (let i = -9; i < 9; i++) expect(a.has([i, 0, i + 1, 0]), `main street ${i}`).toBe(true);
  });

  it("runs its streets out from the centre and across, not round it in rings", () => {
    let town = 0, rings = 0;
    for (let s = 1; s <= 12; s++) {
      town += planTangential(new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, s * 7919, land), 7) / 12;
      rings += planTangential(new TownPlan({ x: 0, y: 0 }, 0, PLAN_ORGANIC, s * 7919, land), 7) / 12;
    }
    // (on a square grid about a fifth of the length runs within 15 degrees of round the centre: the diagonals)
    expect(town).toBeLessThan(0.25);
    expect(rings).toBeGreaterThan(town + 0.08);
  });

  it("meets in T-junctions far more often than in crossroads", () => {
    let T = 0, X = 0;
    for (let s = 1; s <= 30; s++) {
      const P = new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, s * 104729, land);
      const has = (e: GridEdge) => Math.max(...e.map(Math.abs)) <= 6 && P.has(e);
      for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
        const k = +has([i, j, i + 1, j]) + +has([i - 1, j, i, j]) + +has([i, j, i, j + 1]) + +has([i, j - 1, i, j]);
        if (k === 3) T++;
        else if (k === 4) X++;
      }
    }
    expect(T / (T + X)).toBeGreaterThan(0.65);
  });

  it("grows further out where the land is open, and less toward water", () => {
    const P = new TownPlan({ x: 0, y: 0 }, 0, PLAN_TOWN, 5, land);
    // (water to the east: the lean the town sees, LEAN_N directions from east round to the north)
    const lean = Array.from({ length: 32 }, (_, k) => (Math.cos((k / 32) * 2 * Math.PI) > 0.5 ? 0.2 : 1));
    P.setLean(lean);
    // a node 4 blocks east counts as further out than one 4 blocks west
    const east = P.growR(4, 1), west = P.growR(-4, 1);
    expect(east).toBeGreaterThan(west * 1.4);
  });
});

describe("towns grown on PLAN_TOWN", () => {
  let a: { g: Game; t: Town }, b: { g: Game; t: Town }, site: V2;
  const grow = (seed: number, before?: (g: Game, t: Town) => void) => {
    const g = new Game(seed);
    g.start();
    const t = g.towns.list[0];
    before?.(g, t);
    for (let d = 0; d < 30 && sizeOf(t.pop) < 2; d++) g.fastForward(t.id, 24, 2);
    return { g, t };
  };
  beforeAll(() => {
    a = grow(7);
    // (a warehouse of the company's 450-650 m out of the second town before it grows)
    b = grow(3, (g, t) => {
      g.progress.unlocked.buildings.add("warehouse");
      for (const r of [450, 550, 650]) for (let k = 0; k < 24; k++) {
        const th = (k / 24) * 2 * Math.PI, p = { x: t.c.x + Math.cos(th) * r, y: t.c.y + Math.sin(th) * r };
        if (g.placedPlan("warehouse", p)?.ok && g.place("warehouse", p)) { site = p; return; }
      }
    });
  }, 240_000);

  it("are new towns on the new plan", () => {
    expect(a.t.layout).toBe(PLAN_TOWN);
    expect(b.t.layout).toBe(PLAN_TOWN);
    expect(sizeOf(a.t.pop)).toBe(2);
    expect(sizeOf(b.t.pop)).toBe(2);
  });

  it("have streets that run out and across, not round in rings (v0.0.69: 0.44 of the first town's ran round it)", () => {
    expect(shapeOf(a.g, a.t).tan).toBeLessThan(0.3);
    expect(shapeOf(b.g, b.t).tan).toBeLessThan(0.3);
  });

  it("meet in T-junctions more than in crossroads (v0.0.69: a third)", () => {
    const x = shapeOf(a.g, a.t), y = shapeOf(b.g, b.t);
    expect((x.T + y.T) / (x.T + x.X + y.T + y.X)).toBeGreaterThan(0.5);
  });

  it("are lopsided, each its own way (v0.0.69: the first reached 1.06 times as far one way as another)", () => {
    const x = shapeOf(a.g, a.t), y = shapeOf(b.g, b.t);
    expect(x.lop).toBeGreaterThan(1.8);
    expect(y.lop).toBeGreaterThan(1.8);
    expect(x.furthest).not.toBe(y.furthest);
  });

  it("lay no street over water or mountain, nor through the company's sites", () => {
    expect(site, "a spot for the warehouse").toBeDefined();
    for (const { g, t } of [a, b]) {
      for (const s of g.net.segs.values()) {
        if (s.town !== t.id) continue;
        for (const p of g.net.segGeom.get(s.id)!.center.pts) {
          expect(g.world.isWater(p) || g.world.isMountain(p), `street ${s.id} on water or mountain`).toBe(false);
          expect(g.inSite(p), `street ${s.id} in a site`).toBe(false);
        }
      }
    }
  });

  it("keep a town from a v0.0.69 save on the plan it had", () => {
    const g = new Game(3);
    g.start();
    const d = g.towns.toJSON();
    (d.towns[0] as { layout?: number }).layout = PLAN_ORGANIC;
    g.towns.load(d);
    expect(g.towns.list[0].layout).toBe(PLAN_ORGANIC);
    expect(g.towns.planOf(g.towns.list[0]).style).toBe(PLAN_ORGANIC);
  });
});
