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
        const pts = g.center.pts;
        const step = Math.max(1, Math.floor(pts.length / 400));
        let d = 0;
        for (let i = step; i < pts.length + step - 1; i += step) {
          const p = pts[i - step], q = pts[Math.min(i, pts.length - 1)];
          pos.push(p.x, 40, p.y, q.x, 40, q.y);
          const l = Math.hypot(q.x - p.x, q.y - p.y);
          dist.push(d, d + l);
          d += l;
        }
      }
      for (const l of this.lines) {
        if (l.tier !== ti) continue;
        l.line.geometry.dispose();
        const geo = new LineSegmentsGeometry();
        if (pos.length) {
          geo.setPositions(pos);
          if (l.mat.dashed) {
            // (how far along its road each piece starts and ends: the dashes run on from piece to piece)
            const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(dist), 2, 1);
            geo.setAttribute("instanceDistanceStart", new THREE.InterleavedBufferAttribute(buf, 1, 0));
            geo.setAttribute("instanceDistanceEnd", new THREE.InterleavedBufferAttribute(buf, 1, 1));
          }
        }
        l.line.geometry = geo;
        l.line.visible = pos.length > 0;
      }
    });
  }
}
