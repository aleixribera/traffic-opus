// The street wall as a town grows into it (docs/design.md "The street wall"): a Hamlet has none, its few shops
// standing apart at its crossroads; a Village has a short row of shop-houses by its hall, shoulder to shoulder on Main
// Street; the row is on Main Street's lots and nowhere else, with no home left standing in the middle of it; and its
// street can be widened over the front strip without a front of the wall coming down.

import { beforeAll, describe, expect, it } from "vitest";
import { ROAD_TYPES, SIDEWALK, roadGroup, roadWidth, type RoadTypeId } from "../src/config";
import { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { ZONE_GROUP } from "../src/game/growables";
import type { Town } from "../src/game/settlements";
import { BLOCK, wallReach } from "../src/game/towns";
import { dist, rectDistance } from "../src/core/math";

const zoned = (g: Game, t: Town) => g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);

/** How far a lot keeps behind its own road's pavement (negative: on it). */
function behindPavement(g: Game, b: Building): number {
  const s = g.net.segs.get(b.access!.seg)!;
  const T = ROAD_TYPES[s.type];
  const edge = roadWidth(T) / 2 + SIDEWALK[roadGroup(T)];
  let worst = Infinity;
  for (const p of g.net.segGeom.get(s.id)!.center.pts) worst = Math.min(worst, rectDistance(p, b.c, b.hw, b.hd, b.rot) - edge);
  return worst;
}

describe("a hamlet", () => {
  it("has no street wall: its shops stand apart", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 3; d++) g.fastForward(t.id, 24);
    g.towns.census();
    expect(t.size).toBe(0);
    const mine = zoned(g, t);
    expect(mine.length).toBeGreaterThan(8);
    expect(mine.some((b) => b.wall)).toBe(false);
    expect(wallReach(0, g.towns.shopsWanted(t))).toBe(0);
  }, 120_000);
});

describe("a village", () => {
  let g: Game;
  let t: Town;
  let walls: Building[];
  beforeAll(() => {
    g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e7;
    t = g.towns.list[0];
    for (let d = 0; d < 240 && t.pop < 800; d++) g.fastForward(t.id, 6);
    // a few days at that size, for the homes on Main Street by the hall to make way for the row
    const hold = t.target;
    for (let d = 0; d < 6; d++) { t.target = hold; g.fastForward(t.id, 24); t.target = hold; }
    g.towns.census();
    walls = zoned(g, t).filter((b) => b.wall);
  }, 300_000);

  it("has a short row of shop-houses by its hall, on Main Street", () => {
    expect(t.size).toBe(1);
    const shops = zoned(g, t).filter((b) => ZONE_GROUP[b.zone!] === "com");
    const want = g.towns.shopsWanted(t);
    expect(shops.length).toBeGreaterThanOrEqual(0.75 * want);
    expect(walls.length).toBeGreaterThanOrEqual(5);
    expect(walls.length).toBeGreaterThan(0.6 * shops.length);
    // two and three storey shop-houses, nothing taller
    for (const b of walls) {
      expect(b.zone).toBe("comLow");
      expect(["highstreet", "shop"]).toContain(b.kind);
    }
    // a short row: no further out than the shops it wants need, and on one street (a line through the hall)
    const reach = wallReach(1, want);
    expect(reach).toBeLessThanOrEqual(2.5);
    for (const b of walls) expect(dist(b.c, t.c) / BLOCK, `${b.kind} ${b.id}`).toBeLessThan(reach + 0.75);
    const main = { x: Math.cos(t.ang), y: Math.sin(t.ang) };
    for (const b of walls) {
      const off = Math.abs((b.c.x - t.c.x) * -main.y + (b.c.y - t.c.y) * main.x);
      expect(off, `${b.kind} ${b.id} off Main Street`).toBeLessThan(BLOCK * 0.6);
    }
  });

  it("stands its fronts shoulder to shoulder, with no home left in the middle of the row", () => {
    const rows = new Map<string, Building[]>();
    for (const b of walls) rows.set(b.lot!.block, [...(rows.get(b.lot!.block) ?? []), b]);
    let joined = 0;
    for (const row of rows.values()) {
      for (const b of row) if (row.some((o) => o !== b && (o.lot!.col0 === b.lot!.col0 + b.lot!.w || o.lot!.col0 + o.lot!.w === b.lot!.col0))) joined++;
    }
    expect(joined / walls.length).toBeGreaterThan(0.7);
    // (a home on a block of the row, between two of its fronts)
    let between = 0;
    for (const b of zoned(g, t)) {
      if (ZONE_GROUP[b.zone!] !== "res" || !b.lot) continue;
      const row = rows.get(b.lot.block);
      if (!row) continue;
      const lo = Math.min(...row.map((o) => o.lot!.col0)), hi = Math.max(...row.map((o) => o.lot!.col0));
      if (b.lot.col0 > lo && b.lot.col0 < hi) between++;
    }
    expect(between).toBeLessThanOrEqual(1);
  });

  it("keeps every front when its streets are widened over the front strip, and none ends up on the pavement", () => {
    const ids = g.buildings.list.map((b) => b.id);
    for (const b of walls) expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(1);
    const steps: [RoadTypeId, RoadTypeId][] = [["street", "avenue"], ["avenue", "avenueM"]];
    for (const [from, to] of steps) {
      let n = 0;
      for (const id of [...g.net.segs.keys()]) {
        const s = g.net.segs.get(id);
        if (!s || s.type !== from || s.town !== t.id) continue;
        if (g.upgradePlan(id, to).errors.length) continue;
        if (g.upgrade(id, to)) n++;
      }
      expect(n).toBeGreaterThan(3);
      expect(ids.filter((id) => !g.buildings.byId.has(id)), `to ${to}`).toEqual([]);
      for (const b of walls) {
        expect(g.buildings.byId.get(b.id)?.wall).toBe(true);
        expect(behindPavement(g, b), `${b.kind} ${b.id} to ${to}`).toBeGreaterThan(-0.05);
      }
    }
  });
});
