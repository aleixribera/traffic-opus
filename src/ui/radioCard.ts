// The wireless's dedications on screen (audio/dedication.ts): when something big happens the station dedicates its
// next number to it, and its card stands on the radio in the bottom bar for a little while: the radio's glyph and
// the announcer's line with the name in bold, and the tune once it starts ("Now playing “Poplar Creek Stomp”").
//
// Self-contained: it takes the game's events (App's g.on), watches for a long jam clearing itself, picks the biggest
// of the things that happen together, and asks the audio for the ident and the tune. Nothing goes out while the
// radio is off or the sound is muted (the card is the station talking: with no station there is nothing to say).

import "./radioCard.css";
import { BUILDING_TYPES } from "../config";
import { DedicationDesk, JamWatch, dedicationFor, lineOf, weightOf, type Dedication, type DedicationEvent } from "../audio/dedication";
import type { GameAudio } from "../audio";
import type { Game, GameEvent } from "../game/city";
import { BIG_NAME } from "../game/convoys";
import { TOWN_SIZES } from "../game/towns";
import type { V2 } from "../core/math";
import { STUCK_KEEP, stuckSpots } from "./stuckAlerts";

/** Real seconds from the event to the dedication: the moment's own sting and card have their turn first. */
const AFTER = 3.5;
/** How long the card stays: after the tune's name is up, and at most without one (real seconds). */
const STAY_TUNE = 9, STAY_MAX = 15;

const RADIO = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"><rect x="1.8" y="5.4" width="12.4" height="8.6" rx="1.2"/><path d="M4.2 5.4 11 2"/><circle cx="10.6" cy="9.7" r="2"/><path d="M4.2 8.4h2.6M4.2 10.6h2.6"/></svg>`;
const CLOSE = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

export interface RadioHost {
  readonly audio: GameAudio;
  /** the hour on the clock (the announcer's "this morning", "tonight") */
  hour(): number;
}

export class RadioDedications {
  readonly el: HTMLElement;
  private desk = new DedicationDesk();
  /** the dedication waiting its turn (the biggest of what happened together), and when it goes out (real s) */
  private pending: { ev: DedicationEvent; at: number } | null = null;
  /** on show: its town, when it went up, when the tune's name went up (real s), the tune playing before it */
  private shown: { d: Dedication; at: number; titled: number; before: string } | null = null;
  private jams = new JamWatch();
  private jamCheck = 0;
  private game!: Game;

  constructor(private host: RadioHost) {
    this.el = document.createElement("aside");
    this.el.className = "radio-card";
    this.el.hidden = true;
    this.el.setAttribute("role", "status");
    this.el.setAttribute("aria-live", "polite");
  }

  /** Into the HUD (so it hides with it), once it is built. */
  mount(parent: Element | null) {
    if (parent && this.el.parentElement !== parent) parent.append(this.el);
  }

  /** A game was opened (new or loaded): a quiet spell first, and nothing carried over from the last one. */
  setGame(g: Game) {
    this.game = g;
    this.desk.open(now());
    this.pending = null;
    this.jams.reset();
    this.hide();
  }

  /** A game event (App's g.on, in play only). */
  event(e: GameEvent) {
    const ev = this.read(e);
    if (ev) this.offer(ev);
  }

  /** Every frame. */
  tick() {
    const t = now();
    if (this.pending && t >= this.pending.at) {
      const { ev } = this.pending;
      this.pending = null;
      if (this.on() && this.desk.offer(t)) this.air(dedicationFor(ev, this.host.hour()), t);
    }
    if (this.shown) {
      const s = this.shown, tune = this.host.audio.tune;
      if (!s.titled && tune && tune !== s.before && tune.includes(s.d.town)) { s.titled = t; this.title(tune); }
      const until = s.titled ? s.titled + STAY_TUNE : s.at + STAY_MAX;
      // (being read: it waits)
      if (t > until && !this.el.matches(":hover, :focus-within")) this.hide();
      else if (!this.on()) this.hide();
      else this.place();
    }
    if (t - this.jamCheck >= 1) { this.jamCheck = t; this.watchJam(); }
  }

  private on() { const s = this.host.audio.settings; return s.wireless && !s.muted; }

  private offer(ev: DedicationEvent) {
    const t = now();
    if (this.pending) { if (weightOf(ev) > weightOf(this.pending.ev)) this.pending.ev = ev; return; }
    if (!this.on() || !this.desk.ready(t)) return;
    this.pending = { ev, at: t + AFTER };
  }

