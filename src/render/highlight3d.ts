import * as THREE from "three";
import type { Game } from "../game/city";
import { routeLine, type FlowLine, type Related, type Ring } from "../ui/inspect";
import { poseInto } from "../ui/pick";
import { dkDir, dkSeg } from "../sim/router";
import type { Vehicle } from "../sim/traffic";

/**
 * What the inspector lights up on the map (docs/ui-style.md "Inspector"): the selected building's plot outlined in
 * ochre, the places it trades with in cream (suppliers) and amber (buyers), and the goods between them as
 * product-coloured arcs with arrowheads; a selected vehicle ringed, the way it has come faded and the way ahead as
 * dashes marching to its destination; a road's edges with every trip through it drawn along its whole route,
 * thicker where more of them share a road (CS's route view); a junction's approaches green or red as its lights
 * stand; reach as rings. Line widths follow the zoom (a few pixels at any scale). Everything is batched: one mesh
 * per layer, rebuilt only when what it shows or the zoom step changes, and the dashes move in the shader.
 */

const OCHRE = 0xf0c25a, CREAM = 0xf3ead6, NAVY = 0x0c1524, AMBER = 0xe0a833, BRICK = 0xd4573d, GREEN = 0x6fae5c;
const MAX_RINGS = 160;
/**
 * How far over the ground, or over the road it marks, a line floats (m). All of it is drawn over the scene (no depth
 * test, layered by render order), each line at the real height of what it marks: the camera is tilted, so a line
 * floating "above everything" would slide off the road or the plot it belongs to.
 */
const Y = 0.5;
/** dashes: one every this many screen pixels, moving at this many pixels a second (calm, never busy) */
const DASH_PX = 26, DASH_SPEED_PX = 16;

/** a piece of a line, a to b, and how high each end stands (0: on the ground) */
type Seg4 = [ax: number, ay: number, bx: number, by: number, ha?: number, hb?: number];

