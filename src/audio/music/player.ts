// The wireless (docs/design.md, "Sound"): performs the tunes compose.ts writes. The piano, the bass and the brushes
// are the bank's sampled notes, pitched and enveloped; the horn (a muted trumpet or a clarinet) is the one live
// synth: an oscillator with a vibrato, scooped into its notes. The whole band goes through the set's voicing: a
// small speaker's band, a valve's gentle squash, a faint crackle that stays on between tunes.
//
// Notes are set down a third of a second ahead of the audio clock, from the frame loop: a hidden tab schedules
// nothing, and a late frame only delays a note it had not yet reached.

import { BASS_BASE, PIANO_BASE } from "../bank";
import { midiHz } from "../dsp";
import { Engine, Loop } from "../engine";
import { compose, swung, type Mood, type NameSource, type Note, type Tune } from "./compose";

const AHEAD = 0.35;
/** Each part's level in the band. */
const LEVEL = { piano: 0.5, comp: 0.26, bass: 0.62, lead: 0.2, tap: 0.3, swish: 0.22, hat: 0.2, kick: 0.3, cym: 0.3 };
/** The band's level into the set, and the set's crackle. */
const BAND = 0.9, CRACKLE = 0.16;

const nearest = (bases: number[], m: number) => { let b = bases[0]; for (const x of bases) if (Math.abs(x - m) < Math.abs(b - m)) b = x; return b; };

export class Wireless {
  tune: Tune | null = null;
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

  constructor(private e: Engine) {
    const ctx = e.ctx;
    const g = (v: number) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.band = g(BAND);
    // the set: a small speaker in a wooden box
    this.setIn = g(1);
    const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 125; hp.Q.value = 0.7;
    const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 3300; lp.Q.value = 0.8;
    const box = ctx.createBiquadFilter(); box.type = "peaking"; box.frequency.value = 950; box.Q.value = 0.8; box.gain.value = 3.5;
    const valve = ctx.createWaveShaper();
    const N = 1025, curve = new Float32Array(N), d = 1.6;
    for (let i = 0; i < N; i++) { const x = (i / (N - 1)) * 2 - 1; curve[i] = Math.tanh(x * d) / Math.tanh(d); }
    valve.curve = curve;
    this.setOut = g(1);
    this.clean = g(0);
    this.band.connect(this.setIn);
    this.setIn.connect(hp); hp.connect(lp); lp.connect(box); box.connect(valve); valve.connect(this.setOut); this.setOut.connect(e.music);
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
    this.clean.gain.setTargetAtTime(old ? 0 : 0.8, t, 0.08);
  }

  setOn(on: boolean) {
    if (on === this.on) return;
    this.on = on;
    if (on) { this.band.gain.setTargetAtTime(BAND, this.e.now, 0.05); this.startAt = this.e.now + 1.2; }
    else this.hush();
    if (!on) this.onTune?.("");
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

  private begin() {
    const e = this.e, avoid = new Set(this.recent);
    const tune = compose(this.seed(), this.mood(), this.source(), avoid);
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
      if (now >= this.startAt && this.ready()) this.begin();
      return;
    }
    const T = this.tune, ns = T.notes, spb = this.spb, t0 = this.t0;
    // (a tab that slept, a frame that hung: skip what is past instead of playing it all at once)
    while (this.idx < ns.length) {
      const n = ns[this.idx], at = t0 + swung(n.t, T.swing) * spb;
      if (at > now + AHEAD) break;
      this.idx++;
      if (at < now - 0.05) continue;
      this.play(n, Math.max(at, now + 0.005), T);
    }
    if (this.idx >= ns.length && now > t0 + T.beats * spb) {
      // the tune is over: a few seconds of the set's own noise, then another
      this.tune = null;
      this.startAt = now + 3 + 3 * e.rnd();
      this.onTune?.("");
    }
  }

  private play(n: Note, at: number, T: Tune) {
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
