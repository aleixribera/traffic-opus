import * as THREE from "three";
import { LANE_W, ROAD_TYPES, SHOULDER, SIDEWALK, STREET_TREES, isHighway, isUnpaved, roadGroup, roadWidth } from "../config";
import { add, clamp, dist, dot, norm, polyAt, polyClosest, polyDir, right, scale, smoothstep, sub, type Polyline, type V2 } from "../core/math";
import { pocketZones, type ChangeSet, type RoadNetwork } from "../roads/network";
import { ringsNear } from "../roads/planner";
import { goreIslands } from "./gore";
import { dkey } from "../sim/router";
import type { Traffic } from "../sim/traffic";
import { PAL } from "./palette";
import { MeshBatch } from "./batch";
import { ENV, ENV_GLSL, seasonal } from "./envShader";
import type { MergedModel } from "./models";
import type { LampSpot } from "./lamps3d";

const LIFT = 0.06;
const DECK = 0.9;
/** Where a point at height h casts its shadow, per metre of height (the sun in View: up-left, so down-right). */
const SUN_OFF = { x: 0.42, y: 0.62 };
/** The bridge pieces (tools/blender/build_models.py) are built for a 10 m deck; piers and abutments reach the
 * underside of a 6 m deck (5.1 m). */
const PIECE_W = 10, PIECE_H = 5.1;

/** What the road renderer needs from outside for bridges: the Blender bridge pieces, and where the water is. */
/** Grid (m) the driveways are bucketed in when placing street trees. */
const DRIVE_CELL = 16;
/** Street lamps along a town road: how far apart (m), where the rhythm starts (between the street trees), and
 * whether they stand in facing pairs or one side and the other in turn. */
const LAMP_EVERY: Record<string, { every: number; phase: number; both: boolean } | undefined> = {
  small: { every: 32, phase: 0, both: false },
  medium: { every: 15, phase: 7.5, both: false },
  large: { every: 24, phase: 6, both: true },
};

export interface BridgeParts {
  props: Map<string, MergedModel>;
  isWater?: (p: V2) => boolean;
  /** Where driveways meet the kerb (homes, shops, halls): no street tree stands in front of one. */
  drives?: () => V2[];
  /** Company sites' gates (and the way into each site): a street that ends just outside one runs into its yard. */
  gates?: () => { gate: V2; into: V2; front?: V2 }[];
}

/** A site's yard concrete (Buildings3D's service roads), carried out of its gate to the street that reaches it. */
const GATE_APRON = 0x85847c;

/** Shared road surface material: Lambert (so it takes shadows) with markings drawn in the fragment shader. */
export function makeRoadMaterial(opts: { color?: number; opacity?: number; markings?: boolean; arrows?: boolean; highway?: boolean } = {}) {
  const hw = !!opts.highway;
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: (opts.opacity ?? 1) < 1, opacity: opts.opacity ?? 1 });
  const uniforms = {
    uRoad: { value: new THREE.Color(opts.color ?? (hw ? PAL.hwRoad : PAL.road)) },
    uEdge: { value: new THREE.Color(hw ? PAL.hwEdge : PAL.roadEdge) },
    uLane: { value: new THREE.Color(hw ? PAL.hwLane : PAL.lane) },
    uHw: { value: hw ? 1 : 0 },
    uCentre: { value: new THREE.Color(PAL.centre) },
    uGrass: { value: new THREE.Color(PAL.grass) },
    uTree: { value: new THREE.Color(PAL.tree) },
    uTreeLight: { value: new THREE.Color(PAL.treeLight) },
    uFlowMode: { value: 0 },
    uMarkings: { value: opts.markings === false ? 0 : 1 },
    uArrows: { value: opts.arrows === false ? 0 : 1 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms, ENV);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec4 aRoad;\nattribute vec2 aFlow;\nattribute vec3 aMed;\nattribute vec2 aClip;\nattribute vec4 aPock;\nvarying vec4 vRoad;\nvarying vec2 vFlow;\nvarying vec3 vMed;\nvarying vec2 vClip;\nvarying vec4 vPock;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvRoad = aRoad;\nvFlow = aFlow;\nvMed = aMed;\nvClip = aClip;\nvPock = aPock;");
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uRoad; uniform vec3 uEdge; uniform vec3 uLane; uniform vec3 uCentre;
${ENV_GLSL}
uniform vec3 uGrass; uniform vec3 uTree; uniform vec3 uTreeLight;
uniform float uFlowMode; uniform float uMarkings; uniform float uArrows; uniform float uHw;
varying vec4 vRoad; varying vec2 vFlow; varying vec3 vMed; varying vec2 vClip; varying vec4 vPock;
float band(float x, float w) { float f = fwidth(x) * 0.8 + 1e-4; return 1.0 - smoothstep(w - f, w + f, abs(x)); }
// a turn pocket's line: dashed while it opens out, solid where it's a lane of its own
float pockLine(float x, float p, float dash) { return p < 0.01 ? 0.0 : band(x, 0.1) * (p > 0.98 ? 1.0 : dash); }
vec3 flowTint(float r) {
  float k = clamp((0.92 - r) / 0.6, 0.0, 1.0);
  return mix(vec3(1.0), mix(vec3(1.0, 0.62, 0.28), vec3(0.86, 0.13, 0.16), smoothstep(0.35, 1.0, k)), smoothstep(0.0, 0.25, k));
}
`,
      )
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float u = vRoad.x, v = vRoad.y, f = vRoad.z, b = vRoad.w;
  vec3 c = uRoad;
  if (f >= 0.0 && uMarkings > 0.5) {
    float LW = ${LANE_W.toFixed(2)};
    float med = vMed.x * 0.5; // half the median: both directions start this far out
    float halfW = (f + b) * LW * 0.5 + ${SHOULDER.toFixed(2)} + med;
    // where a taper pulls the surface in on this side, the edge band and line follow it in
    // (by the distance in from each side's own edge: a deep taper pulls one edge right past the centreline)
    float deR = halfW - vClip.y - u, deL = u + halfW - vClip.x; // in from the right and left edges
    float de = min(deR, deL);
    float edge = smoothstep(0.42, 0.42 + fwidth(u), de);
    // US lane lines: 3 m dashes with 9 m gaps
    float dash = step(fract(v / 12.0), 0.25);
    float lanes = 0.0;
    // the median's half-width here: it stops short of a junction in a rounded nose (vMed.y: distance to the nearer
    // junction end)
    float dn = vMed.y - 2.2;
    float mh = med <= 0.0 ? 0.0 : dn >= med ? med : (dn <= 0.0 ? 0.0 : sqrt(med * med - (med - dn) * (med - dn)));
    if (b > 0.0) {
      // centre line (US): a dashed yellow line on 1+1 streets, double solid yellow on wider two-way roads; on a divided
      // road a solid yellow line down each side of the median, closing to a double yellow past its nose
      if (med <= 0.0) {
        if (max(f, b) < 1.5) c = mix(c, uCentre, band(u, 0.08) * dash);
        else c = mix(c, uCentre, band(abs(u) - 0.2, 0.08));
      } else c = mix(c, uCentre, band(abs(u) - mh - 0.32, 0.08));
      // turn pockets (vPock: how open the left and right pockets are, this side then the other): a left one opens
      // on the inside and the through lanes move out for it; a right one opens outside them
      float fi = med + vPock.x * LW, bi = med + vPock.z * LW;
      for (int k = 1; k < 4; k++) {
        float fk = float(k);
        if (fk < f) lanes = max(lanes, band(u - fi - fk * LW, 0.08) * dash);
        if (fk < b) lanes = max(lanes, band(u + bi + fk * LW, 0.08) * dash);
      }
      lanes = max(lanes, pockLine(u - fi, vPock.x, dash));
      lanes = max(lanes, pockLine(u - fi - f * LW, vPock.y, dash));
      lanes = max(lanes, pockLine(u + bi, vPock.z, dash));
      lanes = max(lanes, pockLine(u + bi + b * LW, vPock.w, dash));
    } else {
      float o0 = -f * 0.5 * LW + vPock.x * LW;
      for (int k = 1; k < 4; k++) {
        float fk = float(k);
        if (fk < f) lanes = max(lanes, band(u - (o0 + fk * LW), 0.08) * dash);
      }
      lanes = max(lanes, pockLine(u - o0, vPock.x, dash));
      lanes = max(lanes, pockLine(u - o0 - f * LW, vPock.y, dash));
      // one-way: chevrons down each lane, pointing the way traffic goes
      float y = mod(v, 22.0) - 11.0;
      for (int k = 0; k < 4; k++) {
        float fk = float(k);
        if (fk >= f || uArrows < 0.5) break;
        float x = u - (o0 + (fk + 0.5) * LW);
        float ax = abs(x);
        float m = (1.0 - smoothstep(0.95, 1.05, ax));
        lanes = max(lanes, band(y + ax * 0.9 - 0.6, 0.22) * m);
        lanes = max(lanes, band(y + ax * 0.9 + 0.5, 0.22) * m);
      }
    }
    // highways (US freeway): a solid white line along the right edge and a yellow one along the left, just inside the
    // shoulders
    float yl = 0.0;
    if (uHw > 0.5) {
      lanes = max(lanes, band(deR - ${SHOULDER.toFixed(2)} - 0.05, 0.1));
      yl = band(deL - ${SHOULDER.toFixed(2)} - 0.05, 0.1);
    }
    c = mix(c, uLane, lanes);
    c = mix(c, uCentre, yl);
    if (uFlowMode > 0.5) {
      float r = (b > 0.0 && u < 0.0) ? vFlow.y : vFlow.x;
      // dark asphalt: tint by mixing rather than multiplying, so the colour reads; free-flowing roads stay as they are
      vec3 t = flowTint(r);
      c = mix(c, t * 0.82, (1.0 - smoothstep(0.97, 1.0, min(t.g, t.b))) * 0.8);
    }
    if (med > 0.0) {
      // planted median: a kerb either side, grass between, and a row of trees when it is wide enough
      float au = abs(u), fw = fwidth(u) + 1e-4;
      float inMed = 1.0 - smoothstep(mh - fw, mh, au);
      // (the grass in the season's colour, under snow in winter)
      vec3 gr = mix(envGrass(uGrass), envSnowCol(vec2(u, v)), envSnowAt(vec2(u * 3.0, v), -0.3));
      vec3 mc = mix(uEdge, gr, 1.0 - smoothstep(mh - 0.32 - fw, mh - 0.32, au));
      // trees keep clear of the piece ends (vMed.z) so a crown is never cut in half at a join
      if (med > 1.4 && dn > med + 2.0 && vMed.z > 2.6) {
        float y = mod(v, 12.0) - 6.0;
        float rr = min(med - 0.25, 2.4);
        float d = length(vec2(u, y));
        float crown = 1.0 - smoothstep(rr - fwidth(d) - 0.04, rr, d);
        float lit = 1.0 - smoothstep(0.0, rr * 1.3, length(vec2(u + rr * 0.35, y + rr * 0.35)));
        vec4 lf = envLeaf(mix(uTree, uTreeLight, lit), fract(floor(v / 12.0) * 0.618), fract(floor(v / 12.0) * 0.377 + 0.25), vec2(u, y) / rr, lit, 0.0);
        mc = mix(mc, lf.rgb, crown * lf.a);
      }
      c = mix(c, mc, inMed);
    }
    c = mix(uEdge, c, edge);
    // winter: the ploughs keep the lanes black; what they push aside lies in a grey-white bank along the kerbs
    if (envSnow > 0.001) {
      float bw = 0.35 + 0.75 * envNoise(vec2(v * 0.21, u > 0.0 ? 3.0 : 9.0)) * envSnow;
      float bank = (1.0 - smoothstep(bw * 0.6, bw, de)) * smoothstep(0.1, 0.5, envSnow);
      c = mix(c, envSnowCol(vec2(u * 4.0, v)) * 0.86, bank * 0.9);
    }
  }
  diffuseColor.rgb = envGrade(diffuseColor.rgb * c);
}`,
      );
  };
  return { mat, uniforms };
}

/** How far a dirt road's worn edge spills out into the grass either side (m). */
const DIRT_FRINGE = 1.15;
/** The fringe sits just under every road surface, so wherever a road or junction covers it, the road wins. */
const FRINGE_DROP = 0.008;

