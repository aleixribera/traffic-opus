// Busy junctions and pull-outs (owner, 2026-11-08: "fix traffic into roundabouts and also in intersections", and
// "a truck getting blocked because another one just got out of a building but is now interrupting the road").
// - a small roundabout under steady demand: cars going round once filled it to a standstill (each waiting for the
//   next), and its throughput fell as demand rose. Entries now give way to traffic going round, come on only into
//   a real gap, and hold back once the ring is as full as flows best;
// - a plain four-way past its capacity: it fell over (fewer through at 900 cars/arm/h than at 700) as cars gave way
//   to others that were turning off elsewhere;
// - long trucks pulling out of lots across a queued street: they stood across both lanes with cars driving through
//   them, and a tail still swung across a lane let the queue there close up on it.

import { describe, expect, it } from "vitest";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import { RoadNetwork } from "../src/roads/network";
import { ALL_RED, AMBER, GREEN, Traffic, type PendingSpawn, type Trip, type Vehicle } from "../src/sim/traffic";
import { Industry } from "../src/game/industry";
import type { Access } from "../src/sim/router";
import { DT, Watch, acc, net4, trip } from "./trafficWatch";

// Poisson demand from each arm to the other three, a tenth of it heavy trucks (net4's arms run away from the middle)
function bench(ring: 0 | 1 | 2, rate: number, T = 600) {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const { net, arms } = net4(ring);
  const out = (seg: number) => { const s = net.segs.get(seg)!; const a = net.nodes.get(s.a)!.p, b = net.nodes.get(s.b)!.p; return Math.hypot(b.x - 300, b.y - 300) > Math.hypot(a.x - 300, a.y - 300); };
  const car = (from: number, to: number, truck: boolean): PendingSpawn => ({
    from: acc(net, from, out(from) ? 0.8 : 0.2), fromSide: out(from) ? -1 : 1, to: acc(net, to, out(to) ? 0.7 : 0.3), toSide: out(to) ? 1 : -1,
    trip: truck ? { ...trip(), haul: { plant: 0, leg: "out", product: "coal", n: 1, dest: 0, cls: "heavy" as any } } : trip(),
    truck, tries: 0, wait: 0, through: true, ...Industry.body(truck ? ("heavy" as any) : undefined),
  });
  let done = 0, maxWait = 0;
  const tr = new Traffic(net, { arrive: () => { done++; }, fail: () => {} });
  const next = arms.map(() => (rnd() * 3600) / rate);
  for (let t = 0; t < T; t += DT) {
    for (let a = 0; a < 4; a++) while (next[a] <= t) {
      let b = (rnd() * 3) | 0;
      if (b >= a) b++;
      tr.request(car(arms[a], arms[b], rnd() < 0.1));
      next[a] += (-Math.log(1 - rnd()) * 3600) / rate;
    }
    tr.step(DT);
    for (const v of tr.vehicles as Vehicle[]) maxWait = Math.max(maxWait, v.wait);
  }
  return { done, maxWait, jamBreaks: tr.jamBreaks };
}

describe("busy junctions", () => {
  it("a small roundabout at 500 cars/arm/h never fills to a standstill", () => {
    const r = bench(1, 500);
    expect(r.maxWait).toBeLessThan(60); // (it was 150: a ring locked solid, cars giving up)
    expect(r.done).toBeGreaterThan(250); // of ~325 asked for (it was 183)
    expect(r.jamBreaks).toBe(0);
  }, 60000);

  it("a plain four-way past its capacity levels off instead of falling over", () => {
    const at700 = bench(0, 700), at900 = bench(0, 900);
    expect(at900.done).toBeGreaterThanOrEqual(at700.done * 0.95); // (it was 281 against 302)
    expect(at900.maxWait).toBeLessThan(60);
    expect(at900.jamBreaks).toBe(0);
  }, 60000);
});

describe("long trucks pulling out across a queued street", () => {
  it("only go when there is room for their whole length, and nobody drives through them", () => {
    // a street between two sets of lights, cars both ways every ~6 s, a heavy truck out of one of four lots every 3 s
    // (the lights give the empty cross streets their turn too, so the street stands queued for every red)
    const net = new RoadNetwork();
    net.begin();
    const L = net.addNode(v2(0, 300), 0), R = net.addNode(v2(500, 300), 0);
    const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
    const mid = mk(L, R);
    const ends: number[] = [];
    for (const [n, ps] of [[L, [v2(-300, 300), v2(0, 0), v2(0, 600)]], [R, [v2(800, 300), v2(500, 0), v2(500, 600)]]] as const) {
      const arms = ps.map((p) => mk(net.addNode(p, 0), n));
      ends.push(...arms);
      net.setSignal(n, { phases: [{ arms: [mid, arms[0]] }, { arms: [arms[1], arms[2]] }] });
    }
    net.commit();
    net.rebuild();
    const at = (seg: number, frac: number): Access => { const g = net.segGeom.get(seg)!; const s = g.center.length * frac; return { seg, s, p: polyAt(g.center, s) }; };
    const cargo = (from: number): Trip => ({ kind: "cargo", from, to: 9, resident: -1, startT: 0, freeFlow: 0 });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
    let arrived = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: () => {} });
    const w = new Watch(net, tr);
    let nE = 0, nW = 0, nT = 0, worst = 0;
    const lots = [0.3, 0.45, 0.6, 0.75];
    for (let t = 0; t < 360; t += DT) {
      if (t >= nE) { nE += 6 * (0.5 + rnd()); tr.request({ from: at(ends[0], 0.1), fromSide: 1, to: at(ends[3], 0.15), toSide: 1, trip: cargo(3), truck: false, tries: 0, wait: 0, through: true }); }
      if (t >= nW) { nW += 6 * (0.5 + rnd()); tr.request({ from: at(ends[3], 0.1), fromSide: 1, to: at(ends[0], 0.15), toSide: 1, trip: cargo(4), truck: false, tries: 0, wait: 0, through: true }); }
      if (t >= nT) {
        nT += 3;
        const f = lots[(rnd() * lots.length) | 0], side = rnd() < 0.5 ? 1 : -1, east = rnd() < 0.5;
        tr.request({ from: at(mid, f), fromSide: side as 1 | -1, to: at(east ? ends[3] : ends[0], 0.2), toSide: 1, trip: cargo(10 + ((f * 100) | 0) + side), truck: true, tries: 0, wait: 0, ...Industry.body("heavy" as any) });
      }
      w.step();
      for (const v of tr.vehicles as Vehicle[]) worst = Math.max(worst, v.wait);
    }
    expect(w.clips).toBe(0); // (it was hundreds of frames of trucks and cars driving through each other)
    // (nobody stands for good: at worst a round of the lights and a red, the street ahead full the first time)
    expect(worst).toBeLessThan(3 * (GREEN + AMBER + ALL_RED));
    expect(arrived).toBeGreaterThan(60);
    expect(tr.jamBreaks).toBe(0);
  }, 60000);
});
