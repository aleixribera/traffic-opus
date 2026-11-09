// The plumes' rule book (docs/design.md, "A world that moves"): what smokes, how hard, and what each kind of puff
// looks like. A works smokes as hard as it is working: the pace is read off its batch progress between the plants'
// steps, so a starved or stopped plant's stack dies away, and a bigger site smokes more. Pure numbers, no three.js
// (render/smoke.ts draws them), so the rules are tested on their own (tests/plumes.test.ts).

import type { Building } from "../game/buildings";

/** What a model's emitter gives off (the empties in the GLBs: tools/blender/build_models.py, emitter()). */
export type FxKind = "stack" | "steam" | "dust" | "haze" | "flare" | "chimney";
export const FX_KINDS: readonly FxKind[] = ["stack", "steam", "dust", "haze", "flare", "chimney"];

/** An emitter in a model: where its mouth is (model space, three's axes) and how wide the plume leaves it (m). */
export interface FxSpot { kind: FxKind; x: number; y: number; z: number; size: number }

/** An emitter standing in the world. */
export interface FxEmitter {
  b: Building;
  kind: FxKind;
  /** the mouth: map x and y, and its height (m) */
  x: number; y: number; h: number;
  size: number;
  /** whether its building stands (not a site still going up) */
  up: () => boolean;
}

/** How one kind of puff lives. Lengths in metres, times in seconds of the animation clock. */
export interface PuffLook {
  /** puffs a second from a mouth 1 m wide at full pace */
  rate: number;
  life: number;
  /** speed it leaves the mouth at (m/s); it slows to about a quarter of this */
  rise: number;
  /** share of the wind's speed it is carried along at once it has bent over */
  drift: number;
  /** its width at the mouth, as a share of the emitter's */
  start: number;
  /** how fast it spreads (m by the end of a 16 s life, for a mouth 1 m wide) */
  grow: number;
  opacity: number;
  /** its colour unless the works has its own (below) */
  colour: number;
}

export type PuffKind = FxKind | "flame" | "trail";

export const LOOKS: Record<PuffKind, PuffLook> = {
  stack: { rate: 1.5, life: 20, rise: 5.2, drift: 0.62, start: 1.25, grow: 7.5, opacity: 0.86, colour: 0xb4afa7 },
  steam: { rate: 1.3, life: 12, rise: 3.8, drift: 0.55, start: 0.85, grow: 4.2, opacity: 0.82, colour: 0xf6f4ee },
  dust: { rate: 1.5, life: 8, rise: 0.9, drift: 1.0, start: 0.6, grow: 4.4, opacity: 0.5, colour: 0xc9bfa6 },
  haze: { rate: 0.9, life: 8.5, rise: 0.55, drift: 0.75, start: 0.9, grow: 5.0, opacity: 0.3, colour: 0xdcc594 },
  flare: { rate: 0.9, life: 11, rise: 3.2, drift: 0.95, start: 0.7, grow: 3.2, opacity: 0.34, colour: 0x4f4a46 },
  flame: { rate: 8, life: 0.85, rise: 6.5, drift: 0.5, start: 1.5, grow: -1.5, opacity: 0.95, colour: 0xffa02e },
  chimney: { rate: 1.6, life: 10, rise: 2.3, drift: 0.8, start: 1.6, grow: 8, opacity: 0.78, colour: 0x9d9a94 },
  trail: { rate: 7, life: 3, rise: 0.6, drift: 0.35, start: 1.0, grow: 9.5, opacity: 0.5, colour: 0xdccfb0 },
};

/** A works' own smoke: the smelter's brown, the rubber plant's black, the food plant's pale wisp. */
export const STACK_TINT: Record<string, number> = {
  coalplant: 0x9d9992, smelter: 0x9f8c80, coppersmelter: 0xaeaa9c, cementworks: 0xcfc9bc, glassworks: 0xc4c0b8,
  foodplant: 0xe2ddd3, sawmill: 0xcdc8be, refinery: 0xa19c95, chemworks: 0xcfc592, rubberplant: 0x625d58,
  motorworks: 0xbbb7b0, machineworks: 0x9c968e,
};
/** What a works' dust is made of. */
export const DUST_TINT: Record<string, number> = {
  quarry: 0xcdc4ac, ironmine: 0xa9745e, coalmine: 0x4d4a47, sandpit: 0xd9c690, coppermine: 0x94a48f,
  cementworks: 0xd0cab9, constructionplant: 0xc8c1af,
};

/** The colour an emitter's puffs are. */
export function tintOf(kind: FxKind, plant: string): number {
  if (kind === "stack") return STACK_TINT[plant] ?? LOOKS.stack.colour;
  if (kind === "dust") return DUST_TINT[plant] ?? LOOKS.dust.colour;
  return LOOKS[kind].colour;
}

// ---- how hard a works is working

/** Game seconds between the plants' steps (game/city.ts: HOUR / 8). */
export const PLANT_STEP = 5;
/** With no progress for this long (game seconds) a works has stopped. */
export const PULSE_STALE = PLANT_STEP * 1.8;

