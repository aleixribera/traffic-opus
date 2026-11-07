import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { v2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { okCells, road, run, stockShops, zoneFor } from "./helpers";

describe("Shops", () => {
  it("judge their custom over the day, not by how quiet the morning is", () => {
    const g = new Game(7);
    road(g, v2(366, 473), v2(0, 0));
    road(g, v2(-200, 0), v2(0, 0));
    road(g, v2(0, 0), v2(0, -300));
    road(g, v2(-200, 0), v2(-200, -300));
    road(g, v2(-200, -300), v2(0, -300));
    road(g, v2(-200, -150), v2(0, -150));
    const cells = okCells(g);
    zoneFor(g, cells.filter((c) => c.c.y < -150), "resLow", 60);
    zoneFor(g, cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
    g.money = 1e6;
    run(g, 60, () => stockShops(g));
    // the same shops, sampled every hour for a day: a shop doing fine doesn't look starved each morning
    const shops = g.buildings.list.filter((b) => b.zone === "comLow" && b.built >= 1 && g.time - b.born > 2 * 24 * HOUR);
    expect(shops.length).toBeGreaterThan(1);
    const starved: number[] = [];
    for (let h = 0; h < 24; h++) {
      run(g, 1, () => stockShops(g));
      starved.push(shops.filter((b) => b.problem === "Not enough customers").length);
    }
    expect(Math.max(...starved) - Math.min(...starved)).toBeLessThanOrEqual(1);
    // and keep their books through a save
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    for (const b of shops) expect(l.buildings.byId.get(b.id)?.custDay).toBe(b.custDay);
    // a save from before shops kept books: busy shops aren't all flagged the moment it loads
    const old = JSON.parse(JSON.stringify(g.serialize()));
    for (const b of old.buildings) { delete b.custDay; delete b.custToday; }
    const o = Game.load(old);
    run(g, 1);
    run(o, 1);
    const flagged = (x: Game) => shops.filter((b) => x.buildings.byId.get(b.id)?.problem === "Not enough customers").length;
    expect(flagged(o)).toBeLessThanOrEqual(flagged(g));
  });
});