/** One mesh of flat quads, one per segment, each w wide and stretched past its ends by w/2 (so corners close). */
function quads(segs: Seg4[], w: number, y: number, ext = true): THREE.BufferGeometry {
  const pos = new Float32Array(segs.length * 18);
  let o = 0;
  for (const [ax, ay, bx, by, ha = 0, hb = 0] of segs) {
    const L = Math.hypot(bx - ax, by - ay) || 1;
    const ux = (bx - ax) / L, uy = (by - ay) / L, nx = -uy * w * 0.5, ny = ux * w * 0.5;
    const e = ext ? w * 0.5 : 0;
    const x0 = ax - ux * e, y0 = ay - uy * e, x1 = bx + ux * e, y1 = by + uy * e;
    const P = [x0 + nx, y0 + ny, x0 - nx, y0 - ny, x1 - nx, y1 - ny, x0 + nx, y0 + ny, x1 - nx, y1 - ny, x1 + nx, y1 + ny];
    // (corners 0, 1 and 3 are at a, the others at b)
    for (let i = 0; i < 6; i++) { pos[o++] = P[i * 2]; pos[o++] = y + (i < 2 || i === 3 ? ha : hb); pos[o++] = P[i * 2 + 1]; }
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

/** The shared clock of the marching dashes: uT (m along the line) and uP (m per dash period). */
const DASH = { uT: { value: 0 }, uP: { value: 20 } };

/**
 * Lines drawn in one batch: each vertex carries its colour (sRGB, written out as is), alpha, its distance along its
 * line and whether that line is dashed; a dashed line shows bright dashes marching along it over a faint run of
 * the same colour, so it reads as one line even between them.
 */
const lineMat = new THREE.ShaderMaterial({
  uniforms: DASH,
  vertexShader: `
    attribute vec3 lcol; attribute float la; attribute float ld; attribute float lk;
    varying vec3 vC; varying float vA; varying float vD; varying float vK;
    void main() { vC = lcol; vA = la; vD = ld; vK = lk; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
    uniform float uT; uniform float uP;
    varying vec3 vC; varying float vA; varying float vD; varying float vK;
    void main() {
      float a = vA;
      if (vK > 0.5) a *= fract((vD - uT) / uP) < 0.55 ? 1.0 : 0.3;
      gl_FragColor = vec4(vC, a);
    }`,
  transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
});

/** Builds one batch of lines, arrowheads and discs. */
class LineBuf {
  private p: number[] = [];
  private c: number[] = [];
  private a: number[] = [];
  private d: number[] = [];
  private k: number[] = [];
  private i: number[] = [];

  get empty() { return this.i.length === 0; }

  private vert(x: number, y: number, z: number, col: number, al: number, d: number, k: number) {
    this.p.push(x, y, z);
    this.c.push(((col >> 16) & 255) / 255, ((col >> 8) & 255) / 255, (col & 255) / 255);
    this.a.push(al); this.d.push(d); this.k.push(k);
    return this.p.length / 3 - 1;
  }

  /**
   * A polyline (x, y pairs) w wide at height y, mitred at its bends. `d0`: the distance along it its first point
   * stands at (dash phase); `dashed`: marching dashes; `H`: how high over y each point stands (a route over a bridge).
   */
  line(P: ArrayLike<number>, w: number, y: number, col: number, al: number, dashed = false, d0 = 0, H?: ArrayLike<number>) {
    // (repeated points would have no direction)
    const Q: number[] = [], QH: number[] = [];
    for (let j = 0; j < P.length; j += 2) {
      const n = Q.length;
      if (n && Math.abs(Q[n - 2] - P[j]) < 0.05 && Math.abs(Q[n - 1] - P[j + 1]) < 0.05) continue;
      Q.push(P[j], P[j + 1]);
      QH.push(H ? H[j / 2] ?? 0 : 0);
    }
    const m = Q.length / 2;
    if (m < 2) return;
    const h = w / 2, kk = dashed ? 1 : 0;
    let dist = d0, prev = -1;
    for (let j = 0; j < m; j++) {
      const x = Q[2 * j], z = Q[2 * j + 1];
      const jp = Math.max(0, j - 1), jn = Math.min(m - 1, j + 1);
      let ax = x - Q[2 * jp], az = z - Q[2 * jp + 1], bx = Q[2 * jn] - x, bz = Q[2 * jn + 1] - z;
      const la = Math.hypot(ax, az), lb = Math.hypot(bx, bz);
      if (la < 1e-6) { ax = bx; az = bz; } else { ax /= la; az /= la; }
      if (lb < 1e-6) { bx = ax; bz = az; } else { bx /= lb; bz /= lb; }
      if (la < 1e-6) { ax = bx; az = bz; }
      // the mitre: the average of the two normals, lengthened so the edges keep their width (capped at sharp bends)
      let nx = -(az + bz), nz = ax + bx;
      const nl = Math.hypot(nx, nz) || 1;
      nx /= nl; nz /= nl;
      const s = h / Math.max(0.4, nx * -az + nz * ax);
      if (j > 0) dist += la;
      const v0 = this.vert(x + nx * s, y + QH[j], z + nz * s, col, al, dist, kk);
      this.vert(x - nx * s, y + QH[j], z - nz * s, col, al, dist, kk);
      if (prev >= 0) this.i.push(prev, prev + 1, v0, prev + 1, v0 + 1, v0);
      prev = v0;
    }
  }

  tri(ax: number, az: number, bx: number, bz: number, cx: number, cz: number, y: number, col: number, al: number) {
    const v = this.vert(ax, y, az, col, al, 0, 0);
    this.vert(bx, y, bz, col, al, 0, 0);
    this.vert(cx, y, cz, col, al, 0, 0);
    this.i.push(v, v + 1, v + 2);
  }

  /** A filled disc (a reach's faint wash). */
  disc(cx: number, cz: number, r: number, y: number, col: number, al: number, n = 72) {
    const c = this.vert(cx, y, cz, col, al, 0, 0);
    for (let j = 0; j <= n; j++) this.vert(cx + Math.cos((j / n) * Math.PI * 2) * r, y, cz + Math.sin((j / n) * Math.PI * 2) * r, col, al, 0, 0);
    for (let j = 0; j < n; j++) this.i.push(c, c + 1 + j, c + 2 + j);
  }

  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.p, 3));
    g.setAttribute("lcol", new THREE.Float32BufferAttribute(this.c, 3));
    g.setAttribute("la", new THREE.Float32BufferAttribute(this.a, 1));
    g.setAttribute("ld", new THREE.Float32BufferAttribute(this.d, 1));
    g.setAttribute("lk", new THREE.Float32BufferAttribute(this.k, 1));
    g.setIndex(this.i);
    return g;
  }
}

