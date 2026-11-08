// Special industries (docs/design.md: "Freight: oversized loads", "Landmarks", "Industrial parks", "Seasons"):
// convoys from the machine works, megaproject sites, conveyors between neighbouring plants, and the harvest year.
// The parks and the seasons on the Industry alone (a tiny fake world); convoys and landmarks through the Game.

import { describe, expect, it } from "vitest";
import { Industry, PLANTS, type IndustryHost, type PlantKind } from "../src/game/industry";
import { Parks, LINK_CAP, LINK_REACH, LINK_UPKEEP, fenceGap } from "../src/game/parks";
import { SEASONAL, SEASON_DAYS, START_YDAY, YEAR, YEAR_DAYS, fieldLook, seasonAvg, seasonDay, seasonMult, seasonOf, yearOf } from "../src/game/calendar";
import { seasonLine } from "../src/ui/specials";
import { LOADS_PER_PIECE, MAX_TURBINES, PIECE_YARD, TURBINE_BOOST } from "../src/game/convoys";
import { MEGAS, megaBlock, megaProgress, townBoost } from "../src/game/megaprojects";
import { MILESTONES } from "../src/game/progression";
import { PLACED_TABS } from "../src/game/placed";
import { Game } from "../src/game/city";
import { BUILDING_TYPES } from "../src/config";
import { siteLayout, slotHalf } from "../src/game/sites";
import { BLOCK, gridPt } from "../src/game/towns";
import { DAY, HOUR } from "../src/game/society";
import type { Building } from "../src/game/buildings";
import type { PendingSpawn, Vehicle } from "../src/sim/traffic";
import { placeAlong, road, run } from "./helpers";

/** A tiny world (as logistics.test.ts): buildings on numbered road components, everyone fully staffed. */
function world(season?: (k: PlantKind) => number) {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const pending: PendingSpawn[] = [];
  const host: IndustryHost & { time: number } = {
    time: 0,
    buildings: { list, byId } as any,
    has: () => true,
    connected: (a, b) => a === b,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return list.filter((b) => !b.plant); },
    townOf: (b) => b.id,
    want: () => 10,
    sold: () => {},
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    earn: () => {},
    spend: () => {},
    ...(season ? { season } : {}),
  };
  const ind = new Industry(host);
  let id = 1;
  const plant = (kind: PlantKind, x: number, half = 100, comp = 1): Building => {
    const b = { id: id++, kind, c: { x, y: 0 }, rot: 0, hw: half, hd: half, front: { x, y: 0 }, access: { seg: comp, t: 0.5 } as any, side: 1, level: 1, cap: 8, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0, placed: true } as unknown as Building;
    list.push(b);
    byId.set(b.id, b);
    ind.init(b, kind);
    delete b.plant!.site;
    return b;
  };
  return { host, ind, plant, pending, list, byId };
}

