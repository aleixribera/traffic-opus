import * as THREE from "three";
import { LEVEL_H, ROAD_TYPES, roadWidth } from "../config";
import { clamp, smoothstep, type V2 } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { chainPoints, type Guide, type Plan } from "../roads/planner";
import { makeRoadMaterial, ribbon, strip } from "./roads3d";
import { LEVEL_TINT } from "./palette";

const OK_ALPHA = 0.88;

/** Everything drawn while a tool is active: road ghosts, guides, snap markers, removal highlights. */
export class Preview3D {
  readonly group = new THREE.Group();
  private items: THREE.Object3D[] = [];
  private okMats = LEVEL_TINT.map((c) => makeRoadMaterial({ color: c, opacity: OK_ALPHA }));
  private badMat = makeRoadMaterial({ color: 0x9b2f33, opacity: OK_ALPHA });
  private outline = new THREE.MeshBasicMaterial({ color: 0x1c1d20, transparent: true, opacity: 0.85, depthTest: false });
  private delMat = new THREE.MeshBasicMaterial({ color: 0xe5484d, transparent: true, opacity: 0.55, depthTest: false });
  private hiMat = new THREE.MeshBasicMaterial({ color: 0x2fb0e6, transparent: true, opacity: 0.45, depthTest: false });
  private guideMat = new THREE.LineDashedMaterial({ color: 0x2b2d31, dashSize: 3, gapSize: 3, transparent: true, opacity: 0.5, depthTest: false });
  private markerGeo = new THREE.RingGeometry(1.3, 2.1, 24).rotateX(-Math.PI / 2);
  private markerMat = new THREE.MeshBasicMaterial({ color: 0x1c1d20, depthTest: false, transparent: true, opacity: 0.9 });
  ghost: THREE.Mesh | null = null;
  /** Shared geometry (building models) that clear() must not dispose. */
  private keep = new Set<THREE.BufferGeometry>();
  private modelOk = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82 });
  private modelBad = new THREE.MeshLambertMaterial({ color: 0xe5484d, transparent: true, opacity: 0.6 });

  constructor() {
    for (const m of [...this.okMats, this.badMat]) m.mat.depthTest = false;
  }

  clear() {
    for (const o of this.items) {
      this.group.remove(o);
      const m = o as THREE.Mesh;
      if (m.geometry && m.geometry !== this.markerGeo && !this.keep.has(m.geometry)) m.geometry.dispose();
    }
    this.items = [];
  }

  private add(o: THREE.Object3D, order = 7) {
    o.renderOrder = order;
    this.group.add(o);
    this.items.push(o);
  }

  /** Ghost of a planned road (or grid / roundabout). */
  plan(plan: Plan, level: number) {
    const bad = plan.errors.length > 0;
    for (const st of [...plan.strokes, ...(plan.ghosts ?? [])]) {
      const pts = chainPoints(st.chain, 2);
      if (pts.length < 2) continue;
      const T = ROAD_TYPES[st.type];
      const w = roadWidth(T);
      let acc = 0;
      const ss = [0];
      for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); ss.push(acc); }
      const hs = ss.map((s) => st.h0 + (st.h1 - st.h0) * smoothstep(clamp(s / (acc || 1), 0, 1)));
      const lift = 0.35;
      const lvl = Math.round(Math.max(st.h0, st.h1) / LEVEL_H);
      const mat = bad ? this.badMat : this.okMats[clamp(lvl, 0, 3)] ?? this.okMats[level];
      // dark outline under the ghost
      const ol = new THREE.Mesh(ribbon(pts, hs, ss, w / 2 + 0.55, lift - 0.02, [-1, 0]), this.outline);
      this.add(ol, 7);
      const m = new THREE.Mesh(ribbon(pts, hs, ss, w / 2, lift, [T.fwd, T.bwd], undefined, T.median ?? 0), mat.mat);
      this.add(m, 8);
    }
  }

  guides(gs: Guide[]) {
    for (const g of gs) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(g.a.x, 40, g.a.y), new THREE.Vector3(g.b.x, 40, g.b.y)]);
      const l = new THREE.Line(geo, this.guideMat);
      l.computeLineDistances();
      this.add(l, 9);
    }
  }

  marker(p: V2, h: number) {
    const m = new THREE.Mesh(this.markerGeo, this.markerMat);
    m.position.set(p.x, h + 0.6, p.y);
    this.add(m, 10);
  }

  /** Red wash over segments that would be removed. */
  removal(net: RoadNetwork, segs: Iterable<number>) {
    this.washSegs(net, segs, this.delMat);
  }

  highlight(net: RoadNetwork, segs: Iterable<number>) {
    this.washSegs(net, segs, this.hiMat);
  }

  private washSegs(net: RoadNetwork, segs: Iterable<number>, mat: THREE.Material) {
    for (const id of segs) {
      const g = net.segGeom.get(id);
      if (!g) continue;
      const pts = g.center.pts;
      const hs = Array.from(g.hs);
      const m = new THREE.Mesh(strip(pts, Math.max(...hs) + 1.2, g.width + 1), mat);
      this.add(m, 8);
    }
  }

  /** Flat footprint outline (buildings to be bulldozed or blocking). */
  footprint(corners: V2[], color: number, under = false) {
    const shape = new THREE.Shape(corners.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: under ? 0.3 : 0.5, depthTest: false, side: THREE.DoubleSide }));
    // under a ghost model the footprint is a ground decal drawn first, so the model stays visible on top
    m.position.y = under ? 0.15 : 20;
    this.add(m, under ? 5 : 9);
  }

  /** A see-through building model where it would be placed. */
  model(geo: THREE.BufferGeometry, m: THREE.Matrix4, ok: boolean) {
    this.keep.add(geo);
    const mesh = new THREE.Mesh(geo, ok ? this.modelOk : this.modelBad);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    this.add(mesh, 6);
  }

  setGhost(mesh: THREE.Mesh | null) {
    if (this.ghost) this.group.remove(this.ghost);
    this.ghost = mesh;
    if (mesh) this.group.add(mesh);
  }
}
