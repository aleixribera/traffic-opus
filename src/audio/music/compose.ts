// The wireless's band, on paper (docs/design.md, "Sound"): given a seed and a mood, write a whole tune for a small
// swing combo: a form and its changes, a walking bass, piano comping, a head with a motif that comes back, solo
// choruses traded between the lead horn and the piano, a tag and a last chord. Pure and seeded: the same seed
// writes the same tune, a different one never does. music/player.ts performs it; tests/audio.music.test.ts holds
// it to its rules (every note accounted for by its chord, the bass on the root at each change, phrases that breathe).
//
// Time is in beats on a straight grid (four to the bar, off-beat eighths at .5); the player swings it.

import { mulberry32 } from "../../core/noise";

export type Mood = "day" | "night" | "winterDay" | "winterNight";
export type FormId = "blues" | "aaba" | "minorBlues" | "ballad";
export type Quality = "6" | "7" | "m7" | "m6" | "dim" | "m7b5";
export interface Chord { root: number; q: Quality }
/**
 * Why a note is allowed: the chord's root, a chord tone, a comping extension (9th, 13th), a tone of the chord's
 * scale, a blue note of the key, or an approach note a semitone from the chord tone that follows it.
 */
export type Role = "root" | "tone" | "ext" | "scale" | "blue" | "approach";
export type Voice = "lead" | "piano" | "comp" | "bass" | "tap" | "swish" | "hat" | "kick" | "cym";
export interface Note {
  /** start and length in beats, MIDI pitch (0 for drums), loudness 0..1 */
  t: number; d: number; m: number; v: number;
  i: Voice;
  role?: Role;
  /** the chord a comping note voices (a pushed chord sounds half a beat before its bar) */
  ch?: Chord;
  /** a horn's scoop up into the note, or its fall away at the end */
  bend?: "scoop" | "fall";
}
export type Section = "intro" | "head" | "solo" | "out" | "tag" | "end";
export interface Bar {
  chords: Chord[];
  sec: Section;
  /** who has the tune in this bar */
  solo: "lead" | "piano" | null;
  /** the bass: two in the bar, or walking in four */
  feel: "two" | "four";
  /** the bar's place in its chorus (0-based), -1 outside a chorus */
  idx: number;
}
export interface Tune {
  seed: number;
  name: string;
  form: FormId;
  /** tonic pitch class (0 = C) */
  key: number;
  minor: boolean;
  bpm: number;
  /** where the off-beat eighth falls in the beat (0.5 straight, 0.667 a triplet) */
  swing: number;
  lead: "trumpet" | "clarinet";
  mood: Mood;
  bars: Bar[];
  notes: Note[];
  /** length in beats, the last chord's ring included */
  beats: number;
}

export const TONES: Record<Quality, number[]> = { "6": [0, 4, 7, 9], "7": [0, 4, 7, 10], m7: [0, 3, 7, 10], m6: [0, 3, 7, 9], dim: [0, 3, 6, 9], m7b5: [0, 3, 6, 10] };
export const SCALES: Record<Quality, number[]> = {
  "6": [0, 2, 4, 5, 7, 9, 11], "7": [0, 2, 4, 5, 7, 9, 10], m7: [0, 2, 3, 5, 7, 9, 10], m6: [0, 2, 3, 5, 7, 9, 11],
  dim: [0, 2, 3, 5, 6, 8, 9, 11], m7b5: [0, 1, 3, 5, 6, 8, 10],
};
/** Notes a comping hand may add above the chord's own. */
export const EXT: Record<Quality, number[]> = { "6": [2], "7": [2, 9], m7: [2], m6: [2], dim: [], m7b5: [] };
export const BLUES = [0, 3, 5, 6, 7, 10];
/** How many bars a chorus of each form has. */
export const FORM_BARS: Record<FormId, number> = { blues: 12, aaba: 32, minorBlues: 12, ballad: 16 };

/** The ranges the parts are written in (MIDI). */
export const RANGE = { bass: [28, 50], lead: [58, 84], piano: [60, 91], comp: [45, 76] } as const;

type Rnd = () => number;
const pc = (m: number) => ((m % 12) + 12) % 12;
const has = (ch: Chord, m: number, set: Record<Quality, number[]>) => set[ch.q].includes(pc(m - ch.root));
export const isTone = (ch: Chord, m: number) => has(ch, m, TONES);
export const inScale = (ch: Chord, m: number) => has(ch, m, SCALES);
const pick = <T>(r: Rnd, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)];
const C = (key: number, off: number, q: Quality): Chord => ({ root: pc(key + off), q });

// ------------------------------------------------------------------ forms

