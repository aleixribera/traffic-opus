import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip } from "../src/sim/traffic";
import { straightCubic, v2, polyAt, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "street") {
  const na = net.nodes.get(a)!, nb = net.nodes.get(b)!;
  return net.addSeg(a, b, type, straightCubic(na.p, nb.p));
}

function access(net: RoadNetwork, seg: number, frac: number, side: 1 | -1): { a: Access; side: 1 | -1 } {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  const p = polyAt(g.center, s);
  // kerb point: offset to the side of the a->b direction
  const d = { x: g.center.pts[g.center.pts.length - 1].x - g.center.pts[0].x, y: g.center.pts[g.center.pts.length - 1].y - g.center.pts[0].y };
  const L = Math.hypot(d.x, d.y);
  const r: V2 = { x: -d.y / L, y: d.x / L };
  return { a: { seg, s, p: { x: p.x + r.x * side * (g.width / 2), y: p.y + r.y * side * (g.width / 2) } }, side };
}

function run(net: RoadNetwork, trips: [ReturnType<typeof access>, ReturnType<typeof access>][], seconds: number, signal = false) {
  let arrived = 0, failed = 0;
  const reasons: string[] = [];
  const tr = new Traffic(net, {
    arrive: () => { arrived++; },
    fail: (_t, r) => { failed++; reasons.push(r); },
  });
  void signal;
  const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
  let i = 0;
  const dt = 1 / 30;
  for (let t = 0; t < seconds; t += dt) {
    // stagger requests
    if (i < trips.length && t > i * 0.7) {
      const [f, to] = trips[i++];
      tr.request({ from: f.a, fromSide: f.side, to: to.a, toSide: to.side, trip: trip(), truck: i % 5 === 0, tries: 0, wait: 0 });
    }
    tr.step(dt);
  }
  return { arrived, failed, reasons, left: tr.vehicles.length + tr.pending.length };
}

describe("Traffic", () => {
  it("moves cars through a busy four-way junction without gridlock", () => {
    const net = new RoadNetwork();
    net.begin();
    const c = net.addNode(v2(300, 300), 0);
    const ends = [v2(500, 300), v2(100, 300), v2(300, 100), v2(300, 500)].map((p) => net.addNode(p, 0));
    const segs = ends.map((e) => road(net, e, c));
    net.commit();
    net.rebuild();
    const trips: [ReturnType<typeof access>, ReturnType<typeof access>][] = [];
    for (let k = 0; k < 60; k++) {
      const a = segs[k % 4], b = segs[(k * 3 + 1 + (k >> 2)) % 4];
      if (a === b) continue;
      trips.push([access(net, a, 0.3, k % 2 ? 1 : -1), access(net, b, 0.35, k % 3 ? 1 : -1)]);
    }
    const r = run(net, trips, 260);
    expect(r.failed, JSON.stringify(r.reasons)).toBe(0);
    expect(r.arrived).toBe(trips.length);
  });

  it("drives round a bend in the road without stopping", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(100, 300), 0), b = net.addNode(v2(300, 300), 0), c = net.addNode(v2(300, 500), 0);
    const s1 = road(net, a, b), s2 = road(net, b, c);
    net.commit();
    net.rebuild();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    const f = access(net, s1, 0.2, 1), to = access(net, s2, 0.8, 1);
    tr.request({ from: f.a, fromSide: f.side, to: to.a, toSide: to.side, trip: { kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 }, truck: false, tries: 0, wait: 0 });
    let minV = Infinity, sawBend = false, done = false, drove = false;
    for (let t = 0; t < 60 && !done; t += 1 / 30) {
      tr.step(1 / 30);
      const v = tr.vehicles[0];
      if (!v) { done = drove; continue; } // (it rolls out of its lot first)
      drove = true;
      if (v.edge.kind === "conn") sawBend = true;
      if (t > 3 && (v.edge.kind === "conn" || (v.edge as any).seg === s2 && v.s < 20)) minV = Math.min(minV, v.v);
    }
    expect(sawBend).toBe(true);
    expect(done).toBe(true);
    expect(minV).toBeGreaterThan(3); // slows for the corner, never stops at it
  });

  it("handles a signalised avenue crossing", () => {
    const net = new RoadNetwork();
    net.begin();
    const c = net.addNode(v2(300, 300), 0);
    const ends = [v2(560, 300), v2(40, 300), v2(300, 40), v2(300, 560)].map((p) => net.addNode(p, 0));
    const segs = ends.map((e) => road(net, e, c, "avenue"));
    net.setSignal(c, { phases: [{ arms: [segs[0], segs[1]], dur: 14 }, { arms: [segs[2], segs[3]], dur: 14 }] });
    net.commit();
    net.rebuild();
    const trips: [ReturnType<typeof access>, ReturnType<typeof access>][] = [];
    for (let k = 0; k < 80; k++) {
      const a = segs[k % 4], b = segs[(k + 1 + (k % 3)) % 4];
      trips.push([access(net, a, 0.25, 1), access(net, b, 0.4, k % 2 ? 1 : -1)]);
    }
    const r = run(net, trips, 320);
    expect(r.failed).toBe(0);
    expect(r.arrived).toBe(trips.length);
  });

  it("keeps vehicles when a road they are on is split by a new junction", () => {
    const net = new RoadNetwork();
    net.begin();
    const a = net.addNode(v2(0, 0), 0), b = net.addNode(v2(600, 0), 0);
    const s = road(net, a, b);
    net.commit();
    net.rebuild();
    let arrived = 0, failed = 0;
    const tr = new Traffic(net, { arrive: () => arrived++, fail: () => failed++ });
    const from = access(net, s, 0.05, 1), to = access(net, s, 0.95, 1);
    tr.request({ from: from.a, fromSide: from.side, to: to.a, toSide: to.side, trip: { kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 }, truck: false, tries: 0, wait: 0 });
    for (let t = 0; t < 10; t += 1 / 30) tr.step(1 / 30);
    expect(tr.vehicles.length).toBe(1);
    // build a side road joining the middle
    net.begin();
    const mid = net.splitSeg(s, 0.5);
    const side = net.addNode(v2(300, 200), 0);
    road(net, mid, side);
    net.commit();
    tr.onNetworkChange(net.rebuild());
    expect(tr.vehicles.length).toBe(1);
    for (let t = 0; t < 80; t += 1 / 30) tr.step(1 / 30);
    expect(failed).toBe(0);
    expect(arrived).toBe(1);
  });
});
