import { describe, it, expect } from "vitest";
import { RoadNetwork, type Connector, type RSeg } from "../src/roads/network";
import { Traffic, type Trip } from "../src/sim/traffic";
import { hermiteCubic, minRadius, polyAt, polyClosest, rampCurve, sampleCubic, straightCubic, v2, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";
import { chainPoints, commitStrokes, planRoad, slipLaneEnd, snap, type BuildWorld } from "../src/roads/planner";

const world: BuildWorld = { isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9 };
const on = (net: RoadNetwork, p: V2) => snap(net, p, { mpp: 0.2, level: 0, type: "one1" });

const E = v2(1, 0);

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId, ta?: V2, tb?: V2) {
  const na = net.nodes.get(a)!, nb = net.nodes.get(b)!;
  const c = ta || tb ? hermiteCubic(na.p, ta ?? E, nb.p, tb ?? E, 0.42) : straightCubic(na.p, nb.p);
  return net.addSeg(a, b, type, c);
}

/** Lateral distance of a seg's centre from the line y = 0 at x (world y is "right" of travel along +x). */
function yAt(net: RoadNetwork, seg: number, x: number): number {
  const pts = net.segGeom.get(seg)!.center.pts;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    if ((a.x - x) * (b.x - x) <= 0 && a.x !== b.x) return a.y + ((b.y - a.y) * (x - a.x)) / (b.x - a.x);
  }
  return NaN;
}

/** A motorway carriageway along +x with an off-ramp at x=400 and an on-ramp at x=800, both on the right. */
function motorway() {
  const net = new RoadNetwork();
  net.begin();
  const A = net.addNode(v2(0, 0), 0), D = net.addNode(v2(400, 0), 0), M = net.addNode(v2(800, 0), 0), B = net.addNode(v2(1200, 0), 0);
  const offEnd = net.addNode(v2(640, 110), 0), onStart = net.addNode(v2(560, 110), 0);
  const s1 = road(net, A, D, "hw2"), s2 = road(net, D, M, "hw2"), s3 = road(net, M, B, "hw2");
  const off = road(net, D, offEnd, "one1", E, v2(0.6, 0.8));
  const on = road(net, onStart, M, "one1", v2(0.6, -0.8), E);
  net.commit();
  net.rebuild();
  return { net, A, D, M, B, s1, s2, s3, off, on };
}

