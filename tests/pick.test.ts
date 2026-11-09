// Picking along a line of sight (ui/pick.ts): with the camera tilted a click selects what the player sees there, so a
// building is hit on its walls and roof, a bridge on its deck, a vehicle at its own height, and whatever stands in
// front hides what is behind it.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { planRoad, type Snap } from "../src/roads/planner";
import { LEVEL_H } from "../src/config";
import type { V2 } from "../src/core/math";
import type { Vehicle } from "../src/sim/traffic";
import type { Building } from "../src/game/buildings";
import { rayAt, type GroundRay } from "../src/render/viewmath";
import { buildingOn, deckOn, heightsOn, pickOn, rayBox, straightDown, vehicleOn, type Solid } from "../src/ui/pick";
import { road } from "./helpers";

const DEG = Math.PI / 180;

/** The line of sight of a camera turned `rot` and tilted `tilt` that passes through the point p at height h. */
function sightThrough(p: V2, h: number, tilt: number, rot = 0): GroundRay {
  const k = Math.tan(tilt), kx = -Math.sin(rot) * k, ky = Math.cos(rot) * k;
  return { x: p.x - kx * h, y: p.y - ky * h, kx, ky };
}

describe("a line of sight and a building's box", () => {
  const box: Solid = { x: 0, y: 0, ux: 1, uy: 0, hx: 5, hz: 5, tall: 10 };

  it("from straight above, it is the roof or nothing", () => {
    expect(rayBox(straightDown({ x: 2, y: -3 }), box)).toBe(10);
    expect(rayBox(straightDown({ x: 5.5, y: 0 }), box)).toBe(-1);
  });

  it("at a tilt it meets the roof, a wall, or passes over", () => {
    // (the line climbs toward -x: one metre sideways for each metre up)
    const from = (x: number): GroundRay => ({ x, y: 0, kx: -1, ky: 0 });
    // reaches the ground beyond the box, having come in through the roof
    expect(rayBox(from(12), box)).toBe(10);
    // reaches the ground inside the box: it came in through the west wall, 2 m up
    expect(rayBox(from(-3), box)).toBeCloseTo(2, 9);
    // passes over the roof altogether
    expect(rayBox(from(20), box)).toBe(-1);
    // and to one side of it
    expect(rayBox({ x: 12, y: 6, kx: -1, ky: 0 }, box)).toBe(-1);
  });

  it("a box turned on its lot is hit as it stands", () => {
    const c = Math.SQRT1_2, turned: Solid = { x: 0, y: 0, ux: c, uy: c, hx: 10, hz: 1, tall: 4 };
    // (a long thin shed along the diagonal: on it, and off it at the same distance from its middle)
    expect(rayBox(straightDown({ x: 6, y: 6 }), turned)).toBe(4);
    expect(rayBox(straightDown({ x: 6, y: -6 }), turned)).toBe(-1);
  });

  it("the building in front hides the one behind, and a roof is picked from off its lot", () => {
    const lot = (id: number, x: number, y: number) => ({ id, c: { x, y }, hw: 5, hd: 5 }) as unknown as Building;
    const back = lot(1, 0, 0), front = lot(2, 0, 20);
    const solids = new Map<Building, Solid[]>([
      [back, [{ x: 0, y: 0, ux: 1, uy: 0, hx: 5, hz: 5, tall: 10 }]],
      [front, [{ x: 0, y: 20, ux: 1, uy: 0, hx: 5, hz: 5, tall: 12 }]],
    ]);
    const at = (p: V2) => [back, front].find((b) => Math.abs(p.x - b.c.x) <= 5 && Math.abs(p.y - b.c.y) <= 5) ?? null;
    const g = { buildings: { list: [back, front], at } } as unknown as Game;
    const of = (b: Building) => solids.get(b);
    // the ground under this line is the back lot's, but the line comes through the front building's wall first
    const through: GroundRay = { x: 0, y: 4, kx: 0, ky: 1 };
    expect(buildingOn(g, straightDown(through), of)?.b).toBe(back);
    expect(buildingOn(g, through, of)).toEqual({ b: front, h: 12 });
    // a line that lands behind the back building, having come through its roof
    const over: GroundRay = { x: 0, y: -8, kx: 0, ky: 1 };
    expect(buildingOn(g, straightDown(over), of)).toBeNull();
    expect(buildingOn(g, over, of)).toEqual({ b: back, h: 10 });
    // open ground stays open ground
    expect(buildingOn(g, { x: 40, y: 40, kx: 0, ky: 1 }, of)).toBeNull();
  });
});

