// The deeper chains (docs/design.md "Supplies", "Perishables", "Alternate inputs", "Motor Works"): supplies fed back
// up the chain to the sites past level 2, the Motor Works that stops on any missing input and the cars that put a
// town on the road, milk that loses value on a long or jammed haul, and the by-products another plant takes.

import { describe, expect, it } from "vitest";
import { v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import {
  Industry, PLANTS, SHELF, SPOIL_FLOOR, SUPPLY_USE, freshness, suppliesAt, type Delivery, type IndustryHost, type PlantKind,
  type Product,
} from "../src/game/industry";
import type { Building } from "../src/game/buildings";
import { GROW_NEED, levelMult } from "../src/game/sites";
import { MOTOR_MAX, buys, motoring } from "../src/game/towns";
import { WALK, carOdds, walkReach } from "../src/game/society";
import { MILESTONES } from "../src/game/progression";
import type { PendingSpawn, Vehicle } from "../src/sim/traffic";
import { F } from "../src/world/gen";

/** A tiny world (as in industry.test.ts): buildings on numbered road components, fully staffed, every shop its own town. */
function world(canMake?: (p: Product) => boolean) {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const pending: PendingSpawn[] = [];
  let money = 0;
  const sold: [number, Product, number][] = [];
  const delivered: Delivery[] = [];
  const shipped: [number, number, Product][] = [];
  const host: IndustryHost & { time: number } = {
    time: 0,
    buildings: { list, byId } as any,
    has: (f, p) => f === F.fert && p.x < 1000,
    connected: (a, b) => a === b,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    townOf: (b) => b.id,
    want: () => 10,
    sold: (t, p, n) => { sold.push([t, p, n]); },
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    earn: (v) => { money += v; },
    spend: (v) => { money -= v; },
    canMake,
    delivered: (d) => { delivered.push(d); },
    shipped: (a, b, p) => { shipped.push([a.id, b.id, p]); },
  };
  const ind = new Industry(host);
  let id = 1;
  const make = (x: number, comp: number, cap: number): Building => {
    const b = { id: id++, kind: "shop", c: { x, y: 0 }, rot: 0, hw: 10, hd: 10, front: { x, y: 0 }, access: { seg: comp, t: 0.5 } as any, side: 1, level: 1, cap, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0 } as Building;
    list.push(b);
    byId.set(b.id, b);
    return b;
  };
  const plant = (kind: PlantKind, x: number, comp = 1) => {
    const b = make(x, comp, 8);
    b.kind = kind as any;
    ind.init(b, kind);
    // (built already: tier 2 on starts as a site waiting for its materials)
    delete b.plant!.site;
    b.plant!.yld = 1;
    return b;
  };
  const shop = (x: number, comp = 1) => make(x, comp, 3);
  const arrive = (p: PendingSpawn) => { pending.splice(pending.indexOf(p), 1); ind.onArrive({ trip: p.trip } as Vehicle); };
  return { host, ind, plant, shop, pending, arrive, sold, delivered, shipped, get money() { return money; } };
}

describe("Supplies", () => {
  it("farms need fertilizer and mines explosives from level 3, and every site machinery at level 4 (not the machine works)", () => {
    expect(suppliesAt("farm", 2)).toEqual([]);
    expect(suppliesAt("farm", 3)).toEqual(["fertilizer"]);
    expect(suppliesAt("farm", 4)).toEqual(["fertilizer", "machinery"]);
    for (const k of ["ironmine", "coalmine", "quarry", "oilwell", "sandpit", "coppermine"] as PlantKind[]) expect(suppliesAt(k, 3)).toEqual(["explosives"]);
    expect(suppliesAt("loggingcamp", 3)).toEqual([]);
    expect(suppliesAt("smelter", 4)).toEqual(["machinery"]);
    expect(suppliesAt("machineworks", 4)).toEqual([]);
    expect(suppliesAt("warehouse", 4)).toEqual([]);
  });

  it("a site draws its supply down as it works, and out of it slips to its level-2 pace (not to nothing) and says why", () => {
    const w = world(() => true);
    const farm = w.plant("farm", 0);
    farm.plant!.level = 3;
    farm.plant!.stock.fertilizer = 1;
    w.ind.produce(farm, PLANTS.farm.cycle);
    // level 3: three batches, each using a little fertilizer
    expect(farm.plant!.out.crops).toBe(3);
    expect(farm.plant!.stock.fertilizer).toBeCloseTo(1 - 3 * SUPPLY_USE, 6);
    expect(farm.problem).toBeNull();
    farm.plant!.out.crops = 0;
    farm.plant!.stock.fertilizer = 0;
    w.ind.produce(farm, PLANTS.farm.cycle);
    expect(farm.plant!.out.crops).toBe(2);
    expect(farm.problem).toBe("Out of fertilizer: working at its level 2 pace");
    // a level-4 farm with fertilizer but no machinery works at its level-3 pace
    farm.plant!.level = 4;
    farm.plant!.out.crops = 0;
    farm.plant!.stock.fertilizer = 2;
    w.ind.produce(farm, PLANTS.farm.cycle);
    expect(farm.plant!.out.crops).toBe(3);
    expect(farm.problem).toBe("Out of machinery: working at its level 3 pace");
  });

  it("nothing is asked of a site until the company can make the supply", () => {
    const w = world(() => false);
    const mine = w.plant("coalmine", 0);
    mine.plant!.level = 3;
    w.ind.produce(mine, PLANTS.coalmine.cycle);
    expect(mine.plant!.out.coal).toBe(3);
    expect(mine.problem).toBeNull();
  });

  it("growing to the next level needs that level's supply in store", () => {
    const w = world(() => true);
    const farm = w.plant("farm", 0);
    farm.plant!.level = 2;
    farm.plant!.grow = GROW_NEED - 0.5;
    w.ind.produce(farm, 1);
    expect(farm.plant!.level).toBe(2);
    expect(farm.plant!.why).toBe("Needs fertilizer to grow to level 3");
    // a site keeps a store of its next level's supply, so the trucks bring it some
    expect(Industry.wantsSupply(farm)).toEqual(["fertilizer"]);
    farm.plant!.stock.fertilizer = 1;
    farm.plant!.grow = GROW_NEED - 0.5;
    w.ind.produce(farm, 1);
    expect(farm.plant!.level).toBe(3);
  });

  it("the chemical works' trucks take explosives to a mine that wants them, and fertilizer to a farm", () => {
    const w = world(() => true);
    const chem = w.plant("chemworks", 0);
    const mine = w.plant("quarry", 600);
    const farm = w.plant("farm", 900);
    mine.plant!.level = 3;
    farm.plant!.level = 2;
    chem.plant!.out = { fertilizer: 1, explosives: 1 };
    w.ind.trucksOf = () => 2;
    w.ind.tick(0);
    const to = Object.fromEntries(w.pending.map((p) => [p.trip.haul!.product, p.trip.haul!.dest]));
    expect(to).toEqual({ explosives: mine.id, fertilizer: farm.id });
  });
});

describe("Supply boosts (the badge by the gate, the panel's +N%)", () => {
  it("each supply in store is worth what its site would lose without it, and asking leaves the stock as it was", () => {
    const w = world(() => true);
    const farm = w.plant("farm", 0);
    farm.plant!.level = 3;
    expect(w.ind.boosts(farm)).toEqual([]);
    farm.plant!.stock.fertilizer = 1;
    expect(w.ind.boosts(farm)).toEqual([{ p: "fertilizer", pct: Math.round((levelMult(3) / levelMult(2) - 1) * 100) }]);
    // at level 4: without fertilizer it would drop to its level-2 pace, without machinery to its level-3 pace
    farm.plant!.level = 4;
    farm.plant!.stock.machinery = 1;
    expect(w.ind.boosts(farm)).toEqual([
      { p: "fertilizer", pct: Math.round((levelMult(4) / levelMult(2) - 1) * 100) },
      { p: "machinery", pct: Math.round((levelMult(4) / levelMult(3) - 1) * 100) },
    ]);
    expect(farm.plant!.stock).toMatchObject({ fertilizer: 1, machinery: 1 });
    expect(farm.plant!.stock.explosives).toBeUndefined();
    // a supply the company can't make yet boosts nothing (nothing is asked of the site either)
    const w2 = world(() => false);
    const f2 = w2.plant("farm", 0);
    f2.plant!.level = 3;
    f2.plant!.stock.fertilizer = 1;
    expect(w2.ind.boosts(f2)).toEqual([]);
  });
});

describe("Moments (the map's pops and the ticker)", () => {
  it("every load handed over is reported with its pay, and a perishable with how fresh it came and what it lost", () => {
    const w = world();
    const dairy = w.plant("dairyfarm", 0);
    const shop = w.shop(800);
    dairy.plant!.out.milk = 4;
    w.ind.trucksOf = () => 2;
    w.ind.tick(0);
    const [a, b] = w.pending;
    w.host.time = a.trip.startT + 60;
    w.arrive(a);
    expect(w.delivered.at(-1)).toMatchObject({ to: shop, from: dairy, product: "milk", fresh: 1, lost: 0 });
    expect(w.delivered.at(-1)!.pay).toBeGreaterThan(0);
    w.host.time = b.trip.startT + SHELF.milk! * 1.5;
    w.arrive(b);
    const late = w.delivered.at(-1)!;
    expect(late.fresh).toBeLessThan(1);
    expect(late.lost).toBeCloseTo(900 * b.trip.haul!.n * (1 - late.fresh), 3);
  });

  it("a by-product leaving its plant is reported as its own cargo; the main product is not", () => {
    const w = world();
    const saw = w.plant("sawmill", 0);
    const cp = w.plant("coalplant", 700);
    w.plant("furniture", 900);
    saw.plant!.out.chips = 1;
    saw.plant!.out.planks = 1;
    w.ind.trucksOf = () => 2;
    w.ind.tick(0);
    expect(w.pending.map((p) => p.trip.haul!.product).sort()).toEqual(["chips", "planks"]);
    expect(w.shipped).toEqual([[saw.id, cp.id, "chips"]]);
  });
});

describe("Motor Works", () => {
  it("turns steel, glass, rubber and electronics into cars, and stops if any one runs dry", () => {
    const w = world();
    const mw = w.plant("motorworks", 0);
    mw.plant!.stock = { steel: 5, glass: 5, rubber: 5 };
    w.ind.produce(mw, PLANTS.motorworks.cycle * 2);
    expect(mw.plant!.out.cars ?? 0).toBe(0);
    expect(mw.problem).toBe("Waiting for electronics");
    mw.plant!.stock.electronics = 1;
    w.ind.produce(mw, PLANTS.motorworks.cycle * 2);
    expect(mw.plant!.out.cars).toBe(1);
    expect(mw.plant!.stock).toMatchObject({ steel: 4, glass: 4, rubber: 4, electronics: 0 });
    expect(mw.problem).toBe("Waiting for electronics");
  });

  it("unlocks after tier 4, and the rubber plant before it", () => {
    const at = (id: string) => MILESTONES.findIndex((m) => m.id === id);
    const unlock = (k: PlantKind) => MILESTONES.findIndex((m) => m.unlocks.buildings?.includes(k));
    expect(unlock("motorworks")).toBeGreaterThan(at("machinery1"));
    expect(unlock("motorworks")).toBeGreaterThan(unlock("rubberplant"));
    expect(PLANTS.motorworks.tier).toBe(5);
    expect(PLANTS.rubberplant.tier).toBe(5);
    expect(PLANTS.rubberplant.inputs.plastics).toBeGreaterThan(0);
  });

  it("cars sell to Towns and Cities, and each load puts more of a town's people in their cars, capped", () => {
    expect(buys(1000, "cars")).toBe(false);
    expect(buys(1500, "cars")).toBe(true);
    expect(motoring(0, 400)).toBe(0);
    expect(motoring(10, 400)).toBeCloseTo(MOTOR_MAX * 0.1, 6);
    expect(motoring(10_000, 400)).toBe(MOTOR_MAX);
    // a motoring town drives more of its trips, and walks only the shortest
    expect(carOdds(10, 0)).toBeCloseTo(0.1, 6);
    expect(carOdds(10, MOTOR_MAX)).toBeCloseTo(0.15, 6);
    expect(walkReach(0)).toBe(WALK);
    expect(walkReach(MOTOR_MAX)).toBe(WALK / 2);
  });

  it("a town counts the cars sold to it, and scraps a few each day", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    expect(g.towns.motorOf(t.id)).toBe(0);
    g.towns.sold(t.id, "cars", 2);
    expect(t.cars).toBe(2);
    expect(g.towns.motorOf(t.id)).toBeGreaterThan(0);
    g.towns.daily();
    expect(t.cars).toBeLessThan(2);
    expect(t.cars).toBeGreaterThan(1.9);
  }, 30000);
});

