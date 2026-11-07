import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import type { Building } from "../src/game/buildings";
import type { PlacedKind } from "../src/game/placed";

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

function run(g: Game, hours: number) {
  for (let i = 0; i < hours * HOUR * 30; i++) g.step(1 / 30);
}

/** A small town on seed 7: homes, shops and industry off a long street in to the origin. */
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

/** A plant beside the long street in (not zoned), or anywhere along a given street. */
function place(g: Game, kind: PlacedKind, a = v2(0, 0), b = v2(366, 473)): Building {
  for (let k = 0; k < 60; k++) {
    const t = 0.1 + k * 0.014;
    const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
    for (const side of [1, -1]) {
      const p = v2(q.x + side * n.x * 40, q.y + side * n.y * 40);
      if (g.placedPlan(kind, p)?.ok) return g.place(kind, p)!;
    }
  }
  throw new Error("no spot for " + kind);
}

const homes = (g: Game) => g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && g.people.householdsIn(b.id));

describe("Electricity", () => {
  it("a town with no plant goes short, and a plant on its roads powers it (and is paid for)", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 6);
    expect(homes(g).length).toBeGreaterThan(0);
    const s = g.utilities.stats;
    expect(s.power.used).toBeGreaterThan(0);
    expect(s.power.made).toBe(0);
    expect(s.power.short).toBeCloseTo(s.power.used, 5);
    // a coal plant on the long street: its output (even before it is staffed) covers the town
    const plant = place(g, "coalplant");
    expect(plant.placed).toBe(true);
    run(g, 0.5);
    expect(g.utilities.outputOf(plant)).toBeGreaterThan(0);
    expect(g.utilities.stats.power.short).toBe(0);
    expect(g.utilities.supplyOf(homes(g)[0]).power).toBe(1);
    run(g, 1);
    expect(g.budget.expense.utilities).toBe(330);
  });

  it("a power shortage doesn't hurt homes or shops (no problem, no lost demand, nobody leaves)", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 24);
    expect(g.utilities.stats.power.short).toBeGreaterThan(0);
    for (const b of g.buildings.list) expect(b.problem ?? "").not.toMatch(/electric|power/i);
    for (const gp of ["res", "com", "ind"] as const) expect(g.demand[gp].factors.some((f) => /electric|power|utilit/i.test(f.label))).toBe(false);
    expect(g.buildings.list.some((b) => b.abandoned)).toBe(false);
  });

  it("placed plants take workers like any workplace", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 6);
    const plant = place(g, "coalplant");
    run(g, 8);
    expect(g.people.workersAt(plant.id)).toBeGreaterThan(0);
    expect(g.utilities.outputOf(plant)).toBeGreaterThan(70 * 0.25);
  });

  it("a plant on roads that don't reach the town supplies nobody", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 5);
    // a street of its own, joined to nothing
    road(g, v2(-200, 200), v2(-200, 420));
    const plant = place(g, "coalplant", v2(-200, 200), v2(-200, 420));
    run(g, 1);
    expect(g.utilities.stats.power.made).toBeGreaterThan(0);
    expect(g.utilities.stats.power.short).toBeGreaterThan(0);
    expect(g.utilities.plantProblem(plant)).toBe("Not connected to anything");
    expect(plant.problem).toBe("Not connected to anything");
  });

  it("a plant can't be built before it unlocks", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    const plant = place(g, "coalplant");
    const at = plant.c;
    g.undo();
    expect(g.buildings.byId.has(plant.id)).toBe(false);
    g.milestone = 0;
    const pl = g.placedPlan("coalplant", at);
    expect(pl?.ok).toBe(false);
    expect(pl?.reason).toBe("Not unlocked yet");
    expect(g.place("coalplant", at)).toBeNull();
  });

  it("a loaded save shows its supply before the clock runs", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 6);
    place(g, "coalplant");
    run(g, 1);
    const { used, made } = g.utilities.stats.power;
    expect(used).toBeGreaterThan(0);
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(l.utilities.stats.power.used).toBeCloseTo(used, 3);
    expect(l.utilities.stats.power.made).toBeCloseTo(made, 3);
    expect(l.buildings.list.filter((b) => b.placed).length).toBe(1);
  });
});
