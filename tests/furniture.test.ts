// The roadside furniture (render/furniture.ts): the telegraph line follows the country roads and billboards meet the
// traffic coming into a town, and none of it ever stands on a road, a driveway's lot, a works site or water, in a
// town street, or twice in one place; from far up it is not drawn at all.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { Game } from "../src/game/city";
import { townAt, townStreets } from "../src/game/rural";
import { Roads3D } from "../src/render/roads3d";
import { BOARD_CLEAR, Furniture3D, LOTS, Occupied, POLE_CLEAR, POLE_OFF, SPAN_MAX, placeFurniture, type Placed, type RoadLine } from "../src/render/furniture";
import type { MergedModel } from "../src/render/models";
import { ROAD_TYPES, isHighway, roadWidth } from "../src/config";
import { dist, makePolyline, polyClosest, rectCorners, rectDistance, type V2 } from "../src/core/math";
import { layRoad, road } from "./helpers";

/** A game's roads drawn with what the app gives the renderer (but the models), and what is built told to LOTS as
 * Buildings3D tells it. */
function render(g: Game) {
  LOTS.set("buildings", g.buildings.list.map((b) => rectCorners(b.c, b.hw, b.hd, b.rot)));
  const r = new Roads3D(g.net, {
    props: new Map(), isWater: (p) => g.terrain.isWater(p),
    drives: () => g.buildings.list.filter((b) => b.access).map((b): [V2, V2] => [b.front, b.c]),
    townStreets: () => townStreets(g.net, g.towns.list, g.buildings.list),
  });
  r.rebuildAll();
  return r;
}

/** The new map with a company's first country roads on it: out of its town to the four winds, and one across. */
function country(): Game {
  const g = new Game(7);
  g.start();
  g.money = 1e9;
  const c = g.towns.list[0].c, ends: V2[] = [];
  for (const [x, y] of [[1500, 260], [-1300, -420], [240, 1400], [-380, -1500]]) {
    const to = { x: c.x + x, y: c.y + y };
    if (typeof layRoad(g, c, to) !== "string") ends.push(to);
  }
  expect(ends.length).toBeGreaterThanOrEqual(2);
  layRoad(g, ends[0], ends[1]);
  return g;
}

/** Nothing of `f` stands on a road, a lot or water, or along a town street. */
function expectClear(g: Game, f: Placed) {
  const runs = townStreets(g.net, g.towns.list, g.buildings.list);
  const spots: { p: V2; r: number; what: string }[] = [
    ...f.poles.map((p, i) => ({ p: { x: p.x, y: p.y }, r: POLE_CLEAR, what: `pole ${i}` })),
    ...f.boards.flatMap((b, i) => [b, ...b.poly].map((p) => ({ p: { x: p.x, y: p.y }, r: BOARD_CLEAR, what: `billboard ${i}` }))),
  ];
  for (const { p, r, what } of spots) {
    expect(g.terrain.isWater(p), `${what} in the water`).toBe(false);
    for (const b of g.buildings.list) expect(rectDistance(p, b.c, b.hw, b.hd, b.rot), `${what} on the lot of ${b.kind} ${b.id}`).toBeGreaterThanOrEqual(r - 1e-6);
    for (const [id, s] of g.net.segs) {
      const sg = g.net.segGeom.get(id)!;
      if (p.x < sg.bbox.x0 - 30 || p.x > sg.bbox.x1 + 30 || p.y < sg.bbox.y0 - 30 || p.y > sg.bbox.y1 + 30) continue;
      // off the asphalt and its shoulder, of every road
      expect(polyClosest(sg.center, p).d, `${what} on road ${id}`).toBeGreaterThan(roadWidth(ROAD_TYPES[s.type]) / 2 + 0.9);
    }
  }
  for (const [i, p] of f.poles.entries()) {
    const s = g.net.segs.get(p.road)!, sg = g.net.segGeom.get(p.road)!;
    expect(isHighway(ROAD_TYPES[s.type]) || !!s.ring, `pole ${i} on a motorway or a roundabout`).toBe(false);
    expect(townAt(runs.get(p.road), p.s), `pole ${i} in a town street`).toBe(false);
    // on its own road's verge
    expect(polyClosest(sg.center, p).d, `pole ${i}`).toBeGreaterThan(sg.width / 2 + POLE_OFF - 0.5);
    expect(polyClosest(sg.center, p).d, `pole ${i}`).toBeLessThan(sg.width / 2 + POLE_OFF + 0.5);
  }
  for (const [i, sp] of f.spans.entries()) {
    const a = f.poles[sp.a], b = f.poles[sp.b];
    expect(a && b && sp.a !== sp.b, `span ${i}`).toBeTruthy();
    expect(dist(a, b), `span ${i}`).toBeLessThanOrEqual(SPAN_MAX);
    expect(dist(a, b), `span ${i}`).toBeGreaterThan(5);
  }
  // no two in one place, no wire strung twice
  for (let i = 0; i < f.poles.length; i++) for (let j = i + 1; j < f.poles.length; j++) expect(dist(f.poles[i], f.poles[j]), `poles ${i}, ${j}`).toBeGreaterThan(3);
  expect(new Set(f.spans.map((s) => Math.min(s.a, s.b) + ":" + Math.max(s.a, s.b))).size).toBe(f.spans.length);
  for (let i = 0; i < f.boards.length; i++) for (let j = i + 1; j < f.boards.length; j++) expect(dist(f.boards[i], f.boards[j]), `billboards ${i}, ${j}`).toBeGreaterThan(100);
}

