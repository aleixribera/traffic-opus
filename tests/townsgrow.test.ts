// Towns grow into cities (docs/design.md, "Towns grow into cities"): a hall on a square at the centre, rebuilt at
// each size; denser rings of zoning by size; old buildings redeveloped one at a time, at a steady pace; and a
// history of each town for its panel.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { obbOverlap } from "../src/game/buildings";
import { ZONE_GROUP, ZONE_LOTS } from "../src/game/growables";
import { HIST_DAYS, HIST_HOURS, type Town } from "../src/game/settlements";
import { DAY } from "../src/game/society";
import { BLOCK, HALLS, REDEV_SHARE, RINGS, isHall, redevPerDay, ringZone, sizeOf } from "../src/game/towns";
import { ZONE_RANK, type ZoneId } from "../src/game/zones";
import { dist } from "../src/core/math";

describe("zoning by size", () => {
  it("a hamlet has a high street at its centre and houses beyond", () => {
    expect(ringZone(0, 0.3)).toBe("comLow");
    expect(ringZone(0, 1.2)).toBe("resLow");
    expect(ringZone(0, 4)).toBe("resLow");
  });

  it("each size brings its era into the middle: terraces, then blocks, then flats and towers", () => {
    expect(ringZone(1, 2)).toBe("resRow");
    expect(ringZone(2, 2)).toBe("resMed");
    expect(ringZone(2, 1)).toBe("comMid");
    expect(ringZone(3, 2)).toBe("resTower");
    expect(ringZone(3, 3)).toBe("resHigh");
    expect(ringZone(3, 1)).toBe("comHigh");
    expect(ringZone(4, 1)).toBe("comTower");
    // and the edge keeps growing houses
    for (let s = 0; s < RINGS.length; s++) expect(ringZone(s, 12)).toBe("resLow");
  });

  it("land only ever gets denser as a town grows: never a lower zone of the same kind at the same distance", () => {
    for (let s = 1; s < RINGS.length; s++) {
      for (let r = 0; r < 8; r += 0.25) {
        const a = ringZone(s - 1, r), b = ringZone(s, r);
        if (ZONE_GROUP[a] === ZONE_GROUP[b]) expect(ZONE_RANK[b], `size ${s} at ${r} blocks`).toBeGreaterThanOrEqual(ZONE_RANK[a]);
      }
    }
  });

  it("each era stands in its own models, and low models are never stretched tall", () => {
    const models = (z: ZoneId) => ZONE_LOTS[z].map((t) => t.model);
    expect(models("resLow")).toEqual(["house", "house"]);
    expect(models("resRow")).toContain("terrace");
    expect(models("resHigh")).toContain("modernflats");
    expect(models("resTower")).toContain("aptower");
    expect(models("comLow")).toContain("highstreet");
    expect(models("comTower")).toContain("glasstower");
    for (const L of Object.values(ZONE_LOTS)) for (const t of L) expect(t.tall?.[1] ?? 1).toBeLessThanOrEqual(2);
  });

  it("a hall for every size, bigger each time", () => {
    expect(HALLS.slice(0, 4)).toEqual(["hamlethall", "villagehall", "townhall", "cityhall"]);
    expect(HALLS.every(isHall)).toBe(true);
  });

  it("redevelopment's pace climbs with size and town, a few a day", () => {
    expect(redevPerDay(1, 100)).toBeGreaterThanOrEqual(2);
    expect(redevPerDay(3, 1200)).toBeGreaterThan(redevPerDay(1, 100));
    expect(redevPerDay(3, 1200)).toBeLessThan(40);
  });
});

