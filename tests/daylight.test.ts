import { describe, it, expect } from "vitest";
import {
  clockOf, dayLength, lightAt, noonHeight, seasonLook, sunHeight, sunrise, sunset, windowsLit,
  NIGHT_MODES, DEFAULT_NIGHT, WINDOW_KINDS, type Light, type SeasonLook,
} from "../src/render/daylight";
import { DayCycle, mixLight, timeAtYday } from "../src/render/daycycle";
import { DAY, HOUR, START_HOUR } from "../src/game/society";
import { START_YDAY, YEAR_DAYS } from "../src/game/calendar";

const lum = (c: readonly number[]) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;
const total = (L: Light) => lum(L.amb) + lum(L.sun);
// (mid-spring, mid-summer, mid-autumn, mid-winter)
const MID = { spring: 8, summer: 24, autumn: 40, winter: 56 };
/** The biggest jump in any number of a light between two moments. */
function lightJump(a: Light, b: Light): number {
  let d = 0;
  for (let i = 0; i < 3; i++) d = Math.max(d, Math.abs(a.amb[i] - b.amb[i]), Math.abs(a.sun[i] - b.sun[i]));
  return Math.max(d, Math.abs(a.lamps - b.lamps), Math.abs(a.dark - b.dark), Math.abs(a.shade - b.shade));
}
function lookJump(a: SeasonLook, b: SeasonLook): number {
  let d = 0;
  for (const k of Object.keys(a) as (keyof SeasonLook)[]) d = Math.max(d, Math.abs(a[k] - b[k]));
  return d;
}

describe("the clock", () => {
  it("starts the game at 6 am in late spring (day START_YDAY + 1)", () => {
    const c = clockOf(0);
    expect(c.hour).toBeCloseTo(START_HOUR, 6);
    expect(c.yday).toBeCloseTo(START_YDAY + START_HOUR / 24, 6);
  });
  it("runs an hour every HOUR and a day every DAY", () => {
    expect(clockOf(3 * HOUR).hour).toBeCloseTo(START_HOUR + 3, 6);
    expect(clockOf(DAY).yday - clockOf(0).yday).toBeCloseTo(1, 6);
  });
  it("timeAtYday is clockOf's inverse", () => {
    for (const yd of [0, 3.25, 17.5, 40.75, 63.9]) {
      const c = clockOf(timeAtYday(yd));
      expect(c.yday).toBeCloseTo(yd, 5);
      expect(c.hour).toBeCloseTo((yd % 1) * 24, 4);
    }
  });
});

describe("the sun through the year", () => {
  it("summer days are long and high, winter days short and low", () => {
    expect(dayLength(MID.summer)).toBeGreaterThan(14);
    expect(dayLength(MID.winter)).toBeLessThan(10);
    expect(noonHeight(MID.summer)).toBeGreaterThan(65);
    expect(noonHeight(MID.winter)).toBeLessThan(35);
    expect(sunrise(MID.summer)).toBeLessThan(sunrise(MID.winter));
    expect(sunset(MID.summer)).toBeGreaterThan(sunset(MID.winter));
  });
  it("is up at noon, down at midnight, and on the horizon at sunrise and sunset", () => {
    for (const yd of Object.values(MID)) {
      expect(sunHeight(12, yd)).toBeCloseTo(noonHeight(yd), 6);
      expect(sunHeight(0, yd)).toBeLessThan(-10);
      expect(Math.abs(sunHeight(sunrise(yd), yd))).toBeLessThan(1e-6);
      expect(Math.abs(sunHeight(sunset(yd), yd))).toBeLessThan(1e-6);
    }
  });
});