describe("the roadside furniture on a new map", () => {
  const g = country();
  const r = render(g);

  it("strings the telegraph along the country roads and stands billboards on the way into the towns", () => {
    const f = r.furniture;
    expect(f.poles.length).toBeGreaterThan(40);
    // (a line, not posts: nearly every pole is wired to a neighbour)
    expect(f.spans.length).toBeGreaterThan(f.poles.length * 0.8);
    expect(f.boards.length).toBeGreaterThanOrEqual(1);
    expect(f.boards.length).toBeLessThanOrEqual(g.towns.list.length * 4);
    // each billboard by a town: within sight of one's edge
    for (const b of f.boards) expect(Math.min(...g.towns.list.map((t) => dist(t.c, b) - t.reach))).toBeLessThan(260);
  });

  it("never stands on a road, a lot or water, or in a town street", () => {
    expectClear(g, r.furniture);
  });

  it("is the same every time it is placed, and keeps off what is built later", () => {
    const again = render(g);
    expect(again.furniture).toEqual(r.furniture);
    // a road laid across the line: the poles in its way go, the rest stay where they were
    const mid = r.furniture.poles[r.furniture.poles.length >> 1];
    const sg = g.net.segGeom.get(mid.road)!;
    const c = polyClosest(sg.center, mid), n = { x: -mid.dy, y: mid.dx };
    const g2 = country();
    road(g2, { x: mid.x - mid.dx * 3 + n.x * 60, y: mid.y - mid.dy * 3 + n.y * 60 }, { x: mid.x - mid.dx * 3 - n.x * 60, y: mid.y - mid.dy * 3 - n.y * 60 }, "dirt");
    expect(c.d).toBeGreaterThan(0);
    const r2 = render(g2);
    expect(r2.furniture.poles.length).toBeGreaterThan(40);
    expectClear(g2, r2.furniture);
  });
});

describe("placing furniture along a road", () => {
  /** One straight country road of `len` m from (0, 0) east, its last `town` metres a town street. */
  const line = (len: number, town = 0, over: Partial<RoadLine> = {}): RoadLine => ({
    id: 1, a: 1, b: 2, center: makePolyline([{ x: 0, y: 0 }, { x: len / 2, y: 0 }, { x: len, y: 0 }]), hs: [0, 0, 0], halfW: 4,
    from: 6, to: len - 6, runs: town ? [[len - town, len]] : undefined, carries: true, pocketA: false, pocketB: false, ...over,
  });
  const at = (roads: RoadLine[]) => (node: number) => roads.filter((r) => r.a === node || r.b === node).map((r) => r.id);
  const open = () => true;

  it("stands a pole about every fifty metres down one side, each wired to the next", () => {
    const roads = [line(600)];
    const f = placeFurniture(roads, at(roads), open);
    expect(f.poles.length).toBeGreaterThanOrEqual(11);
    expect(f.poles.length).toBeLessThanOrEqual(14);
    expect(f.spans.length).toBe(f.poles.length - 1);
    expect(new Set(f.poles.map((p) => Math.sign(p.y))).size).toBe(1);
    for (const p of f.poles) expect(Math.abs(p.y)).toBeCloseTo(4 + POLE_OFF, 5);
    expect(f.boards.length).toBe(0);
  });

  it("stops the line where the town begins, and stands one billboard before it, facing the traffic coming in", () => {
    const roads = [line(600, 200)];
    const f = placeFurniture(roads, at(roads), open);
    for (const p of f.poles) expect(p.x).toBeLessThan(400);
    expect(f.boards.length).toBe(1);
    const b = f.boards[0];
    // before the town, on the right of the traffic driving in (east: the right is +y here), turned to face it
    expect(b.x).toBeGreaterThan(300);
    expect(b.x).toBeLessThan(400);
    expect(b.y).toBeGreaterThan(4 + 3);
    expect(b.fx).toBeLessThan(-0.5);
    expect(b.fy).toBeLessThan(0);
    for (const q of b.poly) expect(Math.abs(q.y)).toBeGreaterThan(4 + 2);
  });

  it("leaves a motorway, a bridge and taken ground alone", () => {
    for (const roads of [[line(600, 200, { carries: false })], [line(600, 200, { hs: [6, 6, 6] })]]) {
      const f = placeFurniture(roads, at(roads), open);
      expect(f.poles.length + f.boards.length).toBe(0);
    }
    const roads = [line(600, 200)];
    const f = placeFurniture(roads, at(roads), (x) => x < 100);
    expect(f.poles.length).toBeGreaterThan(0);
    for (const p of f.poles) expect(p.x).toBeLessThan(100);
    expect(f.boards.length).toBe(0);
  });

  it("carries the wire on round a corner to the next road's first pole", () => {
    const a = line(300);
    const b: RoadLine = { ...line(300), id: 2, a: 2, b: 3, center: makePolyline([{ x: 300, y: 0 }, { x: 300, y: 150 }, { x: 300, y: 300 }]) };
    const f = placeFurniture([a, b], at([a, b]), open);
    const cross = f.spans.filter((s) => f.poles[s.a].road !== f.poles[s.b].road);
    expect(cross.length).toBe(1);
    expect(f.spans.length).toBe(f.poles.length - 1);
  });
});

