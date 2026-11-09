// Hearing by numbers (docs/design.md, "Sound"): nobody listens to the game while it is built, so the real engine is
// driven into an OfflineAudioContext in a real browser and what comes out is measured: peak, RMS, crest factor, DC
// offset, spectral centroid and a coarse band spectrum for every second, clicks (a sample that jumps on its own),
// and the loudness of the layers against one another. It also draws spectrograms to look at.
//
// Loaded only with ?audiotest in the URL (main.ts). In the console, or from playwright:
//   await __audiotest.run()                   every render, measured and checked: { ok, checks, renders }
//   __audiotest.show("music", 8, 32)          a spectrogram of seconds 8..32 of a render over the page (hide(): away)
//   __audiotest.live()                        the running game's sound: sources live, cost per frame
//   await __audiotest.capture(30)             tape the running game's scene, for the "street" renders of the next run()

import type { GameAudio } from "./index";
import { Bank, DEFAULT_LEVELS, Engine, MAX_SOURCES, type Levels } from "./engine";
import { WORKS, emptyMix, emptyScene, mixFor, type Scene } from "./mixer";
import { compose, type Mood } from "./music/compose";
import { Wireless } from "./music/player";
import type { Where } from "./scene";
import { STING_IDS } from "./stings";
import { UI_IDS } from "./uisounds";
import { World } from "./world";

const SR = 48000, STEP = 0.05;

interface Rig { eng: Engine; world: World; radio: Wireless; scene: Scene; where: Where; mix: ReturnType<typeof emptyMix> }
type Drive = (r: Rig, t: number, dt: number) => void;

export interface Second { peak: number; rms: number; crest: number; dc: number; centroid: number; bands: number[] }
export interface Render {
  name: string; secs: number; l: Float32Array; r: Float32Array; mono: Float32Array; seconds: Second[];
  peak: number; rms: number; dc: number; clicks: number; maxStep: number; peakLive: number; refused: number; played: number;
}

const dB = (x: number) => (x > 1e-9 ? 20 * Math.log10(x) : -180);
const r1 = (x: number) => Math.round(x * 10) / 10;

// ------------------------------------------------------------------ measuring

function fft(re: Float32Array, im: Float32Array) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) { const a = re[i]; re[i] = re[j]; re[j] = a; const b = im[i]; im[i] = im[j]; im[j] = b; }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len, wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k, b = a + len / 2;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr; im[b] = im[a] - xi; re[a] += xr; im[a] += xi;
        const t = cr * wr - ci * wi; ci = cr * wi + ci * wr; cr = t;
      }
    }
  }
}

const NF = 4096;
const HANN = new Float32Array(NF).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / NF));
/** The power spectrum of NF samples from `at` (into `out`, NF/2 bins). */
function spectrum(x: Float32Array, at: number, out: Float32Array, re: Float32Array, im: Float32Array) {
  for (let i = 0; i < NF; i++) { re[i] = (x[at + i] ?? 0) * HANN[i]; im[i] = 0; }
  fft(re, im);
  for (let k = 0; k < NF / 2; k++) out[k] = (re[k] * re[k] + im[k] * im[k]) / ((NF * NF) / 4) / 0.375;
}

/** Band edges (Hz): rumble, low, mid, presence, air. */
export const BANDS = [20, 120, 500, 2000, 6000, 20000];

function measure(l: Float32Array, r: Float32Array, mono: Float32Array): Second[] {
  const out: Second[] = [], re = new Float32Array(NF), im = new Float32Array(NF), ps = new Float32Array(NF / 2), acc = new Float32Array(NF / 2);
  for (let s = 0; (s + 1) * SR <= mono.length; s++) {
    const a = s * SR, b = a + SR;
    let peak = 0, sq = 0, sum = 0;
    for (let i = a; i < b; i++) {
      const p = Math.max(Math.abs(l[i]), Math.abs(r[i]));
      if (p > peak) peak = p;
      sq += mono[i] * mono[i]; sum += mono[i];
    }
    const rms = Math.sqrt(sq / SR);
    acc.fill(0);
    let n = 0;
    for (let at = a; at + NF <= b; at += NF / 2) { spectrum(mono, at, ps, re, im); for (let k = 0; k < NF / 2; k++) acc[k] += ps[k]; n++; }
    let num = 0, den = 0;
    const bands = new Array(BANDS.length - 1).fill(0);
    for (let k = 1; k < NF / 2; k++) {
      const f = (k * SR) / NF, p = acc[k] / n;
      num += f * p; den += p;
      for (let j = 0; j < bands.length; j++) if (f >= BANDS[j] && f < BANDS[j + 1]) bands[j] += p;
    }
    out.push({ peak, rms, crest: rms > 1e-7 ? dB(peak / rms) : 0, dc: sum / SR, centroid: den > 1e-14 ? num / den : 0, bands: bands.map((p) => r1(dB(Math.sqrt(p / 2)))) });
  }
  return out;
}

