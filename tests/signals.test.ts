import { describe, it, expect } from "vitest";
import { RoadNetwork, type Connector } from "../src/roads/network";
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
function drive(flows: [number, number, number][], T: number) {
  const k = crossing();
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
