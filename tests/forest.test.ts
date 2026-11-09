// The wild trees stand by one rule set (render/forest.ts), used twice: instanced in 3D near in, painted as flat
// crowns far out. Here: the hash is the one GLSL computes, every tree obeys the rules (its cell, the forest's edge,
// water, hills, and nothing built under its crown), what the ground shader paints from the baked texture is exactly
// the list the 3D trees are instanced from, and a road built through a wood takes its trees and gives them back.

import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { F, MOUNTAIN_STEPS } from "../src/world/gen";
import { Terrain } from "../src/world/terrain";
import { CLEAR_RANGE, clearShapes, crownCleared } from "../src/render/clearing";
import {
  CANOPY, EVERGREEN, FOREST_R, Forest, H, SCRUB, TILE_CELLS, TILE_M, TREE_CELL, TREE_MODELS, crownRadius, scrubDensity, thash, thashf, treeModel,
  type TreeTile,
} from "../src/render/forest";
import type { V2 } from "../src/core/math";

/** The hash as GLSL works it out: unsigned 32-bit arithmetic that wraps, spelled out with BigInt. */
function glslHash(i: number, j: number, k: number): number {
  const M = (1n << 32n) - 1n, u = (v: number) => BigInt.asUintN(32, BigInt(v));
  let x = (u(i) * 0x9e3779b1n + u(j) * 0x85ebca77n + u(k) * 0xc2b2ae3dn) & M;
  x ^= x >> 15n; x = (x * 0x2c1b3c6dn) & M; x ^= x >> 12n; x = (x * 0x297a2d39n) & M; x ^= x >> 15n;
  return Number(x);
}

/** A tile with a good many forest trees, and one of open scrub, found near the start. */
function findTiles(f: Forest): { wood: TreeTile; scrub: TreeTile; edge: TreeTile } {
  let wood: TreeTile | null = null, scrub: TreeTile | null = null, edge: TreeTile | null = null;
  for (let tj = -40; tj <= 40 && !(wood && scrub && edge); tj++) {
    for (let ti = -40; ti <= 40 && !(wood && scrub && edge); ti++) {
      const t = f.tile(ti, tj);
      const nf = t.grid.reduce((n, g) => n + (g === 0 ? 1 : 0), 0);
      if (!wood && nf > 190) wood = t;
      if (!scrub && nf === 0 && t.n >= 8) scrub = t;
      if (!edge && nf > 40 && nf < 150 && t.n - nf > 2) edge = t;
    }
  }
  return { wood: wood!, scrub: scrub!, edge: edge! };
}

describe("the trees' hash", () => {
  it("gives the bits GLSL's unsigned arithmetic gives, for cells either side of zero", () => {
    for (const [i, j, k] of [[0, 0, 0], [1, 2, 3], [-1, -1, 7], [123456, -98765, 21], [-40000, 77777, 5], [2147483, -2147483, 16]]) {
      expect(thash(i, j, k)).toBe(glslHash(i, j, k));
    }
  });
  it("spreads evenly over 0..1 and is exact in a 32-bit float", () => {
    let sum = 0, lo = 1, hi = 0;
    for (let i = 0; i < 4000; i++) {
      const v = thashf(i % 63 - 31, Math.floor(i / 63) - 31, H.dens);
      expect(Math.fround(v)).toBe(v);
      sum += v; lo = Math.min(lo, v); hi = Math.max(hi, v);
    }
    expect(sum / 4000).toBeGreaterThan(0.47);
    expect(sum / 4000).toBeLessThan(0.53);
    expect(lo).toBeLessThan(0.01);
    expect(hi).toBeGreaterThan(0.99);
    expect(hi).toBeLessThan(1);
  });
});

