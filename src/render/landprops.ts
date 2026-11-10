// What stands on the open land: the hedgerows round the pastures and hay meadows, the gate in each, the haystacks and
// haycocks of a mown meadow, the reeds along the water. Real models (tools/blender/land_props.py), set out from the
// same rules the ground shader paints by (render/land.ts), so a hedge stands on its painted line, a gate in its
// painted gap, the reeds where the bank has no beach. Near in only: they sink into the ground as the camera rises,
// and from there on the painted hedges carry the fields alone.

import * as THREE from "three";
import { CH, F, RES, riverWater, type Terrain } from "../world/terrain";
import { ENV, ENV_GLSL } from "./envShader";
import { thashf, type Forest } from "./forest";
import { ENC, GATE_HW, HEDGE_S, HEDGE_W, LAND_K, MEADOW, beachAt, encLine, encUnwarp, gateAt, reedAt, type Enclosures, type NodeAt } from "./land";
import type { MergedModel } from "./models";

/** Drawn while a pixel is no more than this many metres; they sink into the ground over the last part of it. */
export const LAND_PROPS_SEE = 1.25;
const SINK_FROM = 0.95;
/**
 * Past this many metres a pixel a hedge, a haystack or a clump of reeds is drawn as its far model: the same shape in
 * a tenth of the faces. A hedge is then a few pixels high, and a screen of enclosed country holds thousands of them.
 */
const FAR_FROM = 0.2;
/** A gate is not drawn past this many metres a pixel (the gap in the painted hedge is what is seen of it). */
const GATE_SEE = 0.6;
/** The kinds that have a far model (its name the kind's and "_far"), and whose model each kind is drawn with. */
const MODEL: Record<string, string> = { haycock: "land_haystack" };
const HAS_FAR = new Set(["land_hedgerow_a", "land_hedgerow_b", "land_haystack", "land_reeds"]);
/** A hedgerow piece's length (m), as modelled. */
const PIECE = 8;
/** A gate's width between the outsides of its posts (m), as modelled. */
const GATE_W = 4.2;
/** A chunk of them: half a ground chunk a side (512 m), so setting one out takes a couple of milliseconds. */
const CHS = CH / 2;
/** Chunks kept. */
const KEEP = 140;

const KINDS = ["land_hedgerow_a", "land_hedgerow_b", "land_gate", "land_haystack", "haycock", "land_reeds"] as const;
type Kind = (typeof KINDS)[number];

interface Chunk { meshes: THREE.InstancedMesh[]; used: number; stale: boolean; ci: number; cj: number }
/** A kind's two models: near and far (the same one twice where there is no far one). */
type Geos = [THREE.BufferGeometry, THREE.BufferGeometry];

