// Towns run themselves (docs/design.md, "Towns run themselves", owner 2026-11-08): each town lays out a plan of
// its own (curved side streets, rings and spokes, greens, gardens; townplan.ts), less dense at the centre and
// spreading outward; it widens its own busiest streets, and from Town size builds one road out of town to a road
// within reach. It never touches the player's roads, and never pulls a building down to do any of it.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { ZONE_GROUP } from "../src/game/growables";
import { OUT_REACH, WIDEN_LOAD, type Town } from "../src/game/settlements";
import { PLAN_GRID, PLAN_ORGANIC, TownPlan } from "../src/game/townplan";
import { BLOCK, sizeOf } from "../src/game/towns";
import { dkey } from "../src/sim/router";
import { dist, type V2 } from "../src/core/math";
import { road } from "./helpers";

/** Homes (households they house) per hectare within R m of the hall. */
function homesPerHa(g: Game, t: Town, R: number): number {
  const hall = g.buildings.byId.get(t.hall)!;
  const res = g.buildings.list.filter((b) => b.town === t.id && b.zone && ZONE_GROUP[b.zone] === "res" && dist(b.c, hall.c) < R);
  return res.reduce((n, b) => n + b.cap, 0) / ((Math.PI * R * R) / 10000);
}

/** The player's roads (every road no town laid): type and length of each, summed by type. */
function playerRoads(g: Game): Record<string, number> {
  const out: Record<string, number> = {};
  for (const [id, s] of g.net.segs) {
    if (s.town) continue;
    out[s.type] = Math.round(((out[s.type] ?? 0) + g.net.segGeom.get(id)!.center.length) * 10) / 10;
  }
  return out;
}

describe("a town's own plan", () => {
  let g: Game, t: Town, day = 0;
  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    // (every need served twice over: steady growth on a supply that runs ahead of the town, towns.ts)
    for (day = 0; day < 30 && sizeOf(t.pop) < 2; day++) g.fastForward(t.id, 24, 2);
  }, 120_000);

  it("grows to Town size at the pace it always did (the growth before steady growth, on the same supply: day 8)", () => {
    expect(t.size).toBe(2);
    expect(day).toBeLessThanOrEqual(9);
  });

  it("is less crowded round its hall and reaches further out", () => {
    // (on the square grid, v0.0.68, the same town at Town size: 7.2 homes a hectare within 150 m of the hall, its
    // land reaching 547 m out)
    // (one town's 150 m is a handful of lots, so the figure swings by seed, 3.5 to 7 here: it is judged over six
    // towns, 5.3 on average with front strips and lots kept clear of each other, v0.0.80)
    let sum = homesPerHa(g, t, 150);
    const more = [3, 5, 11, 21, 42];
    for (const seed of more) {
      const h = new Game(seed);
      h.start();
      const u = h.towns.list[0];
      for (let d = 0; d < 30 && sizeOf(u.pop) < 2; d++) h.fastForward(u.id, 24, 2);
      sum += homesPerHa(h, u, 150);
    }
    expect(sum / (more.length + 1)).toBeLessThan(6.2);
    expect(t.reach).toBeGreaterThan(620);
  }, 120_000);

  it("lays streets that aren't all on a square grid", () => {
    let square = 0, n = 0;
    for (const s of g.net.segs.values()) {
      if (s.town !== t.id) continue;
      n++;
      const c = s.c, d = { x: c.p3.x - c.p0.x, y: c.p3.y - c.p0.y }, L = Math.hypot(d.x, d.y);
      const off = Math.abs(Math.sin(2 * (Math.atan2(d.y, d.x) - t.ang)));
      const bow = Math.max(Math.abs((c.p1.x - c.p0.x) * d.y - (c.p1.y - c.p0.y) * d.x), Math.abs((c.p2.x - c.p0.x) * d.y - (c.p2.y - c.p0.y) * d.x)) / L;
      if (off < 0.06 && bow < 1) square++;
    }
    expect(n).toBeGreaterThan(100);
    // (the crossroads and the blocks round the hall stay square: the rest bend)
    expect(square / n).toBeLessThan(0.4);
  });

  it("keeps the main street straight and the hall's square open", () => {
    const P = g.towns.planOf(t);
    for (let i = -4; i <= 4; i++) {
      const p = P.at(i, 0);
      const off = Math.abs(-(p.x - t.c.x) * Math.sin(t.ang) + (p.y - t.c.y) * Math.cos(t.ang));
      expect(off, `main street node ${i}`).toBeLessThan(0.5);
    }
    const hall = g.buildings.byId.get(t.hall)!;
    expect(g.buildings.list.filter((b) => b.zone && g.towns.onSquare(t, b.c))).toEqual([]);
    expect(hall).toBeTruthy();
  });
});

