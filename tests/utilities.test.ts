import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { v2, type V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import type { PlacedKind } from "../src/game/placed";
import { PLANTS, UNPOWERED } from "../src/game/industry";
import { layRoad, okCells, road, run, zoneFor } from "./helpers";

// The company's power (utilities.ts): power plants burn coal and power the tier 2 buildings on their roads within
// reach; short of it, a building works slower. Homes and shops don't use it.

/** A small town on seed 7 (homes and shops off a long street in to the origin): workers for the plants. */
function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  const cells = okCells(g);
  zoneFor(g, cells.filter((c) => c.c.y < -150), "resLow", 60);
  zoneFor(g, cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
}

/** A plant beside the street a-b (the long street in by default). */
function place(g: Game, kind: PlacedKind, a: V2 = v2(0, 0), b: V2 = v2(366, 473)): Building {
  for (let k = 0; k < 60; k++) {
    const t = 0.1 + k * 0.014;
    const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    const L = Math.hypot(b.x - a.x, b.y - a.y), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
    for (const side of [1, -1]) for (const o of [40, 55]) {
      const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
      if (g.placedPlan(kind, p)?.ok) return g.place(kind, p)!;
    }
  }
  throw new Error("no spot for " + kind);
}

/** Skip the building site: the materials are in and it is built. */
const finish = (b: Building) => { b.plant!.site = undefined; b.built = 1; };

function company() {
  const g = new Game(7);
  g.unlockAll();
  g.money = 1e7;
  town(g);
  run(g, 4);
  return g;
}

describe("Company power", () => {
  it("a tier 2 building with no power plant in reach works at 40%, and says so", () => {
    const g = company();
    const sm = place(g, "smelter");
    finish(sm);
    sm.plant!.stock = { ore: 6, coal: 6 };
    run(g, 0.5);
    expect(g.utilities.demandOf(sm)).toBe(PLANTS.smelter.power);
    expect(g.utilities.supplyOf(sm)).toBe(0);
    expect(g.utilities.stats.short).toBe(PLANTS.smelter.power);
    if (g.people.workersAt(sm.id) >= sm.cap / 2) expect(sm.problem).toBe(`No power: working at ${Math.round(UNPOWERED * 100)}%`);
  });

  it("a power plant on its roads, with coal, powers it in full and burns coal only while wanted", () => {
    const g = company();
    const pp = place(g, "coalplant");
    finish(pp);
    pp.plant!.stock = { coal: 4 };
    run(g, 2);
    // nothing wants power yet: it idles and keeps its coal
    expect(g.utilities.wanted(pp)).toBe(false);
    expect(pp.plant!.stock.coal).toBe(4);
    if (g.people.workersAt(pp.id) > 0) expect(pp.problem).toMatch(/^Idle/);
    const sm = place(g, "smelter");
    finish(sm);
    sm.plant!.stock = { ore: 6, coal: 6 };
    run(g, 4);
    expect(g.people.workersAt(pp.id)).toBeGreaterThan(0);
    expect(g.utilities.wanted(pp)).toBe(true);
    expect(g.utilities.outputOf(pp)).toBeGreaterThan(PLANTS.smelter.power!);
    expect(g.utilities.supplyOf(sm)).toBe(1);
    expect(g.utilities.powered).toBe(1);
    expect(pp.plant!.stock.coal).toBeLessThan(4);
    expect(sm.problem ?? "").not.toMatch(/power/i);
  });

  it("a power plant out of coal makes nothing", () => {
    const g = company();
    const pp = place(g, "coalplant");
    finish(pp);
    const sm = place(g, "smelter");
    finish(sm);
    run(g, 2);
    expect(g.utilities.outputOf(pp)).toBe(0);
    expect(g.utilities.supplyOf(sm)).toBe(0);
  });

  it("a power plant on roads that don't reach the building powers nothing", () => {
    const g = company();
    // a street of its own, joined to nothing
    road(g, v2(-200, 200), v2(-200, 420));
    const pp = place(g, "coalplant", v2(-200, 200), v2(-200, 420));
    finish(pp);
    pp.plant!.stock = { coal: 6 };
    const sm = place(g, "smelter");
    finish(sm);
    run(g, 1);
    expect(g.utilities.reaches(pp, sm)).toBe(false);
    expect(g.utilities.supplyOf(sm)).toBe(0);
    expect(g.utilities.wanted(pp)).toBe(false);
  });

  it("a plant far down the same roads gives nothing: power reaches only a plant's own reach", () => {
    const g = company();
    const pp = place(g, "coalplant");
    finish(pp);
    pp.plant!.stock = { coal: 6 };
    // a long street west, joined to the town: a second power plant out there with no coal, and a smelter beside it
    const far = v2(-200 - PLANTS.coalplant.reach! - 1200, 0);
    const r = layRoad(g, v2(-200, 0), far);
    if (typeof r === "string") throw new Error(`no road west: ${r}`);
    const [la, lb] = r.legs[r.legs.length - 1];
    const dry = place(g, "coalplant", lb, la);
    finish(dry);
    const sm = place(g, "smelter", lb, la);
    finish(sm);
    run(g, 1);
    expect(g.connected(pp.access!.seg, sm.access!.seg)).toBe(true);
    expect(g.utilities.reaches(pp, sm)).toBe(false);
    expect(g.utilities.reaches(dry, sm)).toBe(true);
    // the town's plant has power to spare, but none of it gets that far
    expect(g.utilities.supplyOf(sm)).toBe(0);
    expect(g.utilities.stats.short).toBeCloseTo(PLANTS.smelter.power!, 5);
  });

  it("homes, shops and tier 1 plants don't use the company's power", () => {
    const g = company();
    const mill = place(g, "sawmill");
    run(g, 2);
    for (const b of g.buildings.list) expect(g.utilities.demandOf(b)).toBe(0);
    expect(g.utilities.supplyOf(mill)).toBe(1);
    for (const b of g.buildings.list) expect(b.problem ?? "").not.toMatch(/power/i);
  });

  it("a building site draws no power", () => {
    const g = company();
    const sm = place(g, "smelter");
    expect(sm.plant!.site).toBeDefined();
    run(g, 0.5);
    expect(g.utilities.demandOf(sm)).toBe(0);
    expect(sm.problem).toMatch(/^Building site: waiting for 10 loads of planks/);
  });

  it("a loaded save shows its power before the clock runs", () => {
    const g = company();
    const pp = place(g, "coalplant");
    finish(pp);
    pp.plant!.stock = { coal: 6 };
    const sm = place(g, "smelter");
    finish(sm);
    run(g, 3);
    const { used, made } = g.utilities.stats;
    expect(used).toBeGreaterThan(0);
    const l = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(l.utilities.stats.used).toBeCloseTo(used, 3);
    expect(l.utilities.stats.made).toBeCloseTo(made, 3);
    expect(l.utilities.supplyOf(l.buildings.byId.get(sm.id)!)).toBe(g.utilities.supplyOf(sm));
  });
});

describe("Tier 2 unlocks", () => {
  it("tier 2 buildings can't be placed before their milestone", () => {
    const g = new Game(7);
    g.money = 1e7;
    town(g);
    expect(g.placedUnlocked("sawmill")).toBe(true);
    for (const k of ["ironmine", "coalmine", "quarry", "smelter", "cementworks", "coalplant"] as PlacedKind[]) expect(g.placedUnlocked(k)).toBe(false);
    const pl = g.placedPlan("smelter", v2(150, 190));
    expect(pl?.ok).toBe(false);
    expect(pl?.reason).toBe("Not unlocked yet");
    g.progress.done.push("food10", "town2", "planks10", "village");
    expect(g.placedUnlocked("ironmine")).toBe(true);
    expect(g.placedUnlocked("coalplant")).toBe(true);
    expect(g.placedUnlocked("smelter")).toBe(false);
  });
});
