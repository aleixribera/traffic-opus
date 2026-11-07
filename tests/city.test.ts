import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { planGrid, planRoad, planRoundabout, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import type { ZoneId } from "../src/game/zones";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

/** Lay a road, joining existing roads at either end (as the road tool's snapping would). */
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

/** Run the sim for some game hours, tracking the longest any car stood still (and how many cars took to the road). */
function run(g: Game, hours: number) {
  let worst = 0;
  const seen = new Set<number>();
  for (let i = 0; i < hours * HOUR * 30; i++) {
    g.step(1 / 30);
    if (i % 30 === 0) for (const v of g.traffic.vehicles) { worst = Math.max(worst, v.stuck); seen.add(v.id); }
  }
  return { worst, cars: seen.size };
}

const okCells = (g: Game) => [...g.zones.allCells()].filter((c) => c.ok);

/** A small town on seed 7: a long street in to the origin and a grid, zoned homes / shops / industry. */
function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  const cells = okCells(g);
  g.zonePaint(cells.filter((c) => c.c.y < -150), "resLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x >= -100), "ind");
}

describe("Zoning", () => {
  it("makes cells only beside roads that allow driveways, both sides, and paints are undoable", () => {
    const g = new Game(7);
    const before = okCells(g).length;
    expect(before).toBe(0); // no roads yet, no zoning
    road(g, v2(0, 0), v2(200, 0));
    const cells = okCells(g);
    // 200 m of street: about 24 columns a side, 6 deep
    expect(cells.length).toBeGreaterThan(200);
    expect(cells.some((c) => c.c.y > 0) && cells.some((c) => c.c.y < 0)).toBe(true);
    expect(g.zonePaint(cells, "resLow")).toBe(cells.length);
    expect(okCells(g).every((c) => c.zone === "resLow")).toBe(true);
    g.undo();
    expect(okCells(g).every((c) => c.zone === null)).toBe(true);
    g.redo();
    expect(okCells(g).every((c) => c.zone === "resLow")).toBe(true);
  });

  it("refuses zones that aren't unlocked yet", () => {
    const g = new Game(7);
    road(g, v2(0, 0), v2(200, 0));
    expect(g.zonePaint(okCells(g), "resHigh" as ZoneId)).toBe(0);
    expect(g.zonePaint(okCells(g), "comLow")).toBeGreaterThan(0);
  });

  it("keeps zoning when a road is split by a new junction", () => {
    const g = new Game(7);
    road(g, v2(0, 0), v2(240, 0));
    g.zonePaint(okCells(g), "comLow");
    const n0 = okCells(g).length;
    road(g, v2(120, 0), v2(120, 160));
    const after = okCells(g).filter((c) => Math.abs(c.c.y) < 60 && Math.abs(c.c.x - 120) > 20);
    // the cells along the old street that weren't under the new one are still zoned
    expect(after.filter((c) => c.zone === "comLow").length).toBeGreaterThan(n0 * 0.7);
  });
});

describe("Growth, people and money", () => {
  it("grows a town: households move in, find work, shops get goods, income comes in", () => {
    const g = new Game(7);
    town(g);
    const m0 = g.money;
    const { worst } = run(g, 48);
    const s = g.people.stats;
    const by = { res: 0, com: 0, ind: 0 };
    for (const b of g.buildings.list) by[ZONE_GROUP[b.zone!]]++;
    expect(s.population, JSON.stringify(s)).toBeGreaterThan(80);
    expect(by.res).toBeGreaterThan(10);
    expect(by.com + by.ind).toBeGreaterThan(3);
    expect(s.employed).toBeGreaterThan(s.workers * 0.5);
    expect(g.budget.income.res + g.budget.income.ind + g.budget.income.com).toBeGreaterThan(0);
    expect(g.history.length).toBeGreaterThan(40);
    expect(g.money).not.toBe(m0);
    expect(worst, "a car stood still too long").toBeLessThan(90);
    // shops sell to residents (evening trips too), so most aren't short of customers
    const shops = g.buildings.list.filter((b) => b.zone === "comLow" && b.built >= 1 && g.time - b.born > HOUR * 30);
    const lonely = shops.filter((b) => b.problem === "Not enough customers").length;
    expect(lonely).toBeLessThanOrEqual(Math.ceil(shops.length / 3));
  }, 120000);

  it("households move straight into new homes: no highway or outside world needed", () => {
    const g = new Game(7);
    road(g, v2(-200, 0), v2(0, 0));
    road(g, v2(0, 0), v2(0, -300));
    g.zonePaint(okCells(g), "resLow");
    run(g, 12);
    expect(g.people.stats.population).toBeGreaterThan(0);
    // nobody is left on the road with nowhere to go: every household is home
    for (const hh of g.people.households.values()) expect(g.buildings.byId.has(hh.home)).toBe(true);
  }, 60000);

  it("repainting a lot demolishes its building, and undo brings it back", () => {
    const g = new Game(7);
    town(g);
    run(g, 6);
    const b = g.buildings.list.find((x) => x.zone === "resLow")!;
    expect(b).toBeTruthy();
    const cells = g.lotCells(b);
    expect(cells.length).toBeGreaterThan(0);
    g.zonePaint(cells, "comLow");
    expect(g.buildings.byId.has(b.id)).toBe(false);
    g.undo();
    expect(g.buildings.byId.has(b.id)).toBe(true);
    expect(g.lotCells(b).every((c) => c.zone === "resLow")).toBe(true);
  }, 60000);

  it("a road drawn through grown buildings clears them, and undo restores them", () => {
    const g = new Game(7);
    town(g);
    run(g, 8);
    const n = g.buildings.list.length;
    const m = g.money;
    road(g, v2(-190, -228), v2(-10, -228));
    expect(g.buildings.list.length).toBeLessThan(n);
    g.undo();
    expect(g.buildings.list.length).toBe(n);
    expect(g.money).toBeCloseTo(m, 5);
  }, 60000);

  it("reaching a milestone unlocks things and pays its grant", () => {
    const g = new Game(7);
    expect(g.roadsUnlocked.has("avenue")).toBe(false);
    expect(g.featureUnlocked("roundabout")).toBe(false);
    let seen = -1;
    g.on((e) => { if (e.t === "milestone") seen = e.index; });
    const m0 = g.money;
    (g.people.stats as { population: number }).population = 130;
    (g as unknown as { hourly(): void }).hourly();
    expect(g.milestone).toBe(1);
    expect(seen).toBe(1);
    expect(g.money - m0).toBeGreaterThan(7000);
    expect(g.roadsUnlocked.has("avenue")).toBe(true);
    expect(g.featureUnlocked("roundabout")).toBe(true);
  });

  it("buys land next to owned tiles, at a rising price, up to the milestone's limit", () => {
    const g = new Game(7);
    expect(g.tileBlock(2, 0)).toBe("Reach the next milestone to buy more land");
    g.milestone = 2; // Village: 4 more tiles
    expect(g.tileBlock(3, 0)).toMatch(/border/);
    const p0 = g.nextTilePrice;
    const m0 = g.money;
    expect(g.unlockTile(2, 0)).toBe(true);
    expect(g.money).toBe(m0 - p0);
    expect(g.nextTilePrice).toBeGreaterThan(p0);
    expect(g.unlockTile(3, 0)).toBe(true);
    expect(g.unlockTile(4, 0)).toBe(true);
    expect(g.unlockTile(5, 0)).toBe(true);
    expect(g.tileSlotsLeft).toBe(0);
    expect(g.unlockTile(6, 0)).toBe(false);
  });

  it("round-trips a save with zones, buildings and people", () => {
    const g = new Game(7);
    town(g);
    run(g, 10);
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.buildings.list.length).toBe(g.buildings.list.length);
    expect(h.buildings.list.every((b) => b.access)).toBe(true);
    expect(okCells(h).filter((c) => c.zone).length).toBe(okCells(g).filter((c) => c.zone).length);
    expect(h.people.citizens.size).toBe(g.people.citizens.size);
    expect(Math.round(h.money)).toBe(Math.round(g.money));
    expect(() => Game.load({ ...json, v: 1 })).toThrow();
    run(h, 2); // and it keeps running
  }, 60000);
});

