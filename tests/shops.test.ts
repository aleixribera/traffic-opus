import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

function road(g: Game, a: V2, b: V2, type: any = "street") {
  const sa = snap(g.net, a, { mpp: 0.5, level: 0, type });
  const sb = snap(g.net, b, { mpp: 0.5, level: 0, type });
  const plan = planRoad(g.net, g.world, {
    start: sa.node !== undefined || sa.seg !== undefined ? sa : free(a),
    end: sb.node !== undefined || sb.seg !== undefined ? sb : free(b), mode: "straight", type,
  });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

const run = (g: Game, hours: number) => { for (let i = 0; i < hours * HOUR * 30; i++) g.step(1 / 30); };

describe("Shops", () => {
  it("judge their custom over the day, not by how quiet the morning is", () => {
    const g = new Game(7);
    road(g, v2(366, 473), v2(0, 0));
    road(g, v2(-200, 0), v2(0, 0));
    road(g, v2(0, 0), v2(0, -300));
    road(g, v2(-200, 0), v2(-200, -300));
    road(g, v2(-200, -300), v2(0, -300));
    road(g, v2(-200, -150), v2(0, -150));
    const cells = [...g.zones.allCells()].filter((c) => c.ok);
    g.zonePaint(cells.filter((c) => c.c.y < -150), "resLow");
    g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
    g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x >= -100), "ind");
    g.money = 1e6;
    run(g, 60);
    // the same shops, sampled every hour for a day: a shop doing fine doesn't look starved each morning
    const shops = g.buildings.list.filter((b) => b.zone === "comLow" && b.built >= 1 && g.time - b.born > 2 * 24 * HOUR);
    expect(shops.length).toBeGreaterThan(1);
    const starved: number[] = [];
    for (let h = 0; h < 24; h++) {
      run(g, 1);
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
