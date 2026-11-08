import { describe, expect, it } from "vitest";
import { Industry, PLANTS, PRODUCTS, FUEL_PER_KM, type IndustryHost, type PlantKind } from "../src/game/industry";
import type { Building } from "../src/game/buildings";
import type { PendingSpawn, Trip, Vehicle } from "../src/sim/traffic";
import { F } from "../src/world/gen";

const HOUR = 40;

/** A tiny world: buildings on numbered road components, everyone fully staffed unless told otherwise. */
function world() {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const pending: PendingSpawn[] = [];
  const staff = new Map<number, number>();
  let money = 0;
  const spent: Record<string, number> = {};
  const host: IndustryHost & { time: number } = {
    time: 0,
    buildings: { list, byId } as any,
    has: (f, p) => f === F.fert && p.x < 1000,
    connected: (a, b) => a === b,
    workersAt: (id) => staff.get(id) ?? byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    // (every shop its own town, always wanting more)
    townOf: (b) => b.id,
    want: () => 10,
    sold: () => {},
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    earn: (v) => { money += v; },
    spend: (v, what) => { money -= v; spent[what] = (spent[what] ?? 0) + v; },
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
    return b;
  };
  const shop = (x: number, comp = 1) => make(x, comp, 3);
  /** a truck reaches the end of its leg */
  const arrive = (p: PendingSpawn) => { pending.splice(pending.indexOf(p), 1); ind.onArrive({ trip: p.trip } as Vehicle); };
  return { host, ind, plant, shop, pending, staff, arrive, get money() { return money; }, spent };
}

