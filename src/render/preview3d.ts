import * as THREE from "three";
import { LEVEL_H, ROAD_TYPES, roadWidth } from "../config";
import { clamp, smoothstep, type V2 } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import { chainPoints, strokeProfile, type BridgeSpan, type Guide, type Plan } from "../roads/planner";
import type { ToolGuide } from "../roads/snapping";
import type { V2 as P2 } from "../core/math";
import { makeRoadMaterial, ribbon, strip } from "./roads3d";
import { LEVEL_TINT } from "./palette";

const OK_ALPHA = 0.88;

/** How far over the ground or a deck the flat marks float (m): clear of the road's paint, still on it at a tilt. */
const LIFT = 0.5;

/**
 * Everything drawn while a tool is active: road ghosts, guides, snap markers, removal highlights. All of it is drawn
 * over the scene (no depth test), each mark at the real height of what it marks: the camera is tilted, and a guide
 * floating "above everything" would slide off the ground it measures.
 */
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
  // reference guides (the Deco accents): ochre where it snapped, navy-ink faint ones near the cursor; each fades in
  // three steps away from where the cursor meets it
  private refOn = [0.95, 0.6, 0.28].map((o) => new THREE.LineDashedMaterial({ color: 0xe0a833, dashSize: 2.4, gapSize: 1.6, transparent: true, opacity: o, depthTest: false }));
  private refOff = [0.42, 0.24, 0.1].map((o) => new THREE.LineDashedMaterial({ color: 0x122036, dashSize: 2, gapSize: 2.4, transparent: true, opacity: o, depthTest: false }));
  private targetMat = new THREE.MeshBasicMaterial({ color: 0xe0a833, transparent: true, opacity: 0.5, depthTest: false });
  private targetRing = new THREE.MeshBasicMaterial({ color: 0xe0a833, depthTest: false, transparent: true, opacity: 0.95 });
  private squareMat = new THREE.MeshBasicMaterial({ color: 0xf3ead6, depthTest: false, transparent: true, opacity: 0.95, side: THREE.DoubleSide });
  private squareLine = new THREE.MeshBasicMaterial({ color: 0x122036, depthTest: false, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
  private spanMat = new THREE.MeshBasicMaterial({ color: 0xf3ead6, depthTest: false, transparent: true, opacity: 0.9 });
  ghost: THREE.Mesh | null = null;
  /** Shared geometry (building models) that clear() must not dispose. */
  private keep = new Set<THREE.BufferGeometry>();
  private modelOk = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.82 });
  private modelBad = new THREE.MeshLambertMaterial({ color: 0xe5484d, transparent: true, opacity: 0.6 });
  /** held over one of the company's own sites on the way somewhere: its own colours, faded, not a refusal's red */
  private modelHeld = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, opacity: 0.38 });

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

  /** Ghost of a planned road (or roundabout): each piece tinted for its height, so a bridge reads as one. */
  plan(plan: Plan, level: number, net?: RoadNetwork) {
    const bad = plan.errors.length > 0;
    for (const st of [...plan.strokes, ...(plan.ghosts ?? [])]) {
      const pts = chainPoints(st.show ?? st.chain, 2);
      if (pts.length < 2) continue;
      const T = ROAD_TYPES[st.type];
      const w = roadWidth(T);
      let acc = 0;
      const ss = [0];
      for (let i = 1; i < pts.length; i++) { acc += Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); ss.push(acc); }
      const hs = net && st.hj && !st.show ? strokeProfile(net, st, 2).hs : ss.map((s) => st.h0 + (st.h1 - st.h0) * smoothstep(clamp(s / (acc || 1), 0, 1)));
      const lift = 0.35;
      // dark outline under the ghost
      const ol = new THREE.Mesh(ribbon(pts, hs, ss, w / 2 + 0.55, lift - 0.02, [-1, 0]), this.outline);
      this.add(ol, 7);
      // runs of points at one level, each in that level's tint
      const lvlAt = (i: number) => clamp(Math.round(hs[i] / LEVEL_H), 0, 3);
      let i0 = 0;
      for (let i = 1; i <= pts.length; i++) {
        if (i < pts.length && lvlAt(i) === lvlAt(i0)) continue;
        const j0 = Math.max(0, i0 - 1), j1 = Math.min(pts.length, i + 1);
        const lv = lvlAt(i0);
        const mat = bad ? this.badMat : this.okMats[lv] ?? this.okMats[level];
        const sub_ = (a: number[] | P2[]) => a.slice(j0, j1);
        if (j1 - j0 >= 2) this.add(new THREE.Mesh(ribbon(sub_(pts) as P2[], sub_(hs) as number[], sub_(ss) as number[], w / 2, lift, [T.fwd, T.bwd], undefined, T.median ?? 0), mat.mat), 8);
        i0 = i;
      }
    }
  }

  /** Reference guides: the ones it snapped to in ochre, the others faint; each fades away from the cursor. */
  refs(gs: ToolGuide[], h = 0) {
    const y = h + LIFT;
    for (const g of gs) {
      const mats = g.on ? this.refOn : this.refOff;
      const dx = g.b.x - g.a.x, dy = g.b.y - g.a.y, L = Math.hypot(dx, dy);
      if (L < 0.5) continue;
      const ux = dx / L, uy = dy / L;
      const t = clamp((g.at.x - g.a.x) * ux + (g.at.y - g.a.y) * uy, 0, L);
      // bands out from where the cursor meets it: near, mid, far
      const bands = [40, 90, 1e9];
      for (const side of [-1, 1]) {
        let s0 = 0;
        for (const [k, b] of bands.entries()) {
          const a0 = t + side * s0, a1 = t + side * Math.min(b, side > 0 ? L - t : t);
          if ((side > 0 && a0 >= L) || (side < 0 && a0 <= 0)) break;
          const lo = Math.max(0, Math.min(a0, a1)), hi = Math.min(L, Math.max(a0, a1));
          if (hi - lo > 0.3) {
            const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(g.a.x + ux * lo, y, g.a.y + uy * lo), new THREE.Vector3(g.a.x + ux * hi, y, g.a.y + uy * hi)]);
            const l = new THREE.Line(geo, mats[k]);
            l.computeLineDistances();
            this.add(l, g.on ? 10 : 9);
          }
          s0 = b;
        }
      }
    }
  }

  /** What the cursor will join: the road washed in ochre, or a ring round the junction. */
  target(net: RoadNetwork, s: { node?: number; seg?: number; p: P2; h: number }) {
    if (s.node !== undefined) {
      const r = Math.max(4, (net.nodeGeom.get(s.node)?.radius ?? 4) + 1.5);
      const m = new THREE.Mesh(new THREE.RingGeometry(r, r + 1.1, 32).rotateX(-Math.PI / 2), this.targetRing);
      m.position.set(s.p.x, s.h + 1.3, s.p.y);
      this.add(m, 10);
    } else if (s.seg !== undefined) this.washSegs(net, [s.seg], this.targetMat);
  }

  /** A right-angle mark where two roads meet square: a small square in the corner. */
  rightAngle(p: P2, u: P2, v: P2, h: number, size: number) {
    // a solid cream L on a navy keyline, its stroke scaled with the mark so it reads on asphalt and on the preview
    const q = (a: number, b: number): P2 => ({ x: p.x + u.x * a + v.x * b, y: p.y + u.y * a + v.y * b });
    const w = size * 0.15;
    for (const [k, mat, order] of [[2.4, this.squareLine, 10], [1, this.squareMat, 11]] as const) {
      const e = (w * k) / 2;
      this.add(new THREE.Mesh(strip([q(size, -e), q(size, size + e)], h + 1.5, w * k), mat), order);
      this.add(new THREE.Mesh(strip([q(size + e, size), q(-e, size)], h + 1.5, w * k), mat), order);
    }
  }

  /** Where a bridge the road rises onto by itself starts and ends: a bar across each end of its deck. */
  bridge(sp: BridgeSpan, w: number) {
    const dx = sp.b.x - sp.a.x, dy = sp.b.y - sp.a.y, L = Math.hypot(dx, dy) || 1;
    const nx = -dy / L, ny = dx / L;
    for (const e of [sp.a, sp.b]) {
      const pts = [{ x: e.x - nx * (w / 2 + 2), y: e.y - ny * (w / 2 + 2) }, { x: e.x + nx * (w / 2 + 2), y: e.y + ny * (w / 2 + 2) }];
      this.add(new THREE.Mesh(strip(pts, sp.h + 1.4, 1.1), this.spanMat), 11);
    }
  }

  guides(gs: Guide[], h = 0) {
    for (const g of gs) {
      const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(g.a.x, h + LIFT, g.a.y), new THREE.Vector3(g.b.x, h + LIFT, g.b.y)]);
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
      // (it climbs the ramp with the road: one flat sheet at the top's height would hang off the low end)
      const m = new THREE.Mesh(strip(pts, Array.from(g.hs, (h) => h + 1.2), g.width + 1), mat);
      this.add(m, 8);
    }
  }

  /** Flat footprint on the ground (buildings to be bulldozed or blocking): the lot, seen through what stands on it. */
  footprint(corners: V2[], color: number, under = false) {
    const shape = new THREE.Shape(corners.map((p) => new THREE.Vector2(p.x, p.y)));
    const geo = new THREE.ShapeGeometry(shape).rotateX(Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: under ? 0.3 : 0.5, depthTest: false, side: THREE.DoubleSide }));
    // under a ghost model the footprint is a ground decal drawn first, so the model stays visible on top
    m.position.y = under ? 0.15 : LIFT;
    this.add(m, under ? 5 : 9);
  }

  /** A see-through building model where it would be placed (`held`: over another of the company's sites). */
  model(geo: THREE.BufferGeometry, m: THREE.Matrix4, ok: boolean | "held") {
    this.keep.add(geo);
    const mesh = new THREE.Mesh(geo, ok === "held" ? this.modelHeld : ok ? this.modelOk : this.modelBad);
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(m);
    this.add(mesh, 6);
  }

  /** A coloured line (a bus line being drawn, an outline, a reach) at a height, or at one per point. */
  path(pts: V2[], color: number, w = 2.6, h: number | number[] = 0) {
    if (pts.length < 2) return;
    const y = typeof h === "number" ? h + LIFT : h.map((v) => v + LIFT);
    const m = new THREE.Mesh(strip(pts, y, w), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, depthTest: false }));
    this.add(m, 12);
  }

  /** A ring marker in a colour (bus stops on the line being drawn). */
  dot(p: V2, color: number, r = 3.2, h = 0) {
    const geo = new THREE.CircleGeometry(r, 20).rotateX(-Math.PI / 2);
    const m = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color, depthTest: false }));
    m.position.set(p.x, h + LIFT + 0.1, p.y);
    this.add(m, 13);
    const o = new THREE.Mesh(new THREE.RingGeometry(r, r + 0.9, 20).rotateX(-Math.PI / 2), this.markerMat);
    o.position.set(p.x, h + LIFT + 0.2, p.y);
    this.add(o, 13);
  }

  setGhost(mesh: THREE.Mesh | null) {
    if (this.ghost) this.group.remove(this.ghost);
    this.ghost = mesh;
    if (mesh) this.group.add(mesh);
  }
}
