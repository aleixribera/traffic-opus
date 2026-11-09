import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { Router, dkSeg } from "../src/sim/router";
import { Traffic } from "../src/sim/traffic";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import type { Access } from "../src/sim/router";

/**
 * Two ways from A (0,0) to B (1000,0): north through (500,-300) and south through (500,300), the same length. The
 * south way is a town's street when `town` is set, and as far out as `southY`.
 */
function twoWays(town?: number, southY = 300) {
  const net = new RoadNetwork();
  net.begin();
  const A0 = net.addNode(v2(-200, 0), 0), A = net.addNode(v2(0, 0), 0), N = net.addNode(v2(500, -300), 0), S = net.addNode(v2(500, southY), 0);
  const B = net.addNode(v2(1000, 0), 0), B1 = net.addNode(v2(1200, 0), 0);
  const seg = (a: number, b: number, t?: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p), 0, t);
  const start = seg(A0, A), end = seg(B, B1);
  const north = [seg(A, N), seg(N, B)];
  const south = [seg(A, S, town), seg(S, B, town)];
  net.commit();
  net.rebuild();
  const at = (s: number, f: number): Access => { const g = net.segGeom.get(s)!; return { seg: s, s: g.center.length * f, p: polyAt(g.center, g.center.length * f) }; };
  return { net, from: at(start, 0.5), to: at(end, 0.5), north, south };
}

const way = (keys: number[], w: ReturnType<typeof twoWays>) => (keys.some((k) => w.north.includes(dkSeg(k))) ? "north" : "south");

describe("route choice", () => {
  it("drivers spread over two ways about as good as each other, each the same way every time", () => {
    const w = twoWays();
    const r = new Router(w.net);
    // (without a driver: everyone the same way)
    const plain = new Set(Array.from({ length: 20 }, () => way(r.route(w.from, w.to, 1)!.keys, w)));
    expect(plain.size).toBe(1);
    const n = { north: 0, south: 0 };
    for (let salt = 0; salt < 200; salt++) n[way(r.route(w.from, w.to, 1, undefined, { salt, truck: false })!.keys, w)]++;
    expect(Math.min(n.north, n.south)).toBeGreaterThan(40);
    // a driver's habit: the same route every time
    const one = (salt: number) => way(r.route(w.from, w.to, 1, undefined, { salt, truck: false })!.keys, w);
    for (let salt = 0; salt < 20; salt++) expect(one(salt)).toBe(one(salt));
  });

  it("no driver takes a way much longer than the best", () => {
    // the south way a third longer: everyone goes north
    const w = twoWays(undefined, 600);
    const r = new Router(w.net);
    for (let salt = 0; salt < 200; salt++) expect(way(r.route(w.from, w.to, 1, undefined, { salt, truck: false })!.keys, w)).toBe("north");
  });

  it("trucks keep off a town's streets when there is another way", () => {
    const w = twoWays(1);
    const r = new Router(w.net);
    let cars = 0, trucks = 0;
    for (let salt = 0; salt < 200; salt++) {
      if (way(r.route(w.from, w.to, 1, undefined, { salt, truck: false })!.keys, w) === "south") cars++;
      if (way(r.route(w.from, w.to, 1, undefined, { salt, truck: true })!.keys, w) === "south") trucks++;
    }
    expect(cars).toBeGreaterThan(40);
    expect(trucks).toBe(0);
    // but a truck delivering on the town's street goes there
    const g = w.net.segGeom.get(w.south[1])!;
    const shop: Access = { seg: w.south[1], s: g.center.length / 2, p: polyAt(g.center, g.center.length / 2) };
    expect(r.route(w.from, shop, 1, undefined, { salt: 3, truck: true })).not.toBeNull();
  });

  it("drivers plan round a road that jams at this hour every day, before it jams today", () => {
    const w = twoWays();
    const tr = new Traffic(w.net, { arrive: () => {}, fail: () => {} });
    let hour = 8;
    tr.hourOf = () => hour;
    const flow = tr.flow;
    // yesterday at 8-9 the north way crawled at a fifth of its limit; the south way flowed
    const slow = (on: boolean) => {
      for (const s of w.north) for (const k of [s * 2, s * 2 + 1]) flow.set(k, { n: 5, ratio: on ? 0.2 : 1, speed: on ? 0.2 : 1, queue: 0 });
    };
    for (let i = 0; i < 40; i++) { slow(true); (tr as any).stats(); }
    // today: nobody on it yet (it flows), but at 8 they know
    slow(false);
    for (const s of w.north) for (const k of [s * 2, s * 2 + 1]) { flow.delete(k); tr.router.speeds.delete(k); }
    (tr as any).stats();
    const n = (h: number, t = tr) => {
      hour = h;
      (t as any).stats();
      let north = 0;
      for (let salt = 0; salt < 100; salt++) if (way(t.router.route(w.from, w.to, 1, undefined, { salt, truck: false })!.keys, w) === "north") north++;
      return north;
    };
    expect(n(8)).toBeLessThan(10);
    // at midday the north way is as good as ever
    expect(n(13)).toBeGreaterThan(20);
    // and a save keeps what the roads remember
    const back = new Traffic(w.net, { arrive: () => {}, fail: () => {} });
    back.hourOf = () => hour;
    back.loadUsual(JSON.parse(JSON.stringify(tr.usualJSON())));
    expect(n(8, back)).toBeLessThan(10);
    expect(n(13, back)).toBeGreaterThan(20);
  });
});