describe("Slip roads", () => {
  it("makes a glued diverge and merge instead of a junction box", () => {
    const { net, D, M, s2, off, on } = motorway();
    expect(net.nodeGeom.get(D)!.kind).toBe("split");
    expect(net.nodeGeom.get(M)!.kind).toBe("split");
    // no junction surface, nothing trimmed back: the carriageway just runs on
    expect(net.nodeGeom.get(D)!.poly).toBeNull();
    for (const id of [s2, off, on]) { expect(net.segGeom.get(id)!.trimA).toBe(0); expect(net.segGeom.get(id)!.trimB).toBe(0); }
    // the ramp runs right beside the carriageway at first (edges touching), then peels off
    const glued = 4.2 + 2.45 - 0.42;
    expect(yAt(net, off, 405)).toBeCloseTo(glued, 1);
    expect(yAt(net, off, 430)).toBeCloseTo(glued, 1);
    expect(yAt(net, off, 560)).toBeGreaterThan(glued + 15);
    expect(yAt(net, on, 790)).toBeCloseTo(glued, 1);
    // the main line is not moved
    expect(yAt(net, s2, 410)).toBeCloseTo(0, 3);
  });

  it("feeds the ramp from the kerb lane through a taper, and keeps the through lanes 1:1", () => {
    const { net, D, M, s1, s2, s3, off, on } = motorway();
    const cs = net.nodeGeom.get(D)!.conns;
    const toRamp = cs.filter((c) => c.to.seg === off);
    expect(toRamp.length).toBe(1);
    expect(toRamp[0].from.idx).toBe(0);
    expect(toRamp[0].turn).toBe("R");
    // the taper: ramp lane starts well past the node, the connector curves across smoothly
    expect(toRamp[0].pl.length).toBeGreaterThan(25);
    expect(maxBend(toRamp[0])).toBeLessThan(0.08);
    const through = cs.filter((c) => c.to.seg === s2).map((c) => `${c.from.idx}>${c.to.idx}`).sort();
    expect(through).toEqual(["0>0", "1>1"]);
    expect(cs.every((c) => c.from.seg === s1)).toBe(true);
    // merge: the ramp joins the kerb lane, yielding to it
    const ms = net.nodeGeom.get(M)!.conns;
    const fromRamp = ms.find((c) => c.from.seg === on)!;
    expect(fromRamp.to.seg).toBe(s3);
    expect(fromRamp.to.idx).toBe(0);
    expect(fromRamp.conflicts.some((k) => k.merge)).toBe(true);
    expect(maxBend(fromRamp)).toBeLessThan(0.08);
  });

  it("drives cars off and onto the motorway without stalls", () => {
    const { net, s1, s3, off, on } = motorway();
    const acc = (seg: number, frac: number): { a: Access; side: 1 | -1 } => {
      const g = net.segGeom.get(seg)!;
      const s = g.center.length * frac;
      return { a: { seg, s, p: polyAt(g.center, s) }, side: 1 };
    };
    let arrived = 0, failed = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { failed++; } });
    const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
    const reqs: [ReturnType<typeof acc>, ReturnType<typeof acc>][] = [];
    for (let i = 0; i < 24; i++) reqs.push(i % 3 === 0 ? [acc(s1, 0.1), acc(off, 0.97)] : i % 3 === 1 ? [acc(on, 0.03), acc(s3, 0.9)] : [acc(s1, 0.1), acc(s3, 0.9)]);
    let i = 0;
    for (let t = 0; t < 240; t += 1 / 30) {
      if (i < reqs.length && t > i * 1.6) {
        const [f, to] = reqs[i++];
        tr.request({ from: f.a, fromSide: f.side, to: to.a, toSide: to.side, trip: trip(), truck: i % 5 === 0, tries: 0, wait: 0 });
      }
      tr.step(1 / 30);
    }
    expect(failed).toBe(0);
    expect(arrived).toBe(24);
  });

  it("adds an auxiliary lane with tapers when a stretch is widened", () => {
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), P = net.addNode(v2(300, 0), 0), Q = net.addNode(v2(600, 0), 0), B = net.addNode(v2(900, 0), 0);
    road(net, A, P, "hw2");
    const mid = road(net, P, Q, "one3");
    const last = road(net, Q, B, "hw2");
    net.commit();
    net.rebuild();
    expect(net.nodeGeom.get(P)!.kind).toBe("lane");
    expect(net.nodeGeom.get(Q)!.kind).toBe("lane");
    // the wider stretch moves right so the two through lanes stay on their line, and the new lane opens on the right
    expect(yAt(net, mid, 450)).toBeCloseTo(1.75, 2);
    const lanes = net.segGeom.get(mid)!.lanes.sort((x, y) => x.idx - y.idx);
    const startX = (l: { pl: { pts: V2[] } }) => l.pl.pts[0].x;
    expect(startX(lanes[0])).toBeGreaterThan(320);
    expect(startX(lanes[1])).toBeLessThan(301);
    expect(Math.abs(lanes[1].pl.pts[0].y - 1.75)).toBeLessThan(0.05);
    // the lane drop at the far end merges into the kerb lane
    const drop = net.nodeGeom.get(Q)!.conns.filter((c) => c.to.seg === last && c.to.idx === 0);
    expect(drop.length).toBe(2);
    const g = net.segGeom.get(mid)!;
    expect(g.ends.a.clip).toBeCloseTo(3.5, 2);
    expect(polyClosest(g.center, v2(450, 1.75)).d).toBeLessThan(0.01);
  });
});

describe("Drawing slip roads and lanes", () => {
  function carriageway() {
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), B = net.addNode(v2(1000, 0), 0);
    road(net, A, B, "hw2");
    net.commit();
    net.rebuild();
    return net;
  }

  it("draws a one-way off a carriageway as a glued exit, even in straight mode", () => {
    const net = carriageway();
    const plan = planRoad(net, world, { start: on(net, v2(300, 1)), end: { p: v2(520, 90), h: 0, guides: [] }, mode: "straight", type: "one1" });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    const c = plan.strokes[0].chain[0];
    // leaves exactly along the carriageway
    expect(Math.abs((c.p1.y - c.p0.y) / (c.p1.x - c.p0.x))).toBeLessThan(1e-6);
    net.begin();
    commitStrokes(net, plan.strokes);
    net.commit();
    net.rebuild();
    expect([...net.nodeGeom.values()].filter((g) => g.kind === "split").length).toBe(1);
  });
});

