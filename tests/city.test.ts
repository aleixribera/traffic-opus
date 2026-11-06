import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { planGrid, planRoad, planRoundabout, snap } from "../src/roads/planner";
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
    // nothing is locked after a level: a level-1 house can be picked up and put back down
    const old = g.buildings.list.find((b) => b.kind === "house" && b.placedLevel === 1)!;
    const inv = g.inventory.house ?? 0;
    const spot = { ...old.c };
    g.bulldoze([], [old.id]);
    expect(g.buildings.byId.has(old.id)).toBe(false);
    expect(g.inventory.house).toBe(inv + 1);
    const again = g.placement("house", spot);
    expect(again?.ok).toBe(true);
    expect(g.place("house", again!)).toBeTruthy();
    expect(g.inventory.house).toBe(inv);
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

  it("keeps traffic moving through a roundabout (no ring gridlock)", () => {
    const g = new Game(7);
    const c = v2(1200, 1200);
    expect(g.build(planRoundabout(g.net, g.world, c, 1, 0))).toBe(true);
    for (const [x, y] of [[1200, 1120], [1270, 1200], [1200, 1255], [1130, 1200]]) {
      const from = { p: v2(x, y), h: 0, guides: [] };
      const end = snap(g.net, c, { mpp: 0.3, level: 0, type: "street", from });
      const plan = planRoad(g.net, g.world, { start: from, end, mode: "straight", type: "street" });
      expect(plan.errors).toEqual([]);
      expect(g.build(plan)).toBe(true);
    }
    const at = (k: BuildingKind, x: number, y: number) => { const pl = g.placement(k, v2(x, y)); expect(pl?.ok).toBe(true); g.place(k, pl!); };
    for (const x of [1135, 1150, 1165]) { at("house", x, 1191); at("house", x, 1209); }
    for (const y of [1140, 1150]) at("house", 1191, y);
    at("shop", 1240, 1191);
    at("office", 1209, 1240);
    for (let t = 0; t < 600; t += 1 / 30) g.step(1 / 30);
    expect(g.failedTrips).toBe(0);
    expect(g.traffic.flowScore()).toBeGreaterThan(0.9);
  });

  it("never deadlocks a busy street at driveways (turn-ins, pull-outs, keep-clear)", () => {
    for (const seed of [2, 7]) {
      const g = new Game(seed);
      const y = 1060;
      road(g, v2(1090, y), v2(1310, y));
      const at = (k: BuildingKind, x: number, yy: number) => { const pl = g.placement(k, v2(x, yy)); if (pl?.ok) g.place(k, pl); };
      for (const x of [1105, 1125, 1145, 1165, 1185]) at("house", x, 1045);
      for (const x of [1105, 1130, 1155, 1205, 1235, 1265, 1295, 1180, 1205, 1180]) at("house", x, 1077);
      at("shop", 1235, 1043);
      at("office", 1280, 1040);
      for (let t = 0; t < 600; t += 1 / 30) g.step(1 / 30);
      expect(g.failedTrips, `seed ${seed}`).toBe(0);
      expect(g.traffic.flowScore(), `seed ${seed}`).toBeGreaterThan(0.9);
    }
  });

  it("keeps a busy street grid flowing without gridlock", () => {
    const g = new Game(3);
    (g as any).inventory = { house: 200, shop: 20, office: 20 };
    expect(g.build(planGrid(g.net, g.world, v2(1090, 1090), v2(1310, 1310), v2(1, 0), "street", 0))).toBe(true);
    const ys = [...new Set([...g.net.nodes.values()].map((nd) => Math.round(nd.p.y)))];
    let h = 0, s = 0, o = 0, i = 0;
    const tryAt = (k: BuildingKind, x: number, yy: number) => { const pl = g.placement(k, v2(x, yy)); return pl?.ok && g.place(k, pl) ? 1 : 0; };
    for (let x = 1095; x < 1310; x += 12) for (const yy of ys) for (const dy of [-13, 13]) {
      i++;
      if (i % 9 === 0 && s < 6) s += tryAt("shop", x, yy + dy);
      else if (i % 11 === 0 && o < 6) o += tryAt("office", x, yy + dy);
      else if (h < 55) h += tryAt("house", x, yy + dy);
    }
    expect(h).toBe(55);
    for (let t = 0; t < 900; t += 1 / 30) g.step(1 / 30);
    expect(g.failedTrips).toBe(0);
    expect(g.traffic.flowScore()).toBeGreaterThan(0.85);
  });

  it("upgrading a built-up street pushes its lots back, and undo puts them back", () => {
    const g = new Game(7);
    const y = 1200;
    road(g, v2(1010, y), v2(1390, y));
    expect(placeAlong(g, "house", 4, 1030, y, -1)).toBe(4);
    expect(placeAlong(g, "house", 4, 1030, y, 1)).toBe(4);
    const seg = [...g.net.segs.keys()][0];
    const before = g.buildings.list.map((b) => ({ ...b.c }));
    const u = g.upgradePlan(seg, "avenue");
    expect(u.errors).toEqual([]);
    expect(u.moves.length).toBe(8);
    expect(g.upgrade(seg, "avenue")).toBe(true);
    for (const [i, b] of g.buildings.list.entries()) {
      expect(Math.abs(b.c.y - y)).toBeCloseTo(Math.abs(before[i].y - y) + 3.5, 1);
      expect(b.access?.seg).toBe(seg); // still has its driveway
    }
    for (let t = 0; t < 120; t += 1 / 30) g.step(1 / 30);
    expect(g.failedTrips).toBe(0);
    g.undo();
    for (const [i, b] of g.buildings.list.entries()) {
      expect(b.c.y).toBeCloseTo(before[i].y, 5);
      expect(b.access?.seg).toBe(seg);
    }
    // back-to-back lots from a parallel street leave no room: refused, and the blockers are named
    const north = g.buildings.list.find((b) => b.c.y < y)!;
    const outer = Math.abs(north.c.y - y) + north.hd;
    const y2 = y - 2 * outer - 1;
    road(g, v2(1010, y2), v2(1390, y2));
    expect(placeAlong(g, "house", 4, 1030, y2, 1)).toBe(4);
    const v = g.upgradePlan(seg, "avenue");
    expect(v.errors.length).toBe(1);
    expect(v.errors[0].buildings!.length).toBe(4);
    expect(v.moves).toEqual([]);
    expect(g.upgrade(seg, "avenue")).toBe(false);
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
