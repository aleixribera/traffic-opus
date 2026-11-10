// The game's sound, as the rest of the game sees it (docs/design.md, "Sound"). One object: the app binds itself to it
// and calls update() every frame; the HUD plays interface sounds and moments through it and shows its settings and
// the wireless. Everything is synthesized (bank.ts); nothing plays until the first click or key (the browser's rule),
// and nothing is set down while the tab is hidden.

import { SEASON_DAYS } from "../game/calendar";
import type { Game } from "../game/city";
import { Bank, DEFAULT_LEVELS, Engine, type Levels } from "./engine";
import { emptyMix, mixFor } from "./mixer";
import { moodFor } from "./music/compose";
import { Wireless } from "./music/player";
import { SceneReader, type Ear } from "./scene";
import type { StingId } from "./stings";
import type { UiId } from "./uisounds";
import { World } from "./world";

export type { StingId } from "./stings";
export type { UiId } from "./uisounds";

export interface AudioSettings extends Levels {
  /** the wireless is switched on */
  wireless: boolean;
  /** it sounds like a 1930s set (off: the band as it is) */
  old: boolean;
}
export const DEFAULT_SETTINGS: AudioSettings = { ...DEFAULT_LEVELS, wireless: true, old: true };
const KEY = "flowtown.audio";

/** What the sound reads of the app: the game, the camera, the hour and day shown. */
export interface AudioHost { game: Game; view: Ear; dayCycle: { hour: number; yday: number; weather?: { rain: number; snow: number; wet: number } } }

/** The six sounds the old beeper had (ui/sfx.ts): its call sites still work. */
type OldKind = "build" | "remove" | "place" | "error" | "level" | "click";
const OLD: Record<string, UiId> = { level: "upgrade" };

const UI_GAIN = 0.9, STING_GAIN = 0.55;
/** Seconds between looks at the scene. */
const LOOK = 0.2;
const SEASON_STING: StingId[] = ["spring", "summer", "autumn", "winter"];

export function loadSettings(): AudioSettings {
  const s = { ...DEFAULT_SETTINGS };
  try {
    const j = JSON.parse(localStorage.getItem(KEY) ?? "null") as Partial<AudioSettings> | null;
    if (j && typeof j === "object") {
      for (const k of ["master", "music", "world", "ui"] as const) if (typeof j[k] === "number" && Number.isFinite(j[k])) s[k] = Math.max(0, Math.min(1, j[k]!));
      for (const k of ["muted", "wireless", "old"] as const) if (typeof j[k] === "boolean") s[k] = j[k]!;
    }
  } catch { /* a browser with no storage: the defaults */ }
  return s;
}

/**
 * Stings for trouble that keeps happening are not played again within this long (s): a works on a road too slow for
 * its milk lands every load spoiled, and the game asks for the sting at each one (as the ticker names a spoiled
 * plant once an hour, not once a truck).
 */
const STING_GAP: Partial<Record<StingId, number>> = { spoil: 30 };

export class GameAudio {
  settings: AudioSettings = loadSettings();
  /** the tune the wireless is playing ("" between tunes or when it is off) */
  tune = "";
  /** called when the tune, or a setting, changes (the HUD's wireless control and sound panel) */
  onChange: (() => void) | null = null;
  readonly bank: Bank;
  private eng: Engine | null = null;
  private world: World | null = null;
  private radio: Wireless | null = null;
  private host: AudioHost | null = null;
  private reader = new SceneReader();
  private mix = emptyMix();
  private acc = LOOK;
  private lastUi = -1;
  private stingFree = 0;
  /** when each sting with a STING_GAP was last played (context time) */
  private stingAt = new Map<StingId, number>();
  private game: Game | null = null;
  private quits = 0;
  private quitAt = -100;
  private idleT = 0;
  private faults = 0;
  private sleepT: ReturnType<typeof setTimeout> | undefined;
  /** what update() costs: a running mean and the worst (ms), over `frames` frames; the worst look at the scene and the worst turn of the wireless */
  cost = { ms: 0, max: 0, frames: 0, look: 0, radio: 0 };

