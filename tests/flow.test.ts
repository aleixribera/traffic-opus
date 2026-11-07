import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "street") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
const acc = (net: RoadNetwork, seg: number, frac: number): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s) };
};
const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });

describe("Junction flow", () => {
  it("lets a side street out of a steady stream on the main road (no far-off reservations starving it)", () => {
    // avenue W->E through X, a street joining from the south at X
    const net = new RoadNetwork();
    net.begin();
    const W = net.addNode(v2(0, 0), 0), X = net.addNode(v2(600, 0), 0), E = net.addNode(v2(1200, 0), 0), S = net.addNode(v2(600, 300), 0);
    const w = road(net, W, X, "avenue"), e = road(net, X, E, "avenue"), s = road(net, S, X, "street");
    net.commit();
    net.rebuild();
    let arrived = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => {} });
    // main stream: a car every 3.2 s through the junction (both lanes); a few side-street cars turning left onto it
    const side: number[] = [];
    let k = 0;
    const waits = new Map<number, number>();
    for (let t = 0; t < 200; t += 1 / 30) {
      if (t > k * 2.2) {
        k++;
        tr.request({ from: { ...acc(net, w, 0.05) }, fromSide: 1, to: acc(net, e, 0.95), toSide: 1, trip: trip(), truck: k % 2 === 0, tries: 0, wait: 0, through: true });
        if (k % 8 === 3 && side.length < 5) {
          side.push(k);
          tr.request({ from: acc(net, s, 0.2), fromSide: 1, to: acc(net, w, 0.1), toSide: -1, trip: { ...trip(), from: 1 }, truck: false, tries: 0, wait: 0 });
        }
      }
      tr.step(1 / 30);
      for (const v of tr.vehicles as Vehicle[]) if (v.trip.from === 1) waits.set(v.id, Math.max(waits.get(v.id) ?? 0, v.wait));
    }
    const worst = Math.max(...waits.values());
    expect(waits.size).toBe(5);
    expect(worst, `a side-street car waited ${worst.toFixed(0)} s`).toBeLessThan(30);
    expect(arrived).toBeGreaterThan(40);
  });

  it("doesn't stop cars where a street turns into an avenue: they just follow on", () => {
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), X = net.addNode(v2(300, 0), 0), B = net.addNode(v2(700, 0), 0);
    const a = road(net, A, X, "street"), b = road(net, X, B, "avenue");
    net.commit();
    net.rebuild();
    expect(net.nodeGeom.get(X)!.kind).toBe("junction");
    let arrived = 0, boxed = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => {} });
    let k = 0;
    for (let t = 0; t < 180; t += 1 / 30) {
      if (k < 30 && t > k * 1.6) {
        k++;
        tr.request({ from: acc(net, a, 0.1), fromSide: 1, to: acc(net, b, 0.9), toSide: 1, trip: trip(), truck: k % 5 === 0, tries: 0, wait: 0 });
      }
      tr.step(1 / 30);
      for (const v of tr.vehicles as Vehicle[]) if (v.block === "box") { boxed++; v.block = undefined; }
    }
    const left = (tr.vehicles as Vehicle[]).map((v) => `${v.id} ${(v.edge as any).kind}:${(v.edge as any).seg ?? (v.edge as any).node} s=${v.s.toFixed(1)} v=${v.v.toFixed(1)} block=${v.block} wait=${v.wait.toFixed(0)} granted=${v.granted}`);
    expect(boxed).toBe(0);
    expect(arrived, left.join(" | ") + " pending " + tr.pending.map((p) => p.why).join(",")).toBe(30);
  });
  it("takes turns into a backed-up street: a car waiting at its line isn't passed over by every new arrival", () => {
    // X: a street from the north runs on south to Y; a street from the east turns right into it at X.
    // Y is a signal that lets the south street out only briefly, so the street X->Y is backed up most of the time.
    const net = new RoadNetwork();
    net.begin();
    const N = net.addNode(v2(0, -400), 0), X = net.addNode(v2(0, 0), 0), E = net.addNode(v2(400, 0), 0);
    const Y = net.addNode(v2(0, 120), 0), W = net.addNode(v2(-400, 120), 0), F = net.addNode(v2(400, 120), 0);
    const n = road(net, N, X), e = road(net, E, X), xy = road(net, X, Y), w = road(net, Y, W), f = road(net, F, Y);
    net.commit();
    net.rebuild();
    net.begin();
    net.setSignal(Y, { phases: [{ arms: [xy], dur: 5 }, { arms: [f], dur: 25 }] } as any);
    net.commit();
    net.rebuild();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    const waits = new Map<number, number>();
    let k = 0;
    for (let t = 0; t < 400; t += 1 / 30) {
      if (t > k * 2.5) {
        k++;
        tr.request({ from: acc(net, n, 0.1), fromSide: 1, to: acc(net, w, 0.9), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
        if (k % 3 === 0) tr.request({ from: acc(net, e, 0.1), fromSide: 1, to: acc(net, w, 0.9), toSide: 1, trip: { ...trip(), from: 1 }, truck: false, tries: 0, wait: 0, through: true });
      }
      tr.step(1 / 30);
      // time each side-street car spends first in line at the junction (the queue behind it is overload, not unfairness)
      for (const v of tr.vehicles as Vehicle[]) {
        const l = v.edge as any;
        if (v.trip.from === 1 && l.kind === "lane" && l.seg === e && v.s > l.pl.length - 3) waits.set(v.id, (waits.get(v.id) ?? 0) + 1 / 30);
      }
    }
    const worst = Math.max(...waits.values());
    expect(waits.size).toBeGreaterThan(5);
    expect(worst, `a car on the side street waited ${worst.toFixed(0)} s at the front of its queue`).toBeLessThan(45);
  });
});

