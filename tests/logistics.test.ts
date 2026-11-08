// Logistics (docs/design.md, "Freight"): truck classes, warehouses and fuel depots, on the Industry alone (a tiny
// fake world) and through the Game (unlocks, the panel's setters, saves).

import { describe, expect, it } from "vitest";
import { DEPOT_KM, FUEL_AT_COST, FUEL_PER_KM, Industry, PLANTS, TRUCK_UPKEEP, type IndustryHost, type PlantKind } from "../src/game/industry";
import { HEAVY_UNITS, ROAD_TRAIN_UNITS, TRUCK_CLASSES, TRUCK_CLASS_ORDER, classOf } from "../src/game/trucks";
import { MILESTONES, unlockedBy, unlocksOf } from "../src/game/progression";
import { PLACED_TABS } from "../src/game/placed";
import { Game } from "../src/game/city";
import { BLOCK, gridPt } from "../src/game/towns";
import type { Building } from "../src/game/buildings";
import type { PendingSpawn, Vehicle } from "../src/sim/traffic";
import { placeAlong, road } from "./helpers";

/** A tiny world: buildings on numbered road components along the x axis, everyone fully staffed. */
function world(load = 1) {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const pending: PendingSpawn[] = [];
  let money = 0;
  const spent: Record<string, number> = {};
  let want = 10;
  const host: IndustryHost & { time: number } = {
    time: 0,
    buildings: { list, byId } as any,
    has: () => true,
    connected: (a, b) => a === b,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    townOf: (b) => b.id,
    want: () => want,
    sold: () => {},
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    earn: (v) => { money += v; },
    spend: (v, what) => { money -= v; spent[what] = (spent[what] ?? 0) + v; },
    load: () => load,
  };
  const ind = new Industry(host);
  let id = 1;
  const make = (x: number, comp: number, cap: number): Building => {
    const b = { id: id++, kind: "shop", c: { x, y: 0 }, rot: 0, hw: 10, hd: 10, front: { x, y: 0 }, access: { seg: comp, t: 0.5 } as any, side: 1, level: 1, cap, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0 } as Building;
    list.push(b);
    byId.set(b.id, b);
    return b;
  };
  /** a company building, built and running */
  const plant = (kind: PlantKind, x: number, comp = 1) => {
    const b = make(x, comp, 8);
    b.kind = kind as any;
    ind.init(b, kind);
    delete b.plant!.site;
    b.built = 1;
    return b;
  };
  const shop = (x: number, comp = 1) => make(x, comp, 3);
  const arrive = (p: PendingSpawn) => { pending.splice(pending.indexOf(p), 1); ind.onArrive({ trip: p.trip } as Vehicle); };
  const out = () => pending.filter((p) => p.trip.haul?.leg === "out");
  return { host, ind, plant, shop, pending, out, arrive, spent, get money() { return money; }, setWant: (n: number) => { want = n; } };
}

