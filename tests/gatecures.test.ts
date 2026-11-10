// The cures for a jam at a works gate (docs/playtest-2026-11-09.md, A2). The junction panel said "Try lights, stop
// signs on the quiet roads, or a roundabout", and at the sawmill's gate junction neither helped: lights changed
// nothing in ten minutes, a Small roundabout left the sawmill with "No road to the gate", and the 20 m of road back
// to it could not be drawn ("Too short: drag further from the start"). Only Undo saved the company.
//
// The company here is the play-test's (tests/gatejam.scenario.ts), overloaded: one sawmill, two towns, eight sites.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES, MIN_SEG_LEN, SIGNAL_COST } from "../src/config";
import { add, dist, scale, type V2 } from "../src/core/math";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { siteFrame } from "../src/game/sites";
import type { Lane } from "../src/roads/network";
import { planRoad, planRoundabout, snap } from "../src/roads/planner";
import { ALL_RED, AMBER, GREEN } from "../src/sim/traffic";
import { buildGateJam, layStraight, openLand, runGateJam } from "./gatejam.scenario";

/** The junction a works' gate street meets the road at. */
function gateJunction(g: Game, b: Building) {
  const s = g.net.segs.get(b.access!.seg)!;
  return g.net.nodes.get(g.net.segsAt(s.a).length > 1 ? s.a : s.b)!;
}
/** The rate a run settled at: loads an hour over its last game day. */
const rate = (r: ReturnType<typeof runGateJam>) => r.samples.slice(-24).reduce((a, st) => a + st.perHour, 0) / 24;
/** The way a site at p must be turned for its gate to look along `gd`. */
const facing = (gd: V2) => Math.atan2(gd.x, -gd.y);

describe("lights on a works' gate junction", () => {
  it("give the gate a green of its own that clears it; the road past it is slower, never stopped", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    const { g, mill } = s;
    const gate = mill.access!.seg, J = gateJunction(g, mill);
    const plan = g.defaultSignal(J.id)!;
    // one click, the default plan: the road's two sides together, then the gate by itself
    expect(plan.phases.length).toBe(2);
    expect(plan.phases.filter((ph) => ph.arms.length === 1 && ph.arms[0] === gate).length).toBe(1);
    const money = g.money;
    expect(g.setSignal(J.id, plan)).toBe(true);
    expect(money - g.money).toBe(SIGNAL_COST);
    const cycle = plan.phases.length * (GREEN + AMBER + ALL_RED);
    // the longest a truck stood on the gate's street waiting to pull out, and how many pulled out of it
    let worstOut = 0, left = 0;
    const seen = new Set<number>();
    const r = runGateJam(s, 2);
    // (measured over a second stretch, every step: the run above is the hourly samples)
    const end = g.time + 480;
    while (g.time < end) {
      g.step(g.dt);
      for (const v of g.traffic.vehicles) {
        if (v.edge.kind !== "lane" || (v.edge as Lane).seg !== gate || (v.edge as Lane).to !== J.id) continue;
        if (v.stuck > worstOut) worstOut = v.stuck;
        if (!seen.has(v.id)) { seen.add(v.id); left++; }
      }
    }
    // nobody stands five game minutes, anywhere; the longest stand is a couple of reds (it was 451 s, with the towns
    // at a third of their planks and the sawmill at one load an hour: the trucks turning in off the paved side had
    // the right of way over the dirt side, and a truck waiting for a green read as "held up", so none was sent)
    // (since towns buy only their demand, v0.0.105, a returning empty truck can give way for 140 s at a town's T
    // junction away from the gate; the gate itself is held to one cycle below)
    expect(r.standing).toBe(0);
    expect(r.longest).toBeLessThan(3 * cycle);
    expect(r.breaks).toBe(0);
    expect(r.quits).toBe(0);
    // the gate's own green clears it: trucks come out all the time, none waits much more than one cycle for it
    expect(left).toBeGreaterThan(3);
    expect(worstOut).toBeLessThan(cycle + 10);
    // slower than no lights (fixed 24 s greens on a two-lane road), and still a working company
    expect(rate(r)).toBeGreaterThan(1.6);
    expect(r.minA).toBeGreaterThan(30);
    expect(r.minB).toBeGreaterThan(30);
  }, 240000);
});

