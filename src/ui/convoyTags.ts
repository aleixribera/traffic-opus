// Oversized-load convoys on the map: a tag rides above each one ("OVERSIZE LOAD · Turbine / to the Coal Plant") with
// a lamp that flashes like its beacons, so one is easy to spot crawling across a busy map. Click a tag to follow the
// convoy with the camera; pan away (or click it again) to let it go.

import { BUILDING_TYPES } from "../config";
import { BIG_NAME, CONVOY_LEN } from "../game/convoys";
import type { Building } from "../game/buildings";
import type { Vehicle } from "../sim/traffic";
import type { View } from "../render/view";

export class ConvoyTags {
  readonly el = document.createElement("div");
  private tags = new Map<number, { el: HTMLButtonElement; v: Vehicle }>();
  /** The convoy the camera follows (a vehicle id), or null. */
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
      const where = to ? BUILDING_TYPES[to.kind].name : "its site";
      el.innerHTML = `<i class="ct-lamp" aria-hidden="true"></i><span class="ct-k">Oversize load</span><b></b><span class="ct-to"></span>`;
      el.querySelector("b")!.textContent = BIG_NAME[r.big];
      el.querySelector(".ct-to")!.textContent = `to the ${where}`;
      el.title = `${BIG_NAME[r.big]} on its way to the ${where}. Follow it`;
      el.onclick = () => this.follow(this.following === v.id ? null : v.id);
      this.el.appendChild(el);
      this.tags.set(v.id, { el, v });
    }
    for (const [id, t] of this.tags) if (!live.has(id)) { t.el.remove(); this.tags.delete(id); }
    if (this.following !== null && !this.tags.has(this.following)) this.follow(null);
  }

  follow(id: number | null) {
    this.following = id;
    for (const [k, t] of this.tags) t.el.classList.toggle("on", k === id);
    this.onFollow(id);
  }

  /** Where a convoy is now (the middle of its 33 m, between its last two sim steps). */
  static centre(v: Vehicle, alpha: number) {
    const x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha;
    const back = CONVOY_LEN * 0.45;
    return { x: x - Math.cos(v.ang) * back, y: y - Math.sin(v.ang) * back };
  }

  /** Follow the camera and the convoys (every frame). */
  update(view: View, alpha: number) {
    const lift = Math.min(46, 14 / Math.max(0.12, view.mpp));
    for (const { el, v } of this.tags.values()) {
      const s = view.toScreen(ConvoyTags.centre(v, alpha));
      const on = view.halfH < 2600 && s.x > -120 && s.y > -60 && s.x < view.w + 120 && s.y < view.h + 60;
      el.style.display = on ? "" : "none";
      if (on) el.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
