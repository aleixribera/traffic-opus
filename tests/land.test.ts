// The countryside's enclosures (render/land.ts) and the mask of built land (render/landmask.ts): the rules the
// ground shader, the hedges that stand on it and the atlas all draw from. The shader works the same cells out again
// on the GPU, so what is pinned here is what both sides must agree on.

import { describe, it, expect } from "vitest";
import { F, Terrain, riverWater } from "../src/world/terrain";
import {
  ENC, ENC_JIT, ENC_REACH, ENC_WARP, Enclosures, HEDGE_E, HEDGE_N, HEDGE_S, HEDGE_W, MEADOW, OPEN, PASTURE,
  encCell, encKindAlone, encLine, encUnwarp, encWarp, gateAt, type NodeAt,
} from "../src/render/land";
import { rasterPlots, type MaskPlot } from "../src/render/landmask";

describe("the survey grid", () => {
  it("bends no point further than its reach, and the bend can be undone", () => {
    for (let k = 0; k < 400; k++) {
      const x = (k * 7919) % 30000 - 15000, y = (k * 104729) % 30000 - 15000;
      const [dx, dy] = encWarp(x, y);
      expect(Math.abs(dx)).toBeLessThanOrEqual(ENC_WARP[0] + ENC_WARP[1]);
      expect(Math.abs(dy)).toBeLessThanOrEqual(ENC_WARP[0] + ENC_WARP[1]);
      const [ux, uy] = encUnwarp(x + dx, y + dy);
      expect(Math.hypot(ux - x, uy - y)).toBeLessThan(0.5);
    }
  });

  it("is cut into cells of all sizes that leave no gap: a point lies inside the cell found for it", () => {
    const sizes = new Set<number>();
    for (let k = 0; k < 2000; k++) {
      const qx = (k * 37.77) % 9000 - 4500, qy = (k * 91.13) % 9000 - 4500;
      const c = encCell(qx, qy);
      expect(c.fx).toBeGreaterThanOrEqual(0);
      expect(c.fx).toBeLessThan(c.w);
      expect(c.fy).toBeGreaterThanOrEqual(0);
      expect(c.fy).toBeLessThan(c.h);
      expect(c.w).toBeGreaterThanOrEqual(ENC - 2 * ENC_JIT);
      expect(c.w).toBeLessThanOrEqual(ENC + 2 * ENC_JIT);
      expect(encLine(c.ci, 0) + c.fx).toBeCloseTo(qx, 6);
      expect(encLine(c.cj, 1) + c.fy).toBeCloseTo(qy, 6);
      // (a step over its east line is the next cell)
      expect(encCell(qx - c.fx + c.w + 0.01, qy).ci).toBe(c.ci + 1);
      // (the middle of its place on the even grid is never further off than the chunks' margin allows)
      expect(Math.abs((c.ci + 0.5) * ENC - qx)).toBeLessThanOrEqual(ENC / 2 + ENC_JIT);
      sizes.add(Math.round(c.w / 16));
    }
    expect(sizes.size).toBeGreaterThan(4);
    expect(ENC_REACH).toBe(ENC_WARP[0] + ENC_WARP[1] + ENC / 2 + ENC_JIT);
  });

  it("puts a gateway well inside every side", () => {
    for (let i = -20; i < 20; i++) for (const side of [0, 1] as const) {
      const g = gateAt(i, i * 3 + 1, side);
      expect(g).toBeGreaterThanOrEqual(0.14);
      expect(g).toBeLessThanOrEqual(0.86);
    }
  });
});