/**
 * Clicks: a sample that jumps by itself. A discontinuity (a gain stepped, a source cut off) is one large difference
 * between two samples with ordinary ones either side; anything played from the bank or shaped by a glide is spread
 * over many. Counted: |d| over 0.012, eight times the differences around it, and at least three times its
 * neighbours.
 */
export function clicks(x: Float32Array): { n: number; maxStep: number; at: number[] } {
  let n = 0, maxStep = 0;
  const at: number[] = [], W = 240;
  // a running sum of |d| over the 5 ms either side
  const d = new Float32Array(x.length);
  for (let i = 1; i < x.length; i++) { d[i] = Math.abs(x[i] - x[i - 1]); if (d[i] > maxStep) maxStep = d[i]; }
  let sum = 0;
  for (let i = 0; i < Math.min(d.length, 2 * W + 1); i++) sum += d[i];
  for (let i = W; i < d.length - W - 1; i++) {
    const v = d[i];
    if (v > 0.012) {
      const near = Math.max(d[i - 1], d[i + 1], d[i - 2], d[i + 2]);
      const around = (sum - v - d[i - 1] - d[i + 1]) / (2 * W - 2);
      if (v > 8 * around && v > 3 * near) { n++; if (at.length < 12) at.push(+(i / SR).toFixed(4)); }
    }
    sum += d[i + W + 1] - d[i - W];
  }
  return { n, maxStep, at };
}

// ------------------------------------------------------------------ rendering

let bank: Bank | null = null;

async function render(name: string, secs: number, drive: Drive, levels: Partial<Levels> = {}): Promise<Render> {
  bank ??= ((window as unknown as { app?: { audio?: GameAudio } }).app?.audio?.bank ?? new Bank());
  bank.bake();
  const ctx = new OfflineAudioContext(2, Math.round(SR * secs), SR);
  const eng = new Engine(ctx, bank);
  eng.setLevels({ ...DEFAULT_LEVELS, ...levels }, true);
  const where: Where = { near: [0, 1, 2].map(() => ({ id: -1, cls: 0, pan: 0, v: 0, w: 0 })), works: new Array(WORKS.length).fill(0), jam: 0, gate: 0, site: 0, hall: 0, town: 0 };
  const rig: Rig = { eng, world: new World(eng), radio: new Wireless(eng), scene: emptyScene(), where, mix: emptyMix() };
  let seed = 1;
  rig.radio.seed = () => seed++;
  rig.radio.source = () => ({ towns: ["Alder Run", "Marlow", "Cobb's Ferry"], company: "Carver & Sons Haulage" });
  rig.radio.setOn(false);
  for (let k = 1; k * STEP < secs - 1e-6; k++) {
    const at = k * STEP;
    void ctx.suspend(at).then(() => { drive(rig, at, STEP); void ctx.resume(); });
  }
  drive(rig, 0, STEP);
  const buf = await ctx.startRendering();
  const l = buf.getChannelData(0), r = buf.getChannelData(1), mono = new Float32Array(l.length);
  for (let i = 0; i < l.length; i++) mono[i] = (l[i] + r[i]) / 2;
  const seconds = measure(l, r, mono);
  let peak = 0, sq = 0, sum = 0;
  for (let i = 0; i < l.length; i++) { const p = Math.max(Math.abs(l[i]), Math.abs(r[i])); if (p > peak) peak = p; sq += mono[i] * mono[i]; sum += mono[i]; }
  const c = clicks(mono);
  eng.live();
  return { name, secs, l, r, mono, seconds, peak, rms: Math.sqrt(sq / l.length), dc: sum / l.length, clicks: c.n, maxStep: c.maxStep, peakLive: eng.peakLive, refused: eng.refused, played: eng.played };
}

/** The world for a scene: mix it and play it. */
const world = (r: Rig, dt: number) => r.world.apply(mixFor(r.scene, r.mix), r.scene, r.where, dt);

// ------------------------------------------------------------------ scenes

