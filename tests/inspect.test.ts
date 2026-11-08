// The inspector (docs/ui-style.md "Inspector"): every panel's three key numbers come straight from the game state,
// the flow chips point at the places it really trades with, and a click picks what is under it: a moving vehicle
// forgivingly, then a building, a junction or a road.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { BLOCK, gridPt } from "../src/game/towns";
import { Industry } from "../src/game/industry";
import { F } from "../src/world/gen";
import { seasonMult } from "../src/game/calendar";
import type { V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import {
  TradeLedger, congestion, fmtNum, fmtRate, junctionModel, metresLeft, modelOf, rateLately, roadModel, siteModel, splitProblem,
  townModel, trucksOut, vehicleModel, vehiclesOnSeg,
} from "../src/ui/inspect";
import { junctionAt, pickAt, pickRadius, poseOf, vehicleAt } from "../src/ui/pick";
import { placeAlong, road } from "./helpers";

const compass = () => "N";

/** The first chain a player builds on seed 7 (as in economy.test.ts): a farm on fertile soil and a food plant by the town. */
function chain(g: Game) {
  g.start();
  const t = g.towns.list[0];
  const end = gridPt(t.c, t.ang, 1 + 320 / BLOCK, 0);
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
  const foodplant = placeAlong(g, "foodplant", gridPt(t.c, t.ang, 1, 0), end, 35);
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
    const r = rateLately(farm, "crops"), can = (Industry.perDay(farm, "crops") / 24) * seasonMult("farm", g.time);
    expect(r).not.toBeNull();
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
    expect(m.level?.label).toBe(`Lv ${farm.plant!.level + 1}`);
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
    expect(townModel(g, t, led).status.text).toBe("No road yet");
    Object.assign(t, { spawned: was.spawned, today: was.today, yesterday: was.yesterday });
    t.hist.days = was.days;
    const P = farm.plant!, why = P.why;
    P.why = 'Level 3 opens with the goal "Two villages"';
    const lv = siteModel(g, farm, led).level!;
    expect(lv.line).toBe("opens with the goal “Two villages”");
    expect(lv.tone ?? "").toBe("");
    P.why = why;
  });

  it("a truck: speed, distance and arrival; from its farm to its plant, its route lit", () => {
    const v = truckOf(farm)!;
    const m = vehicleModel(g, v);
    expect(m.title).toMatch(/truck/i);
    expect(m.sub).toMatch(/of crops$/);
    expect(m.keys.map((k) => k.label)).toEqual([`speed, limit ${Math.round(v.edge.speed * 3.6)}`, "to go", "arrives about"]);
    expect(m.keys[0].value).toBe(String(Math.round(v.v * 3.6)));
    expect(metresLeft(g, v)).toBeGreaterThan(0);
    expect(m.keys[2].value).toMatch(/^\d\d:\d0$/);
    expect(m.flow[0].chips[0].ref).toEqual({ k: "building", id: farm.id });
    expect(m.flow[1].chips[0].ref).toEqual({ k: "building", id: v.trip.haul!.dest });
    expect(m.related).toMatchObject({ route: v.id, from: [farm.id], to: [v.trip.haul!.dest] });
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
    expect(j.keys.map((k) => k.label)).toEqual(["vehicles queued", "worst approach", "crossing now"]);
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
