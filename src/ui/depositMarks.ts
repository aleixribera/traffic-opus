// Where the ground for an extractor is (docs/design.md, "The map"): deposits lie kilometres apart, so the map marks
// them. While an extractor is being placed, each deposit of its kind carries a small enamel tag at its middle
// ("COAL"), and the nearest ones off screen get a pointer held at the screen's edge with the way and the distance
// ("COAL · 3.4 km"); click it to fly there. In the Resources view every deposit kind on screen is tagged. Only the
// deposit blobs the world generator places are marked: fertile soil and forest are everywhere and show by colour.

import type { V2 } from "../core/math";
import type { View } from "../render/view";
import type { WorldGen } from "../world/gen";
import { productIcon } from "./icons";
import { PLANTS, type PlantKind } from "../game/industry";

/** A kind of deposit the map can mark: its field, its name and the product icon its tag shows. */
export interface DepositKind { field: number; name: string; icon: string }

/** Every kind of deposit, by the extractors that work it ("Coal", the coal icon), one per field. */
export const DEPOSIT_KINDS = new Map<number, DepositKind & { by: PlantKind[] }>();
for (const k of Object.keys(PLANTS) as PlantKind[]) {
  const d = PLANTS[k].deposit;
  if (!d) continue;
  const had = DEPOSIT_KINDS.get(d.field);
  if (had) { had.by.push(k); continue; }
  DEPOSIT_KINDS.set(d.field, { field: d.field, name: d.name[0].toUpperCase() + d.name.slice(1), icon: Object.keys(PLANTS[k].outputs)[0], by: [k] });
}

/** How far out the pointers look for the nearest deposits of the kind being placed (m). */
const SEARCH = 24000;
/** Pointers at most, for the kind being placed (the nearest ones off screen). */
const POINTERS = 2;

interface Mark { key: string; k: DepositKind; c: V2; tag: HTMLButtonElement }

export class DepositMarks {
  readonly el = document.createElement("div");
  private marks = new Map<string, Mark>();
  private edges: { k: DepositKind; c: V2; el: HTMLButtonElement }[] = [];
  /** what is marked: the kind being placed (pointers too), every kind (the Resources view), or nothing */
  private kinds: DepositKind[] = [];
  private focus = false;
  /** where the lists were last gathered round, and for what: gathered again when the view moves on */
  private at: V2 | null = null;
  private atKey = "";
  private walls: DOMRect[] = [];

  constructor(private gen: () => WorldGen, private fly: (c: V2, field?: number) => void) {
    this.el.className = "deposit-marks";
    document.body.prepend(this.el);
  }

  /** Mark these kinds (`focus`: the one being placed, with pointers); none to clear. A few times a second. */
  show(kinds: DepositKind[], focus: boolean) {
    const key = kinds.map((k) => k.field).join(",") + (focus ? "!" : "");
    if (key !== this.atKey) { this.atKey = key; this.at = null; }
    this.kinds = kinds;
    this.focus = focus;
    if (!kinds.length) this.clear();
    this.walls = this.edges.length ? [...document.querySelectorAll(".corner > *, .banner:not([hidden])")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0) : [];
  }

  private clear() {
    for (const m of this.marks.values()) m.tag.remove();
    this.marks.clear();
    for (const e of this.edges) e.el.remove();
    this.edges = [];
    this.at = null;
  }

