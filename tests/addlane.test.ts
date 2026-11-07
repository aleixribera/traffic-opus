import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { commitStrokes, planAddLane, planRoad, slipLaneEnd, snap, type BuildWorld } from "../src/roads/planner";
import { straightCubic, v2, type V2 } from "../src/core/math";
import { LANE_W, type RoadTypeId } from "../src/config";
import { Game } from "../src/game/city";

const world = (over: Partial<BuildWorld> = {}): BuildWorld => ({
  isWater: () => false, isMountain: () => false, inBounds: () => true, unlocked: () => true, buildingsHit: () => [], money: () => 1e9, ...over,
});

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "street") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}

/** Streets crossing at (0,0); w runs west -> east into it, so eastbound traffic is on its +y side. */
function cross(type: RoadTypeId = "street") {
  const net = new RoadNetwork();
  net.begin();
  const X = net.addNode(v2(0, 0), 0);
  const W = net.addNode(v2(-300, 0), 0), E = net.addNode(v2(300, 0), 0), N = net.addNode(v2(0, -300), 0), S = net.addNode(v2(0, 300), 0);
  const w = road(net, W, X, type);
  road(net, X, E, type); road(net, X, N, type); road(net, X, S, type);
  net.commit();
  net.rebuild();
  return { net, X, w };
}

const apply = (net: RoadNetwork, lp: NonNullable<ReturnType<typeof planAddLane>>) => {
  net.begin();
  net.setPocket(lp.pocket!.seg, lp.pocket!.end, lp.pocket!.to);
  net.commit();
  net.rebuild();
};

describe("Add lane: turn lanes", () => {
  it("nearer the middle it is a left-turn lane from the cursor to the stop line, nearer the kerb a right-turn lane", () => {
    const { net, w } = cross();
    const lp = planAddLane(net, world(), v2(-60, 0.2 * LANE_W))!;
    expect(lp.errors).toEqual([]);
    expect(lp.pocket).toMatchObject({ seg: w, end: "b", side: "l" });
    // from here to the stop line, in 5 m steps
    expect(lp.pocket!.len % 5).toBe(0);
    expect(lp.pocket!.len).toBeGreaterThanOrEqual(45);
    expect(lp.pocket!.len).toBeLessThanOrEqual(60);
    expect(lp.label).toBe(`Left-turn lane ${lp.pocket!.len} m`);
    expect(lp.cost).toBeGreaterThan(0);
    // the preview outline sits on the eastbound side
    expect(lp.outline.length).toBeGreaterThan(6);
    expect(Math.min(...lp.outline.map((p) => p.y))).toBeGreaterThan(-0.01);
    apply(net, lp);
    // the kerb half: a right-turn lane, keeping the left one
    const rp = planAddLane(net, world(), v2(-40, 0.85 * LANE_W))!;
    expect(rp.pocket).toMatchObject({ side: "r" });
    expect(rp.pocket!.to).toEqual({ l: lp.pocket!.len, r: rp.pocket!.len });
    // the westbound side of the same road ends at the far (dead) end: nothing to turn into
    expect(planAddLane(net, world(), v2(-60, -0.5 * LANE_W))!.errors[0].msg).toBe("Turn lanes go just before a junction");
  });

  it("caps the lane at what fits, and takes it away again", () => {
    const { net, w } = cross();
    const lp = planAddLane(net, world(), v2(-295, 0.2 * LANE_W))!;
    expect(lp.errors).toEqual([]);
    expect(lp.label).toMatch(/all that fits/);
    expect(lp.pocket!.len).toBeLessThan(290);
    apply(net, lp);
    expect(net.segs.get(w)!.pk?.b?.l).toBe(lp.pocket!.len);
    const rm = planAddLane(net, world(), v2(-60, 0.2 * LANE_W), true)!;
    expect(rm.errors).toEqual([]);
    expect(rm.pocket!.to).toBeNull();
    expect(rm.label).toBe("Remove left-turn lane");
    apply(net, rm);
    expect(net.segs.get(w)!.pk).toBeUndefined();
    // nothing left to remove
    expect(planAddLane(net, world(), v2(-60, 0.2 * LANE_W), true)!.errors[0].msg).toBe("No left-turn lane here");
  });

  it("refuses buildings in the way and an empty purse", () => {
    const { net } = cross();
    expect(planAddLane(net, world({ buildingsHit: () => [7] }), v2(-60, 0.2 * LANE_W))!.errors[0].msg).toBe("Building in the way");
    expect(planAddLane(net, world({ money: () => 0 }), v2(-60, 0.2 * LANE_W))!.errors[0].msg).toBe("Not enough money");
    expect(planAddLane(net, world(), v2(-60, 40))).toBeNull();
  });

  it("checks for buildings where the road widens at the kerb, for a left-turn lane too", () => {
    const { net } = cross();
    // a building just past the eastbound kerb (y = one lane out): the left-turn lane pushes the through lane onto it
    const near = world({ buildingsHit: (pts) => (pts.some((q) => q.x < -5 && q.x > -40 && q.y > LANE_W + 1) ? [7] : []) });
    const lp = planAddLane(net, near, v2(-50, 0.2 * LANE_W))!;
    expect(lp.pocket!.side).toBe("l");
    expect(lp.errors[0]?.msg).toBe("Building in the way");
    expect(Math.max(...lp.widen!.map((q) => q.y))).toBeCloseTo(2 * LANE_W, 1);
  });

  it("a turn lane can still be taken away after the road became a one-way motorway", () => {
    const { net, w } = cross();
    apply(net, planAddLane(net, world(), v2(-60, 0.2 * LANE_W))!);
    net.begin();
    net.setType(w, "hw1");
    net.commit();
    net.rebuild();
    const rm = planAddLane(net, world(), v2(-60, 0), true)!;
    expect(rm.errors).toEqual([]);
    expect(rm.pocket).toMatchObject({ seg: w, end: "b", to: null });
    apply(net, rm);
    expect(net.segs.get(w)!.pk).toBeUndefined();
  });
});