  /** What the announcer needs from a game event (null: nothing to dedicate). */
  private read(e: GameEvent): DedicationEvent | null {
    const g = this.game;
    const town = (id: number | undefined) => (id === undefined ? undefined : g.towns.byId.get(id)?.name);
    switch (e.t) {
      case "townSpawned": { const n = town(e.town); return n ? { k: "newTown", town: n } : null; }
      case "townSize": {
        const n = town(e.town), size = TOWN_SIZES[e.size];
        return n && size && e.size >= 1 ? { k: "townSize", town: n, size: size.name } : null;
      }
      case "milestone": {
        const n = town(e.towns?.[0]) ?? this.biggest();
        return n ? { k: "goal", name: e.m.name, company: g.company?.name ?? "", town: n } : null;
      }
      case "convoy": {
        if (e.phase !== "out") return null;
        const to = g.buildings.byId.get(e.to), n = to && this.nearest(to.c);
        return to && n ? { k: "convoy", load: BIG_NAME[e.kind], to: BUILDING_TYPES[to.kind].name, town: n } : null;
      }
      case "landmark": {
        const b = g.buildings.byId.get(e.b), n = b && this.nearest(b.c);
        return b && n ? { k: "landmark", what: BUILDING_TYPES[b.kind].name, town: n } : null;
      }
      default: return null;
    }
  }

  private biggest(): string | undefined {
    let best: { name: string; pop: number } | undefined;
    for (const t of this.game.towns.list) if (!best || t.pop > best.pop) best = t;
    return best?.name;
  }

  private nearest(p: V2): string | undefined {
    let best: string | undefined, bd = Infinity;
    for (const t of this.game.towns.list) {
      const d = Math.hypot(t.c.x - p.x, t.c.y - p.y);
      if (d < bd) { bd = d; best = t.name; }
    }
    return best;
  }

  /** A long jam that has cleared itself (audio/dedication.ts JamWatch). */
  private watchJam() {
    const g = this.game;
    const town = this.jams.step(g.time, stuckSpots(g.traffic.stuckCars(STUCK_KEEP)), (p) => this.nearest(p));
    if (town) this.offer({ k: "jam", town });
  }

  /** The station dedicates its next number: the ident, the band fading under it, and the card. */
  private air(d: Dedication, t: number) {
    const before = this.host.audio.tune;
    if (!this.host.audio.dedicate(d.town)) return;
    this.shown = { d, at: t, titled: 0, before };
    const el = this.el;
    el.innerHTML = `<p class="rc-line">${RADIO}<span></span></p><p class="rc-tune" hidden></p><button class="rc-x" type="button" aria-label="Put the card away">${CLOSE}</button>`;
    const line = el.querySelector(".rc-line span")!;
    line.append(`${d.lead} `, Object.assign(document.createElement("b"), { textContent: d.to }), `${d.sep}${d.why}.`);
    el.querySelector<HTMLButtonElement>(".rc-x")!.onclick = () => this.hide();
    el.title = lineOf(d);
    el.hidden = false;
    el.classList.remove("out");
    this.place();
  }

  private title(tune: string) {
    const p = this.el.querySelector<HTMLElement>(".rc-tune");
    if (!p) return;
    p.textContent = `Now playing “${tune}”`;
    p.hidden = false;
  }

  private hide() {
    this.shown = null;
    if (this.el.hidden || this.el.classList.contains("out")) return;
    this.el.classList.add("out");
    setTimeout(() => { if (this.el.classList.contains("out")) { this.el.hidden = true; this.el.classList.remove("out"); } }, 260);
  }

  /**
   * Stand it on the radio in the bottom bar (or hang it under the radio, were the bar on top), its right edge with
   * the radio's: the radio moves as the bar's width changes.
   */
  private place() {
    const r = document.querySelector(".wireless")?.getBoundingClientRect();
    const st = this.el.style;
    if (!r || !r.width) { st.left = st.top = st.bottom = ""; return; }
    const w = this.el.offsetWidth || 360;
    st.left = `${Math.round(Math.max(8, Math.min(window.innerWidth - w - 8, r.right - w)))}px`;
    if (r.top > window.innerHeight / 2) { st.top = "auto"; st.bottom = `${Math.round(window.innerHeight - r.top + 10)}px`; }
    else { st.bottom = "auto"; st.top = `${Math.round(r.bottom + 10)}px`; }
  }

  /** For the look-and-fix pass (dev): air one now, whatever the desk says. */
  devShow(ev: DedicationEvent) {
    this.air(dedicationFor(ev, this.host.hour()), now());
  }
}

const now = () => performance.now() / 1000;
