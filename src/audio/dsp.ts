// Small pure DSP kit the sound recipes are written with (docs/design.md, "Sound"). Everything the game plays is
// synthesized: the recipes in sounds.ts compute short buffers with these (noise, filters, decaying partials), and
// the Web Audio side plays, loops, pitches and mixes them. No AudioContext here, so it all runs in Vitest.

import { mulberry32 } from "../core/noise";

/** Sample rate the recipes are computed at (the context resamples on playback; 12 kHz of bandwidth is plenty). */
export const SR = 24000;
export type Rnd = () => number;
export const rnd = mulberry32;
export const TAU = Math.PI * 2;
/** Seconds as a whole number of samples. */
export const sec = (s: number) => Math.max(1, Math.round(s * SR));
export const buf = (s: number) => new Float32Array(sec(s));
export const midiHz = (m: number) => 440 * 2 ** ((m - 69) / 12);
export const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
export const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

export type FilterType = "lp" | "hp" | "bp";

/** An RBJ biquad (transposed direct form II). `bp` peaks at 0 dB. */
export class Biquad {
  private b0 = 1; private b1 = 0; private b2 = 0; private a1 = 0; private a2 = 0;
  private z1 = 0; private z2 = 0;
  constructor(type?: FilterType, f?: number, q?: number) { if (type && f) this.set(type, f, q); }
  set(type: FilterType, f: number, q = 0.707) {
    const w = TAU * clamp(f, 10, SR * 0.47) / SR, c = Math.cos(w), al = Math.sin(w) / (2 * q), a0 = 1 + al;
    if (type === "lp") { this.b0 = (1 - c) / 2 / a0; this.b1 = (1 - c) / a0; this.b2 = this.b0; }
    else if (type === "hp") { this.b0 = (1 + c) / 2 / a0; this.b1 = -(1 + c) / a0; this.b2 = this.b0; }
    else { this.b0 = al / a0; this.b1 = 0; this.b2 = -al / a0; }
    this.a1 = (-2 * c) / a0; this.a2 = (1 - al) / a0;
  }
  run(x: number): number {
    const y = this.b0 * x + this.z1;
    this.z1 = this.b1 * x - this.a1 * y + this.z2;
    this.z2 = this.b2 * x - this.a2 * y;
    return y;
  }
}

export function white(n: number, r: Rnd): Float32Array {
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = r() * 2 - 1;
  return x;
}

/** Pink noise (Paul Kellet's filter), about ±1. */
export function pink(n: number, r: Rnd): Float32Array {
  const x = new Float32Array(n);
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < n; i++) {
    const w = r() * 2 - 1;
    b0 = 0.99886 * b0 + w * 0.0555179; b1 = 0.99332 * b1 + w * 0.0750759; b2 = 0.969 * b2 + w * 0.153852;
    b3 = 0.8665 * b3 + w * 0.3104856; b4 = 0.55 * b4 + w * 0.5329522; b5 = -0.7616 * b5 - w * 0.016898;
    x[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.16;
    b6 = w * 0.115926;
  }
  return x;
}

/** Brown noise (a leaky integrator), about ±1. */
export function brown(n: number, r: Rnd): Float32Array {
  const x = new Float32Array(n);
  let y = 0;
  for (let i = 0; i < n; i++) { y = (y + 0.02 * (r() * 2 - 1)) / 1.02; x[i] = y * 3.5; }
  return x;
}

/**
 * Noise between two frequencies (pink, cut below `lo` and above `hi`). What the low roars are made of: plain brown
 * noise puts most of its power under 60 Hz, where a small speaker plays nothing and headphones only thud.
 */
export function band(n: number, r: Rnd, lo: number, hi: number): Float32Array {
  return filt(filt(pink(n, r), "hp", lo, 0.7), "lp", hi, 0.7);
}

/** Filter in place; `f` may be a function of the sample index (coefficients are then refreshed every 32 samples). */
export function filt(x: Float32Array, type: FilterType, f: number | ((i: number) => number), q = 0.707): Float32Array {
  const b = new Biquad();
  if (typeof f === "number") { b.set(type, f, q); for (let i = 0; i < x.length; i++) x[i] = b.run(x[i]); }
  else for (let i = 0; i < x.length; i++) { if ((i & 31) === 0) b.set(type, f(i), q); x[i] = b.run(x[i]); }
  return x;
}

export function scale(x: Float32Array, g: number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= g;
  return x;
}

/** Multiply by an envelope given as a function of time in seconds. */
export function shape(x: Float32Array, e: (t: number) => number): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] *= e(i / SR);
  return x;
}

/** Add `src` into `dst` from sample `at` (wrapping round when `wrap`, for loops). */
export function mix(dst: Float32Array, src: Float32Array, at = 0, g = 1, wrap = false): Float32Array {
  const n = dst.length;
  at = Math.round(at);
  for (let i = 0; i < src.length; i++) {
    let j = at + i;
    if (j >= n) { if (!wrap) break; j %= n; }
    if (j >= 0) dst[j] += src[i] * g;
  }
  return dst;
}

/** Raised-cosine fades at both ends (seconds), so a one-shot starts and ends at zero. */
export function fade(x: Float32Array, a = 0.003, r = 0.01): Float32Array {
  const na = Math.min(x.length >> 1, sec(a)), nr = Math.min(x.length >> 1, sec(r));
  for (let i = 0; i < na; i++) x[i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / na);
  for (let i = 0; i < nr; i++) x[x.length - 1 - i] *= 0.5 - 0.5 * Math.cos((Math.PI * i) / nr);
  return x;
}