/** Largest heading change between consecutive pieces of a connector (radians). */
function maxBend(c: Connector): number {
  const p = c.pl.pts;
  let m = 0;
  for (let i = 1; i < p.length - 1; i++) {
    const a = Math.atan2(p[i].y - p[i - 1].y, p[i].x - p[i - 1].x), b = Math.atan2(p[i + 1].y - p[i].y, p[i + 1].x - p[i].x);
    m = Math.max(m, Math.abs(Math.atan2(Math.sin(b - a), Math.cos(b - a))));
  }
  return m;
}

describe("Slip road side", () => {
  it("puts an off-ramp on the side it actually leaves from, even when the main line sweeps further out that way", () => {
    // the main line bends hard right after the exit; the ramp peels off right too, but gently and briefly,
    // so halfway along its length it is far less to the right than the main line is halfway along its own
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), D = net.addNode(v2(300, 0), 0), F = net.addNode(v2(700, 500), 0), R = net.addNode(v2(420, 40), 0);
    road(net, A, D, "hw2");
    const main = road(net, D, F, "hw2", E, v2(0, 1));
    const ramp = road(net, D, R, "one1", E, E);
    net.commit();
    net.rebuild();
    const ng = net.nodeGeom.get(D)!;
    const roles = net.splitRoles(ng.arms, [...net.segs.values()]);
    expect(roles?.ramp?.seg).toBe(ramp);
    expect(roles?.main.seg).toBe(main);
    expect(roles?.side).toBe(1); // +y is the right of travel along +x
  });
});

