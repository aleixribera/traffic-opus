// The road tool (docs/design.md, "Road tool modes", "Snapping"): Curve and Straight, the snapping and its guides,
// the errors it fixes by itself, the bridges it raises the road onto, and homes cleared for a road.
import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { LEVEL_H, ROAD_TYPES, roadWidth } from "../src/config";
import { applyStubs, applyTrim, commitStrokes, cubicClosest, planRoad, type BuildWorld, type Plan, type PlanInput, type Snap } from "../src/roads/planner";
import { toolSnap, type ToolSnap, type ToolSnapOpts } from "../src/roads/snapping";
import { BLOCK } from "../src/game/towns";
import { Game } from "../src/game/city";
import { add, cubicTangent, dist, dot, norm, scale, sub, tangentArc, v2, type V2 } from "../src/core/math";

const world = (over: Partial<BuildWorld> = {}): BuildWorld => ({
  isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9,
  ...over,
});
const free = (p: V2, h = 0): Snap => ({ p, h, guides: [] });

function commit(net: RoadNetwork, plan: Plan) {
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  net.begin();
  if (plan.trim) { applyTrim(net, plan.trim); net.rebuild(); }
  for (const st of plan.strokes) { commitStrokes(net, [st]); net.rebuild(); }
  net.commit();
}
function build(net: RoadNetwork, w: BuildWorld, inp: PlanInput) {
  const plan = planRoad(net, w, inp);
  commit(net, plan);
  return plan;
}
const nodeAt = (net: RoadNetwork, p: V2): Snap => {
  const n = [...net.nodes.values()].find((m) => dist(m.p, p) < 0.05)!;
  expect(n).toBeDefined();
  return { p: { ...n.p }, h: n.h, node: n.id, guides: [] };
};
/** A snap onto the road under p (as the tool would catch it there). */
const onRoad = (net: RoadNetwork, p: V2): Snap => {
  for (const s of net.segs.values()) {
    const r = cubicClosest(s.c, p);
    if (r.d < 0.5) return { p: r.p, h: 0, seg: s.id, t: r.t, guides: [] };
  }
  throw new Error("no road there");
};
const opts = (o: Partial<ToolSnapOpts> = {}): ToolSnapOpts => ({ mpp: 0.5, level: 0, type: "street", ...o });
/** How far a guide catches the cursor at that zoom (7 px). */
const tol = 7 * 0.5;

describe("Curve mode", () => {
  it("leaves its start along the road it carries on, and chains four curves with no kinks", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(100, 0)), mode: "straight", type: "street" });
    let at = nodeAt(net, v2(100, 0));
    let dir = v2(1, 0);
    const ends = [v2(200, 60), v2(260, 180), v2(220, 300), v2(120, 340)];
    for (const e of ends) {
      const plan = build(net, w, { start: at, end: free(e), mode: "curve", type: "street", startTangent: dir });
      const st = plan.strokes[0];
      // tangent where it starts: the way the last piece was going
      expect(dot(norm(cubicTangent(st.chain[0], 0)), dir)).toBeGreaterThan(0.9999);
      // and inside the stroke too: every piece meets the next without a kink
      for (let i = 1; i < st.chain.length; i++) {
        expect(dot(norm(cubicTangent(st.chain[i - 1], 1)), norm(cubicTangent(st.chain[i], 0)))).toBeGreaterThan(0.9999);
      }
      dir = plan.endTangent!;
      at = nodeAt(net, e);
    }
    // five roads in a line, every joint a plain bend (two arms), none a junction
    expect(net.segs.size).toBe(5);
    for (const n of net.nodes.keys()) expect(net.segsAt(n).length).toBeLessThanOrEqual(2);
  });

  it("says so when the arc would be tighter than the road allows", () => {
    const net = new RoadNetwork();
    // off (0,0) heading +x to (10,30): an arc of radius (10² + 30²) / 60 ≈ 17 m; a highway needs 25 m
    const plan = planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(10, 30)), mode: "curve", type: "hw1", startTangent: v2(1, 0) });
    expect(plan.errors.some((e) => /too tight/i.test(e.msg))).toBe(true);
    // a street (9 m) takes it
    const ok = planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(10, 30)), mode: "curve", type: "street", startTangent: v2(1, 0) });
    expect(ok.errors).toEqual([]);
  });
});

