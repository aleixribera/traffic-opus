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

  it("connects a road aimed into a roundabout to its ring", () => {
    const net = new RoadNetwork();
    const w = world();
    const plan = planRoundabout(net, w, v2(100, 100), 1, 0);
    expect(plan.errors).toEqual([]);
    net.begin();
    commitRoundabout(net, plan);
    net.rebuild();
    net.commit();
    const from = free(v2(100, 260));
    // drawn from outside, released on the centre: it ends on the rim, facing the ring
    const end = snap(net, v2(100, 100), { mpp: 0.3, level: 0, type: "street", from });
    expect(end.node !== undefined || end.seg !== undefined).toBe(true);
    build(net, w, from, end);
    const j = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 3);
    expect(j.length).toBe(1);
    // started inside a ring with nothing to aim from: projects to the rim
    const s = snap(net, v2(104, 96), { mpp: 0.3, level: 0, type: "street" });
    expect(s.node !== undefined || s.seg !== undefined).toBe(true);
    // a road straight through the island is refused
    const through = planRoad(net, w, { start: free(v2(40, 100)), end: free(v2(160, 100)), mode: "straight", type: "street" });
    expect(through.errors.map((e) => e.msg)).toContain("Can't cross a roundabout's centre");
  });

  it.each([[1, "street"], [2, "avenue"]] as const)("joins four arms to a %i-lane roundabout exactly where they are aimed (%s)", (lanes, type) => {
    const net = new RoadNetwork();
    const w = world();
    const c = v2(300, 300);
    const plan = planRoundabout(net, w, c, lanes, 0);
    expect(plan.errors).toEqual([]);
    net.begin();
    commitRoundabout(net, plan);
    net.rebuild();
    net.commit();
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]]) {
      const from = free(v2(c.x + dx * 90, c.y + dy * 90));
      const end = snap(net, c, { mpp: 0.3, level: 0, type, from });
      const p = planRoad(net, w, { start: from, end, mode: "straight", type });
      expect(p.errors).toEqual([]);
      build(net, w, from, end, type);
      // the junction sits on the arm's own line, not bent to a nearby ring node
      const j = [...net.nodeGeom.entries()].filter(([, g]) => g.kind === "junction").map(([id]) => net.nodes.get(id)!.p);
      const hit = j.find((q) => Math.abs((q.x - c.x) * dy - (q.y - c.y) * dx) < 0.5 && (q.x - c.x) * dx + (q.y - c.y) * dy > 0);
      expect(hit).toBeDefined();
      // and no leftover ring filler node crowds it (its trimmed arcs would vanish)
      const fillers = [...net.nodes.keys()].filter((id) => net.segsAt(id).length === 2 && net.segsAt(id).every((s) => s.ring));
      for (const f of fillers) expect(Math.hypot(net.nodes.get(f)!.p.x - hit!.x, net.nodes.get(f)!.p.y - hit!.y)).toBeGreaterThan(12);
    }
    const arms3 = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 3);
    expect(arms3.length).toBe(4);
    // four arms a quarter-turn apart need no filler nodes at all: each stretch is one true arc
    const fillers = [...net.nodes.keys()].filter((id) => net.segsAt(id).length === 2 && net.segsAt(id).every((s) => s.ring));
    expect(fillers).toEqual([]);
    // and nobody laps the ring at the road's full limit (about 30 km/h or less)
    const ringLanes = [...net.lanes.values()].filter((l) => net.segs.get(l.seg)?.ring);
    expect(ringLanes.length).toBeGreaterThan(0);
    for (const l of ringLanes) expect(l.speed).toBeLessThan(9.5);
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

describe("angle lock", () => {
  const deg = (p: V2, f: V2) => (Math.atan2(p.y - f.y, p.x - f.x) * 180) / Math.PI;
  it("turns free straight roads in 15° steps off the world grid", () => {
    const net = new RoadNetwork();
    const f = v2(0, 0);
    const o = { mpp: 0.2, level: 0, type: "street" as const, angleStep: true, from: { p: f } };
    expect(deg(snap(net, v2(100, 7), o).p, f)).toBeCloseTo(0, 6);
    expect(deg(snap(net, v2(100, 30), o).p, f)).toBeCloseTo(15, 6);
    expect(deg(snap(net, v2(30, 100), o).p, f)).toBeCloseTo(75, 6);
    // and lengths keep to 8 m cells when asked
    const q = snap(net, v2(100, 7), { ...o, lengthStep: 8 }).p;
    expect(Math.hypot(q.x, q.y)).toBeCloseTo(104, 6);
    // without the lock the raw angle stays
    expect(deg(snap(net, v2(100, 30), { ...o, angleStep: false }).p, f)).toBeCloseTo(16.7, 1);
  });
  it("follows the road it leaves when that is nearer than the world grid", () => {
    const net = new RoadNetwork();
    const f = v2(0, 0);
    const t = v2(Math.cos(0.1), Math.sin(0.1)); // a road leaving at ~5.7°
    const o = { mpp: 0.2, level: 0, type: "street" as const, angleStep: true, from: { p: f, tangent: t } };
    expect(deg(snap(net, v2(100, 10), o).p, f)).toBeCloseTo(5.73, 1); // straight on
    expect(deg(snap(net, v2(100, -1), o).p, f)).toBeCloseTo(0, 6); // the world axis is nearer
  });
});