/** A works' pulse: its batch progress when it last moved, and the pace that gave. */
export interface Pulse { prog: number; t: number; speed: number; seen: boolean }
export const newPulse = (): Pulse => ({ prog: 0, t: 0, speed: 0, seen: false });

/**
 * Feel a works' pulse: `prog` is its batch progress now (0..1, game/industry.ts PlantState), `cycle` its batch time
 * at level 1. Returns its pace in batches per cycle: 1 is a level 1 site flat out, 4.5 a level 4 site, 0.4 one
 * without power, 0 one that is starved, full, unstaffed or cut off. (A batch that finishes wraps the progress round;
 * one dropped for want of an input, or with nowhere to put its output, sets it to exactly 0. A batch can also end
 * exactly on a step, so a 0 alone says nothing: the pace is held, and the next step tells which it was.)
 */
export function feel(p: Pulse, prog: number, simTime: number, cycle: number): number {
  if (!p.seen || simTime < p.t) { p.seen = true; p.prog = prog; p.t = simTime; return p.speed; }
  if (prog !== p.prog) {
    if (prog !== 0) {
      let d = prog - p.prog;
      if (d < 0) d += 1;
      // (the first step after it was first seen, or after a pause, came a whole step after the one before; work
      // that starts again from nothing started within the last step)
      const dt = p.prog === 0 ? PLANT_STEP : Math.max(simTime - p.t, PLANT_STEP);
      p.speed = Math.min(6, (d * cycle) / dt);
    }
    p.prog = prog;
    p.t = simTime;
  } else if (simTime - p.t > PULSE_STALE) p.speed = 0;
  return p.speed;
}

/**
 * How hard a works smokes at a pace: nothing when it stands still, a thin plume at part pace, 1 for a level 1 site
 * flat out, and more (but not four times more) for the big sites.
 */
export function smokeOf(speed: number): number {
  if (!(speed > 0)) return 0;
  return speed < 1 ? Math.pow(speed, 0.8) : Math.min(2.2, Math.sqrt(speed));
}

/** A plume's numbers for an emitter `size` m wide smoking at intensity `k` (smokeOf): bigger mouths, bigger plumes. */
export function plumeOf(kind: PuffKind, size: number, k: number, out: Plume): Plume {
  const L = LOOKS[kind], s = Math.sqrt(Math.max(0.2, size));
  const big = Math.min(1.3, 0.62 + 0.21 * size);
  // (a works at part pace gives a thinner, paler plume, not a broken one: the puffs still follow one another)
  const body = 0.62 + 0.38 * Math.min(k, 2.2);
  out.rate = k > 0 ? L.rate * Math.min(1.7, 0.75 + 0.25 * s) * (0.6 + 0.4 * Math.min(k, 1.6)) : 0;
  out.life = L.life * big;
  // (a low fire draws less: its smoke climbs slower, and the wind lays it over sooner)
  out.rise = L.rise * Math.min(1.25, 0.72 + 0.16 * s) * (0.5 + 0.5 * Math.min(k, 1));
  out.size = size * L.start * body;
  // (spread per second^0.8, so a puff swells fast at the mouth and slowly after)
  out.grow = (L.grow * s * body) / Math.pow(16, 0.8);
  // (and one that is stopping fades out as its last puffs leave)
  out.opacity = L.opacity * Math.min(1, 0.4 + 0.6 * k) * Math.min(1, k * 6);
  return out;
}
export interface Plume { rate: number; life: number; rise: number; size: number; grow: number; opacity: number }
export const newPlume = (): Plume => ({ rate: 0, life: 1, rise: 0, size: 1, grow: 0, opacity: 0 });

/** Puffs live at once from a plume in steady state (what its share of the pool is). */
export const liveOf = (p: Plume) => p.rate * p.life;

// ---- the homes' chimneys

/**
 * How many of the fires are lit, 0..1: all winter (bare trees, snow), on cold nights in spring and autumn, never in
 * summer. `night`: 0 day .. 1 night.
 */
export function hearth(bare: number, snow: number, lush: number, night: number): number {
  return Math.min(1, Math.max(0, Math.max(bare, snow) + 0.75 * night * (1 - lush) * (1 - Math.max(bare, snow))));
}

/** Whether a home's fire is lit at a hearth level: the same homes each cold spell, more of them the colder it is. */
export function fireLit(id: number, level: number): boolean {
  if (level <= 0.04) return false;
  const h = (Math.imul(id + 11, 2654435761) >>> 8) / 16777216;
  return h < 0.2 + 0.65 * level;
}

// ---- dust behind the wheels on a dirt road

/** Puffs a second behind a vehicle doing `v` m/s on dirt: none at a crawl, a steady trail at speed. */
export function trailRate(v: number, truck: boolean): number {
  const k = Math.min(1, Math.max(0, (v - 2.5) / 6));
  return LOOKS.trail.rate * k * (truck ? 1.25 : 1);
}

/** How many puffs come due: `acc` carries the fraction over (returns [count, new acc] through `out`). */
export function due(acc: number, rate: number, dt: number, out: { n: number; acc: number }) {
  const a = acc + rate * dt;
  out.n = Math.floor(a);
  out.acc = a - out.n;
  return out;
}