describe("Drawn ramps are smooth where they leave and join", () => {
  /** Tightest bend (m) along the built centrelines of every hw1 piece, sampled every 4 m. */
  function tightest(net: RoadNetwork): number {
    let r = Infinity;
    for (const s of net.segs.values()) if (s.type === "hw1") r = Math.min(r, minRadius(net.segGeom.get(s.id)!.center.pts, 4));
    return r;
  }
  function carriageway() {
    const net = new RoadNetwork();
    net.begin();
    road(net, net.addNode(v2(0, 0), 0), net.addNode(v2(2000, 0), 0), "hw2");
    net.commit();
    net.rebuild();
    return net;
  }
  const free = (p: V2) => ({ p, h: 0, guides: [] });
  // tightest bend allowed as built, by drawn angle (before: a ~20 m hook at 30 degrees; 60 and 70 weren't ramps at all)
  const need: Record<number, number> = { 30: 50, 60: 40, 70: 28 };
  for (const deg of [30, 60, 70]) {
    const a = (deg * Math.PI) / 180, off = v2(110 * Math.cos(a), 110 * Math.sin(a));
    it(`an exit drawn ${deg} degrees off peels away without a hook`, () => {
      const net = carriageway();
      const plan = planRoad(net, world, { start: on(net, v2(500, 0)), end: free(v2(500 + off.x, off.y)), mode: "straight", type: "hw1" });
      expect(plan.errors.map((e) => e.msg)).toEqual([]);
      net.begin(); commitStrokes(net, plan.strokes); net.commit(); net.rebuild();
      expect([...net.nodeGeom.values()].filter((g) => g.kind === "split").length).toBe(1);
      expect(tightest(net)).toBeGreaterThan(need[deg]);
    });
    it(`an entry drawn ${deg} degrees in merges without a hook`, () => {
      const net = carriageway();
      const plan = planRoad(net, world, { start: free(v2(1000 - off.x, off.y)), end: on(net, v2(1000, 0)), mode: "straight", type: "hw1" });
      expect(plan.errors.map((e) => e.msg)).toEqual([]);
      net.begin(); commitStrokes(net, plan.strokes); net.commit(); net.rebuild();
      expect([...net.nodeGeom.values()].filter((g) => g.kind === "split").length).toBe(1);
      expect(tightest(net)).toBeGreaterThan(need[deg]);
    });
  }
  it("never swings a ramp round further than it was drawn", () => {
    for (const deg of [30, 60, 70]) {
      const net = carriageway();
      const a = (deg * Math.PI) / 180;
      const plan = planRoad(net, world, { start: on(net, v2(500, 0)), end: free(v2(500 + 110 * Math.cos(a), 110 * Math.sin(a))), mode: "straight", type: "hw1" });
      const ch = plan.strokes[0].chain, c = ch[ch.length - 1];
      const end = Math.atan2(c.p3.y - c.p2.y, c.p3.x - c.p2.x) * (180 / Math.PI);
      expect(Math.abs(end - deg)).toBeLessThan(56);
    }
  });
  it("a highway road drawn square off a highway is a junction, not a loop", () => {
    const net = carriageway();
    const plan = planRoad(net, world, { start: on(net, v2(500, 0)), end: free(v2(500, 110)), mode: "straight", type: "hw1" });
    const c = plan.strokes[0].chain;
    expect(c.length).toBe(1);
    expect(Math.abs(c[0].p3.x - 500)).toBeLessThan(0.01);
    expect(Math.abs(c[0].p1.x - 500)).toBeLessThan(0.01); // straight out, not along the carriageway
  });
  it("a town one-way drawn square into a highway is a T-junction", () => {
    const net = carriageway();
    const plan = planRoad(net, world, { start: free(v2(800, 60)), end: on(net, v2(800, 0)), mode: "straight", type: "one1" });
    const c = plan.strokes[0].chain;
    expect(c.length).toBe(1);
    expect(Math.abs(c[0].p1.x - 800) + Math.abs(c[0].p2.x - 800)).toBeLessThan(0.01);
  });
  it("keeps a curve's own handle when it leaves a highway steeply", () => {
    const net = carriageway();
    const plan = planRoad(net, world, { start: on(net, v2(500, 0)), end: free(v2(560, 120)), ctrl: v2(505, 60), mode: "curve", type: "hw1" });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    expect(minRadius(sampleCubic(plan.strokes[0].chain[0], 1.5), 4)).toBeGreaterThan(100);
  });
  it("leaves the carriageway dead in line and with no bend at first", () => {
    const c = rampCurve(v2(0, 0), E, v2(95, 55), 50)[0];
    expect(c).toBeDefined();
    expect(c.p1.y).toBeCloseTo(0, 6);
    expect(c.p2.y).toBeCloseTo(0, 6); // p0, p1, p2 in line: zero curvature at the start
    expect(minRadius(sampleCubic(c, 1.5), 4)).toBeGreaterThanOrEqual(50);
  });
});

