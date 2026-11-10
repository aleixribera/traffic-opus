import * as THREE from "three";
import { F, NF, RIVER_K, RIVER_S } from "../world/gen";
import { CH, RES, type Terrain } from "../world/terrain";
import { LAND, PAL } from "./palette";
import { ENV, ENV_GLSL } from "./envShader";
import { CANOPY, EVERGREEN, FOREST_R, TREE_CELL, TREE_HASH_GLSL, type Forest, type Rect } from "./forest";
import { LandProps } from "./landprops";
import type { MergedModel } from "./models";
import { ENC, Enclosures, GATE_HW, HEDGE_HW, LAND_GLSL, LAND_K, type NodeAt } from "./land";
import type { LandMask } from "./landmask";
import type { View } from "./view";
import { riseShare } from "./viewmath";
import { WIND } from "./wind";

export const MOUNTAIN_STEP_H = 7;
const N = CH + 4; // texels per chunk side: nodes -1 .. CH+2
/**
 * The relief-and-enclosure texture reaches further than the fields' (the bent survey grid looks up to ENC_REACH past
 * a chunk's edge): a fine chunk's holds nodes -12 .. CH+11. The coarser levels' hold relief only, nodes -2 .. CH+2.
 */
const N3 = CH + 24, M3 = 12;
/** The slope (of the height field, per metre) the relief texture's bytes are scaled by: x / (1 + |x|) of slope / SLOPE0. */
const SLOPE0 = 1.5e-4;
const LODS = 5; // chunk size 1 km * 4^L
const MAX_PER_LOD = 220;

const col = (c: number) => new THREE.Color(c);