describe("the light through a day", () => {
  it("is brightest at noon, and dark the whole night through", () => {
    for (const yd of Object.values(MID)) {
      let best = { h: 0, v: -1 }, worst = { h: 0, v: 9 };
      for (let h = 0; h < 24; h += 0.25) {
        const v = total(lightAt(h, yd, "full"));
        if (v > best.v) best = { h, v };
        if (v < worst.v) worst = { h, v };
      }
      // (a high summer sun holds the noon light for hours: noon is at the top of the plateau)
      expect(total(lightAt(12, yd, "full"))).toBeCloseTo(best.v, 6);
      // (the night's light is flat from the blue hour's end to dawn's start: 2 am is as dark as it gets)
      expect(total(lightAt(2, yd, "full"))).toBeLessThan(worst.v + 0.01);
      expect(best.v).toBeGreaterThan(0.85);
    }
  });
  it("noon is the palette as drawn; night is moonlit blue, never black", () => {
    const noon = lightAt(12, MID.summer, "full");
    expect(total(noon)).toBeGreaterThan(0.95);
    expect(noon.lamps).toBe(0);
    expect(noon.dark).toBe(0);
    const night = lightAt(2, MID.summer, "full");
    expect(night.lamps).toBe(1);
    expect(night.dark).toBe(1);
    expect(night.amb[2]).toBeGreaterThan(night.amb[0]); // blue
    expect(total(night)).toBeGreaterThan(0.12);
    expect(total(night)).toBeLessThan(0.35);
  });
  it("dawn and the evening are warm; the blue hour is blue", () => {
    const yd = MID.summer;
    const golden = lightAt(sunset(yd) - 0.8, yd, "full");
    expect(golden.sun[0]).toBeGreaterThan(golden.sun[2] * 1.8);
    const dawn = lightAt(sunrise(yd) + 0.6, yd, "full");
    expect(dawn.sun[0]).toBeGreaterThan(dawn.sun[2] * 1.4);
    const blue = lightAt(sunset(yd) + 0.6, yd, "full");
    expect(blue.amb[2]).toBeGreaterThan(blue.amb[0]);
  });
  it("lamps come on over dusk and go off over dawn, not at once", () => {
    const yd = MID.autumn;
    const s = sunset(yd), r = sunrise(yd);
    expect(lightAt(s - 1.5, yd, "full").lamps).toBe(0);
    const mid = lightAt(s, yd, "full").lamps;
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(0.8);
    expect(lightAt(s + 1.5, yd, "full").lamps).toBe(1);
    expect(lightAt(r - 1.5, yd, "full").lamps).toBe(1);
    expect(lightAt(r + 1.5, yd, "full").lamps).toBe(0);
  });
  it("dawn and dusk are ramps you can watch, not a jump (B11)", () => {
    for (const yd of Object.values(MID)) {
      const night = total(lightAt(0, yd, "full")), day = total(lightAt(12, yd, "full"));
      // the biggest brightening in any quarter of an hour stays a small share of night-to-day
      let step = 0;
      for (let h = 0; h < 12; h += 1 / 60) step = Math.max(step, total(lightAt(h + 0.25, yd, "full")) - total(lightAt(h, yd, "full")));
      expect(step / (day - night)).toBeLessThan(0.2);
      // from the first paling of the sky to nine tenths of day takes two hours and more
      let first = -1, most = -1;
      for (let h = 0; h < 12; h += 1 / 60) {
        const v = (total(lightAt(h, yd, "full")) - night) / (day - night);
        if (first < 0 && v > 0.05) first = h;
        if (most < 0 && v > 0.9) most = h;
      }
      expect(most - first).toBeGreaterThan(2.5);
    }
  });
  it("winter's 6 pm is night, summer's is still day", () => {
    expect(lightAt(18, MID.winter, "full").lamps).toBe(1);
    expect(lightAt(18, MID.summer, "full").lamps).toBe(0);
  });
  it("moves smoothly: no jump between minutes, across midnight too", () => {
    for (const yd of [...Object.values(MID), 0, 15.9, 47.99]) {
      for (let h = 0; h < 24; h += 1 / 60) {
        const a = lightAt(h, yd, "full"), b = lightAt(h + 1 / 60, yd, "full");
        // (a game minute is under a second at 1x; the fastest change is the shadows coming in just after sunrise)
        const j = lightJump(a, b);
        expect(j).toBeLessThan(0.05);
        // ...and a real ramp, not a step: half the time, about half the change
        if (j > 0.01) expect(lightJump(a, lightAt(h + 1 / 120, yd, "full"))).toBeLessThan(j * 0.7);
      }
      expect(lightJump(lightAt(23.999, yd, "full"), lightAt(0, yd, "full"))).toBeLessThan(0.01);
    }
  });
  it("the direct light is a unit vector above the ground", () => {
    for (let h = 0; h < 24; h += 0.5) {
      const d = lightAt(h, MID.spring, "full").dir;
      expect(Math.hypot(...d)).toBeCloseTo(1, 6);
      expect(d[1]).toBeGreaterThan(0.2);
    }
  });
});

