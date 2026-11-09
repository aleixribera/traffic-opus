// Birds (docs/design.md, "A world that moves"): a few of them wheeling over the woods and the fields by day. Small
// life between the towns: tiny, dark, each with its shadow sliding over the ground under it, gone at night and in
// the data maps, fewer in winter. They are nothing to the game; they are there so that open country is not still.
//
// Where the flocks are is a rule over the map's own fields (the same for everyone on the same map): the map is cut
// into cells, and a cell over woodland or farmland more often has a flock than one over open ground, and one over
// water has none. A bird's path is a closed form of the clock (a circle that wanders on a slower one), so nothing
// moves on the CPU: the instances are written when the view moves on to other cells, and the vertex shader flies
// them. One draw call, a fixed pool, no allocation per frame.

import * as THREE from "three";
import { F, MOUNTAIN_STEPS, waterOf } from "../world/gen";
import { ENV, ENV_CORE_GLSL } from "./envShader";

/** The side (m) of the cells the map is cut into: at most one flock to a cell. */
export const FLOCK_CELL = 320;
/** Birds in the air at once, at most. */
export const MAX_BIRDS = 160;
/** The birds' clock wraps at this (s): every turn rate is a whole number of turns in it, so the wrap is seamless. */
export const BIRD_LOOP = 4096;
/** Past this zoom (m a pixel) a bird is too small to draw. */
export const BIRD_MPP = 1.0;
/** How far outside the view (m) a flock's cell is still flown: its birds wheel in and out of the edge. */
const MARGIN = 120;
const STRIDE = 12;

/** One flock: where it wheels, how many, and its own random number. */
export interface Flock { x: number; y: number; n: number; seed: number }
/** One bird of a flock, as the shader flies it. */
export interface Bird {
  /** the middle of its circle (map x, y), the circle's radius (m), its height (m) */
  x: number; y: number; r: number; h: number;
  /** where on the circle it starts (rad); whole turns it makes in BIRD_LOOP s (its sign: which way round) */
  phase: number; turns: number;
  /** its wingspan (m) and its own random number */
  span: number; seed: number;
}

const hash = (i: number, j: number, k: number): number => {
  let x = (Math.imul(i | 0, 0x9e3779b1) ^ Math.imul(j | 0, 0x85ebca77) ^ Math.imul(k | 0, 0xc2b2ae3d)) | 0;
  x ^= x >>> 15; x = Math.imul(x, 0x2c1b3c6d); x ^= x >>> 12; x = Math.imul(x, 0x297a2d39); x ^= x >>> 15;
  return (x >>> 8) / 16777216;
};

/**
 * How much the birds like a spot, 0..1, from the map's fields there (world/gen.ts `at`): woodland most, farmland
 * next, open ground a little, the high rock hardly, open water not at all.
 */
export function habitat(o: ArrayLike<number>): number {
  if (waterOf(o) >= 0.45) return 0;
  const land = Math.max(0.22, o[F.forest] > 0.5 ? 1 : 0, o[F.fert] > 0.5 ? 0.75 : 0);
  return o[F.mtn] > MOUNTAIN_STEPS[1] ? Math.min(land, 0.15) : land;
}

/**
 * The flock of a cell, if it has one: `fields(x, y)` gives the map's fields at a spot. The same cell has the same
 * flock every time.
 */
export function flockAt(i: number, j: number, fields: (x: number, y: number) => ArrayLike<number>, out: Flock): boolean {
  const x = (i + 0.2 + 0.6 * hash(i, j, 1)) * FLOCK_CELL, y = (j + 0.2 + 0.6 * hash(i, j, 2)) * FLOCK_CELL;
  if (hash(i, j, 3) >= 0.5 * habitat(fields(x, y))) return false;
  out.x = x; out.y = y;
  out.n = 2 + Math.floor(hash(i, j, 4) * 2.99);
  out.seed = hash(i, j, 5);
  return true;
}