export function peak(x: Float32Array): number {
  let m = 0;
  for (let i = 0; i < x.length; i++) { const a = Math.abs(x[i]); if (a > m) m = a; }
  return m;
}

export function rms(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i] * x[i];
  return Math.sqrt(s / Math.max(1, x.length));
}

export function dc(x: Float32Array): number {
  let s = 0;
  for (let i = 0; i < x.length; i++) s += x[i];
  return s / Math.max(1, x.length);
}

/** The biggest jump between neighbouring samples (a click shows as one far above the rest). */
export function maxStep(x: Float32Array, wrap = false): number {
  let m = wrap && x.length ? Math.abs(x[0] - x[x.length - 1]) : 0;
  for (let i = 1; i < x.length; i++) { const a = Math.abs(x[i] - x[i - 1]); if (a > m) m = a; }
  return m;
}

/** Take the mean out. */
export function center(x: Float32Array): Float32Array {
  const d = dc(x);
  for (let i = 0; i < x.length; i++) x[i] -= d;
  return x;
}

/** Scale so the loudest sample is `p`. */
export function norm(x: Float32Array, p = 0.8): Float32Array {
  const m = peak(x);
  return m > 1e-9 ? scale(x, p / m) : x;
}

/** Scale to an RMS level, backing off if that would push a peak over `maxPeak`. */
export function level(x: Float32Array, r = 0.1, maxPeak = 0.9): Float32Array {
  const have = rms(x);
  if (have < 1e-9) return x;
  let g = r / have;
  const m = peak(x) * g;
  if (m > maxPeak) g *= maxPeak / m;
  return scale(x, g);
}

/** A soft clip: straight below about half scale, easing into ±1. */
export function drive(x: Float32Array, d = 1): Float32Array {
  for (let i = 0; i < x.length; i++) x[i] = Math.tanh(x[i] * d);
  return x;
}

/**
 * Make a seamless loop of `n` samples from a longer take: the extra tail is crossfaded (equal power) over the head,
 * so the last sample runs on into the first.
 */
export function loopify(x: Float32Array, n: number): Float32Array {
  const f = x.length - n, out = x.slice(0, n);
  for (let i = 0; i < f; i++) {
    const th = (i / f) * (Math.PI / 2);
    out[i] = x[i] * Math.sin(th) + x[n + i] * Math.cos(th);
  }
  return out;
}

/**
 * Add one decaying sine partial: `f` Hz, peak `amp`, time constant `tau` seconds, from sample `at` for `dur` seconds
 * (to the end of the buffer when left out). A 2 ms attack keeps it from clicking; a recursive oscillator keeps it cheap.
 */
export function partial(dst: Float32Array, at: number, f: number, amp: number, tau: number, dur?: number, ph = 0, attack = 0.002): void {
  if (f >= SR * 0.48 || amp === 0) return;
  const w = (TAU * f) / SR, k = 2 * Math.cos(w), na = sec(attack);
  const end = Math.min(dst.length, dur === undefined ? dst.length : at + sec(dur));
  let y1 = Math.sin(ph - w), y2 = Math.sin(ph - 2 * w), e = amp;
  const d = Math.exp(-1 / (tau * SR));
  for (let i = Math.max(0, at), j = 0; i < end; i++, j++) {
    const y = k * y1 - y2;
    y2 = y1; y1 = y;
    dst[i] += y * e * (j < na ? j / na : 1);
    e *= d;
  }
}

/** A phase-accumulating tone whose frequency and level follow functions of time; `harm` lists harmonic amplitudes. */
export function tone(dst: Float32Array, at: number, dur: number, f: (t: number) => number, a: (t: number) => number, harm: readonly number[] = [1], ph0 = 0): void {
  const n = Math.min(dst.length - at, sec(dur));
  let ph = ph0;
  for (let i = 0; i < n; i++) {
    const t = i / SR, fr = f(t), am = a(t);
    ph += (TAU * fr) / SR;
    if (am === 0) continue;
    let y = 0;
    for (let h = 0; h < harm.length; h++) if (harm[h] && fr * (h + 1) < SR * 0.45) y += harm[h] * Math.sin(ph * (h + 1));
    dst[at + i] += y * am;
  }
}

/** A burst of filtered noise: the stuff of clicks, knocks, puffs and thumps. */
export function burst(r: Rnd, dur: number, type: FilterType, f: number, q: number, tau: number, attack = 0.001): Float32Array {
  const x = filt(white(sec(dur), r), type, f, q);
  const na = sec(attack);
  for (let i = 0; i < x.length; i++) x[i] *= Math.exp(-i / (tau * SR)) * (i < na ? i / na : 1);
  return x;
}

/** A plain echo, for something heard across a field. */
export function echo(x: Float32Array, delay: number, fb: number, wet: number): Float32Array {
  const d = sec(delay);
  const out = new Float32Array(x.length);
  for (let i = 0; i < x.length; i++) {
    const e = i >= d ? out[i - d] : 0;
    out[i] = x[i] + e * fb;
  }
  for (let i = 0; i < x.length; i++) x[i] = x[i] * (1 - wet) + out[i] * wet;
  return x;
}

/** attack / hold / release envelope value at `t` for a note of length `d` (seconds). */
export function ahr(t: number, d: number, a: number, r: number): number {
  if (t < 0 || t > d) return 0;
  return Math.min(1, t / a) * Math.min(1, (d - t) / r);
}