function street(s: Scene) {
  s.halfH = 110; s.hour = 12; s.season = 1; s.paused = false; s.speed = 1;
  s.n = [16, 5, 3, 1]; s.v = [9, 8, 7, 6]; s.idle = 3; s.jam = 0; s.gate = 0.3;
  s.works.fill(0); s.works[WORKS.indexOf("saw")] = 1.2;
  s.logging = 0; s.dairy = 0; s.farm = 0; s.motor = 0; s.pit = 0; s.sites = 1;
  s.homes = 30; s.shops = 8; s.pop = 2500; s.hall = 0.7; s.forest = 0.15; s.water = 0;
}
function country(s: Scene) {
  s.halfH = 220; s.hour = 12; s.season = 1; s.paused = false; s.speed = 1;
  s.n = [0, 0, 0, 0]; s.v = [0, 0, 0, 0]; s.idle = 0; s.jam = 0; s.gate = 0;
  s.works.fill(0); s.logging = 0; s.dairy = 0; s.farm = 0; s.motor = 0; s.pit = 0; s.sites = 0;
  s.homes = 0; s.shops = 0; s.pop = 0; s.hall = 0; s.forest = 0.7; s.water = 0.25;
}
/** Three vehicles crossing the screen, one after another, for the street-level voices. */
function passing(w: Where, t: number, on = true) {
  for (let k = 0; k < 3; k++) {
    const n = w.near[k], period = 5 + k * 1.7, u = ((t + k * 2.1) % period) / period, lap = Math.floor((t + k * 2.1) / period);
    n.id = on ? k * 1000 + lap : -1; n.cls = (k + lap) % 4; n.v = 9 + 3 * k;
    n.pan = (k % 2 ? -1 : 1) * (u * 2.4 - 1.2);
    n.w = on ? Math.max(0, 1 - Math.abs(n.pan) ** 1.5 * 0.8) * (Math.abs(n.pan) > 1.15 ? 0 : 1) : 0;
  }
}

// ------------------------------------------------------------------ the real game, taped

interface Frame { t: number; scene: Scene; where: Where }
/** What the running game's ear saw, ten times a second (capture()), to play back into an offline render ("street"). */
let tape: Frame[] = [];

/** Tape `secs` seconds of the running game's scene (sound must be on: click the page once). */
function capture(secs = 30): Promise<{ frames: number; secs: number; first: Scene | null }> {
  const a = (window as unknown as { app: { audio: GameAudio } }).app.audio, t0 = performance.now();
  tape = [];
  return new Promise((done) => {
    const id = setInterval(() => {
      const d = a.debug(), t = (performance.now() - t0) / 1000;
      tape.push({ t, scene: structuredClone(d.scene), where: structuredClone(d.where) });
      if (t >= secs) { clearInterval(id); done({ frames: tape.length, secs, first: tape[0]?.scene ?? null }); }
    }, 100);
  });
}
function frameAt(t: number): Frame {
  let f = tape[0];
  for (const x of tape) { if (x.t > t) break; f = x; }
  return f;
}

