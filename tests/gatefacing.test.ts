// A site's gate finds the road by itself (docs/playtest-2026-11-09.md, C1 and C8). As played, a new site's gate faced
// the bottom of the screen whatever stood round it: an iron mine 1.3 km south of the only road had its back to it,
// and the road drawn down to it was refused ("Iron Mine's gate faces the other way: draw the road round to it":
// three sides of a square); a Food Plant beside a town ran its street to the town's back street behind it rather
// than to the main road.
//
// Now: a site put down faces the nearest road however far (the player's turn counts from there), the company's road
// before a town's own street a little nearer; its street goes the same way; and a site with no road yet takes its
// gate to the back of its plot when that is where a road comes to it.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { dist, dot, scale, sub, type V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import { siteFrame } from "../src/game/sites";
import { planRoad, snap } from "../src/roads/planner";
import { layStraight, openLand } from "./gatejam.scenario";

/** The way a site must be turned for its gate to look along `gd`. */
const facing = (gd: V2) => Math.atan2(gd.x, -gd.y);
/** What the game hands over when placing: how the site is turned on the screen, and where the screen's bottom points. */
const asPlayed = (down: V2, turn = 0) => ({ rot: facing(down) + turn, down });
/** The way out of a site's gate. */
const outOf = (b: { c: V2; rot: number; side: 1 | -1 }, hd: number) => scale(siteFrame(b.c, b.rot, b.side, hd).into, -1);
const minus = (v: V2) => scale(v, -1);

/** Open land with one road through it: `at(along, across)`, the road along across = 0, `n` pointing away to its right. */
function land() {
  const o = openLand({ pop: 60 });
  layStraight(o.g, o.at(0), o.at(1700), "street");
  layStraight(o.g, o.at(1700), o.at(3400), "street");
  const main = [...o.g.net.segs.values()].find((s) => dist(o.g.net.nodes.get(s.a)!.p, o.at(1700)) < 1 || dist(o.g.net.nodes.get(s.b)!.p, o.at(1700)) < 1)!.id;
  return { ...o, n: { x: -o.dir.y, y: o.dir.x } as V2, main };
}