describe("Merging into a queue", () => {
  it("gets cars from the outer lane into a backed-up exit lane instead of past the exit", () => {
    // a motorway carriageway with an exit to the right at X (from the kerb lane only); the exit road is backed
    // up by a signal that lets it out only briefly, so the kerb lane is a crawling queue. Half the cars arrive
    // in the outer lane and have to squeeze into it.
    const net = new RoadNetwork();
    net.begin();
    // cars come in on an earlier stretch U-A where either lane is fine, so the outer lane only becomes the wrong
    // one on A-X, alongside the queue
    const U = net.addNode(v2(-500, 0), 0), A = net.addNode(v2(0, 0), 0), X = net.addNode(v2(600, 0), 0), B = net.addNode(v2(1000, 0), 0);
    const Y = net.addNode(v2(600, 150), 0), W = net.addNode(v2(600, 500), 0), F = net.addNode(v2(900, 150), 0);
    const u = road(net, U, A, "hw2"), b = road(net, X, B, "hw2"), xy = road(net, X, Y, "street"), w = road(net, Y, W), f = road(net, F, Y);
    road(net, A, X, "hw2");
    net.commit();
    net.rebuild();
    net.begin();
    net.setSignal(Y, { phases: [{ arms: [xy], dur: 6 }, { arms: [f], dur: 12 }] } as any);
    net.commit();
    net.rebuild();
    let arrived = 0, fails = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { fails++; } });
    let k = 0, missed = 0;
    const onB = new Set<number>();
    for (let t = 0; t < 420; t += 1 / 30) {
      if (k < 60 && t > k * 2.4) {
        k++;
        // fromSide -1 on a one-way: joins in the outer lane
        tr.request({ from: acc(net, u, 0.02), fromSide: k % 2 ? 1 : -1, to: acc(net, w, 0.9), toSide: 1, trip: trip(), truck: k % 4 !== 0, tries: 0, wait: 0, through: true });
      }
      tr.step(1 / 30);
      for (const v of tr.vehicles as Vehicle[]) if ((v.edge as any).seg === b && !onB.has(v.id)) { onB.add(v.id); missed++; }
    }
    expect(missed, "cars that missed the exit").toBe(0);
    expect(fails).toBe(0);
    expect(arrived + tr.vehicles.length + tr.pending.length).toBe(60);
  });
});

describe("Swapping lanes", () => {
  it("doesn't lock up two cars side by side that each need the other's lane", () => {
    // a two-lane one-way splitting at X: the left lane goes on to L, the right lane to R. Cars arriving
    // side by side in the wrong lanes must swap.
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), X = net.addNode(v2(150, 0), 0), L = net.addNode(v2(400, -150), 0), R = net.addNode(v2(400, 150), 0);
    const a = road(net, A, X, "one2"), l = road(net, X, L, "one1"), r = road(net, X, R, "one1");
    net.commit();
    net.rebuild();
    let arrived = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => {} });
    for (let i = 0; i < 6; i++) {
      // fromSide -1 joins in the outer (left) lane, +1 in the kerb (right) lane: each pair needs to swap
      tr.request({ from: acc(net, a, 0.1), fromSide: -1, to: acc(net, r, 0.8), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
      tr.request({ from: acc(net, a, 0.1), fromSide: 1, to: acc(net, l, 0.8), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
    }
    let maxStuck = 0;
    for (let t = 0; t < 120; t += 1 / 30) {
      tr.step(1 / 30);
      for (const v of tr.vehicles as Vehicle[]) maxStuck = Math.max(maxStuck, v.stuck);
    }
    expect(maxStuck).toBeLessThan(30);
    expect(arrived).toBe(12);
  });

  it("swaps two cars that reach the end of the lane side by side, each in the other's lane", () => {
    // as above, but the cars turn up late, a short way before the split, and stop level with each other:
    // the older one pulls up to the line and across, the other waits a car's length back
    for (const frac of [0.6, 0.7, 0.8]) {
      const net = new RoadNetwork();
      net.begin();
      const A = net.addNode(v2(0, 0), 0), X = net.addNode(v2(150, 0), 0), L = net.addNode(v2(400, -150), 0), R = net.addNode(v2(400, 150), 0);
      const a = road(net, A, X, "one2"), l = road(net, X, L, "one1"), r = road(net, X, R, "one1");
      net.commit();
      net.rebuild();
      let arrived = 0;
      const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => {} });
      for (let i = 0; i < 3; i++) {
        tr.request({ from: acc(net, a, frac), fromSide: -1, to: acc(net, r, 0.8), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
        tr.request({ from: acc(net, a, frac), fromSide: 1, to: acc(net, l, 0.8), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
      }
      for (let t = 0; t < 120; t += 1 / 30) tr.step(1 / 30);
      expect(arrived, `starting at ${frac}`).toBe(6);
    }
  });
});
