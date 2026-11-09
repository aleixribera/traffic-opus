import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { HOUR, LUNCH_OUT, SHIFT_LEN, errandWeight, isDayShift, lunchesAtNoon, shiftFor, type Citizen } from "../src/game/society";

describe("the daily rhythm", () => {
  it("most jobs are day shifts, a few plants run late and night shifts", () => {
    const n = 1000;
    const plant = Array.from({ length: n }, (_, i) => shiftFor("plant", (i + 0.5) / n));
    const shop = Array.from({ length: n }, (_, i) => shiftFor("com", (i + 0.5) / n));
    expect(plant.filter(isDayShift).length / n).toBeCloseTo(0.7, 1);
    expect(plant.filter((s) => s === 23).length / n).toBeLessThan(0.15);
    expect(shop.every(isDayShift)).toBe(true);
    // shops on the 11:00 shift still close by evening
    expect(Math.max(...shop) + SHIFT_LEN).toBeLessThanOrEqual(19);
    expect(errandWeight(12)).toBeGreaterThan(errandWeight(10));
    expect(errandWeight(17)).toBeGreaterThan(errandWeight(15));
  });

  it("a town is busy at the rushes and over lunch and quiet at night", async () => {
    // (node's fs, loaded by name: the tests are typed for the browser)
    const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
    const g = Game.load(JSON.parse(fs.readFileSync("public/showcase.json", "utf8")));
    const people = g.people as any;
    // count the trips people set off on, by hour of day and kind
    const starts: Record<string, number[]> = { work: Array(24).fill(0), home: Array(24).fill(0), shop: Array(24).fill(0), lunch: Array(24).fill(0), noon: Array(24).fill(0) };
    const travel = people.travel.bind(people);
    people.travel = (c: Citizen, from: unknown, to: unknown, kind: string) => {
      const h = Math.floor(people.hourOf()) % 24;
      if (kind === "work" && !c.back && lunchesAtNoon(c.shift)) starts.noon[h]++;
      if (c.lunch !== undefined && c.lunch >= 0 && kind === "shop") starts.lunch[h]++;
      else if (starts[kind]) starts[kind][h]++;
      return travel(c, from, to, kind);
    };
    // the save loads at 6:00 with everyone at home: let the first day settle, then watch a full day
    const step = 1 / 15;
    const run = (hours: number) => { for (let i = 0; i < hours * HOUR / step; i++) g.step(step); };
    run(20);
    for (const k in starts) starts[k].fill(0);
    run(24);
    const sum = (k: string, a: number, b: number) => starts[k].slice(a, b).reduce((s, x) => s + x, 0);
    const all = (a: number, b: number) => sum("work", a, b) + sum("home", a, b) + sum("shop", a, b) + sum("lunch", a, b);
    // the morning commute leaves before the 8:00 shift; nights are quiet
    expect(sum("work", 4, 8)).toBeGreaterThan(3 * sum("work", 22, 24) + 3 * sum("work", 0, 2));
    // (2.5-3x over runs: the small hours have the late shift's trips home and a few long commutes setting off)
    expect(all(4, 8)).toBeGreaterThan(2.2 * all(0, 4));
    // the evening rush home after the day shift, more than the late shift's trip home at 23:00
    expect(sum("home", 15, 19)).toBeGreaterThan(2 * sum("home", 22, 24) + 2 * sum("home", 0, 2));
    // lunch: day-shift workers out to the shops around noon
    // (about LUNCH_OUT of those on a shift that breaks at noon, the ones who got there early included)
    const went = sum("lunch", 11, 14) / sum("noon", 0, 24);
    expect(went).toBeGreaterThan(LUNCH_OUT * 0.6);
    expect(went).toBeLessThan(LUNCH_OUT * 1.4);
    expect(sum("lunch", 11, 14)).toBeGreaterThan(3 * (sum("lunch", 0, 10) + sum("lunch", 16, 24)));
  });
});
