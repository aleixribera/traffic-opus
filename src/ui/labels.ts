import type { V2 } from "../core/math";
import type { View } from "../render/view";

export interface MapLabel {
  p: V2;
  /** how high over the ground it stands (m): a town's name over its hall's roof */
  h?: number;
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
  /** zoomed out past compactHalfH, one chip in place of the pictograms: "Needs food", "Short of 3 needs" (needs.ts labelSummary) */
  summary?: { text: string; tone: string };
  compactHalfH?: number;
  /** an open order: a tag hung beside the nameplate with what it is for ("Schoolhouse") */
  order?: string;
  /** which label keeps its place where two would sit on each other: the bigger (a town's people) */
  rank?: number;
}

/** A box on the screen (px). */
export interface Rect { l: number; t: number; r: number; b: number }

/** A label asking for room: where it stands, how much it matters, and its box in full and as its name alone (both relative to where it stands). */
export interface Ask {
  x: number; y: number;
  rank: number;
  full: Rect;
  name: Rect;
  /** how it was drawn last time: it only takes a better place again with room to spare, so it does not flicker */
  was?: Fit["mode"];
}

/** How a label is drawn: in full, as its name alone (moved `dy` px to stack clear of a bigger one), or not at all. */
export interface Fit { mode: "full" | "name" | "hidden"; dy: number }

/** Room a label must have around it to be drawn (px), the extra it needs to come back to a better place, and how far a name may be moved to stack. */
export const LABEL_GAP = 3, LABEL_SPARE = 8, LABEL_SHIFT = 60;

const at = (r: Rect, x: number, y: number, pad = 0): Rect => ({ l: x + r.l - pad, t: y + r.t - pad, r: x + r.r + pad, b: y + r.b + pad });
const overlap = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

/**
 * Which labels are drawn where two or more would sit on each other (owner, 2026-11-10: three town names in a heap
 * at far zoom). The biggest keeps its place in full. A smaller one that would touch it is cut to its name; if the
 * name still touches, it is stacked just under or over what it hits (never further than LABEL_SHIFT from its
 * town); failing that it is left out till there is room. Returns a fit per ask, in the order given.
 */
export function declutter(asks: readonly Ask[]): Fit[] {
  const out: Fit[] = asks.map(() => ({ mode: "hidden", dy: 0 }));
  const taken: Rect[] = [];
  const order = asks.map((a, i) => i).sort((i, j) => asks[j].rank - asks[i].rank || i - j);
  const free = (r: Rect) => !taken.some((t) => overlap(r, t));
  for (const i of order) {
    const a = asks[i];
    // (coming back to a better place than last time takes room to spare)
    const padF = LABEL_GAP / 2 + (a.was === "name" || a.was === "hidden" ? LABEL_SPARE : 0);
    if (free(at(a.full, a.x, a.y, padF))) { out[i] = { mode: "full", dy: 0 }; taken.push(at(a.full, a.x, a.y, LABEL_GAP / 2)); continue; }
    const padN = LABEL_GAP / 2 + (a.was === "hidden" ? LABEL_SPARE : 0);
    let dy = 0, ok = free(at(a.name, a.x, a.y, padN));
    if (!ok) {
      // stack it: just under the lowest thing it hits, or just over the highest, whichever is nearer
      for (const dir of [1, -1]) {
        let d = 0;
        for (let k = 0; k < 4 && Math.abs(d) <= LABEL_SHIFT; k++) {
          const r = at(a.name, a.x, a.y + d, padN);
          const hit = taken.filter((t) => overlap(r, t));
          if (!hit.length) break;
          d = dir > 0 ? Math.max(...hit.map((t) => t.b)) - (a.y + a.name.t - padN) + 0.5 : Math.min(...hit.map((t) => t.t)) - (a.y + a.name.b + padN) - 0.5;
        }
        if (Math.abs(d) <= LABEL_SHIFT && free(at(a.name, a.x, a.y + d, padN)) && (!ok || Math.abs(d) < Math.abs(dy))) { ok = true; dy = d; }
      }
    }
    if (!ok) continue;
    out[i] = { mode: "name", dy };
    taken.push(at(a.name, a.x, a.y + dy, LABEL_GAP / 2));
  }
  return out;
}

