import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { RoadNetwork } from "../src/roads/network";
import { planRoad, snap } from "../src/roads/planner";
import { Traffic, type Trip } from "../src/sim/traffic";
import { straightCubic, v2, polyAt, type V2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function lay(g: Game, a: V2, b: V2, type: RoadTypeId) {
  const sn = (p: V2) => {
    const s = snap(g.net, p, { mpp: 0.5, level: 0, type });
    return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] };
  };
  const plan = planRoad(g.net, g.world, { start: sn(a), end: sn(b), mode: "straight", type });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

/** The junction nearest p. */
const nodeNear = (g: Game, p: V2) => [...g.net.nodes.values()].sort((a, b) => Math.hypot(a.p.x - p.x, a.p.y - p.y) - Math.hypot(b.p.x - p.x, b.p.y - p.y))[0];

describe("Traffic lights where bigger roads meet (CS2)", () => {
  const game = () => {
    const g = new Game(7);
    g.milestone = 2; // lights unlocked
    g.money = 1e7;
    return g;
  };

  it("two avenues crossing get lights by themselves; undo takes the crossing and its lights away", () => {
    const g = game();
    lay(g, v2(0, 0), v2(240, 0), "avenue");
    lay(g, v2(120, -120), v2(120, 120), "avenue");
    const x = nodeNear(g, v2(120, 0));
    expect(g.net.nodeGeom.get(x.id)!.arms.length).toBe(4);
    // each avenue: a left-turn phase, then the rest of its traffic
    expect(x.signal?.phases.map((p) => !!p.left)).toEqual([true, false, true, false]);
    g.undo();
    expect([...g.net.nodes.values()].some((n) => n.signal)).toBe(false);
  });

  it("an avenue meeting a street doesn't; nor do lights the player took away come back", () => {
    const g = game();
    lay(g, v2(0, 0), v2(240, 0), "avenue");
    lay(g, v2(120, 0), v2(120, 120), "street");
    expect(nodeNear(g, v2(120, 0)).signal).toBeNull();
    // an avenue T into an avenue: three big arms
    lay(g, v2(60, 0), v2(60, -120), "avenue");
    const t = nodeNear(g, v2(60, 0));
    expect(t.signal).not.toBeNull();
    expect(g.setSignal(t.id, null)).toBe(true);
    // a road added to that junction later leaves it without lights
    lay(g, v2(60, 0), v2(60, 120), "street");
    expect(nodeNear(g, v2(60, 0)).signal).toBeNull();
  });

  it("a crossing left without lights doesn't get them when a road joins one of its avenues further along", () => {
    const g = game();
    const lock = g as unknown as { featureUnlocked: (f: string) => boolean };
    const real = lock.featureUnlocked.bind(g);
    lock.featureUnlocked = () => false;
    lay(g, v2(0, 0), v2(240, 0), "avenue");
    lay(g, v2(120, -120), v2(120, 120), "avenue");
    lock.featureUnlocked = real;
    const x = nodeNear(g, v2(120, 0));
    expect(x.signal).toBeNull();
    // a street teed into the east arm splits that avenue; the crossing's own roads still go the same ways
    lay(g, v2(200, 0), v2(200, 80), "street");
    expect(g.net.nodes.get(x.id)!.signal).toBeNull();
    // but an avenue added to the crossing itself is a change, and it gets lights
    lay(g, v2(120, 0), v2(40, -80), "avenue");
    expect(g.net.nodes.get(x.id)!.signal).not.toBeNull();
  });

  it("a road added to a junction with lights gets its green, with the road across from it", () => {
    const g = game();
    lay(g, v2(0, 0), v2(240, 0), "avenue");
    lay(g, v2(120, 0), v2(120, -120), "avenue");
    const t = nodeNear(g, v2(120, 0));
    expect(t.signal).not.toBeNull();
    lay(g, v2(120, 0), v2(120, 120), "street");
    const ng = g.net.nodeGeom.get(t.id)!;
    const south = ng.arms.find((a) => a.dir.y > 0.9)!.seg, north = ng.arms.find((a) => a.dir.y < -0.9)!.seg;
    const plan = g.net.nodes.get(t.id)!.signal!;
    expect(plan.phases.find((p) => p.arms.includes(south))?.arms).toContain(north);
    // and a save from before the fix heals when loaded
    g.net.nodes.get(t.id)!.signal = { phases: plan.phases.map((p) => ({ ...p, arms: p.arms.filter((x) => x !== south) })) };
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(h.net.nodes.get(t.id)!.signal!.phases.some((p) => p.arms.includes(south))).toBe(true);
  });

  it("not before lights are unlocked", () => {
    const g = new Game(7);
    g.money = 1e7;
    g.milestone = 1;
    // (avenues come with the same milestone: draw them anyway, as if unlocked)
    (g as unknown as { featureUnlocked: (f: string) => boolean }).featureUnlocked = () => false;
    lay(g, v2(0, 0), v2(240, 0), "avenue");
    lay(g, v2(120, -120), v2(120, 120), "avenue");
    expect(nodeNear(g, v2(120, 0)).signal).toBeNull();
  });
});

