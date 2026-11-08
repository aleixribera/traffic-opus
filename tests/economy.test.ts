// The company economy end to end, on the real map and the real traffic: a new company's hamlet, a farm on fertile
// soil, a food plant, trucks on the roads, and a town that grows on what they bring.

import { describe, expect, it } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import { DAY, HOUR } from "../src/game/society";
import { BLOCK, gridPt } from "../src/game/towns";
import { HIST_HOURS, Industry, MIN_DEPOSIT, PLANTS } from "../src/game/industry";
import { levelMult } from "../src/game/sites";
import { F } from "../src/world/gen";
import type { V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import { placeAlong, road } from "./helpers";

/** Steps the sim for a number of game hours, calling `each` once a game minute or so. */
function run(g: Game, hours: number, each?: () => void) {
  for (let i = 0; i < hours * HOUR * 30; i++) {
    g.step(1 / 30);
    if (each && i % 20 === 0) each();
  }
}

/**
 * A new company on seed 7 builds its first chain the way a player would: a road on from the end of the starting
 * road to the nearest good farmland, a farm there, and a food plant by the town.
 */
function chain(g: Game) {
  g.start();
  const t = g.towns.list[0];
  const end = gridPt(t.c, t.ang, 1 + 320 / BLOCK, 0);
  // the nearest patch of fertile soil (a farm's lot all on it) to the end of the road
  let f: V2 | null = null, bd = Infinity;
  for (let r = 50; r < 1200 && !f; r += 25) for (let k = 0; k < 48; k++) {
    const p = { x: end.x + Math.cos((k / 48) * 6.283) * r, y: end.y + Math.sin((k / 48) * 6.283) * r };
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(F.fert, { x: p.x + i * 15, y: p.y + j * 15 })) ok++;
    if (ok >= 20 && r < bd) { bd = r; f = p; }
  }
  expect(f).not.toBeNull();
  const far = { x: f!.x + ((f!.x - end.x) / bd) * 80, y: f!.y + ((f!.y - end.y) / bd) * 80 };
  road(g, end, far);
  const farm = placeAlong(g, "farm", end, far, 35);
  const foodplant = placeAlong(g, "foodplant", gridPt(t.c, t.ang, 1, 0), end, 35);
  return { t, farm, foodplant };
}

