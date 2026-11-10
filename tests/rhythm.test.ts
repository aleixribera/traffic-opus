import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { HOUR, LUNCH_OUT, SHIFT_LEN, errandWeight, isDayShift, lunchesAtNoon, shiftFor, type Citizen } from "../src/game/society";

describe("the daily rhythm", () => {
  it("most jobs are day shifts starting between 8 and 10, plants also run early, late and night shifts", () => {
    const n = 1000;
    const plant = Array.from({ length: n }, (_, i) => shiftFor("plant", (i + 0.5) / n));
    const shop = Array.from({ length: n }, (_, i) => shiftFor("com", (i + 0.5) / n));
    const share = (f: (s: number) => boolean) => plant.filter(f).length / n;
    expect(share(isDayShift)).toBeCloseTo(0.42, 2);
    // (the day shift spread over three start times: no one-hour spike)
    for (const s of [8, 9, 10]) expect(share((x) => x === s)).toBeCloseTo(0.14, 2);
    expect(share((s) => s >= 4 && s <= 6)).toBeCloseTo(0.18, 2);
    expect(share((s) => s >= 12 && s <= 17)).toBeCloseTo(0.32, 2);
    // a skeleton night shift (owner, 2026-11-09: 5-8% of workers)
    expect(share((s) => s >= 21 || s < 4)).toBeCloseTo(0.08, 2);
    expect(shop.every(isDayShift)).toBe(true);
    // shops on the 11:00 shift still close by evening
    expect(Math.max(...shop) + SHIFT_LEN).toBeLessThanOrEqual(19);
    // errands: most in the daytime, a few at night
    expect(errandWeight(12)).toBeGreaterThan(errandWeight(18));
    expect(errandWeight(3)).toBeGreaterThan(0);
    expect(errandWeight(3)).toBeLessThan(errandWeight(21));
    expect(errandWeight(21)).toBeLessThan(errandWeight(10));
  });

  it("a town is busiest at the morning and evening rushes, a little busier over lunch, quietest at night, never dead", async () => {
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
    // the save loads at 6:00 with everyone at home: let the first day settle, then watch six days (any one day's hour
    // is a few cars either way. Before the slower growth of 2026-11-10 six days saw the showcase's town grow a size and
    // put twice the cars on the road, so it watched three; now its towns grow by a tenth over the six, 553 to 602)
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
    run(144, true);
    const sum = (k: string, a: number, b: number) => starts[k].slice(a, b).reduce((s, x) => s + x, 0);
    // cars on the road by hour. The owner's rule is a mild swing, the busiest hour about 1.5-1.8x the quietest: ten
    // of these runs with the dice thrown differently average 1.71 (41 cars at 7:00, 40 at 18:00, 24 at 0:00-2:00).
    // One run's single hours are six samples of a few dozen cars, so its own busiest over quietest hour reads
    // anywhere from 1.55 to 2.15: here it only has to be a rhythm (not flat) without a spike or a dead hour, and the
    // mildness is judged on whole rushes against the whole small hours, which one run does resolve (about 1.6)
    const on = cars.map((c, h) => c / samples[h]);
    const mean = (a: number, b: number) => on.slice(a, b).reduce((s, x) => s + x, 0) / (b - a);
    const ratio = Math.max(...on) / Math.min(...on);
    expect(ratio).toBeGreaterThan(1.3);
    expect(ratio).toBeLessThan(2.4);
    const morning = mean(7, 9), evening = mean(17, 19), night = mean(1, 5), lunch = mean(12, 14);
    expect(Math.max(morning, evening) / night).toBeGreaterThan(1.25);
    expect(Math.max(morning, evening) / night).toBeLessThan(1.9);
    // the busiest hour is one of the rushes; the small hours are the quietest, well under both rushes and under the
    // middle of the day; lunch is a bump, under both rushes
    const busiest = on.indexOf(Math.max(...on));
    expect((busiest >= 6 && busiest < 10) || (busiest >= 16 && busiest < 20)).toBe(true);
    expect(night).toBeLessThan(0.8 * Math.min(morning, evening));
    expect(night).toBeLessThan(mean(9, 17));
    // (a bump over the hours either side of it, not a dip: the hour or two before it can still carry the tail of the
    // morning rush, more so in a bigger town, and a town of 500 sends out about fifty lunch trips, a few cars an hour,
    // which one run's dice can hide; the trip counts below are where the lunch bump is proved)
    expect(lunch).toBeGreaterThan(0.85 * (mean(10, 12) + mean(14, 16)) / 2);
    expect(lunch).toBeLessThan(Math.min(morning, evening));
    // the morning commute leaves before the day shifts (the early shift's in the small hours); the evening one comes
    // home after them
    expect(sum("work", 4, 10)).toBeGreaterThan(2 * sum("work", 0, 4));
    expect(sum("home", 15, 21)).toBeGreaterThan(2 * sum("home", 0, 3));
    // lunch: some of the day shift out to the shops around noon
    // (about LUNCH_OUT of those on a shift that breaks at noon, the ones who got there early included)
    const went = sum("lunch", 11, 15) / sum("noon", 0, 24);
    expect(went).toBeGreaterThan(LUNCH_OUT * 0.5);
    expect(went).toBeLessThan(LUNCH_OUT * 1.5);
    expect(sum("lunch", 11, 15)).toBeGreaterThan(3 * (sum("lunch", 0, 10) + sum("lunch", 17, 24)));
  }, 300000);
});
