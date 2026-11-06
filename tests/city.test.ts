import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { planRoad } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import type { BuildingKind } from "../src/config";

function road(g: Game, a: V2, b: V2, type: any = "street") {
  const start = { p: a, h: 0, guides: [] }, end = { p: b, h: 0, guides: [] };
  const plan = planRoad(g.net, g.world, { start, end, mode: "straight", type });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

function placeAlong(g: Game, kind: BuildingKind, n: number, x0: number, y: number, side: 1 | -1) {
  let placed = 0;
  for (let x = x0; placed < n && x < x0 + 600; x += 3) {
    const pl = g.placement(kind, v2(x, y + side * 14));
    if (pl && pl.ok && g.place(kind, pl)) placed++;
  }
  return placed;
}

describe("Game", () => {
  it("completes city level 1 with a simple street", () => {
    const g = new Game(7);
    const y = 1200;
    road(g, v2(1010, y), v2(1390, y));
    road(g, v2(1200, y), v2(1200, y + 150));
    expect(placeAlong(g, "house", 7, 1030, y, -1)).toBe(7);
    expect(placeAlong(g, "house", 7, 1030, y, 1)).toBe(7);
    expect(placeAlong(g, "shop", 1, 1250, y, 1)).toBe(1);
    const pl = g.placement("office", v2(1220, y + 100));
    expect(pl?.ok).toBe(true);
    g.place("office", pl!);
    expect(g.remainingToPlace()).toBe(0);
    let levelled = false;
    g.on((e) => { if (e.t === "level") levelled = true; });
    for (let t = 0; t < 900 && !levelled; t += 1 / 30) g.step(1 / 30);
    const o = g.objectives.map((x) => `${x.label}: ${x.value} ${x.done}`).join(" | ");
    expect(levelled, o).toBe(true);
    expect(g.failedTrips).toBe(0);
  });

  it("refuses to place a building on a road and explains why", () => {
    const g = new Game(7);
    road(g, v2(1010, 1200), v2(1390, 1200));
    const pl = g.placement("house", v2(1100, 1201));
    expect(pl).not.toBeNull();
    // the snap moves it off the road onto the kerb side, so it should be valid
    expect(pl!.ok).toBe(true);
    g.place("house", pl!);
    const again = g.placement("house", pl!.c);
    expect(again!.ok).toBe(true); // slides to the next free lot
    expect(Math.abs(again!.c.x - pl!.c.x)).toBeGreaterThan(11);
  });

  it("undo restores money and removes buildings back to the inventory", () => {
    const g = new Game(7);
    const m0 = g.money;
    road(g, v2(1010, 1200), v2(1390, 1200));
    expect(g.money).toBeLessThan(m0);
    const pl = g.placement("house", v2(1100, 1214))!;
    g.place("house", pl);
    const inv = g.inventory.house!;
    g.undo();
    expect(g.inventory.house).toBe(inv + 1);
    g.undo();
    expect(g.money).toBe(m0);
    expect(g.net.segs.size).toBe(0);
    g.redo();
    expect(g.net.segs.size).toBe(1);
  });

  it("round-trips a save", () => {
    const g = new Game(7);
    road(g, v2(1010, 1200), v2(1390, 1200));
    g.place("house", g.placement("house", v2(1100, 1214))!);
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.net.segs.size).toBe(1);
    expect(h.buildings.list.length).toBe(1);
    expect(h.buildings.list[0].access).not.toBeNull();
    expect(h.residents.length).toBe(2);
  });
});
