// The world's sound (docs/design.md, "Sound"): takes the mixer's levels and paces (mixer.ts) a few times a second
// and plays them. The beds are loops that glide to their levels; the events (a bird, a horn, a hammer, the clock) are
// drawn at their pace per minute and played once; the three vehicles nearest the middle of a street-level view get a
// voice each, panned where they are and bent a little as they pass.

import { shotKey, variants } from "./bank";
import { Engine, Loop } from "./engine";
import { NW, WORKS, strokes, type Mix, type Scene } from "./mixer";
import type { Where } from "./scene";
import type { ShotId } from "./sounds";

/** Each layer's level when the mixer says 1 (set by ear's stand-in: the measured renders, see audio/harness.ts). */
export const TRIM = {
  wind: 0.6, air: 0.4, hum: 0.8, tyres: 2.4, water: 0.55, rain: 0.32, crickets: 0.5, murmur: 1.0,
  eng: 1.7, idle: 1.1, pass: 1.5, works: 2.1,
  bird: 0.24, owl: 0.3, horn: 0.5, gate: 0.5, event: 0.55, town: 0.4, clock: 0.6, build: 0.7, pop: 0.8,
};

/** How many works beds sound at once (the loudest in view), and how many vehicles are heard one by one. */
const WORKS_SLOTS = 4, PASS_SLOTS = 3;
const PASS_KEYS = ["bed:car", "bed:light", "bed:heavy", "bed:train"];
const PASS_GAIN = [0.8, 0.95, 1.1, 1.15];

const clampPan = (p: number) => (p < -1 ? -1 : p > 1 ? 1 : p);

const E = { bird: 0, owl: 1, horn: 2, gate: 3, clank: 4, steam: 5, blast: 6, axe: 7, rooster: 8, cow: 9, hornTest: 10, clink: 11, build: 12, shopbell: 13, dog: 14, children: 15 } as const;
const NE = 16;

interface Pass { loop: Loop; id: number; cls: number; pan: number; fresh: boolean }

export class World {
  private pink: Loop;
  private windF: BiquadFilterNode;
  private windG: GainNode;
  private airG: GainNode;
  private humG: GainNode;
  private tyreF: BiquadFilterNode;
  private tyreG: GainNode;
  private water: Loop;
  private rain: Loop;
  private crickets: Loop;
  private murmur: Loop;
  private eng: Loop[];
  private idle: Loop;
  private works: { loop: Loop; bed: number }[] = [];
  private pass: Pass[] = [];
  /** countdowns to each kind of event, in events (1 = one expected gap) */
  private due = new Float32Array(NE);
  private gust = 1;
  private gustTo = 1;
  private gustT = 0;
  private hornAt = -100;
  private blastAt = -100;
  private lastHour = -1;
  private strokesLeft = 0;
  private strokeAt = 0;
  private strokeGain = 0;
  private strokePan = 0;
  private lastBird = -1;
  private order = new Int32Array(NW);

  constructor(private e: Engine) {
    const ctx = e.ctx, out = e.world;
    const gain = () => { const g = ctx.createGain(); g.gain.value = 0; return g; };
    const filter = (type: BiquadFilterType, f: number, q: number) => { const n = ctx.createBiquadFilter(); n.type = type; n.frequency.value = f; n.Q.value = q; return n; };
    // one loop of pink noise feeds the wind, the thin winter air, the far hum and the tyres, each through its own filter
    const bus = ctx.createGain();
    this.pink = new Loop(e, "bed:pink", bus);
    this.windF = filter("bandpass", 500, 0.55); this.windG = gain();
    bus.connect(this.windF); this.windF.connect(this.windG); this.windG.connect(out);
    const airF = filter("highpass", 2600, 0.7); this.airG = gain();
    bus.connect(airF); airF.connect(this.airG); this.airG.connect(out);
    const humF = filter("bandpass", 140, 0.8); this.humG = gain();
    bus.connect(humF); humF.connect(this.humG); this.humG.connect(out);
    this.tyreF = filter("bandpass", 1000, 0.8); this.tyreG = gain();
    bus.connect(this.tyreF); this.tyreF.connect(this.tyreG); this.tyreG.connect(out);
    this.water = new Loop(e, "bed:water", out);
    this.rain = new Loop(e, "bed:rain", out);
    this.crickets = new Loop(e, "bed:crickets", out);
    this.murmur = new Loop(e, "bed:murmur", out, { pan: true });
    this.eng = ["carBed", "lightBed", "heavyBed", "trainBed"].map((k) => new Loop(e, `bed:${k}`, out));
    this.idle = new Loop(e, "bed:idle", out);
    for (let i = 0; i < WORKS_SLOTS; i++) this.works.push({ loop: new Loop(e, "bed:saw", out, { pan: true }), bed: -1 });
    for (let i = 0; i < PASS_SLOTS; i++) this.pass.push({ loop: new Loop(e, PASS_KEYS[0], out, { pan: true }), id: -1, cls: 0, pan: 0, fresh: false });
    for (let i = 0; i < NE; i++) this.due[i] = 0.3 + e.rnd();
  }

