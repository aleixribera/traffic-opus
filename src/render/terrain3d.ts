import * as THREE from "three";
import { TILE } from "../config";
import { NF, RIVER_K, RIVER_S } from "../world/gen";
import { CH, RES, type Terrain } from "../world/terrain";
import { PAL } from "./palette";
import type { View } from "./view";

export const MOUNTAIN_STEP_H = 7;
const N = CH + 4; // texels per chunk side: nodes -1 .. CH+2
const OWN = 256; // owned-tile texture covers tiles -128..127 on each axis
const LODS = 5; // chunk size 1 km * 4^L
const MAX_PER_LOD = 220;
const MAX_CITIES = 24;

const col = (c: number) => new THREE.Color(c);

interface Chunk {
  mesh: THREE.Mesh;
  tex: THREE.DataTexture[];
  used: number;
}

/**
 * The ground: endless, chunked, with level of detail. Every chunk is a flat quad whose fragment shader evaluates
 * the terrain fields (water, terraced hills, grass, sand, forest, resources) from a small byte texture with the
 * same B-spline the game rules use, so edges stay crisp at any zoom and match the rules exactly. Terrace
 * shading and the shadows hills throw are drawn in the shader too; buildings' shadows come from the shadow map.
 */
export class Terrain3D {
  readonly group = new THREE.Group();
  private lods: Map<string, Chunk>[] = Array.from({ length: LODS }, () => new Map());
  private queue: { lod: number; ci: number; cj: number; d: number }[] = [];
  private frame = 0;
  private plane = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2).translate(0.5, 0, 0.5);
  private ownTex: THREE.DataTexture;
  private ownData = new Uint8Array(OWN * OWN);
  readonly shared = {
    uOverlay: { value: 0 }, // 0 none, 1 resources, 2 land tiles
    uOwn: { value: null as unknown as THREE.DataTexture },
    uTile: { value: TILE },
    uSun: { value: new THREE.Vector2(-0.56, -0.83) },
    uCities: { value: Array.from({ length: MAX_CITIES }, () => new THREE.Vector4(0, 0, 0, 0)) },
  };

  constructor(private terrain: Terrain, _small: boolean) {
    this.ownTex = new THREE.DataTexture(this.ownData, OWN, OWN, THREE.RedFormat, THREE.UnsignedByteType);
    this.ownTex.needsUpdate = true;
    this.shared.uOwn.value = this.ownTex;
    // far background under everything (the endless map never shows it, but the first frame might)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1e6, 1e6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.ground }));
    bg.position.y = -2;
    this.group.add(bg);
  }

  /** Owned land tiles ("i,j" keys). */
  setTiles(owned: Set<string>) {
    this.ownData.fill(0);
    for (const k of owned) {
      const [i, j] = k.split(",").map(Number);
      const a = i + OWN / 2, b = j + OWN / 2;
      if (a >= 0 && b >= 0 && a < OWN && b < OWN) this.ownData[b * OWN + a] = 255;
    }
    this.ownTex.needsUpdate = true;
  }

  /** Outside cities drawn as urban fabric on the ground: (x, y, radius, seed). */
  setGateways(gws: { p: { x: number; y: number }; r: number; id: number }[]) {
    const u = this.shared.uCities.value;
    for (let i = 0; i < MAX_CITIES; i++) {
      const g = gws[i];
      if (g) u[i].set(g.p.x, g.p.y, g.r, g.id * 7.31 + 1.7); else u[i].set(0, 0, 0, 0);
    }
  }

  setOverlay(mode: "none" | "resources" | "tiles") {
    this.shared.uOverlay.value = mode === "resources" ? 1 : mode === "tiles" ? 2 : 0;
  }

  /** Call every frame: keeps the chunks covering the view built, at the right detail, within a time budget. */
  update(view: View) {
    this.frame++;
    const mpp = view.mpp;
    // node spacing should stay above ~2 screen pixels
    let L = 0;
    while (L < LODS - 1 && RES * 4 ** L < mpp * 2.2) L++;
    const halfW = view.halfH * (view.w / view.h);
    const x0 = view.cx - halfW, x1 = view.cx + halfW, y0 = view.cy - view.halfH, y1 = view.cy + view.halfH;
    this.queue.length = 0;
    // the wanted level, plus the next coarser one underneath while the fine chunks are still being made
    for (const lod of [L, Math.min(LODS - 1, L + 1)]) {
      const S = CH * RES * 4 ** lod;
        for (let cj = Math.floor(y0 / S) - 1; cj <= Math.floor(y1 / S); cj++) {
        for (let ci = Math.floor(x0 / S) - 1; ci <= Math.floor(x1 / S); ci++) {
          if ((ci + 1) * S < x0 || ci * S > x1 || (cj + 1) * S < y0 || cj * S > y1) continue;
          const c = this.lods[lod].get(`${ci},${cj}`);
          if (c) { c.used = this.frame; c.mesh.visible = true; c.mesh.position.y = lod === L ? 0 : -0.2 - lod * 0.01; continue; }
          const cx = (ci + 0.5) * S, cy = (cj + 0.5) * S;
          this.queue.push({ lod, ci, cj, d: (lod === L ? 0 : -1e12) + Math.hypot(cx - view.cx, cy - view.cy) });
        }
      }
    }
    // hide what's not in view this frame; free the oldest beyond the cap
    for (let lod = 0; lod < LODS; lod++) {
      const map = this.lods[lod];
      for (const c of map.values()) if (c.used !== this.frame) c.mesh.visible = false;
      if (map.size > MAX_PER_LOD) {
        const old = [...map.entries()].filter(([, c]) => c.used !== this.frame).sort((a, b) => a[1].used - b[1].used);
        for (const [k, c] of old.slice(0, map.size - MAX_PER_LOD)) this.dispose(c), map.delete(k);
      }
    }
    // coarse first (fills the screen fast), then nearest-first; ~7 ms a frame
    this.queue.sort((a, b) => a.d - b.d);
    const t0 = performance.now();
    for (const q of this.queue) {
      this.build(q.lod, q.ci, q.cj);
      if (performance.now() - t0 > 7) break;
    }
  }

  /** Whether everything in view is built at the wanted detail (tests / screenshots wait on this). */
  get settled() {
    return this.queue.length === 0;
  }

  private build(lod: number, ci: number, cj: number) {
    const step = 4 ** lod;
    const res = RES * step;
    const data = [new Uint8Array(N * N * 4), new Uint8Array(N * N * 4)];
    const i0 = ci * CH - 1, j0 = cj * CH - 1;
    const t = this.terrain;
    const o = new Float32Array(NF);
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        const k = (b * N + a) * 4;
        if (lod === 0) {
          for (let f = 0; f < NF; f++) data[f >> 2][k + (f & 3)] = t.node(f, i0 + a, j0 + b);
        } else {
          t.gen.at((i0 + a) * res, (j0 + b) * res, o);
          for (let f = 0; f < NF; f++) data[f >> 2][k + (f & 3)] = Math.round(o[f] * 255);
        }
      }
    }
    const tex = data.map((d) => {
      const tx = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      tx.needsUpdate = true;
      return tx;
    });
    const mat = this.material(tex, i0 * res, j0 * res, res);
    const S = CH * res;
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.scale.set(S, 1, S);
    mesh.position.set(ci * S, 0, cj * S);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);
    this.lods[lod].set(`${ci},${cj}`, { mesh, tex, used: this.frame });
  }

  private dispose(c: Chunk) {
    this.group.remove(c.mesh);
    (c.mesh.material as THREE.Material).dispose();
    for (const t of c.tex) t.dispose();
  }

  private material(tex: THREE.DataTexture[], ox: number, oy: number, res: number): THREE.Material {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const local = {
      uF0: { value: tex[0] },
      uF1: { value: tex[1] },
      uOrigin: { value: new THREE.Vector2(ox, oy) },
      uRes: { value: res },
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, local, this.shared);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(position, 1.0)).xz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n${GROUND_GLSL}`)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = groundColor(vWorld);");
    };
    mat.customProgramCacheKey = () => "ground-v1";
    return mat;
  }
}

const c3 = (c: number) => {
  const k = col(c);
  return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`;
};