/** One chorus of a form in a key: its bars, each one or two chords (two: the second from beat three). */
export function chorus(form: FormId, key: number, r: Rnd, last = false): Chord[][] {
  const k = (off: number, q: Quality) => C(key, off, q);
  if (form === "blues") {
    const quick = r() < 0.6, dim = r() < 0.35, six = r() < 0.7;
    return [
      [k(0, "7")], [quick ? k(5, "7") : k(0, "7")], [k(0, "7")], [k(0, "7")],
      [k(5, "7")], [dim ? k(6, "dim") : k(5, "7")], [k(0, "7")], [six ? k(9, "7") : k(0, "7")],
      [k(2, "m7")], [k(7, "7")], last ? [k(0, "7")] : [k(0, "7"), k(9, "7")], last ? [k(0, "7")] : [k(2, "m7"), k(7, "7")],
    ];
  }
  if (form === "minorBlues") {
    return [
      [k(0, "m7")], [k(5, "m7")], [k(0, "m7")], [k(0, "m7")],
      [k(5, "m7")], [k(5, "m7")], [k(0, "m7")], [k(0, "m7")],
      [k(8, "7")], [k(7, "7")], [k(0, "m7")], last ? [k(0, "m7")] : [k(2, "m7b5"), k(7, "7")],
    ];
  }
  if (form === "aaba") {
    const dim = r() < 0.5;
    const A = (close: boolean): Chord[][] => [
      [k(0, "6"), k(9, "m7")], [k(2, "m7"), k(7, "7")], [k(0, "6"), k(9, "m7")], [k(2, "m7"), k(7, "7")],
      [k(0, "6"), k(0, "7")], [k(5, "6"), dim ? k(6, "dim") : k(5, "m6")],
      ...(close ? [[k(0, "6"), k(7, "7")], [k(0, "6")]] : [[k(0, "6"), k(9, "m7")], [k(2, "m7"), k(7, "7")]]),
    ];
    const B: Chord[][] = [[k(4, "7")], [k(4, "7")], [k(9, "7")], [k(9, "7")], [k(2, "7")], [k(2, "7")], [k(7, "7")], [k(7, "7")]];
    const end = A(true);
    if (!last) end[7] = [k(0, "6"), k(7, "7")];
    return [...A(false), ...A(true), ...B, ...end];
  }
  // a ballad: sixteen bars, AABA in fours
  const A = (close: boolean): Chord[][] => [
    [k(0, "6"), k(9, "m7")], [k(2, "m7"), k(7, "7")],
    ...(close ? [[k(0, "6"), k(5, "6")], [k(0, "6")]] : [[k(0, "6"), k(9, "7")], [k(2, "m7"), k(7, "7")]]),
  ];
  const end = A(true);
  if (!last) end[3] = [k(0, "6"), k(7, "7")];
  return [...A(false), ...A(true), [k(0, "7")], [k(5, "6")], [k(2, "7")], [k(7, "7")], ...end];
}

/** The chord sounding at a beat. */
export function chordAt(bars: Bar[], t: number): Chord {
  const b = bars[Math.max(0, Math.min(bars.length - 1, Math.floor(t / 4 + 1e-9)))];
  return b.chords.length > 1 && t - Math.floor(t / 4 + 1e-9) * 4 >= 2 - 1e-9 ? b.chords[1] : b.chords[0];
}

// ------------------------------------------------------------------ names

export interface NameSource { towns: string[]; company: string }

const NAMES: Record<"swing" | "blues" | "ballad" | "winter", string[]> = {
  swing: [
    "{T} Stomp", "{T} Jump", "{T} Shuffle", "{T} Strut", "{T} Rag", "{T} Bounce", "{T} Turnaround", "Payday in {T}", "Swinging Down the {T} Road",
    "{C} Special", "{C} Jump", "The {C} Stomp", "Low Gear Shuffle", "Double Clutch Stomp", "Tailgate Ramble", "Ten Ton Bounce", "Flatbed Hop",
    "Weighbridge Stomp", "Six Wheel Swing", "Full Load Jump", "{T} Hop", "{T} Parade", "Saturday Night in {T}", "{T} Two-Step", "Market Day in {T}",
    "The {T} Flyer", "{C} Bounce", "{C} on the Move", "Green Light Jump", "Crossroads Stomp", "Gravel Road Rag", "Downhill and Loaded", "Top Gear Swing",
    "Tin Roof Strut", "Mill Whistle Jump", "New Bridge Bounce", "Kilometre Zero Stomp", "Dust on the {T} Road", "Wide Load Shuffle",
  ],
  blues: [
    "Night Freight Blues", "{T} Blues", "{T} Road Blues", "Empty Yard Blues", "Last Load Blues", "Two A.M. Diesel", "{C} Blues", "Slow Haul Blues",
    "Lamplight Blues", "Graveyard Shift Moan", "Long Way to {T}", "Back Road Blues", "Depot Clock Blues", "{T} After Dark", "Late Run to {T}",
    "Midnight at the {C} Yard", "Headlamp Blues", "Night Shift at {T}", "Waiting at the Gate Blues", "Low Beam Blues", "Furnace Glow Blues",
    "Three Towns Behind Blues", "Queue at the Crossing", "Sleeping {T} Blues", "Slow Road Moan",
  ],
  ballad: [
    "Lullaby for {T}", "{T} Serenade", "Moon over {T}", "The Lamps of {T}", "The Road Home", "Sweet {T} Evening", "A Light in the Depot", "Goodnight, {T}",
    "Stars over {T}", "When the Mill Is Quiet", "{T} Nocturne", "The Last Lamp in {T}", "Home by Morning", "A Letter from {T}", "Quiet Streets of {T}", "River Mist",
  ],
  winter: [
    "Snow on the {T} Road", "Frost Line Blues", "{T} in the Snow", "Cold Morning Start", "Chains On", "Iced Over Blues", "Thaw at {T}", "Stove Corner Blues",
    "First Frost in {T}", "White Fields", "{T} Under Snow", "Short Days Blues", "Frozen Radiator Rag", "Smoke from Every Chimney", "Waiting on the Thaw",
    "{C} Winter Run", "Lanterns in the Snow",
  ],
};

const FIRM_WORDS = /^(&|and|sons?|bros\.?|brothers|haulage|freight|co\.?|company|lines?|transport|trucking|cartage|motors?|express|inc\.?|ltd\.?|carriers?|hauling|haulers|the|of)$/i;

/** A company's name as a band would say it: "Carver & Sons Haulage" is "Carver". */
export function firmShort(name: string): string {
  const words = name.split(/\s+/).filter(Boolean);
  let i = words[0]?.toLowerCase() === "the" ? 1 : 0;
  const keep: string[] = [];
  for (; i < words.length && !FIRM_WORDS.test(words[i]); i++) keep.push(words[i]);
  return keep.join(" ") || words[0] || "Company";
}

export function tuneName(r: Rnd, mood: Mood, form: FormId, src: NameSource): string {
  const style = mood.startsWith("winter") && r() < 0.6 ? "winter" : form === "ballad" ? "ballad" : form === "minorBlues" || mood === "night" ? "blues" : "swing";
  const town = src.towns.length ? pick(r, src.towns) : "Kilometre Zero";
  let tpl = pick(r, NAMES[style]);
  // (a save with no town yet: no line that needs one twice over)
  if (!src.company && tpl.includes("{C}")) tpl = "{T} Special";
  return tpl.replace("{T}", town).replace("{C}", firmShort(src.company));
}

