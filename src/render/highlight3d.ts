import * as THREE from "three";
import type { Game } from "../game/city";
import type { Related } from "../ui/inspect";
import { poseInto, poseOf } from "../ui/pick";
import { dkDir, dkSeg } from "../sim/router";
import type { Vehicle } from "../sim/traffic";

/**
 * What the inspector lights up on the map (docs/ui-style.md "Inspector"): the selected building's plot outlined in
 * ochre, the sites it trades with in cream (suppliers) and ochre (buyers), a selected vehicle ringed with its
 * remaining route as a dashed line, its own trucks on the road ringed small, and a selected road washed ochre.
 * Line widths follow the zoom (a few pixels at any scale); the static pieces are rebuilt only when the selection or
 * the zoom step changes, and the rings move every frame without allocating.
 */

const OCHRE = 0xf0c25a, CREAM = 0xf3ead6, NAVY = 0x0c1524, AMBER = 0xe0a833;
const MAX_RINGS = 160;
/** drawn over everything (the map is seen from straight above) */
const Y = 34;

type Seg4 = [number, number, number, number];

/** One mesh of flat quads, one per segment, each w wide and stretched past its ends by w/2 (so corners close). */
function quads(segs: Seg4[], w: number, y: number, ext = true): THREE.BufferGeometry {
  const pos = new Float32Array(segs.length * 18);
  let o = 0;
  for (const [ax, ay, bx, by] of segs) {
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * w * 0.5, ny = ux * w * 0.5;
    const e = ext ? w * 0.5 : 0;
    const x0 = ax - ux * e, y0 = ay - uy * e, x1 = bx + ux * e, y1 = by + uy * e;
    const P = [x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, x0 + nx, y0 + ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny];
    for (let i = 0; i < 6; i++) { pos[o++] = P[i * 2]; pos[o++] = y; pos[o++] = P[i * 2 + 1]; }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

/** A filled quad (a plot's wash). */
function rectFill(c: { x: number; y: number }, hw: number, hd: number, rot: number, y: number): THREE.BufferGeometry {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const pt = (u: number, v: number) => [c.x + u * cs - v * sn, c.y + u * sn + v * cs];
  const [a, b, d, e] = [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
  const pos = new Float32Array([a[0], y, a[1], b[0], y, b[1], d[0], y, d[1], a[0], y, a[1], d[0], y, d[1], e[0], y, e[1]]);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  return g;
}

const mat = (color: number, opacity: number) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, depthWrite: false, side: THREE.DoubleSide });

export class Highlight3D {
  readonly group = new THREE.Group();
  private statics: THREE.Mesh[] = [];
  private routeMeshes: THREE.Mesh[] = [];
  private rel: Related | null = null;
  private key = "";
  private routeT = 0;
  private selfMat = mat(OCHRE, 0.95);
  private selfFill = mat(OCHRE, 0.14);
  private fromMat = mat(CREAM, 0.85);
  private toMat = mat(AMBER, 0.9);
  private underMat = mat(NAVY, 0.55);
  private segMat = mat(OCHRE, 0.95);
  private routeMat = mat(CREAM, 0.95);
  private routeUnder = mat(NAVY, 0.5);
  private ringMat = mat(OCHRE, 1);
  private ringUnder = mat(NAVY, 0.6);
  private ringGeo = new THREE.RingGeometry(0.78, 1, 40).rotateX(-Math.PI / 2);
  private ring = new THREE.Mesh(this.ringGeo, this.ringMat);
  private ringBack = new THREE.Mesh(new THREE.RingGeometry(0.7, 1.08, 40).rotateX(-Math.PI / 2), this.ringUnder);
  private small: THREE.InstancedMesh;
  /** the vehicle under the cursor (inspect tool): a thin cream ring, moved every frame */
  hoverV: number | null = null;
  private hover = new THREE.Mesh(new THREE.RingGeometry(0.86, 1, 40).rotateX(-Math.PI / 2), mat(CREAM, 0.8));
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private s = new THREE.Vector3();
  private p = new THREE.Vector3();

  constructor() {
    this.group.name = "highlight";
    this.ring.renderOrder = 16;
    this.ringBack.renderOrder = 15;
    this.ring.visible = this.ringBack.visible = false;
    this.small = new THREE.InstancedMesh(this.ringGeo, mat(AMBER, 0.95), MAX_RINGS);
    this.small.renderOrder = 15;
    this.small.count = 0;
    this.small.frustumCulled = false;
    this.ring.frustumCulled = this.ringBack.frustumCulled = false;
    this.hover.renderOrder = 14;
    this.hover.visible = false;
    this.hover.frustumCulled = false;
    this.group.add(this.ring, this.ringBack, this.small, this.hover);
  }

  /** What to light up (null: nothing selected). */
  set(rel: Related | null) {
    this.rel = rel;
    this.want = new Set(rel?.vehicles ?? []);
  }
  private want = new Set<number>();
  private c = { x: 0, y: 0 };

  private clear(list: THREE.Mesh[]) {
    for (const o of list) { this.group.remove(o); o.geometry.dispose(); }
    list.length = 0;
  }

  private add(list: THREE.Mesh[], geo: THREE.BufferGeometry, m: THREE.Material, order: number) {
    const o = new THREE.Mesh(geo, m);
    o.renderOrder = order;
    o.frustumCulled = false;
    this.group.add(o);
    list.push(o);
  }

  /** Every frame: rebuild what changed, move the rings, pulse the selection. */
  update(g: Game, alpha: number, mpp: number, dt: number) {
    const rel = this.rel;
    // the zoom step: line widths are a few pixels, rebuilt each time the scale moves by ~40%
    const step = Math.round(Math.log2(Math.max(0.05, mpp)) * 2);
    const key = rel ? `${step}|${rel.self}|${rel.from}|${rel.to}|${rel.segs}` : "";
    if (key !== this.key) { this.key = key; this.rebuild(g, Math.pow(2, step / 2)); this.routeT = 0; }
    // the route ahead shortens as it drives: redrawn a few times a second
    this.routeT -= dt;
    let v: Vehicle | undefined;
    if (rel?.route !== undefined) for (const x of g.traffic.vehicles) if (x.id === rel.route) { v = x; break; }
    if (this.routeT <= 0) {
      this.routeT = 0.35;
      this.clear(this.routeMeshes);
      if (v) this.drawRoute(g, v, Math.pow(2, step / 2));
    }
    // the selected vehicle's ring, sized to its body and never under ~11 px
    if (v) {
      const c = this.centre(v, alpha), r = Math.max(v.len * 0.62 + 2, 11 * mpp);
      this.ring.position.set(c.x, Y + 1, c.y);
      this.ring.scale.setScalar(r);
      this.ringBack.position.set(c.x, Y + 0.9, c.y);
      this.ringBack.scale.setScalar(r);
    }
    this.ring.visible = this.ringBack.visible = !!v;
    // small rings round the related vehicles (a site's trucks out on the road)
    let n = 0;
    if (rel && rel.vehicles.length) {
      const want = this.want;
      const rr = Math.max(4.5, 6 * mpp);
      for (const o of g.traffic.vehicles) {
        if (n >= MAX_RINGS || !want.has(o.id) || o.id === rel.route) continue;
        const c = this.centre(o, alpha);
        this.p.set(c.x, Y + 0.5, c.y);
        this.s.setScalar(Math.max(rr, o.len * 0.55 + 1.5));
        this.m.compose(this.p, this.q, this.s);
        this.small.setMatrixAt(n++, this.m);
      }
    }
    this.small.count = n;
    this.small.instanceMatrix.needsUpdate = true;
    // the hovered vehicle (not the selected one: that already has its ring)
    let h: Vehicle | undefined;
    if (this.hoverV !== null && this.hoverV !== rel?.route) for (const x of g.traffic.vehicles) if (x.id === this.hoverV) { h = x; break; }
    if (h) {
      const c = this.centre(h, alpha);
      this.hover.position.set(c.x, Y + 0.7, c.y);
      this.hover.scale.setScalar(Math.max(h.len * 0.62 + 2, 10 * mpp));
    }
    this.hover.visible = !!h;
    // a slow pulse on the selection itself, so it reads as "this one"
    const k = 0.5 + 0.5 * Math.sin(performance.now() / 260);
    this.selfMat.opacity = 0.7 + 0.3 * k;
    this.ringMat.opacity = 0.75 + 0.25 * k;
  }

  /** Where to centre a ring on a vehicle (written into one reused point: this runs every frame for many). */
  private centre(v: Vehicle, alpha: number): { x: number; y: number } {
    const q = poseInto(v, alpha, this.pose);
    this.c.x = q.x - Math.cos(q.ang) * v.len * 0.4;
    this.c.y = q.y - Math.sin(q.ang) * v.len * 0.4;
    return this.c;
  }
  private pose = { x: 0, y: 0, ang: 0 };

  private rebuild(g: Game, mpp: number) {
    this.clear(this.statics);
    const rel = this.rel;
    if (!rel) return;
    const w = (px: number, min: number) => Math.max(min, px * mpp);
    const outline = (ids: number[], m: THREE.Material, px: number, fill?: THREE.Material) => {
      const segs: Seg4[] = [];
      for (const id of ids) {
        const b = g.buildings.byId.get(id);
        if (!b) continue;
        const cs = Math.cos(b.rot), sn = Math.sin(b.rot);
        // (a little outside the plot, so the line sits on the ground round it, not on its fence)
        const pad = w(px * 1.5, 1.5);
        const hw = b.hw + pad, hd = b.hd + pad;
        const pt = (u: number, v: number): [number, number] => [b.c.x + u * cs - v * sn, b.c.y + u * sn + v * cs];
        const cn = [pt(-hw, -hd), pt(hw, -hd), pt(hw, hd), pt(-hw, hd)];
        for (let i = 0; i < 4; i++) segs.push([cn[i][0], cn[i][1], cn[(i + 1) % 4][0], cn[(i + 1) % 4][1]]);
        if (fill) this.add(this.statics, rectFill(b.c, hw, hd, b.rot, Y - 2), fill, 12);
      }
      if (!segs.length) return;
      this.add(this.statics, quads(segs, w(px + 2.5, 2.4), Y - 1), this.underMat, 13);
      this.add(this.statics, quads(segs, w(px, 1.4), Y), m, 14);
    };
    const self = new Set(rel.self);
    outline(rel.from.filter((id) => !self.has(id)), this.fromMat, 2.5);
    outline(rel.to.filter((id) => !self.has(id)), this.toMat, 2.5);
    outline(rel.self, this.selfMat, 3.5, this.selfFill);
    // a road piece: ochre lines down both its edges (the traffic on it stays in plain sight between them)
    if (rel.segs.length) {
      const segs: Seg4[] = [];
      const lw = w(3, 1.2);
      for (const id of rel.segs) {
        const geo = g.net.segGeom.get(id);
        if (!geo) continue;
        const P = geo.center.pts, off = geo.width / 2 + lw / 2 + 0.4;
        for (const side of [1, -1]) {
          let px = 0, py = 0;
          for (let i = 0; i < P.length; i++) {
            // the normal at a vertex: the average of its two pieces' (corners stay the road's width out)
            const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)];
            const L = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            const x = P[i].x - ((c.y - a.y) / L) * off * side, y = P[i].y + ((c.x - a.x) / L) * off * side;
            if (i > 0) segs.push([px, py, x, y]);
            px = x; py = y;
          }
        }
      }
      if (segs.length) {
        this.add(this.statics, quads(segs, lw + w(2.5, 1.6), Y - 1), this.underMat, 13);
        this.add(this.statics, quads(segs, lw, Y), this.segMat, 14);
      }
    }
  }

  /** The vehicle's way ahead: a dark underlay and cream dashes that stay put on the ground as it drives along them. */
  private drawRoute(g: Game, v: Vehicle, mpp: number) {
    const pts: number[] = [];
    const pl = v.edge.pl;
    // the rest of the edge it is on
    const q = poseOf(v, 1);
    pts.push(q.x, q.y);
    for (let i = 0; i < pl.pts.length; i++) if (pl.cum[i] > v.s) pts.push(pl.pts[i].x, pl.pts[i].y);
    for (let i = v.ri + 1; i < v.route.length; i++) {
      const geo = g.net.segGeom.get(dkSeg(v.route[i]));
      if (!geo) continue;
      const P = geo.center.pts;
      if (dkDir(v.route[i]) === 1) for (const p of P) pts.push(p.x, p.y);
      else for (let j = P.length - 1; j >= 0; j--) pts.push(P[j].x, P[j].y);
    }
    if (pts.length < 4) return;
    const under: Seg4[] = [], dash: Seg4[] = [];
    let total = 0;
    for (let i = 2; i < pts.length; i += 2) total += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
    const D = Math.max(5, 9 * mpp), G = D * 0.8, period = D + G;
    // (the dash pattern is counted back from the destination, so it doesn't crawl as the route shortens)
    let s = -(total % period) + period;
    for (let i = 2; i < pts.length; i += 2) {
      const ax = pts[i - 2], ay = pts[i - 1], bx = pts[i], by = pts[i + 1];
      const L = Math.hypot(bx - ax, by - ay);
      if (L < 1e-3) continue;
      under.push([ax, ay, bx, by]);
      let t = 0;
      while (t < L) {
        const ph = (s + t) % period;
        if (ph < D) {
          const e = Math.min(L, t + (D - ph));
          dash.push([ax + ((bx - ax) * t) / L, ay + ((by - ay) * t) / L, ax + ((bx - ax) * e) / L, ay + ((by - ay) * e) / L]);
          t = e;
        } else t += period - ph;
      }
      s += L;
    }
    const w = Math.max(1.6, 3 * mpp);
    this.add(this.routeMeshes, quads(under, w + Math.max(1.6, 3 * mpp), Y - 1.5, false), this.routeUnder, 13);
    this.add(this.routeMeshes, quads(dash, w, Y - 0.5, false), this.routeMat, 14);
  }
}
