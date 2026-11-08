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
  /**
   * small pictograms under the name (svg markup), each on a ringed disc whose class tints it ("plenty", "enough",
   * "low", "none", "noroad"); zoomed out past compactHalfH they shrink and the fine ones ("plenty", "enough") drop out
   */
  icons?: { svg: string; cls: string }[];
  /** a few words beside the pictograms ("No road yet") */
  note?: string;
  compactHalfH?: number;
}

/** Place names drawn over the map: station nameplates, so a name reads the same over grass, asphalt or roofs. */
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
      // (a nameplate: the name, its size on a tab hung under it, its needs under that)
      e.innerHTML = `<span class="ml-plate"><b></b>${l.sub ? "<span></span>" : ""}</span>`;
      const plate = e.firstElementChild as HTMLElement;
      plate.querySelector("b")!.textContent = l.name;
      if (l.sub) plate.querySelector("span")!.textContent = l.sub;
      let icons: HTMLElement | null = null;
      if (l.icons?.length) {
        icons = document.createElement("span");
        icons.className = "ml-icons";
        icons.setAttribute("aria-hidden", "true");
        icons.innerHTML = l.icons.map((x) => `<i class="${x.cls}">${x.svg}</i>`).join("") + (l.note ? "<em></em>" : "");
        if (l.note) icons.querySelector("em")!.textContent = l.note;
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
      if (on && icons) icons.classList.toggle("far", view.halfH > (l.compactHalfH ?? Infinity));
      if (on) el.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
  }
}