describe("a site put down", () => {
  const L = land();
  const { g, at, dir, n } = L;

  it("faces the nearest road however far, whichever way the screen is turned; the player's turn counts from there", () => {
    const hd = BUILDING_TYPES.ironmine.d / 2;
    // the tester's mine: 1.25 km off the only road (it faced the bottom of the screen: away from the road, as here first)
    for (const down of [n, dir, minus(dir), minus(n)]) {
      const pl = g.placedPlan("ironmine", at(1700, 1250), asPlayed(down))!;
      expect(pl.ok, pl.reason).toBe(true);
      expect(dot(outOf(pl, hd), minus(n))).toBeGreaterThan(0.999);
      // (too far for the game to lay its street: it waits for a road, its gate toward where one will come from)
      expect(pl.free).toBe(true);
      expect(pl.link).toBeUndefined();
    }
    // turned by the player: a quarter and a half from facing the road, not from the bottom of the screen
    const q = g.placedPlan("ironmine", at(1700, 1250), asPlayed(dir, Math.PI / 2))!;
    expect(Math.abs(dot(outOf(q, hd), n))).toBeLessThan(0.001);
    const h = g.placedPlan("ironmine", at(1700, 1250), asPlayed(dir, Math.PI))!;
    expect(dot(outOf(h, hd), n)).toBeGreaterThan(0.999);
    // past the end of the road: toward that end, in line with the road
    const e = g.placedPlan("ironmine", at(3400 + 150 + hd, 0), asPlayed(n))!;
    expect(e.ok, e.reason).toBe(true);
    expect(dot(outOf(e, hd), minus(dir))).toBeGreaterThan(0.999);
  }, 120000);

  it("lays its street to the road it faces: the main road, not a town's back street behind it or a little nearer", () => {
    const T = BUILDING_TYPES.sawmill, hd = T.d / 2;
    // a town's own street 700 m off the main road, running along it (as a town lays them: tagged its own)
    const before = new Set(g.net.segs.keys());
    layStraight(g, at(1450, 700), at(1950, 700), "street");
    const back = [...g.net.segs.values()].filter((s) => !before.has(s.id));
    for (const s of back) s.town = L.A.id;
    /** Where the street the game would lay from the gate ends: how far from the main road. */
    const joins = (pl: NonNullable<ReturnType<typeof g.placedPlan>>) => {
      const ch = pl.link!.strokes[pl.link!.strokes.length - 1].chain;
      return Math.abs(dot(sub(ch[ch.length - 1].p3, at(0)), n));
    };
    // the tester's plant: the main road the nearer (300 m to 400), the bottom of the screen toward the back street
    const a = g.placedPlan("sawmill", at(1700, 300), asPlayed(n))!;
    expect(a.ok, a.reason).toBe(true);
    expect(dot(outOf(a, hd), minus(n))).toBeGreaterThan(0.999);
    expect(joins(a)).toBeLessThan(1);
    expect(a.link!.length).toBeLessThan((300 - hd) * 1.1);
    // the back street a little nearer (320 m to the main road's 380): the main road still
    const b = g.placedPlan("sawmill", at(1700, 380), asPlayed(n))!;
    expect(dot(outOf(b, hd), minus(n))).toBeGreaterThan(0.999);
    expect(joins(b)).toBeLessThan(1);
    // (it is the town's street that makes the difference: the same street as the company's own road is the nearer)
    for (const s of back) s.town = undefined;
    const b2 = g.placedPlan("sawmill", at(1700, 380), asPlayed(n))!;
    expect(dot(outOf(b2, hd), n)).toBeGreaterThan(0.999);
    expect(Math.abs(joins(b2) - 700)).toBeLessThan(1);
    for (const s of back) s.town = L.A.id;
    // the back street much the nearer (200 m to 500): that is the road it has
    const c = g.placedPlan("sawmill", at(1700, 500), asPlayed(minus(n)))!;
    expect(dot(outOf(c, hd), n)).toBeGreaterThan(0.999);
    expect(Math.abs(joins(c) - 700)).toBeLessThan(1);
    // and put down, it is on the road it faced
    const m = g.place("sawmill", at(1700, 300), asPlayed(n))!;
    expect(m.access).not.toBeNull();
    expect(g.connected(m.access!.seg, L.main)).toBe(true);
  }, 120000);
});

