import { describe, it, expect } from "vitest";
import { RoadNetwork, type Connector } from "../src/roads/network";
import { Traffic, type Trip } from "../src/sim/traffic";
import { hermiteCubic, minRadius, polyAt, polyClosest, rampCurve, sampleCubic, straightCubic, v2, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";
import { commitStrokes, commitWiden, planRoad, snap, type BuildWorld } from "../src/roads/planner";

const world: BuildWorld = { isWater: () => false, isMountain: () => false, inBounds: () => true, unlocked: () => true, buildingsHit: () => [], money: () => 1e9 };
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

  it("adds a lane when a one-way is drawn along the carriageway", () => {
    const net = carriageway();
    const plan = planRoad(net, world, { start: on(net, v2(300, 3)), end: on(net, v2(600, 3)), mode: "straight", type: "one1" });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    expect(plan.note).toBe("Add lane");
    net.begin();
    commitWiden(net, plan.widen!);
    net.commit();
    net.rebuild();
    const types = [...net.segs.values()].sort((x, y) => x.c.p0.x - y.c.p0.x).map((s) => s.type);
    expect(types).toEqual(["hw2", "one3", "hw2"]);
    expect([...net.nodeGeom.values()].filter((g) => g.kind === "lane").length).toBe(2);
    // drawn against the traffic: not a lane, an ordinary (overlapping) road
    const back = planRoad(net, world, { start: on(net, v2(900, 3)), end: on(net, v2(700, 3)), mode: "straight", type: "one1" });
    expect(back.widen).toBeUndefined();
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
