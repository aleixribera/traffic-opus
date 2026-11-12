// A works placed further than its own street reaches (GATE_LINK_REACH) is offered a dirt road from its gate to the
// nearest road, with its price, built with one click (review 2026-11-10, Freight honesty). city.ts roadTo.

import { describe, expect, it } from "vitest";
import { GATE_LINK_REACH, ROAD_TO_REACH, gateLinkWhy } from "../src/game/city";
import { dist } from "../src/core/math";
import { openLand } from "./gatejam.scenario";
import { chainPoints } from "../src/roads/planner";
import type { Building } from "../src/game/buildings";

describe("the road to a far works' gate", () => {
  it("is offered past the gate street's reach, priced as a dirt road, and laid with one click", () => {
    const { g, at, dir } = openLand();
    // a Sawmill 1.2 km out along open land, its gate turned back toward the town
    const b = g.place("sawmill", at(1200), { rot: Math.atan2(-dir.x, dir.y) })!;
    expect(b).toBeTruthy();
    expect(b.access).toBeFalsy();
    const plan = g.roadTo(b)!;
    expect(plan).toBeTruthy();
    expect(plan.strokes.every((s) => s.type === "dirt")).toBe(true);
    const len = plan.strokes.reduce((a, s) => a + s.chain.reduce((x, c) => x + dist(c.p0, c.p3), 0), 0);
    expect(len).toBeGreaterThan(GATE_LINK_REACH);
    expect(len).toBeLessThan(ROAD_TO_REACH);
    expect(plan.cost).toBeGreaterThan(0);
    // asked again with the roads unchanged: the same plan (worked out once)
    expect(g.roadTo(b)).toBe(plan);
    const money = g.money;
    expect(g.buildRoadTo(b)).toBeTruthy();
    expect(b.access).toBeTruthy();
    expect(money - g.money).toBeCloseTo(plan.cost, 0);
    expect(g.roadTo(b)).toBeNull();
    // one Undo takes the road away again
    g.undo();
    expect(b.access).toBeFalsy();
  });

  it("is worked out again when a works is placed on its way, and never laid through it", () => {
    const { g, at, dir } = openLand();
    const b = g.place("sawmill", at(1200), { rot: Math.atan2(-dir.x, dir.y) })!;
    const plan = g.roadTo(b)!;
    // a works on the middle of the offered road (placing it lays no road: the roads are as they were)
    const pts = plan.strokes.flatMap((s) => chainPoints(s.chain, 3));
    const mid = pts[Math.floor(pts.length / 2)];
    const v = g.net.version;
    let farm: Building | null = null;
    for (const k of ["farm", "loggingcamp", "sawmill"] as const) for (const rot of [0, Math.PI / 2, Math.atan2(-dir.x, dir.y)]) farm ??= g.place(k, mid, { rot });
    expect(farm).toBeTruthy();
    expect(g.net.version).toBe(v);
    const again = g.roadTo(b);
    expect(again).not.toBe(plan);
    const built = g.buildRoadTo(b);
    // (round the works, or not at all: never through it)
    expect(g.buildings.byId.has(farm!.id)).toBe(true);
    if (built) expect(b.access).toBeTruthy();
  });

  it("when none is offered, says why in a few words (review 2026-11-12, C5)", () => {
    const { g, at, dir } = openLand();
    const b = g.place("sawmill", at(1200), { rot: Math.atan2(-dir.x, dir.y) })!;
    expect(g.roadTo(b)).toBeTruthy();
    // one is offered: no reason to give
    expect(g.roadToWhy(b)).toBeNull();
    // with nothing to join for 6 km, it says so (the roads are taken out of its reach for the asking)
    const why: { say?: string } = {};
    expect(g.gateLink("sawmill", b.c, b.rot, b.side, { reach: 100, type: "dirt", tries: 3, why })).toBeNull();
    expect(why.say).toBe("no road within 100 m");
    // the planner's refusals, in the works' words
    expect(gateLinkWhy("Mountain in the way")).toBe("a mountain blocks it");
    expect(gateLinkWhy("Needs a bridge here: raise it with Page Up")).toBe("water blocks it");
    expect(gateLinkWhy("Dirt roads stay on the ground")).toBe("water blocks it");
    expect(gateLinkWhy("Too close to a junction, cross at it or 12 m away")).toBe("too many roads there");
    expect(gateLinkWhy("Curve too tight: needs a 30 m radius")).toBe("the way is blocked");
  });
});
