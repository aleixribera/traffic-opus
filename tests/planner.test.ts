import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { commitRoundabout, commitStrokes, planGrid, planRoad, planRoundabout, snap, type BuildWorld, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { LEVEL_H } from "../src/config";

const world = (over: Partial<BuildWorld> = {}): BuildWorld => ({
  isWater: () => false,
  isMountain: () => false,
  inBounds: () => true,
  unlocked: () => true,
  buildingsHit: () => [],
  money: () => 1e9,
  ...over,
});

const free = (p: V2, h = 0): Snap => ({ p, h, guides: [] });

function build(net: RoadNetwork, w: BuildWorld, a: Snap, b: Snap, type: any = "street", mode: any = "straight") {
  const plan = planRoad(net, w, { start: a, end: b, mode, type });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  net.begin();
  commitStrokes(net, plan.strokes);
  const cs = net.rebuild();
  net.commit();
  return { plan, cs };
}

describe("planner", () => {
  it("turns a crossing into a four-way junction", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, free(v2(0, 100)), free(v2(200, 100)));
    build(net, w, free(v2(100, 0)), free(v2(100, 200)));
    const juncs = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 4);
    expect(juncs.length).toBe(1);
    expect(net.segs.size).toBe(4);
  });

  it("snaps onto a road and makes a T junction", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, free(v2(0, 100)), free(v2(200, 100)));
    const s = snap(net, v2(80, 101.5), { mpp: 0.5, level: 0, type: "street", from: { p: v2(80, 0) } });
    expect(s.seg).toBeDefined();
    build(net, w, free(v2(80, 0)), s);
    const t = [...net.nodeGeom.values()].filter((g) => g.arms.length === 3);
    expect(t.length).toBe(1);
  });

  it("reports buildings, water and shallow crossings with specific messages", () => {
    const net = new RoadNetwork();
    build(net, world(), free(v2(0, 100)), free(v2(300, 100)));
    const p1 = planRoad(net, world({ buildingsHit: () => [7] }), { start: free(v2(0, 0)), end: free(v2(50, 0)), mode: "straight", type: "street" });
    expect(p1.errors[0].msg).toBe("Building in the way");
    expect(p1.errors[0].buildings).toEqual([7]);
    const p2 = planRoad(net, world({ isWater: (p) => p.x > 20 }), { start: free(v2(0, 0)), end: free(v2(50, 0)), mode: "straight", type: "street" });
    expect(p2.errors.some((e) => e.msg.includes("bridge"))).toBe(true);
    const p3 = planRoad(net, world(), { start: free(v2(50, 90)), end: free(v2(250, 110)), mode: "straight", type: "street" });
    expect(p3.errors.some((e) => e.msg.startsWith("Crossing too shallow") || e.msg.startsWith("Overlaps"))).toBe(true);
  });

  it("needs a long enough ramp and leaves bridges grade-separated", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, free(v2(100, 0)), free(v2(100, 400)));
    const short = planRoad(net, w, { start: free(v2(0, 50)), end: free(v2(30, 50), LEVEL_H), mode: "straight", type: "one1" });
    expect(short.errors.some((e) => e.msg.startsWith("Ramp too short: needs 55 m"))).toBe(true);
    // a bridge over the road at level 1
    build(net, w, free(v2(0, 200), LEVEL_H), free(v2(200, 200), LEVEL_H));
    expect([...net.nodeGeom.values()].some((g) => g.arms.length >= 3)).toBe(false);
  });

  it("drops a roundabout onto a crossroads", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, free(v2(0, 100)), free(v2(200, 100)));
    build(net, w, free(v2(100, 0)), free(v2(100, 200)));
    const plan = planRoundabout(net, w, v2(100, 100), 1, 0);
    expect(plan.errors).toEqual([]);
    net.begin();
    commitRoundabout(net, plan);
    net.rebuild();
    net.commit();
    const ring = [...net.segs.values()].filter((s) => s.ring);
    expect(ring.length).toBeGreaterThanOrEqual(4);
    const j = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 3);
    expect(j.length).toBe(4);
    // nothing left inside the ring
    for (const n of net.nodes.values()) expect(Math.hypot(n.p.x - 100, n.p.y - 100)).toBeGreaterThan(10);
  });

  it("builds a street grid with junctions at every crossing", () => {
    const net = new RoadNetwork();
    const w = world();
    const plan = planGrid(net, w, v2(0, 0), v2(290, 160), v2(1, 0), "street", 0);
    expect(plan.errors).toEqual([]);
    net.begin();
    for (const st of plan.strokes) { commitStrokes(net, [st]); net.rebuild(); }
    net.commit();
    const four = [...net.nodeGeom.values()].filter((g) => g.arms.length === 4).length;
    const three = [...net.nodeGeom.values()].filter((g) => g.arms.length === 3).length;
    expect(four).toBe(2); // 3x2 blocks -> 2 inner crossings
    expect(three).toBe(6);
  });
});