describe("a roundabout on a works' gate junction", () => {
  it("keeps the works joined: its gate is on the ring, its trucks on the road come home to it, and the jam is gone", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    const { g, mill } = s;
    const J = gateJunction(g, mill), street = mill.access!.seg;
    const plan = planRoundabout(g.net, g.world, J.p, 1, 0);
    expect(plan.errors).toEqual([]);
    // (the trucks heading for the sawmill, away from the junction itself: what stands in the circle is cleared with it)
    const homing = g.traffic.vehicles.filter((v) => v.trip.to === mill.id && dist(v, J.p) > 40);
    expect(homing.length).toBeGreaterThan(1);
    const money = g.money, failed = g.failedTrips;
    expect(g.build(plan)).toBe(true);
    expect(money - g.money).toBeCloseTo(plan.cost, 3);
    // its gate is on the ring now (the 4 m of its street left outside the circle went with the rest)
    expect(mill.access).not.toBeNull();
    expect(g.net.segs.get(mill.access!.seg)!.ring).toBeTruthy();
    expect(g.net.segs.has(street)).toBe(false);
    for (const n of g.net.nodes.values()) if (dist(n.p, J.p) < 40) expect(g.net.segsAt(n.id).length, "no stub left sticking out of the ring").toBeGreaterThan(1);
    for (const t of [s.A, s.B]) {
      const shop = g.shops.find((b) => b.town === t.id && b.access)!;
      expect(g.connected(mill.access!.seg, shop.access!.seg), t.name).toBe(true);
    }
    // nobody on the way to it was lost with its old street
    for (const v of homing) {
      expect(g.traffic.vehicles.includes(v), `truck ${v.id} still on the road`).toBe(true);
      expect(v.dest.seg).toBe(mill.access!.seg);
    }
    expect(g.failedTrips - failed).toBeLessThanOrEqual(4);
    // and it is the cure the panel said it was
    const r = runGateJam(s, 2);
    expect(r.standing).toBe(0);
    expect(r.longest).toBeLessThan(90);
    expect(r.breaks).toBe(0);
    expect(r.quits).toBe(0);
    expect(rate(r)).toBeGreaterThan(2);
    expect(r.minA).toBeGreaterThan(35);
    expect(r.minB).toBeGreaterThan(35);
    expect(mill.access).not.toBeNull();
  }, 240000);

  it("of any size, however far the gate stands from the road: joined after it, and as it was after Undo", () => {
    const { g, at, dir } = openLand({ pop: 60 });
    const T = BUILDING_TYPES.sawmill;
    layStraight(g, at(0), at(1700), "street");
    layStraight(g, at(1700), at(3400), "street");
    const town = g.shops.find((b) => b.access)!;
    const rot = facing({ x: -dir.y, y: dir.x });
    const how = { ring: 0, stub: 0, refused: 0 };
    // sawmills along the road, their gates 16 to 64 m from it, each with the street the game lays to it
    for (let k = 0; k < 13; k++) {
      const gap = 12 + k * 4, x = 400 + (T.w + 40) * k;
      const m = g.place("sawmill", at(x, -(4 + gap + T.d / 2)), { rot })!;
      expect(m?.access, `gap ${gap}: placed with its street`).toBeTruthy();
      const before = m.access!.seg;
      for (const size of [1, 2, 3] as const) {
        const tag = `gate ${gap + 4} m from the road, size ${size}`;
        const plan = planRoundabout(g.net, g.world, at(x), size, 0);
        // (a ring that would run through the works itself is refused in the preview, as any road is)
        if (plan.errors.length) { expect(plan.errors[0].msg, tag).toBe("Building in the way"); how.refused++; continue; }
        const money = g.money;
        expect(g.build(plan), tag).toBe(true);
        expect(money - g.money, tag).toBeCloseTo(plan.cost, 3);
        expect(m.access, tag).not.toBeNull();
        const sg = g.net.segs.get(m.access!.seg)!;
        expect(g.connected(sg.id, town.access!.seg), tag).toBe(true);
        if (sg.ring) how.ring++;
        else {
          // (what is left of its street: a road's length and more, the gate at its end)
          how.stub++;
          expect(g.net.segGeom.get(sg.id)!.center.length, tag).toBeGreaterThanOrEqual(MIN_SEG_LEN - 0.01);
        }
        g.undo();
        expect(m.access?.seg, tag).toBe(before);
      }
    }
    expect(how.ring).toBeGreaterThan(5);
    expect(how.stub).toBeGreaterThan(5);
    expect(how.refused).toBeGreaterThan(5);
  }, 120000);

  it("joins a road a kilometre long to its ring (the cut is on the circle, not 3 m short of it)", () => {
    const s = buildGateJam({ sites: 1, pop: 320, warm: 0.05 });
    const { g, mill } = s;
    const plan = planRoundabout(g.net, g.world, gateJunction(g, mill).p, 2, 0);
    expect(plan.errors).toEqual([]);
    expect(g.build(plan)).toBe(true);
    // the towns either side of the Medium ring are still one company: before, the dirt road west ended beside it
    const a = g.shops.find((b) => b.town === s.A.id && b.access)!, b = g.shops.find((x) => x.town === s.B.id && x.access)!;
    expect(g.connected(a.access!.seg, b.access!.seg)).toBe(true);
    expect(g.traffic.router.route(mill.access!, b.access!)).not.toBeNull();
    expect(g.traffic.router.route(mill.access!, s.sites[0].access!)).not.toBeNull();
  }, 120000);

  it("that would strand a works is refused before a dollar is spent, with the reason, and nothing has changed", () => {
    const s = buildGateJam({ sites: 1, pop: 320, warm: 0.3 });
    const { g, mill } = s;
    const plan = planRoundabout(g.net, g.world, gateJunction(g, mill).p, 1, 0);
    expect(plan.errors).toEqual([]);
    // (no real layout strands one any more: the ring, or what is left of the street, always passes the gate. The
    // check is the last line of defence, so it is made to fail here: no road takes this gate, no street can be laid)
    const B = g.buildings, G = g as unknown as { gateLink: Game["gateLink"] };
    const ga = B.gateAccess, gl = G.gateLink;
    let tries = 0;
    B.gateAccess = (...a) => (tries++ < 1 ? null : ga.apply(B, a));
    G.gateLink = () => null;
    const toasts: string[] = [];
    g.on((e) => { if (e.t === "toast") toasts.push(e.msg); });
    const money = g.money, access = { ...mill.access! }, failed = g.failedTrips;
    const segs = [...g.net.segs.keys()].sort((x, y) => x - y), nodes = [...g.net.nodes.keys()].sort((x, y) => x - y);
    const on = g.traffic.vehicles.map((v) => v.id);
    expect(on.length).toBeGreaterThan(5);
    expect(g.build(plan)).toBe(false);
    B.gateAccess = ga; G.gateLink = gl;
    expect(toasts.length).toBe(1);
    expect(toasts[0]).toMatch(/^Not built: a roundabout there would leave the Sawmill's gate with no road/);
    expect(g.money).toBe(money);
    expect([...g.net.segs.keys()].sort((x, y) => x - y)).toEqual(segs);
    expect([...g.net.nodes.keys()].sort((x, y) => x - y)).toEqual(nodes);
    expect(mill.access!.seg).toBe(access.seg);
    expect(mill.access!.s).toBeCloseTo(access.s, 6);
    // the traffic never knew: every vehicle still on its road, none failed, and the day goes on
    expect(g.traffic.vehicles.map((v) => v.id)).toEqual(on);
    expect(g.failedTrips).toBe(failed);
    const r = runGateJam(s, 0.25);
    expect(r.standing).toBe(0);
    expect(g.failedTrips).toBe(failed);
    // and the same ring is built when nothing stands in its way
    expect(g.build(plan)).toBe(true);
    expect(mill.access).not.toBeNull();
  }, 120000);
});

