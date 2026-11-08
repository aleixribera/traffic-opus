// The road tool's snapping (docs/design.md, "Snapping"): what the cursor joins, and the reference guides that make
// tidy layouts easy without forcing a grid, as in Cities: Skylines 2.
//
// - Existing roads and junctions catch the cursor within a radius that scales with the zoom. Near a junction it
//   prefers the junction; aimed nearly square at a road, it slides to the exact right angle.
// - Guidelines: the straight continuation of a nearby dead end, lines square to a nearby road through its junctions,
//   rays square to a nearby road from where the road starts, right angles and straight on from the start, and the
//   alignment of the end with nearby junctions along the road being drawn.
// - Alongside roads: lines parallel to a nearby straight road, kerb to kerb, one lot deep, and a town block apart.
// - Two guides that cross snap to their crossing.
//
// Whatever it caught last frame it keeps until the cursor moves clearly away (hysteresis), so it never flickers
// between two targets. Alt held ignores it all for a moment.

import { LEVEL_H, NODE_SNAP_PX, ROAD_SNAP_PX, ROAD_TYPES, roadWidth } from "../config";
import { add, angleOf, clamp, cross, cubicTangent, dist, dot, fromAngle, len, norm, right, scale, sub, type V2 } from "../core/math";
import { BLOCK } from "../game/towns";
import { CELL, DEPTH } from "../game/zones";
import type { RoadNetwork } from "./network";
import { cubicClosest, ontoJunction, snap, type Guide, type Snap, type SnapOpts } from "./planner";

/** One lot's depth (m): how deep a town builds beside a street. */
export const LOT_DEPTH = CELL * DEPTH;

export type GuideKind = "ext" | "par" | "perp" | "angle" | "align" | "square";

/** A reference line: from `a` to `b`, faded away from `at` (where the cursor meets it). */
export interface ToolGuide extends Guide {
  kind: GuideKind;
  at: V2;
  /** the guide the point snapped to (drawn stronger) */
  on?: boolean;
}

export interface ToolSnap extends Snap {
  /** Guides near the cursor (faint) and the ones it snapped to (on). */
  refs: ToolGuide[];
  /** What it caught, for hysteresis: "n12" (a node), "s5" (a road), "g:..." (a guide), "" (nothing). */
  key: string;
  /** keys of the guides it snapped to */
  guideKeys: string[];
  /** Meets the road it lands on (or leaves) at a right angle. */
  square?: boolean;
}

export interface ToolSnapOpts extends SnapOpts {
  /** Last frame's result: keep that target while the cursor stays near it. */
  prev?: ToolSnap | null;
  /** Alt held: no snapping at all. */
  free?: boolean;
  /** Drawing a curve: the end's direction is the arc's, so no rays from the start. */
  curve?: boolean;
}

/** How far a guide catches the cursor (px), and how much further it holds on to one it already has. */
const GUIDE_PX = 7;
const HOLD = 1.7;
/** How far round the cursor roads lend their guides (m, at least). */
const REACH = 160;

interface Line { p: V2; d: V2; kind: GuideKind; key: string; ray?: boolean; through?: V2 }

const isStraight = (net: RoadNetwork, id: number) => (net.segGeom.get(id)?.minR ?? 0) > 400;