// world-space value noise for the dirt: one hash (stable at large coordinates), smoothed
const DIRT_NOISE = `
float dHash(vec2 p) { vec3 q = fract(vec3(p.xyx) * 0.1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
float dNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(dHash(i), dHash(i + vec2(1.0, 0.0)), f.x), mix(dHash(i + vec2(0.0, 1.0)), dHash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// packed earth in soft patches, with gravel: small round stones, most pale, a few dark, one at most per 0.4 m cell
vec3 dirtBase(vec2 w) {
  float n = dNoise(w * 0.16) * 0.55 + dNoise(w * 0.72) * 0.3 + dNoise(w * 2.4) * 0.15;
  vec3 c = mix(uDirt * 0.95, uDirtLight, smoothstep(0.3, 0.78, n));
  vec2 q = w * 2.5, cell = floor(q);
  float g = dHash(cell);
  // (the derivative is taken outside the branch: it is undefined where neighbouring pixels branch apart)
  float aa = fwidth(q.x) * 0.7 + 1e-4;
  if (g > 0.72 || g < 0.06) {
    vec2 o = vec2(dHash(cell + 17.0), dHash(cell + 41.0)) * 0.6 + 0.2;
    float d = length(fract(q) - o), r = 0.09 + 0.08 * dHash(cell + 7.0);
    float stone = 1.0 - smoothstep(r - aa, r + aa, d);
    c = mix(c, g > 0.5 ? uDirtLight * 1.08 : uDirtRut * 0.85, stone * 0.6);
  }
  return c;
}
`;

/**
 * A dirt road's surface (opaque) or its worn edge (`fringe`: see below), both procedural: packed earth and gravel in
 * world space, so pieces, bends and junctions run into each other without a seam. On the road itself, two pairs of
 * darker wheel ruts (one per lane, where the wheels run) that wander a little, and a paler crown between them; no
 * markings. The fringe (aFr: 0 at the road's edge, 1 out in the grass) fades the earth out with a ragged edge.
 */
function makeDirtMaterial(fringe = false) {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: fringe, depthWrite: !fringe });
  const uniforms = {
    uDirt: { value: new THREE.Color(PAL.dirt) },
    uDirtLight: { value: new THREE.Color(PAL.dirtLight) },
    uDirtRut: { value: new THREE.Color(PAL.dirtRut) },
    uDirtEdge: { value: new THREE.Color(PAL.dirtEdge) },
    uFlowMode: { value: 0 },
  };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uniforms);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec2 vDW;\n${fringe ? "attribute float aFr;\nvarying float vFr;" : "attribute vec4 aRoad;\nattribute vec2 aFlow;\nattribute vec3 aMed;\nvarying vec4 vRoad;\nvarying vec2 vFlow;\nvarying float vEnd;"}`)
      .replace("#include <begin_vertex>", `#include <begin_vertex>\nvDW = (modelMatrix * vec4(transformed, 1.0)).xz;\n${fringe ? "vFr = aFr;" : "vRoad = aRoad;\nvFlow = aFlow;\nvEnd = aMed.z;"}`);
    sh.fragmentShader = sh.fragmentShader
      .replace(
        "#include <common>",
        `#include <common>
uniform vec3 uDirt; uniform vec3 uDirtLight; uniform vec3 uDirtRut; uniform vec3 uDirtEdge; uniform float uFlowMode;
varying vec2 vDW;
${fringe ? "varying float vFr;" : "varying vec4 vRoad; varying vec2 vFlow; varying float vEnd;"}
${DIRT_NOISE}
vec3 flowTint(float r) {
  float k = clamp((0.92 - r) / 0.6, 0.0, 1.0);
  return mix(vec3(1.0), mix(vec3(1.0, 0.62, 0.28), vec3(0.86, 0.13, 0.16), smoothstep(0.35, 1.0, k)), smoothstep(0.0, 0.25, k));
}
`,
      )
      .replace(
        "#include <color_fragment>",
        fringe
          ? `#include <color_fragment>
{
  // ragged: the earth gives out a little further in places, and stray patches reach on into the grass
  float t = vFr + (dNoise(vDW * 0.85) - 0.5) * 0.6 + (dNoise(vDW * 3.3) - 0.5) * 0.28;
  float a = 1.0 - smoothstep(0.28, 0.78, t);
  if (a < 0.01) discard;
  vec3 c = mix(dirtBase(vDW), uDirtEdge, clamp(vFr * 0.9, 0.0, 1.0));
  diffuseColor.rgb *= c;
  diffuseColor.a *= a;
}`
          : `#include <color_fragment>
{
  float u = vRoad.x, f = vRoad.z;
  vec3 c = dirtBase(vDW);
  if (f >= 0.0) {
    // the wheel ruts: one pair down the middle, where everything drives with nothing coming the other way (a 1.6 m
    // track), and the fainter tracks of each lane (centred ${(LANE_W / 2).toFixed(2)} m out) for when two meet; all
    // wandering together a little, and fading out over the last few metres into a junction or turning circle (vEnd:
    // how far off one is)
    float uu = u + (dNoise(vDW * 0.045) - 0.5) * 0.6;
    float au = abs(uu);
    // (squares, not pow(): pow of a negative base is undefined in GLSL and NaN on some drivers)
    float r0 = (au - 0.8) / 0.3, r1 = (au - ${(LANE_W / 2 - 0.8).toFixed(2)}) / 0.3, r2 = (au - ${(LANE_W / 2 + 0.8).toFixed(2)}) / 0.32;
    float rutMain = exp(-r0 * r0);
    float lane = exp(-r1 * r1) * 0.5 + exp(-r2 * r2);
    float wear = (0.7 + 0.6 * dNoise(vDW * 0.9)) * smoothstep(0.5, 7.0, vEnd);
    c = mix(c, uDirtLight * 1.03, (1.0 - smoothstep(0.2, 0.5, au)) * 0.3 * wear);
    c = mix(c, uDirtRut, clamp((rutMain * 0.62 + lane * 0.22) * wear, 0.0, 0.8));
  }
  if (uFlowMode > 0.5) {
    float r = (vRoad.w > 0.0 && u < 0.0) ? vFlow.y : vFlow.x;
    vec3 t = flowTint(r);
    c = mix(c, t * 0.82, (1.0 - smoothstep(0.97, 1.0, min(t.g, t.b))) * 0.8);
  }
  diffuseColor.rgb *= c;
}`,
      );
  };
  return { mat, uniforms };
}

/**
 * A dirt road's worn edge: a band from a line (lateral offsets `off` from `pts`, or the line itself) out by
 * DIRT_FRINGE on one side, aFr running 0 -> 1 across it. null if too short.
 */
