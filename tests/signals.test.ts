import { describe, it, expect } from "vitest";
import { RoadNetwork, type Connector, type SignalPhase } from "../src/roads/network";
import { ALL_RED, AMBER, GREEN, LEFT_GREEN, Traffic, type Trip } from "../src/sim/traffic";
import { straightCubic, v2, polyAt, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "avenue") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}

function access(net: RoadNetwork, seg: number, frac: number, side: 1 | -1): { a: Access; side: 1 | -1 } {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  const p = polyAt(g.center, s);
  const q0 = g.center.pts[0], q1 = g.center.pts[g.center.pts.length - 1];
  const L = Math.hypot(q1.x - q0.x, q1.y - q0.y);
  const r: V2 = { x: -(q1.y - q0.y) / L, y: (q1.x - q0.x) / L };
  return { a: { seg, s, p: { x: p.x + r.x * side * (g.width / 2), y: p.y + r.y * side * (g.width / 2) } }, side };
}

/** A crossing with lights (avenues, unless `type` says): east-west in one phase, north-south in the other. */
function crossing(type: RoadTypeId = "avenue") {
  const net = new RoadNetwork();
  net.begin();
  const c = net.addNode(v2(300, 300), 0);
  const [e, w, n, s] = [v2(700, 300), v2(-100, 300), v2(300, -100), v2(300, 700)].map((p) => road(net, net.addNode(p, 0), c, type));
  net.setSignal(c, { phases: [{ arms: [e, w] }, { arms: [n, s] }] });
  net.commit();
  net.rebuild();
  return { net, c, e, w, n, s };
}

const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });

/**
 * Sends cars along `flows` ([from arm, to arm, seconds between cars]) for `T` seconds, and reports how many
 * arrived (in all, and per flow) and the longest any one car stood still, per flow.
 */
function drive(flows: [number, number, number][], T: number, phases?: SignalPhase[], type?: RoadTypeId) {
  const k = crossing(type);
  if (phases) {
    k.net.begin();
    k.net.setSignal(k.c, { phases });
    k.net.commit();
    k.net.rebuild();
  }
  let arrived = 0, closest = Infinity;
  const per = flows.map(() => 0);
  const tr = new Traffic(k.net, { arrive: (v) => { arrived++; per[(v.trip as { flow?: number }).flow!]++; }, fail: () => {} });
  const longest = flows.map(() => 0);
  const next = flows.map(() => 0);
  const dt = 1 / 30;
  for (let t = 0; t < T; t += dt) {
    flows.forEach(([a, b, every], i) => {
      if (t < next[i]) return;
      next[i] += every;
      const tp = Object.assign(trip(), { flow: i });
      tr.request({ from: access(k.net, a, 0.15, 1).a, fromSide: 1, to: access(k.net, b, 0.6, -1).a, toSide: -1, trip: tp, truck: false, tries: 0, wait: 0 });
    });
    tr.step(dt);
    for (const v of tr.vehicles) {
      const i = (v.trip as { flow?: number }).flow;
      if (i !== undefined) longest[i] = Math.max(longest[i], v.wait);
    }
    // how close two cars on different paths through the junction get
    const inBox = tr.vehicles.filter((v) => v.edge.kind === "conn");
    for (let a = 0; a < inBox.length; a++) for (let b = a + 1; b < inBox.length; b++) {
      const ea = inBox[a].edge as Connector, eb = inBox[b].edge as Connector;
      if (ea === eb || ea.to === eb.to) continue; // (one behind the other)
      closest = Math.min(closest, Math.hypot(inBox[a].x - inBox[b].x, inBox[a].y - inBox[b].y));
    }
  }
  return { arrived, per, longest, closest };
}

