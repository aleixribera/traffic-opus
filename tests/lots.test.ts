// A building's lot records the zone block and columns it stands on, and redevelopment works along a block by column.
// A town's own new junctions split its streets and lay their blocks out afresh, shifting the columns: every lot has to
// follow, or redevelopment reads past a block's end (it crashed a City this way).

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { DEPTH } from "../src/game/zones";
import type { Building } from "../src/game/buildings";
import { isPlantKind } from "../src/game/industry";
import { dist, rectCorners } from "../src/core/math";

/** Buildings whose recorded lot is not where their cells say they stand. */
function stale(g: Game): number[] {
  const out: number[] = [];
  for (const b of g.buildings.list) {
    if (!b.lot) continue;
    const blk = g.zones.blocks.get(b.lot.block);
    const fits = !!blk && b.lot.col0 + b.lot.w <= blk.cols;
    const mine = fits && [b.lot.col0, b.lot.col0 + b.lot.w - 1].every((k) => blk!.cells[k * DEPTH].lot === b.id);
    if (!mine) out.push(b.id);
  }
  return out;
}

describe("lots follow their street when it is laid out again", () => {
  it("every lot matches the cells its building stands on as a town grows", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    let lots = 0;
    for (let d = 0; d < 10; d++) {
      g.fastForward(t.id, 24);
      expect(stale(g), `day ${d}`).toEqual([]);
      lots = g.buildings.list.filter((b) => b.lot).length;
    }
    expect(lots).toBeGreaterThan(100);
  }, 300_000);

  it("and after a save is loaded", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 5; d++) g.fastForward(t.id, 24);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(stale(h)).toEqual([]);
  }, 300_000);
});

/**
 * How far two lots overlap (m): the least overlap of their rectangles along any of their four edge directions
 * (separating axes), so 0 or less when they are apart or only touch.
 */
function overlapOf(a: Building, b: Building): number {
  const A = rectCorners(a.c, a.hw, a.hd, a.rot), B = rectCorners(b.c, b.hw, b.hd, b.rot);
  let least = Infinity;
  for (const r of [a.rot, a.rot + Math.PI / 2, b.rot, b.rot + Math.PI / 2]) {
    const ax = Math.cos(r), ay = Math.sin(r);
    const pa = A.map((p) => p.x * ax + p.y * ay), pb = B.map((p) => p.x * ax + p.y * ay);
    least = Math.min(least, Math.min(Math.max(...pa), Math.max(...pb)) - Math.max(Math.min(...pa), Math.min(...pb)));
  }
  return least;
}

/** Pairs of a town's buildings (homes, shops, its hall) whose lots overlap by more than `give` (m). */
function overlapping(g: Game, give = 0.3): string[] {
  const L = g.buildings.list.filter((b) => !isPlantKind(b.kind));
  const out: string[] = [];
  for (let i = 0; i < L.length; i++) for (let j = i + 1; j < L.length; j++) {
    const a = L[i], b = L[j];
    if (dist(a.c, b.c) > Math.hypot(a.hw, a.hd) + Math.hypot(b.hw, b.hd)) continue;
    const o = overlapOf(a, b);
    if (o > give) out.push(`${a.kind} ${a.id} / ${b.kind} ${b.id}: ${o.toFixed(2)} m`);
  }
  return out;
}

describe("lots never overlap", () => {
  // (organic plans: bent and leaning streets, blocks laid out again as junctions split them, older and newer blocks
  // meeting at their backs, redevelopment)
  for (const [seed, days] of [[7, 8], [3, 2], [11, 2]] as const) {
    it(`no two lots of a growing town overlap (seed ${seed})`, () => {
      const g = new Game(seed);
      g.start();
      const t = g.towns.list[0];
      for (let d = 0; d < days; d++) {
        g.fastForward(t.id, 24, 3);
        expect(overlapping(g).slice(0, 6), `day ${d}`).toEqual([]);
      }
      expect(g.buildings.list.filter((b) => b.zone).length).toBeGreaterThan(seed === 7 ? 700 : 150);
      // (and the town rebuilt some of its old lots denser: redevelopment's new lots kept clear too)
      if (seed === 7) expect(g.buildings.list.filter((b) => b.redev).length).toBeGreaterThan(10);
    }, 120_000);
  }
});
