// The queue finder (src/sim/queues.ts) and what the Traffic window says of each queue (src/ui/queues.ts): standing
// traffic followed to the front of its queue and gathered at the junction that holds it, classed, and given the fix
// that works in this game. Lights never beat giving way at a junction that is merely busy (measured: see the
// finder's header), so a full junction is told to widen its roads, a side road waiting for gaps to take a roundabout,
// and lights are said only where they were shown to help: a works' gate street (tests/gatecures.test.ts) and a
// deadlock.

import { describe, expect, it } from "vitest";
import { straightCubic, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { Industry } from "../src/game/industry";
import type { Feature } from "../src/game/progression";
import { RoadNetwork, type Lane } from "../src/roads/network";
import { Traffic, stuckNow, type PendingSpawn, type Vehicle } from "../src/sim/traffic";
import { QUEUE_STAND, findQueues, type Queue } from "../src/sim/queues";
import { forgetQueues, holdAdvice, queueFix, roadQueueSay, type FixCtx } from "../src/ui/queues";
import { ADVICE_HOLD } from "../src/ui/bottleneck";
import type { RoadTypeId } from "../src/config";
import { acc, trip, world } from "./trafficWatch";

interface Arm { p: V2; rate: number; to: number[] }

/** Arms from far ends into a junction at (300, 300), all streets. */
function junction(arms: Arm[]) {
  const net = new RoadNetwork();
  net.begin();
  const C = net.addNode(v2(300, 300), 0);
  const ids = arms.map((a) => net.addSeg(net.addNode(a.p, 0), C, "street", straightCubic(a.p, v2(300, 300))));
  net.commit();
  net.rebuild();
  return { net, C, ids };
}

/**
 * Poisson demand into the junction from each arm (vehicles an hour), to the other arms by weight, a tenth trucks; for
 * up to T seconds, until `until` holds of the queues then on the road (checked each second).
 */
function drive(net: RoadNetwork, ids: number[], arms: Arm[], T: number, until: (qs: Queue[], tr: Traffic) => boolean): { tr: Traffic; qs: Queue[] } {
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const car = (from: number, to: number, truck: boolean): PendingSpawn => ({
    from: acc(net, from, 0.15), fromSide: 1, to: acc(net, to, 0.2), toSide: -1,
    trip: truck ? { ...trip(), haul: { plant: 0, leg: "out", product: "coal", n: 1, dest: 0, cls: "heavy" as never } } : trip(),
    truck, tries: 0, wait: 0, through: true, ...Industry.body(truck ? ("heavy" as never) : undefined),
  });
  const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
  const next = arms.map((a) => (rnd() * 3600) / a.rate);
  for (let t = 0; t < T; t += 1 / 30) {
    for (let a = 0; a < arms.length; a++) while (next[a] <= t) {
      const w = arms[a].to, tot = w.reduce((s, x) => s + x, 0);
      let r = rnd() * tot, b = 0;
      while (r > w[b]) { r -= w[b]; b++; }
      tr.request(car(ids[a], ids[b], rnd() < 0.1));
      next[a] += (-Math.log(1 - rnd()) * 3600) / arms[a].rate;
    }
    tr.step(1 / 30);
    if (Math.abs(t - Math.round(t)) < 1 / 60) {
      const qs = findQueues(tr.vehicles, net);
      if (until(qs, tr)) return { tr, qs };
    }
  }
  return { tr, qs: findQueues(tr.vehicles, net) };
}

/** What the fixes read of a game, over a bare road network: what is unlocked, and which roads are works' gates. */
function ctx(net: RoadNetwork, features: Feature[], gates: number[] = []): FixCtx & { time: number } {
  return {
    net, world, time: 0,
    roadsUnlocked: new Set<RoadTypeId>(["dirt", "street", "avenue", "one1", "one2", "streetM", "avenueM"]),
    featureUnlocked: (f) => features.includes(f),
    defaultSignal: (id) => Game.prototype.defaultSignal.call({ net } as unknown as Game, id),
    industry: { plants: () => gates.map((seg) => ({ access: { seg } })) },
  };
}

const ALL: Feature[] = ["roundabout", "signals"];

describe("a four-way of streets past what it can pass", () => {
  // every arm 1,100 vehicles an hour, to the other three alike
  const P = [v2(800, 300), v2(-200, 300), v2(300, -200), v2(300, 800)];
  const arms: Arm[] = P.map((p, i) => ({ p, rate: 1100, to: P.map((_, j) => (j === i ? 0 : 1)) }));
  const { net, C, ids } = junction(arms);
  // (run until two of its roads have three or more standing at the line, counted here, not by the finder; the
  // through road has priority, so most of the time only one road queues, which is giving way)
  const queued = (vs: readonly Vehicle[]) => {
    const per = new Map<number, number>();
    for (const v of vs) if (stuckNow(v, QUEUE_STAND) && v.edge.kind === "lane" && (v.edge as Lane).to === C) per.set((v.edge as Lane).seg, (per.get((v.edge as Lane).seg) ?? 0) + 1);
    return [...per.values()].filter((n) => n >= 3).length;
  };
  const { tr, qs } = drive(net, ids, arms, 600, (_, t) => queued(t.vehicles) >= 2);

  it("is one queue, held at the junction, with its approaches queued: a full junction", () => {
    expect(queued(tr.vehicles)).toBeGreaterThanOrEqual(2);
    const q = qs[0];
    expect(q.key).toBe(`node:${C}`);
    expect(q.node).toBe(C);
    expect(q.cause).toBe("full");
    expect(q.approaches.length).toBeGreaterThanOrEqual(2);
    // (it is where they stand: every standing vehicle is in a queue, most in this one, longest first, on the
    // junction's own roads)
    const standing = tr.vehicles.filter((v) => stuckNow(v, QUEUE_STAND));
    expect(qs.reduce((n, x) => n + x.vehicles.length, 0)).toBe(standing.length);
    expect(q.vehicles.length).toBeGreaterThanOrEqual(Math.max(6, standing.length * 0.8));
    for (const v of q.vehicles) expect(stuckNow(v, QUEUE_STAND)).toBe(true);
    for (let i = 1; i < q.vehicles.length; i++) expect(q.vehicles[i - 1].stuck).toBeGreaterThanOrEqual(q.vehicles[i].stuck);
    for (const s of q.segs) expect(ids).toContain(s);
    expect(q.worst).toBe(q.vehicles[0].stuck);
  });

  it("is told to widen its roads, never to put up lights", () => {
    const fix = queueFix(ctx(net, ALL), qs[0]);
    expect(fix).toBe("Widen its roads to Avenue");
    // (with nothing wider unlocked yet, and even with no roundabouts: still never lights)
    const narrow = { ...ctx(net, ALL), roadsUnlocked: new Set<RoadTypeId>(["street"]) };
    expect(queueFix(narrow, qs[0]) ?? "").not.toMatch(/light/i);
    expect(queueFix(ctx(net, ["signals"]), qs[0]) ?? "").not.toMatch(/light/i);
  });

  it("with lights up, is a queue at lights, told to widen too", () => {
    net.begin();
    net.setSignal(C, Game.prototype.defaultSignal.call({ net } as unknown as Game, C));
    net.commit();
    const lit = findQueues(tr.vehicles, net)[0];
    expect(lit.cause).toBe("lights");
    expect(queueFix(ctx(net, ALL), lit)).toBe("Widen its roads to Avenue");
    net.begin();
    net.setSignal(C, null);
    net.commit();
  });

  it("on roads already two lanes each way, is told to share the traffic with a second road", () => {
    net.begin();
    for (const s of ids) net.setType(s, "avenue");
    net.commit();
    net.rebuild();
    expect(queueFix(ctx(net, ALL), qs[0])).toBe("Build a second road to share the traffic");
    net.begin();
    for (const s of ids) net.setType(s, "street");
    net.commit();
    net.rebuild();
  });
});

describe("a side road waiting for gaps in a busy street", () => {
  // the street east-west at 1,200 an hour each way, mostly straight on; the side road from the south at 500, turning
  const arms: Arm[] = [
    { p: v2(800, 300), rate: 1200, to: [0, 6, 1] },
    { p: v2(-200, 300), rate: 1200, to: [6, 0, 1] },
    { p: v2(300, 800), rate: 500, to: [1, 1, 0] },
  ];
  const { net, C, ids } = junction(arms);
  const q = drive(net, ids, arms, 600, (qs) => (qs[0]?.vehicles.length ?? 0) >= 4).qs[0];

  it("is a queue on the side road alone, held at the junction: giving way", () => {
    expect(q).toBeDefined();
    expect(q.node).toBe(C);
    expect(q.cause).toBe("giveway");
    expect(q.approaches).toEqual([ids[2]]);
  });

  it("is told to build a Medium roundabout there (it fits), not lights", () => {
    expect(queueFix(ctx(net, ALL), q)).toBe("Build a Medium roundabout here");
  });

  it("whatever the money on hand: a roundabout that fits is said even when it can't be paid for this minute", () => {
    const j = junction(arms);
    expect(queueFix({ ...ctx(j.net, ALL), world: { ...world, money: () => 0 } }, q)).toBe("Build a Medium roundabout here");
  });

  it("before roundabouts are unlocked, is told to widen the road in; lights only for a works' gate street", () => {
    expect(queueFix(ctx(net, ["signals"]), q)).toBe("Widen the road in to Avenue");
    // (the side road is a works' gate street: the gate gets a green of its own, tests/gatecures.test.ts)
    expect(queueFix(ctx(net, ["signals"], [ids[2]]), q)).toBe("Add traffic lights here");
    // (and none before they are unlocked either)
    expect(queueFix(ctx(net, [], [ids[2]]), q)).toBe("Widen the road in to Avenue");
  });
});

describe("advice for the rest", () => {
  const three = () => junction([0, 1, 2].map((k) => ({ p: v2(300 + 500 * Math.cos(k * 2.1), 300 + 500 * Math.sin(k * 2.1)), rate: 1, to: [1, 1, 1] })));
  const { net, C, ids } = three();
  const base: Queue = { key: "x", cause: "road", seg: ids[0], at: v2(0, 0), vehicles: [], trucks: 0, worst: 0, segs: [ids[0]], approaches: [] };

  it("a full road is widened; a deadlock gets lights where it has none; gate and lane queues have no fix said", () => {
    expect(queueFix(ctx(net, ALL), base)).toBe("Widen it to Avenue");
    expect(queueFix(ctx(net, ALL), { ...base, cause: "deadlock", node: C, seg: undefined })).toBe("Add traffic lights here");
    expect(queueFix(ctx(net, ["roundabout"]), { ...base, cause: "deadlock", node: C, seg: undefined })).toBe("Build a second way round");
    for (const cause of ["gate", "turn", "lane", "other"] as const) expect(queueFix(ctx(net, ALL), { ...base, cause })).toBeNull();
  });

  it("a road the upgrade can't widen (a works in the way) is not told to widen", () => {
    const j = three();
    const c = { ...ctx(j.net, ALL), upgradePlan: () => ({ errors: [{ msg: "Food Plant in the way" }] }) };
    expect(queueFix(c, { ...base, seg: j.ids[0], segs: [j.ids[0]] })).toBeNull();
    // (but money short this minute is no reason)
    const k = three();
    const poor = { ...ctx(k.net, ALL), upgradePlan: () => ({ errors: [{ msg: "Not enough money" }] }) };
    expect(queueFix(poor, { ...base, seg: k.ids[0], segs: [k.ids[0]] })).toBe("Widen it to Avenue");
  });

  it("a deadlock at a roundabout is never told to put up lights", () => {
    const net = new RoadNetwork();
    net.begin();
    const C = net.addNode(v2(300, 300), 0);
    const ends = [v2(800, 300), v2(-200, 300), v2(300, 800)];
    const ids = ends.map((p, i) => net.addSeg(net.addNode(p, 0), C, i ? "street" : "one1", straightCubic(p, v2(300, 300)), i ? 0 : 1));
    net.commit();
    net.rebuild();
    expect(net.segs.get(ids[0])?.ring).toBeTruthy();
    expect(queueFix(ctx(net, ALL), { ...base, cause: "deadlock", node: C, seg: undefined, segs: ids })).toBe("Build a second way round");
  });

  it("on a road's panel, a queue a junction holds is said as that junction's", () => {
    const row = { key: "node:1", cause: "giveway", why: "Waiting for gaps in traffic", where: "", fix: "Build a Medium roundabout here", vehicles: 9, trucks: 0, worst: 30, at: v2(0, 0), node: 1, segs: [], ids: [] } as const;
    expect(roadQueueSay({ ...row, segs: [], ids: [] })).toBe("Waiting for gaps at a junction. Build a Medium roundabout there");
    expect(roadQueueSay({ ...row, segs: [], ids: [], cause: "road", why: "Road full", fix: "Widen it to Avenue", node: undefined, seg: 4 })).toBe("Road full. Widen it to Avenue");
  });
});

describe("a queue's advice holds", () => {
  const { net, C, ids } = junction([v2(800, 300), v2(-200, 300), v2(300, 800)].map((p) => ({ p, rate: 1, to: [1, 1, 1] })));
  const q = (cause: Queue["cause"]): Queue => ({ key: `node:${C}`, cause, node: C, at: v2(300, 300), vehicles: [], trucks: 0, worst: 0, segs: [ids[2]], approaches: cause === "giveway" ? [ids[2]] : [ids[0], ids[2]] });

  it("for ADVICE_HOLD game hours while the queue lasts, then changes", () => {
    const g = ctx(net, ALL);
    forgetQueues(g);
    expect(holdAdvice(g, q("giveway"))).toEqual({ cause: "giveway", fix: "Build a Medium roundabout here", act: { kind: "ring", node: C, size: 2 } });
    // (seen again and again, a second approach now queued too: still the first advice)
    for (let h = 0.1; h < ADVICE_HOLD; h += 0.1) {
      g.time = h * HOUR;
      expect(holdAdvice(g, q("full")).cause).toBe("giveway");
    }
    g.time = (ADVICE_HOLD + 0.05) * HOUR;
    expect(holdAdvice(g, q("full"))).toMatchObject({ cause: "full", fix: "Widen its roads to Avenue", act: { kind: "widen" } });
  });

  it("but not once the queue has cleared, or its junction is rebuilt", () => {
    const g = ctx(net, ALL);
    forgetQueues(g);
    holdAdvice(g, q("giveway"));
    // gone for a game hour: a new queue there gets its own advice at once
    g.time = 1 * HOUR;
    expect(holdAdvice(g, q("full")).cause).toBe("full");
    // lights put up: the junction is another one now
    g.time = 1.1 * HOUR;
    expect(holdAdvice(g, q("giveway")).cause).toBe("full");
    net.begin();
    net.setSignal(C, g.defaultSignal(C));
    net.commit();
    net.rebuild();
    g.time = 1.2 * HOUR;
    expect(holdAdvice(g, q("lights")).cause).toBe("lights");
  });
});
