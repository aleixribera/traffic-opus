import { afterEach, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import type { ServiceKind } from "../src/game/services";
import type { Building } from "../src/game/buildings";
import { EXPORT_PRICE, IMPORT_CAP } from "../src/game/utilities";
import { SERVICES } from "../src/game/services";

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

/** The services test's town on seed 7: homes, shops and industry off the motorway link. */
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

/** A plant beside the motorway link (not zoned), or anywhere along a given street. */
function place(g: Game, kind: ServiceKind, a = v2(0, 0), b = v2(366, 473)): Building {
  for (let k = 0; k < 60; k++) {
    const t = 0.1 + k * 0.014;
    const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
    for (const side of [1, -1]) {
      const p = v2(q.x + side * n.x * 40, q.y + side * n.y * 40);
      if (g.servicePlan(kind, p)?.ok) return g.placeService(kind, p)!;
    }
  }
  throw new Error("no spot for " + kind);
}

const homes = (g: Game) => g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && g.people.householdsIn(b.id));

const cap0 = { ...IMPORT_CAP };
afterEach(() => Object.assign(IMPORT_CAP, cap0));

describe("Electricity, water and sewage", () => {
  it("a small town is supplied from outside, and pays for it", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 6);
    expect(homes(g).length).toBeGreaterThan(0);
    const s = g.utilities.stats;
    expect(s.power.used).toBeGreaterThan(0);
    expect(s.power.imported).toBeCloseTo(s.power.used, 5);
    expect(s.water.short).toBe(0);
    expect(g.utilities.worstShare.share).toBe(1);
    expect(g.budget.expense.imports).toBeGreaterThan(0);
    for (const b of homes(g)) expect(g.utilities.problemOf(b)).toBeNull();
  });

  it("when the outside won't sell enough, homes go without, and a plant on the town's roads fixes it", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 5);
    IMPORT_CAP.power = 0;
    run(g, 1);
    const h = homes(g);
    expect(h.length).toBeGreaterThan(0);
    expect(g.utilities.stats.power.short).toBeGreaterThan(0);
    expect(g.utilities.problemOf(h[0])).toBe("No electricity");
    expect(g.utilities.unhappiness(h[0])).toBeGreaterThan(0.3);
    expect(g.demand.res.factors.some((f) => f.label === "Not enough electricity" && f.v < 0)).toBe(true);
    // a coal plant on the motorway link: its output (even before it is staffed) covers the town
    const plant = place(g, "coalplant");
    run(g, 0.5);
    expect(g.utilities.outputOf(plant)).toBeGreaterThan(0);
    expect(g.utilities.stats.power.short).toBe(0);
    expect(g.utilities.problemOf(h[0])).toBeNull();
    expect(g.utilities.stats.power.exported).toBeGreaterThan(0);
    run(g, 1);
    expect(g.budget.expense.utilities).toBe(330);
    expect(g.budget.income.utilities).toBeGreaterThan(0);
  });

  it("a plant on roads that don't reach the town supplies nobody", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 5);
    IMPORT_CAP.power = 0;
    // a street of its own, joined to nothing
    road(g, v2(-200, 200), v2(-200, 420));
    const plant = place(g, "coalplant", v2(-200, 200), v2(-200, 420));
    run(g, 1);
    expect(g.utilities.stats.power.made).toBeGreaterThan(0);
    expect(g.utilities.stats.power.short).toBeGreaterThan(0);
    expect(g.utilities.problemOf(homes(g)[0])).toBe("No electricity");
    expect(g.utilities.plantProblem(plant)).toBe("Not connected to anything");
  });

  it("a brand-new town isn't billed for what it buys in until it is a Hamlet", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    expect(g.milestone).toBe(0);
    expect(g.utilities.stats.power.imported).toBeGreaterThan(0);
    expect(g.budget.expense.imports).toBe(0);
  });

  it("a loaded save shows its supply before the clock runs", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    run(g, 6);
    const used = g.utilities.stats.water.used;
    expect(used).toBeGreaterThan(0);
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(l.utilities.stats.water.used).toBeCloseTo(used, 3);
    expect(l.budget.expense.imports).toBe(g.budget.expense.imports);
  });

  it("no plant pays for itself by selling to the outside", () => {
    for (const d of Object.values(SERVICES)) if (d.out) expect(d.out * EXPORT_PRICE[d.svc as keyof typeof EXPORT_PRICE]).toBeLessThan(d.upkeep);
  });

  it("a water pump has to stand on a shore", () => {
    const g = new Game(7);
    g.money = 1e6;
    for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) g.tiles.add(`${i},${j}`);
    g.zones.rebuildAll();
    // inland: refused
    road(g, v2(-200, 0), v2(-200, -300));
    const inland = g.servicePlan("waterpump", v2(-170, -150));
    expect(inland?.ok).toBe(false);
    expect(inland?.reason).toBe("Has to be on a shore");
    // a street running beside the river (find its bank on two lines across it)
    const bank = (y: number) => { for (let x = 900; x < 2200; x += 2) if (g.world.isWater(v2(x, y))) return x; throw new Error("no river"); };
    const y0 = -40, y1 = 120;
    const a = v2(bank(y0) - 45, y0), b = v2(bank(y1) - 45, y1);
    road(g, a, b);
    const mid = v2((a.x + b.x) / 2 + 20, (a.y + b.y) / 2);
    const pl = g.servicePlan("waterpump", mid);
    expect(pl?.reason).toBeUndefined();
    expect(pl?.ok).toBe(true);
  });
});