/** Where a chunk's props stand: a matrix each, by kind (pure: tested without a renderer). */
export function placeLand(
  ci: number, cj: number, terrain: Terrain, enc: Enclosures,
  blocked: (x: number, y: number, r: number) => boolean,
): Record<Kind, THREE.Matrix4[]> {
  const out = Object.fromEntries(KINDS.map((k) => [k, [] as THREE.Matrix4[]])) as Record<Kind, THREE.Matrix4[]>;
  const at: NodeAt = (f, i, j) => terrain.node(f, i * 4, j * 4);
  const q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), pos = new THREE.Vector3(), sc = new THREE.Vector3();
  const put = (kind: Kind, x: number, y: number, ang: number, sx: number, sy: number, sz = sx) => {
    out[kind].push(new THREE.Matrix4().compose(pos.set(x, 0, y), q.setFromAxisAngle(up, ang), sc.set(sx, sy, sz)));
  };
  const wet = { x: 0, y: 0 };
  const inWater = (x: number, y: number) => { wet.x = x; wet.y = y; return terrain.water(wet) >= 0.5; };
  const per = ENC / RES, n = CHS / per;
  for (let b = 0; b < n; b++) {
    for (let a = 0; a < n; a++) {
      const cx = ci * n + a, cy = cj * n + b;
      const byte = enc.byte(cx, cy, at);
      if (!byte) continue;
      const X0 = encLine(cx, 0), X1 = encLine(cx + 1, 0), Y0 = encLine(cy, 1), Y1 = encLine(cy + 1, 1);
      // the hedges on the cell's west and south sides (its east and north ones are its neighbours' west and south)
      for (const side of [0, 1] as const) {
        if (!(byte & (side === 0 ? HEDGE_W : HEDGE_S))) continue;
        const len = side === 0 ? Y1 - Y0 : X1 - X0;
        const gate = gateAt(cx, cy, side) * len;
        // (a point `s` metres along the side, on the ground)
        const along = (s: number) => (side === 0 ? encUnwarp(X0, Y0 + s) : encUnwarp(X0 + s, Y0));
        // (one piece ends where the next begins: that point is found once)
        let endS = NaN, end: [number, number] = [0, 0];
        const piece = (kind: Kind, s0: number, s1: number, h: number, flip: boolean) => {
          const [ax, ay] = s0 === endS ? end : along(s0), [bx, by] = (end = along(s1)), mx = (ax + bx) / 2, my = (ay + by) / 2;
          endS = s1;
          if (blocked(mx, my, 1.6) || blocked(ax, ay, 0.8) || blocked(bx, by, 0.8) || inWater(mx, my)) return;
          // (a model's length runs along its x: turned onto the line, end for end or not)
          const ang = Math.atan2(-(by - ay), bx - ax) + (flip ? Math.PI : 0);
          put(kind, mx, my, ang, Math.hypot(bx - ax, by - ay) / (kind === "land_gate" ? GATE_W : PIECE), h, kind === "land_gate" ? 1 : 0.7 + 0.3 * h);
        };
        let k = 0;
        for (const [r0, r1] of [[0, gate - GATE_HW], [gate + GATE_HW, len]]) {
          const m = Math.max(1, Math.round((r1 - r0) / PIECE));
          for (let i = 0; i < m; i++, k++) {
            const h1 = thashf(cx * 64 + k, cy * 2 + side, LAND_K.piece), h2 = thashf(cx * 64 + k, cy * 2 + side, LAND_K.piece + 1);
            piece(h1 < 0.22 ? "land_hedgerow_b" : "land_hedgerow_a", r0 + ((r1 - r0) * i) / m, r0 + ((r1 - r0) * (i + 1)) / m, 0.82 + 0.4 * h2, h1 * 7 % 1 < 0.5);
          }
        }
        piece("land_gate", gate - GATE_W / 2, gate + GATE_W / 2, 1, false);
      }
      // a meadow's hay: a stack by the gate corner of some, and the haycocks set out in rows after the mowing
      if ((byte & 3) === MEADOW) {
        const hs = thashf(cx, cy, LAND_K.hay);
        if (hs < 0.5) {
          const [x, y] = encUnwarp(X0 + 9 + 14 * thashf(cx, cy, LAND_K.hay + 1), Y0 + 9 + 14 * thashf(cx, cy, LAND_K.hay + 2));
          if (!blocked(x, y, 3) && !inWater(x, y)) put("land_haystack", x, y, hs * 40, 0.9 + 0.5 * hs, 0.9 + 0.4 * hs);
        }
        if (thashf(cx, cy, LAND_K.hay + 3) < 0.7) {
          const rows = thashf(cx, cy, LAND_K.tint) > 0.5; // (as the swaths run: render/terrain3d.ts)
          for (let v = 14; v < (rows ? X1 - X0 : Y1 - Y0) - 10; v += 23) {
            for (let u = 12; u < (rows ? Y1 - Y0 : X1 - X0) - 10; u += 19) {
              const j = thashf(Math.round(X0 + v), Math.round(Y0 + u), LAND_K.hay + 4);
              if (j < 0.25) continue;
              const fx = rows ? v : u + (j - 0.5) * 6, fy = rows ? u + (j - 0.5) * 6 : v;
              const [x, y] = encUnwarp(X0 + fx, Y0 + fy);
              if (!blocked(x, y, 1.5) && !inWater(x, y)) put("haycock", x, y, j * 30, 0.4 + 0.12 * j, 0.36 + 0.1 * j);
            }
          }
        }
      }
    }
  }
  // the reeds: clumps in the shallows and on the bank, where the shore has no beach
  // (the water at each of the chunk's nodes, read once: a square with wet and dry corners has a shore in it)
  const W1 = CHS + 1, wn = new Uint8Array(W1 * W1);
  let anyWet = 0;
  for (let b = 0; b < W1; b++) {
    for (let a = 0; a < W1; a++) {
      const gi = ci * CHS + a, gj = cj * CHS + b;
      anyWet += wn[b * W1 + a] = Math.max(terrain.node(F.lake, gi, gj) / 255, riverWater(terrain.node(F.river, gi, gj) / 255, terrain.node(F.flow, gi, gj) / 255)) >= 0.5 ? 1 : 0;
    }
  }
  const p = { x: 0, y: 0 };
  const water = (x: number, y: number) => { p.x = x; p.y = y; return terrain.water(p); };
  for (let b = 0; b < CHS && anyWet; b++) {
    for (let a = 0; a < CHS; a++) {
      const gi = ci * CHS + a, gj = cj * CHS + b;
      const wet4 = wn[b * W1 + a] + wn[b * W1 + a + 1] + wn[(b + 1) * W1 + a] + wn[(b + 1) * W1 + a + 1];
      if (wet4 === 0 || wet4 === 4) continue;
      for (let k = 0; k < 14; k++) {
        const x = (gi + thashf(gi, gj, LAND_K.reed + 1 + k * 2)) * RES, y = (gj + thashf(gi, gj, LAND_K.reed + 2 + k * 2)) * RES;
        if (beachAt(x, y) > 0.4 || reedAt(x, y) < 0.42) continue;
        const v = water(x, y), gx = (water(x + 1, y) - v), gy = (water(x, y + 1) - v);
        // (metres into the water: from a step back on the bank to knee deep)
        const d = (v - 0.5) / Math.max(Math.hypot(gx, gy), 1e-6);
        if (d < -1.2 || d > 2.6 || blocked(x, y, 1.2)) continue;
        const h = thashf(gi * 16 + k, gj, LAND_K.reed);
        put("land_reeds", x, y, h * 50, 1.0 + 0.7 * h, 0.8 + 0.5 * thashf(gi * 16 + k, gj, LAND_K.reed + 40));
      }
    }
  }
  return out;
}

