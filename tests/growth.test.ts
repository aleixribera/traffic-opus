// Towns grow only on a proven supply and shrink only after a long shortfall (docs/design.md, "Steady growth"):
// owner, 2026-11-08: "it should be 100% sure the supplies will continue before growing crazily".
import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR, DAY } from "../src/game/society";
import { type Product } from "../src/game/industry";
import { buildStep } from "../src/game/construction";
import { GROW_FROM, SHRINK_AFTER, SHRINK_RATE, averageSupply, demandPerDay } from "../src/game/towns";
import { townGrowth, type Town } from "../src/game/settlements";

const STEADY: Partial<Record<Product, number>> = { food: 20, planks: 8, cement: 6 };

/**
 * The start town of seed 7 with no traffic: every need's loads come in through the day at a steady rate (as far as
 * its shops buy), except in the [from, to) days of `off`. Its households every 6 game hours.
 */
function run(days: number, off?: [number, number]) {
  const g = new Game(7);
  g.start();
  const t = g.towns.list[0];
  const g2 = g as unknown as { time: number; dayN: number; traffic: { time: number } };
  const TICK = HOUR / 8;
  const hh: number[] = [];
  let maxLack = 0;
  for (let k = 0; k < days * 24 * 8; k++) {
    g2.time += TICK;
    g2.traffic.time = g2.time;
    for (const b of g.buildings.list) {
      if (b.site) { delete b.site; b.problem = null; }
      if (b.built < 1 && !b.plant?.site) b.built = Math.min(1, b.built + buildStep(b, TICK));
    }
    for (const b of g.shops) { b.stock = Math.max(b.stock, 4); b.badT = 0; }
    const day = g2.time / DAY;
    if (!(off && day >= off[0] && day < off[1])) {
      for (const [p, r] of Object.entries(STEADY) as [Product, number][]) {
        const w = g.towns.want(t.id, p);
        if (w > 0) g.towns.sold(t.id, p, Math.min(w, r / 192));
      }
    }
    g.towns.tick();
    if (k % 8 === 7) {
      g.towns.hourly();
      maxLack = Math.max(maxLack, t.lack ?? 0);
      if ((k + 1) % 48 === 0) hh.push(t.households);
    }
    const dn = Math.floor(g2.time / DAY);
    if (dn !== g2.dayN) { g.towns.daily(); g2.dayN = dn; }
  }
  return { hh, t, maxLack };
}

/** The sample index at the end of day d (samples every 6 hours). */
const at = (d: number) => d * 4 - 1;

describe("steady growth on a proven supply", () => {
  const days = 10;

  it("steady deliveries: households only ever rise, then level off, never above where they settle", () => {
    // (longer than the rest: homes take an afternoon to build, so the last few go up a few days later)
    const D = days + 5;
    const steady = run(D);
    const h = steady.hh;
    for (let i = 1; i < h.length; i++) expect(h[i], `sample ${i}`).toBeGreaterThanOrEqual(h[i - 1]);
    const last = h[h.length - 1];
    expect(Math.max(...h)).toBe(last);
    // (levelled off: the last three days add next to nothing. Houses rebuilt as terraces change the people a
    // household has, and with it the households the same supply carries, by a household or two at a time: on the
    // PLAN_TOWN start town, 257 -> 262 over days 7 to 10 while its people held at 600-607)
    expect(last - h[at(D - 3)]).toBeLessThanOrEqual(Math.max(2, last * 0.025));
    // (and it got somewhere: past Village size on this supply)
    expect(steady.t.pop).toBeGreaterThan(300);
    // the panel's figure is the two-day average of the loads that came in
    expect(steady.t.rate).toEqual(averageSupply(steady.t.hours!));
    expect(steady.t.rate!.food!).toBeGreaterThan(0);
    expect(steady.maxLack).toBe(0);
    // (and it settles where its supply still has it growing, never on homes built for a target that ran ahead)
    expect(steady.t.level!).toBeGreaterThanOrEqual(GROW_FROM - 0.01);
  });

  it("a day without deliveries shrinks nothing", () => {
    const gap = run(days, [6, 7]);
    const before = gap.hh[at(6)];
    for (let i = at(6); i < gap.hh.length; i++) expect(gap.hh[i], `sample ${i}`).toBeGreaterThanOrEqual(before);
    expect(gap.maxLack).toBeLessThan(SHRINK_AFTER);
  });

  it("a long cut: it holds for two days, then declines slowly", () => {
    const cut = run(days + 2, [6, 99]);
    const before = cut.hh[at(6)];
    // (held through the first day and a half of it: nobody leaves; a home already going up may still finish, and the
    // two-day average stays in the growing band for the first few hours of the cut)
    expect(cut.hh[at(7.5)]).toBeGreaterThanOrEqual(before);
    expect(cut.hh[at(7.5)]).toBeLessThanOrEqual(before + 2);
    // (then down, but never by more than SHRINK_RATE of it a day, give or take a household)
    const end = cut.hh[cut.hh.length - 1];
    expect(end).toBeLessThan(before);
    for (let i = at(6) + 4; i < cut.hh.length; i += 4) expect(cut.hh[i - 4] - cut.hh[i]).toBeLessThanOrEqual(Math.ceil(before * SHRINK_RATE) + 1);
    expect(end).toBeGreaterThan(before * 0.75);
  });
}, 600_000);

