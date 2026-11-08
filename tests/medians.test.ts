import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip } from "../src/sim/traffic";
import { Router, dkey, type Access } from "../src/sim/router";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import { ROAD_TYPES, roadWidth, type RoadTypeId } from "../src/config";

/** A divided road along +x from 0 to 600 with a street crossing it at x = 300. */
function divided(type: RoadTypeId = "avenueM") {
  const net = new RoadNetwork();
  net.begin();
  const A = net.addNode(v2(0, 0), 0), X = net.addNode(v2(300, 0), 0), B = net.addNode(v2(600, 0), 0);
  const N = net.addNode(v2(300, -200), 0), S = net.addNode(v2(300, 200), 0);
  const w = net.addSeg(A, X, type, straightCubic(v2(0, 0), v2(300, 0)));
  const e = net.addSeg(X, B, type, straightCubic(v2(300, 0), v2(600, 0)));
  net.addSeg(N, X, "street", straightCubic(v2(300, -200), v2(300, 0)));
  net.addSeg(X, S, "street", straightCubic(v2(300, 0), v2(300, 200)));
  net.commit();
  net.rebuild();
  return { net, A, X, B, w, e };
}

const acc = (net: RoadNetwork, seg: number, frac: number, side: 1 | -1): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s), side };
};

describe("Roads with a median", () => {
  it("is wider by the median and keeps the lanes either side of it", () => {
    const { net, e } = divided();
    const T = ROAD_TYPES.avenueM;
    expect(roadWidth(T)).toBeCloseTo(4 * 3.5 + 1.4 + 3.5, 5);
    const lanes = net.segGeom.get(e)!.lanes;
    const offs = lanes.map((l) => l.offset).sort((a, b) => a - b);
    // inner lanes start half a median out from the centre line
    expect(offs).toEqual([-7, -3.5, 3.5, 7].map((x) => expect.closeTo(x, 5)));
  });

  it("only reaches a building from its own side, and offers U-turns at junctions", () => {
    const { net, X, w, e } = divided();
    // U-turn back onto the divided road at the crossing (not just at dead ends)
    const conns = net.nodeGeom.get(X)!.conns;
    expect(conns.some((c) => c.turn === "U" && c.from.seg === w && c.to.seg === w)).toBe(true);
    expect(conns.some((c) => c.turn === "U" && c.from.seg === e && c.to.seg === e)).toBe(true);
    // no U-turn on the plain street
    expect(conns.some((c) => c.turn === "U" && net.segs.get(c.from.seg)!.type === "street")).toBe(false);
    const r = new Router(net);
    // building on the left (north, side -1) of the east piece, starting from the right-hand carriageway further west
    const route = r.route(acc(net, w, 0.3, 1), acc(net, e, 0.5, -1), 1)!;
    expect(route).not.toBeNull();
    // it must end on the westbound carriageway (dir -1), not stop across the median
    expect(route.keys[route.keys.length - 1]).toBe(dkey(e, -1));
  });

  it.each(["avenueM", "boulevard"] as const)("drives cars between buildings on both sides of a %s without turning across it", (type) => {
    const { net, w, e } = divided(type);
    let arrived = 0, failed = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => { failed++; } });
    const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
    const pairs: [Access, Access][] = [
      [acc(net, w, 0.2, 1), acc(net, w, 0.7, -1)],
      [acc(net, w, 0.6, -1), acc(net, e, 0.4, 1)],
      [acc(net, e, 0.5, 1), acc(net, e, 0.2, -1)],
      [acc(net, e, 0.8, -1), acc(net, w, 0.5, 1)],
    ];
    let i = 0;
    const N = 16;
    let crossedMedian = false;
    for (let t = 0; t < 300; t += 1 / 30) {
      if (i < N && t > i * 2) {
        const [f, to] = pairs[i % pairs.length];
        i++;
        tr.request({ from: f, fromSide: f.side!, to, toSide: to.side!, trip: trip(), truck: false, tries: 0, wait: 0 });
      }
      tr.step(1 / 30);
      for (const v of tr.vehicles) if (v.crossing) crossedMedian = true;
    }
    expect(crossedMedian).toBe(false);
    expect(failed).toBe(0);
    expect(arrived).toBe(N);
  });
});