describe("no loops", () => {
  it("draws no road to an end just behind the start (it would need a loop kilometres round)", () => {
    // heading +x, the cursor 100 m back and 2 m off the line
    expect(tangentArc(v2(0, 0), v2(1, 0), v2(-100, 2))).toEqual([]);
    // a real hairpin still curves round
    expect(tangentArc(v2(0, 0), v2(1, 0), v2(-10, 80)).length).toBeGreaterThan(0);
  });
});

describe("snapping", () => {
  it("holds on to the road it caught until the cursor is clearly away (no flicker at the edge)", () => {
    const net = new RoadNetwork();
    build(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "street" });
    const caught = (s: ToolSnap) => s.seg !== undefined || s.node !== undefined;
    // coming in from afar: where it first catches
    let prev: ToolSnap | null = null;
    let catchAt = -1;
    for (let y = 30; y >= 0; y -= 0.25) {
      prev = toolSnap(net, v2(150, y), opts({ prev }));
      if (caught(prev)) { catchAt = y; break; }
    }
    expect(catchAt).toBeGreaterThan(roadWidth(ROAD_TYPES.street) / 2);
    // going back out: it lets go further out than it caught
    let releaseAt = -1;
    for (let y = catchAt; y <= 40; y += 0.25) {
      prev = toolSnap(net, v2(150, y), opts({ prev }));
      if (!caught(prev)) { releaseAt = y; break; }
    }
    expect(releaseAt).toBeGreaterThan(catchAt + 0.5);
    // jitter at the edge of the catch: the same target every frame
    prev = toolSnap(net, v2(150, catchAt - 0.2), opts());
    const key = prev.key;
    for (const j of [0.3, -0.2, 0.45, 0.1, -0.3, 0.4]) {
      prev = toolSnap(net, v2(150 + j * 3, catchAt + j), opts({ prev }));
      expect(prev.key).toBe(key);
    }
    // and the radius scales with the zoom: zoomed out 4x, it catches from 2.5x as far
    const far = toolSnap(net, v2(150, catchAt * 2.5), opts({ mpp: 2 }));
    expect(caught(far)).toBe(true);
  });

  it("lets go of a held junction for one clearly nearer, and of anything held on another level", () => {
    const net = new RoadNetwork();
    build(net, world(), { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "street" });
    build(net, world(), { start: free(v2(30, -60)), end: free(v2(30, 60)), mode: "straight", type: "street" });
    build(net, world(), { start: free(v2(70, -60)), end: free(v2(70, 60)), mode: "straight", type: "street" });
    const at30 = toolSnap(net, v2(31, 1), opts({ mpp: 1.5 }));
    expect(at30.node).toBeDefined();
    const j30 = at30.node;
    // zoomed out, the cursor right on the next junction 40 m on: that one, not the held one
    const at70 = toolSnap(net, v2(70, 0.5), opts({ mpp: 1.5, prev: at30 }));
    expect(at70.node).toBeDefined();
    expect(at70.node).not.toBe(j30);
    // drifting 35 m off it (out of a fresh catch, inside the hold) it is held on the ground; up a level (Page Up), not
    const off = v2(30 - 24.7, 24.7);
    expect(toolSnap(net, off, opts({ mpp: 1.5, prev: at30 })).node).toBe(j30);
    expect(toolSnap(net, off, opts({ mpp: 1.5, prev: at30, level: 1 })).node).not.toBe(j30);
  });

  it("guides a new street onto the parallel a town block away", () => {
    const net = new RoadNetwork();
    build(net, world(), { start: free(v2(0, 0)), end: free(v2(400, 0)), mode: "straight", type: "street" });
    const s = toolSnap(net, v2(200, BLOCK + tol * 0.6), opts());
    expect(s.p.y).toBeCloseTo(BLOCK, 6);
    expect(s.refs.some((r) => r.kind === "par" && r.on)).toBe(true);
    // and the end of the street drawn from there stays on it
    const e = toolSnap(net, v2(320, BLOCK - tol * 0.5), opts({ from: { p: s.p } }));
    expect(e.p.y).toBeCloseTo(BLOCK, 6);
    // Alt: no guides
    expect(toolSnap(net, v2(200, BLOCK + 1), opts({ free: true })).p.y).toBe(BLOCK + 1);
  });

  it("guides a street off a road's middle square to it", () => {
    const net = new RoadNetwork();
    // (on the diagonal, so it's the road's own guide that squares it, not the world's axes)
    build(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 300)), mode: "straight", type: "street" });
    const from = onRoad(net, v2(150, 150));
    const d = norm(v2(1, 1)), n = v2(d.x, -d.y);
    // aimed about 1.5° off square
    const s = toolSnap(net, add(add(from.p, scale(n, 80)), scale(d, 2)), opts({ from: { p: from.p, on: from } }));
    expect(dot(sub(s.p, from.p), d)).toBeCloseTo(0, 3);
    expect(s.refs.some((r) => r.kind === "perp" && r.on)).toBe(true);
    // built, it meets the road square
    const plan = planRoad(net, world(), { start: from, end: free(s.p), mode: "straight", type: "street" });
    expect(plan.angleToRoad).toBe(true);
    expect(plan.angleDeg!).toBeCloseTo(90, 3);
  });

  it("lines a street's end up with a junction across the way", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "street" });
    build(net, w, { start: onRoad(net, v2(150, 0)), end: free(v2(150, -100)), mode: "straight", type: "street" });
    // a street drawn along the road, 110 m out, its end aimed a metre short of the junction's line
    const s = toolSnap(net, v2(149, 111), opts({ from: { p: v2(60, 110) } }));
    expect(s.p.x).toBeCloseTo(150, 3);
    expect(s.refs.some((r) => (r.kind === "align" || r.kind === "perp") && r.on)).toBe(true);
  });

  it("slides an end aimed nearly square at a road to the exact right angle", () => {
    const net = new RoadNetwork();
    build(net, world(), { start: free(v2(0, 0)), end: free(v2(300, 0)), mode: "straight", type: "street" });
    // from (100, 80), aimed ~2° off square
    const s = toolSnap(net, v2(103, 1), opts({ from: { p: v2(100, 80) } }));
    expect(s.seg).toBeDefined();
    expect(s.square).toBe(true);
    expect(s.p.x).toBeCloseTo(100, 3);
    // aimed well off square (15°): it joins where it's aimed
    const t = toolSnap(net, v2(121, 1), opts({ from: { p: v2(100, 80) } }));
    expect(t.square).toBeFalsy();
    expect(t.p.x).toBeGreaterThan(115);
  });
});

