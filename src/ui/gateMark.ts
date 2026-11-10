// A works' gate, marked plainly (owner, 2026-11-10: "a works gate is not drawn as a clear mark"). Every works has
// one gate, the only place its trucks and its road come and go, and till now a thin arrow on the ghost was all that
// said where. This is a mark over the map: a brass ring on the gate itself and a plate beside it that says "Gate",
// standing out from the fence the way the road has to come. Shown on the works being placed and on a works that is
// selected; it says so too when no road is at the gate yet. Drawn in the interface layer: no model is touched.

import type { V2 } from "../core/math";
import type { SiteFrame } from "../game/sites";
import type { View } from "../render/view";

/** A works narrower than this on screen (px) is too small for its gate to be worth a mark. */
export const GATE_MARK_MIN = 70;
/** How far out from the gate the plate stands (px) at least, so the ring and the plate never touch. */
export const GATE_PLATE_OUT = 34;

export interface GateSpot {
  /** the gate on screen (px) */
  x: number; y: number;
  /** how far the plate stands out from it (px), and which way (radians, screen) */
  out: number; angle: number;
  /** the works is big enough on screen for the mark */
  show: boolean;
}

/**
 * Where a gate's mark goes on screen. `lead`: how far out from the fence (m) the plate has to clear (the ghost's
 * arrow reaches out of the gate; a standing works needs none). `hw`: the works' half width (m).
 */
export function gateSpot(toScreen: (x: number, y: number) => V2, f: SiteFrame, hw: number, lead = 0): GateSpot {
  const s = toScreen(f.gate.x, f.gate.y), o = toScreen(f.gate.x - f.into.x * 10, f.gate.y - f.into.y * 10);
  const dx = o.x - s.x, dy = o.y - s.y, len = Math.hypot(dx, dy);
  // (how wide the works is on screen, along its gate side: at a tilt that is not what 10 m outward measures)
  const a = toScreen(f.gate.x + f.along.x * hw, f.gate.y + f.along.y * hw);
  const wide = Math.hypot(a.x - s.x, a.y - s.y) * 2;
  const pxPerM = len / 10;
  return { x: s.x, y: s.y, out: Math.max(GATE_PLATE_OUT, lead * pxPerM + 22), angle: len > 1e-6 ? Math.atan2(dy, dx) : -Math.PI / 2, show: wide >= GATE_MARK_MIN && len > 1e-6 };
}

/** What to mark: the gate's frame, the works' half width, and what to say beside "Gate". */
export interface GateAsk { f: SiteFrame; hw: number; lead?: number; note?: string; bad?: boolean }

export class GateMark {
  readonly el = document.createElement("div");
  private stem = document.createElement("i");
  private plate = document.createElement("span");
  private ask: GateAsk | null = null;
  private said = "";

  constructor() {
    this.el.className = "gate-mark";
    this.el.setAttribute("aria-hidden", "true");
    this.el.innerHTML = `<i class="gm-ring"></i>`;
    this.stem.className = "gm-stem";
    this.plate.className = "gm-plate";
    this.el.append(this.stem, this.plate);
    this.el.style.display = "none";
    document.body.prepend(this.el);
  }

  /** Mark this gate (null: none). */
  set(ask: GateAsk | null) {
    this.ask = ask;
    if (!ask) { this.el.style.display = "none"; return; }
    const said = `${ask.bad ? "!" : ""}${ask.note ?? ""}`;
    if (said !== this.said || !this.plate.firstChild) {
      this.said = said;
      this.plate.innerHTML = `<b>Gate</b>${ask.note ? `<em></em>` : ""}`;
      if (ask.note) this.plate.querySelector("em")!.textContent = ask.note;
      this.el.classList.toggle("bad", !!ask.bad);
    }
  }

  /** Where it goes this frame. */
  update(view: View) {
    const ask = this.ask;
    if (!ask) return;
    const g = gateSpot((x, y) => view.worldToScreen(x, y), ask.f, ask.hw, ask.lead);
    const on = g.show && g.x > -40 && g.y > -40 && g.x < view.w + 40 && g.y < view.h + 40;
    this.el.style.display = on ? "" : "none";
    if (!on) return;
    this.el.style.transform = `translate(${g.x.toFixed(1)}px, ${g.y.toFixed(1)}px)`;
    this.stem.style.width = `${g.out.toFixed(1)}px`;
    this.stem.style.transform = `rotate(${g.angle.toFixed(3)}rad)`;
    const px = Math.cos(g.angle) * g.out, py = Math.sin(g.angle) * g.out;
    // (the plate hangs off the end of the stem on the side it points: its near edge on the stem's end, never over the ring)
    const ax = -50 + Math.cos(g.angle) * 50, ay = -50 + Math.sin(g.angle) * 50;
    this.plate.style.transform = `translate(${px.toFixed(1)}px, ${py.toFixed(1)}px) translate(${ax.toFixed(1)}%, ${ay.toFixed(1)}%)`;
  }
}
