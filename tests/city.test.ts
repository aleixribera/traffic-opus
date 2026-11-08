import { describe, it, expect } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import { planGrid, planRoad, planRoundabout, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import { TOWN_COST, TOWN_SPACING } from "../src/game/settlements";
import { SEED_EDGES } from "../src/game/towns";
import { hostTown, okCells, road, zoneFor } from "./helpers";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

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

/** A small hand-drawn town on seed 7: a long street in to the origin and a grid, homes to the north, shops south. */
function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  const cells = okCells(g);
  zoneFor(g, cells.filter((c) => c.c.y < -150), "resLow", 80);
  zoneFor(g, cells.filter((c) => c.c.y >= -150), "comLow");
}

/** Open land on seed 7 a town can be founded on (checked by the first test). */
const SITE = v2(-400, -600);

describe("Roadside land", () => {
  it("has cells only beside roads that allow driveways, on both sides", () => {
    const g = new Game(7);
    expect(okCells(g).length).toBe(0); // no roads yet, no land to build on
    road(g, v2(0, 0), v2(200, 0));
    const cells = okCells(g);
    // 200 m of street: about 24 columns a side, 6 deep
    expect(cells.length).toBeGreaterThan(200);
    expect(cells.some((c) => c.c.y > 0) && cells.some((c) => c.c.y < 0)).toBe(true);
  });

  it("keeps its zoning when a road is split by a new junction", () => {
    const g = new Game(7);
    road(g, v2(0, 0), v2(240, 0));
    g.zoneCells(okCells(g), "comLow");
    const n0 = okCells(g).length;
    road(g, v2(120, 0), v2(120, 160));
    const after = okCells(g).filter((c) => Math.abs(c.c.y) < 60 && Math.abs(c.c.x - 120) > 20);
    // the cells along the old street that weren't under the new one are still zoned
    expect(after.filter((c) => c.zone === "comLow").length).toBeGreaterThan(n0 * 0.7);
  });
});

