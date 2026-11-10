// The wireless (docs/design.md, "Sound"): performs the tunes compose.ts writes. The piano, the bass and the brushes
// are the bank's sampled notes, pitched and enveloped; the horn (a muted trumpet or a clarinet) is the one live
// synth: an oscillator with a vibrato, scooped into its notes. The whole band goes through the set's voicing: a
// small speaker's band, a valve's gentle squash, a faint crackle that stays on between tunes.
//
// Notes are set down a third of a second ahead of the audio clock, from the frame loop: a hidden tab schedules
// nothing, and a late frame only delays a note it had not yet reached.
//
// The next tune is written ahead, while this one plays, by a worker (compose.worker.ts): writing one takes a few
// milliseconds, and the session's first several more (review 2026-11-10: the radio's 51 ms worst frame). With no
// worker (the offline renders, the tests) it is written here, in an idle moment.

import { BASS_BASE, PIANO_BASE } from "../bank";
import { midiHz } from "../dsp";
import { Engine, Loop } from "../engine";
import { compose, swung, type Mood, type NameSource, type Note } from "./compose";
import { noteAt, sheetOf, type Sheet } from "./sheet";
import type { WriteAsk } from "./compose.worker";

const AHEAD = 0.35;
/** How long a tune due to start waits for the worker's before it is written here (s). */
const WAIT_WRITER = 2;
const idleCall = (f: () => void, timeout: number): boolean => {
  const idle = (globalThis as { requestIdleCallback?: (f: () => void, o?: { timeout: number }) => number }).requestIdleCallback;
  if (!idle) return false;
  idle(f, { timeout });
  return true;
};
/** Each part's level in the band. */
const LEVEL = { piano: 0.5, comp: 0.24, bass: 0.5, lead: 0.26, tap: 0.5, swish: 0.4, hat: 0.32, kick: 0.3, cym: 0.4 };
/** The band's level into the set, and the set's crackle. */
const BAND = 0.75, CRACKLE = 0.16;
/** The band without the set, brought to the same loudness. */
const CLEAN = 1.75;
const namesOf = (s: NameSource) => s.company + "|" + s.towns.join("|");

const nearest = (bases: number[], m: number) => { let b = bases[0]; for (const x of bases) if (Math.abs(x - m) < Math.abs(b - m)) b = x; return b; };

export class Wireless {
  tune: Sheet | null = null;
  /** called when a tune starts ("" when the set goes quiet) */
  onTune: ((name: string) => void) | null = null;
  /** where the names come from, and the hour's mood, asked as each tune is written */
  source: () => NameSource = () => ({ towns: [], company: "" });
  mood: () => Mood = () => "day";
  seed: () => number = () => Math.floor(Math.random() * 2 ** 31);
  private on = false;
  private band: GainNode;
  private setIn: GainNode;
  private setOut: GainNode;
  private clean: GainNode;
  private crackle: Loop;
  private horn: { osc: OscillatorNode; lfo: OscillatorNode; vib: GainNode; tone: BiquadFilterNode; nose: BiquadFilterNode; amp: GainNode; waves: Record<"trumpet" | "clarinet", PeriodicWave> } | null = null;
  /** context time of the tune's first beat, the next note to set down, seconds a beat */
  private t0 = 0;
  private idx = 0;
  private spb = 0.5;
  /** when the next tune may start (context time) */
  private startAt = 0;
  private recent: string[] = [];
  private old = true;
  /** when the horn's last note ends (it is not re-tongued inside a slur) */
  private hornEnd = 0;
  /** the next tune, written ahead (by the worker, or here while the browser had nothing to do) */
  private ahead: { tune: Sheet; mood: Mood; names: string } | null = null;
  private asked = false;
  /** the worker that writes the tunes, and the tune it is writing */
  private writer: Worker | null = null;
  private writing: { id: number; mood: Mood; names: string } | null = null;
  private asks = 0;
  /** since when (context time) a tune due to start has waited for the worker's */
  private waitFrom = 0;
  private hornAsked = false;

