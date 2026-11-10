// After the last goal the Goals card names one long project with a bar, and the towns' shortfalls are the means to it
// (review 2026-11-10, Progression). longProject.ts.

import { describe, expect, it } from "vitest";
import type { Building } from "../src/game/buildings";
import { Game } from "../src/game/city";
import { longProject } from "../src/ui/longProject";

describe("the long project", () => {
  it("is the biggest town's next size, with how far along and what it will want next", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    t.pop = 450;
    const lp = longProject(g)!;
    expect(lp.name).toBe(`Grow ${t.name} into a Town`);
    expect(lp.measure).toBe("450 of 1,500 people");
    expect(lp.p).toBeCloseTo(0.3, 6);
    expect(lp.town).toBe(t.id);
    expect(lp.ahead).toBe("From 600 people it will want cement too.");
    // (the means are the town's own shortfalls, each with what to do: a town short of food says so)
    for (const m of lp.means) expect(m.say).toMatch(/more loads? a day\. /);
  });

  it("names the next size up from a City, and none past the last", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    t.pop = 7000;
    expect(longProject(g)!.name).toBe(`Grow ${t.name} into a Metropolis`);
    for (const x of g.towns.list) x.pop = 25000;
    expect(longProject(g)).toBeNull();
  });

  it("a landmark on its building site comes first, with what it still waits for", () => {
    const dam = {
      id: 9, kind: "hydrodam", c: { x: 0, y: 0 }, built: 0.5,
      plant: { site: { need: { cement: 320, steel: 200, parts: 120, machinery: 60 }, got: { cement: 320, steel: 50, parts: 120, machinery: 60 } }, landmark: { pieces: 1 }, stock: {}, out: {} },
    } as unknown as Building;
    const g = { industry: { plants: () => [dam] }, towns: { list: [] } } as unknown as Game;
    const lp = longProject(g)!;
    expect(lp.name).toBe("Hydro Dam");
    expect(lp.works).toBe(9);
    // 550 of 700 loads, and 1 of 3 turbines at 10 loads each: 560 of 730
    expect(lp.measure).toBe("76% built");
    expect(lp.means[0]).toEqual({ p: "steel", head: "Steel", say: "150 more loads. Nothing of yours makes steel yet: build a Smelter." });
    expect(lp.means[1]).toEqual({ head: "Turbines", say: "2 more, each by convoy." });
  });
});