describe("the enclosures of a real map", () => {
  const terrain = new Terrain(7);
  const at: NodeAt = (f, i, j) => terrain.node(f, i * 4, j * 4);
  const enc = new Enclosures();
  const R = 60;

  it("are fields of pasture and meadow on plain dry ground only, never one alone", () => {
    let pasture = 0, meadow = 0;
    for (let cj = -R; cj < R; cj++) for (let ci = -R; ci < R; ci++) {
      const k = enc.kind(ci, cj, at);
      if (k === OPEN) continue;
      if (k === PASTURE) pasture++; else { expect(k).toBe(MEADOW); meadow++; }
      // (its middle: no water, no wood, no hill, not the fertile soil the farms want)
      const i = ci * 2 + 1, j = cj * 2 + 1;
      expect(at(F.lake, i, j)).toBeLessThanOrEqual(112);
      expect(riverWater(at(F.river, i, j) / 255, at(F.flow, i, j) / 255)).toBeLessThan(0.2);
      expect(at(F.forest, i, j)).toBeLessThanOrEqual(119);
      expect(at(F.mtn, i, j)).toBeLessThanOrEqual(117);
      expect(at(F.fert, i, j)).toBeLessThanOrEqual(132);
      // (and a field by its own ground beside it)
      const beside = encKindAlone(ci + 1, cj, at) || encKindAlone(ci - 1, cj, at) || encKindAlone(ci, cj + 1, at) || encKindAlone(ci, cj - 1, at);
      expect(beside).toBeTruthy();
    }
    const all = 4 * R * R;
    // (a good part of the plain, far from all of it: the open prairie stays the larger share)
    expect(pasture + meadow).toBeGreaterThan(all * 0.04);
    expect(pasture + meadow).toBeLessThan(all * 0.5);
    expect(pasture).toBeGreaterThan(20);
    expect(meadow).toBeGreaterThan(20);
  });

  it("hedge both sides of a boundary alike, and never a cell with open land all round and no field", () => {
    let hedged = 0, joined = 0;
    for (let cj = -R; cj < R; cj++) for (let ci = -R; ci < R; ci++) {
      const b = enc.byte(ci, cj, at), e = enc.byte(ci + 1, cj, at), n = enc.byte(ci, cj + 1, at);
      expect(!!(b & HEDGE_E)).toBe(!!(e & HEDGE_W));
      expect(!!(b & HEDGE_N)).toBe(!!(n & HEDGE_S));
      const k = b & 3, ke = e & 3;
      // (a field's edge against open land is always hedged)
      if (!!k !== !!ke) expect(b & HEDGE_E).toBe(HEDGE_E);
      if (!k && !ke) expect(b & HEDGE_E).toBe(0);
      if (k && k === ke) { if (b & HEDGE_E) hedged++; else joined++; }
      // (the byte is the same from a second set of remembered cells: nothing depends on the order of asking)
      if ((ci + cj) % 17 === 0) expect(new Enclosures().byte(ci, cj, at)).toBe(b);
    }
    expect(hedged).toBeGreaterThan(joined);
    expect(joined).toBeGreaterThan(10);
  });
});

describe("the mask of built land", () => {
  const plot = (kind: string, x: number, y: number, plant = false, rot = 0): MaskPlot => ({ kind, c: { x, y }, rot, hw: 12, hd: 18, plant: plant ? {} : undefined });

  it("is one empty texel when nothing is built", () => {
    const r = rasterPlots([]);
    expect([r.w, r.h, Array.from(r.data)]).toEqual([1, 1, [0, 0, 0, 0]]);
  });

  it("draws a town's lot in red with its ground running out round it, a works in green, a farm in blue", () => {
    const r = rasterPlots([plot("res", 0, 0), plot("factory", 400, 0, true), plot("farm", 0, 400, true, 0.6)]);
    const px = (x: number, y: number) => {
      const i = Math.floor((x - r.x0) / r.texel), j = Math.floor((y - r.y0) / r.texel);
      return Array.from(r.data.subarray((j * r.w + i) * 4, (j * r.w + i) * 4 + 4));
    };
    expect(r.texel).toBeGreaterThanOrEqual(6);
    expect(px(0, 0)).toEqual([255, 0, 0, 255]);
    expect(px(400, 0)).toEqual([0, 255, 0, 0]);
    expect(px(0, 400)).toEqual([0, 0, 255, 0]);
    // (15 m out from the lot's side: past the lot's own pad, half way down the fall of its ground)
    const near = px(12 + 15, 0);
    expect(near[0]).toBe(0);
    expect(near[3]).toBeGreaterThan(90);
    expect(near[3]).toBeLessThan(170);
    // (well clear of everything: nothing)
    expect(px(200, 200)).toEqual([0, 0, 0, 0]);
    expect(px(12 + 36, 0)[3]).toBe(0);
  });

  it("never makes a texture too large to hold, however far apart the plots are", () => {
    const r = rasterPlots([plot("res", -20000, -9000), plot("res", 20000, 9000)]);
    expect(Math.max(r.w, r.h)).toBeLessThanOrEqual(1024);
    expect(r.texel).toBeGreaterThan(30);
  });
});