describe("where the wild trees stand", () => {
  const terrain = new Terrain(7);
  const forest = new Forest(terrain);
  const { wood, scrub, edge } = findTiles(forest);

  it("finds woods, open scrub and a wood's edge near the start", () => {
    expect(wood).toBeTruthy();
    expect(scrub).toBeTruthy();
    expect(edge).toBeTruthy();
  });

  it("every tree is the one its cell's hashes say: its spot, its crown, inside its own cell and tile", () => {
    for (const t of [wood, scrub, edge]) {
      for (let k = 0; k < t.n; k++) {
        const g = t.grid[k], cell = TREE_CELL * (g + 1), ko = g * SCRUB, ci = t.ci[k], cj = t.cj[k];
        // (what the ground shader computes for the cell: the same spot and the same radius)
        const x = (ci + 0.5 + (thashf(ci, cj, H.jx + ko) - 0.5) * 0.55) * cell, y = (cj + 0.5 + (thashf(ci, cj, H.jy + ko) - 0.5) * 0.55) * cell;
        expect(t.x[k]).toBeCloseTo(x, 3);
        expect(t.y[k]).toBeCloseTo(y, 3);
        expect(t.r[k]).toBeCloseTo(1.1 + 1.3 * thashf(ci, cj, ko) + (g === 0 ? FOREST_R : 0), 4);
        expect(t.r[k]).toBeCloseTo(crownRadius(thashf(ci, cj, H.r + ko), g === 0), 5);
        expect(Math.floor(x / cell)).toBe(ci);
        expect(Math.floor(y / cell)).toBe(cj);
        expect(Math.floor(x / TILE_M)).toBe(t.ti);
        expect(Math.floor(y / TILE_M)).toBe(t.tj);
        // (never wider than the clearing reaches: a road always clears what could touch it)
        expect(t.r[k]).toBeLessThanOrEqual(CLEAR_RANGE);
      }
    }
  });

  it("forest trees stand inside the forest, scrub outside it, none in water or on a hill's tiers", () => {
    for (const t of [wood, scrub, edge]) {
      for (let k = 0; k < t.n; k++) {
        const p = { x: t.x[k], y: t.y[k] };
        const inForest = terrain.sample(F.forest, p.x, p.y) >= 0.5;
        expect(inForest).toBe(t.grid[k] === 0);
        expect(terrain.isWater(p)).toBe(false);
        expect(terrain.sample(F.mtn, p.x, p.y)).toBeLessThan(MOUNTAIN_STEPS[0]);
      }
    }
  });

  it("a forest closes up into canopy; the scrub is scattered, as thick as its density says", () => {
    const nf = wood.grid.reduce((n, g) => n + (g === 0 ? 1 : 0), 0);
    expect(nf / (TILE_CELLS * TILE_CELLS)).toBeGreaterThan(CANOPY - 0.12);
    expect(nf / (TILE_CELLS * TILE_CELLS)).toBeLessThan(CANOPY + 0.1);
    // (scrub: every standing tree's cell hash is under the density at its spot, and the density keeps to its range)
    for (let k = 0; k < scrub.n; k++) {
      const d = scrubDensity(scrub.x[k], scrub.y[k]);
      expect(d).toBeGreaterThanOrEqual(0.1);
      expect(d).toBeLessThanOrEqual(0.52 + 1e-9);
      expect(thashf(scrub.ci[k], scrub.cj[k], H.dens + SCRUB)).toBeLessThanOrEqual(d);
    }
    expect(scrub.n).toBeLessThan((TILE_CELLS / 2) ** 2 * 0.6);
  });

  it("is the same every time it is asked (a fresh forest over the same land grows the same trees)", () => {
    const again = new Forest(new Terrain(7)).tile(wood.ti, wood.tj);
    expect(again.n).toBe(wood.n);
    expect([...again.x]).toEqual([...wood.x]);
    expect([...again.r]).toEqual([...wood.r]);
  });

  it("the ground's painted crowns are baked from the same list: a texel is set exactly where a tree stands", () => {
    for (const t of [wood, edge, scrub]) {
      // (a square of cells round the tile, from an even cell as the shader needs)
      const c0i = t.ti * TILE_CELLS - 4, c0j = t.tj * TILE_CELLS - 4, n = TILE_CELLS + 8;
      const tex = forest.bake(c0i, c0j, n);
      const forestCells = new Set<string>(), scrubCells = new Set<string>();
      for (let tj = t.tj - 1; tj <= t.tj + 1; tj++) for (let ti = t.ti - 1; ti <= t.ti + 1; ti++) {
        const q = forest.tile(ti, tj);
        for (let k = 0; k < q.n; k++) if (q.alive[k]) (q.grid[k] === 0 ? forestCells : scrubCells).add(`${q.ci[k]},${q.cj[k]}`);
      }
      let painted = 0;
      for (let b = 0; b < n; b++) for (let a = 0; a < n; a++) {
        const ci = c0i + a, cj = c0j + b;
        expect(tex[(b * n + a) * 4] > 127).toBe(forestCells.has(`${ci},${cj}`));
        expect(tex[(b * n + a) * 4 + 1] > 127).toBe(scrubCells.has(`${Math.floor(ci / 2)},${Math.floor(cj / 2)}`));
        if (tex[(b * n + a) * 4] > 127 || tex[(b * n + a) * 4 + 1] > 127) painted++;
      }
      if (t.n) expect(painted).toBeGreaterThan(0);
    }
  });

  it("the painted crown and the 3D tree agree on which trees are evergreen", () => {
    let conifers = 0, total = 0;
    for (let k = 0; k < wood.n; k++) {
      if (wood.grid[k] !== 0) continue;
      const kind = thashf(wood.ci[k], wood.cj[k], H.kind);
      const model = TREE_MODELS[treeModel(kind, wood.r[k], EVERGREEN.forest, false)];
      // (the ground shader paints a conifer when the kind hash is under the share: so must the model be one)
      expect(model === "tree_pine" || model === "tree_spruce").toBe(kind < EVERGREEN.forest);
      expect(model.startsWith("shrub")).toBe(false);
      total++;
      if (kind < EVERGREEN.forest) conifers++;
    }
    expect(conifers / total).toBeGreaterThan(EVERGREEN.forest - 0.15);
    expect(conifers / total).toBeLessThan(EVERGREEN.forest + 0.15);
    // (out in the scrub the small ones are shrubs)
    expect(TREE_MODELS[treeModel(0.9, 1.3, EVERGREEN.scrub, true)].startsWith("shrub")).toBe(true);
    expect(TREE_MODELS[treeModel(0.9, 2.2, EVERGREEN.scrub, true)].startsWith("tree")).toBe(true);
  });
});