describe("Industrial parks", () => {
  it("links two plants fence to fence when one makes what the other uses; not when they are far apart", () => {
    const w = world();
    const sm = w.plant("smelter", 0), cp = w.plant("constructionplant", 250), far = w.plant("constructionplant", 0 + 200 + LINK_REACH + 120);
    far.c = { x: 0, y: 400 };
    let paid = 0;
    const parks = new Parks({ buildings: { list: w.list, byId: w.byId }, pay: (v) => { paid += v; } });
    parks.refresh();
    expect(fenceGap(sm, cp).d).toBeCloseTo(50, 3);
    expect(parks.links.map((l) => [l.from, l.to, l.product, l.pipe])).toEqual([[sm.id, cp.id, "steel", false]]);
    expect(parks.isLinked(sm.id) && parks.isLinked(cp.id)).toBe(true);
    expect(parks.isLinked(far.id)).toBe(false);
    // the link's ends stand inside each fence, on the side facing the other plant
    const L = parks.links[0];
    expect(L.a.x).toBeGreaterThan(sm.c.x);
    expect(L.a.x).toBeLessThan(sm.c.x + sm.hw);
    expect(L.b.x).toBeGreaterThan(cp.c.x - cp.hw);
    expect(L.b.x).toBeLessThan(cp.c.x);
    // it costs upkeep every hour
    parks.hourly();
    expect(paid).toBe(LINK_UPKEEP);
    // a crude pipe from an oil well to a refinery
    const w2 = world();
    w2.plant("oilwell", 0);
    w2.plant("refinery", 230);
    const p2 = new Parks({ buildings: { list: w2.list, byId: w2.byId } });
    p2.refresh();
    expect(p2.links.map((l) => [l.product, l.pipe])).toEqual([["crude", true]]);
  });

  it("moves loads up to its capacity; the trucks carry the rest", () => {
    const w = world();
    const sm = w.plant("smelter", 0), cp = w.plant("constructionplant", 250);
    const parks = new Parks({ buildings: { list: w.list, byId: w.byId } });
    sm.plant!.out.steel = 8;
    // two game hours of the link alone: it carries LINK_CAP loads an hour, no more, however much is waiting
    const TICK = HOUR / 8;
    for (let h = 0; h < 2; h++) {
      if (h) parks.hourly();
      for (let t = 0; t < HOUR - 1e-6; t += TICK) parks.tick(TICK);
    }
    expect(cp.plant!.stock.steel).toBe(2 * LINK_CAP);
    expect(sm.plant!.out.steel).toBe(8 - 2 * LINK_CAP);
    expect(sm.plant!.now.sent).toBe(2 * LINK_CAP);
    parks.hourly();
    expect(parks.linesFor(sm.id)[0].text).toMatch(new RegExp(`^Conveyor to Construction Plant: ${LINK_CAP} of ${LINK_CAP} loads/h of steel`));
    expect(parks.linesFor(cp.id)[0].text).toMatch(/^Conveyor from Smelter/);
    // a busier yard: the trucks take what the link can't, to the same plant while it has room
    sm.plant!.out.steel = 8;
    cp.plant!.stock.steel = 0;
    parks.tick(TICK);
    w.ind.tick(TICK);
    const trucks = w.pending.filter((p) => p.trip.haul?.leg === "out" && p.trip.haul.plant === sm.id && p.trip.haul.product === "steel");
    expect(trucks.length).toBeGreaterThan(0);
    expect(trucks.every((p) => p.trip.haul!.dest === cp.id)).toBe(true);
    // a full store: the link waits
    cp.plant!.stock.steel = Industry.storeOf(cp);
    const before = sm.plant!.out.steel!;
    for (let t = 0; t < HOUR; t += TICK) parks.tick(TICK);
    expect(sm.plant!.out.steel).toBe(before);
  });

  it("the catalog has the parks' trade-off in the design doc's numbers: a few loads an hour, within 60 m", () => {
    expect(LINK_CAP).toBeGreaterThanOrEqual(2);
    expect(LINK_CAP).toBeLessThanOrEqual(5);
    expect(LINK_REACH).toBe(60);
  });
});