describe("a line of sight and a vehicle", () => {
  const car = (id: number, x: number, y: number, h: number) =>
    ({ id, x, y, px: x, py: y, ang: 0, pang: 0, h, ph: h, len: 4.5 }) as unknown as Vehicle;

  it("a truck on a bridge is picked on the bridge, not under it", () => {
    const up = car(1, 0, 0, LEVEL_H);
    const ray = sightThrough({ x: -1, y: 0 }, LEVEL_H + 1, 50 * DEG);
    expect(vehicleOn([up], ray, 1.5)?.id).toBe(1);
    // the ground that line reaches is metres from the truck: seen from straight above there is nothing there
    expect(Math.hypot(ray.x + 1, ray.y)).toBeGreaterThan(7);
    expect(vehicleOn([up], straightDown(ray), 1.5)).toBeNull();
  });

  it("a car behind what the line hits first is left out", () => {
    const low = car(2, 0, 0, 0);
    const ray = sightThrough({ x: -1, y: 0 }, 1, 50 * DEG);
    expect(vehicleOn([low], ray, 1.5)?.id).toBe(2);
    // (a deck 6 m up in front of it: only vehicles from 2 m up are in sight)
    expect(vehicleOn([low], ray, 1.5, 1, LEVEL_H - 4)).toBeNull();
  });
});

describe("a line of sight and a raised road", () => {
  let g: Game;
  let under = -1, deck = -1;
  const X = -250, Y = 250;

  beforeAll(() => {
    g = new Game(7);
    // a street on the ground, west to east, and a level-1 street crossing over it, south to north
    road(g, { x: X - 100, y: Y }, { x: X + 100, y: Y });
    under = [...g.net.segs.keys()].at(-1)!;
    const at = (y: number): Snap => ({ p: { x: X, y }, h: LEVEL_H, guides: [] });
    const plan = planRoad(g.net, g.world, { start: at(Y - 100), end: at(Y + 100), mode: "straight", type: "street" });
    expect(plan.errors.map((e) => e.msg)).toEqual([]);
    expect(g.build(plan)).toBe(true);
    deck = [...g.net.segs.keys()].at(-1)!;
    expect(deck).not.toBe(under);
  });

  it("where they cross, the deck is on top", () => {
    const hit = deckOn(g.net, straightDown({ x: X, y: Y }), 2)!;
    expect(hit.id).toBe(deck);
    expect(hit.h).toBeCloseTo(LEVEL_H, 3);
    // (asked for the ground level only, it is the street underneath)
    expect(deckOn(g.net, straightDown({ x: X, y: Y }), 2, 0)?.id).toBe(under);
    expect(deckOn(g.net, straightDown({ x: X, y: Y }), 2, 1)?.id).toBe(deck);
  });

  it("at a tilt the deck is picked where it is seen, though the ground behind it is another road's", () => {
    // looking along the lower street (turned a quarter), steeply: the line through the middle of the deck reaches the
    // ground well to one side of it, on the lower street
    const ray = sightThrough({ x: X, y: Y }, LEVEL_H, 58 * DEG, Math.PI / 2);
    const ground = rayAt(ray, 0);
    expect(Math.abs(ground.x - X)).toBeGreaterThan(g.net.segGeom.get(deck)!.width / 2 + 2);
    expect(pickOn(g, straightDown(ground), 0.3, false)).toEqual({ k: "seg", id: under });
    const hit = deckOn(g.net, ray, 2)!;
    expect(hit.id).toBe(deck);
    expect(hit.h).toBeCloseTo(LEVEL_H, 3);
    expect(hit.p.x).toBeCloseTo(X, 3);
    expect(hit.p.y).toBeCloseTo(Y, 3);
    expect(pickOn(g, ray, 0.3, false)).toEqual({ k: "seg", id: deck });
  });

  it("the road tool is offered both heights there, the higher first", () => {
    const ray = sightThrough({ x: X, y: Y }, LEVEL_H, 58 * DEG, Math.PI / 2);
    const hs = heightsOn(g.net, ray, 2);
    expect(hs).toHaveLength(2);
    expect(hs[0]).toBeCloseTo(LEVEL_H, 3);
    expect(hs[1]).toBeCloseTo(0, 3);
    // out on the open ground there is only the ground
    expect(heightsOn(g.net, straightDown({ x: X + 60, y: Y + 60 }), 2)).toEqual([]);
  });

  it("the end of the bridge is found up there", () => {
    const end = { x: X, y: Y + 100 };
    const hs = heightsOn(g.net, sightThrough(end, LEVEL_H, 40 * DEG, 0.5), 2);
    expect(hs[0]).toBeCloseTo(LEVEL_H, 3);
  });
});
