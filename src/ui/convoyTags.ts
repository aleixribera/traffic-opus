// Oversized-load convoys on the map: a tag rides above each one ("OVERSIZE LOAD · Turbine / to the Coal Plant") with
// a lamp that flashes like its beacons, so one is easy to spot crawling across a busy map. Click a tag to follow the
// convoy with the camera (ui/camera.ts); pan away (or click it again) to let it go.

import { BUILDING_TYPES } from "../config";
import { BIG_NAME, CONVOY_LEN } from "../game/convoys";
import type { Building } from "../game/buildings";
import type { Vehicle } from "../sim/traffic";
import type { View } from "../render/view";

export class ConvoyTags {
  readonly el = document.createElement("div");
  private tags = new Map<number, { el: HTMLButtonElement; v: Vehicle }>();
  /** The vehicle the camera follows (its tag is lit), or null. */
  following: number | null = null;

  constructor(private onFollow: (id: number | null) => void) {
    this.el.className = "convoy-tags";
    document.body.appendChild(this.el);
  }

  /** Add tags for convoys that set off, drop those that got there (a few times a second). */
  sync(vehicles: readonly Vehicle[], byId: Map<number, Building>, hide: boolean) {
    const live = new Set<number>();
    if (!hide) for (const v of vehicles) {
      const r = v.trip.haul;
      if (!r?.big || r.done) continue;
      live.add(v.id);
      if (this.tags.has(v.id)) continue;
      const to = byId.get(r.dest);
      const el = document.createElement("button");
      el.className = "convoy-tag";
      el.type = "button";
      el.setAttribute("aria-pressed", "false");
      const where = to ? BUILDING_TYPES[to.kind].name : "its site";
      el.innerHTML = `<i class="ct-lamp" aria-hidden="true"></i><span class="ct-k">Oversize load</span><b></b><span class="ct-to"></span>`;
      el.querySelector("b")!.textContent = BIG_NAME[r.big];
      el.querySelector(".ct-to")!.textContent = `to the ${where}`;
      el.title = `${BIG_NAME[r.big]} on its way to the ${where}. Follow it`;
      el.onclick = () => this.onFollow(this.following === v.id ? null : v.id);
      el.classList.toggle("on", this.following === v.id);
      el.setAttribute("aria-pressed", String(this.following === v.id));
      this.el.appendChild(el);
      this.tags.set(v.id, { el, v });
    }
    for (const [id, t] of this.tags) if (!live.has(id)) { t.el.remove(); this.tags.delete(id); }
  }

  /** Light the tag of the vehicle the camera follows (null: none). */
  mark(id: number | null) {
    this.following = id;
    for (const [k, t] of this.tags) {
      t.el.classList.toggle("on", k === id);
      t.el.setAttribute("aria-pressed", String(k === id));
    }
  }

  /** Where a convoy is now: the middle of its pieces as drawn, between its last two sim steps. */
  static centre(v: Vehicle, alpha: number) {
    const U = v.uPose, P = v.puPose ?? U;
    if (U && P && U.length >= 4) {
      let x = 0, y = 0;
      const n = U.length / 4;
      for (let i = 0; i < n; i++) {
        x += P[i * 4] + (U[i * 4] - P[i * 4]) * alpha;
        y += P[i * 4 + 1] + (U[i * 4 + 1] - P[i * 4 + 1]) * alpha;
      }
      return { x: x / n, y: y / n };
    }
    // (before its pieces are posed: back from its front along its heading)
    const x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha;
    return { x: x - Math.cos(v.ang) * CONVOY_LEN * 0.5, y: y - Math.sin(v.ang) * CONVOY_LEN * 0.5 };
  }

  /**
   * Follow the camera and the convoys (every frame). A tag hangs just above the convoy as it looks on screen (over
   * the top end of whichever of its pieces reaches highest), so zoomed in it never covers the vehicles.
   */
  update(view: View, alpha: number) {
    for (const { el, v } of this.tags.values()) {
      const c = view.toScreen(ConvoyTags.centre(v, alpha));
      let top = c.y;
      const U = v.uPose, P = v.puPose ?? U, units = v.units;
      if (U && P && units && units.length * 4 === U.length) {
        for (let i = 0; i < units.length; i++) {
          const o = i * 4, k = units[i].len / 2;
          const x = P[o] + (U[o] - P[o]) * alpha, y = P[o + 1] + (U[o + 1] - P[o + 1]) * alpha, a = U[o + 3];
          for (const s of [-1, 1]) top = Math.min(top, view.toScreen({ x: x + Math.cos(a) * k * s, y: y + Math.sin(a) * k * s }).y);
        }
      }
      const y = top - 12;
      const on = view.halfH < 2600 && c.x > -120 && y > -60 && c.x < view.w + 120 && c.y < view.h + 60;
      el.style.display = on ? "" : "none";
      if (on) el.style.transform = `translate(${c.x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