describe("Truck classes", () => {
  it("a bigger class carries more and costs more, and takes more road: longer, slower, slower away", () => {
    const [l, h, r] = TRUCK_CLASS_ORDER.map((c) => TRUCK_CLASSES[c]);
    expect([l.id, h.id, r.id]).toEqual(["light", "heavy", "roadtrain"]);
    for (const [a, b] of [[l, h], [h, r]]) {
      expect(b.payload).toBeGreaterThan(a.payload);
      expect(b.len).toBeGreaterThan(a.len);
      expect(b.speed).toBeLessThan(a.speed);
      expect(b.accel).toBeLessThan(a.accel);
      expect(b.price).toBeGreaterThan(a.price);
      expect(b.upkeep).toBeGreaterThan(a.upkeep);
      // per load carried, a bigger truck burns less fuel: that is what makes it the answer late on
      expect(b.fuel / b.payload).toBeLessThan(a.fuel / a.payload);
    }
    expect(classOf(undefined)).toBe(l);
    // the light truck is the one the sim always had
    expect(l.len).toBe(8.5);
    expect(l.speed).toBe(0.85);
    // a road train's pieces cover its length, front to back, each riding on the one before
    const U = ROAD_TRAIN_UNITS;
    expect(U[0].at).toBe(0);
    expect(U[U.length - 1].at + U[U.length - 1].len).toBeCloseTo(r.len, 6);
    for (let i = 1; i < U.length; i++) expect(U[i].at + U[i].pivot).toBeCloseTo(U[i - 1].at + U[i - 1].axle, 6);
  });

  it("a building's class sets each truck's load, its price, its upkeep and how it drives", () => {
    const w = world(2);
    const mine = w.plant("coalmine", 0);
    const plant = w.plant("smelter", 2000);
    expect(w.ind.capOf(mine)).toBe(2);
    expect(Industry.truckPrice(mine)).toBe(TRUCK_CLASSES.light.price);
    Industry.setClass(mine, "heavy");
    expect(mine.plant!.cls).toBe("heavy");
    expect(w.ind.capOf(mine)).toBe(4);
    expect(Industry.truckPrice(mine)).toBe(TRUCK_CLASSES.heavy.price);
    mine.plant!.out.coal = 4;
    w.ind.tick(0);
    const [t] = w.out();
    expect(t.trip.haul!.dest).toBe(plant.id);
    expect(t.trip.haul!.n).toBe(4);
    expect(t.trip.haul!.cls).toBe("heavy");
    expect(t.len).toBe(TRUCK_CLASSES.heavy.len);
    expect(t.vf).toBe(TRUCK_CLASSES.heavy.speed);
    expect(t.af).toBe(TRUCK_CLASSES.heavy.accel);
    expect(t.units).toBe(HEAVY_UNITS); // drawn on its axles
    // fuel: 2 km each way at the heavy class's rate
    expect(w.spent.fuel).toBeCloseTo(2 * 2 * FUEL_PER_KM * TRUCK_CLASSES.heavy.fuel, 6);
    // it comes home as the same truck
    w.arrive(t);
    const back = w.pending.find((p) => p.trip.haul?.leg === "back")!;
    expect(back.len).toBe(TRUCK_CLASSES.heavy.len);
    expect(back.trip.haul!.cls).toBe("heavy");
    // switching back to light: new trucks are light again
    Industry.setClass(mine, "light");
    expect(mine.plant!.cls).toBeUndefined();
    expect(Industry.body(undefined)).toEqual({});
    // a road train is drawn in pieces
    expect(Industry.body("roadtrain").units).toBe(ROAD_TRAIN_UNITS);
  });

  it("a road train waits for half a load before it sets off; a light truck goes with what there is", () => {
    const w = world(1);
    const mine = w.plant("coalmine", 0);
    w.plant("smelter", 2000);
    mine.plant!.out.coal = 1;
    w.ind.tick(0);
    expect(w.out().length).toBe(1);
    expect(w.out()[0].trip.haul!.n).toBe(1);
    const v = world(1);
    const m2 = v.plant("coalmine", 0);
    v.plant("smelter", 2000);
    Industry.setClass(m2, "roadtrain");
    m2.plant!.out.coal = 1;
    v.ind.tick(0);
    expect(v.out().length).toBe(0);
    m2.plant!.out.coal = 3;
    v.ind.tick(0);
    expect(v.out().length).toBe(1);
    expect(v.out()[0].trip.haul!.n).toBe(3);
    expect(v.out()[0].units).toBe(ROAD_TRAIN_UNITS);
  });

  it("a heavier class costs its upkeep for every truck the building runs, every hour", () => {
    const w = world();
    const mine = w.plant("coalmine", 0);
    const hour = () => { mine.plant!.now.spent = 0; w.ind.hourly(); return mine.plant!.last.spent; };
    const light = hour();
    Industry.setClass(mine, "roadtrain");
    expect(hour() - light).toBeCloseTo(w.ind.trucksOf(mine) * TRUCK_CLASSES.roadtrain.upkeep, 6);
    mine.plant!.bought = 1;
    expect(hour() - light).toBeCloseTo(TRUCK_UPKEEP + w.ind.trucksOf(mine) * TRUCK_CLASSES.roadtrain.upkeep, 6);
  });

  it("pays back fast: a road train's extra upkeep is a few loads' worth of fuel saved on a long haul", () => {
    // per hour of upkeep, how many km of hauling (one load each way) the fuel saving covers
    const L = TRUCK_CLASSES.light, R = TRUCK_CLASSES.roadtrain;
    const perLoadKm = (c: typeof L) => (2 * FUEL_PER_KM * c.fuel) / c.payload;
    const saved = perLoadKm(L) - perLoadKm(R);
    // 4 loads over 8 km save more than an hour's upkeep
    expect(saved * 4 * 8).toBeGreaterThan(R.upkeep);
  });
});