function fringeGeo(pts: V2[], hs: number[] | number, off: number[] | null, side: 1 | -1): THREE.BufferGeometry | null {
  if (pts.length < 2) return null;
  const pos: number[] = [], fr: number[] = [], idx: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    const r = lateralAt(pts, i), o = off ? off[i] : 0, y = (typeof hs === "number" ? hs : hs[i]) + LIFT - FRINGE_DROP;
    const b = pos.length / 3;
    for (const [d, k] of [[0, 0], [DIRT_FRINGE, 1]] as const) {
      const u = o + side * d;
      pos.push(pts[i].x + r.x * u, y, pts[i].y + r.y * u);
      fr.push(k);
    }
    if (i > 0 && dist(pts[i], pts[i - 1]) > 1e-4) idx.push(b - 2, b, b - 1, b - 1, b, b + 1);
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(pos.map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("aFr", new THREE.Float32BufferAttribute(fr, 1));
  g.setIndex(idx);
  fixUpWinding(g);
  g.computeBoundingSphere();
  return g;
}

interface SegMeshes {
  surface: THREE.Mesh;
  extra: THREE.Object3D[];
}

/**
 * Trees as seen from above: flat round crowns, a darker rim and a lit side, each throwing a soft shadow; one instanced
 * quad (twice the crown across) per tree, scaled to its crown. Street trees, and the trees on town squares.
 */
export function makeTreeMesh(n: number): THREE.InstancedMesh {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff, transparent: true, depthWrite: false });
  const uni = { uTree: { value: new THREE.Color(PAL.tree) }, uTreeLight: { value: new THREE.Color(PAL.treeLight) } };
  mat.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, uni, ENV);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vTq; varying vec2 vTseed;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvTq = position.xz * 2.0;\nvTseed = instanceMatrix[3].xz;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${ENV_GLSL}\nuniform vec3 uTree; uniform vec3 uTreeLight;\nvarying vec2 vTq; varying vec2 vTseed;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  // a round crown lit from the sun's side, and its soft shadow thrown away from the sun on the ground (as long and
  // as strong as the light makes it, render/daylight.ts)
  float d = length(vTq);
  float aa = fwidth(d) + 1e-4;
  float crown = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, d);
  float tone = envHash(vTseed * 0.71 + 3.1), h = envHash(vTseed * 0.37 + 9.2);
  float thin = 1.0 - 0.6 * envBare * step(0.2, h);
  float shadow = (1.0 - smoothstep(0.7, 1.15, length(vTq + uSun * 0.85 * uShade.y))) * 0.45 * uShade.x * thin;
  if (crown <= 0.0 && shadow <= 0.01) discard;
  float lit = 1.0 - smoothstep(0.0, 1.3, length(vTq - uSun * 0.5));
  vec3 c = mix(uTree * 0.8, uTreeLight, lit);
  c *= mix(1.0, 0.82, smoothstep(0.78, 0.98, d));
  // the season's crown (street trees: a fifth of them evergreen)
  vec4 lf = envLeaf(c, tone, h, vTq, lit, 0.2);
  float ac = crown * lf.a;
  float a = ac + shadow * (1.0 - ac);
  diffuseColor.rgb = envGrade(diffuseColor.rgb * lf.rgb * ac / max(a, 1e-3));
  diffuseColor.a = a;
}`,
      );
  };
  mat.customProgramCacheKey = () => "tree-v2";
  // twice the crown's size, so the shadow beside it fits on the same quad
  const m = new THREE.InstancedMesh(new THREE.PlaneGeometry(2, 2).rotateX(-Math.PI / 2), mat, Math.max(1, n));
  m.count = 0;
  m.frustumCulled = false; // spread over the whole map; bounds would go stale
  m.receiveShadow = true;
  return m;
}

export class Roads3D {
  readonly group = new THREE.Group();
  private segs = new Map<number, SegMeshes>();
  private nodes = new Map<number, THREE.Object3D[]>();
  private bendFlow = new Map<number, { surface: THREE.Mesh; k1: number; k2: number }>(); // bend node -> overlay tint source
  /** every road and junction mesh, drawn merged by material a square of map at a time */
  private batch = new MeshBatch();
  readonly surface = makeRoadMaterial();
  private ringSurface = makeRoadMaterial({ arrows: false }); // roundabout arcs and bends: direction is obvious, chevrons only clip at the joins
  private plain = makeRoadMaterial({ markings: false });
  private hwSurface = makeRoadMaterial({ highway: true });
  private hwRing = makeRoadMaterial({ highway: true, arrows: false });
  private hwPlain = makeRoadMaterial({ highway: true, markings: false });
  private dirt = makeDirtMaterial();
  private dirtFringe = makeDirtMaterial(true);
  private edgeMat = new THREE.MeshLambertMaterial({ color: PAL.roadEdge });
  // (pavements: swept, so less snow on them than on the verges)
  private walkMat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { shelter: 0.45 });
  private apronMat = new THREE.MeshLambertMaterial({ color: GATE_APRON });
  /** Dead ends drawn as a site gate's apron instead of a turning bulb, as last built. */
  private gateEnds = new Set<number>();
  private gateList: { gate: V2; into: V2; front?: V2 }[] | null = null;
  private seamHw = seamMaterial(PAL.hwRoad, PAL.hwLane);
  private seamTown = seamMaterial(PAL.road, PAL.lane);
  // street trees: flat round crowns, darker rim and a lit side, one instanced mesh for the whole map
  private trees: THREE.InstancedMesh;
  private treeSpots = new Map<number, { x: number; y: number; h: number; r: number }[]>();
  /** Street lamps by seg (before the driveway check), and all of them as the lamps layer takes them. */
  private lampSpots = new Map<number, LampSpot[]>();
  lamps: LampSpot[] = [];
  /** Counts up whenever the lamps change. */
  lampVersion = 0;
  private hwEdgeMat = new THREE.MeshLambertMaterial({ color: PAL.hwEdge });
  /** Every marked surface material, so overlay modes reach all of them. */
  private get marked() { return [this.surface, this.ringSurface, this.hwSurface, this.hwRing, this.dirt]; }
  /** Pavement width round a junction or bend: the narrowest of its paved roads', none if any road there has none
   * (a dirt road has none of its own, but a street meeting it keeps its pavement round the corner). */
  private nodeWalk(id: number): number {
    const at = this.net.segsAt(id);
    if (!at.length || at.some((sg) => sg.ring)) return 0;
    const paved = at.filter((sg) => !isUnpaved(ROAD_TYPES[sg.type]));
    if (!paved.length) return 0;
    return Math.min(...paved.map((sg) => SIDEWALK[roadGroup(ROAD_TYPES[sg.type])]));
  }
  /** Is every road meeting this node a dirt road (so its junction, bend or turning circle is earth too)? */
  private dirtNode(id: number): boolean {
    const at = this.net.segsAt(id);
    return at.length > 0 && at.every((sg) => !sg.ring && isUnpaved(ROAD_TYPES[sg.type]));
  }
  /** The worn edge along a line, as a mesh (none if too short). */
  private fringe(pts: V2[], hs: number[] | number, off: number[] | null, side: 1 | -1): THREE.Mesh | null {
    const g = fringeGeo(pts, hs, off, side);
    if (!g) return null;
    const m = new THREE.Mesh(g, this.dirtFringe.mat);
    m.receiveShadow = true;
    return m;
  }
  /** Is every road meeting this node a highway (so its junction or bend is drawn in highway asphalt)? */
  private hwNode(id: number): boolean {
    const at = this.net.segsAt(id);
    return at.length > 0 && at.every((sg) => isHighway(ROAD_TYPES[sg.type]));
  }
  // the deck body casts the bridge's shadow from both faces (three's default only draws back faces into the shadow map)
  private deckMat = new THREE.MeshLambertMaterial({ color: PAL.deckSide, shadowSide: THREE.DoubleSide });
  // bridges: cream concrete parapets along a raised road's edges, the Blender piers, abutments, pylons and truss
  // panels, and a soft drop shadow on the ground or water down-right of the deck
  private parapetMat = new THREE.MeshLambertMaterial({ color: PAL.parapet });
  private pieceMat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private dropMat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, side: THREE.DoubleSide, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
  // signal heads drawn as coloured dots at the stop line
  private lights: THREE.InstancedMesh;
  private lightRefs: { node: number; arm: number; turns: string[]; x: number; y: number; h: number }[] = [];
  // turn arrows painted on the lanes coming into a junction
  private arrowMat = new THREE.MeshLambertMaterial({ color: PAL.lane, side: THREE.DoubleSide });
  // stop signs: a red octagon at the kerb (white rim)
  private stopMat = new THREE.MeshBasicMaterial({ color: 0xd9302c });
  private stopRim = new THREE.MeshBasicMaterial({ color: 0xffffff });
  private stopGeo = new THREE.CircleGeometry(0.85, 8, Math.PI / 8).rotateX(-Math.PI / 2);
  private stopRimGeo = new THREE.CircleGeometry(1.08, 8, Math.PI / 8).rotateX(-Math.PI / 2);
  // grass islands inside roundabouts
  private islands = new THREE.Group();
  private islandMat = seasonal(new THREE.MeshLambertMaterial({ color: PAL.grass }));

  constructor(private net: RoadNetwork, private parts?: BridgeParts) {
    this.lights = new THREE.InstancedMesh(new THREE.CircleGeometry(0.85, 16).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xffffff }), 256);
    this.lights.count = 0;
    this.lights.renderOrder = 3;
    this.lights.frustumCulled = false; // instances move around the whole map; bounds would go stale
    this.trees = makeTreeMesh(0);
    this.group.add(this.lights, this.islands, this.trees, this.batch.group);
  }

  private show(os: THREE.Object3D[]) {
    for (const o of os) this.batch.add(o as THREE.Mesh);
  }

  /** A street tree stands only where its crown keeps off every other road (a road drawn alongside, a crossing street). */
  private treeClear(own: number, t: { x: number; y: number; r: number }, drives: Map<number, V2[]>): boolean {
    // (a driveway 3.4 m wide comes out to the kerb here)
    const cx = Math.floor(t.x / DRIVE_CELL), cy = Math.floor(t.y / DRIVE_CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
      for (const d of drives.get((cx + i) * 73856 + (cy + j)) ?? []) if (Math.hypot(d.x - t.x, d.y - t.y) < t.r + 2.6) return false;
    }
    const reach = t.r + 12;
    for (const id of this.net.segsNear(t.x - reach, t.y - reach, t.x + reach, t.y + reach)) {
      if (id === own) continue;
      const s = this.net.segs.get(id), g = this.net.segGeom.get(id);
      if (!s || !g) continue;
      if (polyClosest(g.center, t).d < roadWidth(ROAD_TYPES[s.type]) / 2 + t.r * 0.8) return false;
    }
    return true;
  }

  /** Gather every seg's street trees into the one instanced mesh. */
  private collectTrees() {
    let n = 0;
    for (const t of this.treeSpots.values()) n += t.length;
    if (n > this.trees.instanceMatrix.count) {
      this.group.remove(this.trees);
      this.trees.geometry.dispose();
      (this.trees.material as THREE.Material).dispose();
      this.trees.dispose();
      this.trees = makeTreeMesh(Math.ceil(n * 1.5) + 64);
      this.group.add(this.trees);
    }
    const drives = new Map<number, V2[]>();
    for (const d of this.parts?.drives?.() ?? []) {
      const k = Math.floor(d.x / DRIVE_CELL) * 73856 + Math.floor(d.y / DRIVE_CELL);
      const L = drives.get(k);
      if (L) L.push(d); else drives.set(k, [d]);
    }
    let i = 0;
    for (const [sid, spots] of this.treeSpots) {
      for (const t of spots) {
        if (!this.treeClear(sid, t, drives)) continue;
        // (a hair apart in height so crowns that touch never flicker)
        this.tmpM.makeScale(t.r * 2, 1, t.r * 2).setPosition(t.x, t.h + LIFT + 0.03 + (i % 8) * 0.0005, t.y);
        this.trees.setMatrixAt(i++, this.tmpM);
      }
    }
    this.trees.count = i;
    this.trees.instanceMatrix.needsUpdate = true;
    // the lamps: clear of driveways and of other roads, like the trees
    this.lamps = [];
    for (const [sid, spots] of this.lampSpots) {
      for (const l of spots) if (this.treeClear(sid, { x: l.x, y: l.y, r: 0.6 }, drives)) this.lamps.push(l);
    }
    this.lampVersion++;
  }

  set flowMode(on: boolean) {
    for (const m of this.marked) m.uniforms.uFlowMode.value = on ? 1 : 0;
  }

  /** The signal heads (one instance each, coloured by its state): the lamps layer gives them a halo at night. */
  get signalHeads(): THREE.InstancedMesh {
    return this.lights;
  }

  /** Re-place the street trees round the driveways (after buildings come and go). */
  refreshTrees() {
    this.collectTrees();
  }

  /**
   * Redraw the dead ends whose site came or went (after buildings change): the street a site is placed with is
   * built just before the site itself, so its end is first drawn as a turning bulb.
   */
  refreshGates() {
    this.gateList = null;
    let changed = false;
    for (const [id, ng] of this.net.nodeGeom) {
      if (ng.kind !== "end" && !this.gateEnds.has(id)) continue;
      if (!!this.gateAt(id) === this.gateEnds.has(id)) continue;
      this.dropNode(id);
      if (this.net.nodes.has(id)) this.buildNode(id);
      changed = true;
    }
    if (changed) this.batch.flush();
  }

  /** The site gate a dead end runs straight into (the street laid out of a site's gate ends just outside it). */
  private gateAt(id: number): { gate: V2; into: V2; front?: V2 } | null {
    const ng = this.net.nodeGeom.get(id), n = this.net.nodes.get(id);
    if (!ng || !n || ng.kind !== "end" || ng.arms.length !== 1 || n.h > 0.3) return null;
    const A = ng.arms[0];
    this.gateList ??= this.parts?.gates?.() ?? [];
    for (const g of this.gateList) {
      const d = sub(g.gate, n.p), L = Math.hypot(d.x, d.y);
      if (L < 2 || L > 14) continue;
      // the gate straight ahead of the road's end, and the road leaving it square out of the gate
      if (dot(d, A.dir) / L > -0.9 || dot(g.into, A.dir) > -0.9) continue;
      return g;
    }
    return null;
  }

  /**
   * A street that ends at a site's gate: no turning bulb, but the yard's concrete carried out of the gate to the
   * street, as wide as the street and its pavements where it meets it, narrowing to the yard road at the gate.
   */
  private buildGateApron(id: number, gate: { gate: V2; into: V2; front?: V2 }) {
    const n = this.net.nodes.get(id)!, ng = this.net.nodeGeom.get(id)!;
    const A = ng.arms[0], s = this.net.segs.get(A.seg), g = this.net.segGeom.get(A.seg);
    if (!s || !g) return;
    const walk = SIDEWALK[roadGroup(ROAD_TYPES[s.type])] ?? 0;
    const w0 = A.halfW + walk, w1 = 3.5; // (the yard's spine road is 7 m wide)
    // from a little back along the street (the site's own drive starts ~2 m in from the end) to just inside the gate
    const back = Math.min(2.6, g.center.length * 0.4);
    const f = polyAt(g.center, A.end === "a" ? back : g.center.length - back);
    const r0 = right(scale(A.dir, -1)), r1 = right(gate.into);
    const inner = add(gate.gate, scale(gate.into, 0.6));
    const pts = [
      add(f, scale(r0, -w0)), add(n.p, scale(r0, -w0)), add(gate.gate, scale(r1, -w1)), add(inner, scale(r1, -w1)),
      add(inner, scale(r1, w1)), add(gate.gate, scale(r1, w1)), add(n.p, scale(r0, w0)), add(f, scale(r0, w0)),
    ];
    // (and all of the site's drive strip, which runs from where the site meets the street straight to the gate: where
    // the street comes in on a curve, its corners would show past the apron's sides)
    if (gate.front && dist(gate.front, gate.gate) > 0.6) {
      const rd = right(norm(sub(gate.gate, gate.front)));
      for (const q of [gate.front, gate.gate]) pts.push(add(q, scale(rd, 3.55)), add(q, scale(rd, -3.55)));
    }
    const poly = convexHull(pts);
    const geo = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y))), 1);
    geo.rotateX(Math.PI / 2);
    flipWinding(geo);
    // (just above the site's drive strip, so the yard's concrete is the one that shows)
    geo.translate(0, n.h + 0.085, 0);
    geo.deleteAttribute("uv");
    const m = new THREE.Mesh(geo, this.apronMat);
    m.receiveShadow = true;
    this.gateEnds.add(id);
    this.show([m]);
    this.nodes.set(id, [m]);
  }

  rebuildAll() {
    this.gateList = null;
    for (const id of [...this.segs.keys()]) this.dropSeg(id);
    for (const id of [...this.nodes.keys()]) this.dropNode(id);
    for (const id of this.net.segs.keys()) this.buildSeg(id);
    for (const id of this.net.nodes.keys()) this.buildNode(id);
    this.collectLights();
    this.collectTrees();
    this.buildIslands();
    this.batch.flush();
  }

  apply(cs: ChangeSet) {
    this.gateList = null;
    for (const id of cs.removedSegs) this.dropSeg(id);
    for (const id of cs.removedNodes) this.dropNode(id);
    for (const id of cs.dirtySegs) { this.dropSeg(id); if (this.net.segs.has(id)) this.buildSeg(id); }
    for (const id of cs.dirtyNodes) { this.dropNode(id); if (this.net.nodes.has(id)) this.buildNode(id); }
    this.collectLights();
    this.collectTrees();
    this.buildIslands();
    this.batch.flush();
  }

  private dropSeg(id: number) {
    const m = this.segs.get(id);
    if (!m) return;
    this.batch.remove(m.surface);
    m.surface.geometry.dispose();
    for (const o of m.extra) { this.batch.remove(o as THREE.Mesh); if ((o as THREE.Mesh).geometry && !o.userData.shared) (o as THREE.Mesh).geometry.dispose(); }
    this.segs.delete(id);
    this.treeSpots.delete(id);
    this.lampSpots.delete(id);
  }

  private dropNode(id: number) {
    const os = this.nodes.get(id);
    if (!os) return;
    for (const o of os) {
      this.batch.remove(o as THREE.Mesh);
      const geo = (o as THREE.Mesh).geometry;
      if (geo !== this.stopGeo && geo !== this.stopRimGeo) geo?.dispose(); // (the stop signs share theirs)
    }
    this.nodes.delete(id);
    this.bendFlow.delete(id);
    this.gateEnds.delete(id);
  }

  private buildSeg(id: number) {
    const s = this.net.segs.get(id)!;
    const g = this.net.segGeom.get(id)!;
    const T = ROAD_TYPES[s.type];
    const s0 = g.trimA, s1 = Math.max(g.trimA + 0.3, g.center.length - g.trimB);
    const { pts, hs, ss } = sampleRange(g.center.pts, g.center.cum, g.hs, s0, s1);
    const halfW = g.width / 2;
    // where it meets a junction, the road ends exactly on the junction's mouth, square across it: on a curving road
    // the point a trim's length along the curve is a little off the mouth (and turned from it), and the gap shows
    const lat: Lat = [];
    if (!s.ring) {
      for (const [nid, end, i] of [[s.a, "a", 0], [s.b, "b", pts.length - 1]] as const) {
        const ng = this.net.nodeGeom.get(nid), n = this.net.nodes.get(nid);
        // where the road just carries on into its next piece, both pieces end square across one shared tangent, or
        // on a curve each one's last chord turns its end a little and a wedge of ground opens on the outside
        if (ng?.kind === "cont" && n && ng.arms.length === 2) {
          const me = ng.arms.find((x) => x.seg === id && x.end === end), other = ng.arms.find((x) => x !== me);
          if (!me || !other || this.net.segs.get(other.seg)?.ring) continue;
          const u = norm(sub(me.dir, other.dir)); // along this piece, away from the node
          pts[i] = n.p;
          lat[i] = end === "a" ? right(u) : scale(right(u), -1);
          continue;
        }
        const arm = ng?.kind === "junction" ? ng.arms.find((x) => x.seg === id && x.end === end) : undefined;
        if (!arm || !n) continue;
        const d = arm.mouth?.dir ?? arm.dir;
        pts[i] = arm.mouth?.p ?? add(n.p, scale(arm.dir, arm.trim));
        lat[i] = end === "a" ? right(d) : scale(right(d), -1);
      }
    }
    // tapers: where a slip road or an extra lane opens out of (or closes into) the road it runs beside, the
    // surface starts narrow on that side and widens to full
    const L = g.center.length;
    const clipAt = (sc: number, side: 1 | -1) => {
      let c = 0;
      for (const [e, d] of [[g.ends.a, sc], [g.ends.b, L - sc]] as const) {
        if (!e.clip || e.clipSide !== side) continue;
        const len = Math.max(1, Math.min(e.clipLen, L * 0.45));
        c = Math.max(c, e.clip * (1 - smoothstep(clamp(d / len, 0, 1))));
      }
      return c;
    };
    const clipped = !!(g.ends.a.clip || g.ends.b.clip);
    // turn pockets widen the road on the side of the traffic they serve (fwd: right of a->b)
    const pz = g.ends.a.pocket || g.ends.b.pocket ? pocketZones(s, g) : null;
    const pock = pz ? ss.map((sc) => [pz.fwd.l(sc), pz.fwd.r(sc), pz.bwd.l(sc), pz.bwd.r(sc)]) : undefined;
    const edges = clipped || pock
      ? {
        l: ss.map((sc, i) => -halfW + clipAt(sc, -1) - (pock ? (pock[i][2] + pock[i][3]) * LANE_W : 0)),
        r: ss.map((sc, i) => halfW - clipAt(sc, 1) + (pock ? (pock[i][0] + pock[i][1]) * LANE_W : 0)),
      }
      : undefined;
    // a median ends in a nose at a junction or dead end, but runs straight on into more of the same road
    let medEnd: number[] | undefined;
    if (T.median) {
      const nose = (nid: number) => {
        const ng = this.net.nodeGeom.get(nid);
        if (!ng || (ng.kind !== "cont" && ng.kind !== "bend")) return true;
        const o = ng.arms.find((a) => a.seg !== id) ?? ng.arms.find((a) => a.seg === id && a.end !== (s.a === nid ? "a" : "b"));
        const os = o && this.net.segs.get(o.seg);
        return !os || ROAD_TYPES[os.type].median !== T.median;
      };
      const na = nose(s.a), nb = nose(s.b);
      medEnd = ss.map((sc) => Math.min(na ? sc - s0 : 1e4, nb ? s1 - sc : 1e4));
    }
    const hw = isHighway(T);
    const dirt = isUnpaved(T) && !s.ring;
    // (on a dirt road the same attribute says how far it is to a junction or turning circle, where its ruts fade out)
    // (not at an all-dirt bend: its curve carries the ruts on at full strength)
    const polyEnd = (nid: number) => { const ng = this.net.nodeGeom.get(nid); return !!ng?.poly && !(ng.curve && this.dirtNode(nid)); };
    const pa = dirt && polyEnd(s.a), pb = dirt && polyEnd(s.b);
    const geo = ribbon(pts, hs, ss, halfW, LIFT, [T.fwd, T.bwd], edges, T.median ?? 0, medEnd,
      ss.map((sc) => (dirt ? Math.min(pa ? sc - s0 : 1e4, pb ? s1 - sc : 1e4) : Math.min(sc - s0, s1 - sc))), pock, lat);
    const surface = new THREE.Mesh(geo, dirt ? this.dirt.mat : s.ring ? this.ringSurface.mat : hw ? this.hwSurface.mat : this.surface.mat);
    surface.receiveShadow = true;
    const extra: THREE.Object3D[] = [];
    // a dirt road: no kerbs or pavement, its worn edge fading into the grass either side
    if (dirt) {
      for (const side of [-1, 1] as const) {
        const f = this.fringe(pts, hs, edges ? (side > 0 ? edges.r : edges.l) : pts.map(() => halfW * side), side);
        if (f) extra.push(f);
      }
    }
    // town roads: pavements both sides on the ground (not on bridges or round roundabouts), trees on bigger roads
    const grp = roadGroup(T);
    const walk = s.ring || dirt ? 0 : SIDEWALK[grp];
    if (walk > 0) {
      const inner = { l: edges ? edges.l : pts.map(() => -halfW), r: edges ? edges.r : pts.map(() => halfW) };
      const ok = (i: number, side: 1 | -1) => hs[i] < 0.3 && Math.abs(side > 0 ? inner.r[i] : inner.l[i]) > halfW - 0.02;
      // (each road's pavement a hair apart in height, so two that meet or overlap never flicker)
      const wg = sidewalkGeo(pts, hs, inner, walk, ok, (id % 4) * 0.0004, lat);
      if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; extra.push(wm); }
      const tr = STREET_TREES[grp];
      if (tr) {
        const spots: { x: number; y: number; h: number; r: number }[] = [];
        // on a fixed rhythm along the road (so pieces of one road line up), clear of junction mouths
        for (let sc = Math.ceil((s0 + 6) / tr.every) * tr.every; sc < s1 - 6; sc += tr.every) {
          let i = 0;
          while (i < ss.length - 2 && ss[i + 1] < sc) i++;
          for (const side of [-1, 1] as const) {
            if (!ok(i, side) || !ok(Math.min(i + 1, pts.length - 1), side)) continue;
            const r = lateralAt(pts, i), off = (side > 0 ? inner.r[i] : inner.l[i]) + side * walk * 0.55;
            spots.push({ x: pts[i].x + r.x * off, y: pts[i].y + r.y * off, h: hs[i], r: tr.r });
          }
        }
        if (spots.length) this.treeSpots.set(id, spots);
      }
      // street lamps at the kerb, between the trees: one side and the other in turn on smaller roads, facing pairs
      // on the big ones
      const lp = LAMP_EVERY[grp];
      if (lp) {
        const lamps: LampSpot[] = [];
        let k = 0;
        for (let sc = Math.ceil((s0 + 5 - lp.phase) / lp.every) * lp.every + lp.phase; sc < s1 - 5; sc += lp.every, k++) {
          let i = 0;
          while (i < ss.length - 2 && ss[i + 1] < sc) i++;
          for (const side of [-1, 1] as const) {
            if (!lp.both && (k % 2 === 0) !== (side > 0)) continue;
            if (!ok(i, side) || !ok(Math.min(i + 1, pts.length - 1), side)) continue;
            const r = lateralAt(pts, i), off = (side > 0 ? inner.r[i] : inner.l[i]) + side * 0.45;
            lamps.push({ x: pts[i].x + r.x * off, y: pts[i].y + r.y * off, h: hs[i] + LIFT, dx: -r.x * side, dy: -r.y * side, kind: "street" });
          }
        }
        if (lamps.length) this.lampSpots.set(id, lamps);
      }
    } else if (hw && !s.ring) {
      // motorways: a tall lamp on the verge every so often, on the ground only
      const lamps: LampSpot[] = [];
      const every = 44;
      for (let sc = Math.ceil((s0 + 8) / every) * every; sc < s1 - 8; sc += every) {
        let i = 0;
        while (i < ss.length - 2 && ss[i + 1] < sc) i++;
        if (hs[i] > 0.3 || hs[Math.min(i + 1, hs.length - 1)] > 0.3) continue;
        const r = lateralAt(pts, i), off = halfW + 1.1;
        lamps.push({ x: pts[i].x + r.x * off, y: pts[i].y + r.y * off, h: hs[i] + LIFT, dx: -r.x, dy: -r.y, kind: "highway" });
      }
      if (lamps.length) this.lampSpots.set(id, lamps);
    }
    // gores: where a slip road runs flush beside the carriageway it leaves (or joins), the two kerbs between them give
    // way to a broad dashed lane line, so its lane reads as carrying straight on from the carriageway's slip lane;
    // where they part, the line turns solid and follows the gap open to the gore
    for (const gl of [g.ends.a.glue, g.ends.b.glue]) {
      const ms = gl && this.net.segs.get(gl.seg), mg = gl && this.net.segGeom.get(gl.seg);
      if (!gl || !ms || !mg) continue;
      // (where the slip lane is still opening out of a taper, the seam stops inside its edge line, and starts only
      // once there's room for it: the carriageway's own kerb carries on up to there)
      const cum = g.center.cum, edgeAt = (i: number) => ({ l: -halfW + clipAt(cum[i], -1), r: halfW - clipAt(cum[i], 1) });
      const inset = isHighway(T) ? SHOULDER + 0.2 : 0.45;
      const geo = seamGeo(g.center.pts, Array.from(g.hs), gl.line ?? mg.center, Math.abs(gl.d), roadWidth(ROAD_TYPES[ms.type]) / 2, g.width / 2, isHighway(T) ? 0.56 : 0.2, clipped ? { at: edgeAt, inset } : undefined);
      if (geo) { const sm = new THREE.Mesh(geo, isHighway(T) ? this.seamHw : this.seamTown); sm.receiveShadow = true; extra.push(sm); }
    }
    const maxH = Math.max(...hs);
    if (maxH > 0.3) {
      const deck = deckSides(pts, hs, halfW, LIFT, edges, lat);
      const dm = new THREE.Mesh(deck, this.deckMat);
      dm.castShadow = true;
      extra.push(dm);
      // parapets along both edges wherever it's up off the ground
      const pg = parapetGeo(pts, hs, (i, side) => (edges ? (side > 0 ? edges.r[i] : edges.l[i]) : halfW * side));
      if (pg) { const pm = new THREE.Mesh(pg, this.parapetMat); pm.castShadow = true; pm.receiveShadow = true; extra.push(pm); }
      // its shadow on the ground or the water, down-right of the deck (the shadow map alone is a thin sliver)
      const sg = dropShadowGeo(pts, hs, halfW);
      if (sg) { const sm = new THREE.Mesh(sg, this.dropMat); sm.renderOrder = 1; extra.push(sm); }
      extra.push(...this.bridgePieces(id, pts, hs, ss, halfW));
    }
    this.show([surface, ...extra]);
    this.segs.set(id, { surface, extra });
  }

  /** A Blender bridge piece placed at p (height y), turned to run along dir, scaled to the deck. */
  private piece(name: string, p: V2, y: number, dir: V2, sx: number, sy: number, sz: number): THREE.Mesh | null {
    const m = this.parts?.props.get(name);
    if (!m) return null;
    const o = new THREE.Mesh(m.geo, this.pieceMat);
    o.position.set(p.x, y, p.y);
    // (the pieces run along Blender Y, which is three's -z: turn three's +z onto dir)
    o.rotation.y = Math.atan2(dir.x, dir.y);
    o.scale.set(sx, sy, sz);
    o.castShadow = true;
    o.receiveShadow = true;
    o.userData.shared = true;
    return o;
  }

  /** Is another road (not this one, and lower) under the point, so a pier can't stand there? */
  private roadUnder(id: number, p: V2, reach: number): boolean {
    for (const sid of this.net.segsNear(p.x - reach - 20, p.y - reach - 20, p.x + reach + 20, p.y + reach + 20)) {
      if (sid === id) continue;
      const s = this.net.segs.get(sid), g = this.net.segGeom.get(sid);
      if (!s || !g) continue;
      const c = polyClosest(g.center, p);
      if (c.d < roadWidth(ROAD_TYPES[s.type]) / 2 + reach) return true;
    }
    return false;
  }

  /**
   * The bridge under (and over) a raised road: concrete piers where it's high enough, clear of the roads below
   * (a short span over a road needs none); on a long deck over water, a steel through truss on piers further
   * apart; and where a deck meets a ramp down, an abutment with a Deco pylon either side.
   */
  private bridgePieces(id: number, pts: V2[], hs: number[], ss: number[], halfW: number): THREE.Mesh[] {
    const out: THREE.Mesh[] = [];
    if (!this.parts) return out;
    const s0 = ss[0], total = ss[ss.length - 1] - s0;
    if (total < 1) return out;
    const at = (s: number) => {
      let i = 0;
      while (i < ss.length - 2 && ss[i + 1] < s) i++;
      const t = clamp((s - ss[i]) / (ss[i + 1] - ss[i] || 1), 0, 1);
      const a = pts[i], b = pts[i + 1];
      return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, h: hs[i] + (hs[i + 1] - hs[i]) * t, dir: norm(sub(b, a)) };
    };
    const minH = Math.min(...hs), maxH = Math.max(...hs);
    const deck = minH > 2.5 && maxH - minH < 0.6;
    const sx = (halfW * 2) / PIECE_W;
    const wet = this.parts.isWater ? pts.filter((p) => this.parts!.isWater!(p)).length / pts.length : 0;
    const trussed = deck && total >= 50 && wet >= 0.5;
    if (trussed) {
      const n = Math.max(1, Math.round(total / 10)), len = total / n;
      for (let k = 0; k < n; k++) {
        const c = at(s0 + (k + 0.5) * len);
        const o = this.piece("bridge_truss", c.p, c.h + LIFT, c.dir, sx, 1, len / 10);
        if (o) out.push(o);
      }
    }
    // piers: every ~24 m (under a truss, at every fourth panel joint), none in a road below or on the ramps' low ends
    const every = trussed ? 40 : 24;
    const n = Math.max(1, Math.round(total / every));
    for (let k = 0; k < n; k++) {
      const c = at(s0 + (total * (k + 0.5)) / n);
      if (c.h < 2.5 || this.roadUnder(id, c.p, 6)) continue;
      const o = this.piece("bridge_pier", c.p, 0, c.dir, sx, Math.max(0.2, (c.h + LIFT - DECK) / PIECE_H), 1);
      if (o) out.push(o);
    }
    // the deck's ends: where it meets a road going down (a ramp), an abutment and two pylons
    if (deck) {
      const s = this.net.segs.get(id)!;
      for (const [node, i, sgn] of [[s.a, 0, -1], [s.b, pts.length - 1, 1]] as const) {
        const nh = this.net.nodes.get(node)?.h ?? hs[i];
        const down = this.net.segsAt(node).some((o) => o.id !== id && Math.min(...(this.net.segGeom.get(o.id)?.hs ?? [nh])) < nh - 1.5);
        if (!down) continue;
        const d = i === 0 ? norm(sub(pts[1], pts[0])) : norm(sub(pts[i], pts[i - 1]));
        const outDir = { x: d.x * sgn, y: d.y * sgn };
        const e = pts[i];
        const ab = this.piece("bridge_abutment", add(e, scale(outDir, 4)), 0, outDir, sx, Math.max(0.2, (hs[i] + LIFT - DECK) / PIECE_H), 1);
        if (ab) out.push(ab);
        const r = right(d);
        for (const side of [-1, 1]) {
          const q = add(add(e, scale(r, side * (halfW + 0.85))), scale(outDir, 0.9));
          const py = this.piece("bridge_pylon", q, hs[i] + LIFT, d, 1, 1, 1);
          if (py) out.push(py);
        }
      }
    }
    return out;
  }

  private buildNode(id: number) {
    const n = this.net.nodes.get(id)!;
    const ng = this.net.nodeGeom.get(id);
    if (!ng) return;
    const gate = this.gateAt(id);
    if (gate) { this.buildGateApron(id, gate); return; }
    if (!ng.poly) return;
    // roundabout nodes are drawn with their ring (continuous surface + flared mouths)
    if (this.net.segsAt(id).some((sg) => sg.ring)) return;
    const out: THREE.Object3D[] = [];
    if (ng.curve) {
      // a bend is just more road: same markings, kerbs and deck as the segments either side
      const { lanes, halfW } = ng.curve;
      // run 0.4 m into each straight piece, a hair higher, so the joins never show a seam
      const c0 = ng.curve.pts, n0 = c0.length;
      const ext = (p: V2, q: V2) => { const d = norm(sub(p, q)); return { x: p.x + d.x * 0.4, y: p.y + d.y * 0.4 }; };
      const pts = [ext(c0[0], c0[1]), ...c0, ext(c0[n0 - 1], c0[n0 - 2])];
      const hs = [ng.curve.hs[0], ...ng.curve.hs, ng.curve.hs[n0 - 1]].map((h) => h + 0.004);
      const ss: number[] = [0];
      for (let i = 1; i < pts.length; i++) ss.push(ss[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y));
      const earth = this.dirtNode(id);
      const geo = ribbon(pts, hs, ss, halfW, LIFT, lanes, undefined, ng.curve.median, undefined, earth ? pts.map(() => 1e4) : undefined);
      // no one-way chevrons on the curve: the straights either side already point the way, and they'd clip at the joins
      const surface = new THREE.Mesh(geo, earth ? this.dirt.mat : this.hwNode(id) ? this.hwRing.mat : this.ringSurface.mat);
      surface.receiveShadow = true;
      out.push(surface);
      if (earth) {
        // (the worn edge along the curve itself, not the overlap into the straights: they have their own)
        const ch = ng.curve.hs;
        for (const side of [-1, 1] as const) {
          const f = this.fringe(c0, ch, c0.map(() => halfW * side), side);
          if (f) out.push(f);
        }
      }
      const walk = this.nodeWalk(id);
      if (walk > 0) {
        const wg = sidewalkGeo(pts, hs, { l: pts.map(() => -halfW), r: pts.map(() => halfW) }, walk, (i) => hs[i] < 0.3);
        if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; out.push(wm); }
      }
      // the curve runs from the arm whose lanes come in: tint each half like that arm's two directions
      const X = ng.arms.find((a) => { const g = this.net.segGeom.get(a.seg); return g?.lanes.some((l) => l.to === id); }) ?? ng.arms[0];
      const inDir = X.end === "b" ? 1 : -1;
      this.bendFlow.set(id, { surface, k1: dkey(X.seg, inDir), k2: dkey(X.seg, -inDir as 1 | -1) });
      if (Math.max(...hs) > 0.3) {
        const dm = new THREE.Mesh(deckSides(pts, hs, halfW, LIFT), this.deckMat);
        dm.castShadow = true;
        out.push(dm);
      }
      this.show(out);
      this.nodes.set(id, out);
      return;
    }
    const y = n.h + LIFT + 0.012;
    // where only dirt roads meet, the junction (or turning circle) is earth with a worn edge round it, no kerbs; where
    // a paved road comes in, it's paved, and its kerbs run round every corner but one between two dirt roads
    const earth = this.dirtNode(id);
    const m = new THREE.Mesh(plainPoly(ng.poly, y), earth ? this.dirt.mat : this.hwNode(id) ? this.hwPlain.mat : this.plain.mat);
    m.receiveShadow = true;
    const dirtArm = (i: number) => {
      const a = ng.arms[((i % ng.arms.length) + ng.arms.length) % ng.arms.length];
      const sg = a && this.net.segs.get(a.seg);
      return !!sg && isUnpaved(ROAD_TYPES[sg.type]);
    };
    const bare = (ki: number) => earth || (ng.kind === "junction" && dirtArm(ki) && dirtArm(ki + 1));
    if (n.h > 0.3) {
      const deck = new THREE.Mesh(polyDeck(ng.poly, y), this.deckMat);
      deck.castShadow = true;
      const under = new THREE.Mesh(plainPoly(ng.poly, Math.max(0.02, y - DECK)), this.deckMat);
      under.castShadow = true;
      out.push(deck, under);
    }
    out.push(m);
    const walk = n.h < 0.3 ? this.nodeWalk(id) : 0;
    // each kerb runs from one arm's mouth round to the next one's: there it turns square across the mouth, like the
    // road's own kerb and pavement it carries on into
    const ends = ng.kerbs.map((k, i): Lat | undefined => {
      if (ng.kind !== "junction" || ng.kerbs.length !== ng.arms.length || k.length < 2) return undefined;
      const A = ng.arms[i], B = ng.arms[(i + 1) % ng.arms.length];
      const e: Lat = [];
      e[0] = scale(right(A.mouth?.dir ?? A.dir), -1);
      e[k.length - 1] = right(B.mouth?.dir ?? B.dir);
      return e;
    });
    for (const [ki, k] of ng.kerbs.entries()) {
      if (k.length < 2 || walk <= 0 || bare(ki)) continue;
      // the pavement carries on round the corner, outside the kerb line
      const mi = k.length >> 1, lat = lateralAt(k, mi);
      const out_ = lat.x * (n.p.x - k[mi].x) + lat.y * (n.p.y - k[mi].y) > 0 ? -1 : 1;
      const z = k.map(() => 0);
      // (just above the roads' own pavements, so round the corner it wins cleanly)
      const wg = sidewalkGeo(k, k.map(() => n.h), { l: z, r: z }, walk, (_, side) => side === out_, 0.002, ends[ki]);
      if (wg) { const wm = new THREE.Mesh(wg, this.walkMat); wm.receiveShadow = true; out.push(wm); }
    }
    // where two roads part at a shallow angle, the ground between them is paved in one piece out to where their
    // pavements part (above both pavements, under the road surfaces), so neither one's rim cuts across the other's
    if (walk > 0) {
      for (const isl of goreIslands(this.net, id)) {
        const wm = new THREE.Mesh(paveGeo(isl, n.h + LIFT - 0.0025), this.walkMat);
        wm.receiveShadow = true;
        out.push(wm);
      }
    }
    ng.kerbs.forEach((k, ki) => {
      if (k.length < 2) return;
      if (bare(ki)) {
        // the worn edge, outward from the corner
        const mi = k.length >> 1, lat = lateralAt(k, mi);
        const side = lat.x * (n.p.x - k[mi].x) + lat.y * (n.p.y - k[mi].y) > 0 ? -1 : 1;
        const f = this.fringe(k, n.h, null, side);
        if (f) out.push(f);
        return;
      }
      // the line is the road's outer edge; draw the band just inside it, like the segment shader does
      const km = new THREE.Mesh(kerbStrip(k, y + 0.01, n.p, ends[ki]), this.hwNode(id) ? this.hwEdgeMat : this.edgeMat);
      km.receiveShadow = true;
      out.push(km);
    });
    const arrows = this.turnArrows(id);
    if (arrows) out.push(arrows);
    out.push(...this.stopMarks(id));
    this.show(out);
    this.nodes.set(id, out);
  }

  /** Does this arm of a signalled town junction have a zebra crossing (pavements, not a highway)? */
  private crossing(id: number, seg: number): boolean {
    const n = this.net.nodes.get(id), s = this.net.segs.get(seg);
    return !!n?.signal && !!s && !s.ring && !isHighway(ROAD_TYPES[s.type]) && !isUnpaved(ROAD_TYPES[s.type]) && n.h < 0.3 && this.nodeWalk(id) > 0;
  }

  /**
   * Stop lines at a junction: a thick one across every lane coming in on a stop arm, with a sign beside the kerb
   * lane's line, and a thinner one where lights control the arm. Lit arms in town get a zebra crossing between the
   * line and the junction, across the whole road.
   */
  private stopMarks(id: number): THREE.Object3D[] {
    const n = this.net.nodes.get(id), ng = this.net.nodeGeom.get(id);
    const sig = !!n?.signal;
    if (!n || (!n.stops?.length && !sig) || !ng || ng.kind !== "junction") return [];
    const out: THREE.Object3D[] = [];
    const pos: number[] = [];
    for (const a of ng.arms) {
      const stop = !!n.stops?.includes(a.seg);
      if (!stop && !sig) continue;
      const g = this.net.segGeom.get(a.seg);
      if (!g) continue;
      const cross = !stop && this.crossing(id, a.seg);
      if (cross) {
        // the stripes run with the traffic, across every lane of the road, both ways
        for (const l of g.lanes) {
          if (l.seg !== a.seg || (l.to !== id && l.from !== id)) continue;
          // from the lane's mouth on into the junction, past the stop line where cars wait
          const inward = l.to === id, L = l.pl.length;
          const m = polyAt(l.pl, inward ? L : 0), dl = polyDir(l.pl, inward ? L : 0);
          const d = inward ? dl : { x: -dl.x, y: -dl.y }, r = right(dl);
          const p = { x: m.x + d.x * (CROSS_START + CROSS_END) / 2, y: m.y + d.y * (CROSS_START + CROSS_END) / 2 };
          const h = n.h + LIFT + 0.017, half = (CROSS_END - CROSS_START) / 2;
          const c = (x: number, y: number) => [p.x + r.x * x + d.x * y, h, p.y + r.y * x + d.y * y];
          // US continental bars: three to a lane, 0.6 m wide, clear of the lane lines
          for (let k = 0; k < 3; k++) {
            const x0 = (k - 1) * (LANE_W / 3) - 0.3, x1 = x0 + 0.6;
            pos.push(...c(x0, -half), ...c(x1, -half), ...c(x1, half), ...c(x0, -half), ...c(x1, half), ...c(x0, half));
          }
        }
      }
      const inn = g.lanes.filter((l) => l.to === id && l.seg === a.seg && (a.end === "b" ? l.dir === 1 : l.dir === -1));
      // (no paint on earth: a dirt road's stop is the sign alone)
      const bareArm = isUnpaved(ROAD_TYPES[this.net.segs.get(a.seg)?.type ?? "street"]);
      let kerb: (typeof inn)[number] | null = null;
      for (const l of inn) {
        if (!kerb || l.idx < kerb.idx) kerb = l;
        if (bareArm) continue;
        const L = l.pl.length, at = Math.max(0, L - 0.45);
        const p = polyAt(l.pl, at), d = polyDir(l.pl, at), r = right(d);
        const h = (l.hs[l.hs.length - 1] ?? 0) + LIFT + 0.017;
        const hw = LANE_W * 0.47, hd = stop ? 0.3 : 0.22; // (US stop bars: 0.6 m at a stop sign)
        const c = (x: number, y: number) => [p.x + r.x * x + d.x * y, h, p.y + r.y * x + d.y * y];
        pos.push(...c(-hw, -hd), ...c(hw, -hd), ...c(hw, hd), ...c(-hw, -hd), ...c(hw, hd), ...c(-hw, hd));
      }
      if (kerb && stop) {
        const L = kerb.pl.length, at = Math.max(0, L - 1.6);
        const p = polyAt(kerb.pl, at), r = right(polyDir(kerb.pl, at));
        const h = (kerb.hs[kerb.hs.length - 1] ?? 0) + LIFT + 0.05;
        const x = p.x + r.x * (LANE_W / 2 + 1.5), y = p.y + r.y * (LANE_W / 2 + 1.5);
        const rim = new THREE.Mesh(this.stopRimGeo, this.stopRim), face = new THREE.Mesh(this.stopGeo, this.stopMat);
        rim.position.set(x, h, y);
        face.position.set(x, h + 0.01, y);
        rim.renderOrder = face.renderOrder = 3;
        out.push(rim, face);
      }
    }
    if (pos.length) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
      geo.computeVertexNormals();
      const m = new THREE.Mesh(geo, this.arrowMat);
      m.receiveShadow = true;
      out.unshift(m);
    }
    return out;
  }

  /**
   * Turn arrows on the approaches to a junction (CS2): on each lane coming in, a little before the stop line, the
   * ways that lane may go. Only where the choice of lane matters: approaches with more than one lane, or a turn lane.
   */
  private turnArrows(id: number): THREE.Mesh | null {
    const ng = this.net.nodeGeom.get(id);
    if (!ng || ng.kind !== "junction" || ng.arms.length < 3) return null;
    const pos: number[] = [];
    for (const a of ng.arms) {
      const s = this.net.segs.get(a.seg), g = this.net.segGeom.get(a.seg);
      if (!s || !g || s.ring || isHighway(ROAD_TYPES[s.type])) continue;
      const inn = g.lanes.filter((l) => l.to === id && l.seg === a.seg && (a.end === "b" ? l.dir === 1 : l.dir === -1));
      if (inn.length < 2) continue;
      for (const l of inn) {
        const turns = new Set(ng.conns.filter((c) => c.from === l).map((c) => c.turn));
        if (!turns.size) continue;
        // (a U-turn shows as a left turn, unless that's all the lane does)
        if (turns.has("U") && turns.size > 1) turns.delete("U");
        else if (turns.has("U")) { turns.delete("U"); turns.add("L"); }
        const L = l.pl.length, at = L - 7;
        if (at < 3) continue;
        const p = polyAt(l.pl, at), d = polyDir(l.pl, at), r = right(d);
        const f = (at / (L || 1)) * (l.hs.length - 1), i0 = Math.floor(f), i1 = Math.min(l.hs.length - 1, i0 + 1);
        const h = (l.hs[i0] ?? 0) + ((l.hs[i1] ?? 0) - (l.hs[i0] ?? 0)) * (f - i0) + LIFT + 0.016;
        for (const [gx, gy] of arrowGlyph([...turns].sort().join(""))) pos.push(p.x + r.x * gx + d.x * gy, h, p.y + r.y * gx + d.y * gy);
      }
    }
    if (!pos.length) return null;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
    geo.computeVertexNormals();
    const m = new THREE.Mesh(geo, this.arrowMat);
    m.receiveShadow = true;
    return m;
  }

  /** Roundabouts: one continuous ring surface, a grass island, and flared mouths where roads join. */
  private buildIslands() {
    for (const c of [...this.islands.children]) {
      this.islands.remove(c);
      (c as THREE.Mesh).geometry.dispose();
    }
    const seen = new Set<number>();
    for (const sg of this.net.segs.values()) {
      if (!sg.ring || seen.has(sg.ring)) continue;
      seen.add(sg.ring);
      const n0 = this.net.nodes.get(sg.a)!;
      const R = ringsNear(this.net, n0.p, 4).find((r) => r.id === sg.ring);
      const g = this.net.segGeom.get(sg.id);
      if (!R || !g) continue;
      const C = R.c, hw = g.width / 2;
      const Ro = R.r + hw, Ri = R.r - hw;
      if (Ri < 2) continue;
      const y = R.h + LIFT;
      const put = (geo: THREE.BufferGeometry, mat: THREE.Material) => {
        const m = new THREE.Mesh(geo, mat);
        m.receiveShadow = true;
        this.islands.add(m);
      };
      // surface under the (trimmed) ring ribbons so the circle never shows notches at its nodes
      put(plainGeo(new THREE.RingGeometry(Ri, Ro, 96, 1).rotateX(-Math.PI / 2).translate(C.x, y - 0.004, C.y)), this.plain.mat);
      put(new THREE.CircleGeometry(Ri, 64).rotateX(-Math.PI / 2).translate(C.x, y + 0.015, C.y), this.islandMat);
      put(strip(circlePts(C, Ri + 0.21, 64), y + 0.02, 0.42), this.edgeMat);
      // mouths: each road joining the ring flares into it with kerb fillets
      const gaps: [number, number][] = [];
      const ringNodes = new Set<number>();
      for (const s2 of this.net.segs.values()) if (s2.ring === sg.ring) { ringNodes.add(s2.a); ringNodes.add(s2.b); }
      for (const nid of ringNodes) {
        const ng = this.net.nodeGeom.get(nid);
        const nn = this.net.nodes.get(nid);
        if (!ng || !nn) continue;
        for (const a of ng.arms) {
          if (this.net.segs.get(a.seg)?.ring) continue;
          const rt = right(a.dir);
          const base = { x: nn.p.x + a.dir.x * a.trim, y: nn.p.y + a.dir.y * a.trim };
          const thC = Math.atan2(base.y - C.y, base.x - C.x);
          const flare = (side: number) => {
            const e = { x: base.x + rt.x * a.halfW * side, y: base.y + rt.y * a.halfW * side };
            // where this edge, carried on towards the centre, meets the ring's outer kerb
            const m = { x: e.x - C.x, y: e.y - C.y };
            const b = m.x * a.dir.x + m.y * a.dir.y;
            const disc = b * b - (m.x * m.x + m.y * m.y - Ro * Ro);
            let P: V2;
            if (disc >= 0 && b - Math.sqrt(disc) > 0) {
              const t = b - Math.sqrt(disc);
              P = { x: e.x - a.dir.x * t, y: e.y - a.dir.y * t };
            } else {
              const l = Math.hypot(m.x, m.y) || 1;
              P = { x: C.x + (m.x / l) * Ro, y: C.y + (m.y / l) * Ro };
            }
            const thP = Math.atan2(P.y - C.y, P.x - C.x);
            const away = Math.sign(Math.atan2(Math.sin(thP - thC), Math.cos(thP - thC))) || side;
            const thE = thP + away * (3.2 / Ro);
            const E = { x: C.x + Math.cos(thE) * Ro, y: C.y + Math.sin(thE) * Ro };
            const pts: V2[] = [];
            for (let k = 0; k <= 8; k++) {
              const t = k / 8, u = 1 - t;
              pts.push({ x: u * u * e.x + 2 * u * t * P.x + t * t * E.x, y: u * u * e.y + 2 * u * t * P.y + t * t * E.y });
            }
            return { pts, thE };
          };
          const L = flare(-1), Rr = flare(1);
          put(plainPoly([...Rr.pts, ...L.pts.slice().reverse()], y + 0.012), this.plain.mat);
          const inside = { x: base.x - a.dir.x * 2, y: base.y - a.dir.y * 2 };
          put(kerbStrip(Rr.pts, y + 0.022, inside), this.edgeMat);
          put(kerbStrip(L.pts, y + 0.022, inside), this.edgeMat);
          let a0 = L.thE, a1 = Rr.thE;
          if (Math.atan2(Math.sin(a1 - a0), Math.cos(a1 - a0)) < 0) [a0, a1] = [a1, a0];
          const span = (((a1 - a0) % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
          gaps.push([a0, span]);
        }
      }
      // outer kerb, broken at the mouths
      for (const arc of arcsBetween(gaps)) {
        const pts: V2[] = [];
        const n = Math.max(2, Math.ceil((arc[1] / (Math.PI * 2)) * 96));
        for (let k = 0; k <= n; k++) {
          const t = arc[0] + (arc[1] * k) / n;
          pts.push({ x: C.x + Math.cos(t) * (Ro - 0.21), y: C.y + Math.sin(t) * (Ro - 0.21) });
        }
        put(strip(pts, y + 0.02, 0.42), this.edgeMat);
      }
    }
  }

  private collectLights() {
    this.lightRefs = [];
    for (const [id, n] of this.net.nodes) {
      if (!n.signal) continue;
      const ng = this.net.nodeGeom.get(id);
      if (!ng || ng.kind !== "junction") continue; // a plan left on a node that's now a plain bend does nothing
      for (const a of ng.arms) {
        // one dot per incoming lane, at the stop line
        const g = this.net.segGeom.get(a.seg);
        if (!g) continue;
        for (const l of g.lanes) {
          if (l.to !== id) continue;
          const p = l.pl.pts[l.pl.pts.length - 1];
          const q = l.pl.pts[Math.max(0, l.pl.pts.length - 3)];
          const d = norm(sub(p, q));
          // (the turns this lane takes: a left-turn lane shows its own left-turn phase)
          const turns = [...new Set(l.outs.map((c) => c.turn as string))];
          this.lightRefs.push({ node: id, arm: a.seg, turns: turns.length ? turns : ["S"], x: p.x - d.x * 1.2, y: p.y - d.y * 1.2, h: n.h });
        }
      }
    }
  }

  private tmpM = new THREE.Matrix4();
  private tmpC = new THREE.Color();

  /** Per-frame: signal dots. Per-second: flow tint attributes. */
  update(traffic: Traffic, flowOverlay: boolean) {
    const L = this.lights;
    if (this.lightRefs.length > L.instanceMatrix.count) {
      this.group.remove(L);
      this.lights = new THREE.InstancedMesh(L.geometry, L.material, this.lightRefs.length * 2);
      this.lights.renderOrder = 3;
      this.lights.frustumCulled = false;
      this.group.add(this.lights);
    }
    const li = this.lights;
    li.count = this.lightRefs.length;
    for (let i = 0; i < this.lightRefs.length; i++) {
      const r = this.lightRefs[i];
      this.tmpM.makeTranslation(r.x, r.h + LIFT + 0.05, r.y);
      li.setMatrixAt(i, this.tmpM);
      // a lane shared by several turns shows the best of them (a car on it may go when its own turn is green)
      let st = "red";
      for (const t of r.turns) {
        const x = traffic.signalState(r.node, r.arm, t);
        if (x === "green") { st = x; break; }
        if (x === "yellow") st = x;
      }
      li.setColorAt(i, this.tmpC.set(st === "green" ? 0x34c25a : st === "yellow" ? 0xf5b82e : 0xe5484d));
    }
    li.instanceMatrix.needsUpdate = true;
    if (li.instanceColor) li.instanceColor.needsUpdate = true;
    if (flowOverlay) {
      for (const [id, m] of this.segs) this.tintFlow(m.surface, traffic.flow.get(dkey(id, 1))?.ratio ?? 1, traffic.flow.get(dkey(id, -1))?.ratio ?? 1);
      for (const b of this.bendFlow.values()) this.tintFlow(b.surface, traffic.flow.get(b.k1)?.ratio ?? 1, traffic.flow.get(b.k2)?.ratio ?? 1);
    }
  }

  /** A road surface's flow tint (each direction's flow ratio), on its own vertices and where they are drawn merged. */
  private tintFlow(surface: THREE.Mesh, f1: number, f2: number) {
    const own = surface.geometry.getAttribute("aFlow") as THREE.BufferAttribute;
    const a = own.array as Float32Array;
    if (a[0] === f1 && a[1] === f2) return;
    for (let i = 0; i < a.length; i += 2) { a[i] = f1; a[i + 1] = f2; }
    const at = MeshBatch.of(surface);
    if (!at) return;
    const mf = at.mesh.geometry.getAttribute("aFlow") as THREE.BufferAttribute;
    const b = mf.array as Float32Array;
    for (let i = at.start * 2, e = (at.start + at.count) * 2; i < e; i += 2) { b[i] = f1; b[i + 1] = f2; }
    mf.needsUpdate = true;
  }
}


// ------------------------------------------------------------------------------------------------

function sampleRange(pts: V2[], cum: number[], hs: Float32Array, s0: number, s1: number) {
  const outP: V2[] = [], outH: number[] = [], outS: number[] = [];
  const at = (s: number) => {
    let i = 0;
    while (i < cum.length - 2 && cum[i + 1] < s) i++;
    const seg = cum[i + 1] - cum[i] || 1;
    const t = Math.max(0, Math.min(1, (s - cum[i]) / seg));
    const a = pts[i], b = pts[Math.min(i + 1, pts.length - 1)];
    return { p: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, h: hs[i] + (hs[Math.min(i + 1, hs.length - 1)] - hs[i]) * t };
  };
  const first = at(s0);
  outP.push(first.p); outH.push(first.h); outS.push(s0);
  for (let i = 0; i < pts.length; i++) {
    if (cum[i] > s0 + 0.2 && cum[i] < s1 - 0.2) { outP.push(pts[i]); outH.push(hs[i]); outS.push(cum[i]); }
  }
  const last = at(s1);
  outP.push(last.p); outH.push(last.h); outS.push(s1);
  return { pts: outP, hs: outH, ss: outS };
}

function lateralAt(pts: V2[], i: number): V2 {
  const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
  return right(norm(sub(b, a)));
}

/** Per-point lateral directions set by hand (a road's ends, square across the junction mouth they meet). */
type Lat = (V2 | undefined)[];
const latAt = (pts: V2[], i: number, lat?: Lat): V2 => lat?.[i] ?? lateralAt(pts, i);

/** Road ribbon with aRoad = (lateral u, arc length v, fwd lanes, bwd lanes). */
export function ribbon(pts: V2[], hs: number[], ss: number[], halfW: number, lift: number, lanes: [number, number], edges?: { l: number[]; r: number[] }, median = 0, medEnd?: number[], treeEnd?: number[], pock?: number[][], lat?: Lat): THREE.BufferGeometry {
  const n = pts.length;
  const pos = new Float32Array(n * 2 * 3);
  const nor = new Float32Array(n * 2 * 3);
  const road = new Float32Array(n * 2 * 4);
  const flow = new Float32Array(n * 2 * 2).fill(1);
  for (let i = 0; i < n; i++) {
    const r = latAt(pts, i, lat);
    const p = pts[i], y = hs[i] + lift;
    // left (u = -halfW) and right (u = +halfW), or the tapered edges
    const ul = edges ? edges.l[i] : -halfW, ur = edges ? edges.r[i] : halfW;
    pos.set([p.x + r.x * ul, y, p.y + r.y * ul, p.x + r.x * ur, y, p.y + r.y * ur], i * 6);
    nor.set([0, 1, 0, 0, 1, 0], i * 6);
    road.set([ul, ss[i], lanes[0], lanes[1], ur, ss[i], lanes[0], lanes[1]], i * 8);
  }
  const idx: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    // three's y-up with z = world y: (left, right, nextLeft) is counter-clockwise seen from above
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.BufferAttribute(nor, 3));
  g.setAttribute("aRoad", new THREE.BufferAttribute(road, 4));
  g.setAttribute("aFlow", new THREE.BufferAttribute(flow, 2));
  const med = new Float32Array(n * 6);
  for (let i = 0; i < n; i++) {
    const a = medEnd?.[i] ?? 1e4, t = treeEnd ? treeEnd[i] : 0;
    med.set([median, a, t, median, a, t], i * 6);
  }
  g.setAttribute("aMed", new THREE.BufferAttribute(med, 3));
  // how far each side is pulled in by a taper (the shader draws the edge band and line there)
  const clip = new Float32Array(n * 4);
  if (edges) for (let i = 0; i < n; i++) { const cl = halfW + edges.l[i], cr = halfW - edges.r[i]; clip.set([cl, cr, cl, cr], i * 4); }
  g.setAttribute("aClip", new THREE.BufferAttribute(clip, 2));
  // turn pockets: how far each is open (this side's left and right, the other side's)
  const pk = new Float32Array(n * 8);
  if (pock) for (let i = 0; i < n; i++) { pk.set(pock[i], i * 8); pk.set(pock[i], i * 8 + 4); }
  g.setAttribute("aPock", new THREE.BufferAttribute(pk, 4));
  g.setIndex(idx);
  fixUpWinding(g);
  g.computeBoundingSphere();
  return g;
}

/** Vertical deck faces under an elevated ribbon, plus the underside. */
function deckSides(pts: V2[], hs: number[], halfW: number, lift: number, edges?: { l: number[]; r: number[] }, lat?: Lat): THREE.BufferGeometry {
  // (a tapered road's deck follows its tapered edges, or the underside shows through where the surface is pulled in)
  const at = (i: number, side: number) => (edges ? (side > 0 ? edges.r[i] : edges.l[i]) : halfW * side);
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (const side of [-1, 1]) {
    const base = pos.length / 3;
    for (let i = 0; i < n; i++) {
      const r = latAt(pts, i, lat);
      const p = pts[i], y = hs[i] + lift;
      const u = at(i, side);
      const x = p.x + r.x * u, z = p.y + r.y * u;
      pos.push(x, y, z, x, Math.max(0.02, y - DECK), z);
    }
    for (let i = 0; i < n - 1; i++) {
      const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
      if (side > 0) idx.push(a, b, c, b, d, c);
      else idx.push(a, c, b, b, c, d);
    }
  }
  // underside
  const base = pos.length / 3;
  for (let i = 0; i < n; i++) {
    const r = latAt(pts, i, lat);
    const p = pts[i], y = Math.max(0.02, hs[i] + lift - DECK);
    const ul = at(i, -1), ur = at(i, 1);
    pos.push(p.x + r.x * ul, y, p.y + r.y * ul, p.x + r.x * ur, y, p.y + r.y * ur);
  }
  for (let i = 0; i < n - 1; i++) {
    const a = base + i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, b, c, b, d, c);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Cream concrete parapets along both edges of a raised road (where it's more than ~1 m up): a 0.35 m wall, 0.95 m
 * tall, its outer face flush with the deck's edge. null if no part of it is raised. */
function parapetGeo(pts: V2[], hs: number[], edge: (i: number, side: number) => number): THREE.BufferGeometry | null {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  const up = (i: number) => hs[i] > 1;
  if (!hs.some((h) => h > 1)) return null;
  const T = 0.35, H = 0.95;
  for (const side of [-1, 1]) {
    for (let i = 0; i < n - 1; i++) {
      if (!up(i) || !up(i + 1)) continue;
      // three faces (inner, top, outer) as separate quads so they shade flat
      const q = (j: number) => {
        const r = lateralAt(pts, j), u = edge(j, side), y = hs[j] + LIFT;
        const at = (w: number, z: number) => [pts[j].x + r.x * w, z, pts[j].y + r.y * w];
        return { ib: at(u - side * T, y), it: at(u - side * T, y + H), ot: at(u, y + H), ob: at(u, y - 0.15) };
      };
      const a = q(i), b = q(i + 1);
      for (const [p0, p1, p2, p3] of [[a.ib, a.it, b.it, b.ib], [a.it, a.ot, b.ot, b.it], [a.ot, a.ob, b.ob, b.ot]]) {
        const k = pos.length / 3;
        pos.push(...p0, ...p1, ...p2, ...p3);
        idx.push(k, k + 1, k + 2, k, k + 2, k + 3, k, k + 2, k + 1, k, k + 3, k + 2); // both windings
      }
    }
  }
  if (!pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A raised road's soft shadow on the ground under it, thrown down-right by its height: dark navy, densest under
 * the deck's middle, fading out over the last 2.6 m either side and on the low ends of its ramps. */
function dropShadowGeo(pts: V2[], hs: number[], halfW: number): THREE.BufferGeometry | null {
  if (!hs.some((h) => h > 1)) return null;
  const pos: number[] = [];
  const col: number[] = [];
  const idx: number[] = [];
  const F = 2.6, c = new THREE.Color(0x0d1626);
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const r = lateralAt(pts, i), h = Math.max(0, hs[i]);
    const a = 0.5 * smoothstep(clamp((h - 0.6) / 2.4, 0, 1));
    const cx = pts[i].x + SUN_OFF.x * h, cz = pts[i].y + SUN_OFF.y * h;
    for (const [w, k] of [[-halfW - F, 0], [-halfW + 0.5, 1], [halfW - 0.5, 1], [halfW + F, 0]] as const) {
      pos.push(cx + r.x * w, 0.035, cz + r.y * w);
      col.push(c.r, c.g, c.b, a * k);
    }
  }
  for (let i = 0; i < n - 1; i++) {
    for (let j = 0; j < 3; j++) {
      const a = i * 4 + j, b = a + 1, d = a + 4, e = a + 5;
      idx.push(a, d, b, b, d, e);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 4));
  g.setIndex(idx);
  g.computeBoundingSphere();
  return g;
}

function polyDeck(poly: V2[], y: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let i = 0; i < poly.length; i++) {
    const p = poly[i];
    pos.push(p.x, y, p.y, p.x, Math.max(0.02, y - DECK), p.y);
  }
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const a = i * 2, b = a + 1, c = ((i + 1) % n) * 2, d = c + 1;
    idx.push(a, b, c, b, d, c, a, c, b, b, c, d); // both windings: cheap double-sided
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/**
 * Pavement bands either side of a road: from the road edge (`edge.l` / `edge.r`, lateral offsets) out by `walk`, with
 * a darker rim on the outside. Only where `ok(i, side)` holds for both ends of a step. Sits just under the road
 * surface, so where it runs into another road that road covers it. null if there's nothing to draw.
 */
/** A road-coloured band with a broad dashed line down its middle (see seamGeo). */
function seamMaterial(road: number, line: number): THREE.MeshLambertMaterial {
  const m = new THREE.MeshLambertMaterial({ color: road });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uLine = { value: new THREE.Color(line) };
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec3 aSeam;\nvarying vec3 vSeam;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvSeam = aSeam;");
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nuniform vec3 uLine;\nvarying vec3 vSeam;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
{
  float f = fwidth(vSeam.x) * 0.8 + 1e-4;
  float l = 1.0 - smoothstep(0.15 - f, 0.15 + f, abs(vSeam.x));
  float dash = mix(step(fract(vSeam.y / 6.0), 0.55), 1.0, step(0.5, vSeam.z));
  diffuseColor.rgb = mix(diffuseColor.rgb, uLine, l * dash);
}`,
      );
  };
  return m;
}