export function toolSnap(net: RoadNetwork, raw: V2, o: ToolSnapOpts): ToolSnap {
  const h = o.level * LEVEL_H;
  if (o.free) return { p: { ...raw }, h, guides: [], refs: [], key: "", guideKeys: [] };
  const prev = o.prev ?? null;
  const geoOn = !o.off?.geometry;
  // ---- existing roads, junctions, roundabouts, gates
  const nr = clamp(NODE_SNAP_PX * o.mpp, 3, 40);
  const rr = clamp(ROAD_SNAP_PX * o.mpp, 2, 30);
  if (geoOn) {
    // hold on to last frame's node or road while the cursor stays near it
    if (prev?.node !== undefined) {
      const n = net.nodes.get(prev.node);
      if (n && dist(n.p, raw) < nr * HOLD) return finish(net, { p: { ...n.p }, h: n.h, node: n.id, tangent: prev.tangent, guides: [] }, o, `n${n.id}`);
    }
    const g = snap(net, raw, { ...o, off: { geometry: false, guides: true, netSide: true }, angleStep: false, lengthStep: 0 });
    let caught: Snap | null = g.node !== undefined || g.seg !== undefined || g.label ? g : null;
    if (prev?.seg !== undefined && (!caught || (caught.seg !== prev.seg && caught.node === undefined))) {
      const s = net.segs.get(prev.seg), sg = net.segGeom.get(prev.seg);
      if (s && sg) {
        const r = cubicClosest(s.c, raw);
        const hh = net.heightOnSeg(s.id, r.t);
        if (r.d < sg.width / 2 + rr * HOLD && (Math.abs(hh - h) < 0.5 || !o.from)) caught = { p: r.p, h: hh, seg: s.id, t: r.t, guides: [] };
      }
    }
    if (caught) {
      if (caught.ringRaw || caught.label) return finish(net, caught, o, caught.label ? "gate" : `s${caught.seg}`);
      // just short of a junction: the junction (a junction can't be closer than 12 m to another)
      const j = ontoJunction(net, caught);
      if (j.node !== undefined) return finish(net, j, o, `n${j.node}`);
      // aimed nearly square at the road: exactly square
      let square = false;
      if (o.from && !o.curve && caught.seg !== undefined) {
        const s = net.segs.get(caught.seg)!;
        const t = norm(cubicTangent(s.c, caught.t!));
        const f = o.from.p;
        const foot = add(caught.p, scale(t, dot(sub(f, caught.p), t)));
        const dir = norm(sub(caught.p, f));
        if (dist(foot, caught.p) < Math.max(rr * 4, 6) && Math.abs(dot(dir, t)) < Math.sin((7 * Math.PI) / 180)) {
          const r = cubicClosest(s.c, foot);
          if (r.d < 0.5 && r.t > 0.01 && r.t < 0.99) {
            caught = ontoJunction(net, { p: r.p, h: net.heightOnSeg(s.id, r.t), seg: s.id, t: r.t, guides: [] });
            square = caught.node === undefined;
          }
        }
      }
      const out = finish(net, caught, o, caught.node !== undefined ? `n${caught.node}` : `s${caught.seg}`);
      if (square) {
        out.square = true;
        out.refs.push({ a: o.from!.p, b: out.p, kind: "square", at: out.p, on: true });
      }
      return out;
    }
  }
  // ---- a free point: guides
  const tol = Math.max(0.5, GUIDE_PX * o.mpp);
  const reach = Math.max(REACH, 90 * o.mpp);
  const lines = guideLines(net, raw, o, reach);
  const from = o.from?.p;
  let p = { ...raw };
  const refs: ToolGuide[] = [];
  const guideKeys: string[] = [];
  const held = new Set(prev?.guideKeys ?? []);
  const off = (l: Line, q: V2) => Math.abs(cross(l.d, sub(q, l.p)));
  const along = (l: Line, q: V2) => dot(sub(q, l.p), l.d);
  const onLine = (l: Line, q: V2) => add(l.p, scale(l.d, along(l, q)));
  if (o.angleStep && from && len(sub(raw, from)) > 1) {
    // angle steps: 15° off the road it starts from, or off the world's axes, whichever is nearer
    const L = len(sub(raw, from)), ang = angleOf(sub(raw, from));
    const base = o.from?.tangent ? angleOf(o.from.tangent) : 0;
    const step = (15 * Math.PI) / 180;
    let c = base + Math.round((ang - base) / step) * step;
    const w = Math.round(ang / step) * step;
    const da = (a: number) => Math.abs(Math.atan2(Math.sin(ang - a), Math.cos(ang - a)));
    if (o.from?.tangent && da(w) < da(c) - 1e-6) c = w;
    p = add(from, scale(fromAngle(c), L));
    const l: Line = { p: from, d: fromAngle(c), kind: "angle", key: `a${Math.round((c * 180) / Math.PI)}`, ray: true };
    refs.push({ a: from, b: add(from, scale(l.d, L + 200)), kind: "angle", at: p, on: true });
    guideKeys.push(l.key);
    p = alignAlong(net, l, p, o, tol, refs, guideKeys, held);
  } else {
    // the nearest guide (one held from last frame catches from further), then a second one crossing it
    const scored = lines
      .map((l) => ({ l, d: off(l, raw) / (held.has(l.key) ? HOLD : 1) }))
      .filter((x) => x.d < tol && (!x.l.ray || along(x.l, raw) > 0))
      .sort((a, b) => a.d - b.d);
    const first = scored[0]?.l;
    if (first) {
      p = onLine(first, raw);
      guideKeys.push(first.key);
      let second: Line | undefined;
      for (const { l } of scored.slice(1)) {
        if (Math.abs(cross(l.d, first.d)) < 0.17) continue;
        // where the two cross
        const den = cross(first.d, l.d);
        const t = cross(sub(l.p, first.p), l.d) / den;
        const x = add(first.p, scale(first.d, t));
        if (dist(x, raw) < tol * (held.has(l.key) ? HOLD : 1) * 1.2) { p = x; second = l; guideKeys.push(l.key); break; }
      }
      for (const l of second ? [first, second] : [first]) refs.push(guideRef(l, p, true));
      // on a ray from the start: line the end up with junctions along it, or round the length
      if (!second && first.ray && from) p = alignAlong(net, first, p, o, tol, refs, guideKeys, held);
    } else if (from && !o.curve && len(sub(raw, from)) > 1) {
      const l: Line = { p: from, d: norm(sub(raw, from)), kind: "angle", key: "free", ray: true };
      p = alignAlong(net, l, p, o, tol, refs, guideKeys, held);
    }
  }
  // faint references: the guides near the cursor that it didn't snap to
  const near = lines
    .filter((l) => !guideKeys.includes(l.key) && off(l, p) < tol * 8 && (!l.ray || along(l, p) > 0))
    .sort((a, b) => off(a, p) - off(b, p))
    .slice(0, 4);
  for (const l of near) refs.push(guideRef(l, onLine(l, p), false));
  return { p, h, guides: refs, refs, key: guideKeys.length ? "g:" + guideKeys.join("|") : "", guideKeys };
}