describe("Traffic in a growing city", () => {
  it("keeps traffic moving through a roundabout town (no ring gridlock)", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e7;
    g.milestone = 1;
    road(g, v2(366, 473), v2(0, 60));
    expect(g.build(planRoundabout(g.net, g.world, v2(0, 0), 1, 0))).toBe(true);
    for (const [x, y] of [[0, -160], [160, 0], [-160, 0], [0, 60]]) {
      const from = free(v2(x, y));
      const end = snap(g.net, v2(0, 0), { mpp: 0.3, level: 0, type: "street", from });
      const plan = planRoad(g.net, g.world, { start: snap(g.net, v2(x, y), { mpp: 0.5, level: 0, type: "street" }).node !== undefined ? snap(g.net, v2(x, y), { mpp: 0.5, level: 0, type: "street" }) : from, end, mode: "straight", type: "street" });
      if (!plan.errors.length) g.build(plan);
    }
    // homes on a street out south, too far from the jobs round the ring to walk: commuters drive through it
    road(g, v2(0, -160), v2(0, -760));
    const cells = okCells(g);
    g.zonePaint(cells.filter((c) => c.c.y < -460), "resLow");
    g.zonePaint(cells.filter((c) => c.c.y >= -30 && c.c.x < 0), "comLow");
    g.zonePaint(cells.filter((c) => c.c.y >= -30 && c.c.x >= 0), "ind");
    const { worst, cars } = run(g, 36);
    expect(g.people.stats.population).toBeGreaterThan(30);
    expect(cars).toBeGreaterThan(40);
    expect(worst).toBeLessThan(90);
  }, 120000);

  it("keeps a busy zoned street grid flowing without gridlock", () => {
    const g = new Game(3);
    (g as { money: number }).money = 1e7;
    const grid = planGrid(g.net, g.world, v2(-110, -110), v2(110, 110), v2(1, 0), "street", 0);
    expect(grid.errors.map((e) => e.msg)).toEqual([]);
    expect(g.build(grid)).toBe(true);
    // suburbs up streets north and south, too far to walk: their commuters drive into the grid
    road(g, v2(0, 110), v2(0, 760));
    road(g, v2(0, -110), v2(0, -760));
    const cells = okCells(g);
    g.zonePaint(cells.filter((c) => Math.abs(c.c.y) > 480), "resLow");
    g.zonePaint(cells.filter((c) => Math.abs(c.c.y) <= 120 && c.c.x > 0), "ind");
    g.zonePaint(cells.filter((c) => Math.abs(c.c.y) <= 120 && c.c.x <= 0), "comLow");
    const { worst, cars } = run(g, 48);
    expect(g.people.stats.population).toBeGreaterThan(60);
    expect(cars).toBeGreaterThan(60);
    expect(worst).toBeLessThan(90);
    expect(g.traffic.flowScore()).toBeGreaterThan(0.6);
  }, 180000);
});

