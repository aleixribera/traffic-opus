import type { V2 } from "../core/math";
import type { View } from "../render/view";

export interface MapLabel {
  p: V2;
  name: string;
  sub?: string;
  /** Only shown when the view is at least this zoomed out (half-height in metres). */
  minHalfH?: number;
}

/** Place names drawn over the map, like a road atlas. Plain text with a halo, no boxes. */
export class MapLabels {
  readonly el = document.createElement("div");
  private items: { l: MapLabel; el: HTMLElement }[] = [];

  constructor() {
    this.el.className = "map-labels";
    document.body.appendChild(this.el);
  }

  set(labels: MapLabel[]) {
    this.el.replaceChildren();
    this.items = labels.map((l) => {
      const e = document.createElement("div");
      e.className = "map-label";
      e.innerHTML = `<b></b>${l.sub ? "<span></span>" : ""}`;
      e.querySelector("b")!.textContent = l.name;
      if (l.sub) e.querySelector("span")!.textContent = l.sub;
      this.el.appendChild(e);
      return { l, el: e };
    });
  }

  update(view: View) {
    for (const { l, el } of this.items) {
      const s = view.toScreen(l.p);
      const on = view.halfH >= (l.minHalfH ?? 0) && s.x > -100 && s.y > -40 && s.x < view.w + 100 && s.y < view.h + 40;
      el.style.display = on ? "" : "none";
      if (on) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
