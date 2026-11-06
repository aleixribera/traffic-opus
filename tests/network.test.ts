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

  it("treats a road extended round a corner as one road, not a junction", () => {
    for (const [deg, type, lanes] of [[25, "street", 2], [60, "avenue", 4], [90, "street", 2], [90, "one2", 2]] as const) {
      const net = new RoadNetwork();
      net.begin();
      const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(100, 0), 0);
      const r = (deg * Math.PI) / 180;
      const c = net.addNode(v2(100 + 100 * Math.cos(r), 100 * Math.sin(r)), 0);
      road(net, a, b, type); road(net, b, c, type);
      net.commit();
      net.rebuild();
      const g = net.nodeGeom.get(b)!;
      expect(g.kind, `${deg} ${type}`).toBe("bend");
      // lane i carries straight on to lane i, both ways; nothing to yield to
      expect(g.conns.length).toBe(lanes);
      for (const k of g.conns) { expect(k.turn).toBe("S"); expect(k.conflicts).toEqual([]); expect(k.from.idx).toBe(k.to.idx); }
      // a smooth corner: trimmed back from the node, drawn as road (centre line ends meet the lane ends)
      expect(g.curve!.lanes).toEqual(type === "one2" ? [2, 0] : [lanes / 2, lanes / 2]);
      for (const arm of g.arms) expect(arm.trim).toBeGreaterThan(1);
    }
  });

  it("keeps a lane-count change and a three-way join as junctions", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(100, 0), 0), c = net.addNode(v2(150, 60), 0), d = net.addNode(v2(200, 0), 0);
    road(net, a, b, "street"); road(net, b, c, "avenue");
    road(net, c, d, "avenue"); const e = net.addNode(v2(150, 160), 0); road(net, c, e, "avenue");
    net.commit();
    net.rebuild();
    expect(net.nodeGeom.get(b)!.kind).toBe("junction");
    expect(net.nodeGeom.get(c)!.kind).toBe("junction");
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
