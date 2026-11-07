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

describe("Cars that can't reach their destination any more", () => {
  it("don't park at the end of a dead-end one-way when they overshoot the driveway", () => {
    // a street leading onto a one-way that ends in a dead end: nothing can turn back once past a driveway
    const net = new RoadNetwork();
    net.begin();
    const A = net.addNode(v2(0, 0), 0), B = net.addNode(v2(200, 0), 0), C = net.addNode(v2(500, 0), 0);
    const s = road(net, A, B, "street"), o = road(net, B, C, "one1");
    net.commit();
    net.rebuild();
    let fails = 0;
    const tr = new Traffic(net, { arrive: () => {}, fail: () => { fails++; } });
    tr.request({ from: acc(net, s, 0.2), fromSide: 1, to: acc(net, o, 0.5), toSide: 1, trip: trip(), truck: true, tries: 0, wait: 0 });
    let v: Vehicle | undefined;
    for (let t = 0; t < 60 && !v; t += 1 / 30) {
      tr.step(1 / 30);
      v = (tr.vehicles as Vehicle[]).find((x) => x.edge.kind === "lane" && (x.edge as any).seg === o);
    }
    expect(v).toBeDefined();
    // it slips past its driveway (squeezed by traffic, a lane change, a road edit...)
    v!.s = acc(net, o, 0.7).s;
    v!.destS = -1;
    let maxStuck = 0;
    for (let t = 0; t < 60; t += 1 / 30) {
      tr.step(1 / 30);
      for (const x of tr.vehicles as Vehicle[]) maxStuck = Math.max(maxStuck, x.stuck);
    }
    expect(tr.vehicles.length).toBe(0);
    expect(maxStuck).toBeLessThan(3);
    expect(fails).toBe(1);
  });
});
