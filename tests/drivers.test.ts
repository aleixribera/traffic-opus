import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { DRIVERS, Traffic, driver, type Vehicle } from "../src/sim/traffic";
import { straightCubic, v2 } from "../src/core/math";
import { DT, acc, trip } from "./trafficWatch";

/**
 * A long street with a truck in front and cars behind it: they catch it up and follow at the gap each driver keeps.
 * Returns the gaps (m, bumper to bumper) along the platoon once it has settled.
 */
function platoon() {
  const net = new RoadNetwork();
  net.begin();
  const a = net.addNode(v2(0, 300), 0), b = net.addNode(v2(6000, 300), 0);
  const seg = net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  net.commit();
  net.rebuild();
  const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
  const go = (truck: boolean) => tr.request({ from: acc(net, seg, 0.01), fromSide: 1, to: acc(net, seg, 0.99), toSide: 1, trip: trip(), truck, tries: 0, wait: 0, through: true });
  go(true);
  for (let t = 0; t < 300; t += DT) {
    if (Math.abs(t - Math.round(t / 4) * 4) < DT / 2 && t > 1 && t < 50) go(false);
    tr.step(DT);
  }
  const vs = (tr.vehicles as Vehicle[]).slice().sort((p, q) => q.x - p.x);
  const gaps: number[] = [];
  for (let i = 1; i < vs.length; i++) gaps.push(vs[i - 1].x - vs[i - 1].len / 2 - (vs[i].x + vs[i].len / 2));
  return { n: vs.length, speed: vs[vs.length - 1].v, lead: vs[0].v, gaps };
}

const stats = (g: number[]) => {
  const mean = g.reduce((a, b) => a + b, 0) / g.length;
  return { mean, sd: Math.sqrt(g.reduce((a, b) => a + (b - mean) ** 2, 0) / g.length) };
};

describe("drivers differ", () => {
  it("each car has its own driver, from its id: most near the middle, a few brisk or calm", () => {
    const d = Array.from({ length: 4000 }, (_, i) => driver(i));
    expect(d.every((x) => x >= -1 && x <= 1)).toBe(true);
    expect(driver(17)).toBe(driver(17));
    const mean = d.reduce((a, b) => a + b, 0) / d.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(d.filter((x) => Math.abs(x) < 0.5).length / d.length).toBeGreaterThan(0.7);
    expect(d.filter((x) => Math.abs(x) > 0.7).length).toBeGreaterThan(100);
  });

  it("cars following each other keep their own gaps, not one spacing like a train, and on average the usual one", () => {
    const saved = { ...DRIVERS };
    let same: ReturnType<typeof platoon>;
    try {
      DRIVERS.gap = 0; DRIVERS.accept = 0; DRIVERS.launch = 0;
      same = platoon();
    } finally {
      Object.assign(DRIVERS, saved);
    }
    const mixed = platoon();
    const a = stats(same.gaps.slice(1)), b = stats(mixed.gaps.slice(1));
    expect(mixed.n).toBe(same.n);
    expect(b.sd).toBeGreaterThan(a.sd + 0.2);
    expect(Math.abs(b.mean - a.mean) / a.mean).toBeLessThan(0.05);
  });
});