/** A guide line as drawn: a stretch either side of where the cursor meets it (a ray: from its origin). */
function guideRef(l: Line, at: V2, on: boolean): ToolGuide {
  if (l.ray) return { a: l.p, b: add(at, scale(l.d, 120)), kind: l.kind, at, on };
  const a = l.through ?? at;
  const s0 = Math.min(dot(sub(a, l.p), l.d), dot(sub(at, l.p), l.d)) - 120;
  const s1 = Math.max(dot(sub(a, l.p), l.d), dot(sub(at, l.p), l.d)) + 120;
  return { a: add(l.p, scale(l.d, s0)), b: add(l.p, scale(l.d, s1)), kind: l.kind, at, on };
}

/**
 * Along a ray from the start: stop level with a nearby junction (measured along the ray), else round the length to the
 * length step.
 */
function alignAlong(net: RoadNetwork, l: Line, p: V2, o: ToolSnapOpts, tol: number, refs: ToolGuide[], keys: string[], held: Set<string>): V2 {
  const f = l.p, t = dot(sub(p, f), l.d);
  if (!o.off?.guides) {
    let best: { n: V2; id: number; dt: number } | null = null;
    for (const n of net.nodesNear(p, 300)) {
      if (dist(n.p, f) < 4 || dist(n.p, p) < 4) continue;
      const tn = dot(sub(n.p, f), l.d);
      if (tn <= 4) continue;
      const k = `j${n.id}`;
      const dt = Math.abs(tn - t) / (held.has(k) ? HOLD : 1);
      if (dt < tol && (!best || dt < best.dt)) best = { n: n.p, id: n.id, dt };
    }
    if (best) {
      const q = add(f, scale(l.d, dot(sub(best.n, f), l.d)));
      refs.push({ a: best.n, b: q, kind: "align", at: q, on: true });
      keys.push(`j${best.id}`);
      return q;
    }
  }
  if (o.lengthStep && o.lengthStep > 0 && t > 1) return add(f, scale(l.d, Math.max(o.lengthStep, Math.round(t / o.lengthStep) * o.lengthStep)));
  return p;
}