describe("Warehouses", () => {
  it("take loads only when no plant or town can, then re-ship them with their own trucks", () => {
    const w = world();
    const farm = w.plant("farm", 0);
    const fp = w.plant("foodplant", 3000);
    const wh = w.plant("warehouse", 500);
    expect(PLANTS.warehouse.tier).toBe(2);
    // a plant short of crops comes first, however much nearer the warehouse is
    farm.plant!.out.crops = 2;
    w.ind.tick(0);
    expect(w.out().map((p) => p.trip.haul!.dest)).toEqual([fp.id, fp.id]);
    // the food plant full: the overflow goes to the warehouse
    for (const p of [...w.pending]) w.arrive(p);
    for (const p of [...w.pending]) w.arrive(p);
    fp.plant!.stock.crops = Industry.storeOf(fp);
    farm.plant!.out.crops = 2;
    w.ind.tick(0);
    const toWh = w.out();
    expect(toWh.length).toBe(2);
    for (const p of toWh) expect(p.trip.haul!.dest).toBe(wh.id);
    for (const p of toWh) w.arrive(p);
    expect(wh.plant!.stock.crops).toBe(2);
    expect(Industry.stored(wh)).toBe(2);
    // the food plant has room again: the warehouse's own trucks carry the crops on
    fp.plant!.stock.crops = 0;
    w.ind.tick(0);
    const on = w.out().filter((p) => p.trip.haul!.plant === wh.id);
    expect(on.length).toBe(2);
    for (const p of on) expect(p.trip.haul!.dest).toBe(fp.id);
    expect(wh.plant!.stock.crops).toBe(0);
  });

  it("towns come before warehouses, however far; a warehouse's stock never goes to another warehouse", () => {
    const w = world();
    const mill = w.plant("sawmill", 0);
    const far = w.shop(40000); // a town 40 km off
    const wh = w.plant("warehouse", 300);
    const wh2 = w.plant("warehouse", 600);
    mill.plant!.out.planks = 1;
    w.ind.tick(0);
    expect(w.out()[0].trip.haul!.dest).toBe(far.id);
    // nothing wants planks: they go to the nearest warehouse with room
    w.setWant(0);
    expect(w.ind.customers(mill, "planks")[0].b).toBe(wh);
    // the warehouse's own customers: the town, never the other warehouse
    w.setWant(10);
    wh.plant!.stock.planks = 3;
    const cs = w.ind.customers(wh, "planks");
    expect(cs.map((c) => c.b.id)).not.toContain(wh2.id);
    expect(cs[0].b).toBe(far);
  });

  it("take only the products the player picked, and only while they have room", () => {
    const w = world();
    const mine = w.plant("coalmine", 0);
    const wh = w.plant("warehouse", 300);
    expect(w.ind.customers(mine, "coal")[0]?.b).toBe(wh);
    wh.plant!.takes = ["crops"];
    expect(w.ind.customers(mine, "coal").length).toBe(0);
    delete wh.plant!.takes;
    wh.plant!.stock.crops = Industry.storeOf(wh) - 0.5;
    expect(w.ind.customers(mine, "coal").length).toBe(0);
    wh.plant!.stock.crops = 1;
    w.ind.produce(wh, 40);
    expect(wh.problem).toBeNull();
    wh.plant!.stock.crops = Industry.storeOf(wh);
    // full with its trucks parked: nothing wants the stock; full with them all out: it needs more trucks
    w.ind.produce(wh, 40);
    expect(wh.problem).toBe("Full: nothing needs more of what it holds right now");
    w.ind.produce(wh, 40, w.ind.trucksOf(wh));
    expect(wh.problem).toBe("Full: its trucks can't ship the stock as fast as it comes in");
  });

  it("a feeder for a product comes first, when it is nearer than where the load would go otherwise", () => {
    const w = world();
    const mine = w.plant("ironmine", 0);
    const smelter = w.plant("smelter", 9000);
    const wh = w.plant("warehouse", 2000);
    expect(w.ind.customers(mine, "ore")[0].b).toBe(smelter);
    wh.plant!.feeds = ["ore"];
    expect(w.ind.customers(mine, "ore")[0].b).toBe(wh);
    // the warehouse passes it on to the smelter
    wh.plant!.stock.ore = 2;
    expect(w.ind.customers(wh, "ore")[0].b).toBe(smelter);
    // a feeder farther off than the smelter is skipped
    const w2 = world();
    const m2 = w2.plant("ironmine", 0);
    const s2 = w2.plant("smelter", 1000);
    const f2 = w2.plant("warehouse", 5000);
    f2.plant!.feeds = ["ore"];
    expect(w2.ind.customers(m2, "ore")[0].b).toBe(s2);
  });
});

