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
    // drawn against the traffic: still that stretch of carriageway
    const back = planRoad(net, world, { start: on(net, v2(900, 3)), end: on(net, v2(700, 3)), mode: "straight", type: "one1" });
    expect(back.errors.map((e) => e.msg)).toEqual([]);
    expect(back.widen?.lanes).toBe(3);
    expect(back.widen!.a.x).toBeCloseTo(700, 2);
    expect(back.widen!.b.x).toBeCloseTo(900, 2);
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
  /** What the game does with a plan: the roads, then the lanes added to the carriageway. */
  function build(net: RoadNetwork, plan: ReturnType<typeof planRoad>) {
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    net.begin();
    for (const st of plan.strokes) commitStrokes(net, [st]);
    if (plan.widen) { if (plan.strokes.length) net.rebuild(); commitWiden(net, plan.widen); }
    net.commit();
    net.rebuild();
  }
  /** The carriageway along y = 0, west to east: [from x, to x, type]. */
  const along = (net: RoadNetwork) => [...net.segs.values()].filter((s) => s.type !== "hw1")
    .sort((x, y) => x.c.p0.x - y.c.p0.x).map((s) => [Math.round(s.c.p0.x), Math.round(s.c.p3.x), s.type]);
  const exit = (net: RoadNetwork, x: number) => planRoad(net, world, { start: on(net, v2(x, 0)), end: free(v2(x + 220, 110)), mode: "straight", type: "hw1" });
  const entry = (net: RoadNetwork, x: number) => planRoad(net, world, { start: free(v2(x - 220, 110)), end: on(net, v2(x, 0)), mode: "straight", type: "hw1" });

  it("gives an exit a deceleration lane: the carriageway a lane wider before it, the ramp carrying straight on from it", () => {
    const net = carriageway();
    const plan = exit(net, 800);
    expect(plan.note).toBe("160 m slip lane");
    expect(plan.ghosts?.[0].chain.length).toBeGreaterThan(0);
    build(net, plan);
    expect(along(net)).toEqual([[0, 640, "hw2"], [640, 800, "one3"], [800, 2000, "hw2"]]);
    const kinds = [...net.nodeGeom.values()].map((g) => g.kind).filter((k) => k !== "end").sort();
    expect(kinds).toEqual(["lane", "split"]);
    // at the gore: the kerb lane runs on into the ramp, the two through lanes run on 1:1
    const gore = [...net.nodeGeom.values()].find((g) => g.kind === "split")!;
    const ramp = [...net.segs.values()].find((s) => s.type === "hw1")!;
    const toRamp = gore.conns.filter((c) => c.to.seg === ramp.id);
    expect(toRamp.map((c) => c.from.idx)).toEqual([0]);
    expect(maxBend(toRamp[0])).toBeLessThan(0.08);
    expect(gore.conns.filter((c) => c.to.seg !== ramp.id).map((c) => `${c.from.idx}>${c.to.idx}`).sort()).toEqual(["1>0", "2>1"]);
  });

  it("gives an entry a longer acceleration lane after it", () => {
    const net = carriageway();
    const plan = entry(net, 800);
    expect(plan.note).toBe("200 m slip lane");
    build(net, plan);
    expect(along(net)).toEqual([[0, 800, "hw2"], [800, 1000, "one3"], [1000, 2000, "hw2"]]);
  });

  it("joins an entry's lane to the next exit's when they come close: one lane between them", () => {
    const net = carriageway();
    build(net, entry(net, 600));
    const plan = exit(net, 1100);
    expect(plan.note).toBe("Slip lanes joined");
    build(net, plan);
    expect(along(net)).toEqual([[0, 600, "hw2"], [600, 800, "one3"], [800, 1100, "one3"], [1100, 2000, "hw2"]]);
    // and the other way round: an exit drawn first, then the entry before it
    const net2 = carriageway();
    build(net2, exit(net2, 1100));
    build(net2, entry(net2, 600));
    expect(along(net2).map((r) => r[2])).toEqual(["hw2", "one3", "one3", "hw2"]);
    expect(along(net2)[1][0]).toBe(600);
    expect(along(net2)[2][1]).toBe(1100);
  });

  it("keeps lanes apart when the next ramp is far away", () => {
    const net = carriageway(3000);
    build(net, entry(net, 600));
    build(net, exit(net, 1600));
    expect(along(net).map((r) => r[2])).toEqual(["hw2", "one3", "hw2", "one3", "hw2"]);
  });

  it("makes a slip lane longer when it is drawn on along the carriageway, either way", () => {
    const net = carriageway();
    build(net, exit(net, 800));
    // from the lane's start back up the carriageway, against the traffic
    const plan = planRoad(net, world, { start: on(net, v2(640, 3)), end: on(net, v2(400, 3)), mode: "straight", type: "hw1" });
    expect(plan.widen?.lanes).toBe(3);
    build(net, plan);
    expect(along(net).map((r) => r[2])).toEqual(["hw2", "one3", "one3", "hw2"]);
    expect(along(net)[1][0]).toBe(400);
    // drawn over the lane and on past it: the rest is brought up to match, nothing gets a fourth lane
    const over = planRoad(net, world, { start: on(net, v2(500, 3)), end: on(net, v2(300, 3)), mode: "straight", type: "hw1" });
    expect(over.note).toBe("Extend lane");
    build(net, over);
    expect(new Set(along(net).map((r) => r[2]))).toEqual(new Set(["hw2", "one3"]));
    expect(along(net).find((r) => r[2] === "one3")![0]).toBe(300);
  });

  it("runs a lane drawn just short of a slip lane on to meet it, leaving no sliver between", () => {
    const net = carriageway();
    build(net, exit(net, 800));
    const plan = planRoad(net, world, { start: on(net, v2(600, 3)), end: on(net, v2(400, 3)), mode: "straight", type: "hw1" });
    expect(plan.note).toBe("Extend lane");
    build(net, plan);
    expect(along(net).map((r) => r[2])).toEqual(["hw2", "one3", "one3", "hw2"]);
    expect(along(net)[1][0]).toBe(400);
    // but not from far off: that's a lane of its own
    const net2 = carriageway();
    build(net2, exit(net2, 800));
    const far = planRoad(net2, world, { start: on(net2, v2(500, 3)), end: on(net2, v2(300, 3)), mode: "straight", type: "hw1" });
    expect(far.note).toBe("Add lane");
  });

  /** A carriageway along y = 0 that climbs onto a bridge (8 m) over a ground road crossing at x = 1000. */
  function overBridge() {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), m = net.addNode(v2(500, 0), 0), b = net.addNode(v2(900, 0), 8), c = net.addNode(v2(1500, 0), 8);
    road(net, a, m, "hw2");
    road(net, m, b, "hw2");
    road(net, b, c, "hw2");
    road(net, net.addNode(v2(1000, -300), 0), net.addNode(v2(1000, 300), 0), "street");
    net.commit();
    net.rebuild();
    return net;
  }

  it("follows the carriageway onto a rising stretch when drawing along it from lower down", () => {
    const net = overBridge();
    const start = on(net, v2(300, 0));
    const end = snap(net, v2(800, 0.5), { mpp: 0.2, level: 0, type: "hw1", from: { p: start.p, on: start } });
    expect(end.seg).toBeDefined();
    expect(end.h).toBeGreaterThan(4);
    const plan = planRoad(net, world, { start, end, mode: "straight", type: "hw1" });
    expect(plan.widen?.lanes).toBe(3);
    // a stroke from somewhere else doesn't get pulled up onto it
    expect(snap(net, v2(800, 0.5), { mpp: 0.2, level: 0, type: "hw1", from: { p: v2(800, 300) } }).seg).toBeUndefined();
    // aiming at the ground road under the bridge snaps to that road, not up onto the bridge
    const under = snap(net, v2(1001, 1), { mpp: 0.2, level: 0, type: "hw1", from: { p: start.p, on: start } });
    expect(under.h).toBe(0);
    expect(net.segs.get(under.seg!)?.type).toBe("street");
  });

  it("draws an exit's lane preview in order when the lane runs over a node", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), m = net.addNode(v2(1000, 0), 0), b = net.addNode(v2(2000, 0), 0);
    road(net, a, m, "hw2");
    road(net, m, b, "hw2");
    net.commit();
    net.rebuild();
    const plan = exit(net, 1100);
    const xs = plan.ghosts![0].chain.flatMap((c) => [c.p0.x, c.p3.x]);
    expect(xs[0]).toBeCloseTo(940, 0);
    expect(xs[xs.length - 1]).toBeCloseTo(1100, 0);
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThanOrEqual(xs[i - 1] - 0.5);
  });

  it("only takes a straight stroke along the carriageway as a lane, and carries on from the cursor's end", () => {
    const net = carriageway();
    // a loop road drawn round from the carriageway and back onto it is a road
    const loop = planRoad(net, world, { start: on(net, v2(700, 0)), end: on(net, v2(300, 0)), mode: "continuous", type: "one1", startTangent: v2(0, 1) });
    expect(loop.widen).toBeUndefined();
    expect(loop.strokes.length).toBeGreaterThan(0);
    // drawn against the traffic, the next stroke starts where the cursor was, on the carriageway
    const back = planRoad(net, world, { start: on(net, v2(900, 3)), end: on(net, v2(700, 3)), mode: "straight", type: "hw1" });
    expect(back.continueAt?.p.x).toBeCloseTo(700, 0);
    expect(back.continueAt?.p.y).toBeCloseTo(0, 3);
  });

  it("leaves town slip roads and far-side ramps without one", () => {
    const net = carriageway();
    const left = planRoad(net, world, { start: on(net, v2(800, 0)), end: free(v2(1020, -110)), mode: "straight", type: "hw1" });
    expect(left.widen).toBeUndefined();
    const town = new RoadNetwork();
    town.begin();
    road(town, town.addNode(v2(0, 0), 0), town.addNode(v2(1000, 0), 0), "one2");
    town.commit();
    town.rebuild();
    const t = planRoad(town, world, { start: on(town, v2(500, 0)), end: free(v2(600, 30)), mode: "straight", type: "one1" });
    expect(t.widen).toBeUndefined();
  });

  it("drives cars through an interchange with slip lanes without stalls", () => {
    const net = carriageway(2400);
    build(net, exit(net, 700));
    build(net, entry(net, 1300));
    const hw1 = [...net.segs.values()].filter((s) => s.type === "hw1");
    const offRamp = hw1.reduce((m, s) => (dist2(s.c.p3, v2(920, 110)) < dist2(m.c.p3, v2(920, 110)) ? s : m));
    const onRamp = hw1.reduce((m, s) => (dist2(s.c.p0, v2(1080, 110)) < dist2(m.c.p0, v2(1080, 110)) ? s : m));
    const first = [...net.segs.values()].find((s) => s.c.p0.x === 0)!, last = [...net.segs.values()].find((s) => Math.round(s.c.p3.x) === 2400)!;
    const acc = (seg: number, frac: number): { a: Access; side: 1 | -1 } => {
      const g = net.segGeom.get(seg)!;
      const s = g.center.length * frac;
      return { a: { seg, s, p: polyAt(g.center, s) }, side: 1 };
    };
    let arrived = 0, failed = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { failed++; } });
    const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
    const reqs: [ReturnType<typeof acc>, ReturnType<typeof acc>][] = [];
    for (let i = 0; i < 30; i++) reqs.push(i % 3 === 0 ? [acc(first.id, 0.1), acc(offRamp.id, 0.95)] : i % 3 === 1 ? [acc(onRamp.id, 0.05), acc(last.id, 0.9)] : [acc(first.id, 0.1), acc(last.id, 0.9)]);
    let i = 0;
    for (let t = 0; t < 300; t += 1 / 30) {
      if (i < reqs.length && t > i * 1.5) {
        const [f, to] = reqs[i++];
        tr.request({ from: f.a, fromSide: f.side, to: to.a, toSide: to.side, trip: trip(), truck: i % 5 === 0, tries: 0, wait: 0 });
      }
      tr.step(1 / 30);
    }
    expect(failed).toBe(0);
    expect(arrived).toBe(30);
  });
});

const dist2 = (a: V2, b: V2) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