/** Everything about a town's homes, shops and people that has to add up after any amount of rebuilding. */
function consistent(g: Game, t: Town) {
  // every household lives in a home of its town that exists, with no more households than the home has room for
  const per = new Map<number, number>();
  for (const hh of g.people.households.values()) {
    const b = g.buildings.byId.get(hh.home);
    expect(b, `household ${hh.id}'s home`).toBeDefined();
    if (b!.town !== t.id) continue;
    expect(b!.zone && ZONE_GROUP[b!.zone]).toBe("res");
    per.set(b!.id, (per.get(b!.id) ?? 0) + 1);
  }
  for (const [id, n] of per) expect(n, `households in ${id}`).toBeLessThanOrEqual(g.buildings.byId.get(id)!.cap);
  // every lot cell belongs to a building that stands
  for (const c of g.zones.allCells()) if (c.lot) expect(g.buildings.byId.has(c.lot), `cell lot ${c.lot}`).toBe(true);
  // the census adds up
  g.towns.census();
  const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone && !b.abandoned);
  expect(t.shops).toBe(mine.filter((b) => ZONE_GROUP[b.zone!] === "com").length);
  expect(t.homes).toBe(mine.filter((b) => ZONE_GROUP[b.zone!] === "res").reduce((a, b) => a + b.cap, 0));
  expect(t.households).toBeLessThanOrEqual(t.homes);
}

