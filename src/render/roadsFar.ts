import * as THREE from "three";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { ROAD_TYPES, isHighway, isUnpaved, type RoadType } from "../config";
import type { RoadNetwork } from "../roads/network";
import { PAL } from "./palette";

/**
 * Roads as map lines for when you zoom out: real road ribbons get thinner than a pixel, so past a point every
 * road is also drawn as a line with a minimum screen width (motorways widest), white with a grey casing,
 * like a map. Fades in as the ribbons fade out.
 */
export class RoadsFar {
  readonly group = new THREE.Group();
  private tiers: { mats: LineMaterial[]; lines: LineSegments2[]; px: number; fill: number; casing: number; pick: (t: RoadType) => boolean }[];
  private dirty = true;

  constructor(private net: RoadNetwork) {
    this.group.renderOrder = 5;
    // dirt tracks (thinnest, in earth brown), town roads, boulevards, and highways (widest, in highway grey)
    this.tiers = [
      { px: 1.5, fill: PAL.dirt, casing: PAL.dirtRut, pick: isUnpaved, mats: [], lines: [] },
      { px: 2.2, fill: PAL.road, casing: PAL.roadEdge, pick: (t) => t.allowsAccess && !isUnpaved(t), mats: [], lines: [] },
      { px: 3.6, fill: PAL.road, casing: PAL.roadEdge, pick: (t) => !t.allowsAccess && !isHighway(t), mats: [], lines: [] },
      { px: 3.6, fill: PAL.hwRoad, casing: PAL.hwEdge, pick: isHighway, mats: [], lines: [] },
    ];
    for (const t of this.tiers) {
      for (const [k, color] of [[0, t.casing], [1, t.fill]] as const) {
        const mat = new LineMaterial({ color, linewidth: k === 0 ? t.px + 1.6 : t.px, worldUnits: false, transparent: true, depthTest: false, depthWrite: false });
        const line = new LineSegments2(new LineSegmentsGeometry(), mat);
        line.renderOrder = 10 + k * 2 + (t.px > 3 ? 1 : 0);
        line.frustumCulled = false;
        t.mats.push(mat);
        t.lines.push(line);
        this.group.add(line);
      }
    }
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
    for (const t of this.tiers) for (const m of t.mats) { m.opacity = a; m.resolution.set(w, h); }
  }

  private rebuild() {
    this.dirty = false;
    for (const t of this.tiers) {
      const pos: number[] = [];
      for (const s of this.net.segs.values()) {
        const T = ROAD_TYPES[s.type];
        if (!t.pick(T)) continue;
        const g = this.net.segGeom.get(s.id);
        if (!g) continue;
        const pts = g.center.pts;
        const step = Math.max(1, Math.floor(pts.length / 400));
        for (let i = step; i < pts.length + step - 1; i += step) {
          const p = pts[i - step], q = pts[Math.min(i, pts.length - 1)];
          pos.push(p.x, 40, p.y, q.x, 40, q.y);
        }
      }
      for (const l of t.lines) {
        l.geometry.dispose();
        const geo = new LineSegmentsGeometry();
        if (pos.length) geo.setPositions(pos);
        l.geometry = geo;
        l.visible = pos.length > 0;
      }
    }
  }
}
