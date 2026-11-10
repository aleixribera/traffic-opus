// The first goal points at its ground (owner, 2026-11-10: "fertile soil is about 1 km off screen at the opening
// view and only a pointer says so"). A new company opens on its hamlet, zoomed in to see it, and the soil its first
// farm needs lies past the edge of the screen. Till a farm is placed the map says where: a large brass pointer held
// at the screen's edge, the way the soil lies with how far, and a click flies there; with the soil in view, a pin
// on the spot a farm can go, and a click on that puts the Farm in hand. It works at any turn and tilt of the camera:
// the way is read off the view's own projection of the ground, and the distance off the ground itself.

import type { V2 } from "../core/math";
import type { Game } from "../game/city";
import type { View } from "../render/view";
import { F } from "../world/gen";
import { productIcon } from "./icons";

/** How far out from the home town a place for the first farm is looked for (m), and the step of the search. */
export const SOIL_SEARCH = 4000, SOIL_STEP = 100;
/** A place with this share of its plot on soil is well on it; and how much further out (m) the search goes for one. */
export const GOOD_SOIL = 0.8, SOIL_ON = 300;

/** A place found for a works: a road in reach of its gate, none in reach, or the middle of a far patch (nowhere it fits). */
interface Spot { v: string; placed: number; found: "road" | "bare" | "far"; at: V2 | null }
const spots = new WeakMap<Game, Map<string, Spot>>();

/** The works the ground search knows: the ones that go on soil or forest, which lie everywhere in patches. */
export type GroundKind = "farm" | "loggingcamp";
const FIELD: Record<GroundKind, number> = { farm: F.fert, loggingcamp: F.forest };

/**
 * Where the first farm can go: the place nearest the home town where a farm fits well on fertile soil with a road
 * in reach of its gate (it lays its own street), else the nearest where it fits at all, else the middle of the
 * nearest patch of soil. Null once the company has a farm, or with no town. Kept till the roads or the buildings change.
 */
export function farmSpot(g: Game): V2 | null {
  if (g.buildings.list.some((b) => b.kind === "farm")) return null;
  return groundSpot(g, "farm");
}

/**
 * The same for any works on soil or forest (farmSpot): the place nearest the home town it fits well, a road in reach
 * of its gate. The "Nearest forest" pointer used to know only the big patches the map is generated with, and sent a
 * first logging camp 2.4 km over the river past a wood on the town's own bank (first-hour play-test, 2026-11-10).
 * Kept while it still takes the works (not the towns' houses or streets, which go up all the time).
 */
export function groundSpot(g: Game, kind: GroundKind): V2 | null {
  const home = g.towns.list[0];
  if (!home) return null;
  const field = FIELD[kind];
  const placed = g.buildings.list.reduce((n, b) => n + (b.placed ? 1 : 0), 0);
  const v = `${g.net.version}|${placed}`;
  const mine = spots.get(g) ?? new Map<string, Spot>();
  spots.set(g, mine);
  const had = mine.get(kind);
  if (had && had.v === v) return had.at;
  // (the towns lay streets all the time: a place found that still takes the works, a road in reach, stands; the
  // search, a tenth of a second or more, runs again only once it doesn't. A place with no road in reach stands while
  // it still takes the works, and the middle of a far patch (nowhere it fits) as it is, till the company places a
  // works: a search on every street the towns lay would cost frames)
  if (had?.at && (had.found === "road" || had.placed === placed)) {
    const pl = had.found === "far" ? null : g.terrain.has(field, had.at) ? g.placedPlan(kind, had.at) : null;
    const holds = had.found === "far" || (!!pl?.ok && (had.found === "bare" || !!(pl.access || pl.link)));
    if (holds) { had.v = v; had.placed = placed; return had.at; }
  } else if (had && !had.at && had.placed === placed) { had.v = v; return null; }
  // (ring by ring out from the town. The very first place a site fits is on the ground's ragged edge, where a step to
  // either side is refused: the search goes on a little for one well on it, and takes the best it has seen)
  let best: { c: V2; share: number; len: number; r: number } | null = null, bare: { c: V2; r: number } | null = null;
  for (let r = 200; r <= SOIL_SEARCH; r += SOIL_STEP) {
    // (the further out, the more places round the ring: about one every 100 m)
    const n = Math.max(16, Math.round((2 * Math.PI * r) / 100 / 4) * 4);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      const p = { x: home.c.x + Math.cos(a) * r, y: home.c.y + Math.sin(a) * r };
      if (!g.terrain.has(field, p)) continue;
      const pl = g.placedPlan(kind, p);
      if (!pl?.ok) continue;
      if (!pl.access && !pl.link) { bare ??= { c: pl.c, r }; continue; }
      const share = pl.deposit?.share ?? 1, len = pl.link?.length ?? 0;
      if (!best || share > best.share + 1e-9 || (Math.abs(share - best.share) <= 1e-9 && len < best.len)) best = { c: pl.c, share, len, r };
    }
    if (best && (best.share >= GOOD_SOIL || r >= best.r + SOIL_ON)) break;
    // (a place with no road in reach is taken only once the search is well past it: a road-side one may be next)
    if (!best && bare && r > bare.r + 600) break;
  }
  let at: V2 | null = best?.c ?? bare?.c ?? null;
  if (!at) {
    const d = g.terrain.gen.depositsNear(field, home.c.x, home.c.y, 24000)[0];
    at = d ? { x: d.x, y: d.y } : null;
  }
  mine.set(kind, { v, placed, found: best ? "road" : bare ? "bare" : "far", at });
  return at;
}

