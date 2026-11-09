// The trees, standing: every wild tree and shrub the ground would paint as a flat crown (render/forest.ts has the
// one list both come from), and every planted one (street trees, parks, squares, gardens), as instanced Blender
// models (tools/blender/build_trees.py). One draw call per model; the vertex shader places each instance, sways it in
// the wind, colours it by the season with the same functions the painted crowns use (render/envShader.ts), drops a
// broadleaf's leaves clump by clump into winter, and casts a real shadow.
//
// By zoom: near in, the 3D trees stand and the ground paints no crowns (Terrain3D uPaint = 0); farther out the wild
// ones sink flat onto the ground, where they are the very discs the ground then paints, and hand over to it. Because
// both come from one list the handover changes nothing but the cost. The planted ones stay 3D at every zoom.
//
// Culling is by tile (forest.ts TILE_M) against the ground the camera sees, found by casting the screen's corners
// down the camera's own view direction: it holds for the straight-down map, for a tilted camera and for any turn.

import * as THREE from "three";
import { ENV, ENV_CORE_GLSL, v3 } from "./envShader";
import { EVERGREEN, H, SCRUB, TILE_M, TREE_MODELS, thashf, treeModel, type Forest } from "./forest";
import type { TreeShape } from "./models";
import { PAL } from "./palette";
import { WIND } from "./wind";

/** A tree someone planted: where, how wide its crown, and what sort of place it stands in. */
export interface PlantedTree {
  x: number; y: number;
  /** the ground's height there (a street on an embankment) */
  h?: number;
  /** crown radius, m */
  r: number;
  /** a street's trees are one kind for a block or two; a park's and a garden's are mixed, with a conifer here and there */
  style: "street" | "park";
}

const FLOATS = 8; // an instance: x, ground height, z, scale; tone, kind hash, turn, flags
/** A conifer's crown is narrower than the disc the ground paints for it: so it stands a believable height. */
const SCALE = [1, 1, 1, 0.9, 0.9, 1, 1];
/** Ground in view (m2) at which the wild trees start to hand over to the painted crowns, and by which they have. */
const AREA0 = 2.3e6, AREA1 = 3.2e6;
/** ...and the zoom (metres a pixel) by which they have in any case: the painted crowns are at full strength there. */
const MPP1 = 1.12;
/** Past this zoom every tree is drawn as its far model (a couple of dozen triangles). */
const LOD_MPP = 0.52;
const MAX_INSTANCES = 110_000;
const MARGIN = 34; // metres round the ground in view: a tall tree whose foot is off screen, the shadow of one that is

const tkey = (i: number, j: number) => (i + 32768) * 65536 + (j + 32768);