const RENDERS: Record<string, { secs: number; levels?: Partial<Levels>; drive: Drive }> = {
  // the running game as it was taped: the world alone, then (streetMix) with the wireless over it
  street: { secs: 30, drive: (r, t, dt) => { const f = frameAt(t); r.scene = f.scene; r.where = f.where; world(r, dt); } },
  streetMix: { secs: 30, drive: (r, t, dt) => { if (t === 0) r.radio.setOn(true); const f = frameAt(t); r.scene = f.scene; r.where = f.where; world(r, dt); r.radio.update(); } },
  // the master chain's own gain: a quiet noise through it should come out as loud as it went in
  unity: { secs: 3, levels: { master: 1, music: 1, world: 1, ui: 1 }, drive: (r, t) => { if (t === 0) r.eng.shot("bed:pink", r.eng.ui, 0.1, { prio: 2 }); } },
  // the air: a wood by a river at noon, the dawn chorus, a summer night, winter
  air: {
    secs: 40, drive: (r, t, dt) => {
      country(r.scene);
      if (t >= 10 && t < 20) r.scene.hour = 5.9;
      else if (t >= 20 && t < 30) { r.scene.hour = 23.5; r.scene.water = 0; }
      else if (t >= 30) { r.scene.season = 3; r.scene.hour = 13; r.scene.water = 0; }
      world(r, dt);
    },
  },
  // the whole county from far up: wind and a distant hum
  far: { secs: 20, drive: (r, t, dt) => { street(r.scene); r.scene.halfH = 3200; r.scene.n = [160, 50, 30, 10]; world(r, dt); } },
  // a busy street: engines by class, tyres, a queue, vehicles passing one by one
  traffic: {
    secs: 30, drive: (r, t, dt) => {
      street(r.scene);
      r.scene.works.fill(0); r.scene.homes = 0; r.scene.shops = 0; r.scene.pop = 0; r.scene.sites = 0; r.scene.forest = 0; r.scene.hall = 0;
      // (a jam builds in the last ten seconds: idling, and a horn or two)
      if (t >= 20) { r.scene.v = [1, 1, 1, 1]; r.scene.idle = 16; r.scene.jam = 14; r.where.jam = -0.4; }
      passing(r.where, t, t < 20);
      world(r, dt);
    },
  },
  // one vehicle at a time along an empty street, left to right, every five seconds
  passby: {
    secs: 20, drive: (r, t, dt) => {
      street(r.scene);
      r.scene.n = [1, 0, 0, 0]; r.scene.v = [9, 0, 0, 0]; r.scene.idle = 0; r.scene.works.fill(0); r.scene.gate = 0; r.scene.sites = 0;
      r.scene.homes = 0; r.scene.shops = 0; r.scene.pop = 0; r.scene.hall = 0; r.scene.forest = 0; r.scene.halfH = 80;
      const n = r.where.near[0], u = (t % 5) / 5, lap = Math.floor(t / 5);
      n.id = 500 + lap; n.cls = lap % 4; n.v = 11; n.pan = u * 2.2 - 1.1;
      n.w = Math.abs(n.pan) > 1.05 ? 0 : Math.max(0, 1 - Math.abs(n.pan) ** 1.5 * 0.8);
      r.where.near[1].id = -1; r.where.near[2].id = -1;
      world(r, dt);
    },
  },
  // every works bed in turn, three seconds each, with its own events
  works: {
    secs: WORKS.length * 3, drive: (r, t, dt) => {
      country(r.scene);
      r.scene.forest = 0; r.scene.water = 0; r.scene.halfH = 160;
      const i = Math.min(WORKS.length - 1, Math.floor(t / 3));
      r.scene.works[i] = 2.5; r.where.works[i] = (i % 3) - 1;
      r.scene.logging = WORKS[i] === "tractor" ? 1 : 0; r.scene.dairy = r.scene.logging; r.scene.pit = WORKS[i] === "crusher" ? 1 : 0; r.scene.motor = WORKS[i] === "assembly" ? 1 : 0;
      world(r, dt);
    },
  },
  // a town at three in the afternoon: murmur, a shop bell, a dog, building going on, the clock striking three
  town: {
    secs: 30, drive: (r, t, dt) => {
      street(r.scene);
      r.scene.n = [1, 0, 0, 0]; r.scene.v = [5, 0, 0, 0]; r.scene.idle = 0; r.scene.works.fill(0); r.scene.gate = 0; r.scene.sites = 3;
      r.scene.halfH = 150; r.scene.homes = 60; r.scene.shops = 14; r.scene.pop = 5000; r.scene.hall = 1;
      r.scene.hour = t < 5 ? 14.95 : 15.05 + t / 400;
      world(r, dt);
    },
  },
  // the same street four ways: as it is, paused, from far up, at night
  states: {
    secs: 32, drive: (r, t, dt) => {
      street(r.scene);
      passing(r.where, t, t < 8);
      if (t >= 8 && t < 16) r.scene.paused = true;
      else if (t >= 16 && t < 24) r.scene.halfH = 3000;
      else if (t >= 24) { r.scene.hour = 1; r.scene.n = [2, 1, 1, 0]; r.scene.sites = 0; }
      world(r, dt);
    },
  },
  // the interface: every sound, half a second apart, then roads of three lengths
  ui: {
    secs: UI_IDS.length * 0.5 + 6, drive: (r, t) => {
      const k = Math.round(t / 0.5);
      if (Math.abs(t - k * 0.5) < STEP / 2 && k < UI_IDS.length) r.eng.shot(`ui:${UI_IDS[k]}`, r.eng.ui, 0.9, { prio: 2 });
      const t1 = UI_IDS.length * 0.5;
      for (const [at, d] of [[0.2, 0.3], [1.2, 0.8], [3, 1.5]]) {
        if (Math.abs(t - t1 - at) < STEP / 2) {
          r.eng.shot("bed:gravel", r.eng.ui, 0.9 * 1.5, { prio: 2, attack: 0.05, dur: d, release: 0.05 });
          r.eng.shot("ui:roadEnd", r.eng.ui, 0.9, { prio: 2, when: r.eng.now + d + 0.02 });
        }
      }
    },
  },
  // the moments: every sting, one after another
  stings: {
    secs: STING_IDS.length * 4.6, drive: (r, t) => {
      const k = Math.round(t / 4.6);
      if (Math.abs(t - k * 4.6) < STEP / 2 && k < STING_IDS.length) r.eng.shot(`sting:${STING_IDS[k]}`, r.eng.ui, 0.55, { prio: 2 });
    },
  },
  // the wireless alone: a day tune from its first bar
  music: { secs: 90, drive: (r, t) => { if (t === 0) { r.radio.mood = () => "day"; r.radio.setOn(true); } r.radio.update(); } },
  musicNight: { secs: 60, drive: (r, t) => { if (t === 0) { r.radio.mood = () => "night"; r.radio.seed = () => 7; r.radio.setOn(true); } r.radio.update(); } },
  // the band without the old set's voicing
  musicClean: { secs: 30, drive: (r, t) => { if (t === 0) { r.radio.mood = () => "day"; r.radio.setOld(false); r.radio.setOn(true); } r.radio.update(); } },
  // everything a player hears at once at the default levels: the street, the wireless, clicks, a fanfare
  mix: {
    secs: 45, drive: (r, t, dt) => {
      if (t === 0) r.radio.setOn(true);
      street(r.scene); passing(r.where, t);
      world(r, dt); r.radio.update();
      if (Math.abs(t % 3 - 1) < STEP / 2) r.eng.shot("ui:click", r.eng.ui, 0.9, { prio: 2 });
      if (Math.abs(t - 20) < STEP / 2) r.eng.shot("sting:milestone", r.eng.ui, 0.55, { prio: 2 });
    },
  },
  // the worst case: every slider full, a jam at a smelter by a town at street level, fireworks, a fanfare, clicking
  stress: {
    secs: 30, levels: { master: 1, music: 1, world: 1, ui: 1 }, drive: (r, t, dt) => {
      if (t === 0) r.radio.setOn(true);
      street(r.scene); passing(r.where, t);
      r.scene.n = [60, 20, 14, 6]; r.scene.idle = 30; r.scene.jam = 30; r.scene.gate = 2; r.scene.sites = 8; r.scene.pit = 1; r.scene.motor = 1; r.scene.dairy = 1; r.scene.logging = 1;
      r.scene.speed = 4;
      for (let i = 0; i < WORKS.length; i++) r.scene.works[i] = 3;
      world(r, dt); r.radio.update();
      if (Math.abs(t % 0.25) < STEP / 2) r.world.pop(Math.sin(t * 7));
      if (Math.abs(t % 0.5) < STEP / 2) r.eng.shot("ui:place", r.eng.ui, 0.9, { prio: 2 });
      if (Math.abs(t % 5 - 1) < STEP / 2) r.eng.shot(`sting:${STING_IDS[Math.floor(t / 5) % STING_IDS.length]}`, r.eng.ui, 0.55, { prio: 2 });
    },
  },
  // boundaries: scenes cut from one to another, pauses, the wireless switched off, on and on to the next tune
  cuts: {
    secs: 40, drive: (r, t, dt) => {
      if (t === 0) r.radio.setOn(true);
      const k = Math.floor(t / 2) % 6;
      if (k === 0 || k === 3) street(r.scene); else if (k === 1) country(r.scene); else if (k === 2) { street(r.scene); r.scene.halfH = 3000; } else if (k === 4) { street(r.scene); r.scene.paused = true; } else { country(r.scene); r.scene.hour = 23; }
      if (k === 3) for (let i = 0; i < WORKS.length; i++) r.scene.works[i] = i % 2 ? 2 : 0;
      passing(r.where, t, k === 0 || k === 3);
      world(r, dt);
      const at = (x: number) => Math.abs(t - x) < STEP / 2;
      if (at(9)) r.radio.next();
      if (at(15)) r.radio.setOn(false);
      if (at(18)) r.radio.setOn(true);
      if (at(25)) r.radio.setOld(false);
      if (at(29)) r.radio.setOld(true);
      if (at(33)) r.radio.next();
      r.radio.update();
    },
  },
};

