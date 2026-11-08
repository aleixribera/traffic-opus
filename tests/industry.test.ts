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
  const held = new Map<Trip, "gate" | "road">();
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
    held: () => held,
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
  return { host, ind, plant, shop, pending, staff, arrive, held, get money() { return money; }, spent };
}

describe("Industry", () => {
  it("a full site whose trucks are held up says the road is jammed (not a long haul or no buyer), and so does its customer", () => {
    const w = world();
    const farm = w.plant("farm", 0), fp = w.plant("foodplant", 50);
    for (let i = 0; i < 60; i++) w.ind.tick(HOUR);
    const out = w.pending.filter((p) => p.trip.haul?.leg === "out");
    expect(out.length).toBeGreaterThan(2);
    // everything moving: the usual lines
    expect(farm.problem).toMatch(/^Full of crops: its trucks can't keep up/);
    // most of its trucks still in the yard, the road outside jammed
    for (const p of out) w.held.set(p.trip, "gate");
    w.ind.tick(1);
    expect(farm.problem).toBe("Full of crops: the road at its gate is jammed, its trucks can't get out");
    expect(fp.problem).toBe("Waiting for crops: the loads on their way are stuck in traffic");
    // out on the road, standing in traffic
    for (const p of out) w.held.set(p.trip, "road");
    w.ind.tick(1);
    expect(farm.problem).toBe("Full of crops: its trucks are stuck in traffic on the haul (a jammed road)");
    // moving again
    w.held.clear();
    w.ind.tick(1);
    expect(farm.problem).toMatch(/^Full of crops: its trucks can't keep up/);
    expect(fp.problem).toBe("Waiting for crops");
  });

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
    w.ind.trucksOf = () => 2;
    w.ind.tick(0);
    // two trucks, two loads, both to the food plant on its roads
    expect(w.pending.length).toBe(2);
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
    w.ind.trucksOf = () => 1;
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

  it("construction is a real haul (owner, 2026-11-08: \"waaaaay tougher\"): every site from tier 2 waits for dozens of loads", () => {
    for (const k of Object.keys(PLANTS) as (keyof typeof PLANTS)[]) {
      const d = PLANTS[k];
      if (d.tier < 2 || !d.site) continue;
      const loads = Object.values(d.site).reduce((a, n) => a + (n ?? 0), 0);
      expect(loads, k).toBeGreaterThanOrEqual(30);
    }
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
    // (its fleet has a truck for every load in the yard)
    expect(w.pending.length).toBe(4);
    for (const p of w.pending) expect(p.trip.haul!.dest).toBe(sm.id);
    while (w.pending.length) w.arrive(w.pending.find((p) => p.trip.haul!.leg === "out") ?? w.pending[0]);
    expect(sm.plant!.site!.got.planks).toBe(4);
    // the last loads complete it: the site is gone and the building goes up from nothing
    w.ind.deliver(sm, "planks", PLANTS.smelter.site!.planks!, mill);
    expect(sm.plant!.site).toBeUndefined();
    expect(sm.built).toBe(0);
    // (more than it needed is left on the ground: a smelter's yard ships only steel, so it would sit there for good)
    expect(sm.plant!.out.planks ?? 0).toBe(0);
    expect(Industry.running(sm)).toBe(false);
    sm.built = 1;
    expect(Industry.running(sm)).toBe(true);
  });

  it("a truck carries its class's payload and a site's fleet is its level's: nothing from milestones; a capped site waits for its goal", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    const fp = w.plant("foodplant", 1000);
    expect(w.ind.trucksOf(farm)).toBe(Industry.fleetAt("farm", 1));
    farm.plant!.out.crops = 3;
    w.ind.tick(0);
    // light trucks: one load each
    expect(w.pending.map((p) => p.trip.haul!.n)).toEqual(w.pending.map(() => 1));
    w.arrive(w.pending[0]);
    expect(fp.plant!.stock.crops).toBe(1);
    // a power plant runs no trucks
    const pp = w.plant("coalplant", 500);
    expect(w.ind.trucksOf(pp)).toBe(0);
    // at its kind's cap a site stops growing and names the goal that opens its next level
    (w.host as { levelCap?: () => { level: number; goal?: string } }).levelCap = () => ({ level: 2, goal: "Sawn timber" });
    farm.plant!.level = 2;
    farm.plant!.grow = 5;
    (w.ind as unknown as { growth(b: unknown, span: number, working: boolean, staff: number, pw: number, store: number): void }).growth(farm, 100, true, 1, 1, 10);
    expect(farm.plant!.why).toBe('Level 3 opens with the goal "Sawn timber"');
    expect(farm.plant!.grow).toBe(0);
    expect(farm.plant!.level).toBe(2);
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

  it("steel goes to a construction plant; with none on its roads, the smelter says which plant takes it", () => {
    const w = world();
    const sm = w.plant("smelter", 0);
    delete sm.plant!.site;
    w.shop(100);
    sm.plant!.out.steel = PLANTS.smelter.store;
    sm.plant!.stock = { ore: 2, coal: 2 };
    w.ind.tick(HOUR);
    expect(w.pending.length).toBe(0);
    expect(sm.problem).toBe("Full of steel: its trucks can't keep up (a long or jammed haul), or no construction plant, machine works or motor works on its roads");
    sm.plant!.out.steel = 2;
    sm.problem = null;
    w.ind.tick(0);
    expect(sm.problem).toBe("No construction plant, machine works or motor works on your roads takes steel");
    const cp = w.plant("constructionplant", 400);
    delete cp.plant!.site;
    w.ind.tick(0);
    expect(w.pending.length).toBeGreaterThan(0);
    expect(w.pending[0].trip.haul!.dest).toBe(cp.id);
  });
});

describe("Tier 3 chains", () => {
  const ready = (w: ReturnType<typeof world>, kind: PlantKind, x: number) => {
    const b = w.plant(kind, x);
    delete b.plant!.site;
    return b;
  };

  it("the oil well and the sand pit draw crude and sand from their deposits, with no power", () => {
    const w = world();
    for (const [kind, out] of [["oilwell", "crude"], ["sandpit", "sand"]] as const) {
      expect(PLANTS[kind].deposit!.field).toBe(kind === "oilwell" ? F.oil : F.sand);
      expect(PLANTS[kind].power ?? 0).toBe(0);
      expect(PLANTS[kind].tier).toBe(3);
      const b = ready(w, kind, 0);
      b.plant!.yld = 1;
      w.ind.produce(b, PLANTS[kind].cycle * 3.01);
      expect(b.plant!.out[out]).toBe(3);
      expect(b.problem).toBeNull();
    }
  });

  it("each plant turns its inputs into its outputs: glass, household goods, construction parts", () => {
    const cases: [PlantKind, Record<string, number>, string][] = [
      ["glassworks", { sand: 4, coal: 4 }, "glass"],
      ["furniture", { planks: 4, glass: 4 }, "goods"],
      ["constructionplant", { steel: 4, cement: 4 }, "parts"],
    ];
    for (const [kind, stock, out] of cases) {
      const w = world();
      const b = ready(w, kind, 0);
      expect(Object.keys(PLANTS[kind].inputs).sort()).toEqual(Object.keys(stock).sort());
      b.plant!.stock = { ...stock };
      w.ind.produce(b, PLANTS[kind].cycle * 2.01);
      expect(b.plant!.out[out as never], kind).toBe(2);
      for (const p of Object.keys(stock)) expect(b.plant!.stock[p as never], `${kind} ${p}`).toBe(2);
      // and it waits once an input runs out
      const first = Object.keys(stock)[0];
      b.plant!.stock = { ...stock, [first]: 0 };
      w.ind.produce(b, PLANTS[kind].cycle);
      expect(b.problem).toBe(`Waiting for ${PRODUCTS[first as keyof typeof PRODUCTS].name.toLowerCase()}`);
    }
  });

  it("the refinery splits crude into fuel and plastics; it flares the plastics once its yard is full and keeps making fuel", () => {
    const w = world();
    const rf = ready(w, "refinery", 0);
    expect(PLANTS.refinery.outputs).toEqual({ fuel: 1, plastics: 1 });
    rf.plant!.stock.crude = 10;
    w.ind.produce(rf, PLANTS.refinery.cycle * 2.01);
    expect(rf.plant!.out).toEqual({ fuel: 2, plastics: 2 });
    expect(rf.plant!.stock.crude).toBe(8);
    // plastics full: no problem, fuel goes on
    const store = Industry.storeOf(rf);
    rf.plant!.out.plastics = store;
    w.ind.produce(rf, PLANTS.refinery.cycle * 2.01);
    expect(rf.plant!.out.fuel).toBe(4);
    expect(rf.plant!.out.plastics).toBe(store);
    expect(rf.problem).toBeNull();
    expect(Industry.flaring(rf)).toBe("plastics");
    // its trucks never take plastics anywhere (nothing uses them until tier 4), and say nothing about it
    rf.plant!.out.fuel = 0;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(rf.problem ?? "").not.toMatch(/plastics/);
    // both full: it stops, on the fuel
    rf.plant!.out.fuel = store;
    w.ind.produce(rf, PLANTS.refinery.cycle * 2);
    expect(rf.plant!.stock.crude).toBe(6);
    expect(rf.problem).toMatch(/^Full of fuel/);
    expect(Industry.laterTier("plastics")).toBe(4);
  });

  it("the refinery, glassworks and construction plant draw power; the furniture factory does not", () => {
    for (const k of ["refinery", "glassworks", "constructionplant"] as PlantKind[]) expect(PLANTS[k].power, k).toBeGreaterThan(0);
    expect(PLANTS.furniture.power ?? 0).toBe(0);
    const w = world();
    let share = 0;
    (w.host as { power?: () => number }).power = () => share;
    const gw = ready(w, "glassworks", 0);
    gw.plant!.stock = { sand: 9, coal: 9 };
    w.ind.produce(gw, PLANTS.glassworks.cycle * 5.01);
    expect(gw.plant!.out.glass).toBe(2); // 40% of 5
    expect(gw.problem).toBe("No power: working at 40%");
    share = 1;
    gw.plant!.prog = 0;
    w.ind.produce(gw, PLANTS.glassworks.cycle * 2.01);
    expect(gw.plant!.out.glass).toBe(4);
  });

  it("a tier 3 plant's building site waits for planks and cement, and the sawmill and cement works send them there first", () => {
    const w = world();
    const mill = ready(w, "sawmill", 0);
    const cw = ready(w, "cementworks", 100);
    const rf = w.plant("refinery", 2000);
    w.shop(50);
    for (const k of ["oilwell", "sandpit", "refinery", "glassworks", "furniture", "constructionplant"] as PlantKind[]) {
      const s = PLANTS[k].site!;
      expect(s.planks, k).toBeGreaterThan(0);
      expect(s.cement, k).toBeGreaterThan(0);
    }
    expect(rf.plant!.site).toEqual({ need: { ...PLANTS.refinery.site }, got: {} });
    w.ind.produce(rf, HOUR);
    expect(rf.problem).toBe(`Building site: waiting for ${PLANTS.refinery.site!.planks} loads of planks and ${PLANTS.refinery.site!.cement} loads of cement`);
    mill.plant!.out.planks = 2;
    cw.plant!.out.cement = 2;
    w.ind.tick(0);
    expect(w.pending.length).toBeGreaterThan(0);
    for (const p of w.pending) expect(p.trip.haul!.dest).toBe(rf.id);
    w.ind.deliver(rf, "planks", PLANTS.refinery.site!.planks!, mill);
    expect(rf.plant!.site).toBeDefined();
    w.ind.deliver(rf, "cement", PLANTS.refinery.site!.cement!, cw);
    expect(rf.plant!.site).toBeUndefined();
    expect(rf.built).toBe(0);
  });

  it("each chain's trucks take its product on to the next plant: crude to the refinery, sand to the glassworks, glass to the furniture factory", () => {
    const w = world();
    const well = ready(w, "oilwell", 0), pit = ready(w, "sandpit", 50), gw = ready(w, "glassworks", 300);
    const rf = ready(w, "refinery", 600), ff = ready(w, "furniture", 900);
    well.plant!.out.crude = 1;
    pit.plant!.out.sand = 1;
    gw.plant!.out.glass = 1;
    w.ind.tick(0);
    const dest = new Map(w.pending.map((p) => [p.trip.haul!.product, p.trip.haul!.dest]));
    expect(dest.get("crude")).toBe(rf.id);
    expect(dest.get("sand")).toBe(gw.id);
    expect(dest.get("glass")).toBe(ff.id);
  });

  it("fuel goes to a town's filling station once it has one, to its shops until then; goods go to the shops", () => {
    const w = world();
    (w.host as { townOf: (b: Building) => number | null }).townOf = (b) => b.town ?? null;
    const rf = ready(w, "refinery", 0);
    const ff = ready(w, "furniture", 10);
    const shopA = w.shop(300), shopB = w.shop(5000), station = w.shop(4000);
    shopA.town = 1; shopB.town = 2; station.town = 2;
    station.kind = "fuelstation";
    station.built = 0; // still going up: the town's shops take its fuel
    let custs = w.ind.customers(rf, "fuel").map((c) => c.b.id);
    expect(custs).toContain(shopA.id);
    expect(custs).toContain(shopB.id);
    expect(custs).not.toContain(station.id);
    station.built = 1;
    custs = w.ind.customers(rf, "fuel").map((c) => c.b.id);
    expect(custs).toContain(station.id);
    expect(custs).toContain(shopA.id); // town 1 has no station
    expect(custs).not.toContain(shopB.id);
    // goods never go to a filling station
    const goods = w.ind.customers(ff, "goods").map((c) => c.b.id);
    expect(goods).toContain(shopB.id);
    expect(goods).not.toContain(station.id);
    expect(PRODUCTS.goods.price).toBeGreaterThan(0);
    expect(PRODUCTS.fuel.price).toBeGreaterThan(0);
  });

  it("construction parts go to a town's building site, which goes up once it has them all; the town pays", () => {
    const w = world();
    let sold = 0;
    w.host.sold = (_t, p, n) => { if (p === "parts") sold += n; };
    const cp = ready(w, "constructionplant", 0);
    w.shop(200);
    const block = w.shop(500);
    block.kind = "apartments";
    block.built = 0;
    block.site = { need: { parts: 2 }, got: {} };
    cp.plant!.out.parts = 3;
    w.ind.tick(0);
    const legs = w.pending.filter((p) => p.trip.haul!.leg === "out");
    expect(legs.length).toBeGreaterThan(0);
    for (const p of legs) expect(p.trip.haul!.dest).toBe(block.id);
    // no more than it still needs is sent
    expect(legs.reduce((a, p) => a + p.trip.haul!.n, 0)).toBe(2);
    const before = w.money;
    w.ind.deliver(block, "parts", 1, cp);
    expect(block.site!.got.parts).toBe(1);
    w.ind.deliver(block, "parts", 5, cp);
    expect(block.site).toBeUndefined();
    expect(w.money - before).toBe(2 * PRODUCTS.parts.price);
    expect(sold).toBe(2);
    // with no site waiting, parts have nowhere to go, and the plant says why
    w.pending.length = 0;
    cp.plant!.out.parts = 3;
    cp.problem = null;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(cp.problem).toMatch(/^No town on your roads is putting up a block/);
  });
});

describe("Tier 4 chains", () => {
  const ready = (w: ReturnType<typeof world>, kind: PlantKind, x: number) => {
    const b = w.plant(kind, x);
    delete b.plant!.site;
    return b;
  };

  it("the copper mine digs copper ore on its deposit, with no power", () => {
    const w = world();
    expect(PLANTS.coppermine.deposit!.field).toBe(F.copper);
    expect(PLANTS.coppermine.tier).toBe(4);
    expect(PLANTS.coppermine.power ?? 0).toBe(0);
    const b = ready(w, "coppermine", 0);
    w.ind.produce(b, PLANTS.coppermine.cycle * 3.01);
    expect(b.plant!.out.copperore).toBe(3);
    expect(b.problem).toBeNull();
  });

  it("each plant turns its inputs into its outputs: copper, electronics, machinery", () => {
    const cases: [PlantKind, Record<string, number>, string][] = [
      ["coppersmelter", { copperore: 4, coal: 4 }, "copper"],
      ["electronics", { copper: 4, plastics: 4 }, "electronics"],
      ["machineworks", { steel: 4, copper: 4 }, "machinery"],
    ];
    for (const [kind, stock, out] of cases) {
      const w = world();
      const b = ready(w, kind, 0);
      expect(PLANTS[kind].tier, kind).toBe(4);
      expect(Object.keys(PLANTS[kind].inputs).sort()).toEqual(Object.keys(stock).sort());
      b.plant!.stock = { ...stock };
      w.ind.produce(b, PLANTS[kind].cycle * 2.01);
      expect(b.plant!.out[out as never], kind).toBe(2);
      for (const p of Object.keys(stock)) expect(b.plant!.stock[p as never], `${kind} ${p}`).toBe(2);
      const first = Object.keys(stock)[0];
      b.plant!.stock = { ...stock, [first]: 0 };
      w.ind.produce(b, PLANTS[kind].cycle);
      expect(b.problem).toBe(`Waiting for ${PRODUCTS[first as keyof typeof PRODUCTS].name.toLowerCase()}`);
    }
    // a City buys the finished products; copper is only for the company's plants
    expect(PRODUCTS.electronics.price).toBeGreaterThan(PRODUCTS.goods.price);
    expect(PRODUCTS.machinery.price).toBeGreaterThan(PRODUCTS.goods.price);
    expect(PRODUCTS.copper.price).toBe(0);
    expect(PRODUCTS.copperore.price).toBe(0);
  });

  it("the copper smelter, electronics plant and machine works draw power, and work at 40% without it", () => {
    for (const k of ["coppersmelter", "electronics", "machineworks"] as PlantKind[]) {
      expect(PLANTS[k].power, k).toBeGreaterThan(0);
      const w = world();
      let share = 0;
      (w.host as { power?: () => number }).power = () => share;
      const b = ready(w, k, 0);
      b.plant!.stock = Object.fromEntries(Object.keys(PLANTS[k].inputs).map((p) => [p, 9]));
      w.ind.produce(b, PLANTS[k].cycle * 5.01);
      expect(Object.values(b.plant!.out)[0], k).toBe(2);
      expect(b.problem).toBe("No power: working at 40%");
      share = 1;
      w.ind.produce(b, PLANTS[k].cycle * 1.01);
      expect(b.problem, k).toBeNull();
    }
  });

  it("a tier 4 building site waits for construction parts on top of planks and cement; the construction plant sends them there first", () => {
    for (const k of ["coppermine", "coppersmelter", "electronics", "machineworks"] as PlantKind[]) {
      const s = PLANTS[k].site!;
      expect(s.planks, k).toBeGreaterThan(0);
      expect(s.cement, k).toBeGreaterThan(0);
      expect(s.parts, k).toBeGreaterThan(0);
    }
    const w = world();
    const cp = ready(w, "constructionplant", 0);
    const block = w.shop(300);
    block.kind = "apartments";
    block.built = 0;
    block.site = { need: { parts: 2 }, got: {} };
    const el = w.plant("electronics", 1500);
    w.ind.produce(el, HOUR);
    expect(el.problem).toMatch(/^Building site: waiting for .*loads of construction parts$/);
    cp.plant!.out.parts = 2;
    w.ind.tick(0);
    // (the plant's site comes before a town's block, even one nearer)
    const legs = w.pending.filter((p) => p.trip.haul!.leg === "out");
    expect(legs.length).toBeGreaterThan(0);
    for (const p of legs) expect(p.trip.haul!.dest).toBe(el.id);
    w.ind.deliver(el, "planks", 50);
    w.ind.deliver(el, "cement", 50);
    expect(el.plant!.site).toBeDefined();
    w.ind.deliver(el, "parts", 50, cp);
    expect(el.plant!.site).toBeUndefined();
  });

  it("each chain's trucks take its product on: copper ore to the copper smelter, copper to the electronics plant and machine works, plastics to the electronics plant", () => {
    const w = world();
    const mine = ready(w, "coppermine", 0), cs = ready(w, "coppersmelter", 300), rf = ready(w, "refinery", 600);
    const el = ready(w, "electronics", 900), mw = ready(w, "machineworks", 1200);
    mine.plant!.out.copperore = 1;
    rf.plant!.out.plastics = 1;
    cs.plant!.out.copper = 2;
    w.ind.tick(0);
    const to = (p: string) => w.pending.filter((x) => x.trip.haul!.product === p).map((x) => x.trip.haul!.dest);
    expect(to("copperore")).toEqual([cs.id]);
    expect(to("plastics")).toEqual([el.id]);
    expect(to("copper").length).toBe(2);
    expect(to("copper").every((id) => id === el.id || id === mw.id)).toBe(true);
  });

  it("the refinery ships its plastics once the company has an electronics plant, and flares them quietly till then", () => {
    const w = world();
    const rf = ready(w, "refinery", 0);
    rf.plant!.out.plastics = 4;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(rf.problem ?? "").not.toMatch(/plastics/);
    expect(w.ind.wants("plastics")).toBe(false);
    // an electronics plant still a site takes no plastics yet: they stay quietly in the yard
    const el = w.plant("electronics", 400);
    expect(w.ind.wants("plastics")).toBe(true);
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(rf.problem ?? "").not.toMatch(/plastics/);
    delete el.plant!.site;
    w.ind.tick(0);
    expect(w.pending.length).toBeGreaterThan(0);
    expect(w.pending.every((p) => p.trip.haul!.product === "plastics" && p.trip.haul!.dest === el.id)).toBe(true);
  });

  it("electronics go to a City's shops; machinery to its offices and towers, or its shops while it has none", () => {
    const w = world();
    (w.host as { townOf: (b: Building) => number | null }).townOf = (b) => b.town ?? null;
    const el = ready(w, "electronics", 0), mw = ready(w, "machineworks", 10);
    const shopA = w.shop(300), office = w.shop(400), shopB = w.shop(3000), station = w.shop(500);
    shopA.town = 1; office.town = 1; station.town = 1; shopB.town = 2;
    office.kind = "tower";
    station.kind = "fuelstation";
    const ids = (p: "electronics" | "machinery", from: Building) => w.ind.customers(from, p).map((c) => c.b.id);
    const e = ids("electronics", el);
    expect(e).toContain(shopA.id);
    expect(e).toContain(shopB.id);
    expect(e).not.toContain(station.id);
    let m = ids("machinery", mw);
    expect(m).toContain(office.id);
    expect(m).not.toContain(shopA.id); // town 1 has an office tower
    expect(m).toContain(shopB.id); // town 2 has none: its shops take it
    expect(m).not.toContain(station.id);
    office.built = 0; // a tower still going up doesn't count yet
    m = ids("machinery", mw);
    expect(m).toContain(shopA.id);
  });

  it("with no City on its roads, electronics wait and the plant says towns want them from City size", () => {
    const w = world();
    (w.host as { want: (t: number, p: string) => number }).want = (_t, p) => (p === "food" ? 10 : -Infinity);
    const el = ready(w, "electronics", 0);
    w.shop(200);
    el.plant!.out.electronics = 3;
    w.ind.tick(0);
    expect(w.pending.length).toBe(0);
    expect(el.problem).toBe("No town on your roads uses electronics yet: towns want it from City size");
  });
});