/** A circle as a closed polyline. */
function circle(cx: number, cz: number, r: number, n = 96): number[] {
  const P: number[] = [];
  for (let j = 0; j <= n; j++) P.push(cx + Math.cos((j / n) * Math.PI * 2) * r, cz + Math.sin((j / n) * Math.PI * 2) * r);
  return P;
}

/**
 * A flow's arc from a to b (short of each end by ra / rb), bowed a little to its left so a run there and back shows
 * as two lines; with its arrowhead at b.
 */
function arc(f: FlowLine, mpp: number): { pts: number[]; tip: [number, number]; dir: [number, number] } | null {
  const dx = f.b.x - f.a.x, dy = f.b.y - f.a.y, L = Math.hypot(dx, dy);
  const ra = Math.min(f.ra ?? 0, L * 0.3), rb = Math.min(f.rb ?? 0, L * 0.3);
  if (L - ra - rb < 6 * mpp) return null;
  const ux = dx / L, uy = dy / L;
  const ax = f.a.x + ux * ra, ay = f.a.y + uy * ra, bx = f.b.x - ux * rb, by = f.b.y - uy * rb;
  const bow = Math.min(L * 0.12, 900);
  const cx = (ax + bx) / 2 - uy * bow, cy = (ay + by) / 2 + ux * bow;
  const pts: number[] = [];
  const N = 32;
  for (let j = 0; j <= N; j++) {
    const t = j / N, s = 1 - t;
    pts.push(s * s * ax + 2 * s * t * cx + t * t * bx, s * s * ay + 2 * s * t * cy + t * t * by);
  }
  const tx = bx - cx, ty = by - cy, tl = Math.hypot(tx, ty) || 1;
  return { pts, tip: [bx, by], dir: [tx / tl, ty / tl] };
}

export class Highlight3D {
  readonly group = new THREE.Group();
  private statics: THREE.Object3D[] = [];
  private routeMeshes: THREE.Object3D[] = [];
  private tripMeshes: THREE.Object3D[] = [];
  private rel: Related | null = null;
  private key = "";
  private tripKey = "";
  private tripT = 0;
  private routeT = 0;
  private selfMat = mat(OCHRE, 0.95);
  private selfFill = mat(OCHRE, 0.14);
  private fromMat = mat(CREAM, 0.85);
  private toMat = mat(AMBER, 0.9);
  private underMat = mat(NAVY, 0.55);
  private segMats = { plain: mat(OCHRE, 0.95), go: mat(GREEN, 0.95), stop: mat(BRICK, 0.95), bad: mat(BRICK, 0.95) };
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
  /** the road pieces the selected vehicle has driven since it was selected (its plan forgets them when it reroutes) */
  private trailV = -1;
  private trail: number[] = [];
  private trailAt: number | undefined;
  private still = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

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

  private clear(list: THREE.Object3D[]) {
    for (const o of list) { this.group.remove(o); (o as THREE.Mesh).geometry.dispose(); }
    list.length = 0;
  }

  private add(list: THREE.Object3D[], geo: THREE.BufferGeometry, m: THREE.Material, order: number) {
    const o = new THREE.Mesh(geo, m);
    o.renderOrder = order;
    o.frustumCulled = false;
    this.group.add(o);
    list.push(o);
  }

  private addLines(list: THREE.Object3D[], buf: LineBuf, order: number) {
    if (!buf.empty) this.add(list, buf.geometry(), lineMat, order);
  }