// ------------------------------------------------------------------------------------------------ stop signs

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId) {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
function access(net: RoadNetwork, seg: number, frac: number, side: 1 | -1): Access {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac, p = polyAt(g.center, s);
  const q0 = g.center.pts[0], q1 = g.center.pts[g.center.pts.length - 1];
  const L = Math.hypot(q1.x - q0.x, q1.y - q0.y);
  return { seg, s, p: { x: p.x - ((q1.y - q0.y) / L) * side * (g.width / 2), y: p.y + ((q1.x - q0.x) / L) * side * (g.width / 2) } };
}
const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });

describe("Stop signs", () => {
  /** Streets crossing at X; arms run from the ends into X. */
  function cross() {
    const net = new RoadNetwork();
    net.begin();
    const X = net.addNode(v2(300, 300), 0);
    const [e, w, n, s] = [v2(600, 300), v2(0, 300), v2(300, 0), v2(300, 600)].map((p) => road(net, net.addNode(p, 0), X, "street"));
    net.commit();
    net.rebuild();
    return { net, X, e, w, n, s };
  }

  it("a car on a stop arm comes to a full stop at the line even with nothing coming", () => {
    const k = cross();
    k.net.begin();
    k.net.setStops(k.X, [k.n, k.s]);
    k.net.commit();
    k.net.rebuild();
    const tr = new Traffic(k.net, { arrive: () => {}, fail: () => {} });
    tr.request({ from: access(k.net, k.n, 0.2, 1), fromSide: 1, to: access(k.net, k.s, 0.6, -1), toSide: -1, trip: trip(), truck: false, tries: 0, wait: 0 });
    let minV = Infinity, through = false;
    for (let t = 0; t < 60; t += 1 / 30) {
      tr.step(1 / 30);
      const v = tr.vehicles[0];
      if (!v) continue;
      const l = v.edge as { kind: string; seg?: number; pl: { length: number } };
      if (l.kind === "lane" && l.seg === k.n && l.pl.length - v.s < 6) minV = Math.min(minV, v.v);
      if (l.kind === "conn") through = true;
    }
    expect(through).toBe(true);
    expect(minV).toBeLessThan(0.31);
  });

  it("a stop arm gives way to the street it meets, even a smaller one", () => {
    const k = cross();
    // the north-south street has stop signs; east-west has none
    k.net.begin();
    k.net.setStops(k.X, [k.n, k.s]);
    k.net.commit();
    k.net.rebuild();
    const g = k.net.nodeGeom.get(k.X)!;
    const prioOf = (seg: number) => Math.max(...g.conns.filter((c) => c.armIn === seg).map((c) => c.prio));
    expect(prioOf(k.n)).toBeLessThan(prioOf(k.e));
    expect(prioOf(k.s)).toBeLessThan(prioOf(k.w));
  });

  it("can be set and undone in the game, and they follow a road split at the junction", () => {
    const g = new Game(7);
    g.money = 1e7;
    lay(g, v2(0, 0), v2(240, 0), "street");
    lay(g, v2(120, -120), v2(120, 120), "street");
    const x = nodeNear(g, v2(120, 0));
    const ns = g.net.nodeGeom.get(x.id)!.arms.filter((a) => Math.abs(a.dir.y) > 0.9).map((a) => a.seg);
    expect(g.setStops(x.id, ns)).toBe(true);
    expect(g.net.nodes.get(x.id)!.stops).toEqual([...ns].sort((a, b) => a - b));
    // a road joining the north arm half way splits it: the stop sign moves to the new piece
    lay(g, v2(120, -60), v2(200, -60), "street");
    const arms = g.net.nodeGeom.get(x.id)!.arms.filter((a) => Math.abs(a.dir.y) > 0.9).map((a) => a.seg);
    expect([...g.net.nodes.get(x.id)!.stops!].sort()).toEqual([...arms].sort());
    g.undo();
    g.undo();
    expect(g.net.nodes.get(x.id)!.stops).toBeUndefined();
  });
});
