// What a click lands on. The view is tilted, so a click is a line of sight (render/viewmath.ts GroundRay), not a
// ground point: it selects what the player sees there. A building is hit on its walls and roof (its box, as tall as
// its model), a raised road on its deck, a vehicle at its own height, and whatever stands in front hides what is
// behind it. Seen from straight above all of this comes down to the ground point under the click.
//
// Moving vehicles are picked forgivingly: the nearest body within a few screen pixels, measured to the whole length
// of it (a road train is 22 m), not just its centre.

import type { V2 } from "../core/math";
import type { Vehicle } from "../sim/traffic";
import type { Game } from "../game/city";
import type { Building } from "../game/buildings";
import type { RoadNetwork } from "../roads/network";
import { LEVEL_H, MAX_LEVEL } from "../config";
import { cubicClosest } from "../roads/planner";
import { isHall } from "../game/towns";
import { isCivic } from "../game/civics";
import { rayAt, type GroundRay } from "../render/viewmath";
import type { Sel } from "./inspect";

/** The line of sight straight down onto a ground point (the Map view's; tests). */
export const straightDown = (p: V2): GroundRay => ({ x: p.x, y: p.y, kx: 0, ky: 0 });

/**
 * A box a building's model fills, for picking: centred at (x, y) on the ground, one side along (ux, uy), half sizes
 * hx along it and hz across, `tall` high (render/buildings3d.ts makes them from the models).
 */
export interface Solid { x: number; y: number; ux: number; uy: number; hx: number; hz: number; tall: number }
export type SolidsOf = (b: Building) => readonly Solid[] | undefined;

/** How high up a line of sight first meets a box (where it enters, coming down from the camera), or -1 if it misses. */
export function rayBox(r: GroundRay, s: Solid): number {
  if (!(s.tall > 0 && s.hx > 0 && s.hz > 0)) return -1;
  const dx = r.x - s.x, dy = r.y - s.y;
  let lo = 0, hi = s.tall;
  for (let i = 0; i < 2; i++) {
    // the ray along one of the box's two ground axes: a0 + k·h, to stay within ±half
    const ax = i ? -s.uy : s.ux, ay = i ? s.ux : s.uy, half = i ? s.hz : s.hx;
    const a0 = dx * ax + dy * ay, k = r.kx * ax + r.ky * ay;
    if (Math.abs(k) < 1e-9) { if (Math.abs(a0) > half) return -1; continue; }
    const h0 = (-half - a0) / k, h1 = (half - a0) / k;
    lo = Math.max(lo, Math.min(h0, h1));
    hi = Math.min(hi, Math.max(h0, h1));
    if (lo > hi) return -1;
  }
  return hi;
}

/** Distance from p to the segment a-b. */
export function segDist(p: V2, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay;
  const L2 = dx * dx + dy * dy;
  const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - ax) * dx + (p.y - ay) * dy) / L2)) : 0;
  return Math.hypot(p.x - (ax + dx * t), p.y - (ay + dy * t));
}

/** Where a vehicle is drawn now, between its last two sim steps: its front and heading. */
export function poseOf(v: Vehicle, alpha: number): { x: number; y: number; ang: number } {
  return poseInto(v, alpha, { x: 0, y: 0, ang: 0 });
}

/** poseOf into a point the caller keeps (no allocation: called every frame). */
export function poseInto<T extends { x: number; y: number; ang: number }>(v: Vehicle, alpha: number, out: T): T {
  let da = v.ang - v.pang;
  if (da > Math.PI) da -= Math.PI * 2;
  if (da < -Math.PI) da += Math.PI * 2;
  out.x = v.px + (v.x - v.px) * alpha;
  out.y = v.py + (v.y - v.py) * alpha;
  out.ang = v.pang + da * alpha;
  return out;
}

/**
 * The vehicle whose body passes nearest a line of sight, within r (m): each is measured where the line passes its
 * own height (a truck on a bridge is picked on the bridge). The body runs from a little ahead of its pose back along
 * its heading by its length; an articulated one is measured to each of its pieces as drawn. Vehicles lower than
 * `above` (m) are hidden behind what the line hits first, and are left out.
 */
