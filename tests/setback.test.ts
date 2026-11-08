// Homes stand back from their street behind a front strip their driveways cross (config ZONE_SETBACK), so a street
// upgraded to any road that still takes driveways keeps every home, shop and the town hall.
import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { ROAD_TYPES, ZONE_SETBACK, roadWidth, SIDEWALK, roadGroup } from "../src/config";
import { cubicClosest } from "../src/roads/planner";

describe("front strips", () => {
  it("are wide enough for every road homes can face, pavement included", () => {
    for (const t of Object.values(ROAD_TYPES)) if (t.allowsAccess) expect(ZONE_SETBACK).toBeGreaterThan(roadWidth(t) / 2 + SIDEWALK[roadGroup(t)]);
  });

  it("let a town's streets become divided avenues without losing a home or the hall", () => {
    const g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e7;
    for (let i = 0; i < 4000; i++) g.step(0.5);
    const homes = g.buildings.list.filter((b) => b.zone);
    expect(homes.length).toBeGreaterThan(10);
    const ids = g.buildings.list.map((b) => b.id).sort((a, b) => a - b);
    let n = 0;
    for (const id of [...g.net.segs.keys()]) {
      const s = g.net.segs.get(id);
      if (!s || s.type !== "street") continue;
      expect(g.upgradePlan(id, "avenueM").errors.map((e) => e.msg)).toEqual([]);
      expect(g.upgrade(id, "avenueM")).toBe(true);
      n++;
    }
    expect(n).toBeGreaterThan(3);
    for (let i = 0; i < 20; i++) g.step(0.5);
    expect(g.buildings.list.map((b) => b.id).filter((id) => ids.includes(id)).length).toBe(ids.length);
    // every home still reaches its road, its driveway starting at the new kerb
    for (const b of g.buildings.list.filter((x) => x.zone)) {
      expect(b.access).not.toBeNull();
      const s = g.net.segs.get(b.access!.seg)!;
      expect(Math.abs(cubicClosest(s.c, b.front).d - roadWidth(ROAD_TYPES[s.type]) / 2)).toBeLessThan(0.6);
    }
    // and back to streets: still all there, still on their roads
    for (const id of [...g.net.segs.keys()]) if (g.net.segs.get(id)?.type === "avenueM") g.upgrade(id, "street");
    for (let i = 0; i < 20; i++) g.step(0.5);
    for (const b of g.buildings.list.filter((x) => x.zone)) expect(b.access).not.toBeNull();
  });
});