describe("the Nights setting", () => {
  it("offers Full cycle, Soft nights and Always day, defaulting to the full cycle", () => {
    expect(NIGHT_MODES.map((m) => m.id)).toEqual(["full", "soft", "day"]);
    expect(DEFAULT_NIGHT).toBe("full");
  });
  it("Always day is noon whatever the hour or season", () => {
    const n = lightAt(12, MID.summer, "day");
    for (const yd of Object.values(MID)) for (const h of [0, 2, 6, 18.5, 20]) {
      const L = lightAt(h, yd, "day");
      expect(L.lamps).toBe(0);
      expect(L.dark).toBe(0);
      expect(lightJump(L, n)).toBe(0);
    }
  });
  it("Soft nights are brighter than full ones but still nights, and the same by day", () => {
    for (const h of [21, 0, 2, 4]) {
      const full = lightAt(h, MID.winter, "full"), soft = lightAt(h, MID.winter, "soft");
      expect(total(soft)).toBeGreaterThan(total(full) + 0.1);
      expect(total(soft)).toBeGreaterThan(0.4);
      expect(soft.lamps).toBe(1);
    }
    expect(lightJump(lightAt(12, MID.summer, "soft"), lightAt(12, MID.summer, "full"))).toBe(0);
  });
  it("Soft nights move smoothly too", () => {
    for (let h = 0; h < 24; h += 1 / 60) {
      expect(lightJump(lightAt(h, MID.autumn, "soft"), lightAt(h + 1 / 60, MID.autumn, "soft"))).toBeLessThan(0.05);
    }
  });
});

describe("windows through the evening", () => {
  it("stay between none and all, and loop smoothly through midnight", () => {
    for (const k of WINDOW_KINDS) {
      for (let h = 0; h < 24; h += 0.05) {
        const v = windowsLit(k, h);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
        expect(Math.abs(windowsLit(k, h + 0.05) - v)).toBeLessThan(0.05);
      }
      expect(Math.abs(windowsLit(k, 23.999) - windowsLit(k, 0))).toBeLessThan(0.01);
    }
  });
  it("homes fill up through the evening and empty by the small hours", () => {
    expect(windowsLit("home", 21)).toBeGreaterThan(0.7);
    expect(windowsLit("home", 3.5)).toBeLessThan(0.1);
    expect(windowsLit("home", 21)).toBeGreaterThan(windowsLit("home", 17));
  });
  it("offices empty after work; shops close in the late evening", () => {
    expect(windowsLit("office", 12)).toBeGreaterThan(0.8);
    expect(windowsLit("office", 23)).toBeLessThan(0.15);
    expect(windowsLit("shop", 18.5)).toBeGreaterThan(windowsLit("shop", 23));
  });
});