describe("Fuel depots", () => {
  it("take fuel from the refineries", () => {
    const w = world();
    const ref = w.plant("refinery", 0);
    const depot = w.plant("fueldepot", 1500);
    expect(w.ind.customers(ref, "fuel").map((c) => c.b)).toContain(depot);
    depot.plant!.stock.fuel = Industry.storeOf(depot);
    expect(w.ind.customers(ref, "fuel").map((c) => c.b)).not.toContain(depot);
    depot.plant!.stock.fuel = 0;
    w.ind.produce(depot, 40);
    expect(depot.problem).toMatch(/^Out of fuel/);
  });

  it("fill trucks whose run passes near them at cost, and count the trucks and the money saved", () => {
    const w = world();
    const mine = w.plant("coalmine", 0);
    w.plant("smelter", 10000);
    const depot = w.plant("fueldepot", 5000);
    depot.c.y = 800; // 0.8 km off the run
    depot.plant!.stock.fuel = 4;
    mine.plant!.out.coal = 1;
    w.ind.tick(0);
    expect(w.out().length).toBe(1);
    const km = 10;
    expect(w.spent.fuel).toBeCloseTo(km * 2 * FUEL_AT_COST, 6);
    expect(depot.plant!.served).toBe(1);
    expect(depot.plant!.saved).toBeCloseTo(km * 2 * (FUEL_PER_KM - FUEL_AT_COST), 6);
    expect(depot.plant!.stock.fuel).toBeCloseTo(4 - (km * 2) / DEPOT_KM, 6);
    // the hour's books carry it to the panel
    w.ind.hourly();
    expect(depot.plant!.last.served).toBe(1);
    // too far off the run, or out of fuel, or on other roads: the market price
    for (const set of [() => { depot.c.y = 3000; }, () => { depot.c.y = 0; depot.plant!.stock.fuel = 0; }, () => { depot.plant!.stock.fuel = 4; depot.access = { seg: 9, t: 0.5 } as any; }]) {
      set();
      w.spent.fuel = 0;
      const p = w.out()[0];
      w.arrive(p);
      for (const q of [...w.pending]) w.arrive(q);
      mine.plant!.out.coal = 1;
      w.ind.tick(0);
      expect(w.spent.fuel).toBeCloseTo(km * 2 * FUEL_PER_KM, 6);
    }
  });
});

describe("Logistics milestones", () => {
  it("heavy trucks and warehouses in tier 2, depots with the refinery, road trains on the way to a Town", () => {
    const at = (id: string) => MILESTONES.findIndex((m) => m.id === id);
    const truckBy = (c: string) => unlockedBy((u) => u.trucks?.includes(c as never))!.id;
    const bldBy = (k: PlantKind) => unlockedBy((u) => u.buildings?.includes(k))!.id;
    expect(unlocksOf([]).trucks).toEqual(new Set(["light"]));
    expect(at(truckBy("heavy"))).toBeGreaterThan(at("village"));
    expect(at(truckBy("heavy"))).toBeLessThan(at("pop1000"));
    expect(at(bldBy("warehouse"))).toBeLessThan(at("pop1000"));
    expect(at(bldBy("fueldepot"))).toBeGreaterThan(at("fuel1"));
    expect(at(truckBy("roadtrain"))).toBeGreaterThan(at("town"));
    expect(at(truckBy("roadtrain"))).toBeLessThan(at("city"));
    expect(unlocksOf(MILESTONES.map((m) => m.id)).trucks.size).toBe(3);
    // the build menu has them under Logistics
    expect(PLACED_TABS.find((t) => t.id === "logistics")!.kinds).toEqual(["warehouse", "fueldepot"]);
    // measures
    const m = (id: string) => MILESTONES.find((x) => x.id === id)!;
    const view = { towns: [], made: { coal: 12 }, sold: { food: 90, planks: 30 }, bestDay: {}, bestEarned: 0, powered: 0 };
    expect(m(truckBy("heavy")).measure(view)).toEqual([120, 150]);
    expect(m(bldBy("warehouse")).measure(view)).toEqual([12, 30]);
  });
});