/** Bird `k` of a flock: each on its own circle about the flock's middle, the big ones high and slow. */
export function birdOf(f: Flock, k: number, out: Bird): Bird {
  const s = Math.floor(f.seed * 65536), a = hash(s, k, 11), b = hash(s, k, 12), c = hash(s, k, 13), d = hash(s, k, 14);
  out.r = 22 + 34 * a;
  out.x = f.x + (b - 0.5) * 50;
  out.y = f.y + (c - 0.5) * 50;
  out.h = 34 + 30 * d + 10 * a;
  out.phase = hash(s, k, 15) * Math.PI * 2;
  // (once round in 28 to 50 s; a flock mostly turns the one way, on the same rising air)
  const period = 28 + 22 * a;
  out.turns = Math.round(BIRD_LOOP / period) * (hash(s, k, 16) < 0.82 === f.seed < 0.5 ? 1 : -1);
  // (drawn about twice life size: a bird is a speck from up here, and a speck would not be seen)
  out.span = 4.2 + 1.4 * d;
  out.seed = hash(s, k, 17);
  return out;
}

/** The slower loop a bird's circle wanders on: whole turns in BIRD_LOOP s. */
export const wanderTurns = (turns: number) => Math.max(1, Math.floor(Math.abs(turns) * 0.37));

/**
 * Where a bird is at a moment of the birds' clock (the CPU's twin of the vertex shader below, for the tests): its
 * place on the map and its height through `out`.
 */
export function wheel(b: Bird, t: number, out: { x: number; y: number; h: number }) {
  const w = (Math.PI * 2) / BIRD_LOOP;
  const a = b.phase + b.turns * w * t, a2 = b.phase * 3 + b.seed * 6.2832 + wanderTurns(b.turns) * w * t;
  out.x = b.x + b.r * Math.cos(a) + b.r * 0.45 * Math.cos(a2);
  out.y = b.y + b.r * Math.sin(a) + b.r * 0.45 * Math.sin(a2);
  out.h = b.h + 4 * Math.sin(a2 + b.seed * 9);
  return out;
}

/** The share of the flocks that fly in a season (`bare`: 0 in leaf .. 1 midwinter): fewer in the cold. */
export const flying = (bare: number) => 1 - 0.6 * Math.min(1, Math.max(0, bare));

export class Birds {
  readonly mesh: THREE.Mesh;
  /** Birds in the instance buffer now (the dev hook and the tests read it). */
  count = 0;

  private data = new Float32Array(MAX_BIRDS * 2 * STRIDE);
  private buf: THREE.InstancedInterleavedBuffer;
  private geo: THREE.InstancedBufferGeometry;
  private U = {
    ...ENV,
    uTime: { value: 0 },
    uMpp: { value: 1 },
    uFade: { value: 1 },
    uShare: { value: 1 },
    uSunDir: { value: new THREE.Vector3(-0.4, 0.8, -0.4) },
    uLit: { value: new THREE.Vector3(1, 1, 1) },
  };
  private fields: ((x: number, y: number) => ArrayLike<number>) | null = null;
  private clock = 0;
  private i0 = 1; private i1 = 0; private j0 = 1; private j1 = 0;
  private flock: Flock = { x: 0, y: 0, n: 0, seed: 0 };
  private bird: Bird = { x: 0, y: 0, r: 0, h: 0, phase: 0, turns: 1, span: 1, seed: 0 };
  private dir = new THREE.Vector3();
  private corner = new THREE.Vector3();

