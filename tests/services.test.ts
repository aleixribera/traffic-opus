import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, snap, type Snap } from "../src/roads/planner";
import { v2, type V2 } from "../src/core/math";
import { HOUR, St } from "../src/game/society";
import { ZONE_GROUP } from "../src/game/growables";
import type { ServiceKind } from "../src/game/services";
import type { Building } from "../src/game/buildings";
import { dkSeg } from "../src/sim/router";

const free = (p: V2): Snap => ({ p, h: 0, guides: [] });

function road(g: Game, a: V2, b: V2, type: any = "street") {
  const sa = snap(g.net, a, { mpp: 0.5, level: 0, type });
  const sb = snap(g.net, b, { mpp: 0.5, level: 0, type });
  const plan = planRoad(g.net, g.world, {
    start: sa.node !== undefined || sa.seg !== undefined ? sa : free(a),
    end: sb.node !== undefined || sb.seg !== undefined ? sb : free(b), mode: "straight", type,
  });
  expect(plan.errors.map((e) => e.msg)).toEqual([]);
  expect(g.build(plan)).toBe(true);
}

function run(g: Game, hours: number, each?: () => void) {
  for (let i = 0; i < hours * HOUR * 30; i++) {
    g.step(1 / 30);
    if (each && i % 30 === 0) each();
  }
}

const okCells = (g: Game) => [...g.zones.allCells()].filter((c) => c.ok);

/** The city test's town on seed 7, plus a spare street off the motorway link for services. */
function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  const cells = okCells(g);
  g.zonePaint(cells.filter((c) => c.c.y < -150), "resLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x < -100), "comLow");
  g.zonePaint(cells.filter((c) => c.c.y >= -150 && c.c.x >= -100), "ind");
}

/** Place a service near p (trying a few spots along the motorway link, which isn't zoned). */
function place(g: Game, kind: ServiceKind, t = 0.35): Building {
  for (let k = 0; k < 40; k++) {
    const tt = t + k * 0.012;
    const q = v2(366 * tt, 473 * tt);
    for (const side of [1, -1]) {
      const p = v2(q.x + side * 0.79 * 30, q.y - side * 0.61 * 30);
      const pl = g.servicePlan(kind, p);
      if (pl?.ok) {
        const b = g.placeService(kind, p);
        expect(b).not.toBeNull();
        return b!;
      }
    }
  }
  throw new Error("no spot for " + kind);
}

