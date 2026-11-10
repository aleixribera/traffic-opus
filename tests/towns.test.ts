import { describe, expect, it } from "vitest";
import {
  TOWN_SIZES, sizeOf, needsOf, demandPerDay, supplyShare, growthPerDay, townRadius, gridPt, edgeKey, nextEdge, SEED_EDGES, BLOCK, nuisanceAt, type GridEdge,
  SUPPLY_HOURS, SUPPLY_COVER, SUPPLY_WARMUP, GROW_FROM, HOLD_FROM, PER_HOME, averageSupply, supportOf, supportedPop, growthShare, growthBand, growthLine,
  supplyLevel, extrasOf,
} from "../src/game/towns";
import type { Product } from "../src/game/industry";

/** Every load a day a town of this population wants of its needs. */
const total = (pop: number) => needsOf(pop).reduce((a, p) => a + demandPerDay(p, pop), 0);
/** Loads a day of the needs a size added, at a population. */
const group = (size: number, pop: number) => TOWN_SIZES[size].adds.reduce((a, p) => a + (needsOf(pop).includes(p) ? demandPerDay(p, pop) : 0), 0);

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
    expect(needsOf(1499)).toEqual(["food", "planks", "cement"]);
    expect(needsOf(1500)).toEqual(["food", "planks", "cement", "goods", "fuel"]);
    expect(needsOf(5999)).toEqual(needsOf(1500));
    expect(needsOf(6000)).toEqual([...needsOf(1500), "electronics", "machinery"]);
    expect(needsOf(25000)).toEqual(needsOf(6000));
    expect(supplyShare({}, 6000).electronics).toBe(0);
  });

  it("food: a Village of 300 wants under 20 loads a day, a Town of 1,500 40 to 60, a City of 6,000 100 to 150", () => {
    expect(demandPerDay("food", 300)).toBeLessThan(20);
    expect(demandPerDay("food", 300)).toBeGreaterThanOrEqual(12);
    expect(demandPerDay("food", 1500)).toBeGreaterThanOrEqual(40);
    expect(demandPerDay("food", 1500)).toBeLessThanOrEqual(60);
    expect(demandPerDay("food", 6000)).toBeGreaterThanOrEqual(100);
    expect(demandPerDay("food", 6000)).toBeLessThanOrEqual(150);
    expect(demandPerDay("food", 4)).toBe(1); // (never less than a load a day)
  });

  it("an old staple gets lighter a head at every size after its own, though it still climbs a little", () => {
    const head = (p: Product, pop: number) => demandPerDay(p, pop) / pop;
    const after: [Product, number][] = [["food", 300], ["planks", 1500], ["cement", 1500], ["goods", 6000], ["fuel", 6000], ["electronics", 20000], ["machinery", 20000]];
    for (const [p, line] of after) {
      for (let pop = line; pop < 80000; pop *= 1.3) {
        expect(head(p, pop * 1.3), `${p} at ${Math.round(pop)}`).toBeLessThan(head(p, pop));
        expect(demandPerDay(p, pop * 1.3), `${p} at ${Math.round(pop)}`).toBeGreaterThan(demandPerDay(p, pop));
      }
    }
    // never heavier a head than in the size that opened it, and no jump over a size line
    for (const p of ["food", "planks", "cement", "goods", "fuel"] as Product[]) {
      for (const line of [300, 1500, 6000, 20000]) expect(demandPerDay(p, line) / demandPerDay(p, line - 1)).toBeLessThan(1.01);
    }
    // the old 1.6x a size is gone: a City of 6,000 wants about five or six times the food of a Village of 300, not 50
    expect(demandPerDay("food", 6000) / demandPerDay("food", 300)).toBeLessThan(7);
    expect(demandPerDay("planks", 15000) / demandPerDay("planks", 1500)).toBeLessThan(3);
  });

  it("each size's new needs start small and grow into the big ask of that size", () => {
    // a Town's goods and fuel: a handful of loads a day as it opens, about a hundred by City size
    for (const p of ["goods", "fuel"] as const) {
      expect(demandPerDay(p, 1500)).toBeLessThan(15);
      expect(demandPerDay(p, 5999)).toBeGreaterThan(80);
    }
    // a City's electronics and machinery: a few dozen to start, hundreds by a Metropolis
    for (const p of ["electronics", "machinery"] as const) {
      expect(demandPerDay(p, 6000)).toBeLessThan(40);
      expect(demandPerDay(p, 19999)).toBeGreaterThan(200);
    }
    for (let s = 1; s <= 3; s++) {
      const lo = TOWN_SIZES[s].pop, hi = TOWN_SIZES[s + 1].pop, mid = Math.sqrt(lo * hi);
      // from halfway through the size (in people, multiplied) to its end, its own needs add more loads than all the
      // older ones together
      const own = group(s, hi - 1) - group(s, mid);
      let old = 0;
      for (let k = 0; k < s; k++) old += group(k, hi - 1) - group(k, mid);
      expect(own, TOWN_SIZES[s].name).toBeGreaterThan(old);
      // and by its end they are the biggest group of loads it wants
      for (let k = 0; k < s; k++) expect(group(s, hi - 1), `${TOWN_SIZES[s].name} against ${TOWN_SIZES[k].name}`).toBeGreaterThan(group(k, hi - 1));
    }
    // a Town's newest need alone outweighs its food by the time it is a City
    expect(demandPerDay("goods", 5999)).toBeGreaterThan(demandPerDay("food", 5999));
  });

  it("a town's loads a day in all grow slower than its people", () => {
    const pops = [300, 1500, 6000, 15000, 40000];
    for (let i = 1; i < pops.length; i++) expect(total(pops[i]) / pops[i], `${pops[i]}`).toBeLessThan(total(pops[i - 1]) / pops[i - 1]);
    // and well under the old curve: a City of 6,000 wants under 500 loads a day of everything (it was over 3,000 of
    // food alone)
    expect(total(300)).toBeLessThan(30);
    expect(total(6000)).toBeLessThan(500);
  });

  it("the extras follow the same curve: a little milk from a Village, cars from a Town", () => {
    expect(extrasOf(300)).toEqual(["milk", "cheese"]);
    expect(demandPerDay("milk", 300)).toBeLessThan(demandPerDay("food", 300));
    expect(demandPerDay("cars", 1500)).toBeLessThan(10);
    expect(demandPerDay("cars", 6000) / 6000).toBeGreaterThan(demandPerDay("cars", 20000) / 20000);
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

  it("a supply supports the people whose use it covers GROW_FROM of, straight over the size lines", () => {
    expect(SUPPLY_COVER).toBe(GROW_FROM);
    for (const p of ["food", "planks", "cement", "goods", "electronics"] as Product[]) {
      for (let s = 2; s < 600; s *= 1.17) {
        const x = supportedPop(p, s);
        // the most people it covers: just so, and one more is too many
        if (x >= 50) {
          expect(demandPerDay(p, x) * GROW_FROM, `${p} ${s}`).toBeLessThanOrEqual(s + 1e-6);
          expect(demandPerDay(p, x + 1) * GROW_FROM, `${p} ${s}`).toBeGreaterThan(s - 1e-6);
        }
        expect(supportedPop(p, s * 1.17)).toBeGreaterThanOrEqual(x);
      }
    }
    // 18 food a day carries a hamlet to 255 (it covers 85% of 300 people's 18)... and on over the Village line with no
    // step: a village eats no more a head than a hamlet
    expect(supportedPop("food", 18 * GROW_FROM)).toBe(300);
    expect(supportedPop("food", 18)).toBeGreaterThan(300);
    // the floor a shortfall shrinks it to is where it covers HOLD_FROM
    expect(supportedPop("food", 18 * HOLD_FROM, HOLD_FROM)).toBe(300);
  });

  it("the worst-supplied need sets what a town supports; a need short at its opening holds it, never shrinks it", () => {
    const S = supportOf({ food: 100, planks: 3 }, 250);
    expect(S.by).toBe("planks");
    expect(S.pop).toBe(supportedPop("planks", 3));
    // a hamlet's planks (a need opened ahead of its size) hold it back but never shrink it; its food still does
    const h = supportOf({ food: 100 }, 150);
    expect(h.pop).toBe(0);
    expect(h.by).toBe("planks");
    expect(h.floor).toBe(supportedPop("food", 100, HOLD_FROM));
    expect(supportOf({ food: 5, planks: 100 }, 150).floor).toBe(supportedPop("food", 5, HOLD_FROM));
    // goods and fuel don't hold a village back before it can buy them; once a Town, short of them, it holds
    expect(supportOf({ food: 1e4, planks: 1e4, cement: 1e4 }, 1400).pop).toBeGreaterThan(1500);
    const town = supportOf({ food: 1e4, planks: 1e4, cement: 1e4 }, 1520);
    expect(town.pop).toBe(0);
    expect(town.floor).toBe(1500);
    // its supply level is its worst-supplied need's share
    const L = supplyLevel({ food: demandPerDay("food", 400) * 1.2, planks: demandPerDay("planks", 400) * 0.7 }, 400);
    expect(L.by).toBe("planks");
    expect(L.level).toBeCloseTo(0.7, 6);
    expect(supplyLevel({ food: 99 }, 400, (p) => p === "food").level).toBeGreaterThan(1);
  });
});