// ------------------------------------------------------------------ the report

interface Check { name: string; ok: boolean; value: string }

function summary(R: Render) {
  const s = R.seconds;
  const med = (f: (x: Second) => number) => { const a = s.map(f).sort((x, y) => x - y); return a.length ? a[Math.floor(a.length / 2)] : 0; };
  const bands = BANDS.slice(0, -1).map((_, j) => r1(med((x) => x.bands[j])));
  return {
    secs: R.secs, peak: +R.peak.toFixed(3), peakDb: r1(dB(R.peak)), rmsDb: r1(dB(R.rms)), crestDb: r1(dB(R.peak / Math.max(1e-9, R.rms))), dc: +R.dc.toExponential(1),
    centroidHz: Math.round(med((x) => x.centroid)), bandsDb: bands,
    quietestSecDb: r1(dB(Math.min(...s.map((x) => x.rms)))), loudestSecDb: r1(dB(Math.max(...s.map((x) => x.rms)))),
    clicks: R.clicks, maxStep: +R.maxStep.toFixed(3), peakLive: R.peakLive, refused: R.refused, played: R.played,
  };
}

/** The RMS of seconds [a, b) of a render. */
function rmsOf(R: Render, a: number, b: number): number {
  let sq = 0;
  const i0 = Math.round(a * SR), i1 = Math.min(R.mono.length, Math.round(b * SR));
  for (let i = i0; i < i1; i++) sq += R.mono[i] * R.mono[i];
  return Math.sqrt(sq / Math.max(1, i1 - i0));
}
function bandOf(R: Render, a: number, b: number, j: number): number {
  const xs = R.seconds.slice(a, b).map((x) => x.bands[j]);
  return xs.reduce((p, x) => p + 10 ** (x / 10), 0) / Math.max(1, xs.length);
}

const done = new Map<string, Render>();

