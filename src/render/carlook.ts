// What each vehicle of 1925-1940 looks like: which car a townsperson drives and its paint, what a tradesman's van, a
// Motor Works car, the town bus and the company's lorries wear, and when a parked car is in its bay. Pure (no three):
// the traffic and the parked cars both read it, so a street's cars are one mix.
//
// A vehicle model has up to three paints (tools/blender/vehicles_a_kit.py): `body` (the main paint), `second` (a car's
// wings and roof, a lorry's lettering colour) and `cargo` (the load, the tilt or the tank).

import { HERALD_COLORS, type Herald } from "../game/company";

/** The townspeople's cars: a saloon, a coupe, an open tourer and a pickup, and the tradesman's van. */
export const CAR_BODIES = ["car", "car_coupe", "car_tourer", "car_pickup"] as const;
export type CarKind = (typeof CAR_BODIES)[number] | "van";
export const CAR_KINDS: readonly CarKind[] = [...CAR_BODIES, "van"];

export interface CarLook { kind: CarKind; body: number; second: number }

/** The black of a car's wings, running boards and fabric roof (and of most cars). */
export const WING_BLACK = 0x1d1e22;
/** The cream of a bus's window band and a coach-built roof. */
export const COACH_CREAM = 0xefe6cf;
/** A lorry's tilt with nothing under it: plain canvas. */
export const CANVAS = 0xcdbf9d;

/**
 * The paints of about 1930, body then wings: black first and commonest, the deep colours enamel came in (bottle
 * green, maroon, navy), cream, greys and buffs, and a few two-tones. Listed by how often they are seen (a paint
 * listed twice is twice as common).
 */
const BLACK = 0x2b2d33, GREEN = 0x2f4a3a, MAROON = 0x6e2a2a, NAVY = 0x263a5a, CREAM = 0xe6dcc0, GREY = 0x7d8085,
  BUFF = 0xb59a6d, BROWN = 0x4f3a2c, BRICK = 0x9a3a2a, SLATE = 0x7f96a8;
export const CAR_PAINTS: readonly (readonly [number, number])[] = [
  [BLACK, WING_BLACK], [BLACK, WING_BLACK], [BLACK, WING_BLACK], [BLACK, WING_BLACK],
  [GREEN, WING_BLACK], [GREEN, WING_BLACK], [GREEN, WING_BLACK],
  [MAROON, WING_BLACK], [MAROON, WING_BLACK], [MAROON, WING_BLACK],
  [NAVY, WING_BLACK], [NAVY, WING_BLACK], [NAVY, WING_BLACK],
  [CREAM, WING_BLACK], [CREAM, WING_BLACK],
  [GREY, WING_BLACK], [GREY, WING_BLACK],
  [BUFF, WING_BLACK], [BROWN, WING_BLACK], [BRICK, WING_BLACK], [SLATE, WING_BLACK],
  // the two-tones: a light body over dark wings in its own colour, or the other way about
  [CREAM, MAROON], [CREAM, GREEN], [GREY, NAVY], [BUFF, BROWN], [MAROON, CREAM],
];
/** A tradesman's van: sober, lettered on a cream board (so never cream itself), black wings and roof. */
export const VAN_PAINTS: readonly (readonly [number, number])[] = [
  [GREEN, WING_BLACK], [MAROON, WING_BLACK], [NAVY, WING_BLACK], [BROWN, WING_BLACK], [0x5f7486, WING_BLACK],
  [0xb8892e, WING_BLACK], [BRICK, WING_BLACK], [BLACK, WING_BLACK],
];

/** A whole number scrambled (the sim's `look` is often small and counted up: its low bits alone would repeat). */
export function scramble(n: number): number {
  let h = (n | 0) ^ 0x9e3779b9;
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * The car a townsperson with this `look` drives, and its paint. One in six is a van (as the sim has always had it:
 * `look % 6 === 0`); of the rest about four in nine are saloons, two coupes, one or two tourers, two pickups.
 */
export function carLook(look: number): CarLook {
  const h = scramble(look);
  if (look % 6 === 0) {
    const p = VAN_PAINTS[h % VAN_PAINTS.length];
    return { kind: "van", body: p[0], second: p[1] };
  }
  const k = (h >>> 8) % 18;
  const kind: CarKind = k < 8 ? "car" : k < 12 ? "car_coupe" : k < 15 ? "car_tourer" : "car_pickup";
  const p = CAR_PAINTS[h % CAR_PAINTS.length];
  // (a pickup is a working car: no two-tones)
  return { kind, body: p[0], second: kind === "car_pickup" ? WING_BLACK : p[1] };
}

/** A paint a shade deeper (a streamliner's wings, in its own colour). */
export function deeper(hex: number, k = 0.72): number {
  const r = Math.round(((hex >> 16) & 255) * k), g = Math.round(((hex >> 8) & 255) * k), b = Math.round((hex & 255) * k);
  return (r << 16) | (g << 8) | b;
}

const hexOf = (css: string) => parseInt(css.slice(1), 16);
/** What the company's lorries wear: its herald's field on bonnet, cab and body, the herald's ink for the lettering. */
export function fleetLivery(h: Herald | null | undefined): { body: number; second: number } {
  if (!h) return { body: hexOf(HERALD_COLORS.navy), second: hexOf(HERALD_COLORS.cream) };
  return { body: hexOf(HERALD_COLORS[h.field]), second: hexOf(HERALD_COLORS[h.ink]) };
}

/**
 * Whether the car that keeps a bay is in it at `hour` (0..24). `h` is the bay's own number (any whole number, the
 * same each time), `home` whether the bay is a home's. A home's car is there at night and out by day (a third never
 * go out); a shop's, an office's or a works' comes in the morning and leaves in the evening (one in eight stays the
 * night: the night watch, a van left over). Each car keeps its own hours, so a lot fills and empties over a couple of
 * hours rather than at a stroke. Dressing only: the sim's own trips come and go through the bays left free.
 */
export function parkedAt(h: number, home: boolean, hour: number): boolean {
  const s = scramble(h);
  const a = (s & 255) / 255, b = ((s >>> 8) & 255) / 255, c = ((s >>> 16) & 255) / 255;
  if (home) {
    if (a < 0.34) return true;
    return hour < 6.5 + b * 2.5 || hour >= 16.5 + c * 3.5;
  }
  if (a < 0.125) return true;
  return hour >= 6.8 + b * 2.4 && hour < 16.2 + c * 4;
}
