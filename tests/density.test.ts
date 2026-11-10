// Towns are open, not crammed (owner, 2026-11-10: "less dense overall, grow more outward, more empty space, the
// grids a bit more open"): a town founded today lays its streets on the wider OPEN_BLOCK grid, with more parks and
// gardens left between its lots and thinner rings of denser building, so it covers more ground per resident, and a
// City still has the room to grow to 10,000 beside a neighbour. A save from before keeps its town on the old BLOCK.
//
// Measured on seed 7, every need served twice over: homes per km² of built-up ground (the 200 m squares with a home
// on), m² of it per resident, and the radius nine homes in ten stand within.
//   v0.0.91   Village 280 / 1013 m² / 344 m   Town 353 / 728 / 605   City 6,500 423 / 585 / 1149   City 10,000 413 / 487 / 1229
//   open      Village 218 / 1553 / 433        Town 324 / 971 / 802   City 6,500 355 / 850 / 1498   City 10,000 349 / 836 / 1891
//   slower growth (2026-11-10), rebuilding one old building for every ten households grown: Town at 2,001 335 / 960 / 729
//   (main at 1,977: 339 / 991 / 727; rebuilding by the calendar instead packed it to 808 m² a head with 478 homes)

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { ZONE_GROUP } from "../src/game/growables";
import { SPAWN_FIRST, type Town } from "../src/game/settlements";
import { BLOCK, OPEN_BLOCK, blockOf } from "../src/game/towns";
import { dist, v2, type V2 } from "../src/core/math";
import { F } from "../src/world/gen";

/**
 * How spread out a town is: the ground it has built up (the 200 m squares with a home of it on), homes per km² of
 * that and m² of it per resident; and the radius nine homes in ten stand within, and the furthest out (m).
 */
function spread(g: Game, t: Town) {
  const homes = g.buildings.list.filter((b) => b.town === t.id && b.zone && ZONE_GROUP[b.zone] === "res");
  const tiles = new Set(homes.map((b) => `${Math.floor(b.c.x / TILE)},${Math.floor(b.c.y / TILE)}`));
  const area = tiles.size * TILE * TILE;
  const ds = homes.map((b) => dist(b.c, t.c)).sort((a, b) => a - b);
  return { r90: ds[Math.floor(ds.length * 0.9)], rmax: ds[ds.length - 1], homes: homes.length / (area / 1e6), perHead: area / t.pop };
}
const TILE = 200;

/** The start town grown to `pop` (its needs met in full, as fastForward does), on the old grid or the open one. */
function grown(pop: number, old: boolean) {
  const g = new Game(7);
  if (old) {
    // (a town of a save from before the open grid: no block of its own, so the old BLOCK)
    const found = g.towns.found.bind(g.towns);
    g.towns.found = (p: V2, o?: { name?: string; ang?: number }) => {
      const t = found(p, o);
      if (typeof t !== "string") { delete t.block; t.reach = BLOCK; }
      return t;
    };
  }
  g.start();
  const t = g.towns.list[0];
  for (let d = 0; d < 200 && t.pop < pop; d++) g.fastForward(t.id, 24, 2);
  return { g, t };
}

describe("a town's density", () => {
  it("is lower than it was: more ground per resident at Town size, and it reaches further out", () => {
    const { g, t } = grown(2000, false);
    expect(blockOf(t)).toBe(OPEN_BLOCK);
    expect(t.size).toBe(2);
    const s = spread(g, t);
    expect(s.perHead, `${s.perHead.toFixed(0)} m² a head`).toBeGreaterThan(728 * 1.15);
    expect(s.homes, `${s.homes.toFixed(0)} homes/km²`).toBeLessThan(353);
    expect(s.r90).toBeGreaterThan(605 * 1.1);
  }, 300_000);

  it("a town from a save before the open grid keeps its old one", () => {
    const { g, t } = grown(300, true);
    expect(blockOf(t)).toBe(BLOCK);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    const u = h.towns.list[0];
    expect(u.block).toBeUndefined();
    expect(blockOf(u)).toBe(BLOCK);
    expect(h.towns.planOf(u).block).toBe(BLOCK);
    expect(h.buildings.list.length).toBe(g.buildings.list.length);
    // and one founded today keeps its open one through a save
    const n = grown(300, false);
    const m = Game.load(JSON.parse(JSON.stringify(n.g.serialize())));
    expect(blockOf(m.towns.list[0])).toBe(OPEN_BLOCK);
  }, 300_000);

  // (the first town to spring up does so about SPAWN_FIRST, 1.9 km, from the start town: halfway is under a km, so a
  // town is hemmed in only toward its neighbour, and grows on the other way)
  it("leaves a City room to grow to 10,000 beside a neighbour 1.9 km off, a couple of km across", () => {
    const g = new Game(7);
    g.start();
    const A = g.towns.list[0];
    let site: V2 | null = null;
    for (let r = SPAWN_FIRST; r < SPAWN_FIRST + 600 && !site; r += 50) for (let k = 0; k < 24 && !site; k++) {
      const a = A.ang + Math.PI / 4 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const q = v2(A.c.x + Math.cos(a) * r, A.c.y + Math.sin(a) * r);
      if (!g.towns.foundBlock(q) && !g.terrain.has(F.fert, q)) site = q;
    }
    const B = g.towns.found(site!);
    if (typeof B === "string") throw new Error(B);
    for (let d = 0; d < 200 && A.pop < 10000; d++) g.fastForward(A.id, 24, 2);
    expect(A.pop).toBeGreaterThanOrEqual(10000);
    const s = spread(g, A);
    // (more ground a head than v0.0.91 had with no neighbour at all)
    expect(s.perHead).toBeGreaterThan(487 * 1.2);
    // (its homes within about 2 km of its hall, and none past halfway to the neighbour)
    expect(s.r90).toBeLessThan(2100);
    for (const b of g.buildings.list) if (b.town === A.id && b.zone) expect(dist(b.c, B.c), `${b.kind} ${b.id}`).toBeGreaterThan(dist(b.c, A.c));
  }, 600_000);
});