async function run(only?: string[]) {
  const t0 = performance.now();
  for (const [name, spec] of Object.entries(RENDERS)) {
    if (only && !only.includes(name)) continue;
    const taped = name === "street" || name === "streetMix";
    if (taped && !tape.length) continue;
    done.set(name, await render(name, taped ? Math.max(2, Math.floor(tape[tape.length - 1].t)) : spec.secs, spec.drive, spec.levels));
  }
  const checks: Check[] = [];
  const check = (name: string, ok: boolean, value: string | number) => checks.push({ name, ok, value: String(value) });
  const R = (n: string) => done.get(n);
  for (const [name, x] of done) {
    check(`${name}: no clipping (peak under 0.9)`, x.peak < 0.9, x.peak.toFixed(3));
    check(`${name}: no DC offset`, Math.abs(x.dc) < 0.002, x.dc.toExponential(1));
    check(`${name}: no clicks`, x.clicks === 0, x.clicks);
    check(`${name}: at most ${MAX_SOURCES} sources`, x.peakLive <= MAX_SOURCES, x.peakLive);
  }
  const unity = R("unity");
  if (unity) {
    // (what went in: the bank's own noise, seconds 0.5 to 2.5 of it, at a tenth)
    const src = bank!.get("bed:pink")!.getChannelData(0), sr = bank!.get("bed:pink")!.sampleRate;
    let sq = 0;
    for (let i = Math.round(0.5 * sr); i < Math.round(2.5 * sr); i++) sq += src[i] * src[i];
    const g = rmsOf(unity, 0.5, 2.5) / (0.1 * Math.sqrt(sq / (2 * sr)));
    check("the master chain neither lifts nor cuts a quiet sound (gain 0.9 to 1.1)", g > 0.9 && g < 1.1, g.toFixed(3));
  }
  // no silence where there should be sound
  for (const name of ["air", "far", "traffic", "works", "town", "music", "musicNight", "musicClean", "mix", "stress"]) {
    const x = R(name);
    if (!x) continue;
    const from = name.startsWith("music") || name === "mix" ? 3 : 1;
    const q = Math.min(...x.seconds.slice(from).map((s) => s.rms));
    check(`${name}: never silent (every second over -60 dB)`, dB(q) > -60, r1(dB(q)));
  }
  const ui = R("ui");
  if (ui) {
    // each interface sound: heard, and over within its half second
    let longest = 0, quietest = 1;
    for (let k = 0; k < UI_IDS.length; k++) {
      const a = Math.round(k * 0.5 * SR), b = a + SR / 2;
      let last = a, pk = 0;
      for (let i = a; i < b; i++) { const v = Math.abs(ui.mono[i]); if (v > pk) pk = v; if (v > 0.001) last = i; }
      longest = Math.max(longest, (last - a) / SR); quietest = Math.min(quietest, pk);
    }
    check("interface sounds are short (the longest under 0.65 s)", longest < 0.65, longest.toFixed(2));
    check("every interface sound is heard (peak over -40 dB)", dB(quietest) > -40, r1(dB(quietest)));
  }
  const st = R("stings");
  if (st) {
    let quietest = 1;
    for (let k = 0; k < STING_IDS.length; k++) quietest = Math.min(quietest, rmsOf(st, k * 4.6, k * 4.6 + 1.2));
    check("every sting is heard (over -45 dB)", dB(quietest) > -45, r1(dB(quietest)));
    check("stings end before the next (silence in the last 0.1 s of each slot)", rmsOf(st, 4.5, 4.6) < 0.0005, r1(dB(rmsOf(st, 4.5, 4.6))));
  }
  // loudness relations at the default levels
  const music = R("music"), traffic = R("traffic"), mix = R("mix"), states = R("states"), far = R("far"), air = R("air"), town = R("town");
  if (music && traffic) {
    const m = rmsOf(music, 5, 90), w = rmsOf(traffic, 2, 20);
    check("the wireless sits under a busy street (3 to 14 dB below)", dB(w / m) > 3 && dB(w / m) < 14, `${r1(dB(m))} dB under ${r1(dB(w))} dB`);
  }
  if (music && air) {
    const m = rmsOf(music, 5, 90), w = rmsOf(air, 1, 10);
    check("the wireless is heard over a quiet wood (within 8 dB of it)", Math.abs(dB(m / w)) < 8, `${r1(dB(m))} dB against ${r1(dB(w))} dB`);
  }
  if (mix) check("the full mix at the default levels is modest (-30 to -17 dB RMS)", dB(rmsOf(mix, 3, 45)) > -30 && dB(rmsOf(mix, 3, 45)) < -17, r1(dB(rmsOf(mix, 3, 45))));
  if (states) {
    const on = rmsOf(states, 2, 8), paused = rmsOf(states, 11, 16), up = rmsOf(states, 19, 24), night = rmsOf(states, 27, 32);
    check("a pause ducks the world (8 dB or more)", dB(on / paused) > 8, r1(dB(on / paused)));
    check("a paused world is not silent", dB(paused) > -60, r1(dB(paused)));
    check("from far up the street is quieter", dB(on / up) > 3, r1(dB(on / up)));
    check("the street at night is quieter than at noon", dB(on / night) > 3, r1(dB(on / night)));
    // zooming out: the engines' band (120 to 500 Hz) falls against the wind's (500 to 2000)
    const eng = (a: number, b: number) => 10 * Math.log10(bandOf(states, a, b, 1)), wind = (a: number, b: number) => 10 * Math.log10(bandOf(states, a, b, 2));
    check("zooming out trades engines for wind (the low band falls 6 dB or more against the mid)", (eng(2, 8) - wind(2, 8)) - (eng(19, 24) - wind(19, 24)) > 6, r1((eng(2, 8) - wind(2, 8)) - (eng(19, 24) - wind(19, 24))));
  }
  const pb = R("passby");
  if (pb) {
    // each pass: left before the middle, right after it, loudest in the middle
    const e = (x: Float32Array, a: number, b: number) => { let q = 0; for (let i = Math.round(a * SR); i < Math.round(b * SR); i++) q += x[i] * x[i]; return Math.sqrt(q / ((b - a) * SR)); };
    let pans = true, swells = true;
    const bal: string[] = [];
    for (let k = 0; k < 4; k++) {
      const t = k * 5, inL = e(pb.l, t + 1, t + 2), inR = e(pb.r, t + 1, t + 2), outL = e(pb.l, t + 3, t + 4), outR = e(pb.r, t + 3, t + 4);
      const mid = e(pb.mono, t + 2.2, t + 2.8), edge = e(pb.mono, t + 0.1, t + 0.6);
      if (!(inL > inR * 1.25 && outR > outL * 1.25)) pans = false;
      if (!(mid > edge * 1.6)) swells = false;
      bal.push(`${r1(dB(inL / inR))}/${r1(dB(outL / outR))}`);
    }
    check("a vehicle passing crosses from the left ear to the right", pans, bal.join(", ") + " dB left over right, coming and going");
    check("and is loudest as it passes the middle (4 dB or more over the edges)", swells, r1(dB(e(pb.mono, 2.2, 2.8) / e(pb.mono, 0.1, 0.6))));
  }
  if (far && traffic) check("far up is mostly wind: quieter than the street", dB(rmsOf(traffic, 2, 20) / rmsOf(far, 2, 20)) > 2, r1(dB(rmsOf(traffic, 2, 20) / rmsOf(far, 2, 20))));
  if (traffic) check("a jam idles lower than moving traffic, and is not silent", rmsOf(traffic, 23, 30) < rmsOf(traffic, 2, 20) && dB(rmsOf(traffic, 23, 30)) > -50, `${r1(dB(rmsOf(traffic, 23, 30)))} dB against ${r1(dB(rmsOf(traffic, 2, 20)))} dB`);
  if (air) {
    check("the dawn chorus is the air's loudest", rmsOf(air, 11, 20) > rmsOf(air, 31, 40), `${r1(dB(rmsOf(air, 11, 20)))} dB dawn, ${r1(dB(rmsOf(air, 31, 40)))} dB winter`);
    const c = (a: number, b: number) => air.seconds.slice(a, b).reduce((p, x) => p + x.centroid, 0) / (b - a);
    check("a summer night sounds different from noon (crickets: a higher centroid)", c(22, 30) > c(31, 40), `${Math.round(c(22, 30))} Hz night, ${Math.round(c(31, 40))} Hz winter day`);
  }
  if (town) {
    // the clock: three strokes after the hour comes round (at 5 s), 1.55 s apart: energy near 5.2, 6.7, 8.3 s over the second before
    const before = rmsOf(town, 3.5, 5), strokes = [5.2, 6.75, 8.3].map((t) => rmsOf(town, t, t + 0.6));
    check("the town hall clock strikes three at three", strokes.every((x) => x > before * 1.15), strokes.map((x) => r1(dB(x / before))).join(", ") + " dB over the town");
  }
  const cuts = R("cuts");
  if (cuts) check("cuts between scenes: the worst jump between two samples", cuts.maxStep < 0.12, cuts.maxStep.toFixed(3));
  // the detector works: a step put into a copy of the music is found
  if (music) {
    const copy = music.mono.slice(0, 10 * SR);
    const base = clicks(copy).n;
    for (let i = 5 * SR; i < copy.length; i++) copy[i] += 0.03;
    check("the click detector finds a 0.03 step put in on purpose", clicks(copy).n === base + 1, clicks(copy).n - base);
  }
  const renders: Record<string, ReturnType<typeof summary>> = {};
  for (const [name, x] of done) renders[name] = summary(x);
  return { ok: checks.every((c) => c.ok), failed: checks.filter((c) => !c.ok), checks, renders, tookMs: Math.round(performance.now() - t0) };
}

