// A town's commerce keeps pace with its homes (src/game/towns.ts, HIGH_STREET): from a Village on, shops and
// offices line its high streets (the centre cross, and in a City every fourth grid line), out as far as the shops it
// wants. Before, commerce stopped at the centre ring: a City of 8000 had about 25 shops for the 150 its households
// wanted, and jobs for one household in seven.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { ZONE_GROUP } from "../src/game/growables";
import type { Town } from "../src/game/settlements";
import { BLOCK, HIGH_STREET, RINGS, highLine, highStreetReach, ringZone } from "../src/game/towns";
import { ZONE_RANK } from "../src/game/zones";
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
    // along the main street, out past the centre ring: shops; a street over: homes, as its ring has them (points of
    // the town's own plan, which bends its streets: townplan.ts)
    const P = g.towns.planOf(t);
    for (const [a, b] of [[2.5, 0.25], [-3.2, -0.25], [0.25, 3.5], [-0.25, -2.8]]) {
      const p = P.at(a, b);
      if (dist(p, t.c) / BLOCK >= reach) continue;
      const q = Math.abs(a) > Math.abs(b) ? P.at(a + 0.05, 0) : P.at(0, b + 0.05);
      const r = Math.abs(a) > Math.abs(b) ? P.at(a, 0) : P.at(0, b);
      const along = Math.atan2(q.y - r.y, q.x - r.x);
      expect(g.towns.planZone(t, p, along)).toBe(HIGH_STREET[3]);
      const off = Math.abs(a) > Math.abs(b) ? P.at(a, b + 1) : P.at(a + 1, b);
      expect(g.towns.planZone(t, off, along)).toBe(ringZone(3, dist(off, t.c) / BLOCK));
    }
  });

  it("has shops in proportion to its homes, and jobs for a good share of its households", () => {
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
    const shops = mine.filter((b) => ZONE_GROUP[b.zone!] === "com");
    expect(t.shops).toBe(shops.length);
    expect(t.shops).toBeGreaterThan(80); // the centre ring alone holds ~25
    expect(t.shops).toBeGreaterThanOrEqual(0.6 * g.towns.shopsWanted(t));
    expect(t.shops).toBeLessThanOrEqual(g.towns.shopsWanted(t) + 5);
    const jobs = shops.reduce((n, b) => n + b.cap, 0);
    expect(jobs / t.households).toBeGreaterThan(0.25);
    expect(jobs / t.households).toBeLessThan(1);
    // most of them out along the high streets, past the centre ring
    expect(shops.filter((b) => Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y) / BLOCK > RINGS[3][0][0]).length).toBeGreaterThan(t.shops / 2);
    // and the households all have homes
    expect(t.households).toBeLessThanOrEqual(t.homes);
  });
});
