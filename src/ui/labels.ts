import type { V2 } from "../core/math";
import type { View } from "../render/view";

export interface MapLabel {
  p: V2;
  name: string;
  sub?: string;
  /** Only shown when the view is at least this zoomed out (half-height in metres). */
  minHalfH?: number;
  /** Clickable: the label is a button (a town's name opens its panel). */
  onClick?: () => void;
  /** what the button says to a screen reader */
  title?: string;
  /** a slim bar under the name: how well the place is supplied (0..1), coloured by how it is doing */
  bar?: { share: number; cls: "ok" | "mid" | "low" };
  /** small pictograms of what it is short of (svg markup), shown only while zoomed in closer than iconsMaxHalfH */
  icons?: string[];
  iconsMaxHalfH?: number;
}

/** Place names drawn over the map, like a road atlas. Plain text with a halo, no boxes. */
export class MapLabels {
  readonly el = document.createElement("div");
  private items: { l: MapLabel; el: HTMLElement; icons: HTMLElement | null }[] = [];

  constructor() {
    this.el.className = "map-labels";
    document.body.appendChild(this.el);
  }

  /** Passive: clickable labels let clicks through to the map (a tool is in hand). */
  passive(on: boolean) {
    this.el.classList.toggle("passive", on);
  }

  set(labels: MapLabel[]) {
    this.el.replaceChildren();
    this.items = labels.map((l) => {
      const e = document.createElement(l.onClick ? "button" : "div");
      e.className = "map-label" + (l.onClick ? " click" : "");
      if (l.onClick) { e.onclick = l.onClick; e.title = l.title ?? l.name; e.setAttribute("aria-label", l.title ?? l.name); }
      e.innerHTML = `<b></b>${l.sub ? "<span></span>" : ""}`;
      e.querySelector("b")!.textContent = l.name;
      if (l.sub) e.querySelector("span")!.textContent = l.sub;
      if (l.bar) {
        const bar = document.createElement("i");
        bar.className = `ml-bar ${l.bar.cls}`;
        bar.innerHTML = `<i style="width:${Math.max(4, Math.min(100, l.bar.share * 100)).toFixed(0)}%"></i>`;
        e.appendChild(bar);
      }
      let icons: HTMLElement | null = null;
      if (l.icons?.length) {
        icons = document.createElement("i");
        icons.className = "ml-icons";
        icons.innerHTML = l.icons.map((x) => `<i>${x}</i>`).join("");
        e.appendChild(icons);
      }
      this.el.appendChild(e);
      return { l, el: e, icons };
    });
  }

  update(view: View) {
    for (const { l, el, icons } of this.items) {
      const s = view.toScreen(l.p);
      const on = view.halfH >= (l.minHalfH ?? 0) && s.x > -100 && s.y > -40 && s.x < view.w + 100 && s.y < view.h + 40;
      el.style.display = on ? "" : "none";
      if (on && icons) icons.style.display = view.halfH <= (l.iconsMaxHalfH ?? Infinity) ? "" : "none";
      if (on) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
