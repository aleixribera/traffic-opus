// Traffic that is really stuck (owner, 2026-11-08: "a tiny but persistent alert"): where cars have stood still for
// a minute and a half (a gridlock, a broken layout, a junction locked solid; a long red is never that long), a small
// amber warning diamond stands on the map at the spot, and one small chip above the clock says so for as long as any
// spot is stuck ("Traffic stuck · 2 places · 3 min"). Click the chip to fly to the spots in turn, the diamond to look
// closer. A spot's alert stays till its cars have moved on for a few seconds, so it doesn't flicker as a queue
// shuffles. Game time throughout: paused, an alert stays as it is.

import type { V2 } from "../core/math";
import type { View } from "../render/view";

/** Seconds standing before a spot is called stuck, and how long its cars may still have stood for it to stay so. */
export const STUCK_RAISE = 90, STUCK_KEEP = 40;
/** Seconds (game time) a spot's alert lasts once nothing there is stuck any more. */
const CLEAR_AFTER = 6;
/** Cars this close together (m) are one spot. */
const SPOT = 90;

/** A car that has stood still a while: where it is, and for how long (s). */
export interface StuckCar { p: V2; t: number }

interface Alert { id: number; c: V2; h: number; worst: number; cars: number; since: number; seen: number; pin: HTMLButtonElement }

/** Spots where cars stand: the cars within SPOT of each other gathered, the longest-standing first. */
export function stuckSpots(cars: readonly StuckCar[]): { c: V2; worst: number; cars: number }[] {
  const left = [...cars].sort((a, b) => b.t - a.t);
  const out: { c: V2; worst: number; cars: number }[] = [];
  while (left.length) {
    const a = left.shift()!;
    let x = a.p.x, y = a.p.y, n = 1;
    for (let i = left.length - 1; i >= 0; i--) {
      const b = left[i];
      if (Math.hypot(b.p.x - a.p.x, b.p.y - a.p.y) > SPOT) continue;
      x += b.p.x; y += b.p.y; n++;
      left.splice(i, 1);
    }
    out.push({ c: { x: x / n, y: y / n }, worst: a.t, cars: n });
  }
  return out;
}

export class StuckAlerts {
  readonly el = document.createElement("div");
  readonly chip = document.createElement("button");
  private alerts: Alert[] = [];
  private nextId = 1;
  /** the alert the chip flew to last (the next click goes on to the next one) */
  private turn = 0;

  /** How high the road is at a place (m): a jam on a bridge is pinned to its deck. */
  heightAt: ((p: V2) => number) | null = null;

  constructor(private fly: (c: V2, id?: number) => void) {
    this.el.className = "stuck-alerts";
    document.body.prepend(this.el);
    this.chip.type = "button";
    this.chip.className = "sa-chip";
    this.chip.hidden = true;
    this.chip.innerHTML = `<i class="sa-sign" aria-hidden="true"></i><b>Traffic stuck</b><span class="sa-n"></span>`;
    this.chip.onclick = () => {
      if (!this.alerts.length) return;
      const list = [...this.alerts].sort((a, b) => a.since - b.since);
      const i = list.findIndex((a) => a.id === this.turn);
      const a = list[(i + 1) % list.length];
      this.turn = a.id;
      this.fly(a.c, a.id);
    };
    document.body.append(this.chip);
  }

  /** The cars standing still now (at least STUCK_KEEP s), at game time `now`. A few times a second. */
  sync(cars: readonly StuckCar[], now: number, hide: boolean) {
    const spots = hide ? [] : stuckSpots(cars);
    for (const s of spots) {
      let near: Alert | undefined, bd = SPOT * 1.4;
      for (const a of this.alerts) { const d = Math.hypot(a.c.x - s.c.x, a.c.y - s.c.y); if (d < bd) { bd = d; near = a; } }
      if (near) {
        near.seen = now;
        near.worst = s.worst;
        near.cars = s.cars;
        continue;
      }
      if (s.worst < STUCK_RAISE) continue;
      const pin = document.createElement("button");
      pin.type = "button";
      pin.className = "sa-pin";
      pin.innerHTML = `<i class="sa-sign" aria-hidden="true"></i>`;
      pin.title = "Traffic stuck here: see what is held up";
      pin.setAttribute("aria-label", pin.title);
      const a: Alert = { id: this.nextId++, c: s.c, h: this.heightAt?.(s.c) ?? 0, worst: s.worst, cars: s.cars, since: now - s.worst, seen: now, pin };
      pin.onclick = () => this.fly(a.c, a.id);
      this.el.append(pin);
      this.alerts.push(a);
    }
    this.alerts = this.alerts.filter((a) => {
      // (a clock that went back is another game loaded: its alerts go)
      if (!hide && now >= a.seen && now - a.seen <= CLEAR_AFTER) return true;
      a.pin.remove();
      return false;
    });
    // the chip: how many spots, and how long the oldest has been stuck
    const n = this.alerts.length;
    this.chip.hidden = n === 0;
    if (!n) return;
    const oldest = Math.max(...this.alerts.map((a) => now - a.since));
    const mins = Math.max(1, Math.round(oldest / 60));
    const txt = `${n === 1 ? "1 place" : `${n} places`} · ${mins} min`;
    const sp = this.chip.querySelector(".sa-n")!;
    if (sp.textContent !== txt) sp.textContent = txt;
    const tip = `Traffic has stood still for ${mins} min${n > 1 ? ` in ${n} places` : ""}. Fly there and see what is held up`;
    if (this.chip.title !== tip) { this.chip.title = tip; this.chip.setAttribute("aria-label", tip); }
    for (const a of this.alerts) {
      const t = `Traffic stuck here (${a.cars === 1 ? "a car" : `${a.cars} cars`}, ${Math.max(1, Math.round((now - a.since) / 60))} min): see what is held up`;
      if (a.pin.title !== t) { a.pin.title = t; a.pin.setAttribute("aria-label", t); }
    }
  }

  /** Where each diamond goes this frame. */
  update(view: View) {
    for (const a of this.alerts) {
      const s = view.worldToScreen(a.c.x, a.c.y, a.h);
      const on = s.x > -20 && s.y > -20 && s.x < view.w + 20 && s.y < view.h + 20;
      a.pin.style.display = on ? "" : "none";
      if (on) a.pin.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }

  /** How many spots are stuck now (for tests and the panels). */
  get count(): number { return this.alerts.length; }
}