// ------------------------------------------------------------------ the plan: which bars, who plays

interface Plan { form: FormId; key: number; minor: boolean; bpm: number; swing: number; lead: "trumpet" | "clarinet"; sparse: number; bars: Bar[] }

function plan(r: Rnd, mood: Mood): Plan {
  const winter = mood.startsWith("winter"), night = mood === "night" || mood === "winterNight";
  const form: FormId = mood === "day" ? (r() < 0.55 ? "blues" : "aaba")
    : mood === "night" ? pick(r, ["blues", "minorBlues", "ballad"] as const)
    : mood === "winterDay" ? pick(r, ["minorBlues", "ballad", "minorBlues"] as const)
    : pick(r, ["ballad", "minorBlues"] as const);
  const minor = form === "minorBlues";
  // (F, B flat, C and G, or D, G and A minor: the keys the stings' F major sits in)
  const key = minor ? pick(r, [2, 7, 9]) : pick(r, [5, 10, 0, 7]);
  const bpm = Math.round(
    mood === "day" ? (form === "aaba" ? 136 + r() * 36 : 118 + r() * 44)
    : form === "ballad" ? 58 + r() * 12
    : mood === "winterDay" ? 84 + r() * 20
    : 62 + r() * 18);
  const swing = bpm > 150 ? 0.6 : bpm > 110 ? 0.635 : 0.667;
  const lead = r() < (winter ? 0.75 : night ? 0.5 : 0.35) ? "clarinet" : "trumpet";
  const sparse = winter ? 1.6 : night ? 1.2 : 1;
  const N = FORM_BARS[form];
  const bars: Bar[] = [];
  const add = (cs: Chord[][], sec: Section, solo: (i: number) => "lead" | "piano" | null, feel: "two" | "four", idx0 = 0) => {
    cs.forEach((chords, i) => bars.push({ chords, sec, solo: solo(i), feel, idx: sec === "intro" || sec === "tag" || sec === "end" ? -1 : idx0 + i }));
  };
  const slow = bpm < 100;
  const headFeel: "two" | "four" = slow || r() < 0.5 ? "two" : "four";
  const soloFeel: "two" | "four" = form === "ballad" || winter ? "two" : "four";
  const one = chorus(form, key, r);
  // an intro off the end of the form (the piano alone with the rhythm)
  const introN = form === "ballad" ? 2 : 4;
  add(one.slice(N - introN), "intro", () => "piano", "two");
  // the head: the horn states the tune (in the long forms the piano takes the bridge)
  const headSolo = (i: number) => (form === "aaba" && i >= 16 && i < 24 ? "piano" : form === "ballad" && i >= 8 && i < 12 ? "piano" : "lead") as "lead" | "piano";
  add(one, "head", headSolo, headFeel);
  if (form === "blues" && bpm >= 126) add(chorus(form, key, r), "head", headSolo, headFeel);
  // solos, traded between the horn and the piano
  if (form === "aaba") add(chorus(form, key, r), "solo", (i) => (i >= 16 && i < 24 ? "piano" : "lead"), soloFeel);
  else if (form === "ballad") add(chorus(form, key, r).slice(0, 8), "solo", () => "piano", soloFeel);
  else {
    add(chorus(form, key, r), "solo", () => "lead", soloFeel);
    add(chorus(form, key, r), "solo", () => "piano", soloFeel);
    if (bpm >= 140) add(chorus(form, key, r), "solo", (i) => (Math.floor(i / 4) % 2 ? "piano" : "lead"), soloFeel);
  }
  // the head out (the long forms come back in at the bridge), and a tag on its last four bars
  const out = chorus(form, key, r, true);
  if (form === "aaba") add(out.slice(16), "out", (i) => (i < 8 ? "piano" : "lead"), headFeel, 16);
  else if (form === "ballad") add(out.slice(8), "out", (i) => (i < 4 ? "piano" : "lead"), headFeel, 8);
  else add(out, "out", headSolo, headFeel);
  const tagN = form === "ballad" ? 2 : 4;
  add(out.slice(N - tagN), "tag", () => "lead", headFeel);
  const tonic = C(key, 0, minor ? "m6" : "6");
  bars.push({ chords: [tonic], sec: "end", solo: null, feel: "two", idx: -1 });
  return { form, key, minor, bpm, swing, lead, sparse, bars };
}

// ------------------------------------------------------------------ bass

/** The nearest pitch of a pitch class to `near`, inside [lo, hi]. */
function nearestPc(p: number, near: number, lo: number, hi: number): number {
  let best = -1, bd = 1e9;
  for (let m = lo; m <= hi; m++) if (pc(m) === pc(p)) { const d = Math.abs(m - near); if (d < bd) { bd = d; best = m; } }
  return best;
}

