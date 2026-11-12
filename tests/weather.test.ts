// The weather (game/weather.ts): light, seasonal, a pure function of the clock and the map's seed, so a save loads
// into the weather it was saved in; and nothing in the sim reads it.

import { describe, it, expect } from "vitest";
import { CLEAR, weatherAt, wetShares, type Weather } from "../src/game/weather";
import { DAY, HOUR } from "../src/game/society";
import { Game } from "../src/game/city";
import { setYearStart, START_YDAY } from "../src/game/calendar";

describe("the weather", () => {
  it("is the same for the same moment on the same map, and differs between maps", () => {
    setYearStart(START_YDAY);
    let differ = 0;
    for (let t = 0; t < DAY * 30; t += HOUR * 2.3) {
      expect(weatherAt(t, 7)).toEqual(weatherAt(t, 7));
      const a = weatherAt(t, 7), b = weatherAt(t, 8);
      if (Math.abs(a.rain - b.rain) + Math.abs(a.mist - b.mist) > 0.05) differ++;
    }
    expect(differ).toBeGreaterThan(5);
  });

  it("keeps every part between 0 and 1, and never rains and snows at once", () => {
    setYearStart(START_YDAY);
    const w: Weather = { ...CLEAR };
    for (let t = 0; t < DAY * 64 * 2; t += HOUR / 4) {
      weatherAt(t, 3, w);
      for (const k of ["rain", "snow", "mist", "cloud", "wet"] as const) {
        expect(w[k]).toBeGreaterThanOrEqual(0);
        expect(w[k]).toBeLessThanOrEqual(1);
      }
      expect(Math.min(w.rain, w.snow)).toBe(0);
    }
  });

  it("is mostly dry: summers clear, spring the showery season, snow only in winter", () => {
    setYearStart(START_YDAY);
    for (const seed of [1, 7, 42]) {
      const [sp, su, au, wi] = wetShares(seed, 4);
      expect(su).toBeLessThan(0.08);
      expect(sp).toBeGreaterThan(su);
      expect(au).toBeGreaterThan(su);
      for (const s of [sp, au, wi]) { expect(s).toBeGreaterThan(0.02); expect(s).toBeLessThan(0.2); }
    }
    const w: Weather = { ...CLEAR };
    let snowOut = 0;
    for (let t = 0; t < DAY * 64 * 3; t += HOUR / 2) {
      weatherAt(t, 11, w);
      // (sim time 0 is late spring's day 11; winter is the year's last sixteen days)
      const yday = (((START_YDAY + 0.25 + t / DAY) % 64) + 64) % 64;
      if (w.snow > 0 && yday < 48) snowOut++;
    }
    expect(snowOut).toBe(0);
  });

  it("changes slowly: a shower comes on and dies away over game minutes, never in a step", () => {
    setYearStart(START_YDAY);
    let a = weatherAt(0, 5);
    for (let t = HOUR / 60; t < DAY * 20; t += HOUR / 60) {
      const b = weatherAt(t, 5);
      expect(Math.abs(b.rain - a.rain)).toBeLessThan(0.05);
      expect(Math.abs(b.snow - a.snow)).toBeLessThan(0.05);
      expect(Math.abs(b.cloud - a.cloud)).toBeLessThan(0.05);
      expect(Math.abs(b.mist - a.mist)).toBeLessThan(0.05);
      a = b;
    }
  });

  it("leaves the roads wet after rain, drying off over an hour or two", () => {
    setYearStart(START_YDAY);
    // find a shower's end and look after it
    let found = 0;
    let was = weatherAt(0, 9);
    for (let t = HOUR / 10; t < DAY * 40 && found < 3; t += HOUR / 10) {
      const w = weatherAt(t, 9);
      if (was.rain > 0.01 && w.rain === 0) {
        found++;
        expect(w.wet).toBeGreaterThan(0.3);
        const later = weatherAt(t + HOUR * 8, 9);
        if (later.rain === 0 && later.snow === 0 && later.mist === 0) expect(later.wet).toBeLessThan(w.wet * 0.3);
      }
      was = w;
    }
    expect(found).toBeGreaterThan(0);
  });

  it("lays morning mist most often in autumn, lifting by mid-morning", () => {
    setYearStart(START_YDAY);
    const mornings = [0, 0, 0, 0], noonMist = [0];
    for (let d = 0; d < 64 * 4; d++) {
      // 6 am and 1 pm on day d (sim time 0 is 6 am)
      const w6 = weatherAt(d * DAY, 13), w13 = weatherAt(d * DAY + 7 * HOUR, 13);
      const yday = (START_YDAY + d) % 64;
      if (w6.mist > 0.3) mornings[Math.floor(yday / 16)]++;
      if (w13.mist > 0) noonMist[0]++;
    }
    expect(mornings[2]).toBeGreaterThan(mornings[1]);
    expect(mornings[2]).toBeGreaterThan(mornings[0]);
    expect(noonMist[0]).toBe(0);
  });

  it("comes back as it was after a save and a load: it is read from the clock and the map", () => {
    const g = new Game(17);
    g.time = DAY * 9.4;
    const before = weatherAt(g.time, g.seed);
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect(weatherAt(h.time, h.seed)).toEqual(before);
  });
});