/** The GLSL that places a tree's vertex: shared by the lit material and the one the shadow map is drawn with. */
const TREE_VERTEX_GLSL = /* glsl */ `
attribute vec4 aInst;  // x, ground height, z, scale (its crown's radius, m)
attribute vec4 aTree;  // tone, kind hash, turn (radians), flags (1 forest, 2 wild)
attribute vec4 aClump; // the middle of this vertex's clump (model space), the clump's own random number
attribute float aPart; // 0 trunk, 1 leaves, 2 bare limbs, 3 needles, 4 a shrub's foliage
attribute vec3 aTwig;  // where this vertex of a leaf clump goes when the leaves fall: its face becomes a twig
uniform vec4 uWind;    // xy the way the air moves, z how hard, w the wind's clock (wraps at 64 s)
uniform vec4 uTreeFx;  // x how flat the wild trees lie (handing over to the painted crowns), y how far they have faded
vec3 treeRot(vec3 v) {
  float c = cos(aTree.z), s = sin(aTree.z);
  return vec3(c * v.x + s * v.z, v.y, c * v.z - s * v.x);
}
#define TREE_W(n) (float(n) * 0.09817477)
vec3 treeVertex(vec3 pos) {
  float h = aTree.y;
  float bare = envBareOf(h);
  vec3 p = pos;
  bool foliage = aPart > 0.5 && aPart < 1.5 || aPart > 2.5;
  if (aPart > 0.5 && aPart < 1.5) {
    // the leaves fall clump by clump, one after another: each facet of a clump thins to a twig out from its middle
    p = mix(p, aTwig, smoothstep(aClump.w * 0.5, aClump.w * 0.5 + 0.5, bare));
  } else if (aPart > 1.5 && aPart < 2.5) {
    // the limbs keep inside the crown till the leaves go
    p = mix(aClump.xyz, p, mix(0.78, 1.0, smoothstep(0.0, 0.6, bare)));
  } else if (aPart > 3.5) {
    // a shrub thins to a twiggy mass
    p = mix(p, aClump.xyz, 0.22 * bare);
  }
  float wild = step(1.5, aTree.w);
  float tall = 0.88 + 0.3 * fract(h * 11.3);
  vec3 w = treeRot(p * vec3(aInst.w, aInst.w * tall * (1.0 - 0.95 * wild * uTreeFx.x), aInst.w));
  // the wind: the whole tree leans downwind and rocks, more the higher up; gusts run over the trees as waves; each
  // clump of foliage shivers on its own. Calmer in winter (bare limbs hardly move).
  float t = uWind.w, k = uWind.z * (1.0 - 0.55 * envBare) * (1.0 - wild * uTreeFx.x);
  vec2 at = aInst.xz;
  float ph = h * 6.2832 + aTree.x * 4.0;
  float gust = 0.5 + 0.5 * sin(dot(at, uWind.xy) * 0.045 + sin(dot(at, vec2(-uWind.y, uWind.x)) * 0.021) * 1.8 - t * TREE_W(11));
  float up = p.y * tall;
  float bend = up * up * aInst.w * 0.021 * k;
  float rock = sin(t * TREE_W(29) + ph) * 0.55 + sin(t * TREE_W(47) + ph * 1.7) * 0.3;
  w.xz += uWind.xy * bend * (0.25 + 0.75 * gust + 0.5 * rock) + vec2(-uWind.y, uWind.x) * bend * 0.35 * sin(t * TREE_W(37) + ph * 2.3);
  if (foliage) {
    vec3 d = p - aClump.xyz;
    float q = aClump.w * 40.0 + dot(pos, vec3(5.1, 3.7, 4.3));
    w += vec3(sin(t * TREE_W(83) + q), sin(t * TREE_W(71) + q * 1.3) * 0.6, sin(t * TREE_W(97) + q * 0.7)) * (0.03 + 0.05 * gust) * k * aInst.w * (0.4 + length(d));
  }
  return w + vec3(aInst.x, aInst.y, aInst.z);
}
`;

const TREE_COLOUR_GLSL = /* glsl */ `
varying vec3 vTreeCol;
varying float vTreeWild;
vec3 treeColour(vec3 n) {
  float tone = aTree.x, h = aTree.y;
  float fo = mod(aTree.w, 2.0);
  float bare = envBareOf(h);
  // how much this face looks at the sun, and at the sky (the snow lies on what faces up, most on the lit side)
  float sun = clamp(0.5 + 0.5 * dot(n, normalize(vec3(uSun.x, 1.0, uSun.y))), 0.0, 1.0);
  float rnd = fract(sin(dot(position + aClump.w, vec3(12.9898, 78.233, 37.719))) * 43758.5453);
  // the painted crown's two greens (its shaded and its lit side), met in the middle: the light does the rest
  vec3 leaf = mix(${v3(PAL.shrub)}, ${v3(PAL.tree)}, fo * 0.8 + tone * 0.25);
  vec3 summer = mix(leaf * 0.78, mix(${v3(PAL.shrubLight)}, ${v3(PAL.treeLight)}, fo), 0.5) * (0.94 + 0.12 * aClump.w);
  vec3 c;
  if (aPart < 0.5) {
    c = mix(${v3(0x6b5540)}, ${v3(0x5d5148)}, tone);
  } else if (aPart < 1.5) {
    // (blossom: whole facets of it, mottled over the crown; the last leaves browning as they go)
    c = envFoliage(summer, tone, h, 0.62, smoothstep(0.35, 0.6, rnd));
    float gone = smoothstep(aClump.w * 0.5, aClump.w * 0.5 + 0.5, bare);
    c = mix(mix(c, c * vec3(0.8, 0.66, 0.5), smoothstep(0.1, 0.7, bare)), envWood(0.6, smoothstep(0.3, 0.8, n.y + rnd * 0.4) * 0.7), smoothstep(0.5, 1.0, gone));
  } else if (aPart < 2.5) {
    c = envWood(0.6, smoothstep(0.2, 0.75, n.y));
  } else if (aPart < 3.5) {
    c = envConifer(summer, 0.6, smoothstep(0.3, 0.72, n.y * 0.55 + sun * 0.5 + rnd * 0.25 - 0.1));
  } else {
    c = envFoliage(summer, tone, h, 0.62, smoothstep(0.35, 0.6, rnd));
    c = mix(c, envWood(0.62, smoothstep(0.35, 0.8, n.y + rnd * 0.3)), smoothstep(0.3, 1.0, bare) * 0.85);
  }
  return envGrade(c);
}
`;