describe("growth in bands", () => {
  it("grows from GROW_FROM, very little at first, all of it from 100%; holds from HOLD_FROM; shrinks below", () => {
    expect(GROW_FROM).toBeCloseTo(0.85, 6);
    expect(HOLD_FROM).toBeCloseTo(0.6, 6);
    expect(growthShare(0.5)).toBe(0);
    expect(growthShare(0.72)).toBe(0);
    expect(growthShare(GROW_FROM)).toBe(0);
    expect(growthShare(0.87)).toBeLessThan(0.02);
    expect(growthShare(0.9)).toBeCloseTo(1 / 9, 6);
    expect(growthShare(1)).toBe(1);
    expect(growthShare(1.8)).toBe(1);
    // rising smoothly all the way
    for (let x = GROW_FROM; x < 1; x += 0.01) expect(growthShare(x + 0.01)).toBeGreaterThanOrEqual(growthShare(x));
    expect(growthBand(1.2)).toBe("full");
    expect(growthBand(0.9)).toBe("growing");
    expect(growthBand(0.85)).toBe("holding");
    expect(growthBand(0.6)).toBe("holding");
    expect(growthBand(0.59)).toBe("shrinking");
  });

  it("says how it grows in one plain line, its supply level and the next band's line", () => {
    expect(growthLine(1.3, 500)).toBe("Growing: fully supplied");
    expect(growthLine(0.92, 500)).toBe("Growing slowly: 92% supplied, full pace from 100%");
    expect(growthLine(0.72, 500)).toBe("Holding steady: 72% supplied, grows from 85%");
    expect(growthLine(0.48, 500)).toBe("Short of supplies: 48% supplied, holds from 60%");
    expect(growthLine(0.48, 500, true)).toBe("Shrinking: 48% supplied, holds from 60%");
    expect(growthLine(0, 40)).toBe("Settling in");
    for (const l of [growthLine(1, 500), growthLine(0.9, 500), growthLine(0.7, 500), growthLine(0.3, 500, true)]) expect(l).not.toMatch(/—/);
  });

  it("a fully supplied town grows a few percent a day, a settling hamlet faster", () => {
    // households a day against its households
    const pace = (pop: number) => growthPerDay(pop) / (pop / PER_HOME);
    for (const pop of [400, 1000, 1499]) expect(pace(pop)).toBeLessThanOrEqual(0.065);
    for (const pop of [1500, 3000, 5999]) expect(pace(pop)).toBeLessThanOrEqual(0.05);
    for (const pop of [6000, 15000]) expect(pace(pop)).toBeLessThanOrEqual(0.04);
    expect(pace(80)).toBeGreaterThan(pace(300));
    expect(pace(300)).toBeGreaterThan(pace(1000));
    expect(pace(1000)).toBeGreaterThan(pace(3000));
    expect(pace(3000)).toBeGreaterThan(pace(8000));
  });
});

describe("town streets and land", () => {
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