  /** Every frame: rebuild what changed, move the rings and the dashes, pulse the selection. */
  update(g: Game, alpha: number, mpp: number, dt: number) {
    const rel = this.rel;
    // the zoom step: line widths are a few pixels, rebuilt each time the scale moves by ~40%
    const step = Math.round(Math.log2(Math.max(0.05, mpp)) * 2);
    const smpp = Math.pow(2, step / 2);
    const key = rel ? `${step}|${rel.self}|${rel.from}|${rel.to}|${rel.segs}|${JSON.stringify(rel.segTone ?? null)}|${flowKey(rel.flows)}|${ringKey(rel.rings)}` : "";
    if (key !== this.key) { this.key = key; this.rebuild(g, smpp); this.routeT = 0; }
    DASH.uP.value = DASH_PX * smpp;
    if (!this.still) DASH.uT.value = (DASH.uT.value + dt * DASH_SPEED_PX * mpp) % (DASH.uP.value * 1000);
    // the trips through a road: redrawn when they change, at most about twice a second
    this.tripT -= dt;
    const tk = rel?.routes?.length ? `${step}|${[...rel.routes].sort((a, b) => a - b).join(",")}` : "";
    if (tk !== this.tripKey && (this.tripT <= 0 || !tk || !this.tripKey || tk.split("|")[0] !== this.tripKey.split("|")[0])) {
      this.tripKey = tk;
      this.tripT = 0.5;
      this.clear(this.tripMeshes);
      if (tk) this.drawTrips(g, rel!.routes!, smpp);
    }
    // the route ahead shortens as it drives: redrawn a few times a second
    this.routeT -= dt;
    let v: Vehicle | undefined;
    if (rel?.route !== undefined) for (const x of g.traffic.vehicles) if (x.id === rel.route) { v = x; break; }
    if (v) this.track(v);
    else this.trailV = -1;
    if (this.routeT <= 0) {
      this.routeT = 0.3;
      this.clear(this.routeMeshes);
      if (v) this.drawRoute(g, v, smpp);
    }
    // the selected vehicle's ring, sized to its body and never under ~11 px
    if (v) {
      const c = this.centre(v, alpha), r = Math.max(v.len * 0.62 + 2, 11 * mpp);
      const vh = v.ph + (v.h - v.ph) * alpha + Y;
      this.ring.position.set(c.x, vh, c.y);
      this.ring.scale.setScalar(r);
      this.ringBack.position.set(c.x, vh, c.y);
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
        this.p.set(c.x, o.ph + (o.h - o.ph) * alpha + Y, c.y);
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
      this.hover.position.set(c.x, h.ph + (h.h - h.ph) * alpha + Y, c.y);
      this.hover.scale.setScalar(Math.max(h.len * 0.62 + 2, 10 * mpp));
    }
    this.hover.visible = !!h;
    // a slow pulse on the selection itself, so it reads as "this one"
    const k = this.still ? 1 : 0.5 + 0.5 * Math.sin(performance.now() / 260);
    this.selfMat.opacity = 0.7 + 0.3 * k;
    this.ringMat.opacity = 0.75 + 0.25 * k;
  }

