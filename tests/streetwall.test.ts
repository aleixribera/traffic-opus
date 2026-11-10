// The street wall as a town grows into it (docs/design.md "The street wall"): a Hamlet and a Village have none,
// their few shops standing apart by the hall; from a Town on, a short stretch of Main Street by the hall is a row of
// shopfronts shoulder to shoulder, on Main Street's lots and nowhere else, with no home left standing in the middle
// of it; and its street can be widened over the front strip without a front of the wall coming down.

import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_TYPES, ROAD_TYPES, SIDEWALK, roadGroup, roadWidth, type RoadTypeId } from "../src/config";
import { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { WALL_LOTS, ZONE_GROUP, ZONE_LOTS } from "../src/game/growables";
import type { Town } from "../src/game/settlements";
import { MAIN_STREET, WALL_ZONES, blockOf, onMain, wallZone } from "../src/game/towns";
import { ZONE_RANK, type ZoneId } from "../src/game/zones";
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

/** How far a building stands off its town's Main Street line, in blocks. */
const offMain = (t: Town, b: Building) =>
  Math.abs((b.c.x - t.c.x) * -Math.sin(t.ang) + (b.c.y - t.c.y) * Math.cos(t.ang)) / blockOf(t);

describe("the street wall's rules", () => {
  it("none in a hamlet or a village; from a Town on, a short stretch of Main Street by the hall", () => {
    for (let r = 0; r < 6; r += 0.25) {
      expect(wallZone(0, r)).toBeNull();
      expect(wallZone(1, r)).toBeNull();
    }
    for (let s = 2; s < WALL_ZONES.length; s++) {
      expect(wallZone(s, 0.2)).not.toBeNull();
      expect(MAIN_STREET[s]).toBeLessThanOrEqual(2.5);
      expect(wallZone(s, MAIN_STREET[s])).toBeNull();
      if (s > 2) expect(MAIN_STREET[s]).toBeGreaterThanOrEqual(MAIN_STREET[s - 1]);
    }
    // Main Street is the plan's line 0 along it, and nothing else
    expect(onMain([1, 0, 2, 0])).toBe(true);
    expect(onMain([-2, 0, -1, 0])).toBe(true);
    expect(onMain([0, 1, 0, 2])).toBe(false);
    expect(onMain([1, 0, 1, 1])).toBe(false);
    expect(onMain([2, 1, 3, 1])).toBe(false);
  });

  it("steps down from the hall outward, and only ever gets taller as a town grows", () => {
    for (let s = 2; s < WALL_ZONES.length; s++) {
      let last = Infinity;
      for (let r = 0; r < MAIN_STREET[s]; r += 0.25) {
        const z = wallZone(s, r)!;
        expect(ZONE_GROUP[z]).toBe("com");
        expect(ZONE_RANK[z], `size ${s} at ${r}`).toBeLessThanOrEqual(last);
        last = ZONE_RANK[z];
        const was = wallZone(s - 1, r);
        if (was) expect(ZONE_RANK[z], `size ${s} at ${r}`).toBeGreaterThanOrEqual(ZONE_RANK[was]);
      }
    }
    // a Town's is two and three storey shop-houses; towers stand by a City's hall and nowhere else
    expect(wallZone(2, 0.3)).toBe("comLow");
    expect(wallZone(3, 0.3)).toBe("comHigh");
    expect(wallZone(4, 0.3)).toBe("comTower");
    expect(wallZone(3, 1.6)).toBe("comLow");
  });

  it("has a lot of every width from one cell up in every zone, so no stretch of street is left with a gap", () => {
    for (const [zone, lots] of Object.entries(WALL_LOTS) as [ZoneId, typeof WALL_LOTS.comLow][]) {
      const widths = new Set(lots.map((t) => t.w));
      for (let w = 1; w <= Math.max(...widths); w++) expect(widths.has(w), `${zone} ${w} cells`).toBe(true);
      // and each is a kind the zone's detached lots know too (its panel, its parts, its goods)
      for (const t of lots) expect(BUILDING_TYPES[t.model].zone, `${zone} ${t.model}`).toBe("com");
    }
    expect(ZONE_LOTS.comLow.length).toBeGreaterThan(0);
  });
});

describe("a hamlet and a village", () => {
  it("a hamlet has no street wall: its few shops stand apart", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 3; d++) g.fastForward(t.id, 24);
    g.towns.census();
    expect(t.size).toBe(0);
    const mine = zoned(g, t);
    expect(mine.length).toBeGreaterThan(8);
    expect(mine.some((b) => b.wall)).toBe(false);
  }, 120_000);

  it("a village has a handful of shops by its hall, and no street wall", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 240 && t.pop < 1000; d++) g.fastForward(t.id, 6);
    g.towns.census();
    expect(t.size).toBe(1);
    const mine = zoned(g, t);
    expect(mine.some((b) => b.wall)).toBe(false);
    const shops = mine.filter((b) => ZONE_GROUP[b.zone!] === "com");
    expect(shops.length).toBeGreaterThanOrEqual(3);
    expect(shops.length).toBeLessThan(20);
    // most of them by the hall
    const near = shops.filter((b) => dist(b.c, t.c) / blockOf(t) < 1.5);
    expect(near.length, shops.map((b) => (dist(b.c, t.c) / blockOf(t)).toFixed(1)).join(" ")).toBeGreaterThanOrEqual(shops.length / 2);
  }, 300_000);
});