export function vehicleOn(vs: readonly Vehicle[], ray: GroundRay, r: number, alpha = 1, above = -Infinity): Vehicle | null {
  let best: Vehicle | null = null, bd = r;
  const p = { x: 0, y: 0 };
  for (const v of vs) {
    // (measured about a metre up its body)
    const h = v.ph + (v.h - v.ph) * alpha;
    if (h < above) continue;
    p.x = ray.x + ray.kx * (h + 1);
    p.y = ray.y + ray.ky * (h + 1);
    // (cheap reject: too far from its front for any body to reach)
    if (Math.abs(v.x - p.x) > r + v.len + 4 || Math.abs(v.y - p.y) > r + v.len + 4) continue;
    let d: number;
    const U = v.uPose, P = v.puPose ?? U;
    if (U && P && v.units && v.units.length * 4 === U.length) {
      d = Infinity;
      for (let i = 0; i < v.units.length; i++) {
        const o = i * 4, k = v.units[i].len / 2;
        const x = P[o] + (U[o] - P[o]) * alpha, y = P[o + 1] + (U[o + 1] - P[o + 1]) * alpha, a = U[o + 3];
        const c = Math.cos(a) * k, s = Math.sin(a) * k;
        d = Math.min(d, segDist(p, x + c, y + s, x - c, y - s) - 1.2);
      }
    } else {
      const q = poseOf(v, alpha), c = Math.cos(q.ang), s = Math.sin(q.ang);
      d = segDist(p, q.x + c * v.len * 0.5, q.y + s * v.len * 0.5, q.x - c * v.len, q.y - s * v.len) - 1.2;
    }
    if (d < bd) { bd = d; best = v; }
  }
  return best;
}

/** The vehicle whose body passes nearest the ground point p, within r (m): vehicleOn, seen from straight above. */
export function vehicleAt(vs: readonly Vehicle[], p: V2, r: number, alpha = 1): Vehicle | null {
  return vehicleOn(vs, straightDown(p), r, alpha);
}

/** The search radius for a click, in metres: a few pixels on screen, never less than a car's half-width. */
export const pickRadius = (mpp: number, px = 9) => Math.max(1.5, px * mpp);

/** As high as a road gets (m), with room to spare: how far up a line of sight is searched for decks and junctions. */
const DECK_TOP = (MAX_LEVEL + 1) * LEVEL_H;

/** The roads whose box a line of sight passes over, below DECK_TOP (and `pad` metres round it). */
function segsUnder(net: RoadNetwork, ray: GroundRay, pad: number): Set<number> {
  const top = rayAt(ray, DECK_TOP), R = 30 + pad;
  return net.segsNear(Math.min(ray.x, top.x) - R, Math.min(ray.y, top.y) - R, Math.max(ray.x, top.x) + R, Math.max(ray.y, top.y) + R);
}

/** Where a line of sight passes a road's own height (a ramp's changes along it: a few rounds settle it). */
function onSeg(net: RoadNetwork, id: number, ray: GroundRay): { h: number; p: V2; d: number; t: number } | null {
  const s = net.segs.get(id);
  if (!s) return null;
  const ha = net.nodes.get(s.a)!.h, hb = net.nodes.get(s.b)!.h;
  let h = (ha + hb) / 2, p = rayAt(ray, h), r = cubicClosest(s.c, p);
  const flat = ray.kx === 0 && ray.ky === 0;
  for (let i = 0; i < 4; i++) {
    const h1 = net.heightOnSeg(id, r.t);
    const done = flat || Math.abs(h1 - h) < 0.01;
    h = h1;
    if (done) break;
    p = rayAt(ray, h);
    r = cubicClosest(s.c, p);
  }
  return { h, p, d: r.d, t: r.t };
}

/**
 * The road a line of sight lands on, within `pad` metres of its edge: each road is tried where the line passes its
 * own height, so a bridge is picked on its deck and not on the ground behind it. Of the roads the line passes
 * through, the highest (it is drawn over the others); failing those, the nearest. `level`: only roads on that level.
 * Returns the road, the height it was hit at and the point there.
 */
export function deckOn(net: RoadNetwork, ray: GroundRay, pad: number, level: number | null = null): { id: number; h: number; p: V2 } | null {
  let best: { id: number; h: number; p: V2 } | null = null, bs = Infinity;
  for (const id of segsUnder(net, ray, pad)) {
    const g = net.segGeom.get(id), o = g ? onSeg(net, id, ray) : null;
    if (!g || !o) continue;
    if (level !== null && Math.abs(o.h - level * LEVEL_H) > 1) continue;
    const d = o.d - g.width / 2;
    if (d >= pad) continue;
    const score = d <= 0 ? -1000 - o.h : d - o.h * 0.01;
    if (score < bs) { bs = score; best = { id, h: o.h, p: o.p }; }
  }
  return best;
}

/**
 * The heights (m, highest first) of the roads and junctions a line of sight passes within `pad` metres of: the
 * planes the road tool tries its snapping on, so pointing at a bridge's end snaps to it up there.
 */
export function heightsOn(net: RoadNetwork, ray: GroundRay, pad: number): number[] {
  const out: number[] = [];
  const add = (h: number) => { if (!out.some((o) => Math.abs(o - h) < 0.4)) out.push(h); };
  const seen = new Set<number>();
  for (const id of segsUnder(net, ray, pad)) {
    const g = net.segGeom.get(id), s = net.segs.get(id);
    if (!g || !s) continue;
    for (const nid of [s.a, s.b]) {
      if (seen.has(nid)) continue;
      seen.add(nid);
      const n = net.nodes.get(nid)!;
      if (Math.hypot(n.p.x - (ray.x + ray.kx * n.h), n.p.y - (ray.y + ray.ky * n.h)) < pad + 6) add(n.h);
    }
    const o = onSeg(net, id, ray);
    if (o && o.d < g.width / 2 + pad) add(o.h);
  }
  return out.sort((a, b) => b - a);
}