describe("Logistics in the game", () => {
  /** A started company with everything unlocked, a road out of town and a warehouse beside it. */
  function setup() {
    const g = new Game(7);
    g.start();
    g.money = 1e7;
    const t = g.towns.list[0];
    const a = gridPt(t.c, t.ang, 1 + 320 / BLOCK, 0), b = gridPt(t.c, t.ang, 1 + 900 / BLOCK, 0);
    road(g, a, b);
    return { g, a, b };
  }

  it("a plant's class can be switched once it is unlocked; a warehouse's products can be picked", () => {
    const { g, a, b } = setup();
    expect(g.placedUnlocked("warehouse")).toBe(false);
    g.unlockAll();
    const wh = placeAlong(g, "warehouse", a, b, 70);
    const P = wh.plant!;
    // with the road-train milestone not reached, the class is refused
    const all = [...g.progress.done];
    g.progress.done = all.filter((id) => !MILESTONES.find((m) => m.id === id)?.unlocks.trucks?.includes("roadtrain"));
    expect(g.truckUnlocked("roadtrain")).toBe(false);
    expect(g.setTruckClass(wh.id, "roadtrain")).toBe("Not unlocked yet");
    expect(P.cls).toBeUndefined();
    g.progress.done = all;
    expect(g.setTruckClass(wh.id, "roadtrain")).toBeNull();
    expect(P.cls).toBe("roadtrain");
    const before = g.money;
    expect(g.buyTruck(wh.id)).toBeNull();
    expect(g.money).toBe(before - TRUCK_CLASSES.roadtrain.price);
    expect(g.setWarehouse(wh.id, "coal", { take: false })).toBeNull();
    expect(P.takes).not.toContain("coal");
    expect(P.takes!.length).toBeGreaterThan(5);
    expect(g.setWarehouse(wh.id, "ore", { feed: true })).toBeNull();
    expect(P.feeds).toEqual(["ore"]);
    // feeding coal means taking it again; not taking it means not feeding it
    expect(g.setWarehouse(wh.id, "coal", { feed: true })).toBeNull();
    expect(P.takes).toBeUndefined();
    expect(g.setWarehouse(wh.id, "coal", { take: false })).toBeNull();
    expect(P.feeds).toEqual(["ore"]);
    expect(g.setWarehouse(wh.id, "coal", { take: true })).toBeNull();
    expect(P.takes).toBeUndefined();
    const other = g.buildings.list.find((x) => !x.plant)!;
    expect(g.setWarehouse(other.id, "coal", { take: true })).toBe("Not a warehouse");
    expect(g.setTruckClass(other.id, "heavy")).toBe("Not a plant");
  }, 60000);

  it("classes, warehouse settings and depot books survive a save, and saves without them load", () => {
    const { g, a, b } = setup();
    g.unlockAll();
    const wh = placeAlong(g, "warehouse", a, b, 70);
    const dp = placeAlong(g, "fueldepot", a, b, 70);
    expect(g.setTruckClass(wh.id, "heavy")).toBeNull();
    g.setWarehouse(wh.id, "planks", { take: false });
    g.setWarehouse(wh.id, "ore", { feed: true });
    wh.plant!.stock.coal = 7;
    dp.plant!.served = 12;
    dp.plant!.saved = 3400;
    dp.plant!.stock.fuel = 3.5;
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    const W = h.buildings.byId.get(wh.id)!.plant!, D = h.buildings.byId.get(dp.id)!.plant!;
    expect(W.cls).toBe("heavy");
    expect(W.takes).toEqual(wh.plant!.takes);
    expect(W.feeds).toEqual(["ore"]);
    expect(W.stock.coal).toBe(7);
    expect(D.served).toBe(12);
    expect(D.saved).toBe(3400);
    expect(D.stock.fuel).toBe(3.5);
    expect(h.truckUnlocked("roadtrain")).toBe(true);
    // a save from before logistics: no class, no settings, no books (light trucks, takes everything)
    const old = JSON.parse(JSON.stringify(json));
    const strip = (o: unknown): void => {
      if (!o || typeof o !== "object") return;
      for (const k of ["cls", "takes", "feeds", "served", "saved"]) delete (o as Record<string, unknown>)[k];
      for (const v of Object.values(o)) strip(v);
    };
    strip(old);
    const k = Game.load(old);
    const P = k.buildings.byId.get(wh.id)!.plant!;
    expect(P.cls).toBeUndefined();
    expect(k.industry.capOf(k.buildings.byId.get(wh.id)!)).toBe(k.progress.unlocked.load);
    expect(k.buildings.byId.get(dp.id)!.plant!.served).toBeUndefined();
    k.step(1 / 30);
  }, 60000);
});
