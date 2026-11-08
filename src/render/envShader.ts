// The day and the seasons in the shaders: one set of uniforms every map material shares (set once a frame from
// render/daylight.ts), and the GLSL that recolours grass, leaves, roofs and yards with them. No mesh is duplicated
// for a season: snow, autumn colour and bare branches are all drawn by the materials the map already has.

import * as THREE from "three";
import type { Light, SeasonLook } from "./daylight";

/** The shared uniforms (the same objects in every material, so one write reaches all of them). */
export const ENV = {
  /** Seasons: x fresh, y lush, z dry, w fall. */
  uSeasonA: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** Seasons: x bare, y snow, z litter, w blossom. */
  uSeasonB: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** x frost on the water, y autumn's warmer light. */
  uSeasonC: { value: new THREE.Vector2(0, 0) },
  /** Ground-plane direction towards the light (unit, world x and y). */
  uSun: { value: new THREE.Vector2(-0.56, -0.83) },
  /** x drawn shadows' strength (1 at full sun), y their length against the art's noon shadow. */
  uShade: { value: new THREE.Vector2(1, 1) },
  /** x lamps (0 day .. 1 night), y darkness for the windows. */
  uNight: { value: new THREE.Vector2(0, 0) },
  /** x how far colour drains towards moonlit blue-grey at night (the eye's night vision). */
  uGrade: { value: new THREE.Vector2(0, 0) },
};
/** How much colour the night drains, by the Nights setting's darkness (full nights most). */
export const NIGHT_DESAT = 0.48;

/** Write a moment's light and season into the shared uniforms. */
export function setEnv(L: Light, S: SeasonLook) {
  ENV.uSeasonA.value.set(S.fresh, S.lush, S.dry, S.fall);
  ENV.uSeasonB.value.set(S.bare, S.snow, S.litter, S.blossom);
  ENV.uSeasonC.value.set(S.frost, S.warm);
  const h = Math.hypot(L.dir[0], L.dir[2]) || 1;
  ENV.uSun.value.set(L.dir[0] / h, L.dir[2] / h);
  ENV.uShade.value.set(L.shade, L.shadowLen);
  ENV.uNight.value.set(L.lamps, L.dark);
  // (soft nights, lighter, keep more of their colour)
  const lum = L.amb[0] * 0.2126 + L.amb[1] * 0.7152 + L.amb[2] * 0.0722;
  ENV.uGrade.value.set(NIGHT_DESAT * L.dark * (1 - Math.min(1, Math.max(0, (lum - 0.2) / 0.4))), 0);
}

const lin = (hex: number) => new THREE.Color(hex);
/** A colour as a GLSL vec3 (linear, as three's colour management stores it). */
export const v3 = (hex: number) => {
  const c = lin(hex);
  return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`;
};

/** Snow, as it shows from above in the noon light: a cool white, a touch blue in its hollows. */
export const SNOW = 0xe6eaee;
const SNOW_SHADE = 0xc9d3e0;

/**
 * The shared GLSL: the uniforms, a small noise, and the seasons' colour functions. Every name is prefixed `env` so
 * it can sit beside a material's own helpers.
 */
export const ENV_GLSL = /* glsl */ `
uniform vec4 uSeasonA; uniform vec4 uSeasonB; uniform vec2 uSeasonC;
uniform vec2 uSun; uniform vec2 uShade; uniform vec2 uNight; uniform vec2 uGrade;
#define envFresh uSeasonA.x
#define envLush uSeasonA.y
#define envDry uSeasonA.z
#define envFall uSeasonA.w
#define envBare uSeasonB.x
#define envSnow uSeasonB.y
#define envLitter uSeasonB.z
#define envBlossom uSeasonB.w
#define envFrost uSeasonC.x
/* Night drains colour towards a moonlit blue-grey (applied to every map surface's own colour). */
vec3 envGrade(vec3 c) {
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  return mix(c, l * vec3(0.86, 0.97, 1.18), uGrade.x);
}
float envHash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * 0.1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float envNoise(vec2 p) {
  vec2 i = floor(p), f = p - i;
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(envHash(i), envHash(i + vec2(1, 0)), u.x), mix(envHash(i + vec2(0, 1)), envHash(i + vec2(1, 1)), u.x), u.y);
}
/* Grass through the year, as a tint over the palette's dry-summer olive: spring's bright green, summer's deep green
   turning gold late on, autumn's brown olive, winter's dun (under the snow). */
