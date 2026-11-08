import type { V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { PRODUCTS, SHELF, freshness, perishable, type Delivery, type Product } from "../game/industry";
import { siteFrame } from "../game/sites";
import { CARS_PER_LOAD } from "../game/towns";
import type { Traffic } from "../sim/traffic";
import type { View } from "../render/view";
import { productIcon } from "./icons";
import { BUILDING_TYPES } from "../config";

/** How long a pop rises and fades over the map (real seconds). */
const LIFE = 1.9;
/** Most pops up at once (the oldest go first). */
const MAX_POPS = 28;
/** Most freshness rings drawn at once (the trucks nearest the middle of the screen). */
const MAX_RINGS = 48;
/** Pops and rings only show this close in (half the view's height, m): further out they would be noise. */
const NEAR = 900;

const money = (v: number) => `$${Math.round(Math.abs(v)).toLocaleString("en-US")}`;
const SNOW = `<svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1v10M1.7 3.5l8.6 5M1.7 8.5l8.6-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>`;

/** Where a building's loads change hands: by a company site's gate, else its middle. */
function gateOf(b: Building): V2 {
  if (!b.placed) return b.c;
  const f = siteFrame(b.c, b.rot, b.side, b.hd);
  return { x: f.gate.x + f.into.x * 14, y: f.gate.y + f.into.y * 14 };
}

interface Pop { at: V2; el: HTMLElement; t0: number }

/**
 * The money and moments that rise off the map as they happen (TF2's income pops): a load sold pops its price over
 * the shop that took it, a perishable says whether it came fresh or what spoiled on the way, cars arrive in town,
 * and a by-product leaves its plant as its own cargo. And over every refrigerated truck on the road, a ring that
 * runs down its load's shelf time: teal while fresh, amber near the end, red (pulsing) once it is spoiling.
 */
export class Pops {
  readonly el = document.createElement("div");
  private pops: Pop[] = [];
  private rings: HTMLElement[] = [];

  constructor() {
    this.el.className = "map-pops";
    document.body.appendChild(this.el);
  }

  private add(at: V2, cls: string, html: string, view: View) {
    if (view.halfH > NEAR) return;
    const s = view.toScreen(at);
    if (s.x < -60 || s.y < -60 || s.x > view.w + 60 || s.y > view.h + 60) return;
    const el = document.createElement("div");
    el.className = `pop ${cls}`;
    el.innerHTML = html;
    this.el.appendChild(el);
    this.pops.push({ at, el, t0: performance.now() });
    while (this.pops.length > MAX_POPS) this.pops.shift()!.el.remove();
  }

  /** A load handed over: its price, and what is special about it. */
  delivery(d: Delivery, view: View) {
    const at = gateOf(d.to);
    const icon = productIcon(d.product);
    if (d.product === "cars" && d.pay > 0) {
      this.add(at, "cars", `<i>${icon}</i><b>${d.n * CARS_PER_LOAD} new cars</b><em>+${money(d.pay)}</em>`, view);
      return;
    }
    if (perishable(d.product)) {
      if (d.lost >= 1) this.add(at, "spoiled", `<i>${icon}</i><b>${Math.round(d.fresh * 100)}% fresh</b><em>−${money(d.lost)} spoiled</em>`, view);
      else this.add(at, "fresh", `<i class="snow">${SNOW}</i><b>Fresh</b>${d.pay > 0 ? `<em>+${money(d.pay)}</em>` : ""}`, view);
      return;
    }
    if (d.pay > 0) this.add(at, "sale", `<em>+${money(d.pay)}</em>`, view);
  }

  /** A by-product left for another plant: it goes out as cargo of its own, named, from the gate. */
  shipped(from: Building, to: Building, p: Product, view: View) {
    const name = PRODUCTS[p].name;
    this.add(gateOf(from), "byproduct", `<i>${productIcon(p)}</i><b>${name}</b><span>by-product, to the ${BUILDING_TYPES[to.kind].name.toLowerCase()}</span>`, view);
  }

  /** Every frame: the pops rise and fade, the rings follow their trucks. */
  update(view: View, traffic: Traffic | null, alpha: number) {
    const now = performance.now();
    this.pops = this.pops.filter((p) => {
      const f = (now - p.t0) / 1000 / LIFE;
      if (f >= 1) { p.el.remove(); return false; }
      const s = view.toScreen(p.at);
      const rise = 14 + 34 * (1 - (1 - f) * (1 - f));
      p.el.style.transform = `translate(${s.x.toFixed(1)}px, ${(s.y - rise).toFixed(1)}px) translate(-50%, -100%)`;
      p.el.style.opacity = f < 0.05 ? (f / 0.05).toFixed(2) : f > 0.72 ? ((1 - f) / 0.28).toFixed(2) : "1";
      return true;
    });
    this.updateRings(view, traffic, alpha);
  }

  private updateRings(view: View, traffic: Traffic | null, alpha: number) {
    let n = 0;
    if (traffic && view.halfH <= NEAR) {
      const cx = view.w / 2, cy = view.h / 2;
      const list: { x: number; y: number; d: number; p: Product; age: number }[] = [];
      for (const v of traffic.vehicles) {
        const p = v.trip.cargo as Product | undefined;
        if (!v.truck || !p || !perishable(p)) continue;
        // (over the middle of the truck: a road train's middle piece, else its body)
        let x = v.px + (v.x - v.px) * alpha, y = v.py + (v.y - v.py) * alpha;
        if (v.uPose && v.puPose && v.uPose.length >= 8) {
          const o = Math.floor(v.uPose.length / 8) * 4;
          x = v.puPose[o] + (v.uPose[o] - v.puPose[o]) * alpha;
          y = v.puPose[o + 1] + (v.uPose[o + 1] - v.puPose[o + 1]) * alpha;
        }
        const s = view.toScreen({ x, y });
        if (s.x < -30 || s.y < -30 || s.x > view.w + 30 || s.y > view.h + 30) continue;
        list.push({ x: s.x, y: s.y, d: Math.hypot(s.x - cx, s.y - cy), p, age: traffic.time - v.trip.startT });
      }
      list.sort((a, b) => a.d - b.d);
      // (a truck's ring sits a little above it, scaled down as the view pulls out)
      const lift = Math.min(26, 8 / Math.max(0.12, view.mpp)) + 6;
      for (const r of list.slice(0, MAX_RINGS)) {
        let el = this.rings[n];
        if (!el) {
          el = document.createElement("div");
          el.className = "fresh-ring";
          el.innerHTML = `<i></i>`;
          this.el.appendChild(el);
          this.rings.push(el);
        }
        const shelf = SHELF[r.p]!;
        // fresh: the share of its shelf time left; spoiling: the share of its value left (down to the floor)
        const spoiling = r.age > shelf;
        const left = spoiling ? freshness(r.p, r.age) : 1 - r.age / shelf;
        const state = spoiling ? "spoiling" : left < 0.35 ? "late" : "ok";
        if (el.dataset.p !== r.p) { el.dataset.p = r.p; el.firstElementChild!.innerHTML = productIcon(r.p); }
        if (el.dataset.s !== state) { el.dataset.s = state; el.className = `fresh-ring ${state}`; }
        el.style.setProperty("--left", `${Math.max(0, Math.min(1, left)) * 360}deg`);
        el.style.transform = `translate(${r.x.toFixed(1)}px, ${(r.y - lift).toFixed(1)}px) translate(-50%, -100%)`;
        el.style.display = "";
        n++;
      }
    }
    for (let i = n; i < this.rings.length; i++) this.rings[i].style.display = "none";
  }

  /** Clear everything (a new game, the menu). */
  clear() {
    for (const p of this.pops) p.el.remove();
    this.pops = [];
    for (const r of this.rings) r.style.display = "none";
  }
}