describe("a town", () => {
  let g: Game;
  let t: Town;
  let walls: Building[];
  beforeAll(() => {
    g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e7;
    t = g.towns.list[0];
    for (let d = 0; d < 240 && t.pop < 2200; d++) g.fastForward(t.id, 6);
    // a few days at that size, for the homes on Main Street by the hall to make way for the row
    const hold = t.target;
    for (let d = 0; d < 6; d++) { t.target = hold; g.fastForward(t.id, 24); t.target = hold; }
    g.towns.census();
    walls = zoned(g, t).filter((b) => b.wall);
  }, 300_000);

  it("has a short row of shop-houses on Main Street by its hall, and nowhere else", () => {
    expect(t.size).toBe(2);
    expect(walls.length).toBeGreaterThanOrEqual(5);
    for (const b of walls) {
      // (shop-houses, and by the hall the stores and offices of a Town's centre ring)
      expect(["comLow", "comMid"]).toContain(b.zone);
      expect(dist(b.c, t.c) / blockOf(t), `${b.kind} ${b.id}`).toBeLessThan(MAIN_STREET[2] + 0.5);
      expect(offMain(t, b), `${b.kind} ${b.id} off Main Street`).toBeLessThan(0.6);
    }
    // the rest of its shops stand apart, as before
    const shops = zoned(g, t).filter((b) => ZONE_GROUP[b.zone!] === "com");
    expect(shops.length).toBeGreaterThan(walls.length);
  });

  it("stands its fronts shoulder to shoulder, with no home left in the middle of the row", () => {
    const rows = new Map<string, Building[]>();
    for (const b of walls) rows.set(b.lot!.block, [...(rows.get(b.lot!.block) ?? []), b]);
    let joined = 0;
    for (const row of rows.values()) {
      for (const b of row) if (row.some((o) => o !== b && (o.lot!.col0 === b.lot!.col0 + b.lot!.w || o.lot!.col0 + o.lot!.w === b.lot!.col0))) joined++;
    }
    expect(joined / walls.length).toBeGreaterThan(0.7);
    for (const b of walls) {
      expect(b.fit, `${b.kind} ${b.id}`).toBeCloseTo((2 * b.hw) / BUILDING_TYPES[b.kind].w, 6);
    }
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

  it("keeps every front of the wall when its streets are widened over the front strip, and none ends up on the pavement", () => {
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
      // (every front of the wall: a corner lot on a side street can still be taken when the side street widens,
      // as on any street; that is the zones' business, not the wall's)
      expect(walls.filter((b) => !g.buildings.byId.has(b.id)).map((b) => b.id), `to ${to}`).toEqual([]);
      for (const b of walls) {
        expect(g.buildings.byId.get(b.id)?.wall).toBe(true);
        expect(behindPavement(g, b), `${b.kind} ${b.id} to ${to}`).toBeGreaterThan(-0.05);
      }
    }
    // and nothing of any lot stands in the road or on its pavement
    for (const b of zoned(g, t)) if (b.access && g.net.segs.has(b.access.seg)) expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(-0.05);
  });
});
