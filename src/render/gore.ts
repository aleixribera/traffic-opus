// Gore islands: where two town roads part at a shallow angle, each one's pavement runs on over the other's for a
// while, and each one's darker outer rim shows as a line drawn across the other's paving. The island is the ground
// between the two roads' edges from the nose of the junction out to where the two pavements part, paved over in one
// piece, so the rims meet in a clean V where the pavements part and the nose reads as one paved point.

import { ROAD_TYPES, SIDEWALK, roadGroup } from "../config";
import { add, polyAt, polyDirSmooth, right, scale, segIntersect, type V2 } from "../core/math";
import type { Arm, RoadNetwork } from "../roads/network";

/** How far out along the roads the islands are looked for (a fork any shallower than this is parallel roads). */
const REACH = 90;
/** The island's sides run this far in under each road's surface, so no sliver of rim shows along its edge. */
const TUCK = 0.3;

/** The paved islands at a town junction's gores (none where the roads part wide enough for their pavements to). */
export function goreIslands(net: RoadNetwork, nid: number): V2[][] {
  const n = net.nodes.get(nid), ng = net.nodeGeom.get(nid);
  if (!n || !ng || ng.kind !== "junction" || n.h >= 0.3 || ng.arms.length < 2 || ng.kerbs.length !== ng.arms.length) return [];
  const out: V2[][] = [];
  for (let i = 0; i < ng.arms.length; i++) {
    const A = ng.arms[i], B = ng.arms[(i + 1) % ng.arms.length], k = ng.kerbs[i];
    if (k.length < 2) continue;
    // the kerb runs from A's right-hand edge (looking out along A) round to B's left-hand edge
    const ea = sideLines(net, A, 1), eb = sideLines(net, B, -1);
    if (!ea || !eb) continue;
    const hit = firstCrossing(ea.outer, eb.outer);
    if (!hit) continue;
    out.push([...k, ...eb.edge.slice(1, hit.ib + 1), hit.p, ...ea.edge.slice(1, hit.ia + 1).reverse()]);
  }
  return out;
}

/** One side of an arm's road, sampled every metre outward from the mouth: its edge (tucked in) and pavement's outer line. */
function sideLines(net: RoadNetwork, arm: Arm, side: 1 | -1): { edge: V2[]; outer: V2[] } | null {
  const s = net.segs.get(arm.seg), g = net.segGeom.get(arm.seg);
  if (!s || !g || s.ring) return null;
  const walk = SIDEWALK[roadGroup(ROAD_TYPES[s.type])];
  if (!(walk > 0)) return null;
  const L = g.center.length, out = arm.end === "a" ? 1 : -1;
  const s0 = arm.end === "a" ? g.trimA : L - g.trimB;
  const room = Math.min(REACH, arm.end === "a" ? L - s0 : s0);
  const halfW = g.width / 2;
  const edge: V2[] = [], outer: V2[] = [];
  for (let t = 0; t <= room; t += 1) {
    const sc = s0 + out * t, p = polyAt(g.center, sc);
    const rt = right(scale(polyDirSmooth(g.center, sc, 0.75), out));
    edge.push(add(p, scale(rt, side * (halfW - TUCK))));
    outer.push(add(p, scale(rt, side * (halfW + walk))));
  }
  return edge.length >= 2 ? { edge, outer } : null;
}

/** Where two polylines first cross (nearest their starts), with the index of the piece each crosses in. */
function firstCrossing(a: V2[], b: V2[]): { p: V2; ia: number; ib: number } | null {
  let best: { p: V2; ia: number; ib: number; k: number } | null = null;
  for (let i = 0; i < a.length - 1; i++) {
    for (let j = 0; j < b.length - 1; j++) {
      const r = segIntersect(a[i], a[i + 1], b[j], b[j + 1]);
      if (!r) continue;
      const k = i + r.t + j + r.u;
      if (!best || k < best.k) best = { p: { x: a[i].x + (a[i + 1].x - a[i].x) * r.t, y: a[i].y + (a[i + 1].y - a[i].y) * r.t }, ia: i, ib: j, k };
    }
  }
  return best && { p: best.p, ia: best.ia, ib: best.ib };
}
