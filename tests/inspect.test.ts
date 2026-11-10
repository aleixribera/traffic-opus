// The inspector (docs/ui-style.md "Inspector"): every panel's three key numbers come straight from the game state,
// the flow chips point at the places it really trades with, and a click picks what is under it: a moving vehicle
// forgivingly, then a building, a junction or a road.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { blockOf, gridPt } from "../src/game/towns";
import { Industry, PRODUCTS } from "../src/game/industry";
import { F } from "../src/world/gen";
import { seasonMult } from "../src/game/calendar";
import type { V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import {
  GROUND_HILLS, GROUND_WATER, STUCK_NEAR, TradeLedger, WORK_LINE, approaches, congestion, extractorFor, fmtNum, fmtRate, groundAt,
  groundModel, homeModel, junctionModel, metresLeft, modelOf, patchAt, roadModel, routeLine, routesThrough, siteModel,
  splitProblem, stuckAt, stuckModel, townModel, townStatus, trucksOut, vehicleModel, vehiclesOnSeg, waitTone, type Sel,
} from "../src/ui/inspect";
import { dkDir, dkSeg } from "../src/sim/router";
import { junctionAt, pickAt, pickRadius, poseOf, vehicleAt } from "../src/ui/pick";
import { placeAlong, road } from "./helpers";
import { shownRate } from "../src/ui/bottleneck";

const compass = () => "N";

/** The first chain a player builds on seed 7 (as in economy.test.ts): a farm on fertile soil and a food plant by the town. */
function chain(g: Game) {
  g.start();
  const t = g.towns.list[0];
  const end = gridPt(t.c, t.ang, 1 + 320 / blockOf(t), 0, blockOf(t));
  let f: V2 | null = null, bd = Infinity;
  for (let r = 50; r < 1200 && !f; r += 25) for (let k = 0; k < 48; k++) {
    const p = { x: end.x + Math.cos((k / 48) * 6.283) * r, y: end.y + Math.sin((k / 48) * 6.283) * r };
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(F.fert, { x: p.x + i * 15, y: p.y + j * 15 })) ok++;
    if (ok >= 20 && r < bd) { bd = r; f = p; }
  }
  const far = { x: f!.x + ((f!.x - end.x) / bd) * 80, y: f!.y + ((f!.y - end.y) / bd) * 80 };
  road(g, end, far);
  const farm = placeAlong(g, "farm", end, far, 35);
  const foodplant = placeAlong(g, "foodplant", gridPt(t.c, t.ang, 1, 0, blockOf(t)), end, 35);
  return { t, farm, foodplant };
}