/**
 * Their material: the models' own colours, turned with the season as the ground paints its hedges (new green in
 * spring, russet and old gold in autumn, bare wood in winter; reeds and hay keep theirs), the snow lying on top.
 */
function landMaterial(grow: { value: number }): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, ENV, { uLandGrow: grow });
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEnvW; varying vec3 vEnvN; uniform float uLandGrow;")
      .replace("#include <begin_vertex>", `#include <begin_vertex>
  transformed.y *= uLandGrow;
  {
    mat4 envM = modelMatrix * instanceMatrix;
    vEnvW = (envM * vec4(transformed, 1.0)).xyz;
    vEnvN = normalize(mat3(envM) * normal);
  }`);
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${ENV_GLSL}\nvarying vec3 vEnvW; varying vec3 vEnvN;`)
      .replace("#include <color_fragment>", `#include <color_fragment>
  {
    vec3 dc = diffuseColor.rgb;
    float l = dot(dc, vec3(0.3, 0.55, 0.15));
    // (a hedge's leaves are the deep greens; a reed's blades the yellower ones)
    float leaf = smoothstep(0.0, 0.05, dc.g - max(dc.r * 1.45, dc.b * 1.25));
    float reed = smoothstep(0.0, 0.05, dc.g - max(dc.r * 0.9, dc.b * 1.25)) * (1.0 - leaf);
    vec3 lf = mix(dc, dc * vec3(1.02, 1.16, 0.72), envFresh);
    lf = mix(lf, mix(vec3(0.25, 0.1, 0.025), vec3(0.43, 0.25, 0.04), smoothstep(0.35, 0.65, envNoise(vEnvW.xz / 9.0 + 3.1))) * (0.55 + 4.0 * l), envFall * 0.8);
    float bare = smoothstep(0.2, 1.0, envBareOf(0.5));
    lf = mix(lf, vec3(0.19, 0.15, 0.12) * (0.6 + 3.5 * l), bare);
    dc = mix(dc, lf * 0.74, leaf);
    dc = mix(dc, dc * vec3(1.5, 1.05, 0.6), reed * clamp(envFall + envBare, 0.0, 1.0));
    if (envSnow > 0.001) {
      float up = smoothstep(0.3, 0.75, normalize(vEnvN).y);
      dc = mix(dc, envSnowCol(vEnvW.xz), envSnowAt(vEnvW.xz, 0.1) * up * 0.9);
    }
    diffuseColor.rgb = envGrade(dc);
  }`);
  };
  mat.customProgramCacheKey = () => "land-props-v1";
  return mat;
}

export class LandProps {
  readonly group = new THREE.Group();
  private grow = { value: 1 };
  private mat = landMaterial(this.grow);
  private chunks = new Map<string, Chunk>();
  private frame = 0;
  private stamp = -1;
  private lastRefresh = 0;
  /** How long the last chunk took to set out (ms). */
  lastBuildMs = 0;
  /** Whether a chunk in view is still to be set out. */
  due = false;

  constructor(
    private props: Map<string, MergedModel>, private terrain: Terrain, private forest: Forest, private enc: Enclosures,
    /** whether a point lies in a town's ground, and a number that changes when the towns do */
    private town?: { townAt(x: number, y: number): number; stamp: number },
  ) {}

  /** Something was built or cleared inside these rectangles (null: anywhere): what stands there is set out again. */
  invalidate(rects: { x0: number; y0: number; x1: number; y1: number }[] | null) {
    const S = CHS * RES;
    for (const c of this.chunks.values()) {
      const x0 = c.ci * S - 8, y0 = c.cj * S - 8, x1 = x0 + S + 16, y1 = y0 + S + 16;
      if (!rects || rects.some((r) => r.x1 > x0 && r.x0 < x1 && r.y1 > y0 && r.y0 < y1)) c.stale = true;
    }
  }

  /**
   * Call every frame. `mayBuild`: whether this frame has time left to set a chunk out (the ground's own building
   * comes first: a chunk of ground and a chunk of hedges are never both made in one frame).
   */
  update(view: { mpp: number; cx: number; cy: number; bounds(): { x0: number; y0: number; x1: number; y1: number } }, mayBuild = true) {
    this.frame++;
    const mpp = view.mpp;
    this.group.visible = mpp < LAND_PROPS_SEE && this.props.size > 0;
    this.due = false;
    if (!this.group.visible) return;
    this.grow.value = 1 - Math.min(1, Math.max(0, (mpp - SINK_FROM) / (LAND_PROPS_SEE - SINK_FROM))) ** 2;
    // (the hay stands in the meadows from the mowing: the cocks until they are carted, the stacks through the winter)
    const dry = ENV.uSeasonA.value.z, fall = ENV.uSeasonA.value.w, bare = ENV.uSeasonB.value.x;
    const stacks = dry > 0.45 || fall > 0.15 || bare > 0.15, cocks = dry > 0.45 && fall < 0.45;
    const lod = mpp > FAR_FROM ? 1 : 0;
    if (this.town && this.town.stamp !== this.stamp) { this.stamp = this.town.stamp; this.invalidate(null); }
    const S = CHS * RES, { x0, y0, x1, y1 } = view.bounds();
    let want: { ci: number; cj: number; d: number } | null = null, stale: Chunk | null = null;
    for (let cj = Math.floor(y0 / S); cj <= Math.floor(y1 / S); cj++) {
      for (let ci = Math.floor(x0 / S); ci <= Math.floor(x1 / S); ci++) {
        const c = this.chunks.get(`${ci},${cj}`);
        if (c) {
          c.used = this.frame;
          for (const m of c.meshes) {
            m.visible = m.name === "land_haystack" ? stacks : m.name === "haycock" ? cocks : m.name === "land_gate" ? mpp < GATE_SEE : true;
            m.geometry = (m.userData.geos as Geos)[lod];
            // (far, a hedge's shadow is the one the ground paints along it: only a haystack still throws its own)
            m.castShadow = m.name === "land_haystack" || (lod === 0 && m.name !== "land_reeds" && m.name !== "haycock");
          }
          if (c.stale) stale = c;
          continue;
        }
        const d = Math.hypot((ci + 0.5) * S - view.cx, (cj + 0.5) * S - view.cy);
        if (!want || d < want.d) want = { ci, cj, d };
      }
    }
    for (const c of this.chunks.values()) if (c.used !== this.frame) for (const m of c.meshes) m.visible = false;
    // one chunk a frame: a missing one first; one grown stale now and then (a town adds a house every few seconds)
    const now = performance.now();
    this.due = !!want && !mayBuild;
    if (!mayBuild) return;
    if (want) { this.build(want.ci, want.cj); this.due = true; }
    else if (stale && now - this.lastRefresh > 120) { this.lastRefresh = now; this.build(stale.ci, stale.cj); }
    if (this.chunks.size > KEEP) {
      const old = [...this.chunks.entries()].filter(([, c]) => c.used !== this.frame).sort((a, b) => a[1].used - b[1].used);
      for (const [k, c] of old.slice(0, this.chunks.size - KEEP)) { this.drop(c); this.chunks.delete(k); }
    }
  }

  private build(ci: number, cj: number) {
    const t0 = performance.now(), key = `${ci},${cj}`;
    const old = this.chunks.get(key);
    if (old) this.drop(old);
    const town = this.town;
    const placed = placeLand(ci, cj, this.terrain, this.enc, (x, y, r) => this.forest.cleared(x, y, r) || (!!town && town.townAt(x, y) > 0.2));
    const meshes: THREE.InstancedMesh[] = [];
    for (const kind of KINDS) {
      const list = placed[kind], name = MODEL[kind] ?? kind, mm = this.props.get(name);
      if (!mm || !list.length) continue;
      const mesh = new THREE.InstancedMesh(mm.geo, this.mat, list.length);
      mesh.userData.geos = [mm.geo, (HAS_FAR.has(name) && this.props.get(name + "_far")?.geo) || mm.geo] satisfies Geos;
      list.forEach((m, i) => mesh.setMatrixAt(i, m));
      mesh.instanceMatrix.needsUpdate = true;
      mesh.name = kind;
      mesh.frustumCulled = false;
      mesh.castShadow = kind !== "land_reeds" && kind !== "haycock";
      mesh.receiveShadow = true;
      meshes.push(mesh);
      this.group.add(mesh);
    }
    this.chunks.set(key, { meshes, used: this.frame, stale: false, ci, cj });
    this.lastBuildMs = performance.now() - t0;
  }

  private drop(c: Chunk) {
    for (const m of c.meshes) { this.group.remove(m); m.dispose(); }
  }

  dispose() {
    for (const c of this.chunks.values()) this.drop(c);
    this.chunks.clear();
    this.mat.dispose();
  }
}
