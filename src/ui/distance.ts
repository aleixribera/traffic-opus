// Every distance the map says is measured from somewhere on the map, never from the camera (review 2026-11-10, B10:
// the new town's pointer read "0.8 km", from wherever the view happened to be, while its tip read "1.9 km
// south-west of Alder Run"). A place is so far from the nearest town or the nearest road, whichever is nearer,
// and the words say which: "1.9 km from Alder Run", "3.4 km from a road". Pure over the game.

import type { V2 } from "../core/math";
import type { Game } from "../game/city";
import type { Town } from "../game/settlements";
import { cubicClosest, type Plan } from "../roads/planner";

/** How long a planned road is (m), along its curves' chords. */
export const planLength = (p: Plan): number => p.strokes.reduce((a, st) => a + st.chain.reduce((x, c) => x + Math.hypot(c.p3.x - c.p0.x, c.p3.y - c.p0.y), 0), 0);

/** A distance in words: "350 m", "1.9 km", "12 km". */
export const distText = (m: number): string => (m < 950 ? `${Math.max(50, Math.round(m / 50) * 50)} m` : m < 9950 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 1000)} km`);

/** How far the nearest road is from a place (m), and the point on it; null with no roads at all. */
export function nearestRoad(g: Game, p: V2): { m: number; at: V2 } | null {
  const net = g.net;
  if (!net.segs.size) return null;
  let best: { m: number; at: V2 } | null = null;
  // (looking ever further out: a window round the place first, the whole map last)
  for (const r of [400, 1600, 6400, Infinity]) {
    const ids = Number.isFinite(r) ? net.segsNear(p.x - r, p.y - r, p.x + r, p.y + r) : new Set(net.segs.keys());
    for (const id of ids) {
      const s = net.segs.get(id);
      if (!s) continue;
      const c = cubicClosest(s.c, p);
      if (!best || c.d < best.m) best = { m: c.d, at: c.p };
    }
    if (best && best.m <= r) return best;
  }
  return best;
}

/** The town nearest a place, leaving out one (a new town is measured from another). */
export function nearestTown(g: Game, p: V2, not?: number): { t: Town; m: number } | null {
  let best: { t: Town; m: number } | null = null;
  for (const t of g.towns.list) {
    if (t.id === not) continue;
    const m = Math.hypot(t.c.x - p.x, t.c.y - p.y);
    if (!best || m < best.m) best = { t, m };
  }
  return best;
}

/**
 * How far a place is from the map the company has: the nearest town or road, whichever is nearer (`not`: a town
 * that does not count, the one being measured). Null on an empty map.
 */
export function distFrom(g: Game, p: V2, not?: number): { m: number; from: string } | null {
  const t = nearestTown(g, p, not), r = nearestRoad(g, p);
  if (r && (!t || r.m < t.m)) return { m: r.m, from: "a road" };
  return t ? { m: t.m, from: t.t.name } : null;
}

/** "1.9 km from Alder Run", or "" on an empty map. */
export function distFromText(g: Game, p: V2, not?: number): string {
  const d = distFrom(g, p, not);
  return d ? `${distText(d.m)} from ${d.from}` : "";
}
