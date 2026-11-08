import { describe, expect, it } from "vitest";
import {
  TOWN_SIZES, sizeOf, needsOf, demandPerDay, supplyShare, growthPerDay, townRadius, gridPt, edgeKey, nextEdge, SEED_EDGES, BLOCK, nuisanceAt, type GridEdge,
  SUPPLY_HOURS, SUPPLY_COVER, SUPPLY_WARMUP, CROSS, averageSupply, supportOf, supportedPop,
} from "../src/game/towns";

describe("town sizes and needs", () => {
  it("names the size for a population and adds needs as it grows", () => {
    expect(TOWN_SIZES[sizeOf(0)].name).toBe("Hamlet");
    expect(TOWN_SIZES[sizeOf(299)].name).toBe("Hamlet");
    expect(TOWN_SIZES[sizeOf(300)].name).toBe("Village");
    expect(TOWN_SIZES[sizeOf(7000)].name).toBe("City");
    expect(needsOf(99)).toEqual(["food"]);
    // (a hamlet starts building in timber at 100 people, before it is a village)
    expect(needsOf(100)).toEqual(["food", "planks"]);
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
    expect(supplyShare({}, 99)).toEqual({ food: 0 });
  });

  it("a town's supply is two days' deliveries averaged, and a first truckload alone isn't one", () => {
    // a steady 10 loads a day, an hour at a time
    const steady = Array.from({ length: 60 }, () => ({ food: 10 / 24 }));
    expect(averageSupply(steady).food).toBeCloseTo(10, 6);
    // (only the last SUPPLY_HOURS count: a burst three days ago is gone)
    expect(averageSupply([{ food: 500 }, ...steady.slice(0, SUPPLY_HOURS)]).food).toBeCloseTo(10, 6);
    // a day without any halves it, rather than emptying it
    expect(averageSupply([...steady.slice(0, 24), ...Array.from({ length: 24 }, () => ({}))]).food).toBeCloseTo(5, 6);
    // a new town's one truckload in its first hour counts over SUPPLY_WARMUP hours, not as a day's worth an hour
    expect(averageSupply([{ food: 4 }]).food).toBeCloseTo((4 * 24) / SUPPLY_WARMUP, 6);
    // a supply that has just begun goes on the hours since its first load (the empty hours before it don't count)
    expect(averageSupply([...Array.from({ length: 20 }, () => ({})), ...steady.slice(0, 16)]).food).toBeCloseTo(10, 6);
  });

  it("a supply supports the people it covers with a margin, each size using more a head", () => {
    // 25 food a day: a hamlet's worth at 1/8 a head, less the margin
    expect(supportedPop("food", 25)).toBe(Math.floor((25 / SUPPLY_COVER) * 8));
    expect(demandPerDay("food", supportedPop("food", 25)) * SUPPLY_COVER).toBeLessThanOrEqual(25 + 1e-9);
    // 28 doesn't reach the Village line (300); 40 would feed 400 hamlet-folk, but a village eats 1.6x a head: it
    // carries the town just over the line (CROSS) and no further until the supply covers a village's appetite
    expect(supportedPop("food", 28)).toBe(280);
    expect(supportedPop("food", 40)).toBe(Math.ceil(300 * CROSS));
    const v = demandPerDay("food", 300) * SUPPLY_COVER;
    expect(supportedPop("food", v * 0.98)).toBe(Math.ceil(300 * CROSS));
    expect(supportedPop("food", v * 1.5)).toBe(Math.floor((v * 1.5) / SUPPLY_COVER / (demandPerDay("food", 300) / 300)));
    for (let s = 1; s < 4000; s += 37) expect(supportedPop("food", s)).toBeGreaterThanOrEqual(supportedPop("food", s - 1));
  });

  it("the worst-supplied need sets what a town supports; a need short at its opening holds it, never shrinks it", () => {
    const S = supportOf({ food: 100, planks: 30 }, 250);
    expect(S.by).toBe("planks");
    expect(S.pop).toBe(supportedPop("planks", 30));
    // a hamlet's planks (a need opened ahead of its size) hold it back but never shrink it; its food still does
    const h = supportOf({ food: 100 }, 150);
    expect(h.pop).toBe(0);
    expect(h.by).toBe("planks");
    expect(h.floor).toBe(supportedPop("food", 100));
    expect(supportOf({ food: 5, planks: 100 }, 150).floor).toBe(supportedPop("food", 5));
    // goods and fuel don't hold a village back before it can buy them; once a Town, short of them, it holds
    expect(supportOf({ food: 1e4, planks: 1e4, cement: 1e4 }, 1400).pop).toBeGreaterThan(1500);
    const town = supportOf({ food: 1e4, planks: 1e4, cement: 1e4 }, 1520);
    expect(town.pop).toBe(0);
    expect(town.floor).toBe(1500);
    // the pace well supplied: fast while small, slower as it grows
    expect(growthPerDay(50) / 50).toBeGreaterThan(growthPerDay(1000) / 1000);
    expect(growthPerDay(1000) / 1000).toBeGreaterThan(growthPerDay(8000) / 8000);
  });

  it("the street radius grows with population, within a cap", () => {
    expect(townRadius(0)).toBeGreaterThan(BLOCK);
    expect(townRadius(5000)).toBeGreaterThan(townRadius(500));
    expect(townRadius(1e7)).toBe(2200);
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

  it("a plant's smoke and noise fade from its fence to its reach", () => {
    const o = [{ c: { x: 0, y: 0 }, hw: 50, hd: 30, rot: 0, reach: 200 }];
    expect(nuisanceAt({ x: 40, y: 0 }, o)).toBe(1);
    expect(nuisanceAt({ x: 150, y: 0 }, o)).toBeCloseTo(0.5, 5);
    expect(nuisanceAt({ x: 0, y: 230 }, o)).toBe(0);
  });

  it("goes round land that puts the town off, and never onto land it won't build on", () => {
    // the east (i > 1) is out of bounds; the town spreads every other way
    const built = new Set(SEED_EDGES.map(edgeKey));
    const cost = (g: GridEdge) => (Math.max(g[0], g[2]) > 1 ? Infinity : 0);
    for (let i = 0; i < 60; i++) {
      const g = nextEdge(built, new Set(), 4, () => 0, cost);
      if (!g) break;
      expect(Math.max(g[0], g[2])).toBeLessThanOrEqual(1);
      built.add(edgeKey(g));
    }
    expect(built.size).toBeGreaterThan(20);
  });

  it("prefers closing a block over pushing outward", () => {
    // an L of two streets: the next ones should finish the square before reaching out
    const built = new Set([[0, 0, 1, 0], [0, 0, 0, 1], [1, 0, 1, 1]].map((g) => edgeKey(g as GridEdge)));
    const g = nextEdge(built, new Set(), 4, () => 0)!;
    expect(edgeKey(g)).toBe(edgeKey([0, 1, 1, 1]));
  });
});
