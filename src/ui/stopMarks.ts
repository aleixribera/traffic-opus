// Bus stops on the map. Up close the shelter and the yellow bay read for themselves; from the default zoom out they
// are a few pixels of pale blue and a hairline (road play log, item 9), so each stop carries a small plate on a
// stem over its kerb point: the bus pictogram on the company's navy, and under it a tab in each of its lines'
// colours (none: no line calls there yet). Clicking a plate opens the stop, as clicking the shelter does.

import type { BusStop, Transit } from "../game/transit";
import type { View } from "../render/view";
import { ICON } from "./icons";
import { WORKS_FAR } from "./mapIcons";

/** Closer in than this (the view's half height, m) the shelter and bay read on their own: no plate. */
export const STOP_NEAR = 70;
/** Further out than this (half height, m) a stop under a town's name gets no plate (none hanging under it). */
const HANG = 300;
/** Half the square the pointer has round a plate (px). */
const HIT = 13;
/** How far from the kerb point the plate's centre stands (px): the 7 px stem and half the 20 px plate. */
const RISE = 17;
/** The line tab (px) under the plate: a plate standing over its stop stands that much higher with one. */
const TAB = 4;

interface Shown { st: BusStop; el: HTMLElement; sx: number; sy: number; h: number; dy: number }

export class StopMarks {
  readonly el = document.createElement("div");
  private pool: HTMLElement[] = [];
  private shown: Shown[] = [];
  /** Boxes on the screen a plate keeps out from under (set by the app: the towns' names). */
  avoid: (() => readonly { l: number; t: number; r: number; b: number }[]) | null = null;
  /** The height of the road at a point (m; set by the app): on a bridge the stem stands on the deck. */
  heightAt: ((p: { x: number; y: number }) => number) | null = null;

  constructor() {
    this.el.className = "map-stops";
    document.body.appendChild(this.el);
  }

  /** Which stops get a plate now (a few times a second). `hide`: none at all (title screen, line tool in hand). */
  sync(tr: Transit, view: View, hide: boolean) {
    this.shown = [];
    let n = 0;
    if (!hide && view.halfH >= STOP_NEAR && view.halfH < WORKS_FAR && tr.stops.size) {
      const lines = [...tr.lines.values()];
      const names = this.avoid?.() ?? [];
      const put: { x: number; y: number }[] = [];
      for (const st of tr.stops.values()) {
        const h = this.heightAt?.(st.p) ?? 0;
        const s = view.worldToScreen(st.p.x, st.p.y, h);
        if (s.x < -20 || s.y < -10 || s.x > view.w + 20 || s.y > view.h + 40) continue;
        // (the plate with its tab spans 7 to 31 px over the kerb point, beyond the stem; where a town's name stands
        // there, as by its hall, the plate hangs under the stop instead, clear of the name, which draws over it;
        // further out than HANG the town's whole middle is under its name and the name speaks for its stops)
        const down = names.some((r) => s.x + 11 > r.l && s.x - 11 < r.r && s.y - 7 > r.t && s.y - 31 < r.b);
        if (down && view.halfH > HANG) continue;
        const cols = lines.filter((l) => l.stops.includes(st.id)).slice(0, 3).map((l) => l.color);
        const dy = down ? RISE : -(RISE + (cols.length ? TAB : 0));
        const cy = s.y + dy;
        if (put.some((p) => Math.abs(p.x - s.x) < 22 && Math.abs(p.y - cy) < 26)) continue;
        put.push({ x: s.x, y: cy });
        let el = this.pool[n];
        if (!el) { el = document.createElement("div"); el.className = "map-stop"; this.el.appendChild(el); this.pool.push(el); }
        const key = cols.join(",");
        if (el.dataset.k !== key || !el.firstChild) {
          el.dataset.k = key;
          el.innerHTML = `<b>${ICON.busCat}</b>${cols.length ? `<span>${cols.map((c) => `<i style="background:#${c.toString(16).padStart(6, "0")}"></i>`).join("")}</span>` : ""}`;
        }
        el.style.display = "";
        el.classList.toggle("down", down);
        this.shown.push({ st, el, sx: s.x, sy: cy, h, dy });
        if (++n >= 150) break;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = "none";
    this.update(view);
  }

  /** Follow the camera (every frame). */
  update(view: View) {
    for (const e of this.shown) {
      const s = view.worldToScreen(e.st.p.x, e.st.p.y, e.h);
      e.sx = s.x;
      e.sy = s.y + e.dy;
      // (the stem's foot on the kerb point: the element stands on it, or hangs from it)
      e.el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, ${e.dy > 0 ? "0" : "-100%"})`;
    }
  }

  /** The stop whose plate is under a point of the screen (px), if any. */
  hit(x: number, y: number): number | null {
    for (let i = this.shown.length - 1; i >= 0; i--) {
      const s = this.shown[i];
      if (Math.abs(x - s.sx) <= HIT && Math.abs(y - s.sy) <= HIT) return s.st.id;
    }
    return null;
  }
}
