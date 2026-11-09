import * as THREE from "three";
import { F, NF, RIVER_K, RIVER_S } from "../world/gen";
import { CH, RES, type Terrain } from "../world/terrain";
import { PAL } from "./palette";
import { ENV, ENV_GLSL } from "./envShader";
import { CANOPY, EVERGREEN, FOREST_R, TREE_CELL, TREE_HASH_GLSL, type Forest, type Rect } from "./forest";
import type { View } from "./view";

export const MOUNTAIN_STEP_H = 7;
const N = CH + 4; // texels per chunk side: nodes -1 .. CH+2
const LODS = 5; // chunk size 1 km * 4^L
const MAX_PER_LOD = 220;

const col = (c: number) => new THREE.Color(c);

/** No trees (a chunk whose crowns are not worked out yet, or never drawn: the coarse levels). */
const NO_TREES = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
NO_TREES.needsUpdate = true;

interface Chunk {
  mesh: THREE.Mesh;
  tex: THREE.DataTexture[];
  used: number;
  ci: number; cj: number;
  /** its painted crowns: which cells hold a tree (render/forest.ts bake), from which cell on, and whether it is current */
  trees: { value: THREE.Texture };
  treeO: { value: THREE.Vector2 };
  baked: boolean;
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
  readonly shared = {
    uOverlay: { value: 0 }, // 0 none, 1 resources
    uFocus: { value: -1 }, // the one deposit field shown at full strength (an extractor being placed); -1 all of them
    uRot: { value: new THREE.Vector2(1, 0) },
    // how much of the painted crowns and their shadows shows (0 while the 3D trees stand in their place, trees3d.ts)
    uPaint: { value: 1 },
  };
  /** The painted crowns will be wanted soon (the view is nearing the zoom they take over at): work them out now. */
  crownsSoon = false;
  private crownsDue = false;

