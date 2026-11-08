// The mid-game freight jam (balance run, ~day 15): what turned a busy haul into one that stalls and sheds its loads.
// - a site's gate right at a junction's mouth: trucks turning in across the queue stood with their tails in the box;
// - drivers giving up in a queue that crawls on (it isn't stuck: giving up only sends the load out again);
// - light trucks queued in a yard all counting their wait as "blocked driveway" while the one in front pulls out.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { add, dist, polyAt, scale, straightCubic, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { GATE_CLEAR, siteFrame } from "../src/game/sites";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import type { Access } from "../src/sim/router";
import { road } from "./helpers";

const acc = (net: RoadNetwork, seg: number, s: number): Access => {
  const g = net.segGeom.get(seg)!;
  return { seg, s, p: polyAt(g.center, s) };
};
const cargo = (from = 7): Trip => ({ kind: "cargo", from, to: 9, resident: -1, startT: 0, freeFlow: 0 });

function straight(len: number) {
  const net = new RoadNetwork();
  net.begin();
  const A = net.addNode(v2(0, 0), 0), B = net.addNode(v2(len, 0), 0);
  const s = net.addSeg(A, B, "street", straightCubic(net.nodes.get(A)!.p, net.nodes.get(B)!.p));
  net.commit();
  net.rebuild();
  return { net, s };
}

describe("drivers give up only when really stuck", () => {
  // a truck stands at a spot (dwell holds it there) and is moved on by hand: the car behind it queues
  function queue(creep: number) {
    const { net, s } = straight(800);
    const fails: string[] = [];
    const tr = new Traffic(net, { arrive: () => {}, fail: (_t, r) => { fails.push(r); } });
    tr.request({ from: acc(net, s, 300), fromSide: 1, to: acc(net, s, 780), toSide: 1, trip: cargo(1), truck: true, tries: 0, wait: 0 });
    for (let i = 0; i < 30 * 5; i++) tr.step(1 / 30);
    const head = (tr.vehicles as Vehicle[])[0];
    head.v = 0;
    head.dwell = 1e9;
    tr.request({ from: acc(net, s, 100), fromSide: 1, to: acc(net, s, 780), toSide: 1, trip: cargo(2), truck: true, tries: 0, wait: 0 });
    let t = 0;
    for (let k = 0; k < 30 * 400; k++) {
      tr.step(1 / 30);
      t += 1 / 30;
      // every 40 s the one in front rolls a truck length on (and stops again)
      if (creep && t >= 40) { t = 0; head.s += creep; }
    }
    const behind = (tr.vehicles as Vehicle[]).find((v) => v !== head);
    return { fails, behind };
  }

  it("not in a queue that crawls on a truck length every 40 s", () => {
    const { fails, behind } = queue(10);
    expect(fails).toEqual([]);
    expect(behind).toBeDefined();
    expect(behind!.stuck).toBeGreaterThan(150); // (it has stood more than it has moved: the stat still says so)
  });

  it("but still in one that doesn't move at all (a broken layout never freezes the city)", () => {
    const { fails, behind } = queue(0);
    expect(fails).toEqual(["gave up in traffic"]);
    expect(behind).toBeUndefined();
  });
});

describe("a yard of light trucks", () => {
  it("files out without any of them counted as a blocked driveway: they wait their turn behind each other", () => {
    const { net, s } = straight(1200);
    const fails: string[] = [];
    let arrived = 0;
    const tr = new Traffic(net, { arrive: () => { arrived++; }, fail: (_t, r) => { fails.push(r); } });
    // 50 loads called at once from one yard (light trucks: they don't need the gate to themselves)
    for (let i = 0; i < 50; i++) tr.request({ from: acc(net, s, 40), fromSide: 1, to: acc(net, s, 1150), toSide: 1, trip: cargo(), truck: true, tries: 0, wait: 0 });
    for (let k = 0; k < 30 * 400 && arrived < 50; k++) tr.step(1 / 30);
    expect(fails).toEqual([]);
    expect(arrived).toBe(50);
  });

  it("still counts a driveway that really is blocked", () => {
    const { net, s } = straight(400);
    const fails: string[] = [];
    const tr = new Traffic(net, { arrive: () => {}, fail: (_t, r) => { fails.push(r); } });
    // a truck parked across the kerb lane right at the gate
    tr.request({ from: acc(net, s, 50), fromSide: 1, to: acc(net, s, 390), toSide: 1, trip: cargo(1), truck: true, tries: 0, wait: 0 });
    for (let i = 0; i < 30 * 3; i++) tr.step(1 / 30);
    const plug = (tr.vehicles as Vehicle[])[0];
    plug.v = 0;
    plug.dwell = 1e9;
    for (let i = 0; i < 3; i++) tr.request({ from: acc(net, s, plug.s - 2), fromSide: 1, to: acc(net, s, 390), toSide: 1, trip: cargo(), truck: true, tries: 0, wait: 0 });
    for (let k = 0; k < 30 * 100; k++) tr.step(1 / 30);
    expect(fails[0]).toBe("blocked driveway");
  });
});

