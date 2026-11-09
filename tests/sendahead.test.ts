// Deliveries that land in time (owner, 2026-11-09: "deliveries to towns seem to always be late"). A town has only
// what has landed; the company's plants see its supply about to fall below "Enough" before its people do and send its
// load first, without waiting at the dock for a full truck (industry.ts SEND_SPARE, the send-ahead line); and a
// supply just fallen below the line has a grace (supply.ts GRACE) before it shows or counts. A jammed road still lets
// a town run low. The town and its supply are the real sim's (settlements.ts); the plant's trucks drive a scripted run
// of known length, so each test can say exactly when a load lands.

import { beforeEach, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { Industry, type IndustryHost, type PlantKind } from "../src/game/industry";
import type { Town } from "../src/game/settlements";
import { HOUR } from "../src/game/society";
import { GRACE } from "../src/game/supply";
import { averageSupply, demandPerDay } from "../src/game/towns";
import type { PendingSpawn, Vehicle } from "../src/sim/traffic";
import { needView } from "../src/ui/needs";

const TICK = HOUR / 8;
/** a town nobody but the test runs: always wanting food, never about to dip (a nearer buyer to compete with) */
const OTHER = 999;

let g: Game, t: Town;

/** The start town's food, as its panel reads it. */
const state = () => needView(t, "food").state;

/**
 * A food plant beside the real start town's sim, with one shop of the town `far` m away (and, if asked, a shop of
 * another town nearer). Its trucks take `trip` sim s each way, or never arrive while `jam` is on.
 */
function run(opts: { far: number; trip: number; near?: number; heavy?: boolean }) {
  const pending: PendingSpawn[] = [];
  const onRoad: { p: PendingSpawn; at: number }[] = [];
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const host: IndustryHost = {
    get time() { return g.time; },
    buildings: { list, byId } as any,
    has: () => false,
    connected: (a, b) => a === b,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    townOf: (b) => b.town ?? null,
    want: (town, p) => (town === OTHER ? (p === "food" ? 10 : -Infinity) : g.towns.want(town, p)),
    short: (town, p) => (town === OTHER ? 0 : g.towns.short(town, p)),
    dipIn: (town, p, arriving) => (town === OTHER ? Infinity : g.towns.dipIn(town, p, arriving)),
    sold: (town, p, n) => { if (town !== OTHER) g.towns.sold(town, p, n); },
    request: (p) => { pending.push(p); },
    trips: () => [...pending.map((p) => p.trip), ...onRoad.map((r) => r.p.trip)],
    earn: () => {},
    spend: () => {},
    truckClass: () => (opts.heavy ? "heavy" : "light"),
  };
  const ind = new Industry(host);
  let id = 1;
  const make = (x: number, cap: number, town?: number): Building => {
    const b = { id: id++, kind: "shop", c: { x, y: 0 }, rot: 0, hw: 10, hd: 10, front: { x, y: 0 }, access: { seg: 1, t: 0.5 } as any, side: 1, level: 1, cap, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0, ...(town !== undefined ? { town } : {}) } as Building;
    list.push(b);
    byId.set(b.id, b);
    return b;
  };
  const plant = make(0, 8);
  plant.kind = "foodplant" as any;
  ind.init(plant, "foodplant" as PlantKind);
  const shop = make(opts.far, 3, t.id);
  const near = opts.near !== undefined ? make(opts.near, 3, OTHER) : null;
  // one truck: a heavy one when asked (two loads; it waits at the dock for both, up to an hour)
  ind.trucksOf = () => 1;
  if (opts.heavy) ind.mixOf = () => ({ light: 0, heavy: 1, roadtrain: 0 });
  let k = 0, jam = false;
  const sent: { to: number; at: number; n: number }[] = [];
  /** one tick of the world: trucks land, the plant makes `make` loads an hour and sends them, the hour rolls */
  const step = (make = 0) => {
    g.time += TICK;
    for (const r of [...onRoad]) {
      if (r.at > g.time || (jam && r.p.trip.haul?.leg === "out")) continue;
      onRoad.splice(onRoad.indexOf(r), 1);
      ind.onArrive({ trip: r.p.trip } as Vehicle);
    }
    plant.plant!.out.food = (plant.plant!.out.food ?? 0) + make / 8;
    ind.tick(TICK);
    for (const p of pending.splice(0)) {
      if (p.trip.haul?.leg === "out") sent.push({ to: p.trip.haul.dest, at: g.time, n: p.trip.haul.n });
      onRoad.push({ p, at: g.time + opts.trip });
    }
    if (++k % 8 === 0) g.towns.hourly();
    if (k % 192 === 0) g.towns.daily();
  };
  return { ind, plant, shop, near, step, sent, jamOn: () => { jam = true; } };
}

/** The town as if it had had `loads[i]` loads of food land in the hour `i` hours before this one (48 of them). */
function history(loads: Record<number, number>) {
  t.hours = Array.from({ length: 48 }, (_, i) => (loads[47 - i] ? { food: loads[47 - i] } : {}));
  t.hourNow = {};
  t.rate = averageSupply(t.hours);
  t.today = { food: demandPerDay("food", t.pop) };
  t.yesterday = { food: demandPerDay("food", t.pop) };
  delete t.grace;
}

beforeEach(() => {
  g = new Game(7);
  g.start();
  t = g.towns.list[0];
  // (its households stay put: the test is about what it reads, not how it grows)
  t.fixed = true;
  // the hours start on an hour's roll
  g.time = 0;
  g.towns.hourly();
});

describe("deliveries that land in time", () => {
  it("a steady, established single-truck run never shows the town running low", () => {
    // one light truck shuttling food 4.1 game hours each way: a load every ~8.2 hours, about 2.9 loads a day of the
    // town's 3.25 (Enough). The two-day window holds 5 or 6 of them, so for an hour or two a cycle it reads 2.5, under
    // the line, before the next lands.
    const D = demandPerDay("food", t.pop);
    const r = run({ far: 2000, trip: 4.1 * HOUR });
    r.plant.plant!.out.food = 8;
    // three days to settle in
    for (let i = 0; i < 3 * 192; i++) r.step(4);
    expect(r.sent.length).toBeGreaterThan(6);
    const seen = new Set<string>();
    let dips = 0;
    for (let i = 0; i < 4 * 192; i++) {
      r.step(4);
      seen.add(state());
      if (t.grace?.food) dips++;
    }
    // it reads Enough (or Plenty) throughout, though what has landed does dip under the line now and then
    expect([...seen].sort()).not.toContain("low");
    expect(seen.has("enough")).toBe(true);
    expect(dips).toBeGreaterThan(0);
    expect((t.rate!.food ?? 0) / D).toBeGreaterThan(0.8);
  });

  it("a town about to dip has its load sent ahead of a nearer buyer, without waiting for a full truck, and it lands first", () => {
    // what has landed reads 3 a day (Enough, of 3.25) and falls to 2.5 in 8 hours, when its oldest load leaves the
    // two-day window. The run there takes ~6.4 hours; another town's shop is next door.
    history({ 40: 1, 30: 1, 20: 1, 10: 1, 5: 1, 0: 1 });
    const r = run({ far: 2000, near: 300, trip: 6.4 * HOUR, heavy: true });
    // one load in the yard: a heavy truck would wait an hour for its second
    r.plant.plant!.out.food = 1;
    const seen = new Set<string>();
    for (let i = 0; i < 14 * 8; i++) {
      r.step(0);
      seen.add(state());
    }
    expect(r.sent[0]).toMatchObject({ to: r.shop.id, at: TICK, n: 1 });
    expect(seen).not.toContain("low");
    expect(t.grace).toBeUndefined();
  });

  it("a jammed road still lets the town run low", () => {
    const r = run({ far: 2000, trip: 4.1 * HOUR });
    r.plant.plant!.out.food = 8;
    for (let i = 0; i < 3 * 192; i++) r.step(4);
    expect(state()).not.toBe("low");
    // the truck out on the run stands in a jam and never gets there
    r.jamOn();
    let low = -1;
    for (let i = 0; i < 3 * 192 && low < 0; i++) {
      r.step(4);
      if (state() === "low" || state() === "none") low = i;
    }
    expect(low).toBeGreaterThan(0);
    // and it stays that way while nothing lands
    for (let i = 0; i < 48; i++) r.step(4);
    expect(["low", "none"]).toContain(state());
  });
});

describe("a grace before a dip shows", () => {
  /** reads 3 a day (Enough) now, 2.5 (Running low) from the next roll: its oldest load is about to leave the window */
  const aboutToDip = () => history({ 47: 1, 46: 1, 30: 1, 20: 1, 10: 1, 2: 1 });
  const hour = () => { for (let i = 0; i < 8; i++) { g.time += TICK; if (i === 7) g.towns.hourly(); } };

  it("is three game hours: two real minutes at 1x", () => {
    expect(GRACE).toBe(3 * HOUR);
  });

  it("a dip shorter than the grace never shows, and never moves the averages its growth and goals go on", () => {
    aboutToDip();
    const line = 0.8 * demandPerDay("food", t.pop);
    expect(state()).toBe("enough");
    for (let i = 0; i < 2; i++) {
      hour();
      // what has landed is under the line now (its two-day average too), but the town reads as it did, and its growth
      // and the goals go on as if the need were met at the line
      expect(t.grace?.food).toBeDefined();
      if (i === 0) expect(averageSupply(t.hours!).food).toBeLessThan(line);
      expect(state()).toBe("enough");
      expect(t.rate!.food).toBeGreaterThanOrEqual(line - 1e-9);
      expect(t.supply.food).toBeGreaterThanOrEqual(0.8 - 1e-9);
    }
    // two loads land within the grace: nothing was ever shown, and the dip never counted
    g.towns.sold(t.id, "food", 2);
    expect(t.grace).toBeUndefined();
    expect(state()).not.toMatch(/low|none/);
    for (let i = 0; i < 6; i++) { hour(); expect(state()).not.toMatch(/low|none/); }
  });

  it("a dip longer than the grace shows once the grace is out, and counts only from then on", () => {
    aboutToDip();
    const line = 0.8 * demandPerDay("food", t.pop);
    const states: string[] = [], rates: number[] = [], landed: number[] = [];
    for (let i = 0; i < 6; i++) {
      hour();
      states.push(state());
      rates.push(t.rate!.food ?? 0);
      landed.push(averageSupply(t.hours!).food ?? 0);
    }
    // three hours of grace, reading as before and its averages held at the line; then the drop shows
    expect(states).toEqual(["enough", "enough", "enough", "low", "low", "low"]);
    expect(landed[0]).toBeLessThan(line);
    for (const i of [0, 1, 2]) expect(rates[i]).toBeGreaterThanOrEqual(Math.max(line, landed[i]) - 1e-9);
    // from then on the averages are what has landed: the grace hours weren't held against it after the fact (no more
    // than the hours without a load they were), nor anything made up for them
    for (const i of [3, 4, 5]) expect(rates[i]).toBeCloseTo(landed[i], 6);
    expect(t.grace).toBeUndefined();
  });
});
