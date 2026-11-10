// The game's words agree with the game (review 2026-11-10: B5, B8, B9, B10 and the "all they can store" beside
// "waiting for coal"). Each message is built from the state it talks about, when it is shown.

import { beforeAll, describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { Industry, PLANTS, PLANT_KINDS, type IndustryHost } from "../src/game/industry";
import type { Town } from "../src/game/settlements";
import { tipFor } from "../src/ui/tips";
import { farText } from "../src/ui/townPings";
import { distFrom, distText } from "../src/ui/distance";
import { worksStatus } from "../src/ui/inspect";
import { road } from "./helpers";

describe("one voice for what a works does (B5)", () => {
  it("every works' card line is its recipe's own", () => {
    for (const k of PLANT_KINDS) expect(BUILDING_TYPES[k].blurb, k).toBe(PLANTS[k].blurb);
    // the Power Plant's card says what its banner and hand bar say: coal, or wood chips
    expect(BUILDING_TYPES.coalplant.blurb).toMatch(/wood chips/);
  });
});

describe("the income rate after a load (B9)", () => {
  it("is the same day's average it was when saved, not the last hour alone", () => {
    const g = new Game(3);
    g.start();
    // a day of good hours and one quiet one last
    const hour = (sales: number) => ({ income: { sales, transit: 0 }, expense: { roads: 20, wages: 30, upkeep: 10, fuel: 5, transit: 0, loans: 0 } });
    g.budgetLog = [...Array.from({ length: 23 }, () => hour(1800)), hour(0)];
    g.budget = g.budgetLog[23];
    const before = g.netIncome;
    expect(before).toBeGreaterThan(1500);
    const back = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(back.netIncome).toBeCloseTo(before, 6);
  });

  it("a save from before the log was kept still loads, on its last hour", () => {
    const g = new Game(3);
    g.start();
    g.budget = { income: { sales: 500, transit: 0 }, expense: { roads: 0, wages: 0, upkeep: 0, fuel: 0, transit: 0, loans: 0 } };
    const data = JSON.parse(JSON.stringify(g.serialize()));
    delete data.budgetLog;
    expect(Game.load(data).netIncome).toBeCloseTo(500, 6);
  });
});

describe("a works whose goods are spoken for says where they are", () => {
  // a Coal Mine whose coal is all on its way to the Smelter: two loads on the road, the nearer due in 2 game hours
  const HOUR = 40;
  const mine = { id: 1, kind: "coalmine", built: 1, c: { x: 0, y: 0 }, access: { seg: 1 }, plant: { site: null, stock: {}, out: { coal: 3 } } } as unknown as Building;
  const smelter = { id: 2, kind: "smelter", built: 1, c: { x: 2000, y: 0 }, access: { seg: 2 }, plant: { site: null, stock: {}, out: {} } } as unknown as Building;
  const trip = (n: number, eta: number) => ({ haul: { plant: 1, leg: "out", product: "coal", n, dest: 2, eta } });
  const host = (trips: unknown[]) => ({
    time: 1000, buildings: { list: [mine, smelter], byId: new Map([[1, mine], [2, smelter]]) },
    connected: () => true, trips: () => trips, shops: [],
  }) as unknown as IndustryHost;
  const say = (trips: unknown[]) => (new Industry(host(trips)) as unknown as { noBuyer(b: Building, p: string): string }).noBuyer(mine, "coal");

  it("counts the loads on their way and says when the next lands", () => {
    expect(say([trip(1, 1000 + 2 * HOUR), trip(1, 1000 + 5 * HOUR)])).toBe("2 loads on the way to the Smelter. The next lands in about 2 hours");
    expect(say([trip(1, 1010)])).toBe("1 load on the way to the Smelter. The next lands within the hour");
  });

  it("with none on the road the plain words stand", () => {
    expect(say([])).toBe("Your plants that use coal have all they can store, with the loads on their way");
  });

  it("is not called a problem in its panel: nothing is wrong", () => {
    const g = { ...({} as Game) };
    const b = { ...mine, built: 1, problem: "2 loads on the way to the Smelter. The next lands in about 2 hours", plant: { ...mine.plant!, level: 1 } } as unknown as Building;
    const st = (worksStatus as (g: Game, b: Building) => ReturnType<typeof worksStatus>)(
      { ...g, people: { workersAt: () => 99 }, utilities: { supplyOf: () => 1, plants: new Map() }, industry: { plants: () => [b] }, trips: () => [], time: 1000, buildings: { list: [b], byId: new Map([[1, b]]) }, towns: { list: [] } } as unknown as Game, b);
    expect(st.tone).not.toBe("bad");
    expect(st.fix).toBe("2 loads on the way to the Smelter. The next lands in about 2 hours.");
  });
});

describe("the jam tip counts what the sign counts (B8)", () => {
  let g: Game;
  beforeAll(() => { g = new Game(7); g.start(); });
  const jam = (gg: Game) => {
    // five cars standing together for three minutes
    (gg.traffic as unknown as { stuckCars: () => unknown[] }).stuckCars = () => Array.from({ length: 5 }, (_, i) => ({ p: { x: 100 + i * 8, y: 100 }, t: 180 }));
  };
  const only = (id: string) => (x: string) => x !== id;

  it("says the sign's number of places, not its own count", () => {
    jam(g);
    expect(tipFor(g, only("jam"), 14)!.html).toMatch(/stuck in 14 places/);
    expect(tipFor(g, only("jam"), 1)!.html).toMatch(/stuck in one place/);
  });

  it("with no sign up there is nothing to point at, so no tip", () => {
    jam(g);
    expect(tipFor(g, only("jam"), 0)).toBeNull();
  });
});

describe("distances from the map, never the camera (B10)", () => {
  const town = (id: number, name: string, x: number, y: number) => ({ id, name, c: { x, y } }) as unknown as Town;

  it("a new town's pointer says how far it is from the nearest other town, as its banner and tip do", () => {
    const a = town(1, "Alder Run", 0, 0), b = town(2, "Danner Ridge", 5000, 0), n = town(3, "Pecan Bend", 1300, -1400);
    expect(farText(n, [a, b, n])).toBe("1.9 km from Alder Run");
    expect(farText(a, [a])).toBe("");
  });

  it("the words: metres in fifties, then tenths of a kilometre, then whole ones", () => {
    expect(distText(12)).toBe("50 m");
    expect(distText(430)).toBe("450 m");
    expect(distText(1949)).toBe("1.9 km");
    expect(distText(12400)).toBe("12 km");
  });

  it("a place is measured from the nearest road when that is nearer than any town", () => {
    const g = new Game(7);
    g.start();
    const home = g.towns.list[0];
    const far = { x: home.c.x + 6000, y: home.c.y };
    // (the home town's own streets reach out a few hundred metres: the nearest road is one of them)
    const before = distFrom(g, far)!;
    expect(before.m).toBeGreaterThan(4500);
    expect(distFrom(g, home.c)!.m).toBeLessThan(60);
    road(g, { x: home.c.x + 4000, y: home.c.y + 300 }, { x: home.c.x + 4000, y: home.c.y + 900 });
    const after = distFrom(g, far)!;
    expect(after.from).toBe("a road");
    expect(after.m).toBeGreaterThan(1900);
    expect(after.m).toBeLessThan(2100);
  });
});
