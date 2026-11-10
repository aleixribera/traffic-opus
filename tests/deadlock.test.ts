// Deadlocks (review 2026-11-10, B1): a junction or a cluster of junctions locked in a circular wait, each car held
// by the next, so nothing moves until the jam breaker forces a car through, and the queues behind grow without end.
// A jam the player can fix is the game; a lock the player did not build, and that never clears, is a bug.

import { describe, expect, it } from "vitest";
import { straightCubic, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { planRoad, snap } from "../src/roads/planner";
import { RoadNetwork } from "../src/roads/network";
import { SIGNAL_COST } from "../src/config";
import { deadlockAt } from "../src/ui/inspect";
import { Traffic, type PendingSpawn, type Vehicle } from "../src/sim/traffic";
import { DT, acc, trip } from "./trafficWatch";

/** A seeded random stream (the same cars every run). */
function rng(seed: number) {
  return () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
}

/**
 * A plain four-way C whose west exit runs 60 m into lights M: every red the exit lane fills back to C, and the
 * cars from the east (straight on) and from the north and south (turning) all stand at C waiting for room on it.
 * `rate` cars/h from each of the three arms, all bound west past M: under what the lights can pass.
 */
function exitFills(rate: number, T = 900) {
  const net = new RoadNetwork();
  net.begin();
  const P = (x: number, y: number) => net.addNode(v2(x, y), 0);
  const C = P(300, 300), M = P(240, 300);
  const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  const east = mk(P(700, 300), C), north = mk(P(300, -100), C), south = mk(P(300, 700), C);
  const link = mk(C, M), west = mk(M, P(-300, 300)), mn = mk(M, P(240, 0)), ms = mk(M, P(240, 600));
  net.setSignal(M, { phases: [{ arms: [link, west] }, { arms: [mn, ms] }] });
  net.commit();
  net.rebuild();
  const rnd = rng(777);
  let done = 0, maxWait = 0, cycleT = 0;
  const tr = new Traffic(net, { arrive: () => { done++; }, fail: () => {} });
  const arms = [east, north, south];
  const next = arms.map(() => (rnd() * 3600) / rate);
  let asked = 0;
  const car = (from: number): PendingSpawn => ({ from: acc(net, from, 0.15), fromSide: 1, to: acc(net, west, 0.8), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
  for (let t = 0; t < T; t += DT) {
    for (let a = 0; a < arms.length; a++) while (next[a] <= t) {
      tr.request(car(arms[a]));
      asked++;
      next[a] += (-Math.log(1 - rnd()) * 3600) / rate;
    }
    tr.step(DT);
    for (const v of tr.vehicles as Vehicle[]) maxWait = Math.max(maxWait, v.wait);
    if (tr.waitCycles(5).length) cycleT += DT;
  }
  return { done, asked, maxWait, cycleT, jamBreaks: tr.jamBreaks };
}

describe("a junction where straight and turning traffic wait for room on the same exit lane", () => {
  it("never locks in a circular wait: whoever holds the claim on the exit goes when it opens", () => {
    const r = exitFills(200);
    expect(r.cycleT).toBe(0);
    expect(r.jamBreaks).toBe(0);
    expect(r.maxWait).toBeLessThan(90);
    expect(r.done).toBeGreaterThan(r.asked * 0.8);
  }, 120000);
});

/**
 * Two crossings `d` apart along a street (A west, B east; at 22 m the piece of street between their boxes is under
 * 7 m, a car and a bit), each with a street across it, and lights 60 m beyond each on the main street so the ways
 * out fill every red. `rate` cars/h from each of the six ends to any other.
 */
function twoClose(d: number, rate: number, T = 1500) {
  const net = new RoadNetwork();
  net.begin();
  const P = (x: number, y: number) => net.addNode(v2(x, y), 0);
  const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  const A = P(300, 300), B = P(300 + d, 300), W = P(240, 300), E = P(360 + d, 300);
  const link = mk(A, B), an = mk(P(300, -100), A), as = mk(P(300, 700), A), bn = mk(P(300 + d, -100), B), bs = mk(P(300 + d, 700), B);
  const wl = mk(W, A), el = mk(B, E), wf = mk(W, P(-300, 300)), ef = mk(E, P(900 + d, 300));
  net.setSignal(W, { phases: [{ arms: [wl, wf] }, { arms: [mk(W, P(240, 0)), mk(W, P(240, 600))] }] });
  net.setSignal(E, { phases: [{ arms: [el, ef] }, { arms: [mk(E, P(360 + d, 0)), mk(E, P(360 + d, 600))] }] });
  net.commit();
  net.rebuild();
  const rnd = rng(4242);
  let done = 0, maxWait = 0, cycleT = 0, asked = 0, step = 0;
  const tr = new Traffic(net, { arrive: () => { done++; }, fail: () => {} });
  const ends = [an, as, bn, bs, wf, ef];
  const next = ends.map(() => (rnd() * 3600) / rate);
  for (let t = 0; t < T; t += DT) {
    for (let a = 0; a < ends.length; a++) while (next[a] <= t) {
      let k = Math.floor(rnd() * ends.length);
      if (k === a) k = (k + 1) % ends.length;
      const far = ends[a] === wf || ends[a] === ef;
      tr.request({ from: acc(net, ends[a], far ? 0.95 : 0.15), fromSide: far ? -1 : 1, to: acc(net, ends[k], 0.5), toSide: 1, trip: trip(), truck: rnd() < 0.2, tries: 0, wait: 0, through: true } as PendingSpawn);
      asked++;
      next[a] += (-Math.log(1 - rnd()) * 3600) / rate;
    }
    tr.step(DT);
    // (looked at twice a second: the scenario is long)
    if (++step % 15) continue;
    for (const v of tr.vehicles as Vehicle[]) maxWait = Math.max(maxWait, v.wait);
    if (tr.waitCycles(5).length) cycleT += 15 * DT;
  }
  return { close: net.closeLink(link), done, asked, maxWait, cycleT, jamBreaks: tr.jamBreaks };
}

describe("junctions closer than a couple of car lengths work as one", () => {
  it("a car goes into the short link between them only with room on its way out beyond the far one", () => {
    // (without the look-through: 85 s of circular waits)
    const r = twoClose(22, 240);
    expect(r.close).toBe(true);
    expect(r.cycleT).toBeLessThan(3); // (a moment of one, while the waits change hands)
    expect(r.jamBreaks).toBe(0);
    expect(r.maxWait).toBeLessThan(90);
    expect(r.done).toBeGreaterThan(r.asked * 0.9);
  }, 120000);

  it("lights on one of them cover both, on one clock, the road along the link going first at each", () => {
    const g = new Game(7);
    g.unlockAll();
    g.money = 1e7;
    const lay = (a: V2, b: V2) => {
      const sn = (p: V2) => {
        const s = snap(g.net, p, { mpp: 0.5, level: 0, type: "street" });
        return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
      };
      expect(g.build(planRoad(g.net, g.world, { start: sn(a), end: sn(b), mode: "straight", type: "street" }))).toBe(true);
    };
    lay(v2(0, 0), v2(300, 0));
    lay(v2(120, -120), v2(120, 120));
    lay(v2(142, -120), v2(142, 120));
    const near = (x: number) => [...g.net.nodes.values()].find((n) => Math.hypot(n.p.x - x, n.p.y) < 1)!.id;
    const A = near(120), B = near(142);
    expect(g.net.clusterOf(A)).toEqual([A, B].sort((a, b) => a - b));
    const money = g.money;
    expect(g.setSignal(A, g.defaultSignal(A))).toBe(true);
    expect(g.money).toBe(money - 2 * SIGNAL_COST);
    for (const n of [A, B]) {
      const sig = g.net.nodes.get(n)!.signal!;
      expect(sig.phases[0].arms.some((x) => g.net.closeLink(x))).toBe(true);
    }
    // whatever each clock was doing, they run as one from the next step on
    const tr = g.traffic;
    const link = g.net.nodeGeom.get(A)!.arms.find((a) => g.net.closeLink(a.seg))!.seg;
    tr.signalState(B, link);
    (tr as unknown as { sigCtl: Map<number, { i: number; t: number }> }).sigCtl.get(B)!.i = 1;
    for (let t = 0; t < 200; t += DT) {
      tr.step(DT);
      expect(tr.signalState(B, link)).toBe(tr.signalState(A, link));
    }
    // and taking them away takes both
    expect(g.setSignal(B, null)).toBe(true);
    expect(g.net.nodes.get(A)!.signal).toBeNull();
  });

  it("a town never lays a street that would make a junction that close to another", () => {
    // (both close pairs in the late save were a town's street run onto a player's road a few metres from a crossing)
    const g = new Game(7);
    g.money = 1e7;
    const sn = (p: V2) => {
      const s = snap(g.net, p, { mpp: 0.5, level: 0, type: "street" });
      return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
    };
    const plan = (a: V2, b: V2) => planRoad(g.net, g.world, { start: sn(a), end: sn(b), mode: "straight", type: "street" });
    expect(g.build(plan(v2(0, 0), v2(300, 0)))).toBe(true);
    expect(g.build(plan(v2(120, -120), v2(120, 120)))).toBe(true);
    // a street from the south ending on the main street 20 m from the crossing: no; 60 m along: yes
    expect(g.towns.closeJunctions(plan(v2(140, 120), v2(140, 0)))).toBe(true);
    expect(g.towns.closeJunctions(plan(v2(180, 120), v2(180, 0)))).toBe(false);
    // nor across another road 20 m from it, nor onto a crossing itself (that junction is there already)
    expect(g.towns.closeJunctions(plan(v2(140, 120), v2(140, -120)))).toBe(true);
    expect(g.towns.closeJunctions(plan(v2(240, 120), v2(120, 0)))).toBe(false);
  });
});

/**
 * Gridlock round a block: four street crossings `L` m apart in a square, two roads out from each corner, and from
 * each of those `rate` cars/h to the far side of the square, two sides of it along. Far more than it can carry:
 * the sides fill, the car at the head of each waits for room on the next side, and the ring locks.
 */
function gridlock(L: number, rate: number, release: boolean, T = 1200) {
  const net = new RoadNetwork();
  net.begin();
  const P = (x: number, y: number) => net.addNode(v2(x, y), 0);
  const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  const c = [P(300, 300), P(300 + L, 300), P(300 + L, 300 + L), P(300, 300 + L)];
  for (let i = 0; i < 4; i++) mk(c[i], c[(i + 1) % 4]);
  const out = [
    [mk(P(0, 300), c[0]), mk(P(300, 0), c[0])], [mk(P(300 + L, 0), c[1]), mk(P(600 + L, 300), c[1])],
    [mk(P(600 + L, 300 + L), c[2]), mk(P(300 + L, 600 + L), c[2])], [mk(P(300, 600 + L), c[3]), mk(P(0, 300 + L), c[3])],
  ];
  net.commit();
  net.rebuild();
  const rnd = rng(99);
  let cycleT = 0, step = 0;
  const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
  if (!release) (tr as unknown as { releaseCycles: () => void }).releaseCycles = () => {};
  const srcs = out.flat();
  const next = srcs.map(() => (rnd() * 3600) / rate);
  for (let t = 0; t < T; t += DT) {
    for (let a = 0; a < srcs.length; a++) while (next[a] <= t) {
      const to = out[((a >> 1) + 2) % 4][a & 1];
      tr.request({ from: acc(net, srcs[a], 0.3), fromSide: 1, to: acc(net, to, 0.5), toSide: -1, trip: trip(), truck: rnd() < 0.2, tries: 0, wait: 0, through: true } as PendingSpawn);
      next[a] += (-Math.log(1 - rnd()) * 3600) / rate;
    }
    tr.step(DT);
    if (++step % 15 === 0 && tr.waitCycles(10).length) cycleT += 15 * DT;
  }
  return { cycleT, quits: tr.jamQuits, releases: tr.cycleReleases };
}

describe("a circular wait that has stood a long time", () => {
  it("lets one car out of it by another way (its trip runs late), so fewer drivers give up; rarely", () => {
    // (a jam this heavy is the player's to fix: the release only keeps it from freezing solid. Measured: circular
    // waits 218 -> 139 s, drivers giving up 10 -> 0, 8 cars let out by another way in 20 minutes)
    const off = gridlock(80, 300, false), on = gridlock(80, 300, true);
    expect(off.cycleT).toBeGreaterThan(60); // (the scenario does lock)
    expect(on.releases).toBeGreaterThan(0);
    expect(on.releases).toBeLessThan(30);
    expect(on.cycleT).toBeLessThan(off.cycleT);
    expect(on.quits).toBeLessThanOrEqual(off.quits);
  }, 300000);
});

describe("the Traffic stuck panel", () => {
  it("names a ring of vehicles waiting on each other a deadlock, and offers lights on the junction where it forms", () => {
    const g = new Game(7);
    g.unlockAll();
    g.money = 1e7;
    const sn = (p: V2) => {
      const s = snap(g.net, p, { mpp: 0.5, level: 0, type: "street" });
      return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
    };
    const lay = (a: V2, b: V2) => expect(g.build(planRoad(g.net, g.world, { start: sn(a), end: sn(b), mode: "straight", type: "street" }))).toBe(true);
    lay(v2(0, 0), v2(300, 0));
    lay(v2(120, -120), v2(120, 120));
    lay(v2(142, -120), v2(142, 120));
    const A = [...g.net.nodes.values()].find((n) => Math.hypot(n.p.x - 120, n.p.y) < 1)!.id;
    // three cars at A, each held by the next, standing a minute (as Traffic.waitCycles finds them)
    const ring = [0, 1, 2].map((i) => ({ id: -1 - i, x: 120, y: i * 3, v: 0, stuck: 60, edge: { kind: "lane" }, next: { node: A } }) as unknown as Vehicle);
    ring.forEach((v, i) => { v.waitOn = ring[(i + 1) % 3]; });
    (g.traffic.vehicles as Vehicle[]).push(...ring);
    try {
      const d = deadlockAt(g, ring)!;
      expect(d.text).toMatch(/^Deadlock: 3 vehicles each waiting/);
      // (the crossing 22 m along is so close it works as one with A: lights on both)
      expect(d.act).toMatchObject({ kind: "lights", node: A, cost: 2 * SIGNAL_COST });
      expect(d.fix).toContain("work as one");
      expect(d.text + d.fix + d.act!.label).not.toMatch(/[—–]/); // (no dashes in the player's words)
      // (the fake cars off the road while it changes: they have no real lanes to carry over)
      const vs = g.traffic.vehicles as Vehicle[];
      vs.splice(vs.length - 3, 3);
      expect(g.setSignal(d.act!.node, g.defaultSignal(d.act!.node))).toBe(true);
      vs.push(...ring);
      // lit already: no button, the advice moves on
      const lit = deadlockAt(g, ring)!;
      expect(lit.act).toBeUndefined();
      expect(lit.fix).toMatch(/roundabout/);
      // nor is a queue that merely stands a deadlock
      ring[2].waitOn = null;
      expect(deadlockAt(g, ring)).toBeNull();
    } finally {
      const vs = g.traffic.vehicles as Vehicle[];
      vs.splice(vs.length - 3, 3);
    }
  });
});