describe("Towns", () => {
  it("a new company starts with a lived-in hamlet and a few hundred metres of road out of it", () => {
    const g = new Game(7);
    g.start();
    expect(g.towns.list.length).toBe(1);
    const t = g.towns.list[0];
    expect(g.cityName).toBe(t.name);
    expect(t.households).toBeGreaterThanOrEqual(6);
    expect(t.shops).toBeGreaterThanOrEqual(1);
    expect(g.money).toBe(START_MONEY);
    // the road out is the company's (not the town's), and nothing of the start can be undone
    let own = 0;
    for (const s of g.net.segs.values()) if (!s.town) own += g.net.segGeom.get(s.id)!.center.length;
    expect(own).toBeGreaterThan(250);
    expect(own).toBeLessThan(450);
    expect(g.canUndo()).toBe(false);
  });

  it("a town street that joins the company's road leaves that road the company's", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    const own = () => { let L = 0; for (const s of g.net.segs.values()) if (!s.town) L += g.net.segGeom.get(s.id)!.center.length; return L; };
    const own0 = own();
    // as it grows out along the road out of town, its cross streets meet the road and split it
    expect(g.towns.layEdge(t, [2, 0, 2, 1])).toBe(true);
    expect(g.towns.layEdge(t, [3, -1, 3, 0])).toBe(true);
    const splitAt = [...g.net.segs.values()].filter((s) => !s.town).length;
    expect(splitAt).toBeGreaterThan(1);
    expect(own()).toBeCloseTo(own0, 0);
  }, 120000);

  it("a town street laid onto the player's junction drops the undo that would take the junction away", () => {
    const g = new Game(7);
    const t = g.towns.found(SITE, { free: true });
    if (typeof t === "string") throw new Error(t);
    const end = v2(SITE.x - 500, SITE.y - 300);
    road(g, v2(SITE.x - 500, SITE.y + 100), end);
    expect(g.canUndo()).toBe(true);
    // the town lays a street onto the end of it (as its grid would, a node within snapping distance)
    const sn = snap(g.net, end, { mpp: 0.5, level: 0, type: "street" });
    expect(sn.node).toBeDefined();
    const plan = planRoad(g.net, g.world, { start: sn, end: free(v2(end.x + 150, end.y)), mode: "straight", type: "street" });
    expect(g.buildFree(plan, t.id)).toBe(true);
    // undoing the player's road would pull the junction from under the town's street: that undo is gone
    expect(g.canUndo()).toBe(false);
    for (const s of g.net.segs.values()) expect(g.net.nodes.has(s.a) && g.net.nodes.has(s.b)).toBe(true);
  });

  it("a town lays its own streets, zones its land, and homes and shops appear and fill", () => {
    const g = new Game(7);
    expect(g.towns.foundBlock(SITE)).toBeNull();
    const t = g.towns.found(SITE, { free: true });
    if (typeof t === "string") throw new Error(t);
    // its first streets are down at once, and they are the town's (no upkeep, not the player's to undo)
    expect(t.built.size).toBe(SEED_EDGES.length);
    const streets = [...g.net.segs.values()].filter((s) => s.town === t.id);
    expect(streets.length).toBeGreaterThanOrEqual(4);
    expect(g.canUndo()).toBe(false);
    // it wants more homes than its first streets hold: it lays more
    t.target = 60;
    run(g, 30);
    expect(t.built.size).toBeGreaterThan(SEED_EDGES.length);
    expect(okCells(g).filter((c) => c.zone).length).toBeGreaterThan(100);
    const mine = g.buildings.list.filter((b) => b.town === t.id);
    expect(mine.filter((b) => ZONE_GROUP[b.zone!] === "res").length).toBeGreaterThan(10);
    expect(mine.some((b) => ZONE_GROUP[b.zone!] === "com")).toBe(true);
    expect(t.households).toBeGreaterThan(30);
    // shops round the middle, homes beyond
    const r = (b: (typeof mine)[number]) => Math.hypot(b.c.x - t.c.x, b.c.y - t.c.y);
    const shop = mine.filter((b) => ZONE_GROUP[b.zone!] === "com"), homes = mine.filter((b) => ZONE_GROUP[b.zone!] === "res");
    expect(Math.min(...shop.map(r))).toBeLessThan(Math.max(...homes.map(r)));
    // everyone lives in a home of the town
    for (const hh of g.people.households.values()) expect(g.buildings.byId.get(hh.home)?.town).toBe(t.id);
  }, 120000);

  it("founding a town costs money and is refused too close to another, on water or without the money", () => {
    const g = new Game(7);
    const m0 = g.money;
    const a = g.towns.found(SITE);
    if (typeof a === "string") throw new Error(a);
    expect(g.money).toBe(m0 - TOWN_COST);
    expect(g.towns.foundBlock(v2(SITE.x + TOWN_SPACING * 0.8, SITE.y))).toMatch(/^Too close to /);
    // water: the lake south of the start on seed 7
    let wet: V2 | null = null;
    for (let x = -3000; x < 3000 && !wet; x += 50) for (let y = -3000; y < 3000 && !wet; y += 50) if (g.world.isWater(v2(x, y))) wet = v2(x, y);
    expect(wet).not.toBeNull();
    expect(g.towns.foundBlock(wet!)).toBe("Too close to water");
    const far = v2(SITE.x, SITE.y + TOWN_SPACING * 1.2);
    expect(g.towns.foundBlock(far)).toBeNull();
    g.money = TOWN_COST - 1;
    expect(g.towns.foundBlock(far)).toBe("Not enough money");
    expect(g.towns.found(far)).toBe("Not enough money");
    // with no company road near, it warns that the town starts cut off
    expect(g.towns.cutOff(far)).toBe(true);
  });

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
    const seen: string[] = [];
    g.on((e) => { if (e.t === "milestone") seen.push(e.m.id); });
    const m0 = g.money;
    g.progress.onSold("food", 10);
    g.checkMilestones();
    expect(seen).toEqual(["food10"]);
    expect(g.money - m0).toBe(5000);
    expect(g.roadsUnlocked.has("avenue")).toBe(true);
    expect(g.tileSlotsLeft).toBe(3);
    // a second town: roundabouts and a town slot more
    expect(g.featureUnlocked("roundabout")).toBe(false);
    expect(g.townSlots).toBe(2);
  });

  it("buys land next to owned tiles, at a rising price, up to the milestone's limit", () => {
    const g = new Game(7);
    expect(g.tileBlock(2, 0)).toBe("Reach the next milestone to buy more land");
    g.progress.done.push("village"); // Village: 4 more tiles
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
});

describe("Saves", () => {
  it("round-trip towns, their streets, buildings and people", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    t.target = 30;
    run(g, 10);
    t.today = { food: 3 };
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.buildings.list.length).toBe(g.buildings.list.length);
    expect(h.buildings.list.every((b) => b.access)).toBe(true);
    expect(h.buildings.list.filter((b) => b.town === t.id).length).toBe(g.buildings.list.filter((b) => b.town === t.id).length);
    expect(okCells(h).filter((c) => c.zone).length).toBe(okCells(g).filter((c) => c.zone).length);
    expect(h.people.citizens.size).toBe(g.people.citizens.size);
    expect(Math.round(h.money)).toBe(Math.round(g.money));
    const u = h.towns.byId.get(t.id)!;
    expect({ name: u.name, c: u.c, ang: u.ang, target: u.target, today: u.today, built: [...u.built].sort(), failed: [...u.failed].sort() })
      .toEqual({ name: t.name, c: t.c, ang: t.ang, target: t.target, today: t.today, built: [...t.built].sort(), failed: [...t.failed].sort() });
    expect(u.households).toBe(t.households);
    // the town's streets are still the town's
    expect([...h.net.segs.values()].filter((s) => s.town === t.id).length).toBe([...g.net.segs.values()].filter((s) => s.town === t.id).length);
    run(h, 2); // and it keeps running
    expect(h.towns.byId.get(t.id)!.households).toBeGreaterThan(0);
  }, 60000);

  it("saves from before the company economy are refused, clearly", () => {
    const g = new Game(7);
    g.start();
    const json = JSON.parse(JSON.stringify(g.serialize()));
    for (const v of [1, 2, 3, undefined]) expect(() => Game.load({ ...json, v } as typeof json)).toThrow(/older version/);
  });
});