describe("Perishables", () => {
  it("keep full value up to their shelf time, then lose it to a floor at twice that", () => {
    const s = SHELF.milk!;
    expect(freshness("milk", 0)).toBe(1);
    expect(freshness("milk", s)).toBe(1);
    expect(freshness("milk", s * 1.5)).toBeCloseTo(1 - (1 - SPOIL_FLOOR) / 2, 6);
    expect(freshness("milk", s * 2)).toBeCloseTo(SPOIL_FLOOR, 6);
    expect(freshness("milk", s * 5)).toBe(SPOIL_FLOOR);
    expect(freshness("food", s * 5)).toBe(1);
    expect(SHELF.cheese!).toBeGreaterThan(s * 2);
    // a good 6 km road at street speed (~12 m/s with its junctions) gets milk there fresh
    expect(6000 / 12).toBeLessThan(s);
  });

  it("a late load is paid for what is left of it, and the dairy's books show what spoiled", () => {
    const w = world();
    const dairy = w.plant("dairyfarm", 0);
    w.shop(800);
    dairy.plant!.out.milk = 2;
    w.ind.trucksOf = () => 1;
    w.ind.tick(0);
    expect(w.pending.length).toBe(1);
    const load = w.pending[0], n = load.trip.haul!.n;
    w.host.time = SHELF.milk! * 1.5;
    const before = w.money;
    w.arrive(load);
    const fresh = 1 - (1 - SPOIL_FLOOR) / 2;
    expect(w.money - before).toBeCloseTo(900 * n * fresh, 3);
    expect(dairy.plant!.now.perish).toBe(n);
    expect(dairy.plant!.now.fresh ?? 0).toBe(0);
    expect(dairy.plant!.now.spoiled).toBeCloseTo(900 * n * (1 - fresh), 3);
    // the next one gets there in time
    w.arrive(w.pending[0]); // (home)
    w.ind.tick(0);
    const next = w.pending[0];
    w.host.time = next.trip.startT + 60;
    w.arrive(next);
    expect(dairy.plant!.fresh).toBe(next.trip.haul!.n);
    expect(dairy.plant!.perish).toBe(n + next.trip.haul!.n);
  });

  it("a creamery stocks only the good part of a late load of milk, and a warehouse never takes milk", () => {
    const w = world();
    const dairy = w.plant("dairyfarm", 0);
    const cr = w.plant("creamery", 500);
    w.plant("warehouse", 300);
    dairy.plant!.out.milk = 1;
    w.ind.trucksOf = () => 1;
    w.ind.tick(0);
    expect(w.pending.length).toBe(1);
    expect(w.pending[0].trip.haul!.dest).toBe(cr.id);
    const n = w.pending[0].trip.haul!.n;
    w.host.time = SHELF.milk! * 2;
    w.arrive(w.pending[0]);
    expect(cr.plant!.stock.milk).toBeCloseTo(n * SPOIL_FLOOR, 6);
  });
});

