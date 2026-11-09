import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { HOUR, LUNCH_OUT, SHIFT_LEN, errandWeight, isDayShift, lunchesAtNoon, shiftFor, type Citizen } from "../src/game/society";

describe("the daily rhythm", () => {
  it("most jobs are day shifts starting between 7 and 9, plants also run late and night shifts", () => {
    const n = 1000;
    const plant = Array.from({ length: n }, (_, i) => shiftFor("plant", (i + 0.5) / n));
    const shop = Array.from({ length: n }, (_, i) => shiftFor("com", (i + 0.5) / n));
    expect(plant.filter(isDayShift).length / n).toBeCloseTo(0.6, 1);
    // (the day shift spread over three start times: no one-hour spike)
    for (const s of [7, 8, 9]) expect(plant.filter((x) => x === s).length / n).toBeCloseTo(0.2, 1);
    expect(plant.filter((s) => s === 23).length / n).toBeCloseTo(0.15, 1);
    expect(shop.every(isDayShift)).toBe(true);
    // shops on the 11:00 shift still close by evening
    expect(Math.max(...shop) + SHIFT_LEN).toBeLessThanOrEqual(19);
    // errands: most in the daytime, a few at night
    expect(errandWeight(12)).toBeGreaterThan(errandWeight(10));
    expect(errandWeight(3)).toBeGreaterThan(0);
    expect(errandWeight(3)).toBeLessThan(errandWeight(21));
    expect(errandWeight(21)).toBeLessThan(errandWeight(10));
  });

  it("a town is a bit busier at the rushes and over lunch and quieter at night, never dead or jammed by it", async () => {
    // (node's fs, loaded by name: the tests are typed for the browser)
    const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
    const g = Game.load(JSON.parse(fs.readFileSync("public/showcase.json", "utf8")));
    const people = g.people as any;
    const tr = g.traffic as any;
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
    // the save loads at 6:00 with everyone at home: let the first day settle, then watch three days
    const step = 1 / 15;
    const cars = Array(24).fill(0), samples = Array(24).fill(0);
    const run = (hours: number, watch: boolean) => {
      for (let i = 0; i < (hours * HOUR) / step; i++) {
        g.step(step);
        if (!watch || i % 15) continue;
        const h = Math.floor(people.hourOf()) % 24;
        let n = 0;
        for (const v of tr.vehicles) if (!v.truck && !v.trip.bus) n++;
        cars[h] += n;
        samples[h]++;
      }
    };
    run(20, false);
    for (const k in starts) starts[k].fill(0);
    run(72, true);
    const sum = (k: string, a: number, b: number) => starts[k].slice(a, b).reduce((s, x) => s + x, 0);
    // cars on the road by hour: the busiest hour about 1.5-1.8x the quietest (a gentle rhythm, not rush-hour
    // gridlock and empty nights), and the small hours quieter than the rushes
    const on = cars.map((c, h) => c / samples[h]);
    const mean = (a: number, b: number) => on.slice(a, b).reduce((s, x) => s + x, 0) / (b - a);
    const ratio = Math.max(...on) / Math.min(...on);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(2.2);
    expect(mean(2, 5)).toBeLessThan(0.85 * Math.max(mean(5, 9), mean(16, 20)));
    // the morning commute leaves before the day shifts; the evening one comes home after them
    expect(sum("work", 4, 9)).toBeGreaterThan(3 * sum("work", 0, 3));
    expect(sum("home", 15, 21)).toBeGreaterThan(2 * sum("home", 0, 3));
    // lunch: some of the day shift out to the shops around noon
    // (about LUNCH_OUT of those on a shift that breaks at noon, the ones who got there early included)
    const went = sum("lunch", 11, 15) / sum("noon", 0, 24);
    expect(went).toBeGreaterThan(LUNCH_OUT * 0.5);
    expect(went).toBeLessThan(LUNCH_OUT * 1.5);
    expect(sum("lunch", 11, 15)).toBeGreaterThan(3 * (sum("lunch", 0, 10) + sum("lunch", 17, 24)));
  }, 300000);
});
