// Pitched instruments and the drum kit, as pure recipes (docs/design.md, "Sound"): the wireless band's piano, bass
// and brushes are short rendered notes the player pitches and plays; the stings (stings.ts) are phrases written
// with the brass, clarinet, bells and the cash register here.

import { type Rnd, SR, TAU, buf, burst, clamp, drive, fade, filt, midiHz, mix, norm, partial, pink, sec, shape, smooth, tone, white } from "./dsp";
import { bellAt } from "./sounds";

/** An upright piano note: stiff-string partials, two strings a little apart, a quick strike and a long tail. */
export function pianoNote(midi: number, r: Rnd): Float32Array {
  const f0 = midiHz(midi), dur = clamp(2.5 - (midi - 36) * 0.03, 1.0, 2.5);
  const x = buf(dur);
  const B = 0.00035 * 2 ** ((midi - 60) / 14);
  const tau1 = clamp(1.0 * 2 ** ((48 - midi) / 18), 0.25, 1.4);
  for (let k = 1; k <= 16; k++) {
    const f = k * f0 * Math.sqrt(1 + B * k * k);
    if (f > 6000) break;
    // (the hammer strikes about a seventh of the way along: partials near multiples of 7 are weak)
    const a = (0.25 + 0.75 * Math.abs(Math.sin((Math.PI * k) / 7.3))) / k ** 1.1;
    const tau = tau1 / (1 + 0.3 * (k - 1)), det = 0.0009 + r() * 0.0006;
    partial(x, 0, f * (1 + det), a * 0.5, tau, undefined, r() * TAU, 0.0015);
    partial(x, 0, f * (1 - det), a * 0.4, tau * 0.85, undefined, r() * TAU, 0.0015);
    // the strike itself: a bright part that is gone in a moment
    partial(x, 0, f, a * 0.5, tau / 7, undefined, r() * TAU, 0.001);
  }
  mix(x, burst(r, 0.04, "lp", 900 + midi * 12, 0.7, 0.007), 0, 0.12);
  return norm(fade(x, 0.0008, 0.12), 0.8);
}

/** An upright bass note, plucked: a round fundamental, a woody attack, about a beat of ring. */
export function bassNote(midi: number, r: Rnd): Float32Array {
  const f0 = midiHz(midi), x = buf(1.5);
  const A = [1, 0.85, 0.55, 0.34, 0.24, 0.15, 0.1, 0.07, 0.05, 0.03];
  for (let k = 1; k <= A.length; k++) {
    partial(x, 0, k * f0 * (1 + 0.0002 * k * k), A[k - 1], 0.7 / k ** 0.55, undefined, r() * 0.5, 0.004);
  }
  mix(x, burst(r, 0.03, "bp", 700, 1.2, 0.006), 0, 0.25);
  mix(x, burst(r, 0.05, "lp", 240, 0.7, 0.015), 0, 0.3);
  return norm(fade(x, 0.001, 0.15), 0.8);
}

export type DrumId = "tap" | "swish" | "hat" | "kick" | "cym";

export const DRUMS: Record<DrumId, (r: Rnd) => Float32Array> = {
  /** a brush tapped on the snare head */
  tap: (r) => {
    const x = burst(r, 0.16, "bp", 3600, 0.6, 0.03, 0.0015);
    partial(x, 0, 195, 0.25, 0.03);
    mix(x, burst(r, 0.16, "bp", 1400, 0.8, 0.05, 0.002), 0, 0.4);
    return norm(fade(x, 0.0008, 0.03), 0.6);
  },
  /** a brush stirred across the head */
  swish: (r) => {
    const d = 0.34, x = filt(white(sec(d), r), "bp", (i) => 2400 + 1800 * Math.sin((Math.PI * i) / SR / d), 0.5);
    return norm(fade(shape(x, (t) => Math.sin((Math.PI * t) / d) ** 1.5), 0.01, 0.02), 0.4);
  },
  /** the hi-hat closing under the foot */
  hat: (r) => {
    const x = burst(r, 0.1, "hp", 6500, 0.8, 0.018, 0.001);
    mix(x, burst(r, 0.1, "bp", 4200, 3, 0.012), 0, 0.5);
    return norm(fade(x, 0.0008, 0.02), 0.45);
  },
  /** the bass drum, feathered */
  kick: (r) => {
    const x = buf(0.3);
    tone(x, 0, 0.3, (t) => 52 + 40 * Math.exp(-t / 0.02), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.07));
    mix(x, burst(r, 0.02, "lp", 500, 0.7, 0.005), 0, 0.3);
    return norm(fade(x, 0.001, 0.05), 0.7);
  },
  /** a cymbal let ring (the last bar) */
  cym: (r) => {
    const d = 2.2, x = filt(white(sec(d), r), "hp", 3800, 0.7);
    shape(x, (t) => Math.min(1, t / 0.004) * Math.exp(-t / 0.6));
    for (const f of [3120, 4470, 5210, 6830, 7450]) partial(x, 0, f, 0.12, 0.5, undefined, r() * TAU);
    return norm(fade(x, 0.001, 0.3), 0.5);
  },
};

// ------------------------------------------------------------------ the sting band

export type Inst = "brass" | "clar" | "bell" | "glock" | "horn" | "timp" | "mute";