  constructor(private terrain: Terrain, private forest: Forest, _small: boolean) {
    // far background under everything (the endless map never shows it, but the first frame might)
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1e6, 1e6).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: PAL.ground }));
    bg.position.y = -2;
    this.group.add(bg);
  }

  /** The resources overlay on or off; `focus`: the one deposit field to show strongly, the rest faint. */
  setOverlay(mode: "none" | "resources", focus = -1) {
    this.shared.uOverlay.value = mode === "resources" ? 1 : 0;
    this.shared.uFocus.value = focus;
  }

  /** Call every frame: keeps the chunks covering the view built, at the right detail, within a time budget. */
  update(view: View) {
    this.frame++;
    const mpp = view.mpp;
    // node spacing should stay above ~2 screen pixels
    let L = 0;
    while (L < LODS - 1 && RES * 4 ** L < mpp * 2.2) L++;
    const { ex, ey } = view.extents();
    const x0 = view.cx - ex, x1 = view.cx + ex, y0 = view.cy - ey, y1 = view.cy + ey;
    this.shared.uRot.value.set(Math.cos(view.rot), Math.sin(view.rot));
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
    // the painted crowns of the chunks in view (only at the zooms that show them), nearest first, a few ms a frame
    this.crownsDue = false;
    if (L === 0 && mpp < 2.1 && (this.shared.uPaint.value > 0 || this.crownsSoon)) {
      const S = CH * RES;
      const d = (c: Chunk) => Math.hypot((c.ci + 0.5) * S - view.cx, (c.cj + 0.5) * S - view.cy);
      const todo = [...this.lods[0].values()].filter((c) => c.used === this.frame && !c.baked).sort((a, b) => d(a) - d(b));
      let done = 0;
      for (const c of todo) {
        this.bake(c);
        done++;
        if (performance.now() - t0 > 9) break;
      }
      this.crownsDue = done < todo.length;
    }
  }

  /** Which cells of a chunk hold a tree, as the texture its shader paints the crowns from. */
  private bake(c: Chunk) {
    const S = CH * RES, x0 = c.ci * S, y0 = c.cj * S;
    const cell2 = TREE_CELL * 2;
    // (from the scrub cell before the chunk's first to the one after its last: a crown reaches into its neighbours)
    const c0i = 2 * (Math.floor(x0 / cell2) - 1), c0j = 2 * (Math.floor(y0 / cell2) - 1);
    const n = Math.max(2 * (Math.floor((x0 + S) / cell2) + 1) + 2 - c0i, 2 * (Math.floor((y0 + S) / cell2) + 1) + 2 - c0j);
    const data = this.forest.bake(c0i, c0j, n);
    if (c.trees.value !== NO_TREES) c.trees.value.dispose();
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.UnsignedByteType);
    t.needsUpdate = true;
    c.trees.value = t;
    c.treeO.value.set(c0i, c0j);
    c.baked = true;
  }

  /** Trees came or went on this ground (something was built or removed; null: anywhere): paint its crowns again. */
  invalidateTrees(rects: Rect[] | null) {
    const S = CH * RES;
    for (const c of this.lods[0].values()) {
      if (!c.baked) continue;
      const x0 = c.ci * S - 16, y0 = c.cj * S - 16, x1 = x0 + S + 32, y1 = y0 + S + 32;
      if (!rects || rects.some((r) => r.x1 > x0 && r.x0 < x1 && r.y1 > y0 && r.y0 < y1)) c.baked = false;
    }
  }

  /** Whether everything in view is built at the wanted detail (tests / screenshots wait on this). */
  get settled() {
    return this.queue.length === 0 && !this.crownsDue;
  }

  private build(lod: number, ci: number, cj: number) {
    const step = 4 ** lod;
    const res = RES * step;
    const data = Array.from({ length: Math.ceil(NF / 4) }, () => new Uint8Array(N * N * 4));
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
    const trees = { value: NO_TREES as THREE.Texture }, treeO = { value: new THREE.Vector2(0, 0) };
    const mat = this.material(tex, i0 * res, j0 * res, res, trees, treeO);
    const S = CH * res;
    const mesh = new THREE.Mesh(this.plane, mat);
    mesh.scale.set(S, 1, S);
    mesh.position.set(ci * S, 0, cj * S);
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = true;
    this.group.add(mesh);
    this.lods[lod].set(`${ci},${cj}`, { mesh, tex, used: this.frame, ci, cj, trees, treeO, baked: false });
  }

  private dispose(c: Chunk) {
    this.group.remove(c.mesh);
    (c.mesh.material as THREE.Material).dispose();
    for (const t of c.tex) t.dispose();
    if (c.trees.value !== NO_TREES) c.trees.value.dispose();
  }

  private material(tex: THREE.DataTexture[], ox: number, oy: number, res: number, trees: { value: THREE.Texture }, treeO: { value: THREE.Vector2 }): THREE.Material {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const local = {
      uF0: { value: tex[0] },
      uF1: { value: tex[1] },
      uF2: { value: tex[2] },
      uOrigin: { value: new THREE.Vector2(ox, oy) },
      uRes: { value: res },
      uTrees: trees,
      uTreeO: treeO,
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, local, this.shared, ENV);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(position, 1.0)).xz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n${ENV_GLSL}\n${GROUND_GLSL}`)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = envGrade(groundColor(vWorld));");
    };
    mat.customProgramCacheKey = () => "ground-v5";
    return mat;
  }
}

const c3 = (c: number) => {
  const k = col(c);
  return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`;
};