describe("Alternate inputs and by-products", () => {
  it("a cement works burns the smelter's slag in place of limestone, and a power plant the sawmill's chips in place of coal", () => {
    const w = world();
    const cw = w.plant("cementworks", 0);
    cw.plant!.stock = { slag: 2, coal: 2 };
    w.ind.produce(cw, PLANTS.cementworks.cycle);
    expect(cw.plant!.out.cement).toBe(1);
    expect(cw.plant!.stock).toMatchObject({ slag: 1, coal: 1 });
    // limestone and slag both on hand: the slag goes first (it would otherwise be flared at the smelter)
    cw.plant!.stock = { lime: 1, slag: 1, coal: 2 };
    w.ind.produce(cw, PLANTS.cementworks.cycle);
    expect(cw.plant!.stock).toMatchObject({ lime: 1, slag: 0 });
    cw.plant!.stock = { coal: 2 };
    w.ind.produce(cw, PLANTS.cementworks.cycle);
    expect(cw.problem).toBe("Waiting for limestone or slag");
    const cp = w.plant("coalplant", 2000, 2);
    cp.plant!.stock = { chips: 1 };
    w.ind.produce(cp, PLANTS.coalplant.cycle);
    expect(cp.plant!.stock.chips).toBe(0);
  });

  it("the sawmill's trucks take chips to a power plant, and the smelter's slag to a cement works", () => {
    const w = world();
    const saw = w.plant("sawmill", 0);
    const cp = w.plant("coalplant", 700);
    const sm = w.plant("smelter", 3000, 2);
    const cw = w.plant("cementworks", 3500, 2);
    saw.plant!.out.chips = 1;
    sm.plant!.out.slag = 1;
    w.ind.trucksOf = () => 1;
    w.ind.tick(0);
    const to = Object.fromEntries(w.pending.map((p) => [p.trip.haul!.product, p.trip.haul!.dest]));
    expect(to).toEqual({ chips: cp.id, slag: cw.id });
  });

  it("a full yard of slag is flared: the smelter keeps making steel, and the slag never sizes its fleet", () => {
    const w = world();
    const sm = w.plant("smelter", 0);
    const store = Industry.storeOf(sm);
    sm.plant!.out.slag = store;
    sm.plant!.stock = { ore: 3, coal: 3 };
    w.ind.produce(sm, PLANTS.smelter.cycle * 2);
    expect(sm.plant!.out.steel).toBe(2);
    expect(Industry.flaring(sm)).toBe("slag");
    expect(sm.problem ?? "").not.toMatch(/^Full/);
    const d = PLANTS.smelter, by = d.byproduct;
    d.byproduct = undefined;
    const counted = Industry.fleetAt("smelter", 4);
    d.byproduct = by;
    expect(Industry.fleetAt("smelter", 4)).toBeLessThan(counted);
  });
});

