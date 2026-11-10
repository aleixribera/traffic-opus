import { describe, expect, it } from "vitest";
import { STAGES, buildTime, deliveredShare, stageAt, stageOf } from "../src/game/construction";
import { HOUR } from "../src/game/society";
import type { Building } from "../src/game/buildings";

const bld = (o: Partial<Building>): Building => ({ kind: "house", built: 0, ...o }) as Building;

describe("construction stages", () => {
  it("goes staked, slab, frame, walls, roof, done in order as the build goes on", () => {
    let last = -1;
    const seen: string[] = [];
    for (let p = 0; p <= 1.0001; p += 0.01) {
      const s = stageAt(Math.min(1, p));
      const i = STAGES.indexOf(s.stage);
      expect(i).toBeGreaterThanOrEqual(last);
      expect(s.k).toBeGreaterThanOrEqual(0);
      expect(s.k).toBeLessThanOrEqual(1);
      if (i !== last) seen.push(s.stage);
      last = i;
    }
    expect(seen).toEqual(["staked", "slab", "frame", "walls", "roof", "done"]);
  });

  it("k runs from 0 to 1 within each step", () => {
    expect(stageAt(0.25).stage).toBe("frame");
    expect(stageAt(0.25).k).toBeCloseTo(0);
    expect(stageAt(0.4999).k).toBeGreaterThan(0.99);
    expect(stageAt(0.999).stage).toBe("roof");
    expect(stageAt(0.999).k).toBeGreaterThan(0.99);
  });

  it("a site waiting for materials stays staked, its piles growing with what has come in", () => {
    const b = bld({ kind: "apartments", site: { need: { planks: 4, cement: 4 }, got: { planks: 4, cement: 0 } } });
    expect(deliveredShare(b.site)).toBeCloseTo(0.5);
    const s = stageOf(b);
    expect(s.stage).toBe("staked");
    expect(s.got).toBeCloseTo(0.5);
    // (more than it needs counts as no more than it needs)
    expect(deliveredShare({ need: { planks: 2, steel: 2 }, got: { planks: 9 } })).toBeCloseTo(0.5);
    // every load in but the site not yet started: still staked, never past it
    expect(stageOf(bld({ site: { need: { planks: 2 }, got: { planks: 2 } } })).stage).toBe("staked");
  });

  it("a works waiting for its materials is staked too; once they're in it goes up by its progress", () => {
    const w = bld({ kind: "sawmill", built: 0, plant: { site: { need: { planks: 30 }, got: { planks: 15 } } } as Building["plant"] });
    expect(stageOf(w).stage).toBe("staked");
    expect(stageOf({ ...w, plant: { ...w.plant!, site: undefined }, built: 0.6 }).stage).toBe("walls");
  });

  it("bigger buildings take longer; a house goes up in an afternoon, a tower over a day", () => {
    expect(buildTime("house")).toBe(3 * HOUR);
    expect(buildTime("terrace")).toBeGreaterThan(buildTime("house"));
    expect(buildTime("apartments")).toBeGreaterThan(buildTime("terrace"));
    expect(buildTime("aptower")).toBeGreaterThan(buildTime("apartments"));
    expect(buildTime("aptower")).toBeGreaterThanOrEqual(12 * HOUR);
    // a first-tier works in a couple of hours, deeper ones longer
    expect(buildTime("farm")).toBe(2 * HOUR);
    expect(buildTime("smelter")).toBeGreaterThan(buildTime("farm"));
    expect(buildTime("motorworks")).toBeGreaterThan(buildTime("smelter"));
    // (every kind has a time)
    for (const k of ["house", "highstreet", "shop", "store", "office", "mall", "tower", "glasstower", "fuelstation", "hamlethall", "cityhall", "warehouse"] as const)
      expect(buildTime(k)).toBeGreaterThan(HOUR);
  });
});