describe("a save from before the demand rework", () => {
  // (public/showcase.json was saved under the old demand, a town's use of each need rising 1.6x a size: its towns'
  // supply now covers more of the new, smaller use, so none of them is pushed into shrinking by loading it)
  it("loads, and over its next two days no town's target drops, none counts toward shrinking, none ends smaller", async () => {
    // (before the rework its Elton counted toward shrinking from its first hour, 40 hours of it by the end of the
    // second day; a home rebuilt bigger takes a household away for an afternoon, so homes are judged at the end)
    const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
    const g = Game.load(JSON.parse(fs.readFileSync("public/showcase.json", "utf8")));
    const homes = new Map(g.towns.list.map((t) => [t.id, t.households]));
    const target = new Map(g.towns.list.map((t) => [t.id, t.target]));
    expect(homes.size).toBeGreaterThan(1);
    let maxLack = 0;
    for (let i = 0; i < (2 * DAY) / (1 / 4); i++) {
      g.step(1 / 4);
      for (const t of g.towns.list) {
        if (!target.has(t.id)) continue;
        expect(t.target, t.name).toBeGreaterThanOrEqual(target.get(t.id)! - 1e-9);
        target.set(t.id, t.target);
        maxLack = Math.max(maxLack, t.lack ?? 0);
      }
    }
    expect(maxLack).toBe(0);
    for (const t of g.towns.list) if (homes.has(t.id)) expect(t.households, t.name).toBeGreaterThanOrEqual(homes.get(t.id)!);
  });
}, 600_000);

describe("townGrowth: the band and line the town panel shows", () => {
  // (stand-in towns: only what townGrowth reads)
  const town = (pop: number, food: number, lack = 0) => /* (under 100 people: food is its only need) */ ({ pop, rate: { food }, lack, hours: [] }) as unknown as Town;
  const food = (pop: number) => demandPerDay("food", pop);
  it("fast at full supply, slow just under it, hold through the wide middle, shrink only once the shortfall has lasted", () => {
    expect(townGrowth(town(90, food(90) * 1.1))).toMatchObject({ band: "fast", line: "Growing: fully supplied", by: "food" });
    expect(townGrowth(town(90, food(90) * 0.92))).toMatchObject({ band: "slow", line: "Growing slowly: 92% supplied, full pace from 100%" });
    expect(townGrowth(town(90, food(90) * 0.72))).toMatchObject({ band: "hold", line: "Holding steady: 72% supplied, grows from 85%" });
    expect(townGrowth(town(90, food(90) * 0.48))).toMatchObject({ band: "hold", line: "Short of supplies: 48% supplied, holds from 60%" });
    expect(townGrowth(town(90, food(90) * 0.48, SHRINK_AFTER))).toMatchObject({ band: "shrink", line: "Shrinking: 48% supplied, holds from 60%" });
    expect(townGrowth(town(90, food(90) * 0.72, SHRINK_AFTER)).band).toBe("hold");
    expect(townGrowth(town(90, food(90) * 0.72)).level).toBeCloseTo(0.72, 6);
  });
  it("a town still settling in grows whatever its supply", () => {
    expect(townGrowth(town(40, 0))).toMatchObject({ band: "slow", line: "Settling in" });
    expect(townGrowth(town(40, food(40) * 2)).band).toBe("fast");
  });
});