interface Batch {
  full: THREE.Mesh; lod: THREE.Mesh;
  buf: THREE.InstancedInterleavedBuffer;
  n: number;
}

interface TileCache { version: number; parts: (Float32Array | null)[] }

export class Trees3D {
  readonly group = new THREE.Group();
  /** How much of the painted crowns the ground should show (1 - how much of the wild trees stands here): Terrain3D's uPaint. */
  paint = 0;
  /** The view is near the zoom the painted crowns take over at: the ground should have them ready. */
  handoverNear = false;
  /** Trees drawn last frame (for the performance read-outs). */
  count = 0;
  private fx = { value: new THREE.Vector4(0, 0, 0, 0) };
  private mat: THREE.MeshLambertMaterial;
  private depth: THREE.MeshDepthMaterial;
  private batches: Batch[] = [];
  private shapes: TreeShape[];
  private wild = new Map<number, TileCache>();
  private planted = new Map<number, (Float32Array | null)[]>();
  private plantedVersion = 0;
  private sig = "";
  private pending = false;
  private corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private dir = new THREE.Vector3();
  private scratch: number[][] = TREE_MODELS.map(() => []);

  constructor(models: Map<string, TreeShape>, private forest: Forest) {
    this.shapes = TREE_MODELS.map((n) => models.get(n)!);
    const inject = (sh: THREE.WebGLProgramParametersWithUniforms, colour: boolean) => {
      Object.assign(sh.uniforms, ENV, WIND, { uTreeFx: this.fx });
      sh.vertexShader = sh.vertexShader
        .replace("#include <common>", `#include <common>\n${ENV_CORE_GLSL}\n${TREE_VERTEX_GLSL}\n${colour ? TREE_COLOUR_GLSL : "varying float vTreeWild;"}`)
        .replace("#include <beginnormal_vertex>", "vec3 objectNormal = treeRot(normal);")
        .replace("#include <begin_vertex>", `vec3 transformed = treeVertex(position);\nvTreeWild = step(1.5, aTree.w);${colour ? "\nvTreeCol = treeColour(treeRot(normal));" : ""}`);
      // the wild trees thin out pixel by pixel as the painted crowns take their place
      const fade = `if (vTreeWild > 0.5 && uTreeFx.y > 0.0 && fract(52.9829189 * fract(dot(gl_FragCoord.xy, vec2(0.06711056, 0.00583715)))) < uTreeFx.y) discard;`;
      sh.fragmentShader = sh.fragmentShader
        .replace("#include <common>", `#include <common>\nuniform vec4 uTreeFx; varying float vTreeWild;${colour ? " varying vec3 vTreeCol;" : ""}`)
        .replace(colour ? "#include <color_fragment>" : "#include <clipping_planes_fragment>", colour ? `${fade}\ndiffuseColor.rgb = vTreeCol;` : `#include <clipping_planes_fragment>\n${fade}`);
    };
    this.mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
    this.mat.onBeforeCompile = (sh) => inject(sh, true);
    this.mat.customProgramCacheKey = () => "trees-v1";
    this.depth = new THREE.MeshDepthMaterial();
    this.depth.onBeforeCompile = (sh) => inject(sh, false);
    this.depth.customProgramCacheKey = () => "trees-depth-v1";
    for (let m = 0; m < TREE_MODELS.length; m++) this.batches.push(this.makeBatch(m, 256));
  }

  dispose() {
    for (const b of this.batches) { b.full.geometry.dispose(); b.lod.geometry.dispose(); }
    this.mat.dispose();
    this.depth.dispose();
  }

  private makeBatch(m: number, cap: number): Batch {
    const buf = new THREE.InstancedInterleavedBuffer(new Float32Array(cap * FLOATS), FLOATS);
    buf.setUsage(THREE.DynamicDrawUsage);
    const mesh = (src: THREE.BufferGeometry) => {
      const g = new THREE.InstancedBufferGeometry();
      for (const k of ["position", "normal", "aClump", "aPart", "aTwig"]) g.setAttribute(k, src.getAttribute(k));
      g.setAttribute("aInst", new THREE.InterleavedBufferAttribute(buf, 4, 0));
      g.setAttribute("aTree", new THREE.InterleavedBufferAttribute(buf, 4, 4));
      g.instanceCount = 0;
      const o = new THREE.Mesh(g, this.mat);
      o.customDepthMaterial = this.depth;
      o.frustumCulled = false; // (placed in the shader; culled by tile here)
      o.castShadow = true;
      o.receiveShadow = true;
      o.visible = false;
      this.group.add(o);
      return o;
    };
    return { full: mesh(this.shapes[m].full), lod: mesh(this.shapes[m].lod), buf, n: 0 };
  }