const GROUND_GLSL = /* glsl */ `
varying vec2 vWorld;
uniform sampler2D uF0; uniform sampler2D uF1; uniform sampler2D uOwn;
uniform vec4 uCities[${MAX_CITIES}];
uniform vec2 uOrigin; uniform float uRes; uniform float uOverlay; uniform float uTile; uniform vec2 uSun;

vec4 bsw(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}
// B-spline of both field textures at world point p (same weights and bytes as Terrain.sample)
void fields(vec2 p, out vec4 a, out vec4 b) {
  vec2 u = (p - uOrigin) / uRes;
  vec2 i = floor(u); vec2 f = u - i;
  vec4 wx = bsw(f.x), wy = bsw(f.y);
  a = vec4(0.0); b = vec4(0.0);
  ivec2 lo = ivec2(0), hi = ivec2(${N - 1});
  for (int y = 0; y < 4; y++) {
    vec4 ra = vec4(0.0), rb = vec4(0.0);
    for (int x = 0; x < 4; x++) {
      ivec2 q = clamp(ivec2(i) + ivec2(x - 1, y - 1), lo, hi);
      ra += texelFetch(uF0, q, 0) * wx[x];
      rb += texelFetch(uF1, q, 0) * wx[x];
    }
    a += ra * wy[y]; b += rb * wy[y];
  }
}
float mtnOnly(vec2 p) {
  vec2 u = (p - uOrigin) / uRes;
  vec2 i = floor(u); vec2 f = u - i;
  vec4 wx = bsw(f.x), wy = bsw(f.y);
  float s = 0.0;
  ivec2 lo = ivec2(0), hi = ivec2(${N - 1});
  for (int y = 0; y < 4; y++) {
    float r = 0.0;
    for (int x = 0; x < 4; x++) r += texelFetch(uF0, clamp(ivec2(i) + ivec2(x - 1, y - 1), lo, hi), 0).r * wx[x];
    s += r * wy[y];
  }
  return s;
}
float hash12(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2(1, 0)), u.x), mix(hash12(i + vec2(0, 1)), hash12(i + vec2(1, 1)), u.x), u.y);
}
// coverage of a field above 0.5 with a one-pixel soft edge
float cov(float v) { float w = max(fwidth(v), 1e-4) * 0.75; return smoothstep(0.5 - w, 0.5 + w, v); }

vec3 groundColor(vec2 p) {
  vec4 A, B;
  fields(p, A, B);
  float m = A.r, lake = A.g, flow = A.a;
  float fert = B.r, forest = B.g, ore = B.b, oil = B.a;
  float mpp = fwidth(p.x);
  // rivers from the signed river noise; never thinner than ~1.5 px so they read at any zoom
  float sAbs = abs((A.b - 0.5) / 4.0);
  float rwid = smoothstep(0.3, 0.75, flow);
  float rw = max(${RIVER_S} * rwid, fwidth(sAbs) * 0.75 * smoothstep(0.5, 0.8, rwid));
  float water = max(lake, 0.5 + (rw - sAbs) * ${RIVER_K.toFixed(1)});
  // decoration fades out as you zoom out so the far map stays calm
  float decoK = mix(1.0, 0.35, smoothstep(5.0, 16.0, mpp));
  float deco = vnoise(p / 600.0) * 0.55 + vnoise(p / 230.0 + 31.7) * 0.3 + vnoise(p / 90.0 - 12.1) * 0.15;
  deco = deco + 0.06 + (forest - 0.5) * 0.3;
  vec3 c = ${c3(PAL.ground)};
  float sand = max(1.0 - cov(deco + 0.27), cov(water + 0.08) * (1.0 - cov(deco - 0.06)));
  c = mix(c, ${c3(PAL.sand)}, sand * decoK);
  c = mix(c, ${c3(PAL.grass)}, cov(deco) * decoK);
  // forest floor with tree crowns (cells of ~7 m, one crown each, shadow down-right); flat when far out
  float fo = cov(forest);
  float crownK = 1.0 - smoothstep(0.9, 1.6, mpp);
  if (fo > 0.0) {
    vec3 floorC = ${c3(PAL.forestFloor)};
    vec3 fc = mix(floorC, ${c3(PAL.tree)}, 0.7);
    if (crownK > 0.0) {
      vec2 g = p / 7.0;
      vec2 gi = floor(g);
      float crown = 0.0, shade = 0.0, tone = 0.0;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        vec2 cell = gi + vec2(x, y);
        float h = hash12(cell);
        vec2 ctr = cell + 0.5 + (vec2(hash12(cell + 17.1), hash12(cell + 41.7)) - 0.5) * 0.6;
        float r = 0.36 + 0.14 * h;
        float d = length(g - ctr);
        float d2 = length(g - ctr - vec2(0.16, 0.22));
        float aa = fwidth(d) + 1e-4;
        float cr = 1.0 - smoothstep(r - aa, r + aa, d);
        if (cr > crown) { crown = cr; tone = hash12(cell + 5.3); }
        shade = max(shade, 1.0 - smoothstep(r - aa, r + aa, d2));
      }
      vec3 tree = mix(${c3(PAL.tree)}, ${c3(PAL.treeLight)}, tone * 0.6);
      vec3 near = mix(floorC, floorC * 0.82, shade);
      near = mix(near, tree, crown);
      fc = mix(fc, near, crownK);
    }
    c = mix(c, fc, fo);
  }
  // terraced hills: flat tiers, a lit or shaded bevel at each step, and the shadow each tier throws
  float lvl = 0.0;
  vec3 mc = c;
  float steps[4] = float[4](0.5, 0.6, 0.7, 0.8);
  vec3 mcol[4] = vec3[4](${c3(PAL.mountain[0])}, ${c3(PAL.mountain[1])}, ${c3(PAL.mountain[2])}, ${c3(PAL.mountain[3])});
  for (int k = 0; k < 4; k++) {
    float a = cov(m - steps[k] + 0.5);
    mc = mix(mc, mcol[k], a);
    lvl += step(steps[k], m);
  }
  // bevel: near a step edge, tint by which way the slope faces the sun
  vec2 gm = vec2(dFdx(m), dFdy(m));
  float gl = length(gm);
  if (gl > 1e-6) {
    // screen y runs north, world y south
    float facing = dot(normalize(vec2(-gm.x, gm.y)), uSun);
    for (int k = 0; k < 4; k++) {
      float d = (m - steps[k]) / max(gl, 1e-6); // pixels from the edge, inside > 0
      float band = (1.0 - smoothstep(0.0, 4.0, d)) * step(0.0, d);
      mc *= 1.0 + band * facing * 0.10;
    }
  }
  c = mc;
  // shadows of higher tiers: a point is in shadow when the ground k tiers higher lies within k step-shadows
  // towards the sun (a 7 m step throws a ~5 m shadow)
  float sh = 0.0;
  if (uRes < 300.0) {
    for (int k = 1; k <= 3; k++) {
      float mm = mtnOnly(p + uSun * float(k) * ${(MOUNTAIN_STEP_H * 0.75).toFixed(2)});
      float up = 0.0;
      for (int s = 0; s < 4; s++) up += step(steps[s], mm);
      if (up - lvl >= float(k)) sh = 1.0;
    }
  }
  c *= 1.0 - sh * 0.3;
  // water: periwinkle with a darker rim
  float wa = cov(water);
  if (wa > 0.0) {
    float wd = (water - 0.5) / max(fwidth(water), 1e-5);
    vec3 wc = mix(${c3(PAL.waterEdge)}, ${c3(PAL.water)}, smoothstep(1.0, 3.0, wd));
    c = mix(c, wc, wa);
  }
  // outside cities: a block grid of roofs inside a ragged edge
  for (int i = 0; i < ${MAX_CITIES}; i++) {
    vec4 C = uCities[i];
    if (C.z <= 0.0) continue;
    vec2 d = p - C.xy;
    float dl = length(d);
    if (dl > C.z * 1.5) continue;
    float edge = C.z * (0.82 + 0.4 * vnoise(d / 260.0 + C.w));
    float inC = 1.0 - smoothstep(edge - mpp, edge + mpp, dl);
    if (inC <= 0.0) continue;
    float ang = fract(C.w * 0.37) * 1.57;
    mat2 R = mat2(cos(ang), -sin(ang), sin(ang), cos(ang));
    vec2 q = R * d;
    float B = 64.0;
    vec2 bi = floor(q / B), bf = q - bi * B;
    float street = min(min(bf.x, B - bf.x), min(bf.y, B - bf.y));
    float h = hash12(bi + C.w);
    // lots inside each block
    vec2 li = floor(bf / vec2(16.0, 21.0)), lf = bf - li * vec2(16.0, 21.0);
    float lh = hash12(li + bi * 7.0 + C.w);
    float lot = min(min(lf.x, 16.0 - lf.x), min(lf.y, 21.0 - lf.y));
    float core = 1.0 - smoothstep(0.0, C.z, dl);
    vec3 roof = mix(vec3(0.80, 0.79, 0.76), vec3(0.70, 0.71, 0.74), lh);
    roof = mix(roof, vec3(0.83, 0.64, 0.55), step(0.82, lh) * (1.0 - core));
    roof = mix(roof, vec3(0.62, 0.64, 0.69), core * step(0.4, lh));
    vec3 uc = mix(vec3(0.88, 0.87, 0.84), roof, smoothstep(0.6, 1.4, lot / max(mpp, 0.5)) * step(0.06, h));
    // park blocks
    uc = mix(uc, ${c3(PAL.grass)} * 0.92, step(h, 0.06));
    float sw = max(4.5, mpp * 1.2);
    uc = mix(uc, ${c3(PAL.road)}, 1.0 - smoothstep(sw - mpp, sw + mpp, street));
    // far out it reads as one grey patch
    uc = mix(uc, vec3(0.78, 0.77, 0.74), smoothstep(6.0, 14.0, mpp));
    c = mix(c, uc, inC * (1.0 - wa));
  }
  // resources overlay
  if (uOverlay > 0.5 && uOverlay < 1.5) {
    c = mix(c, c * 0.72 + 0.28 * vec3(1.0), 0.6);
    c = mix(c, ${c3(PAL.resFert)}, cov(fert) * 0.75 * (1.0 - wa));
    c = mix(c, ${c3(PAL.resForest)}, cov(forest) * 0.7);
    c = mix(c, ${c3(PAL.resOre)}, cov(ore) * 0.85);
    c = mix(c, ${c3(PAL.resOil)}, cov(oil) * 0.85);
  }
  // land you don't own is a touch dimmer; tile view adds the grid
  vec2 tc = floor(p / uTile + 0.5) + ${(OWN / 2).toFixed(1)};
  float owned = (tc.x < 0.0 || tc.y < 0.0 || tc.x >= ${OWN.toFixed(1)} || tc.y >= ${OWN.toFixed(1)}) ? 0.0 : texelFetch(uOwn, ivec2(tc), 0).r;
  c = mix(c * vec3(0.9, 0.9, 0.92), c, owned);
  if (uOverlay > 1.5) {
    vec2 tf = abs(fract(p / uTile + 0.5) - 0.5) * uTile;
    float e = min(tf.x, tf.y);
    float lw = fwidth(p.x) * 1.2;
    c = mix(c, vec3(0.35), (1.0 - smoothstep(lw, lw * 2.0, e)) * 0.5);
    c = mix(c, c * vec3(0.78, 0.8, 0.86), 1.0 - owned);
  }
  return c;
}
`;