function writeBass(P: Plan, r: Rnd, out: Note[]) {
  const [lo, hi] = RANGE.bass;
  let prev = nearestPc(P.bars[0].chords[0].root, 38, lo, hi);
  let dir = 1, led = false;
  const B = P.bars;
  for (let b = 0; b < B.length; b++) {
    const bar = B[b], t0 = b * 4;
    if (bar.sec === "end") { out.push({ t: t0, d: 4, m: nearestPc(bar.chords[0].root, 36, lo, hi), v: 0.85, i: "bass", role: "root" }); break; }
    const next = B[b + 1].chords[0];
    const two = bar.chords.length > 1;
    const chOf = (beat: number) => (two && beat >= 2 ? bar.chords[1] : bar.chords[0]);
    const prevCh = b > 0 ? B[b - 1].chords[B[b - 1].chords.length - 1] : null;
    if (bar.feel === "two") {
      for (const beat of [0, 2]) {
        const ch = chOf(beat);
        // the root at each change and each bar; with one chord in the bar, its fifth (or third) on beat three
        let m: number, role: Role = "root";
        if (beat === 0 || two) { m = nearestPc(ch.root, prev, lo, hi); led = false; }
        else { const iv = TONES[ch.q][r() < 0.75 ? 2 : 1]; m = nearestPc(ch.root + iv, prev, lo, hi); role = "tone"; }
        out.push({ t: t0 + beat, d: 1.75, m, v: beat === 0 ? 0.82 : 0.72, i: "bass", role });
        prev = m;
      }
      // (a pickup into the next bar, now and then)
      if (r() < 0.22) {
        const target = nearestPc(next.root, prev, lo, hi), m = target + (r() < 0.5 ? -1 : 1);
        if (m >= lo && m <= hi) { out[out.length - 1].d = 1.4; out.push({ t: t0 + 3.5, d: 0.45, m, v: 0.6, i: "bass", role: "approach" }); prev = m; led = true; }
      }
      continue;
    }
    for (let beat = 0; beat < 4; beat++) {
      const ch = chOf(beat);
      const change = beat === 0 ? !prevCh || prevCh.root !== ch.root || prevCh.q !== ch.q : two && beat === 2;
      const nextCh = beat === 3 ? next : two && beat === 1 ? bar.chords[1] : null;
      let m: number, role: Role;
      if (led || change || (beat === 0 && r() < 0.8)) { m = nearestPc(ch.root, led ? prev : prev + dir * 2, lo, hi); role = "root"; led = false; }
      else if (nextCh) {
        // the beat before a chord: lead into its root by a semitone, or from a scale tone a step away
        const target = nearestPc(nextCh.root, prev, lo, hi);
        const cands = [target - 1, target + 1, target - 2, target + 2].filter((x) => x >= lo && x <= hi && x !== prev && (Math.abs(x - target) === 1 || inScale(ch, x)));
        m = cands.length ? (r() < 0.6 ? cands[0] : pick(r, cands)) : target;
        role = "approach"; led = true;
      } else {
        const cands: { m: number; w: number; role: Role }[] = [];
        for (let x = Math.max(lo, prev - 7); x <= Math.min(hi, prev + 7); x++) {
          if (x === prev) continue;
          const d = Math.abs(x - prev), along = Math.sign(x - prev) === dir ? 1.6 : 1;
          if (isTone(ch, x)) cands.push({ m: x, w: (d <= 4 ? 2 : 1) * along, role: pc(x) === ch.root ? "root" : "tone" });
          else if (d <= 2 && inScale(ch, x)) cands.push({ m: x, w: 1.4 * along, role: "scale" });
        }
        let sum = 0;
        for (const c of cands) sum += c.w;
        let u = r() * sum, c = cands[0];
        for (const k of cands) { u -= k.w; if (u <= 0) { c = k; break; } }
        m = c.m; role = c.role;
      }
      if (m !== prev) dir = Math.sign(m - prev) || dir;
      if (m >= hi - 2) dir = -1;
      if (m <= lo + 2) dir = 1;
      out.push({ t: t0 + beat, d: 0.92, m, v: beat === 0 ? 0.85 : beat === 2 ? 0.78 : 0.72, i: "bass", role });
      prev = m;
    }
  }
}

// ------------------------------------------------------------------ piano comping

const VOICINGS: Record<Quality, number[][]> = {
  "6": [[4, 7, 9, 12], [7, 9, 12, 16], [9, 12, 16], [4, 9, 14]],
  "7": [[4, 10, 14], [10, 14, 16], [4, 7, 10], [10, 16, 21]],
  m7: [[3, 7, 10], [3, 10, 14], [10, 15, 19]],
  m6: [[3, 7, 9], [3, 9, 14], [9, 12, 15]],
  dim: [[0, 3, 6, 9], [3, 6, 9, 12]],
  m7b5: [[3, 6, 10], [6, 10, 15]],
};

/** A voicing of a chord near a centre pitch: the shape and octave that move least from the last one. */
function voice(ch: Chord, centre: number, r: Rnd, lo: number, hi: number): number[] {
  let best: number[] = [], bd = 1e9;
  for (const shape of VOICINGS[ch.q]) {
    for (let oct = 2; oct <= 6; oct++) {
      const ms = shape.map((x) => 12 * oct + ch.root + x);
      if (ms[0] < lo || ms[ms.length - 1] > hi) continue;
      const mid = ms.reduce((a, x) => a + x, 0) / ms.length;
      const d = Math.abs(mid - centre) + r() * 2.5;
      if (d < bd) { bd = d; best = ms; }
    }
  }
  return best;
}