/**
 * The seam between a slip road and the carriageway it runs flush beside (its centre `d` from the carriageway's, the
 * carriageway `mainHalf` wide each side, the slip road `rampHalf`): a road-coloured band over both kerbs with a broad
 * dashed line down it. Where the two part, the band widens to fill the gap and the line turns solid, up to where the
 * kerbs are clear of each other (the gore). `pad`: how far past the kerbs the band reaches. null where they never meet.
 */
function seamGeo(
  pts: V2[], hs: number[], main: Polyline, d: number, mainHalf: number, rampHalf: number, pad: number,
  taper?: { at: (i: number) => { l: number; r: number }; inset: number },
): THREE.BufferGeometry | null {
  const pos: number[] = [], uv: number[] = [], idx: number[] = [];
  let run = 0, v = 0, prev: V2 | null = null;
  for (let i = 0; i < pts.length; i++) {
    const c = polyClosest(main, pts[i]);
    const dir = polyDir(main, c.s), foot = polyAt(main, c.s), nrm = right(dir);
    const lat = dot(sub(pts[i], foot), nrm), gap = Math.abs(lat) - d;
    // (once the kerbs are clear of each other, they and the grass between them make the gore; and only beside the
    // carriageway, right up to the node where it starts or ends, not out past it)
    const on = gap > -0.3 && gap < 0.5 && Math.abs(dot(sub(pts[i], foot), dir)) < 0.6;
    if (!on) { run = 0; prev = null; continue; }
    const sg = Math.sign(lat), y = hs[i] + LIFT + 0.004;
    // between the carriageway's outer edge and the slip road's inner edge (they overlap 0.42 m when flush)
    const e0 = mainHalf - 0.42, e1 = Math.abs(lat) - rampHalf + 0.42;
    const mid = (e0 + e1) / 2, cover = (e1 - e0) / 2 + pad;
    // the outer side reaches no further than just inside the slip road's (tapered) edge line
    let reach = cover;
    if (taper) {
      const e = taper.at(i), rr = lateralAt(pts, i);
      const far = Math.max(...[e.l, e.r].map((u) => Math.abs(dot(sub(add(pts[i], scale(rr, u)), foot), nrm))));
      reach = Math.min(cover, far - taper.inset - mid);
      if (reach < 0.3) { run = 0; prev = null; continue; }
    }
    const m = { x: foot.x + nrm.x * sg * mid, y: foot.y + nrm.y * sg * mid };
    if (prev) v += dist(prev, m);
    prev = m;
    const base = pos.length / 3;
    const solid = smoothstep(clamp((gap - 0.1) / 0.3, 0, 1));
    // (-nrm side first)
    const lo = sg > 0 ? cover : reach, hi = sg > 0 ? reach : cover;
    pos.push(m.x - nrm.x * lo, y, m.y - nrm.y * lo, m.x + nrm.x * hi, y, m.y + nrm.y * hi);
    uv.push(-lo, v, solid, hi, v, solid);
    if (run > 0) idx.push(base - 2, base - 1, base, base - 1, base + 1, base);
    run++;
  }
  if (!idx.length) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("aSeam", new THREE.Float32BufferAttribute(uv, 3));
  geo.setIndex(idx);
  geo.computeVertexNormals();
  return geo;
}

