// Industry sites: the plot's layout (pure), a site growing through its levels, and a site placed with no road that
// joins the network once a road reaches its gate.

import { describe, expect, it } from "vitest";
import { BUILDING_TYPES } from "../src/config";
import { add, rectDistance, scale, v2, type V2 } from "../src/core/math";
import { Game } from "../src/game/city";
import { Industry, PLANT_KINDS, type IndustryHost } from "../src/game/industry";
import type { Building } from "../src/game/buildings";
import { GATE_REACH, GROW_NEED, LEVEL_MULT, SITE_LEVELS, siteFrame, siteLayout, slotHalf, type SiteLayout } from "../src/game/sites";
import type { PendingSpawn } from "../src/sim/traffic";
import { planRoad } from "../src/roads/planner";
import { okCells, road, run } from "./helpers";

const boxes = (L: SiteLayout) => L.slots.map((s) => ({ s, ...slotHalf(s) }));

describe("site layout", () => {
  it("is the same for the same plot and seed, and fits every kind's plot", () => {
    for (const kind of PLANT_KINDS) {
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
  it("grows a level after a few days near capacity, with more output, jobs, trucks and store", () => {
    const { ind, b, work, grew, host } = lonePlant();
    const P = b.plant!;
    const jobs1 = b.cap, trucks1 = ind.trucksOf(b), store1 = Industry.storeOf(b);
    work(Math.floor(GROW_NEED / 40) - 2);
    expect(P.level).toBe(1);
    expect(P.why).toBeNull();
    expect(P.grow / GROW_NEED).toBeGreaterThan(0.9);
    work(3);
    expect(P.level).toBe(2);
    expect(grew).toEqual([2]);
    expect(P.upAt).toBeGreaterThan(0);
    expect(P.upAt).toBeLessThanOrEqual(host.time);
    expect(b.cap).toBe(Math.round(jobs1 * LEVEL_MULT[1]));
    expect(ind.trucksOf(b)).toBe(Math.round(trucks1 * LEVEL_MULT[1]));
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
    work(Math.floor(GROW_NEED / 40 / 2));
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

/** Every tile round the origin bought (big sites need room), and no town. */
function openGame(): Game {
  const g = new Game(7);
  for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) g.tiles.add(`${i},${j}`);
  return g;
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
    for (let i = -8; i <= 8; i++) for (let j = -8; j <= 8; j++) g.tiles.add(`${i},${j}`);
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
