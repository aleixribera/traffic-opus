import { describe, it, expect } from "vitest";
import { ROAD_TYPES, ROAD_ORDER, isHighway } from "../src/config";
import { MILESTONES } from "../src/game/progression";

describe("Road types", () => {
  it("a one-lane highway exists alongside the one-lane town one-way, and only highways count as highways", () => {
    const hw1 = ROAD_TYPES.hw1, one1 = ROAD_TYPES.one1;
    expect(hw1.fwd).toBe(1);
    expect(hw1.bwd).toBe(0);
    expect(isHighway(hw1)).toBe(true);
    expect(isHighway(one1)).toBe(false); // the small one-way is a town street: drawn white, buildings face it
    expect(one1.allowsAccess).toBe(true);
    expect(hw1.allowsAccess).toBe(false);
    expect(hw1.speed).toBeGreaterThan(one1.speed);
    // highways are the one-way carriageways; boulevards (no driveways, but two-way) are not
    expect(ROAD_ORDER.filter((id) => isHighway(ROAD_TYPES[id]))).toEqual(["hw1", "hw2", "one3", "one4"]);
    expect(ROAD_ORDER).toContain("hw1");
  });

  it("the one-lane highway is available from the start, like the motorway it links to", () => {
    expect(MILESTONES[0].roads).toContain("hw1");
    expect(MILESTONES[0].roads).toContain("hw2");
  });
});
