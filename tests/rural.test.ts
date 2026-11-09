// Town streets and country roads (owner, 2026-11-09: "feel real"): roads out in the fields lose their kerbs,
// pavements, lamps and street trees; a town's streets keep them. Which stretch of a road is which comes from the map.
import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { straightCubic, v2, type V2 } from "../src/core/math";
import { runsDiffer, townAt, townRuns, townStreets, type Frontage, type TownLand } from "../src/game/rural";
import type { BuildingKind } from "../src/config";

/** One straight street from a to b (laid by `town` if given); its id. */
function one(a: V2, b: V2, town?: number) {
  const net = new RoadNetwork();
  net.begin();
  const A = net.addNode(a, 0), B = net.addNode(b, 0);
  const id = net.addSeg(A, B, "street", straightCubic(a, b), 0, town);
  net.commit();
  net.rebuild();
  return { net, id, len: net.segGeom.get(id)!.center.length };
}
const front = (seg: number, s: number, kind: BuildingKind, zone?: string, hw = 6): Frontage => ({ access: { seg, s }, zone, kind, hw });

describe("town streets and country roads", () => {
  it("a lone road out in the country is country all along", () => {
    const { net, id } = one(v2(3000, 0), v2(3400, 0));
    const towns: TownLand[] = [{ id: 1, c: v2(0, 0), reach: 300 }];
    expect(townStreets(net, towns, []).get(id)).toBeUndefined();
    expect(townStreets(net, [], []).size).toBe(0);
  });

  it("a street a town laid on its own land is a town street end to end", () => {
    const { net, id, len } = one(v2(-100, 0), v2(100, 40), 1);
    const runs = townStreets(net, [{ id: 1, c: v2(0, 0), reach: 300 }], []).get(id);
    expect(runs).toEqual([[0, len]]);
  });

  it("homes facing a road make it a street in front of them, and a little past", () => {
    const { net, id, len } = one(v2(2000, 0), v2(2400, 0));
    expect(len).toBeCloseTo(400, 0);
    const homes = [front(id, 150, "house", "res"), front(id, 166, "house", "res"), front(id, 182, "terrace", "res", 12)];
    const runs = townStreets(net, [], homes).get(id)!;
    expect(runs).toHaveLength(1);
    const [a, b] = runs[0];
    // from the first house's front (less half its width, less the pavement's run-on) to the last one's
    expect(a).toBeGreaterThan(130);
    expect(a).toBeLessThanOrEqual(150 - 6);
    expect(b).toBeGreaterThanOrEqual(182 + 12);
    expect(b).toBeLessThan(215);
    expect(townAt(runs, 160)).toBe(true);
    expect(townAt(runs, 50)).toBe(false);
    expect(townAt(runs, 350)).toBe(false);
    // a town hall counts too, zoned or not
    expect(townStreets(net, [], [front(id, 300, "hamlethall")]).get(id)).toBeDefined();
  });

  it("a company's works on a road leave it a country road", () => {
    const { net, id } = one(v2(2000, 0), v2(2400, 0));
    const works = [front(id, 200, "farm", undefined, 145), front(id, 60, "sawmill"), front(id, 330, "loggingcamp")];
    expect(townStreets(net, [], works).get(id)).toBeUndefined();
  });

  it("a long road through a town is a town street only where it runs through it", () => {
    const { net, id, len } = one(v2(-1000, 0), v2(1000, 0));
    const runs = townStreets(net, [{ id: 1, c: v2(0, 0), reach: 300 }], []).get(id)!;
    expect(runs).toHaveLength(1);
    const [a, b] = runs[0];
    expect(a).toBeGreaterThan(690);
    expect(a).toBeLessThan(705);
    expect(b).toBeGreaterThan(1295);
    expect(b).toBeLessThan(1310);
    expect(townAt(runs, len / 2)).toBe(true);
    expect(townAt(runs, 100)).toBe(false);
    expect(townAt(runs, len - 100)).toBe(false);
  });

  it("a town's own road out of town stops being a street a little past the edge of its land", () => {
    // laid by the town (its outward road), but it runs on 1 km into the fields
    const { net, id } = one(v2(0, 0), v2(1300, 0), 1);
    const runs = townStreets(net, [{ id: 1, c: v2(0, 0), reach: 300 }], []).get(id)!;
    expect(runs).toHaveLength(1);
    expect(runs[0][0]).toBe(0);
    expect(runs[0][1]).toBeGreaterThan(300);
    expect(runs[0][1]).toBeLessThan(300 + 48 + 6);
    // and another town's land is not its own: on that town's land it is a street only within the plain reach
    const other = townStreets(net, [{ id: 2, c: v2(0, 0), reach: 300 }], []).get(id)!;
    expect(other[0][1]).toBeLessThan(310);
  });

  it("stretches that nearly meet join, and one that nearly reaches an end runs on to it", () => {
    const near = townRuns(200, (s) => s > 15 && s < 80);
    expect(near).toHaveLength(1);
    expect(near[0][0]).toBe(0);
    expect(Math.abs(near[0][1] - 80)).toBeLessThan(4);
    const two = townRuns(400, (s) => (s > 100 && s < 150) || (s > 170 && s < 220));
    expect(two).toHaveLength(1);
    const apart = townRuns(400, (s) => (s > 100 && s < 150) || (s > 250 && s < 300));
    expect(apart).toHaveLength(2);
    expect(townRuns(400, () => false)).toEqual([]);
    expect(townRuns(400, () => false, [[-20, 30]])).toEqual([[0, 30]]);
  });

  it("only a real change counts as one (so the look rebuilds only the roads that flipped)", () => {
    expect(runsDiffer(undefined, undefined)).toBe(false);
    expect(runsDiffer([[0, 10]], undefined)).toBe(true);
    expect(runsDiffer([[0, 10]], [[0, 10.2]])).toBe(false);
    expect(runsDiffer([[0, 10]], [[0, 12]])).toBe(true);
    expect(runsDiffer([[0, 10]], [[0, 10], [20, 30]])).toBe(true);
  });
});