describe("plans", () => {
  const land = { isWater: () => false, isMountain: () => false };
  it("are the same every time for a town (nothing about them is saved)", () => {
    const a = new TownPlan({ x: 100, y: 200 }, 0.3, PLAN_ORGANIC, 12345, land);
    const b = new TownPlan({ x: 100, y: 200 }, 0.3, PLAN_ORGANIC, 12345, land);
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) {
      expect(a.pt(i, j)).toEqual(b.pt(i, j));
      expect(a.has([i, j, i + 1, j])).toBe(b.has([i, j, i + 1, j]));
    }
  });

  it("differ from town to town", () => {
    const a = new TownPlan({ x: 0, y: 0 }, 0, PLAN_ORGANIC, 1, land);
    const b = new TownPlan({ x: 0, y: 0 }, 0, PLAN_ORGANIC, 2, land);
    let moved = 0;
    for (let i = -5; i <= 5; i++) for (let j = -5; j <= 5; j++) if (dist(a.pt(i, j)!, b.pt(i, j)!) > 5) moved++;
    expect(moved).toBeGreaterThan(40);
  });

  it("leave the crossroads and the ring round it square", () => {
    const a = new TownPlan({ x: 0, y: 0 }, 0, PLAN_ORGANIC, 99, land);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) expect(dist(a.pt(i, j)!, { x: i * BLOCK, y: j * BLOCK })).toBeLessThan(1e-6);
  });

  it("keep a town from an older save on its square grid", () => {
    const g = new Game(3);
    g.start();
    const d = g.towns.toJSON();
    delete (d.towns[0] as { layout?: number }).layout;
    g.towns.load(d);
    const t = g.towns.list[0];
    expect(t.layout).toBe(PLAN_GRID);
    const P = g.towns.planOf(t);
    const p = P.at(3, -2), u = { x: Math.cos(t.ang), y: Math.sin(t.ang) };
    expect(dist(p, { x: t.c.x + (u.x * 3 + u.y * 2) * BLOCK, y: t.c.y + (u.y * 3 - u.x * 2) * BLOCK })).toBeLessThan(1e-6);
  });
});

