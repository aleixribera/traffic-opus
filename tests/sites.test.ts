// Industry sites: the plot's layout (pure), a site growing through its levels, and a site placed with no road that
// joins the network once a road reaches its gate.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { add, norm, rectDistance, scale, sub, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { Industry, PLANTS, PLANT_KINDS, type IndustryHost, type PlantKind } from "../src/game/industry";
import type { Building } from "../src/game/buildings";
import { PLACED } from "../src/game/placed";
import { GATE_REACH, GROW_NEED, GROW_NEED_FIRST, LEVEL_MULT, SITE_LEVELS, siteFrame, siteLayout, slotHalf, type SiteLayout } from "../src/game/sites";
import type { PendingSpawn } from "../src/sim/traffic";
import { chainPoints, planRoad } from "../src/roads/planner";
import { okCells, road, run } from "./helpers";

const boxes = (L: SiteLayout) => L.slots.map((s) => ({ s, ...slotHalf(s) }));

describe("site layout", () => {
  it("is the same for the same plot and seed, and fits every kind's plot", () => {
    // (the landmarks are not growing complexes: special.test.ts has theirs)
    for (const kind of PLANT_KINDS.filter((k) => !PLANTS[k].mega)) {
      // (a warehouse or a fuel depot is a single building on a small lot: it never grows)
      if (PLANTS[kind].logistics) {
        const T = BUILDING_TYPES[kind];
        const L = siteLayout(kind, T.w, T.d, 1);
        expect(L.slots.map((s) => [s.model, s.role, s.level])).toEqual([[kind, "core", 1]]);
        expect(L.roads).toEqual([]);
        continue;
      }
      const T = BUILDING_TYPES[kind];
      for (const seed of [1, 2, 17, 404]) {
        const L = siteLayout(kind, T.w, T.d, seed);
        expect(siteLayout(kind, T.w, T.d, seed)).toEqual(L);
        // the plant itself and the truck yard, by the gate, from the start
        const core = L.slots.find((s) => s.role === "core")!, yard = L.slots.find((s) => s.role === "yard")!;
        expect(core.level).toBe(1);
        expect(yard.level).toBe(1);
        expect(core.model).toBe(kind);
        expect(core.y - slotHalf(core).hy).toBeLessThan(15);
        expect(yard.y - slotHalf(yard).hy).toBeLessThan(15);
        // every level adds buildings
        for (let lv = 2; lv <= SITE_LEVELS; lv++) expect(L.slots.some((s) => s.level === lv), `${kind} ${seed} level ${lv}`).toBe(true);
        const bx = boxes(L);
        for (const { s, hx, hy } of bx) {
          // inside the fence, clear of it
          expect(Math.abs(s.x) + hx, `${kind} ${s.model}`).toBeLessThanOrEqual(T.w / 2 - 4);
          expect(s.y - hy).toBeGreaterThanOrEqual(4);
          expect(s.y + hy).toBeLessThanOrEqual(T.d - 4);
          // facing a service road: its front is a unit along x or y
          expect(Math.abs(s.fx) + Math.abs(s.fy)).toBeCloseTo(1);
        }
        // no two buildings overlap, and none stands on a service road
        for (let i = 0; i < bx.length; i++) for (let j = i + 1; j < bx.length; j++) {
          const a = bx[i], b = bx[j];
          const over = Math.abs(a.s.x - b.s.x) < a.hx + b.hx - 0.01 && Math.abs(a.s.y - b.s.y) < a.hy + b.hy - 0.01;
          expect(over, `${kind} ${seed}: ${a.s.model} and ${b.s.model}`).toBe(false);
        }
        for (const r of L.roads) {
          const rx = (Math.abs(r.a.x - r.b.x) + r.w) / 2, ry = (Math.abs(r.a.y - r.b.y) + r.w) / 2;
          const cx = (r.a.x + r.b.x) / 2, cy = (r.a.y + r.b.y) / 2;
          for (const { s, hx, hy } of bx) {
            const over = Math.abs(s.x - cx) < hx + rx - 0.01 && Math.abs(s.y - cy) < hy + ry - 0.01;
            expect(over, `${kind} ${seed}: ${s.model} on a road`).toBe(false);
          }
        }
        // the spine runs in from the gate
        expect(L.roads[0].a).toEqual({ x: 0, y: 0 });
      }
    }
  });

  it("varies from one site to the next, and an old small lot keeps just its plant", () => {
    const T = BUILDING_TYPES.farm;
    const a = JSON.stringify(siteLayout("farm", T.w, T.d, 1)), b = JSON.stringify(siteLayout("farm", T.w, T.d, 2));
    const c = JSON.stringify(siteLayout("farm", T.w, T.d, 3));
    expect(a !== b || a !== c).toBe(true);
    const small = siteLayout("farm", 56, 56, 9);
    expect(small.slots.length).toBe(1);
    expect(small.slots[0]).toMatchObject({ model: "farm", level: 1, role: "core" });
  });
});