  /** The deposits round the view centre (gathered again once the view has moved a good way or zoomed out). */
  private gather(view: View) {
    const c = { x: view.cx, y: view.cy };
    const reach = Math.max(view.halfH * (view.w / Math.max(1, view.h)), view.halfH) * 1.5;
    if (this.at && Math.hypot(c.x - this.at.x, c.y - this.at.y) < Math.max(400, reach * 0.3)) return;
    this.at = c;
    const gen = this.gen();
    const live = new Set<string>();
    const nearest: { k: DepositKind; c: V2 }[] = [];
    for (const k of this.kinds) {
      const found = gen.depositsNear(k.field, c.x, c.y, this.focus ? SEARCH : reach + 1500);
      for (const d of found) {
        const key = `${k.field}:${Math.round(d.x)}:${Math.round(d.y)}`;
        live.add(key);
        if (!this.marks.has(key)) {
          const tag = document.createElement("button");
          tag.type = "button";
          tag.className = `dm-tag${this.focus ? " on" : ""}`;
          tag.innerHTML = `<i aria-hidden="true">${productIcon(k.icon)}</i><span></span>`;
          tag.querySelector("span")!.textContent = k.name;
          tag.title = `${k.name} deposit: look at it`;
          tag.setAttribute("aria-label", tag.title);
          const at = { x: d.x, y: d.y };
          tag.onclick = () => this.fly(at, k.field);
          this.el.append(tag);
          this.marks.set(key, { key, k, c: at, tag });
        }
        if (this.focus && nearest.length < POINTERS * 3) nearest.push({ k, c: { x: d.x, y: d.y } });
      }
    }
    for (const [key, m] of this.marks) if (!live.has(key)) { m.tag.remove(); this.marks.delete(key); }
    for (const m of this.marks.values()) m.tag.classList.toggle("on", this.focus);
    // the pointers: the nearest few of the kind being placed (which of them are off screen is decided each frame)
    for (const e of this.edges) e.el.remove();
    this.edges = nearest.map(({ k, c: at }) => {
      const el = document.createElement("button");
      el.type = "button";
      el.className = "tp-edge dm-edge";
      el.innerHTML = `<i class="tp-arrow" aria-hidden="true"></i><span class="tp-k">Nearest</span><b></b><span class="tp-km"></span>`;
      el.querySelector("b")!.textContent = k.name;
      el.title = `Fly to the ${k.name.toLowerCase()} deposit`;
      el.setAttribute("aria-label", el.title);
      el.onclick = () => this.fly(at);
      this.el.append(el);
      return { k, c: at, el };
    });
  }

  /** Where each tag and pointer goes this frame. */
  update(view: View) {
    if (!this.kinds.length) return;
    this.gather(view);
    const W = view.w, H = view.h;
    // (tags only once the deposits read as patches, not from right on top of one, where the ground says it all)
    const tagsOn = view.halfH > 160;
    for (const m of this.marks.values()) {
      const s = view.toScreen(m.c);
      const on = tagsOn && s.x > -60 && s.y > -30 && s.x < W + 60 && s.y < H + 30;
      m.tag.style.display = on ? "" : "none";
      if (on) m.tag.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
    }
    // pointers: the nearest of the focused kind that are off screen, POINTERS at most (none once one is in view)
    const L = 24, R = W - 24, T = 84, B = H - 128;
    const cx = W / 2, cy = (T + B) / 2;
    const anyOn = this.edges.some((e) => { const s = view.toScreen(e.c); return s.x > 0 && s.y > 0 && s.x < W && s.y < H; });
    let shown = 0;
    const order = [...this.edges].sort((a, b) => Math.hypot(a.c.x - view.cx, a.c.y - view.cy) - Math.hypot(b.c.x - view.cx, b.c.y - view.cy));
    for (const e of order) {
      const s = view.toScreen(e.c);
      const off = !(s.x > 0 && s.y > 0 && s.x < W && s.y < H);
      const show = off && !anyOn && shown < POINTERS;
      e.el.style.display = show ? "" : "none";
      if (!show) continue;
      shown++;
      const dx = s.x - cx, dy = s.y - cy;
      const k = Math.min(dx > 0 ? (R - 110 - cx) / dx : dx < 0 ? (L + 110 - cx) / dx : Infinity, dy > 0 ? (B - cy) / dy : dy < 0 ? (T - cy) / dy : Infinity);
      const hw = 95, hh = 26;
      const under = (x: number, y: number) => this.walls.some((r) => x + hw > r.left && x - hw < r.right && y + hh > r.top && y - hh < r.bottom);
      let f = 1;
      while (f > 0.15 && under(cx + dx * k * f, cy + dy * k * f)) f -= 0.04;
      e.el.style.transform = `translate(${(cx + dx * k * f).toFixed(1)}px, ${(cy + dy * k * f).toFixed(1)}px) translate(-50%, -50%)`;
      (e.el.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      const km = Math.hypot(e.c.x - view.cx, e.c.y - view.cy) / 1000;
      const txt = `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
      const kmEl = e.el.querySelector(".tp-km")!;
      if (kmEl.textContent !== txt) kmEl.textContent = txt;
    }
  }
}
