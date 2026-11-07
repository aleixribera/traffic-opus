import * as THREE from "three";
import { angleOf, polyAt, polyClosest, polyDirSmooth, right, type V2 } from "../core/math";
import type { Transit } from "../game/transit";
import type { Lane, RoadNetwork } from "../roads/network";
import { dkDir, dkSeg, type Access } from "../sim/router";
import { lotMatrix } from "./buildings3d";
import type { MergedModel } from "./models";
import { strip } from "./roads3d";

/** Bus stops (a shelter on the footpath and a yellow box on the kerb lane) and, when asked for, each line's route. */
export class Transit3D {
  readonly group = new THREE.Group();
  private shelters: THREE.InstancedMesh | null = null;
  private marks: THREE.Mesh | null = null;
  private routes = new THREE.Group();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private markMat: THREE.MeshBasicMaterial;
  private version = -1;
  private routesOn = false;
  private routesVer = -1;
  private routeMats = new Map<number, THREE.MeshBasicMaterial>();
  private dimMats = new Map<number, THREE.MeshBasicMaterial>();
  /** line drawn on top of the others (the one being edited or looked at) */
  focus: number | null = null;
  private focusShown: number | null = null;

  constructor(private shelter: MergedModel | undefined) {
    this.markMat = new THREE.MeshBasicMaterial({ map: markTexture(), transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4 });
    this.group.add(this.routes);
  }

  /** route width in metres, from the zoom: about 7 px on screen, never narrower than a bus */
  private routeW = 2.2;

  /** the view turn the BUS lettering was laid out for (it is turned to read upright on screen) */
  private rot = 0;

  update(tr: Transit, net: RoadNetwork, showRoutes: boolean, mpp = 0.5, rot = 0) {
    const w = Math.max(2.2, mpp * 7);
    const zoomed = Math.abs(w / this.routeW - 1) > 0.25;
    const turned = Math.abs(Math.atan2(Math.sin(rot - this.rot), Math.cos(rot - this.rot))) > 0.2;
    if (tr.version !== this.version || turned) {
      this.version = tr.version;
      this.rot = rot;
      this.rebuildStops(tr, net);
    }
    if (showRoutes !== this.routesOn || (showRoutes && (tr.version !== this.routesVer || this.focus !== this.focusShown || zoomed))) {
      this.routeW = w;
      this.routesOn = showRoutes;
      this.routesVer = tr.version;
      this.focusShown = this.focus;
      this.rebuildRoutes(tr, net, showRoutes);
    }
  }