describe("ground that is taken", () => {
  it("is found within a reach of its shapes, whoever said so", () => {
    const o = new Occupied();
    expect(o.hit(0, 0, 5)).toBe(false);
    o.set("a", [rectCorners({ x: 100, y: 100 }, 10, 5, 0)], 1);
    const v = o.version;
    expect(o.hit(100, 100, 0)).toBe(true);
    expect(o.hit(111, 100, 0.5)).toBe(false);
    expect(o.hit(111, 100, 1.5)).toBe(true);
    expect(o.hit(100, 108, 2)).toBe(false);
    // the same again changes nothing; another's shapes are kept apart from it
    o.set("a", [rectCorners({ x: 100, y: 100 }, 10, 5, 0)], 1);
    expect(o.version).toBe(v);
    o.set("b", [rectCorners({ x: -300, y: 40 }, 4, 4, 0.6)]);
    expect(o.hit(-300, 40, 0)).toBe(true);
    o.set("a", [], 2);
    expect(o.hit(100, 100, 0)).toBe(false);
    expect(o.hit(-300, 40, 0)).toBe(true);
  });
});

describe("drawing the furniture", () => {
  it("draws none of it from far up, all of it close to", () => {
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const model = { geo, bays: [], fx: [] } as unknown as MergedModel;
    const f3 = new Furniture3D(new Map(["telegraphpole", "telegraphwire", "billboard_a", "billboard_b", "billboard_c"].map((n) => [n, model])));
    const roads: RoadLine[] = [{
      id: 1, a: 1, b: 2, center: makePolyline([{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 600, y: 0 }]), hs: [0, 0, 0], halfW: 4,
      from: 6, to: 594, runs: [[400, 600]], carries: true, pocketA: false, pocketB: false,
    }];
    const placed = placeFurniture(roads, () => [1], () => true);
    f3.show(placed);
    const meshes = f3.group.children as THREE.InstancedMesh[];
    expect(meshes.length).toBe(3);
    const counts = [placed.poles.length, placed.spans.length, 1];
    const view = (halfH: number) => {
      const cam = new THREE.OrthographicCamera(-halfH * 16 / 9, halfH * 16 / 9, halfH, -halfH, 1, 5000);
      const renderer = { getSize: (v: THREE.Vector2) => v.set(1600, 900) };
      for (const m of meshes) (m.onBeforeRender as unknown as (r: unknown, s: unknown, c: THREE.Camera) => void)(renderer, null, cam);
      return meshes.map((m) => m.count);
    };
    expect(view(40)).toEqual(counts);
    // (the whole map on screen: nothing of it is sent to be drawn)
    expect(view(1200)).toEqual([0, 0, 0]);
    // wires go first, then the poles, the billboards last
    expect(view(160)).toEqual([counts[0], 0, counts[2]]);
    expect(view(400)).toEqual([0, 0, counts[2]]);
    expect(view(40)).toEqual(counts);
  });
});