describe("Saves", () => {
  it("keep a town's cars and a dairy's fresh-delivery books; saves without them still load", () => {
    const g = new Game(7);
    g.start();
    g.unlockAll();
    g.money = 1e7;
    const t = g.towns.list[0];
    t.cars = 2.5;
    const spot = (): V2 => {
      for (let r = 400; r < 4000; r += 150) for (let k = 0; k < 24; k++) {
        const p = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
        if (g.placedPlan("creamery", p)?.ok) return p;
      }
      throw new Error("no open ground");
    };
    const cr = g.place("creamery", spot())!;
    cr.plant!.perish = 5;
    cr.plant!.fresh = 4;
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.towns.byId.get(t.id)!.cars).toBe(2.5);
    expect(h.buildings.byId.get(cr.id)!.plant).toMatchObject({ perish: 5, fresh: 4 });
    // an older save: no cars, no perishable books
    delete json.towns.towns[0].cars;
    const b = json.buildings.find((x: { id: number }) => x.id === cr.id);
    delete b.plant.perish;
    delete b.plant.fresh;
    const old = Game.load(json);
    expect(old.towns.motorOf(t.id)).toBe(0);
    expect(old.buildings.byId.get(cr.id)!.plant!.perish).toBeUndefined();
  }, 60000);
});