  /** Keep the road pieces the selected vehicle has driven, whatever its plan does meanwhile. */
  private track(v: Vehicle) {
    if (v.id !== this.trailV) {
      this.trailV = v.id;
      this.trail = v.route.slice(0, Math.max(0, v.ri));
      this.trailAt = v.route[v.ri];
      return;
    }
    const cur = v.route[v.ri];
    if (cur === this.trailAt) return;
    if (this.trailAt !== undefined && this.trail[this.trail.length - 1] !== this.trailAt) this.trail.push(this.trailAt);
    this.trailAt = cur;
    if (this.trail.length > 400) this.trail.splice(0, this.trail.length - 400);
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
    // reach and extent first: under everything else
    if (rel.rings?.length) this.drawRings(rel.rings, mpp);
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
        if (fill) this.add(this.statics, rectFill(b.c, hw, hd, b.rot, Y), fill, 12);
      }
      if (!segs.length) return;
      this.add(this.statics, quads(segs, w(px + 2.5, 2.4), Y), this.underMat, 13);
      this.add(this.statics, quads(segs, w(px, 1.4), Y), m, 14);
    };
    const self = new Set(rel.self);
    outline(rel.from.filter((id) => !self.has(id)), this.fromMat, 2.5);
    outline(rel.to.filter((id) => !self.has(id)), this.toMat, 2.5);
    outline(rel.self, this.selfMat, 3.5, this.selfFill);
    // a road piece: lines down both its edges (the traffic on it stays in plain sight between them), ochre, or
    // green / red for a junction's approaches as its lights stand
    if (rel.segs.length) {
      const lw = w(3, 1.2);
      const by = new Map<THREE.Material, Seg4[]>();
      for (const id of rel.segs) {
        const geo = g.net.segGeom.get(id);
        if (!geo) continue;
        const tone = rel.segTone?.[id];
        const m = tone ? this.segMats[tone] : this.segMats.plain;
        if (!by.has(m)) by.set(m, []);
        const segs = by.get(m)!;
        const P = geo.center.pts, off = geo.width / 2 + lw / 2 + 0.4;
        for (const side of [1, -1]) {
          let px = 0, py = 0;
          // (each edge line climbs with its road)
          for (let i = 0; i < P.length; i++) {
            // the normal at a vertex: the average of its two pieces' (corners stay the road's width out)
            const a = P[Math.max(0, i - 1)], c = P[Math.min(P.length - 1, i + 1)];
            const L = Math.hypot(c.x - a.x, c.y - a.y) || 1;
            const x = P[i].x - ((c.y - a.y) / L) * off * side, y = P[i].y + ((c.x - a.x) / L) * off * side;
            if (i > 0) segs.push([px, py, x, y, geo.hs[i - 1], geo.hs[i]]);
            px = x; py = y;
          }
        }
      }
      for (const [m, segs] of by) {
        this.add(this.statics, quads(segs, lw + w(2.5, 1.6), Y), this.underMat, 13);
        this.add(this.statics, quads(segs, lw, Y), m, 14);
      }
    }
    if (rel.flows?.length) this.drawFlows(rel.flows, mpp);
  }

  /** Goods and people between places: arcs over a navy underlay, marching dashes, an arrowhead at the far end. */
  private drawFlows(flows: FlowLine[], mpp: number) {
    const under = new LineBuf(), top = new LineBuf();
    for (const f of flows) {
      const a = arc(f, mpp);
      if (!a) continue;
      const goods = f.kind === "goods";
      const wpx = goods ? 2.6 + 1.3 * Math.min(4, Math.sqrt(f.n)) : 1.6 + 0.9 * Math.min(4, Math.sqrt(f.n));
      const w = Math.max(0.8, wpx * mpp);
      const al = (goods ? 12 : 9) * mpp + w, aw = (goods ? 6 : 4.5) * mpp + w * 0.9;
      // (the line stops inside the arrowhead, which points along the arc's last stretch)
      const [tx, ty] = a.tip, [dx, dy] = a.dir;
      const P = a.pts;
      let cut = P.length;
      while (cut > 4 && Math.hypot(P[cut - 2] - tx, P[cut - 1] - ty) < al * 0.7) cut -= 2;
      const body = P.slice(0, cut);
      body.push(tx - dx * al * 0.7, ty - dy * al * 0.7);
      // (dashes count back from the head, so they all arrive together)
      let len = 0;
      for (let j = 2; j < body.length; j += 2) len += Math.hypot(body[j] - body[j - 2], body[j + 1] - body[j - 1]);
      const bx = tx - dx * al, by = ty - dy * al;
      under.line(body, w + Math.max(1.4, 2.6 * mpp), Y, NAVY, 0.5);
      const ua = aw + 1.6 * mpp, ul = al + 2 * mpp;
      under.tri(tx + dx * 1.6 * mpp, ty + dy * 1.6 * mpp, tx - dx * ul - dy * ua, ty - dy * ul + dx * ua, tx - dx * ul + dy * ua, ty - dy * ul - dx * ua, Y, NAVY, 0.5);
      top.line(body, w, Y, f.color, 0.95, true, -len);
      top.tri(tx, ty, bx - dy * aw, by + dx * aw, bx + dy * aw, by - dx * aw, Y, f.color, 1);
    }
    this.addLines(this.statics, under, 15);
    this.addLines(this.statics, top, 16);
  }

  /** Rings on the ground: a reach (ochre, a faint wash inside), a deposit (cream dashes), a spot (brick), here (a small mark). */
  private drawRings(rings: Ring[], mpp: number) {
    const fill = new LineBuf(), under = new LineBuf(), top = new LineBuf();
    for (const r of rings) {
      if (r.tone === "here") {
        // where you clicked: a small ochre ring with a dot
        const R = 9 * mpp;
        under.line(circle(r.c.x, r.c.y, R, 32), 5 * mpp, Y, NAVY, 0.6);
        top.line(circle(r.c.x, r.c.y, R, 32), 2.4 * mpp, Y, OCHRE, 1);
        fill.disc(r.c.x, r.c.y, 2.6 * mpp, Y, OCHRE, 1, 16);
        continue;
      }
      const col = r.tone === "reach" ? OCHRE : r.tone === "spot" ? BRICK : CREAM;
      if (r.tone === "reach") fill.disc(r.c.x, r.c.y, r.r, Y, OCHRE, 0.07);
      const P = circle(r.c.x, r.c.y, r.r, r.r > 1500 ? 160 : 96);
      const w = Math.max(1, 2.4 * mpp);
      under.line(P, w + Math.max(1.4, 2.6 * mpp), Y, NAVY, 0.5);
      top.line(P, w, Y, col, 0.95, r.tone === "deposit");
    }
    this.addLines(this.statics, fill, 10);
    this.addLines(this.statics, under, 11);
    this.addLines(this.statics, top, 11);
  }

  /**
   * The trips through a road (CS's route view): every one's whole route, on the lanes they drive, so the two ways
   * show apart; thicker where more of them share a road, ochre for the company's freight and cream for the rest,
   * dashes marching the way they go.
   */
  private drawTrips(g: Game, ids: number[], mpp: number) {
    const want = new Set(ids);
    const n = new Map<number, number>(), fr = new Map<number, number>();
    for (const v of g.traffic.vehicles) {
      if (!want.has(v.id)) continue;
      const seen = new Set<number>();
      for (const k of v.route) {
        if (seen.has(k)) continue;
        seen.add(k);
        n.set(k, (n.get(k) ?? 0) + 1);
        if (v.trip.haul) fr.set(k, (fr.get(k) ?? 0) + 1);
      }
    }
    let most = 1;
    for (const x of n.values()) most = Math.max(most, x);
    const under = new LineBuf(), top = new LineBuf();
    for (const [k, c] of n) {
      const geo = g.net.segGeom.get(dkSeg(k));
      if (!geo) continue;
      const dir = dkDir(k);
      const ls = geo.lanes.filter((l) => l.dir === dir && !l.pocket);
      if (!ls.length) continue;
      const lane = ls[Math.floor(ls.length / 2)];
      const P: number[] = [];
      for (const p of lane.pl.pts) P.push(p.x, p.y);
      const w = Math.max(0.8, (1.8 + 3.6 * Math.sqrt(c / most)) * mpp);
      const share = (fr.get(k) ?? 0) / c;
      under.line(P, w + Math.max(1.2, 2.2 * mpp), Y, NAVY, 0.45, false, 0, lane.hs);
      top.line(P, w, Y, share >= 0.5 ? AMBER : CREAM, 0.9, true, 0, lane.hs);
    }
    this.addLines(this.tripMeshes, under, 12);
    this.addLines(this.tripMeshes, top, 13);
  }

  /** The selected vehicle's route: the way it came, faded; the way ahead, dashes marching to where it is going. */
  private drawRoute(g: Game, v: Vehicle, mpp: number) {
    const { pts, cut, hs } = routeLine(g, v, this.trailV === v.id ? this.trail : undefined);
    const w = Math.max(1.6, 3 * mpp);
    const behind = pts.slice(0, cut * 2 + 2), ahead = pts.slice(cut * 2);
    const hBehind = hs.slice(0, cut + 1), hAhead = hs.slice(cut);
    const under = new LineBuf(), top = new LineBuf();
    if (behind.length >= 4) top.line(behind, w * 0.8, Y, CREAM, 0.4, false, 0, hBehind);
    if (ahead.length >= 4) {
      // (the dash pattern counts back from the destination, so the dashes don't jump as the route shortens)
      let len = 0;
      for (let j = 2; j < ahead.length; j += 2) len += Math.hypot(ahead[j] - ahead[j - 2], ahead[j + 1] - ahead[j - 1]);
      under.line(ahead, w + Math.max(1.6, 3 * mpp), Y, NAVY, 0.5, false, 0, hAhead);
      top.line(ahead, w, Y, CREAM, 0.95, true, -len, hAhead);
      // its destination: a small cream square at the route's end
      const ex = ahead[ahead.length - 2], ey = ahead[ahead.length - 1], s = 5 * mpp;
      top.line([ex - s, ey, ex + s, ey], s * 2, Y + hAhead[hAhead.length - 1], CREAM, 1);
    }
    this.addLines(this.routeMeshes, under, 13);
    this.addLines(this.routeMeshes, top, 14);
  }
}

const flowKey = (f?: FlowLine[]) => (f ?? []).map((x) => `${Math.round(x.a.x)},${Math.round(x.a.y)}>${Math.round(x.b.x)},${Math.round(x.b.y)}:${x.color}:${Math.min(16, x.n)}`).join(";");
const ringKey = (r?: Ring[]) => (r ?? []).map((x) => `${Math.round(x.c.x)},${Math.round(x.c.y)},${Math.round(x.r)},${x.tone}`).join(";");
