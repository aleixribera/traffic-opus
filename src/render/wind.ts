// The wind over the map (docs/design.md, "A world that moves"): one direction and one strength for the whole map,
// both drifting slowly through the day, with gusts on top. Trees lean and shimmer with it, smoke and steam lean and
// run downwind, dust blows off the roads; the soundscape can read it too. Pure functions of the clock (no three.js
// here but the one shared uniform at the bottom), so it is tested on its own (tests/wind.test.ts).

import * as THREE from "three";

/** The wind at one moment. */
export interface Wind {
  /** Unit vector the air moves along, in map coordinates (x east, y south). */
  x: number;
  y: number;
  /** How hard it blows: 0 dead calm .. 1 a stiff breeze (it never storms). */
  strength: number;
  /** The gust riding on it now, -1 .. 1 (a lull to a gust). */
  gust: number;
  /** Metres a second the air carries smoke along the ground at this strength. */
  speed: number;
}

/** Game seconds in a game hour (game/society.ts HOUR; kept here so this module has no imports to drag in). */
const HOUR = 40;
/** The air's speed at full strength (m/s): smoke runs a plume's length downwind in a few seconds. */
export const WIND_SPEED = 5.5;
/** The period (s) every animation driven by the wind's clock repeats over: its phases stay exact in a float. */
export const WIND_LOOP = 64;

/** A smooth value noise over one axis (0..1), period-free: the same for the same t on every machine. */
function noise1(t: number, seed: number): number {
  const i = Math.floor(t), f = t - i;
  const h = (n: number) => {
    let x = (Math.imul(n | 0, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca77)) | 0;
    x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
    return (x >>> 8) / 16777216;
  };
  const u = f * f * (3 - 2 * f);
  return h(i) + (h(i + 1) - h(i)) * u;
}

/**
 * The wind at a sim time (game seconds) and a moment of the animation clock (real seconds while the game runs).
 * The direction swings round over hours, mostly out of the west-south-west (the prevailing wind: on the map as it
 * first opens, plumes lean away to the right and up the screen), backing and veering either side of it; the strength
 * rises and falls over an hour or two; gusts come and go over seconds.
 */
export function windAt(simTime: number, animTime = 0): Wind {
  const h = simTime / HOUR;
  // the bearing the air moves toward: east-north-east on average, swinging up to about 70 degrees either side
  const swing = (noise1(h / 5, 11) - 0.5) * 2 * 0.8 + (noise1(h / 1.7, 23) - 0.5) * 2 * 0.4;
  const a = -0.4 + swing * 1.05;
  // (never dead calm for long, never a gale)
  const base = 0.2 + 0.6 * noise1(h / 2.3, 37) + 0.2 * noise1(h / 0.6, 41);
  const gust = Math.sin(animTime * 0.37) * 0.55 + Math.sin(animTime * 0.83 + 1.7) * 0.3 + Math.sin(animTime * 1.9 + 0.4) * 0.15;
  const strength = Math.min(1, Math.max(0.06, base * (1 + 0.28 * gust)));
  return { x: Math.cos(a), y: Math.sin(a), strength, gust, speed: WIND_SPEED * strength };
}

/**
 * The wind as the shaders read it: x, y the direction (map x and y: the scene's x and z), z the strength, w the
 * animation clock wrapped to WIND_LOOP seconds. One object shared by every material that sways or drifts.
 */
export const WIND = { uWind: { value: new THREE.Vector4(1, 0, 0.4, 0) } };

/** The wind last written to the shaders (what smoke and sound read this frame). */
export const windNow: Wind = { x: 1, y: 0, strength: 0.4, gust: 0, speed: WIND_SPEED * 0.4 };

/** The dev hook's wind (app.ts, `__env.wind`): held at one bearing and strength until let go. */
let held: { a: number; strength: number } | null = null;
/** Hold the wind at a bearing (degrees: 0 blows east, 90 south) and a strength (0..1), or let it go (no arguments). */
export function holdWind(deg?: number, strength = 0.5) {
  held = deg === undefined ? null : { a: (deg * Math.PI) / 180, strength: Math.min(1, Math.max(0, strength)) };
}

/** Once a frame: work the wind out and hand it to the shaders. */
export function setWind(simTime: number, animTime: number): Wind {
  const w = windAt(simTime, animTime);
  if (held) { w.x = Math.cos(held.a); w.y = Math.sin(held.a); w.strength = held.strength; w.speed = WIND_SPEED * held.strength; }
  Object.assign(windNow, w);
  WIND.uWind.value.set(w.x, w.y, w.strength, animTime % WIND_LOOP);
  return windNow;
}