describe("The inspector's panels", () => {
  let g: Game, farm: Building, foodplant: Building, led: TradeLedger;
  const truckOf = (b: Building) => g.traffic.vehicles.find((v) => v.trip.haul?.plant === b.id && v.trip.haul.leg === "out");
  beforeAll(() => {
    g = new Game(7);
    ({ farm, foodplant } = chain(g));
    for (const b of [farm, foodplant]) { b.built = 1; if (b.plant) b.plant.site = undefined; }
    led = new TradeLedger();
    // until a farm truck is out on the road with a load (the ledger watching as the HUD's tick would)
    for (let i = 0; i < 8 * HOUR * 30; i++) {
      g.step(1 / 30);
      if (i % 30 === 0) led.observe(g);
      if (i > 4 * HOUR * 30 && truckOf(farm) && truckOf(farm)!.v > 1) break;
    }
  }, 240_000);

  it("a producing site: output an hour (made vs can make), what it earns or ships, and trucks out of the fleet", () => {
    const m = siteModel(g, farm, led);
    expect(m.keys).toHaveLength(3);
    // (its pace now, the season's swing included: a farm in autumn can make more than its year-round pace)
    // (one source with its status and the town's advice, and never above what it can make)
    const { rate: r, can } = shownRate(g, farm, "crops");
    expect(can).toBeCloseTo((Industry.perDay(farm, "crops") / 24) * seasonMult("farm", g.time));
    expect(r).not.toBeNull();
    expect(r!).toBeLessThanOrEqual(can + 1e-9);
    expect(m.keys[0]).toMatchObject({ value: fmtRate(r!), unit: "/h", label: `crops, can ${fmtRate(can)}` });
    // crops only feed your own plants: no price, so it shows what it shipped, not a "profit" that's only costs
    expect(m.keys[1].label).toMatch(/shipped, last hour$/);
    expect(m.keys[1].value).toBe(String(farm.plant!.last.sent));
    const out = trucksOut(g, farm);
    expect(out.busy).toBeGreaterThan(0);
    expect(m.keys[2]).toMatchObject({ value: String(out.busy), unit: `/${g.industry.trucksOf(farm)}`, label: "trucks out" });
    // its trucks on the road are lit with it
    expect(m.related.vehicles.sort()).toEqual(out.ids.sort());
    expect(m.related.self).toEqual([farm.id]);
    // From: the soil under it; To: the food plant its trucks really drive to (a chip that selects it)
    const from = m.flow.find((r) => r.label === "From")!, to = m.flow.find((r) => r.label === "To")!;
    expect(from.chips[0].text).toBe("Fertile soil");
    expect(to.chips.some((c) => c.ref?.k === "building" && c.ref.id === foodplant.id)).toBe(true);
    expect(m.related.to).toContain(foodplant.id);
    expect(m.badge).toBe(`Lv ${farm.plant!.level}/${4}`);
    // the season: one small tag in the status line ("Autumn harvest ×1.6"), nothing more
    expect(m.status.tag).toMatch(/^(Spring|Summer|Autumn|Winter) (sowing|growing|harvest|fallow) ×\d\.\d$/);
    // (named at both ends: this level and the next)
    expect(m.level?.from).toBe(`Level ${farm.plant!.level}`);
    expect(m.level?.to).toBe(`Level ${farm.plant!.level + 1}`);
  });

  it("a product the towns pay for shows profit; the food plant's farm shows as its source", () => {
    const m = siteModel(g, foodplant, led);
    const P = foodplant.plant!;
    expect(m.keys[1]).toMatchObject({ label: "profit, last hour", tone: P.last.earned - P.last.spent > 0 ? "good" : P.last.earned - P.last.spent < 0 ? "bad" : "" });
    const from = m.flow.find((r) => r.label === "From")!;
    expect(from.chips.some((c) => c.ref?.k === "building" && c.ref.id === farm.id)).toBe(true);
    expect(m.related.from).toContain(farm.id);
  });

  it("a town: people, how many of its needs are met, and how it grows in words", () => {
    const t = g.towns.list[0];
    const m = townModel(g, t, led);
    expect(m.keys).toHaveLength(2);
    expect(m.keys[0].value).toBe(fmtNum(t.pop));
    expect(m.keys[0].label).toMatch(/^people/);
    // (each need is read out in the panel's "What it needs" rows: tests/needs.test.ts)
    expect(m.keys[1].label).toBe("needs met");
    expect(m.keys[1].value).toMatch(/^\d+$/);
    expect(m.status.text).not.toMatch(/\d/);
    expect(m.related.self).toContain(t.hall);
  });

  it("a town that sprang up says it has no road yet; a site held at its kind's level waits for a goal, not in trouble", () => {
    const t = g.towns.list[0];
    const was = { spawned: t.spawned, today: t.today, yesterday: t.yesterday, days: t.hist.days };
    Object.assign(t, { spawned: true, today: {}, yesterday: {} });
    t.hist.days = [];
    expect(townStatus(t).text).toBe("No road yet");
    // (this one has the company's roads at its door: it is joined, and waiting for its first load. Play-test A10)
    expect(townModel(g, t, led).status.text).toBe("Joined by road");
    Object.assign(t, { spawned: was.spawned, today: was.today, yesterday: was.yesterday });
    t.hist.days = was.days;
    const P = farm.plant!, why = P.why;
    P.why = 'Level 3 opens with the goal "Two villages"';
    const lv = siteModel(g, farm, led).level!;
    expect(lv.line).toBe("opens with the goal “Two villages”");
    expect(lv.tone ?? "").toBe("");
    P.why = why;
  });

  it("a loaded truck: its loads, what they're worth, and arrival; cargo, from its farm to its plant, its route lit", () => {
    const v = truckOf(farm)!;
    const h = v.trip.haul!;
    const m = vehicleModel(g, v);
    expect(m.title).toMatch(/truck/i);
    expect(m.sub).toMatch(/of crops$/);
    // crops feed your own food plant: nobody pays for them, so no cargo value
    expect(m.keys.map((k) => k.label)).toEqual(["crops", "for your own plant", expect.stringMatching(/^arrives · [\d.]+ k?m to go$/)]);
    expect(m.keys[0].value).toBe(String(h.n));
    expect(metresLeft(g, v)).toBeGreaterThan(0);
    expect(m.keys[2].value).toMatch(/^\d\d:\d\d$/); // (to the minute, as the clock counts)
    expect(m.flow.map((r) => r.label)).toEqual(["Cargo", "From", "To"]);
    expect(m.flow[0].chips[0]).toMatchObject({ product: "crops", note: `${h.n} load${h.n === 1 ? "" : "s"}` });
    expect(m.flow[1].chips[0].ref).toEqual({ k: "building", id: farm.id });
    expect(m.flow[2].chips[0].ref).toEqual({ k: "building", id: h.dest });
    expect(m.status.tag).toBe("Outbound");
    expect(m.related).toMatchObject({ route: v.id, from: [farm.id], to: [h.dest] });
  });

  it("a vehicle's route line is its planned route: the pieces behind, where it is, then every piece ahead", () => {
    const v = truckOf(farm)!;
    const piece = (k: number) => {
      const P = g.net.segGeom.get(dkSeg(k))!.center.pts;
      return (dkDir(k) === 1 ? P : [...P].reverse()).flatMap((p) => [p.x, p.y]);
    };
    const { pts, cut } = routeLine(g, v);
    // the point at `cut` is the vehicle itself
    const q = poseOf(v, 1);
    expect(pts[cut * 2]).toBeCloseTo(q.x, 6);
    expect(pts[cut * 2 + 1]).toBeCloseTo(q.y, 6);
    // it ends with exactly the route's pieces still ahead, in order
    const ahead = v.route.slice(v.ri + 1).flatMap(piece);
    expect(pts.slice(pts.length - ahead.length)).toEqual(ahead);
    // and starts with the pieces it drove (as given: the trail the map keeps)
    const behind = v.route.slice(0, Math.max(0, v.ri));
    if (behind.length) expect(pts.slice(0, piece(behind[0]).length)).toEqual(piece(behind[0]));
  });

  it("a road lists the trips through it (the vehicles on it now), and the map draws their whole routes", () => {
    let seg = -1;
    for (const s of g.net.segs.keys()) if (vehiclesOnSeg(g, s).all.length > (seg < 0 ? 0 : vehiclesOnSeg(g, seg).all.length)) seg = s;
    expect(seg).toBeGreaterThanOrEqual(0);
    const on = vehiclesOnSeg(g, seg).all;
    const trips = routesThrough(g, seg);
    expect(trips.map((t) => t.id).sort()).toEqual(on.map((v) => v.id).sort());
    for (const t of trips) {
      const v = on.find((o) => o.id === t.id)!;
      expect(t.freight).toBe(!!v.trip.haul);
      if (!v.trip.haul) expect([t.from, t.to]).toEqual([v.trip.from, v.trip.to]);
    }
    expect(roadModel(g, seg)!.related.routes!.sort()).toEqual(on.map((v) => v.id).sort());
  });

  it("a site draws its trade as flow lines in its products' colours; a home draws lines to where its people work", () => {
    const m = siteModel(g, farm, led);
    const f = m.related.flows!.find((l) => l.b.x === foodplant.c.x && l.b.y === foodplant.c.y)!;
    expect(f).toBeDefined();
    expect(f).toMatchObject({ a: farm.c, color: PRODUCTS.crops.color, kind: "goods" });
    expect(f.n).toBeGreaterThan(0);
    // a home with working residents: a line from it to each workplace, as many people as the row says
    const home = g.buildings.list.find((b) => b.zone && homeModel(g, b).flow.some((r) => r.label === "Work at"))!;
    expect(home).toBeDefined();
    const hm = homeModel(g, home);
    const row = hm.flow.find((r) => r.label === "Work at")!;
    for (const c of row.chips) {
      const w = g.buildings.byId.get(c.ref!.id)!;
      const line = hm.related.flows!.find((l) => l.b === w.c);
      expect(line).toMatchObject({ a: home.c, kind: "people", color: WORK_LINE });
      const n = [...g.people.citizens.values()].filter((p) => p.home === home.id && p.job === w.id).length;
      expect(line!.n).toBe(n);
    }
  });

  it("open ground picks what is there: water, a deposit, soil or forest, or nothing on plain land", () => {
    // the farm's own soil (somewhere on its lot): fertile, worked by the farm, with its extractor offered
    const onSoil = Array.from({ length: 81 }, (_, i) => ({ x: farm.c.x + ((i % 9) - 4) * farm.hw / 4, y: farm.c.y + (Math.floor(i / 9) - 4) * farm.hd / 4 })).find((p) => groundAt(g, p)?.id === F.fert)!;
    expect(onSoil).toBeDefined();
    const soil = groundAt(g, onSoil);
    expect(soil?.id).toBe(F.fert);
    {
      const m = groundModel(g, soil as Extract<Sel, { k: "ground" }>);
      expect(m.title).toBe("Fertile soil");
      // its patch: the soil joined to the click, flooded from there (at least the 40 m cell clicked)
      const patch = patchAt(g, F.fert, onSoil);
      expect(patch.ha).toBeGreaterThan(1);
      expect(Math.hypot(patch.c.x - onSoil.x, patch.c.y - onSoil.y)).toBeLessThan(1300);
      expect(m.keys[1].value).toMatch(/^[1-9][\d,]*\+?$/);      expect(m.related.to).toContain(farm.id);
      expect(m.flow.find((r) => r.label === "Worked by")!.chips.some((c) => c.ref?.id === farm.id)).toBe(true);
      expect(modelOf(g, soil!, led, compass)?.title).toBe("Fertile soil");
    }
    expect(extractorFor(g, F.fert)).toBe("farm");
    // scan the map round the town for one point of each
    const t = g.towns.list[0];
    const seen = new Map<number | null, V2>();
    for (let i = -40; i <= 40 && seen.size < 6; i++) for (let j = -40; j <= 40; j++) {
      const p = { x: t.c.x + i * 120, y: t.c.y + j * 120 };
      const s = groundAt(g, p);
      if (!seen.has(s?.id ?? null)) seen.set(s?.id ?? null, p);
    }
    for (const [id, p] of seen) {
      if (id === null) {
        expect(g.terrain.isWater(p) || g.terrain.isMountain(p) || g.terrain.has(F.fert, p) || g.terrain.has(F.forest, p)).toBe(false);
        continue;
      }
      if (id === GROUND_WATER) expect(g.terrain.isWater(p)).toBe(true);
      else if (id === GROUND_HILLS) expect(g.terrain.isMountain(p)).toBe(true);
      else expect(g.terrain.has(id, p)).toBe(true);
      // every kind opens a panel
      expect(modelOf(g, { k: "ground", id, x: p.x, y: p.y }, led, compass)?.title).toBeTruthy();
    }
    expect(seen.has(null)).toBe(true);
    // a road or building still wins over the ground under it
    expect(pickAt(g, farm.c, 0.3, false)).toEqual({ k: "building", id: farm.id });
  });

  it("a stuck diamond opens the vehicles standing there and the roads they hold up", () => {
    const v = truckOf(farm) ?? g.traffic.vehicles[0];
    const was = v.stuck;
    v.stuck = 200;
    try {
      const m = stuckModel(g, { k: "stuck", id: 1, x: v.x + 20, y: v.y });
      expect(m.related.vehicles[0]).toBe(v.id);
      expect(m.related.rings![0]).toMatchObject({ r: STUCK_NEAR, tone: "spot" });
      expect(m.flow.find((r) => r.label === "Vehicles")!.chips.some((c) => c.ref?.k === "vehicle" && c.ref.id === v.id)).toBe(true);
      expect(stuckAt(g, { x: v.x + STUCK_NEAR * 2, y: v.y }).some((o) => o.id === v.id)).toBe(false);
    } finally { v.stuck = was; }
  });

  it("a road: vehicles on it now, speed against the limit, how full; a junction: queues and the worst approach", () => {
    const v = truckOf(farm)!;
    const seg = "seg" in v.edge ? (v.edge.seg as number) : null;
    const s = seg ?? [...g.net.segs.keys()][0];
    const m = roadModel(g, s)!;
    expect(m.keys).toHaveLength(3);
    expect(m.keys[0].value).toBe(String(vehiclesOnSeg(g, s).all.length));
    expect(m.related.segs).toEqual([s]);
    expect(congestion(0.95, 3).word).toBe("Free-flowing");
    expect(congestion(0.1, 12).tone).toBe("bad");
    const node = [...g.net.nodeGeom.entries()].find(([, ng]) => ng.kind === "junction" && ng.arms.length >= 3)![0];
    const j = junctionModel(g, node, compass)!;
    expect(j.keys.map((k) => k.label)).toEqual(["vehicles queued", "longest wait", "crossing now"]);
    // each approach: its vehicles, queued and the longest wait among them
    const ap = approaches(g, node);
    expect(ap.length).toBe(g.net.nodeGeom.get(node)!.arms.length);
    for (const a of ap) expect(a.queue).toBeLessThanOrEqual(a.cars);
    expect(waitTone(70)).toBe("bad");
    expect(waitTone(5)).toBe("good");
    expect(j.related.segs.length).toBe(g.net.nodeGeom.get(node)!.arms.length);
    // modelOf dispatches by what is selected
    expect(modelOf(g, { k: "node", id: node }, led, compass)?.title).toBe(j.title);
    expect(modelOf(g, { k: "vehicle", id: -1 }, led, compass)).toBeNull();
  });

  it("problem lines split into what's wrong and what to do", () => {
    expect(splitProblem("No buyer: build a plant that uses steel")).toMatchObject({ text: "No buyer" });
    expect(splitProblem("No buyer: build a plant that uses steel").fix).toMatch(/steel/);
  });

  it("picking: a vehicle along its whole body within a few pixels, else the building, the junction or the road", () => {
    const v = truckOf(farm) ?? g.traffic.vehicles[0];
    const q = poseOf(v, g.alpha);
    const back = { x: q.x - Math.cos(q.ang) * v.len * 0.8, y: q.y - Math.sin(q.ang) * v.len * 0.8 };
    // its tail, not just its centre, picks it
    expect(vehicleAt(g.traffic.vehicles, back, 1.5, g.alpha)?.id).toBe(v.id);
    expect(pickAt(g, back, 0.3)).toEqual({ k: "vehicle", id: v.id });
    // a few pixels to the side: forgiving at a far zoom, a miss when zoomed right in
    const side = { x: q.x - Math.sin(q.ang) * 5.5, y: q.y + Math.cos(q.ang) * 5.5 };
    const others = g.traffic.vehicles.filter((o) => o.id !== v.id && Math.hypot(o.x - side.x, o.y - side.y) < 40);
    if (!others.length) {
      expect(vehicleAt(g.traffic.vehicles, side, pickRadius(1), g.alpha)?.id).toBe(v.id);
      expect(vehicleAt(g.traffic.vehicles, side, pickRadius(0.1), g.alpha)).toBeNull();
    }
    // zoomed out past where vehicles are drawn they aren't picked
    expect(pickAt(g, back, 0.3, false)?.k).not.toBe("vehicle");
    // a building's plot picks the building
    expect(pickAt(g, farm.c, 0.3, false)).toEqual({ k: "building", id: farm.id });
    // a junction's centre picks the junction; partway along a road picks the road
    const [node] = [...g.net.nodeGeom.entries()].find(([id, ng]) => ng.kind === "junction" && ng.arms.length >= 3 && !g.buildings.at(g.net.nodes.get(id)!.p))!;
    const np = g.net.nodes.get(node)!.p;
    expect(junctionAt(g, np, 0.3)).toBe(node);
    expect(pickAt(g, np, 0.3, false)).toEqual({ k: "node", id: node });
    const [seg, geo] = [...g.net.segGeom.entries()].find(([, sg]) => sg.center.length > 120)!;
    const mid = geo.center.pts[Math.floor(geo.center.pts.length / 2)];
    const at = pickAt(g, mid, 0.3, false);
    if (!g.buildings.at(mid)) expect(at).toEqual({ k: "seg", id: seg });
    // empty ground far from anything: nothing
    expect(pickAt(g, { x: 99999, y: 99999 }, 0.3, false)).toBeNull();
  });

  it("the trade ledger remembers who sent what to whom, and forgets it on another game", () => {
    const runs = [...led.runs()];
    expect(runs.some((r) => r.from === farm.id && r.to === foodplant.id && r.p === "crops")).toBe(true);
    // another game: nothing carried over (its ids name other things)
    const other = new TradeLedger();
    other.observe(g);
    expect([...other.runs()].length).toBeGreaterThan(0);
    other.observe(new Game(8));
    expect([...other.runs()]).toEqual([]);
  });
});
