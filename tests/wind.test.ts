// The wind (render/wind.ts): one direction and strength over the whole map, changing slowly, never still for long
// and never a gale, the same for the same moment on every machine; what the trees sway to and the smoke leans with.

import { describe, it, expect } from "vitest";
import { WIND, WIND_LOOP, WIND_SPEED, setWind, windAt, windNow } from "../src/render/wind";
import { DAY, HOUR } from "../src/game/society";

describe("the wind", () => {
  it("is a unit direction with a strength between a breath and a stiff breeze", () => {
    for (let t = 0; t < DAY * 20; t += HOUR / 3) {
      const w = windAt(t, t * 0.7);
      expect(Math.hypot(w.x, w.y)).toBeCloseTo(1, 9);
      expect(w.strength).toBeGreaterThanOrEqual(0.06);
      expect(w.strength).toBeLessThanOrEqual(1);
      expect(w.speed).toBeCloseTo(w.strength * WIND_SPEED, 9);
      expect(Math.abs(w.gust)).toBeLessThanOrEqual(1);
    }
  });

  it("is the same for the same moment", () => {
    expect(windAt(12345.6, 78.9)).toEqual(windAt(12345.6, 78.9));
  });

  it("changes slowly: a game minute barely turns it, a day swings it round and blows hard and soft", () => {
    let turnMax = 0, lo = 1, hi = 0, aLo = Infinity, aHi = -Infinity;
    for (let t = 0; t < DAY * 12; t += HOUR / 60) {
      const a = windAt(t), b = windAt(t + HOUR / 60);
      turnMax = Math.max(turnMax, Math.abs(Math.atan2(a.x * b.y - a.y * b.x, a.x * b.x + a.y * b.y)));
      expect(Math.abs(a.strength - b.strength)).toBeLessThan(0.03);
      lo = Math.min(lo, a.strength); hi = Math.max(hi, a.strength);
      const ang = Math.atan2(a.y, a.x);
      aLo = Math.min(aLo, ang); aHi = Math.max(aHi, ang);
    }
    // (under a degree and a half a game minute)
    expect(turnMax).toBeLessThan(0.026);
    expect(lo).toBeLessThan(0.35);
    expect(hi).toBeGreaterThan(0.7);
    // it swings a good way either side of the prevailing wind, but never blows back the way it came
    expect(aHi - aLo).toBeGreaterThan(0.8);
    expect(aHi - aLo).toBeLessThan(Math.PI);
  });

  it("gusts come and go over seconds without changing the hour's wind", () => {
    const calm = windAt(5000, 0);
    let lo = 1, hi = 0;
    for (let s = 0; s < 60; s += 0.25) {
      const w = windAt(5000, s);
      expect(w.x).toBe(calm.x);
      expect(w.y).toBe(calm.y);
      lo = Math.min(lo, w.strength); hi = Math.max(hi, w.strength);
    }
    expect(hi - lo).toBeGreaterThan(0.05);
  });

  it("hands the shaders the direction, the strength and a clock that wraps where every sway repeats", () => {
    const w = setWind(7777, WIND_LOOP * 3 + 5.5);
    expect(WIND.uWind.value.x).toBeCloseTo(w.x, 6);
    expect(WIND.uWind.value.y).toBeCloseTo(w.y, 6);
    expect(WIND.uWind.value.z).toBeCloseTo(w.strength, 6);
    expect(WIND.uWind.value.w).toBeCloseTo(5.5, 6);
    expect(windNow.strength).toBe(w.strength);
    // (the trees' sways are whole numbers of turns over the loop: 2 pi n / WIND_LOOP radians a second)
    expect((2 * Math.PI) / WIND_LOOP).toBeCloseTo(0.09817477, 7);
  });
});
