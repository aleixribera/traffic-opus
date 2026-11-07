import type { Building } from "../game/buildings";
import type { View } from "../render/view";
import { serviceIcon } from "./icons";

/** What a problem looks like on the map: the pictogram and how urgent it is (urgent ones bounce). */
function iconFor(p: string): { key: string; svg: string; urgent: boolean } {
  if (p === "On fire!") return { key: "fire", svg: serviceIcon("firestation"), urgent: true };
  if (p === "Garbage piling up") return { key: "garbage", svg: serviceIcon("garbage"), urgent: false };
  if (p === "High crime") return { key: "crime", svg: serviceIcon("crime"), urgent: false };
  if (p.startsWith("Sick")) return { key: "sick", svg: serviceIcon("sick"), urgent: true };
  if (p === "No road access" || p.startsWith("Trips can't") || p.startsWith("Not connected")) return { key: "road", svg: ROAD, urgent: false };
  return { key: "warn", svg: WARN, urgent: false };
}

const WARN = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 3 L26 24 H2 Z" fill="#f2a33a"/><path d="M14 10 v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="20.6" r="1.6" fill="#fff"/></svg>`;
const ROAD = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#e5484d"/><path d="M10 21 L12 7 M18 21 L16 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M7 7 L21 21" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/**
 * Problem icons floating over buildings (CS2's notification icons): fire, garbage, crime, sick residents, no
 * road, and a generic warning for business trouble. Only the closest few hundred on screen, and only zoomed in.
 */
export class MapIcons {
  readonly el = document.createElement("div");
  private pool: HTMLElement[] = [];
  private shown: { b: Building; el: HTMLElement }[] = [];

  constructor() {
    this.el.className = "map-icons";
    document.body.appendChild(this.el);
  }

  /** Rebuild the set (a few times a second). */
  set(list: Building[], view: View) {
    const on = view.halfH < 1100;
    this.shown = [];
    let n = 0;
    if (on) {
      const pad = 40;
      for (const b of list) {
        if (!b.problem || b.abandoned || b.built < 1) continue;
        const s = view.toScreen(b.c);
        if (s.x < -pad || s.y < -pad || s.x > view.w + pad || s.y > view.h + pad) continue;
        const ic = iconFor(b.problem);
        let el = this.pool[n];
        if (!el) { el = document.createElement("div"); this.el.appendChild(el); this.pool.push(el); }
        if (el.dataset.k !== ic.key) {
          el.dataset.k = ic.key;
          el.className = "map-icon" + (ic.urgent ? " urgent" : "");
          el.innerHTML = ic.svg;
        }
        el.style.display = "";
        this.shown.push({ b, el });
        if (++n >= 300) break;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = "none";
    this.update(view);
  }

  /** Follow the camera (every frame). */
  update(view: View) {
    const lift = Math.min(28, 9 / Math.max(0.12, view.mpp));
    for (const { b, el } of this.shown) {
      const s = view.toScreen(b.c);
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