  constructor(opts: { worker?: boolean } = { worker: true }) {
    this.bank = new Bank({ worker: opts.worker && typeof window !== "undefined" });
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", () => {
        const ctx = this.ctx;
        if (!ctx) return;
        if (document.hidden) void ctx.suspend();
        else if (!this.silent) void ctx.resume();
      });
    }
  }

  private get ctx(): AudioContext | null { return (this.eng?.ctx as AudioContext | undefined) ?? null; }

  /** The app the sound listens to. */
  bind(host: AudioHost) { this.host = host; }

  /** A click or a key: sound may start (and comes back after the browser suspended it). */
  unlock() {
    if (!this.eng) {
      const AC = typeof AudioContext !== "undefined" ? AudioContext : undefined;
      if (!AC) return;
      try { this.start(new AC({ latencyHint: "interactive" })); } catch { return; }
    }
    const ctx = this.ctx;
    if (ctx && ctx.state !== "running" && !document.hidden && !this.silent) void ctx.resume();
    this.sleep();
  }

  /** Sound off, or the master fader all the way down: nothing is heard, so nothing need be played. */
  private get silent() { return this.settings.muted || this.settings.master <= 0; }

  /**
   * Muted, the context sleeps (once the master has faded out): the scene is not read, no sound is set down, the
   * wireless waits, and the audio thread costs nothing. Unmuted, it wakes where it left off.
   */
  private sleep() {
    const ctx = this.ctx;
    // (only the page's own context: an offline one, rendering in the tests, suspends at set times only)
    if (!ctx || typeof AudioContext === "undefined" || !(ctx instanceof AudioContext)) return;
    clearTimeout(this.sleepT);
    if (!this.silent) { if (ctx.state === "suspended" && typeof document !== "undefined" && !document.hidden) void ctx.resume(); return; }
    // (unmuted again while it was going to sleep: wake it once it has)
    this.sleepT = setTimeout(() => {
      if (this.silent && ctx.state === "running") void ctx.suspend().then(() => { if (!this.silent && !document.hidden) void ctx.resume(); });
    }, 250);
  }

  /** Build the engine on a context (the page's own, or one handed in). */
  start(ctx: BaseAudioContext) {
    this.eng = new Engine(ctx, this.bank);
    this.eng.setLevels(this.settings, true);
    this.world = new World(this.eng);
    const radio = this.radio = new Wireless(this.eng, { worker: true });
    radio.source = () => ({ towns: this.host?.game.towns.list.map((t) => t.name) ?? [], company: this.host?.game.company.name ?? "" });
    radio.mood = () => (this.host ? moodFor(this.host.dayCycle.hour, Math.floor(this.host.dayCycle.yday / SEASON_DAYS) % 4) : "day");
    radio.onTune = (name) => { this.tune = name; this.onChange?.(); };
    radio.setOld(this.settings.old);
    radio.setOn(this.settings.wireless);
  }

  // ---- settings

  /** (the old beeper's switch) */
  get muted() { return this.settings.muted; }
  set muted(v: boolean) { this.set({ muted: v }); }

  set(patch: Partial<AudioSettings>) {
    Object.assign(this.settings, patch);
    this.eng?.setLevels(this.settings);
    if (patch.muted !== undefined || patch.master !== undefined) this.sleep();
    if (patch.wireless !== undefined) this.radio?.setOn(patch.wireless);
    if (patch.old !== undefined) this.radio?.setOld(patch.old);
    try { localStorage.setItem(KEY, JSON.stringify(this.settings)); } catch { /* not kept */ }
    this.onChange?.();
  }

  toggleMute() { this.set({ muted: !this.settings.muted }); return this.settings.muted; }
  nextTune() { this.radio?.next(); }

  // ---- the interface

  /** An interface sound. Never two within 40 ms: a burst of clicks is one click. */
  play(k: UiId | OldKind, gain = 1) {
    const e = this.eng;
    if (!e || e.ctx.state !== "running") return;
    const t = e.now;
    if (t - this.lastUi < 0.04) return;
    this.lastUi = t;
    e.shot(`ui:${OLD[k] ?? k}`, e.ui, UI_GAIN * gain, { prio: 2 });
  }

  /** A road laid: gravel going down and the roller over it, as long as the road is (m), and a thump as it stops. */
  road(len: number) {
    const e = this.eng;
    if (!e || e.ctx.state !== "running") return;
    const t = e.now;
    if (t - this.lastUi < 0.04) return;
    const d = Math.max(0.22, Math.min(1.5, 0.2 + len / 320));
    // (the 40 ms rule, from when the gravel starts: not from when it ends, which left the desk mute while it ran,
    // so an undo, a "can't do that" or the next stretch of road within a second and a half made no sound at all)
    this.lastUi = t;
    e.shot("bed:gravel", e.ui, UI_GAIN * 1.5, { prio: 2, attack: 0.05, dur: d, release: 0.05, rate: 0.95 + 0.1 * e.rnd() });
    e.shot("ui:roadEnd", e.ui, UI_GAIN, { prio: 2, when: t + d + 0.02 });
  }

  // ---- moments

  /** A moment's sting. They never talk over one another: a second one waits for the first (or is dropped if the wait is long). */
  sting(id: StingId) {
    const e = this.eng;
    if (!e || e.ctx.state !== "running") return;
    const b = e.buffer(`sting:${id}`);
    if (!b) return;
    const t = e.now, at = Math.max(t, this.stingFree);
    if (at - t > 5) return;
    const gap = STING_GAP[id];
    if (gap !== undefined) {
      if (at - (this.stingAt.get(id) ?? -Infinity) < gap) return;
      this.stingAt.set(id, at);
    }
    if (e.shot(`sting:${id}`, e.ui, STING_GAIN, { prio: 2, when: at })) this.stingFree = at + b.duration * 0.8;
  }

  /** The season's title card dropping in (0 spring .. 3 winter). */
  season(i: number) { this.sting(SEASON_STING[((i % 4) + 4) % 4]); }

  /** A firework bursting on screen. */
  pop(pan = 0) { if (this.eng?.ctx.state === "running") this.world?.pop(pan); }

  // ---- every frame

  /**
   * Once a frame. The game's frame loop must never stop for the sound: a fault in here is caught, and after three
   * frames of them in a row the sound switches itself off (and says so on the console) rather than throw every frame.
   */
  update(dt: number) {
    if (!this.eng) return;
    try {
      this.step(dt);
      this.faults = 0;
    } catch (err) {
      if (++this.faults < 3) return;
      console.error("Sound stopped after an error", err);
      try { void (this.eng.ctx as AudioContext).suspend?.(); } catch { /* already gone */ }
      this.eng = null;
    }
  }

  private step(dt: number) {
    const e = this.eng;
    if (!e) return;
    const t0 = performance.now();
    if (e.ctx.state === "running") {
      const host = this.host;
      this.acc += dt;
      const looked = host !== null && this.acc >= LOOK;
      if (host && this.acc >= LOOK) {
        const g = host.game, day = host.dayCycle;
        const scene = this.reader.read(g, host.view, day.hour, Math.floor(day.yday / SEASON_DAYS) % 4, this.acc);
        const wx = day.weather;
        scene.rain = wx?.rain ?? 0; scene.snow = wx?.snow ?? 0; scene.wet = wx?.wet ?? 0;
        this.world!.apply(mixFor(scene, this.mix), scene, this.reader.where, this.acc, Math.floor(day.yday) % 7 === 6);
        this.acc = 0;
        // a driver who gave up in a jam (not more than one sigh every half minute)
        if (g !== this.game) { this.game = g; this.quits = g.traffic.jamQuits; }
        if (g.traffic.jamQuits > this.quits) {
          this.quits = g.traffic.jamQuits;
          if (e.now - this.quitAt > 30) { this.quitAt = e.now; this.sting("gaveUp"); }
        }
      }
      const t1 = performance.now();
      if (looked && t1 - t0 > this.cost.look) this.cost.look = t1 - t0;
      this.radio!.update();
      const t2 = performance.now() - t1;
      if (t2 > this.cost.radio) this.cost.radio = t2;
    }
    // (no worker: make the bank a sound at a time while nothing else is going on)
    if ((this.idleT += dt) > 0.5) { this.idleT = 0; this.bank.bakeOne(); }
    const ms = performance.now() - t0, c = this.cost;
    c.frames++;
    c.ms += (ms - c.ms) / Math.min(c.frames, 600);
    if (ms > c.max) c.max = ms;
  }

  /** What is going on, for the console and the tests. */
  debug() {
    const e = this.eng;
    return {
      state: e?.ctx.state ?? "off", live: e?.live() ?? 0, peak: e?.peakLive ?? 0, held: e?.held ?? 0, played: e?.played ?? 0, refused: e?.refused ?? 0,
      ready: this.bank.ready, total: this.bank.total, avgMs: +this.cost.ms.toFixed(4), maxMs: +this.cost.max.toFixed(3), maxLookMs: +this.cost.look.toFixed(3), maxRadioMs: +this.cost.radio.toFixed(3), frames: this.cost.frames, tune: this.tune,
      loops: this.world?.loops ?? 0, scene: this.reader.scene, where: this.reader.where, mix: this.mix,
    };
  }
}