/** Write one note of an instrument into `dst` at `at` seconds. */
export function note(dst: Float32Array, inst: Inst, midi: number, at: number, dur: number, amp: number): void {
  const f0 = midiHz(midi), a0 = sec(at);
  if (inst === "bell") { bellAt(dst, a0, f0, amp * 0.6, clamp(dur, 0.3, 3)); return; }
  if (inst === "glock") {
    for (const [m, g, k] of [[1, 1, 1], [2.76, 0.45, 0.5], [5.4, 0.2, 0.22]]) partial(dst, a0, f0 * m, amp * g * 0.7, clamp(dur, 0.1, 1.2) * k * 0.6, undefined, 0, 0.0008);
    return;
  }
  if (inst === "timp") {
    const x = buf(1.1);
    tone(x, 0, 1.1, (t) => f0 * (1 + 0.25 * Math.exp(-t / 0.02)), (t) => Math.min(1, t / 0.003) * Math.exp(-t / 0.3), [1, 0.5, 0.25, 0.1]);
    mix(x, burst(noiseOf(midi), 0.03, "lp", 700, 0.7, 0.008), 0, 0.4);
    mix(dst, fade(x, 0.001, 0.2), a0, amp);
    return;
  }
  const n = sec(dur + 0.08), x = new Float32Array(n);
  if (inst === "horn") {
    // a deep road horn: three reeds, each a little flat as the air comes on
    const H = [1, 0.9, 0.75, 0.6, 0.5, 0.4, 0.3, 0.24, 0.18, 0.12, 0.08, 0.05];
    for (const [m, g] of [[1, 1], [1.4983, 0.8], [2.52, 0.55]]) {
      tone(x, 0, dur + 0.08, (t) => f0 * m * (1 - 0.04 * Math.exp(-t / 0.05)) * (1 + 0.002 * Math.sin(TAU * 4.3 * t + m)),
        (t) => g * smooth(0, 0.07, t) * (1 - smooth(dur - 0.12, dur + 0.08, t)), H, m * 2);
    }
    norm(x, 1); drive(x, 1.6);
    filt(x, "lp", 1700, 0.7);
    mix(dst, norm(x, 1), a0, amp);
    return;
  }
  const scoop = inst === "clar" ? 0.01 : 0.025;
  const f = (t: number) => f0 * (1 - scoop * Math.exp(-t / 0.03)) * (1 + 0.0045 * Math.sin(TAU * 5.6 * t) * smooth(0.14, 0.4, t));
  const att = inst === "clar" ? 0.045 : 0.025;
  const e = (t: number) => Math.min(1, t / att) * (0.82 + 0.18 * Math.exp(-t / 0.12)) * clamp((dur + 0.06 - t) / 0.07);
  if (inst === "clar") {
    tone(x, 0, dur + 0.08, f, e, [1, 0.03, 0.42, 0.02, 0.2, 0.02, 0.09, 0, 0.04]);
    filt(x, "lp", 3200, 0.7);
  } else {
    const H: number[] = [];
    for (let k = 1; k <= 18; k++) H.push(1 / k ** 0.9);
    tone(x, 0, dur + 0.08, f, e, H);
    // the blat: the tone opens as the note speaks, and closes as it ends
    const open = inst === "mute" ? 1400 : 3600;
    filt(x, "lp", (i) => 500 + open * e(i / SR) ** 1.5, 0.9);
    if (inst === "mute") { const m = filt(x.slice(), "bp", 1600, 3); for (let i = 0; i < n; i++) x[i] = x[i] * 0.3 + m[i] * 1.6; }
  }
  mix(dst, norm(x, 1), a0, amp * (inst === "clar" ? 0.8 : 0.7));
}

function noiseOf(seed: number): Rnd {
  let s = (seed * 2654435761) >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

/** A cash register: the lever, the drawer's clunk, the bell. */
export function register(dst: Float32Array, at: number, amp: number, r: Rnd): void {
  const a = sec(at);
  const x = buf(0.2);
  partial(x, 0, 150, 0.8, 0.03); mix(x, burst(r, 0.05, "bp", 520, 1.5, 0.012), 0, 0.9);
  for (let k = 0; k < 4; k++) mix(x, burst(r, 0.006, "hp", 2200, 0.7, 0.0015), sec(0.03 + k * 0.012), 0.4);
  mix(x, burst(r, 0.06, "bp", 380, 1.2, 0.015), sec(0.085), 0.9);
  mix(dst, fade(x, 0.0008, 0.02), a, amp * 0.5);
  for (const [m, g] of [[93, 1], [96, 0.7]]) {
    const f = midiHz(m);
    partial(dst, a + sec(0.1), f, amp * 0.3 * g, 0.28, undefined, 0, 0.0008);
    partial(dst, a + sec(0.1), f * 2.76, amp * 0.12 * g, 0.12, undefined, 0, 0.0008);
  }
}

/** A puff of air: breath on a reed, wind in a sting's tail. */
export function air(dur: number, f: number, r: Rnd): Float32Array {
  return shape(filt(pink(sec(dur), r), "bp", f, 0.8), (t) => Math.sin((Math.PI * t) / dur) ** 2);
}