function writeComp(P: Plan, r: Rnd, out: Note[]) {
  const B = P.bars, [lo, hi] = RANGE.comp;
  let centre = 60;
  const hit = (t: number, d: number, ch: Chord, v: number, shell = false) => {
    let ms = voice(ch, shell ? 52 : centre, r, shell ? lo : 50, shell ? 62 : hi);
    if (shell) ms = ms.slice(0, 2);
    if (!ms.length) return;
    if (!shell) centre = centre * 0.5 + (ms.reduce((a, x) => a + x, 0) / ms.length) * 0.5;
    for (const m of ms) out.push({ t, d, m, v: v * (0.9 + r() * 0.2), i: "comp", role: isTone(ch, m) ? "tone" : "ext", ch });
  };
  const slow = P.bpm < 100;
  for (let b = 0; b < B.length; b++) {
    const bar = B[b], t0 = b * 4, c0 = bar.chords[0], c1 = bar.chords[1] ?? c0, two = bar.chords.length > 1;
    if (bar.sec === "end") { hit(t0, 4, c0, 0.6); continue; }
    const nextCh = B[b + 1].chords[0];
    const under = bar.solo === "piano" && bar.sec !== "intro";
    if (under) {
      // the left hand under the piano's own solo: a shell on the bar, another at a change
      hit(t0, two ? 1.6 : slow ? 3 : 2.4, c0, 0.42, true);
      if (two) hit(t0 + 2, 1.6, c1, 0.4, true);
      continue;
    }
    const v = bar.sec === "intro" ? 0.55 : bar.sec === "solo" ? 0.46 : 0.42;
    if (slow) {
      // slow: let the chords ring
      hit(t0, two ? 1.8 : 3.4, c0, v);
      if (two) hit(t0 + 2, 1.8, c1, v * 0.95);
      else if (r() < 0.35 / P.sparse) hit(t0 + 2.5, 1.2, c0, v * 0.8);
      continue;
    }
    if (r() < 0.1 * P.sparse && bar.sec !== "intro") continue;
    const pat = Math.floor(r() * 5);
    if (two) {
      hit(t0 + (pat === 1 ? 0.5 : 0), 0.7, c0, v);
      hit(t0 + (pat >= 3 ? 1.5 : 2), 0.8, c1, v);
    } else if (pat === 0) { hit(t0, 0.9, c0, v); hit(t0 + 1.5, 0.6, c0, v * 0.9); }
    else if (pat === 1) { hit(t0 + 1.5, 0.6, c0, v); hit(t0 + 3, 0.5, c0, v * 0.85); }
    else if (pat === 2) { hit(t0, 0.5, c0, v); hit(t0 + 2.5, 0.8, c0, v * 0.9); }
    else if (pat === 3) { hit(t0 + 1, 0.5, c0, v * 0.9); hit(t0 + 2.5, 0.6, c0, v); }
    else for (let k = 0; k < 4; k++) hit(t0 + k, 0.4, c0, v * (k % 2 ? 0.8 : 0.62));
    // a push: the next bar's chord half a beat early
    if (r() < 0.22 && !(pat === 1)) hit(t0 + 3.5, 0.5, nextCh, v * 0.95);
  }
}

// ------------------------------------------------------------------ melody: motifs, phrases, lines

/** One note of a motif: when it starts (eighths from the phrase's start), how long (eighths), how far it steps. */
interface Cell { on: number; len: number; step: number }

/** A rhythm with a contour: a run of mostly eighths that ends on a longer note. */
function makeCells(r: Rnd, maxLen: number, energy: number, slow: boolean): Cell[] {
  const want = Math.max(3, Math.min(maxLen - 2, Math.round((slow ? 5 : 6) + r() * (slow ? 5 : 8) * (0.5 + energy))));
  const cells: Cell[] = [];
  let pos = 0, dir = r() < 0.6 ? 1 : -1;
  while (pos < want - 2 && cells.length < 11) {
    const u = r();
    const len = u < (slow ? 0.35 : 0.5 + 0.25 * energy) ? 1 : u < 0.86 ? 2 : 3;
    if (r() < 0.3) dir = -dir;
    // (mostly steps; a leap now and then, and back the other way after it)
    const leap = r() < 0.16;
    cells.push({ on: pos, len, step: cells.length ? dir * (leap ? 2 + Math.floor(r() * 2) : 1) : 0 });
    if (leap) dir = -dir;
    pos += len;
    if (r() < 0.1 && pos < want - 3) pos += 1;
  }
  // the last note: long enough to land
  const last = Math.max(2, Math.min(maxLen - pos, 2 + Math.floor(r() * (slow ? 5 : 4))));
  cells.push({ on: pos, len: last, step: cells.length ? (r() < 0.6 ? -1 : 1) * (r() < 0.25 ? 2 : 1) : 0 });
  return cells;
}

/** A motif played again, a little different: its ending turned round, a note dropped, or its steps upside down. */
function vary(cells: Cell[], r: Rnd): Cell[] {
  const c = cells.map((x) => ({ ...x }));
  const u = r();
  if (u < 0.4 && c.length > 2) { c[c.length - 1].step = -c[c.length - 1].step || 1; c[c.length - 2].step = -c[c.length - 2].step; }
  else if (u < 0.65 && c.length > 4) c.splice(1 + Math.floor(r() * (c.length - 3)), 1);
  else if (u < 0.85) for (const x of c) x.step = -x.step;
  return c;
}

const cellsLen = (cells: Cell[]) => cells[cells.length - 1].on + cells[cells.length - 1].len;

interface LineOpts {
  voice: "lead" | "piano";
  /** the pitch the phrase starts near */
  anchor: number;
  v: number;
  /** on a blues, whether this phrase is played on the key's blues scale */
  blue?: boolean;
  /** end on this pitch class (the tonic, to close a section) */
  land?: number;
  enclose?: boolean;
}

/** The pitches a phrase may step through over a chord: its scale, or the key's blues scale. */
function ladder(ch: Chord, key: number, blue: boolean, lo: number, hi: number): number[] {
  const L: number[] = [];
  for (let m = lo; m <= hi; m++) if (blue ? BLUES.includes(pc(m - key)) || isTone(ch, m) : inScale(ch, m)) L.push(m);
  return L;
}

function nearestTone(ch: Chord, m: number, lo: number, hi: number, not = -1): number {
  let best = m, bd = 1e9;
  for (let x = Math.max(lo, m - 6); x <= Math.min(hi, m + 6); x++) {
    if (x === not || !isTone(ch, x)) continue;
    const d = Math.abs(x - m);
    if (d < bd) { bd = d; best = x; }
  }
  return best;
}

/**
 * Write a phrase: a motif's cells from beat `t0`, stepping through each chord's scale as the changes go by, landing
 * on chord tones on the strong beats and the long notes. Returns the last pitch (the next phrase starts near it).
 */
