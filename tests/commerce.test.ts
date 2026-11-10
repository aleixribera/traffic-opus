// A town's commerce keeps pace with its homes (src/game/towns.ts, HIGH_STREET): from a Village on, shops and
// offices line its high streets (the centre cross, and in a City every fourth grid line), out as far as the shops it
// wants. Before, commerce stopped at the centre ring: a City of 8000 had about 25 shops for the 150 its households
// wanted, and jobs for one household in seven.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { ZONE_GROUP } from "../src/game/growables";
import type { Town } from "../src/game/settlements";
import { BUILDING_TYPES } from "../src/config";
import { obbOverlap, type Building } from "../src/game/buildings";
import { HIGH_STREET, MAIN_STREET, RINGS, blockOf, highLine, highStreetReach, ringZone, wallZone } from "../src/game/towns";
import { CELL, ZONE_RANK } from "../src/game/zones";
import { dist } from "../src/core/math";

describe("high streets", () => {
  it("run further out the more shops a town wants, from a Village on", () => {
    for (let n = 0; n < 400; n += 10) expect(highStreetReach(0, n)).toBe(0);
    for (let s = 1; s < HIGH_STREET.length; s++) {
      let last = 0;
      for (let n = 0; n < 400; n += 5) {
        const r = highStreetReach(s, n);
        expect(r).toBeGreaterThanOrEqual(last);
        expect(r).toBeGreaterThanOrEqual(RINGS[s][0][0]);
        last = r;
      }
      expect(last, `size ${s}`).toBeGreaterThan(4);
    }
    // a City's run out along more streets, so not as far for the same shops
    expect(highStreetReach(3, 200)).toBeLessThan(highStreetReach(2, 200));
  });

  it("only ever get denser, and in a City take in more streets", () => {
    for (let s = 2; s < HIGH_STREET.length; s++) expect(ZONE_RANK[HIGH_STREET[s]!]).toBeGreaterThanOrEqual(ZONE_RANK[HIGH_STREET[s - 1]!]);
    for (const s of [1, 2, 3, 4]) expect(highLine(s, 0)).toBe(true);
    expect(highLine(2, 4)).toBe(false);
    expect(highLine(3, 4) && highLine(3, 8) && !highLine(3, 3)).toBe(true);
  });
});