function sidewalkGeo(pts: V2[], hs: number[], edge: { l: number[]; r: number[] }, walk: number, ok: (i: number, side: 1 | -1) => boolean, lift = 0, lat?: Lat): THREE.BufferGeometry | null {
  const pos: number[] = [], col: number[] = [], idx: number[] = [];
  const cw = new THREE.Color(PAL.sidewalk), ce = new THREE.Color(PAL.sidewalkEdge);
  const rim = Math.min(0.22, walk * 0.15);
  for (const side of [-1, 1] as const) {
    let prev = -1;
    for (let i = 0; i < pts.length; i++) {
      if (!ok(i, side)) { prev = -1; continue; }
      const r = latAt(pts, i, lat), y = hs[i] + LIFT - 0.005 + lift;
      const e = side > 0 ? edge.r[i] : edge.l[i];
      const base = pos.length / 3;
      // four across: road edge, rim start (twice, for a hard colour change), outer edge
      for (const [d, c] of [[0, cw], [walk - rim, cw], [walk - rim, ce], [walk, ce]] as const) {
        const u = e + side * d;
        pos.push(pts[i].x + r.x * u, y, pts[i].y + r.y * u);
        col.push(c.r, c.g, c.b);
      }
      if (prev >= 0 && dist(pts[i], pts[i - 1]) > 1e-4) {
        for (const [a, b] of [[0, 1], [2, 3]]) idx.push(prev + a, base + a, prev + b, prev + b, base + a, base + b);
      }
      prev = base;
    }
  }
  if (!idx.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((_, i) => (i % 3 === 1 ? 1 : 0)), 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  fixUpWinding(g);
  g.computeBoundingSphere();
  return g;
}

/** Flat strip of width w along a polyline (kerbs, guides). */
export function strip(pts: V2[], y: number, w: number, off = 0, lat?: Lat): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const r = latAt(pts, i, lat);
    const p = { x: pts[i].x + r.x * off, y: pts[i].y + r.y * off };
    pos.push(p.x - r.x * w / 2, y, p.y - r.y * w / 2, p.x + r.x * w / 2, y, p.y + r.y * w / 2);
  }
  for (let i = 0; i < n - 1; i++) {
    if (dist(pts[i], pts[i + 1]) < 1e-4) continue;
    const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
    idx.push(a, c, b, b, c, d);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(n * 2).fill(0).flatMap(() => [0, 1, 0]), 3));
  g.setIndex(idx);
  fixUpWinding(g);
  return g;
}