// ------------------------------------------------------------------ pictures

/** dark navy, through ochre, to cream: the game's own colours */
function colour(v: number): [number, number, number] {
  const stops: [number, number, number, number][] = [[0, 7, 13, 23], [0.35, 26, 44, 71], [0.6, 156, 58, 40], [0.8, 224, 168, 51], [1, 243, 234, 214]];
  for (let i = 1; i < stops.length; i++) {
    if (v <= stops[i][0]) {
      const a = stops[i - 1], b = stops[i], k = (v - a[0]) / (b[0] - a[0]);
      return [a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k, a[3] + (b[3] - a[3]) * k];
    }
  }
  return [243, 234, 214];
}

/** Draw seconds [t0, t1) of a render as a spectrogram over the page: time across, 40 Hz to 12 kHz up (log), level as colour. */
function show(name: string, t0 = 0, t1?: number, title?: string) {
  const R = done.get(name);
  if (!R) throw new Error(`no render called ${name}: run() first`);
  hide();
  t1 = Math.min(t1 ?? R.secs, R.secs);
  const W = window.innerWidth, H = window.innerHeight, padL = 64, padB = 34, padT = 34, w = W - padL - 12, h = H - padT - padB;
  const c = document.createElement("canvas");
  c.id = "audiotest-spec"; c.width = W; c.height = H;
  c.style.cssText = "position:fixed;inset:0;z-index:99999;background:#070d17";
  const g = c.getContext("2d")!;
  g.fillStyle = "#070d17"; g.fillRect(0, 0, W, H);
  const img = g.createImageData(w, h), re = new Float32Array(NF), im = new Float32Array(NF), ps = new Float32Array(NF / 2);
  const fLo = 40, fHi = 12000, top = -34, floor = -96;
  for (let x = 0; x < w; x++) {
    const at = Math.round((t0 + ((t1 - t0) * x) / w) * SR) - NF / 2;
    spectrum(R.mono, Math.max(0, at), ps, re, im);
    for (let y = 0; y < h; y++) {
      const f = fLo * (fHi / fLo) ** (1 - y / h), f2 = fLo * (fHi / fLo) ** (1 - (y + 1) / h);
      // (the loudest bin the pixel covers: a thin partial is not lost between rows)
      const k0 = Math.max(1, Math.floor((f2 * NF) / SR)), k1 = Math.max(k0, Math.ceil((f * NF) / SR));
      let p = 0;
      for (let k = k0; k <= k1; k++) if (ps[k] > p) p = ps[k];
      // (tilted 3 dB an octave about 1 kHz, as analysers are: noise that sounds even looks even, low lines do not swamp the picture)
      const v = Math.max(0, Math.min(1, (10 * Math.log10(p + 1e-14) + 3 * Math.log2(f / 1000) - floor) / (top - floor)));
      const [r, gg, b] = colour(v), o = (y * w + x) * 4;
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  g.putImageData(img, padL, padT);
  g.fillStyle = "#cfc4ab"; g.font = "12px Barlow, sans-serif"; g.textBaseline = "middle"; g.textAlign = "right";
  for (const f of [50, 100, 200, 400, 800, 1600, 3200, 6400, 12000]) {
    const y = padT + h * (1 - Math.log(f / fLo) / Math.log(fHi / fLo));
    g.fillText(f >= 1000 ? `${f / 1000} kHz` : `${f} Hz`, padL - 8, y);
    g.fillStyle = "rgba(243,234,214,0.12)"; g.fillRect(padL, Math.round(y), w, 1); g.fillStyle = "#cfc4ab";
  }
  g.textAlign = "center"; g.textBaseline = "top";
  const every = t1 - t0 > 60 ? 10 : t1 - t0 > 20 ? 2 : 1;
  for (let t = Math.ceil(t0 / every) * every; t <= t1; t += every) {
    const x = padL + (w * (t - t0)) / (t1 - t0);
    g.fillText(`${t} s`, x, padT + h + 8);
    g.fillStyle = "rgba(243,234,214,0.10)"; g.fillRect(Math.round(x), padT, 1, h); g.fillStyle = "#cfc4ab";
  }
  g.textAlign = "left"; g.fillStyle = "#f0c25a"; g.font = "600 14px Barlow, sans-serif";
  g.fillText(title ?? `${name}: ${t0} to ${t1} s  ·  peak ${dB(R.peak).toFixed(1)} dB, RMS ${dB(R.rms).toFixed(1)} dB`, padL, 9);
  document.body.appendChild(c);
  return { name, t0, t1, w, h };
}
function hide() { document.getElementById("audiotest-spec")?.remove(); }

/** The notes of the tune a music render played (seed 1, by day), to read the spectrogram against. */
function tune(seed = 1, mood: Mood = "day") {
  const t = compose(seed, mood, { towns: ["Alder Run", "Marlow", "Cobb's Ferry"], company: "Carver & Sons Haulage" });
  return { name: t.name, form: t.form, key: t.key, minor: t.minor, bpm: t.bpm, swing: t.swing, lead: t.lead, bars: t.bars.length, secs: Math.round((t.beats * 60) / t.bpm), sections: t.bars.map((b) => b.sec[0] + (b.solo?.[0] ?? "-")).join(" ") };
}

/** The running game's sound. */
function live() { return (window as unknown as { app: { audio: GameAudio } }).app.audio.debug(); }

(window as unknown as { __audiotest: unknown }).__audiotest = { run, show, hide, live, tune, capture, renders: done, RENDERS };