/** Every guide line near the cursor (see the header). */
function guideLines(net: RoadNetwork, raw: V2, o: ToolSnapOpts, reach: number): Line[] {
  const out: Line[] = [];
  const guides = !o.off?.guides, side = !o.off?.netSide;
  const from = o.from?.p;
  const w = roadWidth(ROAD_TYPES[o.type]);
  const h = o.level * LEVEL_H;
  // from the start: straight on, square off, and the world's axes
  if (guides && from && !o.curve) {
    const base = o.from?.tangent;
    const dirs: [number, string][] = [];
    for (let k = 0; k < 4; k++) dirs.push([(k * Math.PI) / 2, `w${k}`]);
    if (base) for (let k = 0; k < 4; k++) dirs.push([angleOf(base) + (k * Math.PI) / 2, `t${k}`]);
    for (const [a, k] of dirs) out.push({ p: from, d: fromAngle(a), kind: "angle", key: k, ray: true });
  }
  const segs = net.segsNear(raw.x - reach, raw.y - reach, raw.x + reach, raw.y + reach);
  const seenNode = new Set<number>();
  for (const id of segs) {
    const s = net.segs.get(id)!;
    const g = net.segGeom.get(id);
    if (!g || s.ring) continue;
    const r = cubicClosest(s.c, raw);
    if (r.d > reach) continue;
    // (guides come off roads at the level being drawn on)
    if (Math.abs(net.heightOnSeg(id, r.t) - h) > 0.5) continue;
    const t = norm(cubicTangent(s.c, r.t)), n = right(t);
    if (isStraight(net, id)) {
      const sd = norm(sub(s.c.p3, s.c.p0)), sn = right(sd);
      // alongside: kerb to kerb, a verge apart, one lot deep, a town block apart
      if (side) {
        const touch = (g.width + w) / 2 + 0.2;
        const offs: [number, string][] = [[touch, "k"], [touch + 8, "v"], [(g.width + w) / 2 + LOT_DEPTH, "l"], [BLOCK, "b"]];
        for (const [d, k] of offs) for (const sg of [1, -1]) {
          out.push({ p: add(s.c.p0, scale(sn, d * sg)), d: sd, kind: "par", key: `p${id}${k}${sg}` });
        }
      }
      if (guides) {
        // square to the road through its junctions, and from the start
        for (const nid of [s.a, s.b]) {
          if (seenNode.has(nid)) continue;
          seenNode.add(nid);
          const nd = net.nodes.get(nid)!;
          if (dist(nd.p, raw) > reach) continue;
          out.push({ p: nd.p, d: sn, kind: "perp", key: `q${nid}`, through: nd.p });
        }
        if (from && !o.curve && r.d > 8) {
          for (const sg of [1, -1]) out.push({ p: from, d: scale(sn, sg), kind: "perp", key: `r${id}${sg}`, ray: true });
        }
      }
    } else if (guides && from && !o.curve && r.d > 8) {
      for (const sg of [1, -1]) out.push({ p: from, d: scale(n, sg), kind: "perp", key: `r${id}${sg}`, ray: true });
    }
    // straight on from a dead end
    if (guides) {
      for (const nid of [s.a, s.b]) {
        if (net.segsAt(nid).length !== 1) continue;
        const nd = net.nodes.get(nid)!;
        if (from && dist(nd.p, from) < 1) continue;
        const d = s.a === nid ? scale(norm(cubicTangent(s.c, 0)), -1) : norm(cubicTangent(s.c, 1));
        out.push({ p: nd.p, d, kind: "ext", key: `e${nid}`, ray: true });
      }
    }
  }
  return out;
}

/** Caught a road, junction or gate: the guides that come with it (none). */
function finish(_net: RoadNetwork, s: Snap, _o: ToolSnapOpts, key: string): ToolSnap {
  return { ...s, guides: [], refs: [], key, guideKeys: [] };
}
