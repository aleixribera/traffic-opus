// What the inspect tool's click lands on. Moving vehicles are picked forgivingly: the nearest body within a few
// screen pixels, measured to the whole length of it (a road train is 22 m), not just its centre.

import type { V2 } from "../core/math";
import type { Vehicle } from "../sim/traffic";
import type { Game } from "../game/city";
import { segAt } from "../roads/planner";
import { isHall } from "../game/towns";
import { isCivic } from "../game/civics";
import type { Sel } from "./inspect";

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
 * The vehicle whose body passes nearest p, within r (m). The body runs from a little ahead of its pose back along
 * its heading by its length; an articulated one is measured to each of its pieces as drawn.
 */
export function vehicleAt(vs: readonly Vehicle[], p: V2, r: number, alpha = 1): Vehicle | null {
  let best: Vehicle | null = null, bd = r;
  for (const v of vs) {
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

/** The search radius for a click, in metres: a few pixels on screen, never less than a car's half-width. */
export const pickRadius = (mpp: number, px = 9) => Math.max(1.5, px * mpp);

/** The junction (three or more arms) nearest p, within its own radius or ~14 px, whichever is bigger. */
export function junctionAt(g: Game, p: V2, mpp: number): number | null {
  let best: number | null = null, bd = 14 * Math.max(1, mpp * 0.8);
  for (const n of g.net.nodesNear(p, 30)) {
    const ng = g.net.nodeGeom.get(n.id);
    if (!ng || ng.kind !== "junction" || ng.arms.length < 3) continue;
    const d = Math.hypot(n.p.x - p.x, n.p.y - p.y);
    if (d < Math.max(bd, ng.radius)) { bd = d; best = n.id; }
  }
  return best;
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
 * What the inspect tool selects at p (docs/ui-style.md "Inspector"): a vehicle first (they move, so they get the
 * forgiving pick; not when zoomed out past where they are drawn), then a bus stop, a building (a town hall selects its
 * town), a junction, and last a road.
 */
export function pickAt(g: Game, p: V2, mpp: number, vehicles = true): Sel | null {
  if (vehicles) {
    const v = vehicleAt(g.traffic.vehicles, p, pickRadius(mpp), g.alpha);
    if (v) return { k: "vehicle", id: v.id };
  }
  const sid = stopNear(g, p, 6);
  if (sid !== null) return { k: "stop", id: sid };
  const b = g.buildings.at(p);
  if (b) return (isHall(b.kind) || isCivic(b.kind)) && b.town !== undefined ? { k: "town", id: b.town } : { k: "building", id: b.id };
  const n = junctionAt(g, p, mpp);
  if (n !== null) return { k: "node", id: n };
  const seg = segAt(g.net, p, Math.max(2, 6 * mpp), null);
  return seg !== null ? { k: "seg", id: seg } : null;
}
