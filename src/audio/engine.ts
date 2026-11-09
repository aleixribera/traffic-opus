// The engine (docs/design.md, "Sound"): one audio context (the page's, or an offline one for the measured renders),
// three buses (music, world, interface) into a gentle compressor and a soft clip that nothing gets past, a bank of
// buffers rendered by pure DSP (bank.ts, off the main thread), and a strict budget of live sources.
//
// Everything that plays is a buffer source: a loop (Loop: a bed that fades in and out, and is stopped once silent) or
// a one-shot (shot). The only oscillators are the wireless's horn (music/player.ts).

import { allKeys, renderKey } from "./bank";
import { SR } from "./dsp";

/** Live sources never go over this; world one-shots give way first, then the band's notes. */
export const MAX_SOURCES = 48;

export interface Levels { master: number; music: number; world: number; ui: number; muted: boolean }
export const DEFAULT_LEVELS: Levels = { master: 0.8, music: 0.6, world: 0.8, ui: 0.7, muted: false };

/** A slider's position as a gain (a square law: half way sounds about half as loud). */
const law = (x: number) => Math.max(0, Math.min(1, x)) ** 2;

/** The compressor's settings, and what Chrome's built-in make-up gain comes to with them (measured; see the harness). */
const COMP = { threshold: -16, knee: 12, ratio: 4, attack: 0.006, release: 0.22 };
export const COMP_MAKEUP = 1.662;
/** The soft clip: straight up to KNEE, then easing to CEIL. Nothing leaves the engine above CEIL. */
const KNEE = 0.5, CEIL = 0.86;

/**
 * The bank: every sound as a buffer, made by pure DSP. A worker makes them from the moment the page loads (no audio
 * context needed), so they are there by the first click; with no worker they are made here, one per idle moment.
 */
export class Bank {
  private bufs = new Map<string, AudioBuffer>();
  private asked = new Set<string>();
  private worker: Worker | null = null;

  constructor(opts: { worker?: boolean } = {}) {
    if (opts.worker && typeof Worker !== "undefined") {
      try {
        this.worker = new Worker(new URL("./bank.worker.ts", import.meta.url), { type: "module" });
        this.worker.onmessage = (e: MessageEvent<{ key: string; data: Float32Array | null }>) => { if (e.data.data) this.store(e.data.key, e.data.data); };
        this.worker.onerror = () => { this.worker = null; };
        const keys = allKeys();
        for (const k of keys) this.asked.add(k);
        this.worker.postMessage({ keys });
      } catch { this.worker = null; }
    }
  }

  private store(key: string, data: Float32Array) {
    const b = new AudioBuffer({ length: data.length, numberOfChannels: 1, sampleRate: SR });
    b.getChannelData(0).set(data);
    this.bufs.set(key, b);
  }

  /** A sound's buffer, if it is made yet. One not made is asked for (and jumps the queue); it plays next time. */
  get(key: string): AudioBuffer | null {
    const b = this.bufs.get(key);
    if (b) return b;
    if (this.worker) {
      if (!this.asked.has(key)) { this.asked.add(key); this.worker.postMessage({ keys: [key], first: key }); }
      else this.worker.postMessage({ first: key });
    }
    return null;
  }

  has(key: string) { return this.bufs.has(key); }
  get ready() { return this.bufs.size; }
  get total() { return allKeys().length; }

  /** Make sounds here and now (the offline renders). Slow: never in the frame loop. */
  bake(keys: string[] = allKeys()) {
    for (const k of keys) if (!this.bufs.has(k)) this.store(k, renderKey(k));
  }

  /** Make one missing sound on the main thread: the fallback when there is no worker (called when idle). */
  bakeOne(): boolean {
    if (this.worker) return false;
    for (const k of allKeys()) if (!this.bufs.has(k)) { this.store(k, renderKey(k)); return true; }
    return false;
  }
}

export interface ShotOpts {
  pan?: number;
  rate?: number;
  /** context time to start at (now if not given or past) */
  when?: number;
  /** fade in over this long (s): a bed played as a one-shot */
  attack?: number;
  /** held for this long (s), then released over `release` (a note); not given: played to its end */
  dur?: number;
  release?: number;
  /** 0: gives way first (ambience); 1: the band and events; 2: always plays (interface, moments) */
  prio?: 0 | 1 | 2;
}