describe("errors fixed on the spot", () => {
  it("an end that lands just short of a junction joins the junction", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "street" });
    build(net, w, { start: onRoad(net, v2(100, 0)), end: free(v2(100, -100)), mode: "straight", type: "street" });
    const plan = planRoad(net, w, { start: free(v2(105, 90)), end: onRoad(net, v2(106, 0)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.fixed).toContain("Moved onto the junction");
    const last = plan.strokes[0].chain[plan.strokes[0].chain.length - 1];
    expect(dist(last.p3, v2(100, 0))).toBeLessThan(0.01);
    commit(net, plan);
    // a four-way crossroads, not a staggered junction 6 m from the first
    expect(net.segsAt(nodeAt(net, v2(100, 0)).node!).length).toBe(4);
  });

  it("an end that overshoots a road it crosses ends on that road", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "street" });
    const plan = planRoad(net, w, { start: free(v2(100, -80)), end: free(v2(100, 6)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.fixed).toContain("Ends on the road it crossed");
    const last = plan.strokes[0].chain[plan.strokes[0].chain.length - 1];
    expect(Math.abs(last.p3.y)).toBeLessThan(0.01);
  });
});

describe("automatic bridges", () => {
  const river = world({ isWater: (p) => p.y > 140 && p.y < 200 });

  it("raises a road over water onto a bridge with ramps no steeper than the limit", () => {
    const net = new RoadNetwork();
    const plan = planRoad(net, river, { start: free(v2(0, 0)), end: free(v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.bridges).toHaveLength(1);
    const sp = plan.bridges![0];
    expect(sp.over).toBe("water");
    expect(sp.h).toBe(LEVEL_H);
    // the length shown is the deck's (the water and a little either side), not the ramps'
    expect(sp.length).toBeGreaterThanOrEqual(60);
    expect(sp.length).toBeLessThan(80);
    expect(dist(sp.footA, sp.footB)).toBeGreaterThan(sp.length + 2 * LEVEL_H / 0.11 - 1);
    expect(sp.cost).toBeGreaterThan(0);
    commit(net, plan);
    expect(Math.max(...[...net.nodes.values()].map((n) => n.h))).toBe(LEVEL_H);
    // every piece climbs at most the limit (11%) on average
    for (const s of net.segs.values()) {
      const a = net.nodes.get(s.a)!, b = net.nodes.get(s.b)!;
      const L = net.segGeom.get(s.id)!.center.length;
      expect(Math.abs(a.h - b.h) / L).toBeLessThanOrEqual(0.11 + 1e-6);
    }
  });

  it("bridges a road it can't meet at grade (a motorway), with no junction on it", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(-300, 170)), end: free(v2(300, 170)), mode: "straight", type: "hw2" });
    const plan = planRoad(net, w, { start: free(v2(0, 0)), end: free(v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.bridges?.[0].over).toBe("road");
    commit(net, plan);
    for (const n of net.nodes.keys()) expect(net.segsAt(n).length).toBeLessThanOrEqual(2);
  });

  it("a raised road climbing from a street bridges a road on the way without a false 'Ramp too short'", () => {
    // (the ramps' feet were worked out from the stroke's height at the deck's ends, not at the feet: a rising stroke
    // came out steeper than the limit and was refused on a 288 m road)
    for (const ang of [90, 20, 12]) {
      const net = new RoadNetwork();
      const w = world();
      const a = (ang * Math.PI) / 180;
      build(net, w, { start: free(v2(144 - 150 * Math.cos(a), -150 * Math.sin(a))), end: free(v2(144 + 150 * Math.cos(a), 150 * Math.sin(a))), mode: "straight", type: "street" });
      build(net, w, { start: free(v2(-60, 0)), end: free(v2(0, 0)), mode: "straight", type: "street" });
      const plan = planRoad(net, w, { start: nodeAt(net, v2(0, 0)), end: free(v2(288, 0), LEVEL_H), mode: "straight", type: "street", bridges: true });
      expect(plan.errors.map((e) => e.msg)).toEqual([]);
      // it climbs to the deck and stays there to its raised end: no dip down and up again
      const hj = plan.strokes[0].hj!;
      for (let i = 1; i < hj.length; i++) expect(hj[i]).toBeGreaterThanOrEqual(hj[i - 1] - 1e-6);
      commit(net, plan);
      for (const s of net.segs.values()) {
        const p = net.nodes.get(s.a)!, q = net.nodes.get(s.b)!;
        expect(Math.abs(p.h - q.h) / net.segGeom.get(s.id)!.center.length).toBeLessThanOrEqual(0.11 * 1.02);
      }
    }
  });

  it("a raised road joins something: never free at both ends, never ending in mid-air over water", () => {
    const net = new RoadNetwork();
    const both = planRoad(net, world(), { start: free(v2(0, 0), LEVEL_H), end: free(v2(0, 200), LEVEL_H), mode: "straight", type: "street", bridges: true });
    expect(both.errors.map((e) => e.msg)).toEqual(["Start or end a raised road on a road"]);
    build(net, river, { start: free(v2(-60, 0)), end: free(v2(0, 0)), mode: "straight", type: "street" });
    const wet = planRoad(net, river, { start: nodeAt(net, v2(0, 0)), end: free(v2(0, 170), LEVEL_H), mode: "straight", type: "street", bridges: true });
    expect(wet.errors.map((e) => e.msg)).toEqual(["Can't end on the water"]);
    // from a road out to a raised end on dry land is a start of a flyover, and builds
    const dry = planRoad(net, river, { start: nodeAt(net, v2(0, 0)), end: free(v2(0, 120), LEVEL_H), mode: "straight", type: "street", bridges: true });
    expect(dry.errors).toEqual([]);
  });

  it("says where to start when there's no room for a ramp", () => {
    const net = new RoadNetwork();
    const plan = planRoad(net, river, { start: free(v2(0, 139.5)), end: free(v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors.some((e) => /^Start \d+ m further back to ramp up over the water$/.test(e.msg))).toBe(true);
    // (and only that: not also the old "raise it with Page Up")
    expect(plan.errors.some((e) => e.msg.includes("Page Up"))).toBe(false);
    const tooShort = planRoad(net, river, { start: free(v2(0, 0)), end: free(v2(0, 200.5)), mode: "straight", type: "street", bridges: true });
    expect(tooShort.errors.some((e) => /^Carry on \d+ m to ramp down from the bridge$/.test(e.msg))).toBe(true);
  });

  // road play 2026-11-12, C1: a road along the bank 10 m from the water, and a road drawn across both
  const slope = (net: RoadNetwork) => {
    for (const s of net.segs.values()) {
      const p = net.nodes.get(s.a)!, q = net.nodes.get(s.b)!;
      expect(Math.abs(p.h - q.h) / net.segGeom.get(s.id)!.center.length).toBeLessThanOrEqual(0.11 * 1.02);
    }
  };
  for (const type of ["street", "avenue"] as const) {
    it(`a ${type} crosses a bank road at grade and ramps up off the bank behind it`, () => {
      const net = new RoadNetwork();
      build(net, river, { start: free(v2(-150, 130)), end: free(v2(150, 130)), mode: "straight", type: "street" });
      const plan = planRoad(net, river, { start: free(v2(0, 70)), end: free(v2(0, 340)), mode: "straight", type, bridges: true });
      expect(plan.errors.map((e) => e.msg)).toEqual([]);
      expect(plan.bridges).toHaveLength(1);
      expect(plan.bridges![0].over).toBe("water");
      commit(net, plan);
      // one junction on the bank road, at ground level
      const jn = [...net.nodes.values()].filter((n) => net.segsAt(n.id).length >= 3);
      expect(jn).toHaveLength(1);
      expect(jn[0].h).toBe(0);
      expect(dist(jn[0].p, v2(0, 130))).toBeLessThan(1);
      slope(net);
      // and from the bank road itself
      const n2 = new RoadNetwork();
      build(n2, river, { start: free(v2(-150, 130)), end: free(v2(150, 130)), mode: "straight", type: "street" });
      const from = planRoad(n2, river, { start: onRoad(n2, v2(40, 130)), end: free(v2(40, 340)), mode: "straight", type, bridges: true });
      expect(from.errors.map((e) => e.msg)).toEqual([]);
      commit(n2, from);
      slope(n2);
    });
  }

  it("between two bank roads over a narrow river the deck humps lower; a junction at the water's edge is refused", () => {
    const canal = world({ isWater: (p) => p.y > 140 && p.y < 160 });
    const net = new RoadNetwork();
    build(net, canal, { start: free(v2(-150, 130)), end: free(v2(150, 130)), mode: "straight", type: "street" });
    build(net, canal, { start: free(v2(-150, 170)), end: free(v2(150, 170)), mode: "straight", type: "street" });
    const plan = planRoad(net, canal, { start: free(v2(0, 60)), end: free(v2(0, 240)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    expect(plan.bridges![0].h).toBeLessThan(LEVEL_H);
    expect(plan.bridges![0].h).toBeGreaterThan(1);
    commit(net, plan);
    expect([...net.nodes.values()].filter((n) => net.segsAt(n.id).length >= 3)).toHaveLength(2);
    slope(net);
    const tight = new RoadNetwork();
    build(tight, river, { start: free(v2(-150, 137)), end: free(v2(150, 137)), mode: "straight", type: "street" });
    const no = planRoad(tight, river, { start: free(v2(0, 70)), end: free(v2(0, 340)), mode: "straight", type: "street", bridges: true });
    expect(no.errors.map((e) => e.msg)).toEqual(["No room to ramp up between the road and the water"]);
  });
});

describe("dead ends left past a new junction", () => {
  // a street with a dead end at x = 100; a road crossing it 20 m short of that end
  const setup = (w: BuildWorld) => {
    const net = new RoadNetwork();
    build(net, w, { start: free(v2(-100, 0)), end: free(v2(100, 0)), mode: "straight", type: "street" });
    const plan = planRoad(net, w, { start: free(v2(80, -100)), end: free(v2(80, 100)), mode: "straight", type: "street", bridges: true });
    return { net, plan };
  };
  const deadEndAt = (net: RoadNetwork, p: V2) => [...net.nodes.values()].some((n) => dist(n.p, p) < 0.5);

  it("are removed with the road, and the tool says so", () => {
    const { net, plan } = setup(world());
    expect(plan.errors).toEqual([]);
    expect(plan.fixed).toEqual(["Removes the 20 m dead end past the junction"]);
    commit(net, plan);
    net.begin(); applyStubs(net, plan.stubs!); net.rebuild(); net.commit();
    expect(deadEndAt(net, v2(100, 0))).toBe(false);
    expect(deadEndAt(net, v2(-100, 0))).toBe(true); // (the long side is a street: it stays)
    expect([...net.nodeGeom.values()].filter((g) => g.kind === "junction").map((g) => g.arms.length)).toEqual([3]);
  });

  it("leave alone a short road the player is still laying (a dead end at both ends)", () => {
    const net = new RoadNetwork();
    build(net, world(), { start: free(v2(-25, 0)), end: free(v2(25, 0)), mode: "straight", type: "street" });
    const plan = planRoad(net, world(), { start: free(v2(0, -100)), end: free(v2(0, 100)), mode: "straight", type: "street", bridges: true });
    expect(plan.errors).toEqual([]);
    expect(plan.stubs).toBeUndefined();
  });

  it("stay when something has its way in on them", () => {
    const { plan } = setup(world({ servedOn: () => [190] }));
    expect(plan.errors).toEqual([]);
    expect(plan.stubs).toBeUndefined();
    expect(plan.fixed).toBeUndefined();
  });
});

describe("homes in the way", () => {
  it("are cleared with their owners paid; anything else stops the road", () => {
    const g = new Game(7);
    g.start();
    const homes = [...g.buildings.byId.values()].filter((b) => b.zone);
    expect(homes.length).toBeGreaterThan(0);
    // a street through a home, laid any way that only clears homes
    let done = false;
    for (const b of homes) {
      for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
        const d = v2(Math.cos(a), Math.sin(a));
        const plan = planRoad(g.net, g.world, { start: free(add(b.c, scale(d, -30))), end: free(add(b.c, scale(d, 30))), mode: "straight", type: "street", bridges: true });
        if (plan.errors.length) continue;
        const lots = g.lotsUnder(plan);
        if (!lots.some((l) => l.id === b.id)) continue;
        const before = g.money;
        const owed = g.demolishCost(lots);
        expect(owed).toBeGreaterThan(0);
        expect(g.build(plan)).toBe(true);
        expect(g.buildings.byId.has(b.id)).toBe(false);
        expect(before - g.money).toBeCloseTo(plan.cost + owed, 6);
        done = true;
        break;
      }
      if (done) break;
    }
    expect(done).toBe(true);
    // a road whose cost and compensation can't be paid isn't built (no going into debt)
    {
      const b = [...g.buildings.byId.values()].find((x) => x.zone)!;
      for (const a of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4]) {
        const d = v2(Math.cos(a), Math.sin(a));
        const plan = planRoad(g.net, g.world, { start: free(add(b.c, scale(d, -30))), end: free(add(b.c, scale(d, 30))), mode: "straight", type: "street", bridges: true });
        if (plan.errors.length || !g.lotsUnder(plan).length) continue;
        const keep = g.money;
        g.money = plan.cost + g.demolishCost(g.lotsUnder(plan)) - 1;
        const m = g.money;
        expect(g.build(plan)).toBe(false);
        expect(g.money).toBe(m);
        expect(g.buildings.byId.has(b.id)).toBe(true);
        g.money = keep;
        break;
      }
    }
    // the town hall (not a home) is never cleared: the plan says it's in the way
    const hall = [...g.buildings.byId.values()].find((b) => !b.zone)!;
    expect(hall).toBeDefined();
    const d = v2(1, 0);
    const plan = planRoad(g.net, g.world, { start: free(add(hall.c, scale(d, -40))), end: free(add(hall.c, scale(d, 40))), mode: "straight", type: "street", bridges: true });
    expect(plan.errors.some((e) => /in the way/.test(e.msg))).toBe(true);
  });
});