/** A frame on the screen (px) a pointer keeps inside. */
export interface Frame { l: number; t: number; r: number; b: number }

/**
 * Where a pointer of half-size (hw, hh) stands for a way (dx, dy) out from the middle of a frame: as far along the
 * way as it can go with its whole box inside the frame. The way may be any length; (0, 0) stays in the middle.
 */
export function edgeSpot(dx: number, dy: number, f: Frame, hw: number, hh: number): { x: number; y: number } {
  const cx = (f.l + f.r) / 2, cy = (f.t + f.b) / 2;
  const L = Math.hypot(dx, dy);
  if (L < 1e-9) return { x: cx, y: cy };
  const ux = dx / L, uy = dy / L;
  const rx = Math.max(0, (f.r - f.l) / 2 - hw), ry = Math.max(0, (f.b - f.t) / 2 - hh);
  const k = Math.min(ux !== 0 ? rx / Math.abs(ux) : Infinity, uy !== 0 ? ry / Math.abs(uy) : Infinity);
  return { x: cx + ux * k, y: cy + uy * k };
}

/** What of a view the pointer reads: its middle on the ground, and where a ground point falls on screen. */
export type ViewLike = Pick<View, "cx" | "cy" | "worldToScreen">;

/**
 * The way a ground point lies on screen from where the middle of the view falls (px, any length), at any turn and
 * tilt, and how far off it is over the ground (m): the distance a player has to go, not the squashed one a tilted
 * screen shows.
 */
export function screenWay(view: ViewLike, to: V2): { dx: number; dy: number; dist: number } {
  const a = view.worldToScreen(view.cx, view.cy), b = view.worldToScreen(to.x, to.y);
  return { dx: b.x - a.x, dy: b.y - a.y, dist: Math.hypot(to.x - view.cx, to.y - view.cy) };
}

/** Is a ground point on screen, inside a frame? */
export function inFrame(view: ViewLike, to: V2, f: Frame): boolean {
  const s = view.worldToScreen(to.x, to.y);
  return s.x > f.l && s.x < f.r && s.y > f.t && s.y < f.b;
}

/** The first goal's pointer and pin (see the top of the file). */
export class GoalPointer {
  readonly el = document.createElement("div");
  private edge = document.createElement("button");
  private pin = document.createElement("button");
  private at: V2 | null = null;
  private walls: DOMRect[] = [];
  /** the Farm is in hand: the ghost and the soil's colour say where it can go, so the pin steps back */
  private placing = false;
  /** the pointer is at the screen's edge now (the smaller "nearest soil" pointers keep quiet while it is) */
  pointing = false;
  /**
   * How far the place is, in words, as the goal's own line measures it ("1.2 km from Alder Run"; set by the app).
   * Never from the camera (review 2026-11-10, B10).
   */
  far: ((p: V2) => string) | null = null;
  private farAt = "";