/** One plant on its own, staffed and connected, its output shipped as soon as it is made (or not, when told). */
function lonePlant() {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const grew: number[] = [];
  const host: IndustryHost & { time: number } = {
    time: 0,
    buildings: { list, byId } as any,
    has: () => true,
    connected: () => true,
    workersAt: (id) => byId.get(id)!.cap,
    shops: [],
    townOf: () => null,
    want: () => 10,
    sold: () => {},
    request: (_p: PendingSpawn) => {},
    trips: () => [],
    earn: () => {},
    spend: () => {},
    grew: (_b, level) => { grew.push(level); },
  };
  const ind = new Industry(host);
  const b = {
    id: 1, kind: "farm", c: v2(0, 0), rot: 0, hw: 145, hd: 135, front: v2(0, 0), access: { seg: 1, s: 1, p: v2(0, 0) }, side: 1, placed: true,
    level: 1, cap: 8, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0,
  } as unknown as Building;
  list.push(b);
  byId.set(1, b);
  ind.init(b, "farm");
  /** an hour's work at a time; `ship` empties the yard after each */
  const work = (hours: number, ship = true) => {
    for (let k = 0; k < hours; k++) {
      ind.produce(b, 40);
      host.time += 40;
      if (ship) b.plant!.out = {};
    }
  };
  return { ind, b, work, grew, host };
}

describe("site levels", () => {
  it("grows a level after a while near capacity (the first one soonest), with more output, jobs, trucks and store", () => {
    const { ind, b, work, grew, host } = lonePlant();
    const P = b.plant!;
    const jobs1 = b.cap, trucks1 = ind.trucksOf(b), store1 = Industry.storeOf(b);
    work(Math.floor(GROW_NEED_FIRST / 40) - 1);
    expect(P.level).toBe(1);
    expect(P.why).toBeNull();
    expect(P.grow / GROW_NEED_FIRST).toBeGreaterThan(0.9);
    work(3);
    expect(P.level).toBe(2);
    expect(grew).toEqual([2]);
    expect(P.upAt).toBeGreaterThan(0);
    expect(P.upAt).toBeLessThanOrEqual(host.time);
    expect(b.cap).toBe(Math.round(jobs1 * LEVEL_MULT[1]));
    expect(ind.trucksOf(b)).toBeGreaterThan(trucks1);
    expect(ind.trucksOf(b)).toBe(Industry.fleetAt(b.kind as PlantKind, 2, P.yld));
    expect(Industry.storeOf(b)).toBe(Math.round(store1 * LEVEL_MULT[1]));
    // it makes twice as much in the same time
    const made = (hours: number) => { const m0 = P.now.made; work(hours); return P.now.made - m0; };
    const at2 = made(10);
    const solo = lonePlant();
    const m0 = solo.b.plant!.now.made;
    solo.work(10);
    expect(at2 / (solo.b.plant!.now.made - m0)).toBeCloseTo(2, 0);
    // to the top, and no further
    for (let k = 0; k < 400 && P.level < SITE_LEVELS; k++) work(10);
    expect(P.level).toBe(SITE_LEVELS);
    expect(grew).toEqual([2, 3, 4]);
    work(Math.ceil(GROW_NEED / 40) + 5);
    expect(P.level).toBe(SITE_LEVELS);
    expect(b.cap).toBe(Math.round(jobs1 * LEVEL_MULT[3]));
  });

  it("is held back (and loses progress, never a level) when its output piles up or its gate has no road", () => {
    const { b, work } = lonePlant();
    const P = b.plant!;
    work(Math.floor(GROW_NEED_FIRST / 40 / 2));
    const half = P.grow;
    expect(half).toBeGreaterThan(0);
    // nobody takes the crops: the yard fills and it stops
    work(30, false);
    expect(P.why).toMatch(/^Output piling up|^Full of/);
    expect(P.grow).toBeLessThan(half);
    expect(P.level).toBe(1);
    // the road to its gate is gone
    b.plant!.out = {};
    b.access = null;
    work(2);
    expect(P.why).toBe("No road to the gate");
    expect(b.problem).toBe("No road to the gate");
    expect(P.level).toBe(1);
  });
});

