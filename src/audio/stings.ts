// The moments (docs/design.md, "Sound"): short phrases for a milestone, a new town, a season, a convoy, a landmark.
// All in F major (mostly its five-note scale), which every tune the wireless plays sits well with (music/compose.ts
// keeps to F, B flat, C, G and their minors). Each is written as a small score and rendered once into a buffer.

import { type Rnd, fade, level, rnd, sec, mix } from "./dsp";
import { type Inst, air, note, register } from "./instruments";

export type StingId =
  | "milestone" | "money" | "newTown" | "townGrew" | "spring" | "summer" | "autumn" | "winter"
  | "convoyOut" | "convoyIn" | "landmark" | "orderDone" | "orderOpen" | "spoil" | "gaveUp" | "church" | "dedication";

/** [instrument, MIDI note, start (s), length (s), level] */
type N = [Inst, number, number, number, number];

interface Score { len: number; notes: N[]; reg?: number; /** its loudness (RMS), when not the usual */ lvl?: number; extra?: (x: Float32Array, r: Rnd) => void }

// F major: F3 53, A3 57, C4 60, D4 62, F4 65, G4 67, A4 69, C5 72, D5 74, F5 77, G5 79, A5 81, C6 84, D6 86, F6 89
const chord = (inst: Inst, ms: number[], t: number, d: number, g: number): N[] => ms.map((m) => [inst, m, t, d, g] as N);

