// The day and the year as the map shows them (docs/design.md, "Day and night, and the seasons' looks"): where the sun
// stands, what colour its light and the sky's are, when the lamps come on and how many windows are lit; and how far
// each season's look has come in (fresh spring green, late-summer gold, autumn colour and fall, winter snow).
// Pure functions of the sim clock and the player's Nights setting: the renderer turns them into a handful of shader
// uniforms (render/envShader.ts) and the two lights (render/view.ts). Nothing here touches three.js, so it is tested
// on its own (tests/daylight.test.ts).

import { YEAR_DAYS, yearPhase } from "../game/calendar";
import { HOUR, START_HOUR } from "../game/society";

/** The Nights setting: the whole cycle, nights kept light, or the map always lit as by day. */
export type NightMode = "full" | "soft" | "day";
export const NIGHT_MODES: { id: NightMode; name: string; blurb: string }[] = [
  { id: "full", name: "Full cycle", blurb: "Dawn, dusk and moonlit nights, with the lamps on" },
  { id: "soft", name: "Soft nights", blurb: "Nights stay light; the lamps still come on" },
  { id: "day", name: "Always day", blurb: "The map stays lit as at noon" },
];
/** Where the setting is kept (the game's localStorage prefix). */
export const NIGHT_KEY = "flowtown.nights";
/** The setting a new player starts with: the whole cycle (the nights are moonlit blue, never black). */
export const DEFAULT_NIGHT: NightMode = "full";

