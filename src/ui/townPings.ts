// A town that has just sprung up (a milestone's reward, settlements.ts spawn) is marked on the map until the company
// first delivers to it: a ring of ochre pulses round its hall, and, while it is off screen, a pointer held at the
// screen's edge with the way and the distance ("NEW TOWN · Fort Pryor · 3.2 km"). Click the pointer to fly the
// camera there; click the ring to open the town. Once the town has been on screen the pointer stops (the ring stays).

import type { V2 } from "../core/math";
import type { Town } from "../game/settlements";
import type { View } from "../render/view";

/** How long a new town keeps its marker if nobody delivers to it (s of game time: three game days). */
export const PING_FOR = 3 * 24 * 40;

interface Ping {
  t: Town;
  ring: HTMLButtonElement;
  edge: HTMLButtonElement;
  /** it has been on screen (or flown to): no more pointer */
  seen: boolean;
}

export class TownPings {
  readonly el = document.createElement("div");
  private pings = new Map<number, Ping>();
  /** the HUD's corner panels on screen (read a few times a second, not every frame): the pointer keeps clear of them */
  private walls: DOMRect[] = [];

  constructor(private on: { fly(id: number): void; open(id: number): void }) {
    this.el.className = "town-pings";
    // (first in the page, so the town's nameplate and the convoy tags draw over the rings, not under them)
    document.body.prepend(this.el);
  }

  /** Towns that should be marked now: sprung up, not yet delivered to, and recent. A few times a second. */
  sync(towns: readonly Town[], now: number, served: (t: Town) => boolean, hide: boolean) {
    const live = new Set<number>();
    if (!hide) for (const t of towns) {
      if (!t.spawned || now - t.founded > PING_FOR || served(t)) continue;
      live.add(t.id);
      if (this.pings.has(t.id)) continue;
      const ring = document.createElement("button");
      ring.type = "button";
      ring.className = "tp-ring";
      ring.innerHTML = `<i class="tp-pulse" aria-hidden="true"></i><i class="tp-pulse" aria-hidden="true"></i><i class="tp-dot" aria-hidden="true"></i><span class="tp-tag">New town</span>`;
      ring.title = `${t.name} has just sprung up. Open the town`;
      ring.setAttribute("aria-label", ring.title);
      ring.onclick = () => this.on.open(t.id);
      const edge = document.createElement("button");
      edge.type = "button";
      edge.className = "tp-edge";
      edge.innerHTML = `<i class="tp-arrow" aria-hidden="true"></i><span class="tp-k">New town</span><b></b><span class="tp-km"></span>`;
      edge.querySelector("b")!.textContent = t.name;
      edge.title = `Fly to ${t.name}`;
      edge.setAttribute("aria-label", edge.title);
      edge.onclick = () => { const p = this.pings.get(t.id); if (p) p.seen = true; this.on.fly(t.id); };
      this.el.append(ring, edge);
      this.pings.set(t.id, { t, ring, edge, seen: false });
    }
    for (const [id, p] of this.pings) if (!live.has(id)) { p.ring.remove(); p.edge.remove(); this.pings.delete(id); }
    this.walls = this.pings.size ? [...document.querySelectorAll(".corner > *, .banner:not([hidden])")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0) : [];
  }

  /** The towns flown to from elsewhere (the banner's "Fly there"): no pointer for them any more. */
  seen(id: number) {
    const p = this.pings.get(id);
    if (p) p.seen = true;
  }

  /** Where each marker goes this frame: the ring over the town, or the pointer at the edge toward it. */
  update(view: View) {
    const W = view.w, H = view.h;
    // (the pointer keeps inside the corners' panels and the bottom bar)
    const L = 24, R = W - 24, T = 84, B = H - 128;
    for (const p of this.pings.values()) {
      const s = view.worldToScreen(p.t.c.x, p.t.c.y);
      const onScreen = s.x > 0 && s.y > 0 && s.x < W && s.y < H;
      // close enough to see the town, not just its dot from the clouds
      if (onScreen && view.halfH < 6000) p.seen = true;
      p.ring.style.display = onScreen ? "" : "none";
      if (onScreen) p.ring.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -50%)`;
      const showEdge = !onScreen && !p.seen;
      p.edge.style.display = showEdge ? "" : "none";
      if (!showEdge) continue;
      // from the middle of the screen toward the town, stopped at the inset frame
      const cx = W / 2, cy = (T + B) / 2, dx = s.x - cx, dy = s.y - cy;
      const k = Math.min(dx > 0 ? (R - 110 - cx) / dx : dx < 0 ? (L + 110 - cx) / dx : Infinity, dy > 0 ? (B - cy) / dy : dy < 0 ? (T - cy) / dy : Infinity);
      // (slid in along the same line while it would sit under a panel: the Goals in the corner, an open town)
      const hw = 95, hh = 26;
      const under = (x: number, y: number) => this.walls.some((r) => x + hw > r.left && x - hw < r.right && y + hh > r.top && y - hh < r.bottom);
      let f = 1;
      while (f > 0.15 && under(cx + dx * k * f, cy + dy * k * f)) f -= 0.04;
      const x = cx + dx * k * f, y = cy + dy * k * f;
      p.edge.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) translate(-50%, -50%)`;
      (p.edge.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(dy, dx).toFixed(3)}rad)`;
      const c: V2 = { x: view.cx, y: view.cy };
      const km = Math.hypot(p.t.c.x - c.x, p.t.c.y - c.y) / 1000;
      const kmEl = p.edge.querySelector(".tp-km")!;
      const txt = `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
      if (kmEl.textContent !== txt) kmEl.textContent = txt;
    }
  }
}
