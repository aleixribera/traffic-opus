// A town's commerce keeps pace with its homes, and stands in a street wall (src/game/towns.ts WALL_ZONES;
// docs/design.md "The street wall"): from a Village on, shops and offices are built to the pavement along its main
// streets, shoulder to shoulder from the hall outward, as far as the shops it wants; a City's wall steps up to a
// handful of towers by its hall. Before, a City of 8000 had about 25 shops for the 150 its households wanted, no
// two of them touching, and not one tower.

import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { Game } from "../src/game/city";
import { obbOverlap, type Building } from "../src/game/buildings";
import { WALL_LOTS, ZONE_GROUP, ZONE_LOTS } from "../src/game/growables";
import type { Town } from "../src/game/settlements";
import { BLOCK, RINGS, WALL_ZONES, wallCore, wallReach, wallStreet, wallZone, type GridEdge } from "../src/game/towns";
import { CELL, ZONE_RANK, type ZoneId } from "../src/game/zones";
import { dist } from "../src/core/math";

describe("the street wall's rules", () => {
  it("a hamlet has none; from a Village on it runs further out the more shops a town wants", () => {
    for (let n = 0; n < 400; n += 10) expect(wallReach(0, n)).toBe(0);
    expect(wallZone(0, 0.3)).toBeNull();
    for (let s = 1; s < WALL_ZONES.length; s++) {
      let last = 0;
      for (let n = 0; n < 400; n += 5) {
        const r = wallReach(s, n);
        expect(r).toBeGreaterThanOrEqual(last);
        last = r;
      }
      expect(last, `size ${s}`).toBeGreaterThan(3);
    }
    // a village's is a short row by its hall
    expect(wallReach(1, 13)).toBeLessThanOrEqual(1.5);
    // a City's runs along more streets, so not as far for the same shops
    expect(wallReach(3, 200)).toBeLessThan(wallReach(2, 200));
  });

  it("is on Main Street in a village, the cross street too in a town, the core and the through streets in a city", () => {
    const main: GridEdge = [1, 0, 2, 0], cross: GridEdge = [0, 1, 0, 2], core: GridEdge = [1, 0, 1, 1], back: GridEdge = [2, 1, 2, 2];
    const through: GridEdge = [5, 4, 6, 4];
    expect([main, cross, core, back, through].map((e) => wallStreet(0, e))).toEqual([false, false, false, false, false]);
    expect([main, cross, core, back, through].map((e) => wallStreet(1, e))).toEqual([true, false, false, false, false]);
    expect([main, cross, core, back, through].map((e) => wallStreet(2, e))).toEqual([true, true, false, false, false]);
    expect([main, cross, core, back, through].map((e) => wallStreet(3, e))).toEqual([true, true, true, false, true]);
    expect(wallCore(4)).toBeGreaterThan(wallCore(3));
  });

  it("steps down from the hall outward, and only ever gets taller as a town grows", () => {
    for (let s = 1; s < WALL_ZONES.length; s++) {
      let last = Infinity;
      for (let r = 0; r < 8; r += 0.25) {
        const z = wallZone(s, r)!;
        expect(ZONE_GROUP[z]).toBe("com");
        expect(ZONE_RANK[z], `size ${s} at ${r}`).toBeLessThanOrEqual(last);
        last = ZONE_RANK[z];
        if (s > 1) expect(ZONE_RANK[z], `size ${s} at ${r}`).toBeGreaterThanOrEqual(ZONE_RANK[wallZone(s - 1, r)!]);
      }
      // the far end of any wall is two and three storey shop-houses
      expect(wallZone(s, 7)).toBe("comLow");
    }
    // towers stand by a city's hall and nowhere else
    expect(wallZone(2, 0.3)).toBe("comMid");
    expect(wallZone(3, 0.3)).toBe("comHigh");
    expect(wallZone(4, 0.3)).toBe("comTower");
    expect(wallZone(3, 2.5)).not.toBe("comHigh");
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

/** Wall buildings standing shoulder to shoulder: the same block's lot, the next columns along. */
function neighbours(walls: Building[]): Map<number, Building[]> {
  const by = new Map<string, Building[]>();
  for (const b of walls) {
    const a = by.get(b.lot!.block) ?? [];
    a.push(b);
    by.set(b.lot!.block, a);
  }
  const out = new Map<number, Building[]>();
  for (const row of by.values()) {
    for (const b of row) out.set(b.id, row.filter((o) => o !== b && (o.lot!.col0 === b.lot!.col0 + b.lot!.w || o.lot!.col0 + o.lot!.w === b.lot!.col0)));
  }
  return out;
}

describe("a City's commerce", () => {
  let g: Game;
  let t: Town;
  let mine: Building[], shops: Building[], walls: Building[];
  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    for (let d = 0; d < 240 && t.pop < 7000; d++) g.fastForward(t.id, 6);
    // then a few days at that size, for its old houses on the main streets to make way for the wall
    const hold = t.target;
    for (let d = 0; d < 8; d++) { t.target = hold; g.fastForward(t.id, 24); t.target = hold; }
    g.towns.census();
    mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
    shops = mine.filter((b) => ZONE_GROUP[b.zone!] === "com");
    walls = shops.filter((b) => b.wall);
  }, 600_000);

  it("zones its main streets for the wall, and the streets between for homes", () => {
    expect(t.size).toBe(3);
    const reach = wallReach(3, g.towns.shopsWanted(t));
    // along the main street: the wall's zone at that distance; a street over, past the core: homes, as its ring has
    // them (points of the town's own plan, which bends its streets: townplan.ts)
    const P = g.towns.planOf(t);
    let n = 0;
    for (const [a, b] of [[2.5, 0.25], [-3.2, -0.25], [0.25, 3.5], [-0.25, -2.8]]) {
      const p = P.at(a, b);
      const r = dist(p, t.c) / BLOCK;
      if (r >= reach) continue;
      const q = Math.abs(a) > Math.abs(b) ? P.at(a + 0.05, 0) : P.at(0, b + 0.05);
      const o = Math.abs(a) > Math.abs(b) ? P.at(a, 0) : P.at(0, b);
      const along = Math.atan2(q.y - o.y, q.x - o.x);
      expect(g.towns.planZone(t, p, along)).toBe(wallZone(3, r));
      const off = Math.abs(a) > Math.abs(b) ? P.at(a, b + 2) : P.at(a + 2, b);
      expect(ZONE_GROUP[g.towns.planZone(t, off, along)]).toBe("res");
      n++;
    }
    expect(n).toBeGreaterThan(1);
  });

  it("has the shops its homes want, nearly all of them in the wall, and jobs for a good share of its households", () => {
    expect(t.shops).toBe(shops.length);
    const want = g.towns.shopsWanted(t);
    expect(t.shops).toBeGreaterThanOrEqual(0.8 * want);
    expect(t.shops).toBeLessThanOrEqual(want + 5);
    expect(walls.length).toBeGreaterThan(0.8 * shops.length);
    // (a front of the wall is narrower than the detached lots were and holds as many jobs: growables WALL_JOBS)
    const jobs = shops.reduce((n, b) => n + b.cap, 0);
    expect(jobs / t.households).toBeGreaterThan(0.2);
    expect(jobs / t.households).toBeLessThan(1);
    // and the households all have homes
    expect(t.households).toBeLessThanOrEqual(t.homes);
  });

  it("builds every front of the wall exactly as wide as its lot, shoulder to shoulder with the next", () => {
    for (const b of walls) {
      expect(b.fit, `${b.kind} ${b.id}`).toBeCloseTo((2 * b.hw) / BUILDING_TYPES[b.kind].w, 6);
      expect(b.hw * 2, `${b.kind} ${b.id}`).toBeCloseTo(b.lot!.w * CELL, 1);
    }
    const nb = neighbours(walls);
    const joined = walls.filter((b) => nb.get(b.id)!.length > 0);
    expect(joined.length / walls.length).toBeGreaterThan(0.75);
    // neighbours meet: their near ends within a hand's width, their fronts on one line
    let pairs = 0;
    for (const b of walls) {
      for (const o of nb.get(b.id)!) {
        const gap = dist(b.c, o.c) - b.hw - o.hw;
        expect(Math.abs(gap), `${b.id} and ${o.id}`).toBeLessThan(0.35);
        pairs++;
      }
    }
    expect(pairs).toBeGreaterThan(walls.length / 2);
  });

  it("stands no two buildings on the same ground", () => {
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j];
        if (dist(a.c, b.c) > 60) continue;
        expect(obbOverlap(a.c, a.hw - 0.3, a.hd - 0.3, a.rot, b.c, b.hw - 0.3, b.hd - 0.3, b.rot), `${a.kind} ${a.id} on ${b.kind} ${b.id}`).toBe(false);
      }
    }
  });

  it("steps up to a handful of towers by its hall: a compact core, lower the further out", () => {
    const towers = walls.filter((b) => b.kind === "tower" || b.kind === "glasstower");
    expect(towers.length).toBeGreaterThanOrEqual(3);
    expect(towers.length).toBeLessThan(16);
    const far = Math.max(...WALL_ZONES[3]!.filter(([, z]) => z === "comHigh").map(([r]) => r));
    for (const b of towers) expect(dist(b.c, t.c) / BLOCK, `tower ${b.id}`).toBeLessThan(far + 0.75);
    // no front of the wall is of a taller zone than the wall has at its distance (half a block's grace: a lot is
    // zoned where its street front is)
    for (const b of walls) {
      const r = dist(b.c, t.c) / BLOCK;
      expect(ZONE_RANK[b.zone!], `${b.kind} ${b.id} at ${r.toFixed(2)}`).toBeLessThanOrEqual(ZONE_RANK[wallZone(3, Math.max(0, r - 0.5))!]);
    }
    // the middle is offices and towers, the far end shop-houses
    const mean = (bs: Building[]) => bs.reduce((n, b) => n + ZONE_RANK[b.zone!], 0) / Math.max(1, bs.length);
    const near = walls.filter((b) => dist(b.c, t.c) < 1.5 * BLOCK), out = walls.filter((b) => dist(b.c, t.c) > 3 * BLOCK);
    expect(near.length).toBeGreaterThan(8);
    expect(out.length).toBeGreaterThan(8);
    expect(mean(near)).toBeGreaterThan(mean(out) + 1);
    // and past the rings of flats, the town is still mostly houses with gardens
    const homes = mine.filter((b) => ZONE_GROUP[b.zone!] === "res");
    expect(homes.filter((b) => dist(b.c, t.c) / BLOCK > RINGS[3][RINGS[3].length - 1][0]).every((b) => b.zone === "resLow")).toBe(true);
  });

  it("a save from before the wall loads, and its detached shops are rebuilt into the wall in time", () => {
    const old = JSON.parse(JSON.stringify(g.serialize()));
    let n = 0;
    for (const b of old.buildings) if (b.wall) { delete b.wall; delete b.redev; n++; }
    expect(n).toBe(g.buildings.list.filter((b) => b.wall).length);
    const h = Game.load(old);
    const u = h.towns.list[0];
    expect(h.buildings.list.length).toBe(g.buildings.list.length);
    expect(h.buildings.list.some((b) => b.wall)).toBe(false);
    h.towns.census();
    expect(u.shops).toBe(t.shops);
    const hold = u.target;
    for (let d = 0; d < 3; d++) { u.target = hold; h.fastForward(u.id, 24); u.target = hold; }
    expect(h.buildings.list.filter((b) => b.town === u.id && b.wall).length).toBeGreaterThan(3);
  }, 300_000);
});