function phrase(P: Plan, r: Rnd, out: Note[], t0: number, cells: Cell[], o: LineOpts): number {
  const [lo, hi] = RANGE[o.voice];
  const blues = P.form === "blues" || P.form === "minorBlues";
  let cur = Math.max(lo + 2, Math.min(hi - 2, o.anchor)), prev = -1;
  const made: Note[] = [];
  for (let k = 0; k < cells.length; k++) {
    const c = cells[k], t = t0 + c.on / 2, d = c.len / 2, lastNote = k === cells.length - 1;
    const ch = chordAt(P.bars, t);
    const L = ladder(ch, P.key, !!o.blue && blues, lo, hi);
    let idx = 0, bd = 1e9;
    for (let i = 0; i < L.length; i++) { const dd = Math.abs(L[i] - cur); if (dd < bd) { bd = dd; idx = i; } }
    idx += c.step;
    // (turn back at the edge of the range)
    if (idx < 1) idx = 1 - idx;
    if (idx > L.length - 2) idx = 2 * (L.length - 2) - idx;
    idx = Math.max(0, Math.min(L.length - 1, idx));
    let m = L[idx];
    const strong = lastNote || c.len >= 2 || t % 2 === 0;
    if (lastNote && o.land !== undefined) m = nearestPc(o.land, m, lo, hi);
    else if (strong) m = nearestTone(ch, m, lo, hi, c.len < 2 ? prev : -1);
    else if (m === prev) m = L[Math.max(0, Math.min(L.length - 1, idx + (c.step >= 0 ? 1 : -1)))];
    const role: Role = isTone(ch, m) ? (pc(m) === ch.root ? "root" : "tone") : inScale(ch, m) ? "scale" : "blue";
    // loudness: a lift through the phrase, the off-beats leaned on, the last note placed
    const arc = 0.85 + 0.25 * Math.sin((Math.PI * (k + 0.5)) / cells.length);
    const v = Math.min(1, o.v * arc * (c.on % 2 ? 1.07 : 1) * (lastNote ? 0.97 : 1));
    // (a note is held until the next one starts unless a rest is written; short notes before a rest are clipped)
    const nextOn = lastNote ? c.on + c.len : cells[k + 1].on;
    const gap = nextOn - (c.on + c.len);
    made.push({ t, d: gap > 0 ? d * 0.8 : lastNote ? d * 0.92 : d, m, v, i: o.voice, role });
    prev = cur = m;
  }
  // an enclosure: come at the last note from the scale tone above it and the semitone below
  const n = made.length;
  if (o.enclose && n >= 4) {
    const T = made[n - 1], a = made[n - 3], b = made[n - 2];
    const chT = chordAt(P.bars, T.t);
    const tight = Math.abs(a.t + a.d - b.t) < 0.01 && Math.abs(b.t + b.d - T.t) < 0.01 && a.d <= 0.5 && b.d <= 0.5;
    if (tight && isTone(chT, T.m) && T.m - 1 >= lo) {
      const chA = chordAt(P.bars, a.t);
      let up = T.m + 1;
      while (up <= hi && !inScale(chA, up)) up++;
      if (up <= hi && up - T.m <= 2) {
        a.m = up; a.role = isTone(chA, up) ? "tone" : "scale";
        b.m = T.m - 1; b.role = "approach";
      }
    }
  }
  // a horn's inflections: a scoop into a long note, a fall off the last one now and then
  if (o.voice === "lead") {
    for (const x of made) if (x.d >= 1 && r() < 0.35) x.bend = "scoop";
    if (made[n - 1].d >= 1 && made[n - 1].bend === undefined && r() < 0.14) made[n - 1].bend = "fall";
  }
  // (no note is ever sounded twice running on neighbouring eighths: tie them instead)
  for (const x of made) out.push(x);
  return made[n - 1].m;
}

/** Improvise over bars [b0, b1): phrases with rests between them, motifs that come back changed, an arc of energy. */
function solo(P: Plan, r: Rnd, out: Note[], b0: number, b1: number, voice: "lead" | "piano", level: number) {
  const slow = P.bpm < 100, end = b1 * 4;
  const [lo, hi] = RANGE[voice];
  let pos = b0 * 4 + pick(r, [0, 0.5, 1, 1.5]);
  let anchor = lo + 8 + Math.floor(r() * 8), last: Cell[] | null = null;
  while (pos < end - 3) {
    const where = (pos - b0 * 4) / Math.max(4, end - b0 * 4);
    const energy = Math.min(1, 0.35 + 0.9 * Math.sin(Math.PI * Math.min(1, where * 1.25)) ** 2) / (P.sparse > 1 ? 1.3 : 1);
    const room = Math.floor((end - pos) * 2) - 1;
    if (room < 4) break;
    let cells: Cell[] = last && r() < 0.42 ? vary(last, r) : makeCells(r, Math.min(room, slow ? 12 : 16), energy, slow);
    if (cellsLen(cells) > room) cells = makeCells(r, room, energy * 0.5, slow);
    if (cellsLen(cells) > room) break;
    last = cells;
    const final = pos + cellsLen(cells) / 2 > end - 6;
    anchor = phrase(P, r, out, pos, cells, {
      voice, anchor: anchor + Math.round((energy - 0.5) * 6), v: level * (0.82 + 0.25 * energy), blue: r() < 0.45, enclose: r() < 0.4,
      land: final && r() < 0.6 ? chordAt(P.bars, pos + (cells[cells.length - 1].on) / 2).root : undefined,
    });
    // breathe: at least two beats, longer when the tune is sparse or the phrase was long
    const rest = (2 + Math.floor(r() * 4) / 2 + (1 - energy) * 1.5) * P.sparse;
    pos = Math.ceil((pos + cellsLen(cells) / 2 + rest) * 2) / 2;
    anchor = Math.max(lo + 5, Math.min(hi - 7, anchor));
  }
}