describe("Zoned land fills up", () => {
  it("a grid zoned for homes grows houses on every zoneable cell, with no strips left that nothing fits", () => {
    const g = new Game(3);
    (g as { money: number }).money = 1e7;
    const grid = planGrid(g.net, g.world, v2(-110, -110), v2(110, 110), v2(1, 0), "street", 0);
    expect(g.build(grid)).toBe(true);
    // every road of the grid has its zone blocks (not just the last one drawn): the same as building them afresh
    const built = okCells(g).length;
    g.zones.rebuildAll();
    expect(built).toBeGreaterThan(800);
    expect(okCells(g).length).toBe(built);
    const cells = okCells(g);
    g.zonePaint(cells, "resLow");
    let houses = 0;
    for (let i = 0; i < 3000; i++) if ((g as any).grow("res")) houses++;
    expect(houses).toBeGreaterThan(70);
    expect(cells.filter((c) => c.zone && !c.lot).length).toBe(0);
  }, 120000);

  it("so do industry and shops: every zone has a lot small enough for the leftovers between blocks", () => {
    const g = new Game(3);
    (g as { money: number }).money = 1e7;
    expect(g.build(planGrid(g.net, g.world, v2(-110, -110), v2(110, 110), v2(1, 0), "street", 0))).toBe(true);
    const cells = okCells(g);
    g.zonePaint(cells.filter((c) => c.c.x > 30), "ind");
    g.zonePaint(cells.filter((c) => c.c.x <= 30 && c.c.y < 0), "comLow");
    g.zonePaint(cells.filter((c) => c.c.x <= 30 && c.c.y >= 0), "resLow");
    for (let i = 0; i < 4000; i++) for (const gp of ["ind", "com", "res"]) (g as any).grow(gp);
    const left = cells.filter((c) => c.zone && !c.lot);
    // (a lone column between two zones painted side by side is the player's doing: allow a few)
    expect(left.length).toBeLessThan(cells.length * 0.04);
    // and most land still goes to the bigger lots
    const lots = g.buildings.list.filter((b) => b.zone);
    expect(lots.filter((b) => b.lot!.w * b.lot!.d <= 4).length).toBeLessThan(lots.length * 0.4);
  }, 120000);
});
