import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { straightCubic, v2 } from "../src/core/math";

function road(net: RoadNetwork, a: number, b: number, type: any = "street") {
  const na = net.nodes.get(a)!, nb = net.nodes.get(b)!;
  return net.addSeg(a, b, type, straightCubic(na.p, nb.p));
}

describe("RoadNetwork", () => {
  it("builds a four-way junction with turning connectors", () => {
    const net = new RoadNetwork();
    net.begin();
    const c = net.addNode(v2(100, 100), 0);
    const e = net.addNode(v2(200, 100), 0), w = net.addNode(v2(0, 100), 0);
    const n = net.addNode(v2(100, 0), 0), s = net.addNode(v2(100, 200), 0);
    for (const x of [e, w, n, s]) road(net, c, x);
    net.commit();
    net.rebuild();
    const g = net.nodeGeom.get(c)!;
    expect(g.kind).toBe("junction");
    // 4 approaches x 3 exits each (single lane)
    expect(g.conns.length).toBe(12);
    const turns = g.conns.map((k) => k.turn).sort().join("");
    expect(turns).toBe("LLLLRRRRSSSS");
    // straight from west must conflict with straight from south
    const wsS = g.conns.find((k) => k.turn === "S" && net.segs.get(k.armIn)!.b === w)!;
    expect(wsS.conflicts.length).toBeGreaterThan(0);
    // trims leave room for the junction
    for (const arm of g.arms) expect(arm.trim).toBeGreaterThan(4);
  });

  it("treats a straight same-type join as a seamless continuation", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(50, 0), 0), c = net.addNode(v2(100, 0), 0);
    road(net, a, b); road(net, b, c);
    net.commit();
    net.rebuild();
    expect(net.nodeGeom.get(b)!.kind).toBe("cont");
    expect(net.nodeGeom.get(b)!.conns.length).toBe(2);
  });

  it("splits a segment and undoes the split", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(100, 0), 0);
    const s = road(net, a, b);
    net.commit();
    net.rebuild();
    net.begin();
    const mid = net.splitSeg(s, 0.5);
    const ops = net.commit();
    net.rebuild();
    expect(net.segs.size).toBe(2);
    expect(net.nodes.get(mid)!.p.x).toBeCloseTo(50, 3);
    net.undo(ops);
    net.rebuild();
    expect(net.segs.size).toBe(1);
    expect(net.nodes.has(mid)).toBe(false);
    expect(net.segs.has(s)).toBe(true);
  });

  it("gives a dead end a U-turn", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(100, 0), 0);
    road(net, a, b);
    net.commit();
    net.rebuild();
    const g = net.nodeGeom.get(b)!;
    expect(g.kind).toBe("end");
    expect(g.conns.some((k) => k.turn === "U")).toBe(true);
  });
});
