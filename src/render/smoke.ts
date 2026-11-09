// Smoke, steam and dust (docs/design.md, "A world that moves"): every works that is running shows it from across
// the map. Stacks smoke, cooling towers and boilers steam, crushers and pit faces raise dust, a sawmill hangs in a
// haze of sawdust, the refinery's flare burns; homes' chimneys smoke thinly in the cold, and a vehicle on a dirt road
// trails a little dust. The rules (who smokes, how hard, what a puff looks like) are render/plumes.ts.
//
// One instanced draw call over a fixed pool of puffs. A puff is written once, when it is born (where, when, how fast
// it rises, the wind it was born into, its size and colour); the vertex shader works out where it has got to from
// its age, so nothing moves on the CPU and nothing is allocated per frame. The pool is a ring: the oldest puff makes
// way for the newest. Puffs are camera-facing quads, lit by the hour's light (warm at dusk, dim blue-grey at night,
// the works' floodlights catching the plume's foot), leaning with the wind (render/wind.ts).

import * as THREE from "three";
import { PLANTS, type PlantKind } from "../game/industry";
import type { Lane } from "../roads/network";
import type { Traffic } from "../sim/traffic";
import { ENV, ENV_CORE_GLSL } from "./envShader";
import {
  LOOKS, due, feel, fireLit, hearth, liveOf, newPlume, newPulse, plumeOf, smokeOf, tintOf, trailRate,
  type FxEmitter, type Plume, type PuffKind, type Pulse,
} from "./plumes";
import { windNow } from "./wind";

/** Puffs alive at once, at most. */
export const POOL = 8192;
const STRIDE = 16;
/** The puffs' clock is wound back by this (s) whenever it passes it, so their ages stay exact in a float. */
const REBASE = 1024;
/** How far outside the view (m on the ground) an emitter still smokes: its plume may lean in. */
const MARGIN = 170;
/** A home's chimney is too small to see past this zoom (m a pixel), a dust trail past TRAIL_MPP. */
const HOME_MPP = 0.5, TRAIL_MPP = 0.95;
/** How full the pool may run before every emitter is thinned to fit. */
const FULL = 0.8;

const PLAIN = 0, FLAME = 1, WORKS = 2;

/** How much bigger than life a plume is drawn at a zoom (m a pixel): life-size near in, three times from far off. */
export const zoomScale = (mpp: number) => Math.min(3.2, Math.max(1, Math.pow(mpp / 0.4, 0.55)));

/** Where a puff has got to (both the puffs and their shadows on the ground work it out the same way). */
const PUFF_GLSL = /* glsl */ `
attribute vec4 aA; // where it was born (x, height, z), when
attribute vec4 aB; // the wind that carries it (x, z in .xz), how fast it rises (.y), how long it lives
attribute vec4 aC; // its width at birth, how fast it spreads, its own random number, what it is
attribute vec4 aD; // colour, opacity
uniform float uTime; uniform float uMpp; uniform float uZoom;
/* its middle (xyz) and its width (w); w is 0 for a puff not yet born or gone */
vec4 puffAt(float age) {
  if (age < 0.0 || age >= aB.w) return vec4(0.0);
  // it leaves the mouth straight up and fast, slows, and is bent over by the wind as it goes
  float carried = age - 2.4 * (1.0 - exp(-age / 2.4));
  float up = aB.y * (1.7 * (1.0 - exp(-age / 1.7)) + 0.45 * age);
  float d = max(0.05, aC.x + aC.y * pow(age, 0.8));
  float sd = aC.z * 6.2832;
  float amp = 0.06 * aC.x + 0.1 * max(0.0, d - aC.x);
  // (from far off a plume is drawn bigger than it is, as a map draws what matters: it is seen from across the map)
  vec3 c = aA.xyz + uZoom * (vec3(aB.x * carried, up, aB.z * carried)
    + amp * vec3(sin(age * 0.83 + sd * 3.0), 0.6 * sin(age * 0.61 + sd * 5.0), cos(age * 0.71 + sd * 7.0)));
  d *= uZoom;
  if (aC.w > 1.5) d = max(d, 3.2 * uMpp);
  return vec4(c, d);
}`;

/** A works with emitters: its pulse and how hard it smokes now (eased, so a stack dies away rather than stops). */
interface Beat { pulse: Pulse; k: number; live: boolean; frame: number }