describe("a site's gate by a junction", () => {
  /** A food plant standing free, and points in front of its gate (o metres out, a along). */
  function site(g: Game) {
    for (let r = 400; r < 4000; r += 150) for (let k = 0; k < 24; k++) {
      const p = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
      if (!g.placedPlan("foodplant", p, { down: { x: 0, y: 1 } })?.ok) continue;
      const b = g.place("foodplant", p, { down: { x: 0, y: 1 } })!;
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      const out = scale(f.into, -1);
      const at = (o: number, a: number): V2 => add(add(f.gate, scale(out, o)), scale(f.along, a));
      return { b, at };
    }
    throw new Error("no open ground");
  }

  it("joins the road a road train's length clear of the junction's mouth", () => {
    const g = new Game(7);
    const { b, at } = site(g);
    // the road along the front, then a side street joining it right where the gate meets it
    road(g, at(8, -200), at(8, 200));
    expect(b.access).not.toBeNull();
    road(g, at(8, 0), at(160, 0));
    const node = [...g.net.nodes.values()].find((n) => dist(n.p, at(8, 0)) < 1)!;
    expect(node).toBeDefined();
    expect(g.net.segsAt([...g.net.nodes].find(([, n]) => n === node)![0]).length).toBe(3);
    // (the mouth is a few metres out from the node: the gate is at least GATE_CLEAR beyond that)
    expect(dist(b.access!.p, node.p)).toBeGreaterThan(GATE_CLEAR);
    expect(dist(b.front, node.p)).toBeGreaterThan(GATE_CLEAR);
    // and its kerb is still on the road in front of the plant
    expect(dist(b.front, at(8, 0))).toBeLessThan(BUILDING_TYPES.foodplant.w / 2 + GATE_CLEAR);
  });

  it("moves along when the road it is on becomes a junction's arm at its end (the road isn't split)", () => {
    const g = new Game(7);
    const { b, at } = site(g);
    // a road ending 12 m past the gate: a plain end, so the gate joins it right in front
    road(g, at(8, -200), at(8, 12));
    const s0 = b.access!.s;
    expect(dist(b.access!.p, at(8, 12))).toBeLessThan(GATE_CLEAR);
    // two roads on from its end: that end is a junction now
    road(g, at(8, 12), at(8, 200));
    road(g, at(8, 12), at(160, 12));
    expect(b.access).not.toBeNull();
    expect(b.access!.s).not.toBe(s0);
    expect(dist(b.access!.p, at(8, 12))).toBeGreaterThan(GATE_CLEAR);
    expect(dist(b.front, b.access!.p)).toBeLessThan(0.01);
  });

  it("is placed clear of the junction when it snaps to the road beside it", () => {
    const g = new Game(7);
    // (a free-standing one just to find open ground and its frame; the real one goes down on a fresh map)
    const { b, at } = site(g);
    const p = b.c;
    const g2 = new Game(7);
    road(g2, at(8, -200), at(8, 200));
    road(g2, at(8, 15), at(160, 15));
    expect(g2.placedPlan("foodplant", p)?.free).toBeFalsy(); // (it faces the road: snapped, not standing free)
    const s = g2.place("foodplant", p)!;
    expect(s).toBeTruthy();
    expect(s.access).not.toBeNull();
    expect(dist(s.access!.p, at(8, 15))).toBeGreaterThan(GATE_CLEAR);
  });
});
