import { describe, it, expect } from "vitest";
import { ROAD_TYPES, isHighway, type RoadTypeId } from "../src/config";
import { BASE } from "../src/game/progression";

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
    expect((Object.keys(ROAD_TYPES) as RoadTypeId[]).filter((id) => isHighway(ROAD_TYPES[id])).sort()).toEqual(["hw1", "hw2", "one3", "one4"]);
  });

  it("the one-lane highway is available from the start, like the motorway it links to", () => {
    expect(BASE.roads).toContain("hw1");
    expect(BASE.roads).toContain("hw2");
  });
});
