// The jam breaker (owner, 2026-11-08: "let infinite traffic jams get a bit fixed into non infinite ones"). The
// give-way rules are meant never to lock; these tests lock them on purpose (every junction says "no" to everyone)
// and check the last resort: after JAM_BREAK s the longest waiter is let in anyway, and where even that can't help
// (something physically in the way) only the car at the front of the frozen queue gives up, fading off the road.

import { describe, expect, it } from "vitest";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import { RoadNetwork } from "../src/roads/network";
import { GIVE_UP, JAM_BREAK, Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import type { Access } from "../src/sim/router";

const trip = (from: number): Trip => ({ kind: "cargo", from, to: 9, resident: -1, startT: 0, freeFlow: 0 });

/** A street through a junction (with a side road, so it is a real one), and a queue of cars heading through it. */
function locked(block: "yield" | "crossing") {
  const net = new RoadNetwork();
  net.begin();
  const A = net.addNode(v2(0, 0), 0), B = net.addNode(v2(300, 0), 0), C = net.addNode(v2(600, 0), 0), D = net.addNode(v2(300, 300), 0);
  const mk = (a: number, b: number) => net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
  const ab = mk(A, B), bc = mk(B, C);
  mk(B, D);
  net.commit();
  net.rebuild();
  const acc = (seg: number, s: number): Access => { const g = net.segGeom.get(seg)!; return { seg, s, p: polyAt(g.center, s) }; };
  const fails: string[] = [];
  let arrived = 0;
  const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: (_t, r) => { fails.push(r); } });
  // the rules lock: nobody may ever go into the junction
  const T = tr as any;
  T.canEnter = (v: Vehicle) => { v.block = block; return false; };
  for (let i = 0; i < 5; i++) tr.request({ from: acc(ab, 40 + i * 30), fromSide: 1, to: acc(bc, 250), toSide: 1, trip: trip(i), truck: false, tries: 0, wait: 0, through: true });
  return { tr, fails, arrived: () => arrived };
}

describe("the jam breaker", () => {
  it("lets the longest waiter through a junction locked solid, after JAM_BREAK s and not before", () => {
    const { tr, fails, arrived } = locked("yield");
    const crossed = () => (tr.vehicles as Vehicle[]).filter((v) => v.x > 305).length + arrived();
    let firstAt = -1;
    for (let k = 0; k < 30 * 400 && arrived() < 5; k++) {
      tr.step(1 / 30);
      if (firstAt < 0 && crossed() > 0) firstAt = tr.time;
    }
    // the first car is let in once it has stood JAM_BREAK s (it got to the line within half a minute)
    expect(firstAt).toBeGreaterThan(JAM_BREAK);
    expect(firstAt).toBeLessThan(JAM_BREAK + 40);
    // and the rest follow, one at a time (each after a pause), with nobody giving up
    expect(arrived()).toBe(5);
    expect(fails).toEqual([]);
    expect(tr.jamBreaks).toBe(5);
    expect(tr.jamQuits).toBe(0);
  });

  it("where nobody can be let in, only the front car gives up, and it fades off the road", () => {
    const { tr, fails } = locked("crossing");
    let fading = 0;
    for (let k = 0; k < 30 * (GIVE_UP + 20); k++) {
      tr.step(1 / 30);
      for (const v of tr.vehicles as Vehicle[]) if (v.quit !== undefined && v.fade < 1 && v.fade > 0) fading++;
    }
    expect(tr.jamBreaks).toBe(0);
    expect(fails).toEqual(["gave up in traffic"]);
    expect(tr.vehicles.length).toBe(4); // the four behind it are still there, moving up
    expect(fading).toBeGreaterThan(3); // (drawn shrinking away for a few frames, not just gone)
  });
});