describe("Traffic lights on a fixed clock", () => {
  it("give every phase the same long green, then amber and all red, whatever the traffic does", () => {
    // (owner, 2026-11-08: "keep lights dumb, they don't read traffic ... 24 seconds for each is enough")
    const k = crossing();
    k.net.begin();
    k.net.setSignal(k.c, { phases: [{ arms: [k.e, k.w], left: true }, { arms: [k.e, k.w], dur: 6 }, { arms: [k.n, k.s], dur: 60 }] });
    k.net.commit();
    k.net.rebuild();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    // a busy east-west road and an empty cross street: neither stretches nor cuts a green
    let next = 0;
    const seen: [string, string, string][] = [];
    for (let t = 0; t < 200; t += 1 / 30) {
      if (t >= next) { next += 2; tr.request({ from: access(k.net, k.e, 0.15, 1).a, fromSide: 1, to: access(k.net, k.w, 0.6, -1).a, toSide: -1, trip: trip(), truck: false, tries: 0, wait: 0 }); }
      tr.step(1 / 30);
      const st: [string, string, string] = [tr.signalState(k.c, k.e, "L"), tr.signalState(k.c, k.e, "S"), tr.signalState(k.c, k.n, "S")];
      if (!seen.length || seen[seen.length - 1].join() !== st.join()) seen.push(st);
      (seen[seen.length - 1] as unknown as { t?: number }).t ??= t;
    }
    const times = seen.map((x) => (x as unknown as { t: number }).t);
    const lasts = times.slice(1).map((t, i) => [seen[i].join(), t - times[i]] as const).slice(1);
    const green = (key: string) => lasts.filter(([k]) => k === key).map(([, d]) => d);
    // the road's green, the cross street's green and the left arrow: each its fixed time, every round
    for (const d of green("green,green,red")) expect(d).toBeCloseTo(GREEN, 0);
    for (const d of green("red,red,green")) expect(d).toBeCloseTo(GREEN, 0);
    for (const d of green("green,red,red")) expect(d).toBeCloseTo(LEFT_GREEN, 0);
    expect(green("red,red,green").length).toBeGreaterThanOrEqual(2);
    // and between greens, amber then all red
    expect(seen.some((x) => x.join() === "red,red,yellow")).toBe(true);
    for (const d of green("red,red,red")) expect(d).toBeCloseTo(ALL_RED, 0);
    void AMBER;
  });

  it("a busy road's queue goes through on one green, and the cross street gets its turn every round", () => {
    const k = crossing();
    const r = drive([[k.e, k.w, 2.2], [k.w, k.e, 2.6], [k.n, k.s, 30]], 240);
    // (at worst a red and the amber either side of it: nobody waits through a second one)
    const red = GREEN + 2 * (AMBER + ALL_RED);
    expect(r.longest[2]).toBeLessThan(red + 4);
    expect(Math.max(r.longest[0], r.longest[1])).toBeLessThan(red + 4);
    expect(r.arrived).toBeGreaterThan(150);
  });

  it("turns right on red when nothing is coming, after a stop", () => {
    const k = crossing();
    // north-south traffic keeps the green; cars from the east turn right (north) across nobody's path
    const r = drive([[k.n, k.s, 3], [k.s, k.n, 60], [k.e, k.n, 9]], 200);
    // (waiting for the light would take ~9 s here)
    expect(r.longest[2]).toBeLessThan(4);
  });

  it("a right turn on red gives way to the traffic it merges with", () => {
    const k = crossing();
    // northbound traffic on its green goes into the lanes the right-turners want
    const r = drive([[k.s, k.n, 2.5], [k.n, k.s, 3], [k.e, k.n, 6]], 240);
    expect(r.closest).toBeGreaterThan(2.2);
    expect(r.arrived).toBeGreaterThan(120);
  });

  it("a left turn facing a steady stream on a one-lane street goes at the change of the lights", () => {
    // (a town's main crossing, 2026-11-08: a left turn stood at the line round after round, the queue behind it
    // backed up through the roundabout before)
    const k = crossing("street");
    const r = drive([[k.e, k.w, 3], [k.w, k.n, 15], [k.n, k.s, 20]], 300, undefined, "street");
    console.log("left turns facing a stream: through", r.per[1], "longest wait", r.longest[1].toFixed(1));
    expect(r.per[1]).toBeGreaterThanOrEqual(8); // (5 before, the worst of them standing 76 s)
    expect(r.longest[1]).toBeLessThan(2 * (GREEN + AMBER + ALL_RED) + 3);
    expect(r.closest).toBeGreaterThan(2.2);
  });

  it("editing the plan doesn't snap a changing light back to green; changing what goes does it via all red", () => {
    const k = crossing();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    expect(tr.signalState(k.c, k.e)).toBe("green");
    const ctl = (tr as unknown as { sigCtl: Map<number, { i: number; st: number; t: number }> }).sigCtl.get(k.c)!;
    ctl.st = 1; // yellow for east-west
    const edit = (dur: number, arms: number[]) => {
      k.net.begin();
      k.net.setSignal(k.c, { phases: [{ arms, dur }, { arms: [k.n, k.s], dur: 14 }] });
      k.net.commit();
      k.net.rebuild();
    };
    edit(20, [k.e, k.w]);
    tr.step(1 / 30);
    expect(tr.signalState(k.c, k.e)).toBe("yellow");
    ctl.st = 0;
    edit(20, [k.e]); // the west arm no longer goes in this phase
    expect(tr.signalState(k.c, k.e)).toBe("red");
    expect(ctl.st).toBe(2);
  });

  it("a left-turn phase lets left turns through that would wait for a gap in heavy oncoming traffic", () => {
    const k = crossing();
    // eastbound (from the west arm) turning left goes north
    const l = k.net.nodeGeom.get(k.c)!.conns.find((c) => c.armIn === k.w && c.turn === "L")!;
    expect(l.to.seg).toBe(k.n);
    const flows: [number, number, number][] = [[k.e, k.w, 2.2], [k.w, k.e, 2.6], [k.w, k.n, 6], [k.n, k.s, 9]];
    const plain = drive(flows, 300);
    // (the arrow after the road's green, as the junction's own plan has it: by then the cars going straight on
    // ahead of a left turn in its lane have gone, and it waits at the line for the arrow)
    const withLeft = drive(flows, 300, [{ arms: [k.e, k.w] }, { arms: [k.e, k.w], left: true }, { arms: [k.n, k.s] }]);
    console.log("left turn: through", plain.per[2], "->", withLeft.per[2], "longest wait", plain.longest[2].toFixed(1), "->", withLeft.longest[2].toFixed(1), "arrived", plain.arrived, "->", withLeft.arrived);
    expect(withLeft.longest[2]).toBeLessThan(plain.longest[2] * 0.7);
    expect(withLeft.per[2]).toBeGreaterThan(plain.per[2]);
    expect(withLeft.arrived).toBeGreaterThanOrEqual(plain.arrived * 0.95);
    expect(withLeft.closest).toBeGreaterThan(2.2);
  });

  it("never turns green for a phase that lets nobody go", () => {
    const k = crossing();
    k.net.begin();
    k.net.setSignal(k.c, { phases: [{ arms: [k.e, k.w], dur: 14 }, { arms: [], dur: 10 }, { arms: [k.n, k.s], dur: 14 }] });
    k.net.commit();
    k.net.rebuild();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    tr.signalState(k.c, k.e);
    const ctl = (tr as unknown as { sigCtl: Map<number, { i: number; st: number; t: number }> }).sigCtl.get(k.c)!;
    // east-west ends: on to north-south, past the empty phase
    ctl.st = 2; ctl.t = 0;
    for (let t = 0; t < 2; t += 1 / 30) tr.step(1 / 30);
    expect(ctl.i).toBe(2);
    expect(ctl.st).toBe(0);
  });
});