describe("a town growing into a town", () => {
  let g: Game;
  let t: Town;
  const starts: { time: number; sites: number; homes: number; size: number; n: number }[] = [];
  const grown: number[] = [];

  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    g.on((e) => { if (e.t === "townSize" && e.town === t.id) grown.push(e.size); });
    // count each redevelopment as it starts: how many sites were going up already, and how big the town was
    const real = g.rebuildLots.bind(g);
    g.rebuildLots = (...a: Parameters<Game["rebuildLots"]>) => {
      const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone);
      starts.push({
        time: g.time, n: mine.length, size: t.size,
        sites: mine.filter((b) => b.redev && b.built < 1).length,
        homes: mine.filter((b) => ZONE_GROUP[b.zone!] === "res").length,
      });
      return real(...a);
    };
    for (let d = 0; d < 40 && sizeOf(t.pop) < 2; d++) g.fastForward(t.id, 24);
    g.fastForward(t.id, 24);
  }, 600_000);

  it("reaches Town, with a banner at each size", () => {
    expect(sizeOf(t.pop)).toBeGreaterThanOrEqual(2);
    expect(t.size).toBeGreaterThanOrEqual(2);
    expect(grown.slice(0, 2)).toEqual([1, 2]);
  });

  it("has its hall for its size, on its square, with nothing of the town standing on it", () => {
    const h = g.buildings.byId.get(t.hall)!;
    expect(h).toBeDefined();
    expect(h.kind).toBe(HALLS[t.size]);
    expect(h.town).toBe(t.id);
    expect(g.towns.onSquare(t, h.c)).toBe(true);
    expect(dist(h.c, t.c)).toBeLessThan(BLOCK);
    for (const o of g.buildings.list) if (o.zone) expect(obbOverlap(h.c, h.hw - 1, h.hd - 1, h.rot, o.c, o.hw - 1, o.hd - 1, o.rot), `building ${o.id} on the square`).toBe(false);
    // and the square is never zoned
    for (const c of g.zones.allCells()) if (g.towns.onSquare(t, c.c)) expect(c.zone).toBeNull();
  });

  it("zones its free land by its size", () => {
    let n = 0;
    for (const c of g.zones.allCells()) {
      if (!c.ok || c.lot || !c.zone || dist(c.c, t.c) > t.reach) continue;
      expect(c.zone).toBe(ringZone(t.size, dist(c.c, t.c) / BLOCK));
      n++;
    }
    expect(n).toBeGreaterThan(0);
  });

  it("rebuilds its centre denser: terraces and blocks, stores and offices", () => {
    const mine = g.buildings.list.filter((b) => b.town === t.id && b.zone);
    const kinds = new Set(mine.map((b) => b.kind));
    expect(kinds.has("terrace")).toBe(true);
    expect(kinds.has("apartments") || kinds.has("store") || kinds.has("office")).toBe(true);
    expect(mine.filter((b) => b.redev).length).toBeGreaterThan(5);
    // the centre goes first: redeveloped buildings stand nearer the centre than the town's edge
    const redev = mine.filter((b) => b.redev).map((b) => dist(b.c, t.c));
    const far = Math.max(...mine.map((b) => dist(b.c, t.c)));
    expect(Math.min(...redev)).toBeLessThan(far / 2);
  });

  it("redevelops at a steady pace: a few a day, never more than a twentieth of its homes building at once", () => {
    expect(starts.length).toBeGreaterThan(5);
    const perDay = new Map<number, number>();
    for (const s of starts) {
      expect(s.sites, `sites going up at ${s.time}`).toBeLessThan(Math.max(1, Math.floor(s.homes * REDEV_SHARE)));
      const d = Math.floor(s.time / DAY);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    for (const [d, n] of perDay) {
      const s = starts.filter((x) => Math.floor(x.time / DAY) === d).at(-1)!;
      expect(n, `day ${d}`).toBeLessThanOrEqual(redevPerDay(s.size, s.n));
    }
    // and spaced out, not all at once
    for (let i = 1; i < starts.length; i++) {
      const a = starts[i - 1], b = starts[i];
      if (Math.floor(a.time / DAY) === Math.floor(b.time / DAY)) expect(b.time - a.time).toBeGreaterThanOrEqual(DAY / redevPerDay(b.size, b.n) / 2 - 1e-6);
    }
  });

  it("keeps its homes, households and shops consistent through the rebuilding", () => {
    consistent(g, t);
  });

  it("remembers its past: hourly people, capped, and a record of each day", () => {
    const H = t.hist;
    expect(H.pop.length).toBeGreaterThan(24);
    expect(H.pop.length).toBeLessThanOrEqual(HIST_HOURS);
    expect(H.households.length).toBe(H.pop.length);
    expect(H.pop.at(-1)).toBeGreaterThan(H.pop[0]);
    expect(H.days.length).toBeGreaterThan(3);
    expect(H.days.length).toBeLessThanOrEqual(HIST_DAYS);
    const last = H.days.at(-1)!;
    expect(last.day).toBe(g.day - 1);
    expect(last.supply.food).toBeGreaterThan(0.5);
    expect(last.loads.food).toBeGreaterThan(0);
    // days come in order, one each
    for (let i = 1; i < H.days.length; i++) expect(H.days[i].day).toBe(H.days[i - 1].day + 1);
  });

  it("saves and loads its size, hall, square and history, and carries on", () => {
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const h = Game.load(json);
    const u = h.towns.byId.get(t.id)!;
    expect({ size: u.size, hall: u.hall, sq: u.sq, hist: u.hist }).toEqual({ size: t.size, hall: t.hall, sq: t.sq, hist: t.hist });
    expect(h.buildings.byId.get(u.hall)?.kind).toBe(HALLS[t.size]);
    h.fastForward(u.id, 6);
    consistent(h, u);
  });

  it("a town from a save before the halls gets its hall, standing, on a square of its own", () => {
    const json = JSON.parse(JSON.stringify(g.serialize()));
    const tj = json.towns.towns.find((x: { id: number }) => x.id === t.id);
    json.buildings = json.buildings.filter((b: { kind: string }) => !isHall(b.kind as never));
    for (const k of ["size", "hall", "sq", "hist", "redevToday"]) delete tj[k];
    const h = Game.load(json);
    const u = h.towns.byId.get(t.id)!;
    expect(u.size).toBe(sizeOf(u.pop));
    const hall = h.buildings.byId.get(u.hall)!;
    expect(hall.kind).toBe(HALLS[u.size]);
    expect(hall.built).toBe(1);
    expect(h.towns.onSquare(u, hall.c)).toBe(true);
    expect(u.hist).toEqual({ pop: [], households: [], days: [] });
    consistent(h, u);
  });

  it("a town keeps its hall: the bulldozer leaves it standing", () => {
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    const u = h.towns.byId.get(t.id)!;
    h.bulldoze([], [u.hall]);
    expect(h.buildings.byId.has(u.hall)).toBe(true);
  });
});