/** The head: a tune with a shape. Blues: a two-bar motif three times, the last turned to close. The long forms: a, a', b, a close; a sequence through the bridge. */
function head(P: Plan, r: Rnd, out: Note[], b0: number, level: number, motifs: Motifs, closing: boolean) {
  const B = P.bars, N = FORM_BARS[P.form];
  const [lo] = RANGE.lead;
  const at = (i: number) => (b0 + i) * 4;
  const mine = (i: number, voice: "lead" | "piano") => B[b0 + i] && B[b0 + i].solo === voice;
  const say = (i: number, off: number, cells: Cell[], anchor: number, extra: Partial<LineOpts> = {}) => {
    const voice = mine(i, "piano") ? "piano" : "lead";
    return phrase(P, r, out, at(i) + off, cells, { voice, anchor: anchor + (voice === "piano" ? 12 : 0), v: level, ...extra });
  };
  /** the piano's answer in the gap the horn leaves */
  const answer = (i: number) => {
    if (!B[b0 + i] || B[b0 + i].sec === "end") return;
    const cells = makeCells(r, 7, 0.4, P.bpm < 100);
    phrase(P, r, out, at(i) + 1, cells, { voice: "piano", anchor: 74 + Math.floor(r() * 8), v: level * 0.62, blue: true });
  };
  const tonic = P.key;
  if (P.form === "blues" || P.form === "minorBlues") {
    const a0 = lo + 9 + motifs.reg;
    say(0, motifs.off, motifs.a, a0, { blue: motifs.blue });
    answer(2);
    say(4, motifs.off, motifs.a, a0, { blue: motifs.blue });
    answer(6);
    const e = say(8, motifs.off, motifs.a2, a0 + 2, { blue: motifs.blue, enclose: true });
    // the close: a short figure home to the tonic
    phrase(P, r, out, at(10) + 0.5, motifs.close, { voice: "lead", anchor: e, v: level, land: tonic, blue: motifs.blue });
    if (!closing) answer(11);
    return;
  }
  const S = P.form === "aaba" ? 8 : 4;
  for (let s = 0; s < N / S; s++) {
    const i0 = s * S;
    const bridge = s === 2;
    const a0 = lo + 8 + motifs.reg;
    if (bridge) {
      // the bridge: one idea, said again on each new chord
      const step = P.form === "aaba" ? 2 : 1;
      let a = a0 + 5;
      for (let j = 0; j < S; j += step) a = say(i0 + j, motifs.off, motifs.c, a - 2);
      continue;
    }
    const finalA = s === N / S - 1;
    if (P.form === "aaba") {
      say(i0, motifs.off, motifs.a, a0);
      say(i0 + 2, motifs.off, motifs.a2, a0 + 1);
      const e = say(i0 + 4, motifs.off, motifs.b, a0 + 4, { enclose: true });
      phrase(P, r, out, at(i0 + 6) + 0.5, motifs.close, { voice: mine(i0 + 6, "piano") ? "piano" : "lead", anchor: e, v: level, land: s === 0 ? pc(tonic + 7) : tonic });
      if (!(closing && finalA) && s !== 0) answer(i0 + 7);
    } else {
      const e = say(i0, motifs.off, motifs.a, a0);
      phrase(P, r, out, at(i0 + 2) + 0.5, s === 0 ? motifs.b : motifs.close, { voice: mine(i0 + 2, "piano") ? "piano" : "lead", anchor: e + (s === 0 ? 2 : 0), v: level, land: s === 0 ? undefined : tonic, enclose: s === 0 });
    }
  }
}

interface Motifs { a: Cell[]; a2: Cell[]; b: Cell[]; c: Cell[]; close: Cell[]; off: number; reg: number; blue: boolean }

function makeMotifs(P: Plan, r: Rnd): Motifs {
  const slow = P.bpm < 100;
  const blues = P.form === "blues" || P.form === "minorBlues";
  // (a head's motif fits its two bars with room to breathe after it)
  const a = makeCells(r, blues ? 13 : 12, 0.45, slow);
  const close = makeCells(r, 6, 0.2, true);
  return {
    a, a2: vary(a, r), b: makeCells(r, 12, 0.7, slow), c: makeCells(r, P.form === "ballad" ? 6 : 11, 0.5, slow), close,
    off: pick(r, [0, 0.5, 1]), reg: Math.floor(r() * 6), blue: blues && r() < 0.6,
  };
}

// ------------------------------------------------------------------ drums

function writeDrums(P: Plan, r: Rnd, out: Note[]) {
  const B = P.bars, slow = P.bpm < 100, sparse = P.sparse > 1.4;
  const hit = (i: Voice, t: number, v: number, d = 0.25) => out.push({ t, d, m: 0, v, i });
  for (let b = 0; b < B.length; b++) {
    const bar = B[b], t0 = b * 4;
    if (bar.sec === "end") { hit("cym", t0, 0.5, 4); hit("kick", t0, 0.5); break; }
    const quiet = bar.sec === "intro" ? 0.7 : bar.sec === "solo" ? 1.05 : 0.9;
    // the hi-hat closes on two and four; the bass drum is only felt
    hit("hat", t0 + 1, 0.42 * quiet); hit("hat", t0 + 3, 0.45 * quiet);
    if (!sparse) { hit("kick", t0, 0.3 * quiet); if (bar.feel === "four") hit("kick", t0 + 2, 0.24 * quiet); }
    if (slow || sparse) {
      // brushes stirring: a sweep on every beat, a tap on two and four
      for (let k = 0; k < 4; k++) hit("swish", t0 + k, (k % 2 ? 0.5 : 0.4) * quiet, 1);
      if (!sparse) { hit("tap", t0 + 1, 0.4 * quiet); hit("tap", t0 + 3, 0.42 * quiet); if (r() < 0.3) hit("tap", t0 + 3.5, 0.25 * quiet); }
    } else {
      // the swing ride on the snare with a brush: ding, ding-a, ding, ding-a
      hit("tap", t0, 0.5 * quiet); hit("tap", t0 + 1, 0.62 * quiet); hit("tap", t0 + 1.5, 0.34 * quiet);
      hit("tap", t0 + 2, 0.5 * quiet); hit("tap", t0 + 3, 0.62 * quiet); hit("tap", t0 + 3.5, 0.34 * quiet);
      hit("swish", t0, 0.3 * quiet, 1); hit("swish", t0 + 2, 0.3 * quiet, 1);
    }
    // a fill into a new section
    const next = B[b + 1];
    if (next && (next.sec !== bar.sec || (next.idx === 0 && bar.idx > 0)) && !sparse && r() < 0.7) {
      hit("tap", t0 + 2.5, 0.45 * quiet); hit("tap", t0 + 3, 0.55 * quiet); hit("tap", t0 + 3.5, 0.6 * quiet);
    }
  }
}