const GROUND_GLSL = /* glsl */ `
varying vec2 vWorld;
uniform sampler2D uF0; uniform sampler2D uF1; uniform sampler2D uF2;
uniform vec2 uOrigin; uniform float uRes; uniform float uOverlay; uniform float uFocus; uniform vec2 uRot;
// which cells hold a tree (render/forest.ts: the same list the 3D trees are instanced from), from cell uTreeO on
uniform sampler2D uTrees; uniform vec2 uTreeO; uniform float uPaint;
${TREE_HASH_GLSL}

vec4 bsw(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}
// B-spline of the field textures at world point p (same weights and bytes as Terrain.sample)
void fields(vec2 p, out vec4 a, out vec4 b, out vec4 c) {
  vec2 u = (p - uOrigin) / uRes;
  vec2 i = floor(u); vec2 f = u - i;
  vec4 wx = bsw(f.x), wy = bsw(f.y);
  a = vec4(0.0); b = vec4(0.0); c = vec4(0.0);
  ivec2 lo = ivec2(0), hi = ivec2(${N - 1});
  for (int y = 0; y < 4; y++) {
    vec4 ra = vec4(0.0), rb = vec4(0.0), rc = vec4(0.0);
    for (int x = 0; x < 4; x++) {
      ivec2 q = clamp(ivec2(i) + ivec2(x - 1, y - 1), lo, hi);
      ra += texelFetch(uF0, q, 0) * wx[x];
      rb += texelFetch(uF1, q, 0) * wx[x];
      rc += texelFetch(uF2, q, 0) * wx[x];
    }
    a += ra * wy[y]; b += rb * wy[y]; c += rc * wy[y];
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
/* a deposit field's strength in the resources overlay: full, or faint beside the one an extractor being placed works */
float fw(float f) { return uFocus < 0.0 || abs(uFocus - f) < 0.5 ? 1.0 : 0.22; }

vec3 groundColor(vec2 p) {
  vec4 A, B, D;
  fields(p, A, B, D);
  float m = A.r, lake = A.g, flow = A.a;
  float fert = B.r, forest = B.g, ore = B.b, oil = B.a;
  float coal = D.r, lime = D.g, sandD = D.b, copper = D.a;
  float mpp = fwidth(p.x);
  // rivers from the signed river noise; never thinner than ~1.5 px so they read at any zoom
  float sAbs = abs((A.b - 0.5) / 4.0);
  float rwid = smoothstep(0.3, 0.75, flow);
  float rw = max(${RIVER_S} * rwid, fwidth(sAbs) * 0.75 * smoothstep(0.5, 0.8, rwid));
  float water = max(lake, 0.5 + (rw - sAbs) * ${RIVER_K.toFixed(1)});
  // decoration fades out as you zoom out so the far map stays calm
  float decoK = mix(1.0, 0.35, smoothstep(5.0, 16.0, mpp));
  float fineK = 1.0 - smoothstep(0.7, 2.2, mpp); // detail a few metres across
  // dry grassland: broad soft patches of lighter and darker grass, greener hollows, bare soil, fine mottling
  float n1 = vnoise(p / 520.0), n2 = vnoise(p / 170.0 + 31.7), n3 = vnoise(p / 48.0 - 12.1), n4 = vnoise(p / 7.0 + 5.3);
  vec3 c = mix(${c3(PAL.groundDark)}, ${c3(PAL.groundLight)}, smoothstep(0.2, 0.8, n1 * 0.65 + n2 * 0.35));
  c = mix(c, ${c3(PAL.grass)}, smoothstep(0.55, 0.8, n2 * 0.6 + n3 * 0.4 + (fert - 0.5) * 0.3) * 0.6 * decoK);
  c = mix(c, ${c3(PAL.sand)}, smoothstep(0.64, 0.86, n1 * 0.45 + n3 * 0.55) * 0.45 * decoK);
  c *= 1.0 + ((n3 - 0.5) * 0.06 + (n4 - 0.5) * 0.08 * fineK) * decoK;
  // the season's grass (render/envShader.ts)
  c = envGrass(c);
  // dry soil along the water
  c = mix(c, ${c3(PAL.sand)}, cov(water + 0.07) * 0.8);
  // specks: tufts and stones a metre or less across
  if (fineK > 0.0) {
    vec2 g = p / 2.6, gi = floor(g);
    float h = hash12(gi + 3.1);
    vec2 ctr = gi + 0.5 + (vec2(hash12(gi + 7.7), hash12(gi + 9.9)) - 0.5) * 0.7;
    float r = 0.07 + 0.08 * hash12(gi + 1.3);
    float d = length(g - ctr), aa = fwidth(d) + 1e-4;
    // (in autumn more of them, and most are fallen leaves: rust, ochre and brown)
    float hl = hash12(gi + 12.4);
    vec3 lc = hl < 0.4 ? vec3(0.6, 0.2, 0.05) : hl < 0.72 ? vec3(0.64, 0.4, 0.07) : vec3(0.33, 0.16, 0.05);
    vec3 sc = mix(${c3(PAL.speck)}, lc, step(0.3, hl + envLitter * 0.6) * envLitter);
    c = mix(c, sc, step(0.55 - envLitter * 0.25, h) * (1.0 - smoothstep(r - aa, r + aa, d)) * 0.7 * fineK);
  }
  // shrubs and trees: round crowns, lit from the sun's side, each with a soft shadow down-right. Scrub is scattered
  // in loose clumps; in a forest they close up into canopy. Which cells hold one is worked out on the CPU
  // (render/forest.ts) and read here from a texture, so these are the very trees that stand in 3D nearer in
  // (render/trees3d.ts); while those stand, uPaint is 0 and nothing of them is painted.
  float fo = cov(forest);
  float crownK = 1.0 - smoothstep(1.0, 2.0, mpp);
  float density = mix(scrubDensity(p), ${CANOPY.toFixed(2)}, fo);
  vec3 under = mix(c, envGrass(${c3(PAL.forestFloor)}), fo * 0.85);
  // snow on the open ground, thinner on the forest floor
  under = mix(under, envSnowCol(p), envSnowAt(p, fo * 0.35));
  // the share of evergreens among the trees: most in the forests
  float everK = mix(${EVERGREEN.scrub.toFixed(2)}, ${EVERGREEN.forest.toFixed(2)}, fo);
  vec3 near = under;
  if (crownK > 0.0 && uPaint > 0.0) {
    vec2 sh = -uSun * 0.55 * uShade.y;
    float hT = 0.0, foT = 0.0;
    vec2 qT = vec2(0.0);
    float crown = 0.0, shade = 0.0, lit = 0.0, tone = 0.0;
    ivec2 tmax = textureSize(uTrees, 0) - 1;
    // the forest's cells, then the scrub's (twice the size)
    for (int g = 0; g < 2; g++) {
      float cell = g == 0 ? ${TREE_CELL.toFixed(1)} : ${(TREE_CELL * 2).toFixed(1)};
      uint ko = uint(g) * 16u;
      vec2 gp = p / cell;
      ivec2 gi = ivec2(floor(gp));
      float aa = mpp / cell + 1e-4;
      for (int y = -1; y <= 1; y++) for (int x = -1; x <= 1; x++) {
        ivec2 cl = gi + ivec2(x, y);
        vec4 tt = texelFetch(uTrees, clamp((g == 0 ? cl : cl * 2) - ivec2(uTreeO), ivec2(0), tmax), 0);
        if ((g == 0 ? tt.r : tt.g) < 0.5) continue;
        vec2 ctr = vec2(cl) + 0.5 + (vec2(thashf(cl, 1u + ko), thashf(cl, 2u + ko)) - 0.5) * 0.55;
        float r = (mix(1.1, 2.4, thashf(cl, ko)) + (g == 0 ? ${FOREST_R.toFixed(2)} : 0.0)) / cell;
        vec2 q = gp - ctr;
        float wob = 1.0 + 0.09 * sin(atan(q.y, q.x) * 5.0 + thashf(cl, 6u + ko) * 6.28);
        float d = length(q) / wob;
        float cr = 1.0 - smoothstep(r - aa, r + aa, d);
        float ds = length(q - sh * r * 1.5);
        shade = max(shade, 1.0 - smoothstep(r * 0.7, r * 1.2, ds));
        if (cr > crown) {
          crown = cr;
          tone = thashf(cl, 4u + ko);
          hT = thashf(cl, 5u + ko);
          qT = q / r;
          foT = g == 0 ? 1.0 : 0.0;
          lit = 1.0 - smoothstep(0.0, r * 1.35, length(q + sh * r * 0.6 / max(uShade.y, 0.5)));
        }
      }
    }
    vec3 leaf = mix(${c3(PAL.shrub)}, ${c3(PAL.tree)}, foT * 0.8 + tone * 0.25);
    leaf = mix(leaf * 0.78, mix(${c3(PAL.shrubLight)}, ${c3(PAL.treeLight)}, foT), lit * 0.85);
    // the season's crown: new green and blossom, autumn colour, bare branches with snow on them, snowy conifers
    vec4 lf = envLeaf(leaf, tone, hT, qT, lit, mix(${EVERGREEN.scrub.toFixed(2)}, ${EVERGREEN.forest.toFixed(2)}, foT));
    // (bare trees throw thinner shadows; the light sets how strong and how long they are)
    vec3 nr = under * (1.0 - shade * 0.5 * uShade.x * (1.0 - 0.6 * envBare * (1.0 - everK)));
    nr = mix(nr, lf.rgb, crown * lf.a);
    near = mix(under, nr, uPaint);
  }
  // far out, scrub and forest read as a tint (the season's: an average of its evergreens and the rest)
  vec3 farLeaf = mix(${c3(PAL.shrub)}, ${c3(PAL.tree)}, fo) * 0.9;
  vec4 farD = envLeaf(farLeaf, 0.5, 0.999, vec2(0.0, 0.5), 0.5, 0.0);
  vec4 farE = envLeaf(farLeaf, 0.5, 0.0, vec2(0.0, 0.5), 0.5, 1.0);
  farLeaf = mix(mix(under, farD.rgb, farD.a * 0.8 + 0.2), farE.rgb, everK);
  vec3 farTone = mix(under, farLeaf, density * mix(0.14, 0.85, fo));
  c = mix(farTone, near, crownK);
  // mineral deposits show through the grass as patches of their own soil or rock, mottled so they read as ground
  float mott = 0.55 + 0.45 * smoothstep(0.3, 0.7, n3 * 0.6 + n4 * 0.4 * fineK + 0.2);
  c = mix(c, ${c3(PAL.soilOre)}, cov(ore) * 0.42 * mott);
  c = mix(c, ${c3(PAL.soilCoal)}, cov(coal) * 0.45 * mott);
  c = mix(c, ${c3(PAL.soilLime)}, cov(lime) * 0.5 * mott);
  c = mix(c, ${c3(PAL.soilSand)}, cov(sandD) * 0.55 * mott);
  c = mix(c, ${c3(PAL.soilOil)}, cov(oil) * 0.35 * mott);
  c = mix(c, ${c3(PAL.soilCopper)}, cov(copper) * 0.45 * mott);
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
    // screen gradient -> world: screen right is (cos, sin) in world, screen up (gl y) is (sin, -cos)
    vec2 gw = vec2(gm.x * uRot.x + gm.y * uRot.y, gm.x * uRot.y - gm.y * uRot.x);
    float facing = dot(normalize(-gw), uSun);
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
  // (snow on the hills' tiers, as on the grass)
  c = mix(c, envSnowCol(p), envSnowAt(p, -0.15) * step(0.5, lvl));
  c *= 1.0 - sh * 0.3 * uShade.x;
  // water: periwinkle with a darker rim; in winter, colder, with ice along the edge
  float wa = cov(water);
  if (wa > 0.0) {
    float wd = (water - 0.5) / max(fwidth(water), 1e-5);
    vec3 wc = mix(${c3(PAL.waterEdge)}, ${c3(PAL.water)}, smoothstep(1.0, 3.0, wd));
    wc = mix(wc, wc * vec3(0.86, 0.94, 1.04), envFrost);
    // (ice a few metres out from the bank, broken at its edge)
    float wm = (water - 0.5) / max(fwidth(water), 1e-5) * fwidth(p.x); // metres from the bank, about
    float ice = 1.0 - smoothstep(2.0, 5.0 + 6.0 * vnoise(p / 9.0), wm);
    c = mix(c, mix(wc, vec3(0.83, 0.88, 0.92), ice * envFrost * 0.9), wa);
  }
  // resources overlay
  if (uOverlay > 0.5) {
    c = mix(c, c * 0.72 + 0.28 * vec3(1.0), 0.6);
    // (placing an extractor: its own deposit at full strength, the others faint)
    c = mix(c, ${c3(PAL.resFert)}, cov(fert) * 0.75 * (1.0 - wa) * fw(${F.fert}.0));
    c = mix(c, ${c3(PAL.resForest)}, cov(forest) * 0.7 * fw(${F.forest}.0));
    c = mix(c, ${c3(PAL.resOre)}, cov(ore) * 0.85 * fw(${F.ore}.0));
    c = mix(c, ${c3(PAL.resOil)}, cov(oil) * 0.85 * fw(${F.oil}.0));
    c = mix(c, ${c3(PAL.resCoal)}, cov(coal) * 0.85 * fw(${F.coal}.0));
    c = mix(c, ${c3(PAL.resLime)}, cov(lime) * 0.85 * fw(${F.lime}.0));
    c = mix(c, ${c3(PAL.resSand)}, cov(sandD) * 0.85 * fw(${F.sand}.0));
    c = mix(c, ${c3(PAL.resCopper)}, cov(copper) * 0.85 * fw(${F.copper}.0));
  }
  return c;
}
`;