describe("Traffic in a growing town", () => {
  it("keeps traffic moving through a roundabout town (no ring gridlock)", () => {
    const g = new Game(7);
    (g as { money: number }).money = 1e7;
    g.unlockAll();
    road(g, v2(366, 473), v2(0, 60));
    expect(g.build(planRoundabout(g.net, g.world, v2(0, 0), 1, 0))).toBe(true);
    for (const [x, y] of [[0, -160], [160, 0], [-160, 0], [0, 60]]) {
      const from = free(v2(x, y));
      const end = snap(g.net, v2(0, 0), { mpp: 0.3, level: 0, type: "street", from });
      const s0 = snap(g.net, v2(x, y), { mpp: 0.5, level: 0, type: "street" });
      const plan = planRoad(g.net, g.world, { start: s0.node !== undefined ? s0 : from, end, mode: "straight", type: "street" });
      if (!plan.errors.length) g.build(plan);
    }
    // homes on a street out south, too far from the shops round the ring to walk: they drive through it
    road(g, v2(0, -160), v2(0, -760));
    const cells = okCells(g);
    zoneFor(g, cells.filter((c) => c.c.y < -460), "resLow", 60);
    zoneFor(g, cells.filter((c) => c.c.y >= -30), "comLow");
    const { worst, cars } = run(g, 36);
    expect(g.people.stats.population).toBeGreaterThan(30);
    expect(cars).toBeGreaterThan(40);
    expect(worst).toBeLessThan(90);
  }, 120000);

  it("keeps a busy street grid flowing without gridlock", () => {
    const g = new Game(3);
    (g as { money: number }).money = 1e7;
    const grid = planGrid(g.net, g.world, v2(-110, -110), v2(110, 110), v2(1, 0), "street", 0);
    expect(grid.errors.map((e) => e.msg)).toEqual([]);
    expect(g.build(grid)).toBe(true);
    // suburbs up streets north and south, too far to walk: they drive into the grid
    road(g, v2(0, 110), v2(0, 760));
    road(g, v2(0, -110), v2(0, -760));
    const cells = okCells(g);
    zoneFor(g, cells.filter((c) => Math.abs(c.c.y) > 480), "resLow", 120);
    zoneFor(g, cells.filter((c) => Math.abs(c.c.y) <= 120), "comLow");
    const { worst, cars } = run(g, 48);
    expect(g.people.stats.population).toBeGreaterThan(60);
    expect(cars).toBeGreaterThan(60);
    expect(worst).toBeLessThan(90);
    expect(g.traffic.flowScore()).toBeGreaterThan(0.6);
  }, 180000);

  it("a town's own grid keeps flowing as it grows", () => {
    const g = new Game(7);
    const t = g.towns.found(SITE, { free: true });
    if (typeof t === "string") throw new Error(t);
    t.target = 120;
    const { worst, cars } = run(g, 40);
    expect(t.households).toBeGreaterThan(60);
    // (a small town walks to most places: its cars are the few trips across it)
    expect(cars).toBeGreaterThan(10);
    expect(worst).toBeLessThan(90);
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
    zoneFor(g, cells, "resLow");
    const id = hostTown(g, 0).id;
    let houses = 0;
    for (let i = 0; i < 3000; i++) if (g.growIn(id, "res")) houses++;
    expect(houses).toBeGreaterThan(70);
    expect(cells.filter((c) => c.zone && !c.lot).length).toBe(0);
  }, 120000);

  it("so do shops: every zone has a lot small enough for the leftovers between blocks", () => {
    const g = new Game(3);
    (g as { money: number }).money = 1e7;
    expect(g.build(planGrid(g.net, g.world, v2(-110, -110), v2(110, 110), v2(1, 0), "street", 0))).toBe(true);
    const cells = okCells(g);
    zoneFor(g, cells.filter((c) => c.c.y < 0), "comLow");
    zoneFor(g, cells.filter((c) => c.c.y >= 0), "resLow");
    const id = hostTown(g, 0).id;
    for (let i = 0; i < 4000; i++) for (const gp of ["com", "res"] as const) g.growIn(id, gp);
    const left = cells.filter((c) => c.zone && !c.lot);
    // (a lone column between two zones side by side: allow a few)
    expect(left.length).toBeLessThan(cells.length * 0.04);
    // and most land still goes to the bigger lots
    const lots = g.buildings.list.filter((b) => b.zone);
    expect(lots.filter((b) => b.lot!.w * b.lot!.d <= 4).length).toBeLessThan(lots.length * 0.4);
  }, 120000);
});