/** Make every triangle face +y (seen from the top-down camera). */
export function fixUpWinding(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position");
  const ix = g.getIndex();
  if (!ix) return;
  const a = ix.array as Uint16Array | Uint32Array | number[];
  for (let t = 0; t < ix.count; t += 3) {
    const i0 = a[t], i1 = a[t + 1], i2 = a[t + 2];
    const ux = p.getX(i1) - p.getX(i0), uz = p.getZ(i1) - p.getZ(i0);
    const vx = p.getX(i2) - p.getX(i0), vz = p.getZ(i2) - p.getZ(i0);
    // y component of (u x v) = uz*vx - ux*vz
    if (uz * vx - ux * vz < 0) { a[t + 1] = i2; a[t + 2] = i1; }
  }
  ix.needsUpdate = true;
}

function flipWinding(g: THREE.BufferGeometry) {
  fixUpWinding(g);
  const nr = g.getAttribute("normal");
  if (nr) for (let i = 0; i < nr.count; i++) nr.setXYZ(i, 0, 1, 0);
}

/** Flat road-surface polygon (plain material: no lane markings). */
function plainPoly(poly: V2[], y: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y)));
  const geo = new THREE.ShapeGeometry(shape, 1);
  geo.rotateX(Math.PI / 2); // shape (x, y) -> (x, 0, y)
  flipWinding(geo); // faces +y with upward normals
  geo.translate(0, y, 0);
  return plainGeo(geo);
}

