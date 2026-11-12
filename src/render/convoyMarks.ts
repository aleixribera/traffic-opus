// Oversized-load convoys, marked on the road itself (docs/design.md, "Freight: oversized loads"): a band of hazard
// tape round each convoy, amber and dark stripes creeping the way it goes, over a faint amber pool. With the tag over
// it (ui/convoyTags.ts) a convoy reads at a glance on a busy map and at any zoom: the band keeps a few pixels wide
// however far out.
//
// One draw call: an instanced flat quad per convoy, its outline drawn in the fragment shader round the line through
// the convoy's pieces (so it bends with it round a corner), laid on the road at the convoy's own height, so the
// trucks and anything taller stand over it.

import * as THREE from "three";
import type { Vehicle } from "../sim/traffic";
import type { View } from "./view";

/** Convoys marked at once (there are rarely more than a couple on the road). */
const MAX = 12;
/** How far out it shows (half the view's height, m): past this the map is an atlas and the tag says enough. */
const FAR = 3200;
/** Points along a convoy the band follows (its front, its pieces' middles, its back). */
const PTS = 6;

const VS = /* glsl */ `
attribute vec4 aShape; attribute vec4 aP0; attribute vec4 aP1; attribute vec4 aP2;
varying vec2 vP; varying vec4 vS; varying vec4 vA; varying vec4 vB; varying vec4 vC;
void main() {
  vS = aShape; vA = aP0; vB = aP1; vC = aP2;
  // (the quad's corners in metres from its middle: x along the convoy, y across)
  vP = position.xy * 2.0 * aShape.xy;
  gl_Position = projectionMatrix * viewMatrix * modelMatrix * instanceMatrix * vec4(position.x, 0.0, -position.y, 1.0);
}`;

const FS = /* glsl */ `
uniform float uT; uniform float uBand; uniform float uFade;
varying vec2 vP; varying vec4 vS; varying vec4 vA; varying vec4 vB; varying vec4 vC;
float seg(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a; float L = dot(ab, ab);
  float h = L > 1e-4 ? clamp(dot(p - a, ab) / L, 0.0, 1.0) : 0.0;
  return length(p - a - ab * h);
}
void main() {
  // the outline: r out from the line through the convoy's points
  float r = vS.z, seed = vS.w;
  float d = min(min(seg(vP, vA.xy, vA.zw), seg(vP, vA.zw, vB.xy)), min(seg(vP, vB.xy, vB.zw), min(seg(vP, vB.zw, vC.xy), seg(vP, vC.xy, vC.zw)))) - r;
  float aa = fwidth(d) * 1.2;
  float band = smoothstep(-uBand - aa, -uBand, d) * (1.0 - smoothstep(-aa, 0.0, d));
  // hazard tape: diagonal stripes, creeping forward
  float s = fract((vP.x - vP.y) / (uBand * 2.6) - uT * 0.6);
  float stripe = smoothstep(0.46, 0.5, s) - smoothstep(0.96, 1.0, s);
  vec3 amber = vec3(0.98, 0.70, 0.18), ink = vec3(0.05, 0.07, 0.11);
  vec3 col = mix(amber, ink, stripe * 0.85);
  // inside, a faint amber pool, breathing slowly
  float pulse = 0.75 + 0.25 * sin(uT * 2.4 + seed * 6.28);
  float pool = 0.16 * pulse * (1.0 - smoothstep(-aa, 0.0, d)) * smoothstep(-r, -uBand, d);
  float a = max(band * 0.92, pool);
  if (a < 0.01) discard;
  gl_FragColor = vec4(mix(amber, col, band / max(a, 0.001)), a * uFade);
  #include <colorspace_fragment>
}`;

export class ConvoyMarks {
  readonly group = new THREE.Group();
  private mesh: THREE.InstancedMesh;
  private shape: THREE.InstancedBufferAttribute;
  private pts: THREE.InstancedBufferAttribute[];
  private uni = { uT: { value: 0 }, uBand: { value: 1 }, uFade: { value: 1 } };
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private p = new THREE.Vector3();
  private sc = new THREE.Vector3();
  /** a mark's points: world x, y in pairs, then the same in the quad's own frame */
  private w = new Float32Array(PTS * 2);
  private loc = new Float32Array(PTS * 2);