describe("the seasons' looks", () => {
  it("each season is its own at mid-season", () => {
    const sp = seasonLook(MID.spring), su = seasonLook(MID.summer), au = seasonLook(MID.autumn), wi = seasonLook(MID.winter);
    expect(sp.fresh).toBe(1);
    expect(sp.blossom).toBeGreaterThan(0.5);
    expect(sp.snow + sp.bare + sp.fall).toBe(0);
    expect(seasonLook(20).lush).toBe(1); // summer is lush, then...
    expect(su.snow + su.fall + su.bare).toBe(0);
    expect(seasonLook(30).dry).toBe(1); // ...late summer goes gold
    expect(au.fall).toBe(1);
    expect(au.warm).toBe(1);
    expect(seasonLook(45).litter).toBe(1); // the leaves come down late in autumn
    expect(au.snow).toBe(0);
    expect(wi.snow).toBe(1);
    expect(wi.bare).toBe(1);
    expect(wi.frost).toBe(1);
    expect(wi.fresh + wi.lush + wi.fall).toBe(0);
  });
  it("blend in over days, never popping at a season's turn or the year's end", () => {
    const step = 1 / 24; // an hour
    for (let d = -1; d < YEAR_DAYS + 1; d += step) {
      expect(lookJump(seasonLook(d), seasonLook(d + step))).toBeLessThan(0.03);
    }
    for (const turn of [16, 32, 48, 64]) {
      expect(lookJump(seasonLook(turn - 0.001), seasonLook(turn + 0.001))).toBeLessThan(0.01);
    }
    expect(lookJump(seasonLook(YEAR_DAYS - 0.001), seasonLook(0))).toBeLessThan(0.01);
    expect(lookJump(seasonLook(-3), seasonLook(YEAR_DAYS - 3))).toBeLessThan(1e-9);
  });
  it("the snow is gone before spring's blossom", () => {
    for (let d = 0; d < 16; d += 0.25) expect(seasonLook(d).snow * seasonLook(d).blossom).toBe(0);
  });
});

describe("the day cycle", () => {
  it("the dev hook fixes a moment: hour, season (its middle day) and day", () => {
    const c = new DayCycle();
    c.set({ season: "winter", hour: 20 });
    c.update(0, 1 / 60, false, false);
    expect(c.hour).toBeCloseTo(20, 4);
    expect(Math.floor(c.yday)).toBe(48 + 7);
    expect(c.light.lamps).toBe(1);
    expect(c.look.snow).toBe(1);
    c.set({ season: "summer", day: 1, hour: 12 });
    c.update(0, 1 / 60, false, false);
    expect(Math.floor(c.yday)).toBe(16);
    expect(c.light.lamps).toBe(0);
    c.clear();
    c.update(5 * HOUR, 1 / 60, false, false);
    expect(c.hour).toBeCloseTo(START_HOUR + 5, 4);
  });
  it("an overlay lifts the night towards day", () => {
    const c = new DayCycle();
    c.set({ hour: 2, season: "summer", mode: "full" });
    const dark = total(c.update(0, 1 / 60, false, false));
    let lit = dark;
    for (let i = 0; i < 60; i++) lit = total(c.update(0, 1 / 60, false, true));
    expect(lit).toBeGreaterThan(dark + 0.4);
  });
  it("the Traffic window's flow keeps the night: it lifts it far less than a data view (review 2026-11-12, C9)", () => {
    const at = (overlay: boolean | "flow") => {
      const c = new DayCycle();
      c.set({ hour: 0.25, season: "spring", mode: "full" });
      let L = c.update(0, 1 / 60, false, overlay);
      for (let i = 0; i < 120; i++) L = c.update(0, 1 / 60, false, overlay);
      return L;
    };
    const dark = at(false), flow = at("flow"), view = at(true);
    expect(total(flow) - total(dark)).toBeLessThan((total(view) - total(dark)) / 3);
    // (the lamps still read as lit)
    expect(flow.lamps).toBeGreaterThan(0.7);
  });
  it("mixLight blends the ends exactly and keeps the direction a unit vector", () => {
    const a = lightAt(2, MID.summer, "full"), b = lightAt(12, MID.summer, "full");
    expect(lightJump(mixLight(a, b, 0), a)).toBeLessThan(1e-12);
    expect(lightJump(mixLight(a, b, 1), b)).toBeLessThan(1e-12);
    expect(Math.hypot(...mixLight(a, b, 0.5).dir)).toBeCloseTo(1, 9);
  });
});