describe("trees make way for what is built", () => {
  const game = () => {
    const g = new Game(7);
    g.unlockAll();
    g.money = 1e8;
    return g;
  };
  function lay(g: Game, a: V2, b: V2) {
    const at = (p: V2): Snap => {
      const s = snap(g.net, p, { mpp: 0.4, level: 0, type: "street" });
      return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
    };
    const plan = planRoad(g.net, g.world, { start: at(a), end: at(b), mode: "straight", type: "street" });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    expect(g.build(plan)).toBe(true);
  }

  it("a road through a wood: no standing tree's crown reaches it, every tree it took was in its way, and they come back when it goes", () => {
    const g = game();
    const forest = new Forest(g.terrain);
    forest.setShapes(clearShapes(g.net, g.buildings.list));
    const { wood } = findTiles(forest);
    const before = wood.alive.reduce((n, a) => n + a, 0);
    expect(before).toBeGreaterThan(150);
    const x0 = wood.ti * TILE_M, y0 = wood.tj * TILE_M, v0 = wood.version;
    lay(g, { x: x0 + 8, y: y0 + 20 }, { x: x0 + TILE_M - 8, y: y0 + TILE_M - 30 });
    const shapes = clearShapes(g.net, g.buildings.list);
    const dirty = forest.setShapes(shapes)!;
    // (only the ground round the new road is looked at again)
    expect(dirty.length).toBeGreaterThan(0);
    expect(dirty.length).toBeLessThan(20);
    const t = forest.tile(wood.ti, wood.tj);
    expect(t.version).toBeGreaterThan(v0);
    let felled = 0;
    for (let k = 0; k < t.n; k++) {
      const hit = crownCleared(shapes, { x: t.x[k], y: t.y[k] }, t.r[k]);
      expect(t.alive[k] === 0).toBe(hit);
      expect(forest.cleared(t.x[k], t.y[k], t.r[k])).toBe(hit);
      if (hit) felled++;
    }
    expect(felled).toBeGreaterThan(10);
    expect(felled).toBeLessThan(before);
    // a tile well away from the road was not touched
    expect(forest.ready(wood.ti, wood.tj)).toBe(true);
    // the road goes: the trees are back
    g.undo();
    expect(forest.setShapes(clearShapes(g.net, g.buildings.list))!.length).toBeGreaterThan(0);
    const back = forest.tile(wood.ti, wood.tj);
    expect(back.alive.reduce((n, a) => n + a, 0)).toBe(before);
    // nothing changed: nothing to look at again
    expect(forest.setShapes(clearShapes(g.net, g.buildings.list))).toEqual([]);
  });

  it("a tile dropped from memory and worked out again is never taken for the one that was kept: its version is new", () => {
    // (the 3D trees keep a tile's instances by its version, render/trees3d.ts wildTile, and they keep them longer
    // than the forest keeps the tile: a version that started again from nothing would bring the old trees back)
    const g = game();
    const { wood } = findTiles(new Forest(g.terrain));
    const forest = new Forest(g.terrain, 8);
    const x0 = wood.ti * TILE_M, y0 = wood.tj * TILE_M;
    lay(g, { x: x0 + 8, y: y0 + 20 }, { x: x0 + TILE_M - 8, y: y0 + TILE_M - 30 });
    forest.setShapes(clearShapes(g.net, g.buildings.list));
    const kept = forest.tile(wood.ti, wood.tj);
    const v1 = kept.version, alive1 = Array.from(kept.alive);
    // the view goes elsewhere, over more ground than the forest keeps: the tile is dropped
    for (let i = 1; i <= 9; i++) forest.tile(wood.ti + 100 + i, wood.tj);
    // a second road through the same wood meanwhile
    lay(g, { x: x0 + 60, y: y0 + 8 }, { x: x0 + TILE_M - 8, y: y0 + 50 });
    forest.setShapes(clearShapes(g.net, g.buildings.list));
    const again = forest.tile(wood.ti, wood.tj);
    expect(again).not.toBe(kept);
    expect(Array.from(again.alive)).not.toEqual(alive1);
    expect(again.version).not.toBe(v1);
    // and a tile that only came back as it was is still a new version (worked out again, never an old one's number)
    for (let i = 1; i <= 9; i++) forest.tile(wood.ti + 200 + i, wood.tj);
    expect(forest.tile(wood.ti, wood.tj).version).toBeGreaterThan(again.version);
  });
});