  /** Room for n instances of model m (the buffers grow by half as much again; never shrink). */
  private reserve(m: number, n: number): Batch {
    const b = this.batches[m];
    if (n * FLOATS <= b.buf.array.length) return b;
    this.group.remove(b.full, b.lod);
    b.full.geometry.dispose();
    b.lod.geometry.dispose();
    return (this.batches[m] = this.makeBatch(m, Math.ceil(n * 1.5) + 64));
  }

  /** Every planted tree there is now (the streets', the greens', the squares', the gardens'), replacing the last list. */
  setPlanted(trees: PlantedTree[]) {
    this.planted.clear();
    const lists = new Map<number, number[][]>();
    for (const t of trees) {
      // (hashed from where it stands: the same tree every time the list is rebuilt)
      const a = Math.round(t.x * 4), b = Math.round(t.y * 4);
      const kind = thashf(a, b, 41), tone = thashf(a, b, 42);
      let model: number;
      if (t.style === "street") {
        // one kind along a block or two of street
        model = thashf(Math.floor(t.x / 180), Math.floor(t.y / 180), 43) < 0.55 ? 0 : 1;
        if (kind < 0.12) model = 1 - model;
      } else model = treeModel(kind, t.r, EVERGREEN.street, true);
      const key = tkey(Math.floor(t.x / TILE_M), Math.floor(t.y / TILE_M));
      let e = lists.get(key);
      if (!e) lists.set(key, (e = TREE_MODELS.map(() => [])));
      e[model].push(t.x, t.h ?? 0, t.y, t.r * SCALE[model], tone, kind, thashf(a, b, 44) * 6.2832, 1);
    }
    for (const [key, e] of lists) this.planted.set(key, e.map((l) => (l.length ? Float32Array.from(l) : null)));
    this.plantedVersion++;
  }

  /** A tile's wild trees as instances, by model. */
  private wildTile(ti: number, tj: number, key: number): TileCache {
    const t = this.forest.tile(ti, tj);
    let c = this.wild.get(key);
    if (c && c.version === t.version) return c;
    const lists = this.scratch;
    for (const l of lists) l.length = 0;
    for (let k = 0; k < t.n; k++) {
      if (!t.alive[k]) continue;
      const grid = t.grid[k], ko = grid * SCRUB, ci = t.ci[k], cj = t.cj[k];
      const kind = thashf(ci, cj, H.kind + ko);
      const model = treeModel(kind, t.r[k], grid === 0 ? EVERGREEN.forest : EVERGREEN.scrub, grid === 1);
      lists[model].push(t.x[k], 0, t.y[k], t.r[k] * SCALE[model], thashf(ci, cj, H.tone + ko), kind, thashf(ci, cj, H.rot + ko) * 6.2832, (grid === 0 ? 1 : 0) + 2);
    }
    if (this.wild.size > 4000) this.wild.delete(this.wild.keys().next().value!);
    c = { version: t.version, parts: lists.map((l) => (l.length ? Float32Array.from(l) : null)) };
    this.wild.set(key, c);
    return c;
  }