/** Place names drawn over the map: station nameplates, so a name reads the same over grass, asphalt or roofs. */
export class MapLabels {
  readonly el = document.createElement("div");
  private items: { l: MapLabel; el: HTMLElement; icons: HTMLElement | null; size: [Sizes | null, Sizes | null]; fit?: Fit["mode"] }[] = [];
  private boxes: Rect[] = [];

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
      if (l.order) {
        const o = document.createElement("span");
        o.className = "ml-order";
        o.innerHTML = `<i aria-hidden="true"></i><span></span>`;
        o.lastElementChild!.textContent = l.order;
        plate.appendChild(o);
      }
      let icons: HTMLElement | null = null;
      if (l.icons?.length) {
        icons = document.createElement("span");
        icons.className = "ml-icons";
        icons.setAttribute("aria-hidden", "true");
        icons.innerHTML = l.icons.map((x) => `<i class="${x.cls}">${x.svg}</i>`).join("") + (l.note ? "<em></em>" : "") + (l.summary ? `<b class="ml-sum ${l.summary.tone}"></b>` : "");
        if (l.note) icons.querySelector("em")!.textContent = l.note;
        if (l.summary) icons.querySelector(".ml-sum")!.textContent = l.summary.text;
        e.appendChild(icons);
      }
      this.el.appendChild(e);
      return { l, el: e, icons, size: [null, null] };
    });
  }

  /** The boxes of the labels drawn now (px): the works' plates keep out from under them. */
  rects(): readonly Rect[] {
    return this.boxes;
  }

  /** A label's box in full and as its name alone, about its middle (measured once per look: its pictograms shrink far out). */
  private measure(it: MapLabels["items"][number], far: boolean): Sizes {
    const k = far ? 1 : 0;
    const have = it.size[k];
    if (have) return have;
    const el = it.el;
    el.style.display = "";
    el.classList.remove("brief");
    it.icons?.classList.toggle("far", far);
    const w = el.offsetWidth, h = el.offsetHeight;
    // (the order's tag hangs out to the right of the plate, outside the label's own box)
    const tag = el.querySelector<HTMLElement>(".ml-order");
    const plate = el.querySelector<HTMLElement>(".ml-plate")!;
    const right = tag ? plate.offsetLeft + tag.offsetLeft + tag.offsetWidth - w / 2 : w / 2;
    el.classList.add("brief");
    const nw = el.offsetWidth, nh = el.offsetHeight;
    el.classList.remove("brief");
    const s: Sizes = { full: { l: -w / 2, t: -h / 2, r: Math.max(w / 2, right), b: h / 2 }, name: { l: -nw / 2, t: -nh / 2, r: nw / 2, b: nh / 2 } };
    it.size[k] = s;
    return s;
  }

  update(view: View) {
    const asks: Ask[] = [], who: MapLabels["items"] = [];
    for (const it of this.items) {
      const { l, el, icons } = it;
      const s = view.worldToScreen(l.p.x, l.p.y, l.h ?? 0);
      const on = view.halfH >= (l.minHalfH ?? 0) && s.x > -100 && s.y > -40 && s.x < view.w + 100 && s.y < view.h + 40;
      if (!on) { el.style.display = "none"; it.fit = undefined; continue; }
      const far = view.halfH > (l.compactHalfH ?? Infinity);
      const size = this.measure(it, far);
      if (icons) icons.classList.toggle("far", far);
      asks.push({ x: s.x, y: s.y, rank: l.rank ?? 0, full: size.full, name: size.name, was: it.fit });
      who.push(it);
    }
    const fits = declutter(asks);
    this.boxes = [];
    for (let i = 0; i < who.length; i++) {
      const it = who[i], f = fits[i], a = asks[i];
      it.fit = f.mode;
      it.el.style.display = f.mode === "hidden" ? "none" : "";
      if (f.mode === "hidden") continue;
      it.el.classList.toggle("brief", f.mode === "name");
      it.el.style.transform = `translate(${a.x.toFixed(1)}px, ${(a.y + f.dy).toFixed(1)}px) translate(-50%, -50%)`;
      this.boxes.push(at(f.mode === "full" ? a.full : a.name, a.x, a.y + f.dy));
    }
  }
}

interface Sizes { full: Rect; name: Rect }
