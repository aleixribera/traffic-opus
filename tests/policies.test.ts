import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { EFFECT, POLICIES, POLICY_IDS } from "../src/game/policies";

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

function town(g: Game) {
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
}

describe("Policies", () => {
  it("unlock over the milestones", () => {
    const g = new Game(7);
    for (const id of POLICY_IDS) expect(g.policies.set(id, true)).toBe(POLICIES[id].unlock === 0);
    expect(g.policies.on.size).toBe(0);
    g.milestone = 9;
    for (const id of POLICY_IDS) expect(g.policies.set(id, true)).toBe(true);
    // every one of them is unlocked somewhere between Village and Large city
    expect(new Set(POLICY_IDS.map((id) => POLICIES[id].unlock)).size).toBeGreaterThan(3);
  });

  it("recycling means less garbage, and the city pays for it every hour", () => {
    const mk = (on: boolean) => {
      const g = new Game(7);
      town(g);
      g.money = 1e6;
      g.milestone = 2;
      if (on) expect(g.policies.set("recycling", true)).toBe(true);
      run(g, 6);
      let bins = 0;
      for (const b of g.buildings.list) bins += b.garbage ?? 0;
      return { g, bins };
    };
    const off = mk(false), on = mk(true);
    expect(off.bins).toBeGreaterThan(20);
    expect(on.bins).toBeLessThan(off.bins * 0.85);
    expect(on.g.budget.expense.policies).toBe(on.g.policies.costOf("recycling"));
    expect(off.g.budget.expense.policies).toBe(0);
  });

  it("water saving cuts what the town uses", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 4;
    run(g, 6);
    g.utilities.tick(0);
    const w = g.utilities.stats.water.used, p = g.utilities.stats.power.used;
    expect(w).toBeGreaterThan(0);
    g.policies.set("watersave", true);
    g.policies.set("energysave", false);
    g.utilities.tick(0);
    expect(g.utilities.stats.water.used).toBeCloseTo(w * EFFECT.water, 6);
    expect(g.utilities.stats.sewage.used).toBeGreaterThan(0);
    expect(g.utilities.stats.power.used).toBeCloseTo(p, 6);
  });

  it("stay in force through a save and load", () => {
    const g = new Game(7);
    g.milestone = 5;
    g.policies.set("smoke", true);
    g.policies.set("energysave", true);
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect([...l.policies.on].sort()).toEqual(["energysave", "smoke"]);
  });
});
