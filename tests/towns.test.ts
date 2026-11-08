import { describe, expect, it } from "vitest";
import { TOWN_SIZES, sizeOf, needsOf, demandPerDay, supplyShare, growthPerDay, townRadius, gridPt, edgeKey, nextEdge, SEED_EDGES, BLOCK, type GridEdge } from "../src/game/towns";

describe("town sizes and needs", () => {
  it("names the size for a population and adds needs as it grows", () => {
    expect(TOWN_SIZES[sizeOf(0)].name).toBe("Hamlet");
    expect(TOWN_SIZES[sizeOf(299)].name).toBe("Hamlet");
    expect(TOWN_SIZES[sizeOf(300)].name).toBe("Village");
    expect(TOWN_SIZES[sizeOf(7000)].name).toBe("City");
    expect(needsOf(100)).toEqual(["food"]);
    expect(needsOf(400)).toEqual(["food", "planks"]);
  });

  it("a Town adds household goods and fuel, a few dozen loads a day each to start", () => {
    expect(needsOf(1499)).toEqual(["food", "planks", "cement"]);
    expect(needsOf(1500)).toEqual(["food", "planks", "cement", "goods", "fuel"]);
    for (const p of ["goods", "fuel"] as const) {
      expect(demandPerDay(p, 1500)).toBeGreaterThan(40);
      expect(demandPerDay(p, 1500)).toBeLessThan(100);
      // lighter per resident than the staples
      expect(demandPerDay(p, 1500)).toBeLessThan(demandPerDay("planks", 1500));
    }
    expect(needsOf(5999)).toEqual(needsOf(1500));
  });

  it("a City adds electronics and machinery, a couple of hundred loads a day each, lighter per head than goods; a Metropolis adds nothing yet", () => {
    expect(needsOf(6000)).toEqual([...needsOf(1500), "electronics", "machinery"]);
    for (const p of ["electronics", "machinery"] as const) {
      expect(demandPerDay(p, 6000)).toBeGreaterThan(100);
      expect(demandPerDay(p, 6000)).toBeLessThan(400);
      expect(demandPerDay(p, 6000)).toBeLessThan(demandPerDay("goods", 6000));
    }
    expect(needsOf(25000)).toEqual(needsOf(6000));
    expect(supplyShare({}, 6000).electronics).toBe(0);
  });

  it("demand per resident climbs with each size, so the total climbs faster than the population", () => {
    const perHead = (pop: number) => demandPerDay("food", pop) / pop;
    expect(perHead(500)).toBeGreaterThan(perHead(250));
    expect(perHead(2000)).toBeGreaterThan(perHead(1000));
    expect(perHead(8000)).toBeGreaterThan(perHead(4000));
    // a city wants far more than 20x what a village does, with 20x the people
    expect(demandPerDay("food", 6000)).toBeGreaterThan(20 * demandPerDay("food", 300) * 1.5);
    expect(demandPerDay("food", 4)).toBe(1); // (never less than a load a day)
  });

  it("supply is the share of each need delivered, capped at 1", () => {
    const pop = 400;
    const s = supplyShare({ food: demandPerDay("food", pop) / 2, planks: 999 }, pop);
    expect(s.food).toBeCloseTo(0.5, 6);
    expect(s.planks).toBe(1);
    expect(supplyShare({}, 100)).toEqual({ food: 0 });
  });

  it("a supplied town grows, an unsupplied one shrinks, and a new one fills its first streets regardless", () => {
    expect(growthPerDay({ food: 0 }, 20)).toBeGreaterThan(0);
    expect(growthPerDay({ food: 1 }, 500)).toBeGreaterThan(growthPerDay({ food: 0.6 }, 500));
    expect(growthPerDay({ food: 0.3 }, 500)).toBe(0);
    expect(growthPerDay({ food: 0 }, 500)).toBeLessThan(0);
    // the worst-supplied need decides
    expect(growthPerDay({ food: 1, planks: 0 }, 500)).toBeLessThan(0);
  });

  it("the street radius grows with population, within a cap", () => {
    expect(townRadius(0)).toBeGreaterThan(BLOCK);
    expect(townRadius(5000)).toBeGreaterThan(townRadius(500));
    expect(townRadius(1e7)).toBe(1600);
  });
});

describe("town street grid", () => {
  it("turns grid nodes about the centre", () => {
    const p = gridPt({ x: 100, y: 50 }, Math.PI / 2, 1, 0);
    expect(p.x).toBeCloseTo(100, 6);
    expect(p.y).toBeCloseTo(50 + BLOCK, 6);
  });

  it("names an edge the same whichever way round it is given", () => {
    expect(edgeKey([0, 0, 1, 0])).toBe(edgeKey([1, 0, 0, 0]));
  });

  it("grows from the seed cross block by block, in a rough circle, skipping streets that failed", () => {
    const built = new Set(SEED_EDGES.map(edgeKey));
    const failed = new Set<string>();
    const noJitter = () => 0;
    // the first new street touches the cross
    const e = nextEdge(built, failed, 3, noJitter)!;
    const touches = (g: GridEdge) => [`${g[0]},${g[1]}`, `${g[2]},${g[3]}`].some((n) => [...built].some((k) => k.split("|").includes(n)));
    expect(touches(e)).toBe(true);
    // keep growing: every street stays inside the radius and joins the network
    for (let i = 0; i < 60; i++) {
      const g = nextEdge(built, failed, 3, noJitter);
      if (!g) break;
      expect(touches(g)).toBe(true);
      expect(Math.hypot(g[2], g[3])).toBeLessThanOrEqual(3);
      expect(Math.hypot(g[0], g[1])).toBeLessThanOrEqual(3);
      built.add(edgeKey(g));
    }
    expect(nextEdge(built, failed, 3, noJitter)).toBeNull();
    // the inner blocks are closed: all four sides of the block at (0,0)-(1,1) exist
    for (const g of [[0, 0, 1, 0], [1, 0, 1, 1], [0, 1, 1, 1], [0, 0, 0, 1]] as GridEdge[]) expect(built.has(edgeKey(g))).toBe(true);
    // a street that failed is never offered again
    const b2 = new Set(SEED_EDGES.map(edgeKey));
    const first = nextEdge(b2, failed, 3, noJitter)!;
    failed.add(edgeKey(first));
    expect(edgeKey(nextEdge(b2, failed, 3, noJitter)!)).not.toBe(edgeKey(first));
  });

  it("prefers closing a block over pushing outward", () => {
    // an L of two streets: the next ones should finish the square before reaching out
    const built = new Set([[0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 1, 1]].map((g) => edgeKey(g as GridEdge)));
    const g = nextEdge(built, new Set(), 4, () => 0)!;
    expect(edgeKey(g)).toBe(edgeKey([0, 1, 1, 1]));
  });
});
