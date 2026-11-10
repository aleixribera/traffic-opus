import { describe, it, expect } from "vitest";
import { stuckSpots } from "../src/ui/stuckAlerts";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, stuckNow, type Vehicle } from "../src/sim/traffic";

// The stuck-traffic alert (src/ui/stuckAlerts.ts): cars that have stood still a long while are gathered into spots.

describe("Stuck traffic spots", () => {
  it("gathers cars standing close together into one spot, the longest standing first", () => {
    const spots = stuckSpots([
      { p: { x: 0, y: 0 }, t: 50 },
      { p: { x: 20, y: 10 }, t: 120 },
      { p: { x: 40, y: 0 }, t: 95 },
      { p: { x: 900, y: -400 }, t: 100 },
    ]);
    expect(spots).toHaveLength(2);
    expect(spots[0].worst).toBe(120);
    expect(spots[0].cars).toBe(3);
    expect(spots[0].c.x).toBeCloseTo(20, 5);
    expect(spots[1]).toEqual({ c: { x: 900, y: -400 }, worst: 100, cars: 1 });
  });

  it("no stuck cars, no spots", () => {
    expect(stuckSpots([])).toEqual([]);
  });
});

describe("What counts as stuck", () => {
  it("a car that stood a long while and is driving off again is not stuck any more (review 2026-11-10, B1)", () => {
    // (`stuck` runs down slower than it built up: before, a car that had stood five minutes still counted, alone on
    // an open road at full speed, as a stuck "place" of its own for minutes after its jam had cleared)
    const tr = new Traffic(new RoadNetwork(), { arrive: () => {}, fail: () => {} });
    const car = (id: number, stuck: number, v: number) => ({ id, stuck, v, x: id * 500, y: 0 }) as unknown as Vehicle;
    tr.vehicles.push(car(1, 300, 13.9), car(2, 300, 0), car(3, 300, 1.5), car(4, 20, 0));
    expect(tr.stuckCars(90).map((c) => c.p.x)).toEqual([1000, 1500]);
    expect(stuckNow(car(5, 300, 13.9), 90)).toBe(false);
  });
});