/** A new map with no town yet (there is no land to buy: the company builds anywhere). */
function openGame(): Game {
  return new Game(7);
}

/** Open, dry, flat ground where a site of `kind` can stand (on its deposit), at least 400 m from the origin. */
function openSpot(g: Game, kind: "foodplant" | "farm", opts = {}): V2 {
  for (let r = 400; r < 4000; r += 150) for (let k = 0; k < 24; k++) {
    const p = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
    if (g.placedPlan(kind, p, opts)?.ok) return p;
  }
  throw new Error("no open ground");
}

describe("free placement and the gate", () => {
  it("builds anywhere: a farm several km out stands on its soil, with no land to buy", () => {
    const g = new Game(7);
    g.start();
    let p: V2 | null = null;
    for (let r = 4000; r < 9000 && !p; r += 250) for (let k = 0; k < 24 && !p; k++) {
      const q = v2(Math.cos((k / 24) * 6.283) * r, Math.sin((k / 24) * 6.283) * r);
      if (g.placedPlan("farm", q)?.ok) p = q;
    }
    expect(p, "a farm plot 4+ km out").not.toBeNull();
    const m = g.money;
    const b = g.place("farm", p!)!;
    expect(b).toBeTruthy();
    expect(Math.hypot(b.c.x, b.c.y)).toBeGreaterThan(3800);
    expect(g.money).toBe(m - PLACED.farm.cost); // the plant's price, nothing for land
  });

  it("stands free with no road near, turns in steps, and joins the first road that passes its gate", () => {
    const g = openGame();
    const toasts: string[] = [];
    g.on((e) => { if (e.t === "toast") toasts.push(e.msg); });
    const p = openSpot(g, "foodplant");
    // with no road anywhere it faces the bottom of the screen, centred on the cursor
    const pl = g.placedPlan("foodplant", p, { down: { x: 0, y: 1 } })!;
    expect(pl.ok).toBe(true);
    expect(pl.free).toBe(true);
    expect(pl.access).toBeNull();
    expect(pl.c).toEqual(p);
    const T = BUILDING_TYPES.foodplant;
    expect(siteFrame(pl.c, pl.rot, pl.side, T.d / 2).into.y).toBeCloseTo(-1);
    // turned a quarter round with , and .
    const turned = g.placedPlan("foodplant", p, { down: { x: 0, y: 1 }, turn: Math.PI / 2 })!;
    const into = siteFrame(turned.c, turned.rot, turned.side, T.d / 2).into;
    expect(Math.abs(into.x)).toBeCloseTo(1);
    // put down: no road to the gate, so it waits
    const b = g.place("foodplant", p, { down: { x: 0, y: 1 } })!;
    expect(b).toBeTruthy();
    expect(b.access).toBeNull();
    run(g, 0.2);
    expect(b.problem).toBe("No road to the gate");
    // a road through the site's fence is refused...
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const out = scale(f.into, -1);
    const across = (o: number, k: number) => add(add(f.gate, scale(out, o)), scale(f.along, k));
    const cut = planRoad(g.net, g.world, { start: { p: add(b.c, scale(f.along, -300)), h: 0, guides: [] }, end: { p: add(b.c, scale(f.along, 300)), h: 0, guides: [] }, mode: "straight", type: "street" });
    expect(cut.errors.length).toBeGreaterThan(0);
    // ...but one passing just in front of the gate joins it
    road(g, across(GATE_REACH - 4, -160), across(GATE_REACH - 4, 160));
    expect(b.access).not.toBeNull();
    expect(toasts.some((t) => t === "Food Plant connected: its trucks can start")).toBe(true);
    // its kerb is on the road's edge in front of the gate
    expect(rectDistance(b.front, b.c, b.hw, b.hd, b.rot)).toBeLessThan(GATE_REACH);
    expect(rectDistance(b.front, b.c, b.hw, b.hd, b.rot)).toBeGreaterThan(1);
    run(g, 0.2);
    expect(b.problem).not.toBe("No road to the gate");
  });

  it("turned freely by the player, it stands at the cursor and gets a street laid to its gate (one undo)", () => {
    const g = openGame();
    const p = openSpot(g, "foodplant");
    const T = BUILDING_TYPES.foodplant;
    const rot = 0.7;
    const f = siteFrame(p, rot, 1, T.d / 2);
    const out = scale(f.into, -1);
    // with no road within reach it stands free and waits, as before
    const lone = g.placedPlan("foodplant", p, { rot })!;
    expect(lone.ok).toBe(true);
    expect(lone.free).toBe(true);
    expect(lone.link).toBeUndefined();
    // a curving road passing ~140 m in front of the gate, slanted to it
    const at = (o: number, k: number) => add(add(f.gate, scale(out, o)), scale(f.along, k));
    const curve = planRoad(g.net, g.world, { start: { p: at(110, -260), h: 0, guides: [] }, end: { p: at(200, 260), h: 0, guides: [] }, startTangent: norm(sub(at(120, 40), at(110, -260))), mode: "curve", type: "street" });
    expect(curve.errors).toEqual([]);
    expect(g.build(curve)).toBe(true);
    const segs = g.net.segs.size, money = g.money;
    const pl = g.placedPlan("foodplant", p, { rot })!;
    expect(pl.ok).toBe(true);
    // no snapping: where the cursor is, turned as the player has it
    expect(pl.c).toEqual(p);
    expect(pl.rot).toBeCloseTo(rot);
    expect(pl.link).toBeTruthy();
    expect(pl.link!.length).toBeLessThan(250);
    expect(pl.cost).toBeCloseTo(PLANTS.foodplant.cost + pl.link!.cost);
    // never through its own fence
    for (const st of pl.link!.strokes) for (const q of chainPoints(st.chain, 2)) expect(rectDistance(q, p, T.w / 2, T.d / 2, rot)).toBeGreaterThan(5);
    const b = g.place("foodplant", p, { rot })!;
    expect(b.access).not.toBeNull();
    expect(g.net.segs.size).toBeGreaterThan(segs);
    expect(g.money).toBeCloseTo(money - pl.cost);
    run(g, 0.2);
    expect(b.problem).not.toBe("No road to the gate");
    // one undo takes the site and its street away
    g.undo();
    expect(g.buildings.byId.has(b.id)).toBe(false);
    expect(g.net.segs.size).toBe(segs);
    expect(g.money).toBeCloseTo(money);
    // turned with its gate away from the road, the street never cuts through the site to reach it
    const back = g.placedPlan("foodplant", p, { rot: rot + Math.PI })!;
    for (const st of back.link?.strokes ?? []) for (const q of chainPoints(st.chain, 2)) expect(rectDistance(q, p, T.w / 2, T.d / 2, rot)).toBeGreaterThan(5);
  });

  it("a gate opens onto a boulevard (right-in, right-out), though no house may face one", () => {
    const g = openGame();
    const b = g.place("foodplant", openSpot(g, "foodplant"), { down: { x: 0, y: 1 } })!;
    expect(b.access).toBeNull();
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const out = scale(f.into, -1);
    const across = (o: number, k: number) => add(add(f.gate, scale(out, o)), scale(f.along, k));
    road(g, across(GATE_REACH, -200), across(GATE_REACH, 200), "boulevard");
    expect(b.access).not.toBeNull();
    expect(g.net.segs.get(b.access!.seg)!.type).toBe("boulevard");
    run(g, 0.2);
    expect(b.problem).not.toBe("No road to the gate");
  });

  it("a road that only ends at the gate joins it too, and its trucks set off", () => {
    const g = openGame();
    const b = g.place("farm", openSpot(g, "farm"), { down: { x: 0, y: 1 } })!;
    expect(b.access).toBeNull();
    // crops ready to ship, but no road out: nothing leaves
    b.plant!.out = { crops: 6 };
    run(g, 0.5);
    expect([...g.trips()].some((t) => t.haul?.plant === b.id)).toBe(false);
    // a road straight out from the gate, ending just in front of it, to a food plant
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const out = scale(f.into, -1);
    const end = add(f.gate, scale(out, 6)), far = add(f.gate, scale(out, 520));
    road(g, far, end);
    expect(b.access).not.toBeNull();
    const fp = g.place("foodplant", add(far, add(scale(out, -60), scale(f.along, 110))));
    expect(fp?.access).toBeTruthy();
    run(g, 0.5);
    expect([...g.trips()].some((t) => t.haul?.plant === b.id && t.haul.dest === fp!.id)).toBe(true);
  });

  it("keeps off a town's square, and a town's hall is never taken for a site", () => {
    const g = openGame();
    g.start();
    g.money = 1e7;
    const t = g.towns.list[0];
    const hall = g.buildings.byId.get(t.hall!)!;
    // the hall: a town building, not one of the company's sites (no fence, no gate, no levels)
    expect(hall.placed).toBeFalsy();
    expect(hall.plant).toBeUndefined();
    expect(g.inSite(hall.c)).toBe(false);
    // a plant standing free (turned, so it stays where the cursor is) can't cover any of the square
    const T = BUILDING_TYPES.foodplant;
    for (const off of [0, 60, T.w / 2 + 20]) {
      const p = add(hall.c, scale({ x: Math.cos(t.ang), y: Math.sin(t.ang) }, off * t.sq![0]));
      const pl = g.placedPlan("foodplant", p, { turn: 0.25 })!;
      expect(pl.ok, `${off} m along: ${pl.reason}`).toBe(false);
    }
    expect(g.onTownSquare(hall.c, 0, 5, 5)).toBe(true);
    // just past the square's edge (the hall's own lot misses it) still counts as on the square
    const edge = add(hall.c, scale({ x: Math.cos(t.ang), y: Math.sin(t.ang) }, -hall.hw * t.sq![0] - 2));
    expect(g.onTownSquare(edge, t.ang, 3, 3)).toBe(true);
    expect(g.place("foodplant", hall.c, { turn: 0.25 })).toBeNull();
    expect(g.buildings.byId.get(hall.id)?.kind).toBe(hall.kind);
  });

  it("no town builds inside a site's fence", () => {
    const g = openGame();
    const p = openSpot(g, "foodplant");
    const b = g.place("foodplant", p, { down: { x: 0, y: 1 } })!;
    expect(g.inSite(b.c)).toBe(true);
    // a street along the fence, outside it: its cells on the site's side are not for building
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const side = (o: number) => add(f.gate, scale(f.along, o));
    const e1 = add(side(b.hw + 20), scale(f.into, -10)), e2 = add(side(b.hw + 20), scale(f.into, b.hd * 2 + 40));
    road(g, e1, e2);
    const cells = [...g.zones.allCells()].filter((c) => rectDistance(c.c, b.c, b.hw, b.hd, b.rot) < 0.5);
    expect(cells.length).toBeGreaterThan(0);
    expect(okCells(g).filter((c) => rectDistance(c.c, b.c, b.hw, b.hd, b.rot) < 0.5)).toEqual([]);
  });

  it("the street laid to a gate goes round a town's homes, and place, undo, redo, undo keeps every one", () => {
    const g = new Game(7);
    g.start();
    run(g, 24 * 3);
    const town = g.towns.list[0];
    let links = 0, tried = false;
    for (let r = 250; r <= 700; r += 75) for (let k = 0; k < 16; k++) for (let q = 0; q < 4; q++) {
      const a = (k / 16) * 6.283, p = v2(town.c.x + Math.cos(a) * r, town.c.y + Math.sin(a) * r), rot = (q / 4) * 6.283;
      const pl = g.placedPlan("foodplant", p, { rot });
      // (a spot whose own footprint takes homes is no test of the street to its gate)
      if (!pl?.ok || !pl.link || pl.clears?.length) continue;
      links++;
      expect(g.lotsUnder(pl.link)).toEqual([]);
      if (tried) continue;
      tried = true;
      const homes = () => g.buildings.list.filter((b) => b.zone).map((b) => b.id).sort((x, y) => x - y);
      const h0 = homes(), m0 = g.money;
      expect(g.place("foodplant", p, { rot })).not.toBeNull();
      expect(homes()).toEqual(h0);
      g.undo(); g.redo(); g.undo();
      expect(homes()).toEqual(h0);
      expect(g.money).toBe(m0);
    }
    expect(links).toBeGreaterThan(10);
  }, 300000);
});

describe("site frame", () => {
  it("is the same for a pose and its twin turned half round with the other side", () => {
    const c = v2(120, -40);
    for (const rot of [0, 0.7, 2.2, -1.9]) for (const side of [1, -1] as const) {
      const a = siteFrame(c, rot, side, 90), b = siteFrame(c, rot + Math.PI, side === 1 ? -1 : 1, 90);
      for (const k of ["gate", "into", "along"] as const) {
        expect(b[k].x).toBeCloseTo(a[k].x, 6);
        expect(b[k].y).toBeCloseTo(a[k].y, 6);
      }
    }
  });
});
