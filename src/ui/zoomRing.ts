// A ring at the cursor for each wheel notch (review 2026-11-10, Camera 4): it closes in as the map zooms in and opens
// out as it zooms out, so every notch shows it was taken, and a notch at the end of the zoom shows that too (the
// ring only pulses where it is). Drawn over the map, under the panels; never in the way of the pointer.
import "./zoomRing.css";

export type RingKind = "in" | "out" | "stop";

export class ZoomRing {
  private el: HTMLDivElement;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "zoom-ring";
    this.el.setAttribute("aria-hidden", "true");
    parent.appendChild(this.el);
  }

  /** A notch at (x, y), in the parent's CSS pixels. */
  show(x: number, y: number, kind: RingKind) {
    const el = this.el;
    el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    el.dataset.kind = kind;
    // (restart the animation: a notch while the last ring is still fading starts a fresh one)
    el.classList.remove("on");
    void el.offsetWidth;
    el.classList.add("on");
  }
}