// ------------------------------------------------------------------ the whole tune

/** Write a tune. `avoid`: names not to give it (the ones played lately). */
export function compose(seed: number, mood: Mood, src: NameSource = { towns: [], company: "" }, avoid?: ReadonlySet<string>): Tune {
  const r = mulberry32((seed * 2654435761) >>> 0);
  const P = plan(r, mood);
  // (a name the wireless played lately is passed over)
  const nr = mulberry32((seed * 40503 + 17) >>> 0);
  let name = tuneName(nr, mood, P.form, src);
  for (let k = 0; k < 12 && avoid?.has(name); k++) name = tuneName(nr, mood, P.form, src);
  const notes: Note[] = [];
  const B = P.bars;
  writeBass(P, r, notes);
  writeComp(P, r, notes);
  writeDrums(P, r, notes);
  const motifs = makeMotifs(P, r);
  // walk the sections: each run of bars with one job
  for (let b = 0; b < B.length;) {
    const bar = B[b];
    let e = b + 1;
    while (e < B.length && B[e].sec === bar.sec && B[e].idx === B[e - 1].idx + 1) e++;
    if (bar.sec === "intro") solo(P, r, notes, b, e, "piano", 0.6);
    else if (bar.sec === "head") head(P, r, notes, b, 0.74, motifs, false);
    else if (bar.sec === "out") {
      if (bar.idx === 0) head(P, r, notes, b, 0.8, motifs, true);
      else {
        // (the long forms come back in at the bridge: the piano takes it, the horn takes the last A home)
        const S = P.form === "aaba" ? 8 : 4;
        solo(P, r, notes, b, b + S, "piano", 0.66);
        const a0 = RANGE.lead[0] + 8 + motifs.reg;
        if (P.form === "aaba") {
          phrase(P, r, notes, (b + S) * 4 + motifs.off, motifs.a, { voice: "lead", anchor: a0, v: 0.8 });
          phrase(P, r, notes, (b + S + 2) * 4 + motifs.off, motifs.a2, { voice: "lead", anchor: a0 + 1, v: 0.8 });
          const x = phrase(P, r, notes, (b + S + 4) * 4 + motifs.off, motifs.b, { voice: "lead", anchor: a0 + 4, v: 0.82, enclose: true });
          phrase(P, r, notes, (b + S + 6) * 4 + 0.5, motifs.close, { voice: "lead", anchor: x, v: 0.8, land: P.key });
        } else {
          const x = phrase(P, r, notes, (b + S) * 4 + motifs.off, motifs.a, { voice: "lead", anchor: a0, v: 0.8 });
          phrase(P, r, notes, (b + S + 2) * 4 + 0.5, motifs.close, { voice: "lead", anchor: x, v: 0.8, land: P.key });
        }
      }
    } else if (bar.sec === "solo") {
      // (within a chorus the soloist can change: the bridge, or fours)
      for (let s = b; s < e;) {
        let x = s + 1;
        while (x < e && B[x].solo === B[s].solo) x++;
        solo(P, r, notes, s, x, B[s].solo ?? "lead", B[s].solo === "piano" ? 0.7 : 0.8);
        s = x;
      }
    } else if (bar.sec === "tag") {
      // the tag: the closing figure once more, and home
      const n = e - b;
      phrase(P, r, notes, b * 4 + motifs.off, n >= 4 ? motifs.a2 : motifs.close, { voice: "lead", anchor: RANGE.lead[0] + 10 + motifs.reg, v: 0.8, land: n >= 4 ? undefined : P.key });
      if (n >= 4) phrase(P, r, notes, (b + 2) * 4 + 0.5, motifs.close, { voice: "lead", anchor: RANGE.lead[0] + 10, v: 0.78, land: P.key });
    } else if (bar.sec === "end") {
      // the last chord: the horn holds the tonic, the piano climbs through the chord
      const t0 = b * 4, ch = bar.chords[0];
      notes.push({ t: t0, d: 3.6, m: nearestPc(P.key, 70, RANGE.lead[0], RANGE.lead[1]), v: 0.72, i: "lead", role: "root" });
      let m = nearestTone(ch, 72, 60, 91);
      for (let k = 0; k < 5; k++) {
        notes.push({ t: t0 + 1 + k * 0.5, d: k === 4 ? 1 : 0.5, m, v: 0.5 - k * 0.03, i: "piano", role: pc(m) === ch.root ? "root" : "tone" });
        m = nearestTone(ch, m + 3, 60, 91, m);
      }
    }
    b = e;
  }
  tidy(notes);
  return { seed, name, form: P.form, key: P.key, minor: P.minor, bpm: P.bpm, swing: P.swing, lead: P.lead, mood, bars: B, notes, beats: B.length * 4 + 4 };
}

/** Order the notes, and keep each melody line to one note at a time (a phrase never runs into the next). */
function tidy(notes: Note[]) {
  notes.sort((a, b) => a.t - b.t || a.m - b.m);
  for (const voice of ["lead", "piano"] as const) {
    let prev: Note | null = null;
    for (const n of notes) {
      if (n.i !== voice) continue;
      if (prev && prev.t + prev.d > n.t) prev.d = Math.max(0.2, n.t - prev.t);
      prev = n;
    }
  }
}

/** A beat on the straight grid as the band plays it: the off-beat eighth pushed late. */
export function swung(t: number, swing: number): number {
  const b = Math.floor(t + 1e-9), f = t - b;
  return b + (f < 0.5 ? f * 2 * swing : swing + (f - 0.5) * 2 * (1 - swing));
}

/** The mood for an hour and a season (0 spring .. 3 winter). */
export function moodFor(hour: number, season: number): Mood {
  const night = hour >= 20 || hour < 6;
  return season === 3 ? (night ? "winterNight" : "winterDay") : night ? "night" : "day";
}
