// A queue's fix, one click away (src/ui/queues.ts fixOffer / applyFix): the button the junction and road panels show
// under the advice builds what the advice names (wider roads, a roundabout, lights) through the game's own paths, at
// the price on the button, as one undo step; a fix that can't be built says why and changes nothing; and once built,
// the advice stops asking for it.

import { beforeEach, describe, expect, it, vi } from "vitest";
import { v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import type { Queue } from "../src/sim/queues";
import { applyFix, fixOf, fixOffer, forgetQueues, holdAdvice, type FixAct, type QueueRow } from "../src/ui/queues";
import { planRoad, snap } from "../src/roads/planner";

// (the panels read the queue held at a junction or road from the traffic; here it is handed in)
const at = vi.hoisted(() => ({ row: null as QueueRow | null }));
vi.mock("../src/ui/queues", async (orig) => ({ ...(await orig<typeof import("../src/ui/queues")>()), queueAt: () => at.row }));
const { junctionModel, roadModel } = await import("../src/ui/inspect");

/** A street from a to b on open ground (snapped to the roads already there), or false where the planner refuses it. */
function street(g: Game, a: V2, b: V2): boolean {
  const end = (p: V2) => { const s = snap(g.net, p, { mpp: 0.5, level: 0, type: "street" }); return s.node !== undefined || s.seg !== undefined ? s : { p, h: 0, guides: [] }; };
  const plan = planRoad(g.net, g.world, { start: end(a), end: end(b), mode: "straight", type: "street" });
  return !plan.errors.length && g.build(plan);
}

/** A T of streets on open ground away from the town: its junction and its three arms. */
function tee(g: Game): { node: number; arms: number[] } {
  const t = g.towns.list[0];
  for (let r = 1400; r < 4000; r += 300) for (let k = 0; k < 12; k++) {
    const c = v2(t.c.x + Math.cos(k / 2) * r, t.c.y + Math.sin(k / 2) * r);
    const before = g.net.version;
    if (!street(g, v2(c.x - 220, c.y), v2(c.x + 220, c.y))) continue;
    if (!street(g, v2(c.x, c.y + 220), v2(c.x, c.y))) { while (g.net.version !== before && g.canUndo()) g.undo(); continue; }
    const node = [...g.net.nodeGeom].find(([id, ng]) => ng.kind === "junction" && ng.arms.length === 3 && Math.hypot(g.net.nodes.get(id)!.p.x - c.x, g.net.nodes.get(id)!.p.y - c.y) < 5);
    if (node) return { node: node[0], arms: node[1].arms.map((a) => a.seg) };
  }
  throw new Error("no open ground for a T");
}
/** A queue held at the junction (what src/sim/queues.ts would hand over), of this cause. */
const queue = (node: number, arms: number[], cause: Queue["cause"]): Queue => ({
  key: `node:${node}`, cause, node, at: v2(0, 0), vehicles: [], trucks: 0, worst: 90, segs: arms.slice(0, 2), approaches: arms.slice(0, 1),
});

const types = (g: Game, segs: number[]) => segs.map((s) => g.net.segs.get(s)?.type);

describe("a queue's fix, one click", () => {
  let g: Game, node: number, arms: number[];
  beforeEach(() => {
    g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 5_000_000;
    ({ node, arms } = tee(g));
    forgetQueues(g);
    at.row = null;
  });

  it("widens the junction's roads at the price on the button, as one undo step", () => {
    const f = fixOf(g, queue(node, arms, "full"))!;
    expect(f.say).toBe("Widen its roads to Avenue");
    expect(f.act).toEqual({ kind: "widen", segs: arms.map((seg) => ({ seg, to: "avenue" })) });
    const o = fixOffer(g, f.act!)!;
    const quoted = arms.reduce((a, s) => a + g.upgradePlan(s, "avenue").cost, 0);
    expect(o.cost).toBeCloseTo(quoted, 6);
    expect(o.label).toMatch(/^Widen to Avenue · \$[\d,]+$/);
    expect(o.blocked).toBeUndefined();
    const m0 = g.money, others = [...g.net.segs.keys()].filter((s) => !arms.includes(s)).map((s) => [s, g.net.segs.get(s)!.type]);
    expect(applyFix(g, f.act!)).toBeNull();
    expect(m0 - g.money).toBeCloseTo(o.cost, 6);
    expect(types(g, arms)).toEqual(["avenue", "avenue", "avenue"]);
    // (only those: every other road is as it was)
    for (const [s, t] of others) expect(g.net.segs.get(s as number)?.type).toBe(t);
    // nothing left to widen: no button
    expect(fixOffer(g, f.act!)).toBeNull();
    // one undo puts all three back, and the money
    g.undo();
    expect(types(g, arms)).toEqual(["street", "street", "street"]);
    expect(g.money).toBeCloseTo(m0, 6);
  });

  it("says why it can't, and changes nothing", () => {
    const act = fixOf(g, queue(node, arms, "full"))!.act!;
    g.money = 10;
    const o = fixOffer(g, act)!;
    expect(o.blocked).toBe("Not enough money");
    const v = g.net.version;
    expect(applyFix(g, act)).toBe("Not enough money");
    expect(g.net.version).toBe(v);
    expect(g.money).toBe(10);
    expect(types(g, arms)).toEqual(["street", "street", "street"]);
    expect(g.canUndo()).toBe(true); // (the T's own streets, nothing new)
  });

  it("widens the roads that can be, and says which stays and why", () => {
    const act = fixOf(g, queue(node, arms, "full"))!.act!;
    const real = g.upgradePlan.bind(g);
    // (a works the road can't push back stands by one arm)
    vi.spyOn(g, "upgradePlan").mockImplementation((seg, to) => {
      const u = real(seg, to);
      return seg === arms[0] ? { ...u, errors: [{ msg: "Sawmill in the way", p: v2(0, 0) }] } : u;
    });
    const o = fixOffer(g, act)!;
    expect(o.note).toBe("1 road stays: Sawmill in the way");
    expect(o.segs).toEqual(arms.slice(1));
    expect(applyFix(g, act)).toBeNull();
    expect(types(g, arms)).toEqual(["street", "avenue", "avenue"]);
    // every road in the way: the button is off and says why
    vi.spyOn(g, "upgradePlan").mockImplementation((seg, to) => ({ ...real(seg, to), errors: [{ msg: "Sawmill in the way", p: v2(0, 0) }] }));
    g.undo();
    const none = fixOffer(g, act)!;
    expect(none.blocked).toBe("Sawmill in the way");
    expect(none.label).toBe("Widen to Avenue");
    const v = g.net.version;
    expect(applyFix(g, act)).toBe("Sawmill in the way");
    expect(g.net.version).toBe(v);
    // and Game.upgradeAll itself refuses all of it when any piece is in the way
    expect(g.upgradeAll(arms.map((seg) => ({ seg, to: "avenue" })))).toBe(false);
    expect(types(g, arms)).toEqual(["street", "street", "street"]);
  });

  it("takes all of it back when a road gets in the way only once the others are wider", () => {
    const real = g.upgradePlan.bind(g);
    // (the third road is clear until the first is an avenue: a works pushed back for one lands in the other's way)
    vi.spyOn(g, "upgradePlan").mockImplementation((seg, to) => {
      const u = real(seg, to);
      return seg === arms[2] && g.net.segs.get(arms[0])?.type === "avenue" ? { ...u, errors: [{ msg: "Sawmill in the way", p: v2(0, 0) }] } : u;
    });
    const m0 = g.money, v = g.net.version;
    expect(g.upgradeAll(arms.map((seg) => ({ seg, to: "avenue" })))).toBe(false);
    expect(types(g, arms)).toEqual(["street", "street", "street"]);
    expect(g.money).toBeCloseTo(m0, 6);
    expect(g.canRedo()).toBe(false);
    expect(g.net.version).toBeGreaterThan(v);
    // (the undo stack is as it was: the next undo takes the T's side street away)
    const before = g.net.segs.size;
    g.undo();
    expect(g.net.segs.size).toBeLessThan(before);
  });

  it("won't build a roundabout that leaves a works with no road, and says so", () => {
    const act = fixOf(g, queue(node, arms, "giveway"))!.act!;
    // (as Game.build would find it: the ring takes the Sawmill's gate street and can't lay it again)
    const cut = vi.spyOn(g, "ringCutsOff").mockImplementation((_p, _k, peek) => (peek && !cut.mock.calls.some((c) => !c[2]) ? null : ({ kind: "sawmill" } as never)));
    expect(fixOffer(g, act)!.blocked).toBeUndefined();
    const v = g.net.version, m0 = g.money;
    expect(applyFix(g, act)).toBe("Leaves the Sawmill with no road");
    expect(g.net.version).toBe(v);
    expect(g.money).toBe(m0);
    expect(g.net.nodes.has(node)).toBe(true);
    // the click found it out: the button is off from then on, with the reason
    expect(fixOffer(g, act)!.blocked).toBe("Leaves the Sawmill with no road");
  });

  it("builds the roundabout the advice names, at the tool's price, as one undo step", () => {
    const f = fixOf(g, queue(node, arms, "giveway"))!;
    expect(f.act).toMatchObject({ kind: "ring", node });
    const o = fixOffer(g, f.act!)!;
    expect(o.label).toBe(`Build a ${f.say.match(/Build a (\w+) roundabout/)![1]} roundabout · ${o.label.split(" · ")[1]}`);
    expect(o.cost).toBeCloseTo(o.plan!.cost + g.demolishCost(g.lotsUnder(o.plan!)), 6);
    const m0 = g.money, n0 = g.net.nodes.size;
    expect(applyFix(g, f.act!)).toBeNull();
    expect(m0 - g.money).toBeCloseTo(o.cost, 6);
    expect(g.net.nodes.has(node)).toBe(false);
    expect([...g.net.segs.values()].some((s) => s.ring)).toBe(true);
    g.undo();
    expect(g.net.nodes.has(node)).toBe(true);
    expect([...g.net.segs.values()].some((s) => s.ring)).toBe(false);
    expect(g.net.nodes.size).toBe(n0);
    expect(g.money).toBeCloseTo(m0, 6);
  });

  it("puts the advice's fix on the junction and road panels: widen, roundabout, or lights", () => {
    const row = (cause: Queue["cause"]): QueueRow => {
      const q = queue(node, arms, cause), f = fixOf(g, q)!;
      return { key: q.key, cause, why: "Junction full", where: "on the open road", fix: f.say, act: f.act, vehicles: 9, trucks: 0, worst: 90, at: q.at, node, segs: q.segs, ids: [] };
    };
    const compass = () => "N";
    at.row = row("full");
    const j = junctionModel(g, node, compass)!.status;
    expect(j.act?.act.kind).toBe("widen");
    // (the fix said once: on the button, not again in the line above it)
    expect(j.fix).toBeUndefined();
    const r = roadModel(g, arms[0])!.status;
    expect(r.act?.label).toMatch(/^Widen to Avenue · /);
    // (a road's panel names the junction ahead the fix lands on: it keeps the words)
    expect(r.fix).toBe("Queued into a full junction. Widen its roads to Avenue");
    at.row = row("giveway");
    expect(junctionModel(g, node, compass)!.status.act?.act.kind).toBe("ring");
    at.row = row("deadlock");
    const lit = junctionModel(g, node, compass)!.status.act!;
    expect(lit.act).toEqual({ kind: "lights", node });
    // (the junction panel's own lights button is the one there: the advice keeps its words)
    expect(junctionModel(g, node, compass)!.status.fix).toBe("Add traffic lights here");
    expect(lit.label).toBe(`Add traffic lights · $${g.lightsCost(node).toLocaleString("en-US")}`);
    // a fix that is no one thing to build: no button
    at.row = { ...row("full"), fix: "Build a second road to share the traffic", act: undefined };
    expect(junctionModel(g, node, compass)!.status.act).toBeUndefined();
  });

  it("stops asking for what was just built", () => {
    const q = queue(node, arms, "full");
    const was = holdAdvice(g, q);
    expect(was.fix).toBe("Widen its roads to Avenue");
    expect(applyFix(g, was.act as FixAct)).toBeNull();
    // (the same queue, the same minute: the advice held for hours otherwise, but its junction was rebuilt)
    const now = holdAdvice(g, q);
    expect(now.fix).not.toMatch(/^Widen/);
    expect(now.act?.kind).not.toBe("widen");
  });
});
