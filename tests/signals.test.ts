import { describe, it, expect } from "vitest";
import { RoadNetwork, type Connector, type SignalPhase } from "../src/roads/network";
import { Traffic, type Trip } from "../src/sim/traffic";
import { straightCubic, v2, polyAt, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "avenue") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}

function access(net: RoadNetwork, seg: number, frac: number, side: 1 | -1): { a: Access; side: 1 | -1 } {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  const p = polyAt(g.center, s);
  const q0 = g.center.pts[0], q1 = g.center.pts[g.center.pts.length - 1];
  const L = Math.hypot(q1.x - q0.x, q1.y - q0.y);
  const r: V2 = { x: -(q1.y - q0.y) / L, y: (q1.x - q0.x) / L };
  return { a: { seg, s, p: { x: p.x + r.x * side * (g.width / 2), y: p.y + r.y * side * (g.width / 2) } }, side };
}

/** An avenue crossing with lights: east-west in one phase, north-south in the other. */
function crossing() {
  const net = new RoadNetwork();
  net.begin();
  const c = net.addNode(v2(300, 300), 0);
  const [e, w, n, s] = [v2(700, 300), v2(-100, 300), v2(300, -100), v2(300, 700)].map((p) => road(net, net.addNode(p, 0), c));
  net.setSignal(c, { phases: [{ arms: [e, w], dur: 14 }, { arms: [n, s], dur: 14 }] });
  net.commit();
  net.rebuild();
  return { net, c, e, w, n, s };
}

const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });

/**
 * Sends cars along `flows` ([from arm, to arm, seconds between cars]) for `T` seconds, and reports how many
 * arrived and the longest any one car stood still, per flow.
 */
function drive(flows: [number, number, number][], T: number, phases?: SignalPhase[]) {
  const k = crossing();
  if (phases) {
    k.net.begin();
    k.net.setSignal(k.c, { phases });
    k.net.commit();
    k.net.rebuild();
  }
  let arrived = 0, closest = Infinity;
  const tr = new Traffic(k.net, { arrive: () => { arrived++; }, fail: () => {} });
  const longest = flows.map(() => 0);
  const next = flows.map(() => 0);
  const dt = 1 / 30;
  for (let t = 0; t < T; t += dt) {
    flows.forEach(([a, b, every], i) => {
      if (t < next[i]) return;
      next[i] += every;
      const tp = Object.assign(trip(), { flow: i });
      tr.request({ from: access(k.net, a, 0.15, 1).a, fromSide: 1, to: access(k.net, b, 0.6, -1).a, toSide: -1, trip: tp, truck: false, tries: 0, wait: 0 });
    });
    tr.step(dt);
    for (const v of tr.vehicles) {
      const i = (v.trip as { flow?: number }).flow;
      if (i !== undefined) longest[i] = Math.max(longest[i], v.wait);
    }
    // how close two cars on different paths through the junction get
    const inBox = tr.vehicles.filter((v) => v.edge.kind === "conn");
    for (let a = 0; a < inBox.length; a++) for (let b = a + 1; b < inBox.length; b++) {
      const ea = inBox[a].edge as Connector, eb = inBox[b].edge as Connector;
      if (ea === eb || ea.to === eb.to) continue; // (one behind the other)
      closest = Math.min(closest, Math.hypot(inBox[a].x - inBox[b].x, inBox[a].y - inBox[b].y));
    }
  }
  return { arrived, longest, closest };
}