export const STINGS: Record<StingId, Score> = {
  // a small brass-and-bell fanfare, and the till rings
  milestone: {
    len: 2.7,
    notes: [
      ["brass", 72, 0, 0.13, 0.8], ["brass", 77, 0.15, 0.13, 0.85], ["brass", 81, 0.3, 0.13, 0.9], ["brass", 84, 0.45, 0.85, 1],
      ["brass", 69, 0, 0.13, 0.5], ["brass", 72, 0.15, 0.13, 0.5], ["brass", 77, 0.3, 0.13, 0.55], ["brass", 81, 0.45, 0.85, 0.6], ["brass", 65, 0.45, 0.85, 0.5],
      ["timp", 41, 0.45, 1, 0.6], ["bell", 77, 0.45, 1.3, 0.5], ["glock", 96, 0.45, 0.8, 0.3],
    ],
    reg: 1.3,
  },
  // money landing: the till and two coins
  money: { len: 1.1, notes: [["glock", 98, 0.3, 0.5, 0.35], ["glock", 101, 0.42, 0.6, 0.35]], reg: 0 },
  // a town springs up: a bell, and a figure climbing to meet it
  newTown: {
    len: 2.9,
    notes: [
      ["bell", 65, 0, 2.2, 0.8],
      ["clar", 65, 0.18, 0.1, 0.5], ["clar", 67, 0.3, 0.1, 0.55], ["clar", 69, 0.42, 0.1, 0.6], ["clar", 72, 0.54, 0.1, 0.65], ["clar", 74, 0.66, 0.1, 0.7], ["clar", 77, 0.78, 0.6, 0.75],
      ["glock", 81, 0.78, 0.8, 0.4], ["glock", 84, 0.98, 0.9, 0.4], ["bell", 72, 0.78, 1.5, 0.4],
    ],
  },
  // a town grown a size
  townGrew: { len: 1.9, notes: [...chord("brass", [65, 69, 72], 0, 0.7, 0.4), ["glock", 81, 0.1, 0.6, 0.4], ["glock", 84, 0.28, 0.6, 0.4], ["glock", 89, 0.46, 0.9, 0.45]] },
  // the seasons' title cards: four notes each
  spring: {
    len: 1.7,
    notes: [
      ["clar", 72, 0, 0.11, 0.6], ["clar", 74, 0.16, 0.11, 0.65], ["clar", 77, 0.32, 0.11, 0.7], ["clar", 81, 0.48, 0.5, 0.75],
      ["glock", 84, 0, 0.3, 0.3], ["glock", 86, 0.16, 0.3, 0.3], ["glock", 89, 0.32, 0.3, 0.32], ["glock", 93, 0.48, 0.9, 0.35],
    ],
  },
  summer: { len: 2.1, notes: [["brass", 65, 0, 0.22, 0.6], ["brass", 69, 0.26, 0.22, 0.65], ["brass", 72, 0.52, 0.22, 0.7], ["brass", 77, 0.78, 0.8, 0.8], ["clar", 53, 0, 1.6, 0.4], ["clar", 60, 0.78, 0.8, 0.3]] },
  autumn: { len: 2.4, notes: [["clar", 74, 0, 0.3, 0.7], ["clar", 72, 0.34, 0.3, 0.65], ["clar", 69, 0.68, 0.3, 0.6], ["clar", 62, 1.02, 0.9, 0.7], ["bell", 62, 1.02, 1.3, 0.3], ["clar", 57, 1.02, 0.9, 0.3]] },
  winter: { len: 3, notes: [["glock", 81, 0, 0.9, 0.5], ["glock", 77, 0.42, 0.9, 0.45], ["glock", 74, 0.84, 0.9, 0.4], ["bell", 72, 1.26, 1.6, 0.45], ["glock", 72, 1.26, 1.2, 0.3]] },
  // an oversized load: a deep horn as it sets off (short, long), and a long one and two notes as it gets there
  convoyOut: { len: 2.2, notes: [["horn", 41, 0, 0.3, 0.9], ["horn", 41, 0.5, 1.25, 1]] },
  convoyIn: { len: 2.6, notes: [["horn", 41, 0, 0.9, 0.9], ["brass", 72, 0.95, 0.14, 0.6], ["brass", 77, 1.11, 0.6, 0.7], ["brass", 69, 1.11, 0.6, 0.4], ["bell", 65, 1.11, 1.3, 0.5]] },
  // a landmark opens: the full fanfare (the fireworks' pops are played as they burst)
  landmark: {
    len: 4.2,
    notes: [
      ...chord("brass", [65, 69, 72], 0, 0.27, 0.6), ...chord("brass", [65, 69, 72], 0.32, 0.09, 0.5), ...chord("brass", [65, 69, 72], 0.45, 0.27, 0.6),
      ...chord("brass", [69, 72, 77], 0.8, 0.27, 0.65), ...chord("brass", [69, 72, 77], 1.12, 0.09, 0.55), ...chord("brass", [69, 72, 77], 1.25, 0.27, 0.65),
      ...chord("brass", [72, 77, 81], 1.6, 1.7, 0.7), ["brass", 84, 1.6, 1.7, 0.75], ["brass", 53, 1.6, 1.7, 0.5],
      ["timp", 41, 0, 1, 0.7], ["timp", 48, 0.8, 1, 0.7], ["timp", 41, 1.6, 1, 0.8], ["timp", 41, 1.78, 1, 0.5], ["timp", 41, 1.96, 1, 0.6],
      ["bell", 65, 1.6, 2.2, 0.6], ["bell", 72, 2.0, 1.8, 0.4], ["bell", 77, 2.4, 1.6, 0.35],
      ["glock", 84, 1.6, 0.8, 0.3], ["glock", 89, 1.8, 0.8, 0.3], ["glock", 93, 2.0, 0.8, 0.3], ["glock", 96, 2.2, 1, 0.32],
    ],
  },
  // a town's order filled
  orderDone: { len: 1.7, notes: [["brass", 72, 0, 0.12, 0.7], ["brass", 77, 0.14, 0.4, 0.8], ["brass", 69, 0, 0.12, 0.4], ["brass", 72, 0.14, 0.4, 0.45], ["glock", 81, 0.14, 0.5, 0.35], ["glock", 84, 0.3, 0.6, 0.35]], reg: 0.6 },
  // a town asks for something: two notes on the counter bell
  orderOpen: { len: 1.1, notes: [["glock", 84, 0, 0.5, 0.5], ["glock", 81, 0.15, 0.7, 0.45], ["bell", 77, 0, 0.6, 0.15]] },
  // a load spoiled on the road: a small falling figure
  spoil: { len: 1.6, lvl: 0.1, notes: [["clar", 72, 0, 0.19, 0.7], ["clar", 69, 0.22, 0.19, 0.6], ["clar", 65, 0.44, 0.19, 0.5], ["clar", 62, 0.66, 0.65, 0.45]] },
  // a driver gives up in a jam: two muted notes sinking, and a sigh
  gaveUp: {
    len: 1.5,
    notes: [["mute", 57, 0, 0.3, 0.8], ["mute", 53, 0.34, 0.62, 0.7]],
    extra: (x, r) => { mix(x, air(0.7, 900, r), sec(0.55), 0.25); },
  },
  // Sunday: one toll of the church bell (struck several times by the director)
  church: { len: 2.6, notes: [["bell", 65, 0, 2.2, 0.9]] },
  // the station's ident before a dedication: four soft chimes climbing, a held bell under the last (quieter than
  // the moments: it is the station talking, not the game)
  dedication: {
    len: 2.4,
    lvl: 0.09,
    notes: [["glock", 77, 0, 0.5, 0.42], ["glock", 81, 0.2, 0.5, 0.42], ["glock", 84, 0.4, 0.5, 0.44], ["glock", 86, 0.6, 1.2, 0.46], ["bell", 65, 0.6, 1.6, 0.3], ["bell", 72, 0.6, 1.4, 0.18]],
  },
};

export const STING_IDS = Object.keys(STINGS) as StingId[];

/** Render a sting. */
export function renderSting(id: StingId): Float32Array {
  const S = STINGS[id], r = rnd(STING_IDS.indexOf(id) * 97 + 5);
  const x = new Float32Array(sec(S.len));
  for (const [inst, m, t, d, g] of S.notes) note(x, inst, m, t, d, g);
  if (S.reg !== undefined) register(x, S.reg, 0.9, r);
  S.extra?.(x, r);
  // (one loudness for them all, however many notes: none louder than 0.7 at its peak)
  return level(fade(x, 0.001, 0.25), S.lvl ?? 0.13, 0.7);
}