  private rebuildStops(tr: Transit, net: RoadNetwork) {
    if (this.shelters) { this.group.remove(this.shelters); this.shelters.dispose(); this.shelters = null; }
    if (this.marks) { this.group.remove(this.marks); this.marks.geometry.dispose(); this.marks = null; }
    const stops = [...tr.stops.values()].filter((s) => net.segGeom.has(s.access.seg));
    if (!stops.length) return;
    const pos: number[] = [], uv: number[] = [], idx: number[] = [];
    const m = new THREE.Matrix4();
    if (this.shelter) this.shelters = new THREE.InstancedMesh(this.shelter.geo, this.mat, stops.length);
    stops.forEach((st, i) => {
      const g = net.segGeom.get(st.access.seg)!;
      const side = st.access.side ?? 1;
      const r = polyClosest(g.center, st.p);
      const t = polyDirSmooth(g.center, r.s, 2), n = right(t);
      const out = { x: n.x * side, y: n.y * side };
      // the shelter on the footpath, open to the road
      const c = { x: st.p.x + out.x * 1.5, y: st.p.y + out.y * 1.5 };
      if (this.shelters) { lotMatrix(m, c, angleOf(t), side, 0.02); this.shelters.setMatrixAt(i, m); }
      // the bay marking: 14 m along the kerb lane, ending at the stop (the bus pulls up to the shelter)
      const along = (side === 1 ? 1 : -1); // which way traffic on this side drives, along the centreline
      const lane = g.lanes.find((l: Lane) => (l.dir === 1 ? 1 : -1) === side && l.idx === 0);
      const w = 2.6;
      const mid = lane ? polyAt(lane.pl, polyClosest(lane.pl, st.p).s) : { x: st.p.x - out.x * 1.7, y: st.p.y - out.y * 1.7 };
      const a = { x: mid.x - t.x * along * 10, y: mid.y - t.y * along * 10 }, b = { x: mid.x + t.x * along * 4, y: mid.y + t.y * along * 4 };
      const u = { x: (b.x - a.x) / 14, y: (b.y - a.y) / 14 }, v = { x: u.y, y: -u.x };
      const k = pos.length / 3;
      const y = 0.09;
      for (const [p, q] of [[a, -1], [b, -1], [b, 1], [a, 1]] as [V2, number][]) pos.push(p.x + v.x * q * w / 2, y, p.y + v.y * q * w / 2);
      // lettering upright on screen (screen right is (cos rot, sin rot) in the world)
      if (u.x * Math.cos(this.rot) + u.y * Math.sin(this.rot) >= 0) uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      else uv.push(1, 1, 0, 1, 0, 0, 1, 0);
      idx.push(k, k + 1, k + 2, k, k + 2, k + 3);
    });
    if (this.shelters) {
      this.shelters.instanceMatrix.needsUpdate = true;
      this.shelters.castShadow = true;
      this.shelters.receiveShadow = true;
      this.group.add(this.shelters);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
    geo.setIndex(idx);
    // (face the camera above: the winding of each quad depends on the side, so draw both faces)
    this.markMat.side = THREE.DoubleSide;
    this.marks = new THREE.Mesh(geo, this.markMat);
    this.marks.renderOrder = 2;
    this.group.add(this.marks);
  }

  private rebuildRoutes(tr: Transit, net: RoadNetwork, on: boolean) {
    for (const c of [...this.routes.children]) { this.routes.remove(c); (c as THREE.Mesh).geometry.dispose(); }
    if (!on) return;
    const lines = [...tr.lines.values()].sort((a, b) => (a.id === this.focus ? 1 : 0) - (b.id === this.focus ? 1 : 0));
    lines.forEach((l, li) => {
      const pts = routePoints(tr, net, l.id);
      if (pts.length < 2) return;
      let mat = this.routeMats.get(l.color);
      if (!mat) this.routeMats.set(l.color, (mat = new THREE.MeshBasicMaterial({ color: l.color, transparent: true, opacity: 0.85, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6 })));
      const dim = this.focus !== null && l.id !== this.focus;
      // on the road surface (bridges included), under the vehicles: the buses stay visible on their own route
      const geo = strip(pts, 0, this.routeW * (dim ? 0.6 : 1));
      const pa = geo.getAttribute("position") as THREE.BufferAttribute;
      pts.forEach((q, i) => { const y = (q.h ?? 0) + 0.3 + li * 0.01; pa.setY(i * 2, y); pa.setY(i * 2 + 1, y); });
      // far out the cars are gone and the simplified roads sit on top: draw the route over everything then
      mat.depthTest = this.routeW < 5;
      const mesh = new THREE.Mesh(geo, mat);
      mesh.renderOrder = dim ? 11 : 12;
      if (dim) {
        let dm = this.dimMats.get(l.color);
        if (!dm) { dm = mat.clone(); dm.opacity = 0.35; this.dimMats.set(l.color, dm); }
        dm.depthTest = mat.depthTest;
        mesh.material = dm;
      }
      this.routes.add(mesh);
    });
  }
}

/** The path a line's buses drive, as one polyline along the kerb lanes (stop to stop, round to the first). */
export function routePoints(tr: Transit, net: RoadNetwork, id: number): RoutePt[] {
  const l = tr.lines.get(id);
  if (!l) return [];
  const out: RoutePt[] = [];
  for (let i = 0; i < l.stops.length; i++) {
    const a = tr.stops.get(l.stops[i]), b = tr.stops.get(l.stops[(i + 1) % l.stops.length]);
    if (!a || !b) continue;
    out.push(...legPoints(tr, net, a.access, b.access));
  }
  return out;
}

/** Points along the route from one stop to the next (empty when there is no way). */
export type RoutePt = V2 & { h?: number };

export function legPoints(tr: Transit, net: RoadNetwork, a: Access, b: Access): RoutePt[] {
  const r = tr.routeKeys(a, b);
  if (!r) return [];
  const pts: RoutePt[] = [];
  r.forEach((k, i) => {
    const g = net.segGeom.get(dkSeg(k));
    if (!g) return;
    const lanes = g.lanes.filter((x) => x.dir === dkDir(k) && !x.pocket);
    const lane = lanes.find((x) => x.idx === 0) ?? lanes[0];
    if (!lane) return;
    const L = lane.pl.length;
    const s0 = i === 0 ? polyClosest(lane.pl, a.p).s : 0;
    const s1 = i === r.length - 1 ? polyClosest(lane.pl, b.p).s : L;
    if (s1 <= s0) return;
    const n = Math.max(2, Math.ceil((s1 - s0) / 4));
    for (let j = 0; j <= n; j++) {
      const s = s0 + ((s1 - s0) * j) / n;
      const q: RoutePt = polyAt(lane.pl, s);
      q.h = heightOn(lane, s);
      pts.push(q);
    }
  });
  return pts;
}

/** Height of an edge at arc-length s (from its per-point heights). */
function heightOn(e: Lane, s: number): number {
  const c = e.pl.cum, h = e.hs;
  if (!h.length) return 0;
  let i = 1;
  while (i < c.length - 1 && c[i] < s) i++;
  const f = Math.min(1, Math.max(0, (s - c[i - 1]) / (c[i] - c[i - 1] || 1)));
  return h[i - 1] + (h[Math.min(i, h.length - 1)] - h[i - 1]) * f;
}

/** A yellow bus bay: a box outline with BUS painted in it (u along the kerb, v across). */
function markTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 110;
  const x = c.getContext("2d")!;
  x.strokeStyle = "#f2c230";
  x.lineWidth = 9;
  // zig-zag along the open side, solid line along the kerb, ends closed
  x.strokeRect(6, 6, 500, 98);
  x.fillStyle = "#f2c230";
  x.font = "bold 66px system-ui, sans-serif";
  x.textAlign = "center";
  x.textBaseline = "middle";
  x.fillText("BUS", 256, 58);
  const t = new THREE.CanvasTexture(c);
  t.anisotropy = 4;
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
