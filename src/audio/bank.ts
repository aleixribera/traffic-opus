// The sound bank's index (docs/design.md, "Sound"): every sound the game plays has a key, and a key renders to one
// mono buffer at SR by pure DSP. The engine asks for keys; a worker (bank.worker.ts) renders them off the main thread
// in the order given here, most needed first. Nothing is loaded: there are no audio files.

import { rnd } from "./dsp";
import { DRUMS, bassNote, pianoNote, type DrumId } from "./instruments";
import { BEDS, SHOTS, VARIANTS, finish, type BedId, type ShotId } from "./sounds";
import { STING_IDS, renderSting, type StingId } from "./stings";
import { UI, UI_IDS, type UiId } from "./uisounds";

/** The piano's and the bass's sampled notes: one every three semitones, pitched to the notes between. */
export const PIANO_BASE = [36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90];
export const BASS_BASE = [28, 31, 34, 37, 40, 43, 46, 49];

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Render one key ("bed:saw", "shot:bird2:1", "ui:click", "sting:milestone", "piano:60", "bass:40", "drum:tap"). */
export function renderKey(key: string): Float32Array {
  const [kind, id, n] = key.split(":");
  const r = rnd(hash(key));
  if (kind === "bed") return finish(BEDS[id as BedId](r), true);
  if (kind === "shot") return finish(SHOTS[id as ShotId](rnd(hash(id) + 31 * (Number(n) || 0) + 1)), false);
  if (kind === "ui") return finish(UI[id as UiId](r), false);
  if (kind === "sting") return finish(renderSting(id as StingId), false);
  if (kind === "piano") return finish(pianoNote(Number(id), r), false);
  if (kind === "bass") return finish(bassNote(Number(id), r), false);
  if (kind === "drum") return finish(DRUMS[id as DrumId](r), false);
  throw new Error(`no such sound: ${key}`);
}

export const variants = (id: ShotId) => VARIANTS[id] ?? 1;
export const shotKey = (id: ShotId, v = 0) => `shot:${id}:${v}`;

/** Every key, in the order to make them: what a first minute needs, then the rest. */
export function allKeys(): string[] {
  const keys: string[] = [];
  const bed = (...ids: BedId[]) => { for (const id of ids) keys.push(`bed:${id}`); };
  const shot = (...ids: ShotId[]) => { for (const id of ids) for (let v = 0; v < variants(id); v++) keys.push(shotKey(id, v)); };
  for (const id of UI_IDS) keys.push(`ui:${id}`);
  bed("pink", "gravel", "carBed", "car", "crackle");
  for (const id of Object.keys(DRUMS)) keys.push(`drum:${id}`);
  // (the middle of the keyboard first: a tune can start on those)
  for (const m of [...PIANO_BASE].sort((a, b) => Math.abs(a - 63) - Math.abs(b - 63))) keys.push(`piano:${m}`);
  for (const m of BASS_BASE) keys.push(`bass:${m}`);
  shot("bird0", "bird1", "bird2", "bird3", "bird4");
  bed("lightBed", "light", "idle", "murmur", "tractor", "saw", "water", "rain");
  keys.push("sting:milestone", "sting:money", "sting:orderOpen", "sting:orderDone");
  shot("clock", "hammer", "handsaw", "axe", "dog", "shopbell", "rooster", "cow", "horn", "klaxon", "airbrake", "door");
  bed("heavyBed", "heavy", "trainBed", "train", "crickets", "crusher", "furnace", "lightmach", "pumpjack", "turbine", "hiss", "kiln", "glass", "assembly");
  for (const id of STING_IDS) if (!keys.includes(`sting:${id}`)) keys.push(`sting:${id}`);
  shot("owl", "children", "clank", "steam", "blast", "clink", "pop");
  return keys;
}
