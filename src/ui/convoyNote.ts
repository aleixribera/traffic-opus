// A convoy setting off (game/convoys.ts): its notice under the toasts says what leaves where for where, with a
// Follow button that puts the camera on it (App.followVehicle, as its tag over the map does). The convoy is asked
// for from the yard and pulls out a moment later: the button waits, greyed, until it is on the road.
//
// Self-contained: one note at a time (a newer convoy's takes its place), the order note's slip look (one line, no
// kicker: docs/ui-words.md), put away by
// itself after a while (not while it is being read) or with its close button.

import "./convoyNote.css";
import { BUILDING_TYPES } from "../config";
import type { Game } from "../game/city";
import { BIG_NAME, type BigKind } from "../game/convoys";

/** How long the note stays once the convoy is on the road (ms), the longest it waits for it to pull out, and a
 * little longer once the pointer leaves it. */
const STAY = 14000, WAIT = 60000, AFTER_HOVER = 5000;

const CLOSE = `<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"><path d="M4 4l8 8M12 4l-8 8"/></svg>`;

export interface ConvoyNoteHost {
  /** put the camera on a vehicle */
  follow(id: number): void;
  /** a click's sound */
  click(): void;
}

export class ConvoyNotes {
  private note: { el: HTMLElement; btn: HTMLButtonElement; from: number; to: number; id: number | null } | null = null;
  private timer = 0;
  private lastLook = 0;
  private game!: Game;

  constructor(private host: ConvoyNoteHost) {}

  /** A convoy set off from `from` for `to` (building ids). */
  show(kind: BigKind, from: number, to: number) {
    const g = this.game, a = g.buildings.byId.get(from), b = g.buildings.byId.get(to);
    const box = document.querySelector(".hud .toasts");
    if (!a || !b || !box) return;
    this.away(0, true);
    const el = document.createElement("div");
    el.className = "toast order-note convoy-note";
    el.setAttribute("role", "status");
    const load = BIG_NAME[kind].toLowerCase(), a1 = /^[aeiou]/.test(load) ? "An" : "A";
    el.innerHTML = `<p class="cn-line"></p><div class="cn-act"><button class="btn primary cn-follow" type="button" disabled>Follow</button><span class="cn-wait">Leaving the yard</span></div><button class="close on-x" type="button" aria-label="Put the note away">${CLOSE}</button>`;
    el.querySelector(".cn-line")!.textContent = `${a1} ${load} leaves the ${BUILDING_TYPES[a.kind].name} for the ${BUILDING_TYPES[b.kind].name} under escort`;
    const btn = el.querySelector<HTMLButtonElement>(".cn-follow")!;
    btn.title = "Follow the convoy with the camera. Pan away to let it go";
    btn.onclick = () => {
      const n = this.note;
      if (!n || n.id === null) return;
      this.host.click();
      this.host.follow(n.id);
      this.away(0);
    };
    el.querySelector<HTMLButtonElement>(".on-x")!.onclick = () => this.away(0);
    el.addEventListener("mouseenter", () => { if (this.note?.el === el) clearTimeout(this.timer); });
    el.addEventListener("mouseleave", () => { if (this.note?.el === el) this.away(this.note.id === null ? WAIT : AFTER_HOVER); });
    box.prepend(el);
    this.note = { el, btn, from, to, id: null };
    this.away(WAIT);
    this.look();
  }

  /** Every frame: once the convoy is on the road, the Follow button wakes. */
  tick() {
    const n = this.note;
    if (!n || n.id !== null) return;
    const t = performance.now();
    if (t - this.lastLook < 250) return;
    this.lastLook = t;
    this.look();
  }

  private look() {
    const n = this.note;
    if (!n) return;
    let id: number | null = null;
    for (const v of this.game.traffic.vehicles) {
      const r = v.trip.haul;
      if (r?.big && !r.done && r.plant === n.from && r.dest === n.to && (id === null || v.id > id)) id = v.id;
    }
    if (id === null) return;
    n.id = id;
    n.btn.disabled = false;
    n.el.querySelector(".cn-wait")?.remove();
    // (its time starts now it can be followed; not while it is being read)
    if (!n.el.matches(":hover, :focus-within")) this.away(STAY);
  }

  /** Put it away after `ms` (0: now; `now`: without the fade, a newer one is taking its place). */
  private away(ms: number, now = false) {
    clearTimeout(this.timer);
    const n = this.note;
    if (!n) return;
    const go = () => {
      if (this.note !== n) return;
      // (being read, or holding the keyboard: it waits a little longer)
      if (ms && n.el.matches(":hover, :focus-within")) { this.away(AFTER_HOVER); return; }
      this.note = null;
      if (now) { n.el.remove(); return; }
      n.el.classList.add("out");
      setTimeout(() => n.el.remove(), 300);
    };
    if (ms) this.timer = window.setTimeout(go, ms);
    else go();
  }

  /** A game was opened: the last one's note goes. */
  setGame(g: Game) { this.game = g; this.away(0, true); }
}