  constructor() {
    const geo = new THREE.PlaneGeometry(1, 1);
    const attr = () => { const a = new THREE.InstancedBufferAttribute(new Float32Array(MAX * 4), 4); a.setUsage(THREE.DynamicDrawUsage); return a; };
    this.shape = attr();
    this.pts = [attr(), attr(), attr()];
    geo.setAttribute("aShape", this.shape);
    this.pts.forEach((a, i) => geo.setAttribute(`aP${i}`, a));
    const mat = new THREE.ShaderMaterial({
      vertexShader: VS, fragmentShader: FS, uniforms: this.uni,
      transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -4,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, MAX);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    // (over the roads and the ground, under the vehicles' own transparent bits)
    this.mesh.renderOrder = 2;
    this.group.add(this.mesh);
  }

  /** Every frame: the convoys on the road now, where they are drawn (`alpha` between sim steps). */
  update(vehicles: readonly Vehicle[], alpha: number, view: View, t: number, hide: boolean) {
    let n = 0;
    const mpp = view.mpp, w = this.w;
    if (!hide && view.halfH < FAR) {
      for (const v of vehicles) {
        const r = v.trip.haul;
        if (!r?.big || r.done || n >= MAX) continue;
        const U = v.uPose, P = v.puPose ?? U, units = v.units;
        const h = v.ph + (v.h - v.ph) * alpha;
        if (U && P && units && units.length >= 1 && units.length * 4 === U.length) {
          // its front, its pieces' middles (spread over the points between), its back
          const k = units.length;
          const X = (i: number) => P[i * 4] + (U[i * 4] - P[i * 4]) * alpha, Y = (i: number) => P[i * 4 + 1] + (U[i * 4 + 1] - P[i * 4 + 1]) * alpha;
          const fa = U[3], la = U[(k - 1) * 4 + 3];
          w[0] = X(0) + Math.cos(fa) * units[0].len / 2;
          w[1] = Y(0) + Math.sin(fa) * units[0].len / 2;
          for (let j = 1; j < PTS - 1; j++) {
            const i = Math.min(k - 1, Math.round(((j - 1) * (k - 1)) / (PTS - 3)));
            w[j * 2] = X(i);
            w[j * 2 + 1] = Y(i);
          }
          w[(PTS - 1) * 2] = X(k - 1) - Math.cos(la) * units[k - 1].len / 2;
          w[(PTS - 1) * 2 + 1] = Y(k - 1) - Math.sin(la) * units[k - 1].len / 2;
        } else {
          // (before its pieces are posed: back from its front along its heading)
          const bx = v.px + (v.x - v.px) * alpha, by = v.py + (v.y - v.py) * alpha;
          for (let j = 0; j < PTS; j++) { const f = (j / (PTS - 1)) * 24; w[j * 2] = bx - Math.cos(v.ang) * f; w[j * 2 + 1] = by - Math.sin(v.ang) * f; }
        }
        this.put(n++, h + 0.3, Math.max(4.2, mpp * 9), (v.id * 0.37) % 1);
      }
    }
    this.mesh.count = n;
    this.mesh.visible = n > 0;
    if (!n) return;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.shape.needsUpdate = true;
    for (const a of this.pts) a.needsUpdate = true;
    this.uni.uT.value = t % 600;
    // (the tape: about three pixels wide at any zoom, never under a metre)
    this.uni.uBand.value = Math.max(1, mpp * 3.2);
    this.uni.uFade.value = 1 - Math.max(0, Math.min(1, (view.halfH - FAR * 0.75) / (FAR * 0.25)));
  }

  /**
   * A mark `rad` out from the line through the points in `w`, at height `h`: a quad turned back to front along them,
   * just big enough, the points handed to the shader in the quad's own frame.
   */
  private put(i: number, h: number, rad: number, seed: number) {
    const w = this.w, loc = this.loc, L = PTS - 1;
    const mx = (w[0] + w[L * 2]) / 2, my = (w[1] + w[L * 2 + 1]) / 2;
    const ang = Math.atan2(w[1] - w[L * 2 + 1], w[0] - w[L * 2]);
    const c = Math.cos(ang), s = Math.sin(ang);
    let hx = 0, hy = 0;
    for (let j = 0; j < PTS; j++) {
      const dx = w[j * 2] - mx, dy = w[j * 2 + 1] - my;
      // (along, and across: the quad's y lies along the scene's -z, the other way to the world's left)
      const lx = dx * c + dy * s, ly = dx * s - dy * c;
      loc[j * 2] = lx;
      loc[j * 2 + 1] = ly;
      hx = Math.max(hx, Math.abs(lx));
      hy = Math.max(hy, Math.abs(ly));
    }
    hx += rad + 1;
    hy += rad + 1;
    this.q.setFromAxisAngle(this.up, -ang);
    this.m.compose(this.p.set(mx, h, my), this.q, this.sc.set(2 * hx, 1, 2 * hy));
    this.mesh.setMatrixAt(i, this.m);
    this.shape.setXYZW(i, hx, hy, rad, seed);
    for (let a = 0; a < 3; a++) this.pts[a].setXYZW(i, loc[a * 4], loc[a * 4 + 1], loc[a * 4 + 2], loc[a * 4 + 3]);
  }
}