describe("Slip lanes (parallel-type ramps)", () => {
  const free = (p: V2) => ({ p, h: 0, guides: [] });
  function carriageway(len = 2000) {
    const net = new RoadNetwork();
    net.begin();
    road(net, net.addNode(v2(0, 0), 0), net.addNode(v2(len, 0), 0), "hw2");
    net.commit();
    net.rebuild();
    return net;
  }
  /** What the game does with a plan: a slip lane being redrawn goes first, then the roads. */
  function build(net: RoadNetwork, plan: ReturnType<typeof planRoad>) {
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    net.begin();
    for (const id of plan.removeSegs ?? []) net.removeSeg(id, true);
    for (const st of plan.strokes) commitStrokes(net, [st]);
    net.commit();
    return net.rebuild();
  }
  const exit = (net: RoadNetwork, x: number, side = 1) => planRoad(net, world, { start: on(net, v2(x, 0)), end: free(v2(x + 220, 110 * side)), mode: "straight", type: "hw1" });
  const entry = (net: RoadNetwork, x: number) => planRoad(net, world, { start: free(v2(x - 220, 110)), end: on(net, v2(x, 0)), mode: "straight", type: "hw1" });
  /** The carriageway: every piece still a two-lane carriageway exactly on y = 0. */
  function untouched(net: RoadNetwork) {
    const cw = [...net.segs.values()].filter((s) => s.type !== "hw1");
    for (const s of cw) {
      expect(s.type).toBe("hw2");
      for (const p of net.segGeom.get(s.id)!.center.pts) expect(Math.abs(p.y)).toBeLessThan(1e-6);
    }
    expect(Math.min(...cw.map((s) => s.c.p0.x))).toBe(0);
    return cw;
  }
  const lanes = (net: RoadNetwork) => [...net.segs.values()].filter((s) => slipLaneEnd(net, s.id));
  const glued = 4.2 + 2.45 - 0.42;
  /** Lateral distance of a road from y = 0 along x0..x1: every built point within tol of `want`. */
  function beside(net: RoadNetwork, seg: number, x0: number, x1: number, want = glued, tol = 0.05) {
    const pts = net.segGeom.get(seg)!.center.pts.filter((p) => p.x >= x0 && p.x <= x1);
    expect(pts.length).toBeGreaterThan(10);
    for (const p of pts) expect(Math.abs(p.y - want)).toBeLessThan(tol);
  }

  it("gives an exit a deceleration lane beside the carriageway, which stays as it was", () => {
    const net = carriageway();
    const plan = exit(net, 800);
    expect(plan.note).toBe("160 m slip lane");
    // the preview shows the lane where it will be, beside the carriageway, not over it
    for (const p of chainPoints(plan.strokes[0].show!, 4)) if (p.x < 800) expect(p.y).toBeGreaterThan(glued - 0.3);
    build(net, plan);
    untouched(net);
    const [lane] = lanes(net);
    expect(slipLaneEnd(net, lane.id)).toBe("a");
    expect(net.nodes.get(lane.a)!.p.x).toBeCloseTo(640, 0);
    // glued beside the carriageway all the way to the gore, where the ramp carries straight on
    beside(net, lane.id, 641, 799);
    const ramp = [...net.segs.values()].find((s) => s.type === "hw1" && s.a === lane.b)!;
    expect(yAt(net, ramp.id, 801)).toBeCloseTo(glued, 0);
    expect(yAt(net, ramp.id, 950)).toBeGreaterThan(30);
    // the lane opens off the kerb lane through a taper; the through lanes run on 1:1
    const ng = net.nodeGeom.get(lane.a)!;
    expect(ng.kind).toBe("split");
    const toLane = ng.conns.filter((c) => c.to.seg === lane.id);
    expect(toLane.map((c) => c.from.idx)).toEqual([0]);
    expect(maxBend(toLane[0])).toBeLessThan(0.08);
    expect(ng.conns.filter((c) => c.to.seg !== lane.id).map((c) => `${c.from.idx}>${c.to.idx}`).sort()).toEqual(["0>0", "1>1"]);
    // the gore is just the ramp carrying on
    expect(net.nodeGeom.get(lane.b)!.kind).toMatch(/cont|bend/);
  });

  it("gives an entry a longer acceleration lane, merging into the kerb lane at its end", () => {
    const net = carriageway();
    const plan = entry(net, 800);
    expect(plan.note).toBe("200 m slip lane");
    build(net, plan);
    untouched(net);
    const [lane] = lanes(net);
    expect(slipLaneEnd(net, lane.id)).toBe("b");
    expect(net.nodes.get(lane.b)!.p.x).toBeCloseTo(1000, 0);
    beside(net, lane.id, 801, 999);
    const ng = net.nodeGeom.get(lane.b)!;
    const merge = ng.conns.find((c) => c.from.seg === lane.id)!;
    expect(merge.to.idx).toBe(0);
    expect(merge.conflicts.some((k) => k.merge)).toBe(true);
  });

  it("puts a ramp's lane on the side it leaves from", () => {
    const net = carriageway();
    build(net, exit(net, 800, -1));
    untouched(net);
    const [lane] = lanes(net);
    beside(net, lane.id, 641, 799, -glued);
  });

  it("joins an entry's lane to the next exit's when they come close: one lane between them, a weave", () => {
    const check = (net: RoadNetwork) => {
      untouched(net);
      const ls = lanes(net);
      expect(ls.length).toBe(2);
      const inn = ls.find((s) => slipLaneEnd(net, s.id) === "b")!, out = ls.find((s) => slipLaneEnd(net, s.id) === "a")!;
      expect(inn.b).toBe(out.a);
      const ng = net.nodeGeom.get(inn.b)!;
      expect(ng.kind).toBe("split");
      expect(ng.arms.length).toBe(4);
      // one lane all the way from the entry's gore to the exit's
      beside(net, inn.id, 601, net.nodes.get(inn.b)!.p.x - 1);
      beside(net, out.id, net.nodes.get(inn.b)!.p.x + 1, 1099);
      // through the weave: the slip lane carries on into the exit, or merges into the kerb lane, giving way to the
      // carriageway's traffic, which never stops (staying on, or moving over into the exit's lane)
      const through = ng.conns.find((c) => c.from.seg === inn.id && c.to.seg === out.id)!;
      const merge = ng.conns.find((c) => c.from.seg === inn.id && c.to.seg !== out.id)!;
      expect(through.free).toBe(false);
      expect(merge.free).toBe(false);
      expect(merge.to.idx).toBe(0);
      expect(maxBend(through)).toBeLessThan(0.01);
      for (const c of ng.conns.filter((c) => c.from.seg !== inn.id)) expect(c.free).toBe(true);
    };
    const net = carriageway();
    build(net, entry(net, 600));
    const plan = exit(net, 1100);
    expect(plan.note).toBe("Slip lanes joined");
    build(net, plan);
    check(net);
    // and the other way round: the exit first, then the entry before it
    const net2 = carriageway();
    build(net2, exit(net2, 1100));
    const p2 = entry(net2, 600);
    expect(p2.note).toBe("Slip lanes joined");
    build(net2, p2);
    check(net2);
  });

  it("keeps lanes apart when the next ramp is far away", () => {
    const net = carriageway(3000);
    build(net, entry(net, 600));
    build(net, exit(net, 1600));
    untouched(net);
    const kinds = [...net.nodeGeom.values()].filter((g) => g.kind === "split").map((g) => g.arms.length);
    expect(kinds).toEqual([3, 3]);
  });

  it("makes a slip lane longer when drawn on along the carriageway from its start, either way", () => {
    const net = carriageway();
    build(net, exit(net, 800));
    const [old] = lanes(net);
    // from the lane's start back up the carriageway, against the traffic
    const plan = planRoad(net, world, { start: on(net, v2(640, 0)), end: on(net, v2(400, 0)), mode: "straight", type: "hw1" });
    expect(plan.note).toBe("400 m slip lane");
    expect(plan.removeSegs).toEqual([old.id]);
    expect(plan.continueAt?.p.x).toBeCloseTo(400, 0);
    build(net, plan);
    untouched(net);
    const [lane] = lanes(net);
    expect(net.nodes.get(lane.a)!.p.x).toBeCloseTo(400, 0);
    beside(net, lane.id, 401, 799);
    // drawn towards it from further up, starting just short of it on the carriageway
    const p2 = planRoad(net, world, { start: on(net, v2(200, 0)), end: on(net, v2(385, 0)), mode: "straight", type: "hw1" });
    expect(p2.note).toBe("600 m slip lane");
    build(net, p2);
    expect(net.nodes.get(lanes(net)[0].a)!.p.x).toBeCloseTo(200, 0);
    // an entry's lane drawn on with the traffic
    const net2 = carriageway();
    build(net2, entry(net2, 600));
    const p3 = planRoad(net2, world, { start: on(net2, v2(800, 0)), end: on(net2, v2(1200, 0)), mode: "straight", type: "hw1" });
    expect(p3.note).toBe("600 m slip lane");
    build(net2, p3);
    expect(net2.nodes.get(lanes(net2)[0].b)!.p.x).toBeCloseTo(1200, 0);
  });

  it("joins a slip lane drawn on to the next ramp's lane", () => {
    const net = carriageway(3000);
    build(net, entry(net, 600));
    build(net, exit(net, 1600));
    const exitStart = net.nodes.get(lanes(net).find((s) => slipLaneEnd(net, s.id) === "a")!.a)!.p.x;
    const plan = planRoad(net, world, { start: on(net, v2(exitStart, 0)), end: on(net, v2(790, 0)), mode: "straight", type: "hw1" });
    expect(plan.note).toBe("Slip lanes joined");
    build(net, plan);
    untouched(net);
    expect([...net.nodeGeom.values()].filter((g) => g.kind === "split").map((g) => g.arms.length)).toEqual([4]);
  });

  it("follows the carriageway's height onto a bridge", () => {
    // the carriageway climbs from the ground to 8 m between x = 500 and 900, over a street crossing at x = 1000
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), m = net.addNode(v2(500, 0), 0), b = net.addNode(v2(900, 0), 8), c = net.addNode(v2(1600, 0), 8);
    road(net, a, m, "hw2");
    road(net, m, b, "hw2");
    road(net, b, c, "hw2");
    road(net, net.addNode(v2(1000, -300), 0), net.addNode(v2(1000, 300), 0), "street");
    net.commit();
    net.rebuild();
    // an exit off the bridge, its lane drawn back down the slope
    const ex = planRoad(net, world, { start: { ...on(net, v2(1300, 0)), h: 8 }, end: { p: v2(1520, 110), h: 8, guides: [] }, mode: "straight", type: "hw1" });
    build(net, ex);
    const start = net.nodes.get(lanes(net)[0].a)!;
    const plan = planRoad(net, world, { start: { p: start.p, h: start.h, node: start.id, guides: [] }, end: snap(net, v2(700, 0.5), { mpp: 0.2, level: 0, type: "hw1", from: { p: start.p, on: { p: start.p, h: start.h, node: start.id, guides: [] } } }), mode: "straight", type: "hw1" });
    build(net, plan);
    const [lane] = lanes(net);
    const g = net.segGeom.get(lane.id)!;
    const cw = [...net.segs.values()].filter((s) => s.type === "hw2");
    for (let i = 0; i < g.center.pts.length; i += 5) {
      const p = g.center.pts[i];
      const s = cw.find((x) => p.x >= x.c.p0.x && p.x <= x.c.p3.x)!;
      const t = polyClosest(net.segGeom.get(s.id)!.center, p);
      expect(Math.abs(g.hs[i] - net.segGeom.get(s.id)!.hs[Math.round(t.s / net.segGeom.get(s.id)!.center.length * (net.segGeom.get(s.id)!.hs.length - 1))])).toBeLessThan(0.3);
    }
    // it passes over the street, as the carriageway does: no junction made with it
    expect([...net.nodeGeom.values()].filter((x) => x.kind === "junction").length).toBe(0);
  });

  it("leaves a carriageway as it is when a road is drawn along it, and town slip roads without a lane", () => {
    const net = carriageway();
    const along = planRoad(net, world, { start: on(net, v2(300, 0)), end: on(net, v2(600, 0)), mode: "straight", type: "hw1" });
    expect(along.errors.length).toBeGreaterThan(0);
    const town = new RoadNetwork();
    town.begin();
    road(town, town.addNode(v2(0, 0), 0), town.addNode(v2(1000, 0), 0), "one2");
    town.commit();
    town.rebuild();
    const t = planRoad(town, world, { start: on(town, v2(500, 0)), end: free(v2(600, 30)), mode: "straight", type: "one1" });
    expect(t.note).toBeUndefined();
    expect(t.strokes[0].show).toBeUndefined();
  });

  it("checks a slip lane where it is built, and only treats one stretch of carriageway as 'along' it", () => {
    // a gap in a carriageway, filled from one dead end to the other, is a road (not "along the carriageway")
    const gap = new RoadNetwork();
    gap.begin();
    road(gap, gap.addNode(v2(0, 0), 0), gap.addNode(v2(800, 0), 0), "hw2");
    road(gap, gap.addNode(v2(1000, 0), 0), gap.addNode(v2(2000, 0), 0), "hw2");
    gap.commit();
    gap.rebuild();
    const fill = planRoad(gap, world, { start: on(gap, v2(800, 0)), end: on(gap, v2(1000, 0)), mode: "straight", type: "hw2" });
    expect(fill.errors.map((e) => e.msg)).toEqual([]);
    // the other carriageway at the usual spacing: no room for a lane on the median side
    const pair = carriageway();
    pair.begin();
    road(pair, pair.addNode(v2(2000, -12.4), 0), pair.addNode(v2(0, -12.4), 0), "hw2");
    pair.commit();
    pair.rebuild();
    const left = planRoad(pair, world, { start: on(pair, v2(800, 0)), end: free(v2(1020, -110)), mode: "straight", type: "hw1" });
    expect(left.errors.some((e) => e.msg.startsWith("Overlaps"))).toBe(true);
    // a street running just outside the carriageway: the lane would be built on top of it
    const st = carriageway();
    st.begin();
    road(st, st.addNode(v2(300, 9), 0), st.addNode(v2(700, 9), 0), "street");
    st.commit();
    st.rebuild();
    const over = exit(st, 800);
    expect(over.errors.some((e) => e.msg.startsWith("Overlaps"))).toBe(true);
    // nor does a road join a slip lane part-way along it
    const j = carriageway();
    build(j, exit(j, 800));
    const mid = planRoad(j, world, { start: free(v2(720, 80)), end: snap(j, v2(720, glued), { mpp: 0.2, level: 0, type: "street" }), mode: "straight", type: "street" });
    expect(mid.errors.some((e) => e.msg.startsWith("Can't join a slip lane"))).toBe(true);
  });

  it("drives cars through slip lanes and a weave smoothly: no jumps, no failed trips", () => {
    const net = carriageway(2400);
    build(net, entry(net, 600));
    build(net, exit(net, 1100));
    build(net, exit(net, 1900));
    const segs = [...net.segs.values()];
    const near = (p: V2) => segs.reduce((m, s) => (dist2(net.segGeom.get(s.id)!.center.pts[0], p) < dist2(net.segGeom.get(m.id)!.center.pts[0], p) ? s : m));
    const first = near(v2(0, 0)), onR = near(v2(380, 110)), off1 = near(v2(1100 + 30, 20)), off2 = near(v2(1900 + 30, 20));
    const last = segs.find((s) => Math.round(s.c.p3.x) === 2400)!;
    const end = (s: RSeg) => (s.type === "hw1" ? segs.find((x) => x.a === s.b) ?? s : s);
    const acc = (seg: number, frac: number): Access => { const g = net.segGeom.get(seg)!; const s = g.center.length * frac; return { seg, s, p: polyAt(g.center, s) }; };
    let arrived = 0, failed = 0, jumps = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { failed++; } });
    const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
    const routes: [Access, Access][] = [
      [acc(first.id, 0.05), acc(end(off1).id, 0.9)], [acc(onR.id, 0.05), acc(last.id, 0.9)],
      [acc(onR.id, 0.05), acc(end(off1).id, 0.9)], [acc(first.id, 0.05), acc(end(off2).id, 0.9)], [acc(first.id, 0.05), acc(last.id, 0.9)],
    ];
    let n = 0;
    for (let t = 0; t < 300; t += 1 / 30) {
      if (n < 50 && t > n * 2) { const [f, to] = routes[n % routes.length]; tr.request({ from: f, fromSide: 1, to, toSide: 1, trip: trip(), truck: n % 5 === 0, tries: 0, wait: 0 }); n++; }
      tr.step(1 / 30);
      for (const v of tr.vehicles) {
        if (v.fade < 1 || v.leaving > 0) continue;
        if (Math.hypot(v.x - v.px, v.y - v.py) > v.v / 30 * 1.6 + 0.12) jumps++;
      }
    }
    expect(failed).toBe(0);
    expect(arrived).toBe(50);
    expect(jumps).toBe(0);
  });

  it("lets cars already on the carriageway drive on while a ramp is built under them", () => {
    const net = carriageway(2400);
    const cw = [...net.segs.values()][0];
    const acc = (seg: number, frac: number): Access => { const g = net.segGeom.get(seg)!; const s = g.center.length * frac; return { seg, s, p: polyAt(g.center, s) }; };
    let arrived = 0, failed = 0, jumps = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { failed++; } });
    const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
    for (let i = 0; i < 12; i++) tr.request({ from: acc(cw.id, 0.02), fromSide: 1, to: acc(cw.id, 0.98), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0 });
    let built = false;
    for (let t = 0; t < 200; t += 1 / 30) {
      if (!built && t > 25) {
        built = true;
        const cs = build(net, exit(net, 1200));
        tr.onNetworkChange(cs);
        const cs2 = build(net, entry(net, 1500));
        tr.onNetworkChange(cs2);
      }
      tr.step(1 / 30);
      for (const v of tr.vehicles) {
        if (v.fade < 1 || v.leaving > 0) continue;
        if (Math.hypot(v.x - v.px, v.y - v.py) > v.v / 30 * 1.6 + 0.12) jumps++;
      }
    }
    expect(failed).toBe(0);
    expect(arrived).toBe(12);
    expect(jumps).toBe(0);
  });
});

const dist2 = (a: V2, b: V2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