/** No trees (a chunk whose crowns are not worked out yet, or never drawn: the coarse levels). */
const NO_TREES = new THREE.DataTexture(new Uint8Array(4), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
NO_TREES.needsUpdate = true;
/** Nothing built anywhere (a ground given no mask of the built land: the tests'). */
const NO_MASK = { uMask: { value: NO_TREES as THREE.Texture }, uMaskRect: { value: new THREE.Vector4(0, 0, 0, 0) } };

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
 *
 * It is drawn two ways, and crossfades between them over the zooms the camera's tilt eases out across. Near, a
 * painted countryside whose cover follows the fields: damp green by the water, deep prairie on fertile soil, gold
 * on the dry rises, hedged pasture and meadow in the settled districts, bare earth in a works' yard. Far, a road
 * atlas of the 1930s: cream paper, washes, woods as tree symbols, hill shading, engraved shorelines.
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
    // the view's turn (cos, sin) and the cosine of its tilt
    uRot: { value: new THREE.Vector3(1, 0, 1) },
    // how much of the painted crowns and their shadows shows (0 while the 3D trees stand in their place, trees3d.ts)
    uPaint: { value: 1 },
    // the same for the painted hedges (0 while the 3D ones stand, landprops.ts)
    uHedge: { value: 1 },
    // how much of the ground is drawn as the atlas (0 near in .. 1 far out)
    uAtlas: { value: 0 },
  };
  /** The painted crowns will be wanted soon (the view is nearing the zoom they take over at): work them out now. */
  crownsSoon = false;
  private crownsDue = false;
  /** The countryside's enclosures (which cells are hedged fields): the 3D hedges are placed from the same ones. */
  readonly enclosures = new Enclosures();
  private mask: LandMask["uniforms"];

  /** What stands on the open land near in: hedgerows, gates, hay, reeds (its group goes into the scene beside the ground's). */
  readonly land: LandProps;

  constructor(private terrain: Terrain, private forest: Forest, _small: boolean, mask?: Pick<LandMask, "uniforms"> & Partial<Pick<LandMask, "townAt" | "stamp">>, props?: Map<string, MergedModel>) {
    this.mask = mask?.uniforms ?? NO_MASK;
    this.land = new LandProps(props ?? new Map(), terrain, forest, this.enclosures, mask?.townAt ? (mask as LandMask) : undefined);
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
    // (the ground the tilted, turned view covers)
    const { x0, y0, x1, y1 } = view.bounds();
    this.shared.uRot.value.set(Math.cos(view.rot), Math.sin(view.rot), Math.cos(view.tilt));
    // (the atlas takes over as the camera rises to straight down, over the same zooms)
    this.shared.uAtlas.value = ENV.uEnvAtlas.value = view.halfH > 0 ? 1 - riseShare(view.halfH) : 0;
    this.land.update(view);
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
        for (const [k, c] of old.slice(0, map.size - MAX_PER_LOD)) this.drop(c), map.delete(k);
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
    this.land.invalidate(rects);
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
    // (the coarse levels keep their heights as numbers: their relief is worked out from them below)
    const mf = lod === 0 ? null : new Float32Array(N * N);
    for (let b = 0; b < N; b++) {
      for (let a = 0; a < N; a++) {
        const k = (b * N + a) * 4;
        if (lod === 0) {
          for (let f = 0; f < NF; f++) data[f >> 2][k + (f & 3)] = t.node(f, i0 + a, j0 + b);
        } else {
          t.gen.at((i0 + a) * res, (j0 + b) * res, o);
          for (let f = 0; f < NF; f++) data[f >> 2][k + (f & 3)] = Math.round(o[f] * 255);
          mf![b * N + a] = o[F.mtn];
        }
      }
    }
    const tex = data.map((d) => {
      const tx = new THREE.DataTexture(d, N, N, THREE.RGBAFormat, THREE.UnsignedByteType);
      tx.needsUpdate = true;
      return tx;
    });
    // the relief (which way the ground slopes, smoothed) and the enclosures (a byte per cell), as a fourth texture
    const n3 = lod === 0 ? N3 : N + 1, i3 = lod === 0 ? ci * CH - M3 : i0 - 1, j3 = lod === 0 ? cj * CH - M3 : j0 - 1;
    const d3 = lod === 0 ? this.reliefFine(i3, j3) : this.reliefCoarse(mf!, res);
    if (lod === 0) this.enclose(d3, n3, i3, j3);
    const t3 = new THREE.DataTexture(d3, n3, n3, THREE.RGBAFormat, THREE.UnsignedByteType);
    t3.magFilter = t3.minFilter = THREE.LinearFilter;
    t3.needsUpdate = true;
    tex.push(t3);
    const trees = { value: NO_TREES as THREE.Texture }, treeO = { value: new THREE.Vector2(0, 0) };
    const mat = this.material(tex, i0 * res, j0 * res, res, new THREE.Vector3(i3 * res, j3 * res, n3), trees, treeO);
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

  /**
   * A fine chunk's relief: the slope of the height field at each node from (i3, j3) on, east and south. The field
   * is kept as bytes, and the plain's slopes are a fraction of a byte a node, so the slope is taken over a wide
   * window (three nodes either way, five rows deep): smooth, with none of the bytes' steps left in it.
   */
  private reliefFine(i3: number, j3: number): Uint8Array {
    const W = N3 + 6, t = this.terrain;
    const m = new Int16Array(W * W);
    for (let b = 0; b < W; b++) for (let a = 0; a < W; a++) m[b * W + a] = t.node(F.mtn, i3 - 3 + a, j3 - 3 + b);
    // (sums of five down each column, and of five along each row)
    const cs = new Int16Array(W * W), rs = new Int16Array(W * W);
    for (let b = 2; b < W - 2; b++) for (let a = 0; a < W; a++) cs[b * W + a] = m[(b - 2) * W + a] + m[(b - 1) * W + a] + m[b * W + a] + m[(b + 1) * W + a] + m[(b + 2) * W + a];
    for (let b = 0; b < W; b++) for (let a = 2; a < W - 2; a++) rs[b * W + a] = m[b * W + a - 2] + m[b * W + a - 1] + m[b * W + a] + m[b * W + a + 1] + m[b * W + a + 2];
    const out = new Uint8Array(N3 * N3 * 4);
    const k = 1 / (60 * 255 * RES);
    for (let b = 0; b < N3; b++) {
      for (let a = 0; a < N3; a++) {
        const q = (b + 3) * W + a + 3;
        const gx = cs[q + 1] - cs[q - 1] + cs[q + 2] - cs[q - 2] + cs[q + 3] - cs[q - 3];
        const gy = rs[q + W] - rs[q - W] + rs[q + 2 * W] - rs[q - 2 * W] + rs[q + 3 * W] - rs[q - 3 * W];
        const p = (b * N3 + a) * 4;
        out[p] = slopeByte(gx * k);
        out[p + 1] = slopeByte(gy * k);
      }
    }
    return out;
  }

  /** A coarse chunk's relief, from its heights as numbers (nodes `res` apart), from one node before its fields' first. */
  private reliefCoarse(mf: Float32Array, res: number): Uint8Array {
    const n3 = N + 1;
    const out = new Uint8Array(n3 * n3 * 4);
    for (let b = 0; b < n3; b++) {
      for (let a = 0; a < n3; a++) {
        // (the fields' own node, held at their edge)
        const fa = Math.max(0, a - 1), fb = Math.max(0, b - 1);
        const a0 = Math.max(0, fa - 1), a1 = Math.min(N - 1, fa + 1), b0 = Math.max(0, fb - 1), b1 = Math.min(N - 1, fb + 1);
        const p = (b * n3 + a) * 4;
        out[p] = slopeByte((mf[fb * N + a1] - mf[fb * N + a0]) / ((a1 - a0) * res));
        out[p + 1] = slopeByte((mf[b1 * N + fa] - mf[b0 * N + fa]) / ((b1 - b0) * res));
      }
    }
    return out;
  }

  /**
   * The enclosures (render/land.ts) into a fine chunk's relief texture, its third byte: each node holds the byte of
   * the cell whose place on the survey grid it lies in (the shader looks a cell up at the middle of its place). Only
   * the fine chunks have them: further out the fields are too small to draw.
   */
  private enclose(d3: Uint8Array, n3: number, i3: number, j3: number) {
    const t = this.terrain;
    const at: NodeAt = (f, i, j) => t.node(f, i * 4, j * 4);
    const per = ENC / RES; // nodes to a cell
    const c0i = Math.floor(i3 / per), c0j = Math.floor(j3 / per);
    const nc = Math.max(Math.floor((i3 + n3 - 1) / per) - c0i, Math.floor((j3 + n3 - 1) / per) - c0j) + 1;
    const cells = new Uint8Array(nc * nc);
    let any = false;
    for (let b = 0; b < nc; b++) for (let a = 0; a < nc; a++) if ((cells[b * nc + a] = this.enclosures.byte(c0i + a, c0j + b, at))) any = true;
    if (!any) return;
    for (let b = 0; b < n3; b++) {
      const cb = Math.floor((j3 + b) / per) - c0j;
      for (let a = 0; a < n3; a++) d3[(b * n3 + a) * 4 + 2] = cells[cb * nc + Math.floor((i3 + a) / per) - c0i];
    }
  }

  /**
   * This ground is done with (a new game, a loaded save): everything it holds on the GPU is handed back. Nothing
   * else frees a chunk's textures: without this every load leaves them all behind.
   */
  dispose() {
    this.land.dispose();
    for (const map of this.lods) {
      for (const c of map.values()) this.drop(c);
      map.clear();
    }
    this.queue.length = 0;
    for (const m of [...this.group.children] as THREE.Mesh[]) {
      this.group.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    }
    this.plane.dispose();
  }

  private drop(c: Chunk) {
    this.group.remove(c.mesh);
    (c.mesh.material as THREE.Material).dispose();
    for (const t of c.tex) t.dispose();
    if (c.trees.value !== NO_TREES) c.trees.value.dispose();
  }

  private material(tex: THREE.DataTexture[], ox: number, oy: number, res: number, geo3: THREE.Vector3, trees: { value: THREE.Texture }, treeO: { value: THREE.Vector2 }): THREE.Material {
    const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    const local = {
      uF0: { value: tex[0] },
      uF1: { value: tex[1] },
      uF2: { value: tex[2] },
      uF3: { value: tex[3] },
      uOrigin: { value: new THREE.Vector2(ox, oy) },
      uRes: { value: res },
      // the relief texture's first texel in the world (x, y), and its size in texels
      uGeo3: { value: geo3 },
      uTrees: trees,
      uTreeO: treeO,
    };
    mat.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, local, this.shared, this.mask, ENV, WIND);
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", "#include <common>\nvarying vec2 vWorld;")
        .replace("#include <begin_vertex>", "#include <begin_vertex>\nvWorld = (modelMatrix * vec4(position, 1.0)).xz;");
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\n${ENV_GLSL}\n${GROUND_GLSL}`)
        .replace("#include <color_fragment>", "#include <color_fragment>\ndiffuseColor.rgb = envGrade(groundColor(vWorld));");
    };
    mat.customProgramCacheKey = () => "ground-v6";
    return mat;
  }
}

/** A slope as the relief texture's byte. */
function slopeByte(slope: number): number {
  const x = slope / SLOPE0;
  return 128 + Math.round((127 * x) / (1 + Math.abs(x)));
}

const c3 = (c: number) => {
  const k = col(c);
  return `vec3(${k.r.toFixed(4)}, ${k.g.toFixed(4)}, ${k.b.toFixed(4)})`;
};
const fl = (v: number) => (Number.isInteger(v) ? v.toFixed(1) : String(v));

const GROUND_GLSL = /* glsl */ `
varying vec2 vWorld;
uniform sampler2D uF0; uniform sampler2D uF1; uniform sampler2D uF2; uniform sampler2D uF3;
uniform vec2 uOrigin; uniform float uRes; uniform vec3 uGeo3; uniform float uOverlay; uniform float uFocus;
// which cells hold a tree (render/forest.ts: the same list the 3D trees are instanced from), from cell uTreeO on
uniform sampler2D uTrees; uniform vec2 uTreeO; uniform float uPaint; uniform float uHedge;
// the far map's share; the built land (render/landmask.ts); the wind and its clock (render/wind.ts)
uniform float uAtlas; uniform sampler2D uMask; uniform vec4 uMaskRect; uniform vec4 uWind;
${TREE_HASH_GLSL}
${LAND_GLSL}

vec4 bsw(float t) {
  float t2 = t * t, t3 = t2 * t;
  return vec4(1.0 - 3.0 * t + 3.0 * t2 - t3, 4.0 - 6.0 * t2 + 3.0 * t3, 1.0 + 3.0 * t + 3.0 * t2 - 3.0 * t3, t3) / 6.0;
}
/* (the same weights' slopes) */
vec4 bsd(float t) {
  float t2 = t * t;
  return vec4(-1.0 + 2.0 * t - t2, -4.0 * t + 3.0 * t2, 1.0 + 2.0 * t - 3.0 * t2, t2) * 0.5;
}
// B-spline of the field textures at world point p (same weights and bytes as Terrain.sample), and the first
// texture's slope east and south (per metre): how far a point is from a shore or a hill's step comes from it, in
// metres, whichever way the camera is turned
void fields(vec2 p, out vec4 a, out vec4 b, out vec4 c, out vec4 ax, out vec4 ay) {
  vec2 u = (p - uOrigin) / uRes;
  vec2 i = floor(u); vec2 f = u - i;
  vec4 wx = bsw(f.x), wy = bsw(f.y), dx = bsd(f.x), dy = bsd(f.y);
  a = vec4(0.0); b = vec4(0.0); c = vec4(0.0); ax = vec4(0.0); ay = vec4(0.0);
  ivec2 lo = ivec2(0), hi = ivec2(${N - 1});
  for (int y = 0; y < 4; y++) {
    vec4 ra = vec4(0.0), rb = vec4(0.0), rc = vec4(0.0), rx = vec4(0.0);
    for (int x = 0; x < 4; x++) {
      ivec2 q = clamp(ivec2(i) + ivec2(x - 1, y - 1), lo, hi);
      vec4 t0 = texelFetch(uF0, q, 0);
      ra += t0 * wx[x];
      rx += t0 * dx[x];
      rb += texelFetch(uF1, q, 0) * wx[x];
      rc += texelFetch(uF2, q, 0) * wx[x];
    }
    a += ra * wy[y]; b += rb * wy[y]; c += rc * wy[y];
    ax += rx * wy[y]; ay += ra * dy[y];
  }
  ax /= uRes; ay /= uRes;
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
/* (the same, its lattice turned off the compass: thresholded noise shows its grid, and two grids at odd angles hide each other) */
float rnoise(vec2 p) { return vnoise(mat2(0.8, -0.6, 0.6, 0.8) * p) * 0.6 + vnoise(mat2(0.28, 0.96, -0.96, 0.28) * p * 2.3 + 17.1) * 0.4; }
// coverage of a field above 0.5 with a one-pixel soft edge
float cov(float v) { float w = max(fwidth(v), 1e-4) * 0.75; return smoothstep(0.5 - w, 0.5 + w, v); }
/* a deposit field's strength in the resources overlay: full, or faint beside the one an extractor being placed works */
float fw(float f) { return uFocus < 0.0 || abs(uFocus - f) < 0.5 ? 1.0 : 0.22; }
/* A map symbol's cell: symbols stand on a grid that keeps its size on the page (between 'base' / 2 and 'base' pixels
   a cell) as the map is zoomed. The grid is the world's, an octave of it: zooming out, three cells in four shrink
   their symbol away and the fourth keeps it, until the next octave takes over with exactly those. Returns the
   point's place from its cell's symbol in pixels (xy), how much of the symbol is left (z), and a hash (w). */
vec4 symCell(vec2 p, float mpp, float base, float jit) {
  float o = log2(mpp * base), o0 = floor(o), ot = o - o0;
  float cs = exp2(o0);
  vec2 g = p / cs, gi = floor(g);
  // the block of four cells this one is in, and the symbol the block keeps (it moves to the block's middle, where
  // the next octave's cell will have it)
  vec2 bi = floor(gi * 0.5) * 2.0;
  vec2 wb = bi * cs; // the block's corner in the world: the same number at this octave and the next
  vec2 jb = (vec2(hash12(wb * 0.37 + 5.1), hash12(wb * 0.37 + 9.3)) - 0.5) * jit;
  vec2 dB = (g - bi - mix(vec2(0.5) + jb, vec2(1.0) + jb * 2.0, ot)) * cs / mpp;
  vec4 res = vec4(dB, 1.0, hash12(wb * 0.37 + 1.7));
  // this cell's own, if it is one of the three that go
  vec2 wo = gi * cs;
  vec2 jo = (vec2(hash12(wo * 0.37 + 5.1), hash12(wo * 0.37 + 9.3)) - 0.5) * jit;
  vec2 dO = (g - gi - 0.5 - jo) * cs / mpp;
  float left = (1.0 - smoothstep(0.1, 0.8, ot)) * (any(notEqual(gi, bi)) ? 1.0 : 0.0);
  if (left > 0.0 && dot(dO, dO) < dot(dB, dB)) res = vec4(dO, left, hash12(wo * 0.37 + 1.7));
  return res;
}

vec3 groundColor(vec2 p) {
  vec4 A, B, D, Ax, Ay;
  fields(p, A, B, D, Ax, Ay);
  float m = A.r, lake = A.g, flow = A.a;
  float fert = B.r, forest = B.g, ore = B.b, oil = B.a;
  float coal = D.r, lime = D.g, sandD = D.b, copper = D.a;
  float mpp = length(dFdx(p));
  // rivers from the signed river noise; never thinner than ~1.5 px so they read at any zoom
  float sAbs = abs((A.b - 0.5) / 4.0);
  float gsl = max(length(vec2(Ax.b, Ay.b)) / 4.0, 1e-7);
  float rwid = smoothstep(0.3, 0.75, flow);
  float rw = max(${RIVER_S} * rwid, gsl * mpp * 0.8 * smoothstep(0.5, 0.8, rwid));
  float water = max(lake, 0.5 + (rw - sAbs) * ${RIVER_K.toFixed(1)});
  // how far into the water a point is, in metres (negative: how far back from it on the land)
  float dR = mix(-400.0, (rw - sAbs) / gsl, smoothstep(0.0, 0.12, rwid));
  float dL = (lake - 0.5) / max(length(vec2(Ax.g, Ay.g)), 1e-6);
  float dW = clamp(max(dL, dR), -400.0, 400.0);
  float wa = smoothstep(-0.75, 0.75, dW / mpp);
  float land = -dW;
  // decoration fades out as you zoom out so the far map stays calm
  float decoK = mix(1.0, 0.35, smoothstep(5.0, 16.0, mpp));
  float fineK = 1.0 - smoothstep(0.7, 2.2, mpp); // detail a few metres across
  float n1 = vnoise(p / 520.0), n2 = vnoise(p / 170.0 + 31.7), n3 = vnoise(p / 48.0 - 12.1), n4 = vnoise(mat2(0.8, -0.6, 0.6, 0.8) * p / 7.0 + 5.3);
  // the relief (the ground's slope, smoothed) and the built land
  vec4 t3 = texture(uF3, ((p - uGeo3.xy) / uRes + 0.5) / uGeo3.z);
  vec2 hv = (t3.rg * 255.0 - 128.0) / 127.0;
  vec2 slope = hv / (1.0 - min(abs(hv), vec2(0.97))); // in units of ${SLOPE0}
  vec4 mk = texture(uMask, (p - uMaskRect.xy) * uMaskRect.zw);
  float town = mk.r, works = mk.g, farm = mk.b;
  // (a town's ground: its lots and the mown, trodden land round them, running out into the meadow)
  float townG = smoothstep(0.0, 0.8, mk.a * (0.75 + 0.5 * n3));
  // what grows where: damp ground by the water and in the valley bottoms, fertile soil, the dry rises, scrubland
  float fo = cov(forest);
  float wetK = 1.0 - smoothstep(3.0, 22.0 + 36.0 * n2, land);
  float lowK = 1.0 - smoothstep(0.12, 0.2, m);
  float fk = smoothstep(0.485, 0.515, fert + (n3 - 0.5) * 0.02);
  float sd = scrubDensity(p);
  float heath = smoothstep(0.26, 0.48, sd) * (1.0 - fk);
  float dryK = clamp(0.36 + (m - 0.2) * 2.4 + (n1 * 0.6 + n2 * 0.4 - 0.5) * 0.9 - wetK * 0.6 - lowK * 0.2 - fk * 0.22 + heath * 0.12, 0.0, 1.0);
  // the enclosures: which cell of the bent survey grid this is, what it is, and where its hedges run
  int cls = 0;
  vec2 ef = vec2(0.0);
  ivec2 ec = ivec2(0);
  vec2 el = vec2(${fl(ENC)});
  float encK = 1.0 - smoothstep(4.2, 6.8, mpp);
  if (uRes < 20.0 && encK > 0.0) {
    vec2 q = p + encWarp(p);
    vec3 ex = encAxis(q.x, ${LAND_K.lineX}u), ey = encAxis(q.y, ${LAND_K.lineY}u);
    ec = ivec2(int(ex.x), int(ey.x));
    ef = vec2(ex.y, ey.y);
    el = vec2(ex.z, ey.z);
    vec2 mid = (vec2(ex.x, ey.x) + 0.5) * ${fl(ENC)};
    cls = int(texelFetch(uF3, clamp(ivec2(floor((mid - uGeo3.xy) / uRes)), ivec2(0), ivec2(int(uGeo3.z) - 1)), 0).b * 255.0 + 0.5);
  }
  float kind = float(cls & 3);
  float pasture = (kind == 1.0 ? 1.0 : 0.0) * encK, meadow = (kind == 2.0 ? 1.0 : 0.0) * encK;
  // (two cells thrown together are one field: one tone)
  ivec2 fid = ec;
  if (kind > 0.0) { if ((cls & 16) == 0) fid.x -= 1; else if ((cls & 32) == 0) fid.y -= 1; }
  float fh = thashf(fid, ${LAND_K.tint}u);
  // hedges: the nearest one's middle line (m), which side of it faces the sun, and the shadow it throws
  float hd = 1e3, hlit = 0.5, hsh = 0.0;
  if ((cls & 60) != 0) {
    float reach = 1.9 * uShade.y;
    for (int sd4 = 0; sd4 < 4; sd4++) {
      int bit = sd4 == 0 ? 16 : sd4 == 1 ? 4 : sd4 == 2 ? 32 : 8;
      bool we = sd4 < 2;
      // (signed: east of a west or east line, south of a south or north one)
      float s = we ? (sd4 == 0 ? ef.x : ef.x - el.x) : (sd4 == 2 ? ef.y : ef.y - el.y);
      float al = we ? ef.y : ef.x;
      ivec2 gc = ec + (sd4 == 1 ? ivec2(1, 0) : sd4 == 3 ? ivec2(0, 1) : ivec2(0));
      float gate = (0.14 + thashf(gc, we ? ${LAND_K.gate}u : ${LAND_K.gate + 1}u) * 0.72) * (we ? el.y : el.x);
      float on = ((cls & bit) != 0 && abs(al - gate) > ${fl(GATE_HW)}) ? 1.0 : 0.0;
      float sn = we ? uSun.x : uSun.y;
      float a = mix(1e3, abs(s), on);
      if (a < hd) { hd = a; hlit = 0.5 + 0.5 * clamp(s / ${fl(HEDGE_HW)}, -1.0, 1.0) * sn; }
      float len = reach * abs(sn);
      hsh = max(hsh, on * step(0.0, -s * sn) * (1.0 - smoothstep(${fl(HEDGE_HW * 0.5)} + len * 0.55, ${fl(HEDGE_HW)} + len, abs(s))));
    }
  }
  vec3 c = vec3(0.0);
  float sn = 0.0;
  if (uAtlas < 0.999) {
    // open grassland: broad soft patches of lighter and darker grass, greener hollows, fine mottling
    c = mix(${c3(PAL.groundDark)}, ${c3(PAL.groundLight)}, smoothstep(0.2, 0.8, n1 * 0.65 + n2 * 0.35));
    c = mix(c, ${c3(PAL.grass)}, smoothstep(0.55, 0.8, n2 * 0.6 + n3 * 0.4) * 0.5 * decoK);
    c *= 1.0 + ((n3 - 0.5) * 0.07 + (n4 - 0.5) * 0.09 * fineK) * decoK;
    // pasture is grazed short and stays green; a meadow stands tall, is mown for hay in late summer and left pale
    float mown = envDry * (1.0 - envFall);
    float dryG = mix(mix(dryK, 0.2, pasture * 0.8), 0.82, meadow * 0.8 * mown);
    dryG = mix(dryG, dryG * 0.5, max(wetK, (1.0 - smoothstep(0.1, 0.27, m)) * 0.6));
    // the season's grass (render/envShader.ts): gold only where the ground is driest
    c = envGrassAt(c, dryG);
    // fertile soil is deep, rich prairie; damp ground a darker, bluer green; scrubland rough and browner
    c = mix(c, c * vec3(0.8, 0.98, 0.7), fk * 0.9);
    c = mix(c, c * vec3(0.76, 0.93, 0.8), max(wetK, lowK * 0.45) * (1.0 - 0.5 * envBare));
    c = mix(c, c * vec3(1.07, 0.93, 0.8), heath * 0.55 * decoK);
    if (heath * fineK > 0.01) c *= 1.0 - heath * (0.5 - rnoise(p / 5.0)) * 0.22 * fineK;
    // the driest ground: sun-bleached grass in broad soft patches
    float worn = rnoise(p / 34.0) * smoothstep(0.45, 0.8, dryK) * (1.0 - max(pasture, meadow)) * (1.0 - townG);
    c = mix(c, c * mix(vec3(1.17, 1.06, 0.8), vec3(1.0), envBare), smoothstep(0.28, 0.66, worn) * 0.6 * decoK);
    // the fields: each its own tone; a mown meadow lies in swaths
    if (kind > 0.0) {
      vec3 ft = kind == 1.0 ? vec3(1.06, 1.04, 0.92) : vec3(0.93, 1.0, 0.86);
      c = mix(c, c * ft * (0.93 + 0.14 * fh), encK);
      float sw = sin((fh > 0.5 ? ef.x : ef.y) * ${(6.2832 / 4.6).toFixed(4)});
      c *= 1.0 + sw * 0.045 * meadow * mown * (1.0 - smoothstep(0.5, 1.6, mpp));
    }
    // built land: a town's ground is the lawn of its lots (buildings3d.ts YARD.res, as the seasons' shader turns it),
    // a works' yard bare trodden earth, a farmyard worn and pale
    c = mix(c, mix(${c3(0x99994f)}, envGrass(${c3(0x99994f)}), 0.69) * (1.0 + (n4 - 0.5) * 0.05), max(townG, smoothstep(0.1, 0.7, town)) * 0.92);
    float yardN = smoothstep(0.25, 0.75, n3 * 0.5 + n4 * 0.5);
    vec3 earth = mix(${c3(LAND.earthDark)}, ${c3(LAND.earth)}, yardN) * mix(vec3(1.0), vec3(0.86, 0.86, 0.88), envBare);
    c = mix(c, earth, smoothstep(0.25, 0.75, works + (n4 - 0.5) * 0.3) * 0.86);
    c = mix(c, mix(c, earth * 1.12, 0.5), smoothstep(0.3, 0.8, farm + (n4 - 0.5) * 0.3) * (0.12 + 0.5 * smoothstep(0.5, 0.8, rnoise(p / 26.0))));
    // the shore: a beach in places, wet at the water's edge; elsewhere the grass comes down to the water
    // (which the reeds that stand in 3D read too: render/land.ts)
    float beach = land < 16.0 ? beachAt(p) : 0.0;
    float bw = mix(1.3, 7.5, beach) * mix(0.55, 1.0, step(dR, dL));
    float sand = (1.0 - smoothstep(bw * 0.55, bw, land)) * step(0.0, land + 2.0);
    c = mix(c, mix(${c3(LAND.sandWet)}, ${c3(LAND.beach)}, smoothstep(0.2, 1.3, land)), sand * 0.92);
    // specks: tufts and stones a metre or less across; wild flowers in drifts; reeds along the water
    if (fineK > 0.0) {
      vec2 g = p / 2.6, gi = floor(g);
      float h = hash12(gi + 3.1);
      vec2 ctr = gi + 0.5 + (vec2(hash12(gi + 7.7), hash12(gi + 9.9)) - 0.5) * 0.7;
      float r = 0.07 + 0.08 * hash12(gi + 1.3);
      float d = length(g - ctr), aa = fwidth(d) + 1e-4;
      // (in autumn more of them, and most are fallen leaves: rust, ochre and brown)
      float hl = hash12(gi + 12.4);
      vec3 lc = hl < 0.4 ? vec3(0.6, 0.2, 0.05) : hl < 0.72 ? vec3(0.64, 0.4, 0.07) : vec3(0.33, 0.16, 0.05);
      vec3 sc = mix(c * 0.62, lc, step(0.3, hl + envLitter * 0.6) * envLitter);
      float tufts = 0.55 - envLitter * 0.25 + pasture * 0.25 + town * 0.3 - heath * 0.2;
      c = mix(c, sc, step(tufts, h) * (1.0 - smoothstep(r - aa, r + aa, d)) * 0.7 * fineK * (1.0 - sand));
      // flowers: thick on fertile soil and in a meadow not yet mown, thin elsewhere, none on mown, grazed or built ground
      float bloom = clamp(envFresh * 0.9 + envBlossom * 0.3 + envLush * 0.75 - envDry * 0.8 - envFall - envBare, 0.0, 1.0);
      float fl = bloom * (0.015 + 0.2 * fk + 0.24 * meadow + 0.04 * wetK) * (1.0 - pasture * 0.8) * (1.0 - fo) * (1.0 - max(town, max(works, farm))) * (1.0 - sand);
      if (fl > 0.0) {
        // (they grow in drifts of one kind: a patch of buttercups, a sweep of daisies, poppies here and there)
        float dn = vnoise(p / 13.0 + 51.0) * 0.6 + n3 * 0.4, kn = vnoise(p / 41.0 + 4.4) * 2.6;
        float drift = smoothstep(0.48, 0.72, dn);
        vec2 g2 = p / 0.9, gj = floor(g2);
        float hf = hash12(gj + 21.3);
        vec2 c2 = gj + 0.5 + (vec2(hash12(gj + 2.7), hash12(gj + 6.1)) - 0.5) * 0.7;
        float d2 = length(g2 - c2), a2 = fwidth(d2) + 1e-4;
        float hk = fract(kn + hf * 0.22);
        vec3 fc = hk < 0.42 ? ${c3(LAND.flowers[0])} : hk < 0.74 ? ${c3(LAND.flowers[1])} : hk < 0.83 ? ${c3(LAND.flowers[2])} : hk < 0.93 ? ${c3(LAND.flowers[3])} : ${c3(LAND.flowers[4])};
        float dens = fl * (0.06 + 1.7 * drift);
        float dot2 = step(hf, dens) * (1.0 - smoothstep(0.2 - a2, 0.2 + a2, d2));
        // (too small to see one by one from higher up: there they tint their drift)
        float seen = 1.0 - smoothstep(0.25, 0.6, mpp);
        c = mix(c, fc, max(dot2 * seen * 0.9, dens * 0.13 * (1.0 - seen)) * fineK);
      }
      // reeds: dark blades standing in the shallows and on the bank where there is no beach
      float reedK = (1.0 - beach) * (1.0 - smoothstep(1.5, 5.5 + 4.0 * n4, abs(land - 1.0))) * (abs(land - 1.0) < 10.0 ? smoothstep(0.3, 0.6, reedAt(p)) : 0.0);
      if (reedK > 0.0) {
        // (a reed bed from above: a rank, darker stand, flecked; the blades themselves stand in 3D, render/landprops.ts)
        vec3 rc = mix(${c3(LAND.reed)}, ${c3(LAND.reedDry)}, clamp(envFall + envBare, 0.0, 1.0)) * (0.82 + 0.36 * hash12(floor(p / 0.6) + 4.2));
        c = mix(c, rc, reedK * (0.35 + 0.3 * rnoise(p / 2.3)) * fineK);
      }
    }
    // shrubs and trees: round crowns, lit from the sun's side, each with a soft shadow down-right. Scrub is scattered
    // in loose clumps; in a forest they close up into canopy. Which cells hold one is worked out on the CPU
    // (render/forest.ts) and read here from a texture, so these are the very trees that stand in 3D nearer in
    // (render/trees3d.ts); while those stand, uPaint is 0 and nothing of them is painted.
    float crownK = 1.0 - smoothstep(1.0, 2.0, mpp);
    float density = mix(sd, ${CANOPY.toFixed(2)}, fo);
    // (a wood's floor, and a darker, ranker fringe round it)
    float fringe = cov(forest + 0.05) - fo;
    vec3 under = mix(c, c * vec3(0.84, 0.92, 0.78), fringe * 0.7);
    under = mix(under, envGrass(${c3(PAL.forestFloor)}), fo * 0.85);
    // snow: drifts with a lit and a shaded side, thin under the trees, on trodden and wind-scoured ground, and
    // gone from the water's edge; a hedge's shadow lies on it
    if (envSnow > 0.001) {
      sn = envSnowAt(p, -0.3 + fo * 0.72 + works * 0.6 + heath * 0.2 + (1.0 - smoothstep(0.0, 2.5, land)) * 0.9 + smoothstep(0.6, 0.9, dryK) * 0.2);
      float e = rnoise((p + uSun * 5.0) / 31.0) - rnoise((p - uSun * 5.0) / 31.0);
      vec3 sc = envSnowCol(p) * (1.0 + clamp(e * 0.45, -0.1, 0.06)) * mix(vec3(1.0), vec3(0.9, 0.94, 1.0), clamp(-e * 2.0, 0.0, 1.0));
      under = mix(under, sc, sn);
    }
    under *= 1.0 - hsh * 0.34 * uShade.x * uHedge * encK * (1.0 - town) * (1.0 - smoothstep(1.0, 3.0, mpp));
    // the hedges, painted (until the 3D ones stand in their place): a lumpy dark band, its sun side lit
    if (hd < 4.0 && uHedge > 0.0) {
      float hw = ${fl(HEDGE_HW)} * (0.72 + 0.56 * vnoise(p / 1.9 + 8.8));
      float hm = 1.0 - smoothstep(hw - mpp * 0.7, hw + mpp * 0.7, hd);
      vec3 leaf = mix(${c3(PAL.shrub)} * 0.74, ${c3(PAL.shrubLight)}, hlit * 0.8) * (0.9 + 0.2 * n4);
      // (new green in spring; russet and old gold in autumn, a stretch at a time; bare twigs in winter)
      vec3 hc = mix(leaf, leaf * vec3(1.02, 1.16, 0.72), envFresh);
      hc = mix(hc, mix(${c3(0x8a5a2c)}, ${c3(0xb08a38)}, smoothstep(0.35, 0.65, vnoise(p / 9.0 + 3.1))) * (0.7 + 0.4 * hlit), envFall * 0.8);
      float bare = envBareOf(0.5);
      hc = mix(hc, envWood(hlit, smoothstep(0.35, 0.8, hlit + n4 * 0.3)), smoothstep(0.2, 1.0, bare));
      under = mix(under, hc, hm * uHedge * encK * (1.0 - town) * mix(1.0, 0.8, bare) * (1.0 - smoothstep(2.5, 6.0, mpp) * 0.55));
    }
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
    // the lie of the land: slopes that face the sun a little lighter, those turned from it darker (bluer on snow)
    float lit = clamp(-dot(slope, uSun) * 0.055, -0.13, 0.1) * uShade.x;
    c *= 1.0 + lit * mix(vec3(1.0), vec3(1.25, 1.0, 0.6), sn * step(lit, 0.0));
  }
  // terraced hills: flat tiers, a lit or shaded bevel at each step, and the shadow each tier throws
  float lvl = 0.0;
  float steps[4] = float[4](0.5, 0.6, 0.7, 0.8);
  for (int k = 0; k < 4; k++) lvl += step(steps[k], m);
  vec2 gm = vec2(Ax.r, Ay.r);
  float gml = max(length(gm), 1e-7);
  if (uAtlas < 0.999 && m > 0.46) {
    vec3 mc = c;
    vec3 mcol[4] = vec3[4](${c3(PAL.mountain[0])}, ${c3(PAL.mountain[1])}, ${c3(PAL.mountain[2])}, ${c3(PAL.mountain[3])});
    // (rock, weathered in bands and flecks; the lowest tier still half turf)
    // (each tier a shelf: turf on its top, thinner the higher it is, rock showing through in patches; its step a
    // rock face a few metres deep, in strata, lit or shaded by the way it faces)
    float rockN = 1.0 + (n3 - 0.5) * 0.1 + (n4 - 0.5) * 0.1 * fineK;
    float facing = dot(-gm / gml, uSun);
    float crag = smoothstep(0.56, 0.74, rnoise(p / 27.0));
    float turfK[4] = float[4](0.78, 0.6, 0.36, 0.12);
    vec3 turf = c * vec3(0.97, 0.95, 0.88);
    for (int k = 0; k < 4; k++) {
      float a = cov(m - steps[k] + 0.5);
      float dm = (m - steps[k]) / gml;
      float face = 1.0 - smoothstep(4.5, 8.0 + 5.0 * n4, dm);
      vec3 rk = mcol[k] * rockN;
      vec3 top = mix(rk, turf * (1.0 - 0.05 * float(k)), turfK[k] * (1.0 - crag * 0.6));
      vec3 fc = rk * (1.0 + facing * 0.15 * uShade.x) * (1.0 - 0.09 * smoothstep(0.2, 0.9, sin(dm * 2.6 + n3 * 9.0)) * fineK);
      mc = mix(mc, mix(top, fc, face), a);
    }
    // bevel: near a step edge, tint by which way the slope faces the sun
    for (int k = 0; k < 4; k++) {
      float d = (m - steps[k]) / (gml * mpp); // pixels from the edge, inside > 0
      float band = (1.0 - smoothstep(0.0, 4.0, d)) * step(0.0, d);
      mc *= 1.0 + band * facing * 0.10;
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
  }
  // water: shallows over the sand, deepening; ripples run in to the bank; in winter, colder, with ice along the edge
  if (wa > 0.0 && uAtlas < 0.999) {
    float isLake = step(dR, dL);
    // (a river is deep along its middle, however the field that draws it lies there)
    float mid = clamp((rw - sAbs) / max(rw, 1e-6), 0.0, 1.0);
    float depth = max(max(dW, 0.0), (1.0 - isLake) * mid * mid * 26.0 * smoothstep(0.0, 4.0, dW));
    vec3 wc = mix(${c3(LAND.waterShallow)}, ${c3(PAL.water)}, smoothstep(0.0, mix(3.5, 9.0, isLake) + 5.0 * n3, depth));
    wc = mix(wc, ${c3(LAND.waterDeep)}, smoothstep(9.0, mix(22.0, 70.0, isLake), depth) * 0.9);
    wc *= 1.0 + (n2 - 0.5) * 0.1 + (n3 - 0.5) * 0.05;
    float rippleK = 1.0 - smoothstep(0.5, 1.5, mpp);
    if (rippleK > 0.0) {
      float t = uWind.w * ${(6.2832 / 64).toFixed(5)};
      // (rings running in to the bank, broken along their length)
      float ph = depth * 1.7 + t * 10.0 + n4 * 5.0 + vnoise(p / 3.3 + 9.1) * 5.0;
      float ring = smoothstep(0.82, 0.97, sin(ph)) * exp(-depth / 11.0) * smoothstep(0.35, 0.6, vnoise(p / 5.1 + vec2(t * 0.0, 2.2)));
      // (out in the open, short glints that come and go with the wind)
      vec2 gq = vec2(dot(p, vec2(uWind.y, -uWind.x)) / 11.0, dot(p, uWind.xy) / 3.4), gqi = floor(gq);
      float gh = hash12(gqi + 31.7);
      vec2 gd = (gq - gqi - 0.5) * vec2(11.0, 3.4);
      // (a wavelet's crest: a few metres long across the wind, bent, thin)
      float glint = step(0.88, gh) * (1.0 - smoothstep(1.6, 4.2, abs(gd.x))) * (1.0 - smoothstep(0.1, 0.26, abs(gd.y + sin(gd.x * 1.25 + gh * 20.0) * 0.5)))
        * smoothstep(0.5, 1.0, sin(t * (4.0 + floor(gh * 50.0)) + gh * 40.0)) * smoothstep(4.0, 14.0, depth);
      wc += (ring * 0.1 + glint * 0.06 * (0.5 + uWind.z)) * rippleK * (1.0 - envFrost);
      // a river's current: fine lines along its banks
      wc *= 1.0 - (1.0 - isLake) * smoothstep(0.75, 0.95, sin(depth * 2.3 + n3 * 7.0 + n4 * 2.0)) * 0.06 * rippleK;
    }
    // (a pale line where the water meets the land)
    wc = mix(wc, ${c3(LAND.foam)}, (1.0 - smoothstep(0.15, 0.8, depth)) * 0.45 * (1.0 - smoothstep(0.6, 1.8, mpp)) * (1.0 - envFrost));
    wc = mix(wc, wc * vec3(0.86, 0.94, 1.04), envFrost);
    // (ice a few metres out from the bank, broken at its edge, snow lying on it near the bank)
    float ice = (1.0 - smoothstep(2.0, 5.0 + 6.0 * vnoise(p / 9.0), depth)) * envFrost;
    vec3 ic = mix(vec3(0.83, 0.88, 0.92), envSnowCol(p), (1.0 - smoothstep(0.5, 3.0 + 2.0 * n4, depth)) * envSnow * 0.8);
    c = mix(c, mix(wc, ic, ice * 0.9), wa);
  }
  // far out the land is a page of a road atlas: paper, washes, inked symbols
  if (uAtlas > 0.001) {
    vec3 a = ${c3(LAND.paper)} * (0.985 + (n1 - 0.5) * 0.035);
    // the low ground a pale green, the high ground buff
    a = mix(a, ${c3(LAND.low)}, (1.0 - smoothstep(0.13, 0.24, m)) * 0.7);
    a = mix(a, ${c3(LAND.high)}, smoothstep(0.24, 0.46, m) * 0.7);
    // fertile soil: a warm wash, stippled
    {
      float fa = cov(fert);
      vec4 sc = symCell(p, mpp, 9.0, 0.5);
      float dot1 = (1.0 - smoothstep(0.55, 1.15, length(sc.xy))) * sc.z;
      a = mix(a, ${c3(LAND.fertile)}, fa * 0.55);
      a = mix(a, ${c3(LAND.fertileInk)}, fa * dot1 * 0.55);
    }
    // the fields: a patchwork of pale washes inside their hedge lines
    if (kind > 0.0) a = mix(a, (kind == 1.0 ? ${c3(LAND.pasture)} : ${c3(LAND.meadow)}) * (0.97 + 0.05 * fh), encK * 0.75);
    a = mix(a, ${c3(LAND.parcelInk)}, (1.0 - smoothstep(0.3, 0.9, hd / mpp)) * 0.42 * encK);
    // deposits: a faint tint of their soil
    a = mix(a, ${c3(PAL.soilOre)}, cov(ore) * 0.2);
    a = mix(a, ${c3(PAL.soilCoal)}, cov(coal) * 0.2);
    a = mix(a, ${c3(PAL.soilLime)}, cov(lime) * 0.3);
    a = mix(a, ${c3(PAL.soilSand)}, cov(sandD) * 0.3);
    a = mix(a, ${c3(PAL.soilOil)}, cov(oil) * 0.18);
    a = mix(a, ${c3(PAL.soilCopper)}, cov(copper) * 0.22);
    // winter: the page goes white, the washes faint under it
    float aSnow = envSnow * 0.62;
    a = mix(a, ${c3(LAND.snow)}, aSnow);
    // woods: a green wash (ochre in autumn, grey-brown when bare) and tree symbols
    {
      vec3 wood = mix(${c3(LAND.wood)}, vec3(0.80, 0.62, 0.30), envFall * 0.5);
      wood = mix(wood, vec3(0.70, 0.68, 0.60), envBare * 0.6);
      vec3 wink = mix(${c3(LAND.woodInk)}, vec3(0.42, 0.26, 0.1), envFall * 0.5);
      wink = mix(wink, vec3(0.3, 0.27, 0.23), envBare * 0.6);
      a = mix(a, wood, fo * 0.9);
      vec4 sc = symCell(p, mpp, 15.0, 0.42);
      float r = 2.5 + 1.3 * fract(sc.w * 7.7);
      float d = length(sc.xy);
      float body = 1.0 - smoothstep(r - 0.6, r + 0.4, d);
      // (a round crown: its outline, darker on the side away from the light)
      float rim = body * smoothstep(r - 1.9, r - 0.5, d + dot(sc.xy, vec2(0.6, 0.8)) * 0.45);
      float sym = sc.z * fo;
      a = mix(a, mix(wood * 0.93, wink, rim * 0.85), body * sym * 0.9);
    }
    // relief: the tiers' washes, a brown form line at each step, and hill shading with the light from the north-west
    {
      vec3 tier[4] = vec3[4](${c3(LAND.tier[0])}, ${c3(LAND.tier[1])}, ${c3(LAND.tier[2])}, ${c3(LAND.tier[3])});
      float line = 0.0;
      for (int k = 0; k < 4; k++) {
        a = mix(a, mix(tier[k], ${c3(LAND.snow)}, aSnow), cov(m - steps[k] + 0.5) * 0.9);
        line = max(line, 1.0 - smoothstep(0.45, 1.2, abs(m - steps[k]) / (gml * mpp)));
      }
      float shade = clamp(-dot(slope, vec2(-0.6, -0.8)) * 0.11, -0.22, 0.12);
      // (steeper on the hills themselves, from the field's own slope)
      shade += clamp(-dot(gm / ${SLOPE0}, vec2(-0.6, -0.8)) * 0.02, -0.12, 0.08) * step(0.5, m);
      a *= 1.0 + shade * vec3(0.9, 1.0, 1.2);
      a = mix(a, ${c3(LAND.reliefInk)}, line * 0.75);
    }
    // built land: a town's blocks in a warm wash, a works hatched, a farm's plot pale gold, each with its outline
    {
      float tw = smoothstep(0.3, 0.55, town), ww = smoothstep(0.35, 0.6, works), fw2 = smoothstep(0.35, 0.6, farm);
      a = mix(a, ${c3(LAND.town)}, tw * 0.9);
      a = mix(a, ${c3(LAND.farm)}, fw2 * 0.8);
      a = mix(a, ${c3(LAND.works)}, ww * 0.9);
      // (hatching that keeps its spacing on the page: every other line fades as the map is zoomed out)
      float o = log2(mpp * 5.0), o0 = floor(o), ot = o - o0, hs = exp2(o0);
      float hx = (p.x + p.y) / hs, hi = floor(hx);
      float hl = (1.0 - smoothstep(0.3, 0.75, abs(hx - hi - 0.5) * hs / mpp)) * mix(1.0 - smoothstep(0.1, 0.8, ot), 1.0, step(mod(hi, 2.0), 0.5));
      a = mix(a, ${c3(LAND.worksInk)}, ww * hl * 0.5);
      float te = 1.0 - smoothstep(0.5, 1.3, abs(town - 0.42) / max(fwidth(town), 1e-4));
      float we = 1.0 - smoothstep(0.5, 1.3, abs(works - 0.47) / max(fwidth(works), 1e-4));
      float fe = 1.0 - smoothstep(0.5, 1.3, abs(farm - 0.47) / max(fwidth(farm), 1e-4));
      a = mix(a, ${c3(LAND.townInk)}, te * 0.55);
      a = mix(a, ${c3(LAND.worksInk)}, max(we * 0.8, fe * 0.5));
    }
    // water: a pale blue, its shore inked, fine lines following the shore in, short wave marks out on a lake
    {
      float dp = dW / mpp;
      vec3 wc = mix(${c3(LAND.water)}, ${c3(LAND.snow)} * vec3(0.9, 0.95, 1.0), envFrost * 0.45);
      float lines = max(max((1.0 - smoothstep(0.35, 0.9, abs(dp - 3.2))) * 0.5, (1.0 - smoothstep(0.35, 0.9, abs(dp - 7.4))) * 0.33), (1.0 - smoothstep(0.35, 0.9, abs(dp - 13.0))) * 0.2);
      vec4 sc = symCell(p, mpp, 30.0, 0.5);
      float wave = (1.0 - smoothstep(0.3, 0.8, abs(sc.y + sin(sc.x * 1.1) * 0.9))) * (1.0 - smoothstep(3.5, 5.0, abs(sc.x))) * sc.z * smoothstep(16.0, 24.0, dp) * step(0.4, sc.w);
      wc = mix(wc, ${c3(LAND.waterInk)}, max(lines, wave * 0.4));
      a = mix(a, wc, wa);
      a = mix(a, ${c3(LAND.waterInk)}, (1.0 - smoothstep(0.5, 1.3, abs(dp))) * 0.9);
    }
    // the page's squares: a fine line every two kilometres
    {
      vec2 gd = abs(fract(p / 2000.0 + 0.5) - 0.5) * 2000.0 / mpp;
      a = mix(a, ${c3(LAND.gridInk)}, (1.0 - smoothstep(0.3, 0.9, min(gd.x, gd.y))) * 0.2);
    }
    c = mix(c, a, uAtlas);
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