/**
 * The junction (three or more arms) nearest a line of sight, within its own radius or ~14 px, whichever is bigger;
 * each is measured where the line passes its height.
 */
export function junctionOn(g: Game, ray: GroundRay, mpp: number): number | null {
  let best: number | null = null, bd = 14 * Math.max(1, mpp * 0.8);
  const mid = rayAt(ray, DECK_TOP / 2);
  for (const n of g.net.nodesNear(mid, 30 + Math.hypot(ray.kx, ray.ky) * (DECK_TOP / 2))) {
    const ng = g.net.nodeGeom.get(n.id);
    if (!ng || ng.kind !== "junction" || ng.arms.length < 3) continue;
    const d = Math.hypot(n.p.x - (ray.x + ray.kx * n.h), n.p.y - (ray.y + ray.ky * n.h));
    if (d < Math.max(bd, ng.radius)) { bd = d; best = n.id; }
  }
  return best;
}

/** The junction nearest the ground point p: junctionOn, seen from straight above. */
export function junctionAt(g: Game, p: V2, mpp: number): number | null {
  return junctionOn(g, straightDown(p), mpp);
}

/** The bus stop nearest p, within r (m). */
export function stopNear(g: Game, p: V2, r: number): number | null {
  let best: number | null = null, bd = r;
  for (const st of g.transit.stops.values()) {
    const d = Math.hypot(st.p.x - p.x, st.p.y - p.y);
    if (d < bd) { bd = d; best = st.id; }
  }
  return best;
}

/**
 * The building a line of sight hits: the one whose walls or roof it meets first (highest up), with the height it
 * meets it at; failing any, the one whose lot the line reaches the ground on (h 0). Without `solids` (no models: the
 * tests; seen from straight above none are needed) only the lot.
 */
export function buildingOn(g: Game, ray: GroundRay, solids?: SolidsOf): { b: Building; h: number } | null {
  let best: Building | null = null, bh = -1;
  const reach = Math.hypot(ray.kx, ray.ky);
  if (solids && reach > 0) {
    for (const b of g.buildings.list) {
      // (cheap reject: the line never comes over its lot below 120 m)
      const r = Math.hypot(b.hw, b.hd) + reach * 120;
      if (Math.abs(b.c.x - ray.x) > r || Math.abs(b.c.y - ray.y) > r) continue;
      for (const s of solids(b) ?? []) {
        const h = rayBox(ray, s);
        if (h > bh) { bh = h; best = b; }
      }
    }
  }
  if (best) return { b: best, h: bh };
  const lot = g.buildings.at(ray);
  return lot ? { b: lot, h: 0 } : null;
}

/**
 * What the inspect tool selects along a line of sight (docs/ui-style.md "Inspector"): a vehicle first (they move, so
 * they get the forgiving pick; not when zoomed out past where they are drawn), then a bus stop, a building (a town
 * hall selects its town), a junction, and last a road. What stands in front wins: a building's wall hides the road
 * behind it, a bridge's deck the cars and the ground under it.
 */
export function pickOn(g: Game, ray: GroundRay, mpp: number, vehicles = true, solids?: SolidsOf): Sel | null {
  const hit = buildingOn(g, ray, solids);
  const deck = deckOn(g.net, ray, Math.max(2, 6 * mpp), null);
  // the height of whatever solid thing the line meets first (a lot's ground and a road at grade hide nothing)
  const front = Math.max(hit?.h ?? 0, deck?.h ?? 0);
  if (vehicles) {
    const v = vehicleOn(g.traffic.vehicles, ray, pickRadius(mpp), g.alpha, front - 4);
    if (v) return { k: "vehicle", id: v.id };
  }
  if (front < 4) {
    const sid = stopNear(g, ray, 6);
    if (sid !== null) return { k: "stop", id: sid };
  }
  // a building, unless a raised deck passes in front of it
  if (hit && hit.h >= (deck && deck.h > 1.5 ? deck.h - 0.5 : 0)) {
    const b = hit.b;
    return (isHall(b.kind) || isCivic(b.kind)) && b.town !== undefined ? { k: "town", id: b.town } : { k: "building", id: b.id };
  }
  const n = junctionOn(g, ray, mpp);
  if (n !== null && g.net.nodes.get(n)!.h >= front - 1.5) return { k: "node", id: n };
  return deck ? { k: "seg", id: deck.id } : null;
}

/** What the inspect tool selects at the ground point p: pickOn, seen from straight above. */
export function pickAt(g: Game, p: V2, mpp: number, vehicles = true): Sel | null {
  return pickOn(g, straightDown(p), mpp, vehicles);
}
