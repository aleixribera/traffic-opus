// Town streets and country roads (owner, 2026-11-09: "feel real"): a road out in the fields has no kerbs, pavements,
// street lamps or street trees, only a gravel shoulder and a grass verge; a town's streets keep all of them. Which is
// which is worked out from the map (nothing is saved), along each road: it is a town street where it runs through a
// town's built-up land, where a town laid it on its own land, and in front of the homes, shops and town halls that
// face it. A company's own works on a road never make it a street. So the road a hamlet starts on keeps its kerbs and
// pavements past the last house, then runs on out into the country without them.

import { dist, polyAt, type Polyline, type V2 } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { BLOCK, isHall } from "./towns";
import { isCivic } from "./civics";
import type { BuildingKind } from "../config";

/** A town's built-up land: its centre and how far its land reaches (m). */
export interface TownLand { id: number; c: V2; reach: number }
/** What the look needs of a building: the road it faces and where along it, and whether it's a town's (zoned, a hall). */
export interface Frontage { access: { seg: number; s: number } | null; zone?: unknown; kind: BuildingKind; hw: number }
/** The stretches of a road that are town street, as [from, to] in metres along its centreline (none: all country). */
export type TownRuns = [number, number][];

/** How often a road is looked at along its length (m). */
const STEP = 6;
/** A town's own street stays one this far past the edge of its land (its last streets end on the edge). */
const OWN_MARGIN = BLOCK / 2;
/** The pavement runs on this far past the last house's front either side (m). */
const PAST_FRONT = 6;
/** Two town stretches of a road closer than this become one (m); one this near an end runs on to it. */
const GAP = 30, SNAP = 20;

/** Is p on a town's land (with `pad` metres more)? */
const onLand = (p: V2, t: TownLand, pad = 0) => dist(p, t.c) <= t.reach + pad;

/**
 * The town stretches of a road from what lies along it: points STEP apart along its centreline (`town(s)`: is the
 * road a town street at s), joined where they nearly meet and carried on to an end they nearly reach.
 */
export function townRuns(len: number, town: (s: number) => boolean, extra: readonly [number, number][] = []): TownRuns {
  const n = Math.max(2, Math.ceil(len / STEP) + 1);
  const raw: [number, number][] = [];
  for (let i = 0; i < n; i++) {
    const s = (len * i) / (n - 1);
    if (!town(s)) continue;
    const last = raw[raw.length - 1];
    const half = len / (n - 1) / 2;
    if (last && last[1] >= s - half - 1e-6) last[1] = Math.min(len, s + half);
    else raw.push([Math.max(0, s - half), Math.min(len, s + half)]);
  }
  for (const [a, b] of extra) if (b > 0 && a < len) raw.push([Math.max(0, a), Math.min(len, b)]);
  raw.sort((x, y) => x[0] - y[0]);
  const out: TownRuns = [];
  for (const r of raw) {
    const last = out[out.length - 1];
    if (last && r[0] - last[1] < GAP) last[1] = Math.max(last[1], r[1]);
    else out.push([r[0], r[1]]);
  }
  if (out.length) {
    if (out[0][0] < SNAP) out[0][0] = 0;
    if (len - out[out.length - 1][1] < SNAP) out[out.length - 1][1] = len;
  }
  return out;
}

/** Is a road a town street at s along it? */
export const townAt = (runs: TownRuns | undefined, s: number) => !!runs && runs.some(([a, b]) => s >= a - 1e-6 && s <= b + 1e-6);

/**
 * The town stretches of every road that has any (a road missing from the map is a country road all along). Cheap:
 * buildings are indexed once by the road they face, and only the roads near a town or with houses on them are looked at.
 */
export function townStreets(net: RoadNetwork, towns: readonly TownLand[], buildings: readonly Frontage[]): Map<number, TownRuns> {
  // homes, shops, halls and civic buildings along a road: the stretch each one's front takes up
  const fronts = new Map<number, [number, number][]>();
  for (const b of buildings) {
    if (!b.access || !(b.zone || isHall(b.kind) || isCivic(b.kind))) continue;
    let L = fronts.get(b.access.seg);
    if (!L) fronts.set(b.access.seg, (L = []));
    L.push([b.access.s - b.hw - PAST_FRONT, b.access.s + b.hw + PAST_FRONT]);
  }
  const look = new Set(fronts.keys());
  for (const t of towns) {
    const R = t.reach + OWN_MARGIN;
    for (const id of net.segsNear(t.c.x - R, t.c.y - R, t.c.x + R, t.c.y + R)) look.add(id);
  }
  const byId = new Map(towns.map((t) => [t.id, t]));
  const out = new Map<number, TownRuns>();
  const p: V2 = { x: 0, y: 0 };
  for (const id of look) {
    const s = net.segs.get(id), g = net.segGeom.get(id);
    if (!s || !g) continue;
    const pl: Polyline = g.center;
    const own = s.town !== undefined ? byId.get(s.town) : undefined;
    // (only the towns whose land the road's bounds come near)
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const q of pl.pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
    const near = towns.filter((t) => Math.hypot(Math.max(x0 - t.c.x, 0, t.c.x - x1), Math.max(y0 - t.c.y, 0, t.c.y - y1)) <= t.reach + OWN_MARGIN);
    // (most of a town's streets lie wholly on its land: a street end to end, nothing to sample)
    const inside = (t: TownLand, pad: number) => {
      const fx = Math.max(Math.abs(x0 - t.c.x), Math.abs(x1 - t.c.x)), fy = Math.max(Math.abs(y0 - t.c.y), Math.abs(y1 - t.c.y));
      return Math.hypot(fx, fy) <= t.reach + pad;
    };
    if ((own && inside(own, OWN_MARGIN)) || near.some((t) => inside(t, 0))) { out.set(id, [[0, pl.length]]); continue; }
    const runs = townRuns(pl.length, (sc) => {
      if (!near.length) return false;
      polyAt(pl, sc, p);
      return (!!own && onLand(p, own, OWN_MARGIN)) || near.some((t) => onLand(p, t));
    }, fronts.get(id));
    if (runs.length) out.set(id, runs);
  }
  return out;
}

/** Do two roads' town stretches differ (to the metre)? */
export function runsDiffer(a: TownRuns | undefined, b: TownRuns | undefined): boolean {
  if (!a || !b) return !a !== !b;
  if (a.length !== b.length) return true;
  return a.some((r, i) => Math.abs(r[0] - b[i][0]) > 0.5 || Math.abs(r[1] - b[i][1]) > 0.5);
}
