// The cures for a jam at a works gate (docs/playtest-2026-11-09.md, A2). The junction panel said "Try lights, stop
// signs on the quiet roads, or a roundabout", and at the sawmill's gate junction neither helped: lights changed
// nothing in ten minutes, a Small roundabout left the sawmill with "No road to the gate", and the 20 m of road back
// to it could not be drawn ("Too short: drag further from the start"). Only Undo saved the company.
//
// The company here is the play-test's (tests/gatejam.scenario.ts), overloaded: one sawmill, two towns, eight sites.

import { describe, expect, it } from "vitest";
import { SIGNAL_COST } from "../src/config";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import type { Lane } from "../src/roads/network";
import { ALL_RED, AMBER, GREEN } from "../src/sim/traffic";
import { buildGateJam, runGateJam } from "./gatejam.scenario";

/** The junction a works' gate street meets the road at. */
function gateJunction(g: Game, b: Building) {
  const s = g.net.segs.get(b.access!.seg)!;
  return g.net.nodes.get(g.net.segsAt(s.a).length > 1 ? s.a : s.b)!;
}
/** The rate a run settled at: loads an hour over its last game day. */
const rate = (r: ReturnType<typeof runGateJam>) => r.samples.slice(-24).reduce((a, st) => a + st.perHour, 0) / 24;

describe("lights on a works' gate junction", () => {
  it("give the gate a green of its own that clears it; the road past it is slower, never stopped", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    const { g, mill } = s;
    const gate = mill.access!.seg, J = gateJunction(g, mill);
    const plan = g.defaultSignal(J.id)!;
    // one click, the default plan: the road's two sides together, then the gate by itself
    expect(plan.phases.length).toBe(2);
    expect(plan.phases.filter((ph) => ph.arms.length === 1 && ph.arms[0] === gate).length).toBe(1);
    const money = g.money;
    expect(g.setSignal(J.id, plan)).toBe(true);
    expect(money - g.money).toBe(SIGNAL_COST);
    const cycle = plan.phases.length * (GREEN + AMBER + ALL_RED);
    // the longest a truck stood on the gate's street waiting to pull out, and how many pulled out of it
    let worstOut = 0, left = 0;
    const seen = new Set<number>();
    const r = runGateJam(s, 2);
    // (measured over a second stretch, every step: the run above is the hourly samples)
    const end = g.time + 480;
    while (g.time < end) {
      g.step(g.dt);
      for (const v of g.traffic.vehicles) {
        if (v.edge.kind !== "lane" || (v.edge as Lane).seg !== gate || (v.edge as Lane).to !== J.id) continue;
        if (v.stuck > worstOut) worstOut = v.stuck;
        if (!seen.has(v.id)) { seen.add(v.id); left++; }
      }
    }
    // nobody stands five game minutes, anywhere; the longest stand is a couple of reds (it was 451 s, with the towns
    // at a third of their planks and the sawmill at one load an hour: the trucks turning in off the paved side had
    // the right of way over the dirt side, and a truck waiting for a green read as "held up", so none was sent)
    // (since towns buy only their demand, v0.0.105, a returning empty truck can give way for 140 s at a town's T
    // junction away from the gate; the gate itself is held to one cycle below)
    expect(r.standing).toBe(0);
    expect(r.longest).toBeLessThan(3 * cycle);
    expect(r.breaks).toBe(0);
    expect(r.quits).toBe(0);
    // the gate's own green clears it: trucks come out all the time, none waits much more than one cycle for it
    expect(left).toBeGreaterThan(3);
    expect(worstOut).toBeLessThan(cycle + 10);
    // slower than no lights (fixed 24 s greens on a two-lane road), and still a working company
    expect(rate(r)).toBeGreaterThan(1.6);
    expect(r.minA).toBeGreaterThan(30);
    expect(r.minB).toBeGreaterThan(30);
  }, 600000); // (about two minutes alone: room for a PC busy with other runs)
});
