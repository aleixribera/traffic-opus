// Scenery clearing: the map's wild trees and shrubs stand in hashed cells that know nothing of what's built
// (render/forest.ts). This keeps them off the roads, their pavements and verges, junctions, company sites (their yard
// roads, buildings and pads, and the fence line) and buildings' plots: everything built is a shape with a margin, and
// a tree whose crown would reach one does not stand. Being worked out from what is built each time, it holds for
// roads built before or after the trees, and a road taken away gives its trees back.

import { ROAD_TYPES, SIDEWALK, roadGroup } from "../config";
import { dist, pointSegDist2, polygonContains, rectCorners, type V2 } from "../core/math";
import type { Building } from "../game/buildings";
import { siteFrame, siteLayout, siteToWorld, slotHalf, GATE_GAP } from "../game/sites";
import { GATE_LINK_OUT } from "../game/city";
import type { PlantKind } from "../game/industry";
import type { RoadNetwork } from "../roads/network";

/** Grass left between a pavement (or a road with none) and the nearest crown. */
export const VERGE = 1;
/** The widest crown there is (its radius, m): nothing farther than this from built ground is ever cleared. */
export const CLEAR_RANGE = 4.5;

/** Built ground to keep scenery off: a polyline (a road's centre) or a polygon, and how far round it to clear. */
export type ClearShape = { line: V2[]; hard: number } | { poly: V2[]; hard: number };

/** Everything that keeps trees off: roads with their pavements and verges, junctions, sites and buildings. */
export function clearShapes(net: RoadNetwork, buildings: readonly Building[]): ClearShape[] {
  const out: ClearShape[] = [];
  for (const [id, s] of net.segs) {
    const g = net.segGeom.get(id);
    if (!g) continue;
    const walk = s.ring ? 0 : SIDEWALK[roadGroup(ROAD_TYPES[s.type])] ?? 0;
    out.push({ line: g.center.pts, hard: g.width / 2 + walk + VERGE });
  }
  for (const [id, ng] of net.nodeGeom) {
    const at = net.segsAt(id);
    const walk = at.length && !at.some((x) => x.ring) ? Math.max(...at.map((x) => SIDEWALK[roadGroup(ROAD_TYPES[x.type])] ?? 0)) : 0;
    if (ng.poly && ng.poly.length >= 3) out.push({ poly: ng.poly, hard: walk + VERGE });
    if (ng.curve) out.push({ line: ng.curve.pts, hard: ng.curve.halfW + walk + VERGE });
  }
  for (const b of buildings) {
    if (b.placed && b.plant) {
      // a company site: its yard roads (and the apron out of its gate), its buildings and the pads of those to
      // come, and a strip along its fence so the fence reads as one
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      const W = (x: number, y: number) => siteToWorld(f, x, y);
      const L = siteLayout(b.kind as PlantKind, b.hw * 2, b.hd * 2, b.id);
      L.roads.forEach((r, i) => {
        const a = i === 0 ? { x: r.a.x, y: Math.min(r.a.y, -GATE_LINK_OUT) } : r.a;
        out.push({ line: [W(a.x, a.y), W(r.b.x, r.b.y)], hard: r.w / 2 + VERGE });
      });
      for (const s of L.slots) {
        const { hx, hy } = slotHalf(s);
        out.push({ poly: [W(s.x - hx, s.y - hy), W(s.x + hx, s.y - hy), W(s.x + hx, s.y + hy), W(s.x - hx, s.y + hy)], hard: VERGE + 0.5 });
      }
      const hw = b.hw, d = b.hd * 2, gg = GATE_GAP / 2;
      for (const [x0, y0, x1, y1] of [[-gg, 0, -hw, 0], [-hw, 0, -hw, d], [-hw, d, hw, d], [hw, d, hw, 0], [hw, 0, gg, 0]]) {
        out.push({ line: [W(x0, y0), W(x1, y1)], hard: 0.6 });
      }
      continue;
    }
    out.push({ poly: rectCorners(b.c, b.hw, b.hd, b.rot), hard: 0.5 });
  }
  return out;
}

/** How far past a shape's cleared ground a point is (negative inside it). */
export function clearDist(sh: ClearShape, p: V2): number {
  if ("line" in sh) {
    const pts = sh.line;
    let best = Infinity;
    if (pts.length === 1) best = dist(pts[0], p);
    for (let i = 0; i < pts.length - 1; i++) best = Math.min(best, Math.sqrt(pointSegDist2(p, pts[i], pts[i + 1]).d2));
    return best - sh.hard;
  }
  const pts = sh.poly;
  if (polygonContains(pts, p)) return -sh.hard;
  let best = Infinity;
  for (let i = 0; i < pts.length; i++) best = Math.min(best, Math.sqrt(pointSegDist2(p, pts[i], pts[(i + 1) % pts.length]).d2));
  return best - sh.hard;
}

/** Would a crown of radius r centred at p be dropped (it reaches cleared ground)? (forest.ts asks the same through a grid.) */
export function crownCleared(shapes: readonly ClearShape[], p: V2, r: number): boolean {
  return shapes.some((sh) => clearDist(sh, p) < r);
}