/** A flat paved polygon in plain pavement colour (for the pavement material). */
function paveGeo(poly: V2[], y: number): THREE.BufferGeometry {
  const geo = new THREE.ShapeGeometry(new THREE.Shape(poly.map((p) => new THREE.Vector2(p.x, p.y))), 1);
  geo.rotateX(Math.PI / 2);
  flipWinding(geo);
  geo.translate(0, y, 0);
  geo.deleteAttribute("uv"); // (so it batches with the other pavements)
  const c = new THREE.Color(PAL.sidewalk), cnt = geo.getAttribute("position").count;
  geo.setAttribute("color", new THREE.Float32BufferAttribute(new Array(cnt).fill(0).flatMap(() => [c.r, c.g, c.b]), 3));
  return geo;
}

/** Give any surface geometry the attributes the road shader expects, as a plain (unmarked) surface. */
function plainGeo(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const cnt = geo.getAttribute("position").count;
  geo.setAttribute("aRoad", new THREE.Float32BufferAttribute(new Array(cnt * 4).fill(0).map((_, i) => (i % 4 === 2 ? -1 : 0)), 4));
  geo.setAttribute("aFlow", new THREE.Float32BufferAttribute(new Array(cnt * 2).fill(1), 2));
  return geo;
}

/** Kerb band along an outer road edge, drawn on the side facing `inside` (like the segment shader's edge). */
function kerbStrip(k: V2[], y: number, inside: V2, ends?: Lat): THREE.BufferGeometry {
  const mi = k.length >> 1;
  const lat = latAt(k, mi, ends);
  const s = lat.x * (inside.x - k[mi].x) + lat.y * (inside.y - k[mi].y) > 0 ? 1 : -1;
  return strip(k, y, 0.42, s * 0.21, ends);
}