describe("a City's commerce", () => {
  let g: Game;
  let t: Town;
  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    for (let d = 0; d < 240 && t.pop < 7000; d++) g.fastForward(t.id, 6);
    // then a few days at that size, for its old houses on the high streets to make way for shops
    const hold = t.target;
    for (let d = 0; d < 8; d++) { t.target = hold; g.fastForward(t.id, 24); t.target = hold; }
    g.towns.census();
  }, 600_000);

  it("zones its high streets for shops, and the streets between for homes", () => {
    expect(t.size).toBe(3);
    const reach = highStreetReach(3, g.towns.shopsWanted(t));
    // along the main street, out past the centre ring and its wall: shops; a street over: homes, as its ring has them (points of
    // the town's own plan, which bends its streets: townplan.ts)
    const P = g.towns.planOf(t);
    for (const [a, b] of [[2.5, 0.25], [-3.2, -0.25], [0.25, 3.5], [-0.25, -2.8]]) {
      const p = P.at(a, b);
      if (dist(p, t.c) / blockOf(t) >= reach || dist(p, t.c) / blockOf(t) < MAIN_STREET[3]) continue;
      const q = Math.abs(a) > Math.abs(b) ? P.at(a + 0.05, 0) : P.at(0, b + 0.05);
      const r = Math.abs(a) > Math.abs(b) ? P.at(a, 0) : P.at(0, b);
      const along = Math.atan2(q.y - r.y, q.x - r.x);
      expect(g.towns.planZone(t, p, along)).toBe(HIGH_STREET[3]);
      const off = Math.abs(a) > Math.abs(b) ? P.at(a, b + 1) : P.at(a + 1, b);
      expect(g.towns.planZone(t, off, along)).toBe(ringZone(3, dist(off, t.c) / blockOf(t)));
    }
  });

  it("has shops in proportion to its homes, and jobs for a good share of its households", () => {
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
    const shops = mine.filter((b) => ZONE_GROUP[b.zone!] === "com");
    expect(t.shops).toBe(shops.length);
    expect(t.shops).toBeGreaterThan(95); // the centre ring alone holds ~25 (about 120 before the front strips, ~104 with them and sparser towns)
    expect(t.shops).toBeGreaterThanOrEqual(0.6 * g.towns.shopsWanted(t));
    expect(t.shops).toBeLessThanOrEqual(g.towns.shopsWanted(t) + 5);
    const jobs = shops.reduce((n, b) => n + b.cap, 0);
    expect(jobs / t.households).toBeGreaterThan(0.25);
    expect(jobs / t.households).toBeLessThan(1);
    // most of them out along the high streets, past the centre ring
    expect(shops.filter((b) => Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y) / blockOf(t) > RINGS[3][0][0]).length).toBeGreaterThan(t.shops / 2);
    // and the households all have homes
    expect(t.households).toBeLessThanOrEqual(t.homes);
  });

  it("has a short street wall on Main Street by its hall, its fronts built to their lots and shoulder to shoulder", () => {
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
    const walls = mine.filter((b) => b.wall);
    expect(walls.length).toBeGreaterThanOrEqual(6);
    // (a few dozen at most: the rest of its commerce stands apart along the high streets)
    expect(walls.length).toBeLessThan(0.4 * t.shops);
    for (const b of walls) {
      const r = dist(b.c, t.c) / blockOf(t);
      expect(r, `${b.kind} ${b.id}`).toBeLessThan(MAIN_STREET[3] + 0.5);
      const off = Math.abs((b.c.x - t.c.x) * -Math.sin(t.ang) + (b.c.y - t.c.y) * Math.cos(t.ang)) / blockOf(t);
      expect(off, `${b.kind} ${b.id} off Main Street`).toBeLessThan(0.6);
      expect(b.fit, `${b.kind} ${b.id}`).toBeCloseTo((2 * b.hw) / BUILDING_TYPES[b.kind].w, 6);
      // (as wide as its cells, or trimmed a hair to clear a neighbour that stood there first)
      expect(b.hw * 2, `${b.kind} ${b.id}`).toBeLessThanOrEqual(b.lot!.w * CELL + 0.01);
      expect(b.hw * 2, `${b.kind} ${b.id}`).toBeGreaterThan(b.lot!.w * CELL - 0.6);
    }
    let joined = 0;
    for (const b of walls) {
      const nb = walls.filter((o) => o !== b && o.lot!.block === b.lot!.block && (o.lot!.col0 === b.lot!.col0 + b.lot!.w || o.lot!.col0 + o.lot!.w === b.lot!.col0));
      if (nb.length) joined++;
      for (const o of nb) expect(Math.abs(dist(b.c, o.c) - b.hw - o.hw), `${b.id} and ${o.id}`).toBeLessThan(0.35);
    }
    expect(joined / walls.length).toBeGreaterThan(0.7);
  });

  it("has a handful of towers by its hall for a skyline, not a downtown", () => {
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
    const towers = mine.filter((b) => b.kind === "tower" || b.kind === "glasstower" || b.kind === "aptower");
    expect(towers.length).toBeGreaterThanOrEqual(3);
    expect(towers.length).toBeLessThanOrEqual(16);
    for (const b of towers) expect(dist(b.c, t.c) / blockOf(t), `${b.kind} ${b.id}`).toBeLessThan(2);
    // no front of the wall is of a taller zone than the wall has at its distance (half a block's grace: a lot is
    // zoned where its street front is)
    for (const b of mine.filter((b) => b.wall)) {
      const r = dist(b.c, t.c) / blockOf(t);
      const z = wallZone(3, Math.max(0, r - 0.5));
      if (z) expect(ZONE_RANK[b.zone!], `${b.kind} ${b.id} at ${r.toFixed(2)}`).toBeLessThanOrEqual(Math.max(ZONE_RANK[z], ZONE_RANK[ringZone(3, Math.max(0, r - 0.5))]));
    }
    // and past the rings of flats, the town is houses with gardens
    const homes = mine.filter((b) => ZONE_GROUP[b.zone!] === "res");
    expect(homes.filter((b) => dist(b.c, t.c) / blockOf(t) > RINGS[3][RINGS[3].length - 1][0]).every((b) => b.zone === "resLow")).toBe(true);
  });

  it("stands no two buildings on the same ground", () => {
    const mine: Building[] = g.buildings.list.filter((b) => b.town === t.id);
    for (let i = 0; i < mine.length; i++) {
      for (let j = i + 1; j < mine.length; j++) {
        const a = mine[i], b = mine[j];
        if (dist(a.c, b.c) > 60) continue;
        expect(obbOverlap(a.c, a.hw - 0.3, a.hd - 0.3, a.rot, b.c, b.hw - 0.3, b.hd - 0.3, b.rot), `${a.kind} ${a.id} on ${b.kind} ${b.id}`).toBe(false);
      }
    }
  });

  it("a save from before the wall loads unchanged, and its shops on Main Street are rebuilt into the wall in time", () => {
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