describe("lights in a town", () => {
  it("never lock up: a car held at its driveway by the queue for the red drives on and comes back round", async () => {
    const { Game } = await import("../src/game/city");
    const { HOUR } = await import("../src/game/society");
    // Alder Run grown to a village on seed 7, lights at its centre crossing: before, a car turning in across the
    // queue for the red stood at its driveway for good, its lane and the junction behind it locked (2026-11-08)
    const g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e8;
    const t = g.towns.list[0];
    t.target = 400;
    const stock = () => { for (const b of g.shops) b.stock = Math.max(b.stock, 8); };
    for (let i = 0; i < 14 * HOUR * 30; i++) { g.step(1 / 30); if (i % 600 === 0) t.target = Math.max(t.target, 400); stock(); }
    const c = [...g.net.nodes.values()].sort((a, b) => Math.hypot(a.p.x - t.c.x, a.p.y - t.c.y) - Math.hypot(b.p.x - t.c.x, b.p.y - t.c.y))[0];
    const arms = [...g.net.segs.values()].filter((s) => s.a === c.id || s.b === c.id);
    expect(arms.length).toBe(4);
    const ew = arms.filter((s) => { const o = g.net.nodes.get(s.a === c.id ? s.b : s.a)!; return Math.abs(o.p.x - c.p.x) > Math.abs(o.p.y - c.p.y); }).map((s) => s.id);
    g.setSignal(c.id, { phases: [{ arms: ew }, { arms: arms.map((s) => s.id).filter((i) => !ew.includes(i)) }] });
    let worst = 0;
    for (let i = 0; i < 40 * HOUR * 30; i++) {
      g.step(1 / 30);
      stock();
      if (i % 30 === 0) for (const v of g.traffic.vehicles) if (v.v < 0.5) worst = Math.max(worst, v.wait);
    }
    // (a round of the lights, at most: no one waits through round after round)
    expect(worst).toBeLessThan(2 * (GREEN + AMBER + ALL_RED) + 3);
  }, 120000);
});