  constructor(private act: { fly: (c: V2) => void; pick: () => void }) {
    this.el.className = "goal-ptr-layer";
    this.edge.type = this.pin.type = "button";
    this.edge.className = "goal-ptr";
    this.edge.innerHTML = `<i class="gp-arrow" aria-hidden="true"><s class="gp-ring"></s></i><b>Fertile soil</b><span class="gp-km"></span>`;
    this.edge.onclick = () => { if (this.at) this.act.fly(this.at); };
    this.pin.className = "goal-pin";
    this.pin.innerHTML = `<i aria-hidden="true"><s class="gp-ring"></s>${productIcon("crops")}</i><span><b>Fertile soil</b></span>`;
    this.pin.title = "Take the Farm in hand to place it here";
    this.pin.setAttribute("aria-label", "Fertile soil for your first farm. Take the Farm in hand");
    this.pin.onclick = () => this.act.pick();
    this.edge.style.display = this.pin.style.display = "none";
    this.el.append(this.pin, this.edge);
    document.body.prepend(this.el);
  }

  /** Point at a place (null: nothing to point at). `placing`: the Farm is in hand. A few times a second. */
  set(at: V2 | null, placing = false) {
    this.at = at;
    this.placing = placing;
    if (!at) { this.edge.style.display = this.pin.style.display = "none"; this.pointing = false; return; }
    const far = this.far?.(at) ?? "";
    if (far !== this.farAt) {
      this.farAt = far;
      this.edge.querySelector(".gp-km")!.textContent = far;
      this.edge.title = `Fertile soil for your first farm${far ? `, ${far}` : ""}. Fly there`;
      this.edge.setAttribute("aria-label", this.edge.title);
    }
    this.walls = [...document.querySelectorAll(".corner > *, .banner:not([hidden]), .bottom > .assets, .bottom > .toolopts")].map((e) => e.getBoundingClientRect()).filter((r) => r.width > 0 && r.height > 0);
  }

  /** Where the pointer or the pin goes this frame. */
  update(view: View) {
    const at = this.at;
    if (!at) return;
    const W = view.w, H = view.h;
    const frame: Frame = { l: 24, t: 84, r: W - 24, b: H - 128 };
    const seen = inFrame(view, at, { l: 40, t: 70, r: W - 40, b: H - 110 });
    this.pointing = !seen;
    this.edge.style.display = seen ? "none" : "";
    this.pin.style.display = seen && !this.placing ? "" : "none";
    if (seen) {
      const s = view.worldToScreen(at.x, at.y);
      this.pin.style.transform = `translate(${s.x.toFixed(1)}px, ${s.y.toFixed(1)}px) translate(-50%, -100%)`;
      return;
    }
    const way = screenWay(view, at);
    const hw = (this.edge.offsetWidth || 220) / 2 + 6, hh = (this.edge.offsetHeight || 56) / 2 + 6;
    const far = edgeSpot(way.dx, way.dy, frame, hw, hh);
    // (slid in along the same line while it would sit under a panel: the Goals in the corner, the catalog)
    const cx = (frame.l + frame.r) / 2, cy = (frame.t + frame.b) / 2;
    const under = (x: number, y: number) => this.walls.some((r) => x + hw > r.left && x - hw < r.right && y + hh > r.top && y - hh < r.bottom);
    let f = 1;
    while (f > 0.2 && under(cx + (far.x - cx) * f, cy + (far.y - cy) * f)) f -= 0.04;
    this.edge.style.transform = `translate(${(cx + (far.x - cx) * f).toFixed(1)}px, ${(cy + (far.y - cy) * f).toFixed(1)}px) translate(-50%, -50%)`;
    (this.edge.firstElementChild as HTMLElement).style.transform = `rotate(${Math.atan2(way.dy, way.dx).toFixed(3)}rad)`;
  }
}