describe("City services", () => {
  it("a station covers what its vehicles can reach in time over the roads", () => {
    const g = new Game(7);
    town(g);
    g.milestone = 1;
    g.money = 1e6;
    run(g, 6);
    const fs = place(g, "firestation");
    expect(fs.svc).toBe(true);
    const reach = g.services.reachOf(fs);
    expect(reach.size).toBeGreaterThan(4);
    // a seg next to the station is covered; a far motorway piece isn't
    expect(reach.get(fs.access!.seg)).toBe(0);
    const homes = g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res");
    expect(homes.length).toBeGreaterThan(0);
    // staffed stations cover; give it staff then check
    g.people.staff.set(fs.id, 6);
    const c = g.services.coverageOf(homes[0]);
    expect(c.fire).toBeGreaterThan(0.2);
    expect(c.police).toBe(0);
  }, 60000);

  it("placing a service building clears zoned buildings under it, costs money, and undo restores them", () => {
    const g = new Game(7);
    town(g);
    g.milestone = 4;
    g.money = 1e6;
    run(g, 20);
    const homes = g.buildings.list.filter((b) => b.zone === "resLow" && b.built >= 1);
    expect(homes.length).toBeGreaterThan(4);
    // a high school is big: put it on the homes
    // the first home a high school fits on (which homes grow depends on the city's traffic)
    const order = [...homes.slice(Math.floor(homes.length / 2)), ...homes.slice(0, Math.floor(homes.length / 2))];
    const target = order.find((h) => { const p = g.servicePlan("highschool", h.c); return p?.ok && p.clears!.length > 0; }) ?? order[0];
    const pl = g.servicePlan("highschool", target.c);
    expect(pl?.ok, pl?.reason).toBe(true);
    expect(pl!.clears!.length).toBeGreaterThan(0);
    const m0 = g.money;
    const b = g.placeService("highschool", target.c)!;
    expect(b).not.toBeNull();
    expect(g.money).toBe(m0 - pl!.cost);
    for (const id of pl!.clears!) expect(g.buildings.byId.has(id)).toBe(false);
    // nothing grows under it
    expect(g.lotCells(b).every((c) => c.lot === b.id)).toBe(true);
    g.undo();
    expect(g.buildings.byId.has(b.id)).toBe(false);
    for (const id of pl!.clears!) expect(g.buildings.byId.has(id)).toBe(true);
    expect(g.money).toBe(m0);
  }, 60000);

  it("locked services can't be placed", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    let reason = "";
    for (let k = 0; k < 40 && !reason; k++) {
      const tt = 0.35 + k * 0.012;
      const pl = g.servicePlan("hospital", v2(366 * tt + 30, 473 * tt - 20));
      if (pl && pl.reason === "Not unlocked yet") reason = pl.reason;
    }
    expect(reason).toBe("Not unlocked yet");
  });

  it("a town with no services fills up with garbage and its residents grow unhappy", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1; // problems start at Hamlet
    run(g, 90); // (a house's bins take three or four days to overflow)
    const homes = g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && g.people.householdsIn(b.id) > 0);
    const piled = homes.filter((b) => (b.garbage ?? 0) > 45).length;
    expect(piled, "homes with garbage piling up").toBeGreaterThan(homes.length * 0.5);
    expect(homes.some((b) => b.problem === "Garbage piling up")).toBe(true);
    const f = g.demand.res.factors.find((x) => x.label === "City services");
    expect(f && f.v).toBeLessThan(0);
  }, 120000);

  it("garbage trucks, ambulances, police and schools work through real traffic", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1;
    const st = [place(g, "garbage", 0.3), place(g, "clinic", 0.45), place(g, "police", 0.55), place(g, "school", 0.65)];
    let svcCars = 0, schoolCars = 0, maxBusy = 0;
    const kinds = new Set<string>();
    run(g, 44, () => {
      for (const v of g.traffic.vehicles) {
        if (v.trip.run) { svcCars++; kinds.add(v.trip.run.svc); }
        if (v.trip.kind === "school") schoolCars++;
      }
      for (const s of st) maxBusy = Math.max(maxBusy, s.busy ?? 0);
    });
    for (const s of st) expect(g.people.workersAt(s.id), s.kind + " staff").toBeGreaterThan(0);
    expect(svcCars).toBeGreaterThan(0);
    expect(kinds.has("garbage")).toBe(true);
    expect(maxBusy).toBeGreaterThan(0);
    // garbage is being collected: few homes have it piling up
    const homes = g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && g.people.householdsIn(b.id) > 0);
    const piled = homes.filter((b) => (b.garbage ?? 0) > 45).length;
    expect(piled, `${piled}/${homes.length} homes with garbage piling up`).toBeLessThan(homes.length * 0.25);
    // children go to school
    const kids = [...g.people.citizens.values()].filter((c) => c.age === 0);
    if (kids.length) {
      expect(kids.filter((c) => c.school >= 0).length).toBeGreaterThan(kids.length * 0.5);
      expect(schoolCars).toBeGreaterThan(0);
    }
    // nobody is left in a broken state: patients either home, travelling or in care
    for (const c of g.people.citizens.values()) if (c.kind === "service") expect([St.Travel, St.Away]).toContain(c.st);
    // the vehicles all come back eventually
    g.milestone = 0; // stop new calls
    for (const b of g.buildings.list) { b.garbage = 0; b.crime = 0; b.fire = 0; }
    for (const c of g.people.citizens.values()) if (c.sick && c.st === St.Home) c.sick = 0;
    run(g, 8);
    for (const s of st) expect(s.busy ?? 0, s.kind + " vehicles still out").toBe(0);
    // upkeep is charged
    expect(g.budget.expense.services).toBeGreaterThan(0);
  }, 180000);

  it("a garbage truck empties the bins along the roads it has driven, and no others", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1;
    place(g, "garbage", 0.3);
    for (const b of g.buildings.list) if (!b.svc) b.garbage = 60;
    // a truck out on its round, a few roads in
    let truck: any = null;
    for (let i = 0; i < 12 * HOUR * 30 && !truck; i++) {
      g.step(1 / 30);
      truck = g.traffic.vehicles.find((v) => v.trip.run?.svc === "garbage" && v.trip.run.leg === "out" && v.ri >= 1) ?? null;
    }
    expect(truck, "a garbage truck a few roads into its round").not.toBeNull();
    const driven = new Set<number>();
    for (let i = 0; i <= truck.ri; i++) driven.add(dkSeg(truck.route[i]));
    for (const b of g.buildings.list) if (!b.svc) b.garbage = 30;
    truck.trip.run.swept = 0;
    truck.trip.run.load = 0;
    (g.services as any).sweep();
    const emptied = g.buildings.list.filter((b) => !b.svc && b.access && b.garbage === 0);
    const along = g.buildings.list.filter((b) => !b.svc && b.access && driven.has(b.access.seg));
    expect(along.length, "buildings on the roads it drove").toBeGreaterThan(0);
    expect(emptied.map((b) => b.id).sort(), "bins emptied").toEqual(along.map((b) => b.id).sort());
  }, 120000);

  it("fire engines put fires out; without a station the building burns down", () => {
    for (const withStation of [true, false]) {
      const g = new Game(7);
      town(g);
      g.money = 1e6;
      run(g, 12);
      g.milestone = 1;
      if (withStation) { const fs = place(g, "firestation"); run(g, 3); expect(g.people.workersAt(fs.id)).toBeGreaterThan(0); }
      const homes = g.buildings.list.filter((b) => b.zone && ZONE_GROUP[b.zone] === "res" && b.built >= 1);
      const b = homes[0];
      b.fire = g.time;
      let engine = false;
      run(g, 5, () => { if (g.traffic.vehicles.some((v) => v.trip.run?.svc === "fire")) engine = true; });
      if (withStation) {
        expect(engine).toBe(true);
        expect(g.buildings.byId.has(b.id)).toBe(true);
        expect(b.fire).toBe(0);
      } else {
        expect(g.buildings.byId.has(b.id)).toBe(false);
      }
    }
  }, 180000);

  it("painting zones over a service building leaves it standing", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    const sc = place(g, "school");
    const under = g.lotCells(sc);
    expect(under.length).toBeGreaterThan(0);
    g.zonePaint(under, "resLow");
    expect(g.buildings.byId.has(sc.id), "school survives repainting").toBe(true);
    g.zonePaint(under, null);
    expect(g.buildings.byId.has(sc.id), "school survives erasing zones").toBe(true);
  });

  it("a service leg that traffic reports twice is only counted once", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    g.milestone = 1;
    const fs = place(g, "firestation");
    fs.busy = 2;
    const trip = { kind: "service", from: fs.id, to: fs.id, resident: -1, startT: 0, freeFlow: 0, run: { svc: "fire", station: fs.id, target: fs.id, leg: "out" } } as any;
    g.services.onFail(trip);
    g.services.onFail(trip);
    expect(fs.busy).toBe(1);
  });

  it("demolishing a clinic mid-run strands nobody, and undo brings it back with honest counts", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1;
    const cl = place(g, "clinic");
    run(g, 4);
    expect(g.people.workersAt(cl.id)).toBeGreaterThan(0);
    // make residents ill until an ambulance is out with one aboard (or on its way)
    let out = false;
    for (let k = 0; k < 40 && !out; k++) {
      for (const c of g.people.citizens.values()) if (c.home >= 0 && c.st === St.Home && !c.sick) { c.sick = g.time; break; }
      run(g, 0.25);
      out = g.traffic.vehicles.some((v) => v.trip.run?.svc === "health");
    }
    expect(out, "an ambulance went out").toBe(true);
    // ride along until someone is aboard, if that happens soon
    for (let k = 0; k < 60; k++) {
      if ([...g.people.citizens.values()].some((c) => c.kind === "service" && c.st === St.Travel)) break;
      run(g, 0.05);
    }
    g.bulldoze([], [cl.id]);
    run(g, 6);
    // nobody waits forever in a vehicle that has nowhere to go
    const stuck = [...g.people.citizens.values()].filter((c) => c.kind === "service" && c.st === St.Travel && c.next === Infinity);
    const aboard = new Set(g.traffic.vehicles.map((v) => v.trip.run?.patient).filter((x) => x !== undefined));
    expect(stuck.filter((c) => !aboard.has(c.id)).map((c) => c.id), "patients stranded").toEqual([]);
    // the clinic comes back with only what's really out and really in
    g.undo();
    const back = g.buildings.byId.get(cl.id)!;
    const live = g.traffic.vehicles.filter((v) => v.trip.run?.station === cl.id && !v.trip.run.done).length
      + g.traffic.pending.filter((p) => p.trip.run?.station === cl.id && !p.trip.run.done).length;
    expect(back.busy ?? 0).toBe(live);
    expect(back.users ?? 0).toBe([...g.people.citizens.values()].filter((c) => c.kind === "service" && c.st === St.Away && c.at === cl.id).length);
  }, 120000);

  it("a full clinic sends no more ambulances", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1;
    const cl = place(g, "clinic");
    run(g, 4);
    cl.users = 12; // every bed taken
    let sent = false;
    for (let k = 0; k < 8; k++) {
      for (const c of g.people.citizens.values()) if (c.home >= 0 && c.st === St.Home && !c.sick) { c.sick = g.time; break; }
      run(g, 0.25, () => { if (g.traffic.vehicles.some((v) => v.trip.run?.svc === "health")) sent = true; });
    }
    expect(sent).toBe(false);
  }, 120000);

  it("round-trips a save with service buildings and pupils", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 6);
    g.milestone = 1;
    const sc = place(g, "school");
    run(g, 20);
    const users = sc.users ?? 0;
    const g2 = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    const sc2 = g2.buildings.byId.get(sc.id)!;
    expect(sc2.svc).toBe(true);
    expect(sc2.kind).toBe("school");
    expect(sc2.users ?? 0).toBe(users);
    expect(sc2.busy ?? 0).toBe(0);
    run(g2, 2);
  }, 120000);
});