describe("a road drawn back to a gate", () => {
  it("joins the works whatever the distance: by itself within the gate's reach, by the road tool beyond it", () => {
    const { g, at, dir } = openLand({ pop: 60 });
    const T = BUILDING_TYPES.sawmill, gd = { x: -dir.y, y: dir.x };
    // sawmills placed before there is any road in reach (none gets a street), their gates 8 to 40 m from where the
    // road will run, on alternate sides of it
    const Ds = [8, 10, 12, 13, 14, 15, 16, 17, 18, 19, 20, 22, 24, 26, 28, 30, 34, 40];
    const mills = Ds.map((D, i) => {
      const side = i % 2 ? 1 : -1;
      const m = g.place("sawmill", at(700 + 130 * i, side * (D + T.d / 2)), { rot: facing(scale(gd, -side)) })!;
      expect(m, `gate ${D} m off`).toBeTruthy();
      expect(m.access).toBeNull();
      return m;
    });
    layStraight(g, at(0), at(1700), "street");
    layStraight(g, at(1700), at(3400), "street");
    let self = 0, drawn = 0;
    for (const [i, m] of mills.entries()) {
      const D = Ds[i];
      if (m.access) { self++; continue; }
      // the player's way: drag from the works to the road in front of its gate (the tester's was about 20 m)
      const f = siteFrame(m.c, m.rot, m.side, m.hd);
      const opts = { mpp: 0.5, level: 0, type: "street" as const, sites: g.buildings.siteTargets() };
      const a = snap(g.net, add(f.gate, scale(f.into, 10)), opts);
      const b = snap(g.net, add(f.gate, scale(f.into, -D)), { ...opts, from: a });
      const plan = planRoad(g.net, g.world, { start: a, end: b, mode: "straight", type: "street" });
      expect(plan.errors.map((e) => e.msg), `gate ${D} m off`).toEqual([]);
      expect(g.build(plan), `gate ${D} m off`).toBe(true);
      expect(m.access, `gate ${D} m off`).not.toBeNull();
      drawn++;
    }
    expect(self).toBeGreaterThan(3);
    expect(drawn).toBeGreaterThan(8);
  }, 120000);

  it("from a gate to the roundabout it is on says so, not \"Too short\"", () => {
    const s = buildGateJam({ sites: 1, pop: 320, warm: 0.05 });
    const { g, mill } = s;
    const J = gateJunction(g, mill);
    expect(g.build(planRoundabout(g.net, g.world, J.p, 1, 0))).toBe(true);
    // the tester's drag: from the sawmill's gate to the ring 10 m in front of it
    const f = siteFrame(mill.c, mill.rot, mill.side, mill.hd);
    const opts = { mpp: 0.5, level: 0, type: "street" as const, sites: g.buildings.siteTargets() };
    const a = snap(g.net, add(f.gate, scale(f.into, 6)), opts);
    const b = snap(g.net, add(J.p, scale(f.into, 16)), { ...opts, from: a });
    const plan = planRoad(g.net, g.world, { start: a, end: b, mode: "straight", type: "street" });
    expect(plan.errors.map((e) => e.msg)).toEqual(["Sawmill's gate is on this road already"]);
  }, 120000);
});
