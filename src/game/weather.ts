// The weather (docs/design.md, "Weather"): light weather that suits the seasons. Passing showers in spring and
// autumn, now and then in summer (clear days most of the time), snow showers in winter over the snow that lies,
// and morning mist, most of all on autumn mornings. After rain the roads stay wet and dry off over an hour or two.
//
// It is mood, not a mechanic: nothing in the sim reads it. No car drives slower, no route changes, no works makes
// less. Only the map's light and look, the soundscape and the clock's readout follow it.
//
// A pure function of the sim clock and the map's seed, like the wind and the seasons: the same moment on the same
// map always has the same weather, so a save loads into the rain it was saved in, and nothing need be kept.
// The day is cut into slots of a few hours; each slot may hold one spell of rain or snow (a hashed draw against its
// season's chance) that can run on into the next slot; each day may have a morning mist.

import { YEAR_DAYS, yearPhase } from "./calendar";
import { HOUR, START_HOUR } from "./society";

/** What the clock's readout calls the weather now. */
export type WeatherKind = "clear" | "fair" | "overcast" | "showers" | "rain" | "clearing" | "mist" | "snow";
export const WEATHER_NAME: Record<WeatherKind, string> = {
  clear: "Clear", fair: "Fair", overcast: "Overcast", showers: "Showers", rain: "Rain", clearing: "Clearing", mist: "Mist", snow: "Snow",
};

/** The weather at one moment. Every part is 0..1. */
export interface Weather {
  /** rain falling (0 none, 1 a downpour) */
  rain: number;
  /** snow falling */
  snow: number;
  /** ground mist */
  mist: number;
  /** cloud over the sun (dims it and softens the shadows) */
  cloud: number;
  /** how wet the roads are: up while it rains, drying off for an hour or two after */
  wet: number;
  kind: WeatherKind;
}

export const CLEAR: Readonly<Weather> = { rain: 0, snow: 0, mist: 0, cloud: 0, wet: 0, kind: "clear" };

/** Game hours in a slot: each may start one spell. */
export const SLOT_H = 4;
/** A spell's length (game hours), shortest and longest. */
const SPELL_MIN = 1, SPELL_MAX = 3.4;
/** How far into its slot a spell may start (share of the slot). */
const START_SPAN = 0.6;
/** Chance a slot has a spell, by season (spring, summer, autumn, winter): April showers, clear summers, a wet autumn, snow showers. */
export const SPELL_CHANCE = [0.2, 0.065, 0.16, 0.14];
/** Chance of a morning mist, by season. */
export const MIST_CHANCE = [0.22, 0.06, 0.6, 0.3];
/** How long the roads take to dry (game hours to fall to a third), by season. */
const DRY_H = [1.6, 1.0, 2.4, 2.6];
/** Game hours over which the rain comes on and dies away, and the cloud gathers before it and clears after. */
const RAMP_IN = 0.6, RAMP_OUT = 0.8, CLOUD_BEFORE = 1.1, CLOUD_AFTER = 0.9;
/** Slots back a spell's wet roads are still drying from. */
const WET_BACK = 3;

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const ramp = (a: number, b: number, x: number) => { const t = clamp01((x - a) / (b - a)); return t * t * (3 - 2 * t); };

/** A hash of three integers to 0..1 (the same on every machine). */
function hash3(a: number, b: number, c: number): number {
  let x = (Math.imul(a | 0, 0x9e3779b1) ^ Math.imul(b | 0, 0x85ebca77) ^ Math.imul(c | 0, 0xc2b2ae3d)) | 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 8) / 16777216;
}

/** The clock's hours since the game's first midnight (fractional), at a sim time. */
const hoursOf = (t: number) => t / HOUR + START_HOUR;
/** The season (0 spring .. 3 winter) at an hour on that count. */
const seasonAtHours = (h: number) => Math.min(3, Math.floor(yearPhase((h - START_HOUR) * HOUR) * 4));

/** One spell: when it starts and ends (hours on the count above), how hard at its height, and whether it is snow. */
interface Spell { a: number; b: number; peak: number; snow: boolean; season: number }

/** The spell slot `k` holds, if any. */
function spellOf(seed: number, k: number, out: Spell): boolean {
  const s0 = k * SLOT_H;
  const season = seasonAtHours(s0);
  if (hash3(seed, k, 1) >= SPELL_CHANCE[season]) return false;
  out.a = s0 + hash3(seed, k, 2) * START_SPAN * SLOT_H;
  out.b = out.a + SPELL_MIN + (SPELL_MAX - SPELL_MIN) * hash3(seed, k, 3);
  // (most are light to moderate; one in five a proper downpour)
  const h = hash3(seed, k, 4);
  out.peak = h < 0.8 ? 0.35 + 0.4 * (h / 0.8) : 0.8 + 0.2 * ((h - 0.8) / 0.2);
  out.season = season;
  // (snow in winter, over the snow that lies; rain the rest of the year)
  out.snow = season === 3;
  return true;
}

/** A smooth wobble, 0..1, over hours (a spell eases and comes on harder through its length). */
function wobble(seed: number, h: number): number {
  const i = Math.floor(h * 2), f = h * 2 - i, u = f * f * (3 - 2 * f);
  const a = hash3(seed, i, 9), b = hash3(seed, i + 1, 9);
  return a + (b - a) * u;
}

