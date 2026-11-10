// Deadlocks (review 2026-11-10, B1): a junction or a cluster of junctions locked in a circular wait, each car held
// by the next, so nothing moves until the jam breaker forces a car through, and the queues behind grow without end.
// A jam the player can fix is the game; a lock the player did not build, and that never clears, is a bug.

import { describe, expect, it } from "vitest";
import { straightCubic, v2 } from "../src/core/math";
import { RoadNetwork } from "../src/roads/network";
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
    for (const rate of [100, 150, 200, 250]) console.log(rate, JSON.stringify(exitFills(rate, 1200)));
    const r = exitFills(200);
    expect(r.cycleT).toBe(0);
    expect(r.jamBreaks).toBe(0);
    expect(r.maxWait).toBeLessThan(90);
    expect(r.done).toBeGreaterThan(r.asked * 0.8);
  }, 120000);
});
