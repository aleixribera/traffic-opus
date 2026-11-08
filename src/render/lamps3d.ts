// The map's lights (docs/design.md, "Day and night"): the Deco street lamps along the roads and the floodlight masts
// over the company's works (Blender models, standing by day too), and at night what they throw: warm pools on the
// asphalt, the works' white floodlit yards, the windows' light spilling out round the houses, shops and offices,
// the cars' headlight beams and tail lights, and a halo round each signal.
// No real three.js lights: every pool is a quad in one of a few instanced meshes, blended so it brightens what lies
// under it (the framebuffer times 1 + its light: lit asphalt stays asphalt, lit grass stays grass). Glows add on top.
// One time-of-day value drives it all (ENV.uNight); by day the layer is hidden.

import * as THREE from "three";
import { ENV, seasonal } from "./envShader";
import { windowsLit, WINDOW_KINDS, type WindowKind } from "./daylight";
import type { MergedModel } from "./models";

/** A light on a post or a mast: where it stands (h: the ground's height there) and which way it throws its light. */
/** A lamp: where its post stands, the way it faces (unit), and for a floodlight how far its light reaches (m; a
 * small yard's masts throw less, so four of them don't flood it white). */
export interface LampSpot { x: number; y: number; h: number; dx: number; dy: number; kind: "street" | "highway" | "flood"; r?: number }
/** A building's lit windows: its footprint (centre, the unit direction of its x side, half extents) and what it is. */
export interface WindowSpot { x: number; y: number; ux: number; uy: number; hx: number; hz: number; tall: number; kind: WindowKind; seed: number }

/** How a lamp of each kind lights the ground: the pool's radius (m), how far out from the post its middle is, its
 * colour, and its glow's size (m) and height on the model. */
const LAMP = {
  street: { r: 13, reach: 1.8, color: [1.0, 0.72, 0.4], glow: 2.6, head: 5.6 },
  highway: { r: 14, reach: 2.2, color: [1.0, 0.7, 0.36], glow: 3.0, head: 5.6 },
  flood: { r: 24, reach: 18, color: [0.36, 0.38, 0.36], glow: 2.4, head: 13.6 },
} as const;
/** The head of the street lamp model (model space; +z is the way its arm reaches). */
const STREET_HEAD = new THREE.Vector3(0, 5.6, 1.25);
const FLOOD_HEAD = new THREE.Vector3(0, 13.4, 1.0);
/** The side of the map's blocks the posts are drawn in (m). */
const POST_BLOCK = 256;
/** Window light by kind: the colour that spills out, and the window spacing along a wall (m). */
const WIN: Record<WindowKind, { color: [number, number, number]; every: number }> = {
  home: { color: [1.0, 0.62, 0.28], every: 2.6 },
  shop: { color: [1.0, 0.88, 0.7], every: 2.2 },
  office: { color: [0.82, 0.9, 1.0], every: 2.0 },
  hall: { color: [1.0, 0.8, 0.5], every: 2.4 },
};
/** How far window light reaches out from the walls (m). */
const SPILL = 3.6;

