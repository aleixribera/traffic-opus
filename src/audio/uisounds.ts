// The interface's palette (docs/design.md, "Sound"): office and workshop things of the 1930s. A typewriter key for
// a click, a brass switch for pause, a ledger stamp for placing a works, a drawer for a panel. Short, weighty, quiet.

import { type Rnd, buf, burst, fade, filt, mix, norm, partial, pink, sec, shape, white, SR } from "./dsp";

export type UiId =
  | "click" | "tool" | "open" | "close" | "place" | "build" | "upgrade" | "remove" | "error" | "undo" | "redo"
  | "speed" | "pause" | "resume" | "roadEnd";

const tick = (r: Rnd, f: number, a = 1) => { const x = burst(r, 0.02, "bp", f, 1.6, 0.0022, 0.0004); return a === 1 ? x : x.map((v) => v * a); };

export const UI: Record<UiId, (r: Rnd) => Float32Array> = {
  /** a typewriter key: the tick, and the key bottoming out */
  click: (r) => {
    const x = buf(0.07);
    mix(x, tick(r, 2600), 0, 0.9);
    mix(x, burst(r, 0.04, "lp", 420, 0.8, 0.008), sec(0.004), 0.5);
    partial(x, sec(0.003), 1850, 0.12, 0.012);
    return norm(fade(x, 0.0004, 0.01), 0.5);
  },
  /** picking up a tool: a heavier key, with a little ring */
  tool: (r) => {
    const x = buf(0.14);
    mix(x, tick(r, 2100), 0, 0.9);
    mix(x, burst(r, 0.06, "lp", 320, 0.8, 0.014), sec(0.005), 0.8);
    partial(x, sec(0.004), 1320, 0.18, 0.03); partial(x, sec(0.004), 2110, 0.08, 0.02);
    return norm(fade(x, 0.0004, 0.02), 0.55);
  },
  /** a panel opening: a ledger drawn across the desk */
  open: (r) => {
    const d = 0.11, x = filt(pink(sec(d), r), "bp", (i) => 700 + 1500 * (i / SR / d), 1.2);
    shape(x, (t) => Math.sin((Math.PI * t) / d) ** 1.4);
    mix(x, burst(r, 0.02, "lp", 500, 0.8, 0.006), sec(d - 0.025), 0.35);
    return norm(fade(x, 0.002, 0.01), 0.35);
  },
  close: (r) => {
    const d = 0.1, x = filt(pink(sec(d), r), "bp", (i) => 2000 - 1300 * (i / SR / d), 1.2);
    shape(x, (t) => Math.sin((Math.PI * t) / d) ** 1.4);
    mix(x, burst(r, 0.03, "lp", 380, 0.8, 0.008), sec(d - 0.03), 0.5);
    return norm(fade(x, 0.002, 0.01), 0.35);
  },
  /** placing a works: a solid thump, then the ledger stamp */
  place: (r) => {
    const x = buf(0.42);
    partial(x, 0, 68, 1, 0.07, undefined, 0, 0.003); partial(x, 0, 136, 0.4, 0.04, undefined, 0, 0.003);
    mix(x, burst(r, 0.08, "lp", 300, 0.8, 0.02), 0, 0.8);
    const s = sec(0.13);
    partial(x, s, 118, 0.7, 0.035); mix(x, burst(r, 0.05, "bp", 1500, 1, 0.01), s, 0.6); mix(x, burst(r, 0.04, "lp", 600, 0.8, 0.012), s, 0.6);
    return norm(fade(x, 0.001, 0.05), 0.7);
  },
  /** something built that is not a road: a mallet and a peg */
  build: (r) => {
    const x = buf(0.22);
    partial(x, 0, 96, 0.8, 0.045, undefined, 0, 0.002); mix(x, burst(r, 0.05, "bp", 700, 1.5, 0.012), 0, 0.8);
    partial(x, sec(0.075), 640, 0.35, 0.025); partial(x, sec(0.075), 1540, 0.2, 0.015); mix(x, tick(r, 1900), sec(0.075), 0.5);
    return norm(fade(x, 0.0008, 0.03), 0.6);
  },
  /** an upgrade: a ratchet taken up, and a small bell */
  upgrade: (r) => {
    const x = buf(0.6);
    for (let k = 0; k < 5; k++) mix(x, tick(r, 1500 + k * 260), sec(k * 0.034), 0.6 + k * 0.08);
    partial(x, sec(0.19), 1397, 0.4, 0.14, undefined, 0, 0.0008); partial(x, sec(0.19), 1397 * 2.76, 0.16, 0.07, undefined, 0, 0.0008);
    return norm(fade(x, 0.0005, 0.05), 0.5);
  },
  /** the bulldozer: a crunch, and bits coming down after it */
  remove: (r) => {
    const x = buf(0.5);
    mix(x, shape(filt(white(sec(0.3), r), "lp", 520, 0.8), (t) => Math.min(1, t / 0.006) * Math.exp(-t / 0.07)), 0, 1.2);
    partial(x, 0, 58, 0.7, 0.07, undefined, 0, 0.004);
    for (let k = 0; k < 16; k++) mix(x, burst(r, 0.02, "bp", 500 + r() * 1600, 2, 0.005), sec(0.04 + r() * 0.3), 0.4 * r());
    return norm(fade(x, 0.001, 0.06), 0.6);
  },
  /** no: two soft, low knocks */
  error: (r) => {
    const x = buf(0.3);
    for (const [at, f] of [[0, 155], [0.11, 124]] as const) {
      partial(x, sec(at), f, 0.9, 0.05, undefined, 0, 0.006); partial(x, sec(at), f * 2, 0.25, 0.03, undefined, 0, 0.006);
      mix(x, burst(r, 0.03, "lp", 300, 0.8, 0.008, 0.003), sec(at), 0.3);
    }
    return norm(fade(x, 0.002, 0.05), 0.5);
  },
  /** undo: the carriage pushed back */
  undo: (r) => {
    const d = 0.1, x = filt(white(sec(d), r), "bp", (i) => 2500 - 1600 * (i / SR / d), 2.5);
    shape(x, (t) => Math.sin((Math.PI * t) / d) * (0.6 + 0.4 * Math.sign(Math.sin(Math.PI * 2 * 140 * t))));
    mix(x, tick(r, 1500), sec(d - 0.02), 1.2);
    return norm(fade(x, 0.002, 0.008), 0.4);
  },
  redo: (r) => {
    const d = 0.1, x = filt(white(sec(d), r), "bp", (i) => 900 + 1600 * (i / SR / d), 2.5);
    shape(x, (t) => Math.sin((Math.PI * t) / d) * (0.6 + 0.4 * Math.sign(Math.sin(Math.PI * 2 * 140 * t))));
    mix(x, tick(r, 2300), sec(d - 0.02), 1.2);
    return norm(fade(x, 0.002, 0.008), 0.4);
  },
  /** the speed lever: click, clack */
  speed: (r) => {
    const x = buf(0.12);
    mix(x, tick(r, 1700), 0, 0.8); mix(x, tick(r, 2300), sec(0.045), 1);
    partial(x, sec(0.045), 980, 0.15, 0.02);
    mix(x, burst(r, 0.03, "lp", 350, 0.8, 0.008), sec(0.045), 0.4);
    return norm(fade(x, 0.0004, 0.02), 0.5);
  },
  /** pause: a brass switch thrown down */
  pause: (r) => {
    const x = buf(0.25);
    mix(x, tick(r, 2400), 0, 0.9); mix(x, tick(r, 1500), sec(0.03), 1);
    partial(x, sec(0.03), 880, 0.3, 0.05); partial(x, sec(0.03), 587, 0.3, 0.07);
    mix(x, burst(r, 0.04, "lp", 300, 0.8, 0.012), sec(0.03), 0.6);
    return norm(fade(x, 0.0004, 0.04), 0.55);
  },
  /** and thrown back up */
  resume: (r) => {
    const x = buf(0.25);
    mix(x, tick(r, 1500), 0, 0.9); mix(x, tick(r, 2400), sec(0.03), 1);
    partial(x, sec(0.03), 587, 0.25, 0.05); partial(x, sec(0.03), 880, 0.3, 0.07);
    mix(x, burst(r, 0.04, "lp", 380, 0.8, 0.01), sec(0.03), 0.5);
    return norm(fade(x, 0.0004, 0.04), 0.55);
  },
  /** the roller coming to rest at the end of a new road */
  roadEnd: (r) => {
    const x = buf(0.22);
    partial(x, 0, 74, 0.9, 0.05, undefined, 0, 0.004); mix(x, burst(r, 0.07, "lp", 380, 0.8, 0.02, 0.002), 0, 0.9);
    mix(x, burst(r, 0.03, "bp", 1800, 1, 0.006), sec(0.004), 0.25);
    return norm(fade(x, 0.001, 0.04), 0.55);
  },
};

export const UI_IDS = Object.keys(UI) as UiId[];
