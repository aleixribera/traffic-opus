import { describe, expect, it } from "vitest";
import { BED_OF, NW, WORKS, dawnOf, dayOf, emptyScene, mixFor, nightOf, strokes, type Scene } from "../src/audio/mixer";
import { BEDS } from "../src/audio/sounds";

/** a busy street by a sawmill at noon in summer */
const street = (over: Partial<Scene> = {}): Scene => {
  const s = emptyScene();
  s.halfH = 120; s.hour = 12; s.season = 1;
  s.n = [14, 4, 3, 1]; s.v = [11, 10, 9, 8];
  s.works[WORKS.indexOf("saw")] = 1.5;
  s.homes = 30; s.shops = 8; s.pop = 2400; s.forest = 0.3; s.hall = 0.8;
  return Object.assign(s, over);
};
const sum = (a: number[]) => a.reduce((x, y) => x + y, 0);

describe("the mixer: what should be heard", () => {
  it("zooming in raises the traffic and lowers the wind", () => {
    let prevEng = Infinity, prevWind = -Infinity;
    for (const halfH of [60, 120, 250, 500, 1000, 2000, 4000]) {
      const m = mixFor(street({ halfH }));
      expect(sum(m.eng) + m.tyres).toBeLessThanOrEqual(prevEng + 1e-9);
      expect(m.wind).toBeGreaterThanOrEqual(prevWind - 1e-9);
      prevEng = sum(m.eng) + m.tyres; prevWind = m.wind;
    }
    const near = mixFor(street({ halfH: 80 })), far = mixFor(street({ halfH: 3000 }));
    expect(sum(near.eng)).toBeGreaterThan(1);
    expect(sum(far.eng) + far.tyres + far.idle).toBeLessThan(0.01);
    expect(far.wind).toBeGreaterThan(near.wind * 2);
    // far out is wind and a distant hum, nothing singled out
    expect(far.hum).toBeGreaterThan(near.hum);
    expect(far.street).toBe(0);
    expect(near.street).toBe(1);
    expect(sum(far.works)).toBeLessThan(0.01);
  });

  it("the wind is always there", () => {
    for (const halfH of [40, 300, 6000]) for (const hour of [0, 6, 12, 18]) for (const season of [0, 1, 2, 3]) {
      expect(mixFor(street({ halfH, hour, season })).wind).toBeGreaterThan(0.12);
    }
  });

  it("night silences the birds, and brings the crickets out in summer", () => {
    const day = mixFor(street()), night = mixFor(street({ hour: 23.5 }));
    expect(day.birds).toBeGreaterThan(2);
    expect(night.birds).toBe(0);
    expect(mixFor(street({ hour: 2 })).birds).toBe(0);
    expect(day.crickets).toBe(0);
    expect(mixFor(street({ hour: 23.5, homes: 0, shops: 0 })).crickets).toBeGreaterThan(0.5);
    expect(mixFor(street({ hour: 23.5, season: 3, homes: 0, shops: 0 })).crickets).toBe(0);
    expect(night.owl).toBeGreaterThan(0);
    expect(day.owl).toBe(0);
  });

  it("the dawn chorus is the birds' loudest hour, spring their best season, winter nearly bare", () => {
    const at = (hour: number, season = 0) => mixFor(street({ hour, season })).birds;
    expect(at(6)).toBeGreaterThan(at(12) * 1.5);
    expect(at(12, 0)).toBeGreaterThan(at(12, 2));
    expect(at(12, 3)).toBeLessThan(at(12, 0) * 0.2);
    // no trees, few birds
    expect(mixFor(street({ forest: 0, homes: 0 })).birds).toBeLessThan(at(12, 1) * 0.3);
  });

  it("winter: a thinner, colder wind", () => {
    const summer = mixFor(street()), winter = mixFor(street({ season: 3 }));
    expect(winter.wind).toBeLessThan(summer.wind);
    expect(winter.windHz).toBeLessThan(summer.windHz);
    expect(winter.air).toBeGreaterThan(summer.air * 2);
  });

  it("a works that is not running is silent; a running one is heard, more with level", () => {
    const i = WORKS.indexOf("saw");
    const off = street(); off.works[i] = 0;
    expect(mixFor(off).works[i]).toBe(0);
    const one = street(); one.works[i] = 1;
    const four = street(); four.works[i] = 4;
    expect(mixFor(one).works[i]).toBeGreaterThan(0.2);
    expect(mixFor(four).works[i]).toBeGreaterThan(mixFor(one).works[i] * 1.3);
    // nothing else plays
    expect(sum(mixFor(one).works)).toBeCloseTo(mixFor(one).works[i], 9);
    // and its events only come with it
    const sm = street(); sm.works.fill(0);
    expect(mixFor(sm).clank + mixFor(sm).steam + mixFor(sm).clink).toBe(0);
    sm.works[WORKS.indexOf("furnace")] = 2;
    expect(mixFor(sm).clank).toBeGreaterThan(3);
    expect(mixFor(sm).steam).toBeGreaterThan(0.5);
  });

  it("the tractor works by day only", () => {
    const i = WORKS.indexOf("tractor");
    const s = street(); s.works[i] = 2;
    expect(mixFor(s).works[i]).toBeGreaterThan(0.3);
    s.hour = 1;
    expect(mixFor(s).works[i]).toBe(0);
  });

  it("paused ducks the world and stops its events", () => {
    const s = street({ jam: 12, gate: 1, sites: 3, pit: 1, dairy: 1, farm: 1, motor: 1, logging: 1 });
    s.works[WORKS.indexOf("furnace")] = 2; s.works[WORKS.indexOf("glass")] = 2;
    const run = mixFor(s), held = mixFor({ ...s, paused: true });
    expect(run.duck).toBe(1);
    expect(held.duck).toBeLessThan(0.4);
    expect(held.duck).toBeGreaterThan(0);
    expect(run.horn).toBeGreaterThan(0);
    for (const k of ["horn", "gate", "clank", "steam", "blast", "axe", "rooster", "cow", "hornTest", "clink", "build", "shopbell", "dog", "children", "clock"] as const) {
      expect(held[k], k).toBe(0);
    }
    expect(run.clock).toBeGreaterThan(0.5);
  });

  it("a faster game: more events, the same pitch", () => {
    const s = street({ jam: 12, sites: 3 });
    const x1 = mixFor(s), x4 = mixFor({ ...s, speed: 4 });
    expect(x4.build).toBeGreaterThan(x1.build * 1.5);
    expect(x4.horn).toBeGreaterThan(x1.horn);
    expect(x4.rate).toEqual(x1.rate);
    expect(x4.eng).toEqual(x1.eng);
  });

  it("engines follow speed: a queue idles, a free road sings", () => {
    const fast = mixFor(street({ v: [22, 20, 18, 16] })), slow = mixFor(street({ v: [1, 1, 1, 1], idle: 14 }));
    expect(fast.tyres).toBeGreaterThan(slow.tyres * 5);
    expect(fast.rate[0]).toBeGreaterThan(slow.rate[0]);
    expect(slow.idle).toBeGreaterThan(fast.idle);
    for (const r of [...fast.rate, ...slow.rate]) { expect(r).toBeGreaterThan(0.7); expect(r).toBeLessThan(1.3); }
    // a short queue is not a jam: no horns
    expect(mixFor(street({ jam: 2 })).horn).toBe(0);
    expect(mixFor(street({ jam: 40 })).horn).toBeLessThanOrEqual(3);
  });

  it("towns murmur by day, more the bigger they are, and sleep at night", () => {
    const big = mixFor(street({ pop: 6000 })), small = mixFor(street({ pop: 200 })), night = mixFor(street({ hour: 1 }));
    expect(big.murmur).toBeGreaterThan(small.murmur * 1.5);
    expect(night.murmur).toBe(0);
    expect(night.shopbell).toBe(0);
    expect(mixFor(street({ hour: 15.5 })).children).toBeGreaterThan(0);
    expect(mixFor(street({ hour: 11 })).children).toBe(0);
  });

  it("every level stays in range for any scene", () => {
    let seed = 1;
    const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
    for (let k = 0; k < 400; k++) {
      const s = emptyScene();
      s.halfH = 30 * 300 ** r(); s.hour = r() * 24; s.season = Math.floor(r() * 4); s.paused = r() < 0.2; s.speed = [1, 2, 4][Math.floor(r() * 3)];
      s.n = [r() * 200, r() * 60, r() * 40, r() * 20]; s.v = [r() * 30, r() * 30, r() * 25, r() * 20];
      s.idle = r() * 80; s.jam = r() * 60; s.gate = r() * 3;
      for (let i = 0; i < NW; i++) s.works[i] = r() < 0.5 ? 0 : r() * 12;
      s.logging = r() * 3; s.dairy = r() * 3; s.farm = r() * 3; s.motor = r() * 3; s.pit = r() * 3; s.sites = r() * 10;
      s.homes = r() * 300; s.shops = r() * 80; s.pop = r() * 20000; s.hall = r(); s.forest = r(); s.water = r();
      const m = mixFor(s);
      for (const [k2, v] of Object.entries(m)) {
        for (const x of Array.isArray(v) ? v : [v]) {
          expect(Number.isFinite(x), k2).toBe(true);
          expect(x, k2).toBeGreaterThanOrEqual(0);
        }
      }
      for (const k2 of ["wind", "hum", "crickets", "water", "tyres", "idle", "street", "murmur", "clock", "near", "duck", "birdGain"] as const) expect(m[k2], k2).toBeLessThanOrEqual(1.2);
      for (const x of [...m.eng, ...m.works]) expect(x).toBeLessThanOrEqual(1.1);
    }
  });

  it("the day's shape, and the clock's strokes", () => {
    expect(dayOf(12)).toBe(1); expect(dayOf(0)).toBe(0); expect(dayOf(23)).toBe(0);
    expect(dawnOf(6)).toBeGreaterThan(0.9); expect(dawnOf(12)).toBe(0);
    expect(nightOf(0)).toBe(1); expect(nightOf(12)).toBe(0);
    expect(strokes(3, 1)).toBe(3); expect(strokes(15, 1)).toBe(3); expect(strokes(0, 1)).toBe(12); expect(strokes(12, 1)).toBe(12);
    expect(strokes(9, 4)).toBe(1);
  });

  it("every works bed is a sound that exists", () => {
    for (const k of WORKS) expect(BEDS[k], k).toBeTypeOf("function");
    for (const bed of Object.values(BED_OF)) expect(WORKS).toContain(bed);
  });
});
