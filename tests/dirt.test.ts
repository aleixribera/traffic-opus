// The dirt road (owner, 2026-11-08: "Roads are hella expensive for early game, can you add a 1 lane 2 way dirt
// road?"): cheap and slow, buildings can face it, paved in place by drawing a street over it, a paved bridge where
// it has to cross water or a road, and it saves like any road.
import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { LEVEL_H, ROAD_TYPES, roadWidth, type RoadTypeId } from "../src/config";
import { applyPave, commitStrokes, planAddLane, planRoad, upgradeCost, type BuildWorld, type Plan, type Snap } from "../src/roads/planner";
import { BASE } from "../src/game/progression";
import { Game } from "../src/game/city";
import { dist, v2, type V2 } from "../src/core/math";
import { road } from "./helpers";

const world = (over: Partial<BuildWorld> = {}): BuildWorld => ({
  isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9,
  ...over,
});
const free = (p: V2, h = 0): Snap => ({ p, h, guides: [] });
const nodeAt = (net: RoadNetwork, p: V2): Snap => {
  const n = [...net.nodes.values()].find((m) => dist(m.p, p) < 0.05)!;
  expect(n).toBeDefined();
  return { p: { ...n.p }, h: n.h, node: n.id, guides: [] };
};
const onSeg = (net: RoadNetwork, id: number, t: number): Snap => {
  const s = net.segs.get(id)!;
  const c = s.c, u = 1 - t;
  const p = v2(
    u * u * u * c.p0.x + 3 * u * u * t * c.p1.x + 3 * u * t * t * c.p2.x + t * t * t * c.p3.x,
    u * u * u * c.p0.y + 3 * u * u * t * c.p1.y + 3 * u * t * t * c.p2.y + t * t * t * c.p3.y,
  );
  return { p, h: 0, seg: id, t, guides: [] };
};
function build(net: RoadNetwork, plan: Plan) {
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  net.begin();
  if (plan.pave) applyPave(net, plan.pave);
  for (const st of plan.strokes) { commitStrokes(net, [st]); net.rebuild(); }
  net.rebuild();
  net.commit();
}
const lengthOf = (net: RoadNetwork, type: RoadTypeId) =>
  [...net.segs.values()].filter((s) => s.type === type).reduce((a, s) => a + net.segGeom.get(s.id)!.center.length, 0);