export class Engine {
  readonly ctx: BaseAudioContext;
  /** bus inputs */
  readonly music: GainNode;
  readonly world: GainNode;
  readonly ui: GainNode;
  /** the world's duck (a pause): between the world's layers and its bus fader */
  private duck: GainNode;
  private master: GainNode;
  private faders: { music: GainNode; world: GainNode; ui: GainNode };
  /** when each playing one-shot ends (context time); a slot at or before now is free */
  private ends = new Float64Array(96);
  /** loops and oscillators running */
  held = 0;
  peakLive = 0;
  refused = 0;
  played = 0;
  private seed = 12345;
  levels: Levels = { ...DEFAULT_LEVELS };

  constructor(ctx: BaseAudioContext, readonly bank: Bank) {
    this.ctx = ctx;
    const g = (v = 1) => { const n = ctx.createGain(); n.gain.value = v; return n; };
    this.music = g(); this.world = g(); this.ui = g();
    this.duck = g();
    this.faders = { music: g(), world: g(), ui: g() };
    const sum = g();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = COMP.threshold; comp.knee.value = COMP.knee; comp.ratio.value = COMP.ratio;
    comp.attack.value = COMP.attack; comp.release.value = COMP.release;
    const trim = g(1 / COMP_MAKEUP);
    const clip = ctx.createWaveShaper();
    const N = 2049, curve = new Float32Array(N);
    for (let i = 0; i < N; i++) {
      const x = (i / (N - 1)) * 2 - 1, a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= KNEE ? a : KNEE + (CEIL - KNEE) * Math.tanh((a - KNEE) / (CEIL - KNEE)));
    }
    clip.curve = curve;
    this.master = g(0);
    this.music.connect(this.faders.music);
    this.world.connect(this.duck); this.duck.connect(this.faders.world);
    this.ui.connect(this.faders.ui);
    for (const f of Object.values(this.faders)) f.connect(sum);
    // (nothing under 30 Hz: no speaker plays it, and it would only work the compressor)
    const sub = ctx.createBiquadFilter(); sub.type = "highpass"; sub.frequency.value = 30; sub.Q.value = 0.7;
    sum.connect(sub); sub.connect(comp); comp.connect(trim); trim.connect(clip); clip.connect(this.master); this.master.connect(ctx.destination);
    this.setLevels(this.levels, true);
  }

  get now() { return this.ctx.currentTime; }

  /** A repeatable random number (the offline renders must come out the same every time). */
  rnd = () => {
    let t = (this.seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  setLevels(l: Levels, now = false) {
    this.levels = { ...l };
    const t = this.ctx.currentTime;
    const set = (p: AudioParam, v: number) => { if (now) p.value = v; else p.setTargetAtTime(v, t, 0.04); };
    set(this.master.gain, l.muted ? 0 : law(l.master));
    set(this.faders.music.gain, law(l.music));
    set(this.faders.world.gain, law(l.world));
    set(this.faders.ui.gain, law(l.ui));
  }

  /** Duck the world (a pause). */
  setDuck(v: number) { this.duck.gain.setTargetAtTime(v, this.ctx.currentTime, 0.25); }

  buffer(key: string): AudioBuffer | null { return this.bank.get(key); }

  /** Sources sounding now. */
  live(): number {
    const t = this.ctx.currentTime, e = this.ends;
    let n = this.held;
    for (let i = 0; i < e.length; i++) if (e[i] > t) n++;
    if (n > this.peakLive) this.peakLive = n;
    return n;
  }

  private track(end: number) {
    const t = this.ctx.currentTime, e = this.ends;
    let k = 0, min = Infinity;
    for (let i = 0; i < e.length; i++) {
      if (e[i] <= t) { k = i; break; }
      if (e[i] < min) { min = e[i]; k = i; }
    }
    e[k] = end;
  }

  /** Play a buffer once into a bus. False if it isn't made yet or the budget is spent. */
  shot(key: string, bus: AudioNode, gain: number, o: ShotOpts = {}): boolean {
    if (gain <= 0.0005) return false;
    const b = this.buffer(key);
    if (!b) return false;
    const prio = o.prio ?? 1;
    if (this.live() >= (prio === 2 ? MAX_SOURCES : prio === 1 ? MAX_SOURCES - 4 : MAX_SOURCES - 12)) { this.refused++; return false; }
    const ctx = this.ctx, rate = o.rate ?? 1;
    const t = Math.max(o.when ?? 0, ctx.currentTime);
    const src = ctx.createBufferSource();
    src.buffer = b; src.playbackRate.value = rate;
    const g = ctx.createGain();
    g.gain.value = gain;
    src.connect(g);
    let tail: AudioNode = g;
    if (o.pan) { const p = ctx.createStereoPanner(); p.pan.value = Math.max(-1, Math.min(1, o.pan)); g.connect(p); tail = p; }
    tail.connect(bus);
    let end = t + b.duration / rate;
    if (o.attack) { g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(gain, t + o.attack); }
    src.start(t);
    if (o.dur !== undefined) {
      const rel = o.release ?? 0.08, off = t + o.dur;
      if (off + rel * 4 < end) {
        g.gain.setValueAtTime(gain, off);
        g.gain.setTargetAtTime(0, off, rel);
        end = off + rel * 5;
        src.stop(end);
      }
    }
    src.onended = () => { tail.disconnect(); };
    this.track(end);
    this.played++;
    return true;
  }
}

/**
 * A bed: a looping buffer behind a gain (and a filter or a panner if asked for). It starts when it is first wanted
 * and its buffer is made, follows its level with a slow glide, and gives its source back once it has been silent a
 * while.
 */
export class Loop {
  readonly gain: GainNode;
  readonly filter: BiquadFilterNode | null = null;
  readonly pan: StereoPannerNode | null = null;
  private src: AudioBufferSourceNode | null = null;
  private quiet = 0;
  private g = 0;
  private rate = 1;
  key: string;

  constructor(private eng: Engine, key: string, dest: AudioNode, o: { filter?: BiquadFilterType; pan?: boolean; q?: number } = {}) {
    this.key = key;
    const ctx = eng.ctx;
    this.gain = ctx.createGain();
    this.gain.gain.value = 0;
    let tail: AudioNode = this.gain;
    if (o.filter) {
      this.filter = ctx.createBiquadFilter();
      this.filter.type = o.filter; this.filter.Q.value = o.q ?? 0.7;
      tail.connect(this.filter); tail = this.filter;
    }
    if (o.pan) { this.pan = ctx.createStereoPanner(); tail.connect(this.pan); tail = this.pan; }
    tail.connect(dest);
  }

  get on() { return this.src !== null; }

  /** Set the level (and pitch) to glide to. `dt`: time since the last call, to count the silence. */
  set(g: number, dt: number, rate = 1, tau = 0.3) {
    const eng = this.eng, t = eng.now;
    if (g > 0.002 && !this.src) this.start();
    if (!this.src) return;
    if (g !== this.g) { this.gain.gain.setTargetAtTime(g, t, tau); this.g = g; }
    if (rate !== this.rate) { this.src.playbackRate.setTargetAtTime(rate, t, 0.4); this.rate = rate; }
    if (g <= 0.002) {
      this.quiet += dt;
      if (this.quiet > tau * 5 + 0.2) this.stop();
    } else this.quiet = 0;
  }

  /** Change which buffer it loops (a works slot taken by another kind of works). Only while silent. */
  retune(key: string) {
    if (key === this.key) return;
    this.stop();
    this.key = key;
  }

  private start() {
    const eng = this.eng, b = eng.buffer(this.key);
    if (!b || eng.live() >= MAX_SOURCES - 2) return;
    const src = eng.ctx.createBufferSource();
    src.buffer = b; src.loop = true; src.playbackRate.value = this.rate;
    src.connect(this.gain);
    // (each bed from its own place in its loop: two of a kind never run in step)
    src.start(0, eng.rnd() * b.duration);
    this.src = src;
    this.quiet = 0;
    this.g = 0;
    this.gain.gain.setValueAtTime(0, eng.now);
    eng.held++;
  }

  stop() {
    if (!this.src) return;
    const t = this.eng.now;
    this.gain.gain.cancelScheduledValues(t);
    this.gain.gain.setTargetAtTime(0, t, 0.02);
    this.src.stop(t + 0.12);
    const src = this.src;
    src.onended = () => src.disconnect();
    this.src = null;
    this.g = 0;
    this.eng.held--;
  }
}