describe("The company economy", () => {
  it("a farm only goes on fertile soil, and the preview says how fertile", () => {
    const g = new Game(7);
    const { t, farm } = chain(g);
    // the farm the chain put down sits on good soil, and works it at that yield
    expect(farm.plant!.yld).toBeGreaterThan(MIN_DEPOSIT);
    // somewhere round the town without enough farmland under the plot a farm is refused, and the preview says why
    let bare: V2 | null = null;
    for (let r = 200; r < 1400 && !bare; r += 100) for (let k = 0; k < 24 && !bare; k++) {
      const q = { x: t.c.x + Math.cos((k / 24) * 6.283) * r, y: t.c.y + Math.sin((k / 24) * 6.283) * r };
      const pl = g.placedPlan("farm", q);
      if (pl?.deposit && pl.deposit.share < MIN_DEPOSIT && pl.reason?.startsWith("Needs")) bare = q;
    }
    expect(bare).not.toBeNull();
    const no = g.placedPlan("farm", bare!)!;
    expect(no.ok).toBe(false);
    expect(no.deposit!.name).toBe("fertile soil");
    expect(no.reason).toMatch(/^Needs fertile soil: \d+% here, 35% at least$/);
    const m0 = g.money;
    expect(g.place("farm", bare!)).toBeNull();
    expect(g.money).toBe(m0);
    // a food plant needs no deposit, so the preview shows none
    expect(g.placedPlan("foodplant", bare!)?.deposit).toBeUndefined();
  });

  it("farm -> food plant -> town: real trucks carry the loads, the company is paid, and the town grows", () => {
    const g = new Game(7);
    const { t, farm, foodplant } = chain(g);
    expect(g.money).toBeLessThan(START_MONEY - PLANTS.farm.cost - PLANTS.foodplant.cost); // the two plants and the road
    const pop0 = t.pop, households0 = t.households;
    // watch the trucks: crops leave the farm for the food plant, food leaves the food plant for the town's shops
    const seen = { crops: new Set<number>(), food: new Set<number>() };
    let sales = 0;
    const money0 = g.money;
    for (let d = 0; d < 4; d++) {
      run(g, 24, () => {
        for (const v of g.traffic.vehicles) {
          const h = v.trip.haul;
          if (!h || h.leg !== "out") continue;
          if (h.plant === farm.id && h.dest === foodplant.id && h.product === "crops") seen.crops.add(v.id);
          if (h.plant === foodplant.id && h.product === "food" && g.buildings.byId.get(h.dest)?.town === t.id) seen.food.add(v.id);
        }
      });
      sales += g.budgetAvg.income.sales * 24;
    }
    expect(seen.crops.size).toBeGreaterThan(5);
    expect(seen.food.size).toBeGreaterThan(5);
    // the town counted what came in, and it was enough to grow on
    expect(t.yesterday.food ?? 0).toBeGreaterThan(2);
    expect(t.supply.food ?? 0).toBeGreaterThan(0.5);
    expect(t.households).toBeGreaterThan(households0 + 10);
    expect(t.pop).toBeGreaterThan(pop0 * 1.5);
    // money only comes in from deliveries: sales cover the running costs once the chain is going
    expect(sales).toBeGreaterThan(0);
    expect(g.money).toBeGreaterThan(money0 - 8000);
    // the shops have food on the shelves
    const shops = g.buildings.list.filter((b) => b.town === t.id && b.zone === "comLow" && b.built >= 1);
    expect(shops.length).toBeGreaterThan(0);
    expect(shops.filter((b) => b.problem === "Out of food").length).toBeLessThan(shops.length);
  }, 300000);

  it("a town nobody supplies doesn't grow past a hamlet, and its shops run out of food", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    run(g, 5 * 24);
    expect(t.pop).toBeLessThan(90);
    expect(t.supply.food ?? 0).toBe(0);
    const shops = g.buildings.list.filter((b) => b.town === t.id && b.zone === "comLow" && b.built >= 1 && !b.abandoned);
    expect(shops.some((b) => b.problem === "Out of food")).toBe(true);
  }, 300000);

  it("a plant remembers a day of output hour by hour, its figures add up, and a save keeps them", () => {
    const g = new Game(7);
    const { farm } = chain(g);
    // what it can make a day: its kind's batch, its level and its deposit, fully staffed
    const P = farm.plant!;
    const can = (PLANTS.farm.outputs.crops! * levelMult(P.level) * P.yld * DAY) / PLANTS.farm.cycle;
    expect(Industry.perDay(farm, "crops")).toBeCloseTo(can, 6);
    expect(Industry.perDay(farm, "food")).toBe(0);
    let made = 0, last = P.now;
    run(g, 30, () => { if (P.now !== last) { made += last.by?.crops ?? 0; last = P.now; } });
    const m = Industry.madeLately(farm, "crops");
    expect(m.hours).toBe(HIST_HOURS);
    expect(m.byHour).toHaveLength(HIST_HOURS);
    // (the last 24 of the 30 hours it counted)
    expect(m.made).toBeGreaterThan(0);
    expect(m.made).toBeLessThanOrEqual(made);
    // (its first level comes inside a day of work, so it may have grown one by now: no more than its level allows)
    expect(m.made).toBeLessThanOrEqual(((can * levelMult(P.level)) / levelMult(1)) * 1.05);
    expect(m.byHour.reduce((a, v) => a + v, 0)).toBe(m.made);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(Industry.madeLately(h.buildings.byId.get(farm.id)! as Building, "crops")).toEqual(m);
  }, 300000);

  it("a save round-trips the plants (stores, yard, trucks out on the road) and the towns' books", () => {
    const g = new Game(7);
    const { t, farm, foodplant } = chain(g);
    // until there are loads on the road
    let k = 0;
    const out = () => g.traffic.vehicles.filter((v) => v.trip.haul?.leg === "out" && !v.trip.haul.done);
    while (out().length < 1 && k++ < DAY * 30) g.step(1 / 30);
    expect(out().length).toBeGreaterThan(0);
    const onRoad: Record<number, number> = {};
    for (const v of out()) onRoad[v.trip.haul!.plant] = (onRoad[v.trip.haul!.plant] ?? 0) + v.trip.haul!.n;
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    for (const b of [farm, foodplant]) {
      const l = h.buildings.byId.get(b.id)! as Building;
      expect(l.kind).toBe(b.kind);
      expect(l.plant!.stock).toEqual(b.plant!.stock);
      expect(l.plant!.yld).toBeCloseTo(b.plant!.yld, 6);
      expect(h.industry.trucksOf(l)).toBe(g.industry.trucksOf(b));
      // (loads that were on the road are back in the yard, to go out again)
      const yard = (x: Building) => Object.values(x.plant!.out).reduce((a, n) => a + (n ?? 0), 0);
      expect(yard(l)).toBe(yard(b) + (onRoad[b.id] ?? 0));
    }
    const u = h.towns.byId.get(t.id)!;
    expect({ target: u.target, today: u.today, yesterday: u.yesterday, supply: u.supply }).toEqual({ target: t.target, today: t.today, yesterday: t.yesterday, supply: t.supply });
    // and it carries on: the loads go out again and arrive
    let delivered = 0;
    const ev = (h as any).industry;
    const deliver = ev.deliver.bind(ev);
    ev.deliver = (...a: unknown[]) => { delivered++; return deliver(...a); };
    run(h, 6);
    expect(delivered).toBeGreaterThan(0);
  }, 300000);
  it("a plant's fleet comes with its level: nothing to buy, and more trucks as it grows", () => {
    const g = new Game(7);
    const { foodplant } = chain(g);
    const P = foodplant.plant!;
    expect(g.industry.trucksOf(foodplant)).toBe(Industry.fleetAt("foodplant", 1, P.yld) + g.progress.unlocked.bays);
    expect("buyTruck" in g).toBe(false);
    P.level = 3;
    expect(g.industry.trucksOf(foodplant)).toBe(Industry.fleetAt("foodplant", 3, P.yld) + g.progress.unlocked.bays);
    expect(Industry.fleetAt("foodplant", 3)).toBeGreaterThan(Industry.fleetAt("foodplant", 1));
  });
});
