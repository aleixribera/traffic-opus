import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { ROAD_TYPES, SIDEWALK, roadGroup, roadWidth } from "../src/config";
import { dist, straightCubic, v2, type V2 } from "../src/core/math";

/** A turning bulb's circle: its centre and radius (the poly is a ring of points round it). */
function bulb(net: RoadNetwork, nid: number): { c: V2; r: number } {
  const poly = net.nodeGeom.get(nid)!.poly!;
  const c = { x: poly.reduce((a, p) => a + p.x, 0) / poly.length, y: poly.reduce((a, p) => a + p.y, 0) / poly.length };
  return { c, r: dist(c, poly[0]) };
}

const HALF = roadWidth(ROAD_TYPES.street) / 2;
const WALK = SIDEWALK[roadGroup(ROAD_TYPES.street)];

function street(net: RoadNetwork, a: V2, b: V2) {
  const na = net.addNode(a, 0), nb = net.addNode(b, 0);
  net.addSeg(na, nb, "street", straightCubic(a, b));
  return { na, nb };
}

describe("turning bulbs", () => {
  it("a lone dead end gets the full turning circle", () => {
    const net = new RoadNetwork();
    net.begin();
    const { nb } = street(net, v2(0, 0), v2(100, 0));
    net.commit();
    net.rebuild();
    expect(bulb(net, nb).r).toBeCloseTo(HALF + 2.2, 1);
  });

  it("twin dead ends 12 m apart keep their circles and pavements apart, and grow back when the twin goes", () => {
    const net = new RoadNetwork();
    net.begin();
    const one = street(net, v2(0, 0), v2(100, 0));
    net.commit();
    net.rebuild();
    // the twin comes later: the first road's end must make room too, though nothing at it changed
    net.begin();
    const two = street(net, v2(0, 12), v2(100, 12));
    net.commit();
    const ch = net.rebuild();
    expect(ch.dirtyNodes.has(one.nb)).toBe(true);
    const A = bulb(net, one.nb), B = bulb(net, two.nb);
    expect(A.r + WALK + B.r + WALK).toBeLessThanOrEqual(dist(A.c, B.c) + 1e-6);
    expect(A.r).toBeGreaterThanOrEqual(HALF - 1e-6);
    // the twin goes: the circle comes back
    net.begin();
    for (const s of net.segsAt(two.nb)) net.removeSeg(s.id);
    net.commit();
    net.rebuild();
    expect(bulb(net, one.nb).r).toBeCloseTo(HALF + 2.2, 1);
  });

  it("a dead end short of a road across it doesn't reach over that road's pavement", () => {
    const net = new RoadNetwork();
    net.begin();
    const { nb } = street(net, v2(0, 0), v2(100, 0));
    street(net, v2(112, -60), v2(112, 60));
    net.commit();
    net.rebuild();
    const A = bulb(net, nb);
    expect(A.r).toBeLessThan(HALF + 2.2);
    expect(112 - HALF - WALK - (A.c.x + A.r + WALK)).toBeGreaterThanOrEqual(-1e-6);
  });

  it("however tight, the circle still holds the cars' U-turn", () => {
    const net = new RoadNetwork();
    net.begin();
    const { nb } = street(net, v2(0, 0), v2(100, 0));
    street(net, v2(106, -60), v2(106, 60));
    net.commit();
    net.rebuild();
    const A = bulb(net, nb);
    const u = net.nodeGeom.get(nb)!.conns.find((c) => c.turn === "U")!;
    const reach = Math.max(...u.pl.pts.map((p) => p.x));
    expect(reach).toBeGreaterThan(100);
    expect(A.c.x + A.r).toBeGreaterThanOrEqual(reach);
  });

  it("an avenue's dead end on a road of short pieces keeps its full circle: its own road isn't beside it", () => {
    const net = new RoadNetwork();
    net.begin();
    const L = net.addNode(v2(-100, 0), 0), K = net.addNode(v2(8, 0), 0), J = net.addNode(v2(15, 0), 0), E = net.addNode(v2(25, 0), 0);
    net.addSeg(L, K, "avenue", straightCubic(v2(-100, 0), v2(8, 0)));
    net.addSeg(K, J, "avenue", straightCubic(v2(8, 0), v2(15, 0)));
    net.addSeg(J, E, "avenue", straightCubic(v2(15, 0), v2(25, 0)));
    net.commit();
    net.rebuild();
    expect(bulb(net, E).r).toBeCloseTo(roadWidth(ROAD_TYPES.avenue) / 2 + 2.2, 1);
  });

  it("a short street off a road keeps its full circle: the road it comes from isn't beside it", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, -60), 0), x = net.addNode(v2(0, 0), 0), b = net.addNode(v2(0, 60), 0);
    net.addSeg(a, x, "street", straightCubic(v2(0, -60), v2(0, 0)));
    net.addSeg(x, b, "street", straightCubic(v2(0, 0), v2(0, 60)));
    const e = net.addNode(v2(14, 0), 0);
    net.addSeg(x, e, "street", straightCubic(v2(0, 0), v2(14, 0)));
    net.commit();
    net.rebuild();
    expect(bulb(net, e).r).toBeCloseTo(HALF + 2.2, 1);
  });

  it("a road passing over on a bridge leaves the circle alone", () => {
    const net = new RoadNetwork();
    net.begin();
    const { nb } = street(net, v2(0, 0), v2(100, 0));
    const a = net.addNode(v2(104, -60), 12), b = net.addNode(v2(104, 60), 12);
    net.addSeg(a, b, "street", straightCubic(v2(104, -60), v2(104, 60)));
    net.commit();
    net.rebuild();
    expect(bulb(net, nb).r).toBeCloseTo(HALF + 2.2, 1);
  });
});