  /** An event drawn at `perMin` a minute: true when one is due. */
  private roll(i: number, perMin: number, dt: number): boolean {
    if (perMin <= 0) return false;
    this.due[i] -= (dt * perMin) / 60;
    if (this.due[i] > 0) return false;
    this.due[i] = 0.35 + 1.3 * this.e.rnd();
    return true;
  }

  private shot(id: ShotId, gain: number, pan = 0, o: { rate?: number; when?: number; prio?: 0 | 1 | 2 } = {}) {
    const e = this.e, n = variants(id);
    return e.shot(shotKey(id, n > 1 ? Math.floor(e.rnd() * n) : 0), e.world, gain, { pan, rate: o.rate, when: o.when, prio: o.prio ?? 0 });
  }

  /** Bring every layer to the mix, and play what falls due. `dt`: seconds since the last call. */
  apply(m: Mix, s: Scene, w: Where, dt: number, sunday = false) {
    const e = this.e, t = e.now, r = e.rnd;
    e.setDuck(m.duck);

    // ---- the air: the wind breathes (slow gusts), thinner and higher in winter
    this.gustT -= dt;
    if (this.gustT <= 0) { this.gustT = 1.5 + 3 * r(); this.gustTo = 0.72 + 0.5 * r(); }
    this.gust += (this.gustTo - this.gust) * Math.min(1, dt * 0.5);
    const tyres = m.tyres * TRIM.tyres;
    this.pink.set(1, dt);
    if (this.pink.on) {
      this.windG.gain.setTargetAtTime(m.wind * this.gust * TRIM.wind, t, 0.6);
      this.windF.frequency.setTargetAtTime(m.windHz * (0.85 + 0.3 * this.gust), t, 0.8);
      this.airG.gain.setTargetAtTime(m.wind * m.air * this.gust * TRIM.air, t, 0.8);
      this.humG.gain.setTargetAtTime(m.hum * TRIM.hum, t, 0.8);
      this.tyreG.gain.setTargetAtTime(tyres, t, 0.4);
      this.tyreF.frequency.setTargetAtTime(m.tyreHz, t, 0.5);
    }
    this.water.set(m.water * TRIM.water, dt, 1, 0.6);
    // (a shower comes on and dies away over game minutes: the bed follows it slowly)
    this.rain.set(m.rain * TRIM.rain, dt, 1, 1.5);
    this.crickets.set(m.crickets * TRIM.crickets, dt, 1, 0.8);
    this.murmur.set(m.murmur * TRIM.murmur, dt, 1, 0.6);
    this.murmur.pan?.pan.setTargetAtTime(w.town * 0.5, t, 0.5);

    // ---- traffic
    for (let c = 0; c < 4; c++) this.eng[c].set(m.eng[c] * TRIM.eng, dt, m.rate[c], 0.35);
    this.idle.set(m.idle * TRIM.idle, dt, 1, 0.4);
    this.passBy(m, w, dt);

    // ---- the works: the loudest few in view each take a slot
    this.assignWorks(m, w, dt);

    // ---- events
    const near = 0.35 + 0.65 * m.near;
    if (this.roll(E.bird, m.birds, dt)) {
      // (a dawn chorus has every species in it; at midday mostly sparrows and a warbler; never the same bird twice running)
      let k = Math.floor(r() * 5);
      if (k === this.lastBird) k = (k + 1 + Math.floor(r() * 3)) % 5;
      this.lastBird = k;
      this.shot(`bird${k}` as ShotId, m.birdGain * TRIM.bird * (0.25 + 0.75 * r() * r()), r() * 1.7 - 0.85, { rate: 0.95 + 0.1 * r() });
    }
    if (this.roll(E.owl, m.owl, dt)) this.shot("owl", TRIM.owl * (0.5 + 0.5 * r()), r() * 1.6 - 0.8);
    if (m.horn > 0 && t - this.hornAt > 7 && this.roll(E.horn, m.horn, dt)) {
      this.hornAt = t;
      this.shot(r() < 0.35 ? "klaxon" : "horn", TRIM.horn * near * (0.6 + 0.4 * r()), w.jam * 0.8, { rate: 0.94 + 0.12 * r(), prio: 1 });
    }
    if (this.roll(E.gate, m.gate, dt)) this.shot(r() < 0.6 ? "airbrake" : "door", TRIM.gate * near * (0.6 + 0.4 * r()), w.gate * 0.8);
    const wi = (k: (typeof WORKS)[number]) => w.works[WORKS.indexOf(k)] * 0.7;
    if (this.roll(E.clank, m.clank, dt)) this.shot("clank", TRIM.event * near * (0.4 + 0.6 * r()), wi("furnace") + (r() - 0.5) * 0.3, { rate: 0.9 + 0.2 * r() });
    if (this.roll(E.steam, m.steam, dt)) this.shot("steam", TRIM.event * near * 0.7, wi("furnace"));
    if (m.blast > 0 && t - this.blastAt > 45 && this.roll(E.blast, m.blast, dt)) { this.blastAt = t; this.shot("blast", TRIM.event * near * 1.3, wi("crusher"), { prio: 1 }); }
    if (this.roll(E.axe, m.axe, dt)) this.shot("axe", TRIM.event * near * 0.9, wi("tractor") + (r() - 0.5) * 0.4);
    if (this.roll(E.rooster, m.rooster, dt)) this.shot("rooster", TRIM.event * near * 0.6, wi("tractor"), { rate: 0.96 + 0.08 * r() });
    if (this.roll(E.cow, m.cow, dt)) this.shot("cow", TRIM.event * near * 0.5, wi("tractor") + (r() - 0.5) * 0.4, { rate: 0.92 + 0.14 * r() });
    if (this.roll(E.hornTest, m.hornTest, dt)) this.shot(r() < 0.5 ? "klaxon" : "horn", TRIM.event * near * 0.45, wi("assembly"));
    if (this.roll(E.clink, m.clink, dt)) this.shot("clink", TRIM.event * near * 0.6, wi("glass") + (r() - 0.5) * 0.3);
    if (this.roll(E.build, m.build, dt)) this.shot(r() < 0.62 ? "hammer" : "handsaw", TRIM.build * near * (0.5 + 0.5 * r()), w.site * 0.7 + (r() - 0.5) * 0.4, { rate: 0.93 + 0.14 * r() });
    if (this.roll(E.shopbell, m.shopbell, dt)) this.shot("shopbell", TRIM.town * near * (0.5 + 0.5 * r()), w.town * 0.6 + (r() - 0.5) * 0.5, { rate: 0.97 + 0.08 * r() });
    if (this.roll(E.dog, m.dog, dt)) this.shot("dog", TRIM.town * near * 0.7, w.town * 0.6 + (r() - 0.5) * 0.8, { rate: 0.9 + 0.25 * r() });
    if (this.roll(E.children, m.children, dt)) this.shot("children", TRIM.town * near * 0.5, w.town * 0.6 + (r() - 0.5) * 0.6);

    this.clock(m, s, w, sunday);
  }

