import { describe, it, expect } from "vitest";
import { stuckSpots } from "../src/ui/stuckAlerts";

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