describe("a site with no road yet", () => {
  const L = land();
  const { g, at, dir, n } = L;
  const T = BUILDING_TYPES.ironmine, hw = T.w / 2, hd = T.d / 2;
  const toasts: string[] = [];
  g.on((e) => { if (e.t === "toast") toasts.push(e.msg); });
  const opts = () => ({ mpp: 0.5, level: 0, type: "street" as const, sites: g.buildings.siteTargets() });
  /** The player's drag: from the main road, straight to the site (the cursor let go over it). */
  const dragTo = (b: Building, along: number) => {
    const a = snap(g.net, at(along, 0), opts());
    const e = snap(g.net, b.c, { ...opts(), from: a });
    return { e, plan: planRoad(g.net, g.world, { start: a, end: e, mode: "straight", type: "street" }) };
  };

  it("takes its gate to the back of its plot when the road comes to it from behind (it was refused: draw the road round)", () => {
    // 900 m off the road, turned by the player with its back to it
    const mine = g.place("ironmine", at(1900, 900), { rot: facing(n) })!;
    expect(mine.access).toBeNull();
    expect(dot(outOf(mine, hd), n)).toBeGreaterThan(0.999);
    const c0 = { ...mine.c }, corners = g.buildings.footprint(mine).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).sort();
    const { e, plan } = dragTo(mine, 1900);
    // the road ends just outside the middle of its back fence, and says what will happen
    expect(e.site?.turned).toBe(true);
    expect(dist(e.p, at(1900, 900 - hd - 7))).toBeLessThan(0.5);
    expect(plan.errors.map((x) => x.msg)).toEqual([]);
    expect(plan.connects).toBe("Connects to Iron Mine: its gate turns to this side");
    toasts.length = 0;
    expect(g.build(plan)).toBe(true);
    expect(mine.access).not.toBeNull();
    expect(g.connected(mine.access!.seg, L.main)).toBe(true);
    expect(dot(outOf(mine, hd), minus(n))).toBeGreaterThan(0.999);
    // (joined to the town, but towns don't buy ore and no steel works is built yet: play-test 2026-11-10)
    expect(toasts).toEqual(["Iron Mine connected, its gate turned to the road. Nothing on your roads takes its iron ore yet"]);
    // (the same plot: nothing else moved)
    expect(mine.c).toEqual(c0);
    expect(g.buildings.footprint(mine).map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).sort()).toEqual(corners);
    // Undo takes the road away; the site waits again, its gate where the road was
    g.undo();
    expect(mine.access).toBeNull();
    expect(dot(outOf(mine, hd), minus(n))).toBeGreaterThan(0.999);
  }, 120000);

  it("is not turned a quarter: a road to its flank goes round to its gate, and one that would cut its yard is told where the gate is", () => {
    // its gate along the road; no plot is square (this one 220 m by 200), so a quarter turn would be another plot
    const mine = g.place("ironmine", at(400, 700), { rot: facing(dir) })!;
    expect(mine.access).toBeNull();
    expect(hw).not.toBe(hd);
    expect(g.buildings.turnsOf(mine).length).toBe(1);
    const rot = mine.rot;
    // straight at its flank: the way to its gate (and to its back) cuts the corner of its yard
    const r = dragTo(mine, 400);
    expect(r.e.site?.turned).toBeUndefined();
    expect(r.plan.errors.map((x) => x.msg)).toEqual(["Iron Mine's gate faces the other way: draw the road round to it"]);
    // from further along, clear of the corner: to its gate as it stands
    const { e, plan } = dragTo(mine, 900);
    expect(e.site?.turned).toBeUndefined();
    expect(dist(e.p, at(400 + hd + 7, 700))).toBeLessThan(0.5);
    expect(plan.errors.map((x) => x.msg)).toEqual([]);
    expect(plan.connects).toBe("Connects to Iron Mine");
    expect(g.build(plan)).toBe(true);
    expect(mine.access).not.toBeNull();
    expect(mine.rot).toBe(rot);
  }, 120000);

  it("turns to a road that is only laid past the back of it, drawn to somewhere else", () => {
    const mine = g.place("ironmine", at(1500, 1150), { rot: facing(minus(n)) })!;
    expect(mine.access).toBeNull();
    toasts.length = 0;
    layStraight(g, at(1380, 1150 + hd + 12), at(1620, 1150 + hd + 12), "street");
    expect(mine.access).not.toBeNull();
    expect(dot(outOf(mine, hd), n)).toBeGreaterThan(0.999);
    // (a road that leads nowhere yet: the mine is not "connected" till it joins the others, play-test 2026-11-10)
    expect(toasts).toEqual(["Iron Mine's gate turned to the road. Join that road to your others and its trucks can start"]);
    layStraight(g, at(1380, 1150 + hd + 12), at(1380, 0), "street");
    expect(toasts.slice(1)).toEqual(["Iron Mine connected. Nothing on your roads takes its iron ore yet"]);
  }, 120000);

  it("with a road at its gate keeps its gate: a road drawn to its back is still refused", () => {
    // near enough the road for the game to lay its street
    const mill = g.place("sawmill", at(2600, 200), asPlayed(n))!;
    expect(mill.access).not.toBeNull();
    expect(g.buildings.turnsOf(mill)).toEqual([]);
    const rot = mill.rot, side = mill.side;
    // from a road beyond it, to its back
    layStraight(g, at(2400, 600), at(2800, 600), "street");
    const a = snap(g.net, at(2600, 600), opts());
    const e = snap(g.net, mill.c, { ...opts(), from: a });
    expect(e.site?.turned).toBeUndefined();
    const plan = planRoad(g.net, g.world, { start: a, end: e, mode: "straight", type: "street" });
    expect(plan.errors.map((x) => x.msg)).toContain("Sawmill's gate faces the other way: draw the road round to it");
    expect([mill.rot, mill.side]).toEqual([rot, side]);
  }, 120000);
});
