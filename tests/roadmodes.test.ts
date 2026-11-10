import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { ROAD_TYPES, roadWidth } from "../src/config";
import {
  ROUNDABOUTS, applyTrim, commitRoundabout, commitStrokes, makeChain, offsetChain, parallelSpacing, planRoad, planRoundabout, snap,
  type BuildWorld, type Plan, type PlanInput, type RoundaboutSize, type Snap,
} from "../src/roads/planner";
import { cubicAt, cubicTangent, dist, dot, norm, tangentArc, v2, type V2 } from "../src/core/math";

const world = (over: Partial<BuildWorld> = {}): BuildWorld => ({
  isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9,
  ...over,
});
const free = (p: V2, h = 0): Snap => ({ p, h, guides: [] });

/** Commit like Game.build: one stroke at a time, so later strokes see earlier ones. */
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

const deadEnds = (net: RoadNetwork) => [...net.nodes.keys()].filter((n) => net.segsAt(n).length === 1).length;

describe("road modes", () => {
  it("offsets an arc into a concentric arc", () => {
    const chain = tangentArc(v2(0, 0), v2(1, 0), v2(100, 60));
    const c = { x: 0, y: 0 };
    // centre of the arc: on the start normal, equidistant from both ends
    const n = v2(0, 1); // right of (1,0) in y-down coordinates
    const R = (100 * 100 + 60 * 60) / (2 * 60);
    c.x = n.x * R; c.y = n.y * R;
    for (const d of [-12, 12]) {
      for (const cb of offsetChain(chain, d)) {
        for (const t of [0, 0.25, 0.5, 0.75, 1]) expect(Math.abs(dist(cubicAt(cb, t), c) - (R - d))).toBeLessThan(0.15);
      }
    }
  });

  it("a curve is an arc leaving along its start direction; squareEnd always meets a road square", () => {
    const ch = makeChain("curve", v2(0, 0), v2(100, 60), v2(1, 0));
    expect(norm(cubicTangent(ch[0], 0))).toEqual(v2(1, 0));
    // a true circular arc: every point the same distance from the centre
    const r = (100 * 100 + 60 * 60) / (2 * 60), c = v2(0, r);
    for (const cb of ch) for (const t of [0, 0.3, 0.6, 1]) expect(Math.abs(dist(cubicAt(cb, t), c) - r)).toBeLessThan(0.05);
    // no start direction: a straight
    expect(makeChain("curve", v2(0, 0), v2(100, 60))).toHaveLength(1);
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 200)), end: free(v2(300, 200)), mode: "straight", type: "street" });
    const end = snap(net, v2(150, 199), { mpp: 0.5, level: 0, type: "street", from: { p: v2(60, 60) } });
    expect(end.seg).toBeDefined();
    const plan = planRoad(net, w, { start: free(v2(60, 60)), end, mode: "curve", squareEnd: true, type: "street", startTangent: v2(1, 0) });
    const last = plan.strokes[0].chain[plan.strokes[0].chain.length - 1];
    const t = norm(cubicTangent(last, 1));
    expect(Math.abs(dot(t, v2(1, 0)))).toBeLessThan(0.02);
  });

  it("parallel one-way builds a dual carriageway running the other way", () => {
    const net = new RoadNetwork();
    const w = world();
    const off = parallelSpacing("one2");
    const plan = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2", parallel: { offset: off } });
    expect(plan.strokes).toHaveLength(2);
    const segs = [...net.segs.values()];
    expect(segs).toHaveLength(2);
    const [m, p] = segs;
    // the twin lies to the left of travel (north here, y-down) and is drawn the other way
    expect(net.nodes.get(p.a)!.p.y).toBeCloseTo(-off, 3);
    expect(net.nodes.get(p.a)!.p.x).toBeCloseTo(200, 3);
    expect(net.nodes.get(p.b)!.p.x).toBeCloseTo(0, 3);
    expect(net.nodes.get(m.a)!.p.x).toBeCloseTo(0, 3);
  });

  it("parallel carries on from the previous piece, and joins a cross street on its own line", () => {
    const net = new RoadNetwork();
    const w = world();
    // a cross street at an angle
    build(net, w, { start: free(v2(-60, 120)), end: free(v2(60, -120)), mode: "straight", type: "street" });
    const s0 = snap(net, v2(0, 0), { mpp: 0.5, level: 0, type: "avenue" });
    expect(s0.seg !== undefined || s0.node !== undefined).toBe(true);
    const off = parallelSpacing("avenue");
    const p1 = build(net, w, { start: s0, end: free(v2(200, 0)), mode: "straight", type: "avenue", parallel: { offset: off } });
    // both carriageways meet the cross street: two T junctions, no stray stubs on that side
    const t = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 3);
    expect(t).toHaveLength(2);
    // carry on, turned 30 degrees: the twin continues from the previous twin's end
    const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "avenue" });
    const from = snap(net, p1.parallelEnds!.b, { mpp: 0.05, level: 0, type: "avenue" });
    expect(from.node).toBeDefined();
    build(net, w, { start: a, end: free(v2(200 + 173, 100)), mode: "straight", type: "avenue", parallel: { offset: off, from } });
    // open ends: the cross street's two, and the far end of each carriageway
    expect(deadEnds(net)).toBe(4);
  });

  it("builds every roundabout size with four arms", () => {
    for (const size of [1, 2, 3, 4] as RoundaboutSize[]) {
      const net = new RoadNetwork();
      const w = world();
      const c = v2(300, 300);
      build(net, w, { start: free(v2(100, 300)), end: free(v2(500, 300)), mode: "straight", type: "avenue" });
      build(net, w, { start: free(v2(300, 100)), end: free(v2(300, 500)), mode: "straight", type: "avenue" });
      const plan = planRoundabout(net, w, c, size, 0);
      expect(plan.errors).toEqual([]);
      net.begin();
      commitRoundabout(net, plan);
      net.rebuild();
      net.commit();
      const j = [...net.nodeGeom.values()].filter((g) => g.kind === "junction" && g.arms.length === 3);
      expect(j.length).toBe(4);
      for (const n of net.nodes.values()) expect(dist(n.p, c)).toBeGreaterThan(ROUNDABOUTS[size].r - 1);
    }
  });

  it("snapping switches: no road snapping, and 8 m length steps", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(100, 0)), mode: "straight", type: "street" });
    const on = snap(net, v2(100.5, 0.5), { mpp: 1, level: 0, type: "street" });
    expect(on.node).toBeDefined();
    const off = snap(net, v2(100.5, 0.5), { mpp: 1, level: 0, type: "street", off: { geometry: true } });
    expect(off.node).toBeUndefined();
    expect(off.seg).toBeUndefined();
    const st = snap(net, v2(37, 300), { mpp: 1, level: 0, type: "street", from: { p: v2(37, 200) }, lengthStep: 8 });
    expect(dist(st.p, v2(37, 200)) % 8).toBeCloseTo(0, 6);
  });
});

