// The world's sound recipes (docs/design.md, "Sound"): engines, works, town and country, each computed from noise,
// filters and decaying partials into a short buffer. Beds are seamless loops (a few seconds, played on repeat and
// pitched a little); the rest are one-shots, in a few seeded variants so no two in a row are the same.
// Pure: no AudioContext. tests/audio.sounds.test.ts checks every recipe (level, no DC, no click, loop seams).

import {
  Biquad, SR, TAU, type Rnd, band, burst, center, clamp, drive, echo, fade, filt, level, loopify, mix, norm, partial, peak, pink,
  scale, sec, shape, smooth, tone, white,
} from "./dsp";

const FADE = 0.3;

// ------------------------------------------------------------------ engines

interface Eng {
  /** firings a second */
  fire: number;
  /** how hard each cylinder in turn fires (the lumpiness of an old engine) */
  pat: number[];
  /** exhaust resonances: [Hz, Q, gain] */
  res: [number, number, number][];
  lp: number;
  /** timing jitter, as a share of the firing period */
  jit?: number;
  /** a clattery knock on each firing (a big diesel) */
  knock?: number;
  /** soft clipping (a growl) */
  drive?: number;
  /** how long each puff of exhaust lasts (s): the shorter, the more of the engine's note is above its rumble */
  pulse?: number;
  gain?: number;
}

/** One or more engines running, as a loop of `D` seconds: a train of exhaust pulses through pipe resonances. */
function engines(r: Rnd, D: number, list: Eng[]): Float32Array {
  const n = sec(D), N = n + sec(FADE);
  const out = new Float32Array(N);
  for (const E of list) {
    const cycles = Math.max(1, Math.round(E.fire * D)), per = n / cycles;
    const amp: number[] = [], off: number[] = [];
    for (let i = 0; i < cycles; i++) { amp.push(E.pat[i % E.pat.length] * (0.8 + 0.4 * r())); off.push((r() - 0.5) * (E.jit ?? 0.06) * per); }
    const exc = new Float32Array(N);
    const pl = Math.max(8, Math.min(sec(E.pulse ?? 0.002), Math.floor(per * 0.45)));
    for (let i = 0; i * per < N; i++) {
      const k = i % cycles, at = Math.round(i * per + off[k]);
      for (let j = 0; j < pl; j++) {
        const p = at + j;
        if (p < 0 || p >= N) continue;
        const w = j / pl;
        // (a puff of pressure, with some grit in it)
        exc[p] += amp[k] * (Math.sin(Math.PI * w) * 0.7 + (r() * 2 - 1) * (1 - w) * 0.5);
      }
    }
    const eng = new Float32Array(N);
    for (const [f, q, g] of E.res) {
      const b = new Biquad("bp", f, q);
      for (let i = 0; i < N; i++) eng[i] += b.run(exc[i]) * g;
    }
    if (E.knock) {
      const kn = filt(exc.slice(), "bp", 1500, 1.2);
      for (let i = 0; i < N; i++) eng[i] += kn[i] * E.knock;
    }
    if (E.drive) { norm(eng, 1); drive(eng, E.drive); }
    filt(eng, "lp", E.lp, 0.6);
    level(eng, 0.1, 2);
    mix(out, eng, 0, E.gain ?? 1);
  }
  filt(out, "hp", 45, 0.7);
  return level(loopify(out, n), 0.1);
}

const CAR: Eng = { fire: 30, pat: [1, 0.7, 0.9, 0.6], res: [[95, 4, 0.8], [190, 3, 0.8], [420, 2, 0.6], [900, 1.5, 0.42], [1700, 1.2, 0.2]], lp: 2600, drive: 1.8, pulse: 0.0011 };
const LIGHT: Eng = { fire: 42, pat: [1, 0.85, 0.95, 0.8, 0.9, 0.75], res: [[80, 3, 0.8], [165, 3, 0.9], [300, 2.5, 0.75], [620, 2, 0.5], [1200, 1.5, 0.3]], lp: 2600, drive: 2.2, pulse: 0.0011 };
const HEAVY: Eng = { fire: 23, pat: [1, 0.8, 0.9, 0.7, 0.95, 0.75], res: [[58, 5, 0.9], [104, 4, 1], [158, 3, 0.8], [330, 2, 0.55], [700, 1.5, 0.3]], lp: 2000, knock: 0.22, drive: 2, pulse: 0.0014 };
const TRAIN: Eng = { fire: 17, pat: [1, 0.85, 0.9, 0.8], res: [[55, 6, 0.9], [84, 5, 1.1], [126, 4, 0.9], [250, 2, 0.55], [560, 1.5, 0.3]], lp: 1700, knock: 0.18, drive: 2, pulse: 0.0016 };
const IDLE: Eng = { fire: 12, pat: [1, 0.6, 0.85, 0.55], res: [[75, 4, 0.8], [140, 3, 0.8], [300, 2, 0.5], [640, 1.5, 0.28]], lp: 1400, jit: 0.12, drive: 1.6, pulse: 0.0014 };
const TRACTOR: Eng = { fire: 9.5, pat: [1, 0.55], res: [[85, 5, 0.9], [170, 4, 0.9], [340, 3, 0.6], [700, 2, 0.4], [1300, 1.5, 0.16]], lp: 2000, jit: 0.1, drive: 1.8, pulse: 0.0012 };

