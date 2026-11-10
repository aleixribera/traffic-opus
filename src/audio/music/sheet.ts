// A tune as the wireless reads it (music/player.ts): what it needs to perform one, with the notes packed into plain
// arrays. A tune written off the main thread (compose.worker.ts) comes back as these arrays, handed over whole
// instead of copied note by note, so taking it in costs the frame nothing.

import type { Note, Tune, Voice } from "./compose";

const VOICES: readonly Voice[] = ["lead", "piano", "comp", "bass", "tap", "swish", "hat", "kick", "cym"];
const BENDS = [undefined, "scoop", "fall"] as const;

export interface Sheet {
  name: string;
  bpm: number;
  swing: number;
  lead: Tune["lead"];
  beats: number;
  /** how many notes, and each one's start and length (beats), pitch (MIDI), loudness, voice and bend, in order */
  count: number;
  t: Float64Array;
  d: Float64Array;
  m: Uint8Array;
  v: Float32Array;
  i: Uint8Array;
  b: Uint8Array;
}

export function sheetOf(T: Tune): Sheet {
  const n = T.notes.length;
  const s: Sheet = {
    name: T.name, bpm: T.bpm, swing: T.swing, lead: T.lead, beats: T.beats, count: n,
    t: new Float64Array(n), d: new Float64Array(n), m: new Uint8Array(n), v: new Float32Array(n), i: new Uint8Array(n), b: new Uint8Array(n),
  };
  T.notes.forEach((x, k) => {
    s.t[k] = x.t;
    s.d[k] = x.d;
    s.m[k] = x.m;
    s.v[k] = x.v;
    s.i[k] = VOICES.indexOf(x.i);
    s.b[k] = x.bend === "scoop" ? 1 : x.bend === "fall" ? 2 : 0;
  });
  return s;
}

/** The k-th note, as compose.ts wrote it (but for its role and chord, which only the tests read). */
export function noteAt(s: Sheet, k: number): Note {
  return { t: s.t[k], d: s.d[k], m: s.m[k], v: s.v[k], i: VOICES[s.i[k]], bend: BENDS[s.b[k]] };
}

/** The arrays to hand over with a sheet posted between threads. */
export function sheetBuffers(s: Sheet): ArrayBuffer[] {
  return [s.t.buffer, s.d.buffer, s.m.buffer, s.v.buffer, s.i.buffer, s.b.buffer] as ArrayBuffer[];
}