/** The convex hull of some points (Andrew's monotone chain), counter-clockwise. */
function convexHull(pts: V2[]): V2[] {
  const p = pts.slice().sort((a, b) => a.x - b.x || a.y - b.y);
  if (p.length < 3) return p;
  const cr = (o: V2, a: V2, b: V2) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lo: V2[] = [], hi: V2[] = [];
  for (const q of p) { while (lo.length >= 2 && cr(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (const q of p.reverse()) { while (hi.length >= 2 && cr(hi[hi.length - 2], hi[hi.length - 1], q) <= 0) hi.pop(); hi.push(q); }
  return [...lo.slice(0, -1), ...hi.slice(0, -1)];
}

function circlePts(c: V2, r: number, n: number): V2[] {
  const pts: V2[] = [];
  for (let k = 0; k <= n; k++) {
    const a = (k / n) * Math.PI * 2;
    pts.push({ x: c.x + Math.cos(a) * r, y: c.y + Math.sin(a) * r });
  }
  return pts;
}

/** Complement of angular gaps [start, span] on a circle, as [start, span] arcs. */
export function arcsBetween(gaps: [number, number][]): [number, number][] {
  const TAU = Math.PI * 2;
  if (!gaps.length) return [[0, TAU]];
  const g = gaps.map(([a, sp]) => [((a % TAU) + TAU) % TAU, sp] as [number, number]).sort((x, y) => x[0] - y[0]);
  const m: [number, number][] = [];
  for (const [a, sp] of g) {
    const last = m[m.length - 1];
    if (last && a <= last[0] + last[1]) last[1] = Math.max(last[1], a + sp - last[0]);
    else m.push([a, sp]);
  }
  const out: [number, number][] = [];
  for (let i = 0; i < m.length; i++) {
    const end = m[i][0] + m[i][1];
    const next = i + 1 < m.length ? m[i + 1][0] : m[0][0] + TAU;
    if (next - end > 1e-3) out.push([end, next - end]);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// turn arrow glyphs: triangles in lane space (x: metres right of the lane's line, y: metres ahead)
// ---------------------------------------------------------------------------------------------

const glyphs = new Map<string, number[][]>();

/** A painted arrow for a set of turns ("S", "L", "R", "LS", "RS", "LR", "LRS"): triangle corners, upward-facing. */
/** A zebra crossing spans this stretch past each lane's mouth, into the junction (m). */
const CROSS_START = 0.4, CROSS_END = 3.4;

function arrowGlyph(key: string): number[][] {
  const hit = glyphs.get(key);
  if (hit) return hit;
  const tris: number[][] = [];
  const W = 0.15; // half the stroke
  // a thick line along pts (mitred joints)
  const stroke = (pts: number[][]) => {
    const side: number[][][] = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
      const dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1;
      const nx = dy / l, ny = -dx / l; // to the right of the way the line runs
      side.push([[pts[i][0] - nx * W, pts[i][1] - ny * W], [pts[i][0] + nx * W, pts[i][1] + ny * W]]);
    }
    for (let i = 0; i < pts.length - 1; i++) {
      const [l0, r0] = side[i], [l1, r1] = side[i + 1];
      tris.push(l0, r0, r1, l0, r1, l1);
    }
  };
  // a head: tip, and the two corners of its base
  const head = (tip: number[], dx: number, dy: number, len = 0.9, half = 0.5) => {
    const bx = tip[0] - dx * len, by = tip[1] - dy * len;
    tris.push(tip, [bx - dy * half, by + dx * half], [bx + dy * half, by - dx * half]);
  };
  stroke([[0, -2.3], [0, -0.2]]);
  if (key.includes("S")) { stroke([[0, -0.3], [0, 1.45]]); head([0, 2.3], 0, 1); }
  for (const sgn of [key.includes("L") ? -1 : 0, key.includes("R") ? 1 : 0]) {
    if (!sgn) continue;
    // up from the stem and round to the side
    const arc: number[][] = [];
    for (let k = 0; k <= 6; k++) {
      const t = (k / 6) * (Math.PI / 2);
      arc.push([sgn * (0.6 - 0.6 * Math.cos(t)), -0.4 + 0.6 * Math.sin(t)]);
    }
    arc.push([sgn * 0.75, 0.2]);
    stroke(arc);
    // (inside the lane: the tip stays clear of the line beside it)
    head([sgn * 1.4, 0.2], sgn, 0, 0.75, 0.45);
  }
  glyphs.set(key, tris);
  return tris;
}