export class Smoke {
  readonly mesh: THREE.Mesh;
  private shadow: THREE.Mesh;
  /** Puffs born so far, and those alive at the last count (the dev hook and the tests read them). */
  emitted = 0;
  demand = 0;

  private data = new Float32Array(POOL * STRIDE);
  private buf: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private wrote = 0;
  private ranges = [{ start: 0, count: 0 }, { start: 0, count: 0 }];
  private clock = 0;
  private U = {
    ...ENV,
    uTime: { value: 0 },
    uMpp: { value: 1 },
    uZoom: { value: 1 },
    uSunScr: { value: new THREE.Vector2(-0.5, 0.8) },
    uLit: { value: new THREE.Vector3(1, 1, 1) },
    uDim: { value: new THREE.Vector3(0.6, 0.6, 0.6) },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.8, -0.4) },
  };

  private works: FxEmitter[] = [];
  private homes: FxEmitter[] = [];
  private wTint = new Float32Array(0);
  /** per works emitter: puffs owed (two kinds: a flare's flame and its smoke), whether it was in view, its beat */
  private wAcc = new Float32Array(0);
  private wSeen = new Uint8Array(0);
  private wBeat: Beat[] = [];
  private hAcc = new Float32Array(0);
  private hSeen = new Uint8Array(0);
  private beats = new Map<number, Beat>();
  private trailAcc = new Map<number, number>();
  private thin = 1;

  private sun = new THREE.Vector3(-0.4, 0.8, -0.4);
  private dir = new THREE.Vector3();
  private right = new THREE.Vector3();
  private upv = new THREE.Vector3();
  private corner = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private px = 0; private py = 0; private ux = 1; private uy = 0; private vx = 0; private vy = 1;
  private lu = 1; private lv = 1; private det = 1; private down = false;
  private plume: Plume = newPlume();
  private owed = { n: 0, acc: 0 };
  private col = new THREE.Color();
  private tint = new Float32Array(3 * Object.keys(LOOKS).length);
  private seed = 0x9e3779b9;
  private now = 0;
  private frame = 0;

  constructor() {
    for (let i = 0; i < POOL; i++) this.data[i * STRIDE + 3] = -1e9;
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.setIndex(quad.getIndex());
    geo.setAttribute("position", quad.getAttribute("position"));
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    for (let k = 0; k < 4; k++) geo.setAttribute("aABCD"[0] + "ABCD"[k], new THREE.InterleavedBufferAttribute(this.buf, 4, k * 4));
    geo.instanceCount = POOL;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
${PUFF_GLSL}
varying vec2 vUv; varying vec4 vCol; varying vec3 vK;
void main() {
  float age = uTime - aA.w;
  vec4 p = puffAt(age);
  vUv = position.xy * 2.0;
  vCol = aD;
  vK = vec3(aC.z, age / aB.w, aC.w);
  if (p.w <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec4 mv = viewMatrix * vec4(p.xyz, 1.0);
  mv.xy += position.xy * p.w;
  gl_Position = projectionMatrix * mv;
}`,
      fragmentShader: /* glsl */ `
${ENV_CORE_GLSL}
uniform vec2 uSunScr; uniform vec3 uLit; uniform vec3 uDim;
varying vec2 vUv; varying vec4 vCol; varying vec3 vK;
void main() {
  float seed = vK.x, t = vK.y;
  float r = length(vUv);
  if (r > 1.0) discard;
  // a ragged, slowly turning edge
  float a = seed * 6.2832 + t * 1.3, ca = cos(a), sa = sin(a);
  vec2 q = vec2(ca * vUv.x - sa * vUv.y, sa * vUv.x + ca * vUv.y);
  float n = envNoise(q * 1.25 + seed * 37.0), n2 = envNoise(q * 2.9 - seed * 19.0);
  float edge = r + (n - 0.5) * 0.34 + (n2 - 0.5) * 0.12;
  // (a works' young puff is a firm round billow, going soft and wispy as it thins; a wisp or a haze of dust is soft
  // from the start)
  float alpha = (1.0 - smoothstep(mix(vK.z > 1.5 ? 0.7 : 0.22, vK.z > 1.5 ? 0.3 : 0.1, t), 0.92, edge)) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.45, 1.0, t)) * mix(1.0, 0.6, t) * vCol.a;
  if (alpha < 0.012) discard;
  vec3 col;
  if (vK.z > 0.5 && vK.z < 1.5) {
    // a flame: its own light, a hot core
    col = mix(vCol.rgb, vec3(1.0, 0.9, 0.55), (1.0 - smoothstep(0.0, 0.7, r)) * (1.0 - t));
  } else {
    // two tones: the side the sun is on, and the side it is not
    float s = dot(vUv, uSunScr) + (n - 0.5) * 0.7;
    col = envGrade(vCol.rgb * (1.0 + 0.16 * t)) * mix(uDim, uLit, smoothstep(-0.35, 0.35, s));
    // the works' floodlights catch the foot of its plume at night
    if (vK.z > 1.5) col += vec3(1.0, 0.74, 0.46) * uNight.x * 0.17 * (1.0 - smoothstep(0.0, 0.4, t)) * (0.6 - 0.4 * vUv.y);
  }
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 8;
    // the plumes' shadows: the same puffs once more, laid on the ground where the sun casts them (only the works'
    // plumes: a chimney's wisp and a wheel's dust cast nothing worth drawing)
    const shade = new THREE.ShaderMaterial({
      uniforms: this.U,
      transparent: true,
      depthWrite: false,
      // (the quad lies on the ground, seen from its back)
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
${PUFF_GLSL}
uniform vec3 uSunDir;
varying vec2 vUv; varying vec3 vK;
void main() {
  float age = uTime - aA.w;
  vec4 p = puffAt(age);
  vUv = position.xy * 2.0;
  vK = vec3(aC.z, age / aB.w, aD.a);
  if (p.w <= 0.0 || aC.w < 1.5) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  // (a low sun's shadow is kept from running off across the map)
  vec2 g = p.xz - uSunDir.xz / max(uSunDir.y, 0.34) * p.y;
  float d = p.w * 1.1;
  gl_Position = projectionMatrix * viewMatrix * vec4(g.x + position.x * d, 0.45, g.y + position.y * d, 1.0);
}`,
      fragmentShader: /* glsl */ `
${ENV_CORE_GLSL}
varying vec2 vUv; varying vec3 vK;
void main() {
  float r = length(vUv), t = vK.y;
  float alpha = (1.0 - smoothstep(0.1, 1.0, r)) * smoothstep(0.0, 0.04, t) * (1.0 - smoothstep(0.4, 1.0, t)) * vK.z * 0.08 * uShade.x;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(0.03, 0.05, 0.1, alpha);
}`,
    });
    this.shadow = new THREE.Mesh(geo, shade);
    this.shadow.frustumCulled = false;
    this.shadow.renderOrder = 2;
    this.mesh.add(this.shadow);
    (Object.keys(LOOKS) as PuffKind[]).forEach((k, i) => this.col.setHex(LOOKS[k].colour).toArray(this.tint, i * 3));
  }

  /** A new map: no puff of the last one's hangs over it. */
  reset() {
    for (let i = 0; i < POOL; i++) this.data[i * STRIDE + 3] = -1e9;
    this.wrote = POOL;
    this.clock = 0;
    this.trailAcc.clear();
    this.beats.clear();
    this.setEmitters([]);
  }

  dispose() {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
    (this.shadow.material as THREE.Material).dispose();
  }

  /** The emitters standing now (Buildings3D lays them out with the buildings). */
  setEmitters(list: FxEmitter[]) {
    // (what each one owed and whether it was in view carry over: the same stack goes on smoking)
    const was = new Map<string, { acc: number; acc2: number; seen: number }>();
    const key = (e: FxEmitter) => `${e.b.id}:${e.kind}:${e.x.toFixed(1)}:${e.y.toFixed(1)}`;
    this.works.forEach((e, i) => was.set(key(e), { acc: this.wAcc[i * 2], acc2: this.wAcc[i * 2 + 1], seen: this.wSeen[i] }));
    this.homes.forEach((e, i) => was.set(key(e), { acc: this.hAcc[i], acc2: 0, seen: this.hSeen[i] }));
    this.works = list.filter((e) => e.kind !== "chimney" && e.b.plant);
    this.homes = list.filter((e) => e.kind === "chimney");
    const nw = this.works.length, nh = this.homes.length;
    this.wAcc = new Float32Array(nw * 2);
    this.wSeen = new Uint8Array(nw);
    this.wTint = new Float32Array(nw * 3);
    this.hAcc = new Float32Array(nh);
    this.hSeen = new Uint8Array(nh);
    for (const b of this.beats.values()) b.live = false;
    this.wBeat = this.works.map((e, i) => {
      const w = was.get(key(e));
      if (w) { this.wAcc[i * 2] = w.acc; this.wAcc[i * 2 + 1] = w.acc2; this.wSeen[i] = w.seen; }
      this.col.setHex(tintOf(e.kind, e.b.kind)).toArray(this.wTint, i * 3);
      let b = this.beats.get(e.b.id);
      if (!b) this.beats.set(e.b.id, (b = { pulse: newPulse(), k: 0, live: true, frame: -1 }));
      b.live = true;
      return b;
    });
    this.homes.forEach((e, i) => { const w = was.get(key(e)); if (w) { this.hAcc[i] = w.acc; this.hSeen[i] = w.seen; } });
    for (const [id, b] of this.beats) if (!b.live) this.beats.delete(id);
  }

  /** The hour's light: what falls on a flat top from the sky and from the sun, and where the sun stands. */
  setLight(amb: readonly number[], sun: readonly number[], dir: readonly number[]) {
    // (the side away from the sun is the sky's light and a little of the sun's through the puff)
    this.U.uLit.value.set(amb[0] + sun[0], amb[1] + sun[1], amb[2] + sun[2]).multiplyScalar(1.06);
    this.U.uDim.value.set(amb[0] + sun[0] * 0.14, amb[1] + sun[1] * 0.14, amb[2] + sun[2] * 0.14);
    this.sun.set(dir[0], dir[1], dir[2]);
    this.U.uSunDir.value.copy(this.sun).normalize();
  }

  private rnd(): number {
    let x = this.seed;
    x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
    this.seed = x;
    return (x >>> 8) / 16777216;
  }

  /** Whether a spot on the ground is in view, or within `reach` m of it. */
  private inView(x: number, y: number, reach: number): boolean {
    if (!this.down) return false;
    const mx = x - this.px, my = y - this.py;
    const a = (mx * this.vy - my * this.vx) / this.det, b = (this.ux * my - this.uy * mx) / this.det;
    return a > -reach / this.lu && a < 1 + reach / this.lu && b > -reach / this.lv && b < 1 + reach / this.lv;
  }

  /** One puff, born `age` s ago at a mouth. */
  private puff(x: number, h: number, y: number, age: number, P: Plume, drift: number, tint: Float32Array, ti: number, what: number) {
    const d = this.data, o = this.head * STRIDE, w = windNow;
    const j = P.size * 0.22;
    d[o] = x + (this.rnd() - 0.5) * j;
    d[o + 1] = h + (this.rnd() - 0.5) * j * 0.5;
    d[o + 2] = y + (this.rnd() - 0.5) * j;
    d[o + 3] = this.now - age;
    const ws = w.speed * drift * (0.85 + 0.3 * this.rnd());
    d[o + 4] = w.x * ws + (this.rnd() - 0.5) * 0.5;
    // (a stiff wind lays the plume over before it has climbed far)
    d[o + 5] = P.rise * (0.8 + 0.4 * this.rnd()) * (1 - 0.2 * w.strength);
    d[o + 6] = w.y * ws + (this.rnd() - 0.5) * 0.5;
    d[o + 7] = P.life * (0.8 + 0.4 * this.rnd());
    d[o + 8] = P.size * (0.85 + 0.3 * this.rnd());
    d[o + 9] = P.grow * (0.8 + 0.4 * this.rnd());
    d[o + 10] = this.rnd();
    d[o + 11] = what;
    d[o + 12] = tint[ti]; d[o + 13] = tint[ti + 1]; d[o + 14] = tint[ti + 2];
    d[o + 15] = P.opacity;
    this.head = (this.head + 1) % POOL;
    this.wrote++;
    this.emitted++;
  }

  /**
   * A mouth's puffs for this frame: those that came due, or (when it has just come into view) the whole plume it
   * would have built up by now. Returns what it owes next frame.
   */
  private breathe(x: number, h: number, y: number, P: Plume, drift: number, tint: Float32Array, ti: number, what: number, acc: number, fresh: boolean, dt: number): number {
    this.demand += liveOf(P);
    if (fresh) {
      const n = Math.floor(liveOf(P));
      for (let k = 0; k < n; k++) this.puff(x, h, y, this.rnd() * P.life * 0.92, P, drift, tint, ti, what);
      return this.rnd();
    }
    const o = due(acc, P.rate, dt, this.owed);
    for (let k = 0; k < o.n; k++) this.puff(x, h, y, this.rnd() * dt, P, drift, tint, ti, what);
    return o.acc;
  }

  /**
   * Once a frame. `camera`: the map's camera, wherever it looks from; mpp: metres a pixel at the ground; dt: seconds
   * of the animation clock gone by (0 while the game is paused: the plumes hang still); simTime: the game's clock.
   */
  update(camera: THREE.OrthographicCamera, mpp: number, dt: number, simTime: number, traffic: Traffic | null) {
    this.clock += dt;
    if (this.clock > REBASE) {
      this.clock -= REBASE;
      for (let i = 0; i < POOL; i++) if (this.data[i * STRIDE + 3] > -1e8) this.data[i * STRIDE + 3] -= REBASE;
      this.wrote = POOL;
    }
    const now = (this.now = this.clock);
    this.U.uTime.value = now;
    this.U.uMpp.value = mpp;
    this.U.uZoom.value = zoomScale(mpp);
    // where the sun is on the screen (the lit side of every puff)
    this.right.setFromMatrixColumn(camera.matrixWorld, 0);
    this.upv.setFromMatrixColumn(camera.matrixWorld, 1);
    const sx = this.sun.dot(this.right), sy = this.sun.dot(this.upv), sl = Math.hypot(sx, sy);
    if (sl > 0.05) this.U.uSunScr.value.set(sx / sl, sy / sl); else this.U.uSunScr.value.set(-0.5, 0.86);
    // the ground in view: the screen's corners cast down the view direction
    camera.getWorldDirection(this.dir);
    const d = this.dir, C = this.corner;
    this.down = d.y < -0.05;
    if (this.down) {
      for (let k = 0; k < 4; k++) {
        const p = C[k].set(k === 0 || k === 3 ? -1 : 1, k < 2 ? -1 : 1, 0).unproject(camera);
        const s = -p.y / d.y;
        p.set(p.x + d.x * s, 0, p.z + d.z * s);
      }
      this.px = C[0].x; this.py = C[0].z;
      this.ux = C[1].x - C[0].x; this.uy = C[1].z - C[0].z;
      this.vx = C[3].x - C[0].x; this.vy = C[3].z - C[0].z;
      this.lu = Math.hypot(this.ux, this.uy) || 1; this.lv = Math.hypot(this.vx, this.vy) || 1;
      this.det = this.ux * this.vy - this.uy * this.vx || 1;
    }
    // every works' pulse, in view or not (so its plume is right the moment it is)
    this.frame++;
    for (let i = 0; i < this.works.length; i++) {
      const bt = this.wBeat[i];
      if (bt.frame === this.frame) continue;
      bt.frame = this.frame;
      const b = this.works[i].b, P = b.plant;
      const speed = P && b.built >= 1 ? feel(bt.pulse, P.prog, simTime, PLANTS[b.kind as PlantKind]?.cycle ?? 60) : 0;
      const want = smokeOf(speed);
      // (a stack takes a few seconds to come up, and longer to die away)
      bt.k += (want - bt.k) * (1 - Math.exp(-dt / (want > bt.k ? 2.5 : 5)));
      if (want === 0 && bt.k < 0.02) bt.k = 0;
    }
    if (dt <= 0) { this.upload(); return; }
    // from far off: fewer puffs (each no smaller than a few pixels, so the plume still reads)
    const far = THREE.MathUtils.clamp(1 / mpp, 0.32, 1) * this.thin;
    this.demand = 0;
    const P = this.plume;
    for (let i = 0; i < this.works.length; i++) {
      const e = this.works[i], k = this.wBeat[i].k;
      if (k <= 0 || !this.inView(e.x, e.y, MARGIN + e.h) || !e.up()) { this.wSeen[i] = 0; continue; }
      const fresh = !this.wSeen[i];
      this.wSeen[i] = 1;
      if (e.kind === "flare") {
        // the flame at the tip, and the thin dark smoke off it
        plumeOf("flame", e.size, k, P);
        if (mpp < 1.4) this.wAcc[i * 2 + 1] = this.breathe(e.x, e.h, e.y, P, LOOKS.flame.drift, this.tint, 3 * 5, FLAME, this.wAcc[i * 2 + 1], fresh, dt);
      }
      plumeOf(e.kind, e.size, k, P);
      P.rate *= far;
      // (a crusher works in bursts, a saw screams and stops: dust comes and goes)
      if (e.kind === "dust" || e.kind === "haze") P.rate *= 0.35 + 1.3 * (0.5 + 0.5 * Math.sin(now * 0.55 + i * 2.4)) ** 2;
      const what = e.kind === "dust" || e.kind === "haze" ? PLAIN : WORKS;
      this.wAcc[i * 2] = this.breathe(e.x, e.h, e.y, P, LOOKS[e.kind].drift, this.wTint, i * 3, what, this.wAcc[i * 2], fresh, dt);
    }
    // the homes' chimneys, in the cold
    const fire = hearth(ENV.uSeasonB.value.x, ENV.uSeasonB.value.y, ENV.uSeasonA.value.y, ENV.uNight.value.x);
    if (fire > 0.04 && mpp < HOME_MPP && this.homes.length) {
      // (thinning out toward the zoom they are lost at)
      const near = Math.min(1, (HOME_MPP - mpp) / 0.1);
      for (let i = 0; i < this.homes.length; i++) {
        const e = this.homes[i];
        if (e.b.abandoned || !fireLit(e.b.id, fire) || !this.inView(e.x, e.y, 30) || !e.up()) { this.hSeen[i] = 0; continue; }
        const fresh = !this.hSeen[i];
        this.hSeen[i] = 1;
        plumeOf("chimney", e.size, 1, P);
        P.rate *= this.thin * (0.55 + 0.45 * near);
        P.opacity *= near;
        this.hAcc[i] = this.breathe(e.x, e.h, e.y, P, LOOKS.chimney.drift, this.tint, 3 * 6, PLAIN, this.hAcc[i], fresh, dt);
      }
    } else if (this.homes.length) this.hSeen.fill(0);
    // dust behind the wheels on the dirt roads (dry ones: none in the snow)
    const dry = 1 - Math.min(1, ENV.uSeasonB.value.y * 2.5);
    if (traffic && mpp < TRAIL_MPP && dry > 0.02) {
      const fadeOut = Math.min(1, (TRAIL_MPP - mpp) / 0.2) * dry;
      const vs = traffic.vehicles;
      for (let q = 0; q < vs.length; q++) {
        const v = vs[q];
        if (v.edge.kind !== "lane" || !(v.edge as Lane).rough || v.v < 2.5 || v.h > 0.3 || !this.inView(v.x, v.y, 12)) continue;
        const rate = trailRate(v.v, v.truck) * this.thin;
        const a = (this.trailAcc.get(v.id) ?? this.rnd()) + rate * dt;
        const n = Math.floor(a);
        this.trailAcc.set(v.id, a - n);
        if (!n) continue;
        plumeOf("trail", v.truck ? 1.7 : 1.25, 1, P);
        P.opacity *= fadeOut;
        this.demand += rate * P.life;
        const back = v.len * 0.42, cx = Math.cos(v.ang), cy = Math.sin(v.ang);
        for (let k = 0; k < n; k++) this.puff(v.x - cx * back, 0.35, v.y - cy * back, this.rnd() * dt, P, LOOKS.trail.drift, this.tint, 3 * 7, PLAIN);
      }
      if (this.trailAcc.size > 4000) this.trailAcc.clear();
    }
    // (if the pool would overflow, every mouth gives a little less next frame)
    const over = this.demand / (POOL * FULL);
    this.thin = THREE.MathUtils.clamp(this.thin * (over > 1 ? 1 / over : Math.min(1.02, 1 / Math.max(over, 1e-3))), 0.15, 1);
    this.upload();
  }

  /** Send the puffs born this frame to the GPU (only those: the rest have not changed). */
  private upload() {
    const n = this.wrote;
    if (!n) return;
    this.wrote = 0;
    const R = this.buf.updateRanges as { start: number; count: number }[];
    R.length = 0;
    if (n < POOL) {
      const first = (this.head - n + POOL) % POOL;
      const a = this.ranges[0], b = this.ranges[1];
      a.start = first * STRIDE;
      a.count = Math.min(n, POOL - first) * STRIDE;
      R.push(a);
      if (first + n > POOL) { b.start = 0; b.count = (first + n - POOL) * STRIDE; R.push(b); }
    }
    this.buf.needsUpdate = true;
  }
}