  /**
   * Once a frame. `camera`: the map's camera, wherever it looks from; mpp: metres a pixel at the ground; flat: draw
   * no wild trees at all (the resources overlay reads the ground). Sets `paint` for the ground shader.
   */
  update(camera: THREE.OrthographicCamera, mpp: number, flat: boolean) {
    // the ground in view: the screen's corners cast down the view direction
    camera.getWorldDirection(this.dir);
    const d = this.dir, P = this.corners;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const down = d.y < -0.05;
    if (down) {
      for (let k = 0; k < 4; k++) {
        const p = P[k].set(k === 0 || k === 3 ? -1 : 1, k < 2 ? -1 : 1, 0).unproject(camera);
        const s = -p.y / d.y;
        p.set(p.x + d.x * s, 0, p.z + d.z * s);
        x0 = Math.min(x0, p.x); x1 = Math.max(x1, p.x); y0 = Math.min(y0, p.z); y1 = Math.max(y1, p.z);
      }
    }
    // the screen's two edges on the ground, to tell which tiles of the box round it are really in view
    const ux = P[1].x - P[0].x, uy = P[1].z - P[0].z, vx = P[3].x - P[0].x, vy = P[3].z - P[0].z;
    const lu = Math.hypot(ux, uy) || 1, lv = Math.hypot(vx, vy) || 1;
    const area = Math.abs(ux * vy - uy * vx);
    // how far the wild trees have handed over to the painted crowns
    const t = !down || flat ? 1 : Math.max(THREE.MathUtils.smoothstep(area, AREA0, AREA1), THREE.MathUtils.smoothstep(mpp, MPP1 * 0.82, MPP1));
    this.fx.value.set(THREE.MathUtils.smoothstep(t, 0, 0.7), THREE.MathUtils.smoothstep(t, 0.7, 1), 0, 0);
    this.paint = flat ? 1 : THREE.MathUtils.smoothstep(t, 0.5, 0.95);
    this.handoverNear = t > 0 || area > AREA0 * 0.5 || mpp > MPP1 * 0.6;
    const wildOn = t < 1;
    const useLod = mpp > LOD_MPP;
    if (!down) { for (const b of this.batches) b.full.visible = b.lod.visible = false; this.count = 0; return; }
    // the tiles in view, nearest the middle first (so a cap, if it is ever reached, drops the far edge)
    const cx = (P[0].x + P[1].x + P[2].x + P[3].x) / 4, cy = (P[0].z + P[1].z + P[2].z + P[3].z) / 4;
    const reach = TILE_M * 0.71 + MARGIN;
    const tiles: { ti: number; tj: number; key: number; d: number }[] = [];
    let sig = `${wildOn}|${this.plantedVersion}`;
    for (let tj = Math.floor((y0 - MARGIN) / TILE_M); tj <= Math.floor((y1 + MARGIN) / TILE_M); tj++) {
      for (let ti = Math.floor((x0 - MARGIN) / TILE_M); ti <= Math.floor((x1 + MARGIN) / TILE_M); ti++) {
        const mx = (ti + 0.5) * TILE_M - P[0].x, my = (tj + 0.5) * TILE_M - P[0].z;
        // (the tile's middle, as shares of the way along the screen's edges)
        const det = ux * vy - uy * vx || 1;
        const a = (mx * vy - my * vx) / det, b = (ux * my - uy * mx) / det;
        if (a < -reach / lu || a > 1 + reach / lu || b < -reach / lv || b > 1 + reach / lv) continue;
        tiles.push({ ti, tj, key: tkey(ti, tj), d: Math.hypot((ti + 0.5) * TILE_M - cx, (tj + 0.5) * TILE_M - cy) });
      }
    }
    tiles.sort((a, b) => a.d - b.d);
    // work out the wild tiles that are new (a few ms a frame at most: the rest next frame)
    const t0 = performance.now();
    let pending = false;
    const caches: (TileCache | null)[] = [];
    for (const e of tiles) {
      let c: TileCache | null = null;
      if (wildOn) {
        if (this.forest.ready(e.ti, e.tj) || performance.now() - t0 < 4) c = this.wildTile(e.ti, e.tj, e.key);
        else { c = this.wild.get(e.key) ?? null; pending = true; }
      }
      caches.push(c);
      sig += `|${e.key}:${c ? c.version : "-"}`;
    }
    if (sig !== this.sig || this.pending) {
      this.sig = sig;
      this.pending = pending;
      // gather the tiles' instances into each model's buffer
      const counts = TREE_MODELS.map(() => 0);
      for (let pass = 0; pass < 2; pass++) {
        let total = 0;
        const at = TREE_MODELS.map(() => 0);
        tiles.forEach((e, i) => {
          if (total > MAX_INSTANCES) return;
          const pl = this.planted.get(e.key), wc = caches[i];
          for (let m = 0; m < TREE_MODELS.length; m++) {
            for (const arr of [pl?.[m], wc?.parts[m]]) {
              if (!arr) continue;
              if (pass === 0) counts[m] += arr.length / FLOATS;
              else { (this.batches[m].buf.array as Float32Array).set(arr, at[m]); at[m] += arr.length; }
              total += arr.length / FLOATS;
            }
          }
        });
        if (pass === 0) for (let m = 0; m < TREE_MODELS.length; m++) this.reserve(m, counts[m]);
      }
      this.count = 0;
      for (let m = 0; m < TREE_MODELS.length; m++) {
        const b = this.batches[m];
        b.n = counts[m];
        this.count += b.n;
        b.buf.clearUpdateRanges();
        b.buf.addUpdateRange(0, b.n * FLOATS);
        b.buf.needsUpdate = true;
        (b.full.geometry as THREE.InstancedBufferGeometry).instanceCount = b.n;
        (b.lod.geometry as THREE.InstancedBufferGeometry).instanceCount = b.n;
      }
    }
    for (const b of this.batches) {
      b.full.visible = b.n > 0 && !useLod;
      b.lod.visible = b.n > 0 && useLod;
    }
  }
}