vec3 envGrass(vec3 c) {
  vec3 t = vec3(1.0);
  t = mix(t, vec3(0.62, 0.95, 0.5), envLush);
  t = mix(t, vec3(1.3, 1.16, 1.0), envDry);
  t = mix(t, vec3(0.8, 1.14, 0.66), envFresh);
  t = mix(t, vec3(0.92, 0.8, 0.7), envFall * (1.0 - envDry * 0.5));
  t = mix(t, vec3(0.72, 0.66, 0.64), envBare * (1.0 - envFresh));
  c *= t;
  // (winter's grass is dead: a dun brown-grey, most of its colour gone)
  float w = envBare * (1.0 - envFresh) * 0.55;
  return mix(c, dot(c, vec3(0.2126, 0.7152, 0.0722)) * vec3(1.08, 1.0, 0.86), w);
}
/* How much snow lies at a ground point (0..1): drifts and bare patches at a few scales, more of it the deeper the
   winter; 'shelter' > 0 keeps it thinner (under eaves, on warm ground). */
float envSnowAt(vec2 p, float shelter) {
  if (envSnow <= 0.001) return 0.0;
  // (big drifts, smaller ones, clumps and a fine grain that frays their edges, each octave turned against the
  // last so the drifts never line up with the grid)
  vec2 q0 = mat2(0.96, 0.28, -0.28, 0.96) * p, q1 = mat2(0.8, -0.6, 0.6, 0.8) * p, q2 = mat2(0.28, 0.96, -0.96, 0.28) * p;
  vec2 q3 = mat2(-0.6, 0.8, -0.8, -0.6) * p;
  // (the fine ones fade to their average once under a few pixels across: a zoomed-out drift edge stays smooth,
  // not a fizz of pixels)
  float mpp = fwidth(p.x) + fwidth(p.y);
  float kC = 1.0 - smoothstep(0.25, 0.8, mpp), kB = 1.0 - smoothstep(1.2, 3.5, mpp);
  float n = envNoise(q0 / 39.0) * 0.5 + envNoise(q1 / 12.0 + 7.1) * 0.27
    + mix(0.5, envNoise(q2 / 3.3 - 2.7), kB) * 0.15 + mix(0.5, envNoise(q3 / 0.85 + 3.9), kC) * 0.08;
  float k = envSnow * (1.0 - shelter);
  float aa = max(fwidth(n), 0.004) * 1.5;
  return smoothstep(1.0 - k * 0.63 - aa, 1.0 - k * 0.63 + aa + 0.04, n) * smoothstep(0.0, 0.2, envSnow);
}
/* Snow's colour at a point: a little blue in the hollows. */
vec3 envSnowCol(vec2 p) {
  return mix(${v3(SNOW_SHADE)}, ${v3(SNOW)}, 0.55 + 0.45 * envNoise(p / 2.1));
}
/* A tree crown's colour through the year. summer: its colour as drawn now; tone: 0..1 per tree; h: another hash per
   tree (which trees are evergreen, blossom, which colour they turn); q: the point in the crown (-1..1); lit: its lit
   side 0..1. Returns rgb and a coverage (bare branches let the ground through). */