const POOL_VS = /* glsl */ `
varying vec2 vUv; varying vec3 vCol;
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #else
  vCol = vec3(1.0);
  #endif
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
/**
 * How a light's pass writes it: drawn twice, first adding a little of its colour (lamplight on near-black asphalt
 * has to show as light, not as a brighter black), then multiplying what is there by 1 + its light against the
 * night's own (so lit grass stays grass and lit brick stays brick).
 */
const LIGHT_OUT = /* glsl */ `
uniform float uGain; uniform float uAdd;
vec4 lightOut(vec3 L, float n) {
#ifdef ADD_PASS
  return vec4(L * uAdd + n, 1.0);
#else
  return vec4(1.0 - exp(-L * uGain) + n, 1.0);
#endif
}
// (a hair of noise so the 8-bit falloff doesn't band)
float dither() { return (fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0; }
`;
/** A round pool: soft at its rim, brighter under the lamp. */
const POOL_FS = /* glsl */ `
uniform vec2 uNight; uniform float uK;
${LIGHT_OUT}
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float f = 1.0 - d;
  float e = 1.0 - d * d;
  f = e * e * 0.75 + 0.35 * exp(-d * d * 10.0);
  gl_FragColor = lightOut(vCol * f * uNight.x * uK, dither());
}`;
/**
 * A floodlight's throw: an oval reaching out from the mast, evenly lit with a clear edge (a yard lamp's light, not
 * a street lamp's soft pool), a little brighter at the mast's end.
 */
const FLOOD_FS = /* glsl */ `
uniform vec2 uNight; uniform float uK;
${LIGHT_OUT}
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d = length(q);
  if (d > 1.0) discard;
  float edge = 1.0 - smoothstep(0.62, 1.0, d);
  float f = edge * (0.62 + 0.25 * smoothstep(0.6, -0.9, q.y) + 0.13 * (1.0 - d));
  gl_FragColor = lightOut(vCol * f * uNight.x * uK, dither());
}`;
/** A headlight beam: a fan widening ahead of the car, strongest near it. */
const BEAM_FS = /* glsl */ `
uniform vec2 uNight; uniform float uK;
${LIGHT_OUT}
varying vec2 vUv; varying vec3 vCol;
void main() {
  float z = 1.0 - vUv.y, x = abs(vUv.x * 2.0 - 1.0);
  float w = 0.3 + 0.7 * z;
  float across = 1.0 - smoothstep(w * 0.4, w, x);
  float along = smoothstep(0.0, 0.08, z) * pow(1.0 - z, 1.3);
  gl_FragColor = lightOut(vCol * across * along * uNight.x * uK, dither());
}`;
/** A glow (a lamp's head, a headlamp, a tail light, a signal), kept a few pixels across however far out the view is. */
const GLOW_VS = /* glsl */ `
uniform float uMpp; uniform float uMinPx;
varying vec2 vUv; varying vec3 vCol;
void main() {
  vUv = uv;
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #else
  vCol = vec3(1.0);
  #endif
  vec4 c = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
  vec3 off = (instanceMatrix * vec4(position, 0.0)).xyz;
  float size = length(instanceMatrix[0].xyz);
  float k = max(1.0, uMinPx * uMpp / max(size, 1e-3));
  gl_Position = projectionMatrix * modelViewMatrix * vec4(c.xyz + off * k, 1.0);
}`;
const GLOW_FS = /* glsl */ `
uniform vec2 uNight; uniform float uK;
varying vec2 vUv; varying vec3 vCol;
void main() {
  vec2 q = vUv * 2.0 - 1.0;
  float d2 = dot(q, q);
  if (d2 > 1.0) discard;
  float g = exp(-d2 * 9.0) * 0.9 + exp(-d2 * 2.5) * 0.25;
  gl_FragColor = vec4(vCol * g * uNight.x * uK, 1.0);
}`;
/** Light out of a building's windows onto the ground round it: a band along each wall, warmer opposite each lit window. */
const SPILL_VS = /* glsl */ `
attribute vec4 aWin; attribute vec4 aWin2;
varying vec2 vLoc; varying vec4 vWin; varying vec4 vWin2; varying vec3 vCol;
void main() {
  vWin = aWin; vWin2 = aWin2;
  #ifdef USE_INSTANCING_COLOR
  vCol = instanceColor;
  #else
  vCol = vec3(1.0);
  #endif
  vLoc = position.xz * vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
}`;
const SPILL_FS = /* glsl */ `
uniform vec2 uNight; uniform vec4 uOcc; uniform float uK;
${LIGHT_OUT}
varying vec2 vLoc; varying vec4 vWin; varying vec4 vWin2; varying vec3 vCol;
float h31(vec3 p) { p = fract(p * 0.1031); p += dot(p, p.zyx + 31.32); return fract((p.x + p.y) * p.z); }
void main() {
  vec2 half_ = vWin.xy;
  vec2 o = abs(vLoc) - half_;
  float out_ = max(o.x, o.y);
  if (out_ < -0.3) discard;
  // the nearest wall, and how far along it
  bool xs = o.x > o.y;
  float along = xs ? vLoc.y : vLoc.x;
  float side = xs ? (vLoc.x > 0.0 ? 0.0 : 1.0) : (vLoc.y > 0.0 ? 2.0 : 3.0);
  float every = vWin2.y;
  float u = along / every;
  float wi = floor(u + 0.5);
  // each window lit or dark: lit while the share of its kind's windows lit now is above its own number; the light
  // between two windows is the mix of both (a soft wash along the wall, warmer opposite a lit one)
  int k = int(vWin.z + 0.5);
  float occ = k == 0 ? uOcc.x : k == 1 ? uOcc.y : k == 2 ? uOcc.z : uOcc.w;
  float w0 = floor(u), t = u - w0;
  float on0 = step(h31(vec3(vWin.w, side, w0)), occ), on1 = step(h31(vec3(vWin.w, side, w0 + 1.0)), occ);
  float on = mix(on0, on1, smoothstep(0.0, 1.0, t));
  float reach = vWin2.x;
  float d = max(out_, 0.0) / reach;
  float fall = (1.0 - smoothstep(0.0, 1.0, d)) * (1.0 - 0.55 * smoothstep(0.0, 0.5, d));
  // (round a corner, past both walls' ends, it fades)
  float corner = 1.0 - smoothstep(0.0, reach * 0.7, min(o.x, o.y));
  gl_FragColor = lightOut(vCol * on * fall * corner * uNight.y * uK, dither());
}`;

/** 1 / how bright the night's own light is: what the lamps' light is worth against it (set every frame). */
const GAIN = { value: 1 };
/**
 * A light's two passes: one adding a little of it, one brightening what is under it (framebuffer x (1 + light)).
 * `add`: how much of the light the first pass adds.
 */
function brighten(vs: string, fs: string, k: number, add: number, extra: Record<string, THREE.IUniform> = {}): THREE.ShaderMaterial[] {
  const uniforms = { uNight: ENV.uNight, uK: { value: k }, uGain: GAIN, uAdd: { value: add }, ...extra };
  const base = { vertexShader: vs, fragmentShader: fs, uniforms, transparent: true, depthWrite: false, depthTest: true, blending: THREE.CustomBlending, blendEquation: THREE.AddEquation };
  return [
    new THREE.ShaderMaterial({ ...base, defines: { ADD_PASS: 1 }, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor }),
    new THREE.ShaderMaterial({ ...base, blendSrc: THREE.DstColorFactor, blendDst: THREE.OneFactor }),
  ];
}
function glowMaterial(k: number, minPx: number, mpp: THREE.IUniform): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    vertexShader: GLOW_VS, fragmentShader: GLOW_FS,
    uniforms: { uNight: ENV.uNight, uK: { value: k }, uMpp: mpp, uMinPx: { value: minPx } },
    transparent: true, depthWrite: false, depthTest: true, blending: THREE.AdditiveBlending,
  });
}

const flat = () => new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
/** A geometry drawn twice over (two groups on the same triangles): each light's two passes. */
function twice(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const n = geo.index ? geo.index.count : geo.getAttribute("position").count;
  geo.clearGroups();
  geo.addGroup(0, n, 0);
  geo.addGroup(0, n, 1);
  return geo;
}

export class Lamps3D {
  readonly group = new THREE.Group();
  private mpp = { value: 1 };
  private occ = { value: new THREE.Vector4() };
  private poolMat = brighten(POOL_VS, POOL_FS, 0.5, 0.42);
  private floodMat = brighten(POOL_VS, FLOOD_FS, 0.5, 0.36);
  private beamMat = brighten(POOL_VS, BEAM_FS, 0.5, 0.3);
  private spillMat = brighten(SPILL_VS, SPILL_FS, 0.25, 0.08, { uOcc: this.occ });
  private glowMat = glowMaterial(1.0, 3.2, this.mpp);
  private carGlowMat = glowMaterial(1.0, 2.2, this.mpp);
  private signalMat = glowMaterial(0.9, 0, this.mpp);
  /** The posts and masts: lit like the buildings (snow settles on the lamp hoods). */
  private postMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { roofs: true });
  /** By day: the posts and masts. */
  private posts: THREE.InstancedMesh[] = [];
  /** At night: the static pools, glows and window light. */
  private lit = new THREE.Group();
  private pools: THREE.InstancedMesh | null = null;
  private floodPools: THREE.InstancedMesh | null = null;
  private glows: THREE.InstancedMesh | null = null;
  private spill: THREE.InstancedMesh | null = null;
  /** The cars' lights, filled every frame (see beginCars / car / endCars). */
  private beams: THREE.InstancedMesh;
  private carGlows: THREE.InstancedMesh;
  private nBeam = 0;
  private nGlow = 0;
  private signalGlow: THREE.InstancedMesh;
  private m = new THREE.Matrix4();
  private m2 = new THREE.Matrix4();
  private v = new THREE.Vector3();
  private c = new THREE.Color();
  private q = new THREE.Quaternion();
  private up = new THREE.Vector3(0, 1, 0);
  private s = new THREE.Vector3();
  /** Lamps (0..1) and window darkness (0..1) as last set. */
  private lamps = 0;

  constructor(private street: MergedModel | undefined, private flood: MergedModel | undefined) {
    const beamGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0, 0, 0.5);
    this.beams = this.dyn(twice(beamGeo), this.beamMat, 512, 4);
    this.carGlows = this.dyn(flat(), this.carGlowMat, 2048, 6);
    this.signalGlow = new THREE.InstancedMesh(new THREE.PlaneGeometry(4.2, 4.2).rotateX(-Math.PI / 2), this.signalMat, 1);
    this.signalGlow.count = 0;
    this.signalGlow.frustumCulled = false;
    this.signalGlow.renderOrder = 6;
    this.lit.add(this.beams, this.carGlows, this.signalGlow);
    this.group.add(this.lit);
  }

  private dyn(geo: THREE.BufferGeometry, mat: THREE.Material | THREE.Material[], n: number, order: number): THREE.InstancedMesh {
    const m = new THREE.InstancedMesh(geo, mat, n);
    m.count = 0;
    m.frustumCulled = false;
    m.renderOrder = order;
    m.setColorAt(0, new THREE.Color(1, 1, 1));
    return m;
  }

  private drop(m: THREE.InstancedMesh | null, from: THREE.Object3D) {
    if (!m) return;
    from.remove(m);
    m.geometry.dispose();
    m.dispose();
  }

  /** The lamps and the lit buildings changed (roads built, a town grew): lay their posts, pools and window light again. */
  setStatic(lamps: LampSpot[], windows: WindowSpot[]) {
    for (const p of this.posts) { this.group.remove(p); p.dispose(); }
    this.posts = [];
    this.drop(this.pools, this.lit); this.pools = null;
    this.drop(this.floodPools, this.lit); this.floodPools = null;
    this.drop(this.glows, this.lit); this.glows = null;
    this.drop(this.spill, this.lit); this.spill = null;
    // the posts and masts, by model, in square blocks of the map so the ones off screen (and out of the shadow
    // camera's view) aren't drawn: a big map has thousands
    for (const [kinds, mm] of [[["street", "highway"], this.street], [["flood"], this.flood]] as const) {
      if (!mm) continue;
      const blocks = new Map<string, LampSpot[]>();
      for (const l of lamps) {
        if (!(kinds as readonly string[]).includes(l.kind)) continue;
        const k = `${Math.floor(l.x / POST_BLOCK)},${Math.floor(l.y / POST_BLOCK)}`;
        const b = blocks.get(k);
        if (b) b.push(l); else blocks.set(k, [l]);
      }
      for (const list of blocks.values()) {
        const im = new THREE.InstancedMesh(mm.geo, this.postMat, list.length);
        list.forEach((l, i) => im.setMatrixAt(i, this.post(l)));
        im.castShadow = true;
        im.receiveShadow = true;
        im.computeBoundingSphere();
        im.userData.street = mm === this.street;
        this.posts.push(im);
        this.group.add(im);
      }
    }
    if (lamps.length) {
      const nFlood = lamps.filter((l) => l.kind === "flood").length;
      const pools = new THREE.InstancedMesh(twice(flat()), this.poolMat, Math.max(1, lamps.length - nFlood));
      const floods = new THREE.InstancedMesh(twice(flat()), this.floodMat, Math.max(1, nFlood));
      pools.count = lamps.length - nFlood;
      floods.count = nFlood;
      const glows = new THREE.InstancedMesh(flat(), this.glowMat, lamps.length);
      let ip = 0, iflood = 0;
      lamps.forEach((l, i) => {
        const L = LAMP[l.kind];
        const r = l.r ?? L.r, reach = L.reach * (r / L.r);
        const at = this.v.set(l.x + l.dx * reach, l.h + 0.16, l.y + l.dy * reach);
        if (l.kind === "flood") {
          // (an oval along the throw: local -z, the quad's uv top, is the far end)
          this.q.setFromAxisAngle(this.up, Math.atan2(-l.dx, -l.dy));
          floods.setMatrixAt(iflood, this.m.compose(at, this.q, this.s.set(r * 1.6, 1, r * 2.0)));
          floods.setColorAt(iflood++, this.c.setRGB(L.color[0], L.color[1], L.color[2]));
        } else {
          this.q.setFromAxisAngle(this.up, 0);
          pools.setMatrixAt(ip, this.m.compose(at, this.q, this.s.set(L.r * 2, 1, L.r * 2)));
          pools.setColorAt(ip++, this.c.setRGB(L.color[0], L.color[1], L.color[2]));
        }
        this.q.setFromAxisAngle(this.up, 0);
        const head = this.post(l).multiply(this.m2.makeTranslation(l.kind === "flood" ? FLOOD_HEAD : STREET_HEAD));
        this.v.setFromMatrixPosition(head);
        glows.setMatrixAt(i, this.m.compose(this.v.setY(this.v.y + 0.4), this.q, this.s.set(L.glow * 2, 1, L.glow * 2)));
        glows.setColorAt(i, this.c.setRGB(1, l.kind === "flood" ? 0.97 : 0.86, l.kind === "flood" ? 0.92 : 0.62));
      });
      pools.renderOrder = 4;
      floods.renderOrder = 4;
      glows.renderOrder = 7;
      for (const m of [pools, floods, glows]) { m.computeBoundingSphere(); this.lit.add(m); }
      this.pools = pools;
      this.floodPools = floods;
      this.glows = glows;
    }
    if (windows.length) {
      const sp = new THREE.InstancedMesh(twice(flat()), this.spillMat, windows.length);
      const a = new Float32Array(windows.length * 4), b = new Float32Array(windows.length * 4);
      windows.forEach((w, i) => {
        const reach = SPILL * (1 + Math.min(1.2, w.tall / 30));
        this.q.setFromAxisAngle(this.up, -Math.atan2(w.uy, w.ux));
        sp.setMatrixAt(i, this.m.compose(this.v.set(w.x, 0.15, w.y), this.q, this.s.set((w.hx + reach) * 2, 1, (w.hz + reach) * 2)));
        const W = WIN[w.kind];
        // (a tall building's many floors throw more light)
        const k = 0.75 + Math.min(0.5, w.tall / 40);
        sp.setColorAt(i, this.c.setRGB(W.color[0] * k, W.color[1] * k, W.color[2] * k));
        a.set([w.hx, w.hz, WINDOW_KINDS.indexOf(w.kind), w.seed % 997], i * 4);
        b.set([reach, W.every, 0, 0], i * 4);
      });
      sp.geometry.setAttribute("aWin", new THREE.InstancedBufferAttribute(a, 4));
      sp.geometry.setAttribute("aWin2", new THREE.InstancedBufferAttribute(b, 4));
      sp.renderOrder = 4;
      sp.computeBoundingSphere();
      this.spill = sp;
      this.lit.add(sp);
    }
  }

  /** A lamp's post matrix: standing at its spot, its arm (model +z) reaching the way it throws its light. */
  private post(l: LampSpot): THREE.Matrix4 {
    this.q.setFromAxisAngle(this.up, Math.atan2(l.dx, l.dy));
    return new THREE.Matrix4().compose(new THREE.Vector3(l.x, l.h, l.y), this.q, new THREE.Vector3(1, 1, 1));
  }

  /** Every frame: how dark it is, the clock hour (for the windows), the view's scale, and the signals to give halos. */
  update(lamps: number, hour: number, mpp: number, signals: THREE.InstancedMesh | null, ambient: number) {
    this.lamps = lamps;
    GAIN.value = 1 / Math.max(0.12, ambient);
    this.lit.visible = lamps > 0.002 || ENV.uNight.value.y > 0.002;
    this.mpp.value = mpp;
    // (far out a street lamp's post is under a pixel: not worth its triangles, and its shadow is a hairline well
    // before that; the masts stay)
    for (const p of this.posts) {
      if (!p.userData.street) continue;
      p.visible = mpp < 1.6;
      p.castShadow = mpp < 0.45;
    }
    this.occ.value.set(windowsLit("home", hour), windowsLit("shop", hour), windowsLit("office", hour), windowsLit("hall", hour));
    // signals: a halo round each lit head, from the road renderer's own instances
    const sg = this.signalGlow;
    if (signals && this.lit.visible) {
      if (sg.instanceMatrix !== signals.instanceMatrix) {
        sg.instanceMatrix = signals.instanceMatrix;
        sg.instanceColor = signals.instanceColor;
        (sg as unknown as { count: number }).count = 0;
      }
      sg.count = signals.instanceColor ? signals.count : 0;
      sg.scale.setScalar(1);
    } else sg.count = 0;
  }

  /** Far out the cars aren't drawn, nor are their lights. */
  showCars(on: boolean) {
    this.beams.visible = on;
    this.carGlows.visible = on;
  }

  /** Whether the cars' lights are worth drawing this frame. */
  get carsLit(): boolean {
    return this.lamps > 0.002;
  }

  beginCars() {
    this.nBeam = 0;
    this.nGlow = 0;
  }

  /**
   * One vehicle piece's lights: `m` is its pose (model +z forward), `front` and `rear` its bumpers and `half` its
   * half width (model space); `head`/`tail`: whether this piece carries the headlamps (the front one) and the tail
   * lights (the last one).
   */
  car(m: THREE.Matrix4, front: number, rear: number, half: number, head: boolean, tail: boolean) {
    if (head && this.nBeam < this.beams.instanceMatrix.count) {
      this.m.copy(m).multiply(this.m2.makeTranslation(0, 0.1, front + 0.2)).multiply(this.m2.makeScale(9, 1, 17));
      this.beams.setMatrixAt(this.nBeam, this.m);
      this.beams.setColorAt(this.nBeam++, this.c.setRGB(0.95, 0.82, 0.58));
    }
    const lamp = (x: number, z: number, y: number, size: number, r: number, g: number, b: number) => {
      if (this.nGlow >= this.carGlows.instanceMatrix.count) return;
      this.v.set(x, y, z).applyMatrix4(m);
      this.carGlows.setMatrixAt(this.nGlow, this.m.compose(this.v, this.q.identity(), this.s.set(size, 1, size)));
      this.carGlows.setColorAt(this.nGlow++, this.c.setRGB(r, g, b));
    };
    const x = Math.max(0.45, half - 0.25);
    if (head) for (const sx of [-x, x]) lamp(sx, front - 0.05, 1.6, 1.3, 1.0, 0.92, 0.72);
    if (tail) for (const sx of [-x, x]) lamp(sx, rear + 0.05, 1.6, 0.95, 0.95, 0.08, 0.04);
  }

  endCars() {
    for (const [mesh, n] of [[this.beams, this.nBeam], [this.carGlows, this.nGlow]] as const) {
      mesh.count = n;
      mesh.instanceMatrix.needsUpdate = true;
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
  }
}