  /** The town hall clock strikes the hours (and on every seventh day the church bell rings at ten). */
  private clock(m: Mix, s: Scene, w: Where, sunday: boolean) {
    const e = this.e, t = e.now, h = Math.floor(s.hour);
    if (this.lastHour < 0) this.lastHour = h;
    if (h !== this.lastHour) {
      const next = (this.lastHour + 1) % 24 === h;
      this.lastHour = h;
      // (only an hour that came round by itself: not a loaded save, not a clock set from the console)
      if (next && sunday && h === 10 && m.clock > 0.04) e.shot("sting:church", e.world, m.clock * TRIM.clock, { pan: w.hall * 0.5, prio: 1 });
      else if (next && m.clock > 0.04 && this.strokesLeft === 0) {
        this.strokesLeft = strokes(h, s.speed);
        this.strokeAt = t + 0.15;
        this.strokeGain = m.clock * TRIM.clock;
        this.strokePan = w.hall * 0.5;
      }
    }
    // (each stroke is set down on the beat a moment ahead: the frame's timing never shows)
    while (this.strokesLeft > 0 && this.strokeAt < t + 0.5) {
      if (!s.paused) e.shot(shotKey("clock"), e.world, this.strokeGain, { pan: this.strokePan, when: this.strokeAt, prio: 1 });
      this.strokeAt += 1.55;
      this.strokesLeft--;
    }
  }