vec4 envLeaf(vec3 summer, float tone, float h, vec2 q, float lit, float evergreenShare) {
  float d = length(q);
  // (one return at the end: early returns make Direct3D's compiler warn)
  vec4 res;
  if (h < evergreenShare) {
    // conifers: dark all year, snow lying on their lit side in winter
    vec3 cv = summer * vec3(0.72, 0.86, 0.8);
    float sn = envSnow * smoothstep(0.35, 0.75, lit + envNoise(q * 4.0 + h * 40.0) * 0.5 - 0.2);
    res = vec4(mix(cv, ${v3(SNOW)} * (0.82 + 0.18 * lit), sn * 0.85), 1.0);
  } else {
  vec3 c = summer;
  // spring: a brighter, yellower new green; blossom on about a third, in mottled clusters
  c = mix(c, c * vec3(1.02, 1.16, 0.72), envFresh);
  c = mix(c, c * vec3(0.86, 0.98, 0.84), envLush);
  float hb = fract(h * 7.31);
  if (hb < 0.38 && envBlossom > 0.0) {
    float m = smoothstep(0.42, 0.62, envNoise(q * 5.0 + h * 31.0)) * envBlossom;
    vec3 bl = hb < 0.2 ? vec3(0.96, 0.78, 0.83) : vec3(0.97, 0.95, 0.93);
    c = mix(c, bl * (0.8 + 0.25 * lit), m);
  }
  // autumn: each tree its own colour, orange, red, gold or russet, with a few holding on to their green
  float ha = fract(h * 13.7 + tone * 0.3);
  vec3 au = ha < 0.3 ? ${v3(0xd0762c)} : ha < 0.52 ? ${v3(0xb2412b)} : ha < 0.78 ? ${v3(0xd8aa3a)} : ha < 0.92 ? ${v3(0x93602f)} : summer * vec3(0.95, 0.9, 0.6);
  au *= 0.72 + 0.4 * lit;
  float turn = envFall * smoothstep(0.0, 1.0, envFall * 1.3 - fract(h * 3.3) * 0.3);
  c = mix(c, au, turn);
  // bare: grey-brown branches from the trunk out, fine twigs between, the ground showing through; snow along them
  float bare = clamp(envBare * 1.15 - fract(h * 5.9) * 0.15, 0.0, 1.0);
  if (bare > 0.0) {
    float a = atan(q.y, q.x);
    float k = 7.0 + floor(fract(h * 9.1) * 4.0);
    float w = a * k / 6.2832 + h * 7.0 + d * (fract(h * 2.7) - 0.5) * 2.0;
    float br = abs(fract(w) - 0.5) * 6.2832 / k * d;
    float lim = 0.035 + 0.05 * (1.0 - d);
    float line = 1.0 - smoothstep(lim * 0.6, lim, br);
    float twig = smoothstep(0.5, 0.72, envNoise(q * 11.0 + h * 17.0)) * 0.75;
    float cov = max(line, twig) * (1.0 - smoothstep(0.75, 1.0, d)) + (1.0 - smoothstep(0.0, 0.18, d));
    cov = clamp(cov, 0.0, 1.0);
    vec3 wood = ${v3(0x6d5f52)} * (0.75 + 0.35 * lit);
    wood = mix(wood, ${v3(SNOW)} * (0.85 + 0.15 * lit), envSnow * smoothstep(0.3, 0.8, lit + twig * 0.4) * 0.8);
    // the last leaves hanging on as it goes bare
    vec3 leaves = mix(c, wood, smoothstep(0.2, 1.0, bare));
    res = vec4(mix(c, leaves, smoothstep(0.0, 0.5, bare)), mix(1.0, cov * 0.92, smoothstep(0.35, 1.0, bare)));
  } else {
    res = vec4(c, 1.0);
  }
  }
  return res;
}
`;

/**
 * The seasons on a Lambert material's own colours (vertex colours, instance colours or its colour): grass-green parts
 * take the season's grass, and snow settles on whatever faces up, drawn from the world position and normal. More of it
 * lies on roofs than on the ground (`roofs`), less where it is cleared or sheltered (`shelter`, 0..1), and none on the
 * dark asphalt and concrete a model stands on (its car park, its yard), which is ploughed.
 */
export function seasonal(mat: THREE.MeshLambertMaterial, opts: { roofs?: boolean; shelter?: number; key?: string } = {}): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, ENV);
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nvarying vec3 vEnvW; varying vec3 vEnvN;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  {
    mat4 envM = modelMatrix;
#ifdef USE_INSTANCING
    envM = modelMatrix * instanceMatrix;
#endif
    vEnvW = (envM * vec4(position, 1.0)).xyz;
    vEnvN = normalize(mat3(envM) * normal);
  }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${ENV_GLSL}\nvarying vec3 vEnvW; varying vec3 vEnvN;`)
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  {
    vec3 dc = diffuseColor.rgb;
    // (grass-green: a lawn, a field's verge, a park)
    float green = smoothstep(0.0, 0.05, dc.g - max(dc.r * 0.9, dc.b * 1.25));
    dc = mix(dc, envGrass(dc), green * step(vEnvW.y, 0.8));
    // (higher up, green is a tree's leaves: they turn and fall with the rest)
    if (vEnvW.y > 0.8 && green > 0.0) {
      vec2 tc = floor(vEnvW.xz / 5.0);
      vec4 lf = envLeaf(dc, envHash(tc + 1.7), envHash(tc + 8.3), vec2(0.0, 0.6), 0.6, 0.3);
      dc = mix(dc, lf.rgb, green);
    }
    if (envSnow > 0.001) {
      vec3 n = normalize(vEnvN);
      float up = smoothstep(0.45, 0.8, n.y);
      float l = dot(dc, vec3(0.2126, 0.7152, 0.0722));
      float sat = max(dc.r, max(dc.g, dc.b)) - min(dc.r, min(dc.g, dc.b));
      // (grey, darkish and low: asphalt, a yard's concrete, a drive: ploughed and swept)
      float paved = (1.0 - smoothstep(0.03, 0.06, sat)) * (1.0 - smoothstep(0.12, 0.3, l)) * (1.0 - smoothstep(0.3, 0.8, vEnvW.y));
      float roof = ${opts.roofs ? "smoothstep(0.6, 1.6, vEnvW.y)" : "0.0"};
      float s = envSnowAt(vEnvW.xz, mix(${(opts.shelter ?? 0).toFixed(2)}, -0.05, roof)) * up * (1.0 - paved * 0.92);
      dc = mix(dc, envSnowCol(vEnvW.xz) * (0.95 + 0.05 * n.y), s);
    }
    diffuseColor.rgb = envGrade(dc);
  }`,
      );
  };
  // (the program cache must tell this material's shader from another seasonal one with a different shader of its own)
  const own = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey() : prev?.toString() ?? "";
  const k = `${own}|${opts.key ?? "seasonal"}${opts.roofs ? "r" : ""}${opts.shelter ?? 0}`;
  mat.customProgramCacheKey = () => k;
  return mat;
}
