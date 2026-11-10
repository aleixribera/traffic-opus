// A ring at the cursor for each wheel notch (review 2026-11-10, Camera 4): it closes in as the map zooms in and opens
// out as it zooms out, so every notch shows it was taken, and a notch at the end of the zoom shows that too (the
// ring only pulses where it is). Drawn over the map, under the panels; never in the way of the pointer. With reduced
// motion asked for there is no ring (the zoom itself is instant then).
import "./zoomRing.css";

export type RingKind = "in" | "out" | "stop";

const FRAMES: Record<RingKind, Keyframe[]> = {
  in: [{ transform: "scale(1.35)", opacity: 0.9 }, { transform: "scale(0.45)", opacity: 0 }],
  out: [{ transform: "scale(0.45)", opacity: 0.9 }, { transform: "scale(1.35)", opacity: 0 }],
  stop: [{ transform: "scale(0.8)", opacity: 0.8 }, { transform: "scale(0.9)", opacity: 0.7, offset: 0.5 }, { transform: "scale(0.8)", opacity: 0 }],
};

export class ZoomRing {
  private el: HTMLDivElement;
  private ring: HTMLDivElement;
  private anim: Animation | null = null;

  constructor(parent: HTMLElement) {
    this.el = document.createElement("div");
    this.el.className = "zoom-ring";
    this.el.setAttribute("aria-hidden", "true");
    this.ring = document.createElement("div");
    this.el.appendChild(this.ring);
    parent.appendChild(this.el);
  }

  /** A notch at (x, y), in the parent's CSS pixels. */
  show(x: number, y: number, kind: RingKind) {
    if (typeof this.ring.animate !== "function" || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    this.el.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
    this.ring.dataset.kind = kind;
    // (a notch while the last ring is still fading starts a fresh one)
    this.anim?.cancel();
    this.anim = this.ring.animate(FRAMES[kind], { duration: kind === "stop" ? 360 : 320, easing: "ease-out" });
  }
}