describe("Seasons", () => {
  it("a year of 64 days, 16 a season: spring, summer, autumn, winter, from the first morning", () => {
    expect(SEASON_DAYS).toBe(16);
    expect(YEAR_DAYS).toBe(64);
    expect(YEAR).toBe(64 * DAY);
    // the clock starts at dawn (START_HOUR) on day START_YDAY + 1 of the year, late spring: calendar day n (1-based)
    // runs from `at(n, 0)` to `at(n + 1, 0)`
    const at = (day: number, hour = 12) => (day - 1 - START_YDAY) * DAY + (hour - 6) * HOUR;
    expect(seasonOf(0)).toBe("spring");
    expect(seasonDay(0)).toBe(11);
    expect(yearOf(0)).toBe(1);
    // every calendar day of the year: the season and its day, 1..16, in order
    const seasons = ["spring", "summer", "autumn", "winter"] as const;
    for (let n = 1; n <= YEAR_DAYS; n++) {
      for (const hour of [0.01, 12, 23.99]) {
        expect(seasonOf(at(n, hour)), `day ${n} ${hour}h`).toBe(seasons[Math.floor((n - 1) / 16)]);
        expect(seasonDay(at(n, hour)), `day ${n} ${hour}h`).toBe(((n - 1) % 16) + 1);
      }
    }
    expect(seasonOf(at(16, 23.9))).toBe("spring");
    expect(seasonOf(at(17, 0.1))).toBe("summer");
    expect(seasonOf(at(33))).toBe("autumn");
    expect(seasonOf(at(49))).toBe("winter");
    // and round again: day 65 is the first of spring in year 2
    expect(seasonOf(at(65))).toBe("spring");
    expect(seasonDay(at(65))).toBe(1);
    expect(yearOf(at(64))).toBe(1);
    expect(yearOf(at(65))).toBe(2);
    // the clock shows the day within the season
    expect(seasonLine(at(39))).toContain("Autumn · Day 7");
    expect(seasonLine(at(39))).toContain("Day 7 of 16 of autumn, year 1; Winter in 10 days");
    expect(seasonLine(at(64))).toContain("Winter · Day 16");
    expect(seasonLine(at(64))).toContain("Spring tomorrow");
    expect(seasonLine(at(64 + 20))).toContain("Summer · Day 4");
    expect(seasonLine(at(64 + 20))).toContain("year 2");
  });

  it("the harvest rush comes once a year, over most of autumn, peaking mid-autumn", () => {
    const at = (day: number, hour = 12) => (day - 1 - START_YDAY) * DAY + (hour - 6) * HOUR;
    // above 1.3x is the rush: find each stretch of it over two years, hour by hour
    const runs: { from: number; to: number }[] = [];
    let open: { from: number; to: number } | null = null;
    for (let h = 0; h < 2 * YEAR_DAYS * 24; h++) {
      const t = h * HOUR;
      if (seasonMult("farm", t) > 1.3) {
        if (!open) runs.push((open = { from: t, to: t }));
        open.to = t;
      } else open = null;
    }
    expect(runs.length).toBe(2);
    for (const r of runs) {
      // (it eases in: the farms pass 1.3x on the eve of autumn, the last day of summer)
      expect(seasonOf(r.from + DAY)).toBe("autumn");
      expect(seasonDay(r.from + DAY)).toBe(1);
      expect(seasonOf(r.to)).toBe("autumn");
      expect(seasonOf((r.from + r.to) / 2)).toBe("autumn");
      // it lasts most of the season: from its first day to about its 13th
      const days = (r.to - r.from) / DAY;
      expect(days).toBeGreaterThan(SEASON_DAYS * 0.75);
      expect(days).toBeLessThan(SEASON_DAYS);
    }
    // the peak: the middle of autumn, at the season's full 1.6
    expect(seasonMult("farm", at(33 + 8, 0))).toBeCloseTo(SEASONAL.farm[2], 2);
    expect(seasonMult("farm", at(33 + 8, 0))).toBeGreaterThan(seasonMult("farm", at(34)));
    expect(seasonMult("farm", at(33 + 8, 0))).toBeGreaterThan(seasonMult("farm", at(47)));
    // the fields: ripe gold for the first half of autumn, cut after it, bare through winter, shoots in spring
    expect(fieldLook(at(33))).toBe("ripe");
    expect(fieldLook(at(40))).toBe("ripe");
    expect(fieldLook(at(41, 1))).toBe("cut");
    expect(fieldLook(at(48))).toBe("cut");
    expect(fieldLook(at(49))).toBe("bare");
    expect(fieldLook(at(1))).toBe("young");
    expect(fieldLook(at(17))).toBe("green");
  });

  it("farms surge in autumn and dip in winter, logging peaks in winter, the rest is steady; each year's average is 1", () => {
    for (const k of Object.keys(SEASONAL)) {
      let s = 0;
      const N = 4000;
      for (let i = 0; i < N; i++) s += seasonMult(k, (i / N) * YEAR);
      expect(s / N).toBeCloseTo(1, 6);
    }
    expect(seasonAvg("farm", "autumn")).toBeGreaterThan(1.3);
    expect(seasonAvg("farm", "winter")).toBeLessThan(0.8);
    expect(seasonAvg("farm", "spring")).toBeLessThan(1);
    const lg = (["spring", "summer", "autumn", "winter"] as const).map((s) => seasonAvg("loggingcamp", s));
    expect(Math.max(...lg)).toBe(lg[3]);
    expect(seasonMult("smelter", 123)).toBe(1);
    expect(seasonMult("foodplant", DAY * 40)).toBe(1);
  });

  it("a farm's output follows the seasons and its year's total is what it was without them", () => {
    const year = (seasons: boolean) => {
      let t = 0;
      const w = world(seasons ? (k) => seasonMult(k, t) : undefined);
      const f = w.plant("farm", 0);
      const bySeason = { spring: 0, summer: 0, autumn: 0, winter: 0 };
      const TICK = HOUR / 8;
      for (; t < YEAR - 1e-6; t += TICK) {
        const before = f.plant!.now.made;
        w.ind.produce(f, TICK);
        bySeason[seasonOf(t)] += f.plant!.now.made - before;
        f.plant!.out.crops = 0; // (shipped at once: the yard never fills)
        f.plant!.grow = 0; // (and it stays at level 1: only the seasons change its pace)
      }
      return { total: f.plant!.now.made, bySeason };
    };
    const flat = year(false), wavy = year(true);
    expect(flat.total).toBeGreaterThan(20 * 16);
    expect(Math.abs(wavy.total - flat.total)).toBeLessThanOrEqual(1);
    expect(wavy.bySeason.autumn).toBeGreaterThan(flat.bySeason.autumn * 1.25);
    expect(wavy.bySeason.winter).toBeLessThan(flat.bySeason.winter * 0.8);
    expect(wavy.bySeason.spring).toBeLessThan(flat.bySeason.spring);
  });
  it("a save from the four-day year loads and carries on in the season its clock falls in now", () => {
    const g = new Game(7);
    g.start();
    // day 23 at noon: under the four-day year the third autumn; now (from late spring) the first day of autumn
    g.time = 22 * DAY + 6 * HOUR;
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.time).toBe(g.time);
    expect(h.day).toBe(23);
    expect(seasonOf(h.time)).toBe("autumn");
    expect(seasonDay(h.time)).toBe(1);
    expect(seasonLine(h.time)).toContain("Autumn · Day 1");
    expect(fieldLook(h.time)).toBe("ripe");
    // and it plays on into the next day without trouble
    run(h, 13);
    expect(h.day).toBe(24);
    expect(seasonDay(h.time)).toBe(2);
  }, 60000);
});