const spell: Spell = { a: 0, b: 0, peak: 0, snow: false, season: 0 };

/**
 * The weather at a sim time on the map with this seed (into `out`, which is returned). A spell's rain (or snow)
 * eases in and out; the cloud gathers an hour ahead of it and clears after; the roads are wet from its first minutes
 * and dry off afterwards; a misty morning's mist lies from the small hours and lifts by mid-morning.
 */
export function weatherAt(t: number, seed: number, out: Weather = { ...CLEAR }): Weather {
  const h = hoursOf(t);
  const k = Math.floor(h / SLOT_H);
  let rain = 0, snow = 0, cloud = 0, wet = 0;
  for (let j = k - WET_BACK; j <= k + 1; j++) {
    if (!spellOf(seed, j, spell)) continue;
    const S = spell;
    // falling now
    const on = ramp(S.a, S.a + RAMP_IN, h) * (1 - ramp(S.b - RAMP_OUT, S.b, h));
    if (on > 0) {
      const amt = on * S.peak * (0.72 + 0.28 * wobble(seed + j, h));
      if (S.snow) snow = Math.max(snow, amt); else rain = Math.max(rain, amt);
    }
    // the cloud over it
    const c = ramp(S.a - CLOUD_BEFORE, S.a, h) * (1 - ramp(S.b, S.b + CLOUD_AFTER, h));
    cloud = Math.max(cloud, c * (0.55 + 0.45 * S.peak));
    // the roads: wet from its first minutes (a light shower damps them, a downpour soaks them), then drying
    if (h > S.a) {
      const soak = Math.sqrt(S.peak) * (S.snow ? 0.55 : 1);
      const w = h < S.b ? soak * ramp(S.a, S.a + 0.4, h) : soak * Math.exp(-(h - S.b) / DRY_H[S.season]);
      wet = Math.max(wet, w);
    }
  }
  // a morning mist: on some days, from the small hours, lifting by mid-morning (heavier on some mornings than others)
  const day = Math.floor(h / 24), hd = h - day * 24;
  const dSeason = seasonAtHours(day * 24 + 6);
  let mist = 0;
  if (hash3(seed, day, 21) < MIST_CHANCE[dSeason]) {
    const thick = 0.55 + 0.45 * hash3(seed, day, 22);
    const lift = 8 + 2.2 * hash3(seed, day, 23);
    mist = thick * ramp(1.5, 4.5, hd) * (1 - ramp(lift - 1.6, lift, hd));
  }
  // (rain washes a mist out; mist dampens the roads a little and whitens the sky)
  mist *= 1 - clamp01((rain + snow) * 2.5);
  wet = Math.max(wet, mist * 0.3);
  cloud = Math.max(cloud, mist * 0.55);
  out.rain = rain; out.snow = snow; out.mist = mist; out.cloud = clamp01(cloud); out.wet = clamp01(wet);
  out.kind = kindOf(out, seed, h);
  return out;
}

/** What the readout calls it. */
function kindOf(w: Weather, seed: number, h: number): WeatherKind {
  if (w.snow > 0.08) return "snow";
  if (w.rain > 0.5) return "rain";
  if (w.rain > 0.06) return "showers";
  if (w.mist > 0.25) return "mist";
  if (w.cloud > 0.45) return "overcast";
  if (w.wet > 0.25) return "clearing";
  // (a fair-weather sky: a few clouds on some days, never over the sun for long)
  if (w.cloud > 0.15 || hash3(seed, Math.floor(h / 24), 31) < 0.3) return "fair";
  return "clear";
}

/** The weather picked from the dev console (`__env.set({ weather })`), held as it is: a strong case of each. */
export const WEATHER_LOOKS: Record<"clear" | "rain" | "showers" | "snow" | "mist" | "overcast" | "wet", Weather> = {
  clear: { ...CLEAR },
  rain: { rain: 0.85, snow: 0, mist: 0, cloud: 0.9, wet: 1, kind: "rain" },
  showers: { rain: 0.4, snow: 0, mist: 0, cloud: 0.7, wet: 0.7, kind: "showers" },
  snow: { rain: 0, snow: 0.75, mist: 0, cloud: 0.85, wet: 0.45, kind: "snow" },
  mist: { rain: 0, snow: 0, mist: 0.9, cloud: 0.5, wet: 0.27, kind: "mist" },
  overcast: { rain: 0, snow: 0, mist: 0, cloud: 0.8, wet: 0, kind: "overcast" },
  wet: { rain: 0, snow: 0, mist: 0, cloud: 0.2, wet: 0.9, kind: "clearing" },
};

/** Share of each season's hours with rain or snow falling, over `years` years (for the tests and the design notes). */
export function wetShares(seed: number, years = 6): number[] {
  const n = [0, 0, 0, 0], wet = [0, 0, 0, 0];
  const w = { ...CLEAR };
  for (let t = 0; t < years * YEAR_DAYS * 24 * HOUR; t += HOUR / 2) {
    const s = seasonAtHours(hoursOf(t));
    weatherAt(t, seed, w);
    n[s]++;
    if (w.rain > 0.06 || w.snow > 0.06) wet[s]++;
  }
  return wet.map((x, i) => x / Math.max(1, n[i]));
}
