// Holds at driveways name who holds whom (Vehicle.waitOn), as every other hold does, so a ring of waits that runs
// through one is seen by the sim's deadlock test (Traffic.waitCycles, and the ring breaker after CYCLE_RELEASE) and
// by the queue finder. Before, a car braking for one pulling out across its lane waited on nobody: a ring through a
// pull-out was invisible (seen in the late-game save: a pull-out across a lane holding a road train, no link).

import { describe, expect, it } from "vitest";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import type { Access } from "../src/sim/router";

const DT = 1 / 30;
const trip = (from: number): Trip => ({ kind: "cargo", from, to: 9, resident: -1, startT: 0, freeFlow: 0 });

/**
 * A street W-B-C-F with a side road at B and at C. Four cars stand at C's line heading east, held there for the
 * truck T (the junction gives way to it, as it would to a car with the right of way); car X pulls out of a
 * driveway behind them, across the westbound lane, into the back of their queue; T drives west along that lane and
 * stops for X pulling out across it. A ring: T waits on X, X on the queue ahead of it, the queue on T.
 */
function pullOutRing() {
  const net = new RoadNetwork();
  net.begin();
  const P = (x: number, y: number) => net.addNode(v2(x, y), 0);
  const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  const A = P(0, 0), B = P(300, 0), C = P(700, 0), F = P(1000, 0);
  const ab = mk(A, B), bc = mk(B, C), cf = mk(C, F);
  mk(B, P(300, 300));
  mk(C, P(700, 300));
  net.commit();
  net.rebuild();
  const acc = (seg: number, s: number): Access => { const g = net.segGeom.get(seg)!; return { seg, s, p: polyAt(g.center, s) }; };
  const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
  const T = tr as unknown as { canEnter(v: Vehicle, ...a: unknown[]): boolean };
  const enter = T.canEnter.bind(tr);
  let truck: Vehicle | undefined;
  // the junction at C holds the eastbound traffic for the truck
  T.canEnter = (v: Vehicle, c: unknown, ...a: unknown[]) => {
    if ((c as { node: number }).node === C && v !== truck) { v.block = "yield"; v.blockBy = truck ?? null; return false; }
    return enter(v, c, ...a);
  };
  const run = (s: number, each?: () => void) => { for (let t = 0; t < s; t += DT) { tr.step(DT); each?.(); } };
  // the queue at C's line
  for (let i = 0; i < 4; i++) {
    tr.request({ from: acc(ab, 250 - i * 12), fromSide: 1, to: acc(cf, 200), toSide: 1, trip: trip(i), truck: false, tries: 0, wait: 0, through: true });
  }
  run(70);
  const queue = new Set(tr.vehicles);
  // (all four standing at C's line)
  const bcLen = net.segGeom.get(bc)!.center.length;
  expect([...queue].filter((v) => v.v < 0.3 && (v.edge as { seg?: number }).seg === bc).length).toBe(4);
  // X pulls out from the north side of B-C (left of a->b: across the westbound lane), 45 m short of C
  tr.request({ from: acc(bc, bcLen - 45), fromSide: -1, to: acc(cf, 250), toSide: 1, trip: trip(10), truck: false, tries: 0, wait: 0 });
  let x: Vehicle | undefined;
  for (let k = 0; k < 150 && !x; k++) { tr.step(DT); x = tr.vehicles.find((v) => !queue.has(v)); }
  expect(x?.crossing?.length).toBeGreaterThan(0);
  // T comes west along B-C from just past C, a truck heading for the far end of A-B
  tr.request({ from: acc(bc, bcLen - 4), fromSide: -1, to: acc(ab, 30), toSide: 1, trip: trip(11), truck: true, tries: 0, wait: 0, through: true });
  for (let k = 0; k < 30 && !truck; k++) { tr.step(DT); truck = tr.vehicles.find((v) => v.truck); }
  expect(truck).toBeDefined();
  return { tr, x: x!, truck: truck!, run };
}

describe("a car pulling out of a driveway across a lane", () => {
  it("is what the traffic it holds up waits on, so a ring of waits through it is found", () => {
    const { tr, x, truck, run } = pullOutRing();
    let held = 0, seen = 0, linked = 0;
    run(12, () => {
      // (while the truck stands for the pull-out across its lane)
      if (truck.v > 0.3 || !x.crossing) return;
      held++;
      if (truck.waitOn === x) linked++;
      if (tr.waitCycles(0).some((r) => r.includes(truck) && r.includes(x))) seen++;
    });
    // the hold itself is unchanged: the truck stops short of the car pulling out across its lane
    expect(held).toBeGreaterThan(15);
    expect(linked).toBe(held);
    expect(seen).toBe(held);
    // and it lasts only while the car is still across the lane: standing in its own lane it no longer holds the
    // truck, which drives on (so a ring through a pull-out undoes itself in seconds)
    expect(x.crossing).toBeUndefined();
    expect(held).toBeLessThan(30 * 12);
    expect(truck.v).toBeGreaterThan(1);
  });
});

describe("a car waiting to turn in across a lane", () => {
  it("waits on the vehicle standing across its driveway", () => {
    const net = new RoadNetwork();
    net.begin();
    const P = (x: number, y: number) => net.addNode(v2(x, y), 0);
    const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
    const A = P(0, 0), B = P(400, 0), C = P(800, 0);
    const ab = mk(A, B), bc = mk(B, C);
    mk(B, P(400, 300));
    net.commit();
    net.rebuild();
    const acc = (seg: number, s: number): Access => { const g = net.segGeom.get(seg)!; return { seg, s, p: polyAt(g.center, s) }; };
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    const T = tr as unknown as { canEnter(v: Vehicle, ...a: unknown[]): boolean };
    const enter = T.canEnter.bind(tr);
    // a truck heading west stands at B's line (held there), its body across a driveway on the north side of B-C
    T.canEnter = (v: Vehicle, ...a: unknown[]) => (v.truck ? ((v.block = "yield"), (v.blockBy = null), false) : enter(v, ...a));
    tr.request({ from: acc(bc, 200), fromSide: -1, to: acc(ab, 30), toSide: 1, trip: trip(1), truck: true, tries: 0, wait: 0, through: true });
    for (let t = 0; t < 40; t += DT) tr.step(DT);
    const truck = tr.vehicles[0];
    expect(truck.v).toBeLessThan(0.3);
    // a car from the west drives up to turn into that driveway, across the truck's lane
    tr.request({ from: acc(ab, 300), fromSide: 1, to: acc(bc, 12), toSide: -1, trip: trip(2), truck: false, tries: 0, wait: 0, through: true });
    let held = 0, linked = 0;
    for (let t = 0; t < 30; t += DT) {
      tr.step(DT);
      const car = tr.vehicles.find((v) => !v.truck);
      // (while it stands at its driveway: not once it has given up on it and drives on)
      if (!car || car.v > 0.3 || (car.edge as { seg?: number }).seg !== bc || car.destS < 0) continue;
      held++;
      if (car.waitOn === truck) linked++;
    }
    // (it stands there till it gives up on the driveway and drives round the block to come back to it)
    expect(held).toBeGreaterThan(30 * 5);
    expect(linked).toBe(held);
  });
});