describe("Convoys and landmarks in the game", () => {
  /** A started company with everything unlocked and a long road out of town. */
  function setup() {
    const g = new Game(7);
    g.start();
    g.money = 1e8;
    g.unlockAll();
    const t = g.towns.list[0];
    const a = gridPt(t.c, t.ang, 1 + 320 / BLOCK, 0), b = gridPt(t.c, t.ang, 1 + 900 / BLOCK, 0);
    road(g, a, b);
    return { g, a, b, t };
  }
  const ready = (b: Building) => { delete b.plant!.site; b.built = 1; };

  it("a machine works builds an oversized piece now and then and ships it by convoy; a power plant it reaches makes more for good", () => {
    const { g, a, b } = setup();
    const mw = placeAlong(g, "machineworks", a, b, 120);
    const cp = placeAlong(g, "coalplant", a, b, 120);
    ready(mw); ready(cp);
    // a piece takes LOADS_PER_PIECE loads of machinery's worth of work; the yard holds PIECE_YARD
    g.convoys.made(mw, LOADS_PER_PIECE - 1);
    expect(mw.plant!.big!.n).toBe(0);
    g.convoys.made(mw, 1);
    expect(mw.plant!.big!.n).toBe(1);
    g.convoys.made(mw, LOADS_PER_PIECE * 5);
    expect(mw.plant!.big!.n).toBe(PIECE_YARD);
    // the plant makes them as it works (Industry tells the convoys what it made)
    const made = mw.plant!.big!.prog;
    mw.plant!.big!.n = 1;
    mw.plant!.stock = { steel: 8, copper: 8 };
    g.industry.produce(mw, HOUR * 2);
    expect(mw.plant!.big!.prog).toBeGreaterThan(Math.min(made, 0.5) - 1);
    // it sets off on its own: one convoy at a time, to the coal plant (no landmark waits for a turbine)
    mw.plant!.big = { prog: 0, n: 2 };
    let arrived = 0;
    g.on((e) => { if (e.t === "toast" && /turbine/i.test(e.msg)) arrived++; });
    g.convoys.tick();
    g.convoys.tick();
    const conv = [...g.trips()].filter((t) => t.haul?.big);
    expect(conv.length).toBe(1);
    expect(conv[0].haul!.dest).toBe(cp.id);
    expect(mw.plant!.big!.n).toBe(1);
    // (its rated output, fully staffed and with coal in)
    const rated = () => g.utilities.outputOf({ ...cp, cap: 0, plant: { ...cp.plant!, stock: { coal: 5 } } } as Building);
    const before = rated();
    // it drives there through the real traffic sim, slowly, and the turbine goes in
    let top = 0;
    run(g, 6, () => {
      for (const v of g.traffic.vehicles as Vehicle[]) if (v.trip.haul?.big) top = Math.max(top, v.v);
      if ((cp.plant!.turbines ?? 0) >= 1) return;
    });
    expect(cp.plant!.turbines ?? 0).toBeGreaterThanOrEqual(1);
    expect(arrived).toBeGreaterThanOrEqual(1);
    expect(top).toBeGreaterThan(1);
    expect(top).toBeLessThanOrEqual(8.6);
    expect(g.progress.pieces).toBeGreaterThanOrEqual(1);
    expect(g.progress.isDone("bigiron")).toBe(true);
    const n = cp.plant!.turbines!;
    expect(rated() / before).toBeCloseTo(1 + n * TURBINE_BOOST, 5);
    // a plant takes MAX_TURBINES at most: a works with nowhere to send a piece keeps it in its yard
    cp.plant!.turbines = MAX_TURBINES;
    expect(g.convoys.destination(mw)).toBeNull();
  }, 120000);

  it("a landmark's site takes the freight's deliveries and its pieces, rises, completes and grants its reward", () => {
    const { g, a, b, t } = setup();
    // where it may stand: the tower in a City only; the fair beside a town
    expect(megaBlock("skylinetower", t.c, g.towns.list, () => 1, [])).toMatch(/City/);
    expect(megaBlock("exposition", { x: t.c.x + 9000, y: t.c.y }, g.towns.list, () => 1, [])).toMatch(/beside a town/);
    const ex = placeAlong(g, "exposition", a, b, 130);
    expect(g.placedPlan("exposition", ex.c)?.ok ?? false).toBe(false);
    const def = PLANTS.exposition;
    expect(ex.plant!.site).toBeDefined();
    expect(ex.plant!.landmark).toEqual({ pieces: 0 });
    // the freight sends it what it waits for: a construction plant's parts go there (after the chains' needs)
    const cpl = placeAlong(g, "constructionplant", a, b, 130);
    ready(cpl);
    const to = g.industry.customers(cpl, "parts").map((c) => c.b.id);
    expect(to).toContain(ex.id);
    // every material in, but not its girders: still a site
    for (const [p, n] of Object.entries(def.site!)) g.industry.deliver(ex, p as any, n as number);
    expect(ex.plant!.site).toBeDefined();
    expect(megaProgress(ex, def)).toBeLessThan(1);
    // the girders come by convoy
    const mw = placeAlong(g, "machineworks", a, b, 130);
    ready(mw);
    expect(g.convoys.destination(mw)?.b.id).toBe(ex.id);
    for (let k = 0; k < MEGAS.exposition.pieces.n; k++) {
      g.convoys.arrive({ trip: { haul: { plant: mw.id, leg: "out", product: "machinery", n: 0, dest: ex.id, big: "girder" } } } as unknown as Vehicle);
    }
    expect(ex.plant!.site).toBeUndefined();
    expect(ex.built).toBe(0);
    // it rises, and when it stands the company hears of it and the town gets its reward
    let banner = 0;
    g.on((e) => { if (e.t === "landmark" && e.b === ex.id) banner++; });
    run(g, 2);
    expect(ex.built).toBe(1);
    expect(banner).toBe(1);
    expect(ex.plant!.landmark!.done).toBeGreaterThan(0);
    expect(ex.plant!.landmark!.town).toBe(t.id);
    expect(townBoost(t.id, g.buildings.sites).growth).toBe(MEGAS.exposition.growth);
    expect(g.progressView().landmarks).toBe(1);
    // only one of each
    expect(placeAlongOk(g, "exposition", a, b)).toBe(false);
  }, 120000);

  it("the dam makes power with no coal; a Skyline Tower makes its city buy more", () => {
    const { g, a, b, t } = setup();
    const L = g.buildings.list;
    // (a dam placed by hand: the test road isn't on a shore)
    const cp = placeAlong(g, "coalplant", a, b, 120);
    ready(cp);
    cp.kind = "hydrodam";
    g.industry.init(cp, "hydrodam");
    ready(cp);
    expect(cp.plant!.stock.coal ?? 0).toBe(0);
    cp.cap = 0; // (staffed: no workers in a test town)
    expect(g.utilities.outputOf(cp)).toBeGreaterThan(300);
    // a finished tower in the town
    const tw = { ...cp, id: 99999, kind: "skylinetower", plant: { ...cp.plant!, landmark: { pieces: 4, done: 1, town: t.id } } } as Building;
    const want0 = g.towns.want(t.id, "food");
    L.push(tw);
    g.buildings.version++;
    const want1 = g.towns.want(t.id, "food");
    expect(want1).toBeGreaterThan(want0);
    expect(townBoost(t.id, g.buildings.sites).demand).toBeCloseTo(MEGAS.skylinetower.demand!, 6);
  }, 60000);

  it("a landmark's plot: the landmark at the back facing the gate, the truck yard and office by it, all inside the fence", () => {
    for (const kind of ["hydrodam", "skylinetower", "exposition"] as const) {
      const T = BUILDING_TYPES[kind];
      const L = siteLayout(kind, T.w, T.d, 3);
      const core = L.slots.find((s) => s.role === "core")!, yard = L.slots.find((s) => s.role === "yard")!;
      expect(core.model).toBe(`mega_${kind}`);
      expect(core.fy).toBe(-1);
      expect(yard.y - slotHalf(yard).hy).toBeLessThan(15);
      for (const s of L.slots) {
        const { hx, hy } = slotHalf(s);
        expect(Math.abs(s.x) + hx, `${kind} ${s.model}`).toBeLessThanOrEqual(T.w / 2 - 4);
        expect(s.y - hy).toBeGreaterThanOrEqual(4);
        expect(s.y + hy).toBeLessThanOrEqual(T.d - 4);
      }
      // the spine reaches the landmark's front without running under it
      expect(L.roads[0].b.y).toBeLessThanOrEqual(core.y - slotHalf(core).hy);
      expect(L.slots.every((s) => s.level === 1)).toBe(true);
    }
  });

  it("milestones open the landmarks; they have their own catalog tab", () => {
    const ids = MILESTONES.map((m) => m.id);
    for (const id of ["bigiron", "worldsfair"]) expect(ids).toContain(id);
    // (one block, after tier 4 and the City)
    const at = ["bigiron", "worldsfair"].map((id) => ids.indexOf(id));
    expect(at).toEqual([at[0], at[0] + 1]);
    expect(at[0]).toBeGreaterThan(ids.indexOf("machinery1"));
    expect(at[0]).toBeGreaterThan(ids.indexOf("city"));
    const tab = PLACED_TABS.find((x) => x.id === "landmarks")!;
    expect(tab.kinds).toEqual(["hydrodam", "skylinetower", "exposition"]);
    const g = new Game(7);
    g.start();
    expect(g.placedUnlocked("hydrodam")).toBe(false);
  });

  it("pieces, turbines, landmarks and convoys on the road survive a save; saves without them load", () => {
    const { g, a, b } = setup();
    const mw = placeAlong(g, "machineworks", a, b, 120);
    const cp = placeAlong(g, "coalplant", a, b, 120);
    const ex = placeAlong(g, "exposition", a, b, 130);
    ready(mw); ready(cp);
    cp.plant!.turbines = 2;
    ex.plant!.landmark!.pieces = 1;
    mw.plant!.big = { prog: 0.4, n: 1, shipped: 3 };
    g.progress.pieces = 3;
    g.convoys.tick(); // (one piece on its way to the fair: it goes back to the yard in the save)
    expect([...g.trips()].some((t) => t.haul?.big)).toBe(true);
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    expect(h.buildings.byId.get(mw.id)!.plant!.big).toEqual({ prog: 0.4, n: 1, shipped: 3 });
    expect(h.buildings.byId.get(cp.id)!.plant!.turbines).toBe(2);
    expect(h.buildings.byId.get(ex.id)!.plant!.landmark).toEqual({ pieces: 1 });
    expect(h.progress.pieces).toBe(3);
    // a save from before any of it
    const old = JSON.parse(JSON.stringify(json));
    const strip = (o: unknown): void => {
      if (!o || typeof o !== "object") return;
      for (const k of ["big", "turbines", "landmark", "pieces"]) delete (o as Record<string, unknown>)[k];
      for (const v of Object.values(o)) strip(v);
    };
    strip(old);
    const k = Game.load(old);
    expect(k.progress.pieces).toBe(0);
    expect(k.buildings.byId.get(cp.id)!.plant!.turbines).toBeUndefined();
    k.step(1 / 30);
    run(k, 0.25);
  }, 60000);
});

function placeAlongOk(g: Game, kind: "exposition", a: { x: number; y: number }, b: { x: number; y: number }): boolean {
  try { placeAlong(g, kind, a, b, 130); return true; } catch { return false; }
}