describe("Traffic lights adapt to the traffic (CS2)", () => {
  it("a car alone at the lights barely waits: with nobody on the cross street, the light changes for it", () => {
    const k = crossing();
    const r = drive([[k.e, k.w, 25]], 200);
    expect(r.arrived).toBeGreaterThanOrEqual(6);
    // fixed 14 s phases would leave some of them standing for most of a red (up to ~19 s)
    expect(r.longest[0]).toBeLessThan(8);
  });

  it("a busy road keeps its green while the cross street is quiet, and the cross street still gets its turn", () => {
    const k = crossing();
    const r = drive([[k.e, k.w, 2.2], [k.w, k.e, 2.6], [k.n, k.s, 30]], 240);
    // the side street's cars aren't starved...
    expect(r.longest[2]).toBeLessThan(40);
    // ...and the main road loses little time to it
    expect(Math.max(r.longest[0], r.longest[1])).toBeLessThan(14);
    expect(r.arrived).toBeGreaterThan(160);
  });

  it("turns right on red when nothing is coming, after a stop", () => {
    const k = crossing();
    // north-south traffic keeps the green; cars from the east turn right (north) across nobody's path
    const r = drive([[k.n, k.s, 3], [k.s, k.n, 60], [k.e, k.n, 9]], 200);
    // (waiting for the light would take ~9 s here)
    expect(r.longest[2]).toBeLessThan(4);
  });

  it("a right turn on red gives way to the traffic it merges with", () => {
    const k = crossing();
    // northbound traffic on its green goes into the lanes the right-turners want
    const r = drive([[k.s, k.n, 2.5], [k.n, k.s, 3], [k.e, k.n, 6]], 240);
    expect(r.closest).toBeGreaterThan(2.2);
    expect(r.arrived).toBeGreaterThan(120);
  });

  it("editing the plan doesn't snap a changing light back to green; changing what goes does it via all red", () => {
    const k = crossing();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    expect(tr.signalState(k.c, k.e)).toBe("green");
    const ctl = (tr as unknown as { sigCtl: Map<number, { i: number; st: number; t: number }> }).sigCtl.get(k.c)!;
    ctl.st = 1; // yellow for east-west
    const edit = (dur: number, arms: number[]) => {
      k.net.begin();
      k.net.setSignal(k.c, { phases: [{ arms, dur }, { arms: [k.n, k.s], dur: 14 }] });
      k.net.commit();
      k.net.rebuild();
    };
    edit(20, [k.e, k.w]);
    tr.step(1 / 30);
    expect(tr.signalState(k.c, k.e)).toBe("yellow");
    ctl.st = 0;
    edit(20, [k.e]); // the west arm no longer goes in this phase
    expect(tr.signalState(k.c, k.e)).toBe("red");
    expect(ctl.st).toBe(2);
  });

  it("a left-turn phase lets left turns through that would wait for a gap in heavy oncoming traffic", () => {
    const k = crossing();
    // eastbound (from the west arm) turning left goes north
    const l = k.net.nodeGeom.get(k.c)!.conns.find((c) => c.armIn === k.w && c.turn === "L")!;
    expect(l.to.seg).toBe(k.n);
    const flows: [number, number, number][] = [[k.e, k.w, 1.6], [k.w, k.e, 1.8], [k.w, k.n, 7], [k.n, k.s, 9]];
    const plain = drive(flows, 300);
    const withLeft = drive(flows, 300, [{ arms: [k.e, k.w], dur: 6, left: true }, { arms: [k.e, k.w], dur: 14 }, { arms: [k.n, k.s], dur: 14 }]);
    console.log("left turn: longest wait", plain.longest[2].toFixed(1), "->", withLeft.longest[2].toFixed(1), "arrived", plain.arrived, "->", withLeft.arrived);
    expect(withLeft.longest[2]).toBeLessThan(plain.longest[2] * 0.7);
    expect(withLeft.arrived).toBeGreaterThanOrEqual(plain.arrived * 0.95);
    expect(withLeft.closest).toBeGreaterThan(2.2);
  });

  it("after a left-turn phase with nobody else about, the light rests on the road's green, not on red for it", () => {
    const k = crossing();
    const plan: SignalPhase[] = [{ arms: [k.e, k.w], dur: 6, left: true }, { arms: [k.e, k.w], dur: 14 }, { arms: [k.n, k.s], dur: 14 }];
    // a lone left turn now and then, and between them a lone car going straight on along the same road
    const r = drive([[k.w, k.n, 30], [k.w, k.e, 30]], 200, plan);
    expect(r.arrived).toBeGreaterThanOrEqual(10);
    expect(r.longest[1]).toBeLessThan(2);
    // a left turn, alone, calls its phase and goes
    expect(r.longest[0]).toBeLessThan(8);
  });

  it("never turns green for a phase that lets nobody go, or for a road nobody is on", () => {
    const k = crossing();
    k.net.begin();
    k.net.setSignal(k.c, { phases: [{ arms: [k.e, k.w], dur: 14 }, { arms: [], dur: 10 }, { arms: [k.n, k.s], dur: 14 }] });
    k.net.commit();
    k.net.rebuild();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    tr.signalState(k.c, k.e);
    const ctl = (tr as unknown as { sigCtl: Map<number, { i: number; st: number; t: number }> }).sigCtl.get(k.c)!;
    // east-west ends with nobody waiting anywhere: it comes back to east-west, not the empty phase
    ctl.st = 2; ctl.t = 0;
    for (let t = 0; t < 2; t += 1 / 30) tr.step(1 / 30);
    expect(ctl.i).toBe(0);
    expect(ctl.st).toBe(0);
  });
});

describe("lights in a town", () => {
  it("never lock up: a car held at its driveway by the queue for the red drives on and comes back round", async () => {
    const { Game } = await import("../src/game/city");
    const { HOUR } = await import("../src/game/society");
    // Alder Run grown to a village on seed 7, lights at its centre crossing: before, a car turning in across the
    // queue for the red stood at its driveway for good, its lane and the junction behind it locked (2026-11-08)
    const g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e8;
    const t = g.towns.list[0];
    t.target = 400;
    const stock = () => { for (const b of g.shops) b.stock = Math.max(b.stock, 8); };
    for (let i = 0; i < 14 * HOUR * 30; i++) { g.step(1 / 30); if (i % 600 === 0) t.target = Math.max(t.target, 400); stock(); }
    const c = [...g.net.nodes.values()].sort((a, b) => Math.hypot(a.p.x - t.c.x, a.p.y - t.c.y) - Math.hypot(b.p.x - t.c.x, b.p.y - t.c.y))[0];
    const arms = [...g.net.segs.values()].filter((s) => s.a === c.id || s.b === c.id);
    expect(arms.length).toBe(4);
    const ew = arms.filter((s) => { const o = g.net.nodes.get(s.a === c.id ? s.b : s.a)!; return Math.abs(o.p.x - c.p.x) > Math.abs(o.p.y - c.p.y); }).map((s) => s.id);
    g.setSignal(c.id, { phases: [{ arms: ew, dur: 15 }, { arms: arms.map((s) => s.id).filter((i) => !ew.includes(i)), dur: 15 }] });
    let worst = 0;
    for (let i = 0; i < 40 * HOUR * 30; i++) {
      g.step(1 / 30);
      stock();
      if (i % 30 === 0) for (const v of g.traffic.vehicles) if (v.v < 0.5) worst = Math.max(worst, v.wait);
    }
    // (a red, then a full green for the other road, at most: no one waits through cycle after cycle)
    expect(worst).toBeLessThan(45);
  }, 120000);
});