  /** A firework's crack, as the sparks burst on screen. */
  pop(pan = 0) { this.shot("pop", TRIM.pop * (0.6 + 0.4 * this.e.rnd()), pan, { rate: 0.9 + 0.25 * this.e.rnd(), prio: 1 }); }

  private assignWorks(m: Mix, w: Where, dt: number) {
    // the beds in order of level (a few items: a plain insertion sort, nothing made)
    const ord = this.order;
    for (let i = 0; i < NW; i++) ord[i] = i;
    for (let i = 1; i < NW; i++) {
      const x = ord[i];
      let j = i - 1;
      while (j >= 0 && m.works[ord[j]] < m.works[x]) { ord[j + 1] = ord[j]; j--; }
      ord[j + 1] = x;
    }
    const t = this.e.now;
    // a bed already in a slot keeps it while it is among the loudest
    for (const slot of this.works) {
      let keep = false;
      for (let k = 0; k < WORKS_SLOTS; k++) if (ord[k] === slot.bed && m.works[slot.bed] > 0.002) keep = true;
      if (!keep && slot.bed >= 0) { slot.loop.set(0, dt, 1, 0.25); if (!slot.loop.on) slot.bed = -1; }
    }
    for (let k = 0; k < WORKS_SLOTS; k++) {
      const bed = ord[k], g = m.works[bed];
      if (g <= 0.002) break;
      let slot = this.works.find((x) => x.bed === bed);
      if (!slot) {
        slot = this.works.find((x) => x.bed < 0);
        if (!slot) continue;
        slot.bed = bed;
        slot.loop.retune(`bed:${WORKS[bed]}`);
        slot.loop.pan?.pan.setValueAtTime(w.works[bed] * 0.7, t);
      }
      slot.loop.set(g * TRIM.works, dt, 1, 0.5);
      slot.loop.pan?.pan.setTargetAtTime(w.works[bed] * 0.7, t, 0.4);
    }
  }

  private passBy(m: Mix, w: Where, dt: number) {
    const t = this.e.now;
    for (const p of this.pass) p.fresh = false;
    if (m.street > 0.01) {
      for (const n of w.near) {
        if (n.id < 0 || n.w <= 0) continue;
        let p = this.pass.find((x) => x.id === n.id);
        if (!p) {
          // a free voice: one whose vehicle has gone and whose sound has died away
          p = this.pass.find((x) => !x.fresh && !x.loop.on && (x.id < 0 || !w.near.some((y) => y.id === x.id)));
          if (!p) continue;
          p.id = n.id; p.cls = n.cls; p.pan = n.pan;
          p.loop.retune(PASS_KEYS[n.cls]);
          p.loop.pan?.pan.setValueAtTime(clampPan(n.pan * 0.9), t);
        }
        p.fresh = true;
        // a touch of Doppler: higher coming in towards the middle, lower going away
        const closing = (Math.abs(p.pan) - Math.abs(n.pan)) / Math.max(0.05, dt);
        const dop = Math.max(-0.05, Math.min(0.05, closing * 0.12));
        p.pan = n.pan;
        // (loudest in the middle of the screen: it passes by)
        const g = m.street * TRIM.pass * PASS_GAIN[p.cls] * n.w ** 2 * (0.5 + 0.5 * Math.min(1, n.v / 10));
        p.loop.set(g, dt, (0.82 + 0.4 * Math.min(1, n.v / 20)) * (1 + dop), 0.22);
        p.loop.pan?.pan.setTargetAtTime(clampPan(n.pan * 0.9), t, 0.15);
      }
    }
    for (const p of this.pass) if (!p.fresh) { p.loop.set(0, dt, 1, 0.2); if (!p.loop.on) p.id = -1; }
  }

  /** Sources this layer holds now (for the stats). */
  get loops(): number {
    let n = this.pink.on ? 1 : 0;
    for (const l of [this.water, this.rain, this.crickets, this.murmur, this.idle, ...this.eng, ...this.works.map((x) => x.loop), ...this.pass.map((x) => x.loop)]) if (l.on) n++;
    return n;
  }
}
