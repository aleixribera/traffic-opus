import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { ROAD_TYPES, isHighway, isUnpaved, type RoadType } from "../config";
import type { RoadNetwork } from "../roads/network";
import { LAND } from "./palette";

/** A class of road on the far map: which roads, and how it is inked (widths in pixels). */
interface Tier {
  pick: (t: RoadType) => boolean;
  /** the dark casing under it (0: none) */
  casing: number;
  fill: number;
  color: number;
  /** a line down its middle (motorways) */
  centre?: { px: number; color: number };
  /** drawn in dashes (a dirt track): dash and gap, pixels */
  dash?: [number, number];
}

/**
 * The roads of the far map, inked as a road atlas of the 1930s draws them: real road ribbons get thinner than a
 * pixel out there, so past a point every road is also drawn as a line of a set width on the page, and its class is
 * told at a glance. A dirt track is a thin dashed sepia line; a paved road a pale line in a dark casing; an avenue
 * or a boulevard wider, filled yellow; a motorway widest, red, with a pale line down its middle. All the casings
 * lie under all the fills, so where roads meet their fills run together as on a printed map. Fades in as the
 * ribbons fade out.
 */
export const FAR_TIERS: Tier[] = [
  { pick: isUnpaved, casing: 0, fill: 1.5, color: LAND.inkTrack, dash: [5, 3.2] },
  { pick: (t) => !isUnpaved(t) && !isHighway(t) && t.rank <= 1, casing: 3.5, fill: 1.9, color: LAND.fillStreet },
  { pick: (t) => !isUnpaved(t) && !isHighway(t) && t.rank >= 2, casing: 5.3, fill: 3.5, color: LAND.fillAvenue },
  { pick: isHighway, casing: 6.8, fill: 4.9, color: LAND.fillMotorway, centre: { px: 1, color: LAND.fillMotorwayLine } },
];

export class RoadsFar {
  readonly group = new THREE.Group();
  /** every line drawn: its material, its width on the page, which tier's roads it follows */
  private lines: { line: LineSegments2; mat: LineMaterial; px: number; tier: number }[] = [];
  private dirty = true;
  /** each road's thinned centreline, kept while its geometry stands (a road rebuilt gets a new one) */
  private thinned = new WeakMap<object, { x: number; y: number }[]>();

  constructor(private net: RoadNetwork) {
    this.group.renderOrder = 5;
    const add = (tier: number, px: number, color: number, order: number, dash?: [number, number]) => {
      const mat = new LineMaterial({ color, linewidth: px, worldUnits: false, transparent: true, depthTest: false, depthWrite: false, dashed: !!dash });
      if (dash) { mat.dashSize = dash[0]; mat.gapSize = dash[1]; }
      const line = new LineSegments2(new LineSegmentsGeometry(), mat);
      line.renderOrder = order;
      line.frustumCulled = false;
      this.lines.push({ line, mat, px, tier });
      this.group.add(line);
    };
    FAR_TIERS.forEach((t, i) => {
      if (t.casing) add(i, t.casing, LAND.inkCasing, 10 + i);
      add(i, t.fill, t.color, 20 + i, t.dash);
      if (t.centre) add(i, t.centre.px, t.centre.color, 30 + i);
    });
  }

  /** Builds the lines now if they are due (at load, so the first zoom out doesn't). */
  prepare() {
    if (this.dirty) this.rebuild();
  }

  invalidate() {
    this.dirty = true;
  }

  /** mpp = metres per CSS pixel; w/h = canvas size in CSS pixels. */
  update(mpp: number, w: number, h: number) {
    // ribbons are ~8-12 m wide: start the lines once a road is under ~3 px wide
    const a = Math.min(1, Math.max(0, (mpp - 2.2) / 1.6));
    this.group.visible = a > 0.01;
    if (!this.group.visible) return;
    if (this.dirty) this.rebuild();
    // (far out a town's streets lie a few pixels apart: every line a little finer there, so its plan stays legible)
    const fine = 1 - 0.3 * Math.min(1, Math.max(0, (mpp - 7) / 9));
    for (const l of this.lines) {
      l.mat.opacity = a;
      l.mat.linewidth = l.px * fine;
      l.mat.resolution.set(w, h);
      // (dashes keep their length on the page)
      if (l.mat.dashed) l.mat.dashScale = 1 / mpp;
    }
  }

  private rebuild() {
    this.dirty = false;
    FAR_TIERS.forEach((t, ti) => {
      const pos: number[] = [], dist: number[] = [];
      for (const s of this.net.segs.values()) {
        const T = ROAD_TYPES[s.type];
        if (!t.pick(T)) continue;
        const g = this.net.segGeom.get(s.id);
        if (!g) continue;
        let pts = this.thinned.get(g.center.pts);
        if (!pts) this.thinned.set(g.center.pts, (pts = thin(g.center.pts)));
        let d = 0;
        for (let i = 1; i < pts.length; i++) {
          const p = pts[i - 1], q = pts[i];
          pos.push(p.x, 40, p.y, q.x, 40, q.y);
          const l = Math.hypot(q.x - p.x, q.y - p.y);
          dist.push(d, d + l);
          d += l;
        }
      }
      // (one geometry for every line of the tier: its casing, fill and centre line follow the same roads)
      const mine = this.lines.filter((l) => l.tier === ti);
      mine[0].line.geometry.dispose();
      const geo = new LineSegmentsGeometry();
      if (pos.length) {
        geo.setPositions(pos);
        if (mine.some((l) => l.mat.dashed)) {
          // (how far along its road each piece starts and ends: the dashes run on from piece to piece)
          const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(dist), 2, 1);
          geo.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(buf, 1, 0));
          geo.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(buf, 1, 1));
        }
      }
      for (const l of mine) {
        l.line.geometry = geo;
        l.line.visible = pos.length > 0;
      }
    });
  }
}

/**
 * A road's centreline with only the points a far line needs: one is kept where leaving it out would bend the line
 * more than a few decimetres off the road (under a tenth of a pixel at the zooms that draw these), or every 160 m.
 */
export function thin(pts: readonly { x: number; y: number }[], tol = 0.3, most = 160): { x: number; y: number }[] {
  if (pts.length <= 2) return pts.slice();
  const out = [pts[0]];
  let k = 0;
  for (let i = 2; i < pts.length; i++) {
    const a = pts[k], b = pts[i];
    const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy);
    let keep = L > most;
    for (let j = k + 1; j < i && !keep; j++) keep = L > 1e-6 && Math.abs((pts[j].x - a.x) * dy - (pts[j].y - a.y) * dx) / L > tol;
    if (keep) out.push(pts[i - 1]), (k = i - 1);
  }
  out.push(pts[pts.length - 1]);
  return out;
}
