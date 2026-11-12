// A works being placed is only ever shown moved or turned onto a road where it can be built (road play log 2026-11-10,
// item 8). As played, a Dairy Farm hovered by the dead ends of a parallel pair of streets stood back from them, turned
// to them, and then said "Road in the way": the snap offered a spot it would refuse. Now it tries the next spot (on
// the cursor, then stepped back from the road its gate faces) and, if none will do, stays where the cursor is.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { dist, type V2 } from "../src/core/math";
import { parallelSpacing, planRoad } from "../src/roads/planner";
import { F } from "../src/world/gen";
import { openLand } from "./gatejam.scenario";

describe("placing a works by a parallel pair's dead ends", () => {
  const o = openLand({ pop: 60 });
  const { g, at } = o;
  // fertile everywhere: the farm's soil is not what this is about
  const terr = g.terrain as unknown as { has(f: number, p: V2): boolean };
  const has0 = terr.has.bind(terr);
  terr.has = (f, p) => f === F.fert || has0(f, p);
  g.unlockAll();
  g.money = 1e8;
  // two streets 12.4 m apart, ending side by side in open ground 600 m out
  const pair = planRoad(g.net, g.world, {
    start: { p: at(40), h: 0, guides: [] }, end: { p: at(600), h: 0, guides: [] }, mode: "straight", type: "street",
    parallel: { offset: parallelSpacing("street") },
  });
  expect(pair.errors).toEqual([]);
  g.build(pair);
  // as the game places it: turned as the screen has it
  const opts = { rot: Math.PI, down: { x: 0, y: 1 } };

  it("never moves or turns onto a spot it then refuses", () => {
    const bad: string[] = [];
    for (let a = 400; a <= 900; a += 40) for (let c = -300; c <= 300; c += 40) {
      const p = at(a, c);
      const pl = g.placedPlan("dairyfarm", p, opts)!;
      if (dist(pl.c, p) > 0.5 && !pl.ok) bad.push(`${a},${c}: ${pl.reason}`);
      // and the cursor stays on the site it shows
      if (dist(pl.c, p) > BUILDING_TYPES.dairyfarm.d / 2) bad.push(`${a},${c}: cursor off the site`);
    }
    expect(bad).toEqual([]);
  }, 120000);

  it("past the dead ends it stands back to the road's end and joins it", () => {
    for (const c of [0, 6, 12]) {
      const pl = g.placedPlan("dairyfarm", at(700, c), opts)!;
      expect(pl.ok, `${c}: ${pl.reason}`).toBe(true);
      expect(pl.free, `${c}`).toBe(false);
    }
  });
});