describe("Add lane: motorway slip lanes", () => {
  const free = (p: V2) => ({ p, h: 0, guides: [] });
  const on = (net: RoadNetwork, p: V2) => snap(net, p, { mpp: 0.2, level: 0, type: "one1" });
  it("clicking the carriageway before an exit's deceleration lane draws that lane back to there", () => {
    const net = new RoadNetwork();
    net.begin();
    road(net, net.addNode(v2(0, 0), 0), net.addNode(v2(2000, 0), 0), "hw2");
    net.commit();
    net.rebuild();
    const w = world();
    const exit = planRoad(net, w, { start: on(net, v2(800, 0)), end: free(v2(1020, 110)), mode: "straight", type: "hw1" });
    expect(exit.errors).toEqual([]);
    net.begin();
    commitStrokes(net, exit.strokes);
    net.commit();
    net.rebuild();
    const lane0 = [...net.segs.values()].find((s) => slipLaneEnd(net, s.id))!;
    const x0 = net.nodes.get(lane0.a)!.p.x;
    const lp = planAddLane(net, w, v2(450, 1))!;
    expect(lp.errors).toEqual([]);
    expect(lp.road).toBeDefined();
    expect(lp.road!.removeSegs).toEqual([lane0.id]);
    expect(lp.label).toBe("350 m slip lane");
    expect(x0).toBeGreaterThan(450);
  });
});

describe("Add lane in the game", () => {
  it("charges for a turn lane and undo gives it back", () => {
    const g = new Game(7);
    const lay = (a: V2, b: V2) => {
      const sa = snap(g.net, a, { mpp: 0.5, level: 0, type: "street" }), sb = snap(g.net, b, { mpp: 0.5, level: 0, type: "street" });
      const plan = planRoad(g.net, g.world, { start: sa.node !== undefined || sa.seg !== undefined ? sa : { p: a, h: 0, guides: [] }, end: sb.node !== undefined || sb.seg !== undefined ? sb : { p: b, h: 0, guides: [] }, mode: "straight", type: "street" });
      expect(plan.errors.map((e) => e.msg)).toEqual([]);
      expect(g.build(plan)).toBe(true);
    };
    lay(v2(0, 0), v2(200, 0));
    lay(v2(100, -100), v2(100, 100));
    const m0 = g.money;
    // the arm from the west: eastbound traffic keeps to whichever side is right of the road's direction
    const s = [...g.net.segs.values()].find((x) => Math.max(g.net.nodes.get(x.a)!.p.x, g.net.nodes.get(x.b)!.p.x) < 101 && Math.abs(g.net.nodes.get(x.a)!.p.y) < 1)!;
    const fwd = g.net.nodes.get(s.b)!.p.x > g.net.nodes.get(s.a)!.p.x;
    const lp = planAddLane(g.net, g.world, v2(60, (fwd ? 1 : -1) * 0.2 * LANE_W))!;
    expect(lp.errors.map((e) => e.msg)).toEqual([]);
    expect(lp.pocket!.side).toBe("l");
    expect(g.addLane(lp)).toBe(true);
    expect(g.money).toBeCloseTo(m0 - lp.cost, 5);
    expect(g.net.segGeom.get(s.id)!.lanes.some((l) => l.pocket === "l")).toBe(true);
    g.undo();
    expect(g.money).toBeCloseTo(m0, 5);
    expect(g.net.segGeom.get(s.id)!.lanes.some((l) => l.pocket)).toBe(false);
  });
});