const vary = (E: Eng, k: number, gain = 1): Eng => ({ ...E, fire: E.fire * k, res: E.res.map(([f, q, g]) => [f * (0.94 + 0.12 * ((k * 7.3) % 1)), q, g] as [number, number, number]), gain });

// ------------------------------------------------------------------ voices (animals, people)

/**
 * A voiced call: a buzzy source at `f0(t)` through two moving formants. Rough, but with the right contour it reads
 * as a rooster, a cow, a dog or a far-off shout.
 */
function vocal(r: Rnd, dur: number, f0: (t: number) => number, F1: (t: number) => number, F2: (t: number) => number, amp: (t: number) => number, breath = 0.05): Float32Array {
  const n = sec(dur), x = new Float32Array(n);
  const a = new Biquad(), b = new Biquad(), lp = new Biquad("lp", 3800, 0.7);
  let ph = 0;
  for (let i = 0; i < n; i++) {
    const t = i / SR;
    if ((i & 31) === 0) { a.set("bp", F1(t), 5); b.set("bp", F2(t), 7); }
    ph += f0(t) / SR;
    ph -= Math.floor(ph);
    // (a glottal pulse: a sawtooth with its corner rounded)
    const s = (2 * ph - 1) * (1 - ph * ph * 0.3) + (r() * 2 - 1) * breath;
    x[i] = lp.run(a.run(s) * 1.0 + b.run(s) * 0.6 + s * 0.05) * amp(t);
  }
  return x;
}

// ------------------------------------------------------------------ the catalogue

export type BedId =
  | "pink" | "water" | "crickets" | "murmur" | "crackle" | "gravel"
  | "car" | "light" | "heavy" | "train" | "carBed" | "lightBed" | "heavyBed" | "trainBed" | "idle"
  | "saw" | "furnace" | "crusher" | "turbine" | "pumpjack" | "hiss" | "lightmach" | "tractor" | "kiln" | "glass" | "assembly";

export type ShotId =
  | "bird0" | "bird1" | "bird2" | "bird3" | "bird4" | "owl" | "rooster" | "cow" | "dog" | "shopbell" | "children"
  | "clock" | "klaxon" | "horn" | "airbrake" | "door" | "clank" | "steam" | "blast" | "axe" | "hammer" | "handsaw"
  | "clink" | "pop";

type Recipe = (r: Rnd) => Float32Array;