describe("Industry", () => {
  it("an extractor works at the pace its staff and deposit allow, and stops when its yard is full", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    farm.plant!.yld = 0.5;
    w.staff.set(farm.id, farm.cap / 2);
    w.ind.produce(farm, PLANTS.farm.cycle * 4);
    // half the staff on half a deposit: a quarter of the full rate
    expect(farm.plant!.out.crops).toBe(1);
    farm.plant!.yld = 1;
    w.staff.set(farm.id, farm.cap);
    for (let i = 0; i < 40; i++) w.ind.produce(farm, HOUR);
    expect(farm.plant!.out.crops).toBe(PLANTS.farm.store);
    expect(farm.problem).toMatch(/^Full of crops/);
  });

  it("a plant waits for its input, then turns it into its product", () => {
    const w = world();
    const fp = w.plant("foodplant", 0);
    w.ind.produce(fp, HOUR * 3);
    expect(fp.plant!.out.food ?? 0).toBe(0);
    expect(fp.problem).toBe("Waiting for crops");
    fp.plant!.stock.crops = 2;
    w.ind.produce(fp, PLANTS.foodplant.cycle * 5);
    expect(fp.plant!.out.food).toBe(2);
    expect(fp.plant!.stock.crops).toBe(0);
    expect(fp.problem).toBe("Waiting for crops");
  });

  it("an extractor's trucks take its loads to a plant short of them, never further than the roads reach", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    w.plant("foodplant", 5000, 2); // on roads the farm's don't join
    const near = w.plant("foodplant", 2000);
    w.shop(500); // shops don't buy crops
    farm.plant!.out.crops = 5;
    w.ind.tick(0);
    // two trucks, two loads, both to the food plant on its roads
    expect(w.pending.length).toBe(PLANTS.farm.trucks);
    for (const p of w.pending) expect(p.trip.haul!.dest).toBe(near.id);
    expect(farm.plant!.out.crops).toBe(3);
    // the fuel for the round trip is paid as they set off
    expect(w.spent.fuel).toBeCloseTo(2 * 2 * 2 * FUEL_PER_KM, 6);
    // no more trucks free
    w.ind.tick(0);
    expect(w.pending.length).toBe(2);
  });

  it("a delivered load stocks the plant; the truck comes home, and only then goes out again", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    const fp = w.plant("foodplant", 1000);
    farm.plant!.trucks = 1;
    farm.plant!.out.crops = 3;
    w.ind.tick(0);
    expect(w.pending.length).toBe(1);
    w.arrive(w.pending[0]);
    expect(fp.plant!.stock.crops).toBe(1);
    // heading home empty
    expect(w.pending.length).toBe(1);
    expect(w.pending[0].trip.haul!.leg).toBe("back");
    w.ind.tick(0);
    expect(w.pending.length).toBe(1);
    w.arrive(w.pending[0]);
    w.ind.tick(0);
    expect(w.pending.length).toBe(1);
    expect(w.pending[0].trip.haul!.leg).toBe("out");
  });

  it("food sells to the towns' shops, the nearest needy one first, and the company is paid on delivery", () => {
    const w = world();
    const fp = w.plant("foodplant", 0);
    const far = w.shop(3000), near = w.shop(400), full = w.shop(100);
    full.stock = 6;
    fp.plant!.out.food = 1;
    w.ind.tick(0);
    expect(w.pending[0].trip.haul!.dest).toBe(near.id);
    const before = w.money;
    w.arrive(w.pending[0]);
    expect(w.money - before).toBe(PRODUCTS.food.price);
    expect(near.stock).toBe(3);
    expect(fp.plant!.now.earned).toBe(PRODUCTS.food.price);
    void far;
  });

  it("with nobody to sell to, the load waits and the plant says why", () => {
    const w = world();
    const fp = w.plant("foodplant", 0);
    w.shop(400, 2);
    fp.plant!.out.food = 3;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(fp.problem).toBe("Nobody your roads reach buys food");
  });

  it("ore waits while the smelter that will take it is still a building site, and the mine says so", () => {
    const w = world();
    const mine = w.plant("ironmine", 0);
    mine.plant!.site = undefined;
    const sm = w.plant("smelter", 300);
    expect(sm.plant!.site).toBeDefined();
    mine.plant!.out.ore = 3;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(mine.problem).toBe("The plants that will use iron ore are still building sites");
    // built: the ore goes
    sm.plant!.site = undefined;
    w.ind.tick(0);
    expect(w.pending.length).toBeGreaterThan(0);
    expect(w.pending[0].trip.haul!.dest).toBe(sm.id);
  });

  it("a truck that can't get through brings its load back to the yard", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    w.plant("foodplant", 1000);
    farm.plant!.out.crops = 1;
    w.ind.tick(0);
    const t = w.pending.pop()!.trip as Trip;
    w.ind.onFail(t);
    w.ind.onFail(t); // reported twice: counted once
    expect(farm.plant!.out.crops).toBe(1);
  });

  it("measures how much of a lot sits on its deposit", () => {
    const w = world();
    expect(w.ind.depositShare(F.fert, { x: 0, y: 0 }, 0, 20, 20)).toBe(1);
    expect(w.ind.depositShare(F.fert, { x: 1000, y: 0 }, 0, 20, 20)).toBeCloseTo(0.4, 6);
    expect(w.ind.depositShare(F.forest, { x: 0, y: 0 }, 0, 20, 20)).toBe(0);
  });

  it("pays wages and upkeep every hour, and keeps each plant's books", () => {
    const w = world();
    const fp = w.plant("foodplant", 0);
    fp.plant!.now.earned = 50;
    w.ind.hourly();
    expect(w.spent.wages).toBe(fp.cap);
    expect(w.spent.upkeep).toBe(PLANTS.foodplant.upkeep);
    expect(fp.plant!.last.earned).toBe(50);
    expect(fp.plant!.last.spent).toBe(fp.cap + PLANTS.foodplant.upkeep);
    expect(fp.plant!.now.earned).toBe(0);
  });

  it("a tier 2 plant starts as a building site: planks go to it first, then it goes up", () => {
    const w = world();
    const mill = w.plant("sawmill", 0);
    const sm = w.plant("smelter", 1000);
    w.shop(200); // a town nearer that would buy the planks
    expect(sm.plant!.site).toEqual({ need: { planks: PLANTS.smelter.site!.planks }, got: {} });
    // a site makes nothing, draws no wages or upkeep, and says what it waits for
    w.ind.produce(sm, HOUR);
    expect(sm.problem).toBe(`Building site: waiting for ${PLANTS.smelter.site!.planks} loads of planks`);
    w.ind.hourly();
    expect(w.spent.wages ?? 0).toBe(mill.cap);
    expect(w.spent.upkeep).toBe(PLANTS.sawmill.upkeep);
    mill.plant!.out.planks = 4;
    w.ind.tick(0);
    expect(w.pending.length).toBe(PLANTS.sawmill.trucks);
    for (const p of w.pending) expect(p.trip.haul!.dest).toBe(sm.id);
    while (w.pending.length) w.arrive(w.pending.find((p) => p.trip.haul!.leg === "out") ?? w.pending[0]);
    expect(sm.plant!.site!.got.planks).toBe(PLANTS.sawmill.trucks);
    // the last loads complete it: the site is gone and the building goes up from nothing
    w.ind.deliver(sm, "planks", 20, mill);
    expect(sm.plant!.site).toBeUndefined();
    expect(sm.built).toBe(0);
    // (more than it needed is left on the ground: a smelter's yard ships only steel, so it would sit there for good)
    expect(sm.plant!.out.planks ?? 0).toBe(0);
    expect(Industry.running(sm)).toBe(false);
    sm.built = 1;
    expect(Industry.running(sm)).toBe(true);
  });

  it("a truck carries as many loads as the milestones allow, and the bays add trucks", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    const fp = w.plant("foodplant", 1000);
    (w.host as { load?: () => number }).load = () => 2;
    (w.host as { bays?: () => number }).bays = () => 1;
    expect(w.ind.trucksOf(farm)).toBe(PLANTS.farm.trucks + 1);
    farm.plant!.out.crops = 7;
    w.ind.tick(0);
    expect(w.pending.length).toBe(3);
    expect(w.pending.map((p) => p.trip.haul!.n)).toEqual([2, 2, 2]);
    expect(farm.plant!.out.crops).toBe(1);
    w.arrive(w.pending[0]);
    expect(fp.plant!.stock.crops).toBe(2);
    // a power plant runs no trucks, bays or not
    const pp = w.plant("coalplant", 500);
    expect(w.ind.trucksOf(pp)).toBe(0);
  });

  it("a power plant burns coal only while wanted; a building short of power works slower", () => {
    const w = world();
    const pp = w.plant("coalplant", 0);
    delete pp.plant!.site;
    pp.plant!.stock.coal = 3;
    let wanted = false, share = 1;
    (w.host as { wanted?: () => boolean }).wanted = () => wanted;
    (w.host as { power?: () => number }).power = () => share;
    w.ind.produce(pp, PLANTS.coalplant.cycle * 2);
    expect(pp.plant!.stock.coal).toBe(3);
    expect(pp.problem).toMatch(/^Idle/);
    wanted = true;
    w.ind.produce(pp, PLANTS.coalplant.cycle * 1.01);
    expect(pp.plant!.stock.coal).toBe(2);
    // a smelter: full pace with power, 40% with none
    const sm = w.plant("smelter", 100);
    delete sm.plant!.site;
    sm.plant!.stock = { ore: 8, coal: 8 };
    w.ind.produce(sm, PLANTS.smelter.cycle * 2.5);
    expect(sm.plant!.out.steel).toBe(2);
    share = 0;
    sm.plant!.prog = 0;
    w.ind.produce(sm, PLANTS.smelter.cycle * 2.5);
    expect(sm.plant!.out.steel).toBe(3);
    expect(sm.problem).toBe("No power: working at 40%");
    share = 0.5;
    w.ind.produce(sm, PLANTS.smelter.cycle * 0.1);
    expect(sm.problem).toBe("Short of power: working at 70%");
  });

  it("steel waits in the yard until tier 3, and the smelter says so", () => {
    const w = world();
    const sm = w.plant("smelter", 0);
    delete sm.plant!.site;
    w.shop(100);
    sm.plant!.out.steel = PLANTS.smelter.store;
    sm.plant!.stock = { ore: 2, coal: 2 };
    w.ind.tick(HOUR);
    expect(w.pending.length).toBe(0);
    expect(sm.problem).toBe("Full of steel: nothing uses it until tier 3");
  });
});