  constructor() {
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = (this.geo = new THREE.InstancedBufferGeometry());
    geo.setIndex(quad.getIndex());
    geo.setAttribute("position", quad.getAttribute("position"));
    this.buf = new THREE.InstancedInterleavedBuffer(this.data, STRIDE);
    this.buf.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("aA", new THREE.InterleavedBufferAttribute(this.buf, 4, 0));
    geo.setAttribute("aB", new THREE.InterleavedBufferAttribute(this.buf, 4, 4));
    geo.setAttribute("aC", new THREE.InterleavedBufferAttribute(this.buf, 4, 8));
    geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      uniforms: this.U,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      vertexShader: /* glsl */ `
attribute vec4 aA; // the middle of its circle (x, z), the radius, its height
attribute vec4 aB; // where on the circle it starts, whole turns in the loop (signed), its wingspan, its random number
attribute vec4 aC; // its flock's random number, 1 for its shadow, the wander's whole turns
uniform float uTime; uniform float uMpp; uniform float uFade; uniform float uShare; uniform vec3 uSunDir;
varying vec2 vUv; varying float vShadow; varying float vFlap;
void main() {
  vUv = position.xy * 2.0;
  vShadow = aC.y;
  // (in the cold fewer flocks fly: the same ones each winter)
  if (aC.x > uShare || uFade <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  float w = 6.2831853 / ${BIRD_LOOP.toFixed(1)};
  float a = aB.x + aB.y * w * uTime, a2 = aB.x * 3.0 + aB.w * 6.2832 + aC.z * w * uTime;
  vec2 c = aA.xy + aA.z * vec2(cos(a), sin(a)) + aA.z * 0.45 * vec2(cos(a2), sin(a2));
  float h = aA.w + 4.0 * sin(a2 + aB.w * 9.0);
  // which way it is flying, and how hard it is turning (it banks into the turn)
  vec2 vel = aB.y * vec2(-sin(a), cos(a)) + 0.45 * aC.z * vec2(-sin(a2), cos(a2));
  vec2 fwd = normalize(vel);
  vec2 rgt = vec2(-fwd.y, fwd.x);
  // (a bird is drawn no smaller than a few pixels: a speck that still reads as a bird)
  float span = max(aB.z, 9.0 * uMpp);
  // mostly it glides; now and then a few slow beats
  float beat = smoothstep(0.45, 0.8, sin(uTime * w * floor(160.0 + aB.w * 90.0) + aB.w * 40.0));
  float flap = sin(uTime * 6.2831853 * 2.5 + aB.w * 20.0) * beat;
  vFlap = flap;
  float tip = abs(position.x) * 2.0;
  vec3 p;
  if (aC.y > 0.5) {
    // its shadow, on the ground where the sun casts it (a low sun's is kept from running off across the map)
    vec2 g = c - uSunDir.xz / max(uSunDir.y, 0.34) * h;
    g += rgt * position.x * span + fwd * position.y * span * 0.8;
    p = vec3(g.x, 0.5, g.y);
  } else {
    float bank = sign(aB.y) * 0.3;
    float lift = position.x * span * bank + tip * span * 0.22 * flap;
    vec2 q = c + rgt * position.x * span * (1.0 - 0.18 * abs(flap)) + fwd * position.y * span * 0.8;
    p = vec3(q.x, h + lift, q.y);
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`,
      fragmentShader: /* glsl */ `
${ENV_CORE_GLSL}
uniform float uFade; uniform vec3 uLit;
varying vec2 vUv; varying float vShadow; varying float vFlap;
void main() {
  // a bird from above (lengths in half wingspans): a body, two wings out to the wrist and swept back from it to
  // the tips, a short fanned tail
  float x = abs(vUv.x), y = vUv.y * 0.8;
  float aa = max(fwidth(vUv.x), fwidth(vUv.y)) * 0.8 + 0.012;
  float mid = x < 0.42 ? 0.05 + 0.45 * x : 0.239 - 0.8 * (x - 0.42);
  float wing = min(mix(0.14, 0.04, smoothstep(0.1, 0.95, x)) - abs(y - mid), 0.97 - x);
  float body = (1.0 - length(vec2(x / 0.095, (y - 0.02) / 0.34))) * 0.095;
  float tail = min(min(0.04 + 0.3 * (-0.22 - y) - x, y + 0.5), -0.2 - y);
  float d = max(max(wing, body), tail);
  float a = smoothstep(-aa, aa, d);
  if (vShadow > 0.5) {
    gl_FragColor = vec4(0.03, 0.05, 0.1, a * 0.26 * uShade.x * uFade);
  } else {
    // pale against the land (white birds: they show over the woods and the fields alike), the wing tips dark
    vec3 col = envGrade(mix(vec3(0.9, 0.88, 0.82), vec3(0.1, 0.1, 0.11), smoothstep(0.62, 0.86, x))) * uLit;
    gl_FragColor = vec4(col, a * uFade);
  }
  if (gl_FragColor.a < 0.01) discard;
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`,
    });
    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7;
  }

  /** A new map: its fields say where the flocks are. */
  setWorld(fields: (x: number, y: number) => ArrayLike<number>) {
    this.fields = fields;
    this.i0 = 1; this.i1 = 0;
    this.count = 0;
    this.geo.instanceCount = 0;
  }

  setLight(amb: readonly number[], sun: readonly number[], dir: readonly number[]) {
    this.U.uLit.value.set(amb[0] + sun[0] * 0.8, amb[1] + sun[1] * 0.8, amb[2] + sun[2] * 0.8);
    this.U.uSunDir.value.set(dir[0], dir[1], dir[2]).normalize();
  }

  dispose() {
    this.geo.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }

  /**
   * Once a frame. `camera`: the map's camera, wherever it looks from; mpp: metres a pixel at the ground; dt: seconds
   * of the animation clock gone by (0 while the game is paused: the birds hang where they are).
   */
  update(camera: THREE.OrthographicCamera, mpp: number, dt: number) {
    this.clock = (this.clock + dt) % BIRD_LOOP;
    this.U.uTime.value = this.clock;
    this.U.uMpp.value = mpp;
    // by day only, and not from so far off that a bird is less than a speck
    const day = 1 - THREE.MathUtils.smoothstep(ENV.uNight.value.x, 0.12, 0.45);
    const fade = day * (1 - THREE.MathUtils.smoothstep(mpp, BIRD_MPP * 0.72, BIRD_MPP));
    this.U.uFade.value = fade;
    this.U.uShare.value = flying(ENV.uSeasonB.value.x);
    this.mesh.visible = fade > 0 && this.fields !== null;
    if (!this.mesh.visible) return;
    // the cells under the view: the screen's corners cast down the view direction on to the ground
    const d = camera.getWorldDirection(this.dir);
    if (d.y > -0.05) { this.mesh.visible = false; return; }
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let k = 0; k < 4; k++) {
      const p = this.corner.set(k === 0 || k === 3 ? -1 : 1, k < 2 ? -1 : 1, 0).unproject(camera);
      const s = -p.y / d.y, gx = p.x + d.x * s, gy = p.z + d.z * s;
      if (gx < x0) x0 = gx;
      if (gx > x1) x1 = gx;
      if (gy < y0) y0 = gy;
      if (gy > y1) y1 = gy;
    }
    const i0 = Math.floor((x0 - MARGIN) / FLOCK_CELL), i1 = Math.floor((x1 + MARGIN) / FLOCK_CELL);
    const j0 = Math.floor((y0 - MARGIN) / FLOCK_CELL), j1 = Math.floor((y1 + MARGIN) / FLOCK_CELL);
    if (i0 === this.i0 && i1 === this.i1 && j0 === this.j0 && j1 === this.j1) return;
    this.i0 = i0; this.i1 = i1; this.j0 = j0; this.j1 = j1;
    this.fill();
  }

  /** Write the birds of the cells in view (each twice: itself and its shadow). */
  private fill() {
    const D = this.data, f = this.flock, b = this.bird;
    let n = 0;
    cells: for (let j = this.j0; j <= this.j1; j++) {
      for (let i = this.i0; i <= this.i1; i++) {
        if (!flockAt(i, j, this.fields!, f)) continue;
        for (let k = 0; k < f.n; k++) {
          if (n >= MAX_BIRDS) break cells;
          birdOf(f, k, b);
          for (let s = 0; s < 2; s++) {
            // (the shadows first, so a bird is drawn over another's shadow)
            const o = (s === 0 ? n : MAX_BIRDS + n) * STRIDE;
            D[o] = b.x; D[o + 1] = b.y; D[o + 2] = b.r; D[o + 3] = b.h;
            D[o + 4] = b.phase; D[o + 5] = b.turns; D[o + 6] = b.span; D[o + 7] = b.seed;
            D[o + 8] = f.seed; D[o + 9] = s === 0 ? 1 : 0; D[o + 10] = wanderTurns(b.turns); D[o + 11] = 0;
          }
          n++;
        }
      }
    }
    // (the birds are packed up against their shadows, so one run of instances draws both)
    if (n < MAX_BIRDS) D.copyWithin(n * STRIDE, MAX_BIRDS * STRIDE, (MAX_BIRDS + n) * STRIDE);
    this.count = n;
    this.geo.instanceCount = n * 2;
    this.buf.clearUpdateRanges();
    this.buf.needsUpdate = true;
  }
}