describe("the dirt road", () => {
  it("is cheap and slow: about a quarter of a street's price, 30-35 km/h, one lane each way", () => {
    const D = ROAD_TYPES.dirt, S = ROAD_TYPES.street;
    expect(D.fwd).toBe(1);
    expect(D.bwd).toBe(1);
    expect(D.costPerM / S.costPerM).toBeGreaterThanOrEqual(0.22);
    expect(D.costPerM / S.costPerM).toBeLessThanOrEqual(0.34);
    expect(D.speed * 3.6).toBeGreaterThanOrEqual(30);
    expect(D.speed * 3.6).toBeLessThanOrEqual(35);
    // a kilometre of it, as planned and charged
    const net = new RoadNetwork();
    const dirt = planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(1000, 0)), mode: "straight", type: "dirt", bridges: true });
    const street = planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(1000, 0)), mode: "straight", type: "street", bridges: true });
    expect(dirt.cost).toBeCloseTo(1000 * D.costPerM, 0);
    expect(street.cost / dirt.cost).toBeCloseTo(S.costPerM / D.costPerM, 3);
  });

  it("is there from the start, and gives way to every paved road", () => {
    expect(BASE.roads).toContain("dirt");
    for (const id of Object.keys(ROAD_TYPES) as RoadTypeId[]) if (id !== "dirt") expect(ROAD_TYPES[id].rank).toBeGreaterThan(ROAD_TYPES.dirt.rank);
  });

  it("takes driveways, and is as wide as a street (so paving it moves no lot)", () => {
    expect(ROAD_TYPES.dirt.allowsAccess).toBe(true);
    expect(roadWidth(ROAD_TYPES.dirt)).toBe(roadWidth(ROAD_TYPES.street));
    expect(ROAD_TYPES.dirt.minRadius).toBeLessThanOrEqual(ROAD_TYPES.street.minRadius);
  });

  it("its lanes run at its own limit and are rough (heavy trucks ease off on them)", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "dirt" }));
    const lanes = [...net.segGeom.values()].flatMap((g) => g.lanes);
    expect(lanes.length).toBe(2);
    for (const l of lanes) {
      expect(l.speed).toBeCloseTo(ROAD_TYPES.dirt.speed, 6);
      expect(l.rough).toBe(true);
    }
  });

  it("stays on the ground: no raised dirt road, and a paved road on a bridge can't be turned to dirt", () => {
    const net = new RoadNetwork();
    const up = planRoad(net, world(), { start: free(v2(0, 0), LEVEL_H), end: free(v2(200, 0), LEVEL_H), mode: "straight", type: "dirt" });
    expect(up.errors[0]?.msg).toMatch(/Dirt roads stay on the ground/);
    // a raised street can't be downgraded; one on the ground can, for a refund's worth (cost 0)
    build(net, planRoad(net, world(), { start: free(v2(0, 50), LEVEL_H), end: free(v2(200, 50), LEVEL_H), mode: "straight", type: "street" }));
    build(net, planRoad(net, world(), { start: free(v2(0, 100)), end: free(v2(200, 100)), mode: "straight", type: "street" }));
    const raised = [...net.segs.values()].find((s) => net.nodes.get(s.a)!.h > 1)!;
    const low = [...net.segs.values()].find((s) => net.nodes.get(s.a)!.h < 0.1)!;
    expect(upgradeCost(net, world(), raised.id, "dirt").errors[0]?.msg).toMatch(/stay on the ground/);
    const down = upgradeCost(net, world(), low.id, "dirt");
    expect(down.errors).toEqual([]);
    expect(down.cost).toBe(0);
  });

  it("crosses water on a paved street bridge, priced as one, and says so", () => {
    const river = world({ isWater: (p) => p.y > 140 && p.y < 200 });
    const net = new RoadNetwork();
    const plan = planRoad(net, river, { start: free(v2(0, 0)), end: free(v2(0, 340)), mode: "straight", type: "dirt", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.bridges).toHaveLength(1);
    expect(plan.note).toMatch(/paved street/);
    // the same road as a street, less the dirt it saves on the ground
    const street = planRoad(new RoadNetwork(), river, { start: free(v2(0, 0)), end: free(v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(plan.bridges![0].cost).toBeCloseTo(street.bridges![0].cost, 0);
    expect(plan.cost).toBeLessThan(street.cost);
    expect(plan.cost).toBeGreaterThan(street.bridges![0].cost);
    build(net, plan);
    // every raised piece is a street; the ground at either end is dirt
    for (const s of net.segs.values()) {
      const up = Math.max(net.nodes.get(s.a)!.h, net.nodes.get(s.b)!.h) > 0.5;
      expect(s.type).toBe(up ? "street" : "dirt");
    }
    expect(lengthOf(net, "dirt")).toBeGreaterThan(50);
    expect(lengthOf(net, "street")).toBeGreaterThan(60);
  });

  it("is paved in place by drawing a street over it: the same roads, no second road on top", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "dirt" }));
    build(net, planRoad(net, world(), { start: nodeAt(net, v2(300, 0)), end: free(v2(300, 200)), mode: "straight", type: "dirt" }));
    const segs = net.segs.size, nodes = net.nodes.size;
    // the whole first stretch, end to end
    const plan = planRoad(net, world(), { start: nodeAt(net, v2(0, 0)), end: nodeAt(net, v2(300, 0)), mode: "straight", type: "street", bridges: true });
    expect(plan.pave?.pieces.length).toBe(1);
    expect(plan.note).toMatch(/^Paves 30\d m of dirt road$/);
    // priced as an upgrade: a street's price less the dirt's refund
    expect(plan.cost).toBeCloseTo(300 * (ROAD_TYPES.street.costPerM - 0.75 * ROAD_TYPES.dirt.costPerM), -1);
    const id = plan.pave!.pieces[0].seg;
    build(net, plan);
    expect(net.segs.size).toBe(segs);
    expect(net.nodes.size).toBe(nodes);
    expect(net.segs.get(id)!.type).toBe("street");
    expect(lengthOf(net, "dirt")).toBeCloseTo(200, 0);
  });

  it("paves only as far as it's drawn, splitting the dirt road where the street stops", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(400, 0)), mode: "straight", type: "dirt" }));
    const id = [...net.segs.keys()][0];
    const plan = planRoad(net, world(), { start: nodeAt(net, v2(0, 0)), end: onSeg(net, id, 0.5), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.pave).toBeDefined();
    build(net, plan);
    expect(net.segs.size).toBe(2);
    expect(lengthOf(net, "street")).toBeCloseTo(200, 0);
    expect(lengthOf(net, "dirt")).toBeCloseTo(200, 0);
    // the two meet end to end: one plain joint, no junction
    const joint = [...net.nodes.values()].find((n) => dist(n.p, v2(200, 0)) < 1)!;
    expect(net.segsAt(joint.id).length).toBe(2);
    // and the middle of a dirt road paved from one point on it to another, through a junction on the way
    const net2 = new RoadNetwork();
    build(net2, planRoad(net2, world(), { start: free(v2(0, 0)), end: free(v2(600, 0)), mode: "straight", type: "dirt" }));
    build(net2, planRoad(net2, world(), { start: free(v2(300, -150)), end: free(v2(300, 150)), mode: "straight", type: "dirt" }));
    const west = [...net2.segs.values()].find((s) => dist(net2.nodes.get(s.a)!.p, v2(0, 0)) < 1 || dist(net2.nodes.get(s.b)!.p, v2(0, 0)) < 1)!;
    const east = [...net2.segs.values()].find((s) => dist(net2.nodes.get(s.a)!.p, v2(600, 0)) < 1 || dist(net2.nodes.get(s.b)!.p, v2(600, 0)) < 1)!;
    const tOf = (s: typeof west, x: number) => { const a = net2.nodes.get(s.a)!.p.x, b = net2.nodes.get(s.b)!.p.x; return (x - a) / (b - a); };
    const mid = planRoad(net2, world(), { start: onSeg(net2, west.id, tOf(west, 100)), end: onSeg(net2, east.id, tOf(east, 500)), mode: "straight", type: "street", bridges: true });
    expect(mid.errors).toEqual([]);
    expect(mid.pave?.pieces.length).toBe(2);
    build(net2, mid);
    expect(lengthOf(net2, "street")).toBeCloseTo(400, -1);
    // the crossing road stays dirt
    expect(lengthOf(net2, "dirt")).toBeCloseTo(200 + 300, -1);
  });

  it("paved as a one-way, runs the way it was drawn, whichever way each dirt stretch was built", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(150, 0)), mode: "straight", type: "dirt" }));
    build(net, planRoad(net, world(), { start: free(v2(300, 0)), end: nodeAt(net, v2(150, 0)), mode: "straight", type: "dirt" }));
    const plan = planRoad(net, world(), { start: nodeAt(net, v2(0, 0)), end: nodeAt(net, v2(300, 0)), mode: "straight", type: "one1", bridges: true });
    expect(plan.pave?.pieces.length).toBe(2);
    build(net, plan);
    expect(net.segs.size).toBe(2);
    for (const s of net.segs.values()) {
      expect(s.type).toBe("one1");
      expect(net.nodes.get(s.a)!.p.x).toBeLessThan(net.nodes.get(s.b)!.p.x);
    }
  });

  it("is paved end to end across its bridge in one stroke (the bridge is a street already)", () => {
    const river = world({ isWater: (p) => p.y > 140 && p.y < 200 });
    const net = new RoadNetwork();
    build(net, planRoad(net, river, { start: free(v2(0, 0)), end: free(v2(0, 340)), mode: "straight", type: "dirt", bridges: true }));
    const segs = net.segs.size;
    const plan = planRoad(net, river, { start: nodeAt(net, v2(0, 0)), end: nodeAt(net, v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.pave).toBeDefined();
    build(net, plan);
    expect(net.segs.size).toBe(segs);
    expect(lengthOf(net, "dirt")).toBe(0);
  });

  it("is not paved by a road that only crosses it or runs beside it", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "dirt" }));
    const across = planRoad(net, world(), { start: free(v2(150, -100)), end: free(v2(150, 100)), mode: "straight", type: "street", bridges: true });
    expect(across.pave).toBeUndefined();
    expect(across.errors).toEqual([]);
    const beside = planRoad(net, world(), { start: free(v2(0, 30)), end: free(v2(300, 30)), mode: "straight", type: "street", bridges: true });
    expect(beside.pave).toBeUndefined();
    // and a dirt road drawn over dirt is no paving
    const id = [...net.segs.keys()][0];
    const same = planRoad(net, world(), { start: nodeAt(net, v2(0, 0)), end: onSeg(net, id, 0.6), mode: "straight", type: "dirt", bridges: true });
    expect(same.pave).toBeUndefined();
  });

  it("takes no turn lanes until it is paved", () => {
    const net = new RoadNetwork();
    build(net, planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "dirt" }));
    build(net, planRoad(net, world(), { start: free(v2(300, -100)), end: free(v2(300, 100)), mode: "straight", type: "dirt" }));
    const lp = planAddLane(net, world(), v2(280, 1));
    expect(lp?.errors[0]?.msg).toMatch(/Pave the dirt road first/);
  });

  it("upgrades in place in the game, through the upgrade path, and back down again", () => {
    const g = new Game(7);
    g.start();
    const before = g.net.segs.size;
    road(g, v2(4000, 4000), v2(4400, 4000), "dirt");
    const id = [...g.net.segs.values()].find((s) => s.type === "dirt")!.id;
    expect(g.net.segs.size).toBe(before + 1);
    const m0 = g.money;
    const u = g.upgradePlan(id, "street");
    expect(u.errors).toEqual([]);
    expect(g.upgrade(id, "street")).toBe(true);
    expect(g.net.segs.get(id)!.type).toBe("street");
    expect(m0 - g.money).toBeCloseTo(u.cost, 6);
    // undo puts the dirt back
    g.undo();
    expect(g.net.segs.get(id)!.type).toBe("dirt");
    // drawing a street over it in the game paves it and charges the upgrade
    const s = g.net.segs.get(id)!;
    const a = g.net.nodes.get(s.a)!, b = g.net.nodes.get(s.b)!;
    const plan = planRoad(g.net, g.world, { start: { p: a.p, h: 0, node: a.id, guides: [] }, end: { p: b.p, h: 0, node: b.id, guides: [] }, mode: "straight", type: "street", bridges: true });
    expect(plan.pave).toBeDefined();
    const m1 = g.money;
    expect(g.build(plan)).toBe(true);
    expect(g.net.segs.get(id)!.type).toBe("street");
    expect(m1 - g.money).toBeCloseTo(plan.cost, 6);
    expect(g.net.segs.size).toBe(before + 1);
    // and a street can go back to dirt, at the usual rules (no refund beyond the bulldoze rate)
    expect(g.upgrade(id, "dirt")).toBe(true);
    expect(g.net.segs.get(id)!.type).toBe("dirt");
    // a town street laid along it (free) paves it the same way, without taking it over
    const m2 = g.money;
    const town = planRoad(g.net, { ...g.world, money: () => Infinity }, { start: { p: a.p, h: 0, node: a.id, guides: [] }, end: { p: b.p, h: 0, node: b.id, guides: [] }, mode: "straight", type: "street" });
    expect(town.pave).toBeDefined();
    expect(g.buildFree(town, 1)).toBe(true);
    expect(g.net.segs.get(id)!.type).toBe("street");
    expect(g.net.segs.get(id)!.town).toBeUndefined();
    expect(g.money).toBe(m2);
  });

  it("saves and loads back as dirt", () => {
    const g = new Game(7);
    g.start();
    road(g, v2(4000, 4000), v2(4400, 4000), "dirt");
    road(g, v2(4400, 4000), v2(4400, 4300), "dirt");
    const dirt = [...g.net.segs.values()].filter((s) => s.type === "dirt").map((s) => s.id).sort();
    expect(dirt.length).toBe(2);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect([...h.net.segs.values()].filter((s) => s.type === "dirt").map((s) => s.id).sort()).toEqual(dirt);
    for (const id of dirt) expect(h.net.segGeom.get(id)!.lanes.every((l) => l.rough)).toBe(true);
  });
});
