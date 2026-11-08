import type { V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { siteFrame } from "../game/sites";
import type { View } from "../render/view";

/** What a problem looks like on the map: the pictogram and how urgent it is (urgent ones bounce). */
function iconFor(p: string): { key: string; svg: string; urgent: boolean } {
  if (p === GATE_PROBLEM) return { key: "gate", svg: GATE, urgent: false };
  if (p === "No road access" || p.startsWith("Trips can't") || p.startsWith("Not connected")) return { key: "road", svg: ROAD, urgent: false };
  if (p.startsWith("Full of") || p.startsWith("Waiting for") || p.startsWith("Nobody") || p.startsWith("Towns on your roads") || p.startsWith("Your plants") || p === "Out of food") return { key: "cargo", svg: CARGO, urgent: false };
  return { key: "warn", svg: WARN, urgent: false };
}

/** A company site with no road to its gate yet: its icon stands on the gate, where the road has to come. */
const GATE_PROBLEM = "No road to the gate";
const GATE = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#2d3a48"/><path d="M7.5 8 V20 M20.5 8 V20" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/><path d="M14 9 V18.5 M10.6 15.4 L14 18.8 L17.4 15.4" stroke="#ffd34a" stroke-width="2.2" fill="none" stroke-linecap="round" stroke-linejoin="round"/></svg>`;
const WARN = `<svg viewBox="0 0 28 28" aria-hidden="true"><path d="M14 3 L26 24 H2 Z" fill="#f2a33a"/><path d="M14 10 v7" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="20.6" r="1.6" fill="#fff"/></svg>`;
const CARGO = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#f2a33a"/><rect x="8" y="9" width="12" height="10" rx="1" fill="#fff"/><path d="M8 13 H20 M14 9 V13" stroke="#f2a33a" stroke-width="1.6"/></svg>`;
const ROAD = `<svg viewBox="0 0 28 28" aria-hidden="true"><circle cx="14" cy="14" r="11" fill="#e5484d"/><path d="M10 21 L12 7 M18 21 L16 7" stroke="#fff" stroke-width="2" stroke-linecap="round"/><path d="M7 7 L21 21" stroke="#fff" stroke-width="2.4" stroke-linecap="round"/></svg>`;

/**
 * Problem icons floating over buildings (CS2's notification icons): no road, and a generic warning for business
 * trouble. Only the closest few hundred on screen, and only zoomed in.
 */
export class MapIcons {
  readonly el = document.createElement("div");
  private pool: HTMLElement[] = [];
  private shown: { at: V2; el: HTMLElement }[] = [];

  constructor() {
    this.el.className = "map-icons";
    document.body.appendChild(this.el);
  }

  /** Rebuild the set (a few times a second). */
  set(list: Building[], view: View) {
    const on = view.halfH < 1100;
    // (a town's homes and shops only show theirs up close: further out, the town's label shows what it is short of,
    // and a city's dozens of "Out of food" pins would bury the company's own warnings)
    const town = view.halfH < 260;
    this.shown = [];
    let n = 0;
    if (on) {
      const pad = 40;
      for (const b of list) {
        if (!b.problem || b.abandoned || b.built < 1 || (b.zone && !town)) continue;
        // (a company site's trouble shows by its gate, where its plant and truck yard are, not out in its fields)
        const f = b.placed ? siteFrame(b.c, b.rot, b.side, b.hd) : null;
        const at = !f ? b.c : b.problem === GATE_PROBLEM ? f.gate : { x: f.gate.x + f.into.x * 30, y: f.gate.y + f.into.y * 30 };
        const s = view.toScreen(at);
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
        this.shown.push({ at, el });
        if (++n >= 300) break;
      }
    }
    for (let i = n; i < this.pool.length; i++) this.pool[i].style.display = "none";
    this.update(view);
  }

  /** Follow the camera (every frame). */
  update(view: View) {
    const lift = Math.min(28, 9 / Math.max(0.12, view.mpp));
    for (const { at, el } of this.shown) {
      const s = view.toScreen(at);
      el.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
    }
  }
}