describe("parallel pairs (review fixes)", () => {
  const minGap = (net: RoadNetwork, ids: number[], others: number[]) => {
    let m = Infinity;
    for (const i of ids) for (const j of others) {
      const a = net.segGeom.get(i)!.center.pts, b = net.segGeom.get(j)!.center.pts;
      for (const p of a) for (const q of b) m = Math.min(m, dist(p, q));
    }
    return m;
  };

  for (const [turn, endY] of [["left", -200], ["right", 200]] as const) {
    it(`turns a ${turn} corner with an even gap and no merged carriageways`, () => {
      const net = new RoadNetwork();
      const w = world();
      const off = parallelSpacing("one2");
      const p1 = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2", parallel: { offset: off } });
      const mainIds = new Set([...net.segs.keys()].filter((id) => net.nodes.get(net.segs.get(id)!.a)!.p.y === 0));
      const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "one2" });
      const from = snap(net, p1.parallelEnds!.b, { mpp: 0.05, level: 0, type: "one2" });
      const p2 = planRoad(net, w, { start: a, end: free(v2(200, endY)), mode: "straight", type: "one2", startTangent: p1.endTangent, parallel: { offset: off, from } });
      commit(net, p2);
      // no junction joins the two carriageways
      for (const n of net.nodes.keys()) expect(net.segsAt(n).length).toBeLessThanOrEqual(2);
      expect(deadEnds(net)).toBe(4);
      // the twin keeps its distance all the way round the corner
      const segs = [...net.segs.values()];
      const main = segs.filter((s) => mainIds.has(s.id) || net.nodes.get(s.a)!.p.x === 200 && net.nodes.get(s.b)!.p.x === 200).map((s) => s.id);
      const twin = segs.map((s) => s.id).filter((id) => !main.includes(id));
      expect(main).toHaveLength(2);
      // inside of the turn the old twin is cut back; outside it gets a short extension
      expect(twin).toHaveLength(turn === "left" ? 2 : 3);
      expect(minGap(net, main, twin)).toBeGreaterThan(off - 0.6);
    });
  }

  it("keeps the junction angle checks with Parallel on", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "street" });
    const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "street" });
    const plain = planRoad(net, w, { start: a, end: free(v2(50, 13)), mode: "straight", type: "street" });
    expect(plain.errors.some((e) => e.msg.startsWith("Angle too sharp"))).toBe(true);
    const par = planRoad(net, w, { start: a, end: free(v2(50, 13)), mode: "straight", type: "street", parallel: { offset: parallelSpacing("street") } });
    expect(par.errors.some((e) => e.msg.startsWith("Angle too sharp"))).toBe(true);
  });

  it("refuses a spacing that makes the two roads overlap", () => {
    const net = new RoadNetwork();
    const plan = planRoad(net, world(), { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one4", parallel: { offset: 6 } });
    expect(plan.errors.some((e) => e.msg.includes("overlap"))).toBe(true);
    expect(roadWidth(ROAD_TYPES.one4)).toBeGreaterThan(6);
  });

  it("follows a curve in as few pieces as the road itself", () => {
    const net = new RoadNetwork();
    const w = world();
    build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "curve", type: "avenue", startTangent: norm(v2(100, 80)), parallel: { offset: parallelSpacing("avenue") } });
    expect(net.segs.size).toBeLessThanOrEqual(3);
    // the twin really is parallel: every point the spacing away from the road (within a few cm)
    const chain = makeChain("curve", v2(0, 0), v2(200, 0), norm(v2(100, 80)));
    for (const cb of offsetChain(chain, -parallelSpacing("avenue"))) {
      for (const t of [0.1, 0.3, 0.5, 0.7, 0.9]) {
        const p = cubicAt(cb, t);
        let m = Infinity;
        for (let k = 0; k <= 400; k++) m = Math.min(m, dist(p, cubicAt(chain[0], k / 400)));
        expect(Math.abs(m - parallelSpacing("avenue"))).toBeLessThan(0.3);
      }
    }
  });

  /** Build a one-way-2 pair east to (200,0), then carry on round a corner of `deg` degrees (+ = left). */
  const corner = (deg: number, type2: "one2" | "avenue" = "one2") => {
    const net = new RoadNetwork();
    const w = world();
    const off = parallelSpacing("one2");
    const p1 = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2", parallel: { offset: off } });
    const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "one2" });
    const from = snap(net, p1.parallelEnds!.b, { mpp: 0.05, level: 0, type: "one2" });
    const r = (deg * Math.PI) / 180;
    const end = free(v2(200 + Math.cos(r) * 200, -Math.sin(r) * 200));
    const plan = planRoad(net, w, { start: a, end, mode: "straight", type: type2, startTangent: p1.endTangent, parallel: { offset: parallelSpacing(type2), from } });
    return { net, plan, off, p1 };
  };

  it("turns corners up to the sharpest the planner allows, both ways", () => {
    for (const deg of [30, 60, 90, 100, 110, 118, -30, -60, -90, -100, -110, -118]) {
      const { net, plan, off } = corner(deg);
      commit(net, plan);
      for (const n of net.nodes.keys()) expect(net.segsAt(n).length, `${deg}°`).toBeLessThanOrEqual(2);
      expect(deadEnds(net), `${deg}°`).toBe(4);
      // every twin point keeps the spacing from every main point
      const pts = (ids: number[]) => ids.flatMap((id) => net.segGeom.get(id)!.center.pts);
      const isMain = (id: number) => { const s = net.segs.get(id)!; return [s.a, s.b].some((n) => { const p = net.nodes.get(n)!.p; return Math.abs(p.x - 200) < 1e-6 && Math.abs(p.y) < 1e-6 || Math.abs(p.x) < 1e-6 && Math.abs(p.y) < 1e-6; }); };
      const ids = [...net.segs.keys()];
      const mp = pts(ids.filter(isMain)), tp = pts(ids.filter((i) => !isMain(i)));
      let m = Infinity;
      for (const p of tp) for (const q of mp) m = Math.min(m, dist(p, q));
      expect(m, `${deg}°`).toBeGreaterThan(off - 0.6);
    }
  });

  it("keeps the old twin's type and charges only for new road", () => {
    for (const deg of [90, -90]) {
      const { net, plan } = corner(deg, "avenue");
      const fresh = planRoad(new RoadNetwork(), world(), { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "avenue", parallel: { offset: parallelSpacing("avenue") } });
      expect(plan.cost).toBeLessThan(fresh.cost * 1.25);
      commit(net, plan);
      const types = [...net.segs.values()].filter((s) => net.nodes.get(s.a)!.p.x < 150 && net.nodes.get(s.b)!.p.x < 150 || net.nodes.get(s.a)!.p.y === net.nodes.get(s.b)!.p.y && Math.abs(net.nodes.get(s.a)!.p.y) > 1).map((s) => s.type);
      expect(types.length).toBeGreaterThan(0);
      expect(types.every((t) => t === "one2"), `${deg}°: ${types}`).toBe(true);
    }
  });

  it("switched on mid-chain, the twin never joins the road it carries on", () => {
    for (const endY of [-200, 200]) {
      const net = new RoadNetwork();
      const w = world();
      const p1 = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2" });
      const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "one2" });
      const plan = planRoad(net, w, { start: a, end: free(v2(200, endY)), mode: "straight", type: "one2", startTangent: p1.endTangent, parallel: { offset: parallelSpacing("one2") } });
      if (endY < 0) {
        // left turn: the twin (on the left) would start on the old road
        expect(plan.errors.map((e) => e.msg).join()).toContain("would start on this road");
      } else {
        commit(net, plan);
        for (const n of net.nodes.keys()) expect(net.segsAt(n).length).toBeLessThanOrEqual(2);
      }
    }
  });

  it("still sees the main road crossing the part of the old twin that stays", () => {
    const net = new RoadNetwork();
    const w = world();
    const off = parallelSpacing("one2");
    const q1 = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2", parallel: { offset: off } });
    const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "one2" });
    const from = snap(net, q1.parallelEnds!.b, { mpp: 0.05, level: 0, type: "one2" });
    // loops back over the old twin (y = -off) well away from the corner
    const plan = planRoad(net, w, { start: a, end: free(v2(50, 60)), mode: "curve", startTangent: v2(0, -1), type: "one2", parallel: { offset: off, from } });
    expect(plan.crossings.some((c) => Math.abs(c.y + off) < 1 && c.x < 150)).toBe(true);
  });

  it("carrying on a twin the player flipped follows its flow (no one-way trap)", () => {
    for (const deg of [90, -90, 5]) {
      const net = new RoadNetwork();
      const w = world();
      const off = parallelSpacing("one2");
      const p1 = build(net, w, { start: free(v2(0, 0)), end: free(v2(200, 0)), mode: "straight", type: "one2", parallel: { offset: off } });
      const twin = [...net.segs.values()].find((s) => Math.abs(net.nodes.get(s.a)!.p.y + off) < 1e-6)!;
      net.begin(); net.flip(twin.id); net.rebuild(); net.commit();
      const a = snap(net, v2(200, 0), { mpp: 0.05, level: 0, type: "one2" });
      const from = snap(net, p1.parallelEnds!.b, { mpp: 0.05, level: 0, type: "one2" });
      const r = (deg * Math.PI) / 180;
      commit(net, planRoad(net, w, { start: a, end: free(v2(200 + Math.cos(r) * 200, -Math.sin(r) * 200)), mode: "straight", type: "one2", startTangent: p1.endTangent, parallel: { offset: off, from } }));
      // every node with two one-way roads has one in and one out
      for (const n of net.nodes.keys()) {
        const ss = net.segsAt(n);
        if (ss.length !== 2) continue;
        const ins = ss.filter((s) => s.b === n).length;
        expect(ins, `${deg}°`).toBe(1);
      }
    }
  });
});