  constructor(private e: Engine, opts: { worker?: boolean } = {}) {
    if (opts.worker && typeof Worker !== "undefined") {
      try {
        const w = new Worker(new URL("./compose.worker.ts", import.meta.url), { type: "module" });
        w.onmessage = (ev: MessageEvent<{ id: number; sheet: Sheet }>) => {
          const W = this.writing;
          if (!W || ev.data.id !== W.id) return;
          this.writing = null;
          this.ahead = { tune: ev.data.sheet, mood: W.mood, names: W.names };
        };
        w.onerror = () => { this.writer = null; this.writing = null; };
        this.writer = w;
      } catch { this.writer = null; }
    }
    const ctx = e.ctx;
    const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.band = g(BAND);
    // the set: a small speaker in a wooden box
    this.setIn = g(1);
    // (no bottom at all: the bass is heard by its overtones, as on any small speaker, and stays out of the engines' way)
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 165; hp.Q.value = 0.7;
    const hp2 = ctx.createBiquadFilter(); hp2.type = "highpass"; hp2.frequency.value = 165; hp2.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3600; lp.Q.value = 0.8;
    const box = ctx.createBiquadFilter(); box.type = "peaking"; box.frequency.value = 1100; box.Q.value = 0.8; box.gain.value = 4;
    const valve = ctx.createWaveShaper();
    const N = 1025, curve = new Float32Array(N), d = 1.6;
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(x * d) / Math.tanh(d); }
    valve.curve = curve;
    this.setOut = g(1);
    this.clean = g(0);
    this.band.connect(this.setIn);
    this.setIn.connect(hp); hp.connect(hp2); hp2.connect(lp); lp.connect(box); box.connect(valve); valve.connect(this.setOut); this.setOut.connect(e.music);
    this.band.connect(this.clean); this.clean.connect(e.music);
    this.crackle = new Loop(e, "bed:crackle", this.setIn);
  }

  get playing() { return this.on; }
  get name() { return this.on && this.tune ? this.tune.name : ""; }

  /** The set's tone: the old wireless (band-limited, a little squashed, crackling) or the band as it is. */
  setOld(old: boolean) {
    this.old = old;
    const t = this.e.now;
    this.setOut.gain.setTargetAtTime(old ? 1 : 0, t, 0.08);
    this.clean.gain.setTargetAtTime(old ? 0 : CLEAN, t, 0.08);
  }

  setOn(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    this.waitFrom = 0;
    if (on) { this.band.gain.setTargetAtTime(BAND, this.e.now, 0.05); this.startAt = this.e.now + 1.2; }
    else { this.hush(); this.dropHorn(); }
    if (!on) this.onTune?.("");
  }

  /** The set switched off: the horn's two oscillators stop once it has faded (they would run on, silent, for good). */
  private dropHorn() {
    const h = this.horn;
    if (!h) return;
    this.horn = null;
    const end = this.e.now + 0.4;
    h.osc.onended = () => { h.osc.disconnect(); h.lfo.disconnect(); h.amp.disconnect(); };
    h.osc.stop(end);
    h.lfo.stop(end);
    this.e.held -= 2;
  }

  /** Turn to another tune. */
  next() {
    if (!this.on) return;
    this.hush();
    this.band.gain.setTargetAtTime(BAND, this.e.now + 0.5, 0.05);
    this.startAt = this.e.now + 0.9;
  }

  /** Cut the band off (what is already set down fades with it). */
  private hush() {
    const t = this.e.now;
    this.waitFrom = 0;
    this.band.gain.cancelScheduledValues(t);
    this.band.gain.setTargetAtTime(0, t, 0.07);
    this.tune = null;
    if (this.horn) {
      const h = this.horn;
      h.amp.gain.cancelScheduledValues(t); h.amp.gain.setTargetAtTime(0, t, 0.05);
      h.osc.frequency.cancelScheduledValues(t); h.vib.gain.cancelScheduledValues(t); h.tone.frequency.cancelScheduledValues(t);
    }
  }

  private ready(): boolean {
    const b = this.e.bank;
    return b.has("piano:60") && b.has("piano:48") && b.has("bass:40") && b.has("drum:tap") && b.has("drum:hat");
  }

  /** Write the next tune ahead (by the worker, or in an idle moment), so that starting it costs the frame nothing. */
  private prepare() {
    if (this.ahead || this.writing) return;
    if (this.writer) {
      const mood = this.mood(), src = this.source();
      const ask: WriteAsk = { id: ++this.asks, seed: this.seed(), mood, src: { towns: [...src.towns], company: src.company }, avoid: [...this.recent] };
      this.writing = { id: ask.id, mood, names: namesOf(src) };
      this.writer.postMessage(ask);
      return;
    }
    if (this.asked) return;
    this.asked = idleCall(() => {
      this.asked = false;
      if (this.ahead) return;
      const mood = this.mood(), src = this.source();
      this.ahead = { mood, names: namesOf(src), tune: sheetOf(compose(this.seed(), mood, src, new Set(this.recent))) };
    }, 5000);
  }

  /** The horn's oscillators and waves, made in an idle moment before the first tune needs them. */
  private prepareHorn() {
    if (this.horn || this.hornAsked) return;
    this.hornAsked = idleCall(() => { this.hornAsked = false; if (this.on && !this.horn) this.makeHorn(); }, 1000);
  }

  /** Start the next tune; false while it waits for the worker to write it. */
  private begin(): boolean {
    const e = this.e, avoid = new Set(this.recent), mood = this.mood(), src = this.source(), names = namesOf(src), a = this.ahead;
    // (the one written ahead, unless the hour has turned since, or another save was loaded: a night tune is not
    // played at noon, nor one named after a town that is not on this map)
    let tune = a && a.mood === mood && a.names === names && !avoid.has(a.tune.name) ? a.tune : null;
    this.ahead = null;
    if (!tune) {
      // the worker writes one for now; if it is slow to, it is written here
      if (this.writer && (!this.waitFrom || e.now - this.waitFrom < WAIT_WRITER)) {
        if (!this.waitFrom) this.waitFrom = e.now;
        if (this.writing && (this.writing.mood !== mood || this.writing.names !== names)) this.writing = null;
        this.prepare();
        return false;
      }
      tune = sheetOf(compose(this.seed(), mood, src, avoid));
    }
    this.waitFrom = 0;
    this.recent.push(tune.name);
    if (this.recent.length > 24) this.recent.shift();
    this.tune = tune;
    this.idx = 0;
    this.spb = 60 / tune.bpm;
    this.t0 = e.now + 0.25;
    this.hornEnd = 0;
    if (!this.horn) this.makeHorn();
    const h = this.horn!;
    h.osc.setPeriodicWave(h.waves[tune.lead]);
    const cl = tune.lead === "clarinet";
    h.nose.gain.setValueAtTime(cl ? 0 : 9, e.now);
    this.onTune?.(tune.name);
    return true;
  }

  private makeHorn() {
    const e = this.e, ctx = e.ctx;
    const wave = (amp: (k: number) => number, n: number) => {
      const re = new Float32Array(n + 1), im = new Float32Array(n + 1);
      for (let k = 1; k <= n; k++) im[k] = amp(k);
      return ctx.createPeriodicWave(re, im);
    };
    const CL = [0, 1, 0.03, 0.42, 0.02, 0.2, 0.02, 0.09, 0.01, 0.04];
    const waves = { trumpet: wave((k) => 1 / k ** 0.85, 20), clarinet: wave((k) => CL[k] ?? 0, 9) };
    const osc = ctx.createOscillator(), lfo = ctx.createOscillator();
    lfo.frequency.value = 5.4;
    const vib = ctx.createGain(); vib.gain.value = 0;
    lfo.connect(vib); vib.connect(osc.detune);
    const tone = ctx.createBiquadFilter(); tone.type = "lowpass"; tone.frequency.value = 1200; tone.Q.value = 0.9;
    // a mute's nasal ring (flat for the clarinet)
    const nose = ctx.createBiquadFilter(); nose.type = "peaking"; nose.frequency.value = 1500; nose.Q.value = 2.2; nose.gain.value = 9;
    const amp = ctx.createGain(); amp.gain.value = 0;
    osc.connect(tone); tone.connect(nose); nose.connect(amp); amp.connect(this.band);
    osc.start(); lfo.start();
    e.held += 2;
    this.horn = { osc, lfo, vib, tone, nose, amp, waves };
  }

  /** Set down the notes that fall due. Called every frame; cheap. */
  update() {
    const e = this.e, now = e.now;
    this.crackle.set(this.on && this.old ? CRACKLE : 0, 1 / 60, 1, 0.5);
    if (!this.on) return;
    if (!this.tune) {
      // (the next tune is written, and the horn made, while the set's noise plays between tunes)
      this.prepareHorn();
      this.prepare();
      if (now >= this.startAt && this.ready()) this.begin();
      return;
    }
    this.prepare();
    const T = this.tune, spb = this.spb, t0 = this.t0;
    // (a tab that slept, a frame that hung: skip what is past instead of playing it all at once)
    while (this.idx < T.count) {
      const k = this.idx, at = t0 + swung(T.t[k], T.swing) * spb;
      if (at > now + AHEAD) break;
      this.idx++;
      if (at < now - 0.05) continue;
      this.play(noteAt(T, k), Math.max(at, now + 0.005), T);
    }
    if (this.idx >= T.count && now > t0 + T.beats * spb) {
      // the tune is over: a few seconds of the set's own noise, then another
      this.tune = null;
      this.startAt = now + 3 + 3 * e.rnd();
      this.onTune?.("");
    }
  }

  private play(n: Note, at: number, T: Sheet) {
    const e = this.e, spb = this.spb, r = e.rnd;
    const dur = Math.max(0.09, (swung(n.t + n.d, T.swing) - swung(n.t, T.swing)) * spb);
    if (n.i === "lead") { this.hornNote(n, at, dur); return; }
    if (n.i === "bass") {
      const base = nearest(BASS_BASE, n.m);
      e.shot(`bass:${base}`, this.band, n.v * LEVEL.bass, { rate: 2 ** ((n.m - base) / 12), when: at + 0.004 * r(), dur: dur * 0.96, release: 0.05 });
      return;
    }
    if (n.i === "piano" || n.i === "comp") {
      const base = nearest(PIANO_BASE, n.m);
      // (a hand is never quite together: a chord's notes land a few thousandths apart)
      e.shot(`piano:${base}`, this.band, n.v * LEVEL[n.i], { rate: 2 ** ((n.m - base) / 12), when: at + (n.i === "comp" ? 0.012 * r() : 0.004 * r()), dur: dur + 0.03, release: 0.09 });
      return;
    }
    e.shot(`drum:${n.i}`, this.band, n.v * LEVEL[n.i] * (0.9 + 0.2 * r()), { when: at + 0.003 * r() });
  }

  private hornNote(n: Note, at: number, dur: number) {
    const h = this.horn;
    if (!h) return;
    const f = midiHz(n.m), level = n.v * LEVEL.lead;
    const slur = at - this.hornEnd < 0.03;
    // the pitch: scooped up into the note (more when written so), a fall off its end
    const scoop = n.bend === "scoop" ? 0.945 : slur ? 0.997 : 0.985;
    h.osc.frequency.setValueAtTime(f * scoop, at);
    h.osc.frequency.setTargetAtTime(f, at, n.bend === "scoop" ? 0.045 : 0.012);
    if (n.bend === "fall" && dur > 0.4) h.osc.frequency.setTargetAtTime(f * 0.84, at + dur - 0.22, 0.14);
    // the breath: a quick start, a slight lean, then let go (a slurred note is only re-tongued lightly)
    h.amp.gain.setTargetAtTime(level, at, slur ? 0.012 : 0.022);
    h.amp.gain.setTargetAtTime(level * 0.82, at + 0.09, 0.2);
    h.amp.gain.setTargetAtTime(0, at + dur - 0.025, dur > 0.6 ? 0.06 : 0.035);
    // the tone opens as the note speaks
    const bright = 900 + 2600 * n.v;
    h.tone.frequency.setTargetAtTime(bright, at, 0.025);
    h.tone.frequency.setTargetAtTime(bright * 0.62, at + 0.07, 0.12);
    // vibrato on a note held long enough to carry one
    h.vib.gain.setTargetAtTime(0, at, 0.015);
    if (dur > 0.38) h.vib.gain.setTargetAtTime(22, at + 0.17, 0.14);
    this.hornEnd = at + dur;
  }
}
