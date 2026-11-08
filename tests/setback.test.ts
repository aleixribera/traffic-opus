// Homes stand back from their street behind a front strip their driveways cross (config ZONE_SETBACK), so a street
// upgraded to any road that still takes driveways keeps every home, shop and the town hall: the road and its
// pavement take the strip and the driveways shorten to the new kerb. Saves from before the strips move their homes
// back behind them on load.
import { beforeAll, describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { ROAD_TYPES, ZONE_SETBACK, roadWidth, SIDEWALK, roadGroup, type RoadTypeId } from "../src/config";
import { rectDistance } from "../src/core/math";
import { cubicClosest } from "../src/roads/planner";
import { isHall } from "../src/game/towns";
import { DEPTH, MIN_LOT_DEPTH } from "../src/game/zones";
import type { Building } from "../src/game/buildings";

const fronted = (g: Game) => g.buildings.list.filter((b) => b.zone || isHall(b.kind));

/** Its driveway (a hall's path) starts at its road's kerb. */
function atKerb(g: Game, b: Building): number {
  const s = g.net.segs.get(b.access!.seg)!;
  return Math.abs(cubicClosest(s.c, b.front).d - roadWidth(ROAD_TYPES[s.type]) / 2);
}

/**
 * How far its lot keeps behind its own road's pavement, and clear of any other road's surface (a corner lot's side
 * may run under the side street's pavement, as it always has; negative: on it).
 */
function behindPavement(g: Game, b: Building): number {
  let worst = Infinity;
  for (const id of g.net.segsNear(b.c.x - 90, b.c.y - 90, b.c.x + 90, b.c.y + 90)) {
    const s = g.net.segs.get(id)!;
    const T = ROAD_TYPES[s.type];
    if (!T.allowsAccess) continue;
    const edge = roadWidth(T) / 2 + (id === b.access?.seg ? SIDEWALK[roadGroup(T)] : 0);
    for (const p of g.net.segGeom.get(id)!.center.pts) worst = Math.min(worst, rectDistance(p, b.c, b.hw, b.hd, b.rot) - edge);
  }
  return worst;
}

/**
 * Every town street (or what it was upgraded to) becomes `to`, with the Upgrade tool's checks. Returns how many, and
 * the buildings the upgrades pulled down (none: a town may still redevelop a home later, as it does on any road).
 */
function upgradeAll(g: Game, from: RoadTypeId[], to: RoadTypeId): { n: number; lost: number[] } {
  const before = g.buildings.list.map((b) => b.id);
  let n = 0;
  for (const id of [...g.net.segs.keys()]) {
    const s = g.net.segs.get(id);
    if (!s || !from.includes(s.type)) continue;
    expect(g.upgradePlan(id, to).errors.map((e) => e.msg), `${s.type} ${id} to ${to}`).toEqual([]);
    expect(g.upgrade(id, to)).toBe(true);
    n++;
  }
  return { n, lost: before.filter((id) => !g.buildings.byId.has(id)) };
}

describe("front strips", () => {
  it("are wide enough for every road homes can face, pavement included", () => {
    for (const t of Object.values(ROAD_TYPES)) if (t.allowsAccess) expect(ZONE_SETBACK).toBeGreaterThan(roadWidth(t) / 2 + SIDEWALK[roadGroup(t)]);
  });

  describe("a town's streets upgraded", () => {
    let g: Game;
    let ids: number[];
    beforeAll(() => {
      g = new Game(7);
      g.start();
      g.unlockAll();
      g.money = 1e7;
      for (let i = 0; i < 4000; i++) g.step(0.5);
      expect(g.buildings.list.filter((b) => b.zone).length).toBeGreaterThan(10);
      ids = g.buildings.list.map((b) => b.id);
    }, 120_000);

    it("start with every lot behind the strip and every driveway at the kerb", () => {
      for (const b of fronted(g)) {
        expect(b.access, b.kind).not.toBeNull();
        expect(atKerb(g, b)).toBeLessThan(0.6);
        expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(ZONE_SETBACK - roadWidth(ROAD_TYPES.street) / 2 - SIDEWALK.small - 0.6);
      }
    });

    // each wider road in turn, then back to streets: nothing pulled down, every driveway shortened (or lengthened)
    // to the new kerb, and no lot under the road or its pavement
    const steps: [RoadTypeId[], RoadTypeId][] = [[["street"], "streetM"], [["streetM"], "avenue"], [["avenue"], "avenueM"], [["avenueM"], "street"]];
    for (const [from, to] of steps) {
      it(`to ${to}: keep every home, shop and hall, with their driveways at the new kerb`, () => {
        const { n, lost } = upgradeAll(g, from, to);
        expect(n).toBeGreaterThan(3);
        expect(lost).toEqual([]);
        expect(ids.filter((id) => !g.buildings.byId.has(id))).toEqual([]);
        for (const b of fronted(g)) {
          expect(b.access, `${b.kind} ${b.id}`).not.toBeNull();
          expect(g.net.segs.get(b.access!.seg)!.type).toBe(to);
          expect(atKerb(g, b), `${b.kind} ${b.id}`).toBeLessThan(0.6);
          expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(-0.05);
        }
      });
    }
  });

  it("split a town block five rows and four, so both sides take the deeper lots", () => {
    const g = new Game(7);
    g.start();
    const t = g.towns.list[0];
    for (let d = 0; d < 6; d++) g.fastForward(t.id, 24);
    // every column of a town street's blocks that has any lot room at all: how many rows deep it runs
    let cols = 0, deep = 0;
    for (const blk of g.zones.blocks.values()) {
      if (g.net.segs.get(blk.seg)?.town === undefined) continue;
      for (let k = 1; k < blk.cols - 1; k++) {
        let d = 0;
        while (d < DEPTH && blk.cells[k * DEPTH + d].ok) d++;
        if (d < MIN_LOT_DEPTH) continue;
        cols++;
        if (d >= 4) deep++;
      }
    }
    expect(cols).toBeGreaterThan(200);
    // (with six rows behind the strip the older side of each block took six and left the younger three: about half)
    expect(deep / cols).toBeGreaterThan(0.85);
  }, 120_000);
});

describe("a save from before the front strips (v0.0.65)", () => {
  // (node's fs and zlib, untyped here: the project's types are the browser's)
  let data: any;
  let g: Game;
  beforeAll(async () => {
    const node = (m: string) => import(/* @vite-ignore */ m);
    const [{ readFileSync }, { gunzipSync }] = await Promise.all([node("fs"), node("zlib")]);
    data = JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/pre-strips-v0.0.65.json.gz", import.meta.url))).toString());
    g = Game.load(data);
  });

  it("loads with every home, shop and household, the homes moved back behind the strip", () => {
    const saved = data.buildings as { id: number; zone?: string }[];
    expect(saved.filter((b) => b.zone).length).toBeGreaterThan(100);
    expect(g.buildings.list.map((b) => b.id).sort((a, b) => a - b)).toEqual(saved.map((b) => b.id).sort((a, b) => a - b));
    expect(g.people.households.size).toBe(data.people.hhs.length);
    for (const b of fronted(g)) {
      expect(b.access, `${b.kind} ${b.id}`).not.toBeNull();
      expect(atKerb(g, b)).toBeLessThan(0.6);
      expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(ZONE_SETBACK - roadWidth(ROAD_TYPES.street) / 2 - SIDEWALK.small - 0.6);
    }
    // their lots read off the cells they stand on, so the town builds and redevelops round them as before
    for (const b of g.buildings.list.filter((x) => x.zone)) expect(b.lot, `${b.kind} ${b.id}`).toBeDefined();
  });

  it("lets its streets become divided avenues without pulling a home down", () => {
    g.unlockAll();
    g.money = 1e7;
    const { n, lost } = upgradeAll(g, ["street"], "avenueM");
    expect(n).toBeGreaterThan(10);
    expect(lost).toEqual([]);
    for (const b of fronted(g)) {
      expect(atKerb(g, b)).toBeLessThan(0.6);
      expect(behindPavement(g, b), `${b.kind} ${b.id}`).toBeGreaterThan(-0.05);
    }
  });
});