describe("a town's own roads", () => {
  let g: Game, t: Town;
  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    for (let d = 0; d < 30 && sizeOf(t.pop) < 2; d++) g.fastForward(t.id, 24);
    g.money = 1e9;
  }, 120_000);

  it("widens its busiest street, and nothing else: no building lost, no road of the player's touched", () => {
    const P = g.towns.planOf(t);
    P.index(t.reach / BLOCK + 1);
    // the main street's pieces, busy
    const main: number[] = [];
    for (const [id, s] of g.net.segs) {
      if (s.town !== t.id || s.type !== "street") continue;
      const geo = g.net.segGeom.get(id)!;
      const mid = geo.center.pts[Math.floor(geo.center.pts.length / 2)];
      const dir = { x: Math.cos(t.ang), y: Math.sin(t.ang) };
      const hit = P.edgeAt(mid, dir, 3, 0.95);
      if (hit && hit.e[1] === 0 && hit.e[3] === 0) main.push(id);
    }
    expect(main.length).toBeGreaterThan(2);
    const before = new Set(g.buildings.list.map((b) => b.id));
    const player = playerRoads(g);
    const toasts: string[] = [];
    g.on((e) => { if (e.t === "toast") toasts.push(e.msg); });
    for (const id of main) for (const d of [1, -1] as const) g.traffic.flow.set(dkey(id, d), { n: 12, ratio: 0.5, speed: 0.5, queue: 4 });
    for (let k = 0; k < 48; k++) g.towns.watchTraffic();
    g.towns.widen(t);
    const wide = main.filter((id) => g.net.segs.get(id)?.type === "avenue");
    expect(wide.length).toBeGreaterThan(0);
    expect(toasts).toContain(`${t.name} widened Main Street`);
    expect(t.widened).toBe(1);
    // (every building that stood still stands)
    for (const id of before) expect(g.buildings.byId.has(id), `building ${id}`).toBe(true);
    expect(playerRoads(g)).toEqual(player);
    // nothing quiet is widened
    for (const [id, s] of g.net.segs) if (s.town === t.id && !main.includes(id)) expect(s.type).toBe("street");
  });

  it("widens nothing that isn't busy", () => {
    g.traffic.flow.clear();
    // (a day for the jam to clear: the day after, its busiest hour was the first)
    for (let k = 0; k < 64; k++) g.towns.watchTraffic();
    g.towns.widen(t);
    const types = [...g.net.segs.values()].map((s) => s.type).join();
    for (let k = 0; k < 192; k++) g.towns.watchTraffic();
    g.towns.widen(t);
    g.towns.widen(t);
    expect([...g.net.segs.values()].map((s) => s.type).join()).toBe(types);
    expect(WIDEN_LOAD).toBeGreaterThan(0.5);
  });

  it("builds no road out with nothing in reach", () => {
    const n = g.net.segs.size;
    g.towns.reachOut(t);
    expect(t.outward).toBeUndefined();
    expect(g.net.segs.size).toBe(n);
  });

  it("builds one road out to a road of the player's within reach, and only one", () => {
    // a road of the player's 1.3 km out, across the way the town's start road goes, on open land
    const W = g.world;
    const clear = (a: V2, b: V2) => {
      for (let k = 0; k <= 40; k++) {
        const p = { x: a.x + ((b.x - a.x) * k) / 40, y: a.y + ((b.y - a.y) * k) / 40 };
        if (W.isWater(p) || W.isMountain(p) || !W.inBounds(p)) return false;
      }
      return true;
    };
    let at: { a: V2; b: V2; dir: number } | null = null;
    for (let k = 0; k < 36 && !at; k++) {
      const th = t.ang + Math.PI / 2 + (k % 2 ? 1 : -1) * Math.floor((k + 1) / 2) * (Math.PI / 18);
      const u = { x: Math.cos(th), y: Math.sin(th) }, v = { x: -u.y, y: u.x };
      const m = { x: t.c.x + u.x * 1300, y: t.c.y + u.y * 1300 };
      const a = { x: m.x - v.x * 250, y: m.y - v.y * 250 }, b = { x: m.x + v.x * 250, y: m.y + v.y * 250 };
      if (clear(a, b) && clear(t.c, m) && clear(a, t.c) && clear(b, t.c)) at = { a, b, dir: th };
    }
    expect(at, "open land for the test road").not.toBeNull();
    road(g, at!.a, at!.b);
    const theirs = [...g.net.segs.values()].find((s) => !s.town && dist(s.c.p0, at!.a) < 1)!;
    const player = playerRoads(g);
    const before = new Set(g.buildings.list.map((b) => b.id));
    const toasts: string[] = [];
    g.on((e) => { if (e.t === "toast") toasts.push(e.msg); });
    g.towns.reachOut(t);
    expect(t.outward).toBeDefined();
    expect(toasts.some((m) => m.startsWith(`${t.name} built a road out`))).toBe(true);
    // (the town's streets now reach the player's road)
    const mine = [...g.net.segs.values()].find((s) => s.town === t.id)!;
    expect(g.connected(mine.id, [...g.net.segs.values()].find((s) => !s.town && dist(s.c.p0, at!.a) < 1)?.id ?? theirs.id)).toBe(true);
    // the player's road is split where the town's joins it, and nothing more: same roads, same lengths
    const now = playerRoads(g);
    expect(Object.keys(now)).toEqual(Object.keys(player));
    for (const k of Object.keys(player)) expect(Math.abs(now[k] - player[k])).toBeLessThan(1);
    for (const id of before) expect(g.buildings.byId.has(id), `building ${id}`).toBe(true);
    // its road out is the town's, within reach, and the only one: asked again, it builds nothing more
    const out = [...g.net.segs.values()].filter((s) => s.town === t.id && dist(s.c.p3, t.c) > t.reach);
    expect(out.length).toBeGreaterThan(0);
    for (const s of out) expect(dist(s.c.p3, t.c)).toBeLessThan(OUT_REACH + 50);
    const n = g.net.segs.size;
    g.towns.reachOut(t);
    expect(g.net.segs.size).toBe(n);
  });
});