export const BEDS: Record<BedId, Recipe> = {
  /** the shared noise the wind, the tyres and the far hum are filtered from */
  pink: (r) => level(loopify(filt(pink(sec(6 + FADE), r), "hp", 55, 0.7), sec(6)), 0.2),

  /** water lapping at a bank: slow swells of mid noise, and a few plips */
  water: (r) => {
    const D = 8, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    for (let k = 0; k < 14; k++) {
      const at = r() * (D + FADE - 2.1), len = 0.9 + r() * 1.1, f = 500 + r() * 900;
      const w = filt(pink(sec(len), r), "bp", (i) => f * (1 + 0.8 * (i / SR / len)), 1.4);
      shape(w, (t) => Math.sin(Math.PI * Math.min(1, t / len)) ** 2);
      mix(x, w, at * SR, 0.4 + r() * 0.6);
    }
    for (let k = 0; k < 9; k++) {
      const at = sec(r() * (D - 0.2)), f = 500 + r() * 1100, a = 0.05 + r() * 0.08;
      tone(x, at, 0.05, (t) => f * (1 + 9 * t), (t) => a * Math.exp(-t / 0.014) * Math.min(1, t / 0.002));
    }
    mix(x, filt(pink(N, r), "bp", 900, 0.5), 0, 0.12);
    return level(loopify(x, n), 0.1);
  },

  /** summer night: a few field crickets chirping at their own pace over a soft tree-cricket trill */
  crickets: (r) => {
    const D = 6, n = sec(D), x = new Float32Array(n);
    for (let c = 0; c < 4; c++) {
      const f = 4100 + r() * 900, reps = Math.round(D / (0.38 + r() * 0.3)), per = n / reps, a = 0.4 + r() * 0.6, pulses = 3 + Math.floor(r() * 2);
      for (let k = 0; k < reps; k++) {
        if (r() < 0.12) continue;
        for (let p = 0; p < pulses; p++) {
          const at = Math.round(k * per + p * sec(0.017));
          const g = new Float32Array(sec(0.012));
          tone(g, 0, 0.012, () => f, (t) => a * Math.sin(Math.PI * t / 0.012) ** 2, [1, 0.15]);
          mix(x, g, at, 1, true);
        }
      }
    }
    const tr = new Float32Array(n);
    // (the trill's pulse rate divides the loop, so it wraps without a seam)
    tone(tr, 0, D, () => 3250, (t) => 0.08 * (0.5 + 0.5 * Math.sin(TAU * 42 * t)) ** 2 * (0.7 + 0.3 * Math.sin(TAU * t / D)));
    mix(x, tr);
    return level(x, 0.07);
  },

  /** a town by day, from over the roofs: a blur of voices with no words in it */
  murmur: (r) => {
    const D = 8, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    for (let v = 0; v < 9; v++) {
      const base = 95 + r() * 140, drift = r() * TAU, gain = 0.5 + r() * 0.6;
      // syllables: when each starts and ends, and its vowel
      const syl: [number, number, number, number][] = [];
      for (let t = r() * 1.5; t < D + FADE;) {
        const words = 3 + Math.floor(r() * 7);
        for (let w = 0; w < words && t < D + FADE; w++) {
          const d = 0.1 + r() * 0.16;
          syl.push([t, t + d, 330 + r() * 480, 900 + r() * 1300]);
          t += d + 0.02 + r() * 0.07;
        }
        t += 0.3 + r() * 1.6;
      }
      let si = 0;
      const voice = vocal(r, D + FADE,
        (t) => base * (1 + 0.1 * Math.sin(TAU * 0.31 * t + drift) + 0.04 * Math.sin(TAU * 2.3 * t)),
        (t) => { while (si < syl.length - 1 && t > syl[si][1]) si++; return syl[si]?.[2] ?? 500; },
        () => syl[si]?.[3] ?? 1500,
        (t) => { const s = syl[si]; return s && t >= s[0] && t <= s[1] ? Math.sin(Math.PI * (t - s[0]) / (s[1] - s[0])) : 0; }, 0.1);
      mix(x, voice, 0, gain);
    }
    filt(x, "lp", 1700, 0.6);
    echo(x, 0.113, 0.35, 0.35);
    mix(x, filt(pink(N, r), "bp", 520, 0.5), 0, 0.5 * (0.1 / 0.16));
    return level(loopify(filt(x, "hp", 160, 0.7), n), 0.1);
  },

  /** the wireless set's surface noise: a thin hiss and the odd crackle */
  crackle: (r) => {
    const D = 5, n = sec(D), N = n + sec(FADE), x = filt(white(N, r), "bp", 3000, 0.4);
    scale(x, 0.12);
    for (let k = 0; k < 26; k++) {
      const at = sec(r() * D), a = 0.2 + r() * 0.8;
      mix(x, burst(r, 0.004, "bp", 1800 + r() * 2500, 1, 0.0008), at, a);
    }
    return level(loopify(x, n), 0.05);
  },

  /** gravel going down and a roller over it (the road tool) */
  gravel: (r) => {
    const D = 2.4, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    for (let k = 0; k < 900; k++) mix(x, burst(r, 0.006, "bp", 1200 + r() * 2800, 1.5, 0.0012), r() * N, 0.2 + r() * 0.8);
    mix(x, filt(pink(N, r), "bp", 1700, 0.6), 0, 0.5);
    mix(x, band(N, r, 70, 220), 0, 0.5);
    return level(loopify(x, n), 0.1);
  },

  car: (r) => engines(r, 2, [CAR]),
  light: (r) => engines(r, 2, [LIGHT]),
  heavy: (r) => engines(r, 2, [HEAVY]),
  train: (r) => engines(r, 2, [TRAIN, vary(TRAIN, 1.09, 0.7)]),
  carBed: (r) => engines(r, 3, [vary(CAR, 0.9), vary(CAR, 1.03, 0.9), vary(CAR, 1.19, 0.8)]),
  lightBed: (r) => engines(r, 3, [vary(LIGHT, 0.92), vary(LIGHT, 1.07, 0.85)]),
  heavyBed: (r) => engines(r, 3, [vary(HEAVY, 0.94), vary(HEAVY, 1.1, 0.85)]),
  trainBed: (r) => engines(r, 3, [vary(TRAIN, 0.96), vary(TRAIN, 1.06, 0.9), vary(TRAIN, 1.21, 0.6)]),
  idle: (r) => engines(r, 3, [vary(IDLE, 0.93), vary(IDLE, 1.08, 0.9), vary(IDLE, 1.22, 0.7)]),
  tractor: (r) => engines(r, 4, [TRACTOR]),

  /** a sawmill: the blade's whine sags and roughens as it bites through a log, then sings free again */
  saw: (r) => {
    const D = 8, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    const cuts: [number, number][] = [[0.7, 3.3], [4.7, 6.8]];
    const load = new Float32Array(N);
    let l = 0;
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      const on = cuts.some(([a, b]) => t >= a && t <= b) ? 1 : 0;
      l += (on - l) * (on ? 1 / (0.07 * SR) : 1 / (0.2 * SR));
      load[i] = l;
    }
    let ph = 0;
    const rough = filt(white(N, r), "bp", 2700, 0.8);
    for (let i = 0; i < N; i++) {
      const t = i / SR, L = load[i];
      const f = 1180 * (1 - 0.2 * L - 0.03 * L * Math.sin(TAU * 0.9 * t)) * (1 + 0.004 * Math.sin(TAU * 6.3 * t));
      ph += (TAU * f) / SR;
      const whine = Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.3 * Math.sin(3 * ph) + 0.16 * Math.sin(4 * ph) + 0.09 * Math.sin(5 * ph);
      // (the teeth tearing wood: noise gated at the tooth rate)
      const teeth = 0.55 + 0.45 * Math.sign(Math.sin(TAU * 86 * t));
      x[i] = whine * (0.1 + 0.24 * L) + rough[i] * L * teeth * 1.5;
    }
    mix(x, band(N, r, 70, 240), 0, 0.5);
    return level(loopify(filt(x, "lp", 5200, 0.6), n), 0.1);
  },

  /** a blast furnace: a low roar with the flame's flutter in it */
  furnace: (r) => {
    const D = 7, n = sec(D), N = n + sec(FADE);
    const x = scale(band(N, r, 70, 300), 2.2);
    const mid = filt(pink(N, r), "bp", 520, 0.6);
    const fl = filt(white(N, r), "lp", 6, 0.7);
    norm(fl, 1);
    for (let i = 0; i < N; i++) x[i] = x[i] * (1 + 0.25 * fl[i]) + mid[i] * 0.35 * (1 + 0.5 * fl[i]) + 0.03 * Math.sin((TAU * 62 * i) / SR);
    return level(loopify(x, n), 0.1);
  },

  /** a mine's or a quarry's crusher: rock breaking in a slow jaw rhythm over a low rumble */
  crusher: (r) => {
    const D = 6, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    for (let k = 0; k < 190; k++) {
      const at = r() * (D + FADE), jaw = 0.35 + 0.65 * Math.max(0, Math.sin(TAU * 2 * at)) ** 2;
      mix(x, burst(r, 0.05, "bp", 280 + r() * 700, 2 + r() * 3, 0.006 + r() * 0.012), at * SR, (0.2 + r() * 0.8) * jaw);
    }
    mix(x, band(N, r, 60, 180), 0, 0.5);
    const rattle = filt(pink(N, r), "bp", 1500, 0.8);
    for (let i = 0; i < N; i++) x[i] += rattle[i] * 0.1 * (0.5 + 0.5 * Math.sin((TAU * 2 * i) / SR));
    return level(loopify(x, n), 0.1);
  },

  /** a power plant: the mains hum and a turbine's high, slowly beating whine */
  turbine: (r) => {
    const D = 4, n = sec(D), x = new Float32Array(n);
    const hum: [number, number][] = [[60, 0.5], [120, 1], [180, 0.35], [240, 0.3], [360, 0.12], [1400, 0.05], [1400.5, 0.05], [2100, 0.02], [2100.75, 0.02]];
    for (const [f, a] of hum) tone(x, 0, D, () => f, () => a, [1], r() * TAU);
    const N = n + sec(FADE);
    const air = loopify(filt(pink(N, r), "bp", 2600, 0.5), n);
    mix(x, air, 0, 0.5);
    return level(x, 0.1);
  },

  /** an oil well: the pumpjack's slow stroke, its creak, and a hit-and-miss engine driving it */
  pumpjack: (r) => {
    const D = 6.4, n = sec(D), x = new Float32Array(n);
    for (let s = 0; s < 2; s++) {
      const t0 = s * 3.2;
      // the creak at the top of the stroke, the whoomp at the bottom
      const cr = new Float32Array(sec(0.5));
      tone(cr, 0, 0.5, (t) => 520 + 260 * t + 14 * Math.sin(TAU * 31 * t), (t) => 0.3 * Math.sin(Math.PI * t / 0.5) ** 2, [1, 0.5, 0.35, 0.2]);
      mix(x, cr, sec(t0 + 0.35), 1, true);
      const wh = shape(band(sec(1.1), r, 55, 170), (t) => Math.sin(Math.PI * t / 1.1) ** 2);
      mix(x, wh, sec(t0 + 1.9), 2.2, true);
      // the engine: it fires a few times, then coasts
      for (let k = 0; k < 13; k++) {
        if (k % 13 > 8 && r() < 0.8) continue;
        const pop = new Float32Array(sec(0.12));
        partial(pop, 0, 78, 0.9, 0.03); partial(pop, 0, 156, 0.5, 0.022); partial(pop, 0, 330, 0.2, 0.012);
        mix(pop, burst(r, 0.02, "bp", 600, 1, 0.004), 0, 0.3);
        mix(x, pop, sec(t0 + k * (3.2 / 13) + (r() - 0.5) * 0.012), 0.6 + r() * 0.3, true);
      }
    }
    const N = n + sec(FADE);
    mix(x, loopify(filt(pink(N, r), "bp", 400, 0.5), n), 0, 0.25);
    return level(x, 0.1);
  },

  /** a refinery or a chemical works: steam and gas under pressure, a valve letting go now and then */
  hiss: (r) => {
    const D = 7, n = sec(D), N = n + sec(FADE);
    const x = filt(white(N, r), "bp", 5200, 0.7);
    const sw = (t: number, a: number, len: number) => (t > a && t < a + len ? Math.sin(Math.PI * (t - a) / len) ** 2 : 0);
    const low = band(N, r, 70, 260);
    const mid = filt(pink(N, r), "bp", 1100, 0.6);
    for (let i = 0; i < N; i++) {
      const t = i / SR;
      x[i] = x[i] * (0.5 + 0.12 * Math.sin(TAU * t / 3.5) + 0.9 * sw(t, 1.2, 1.1) + 0.7 * sw(t, 4.6, 0.8)) + low[i] * 0.35 + mid[i] * 0.2 + 0.03 * Math.sin(TAU * 100 * t);
    }
    return level(loopify(x, n), 0.1);
  },

  /** a food plant, a creamery, a workshop: a belt ticking over, a motor, a conveyor's rattle, the odd clink */
  lightmach: (r) => {
    const D = 6, n = sec(D), x = new Float32Array(n);
    for (let k = 0; k < 36; k++) mix(x, burst(r, 0.03, "bp", k % 2 ? 1700 : 1350, 4, 0.006), (k * n) / 36, k % 4 === 0 ? 0.9 : 0.55, true);
    tone(x, 0, D, () => 120, () => 0.1, [1, 0.5, 0, 0.15]);
    const N = n + sec(FADE);
    const rat = loopify(filt(pink(N, r), "bp", 720, 1), n);
    for (let i = 0; i < n; i++) x[i] += rat[i] * 0.5 * (0.6 + 0.4 * Math.sin((TAU * 12 * i) / SR));
    for (let k = 0; k < 7; k++) { const p = new Float32Array(sec(0.2)); partial(p, 0, 2400 + r() * 2200, 0.25, 0.04); mix(x, p, r() * n, 1, true); }
    return level(x, 0.1);
  },

  /** a cement works: the kiln's slow drone and the mill grinding */
  kiln: (r) => {
    const D = 8, n = sec(D), N = n + sec(FADE), x = new Float32Array(N);
    tone(x, 0, D + FADE, () => 55, () => 0.5, [0.6, 1, 0.5, 0.2]);
    const roar = scale(band(N, r, 65, 240), 2), grit = filt(white(N, r), "bp", 520, 1.2), am = norm(filt(white(N, r), "lp", 25, 0.7), 1);
    for (let i = 0; i < N; i++) {
      const turn = 0.75 + 0.25 * Math.sin((TAU * 0.5 * i) / SR);
      x[i] = (x[i] * 0.4 + roar[i]) * turn + grit[i] * 0.6 * (0.5 + 0.5 * am[i]) * turn;
    }
    return level(loopify(x, n), 0.1);
  },

  /** a glassworks: a lighter furnace, the blowers, glass touching glass */
  glass: (r) => {
    const D = 7, n = sec(D), N = n + sec(FADE);
    const x = scale(band(N, r, 90, 420), 2);
    const air = filt(pink(N, r), "bp", 850, 0.7);
    for (let i = 0; i < N; i++) x[i] = x[i] * 0.8 + air[i] * 0.5 * (0.7 + 0.3 * Math.sin((TAU * i) / SR / 2.3));
    const out = loopify(x, n);
    level(out, 0.1);
    for (let k = 0; k < 6; k++) {
      const p = new Float32Array(sec(0.3)), f = 2900 + r() * 2600;
      partial(p, 0, f, 0.1, 0.05); partial(p, 0, f * 2.32, 0.05, 0.03);
      mix(out, p, r() * n, 1, true);
    }
    return level(out, 0.1);
  },

  /** a motor works: riveting in bursts, panels clanking, a line that never stops */
  assembly: (r) => {
    const D = 8, n = sec(D), x = new Float32Array(n);
    for (const t0 of [0.4, 2.9, 5.1, 6.6]) {
      const taps = 6 + Math.floor(r() * 5), f = 1100 + r() * 600;
      for (let k = 0; k < taps; k++) {
        const p = burst(r, 0.03, "bp", f, 3, 0.005);
        partial(p, 0, f * 1.9, 0.2, 0.01);
        mix(x, p, sec(t0 + k / 14), 0.6 + r() * 0.3, true);
      }
    }
    for (let k = 0; k < 11; k++) {
      const p = new Float32Array(sec(0.4)), f = 600 + r() * 700, a = 0.2 + r() * 0.35;
      for (const [m, g, tau] of [[1, 1, 0.09], [2.3, 0.6, 0.06], [3.7, 0.4, 0.04], [5.2, 0.25, 0.03]]) partial(p, 0, f * m, a * g, tau);
      mix(p, burst(r, 0.01, "hp", 2000, 0.7, 0.002), 0, a);
      mix(x, p, r() * n, 1, true);
    }
    for (let k = 0; k < 4; k++) mix(x, burst(r, 0.16, "hp", 4200, 0.7, 0.04, 0.004), r() * n, 0.35, true);
    tone(x, 0, D, () => 100, () => 0.12, [1, 0.5, 0.2]);
    const N = n + sec(FADE);
    mix(x, loopify(filt(pink(N, r), "bp", 600, 0.6), n), 0, 0.7);
    return level(x, 0.1);
  },
};