export function loadNightMode(): NightMode {
  try {
    const v = localStorage.getItem(NIGHT_KEY);
    return v === "full" || v === "soft" || v === "day" ? v : DEFAULT_NIGHT;
  } catch {
    return DEFAULT_NIGHT;
  }
}
export function saveNightMode(m: NightMode) {
  try { localStorage.setItem(NIGHT_KEY, m); } catch { /* private mode: the setting lasts the session */ }
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
/** 0 at a, 1 at b, eased (either order). */
export const ramp = (a: number, b: number, x: number) => {
  const t = clamp01((x - a) / (b - a));
  return t * t * (3 - 2 * t);
};
const RAD = Math.PI / 180;
type RGB = [number, number, number];
const mix3 = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = (c: RGB) => c[0] * 0.2126 + c[1] * 0.7152 + c[2] * 0.0722;

/** The clock hour (0..24) and the day of the year (0..YEAR_DAYS, fractional; 0 is spring's first midnight) at a sim time. */
export function clockOf(t: number): { hour: number; yday: number } {
  return { hour: (((t / HOUR + START_HOUR) % 24) + 24) % 24, yday: yearPhase(t) * YEAR_DAYS };
}

/** The year's swing, 1 at the longest day (just into summer) and -1 at the shortest (mid-winter). */
const yearWave = (yday: number) => Math.cos(2 * Math.PI * (yday / YEAR_DAYS - 0.29));
/** Hours of daylight: about 15 at the longest day, 9 at the shortest, 11 and a bit on the first morning of spring. */
export const dayLength = (yday: number) => 12 + 3.2 * yearWave(yday);
/** How high the sun gets at noon (degrees): 73 in summer, 27 in mid-winter. */
export const noonHeight = (yday: number) => 50 + 23 * yearWave(yday);
/** The clock hour of noon. */
export const NOON = 12;
export const sunrise = (yday: number) => NOON - dayLength(yday) / 2;
export const sunset = (yday: number) => NOON + dayLength(yday) / 2;

/**
 * The sun's height (degrees; below 0 it has set) at a clock hour on a day of the year. A sine arch through the day and a
 * matching dip through the night, joined smoothly at sunrise and sunset.
 */
export function sunHeight(hour: number, yday: number): number {
  const L = dayLength(yday), top = noonHeight(yday), rise = NOON - L / 2;
  const h = (((hour - rise) % 24) + 24) % 24; // hours since sunrise
  if (h <= L) return top * Math.sin((Math.PI * h) / L);
  // (the night's dip falls at the rate the day's arch set: smooth through sunset and sunrise)
  const depth = Math.min(60, (top * (24 - L)) / L);
  return -depth * Math.sin((Math.PI * (h - L)) / (24 - L));
}

/**
 * Which way the sun lies over the map (radians in the ground plane: 0 is east, +x; -PI/2 is north, screen up). It
 * rises in the east-north-east, stands to the north-west at noon like the map's art has always been lit, and sets in
 * the west-south-west.
 */
export function sunBearing(hour: number, yday: number): number {
  const L = dayLength(yday), rise = NOON - L / 2;
  const f = Math.max(-0.15, Math.min(1.15, (hour - rise) / L));
  return (-20 - 180 * f) * RAD;
}
/** The moon's place: high in the north-west, so night shadows fall the way the day's do at noon. */
const MOON = { bearing: -124 * RAD, height: 48 * RAD };
/** Shadows never stretch past this sun height (degrees): a low sun's light, a sane shadow. */
const SHADOW_MIN = 16;

/** Everything the renderer needs about the light at one moment. */
export interface Light {
  /** Ambient light on flat tops (linear RGB, 1 = the palette's own colour). */
  amb: RGB;
  /** The sun's (or the moon's) direct light on a flat top. */
  sun: RGB;
  /** Unit vector from the ground towards the light (three.js: x east, y up, z south). */
  dir: [number, number, number];
  /** The lamps: 0 off (day) .. 1 fully on (night). */
  lamps: number;
  /** How dark it is for the windows (0 by day .. 1 at night). */
  dark: number;
  /** Strength of the drawn shadows (trees, hills): 1 at full sun. */
  shade: number;
  /** How long drawn shadows are against the art's noon shadow (1). */
  shadowLen: number;
  /** The sun's height (degrees), for tests and the dev hook. */
  height: number;
}

// The light by the sun's height: ambient and direct on a flat top. Noon sums to 1 (the palette as drawn); dawn is
// pale gold and rose, the evening deeper gold; the blue hour after sunset; a moonlit blue night.
interface Key { e: number; amb: RGB; sun: RGB }
const NOON_KEY: Key = { e: 40, amb: [0.64, 0.64, 0.64], sun: [0.36, 0.36, 0.36] };
const DUSK: Key[] = [
  { e: -16, amb: [0.16, 0.19, 0.29], sun: [0, 0, 0] },
  { e: -9, amb: [0.2, 0.215, 0.33], sun: [0, 0, 0] },
  { e: -4, amb: [0.3, 0.28, 0.42], sun: [0, 0, 0] },
  { e: 0, amb: [0.44, 0.36, 0.4], sun: [0.06, 0.025, 0.01] },
  { e: 4, amb: [0.5, 0.42, 0.4], sun: [0.3, 0.16, 0.06] },
  { e: 10, amb: [0.56, 0.5, 0.46], sun: [0.42, 0.29, 0.15] },
  { e: 20, amb: [0.62, 0.6, 0.57], sun: [0.39, 0.34, 0.27] },
  NOON_KEY,
];
const DAWN: Key[] = [
  { e: -16, amb: [0.16, 0.19, 0.29], sun: [0, 0, 0] },
  { e: -9, amb: [0.21, 0.225, 0.34], sun: [0, 0, 0] },
  { e: -4, amb: [0.33, 0.31, 0.44], sun: [0, 0, 0] },
  { e: 0, amb: [0.46, 0.4, 0.45], sun: [0.07, 0.04, 0.03] },
  { e: 4, amb: [0.52, 0.47, 0.47], sun: [0.3, 0.2, 0.12] },
  { e: 10, amb: [0.58, 0.55, 0.52], sun: [0.38, 0.3, 0.2] },
  { e: 20, amb: [0.63, 0.62, 0.6], sun: [0.37, 0.34, 0.29] },
  NOON_KEY,
];
/** The moon's light on a flat top at full night. */
const MOONLIGHT: RGB = [0.05, 0.065, 0.1];
/** The darkest a flat top gets, by setting (luminance against the noon palette). */
const NIGHT_FLOOR: Record<NightMode, number> = { full: 0, soft: 0.42, day: 1 };

function keyAt(keys: Key[], e: number): { amb: RGB; sun: RGB } {
  if (e <= keys[0].e) return keys[0];
  for (let i = 1; i < keys.length; i++) {
    const b = keys[i];
    if (e > b.e) continue;
    const a = keys[i - 1], t = ramp(a.e, b.e, e);
    return { amb: mix3(a.amb, b.amb, t), sun: mix3(a.sun, b.sun, t) };
  }
  return keys[keys.length - 1];
}

/** The light at a clock hour on a day of the year, under a Nights setting. */
export function lightAt(hour: number, yday: number, mode: NightMode): Light {
  if (mode === "day") {
    const d = [-0.42, 1, -0.62], n = Math.hypot(d[0], d[1], d[2]);
    return { amb: [...NOON_KEY.amb], sun: [...NOON_KEY.sun], dir: [d[0] / n, d[1] / n, d[2] / n], lamps: 0, dark: 0, shade: 1, shadowLen: 1, height: 53 };
  }
  const e = sunHeight(hour, yday);
  // the dawn and the dusk tables, blended by the hour: all dawn at 6, all dusk at 18, half and half at noon and
  // midnight, so nothing jumps
  const dawnK = keyAt(DAWN, e), duskK = keyAt(DUSK, e);
  const t = 0.5 + 0.5 * Math.sin(((hour - NOON) / 24) * 2 * Math.PI);
  let amb = mix3(dawnK.amb, duskK.amb, t), sun = mix3(dawnK.sun, duskK.sun, t);
  // the moon takes over the direct light once the sun is well down
  const moon = ramp(-5, -13, e);
  sun = mix3(sun, MOONLIGHT, moon);
  // the setting's floor: soft nights lift the darkness, and lose some of the blue as they do
  const floor = NIGHT_FLOOR[mode];
  const L = lum(amb) + lum(sun);
  if (L < floor) {
    const lift = (floor - L) / Math.max(1e-3, lum(amb));
    amb = mix3(amb.map((c) => c * (1 + lift)) as RGB, [floor, floor, floor], 0.35) as RGB;
  }
  // the direct light's direction: the sun's, low suns clamped so shadows stay sane; the moon's at night (the swap
  // happens with both too faint to see)
  const useMoon = e < -4;
  const b = useMoon ? MOON.bearing : sunBearing(hour, yday);
  const h = useMoon ? MOON.height : Math.max(SHADOW_MIN, e) * RAD;
  const dir: [number, number, number] = [Math.cos(b) * Math.cos(h), Math.sin(h), Math.sin(b) * Math.cos(h)];
  const sunLum = lum(sun);
  // drawn shadows follow the direct light's strength (1 at noon) and its height
  const shade = clamp01(sunLum / lum(NOON_KEY.sun));
  const shadowLen = Math.min(1.3, Math.max(0.8, (1 / Math.tan(h)) / 0.75));
  return {
    amb, sun, dir,
    lamps: ramp(5, -5, e),
    dark: ramp(4, -6, e),
    shade, shadowLen, height: e,
  };
}

// ------------------------------------------------------------------ windows through the evening

/** What lights a window: a home, a shop, an office, a town hall. */
export type WindowKind = "home" | "shop" | "office" | "hall";
export const WINDOW_KINDS: WindowKind[] = ["home", "shop", "office", "hall"];

/** Hours (a 24 h loop) and the share of windows lit then, by kind; eased between. */
const OCC: Record<WindowKind, [number, number][]> = {
  // homes: lights on as people come in, most at 9 pm, fewer by midnight, a few at 3 am, the early risers from 5
  home: [[0, 0.3], [1.5, 0.14], [3.5, 0.06], [5, 0.12], [6.5, 0.42], [8.5, 0.18], [16, 0.25], [18.5, 0.62], [21, 0.78], [22.5, 0.58], [24, 0.3]],
  // shops: open into the evening, a few display windows lit all night
  shop: [[0, 0.16], [6, 0.16], [7.5, 0.7], [19, 0.9], [20.5, 0.62], [21.5, 0.24], [24, 0.16]],
  // offices: lit through the working day, a late few, the cleaners, then the night watch
  office: [[0, 0.08], [6.5, 0.1], [8, 0.85], [17.5, 0.85], [19, 0.45], [21, 0.22], [23, 0.1], [24, 0.08]],
  // town halls: lit late for meetings and dances, always a few on
  hall: [[0, 0.28], [6, 0.28], [8, 0.8], [18, 0.85], [22, 0.62], [23.5, 0.32], [24, 0.28]],
};

/** The share of a kind's windows lit at a clock hour (0..1). */
export function windowsLit(kind: WindowKind, hour: number): number {
  const K = OCC[kind];
  const h = ((hour % 24) + 24) % 24;
  for (let i = 1; i < K.length; i++) {
    if (h > K[i][0]) continue;
    const a = K[i - 1], b = K[i];
    return a[1] + (b[1] - a[1]) * ramp(a[0], b[0], h);
  }
  return K[K.length - 1][1];
}

// ------------------------------------------------------------------ the seasons' looks

/**
 * How far each of the seasons' looks has come in on a day of the year (each 0..1). They ease in and out over a few
 * days, never popping: a season's look builds through its first days and lingers into the next one's.
 */
export interface SeasonLook {
  /** Spring's bright new green on grass and leaves. */
  fresh: number;
  /** Blossom on some of the trees. */
  blossom: number;
  /** Summer's deep green. */
  lush: number;
  /** Late summer's dry golden grass. */
  dry: number;
  /** Autumn colour in the deciduous trees. */
  fall: number;
  /** Fallen leaves on the ground. */
  litter: number;
  /** Deciduous trees bare of leaves. */
  bare: number;
  /** Snow on the ground, roofs and trees (the share of ground it covers, about). */
  snow: number;
  /** Frost and ice at the water's edge. */
  frost: number;
  /** Autumn's warmer light. */
  warm: number;
}

/** A bump: 0 before a, rising to 1 by b, holding, falling from c to 0 by d (days of the year, may wrap past the year's end). */
function bump(x: number, a: number, b: number, c: number, d: number): number {
  let best = 0;
  for (const s of [-YEAR_DAYS, 0, YEAR_DAYS]) {
    const y = x + s;
    best = Math.max(best, Math.min(ramp(a, b, y), 1 - ramp(c, d, y)));
  }
  return best;
}

// Days of the year (0 = the first midnight of spring; 16 a season: spring 0-16, summer 16-32, autumn 32-48, winter 48-64).
export function seasonLook(yday: number): SeasonLook {
  const d = ((yday % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  return {
    fresh: bump(d, 0.5, 4, 14, 19),
    blossom: bump(d, 1.5, 4.5, 10, 13.5),
    lush: bump(d, 13, 18, 23, 28),
    dry: bump(d, 22, 29, 35, 40),
    fall: bump(d, 31.5, 35.5, 44, 48),
    litter: bump(d, 37, 43, 47.5, 50.5),
    bare: bump(d, 41, 46.5, 64.5, 67.5),
    snow: bump(d, 48.3, 50.5, 61.5, 64.6),
    frost: bump(d, 47, 49.5, 62, 64.8),
    warm: bump(d, 32, 35, 45, 49),
  };
}