/** A bell: the partials of a cast bell, the low ones ringing longest. */
export function bellAt(dst: Float32Array, at: number, f: number, amp: number, ring: number): void {
  const P: [number, number, number][] = [[0.5, 0.3, 1.4], [1, 1, 1], [1.19, 0.5, 0.8], [1.5, 0.25, 0.6], [2, 0.55, 0.5], [2.51, 0.2, 0.35], [3.01, 0.15, 0.3], [4.1, 0.1, 0.2]];
  for (const [m, g, k] of P) partial(dst, at, f * m, amp * g, ring * k, undefined, m * 1.7, 0.001);
}

const birdNote = (x: Float32Array, at: number, d: number, f0: number, f1: number, a: number, bend = 0) =>
  tone(x, sec(at), d, (t) => f0 + (f1 - f0) * (t / d) + bend * Math.sin(Math.PI * t / d), (t) => a * Math.sin(Math.PI * Math.min(1, t / d)) ** 1.5, [1, 0.12, 0.04]);

export const SHOTS: Record<ShotId, Recipe> = {
  /** a sparrow: a handful of short falling chirps */
  bird0: (r) => {
    const n = 3 + Math.floor(r() * 4), x = new Float32Array(sec(1.2)), f = 4200 + r() * 900;
    for (let k = 0, t = 0.02; k < n; k++, t += 0.13 + r() * 0.08) birdNote(x, t, 0.05 + r() * 0.02, f * (1 + 0.1 * r()), f * 0.68, 0.7 + r() * 0.3);
    return norm(x, 0.6);
  },
  /** a warbler: a run of slurred notes, up and down */
  bird1: (r) => {
    const n = 6 + Math.floor(r() * 5), x = new Float32Array(sec(1.9));
    let f = 2600 + r() * 800, t = 0.02;
    for (let k = 0; k < n; k++) {
      const g = f * (0.8 + r() * 0.5), d = 0.08 + r() * 0.08;
      birdNote(x, t, d, f, clamp(g, 1900, 4400), 0.6 + r() * 0.4, (r() - 0.5) * 500);
      f = clamp(g, 1900, 4400); t += d + 0.015 + (r() < 0.25 ? 0.1 : 0);
    }
    return norm(x, 0.6);
  },
  /** a wren: a fast, dry trill */
  bird2: (r) => {
    const rate = 14 + r() * 7, len = 0.7 + r() * 0.5, x = new Float32Array(sec(len + 0.1)), f = 4300 + r() * 1100;
    for (let k = 0; k < len * rate; k++) birdNote(x, 0.01 + k / rate, 0.7 / rate, f * 1.12, f * 0.9, 0.5 + 0.5 * Math.sin((Math.PI * k) / (len * rate)));
    return norm(x, 0.5);
  },
  /** a chickadee's two clear whistles, high then low */
  bird3: (r) => {
    const x = new Float32Array(sec(1.1)), f = 3700 + r() * 500;
    birdNote(x, 0.02, 0.36, f, f * 0.99, 1);
    birdNote(x, 0.48, 0.42, f * 0.84, f * 0.83, 0.9);
    return norm(x, 0.5);
  },
  /** a dove: three soft, low coos */
  bird4: (r) => {
    const x = new Float32Array(sec(2.2)), f = 470 + r() * 60;
    const coo = (at: number, d: number, a: number) => tone(x, sec(at), d, (t) => f * (1 + 0.07 * Math.sin(Math.PI * t / d)), (t) => a * Math.sin(Math.PI * t / d) ** 2 * (1 + 0.15 * Math.sin(TAU * 27 * t)), [1, 0.2, 0.05]);
    coo(0.02, 0.35, 0.6); coo(0.5, 0.75, 1); coo(1.4, 0.5, 0.7);
    return norm(x, 0.55);
  },
  /** an owl, a long way off */
  owl: (r) => {
    const x = new Float32Array(sec(2.6)), f = 330 + r() * 40;
    for (const [at, d, a] of [[0.02, 0.28, 0.8], [0.62, 0.2, 0.7], [0.9, 0.24, 0.8], [1.5, 0.75, 1]] as const) {
      tone(x, sec(at), d, (t) => f * (1 - 0.06 * t / d), (t) => a * Math.sin(Math.PI * t / d) ** 1.2, [1, 0.12, 0.05]);
    }
    return norm(echo(x, 0.19, 0.3, 0.25), 0.55);
  },
  /** cock-a-doodle-doo */
  rooster: (r) => {
    const k = 0.9 + r() * 0.2;
    const seg: [number, number, number, number][] = [[0, 0.16, 520, 700], [0.2, 0.32, 700, 720], [0.37, 0.56, 660, 840], [0.6, 1.45, 850, 540]];
    const at = (t: number) => seg.find((s) => t >= s[0] && t <= s[1]);
    const x = vocal(r, 1.5,
      (t) => { const s = at(t); return k * (s ? s[2] + (s[3] - s[2]) * ((t - s[0]) / (s[1] - s[0])) : 600) * (1 + (t > 0.8 ? 0.02 * Math.sin(TAU * 9 * t) : 0)); },
      () => 1150, () => 2500,
      (t) => { const s = at(t); return s ? Math.sin(Math.PI * (t - s[0]) / (s[1] - s[0])) ** 0.6 : 0; }, 0.08);
    return norm(echo(fade(x), 0.14, 0.25, 0.2), 0.6);
  },
  /** a cow in the dairy's yard */
  cow: (r) => {
    const d = 1.3 + r() * 0.4, k = 0.9 + r() * 0.2;
    const x = vocal(r, d, (t) => k * (105 + 50 * Math.sin(Math.PI * Math.min(1, t / d * 1.3)) - 18 * (t / d)),
      (t) => 280 + 260 * smooth(0.1, 0.5, t / d), (t) => 850 + 250 * smooth(0.1, 0.6, t / d),
      (t) => Math.sin(Math.PI * t / d) ** 0.7, 0.04);
    return norm(echo(fade(filt(x, "lp", 1600, 0.7), 0.05, 0.1), 0.16, 0.25, 0.2), 0.6);
  },
  /** a dog, two or three barks from a yard */
  dog: (r) => {
    const n = 2 + Math.floor(r() * 2), x = new Float32Array(sec(1.3)), k = 0.85 + r() * 0.4;
    for (let b = 0, t = 0.01; b < n; b++, t += 0.24 + r() * 0.12) {
      const d = 0.11 + r() * 0.05;
      const w = vocal(r, d, (u) => k * (330 - 150 * (u / d)), () => 650 * k, () => 1450 * k, (u) => Math.min(1, u / 0.008) * Math.exp(-u / (d * 0.5)), 0.5);
      mix(x, fade(w, 0.002, 0.02), sec(t));
    }
    return norm(echo(filt(x, "lp", 2200, 0.7), 0.12, 0.3, 0.3), 0.55);
  },
  /** a shop door's bell on its spring */
  shopbell: (r) => {
    const x = new Float32Array(sec(1.1)), f = 2050 + r() * 300;
    for (const [at, a] of [[0, 1], [0.09, 0.6], [0.2, 0.45], [0.29, 0.25]] as const) {
      partial(x, sec(at), f, 0.5 * a, 0.22); partial(x, sec(at), f * 2.71, 0.22 * a, 0.12); partial(x, sec(at), f * 1.48, 0.12 * a, 0.18);
    }
    return norm(x, 0.5);
  },
  /** children playing, streets away */
  children: (r) => {
    const x = new Float32Array(sec(2.6));
    for (let k = 0, t = 0.02; k < 5; k++, t += 0.3 + r() * 0.35) {
      const d = 0.14 + r() * 0.22, f = 520 + r() * 380, up = r() < 0.6 ? 1 : -1;
      const w = vocal(r, d, (u) => f * (1 + up * 0.35 * Math.sin(Math.PI * u / d)), () => 950, () => 2300, (u) => Math.sin(Math.PI * u / d), 0.06);
      mix(x, w, sec(t), 0.5 + r() * 0.5);
    }
    return norm(echo(filt(x, "lp", 2600, 0.7), 0.17, 0.4, 0.4), 0.5);
  },
  /** the town hall clock: one stroke of a deep bell */
  clock: () => {
    const x = new Float32Array(sec(2.6));
    bellAt(x, 0, 261.6, 0.6, 1.3);
    mix(x, burst(rndFixed(), 0.02, "lp", 900, 0.7, 0.004), 0, 0.2);
    return norm(fade(x, 0.001, 0.4), 0.7);
  },
  /** a period klaxon: a-OO-ga */
  klaxon: (r) => {
    const k = 0.92 + r() * 0.16, d = 0.95;
    const f = (t: number) => k * (t < 0.2 ? 190 + 250 * (t / 0.2) ** 0.7 : t < 0.58 ? 440 + 8 * Math.sin(TAU * 11 * t) : 440 - 210 * smooth(0.58, 0.9, t));
    const x = new Float32Array(sec(d));
    let ph = 0;
    for (let i = 0; i < x.length; i++) {
      const t = i / SR;
      ph += f(t) / SR; ph -= Math.floor(ph);
      // (a rasping diaphragm: a narrow pulse)
      x[i] = (ph < 0.3 ? 1 : -0.43) * Math.min(1, t / 0.02) * Math.min(1, (d - t) / 0.12) * (t > 0.58 && t < 0.68 ? 0.6 : 1);
    }
    const a = filt(x.slice(), "bp", 1500, 1.6), b = filt(x.slice(), "bp", 2700, 2);
    for (let i = 0; i < x.length; i++) x[i] = a[i] + b[i] * 0.5 + x[i] * 0.12;
    return norm(fade(filt(x, "lp", 4200, 0.7)), 0.6);
  },
  /** a car's two-note horn: one beep or two */
  horn: (r) => {
    const two = r() < 0.5, d = two ? 0.62 : 0.4, x = new Float32Array(sec(d)), k = 0.94 + r() * 0.14;
    const on = (t: number) => (two ? ahrAt(t, 0, 0.2) + ahrAt(t, 0.3, 0.3) : ahrAt(t, 0, d - 0.02));
    const H = [1, 0.7, 0.55, 0.5, 0.4, 0.3, 0.2, 0.12];
    tone(x, 0, d, () => 370 * k, (t) => 0.5 * on(t), H);
    tone(x, 0, d, () => 466 * k, (t) => 0.45 * on(t), H);
    return norm(filt(x, "lp", 3200, 0.7), 0.55);
  },
  /** a truck's air brakes letting go at a gate */
  airbrake: (r) => {
    const d = 0.75, x = filt(white(sec(d), r), "bp", (i) => 5200 - 2600 * (i / SR / d), 0.9);
    shape(x, (t) => Math.min(1, t / 0.012) * Math.exp(-t / 0.2));
    mix(x, burst(r, 0.02, "bp", 900, 2, 0.004), 0, 0.5);
    return norm(fade(x, 0.001, 0.05), 0.5);
  },
  /** a cab door */
  door: (r) => {
    const x = new Float32Array(sec(0.35)), k = 0.9 + r() * 0.25;
    partial(x, 0, 82 * k, 1, 0.045); partial(x, 0, 190 * k, 0.5, 0.03);
    mix(x, burst(r, 0.06, "bp", 420 * k, 1.5, 0.012), 0, 0.9);
    mix(x, burst(r, 0.08, "bp", 1700, 3, 0.02), sec(0.012), 0.15);
    return norm(fade(x, 0.0008, 0.05), 0.6);
  },
  /** a hammer on iron */
  clank: (r) => {
    const x = new Float32Array(sec(0.7)), f = 480 + r() * 240;
    for (const [m, g, tau] of [[1, 0.8, 0.16], [2.58, 1, 0.12], [4.06, 0.7, 0.09], [6.27, 0.45, 0.06], [8.02, 0.3, 0.04]]) partial(x, 0, f * m, g, tau, undefined, m, 0.0006);
    mix(x, burst(r, 0.012, "hp", 2500, 0.7, 0.002), 0, 1.2);
    return norm(fade(x, 0.0005, 0.08), 0.6);
  },
  /** a boiler blowing off steam */
  steam: (r) => {
    const d = 2.4, x = filt(white(sec(d), r), "bp", (i) => 4200 + 900 * Math.sin(i / SR * 2), 0.7);
    shape(x, (t) => smooth(0, 0.07, t) * (1 - 0.3 * smooth(0.1, 1.2, t)) * (1 - smooth(1.4, d, t)));
    mix(x, shape(filt(pink(sec(d), r), "bp", 900, 0.6), (t) => smooth(0, 0.05, t) * (1 - smooth(0.6, d, t))), 0, 0.4);
    return norm(fade(x, 0.002, 0.1), 0.5);
  },
  /** a shot fired in a quarry face, far off: a thump you feel more than hear */
  blast: (r) => {
    const d = 2.6, x = new Float32Array(sec(d));
    tone(x, 0, 1.4, (t) => 52 + 60 * Math.exp(-t / 0.12), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.4), [0.6, 0.5, 0.3, 0.15]);
    mix(x, shape(scale(band(sec(d), r, 60, 320), 2), (t) => smooth(0, 0.03, t) * Math.exp(-t / 0.7)), 0, 2);
    mix(x, burst(r, 0.08, "bp", 700, 0.7, 0.02), 0, 0.5);
    // (and the rock coming down)
    for (let k = 0; k < 40; k++) mix(x, burst(r, 0.03, "bp", 300 + r() * 900, 2, 0.008), sec(0.25 + r() * 1.3), 0.12 * r());
    return norm(fade(x, 0.001, 0.4), 0.7);
  },
  /** an axe into a trunk, three or four swings */
  axe: (r) => {
    const n = 3 + Math.floor(r() * 2), x = new Float32Array(sec(n * 0.66 + 0.4));
    for (let k = 0; k < n; k++) {
      const at = sec(0.01 + k * (0.6 + r() * 0.06)), f = 260 + r() * 80;
      partial(x, at, f, 0.9, 0.035, undefined, 0, 0.0008); partial(x, at, f * 2.4, 0.6, 0.02, undefined, 0, 0.0008); partial(x, at, f * 4.1, 0.3, 0.012, undefined, 0, 0.0008);
      mix(x, burst(r, 0.03, "bp", 1900, 1, 0.005), at, 0.8);
    }
    return norm(echo(x, 0.21, 0.25, 0.2), 0.6);
  },
  /** a carpenter driving a nail */
  hammer: (r) => {
    const n = 3 + Math.floor(r() * 4), x = new Float32Array(sec(n * 0.3 + 0.3)), f = 800 + r() * 500;
    for (let k = 0, t = 0.005; k < n; k++, t += 0.24 + r() * 0.06) {
      const at = sec(t), a = 0.6 + 0.4 * (k / n);
      partial(x, at, f, a, 0.018, undefined, 0, 0.0006); partial(x, at, f * 2.1, a * 0.5, 0.012, undefined, 0, 0.0006); partial(x, at, 190, a * 0.6, 0.03);
      mix(x, burst(r, 0.015, "hp", 2200, 0.7, 0.003), at, a * 0.7);
    }
    return norm(echo(x, 0.09, 0.2, 0.15), 0.55);
  },
  /** a hand saw through a plank: push and pull */
  handsaw: (r) => {
    const n = 4 + Math.floor(r() * 3), x = new Float32Array(sec(n * 0.36 + 0.2));
    for (let k = 0; k < n; k++) {
      const push = k % 2 === 0, d = 0.3;
      const s = filt(white(sec(d), r), "bp", push ? 2600 : 1900, 1.4);
      shape(s, (t) => Math.sin(Math.PI * t / d) ** 0.8 * (0.6 + 0.4 * Math.sign(Math.sin(TAU * 55 * t))) * (push ? 1 : 0.6));
      mix(x, s, sec(0.01 + k * 0.34));
    }
    return norm(fade(x), 0.45);
  },
  /** glass set down on glass */
  clink: (r) => {
    const x = new Float32Array(sec(0.5)), f = 2800 + r() * 2400;
    partial(x, 0, f, 0.8, 0.07, undefined, 0, 0.0005); partial(x, 0, f * 2.32, 0.4, 0.04, undefined, 0, 0.0005); partial(x, sec(0.05), f * 1.12, 0.4, 0.06, undefined, 0, 0.0005);
    return norm(x, 0.4);
  },
  /** a firework: the crack, its boom, the crackle falling away */
  pop: (r) => {
    const x = new Float32Array(sec(1.5));
    mix(x, burst(r, 0.05, "bp", 1800 + r() * 1200, 0.6, 0.008, 0.0005), 0, 1);
    mix(x, shape(scale(band(sec(0.8), r, 55, 190 + r() * 80), 2), (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.18)), 0, 2.2);
    for (let k = 0; k < 60; k++) { const t = 0.15 + r() * 1.1; mix(x, burst(r, 0.004, "hp", 3000, 0.7, 0.0008), sec(t), 0.25 * (1 - t / 1.3) * r()); }
    return norm(fade(x, 0.0004, 0.2), 0.6);
  },
};

function ahrAt(t: number, at: number, d: number): number {
  const u = t - at;
  return u < 0 || u > d ? 0 : Math.min(1, u / 0.012) * Math.min(1, (d - u) / 0.03);
}

function rndFixed(): Rnd {
  let s = 12345;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** How many seeded variants of each one-shot are kept (a bird never sings the same phrase twice running). */
export const VARIANTS: Partial<Record<ShotId, number>> = {
  bird0: 4, bird1: 4, bird2: 3, bird3: 2, bird4: 2, dog: 3, clank: 3, hammer: 3, handsaw: 2, axe: 2, horn: 3, klaxon: 2, pop: 3, door: 2, clink: 3, children: 2, cow: 2,
};

/** Tidy a finished recipe: no DC, nothing over full scale, and a one-shot that starts and ends at zero. */
export function finish(x: Float32Array, loop: boolean): Float32Array {
  center(x);
  if (!loop) fade(x, 0.0015, 0.004);
  const p = peak(x);
  if (p > 0.95) scale(x, 0.95 / p);
  return x;
}
