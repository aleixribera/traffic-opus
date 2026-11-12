// The day and the seasons in the shaders: one set of uniforms every map material shares (set once a frame from
// render/daylight.ts), and the GLSL that recolours grass, leaves, roofs and yards with them. No mesh is duplicated
// for a season: snow, autumn colour and bare branches are all drawn by the materials the map already has.

import * as THREE from "three";
import type { Light, SeasonLook } from "./daylight";
import type { Weather } from "../game/weather";
import { LAND } from "./palette";

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
  /** How far the view has gone over to the road atlas (0 the diorama .. 1 the far map; render/terrain3d.ts sets it). */
  uEnvAtlas: { value: 0 },
  /** The weather (game/weather.ts): x how wet the ground is, y rain falling, z mist, w snow falling. */
  uWeather: { value: new THREE.Vector4(0, 0, 0, 0) },
  /** The rain's clock (s, wrapped): rings spreading on the puddles. */
  uWetT: { value: 0 },
};

/** Write the weather into the shared uniforms. */
export function setWeather(W: Weather) {
  ENV.uWeather.value.set(W.wet, W.rain, W.mist, W.snow);
}
/**
 * The share of each kind's windows lit now (x home, y shop, z office, w hall): the buildings' lit glass and the light
 * it throws on the ground (render/lamps3d.ts, which sets it each frame) read the same numbers.
 */
export const LIT = { uLit: { value: new THREE.Vector4(0, 0, 0, 0) } };
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

/** A bare tree's wood: the grey-brown of limbs and twigs. */
export const WOOD = 0x6d5f52;

/**
 * The part of the shared GLSL a vertex shader can use too (no screen derivatives): the uniforms, a small noise, and
 * the seasons' colours for grass and for a tree's leaves, needles and wood. Every name is prefixed `env` so it can
 * sit beside a material's own helpers.
 */
export const ENV_CORE_GLSL = /* glsl */ `
uniform vec4 uSeasonA; uniform vec4 uSeasonB; uniform vec2 uSeasonC;
uniform vec2 uSun; uniform vec2 uShade; uniform vec2 uNight; uniform vec2 uGrade; uniform float uEnvAtlas;
uniform vec4 uWeather; uniform float uWetT;
#define envWet uWeather.x
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
/* Grass through the year, as a tint over the palette's olive: spring's fresh green, summer's deep green, late
   summer paler (and gold only where the ground is driest: 'dry' 0 damp .. 1 parched), autumn's ochre with the green
   holding in the damp ground, winter's dun (under the snow). The one place the land's greens are decided: the open
   ground, a lawn, a park, a road's verge all pass their colour through here, so they turn together. */
vec3 envGrassAt(vec3 c, float dry) {
  // (the tints are worked out against the noon light, which lifts the palette's olive by nearly a half)
  vec3 t = vec3(0.38, 0.72, 0.44);
  t = mix(t, vec3(0.31, 0.66, 0.4), envLush);
  t = mix(t, mix(vec3(0.41, 0.66, 0.46), vec3(0.9, 0.8, 0.72), smoothstep(0.5, 0.95, dry)), envDry);
  t = mix(t, vec3(0.44, 0.77, 0.47), envFresh);
  // (autumn: the green holds in the low and grazed ground, the rest goes ochre, the driest rises rust)
  vec3 fall = mix(vec3(0.36, 0.6, 0.4), vec3(0.6, 0.6, 0.56), smoothstep(0.24, 0.74, dry));
  fall = mix(fall, vec3(0.68, 0.56, 0.54), smoothstep(0.74, 1.0, dry));
  t = mix(t, fall, envFall * (1.0 - envDry * 0.5));
  t = mix(t, vec3(0.72, 0.66, 0.64), envBare * (1.0 - envFresh));
  c *= t;
  // (winter's grass is dead: a dun brown-grey, most of its colour gone)
  float w = envBare * (1.0 - envFresh) * 0.55;
  return mix(c, dot(c, vec3(0.2126, 0.7152, 0.0722)) * vec3(1.08, 1.0, 0.86), w);
}
/* (ordinary ground: a lawn, a verge) */
vec3 envGrass(vec3 c) { return envGrassAt(c, 0.38); }
/* A broadleaf's leaves through the year, while it has them. summer: their colour as drawn now; tone: 0..1 per tree;
   h: another hash per tree (whether it blossoms, which colour it turns, when); lit: its lit side 0..1; m: how much of
   this spot is blossom on a tree that flowers (0..1: mottled clusters). The painted crowns and the 3D trees both
   colour their leaves with this, so a tree keeps its colour when one stands in for the other. */
vec3 envFoliage(vec3 summer, float tone, float h, float lit, float m) {
  vec3 c = summer;
  // spring: a brighter, yellower new green; blossom on about a third
  c = mix(c, c * vec3(1.02, 1.16, 0.72), envFresh);
  c = mix(c, c * vec3(0.86, 0.98, 0.84), envLush);
  float hb = fract(h * 7.31);
  if (hb < 0.38 && envBlossom > 0.0) {
    vec3 bl = hb < 0.2 ? vec3(0.96, 0.78, 0.83) : vec3(0.97, 0.95, 0.93);
    c = mix(c, bl * (0.8 + 0.25 * lit), m * envBlossom);
  }
  // autumn: each tree its own colour, orange, red, gold or russet, with a few holding on to their green
  float ha = fract(h * 13.7 + tone * 0.3);
  vec3 au = ha < 0.3 ? ${v3(0xd0762c)} : ha < 0.52 ? ${v3(0xb2412b)} : ha < 0.78 ? ${v3(0xd8aa3a)} : ha < 0.92 ? ${v3(0x93602f)} : summer * vec3(0.95, 0.9, 0.6);
  au *= 0.72 + 0.4 * lit;
  float turn = envFall * smoothstep(0.0, 1.0, envFall * 1.3 - fract(h * 3.3) * 0.3);
  return mix(c, au, turn);
}
/* How bare a broadleaf stands (0 in leaf .. 1 bare): each tree drops its leaves a little before or after the rest. */
float envBareOf(float h) { return clamp(envBare * 1.15 - fract(h * 5.9) * 0.15, 0.0, 1.0); }
/* A bare tree's wood; sn: how much snow lies along it here (0..1). */
vec3 envWood(float lit, float sn) {
  return mix(${v3(WOOD)} * (0.75 + 0.35 * lit), ${v3(SNOW)} * (0.85 + 0.15 * lit), envSnow * sn * 0.8);
}
/* A conifer: dark all year; sn: how much snow lies on it here (0..1). */
vec3 envConifer(vec3 summer, float lit, float sn) {
  return mix(summer * vec3(0.72, 0.86, 0.8), ${v3(SNOW)} * (0.82 + 0.18 * lit), envSnow * sn * 0.85);
}
`;

/** The shared GLSL for a fragment shader: the above, the snow lying on the ground, and a painted crown. */
export const ENV_GLSL = /* glsl */ `
${ENV_CORE_GLSL}
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
  // (in deep winter it lies nearly everywhere; while it comes and goes, in drifts with the ground showing between)
  return smoothstep(1.0 - k * 0.72 - aa, 1.0 - k * 0.72 + aa + 0.04, n) * smoothstep(0.0, 0.2, envSnow);
}
/* The same in two steps, for a shader that asks inside a branch (a derivative there makes Direct3D's compiler run
   both sides of the branch for every pixel): the drifts' noise at p and the width of a soft edge in it, worked out
   from the size of a pixel on the ground (mppS: its two sides added, fwidth(p.x) + fwidth(p.y)); then the snow. */
vec2 envSnowNoise(vec2 p, float mppS) {
  vec2 q0 = mat2(0.96, 0.28, -0.28, 0.96) * p, q1 = mat2(0.8, -0.6, 0.6, 0.8) * p, q2 = mat2(0.28, 0.96, -0.96, 0.28) * p;
  vec2 q3 = mat2(-0.6, 0.8, -0.8, -0.6) * p;
  float kC = 1.0 - smoothstep(0.25, 0.8, mppS), kB = 1.0 - smoothstep(1.2, 3.5, mppS);
  float n = envNoise(q0 / 39.0) * 0.5 + envNoise(q1 / 12.0 + 7.1) * 0.27
    + mix(0.5, envNoise(q2 / 3.3 - 2.7), kB) * 0.15 + mix(0.5, envNoise(q3 / 0.85 + 3.9), kC) * 0.08;
  // (the noise's own slope, octave by octave, times the pixel)
  return vec2(n, max(mppS * (0.013 + 0.024 * kB + 0.05 * kC), 0.004) * 1.5);
}
float envSnowOf(vec2 na, float shelter) {
  float k = envSnow * (1.0 - shelter);
  return smoothstep(1.0 - k * 0.72 - na.y, 1.0 - k * 0.72 + na.y + 0.04, na.x) * smoothstep(0.0, 0.2, envSnow);
}
/* Rain on a hard surface (p: a point on it, m; rough: 0 smooth asphalt .. 1 a rutted yard): how much of it is
   standing water (0..1). The surface darkens as it wets, and puddles gather in its low spots; while rain falls,
   rings spread on them. Returns the puddle share; c is darkened in place and given the sky's sheen in the puddles.
   mpp: the size of a pixel on the ground (m; taken outside any branch, as fwidth must be). */
float envPuddle(inout vec3 c, vec2 p, float rough, float mpp) {
  float w = envWet;
  // wet paving goes dark
  c *= 1.0 - 0.4 * w;
  // the sky in it: an overcast grey by day (the light dims it at night, and the lamps' pools brighten it)
  vec3 sky = vec3(0.3, 0.33, 0.38);
  // far out a puddle is smaller than a pixel: the wet road only takes a faint sheen of the sky
  float near = 1.0 - smoothstep(0.35, 1.1, mpp);
  c = mix(c, sky, 0.1 * w * (1.0 - near));
  if (near < 0.001) return 0.0;
  // (two octaves turned against each other, so no grid shows in the edges)
  vec2 pr = mat2(0.8, -0.6, 0.6, 0.8) * p;
  float n = envNoise(p * 0.22 + 3.7) * 0.7 + envNoise(pr * 0.8 - 1.3) * 0.3;
  // (more of it standing as it gets wetter; a rough yard holds more than a crowned road)
  float th = 0.88 - 0.08 * w - 0.1 * rough;
  float aa = max(mpp * 0.35, 0.004);
  float pud = smoothstep(th - aa, th + aa, n) * smoothstep(0.25, 0.7, w) * near;
  if (pud > 0.001) {
    // rings spreading where drops land (only near in, while it rains)
    float rings = 0.0;
    if (uWeather.y > 0.01 && mpp < 0.35) {
      vec2 q = p / 0.9, cell = floor(q), f = fract(q) - 0.5;
      float h = envHash(cell);
      float age = fract(uWetT * (0.9 + 0.5 * h) + h * 7.0);
      float r = age * 0.42, d = length(f - (vec2(envHash(cell + 3.1), envHash(cell + 5.7)) - 0.5) * 0.3);
      rings = (1.0 - smoothstep(0.0, 0.035, abs(d - r))) * (1.0 - age) * uWeather.y * (1.0 - smoothstep(0.15, 0.35, mpp));
    }
    float rim = smoothstep(th - aa, th + aa, n) - smoothstep(th + aa, th + 3.0 * aa + 0.01, n);
    c = mix(c, sky * 0.82 * (1.0 + 0.6 * rings), pud * 0.55) * (1.0 - 0.15 * rim);
  }
  return pud;
}
/* Snow's colour at a point: a little blue in the hollows. */
vec3 envSnowCol(vec2 p) {
  return mix(${v3(SNOW_SHADE)}, ${v3(SNOW)}, 0.55 + 0.45 * envNoise(p / 2.1));
}
/* A painted tree crown's colour through the year. summer: its colour as drawn now; tone: 0..1 per tree; h: another
   hash per tree (which trees are evergreen, blossom, which colour they turn); q: the point in the crown (-1..1); lit:
   its lit side 0..1. Returns rgb and a coverage (bare branches let the ground through). */
vec4 envLeaf(vec3 summer, float tone, float h, vec2 q, float lit, float evergreenShare) {
  float d = length(q);
  // (one return at the end: early returns make Direct3D's compiler warn)
  vec4 res;
  if (h < evergreenShare) {
    // conifers: dark all year, snow lying on their lit side in winter
    res = vec4(envConifer(summer, lit, smoothstep(0.35, 0.75, lit + envNoise(q * 4.0 + h * 40.0) * 0.5 - 0.2)), 1.0);
  } else {
  // (blossom in mottled clusters)
  vec3 c = envFoliage(summer, tone, h, lit, smoothstep(0.42, 0.62, envNoise(q * 5.0 + h * 31.0)));
  // bare: grey-brown branches from the trunk out, fine twigs between, the ground showing through; snow along them
  float bare = envBareOf(h);
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
    vec3 wood = envWood(lit, smoothstep(0.3, 0.8, lit + twig * 0.4));
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
 *
 * `windows`: the model's glass lights at night. Its vertices carry `lit` (render/models.ts: 0 a wall; else 1 + the
 * window's kind + the pane's own random share): a pane is lit while the share of its kind's windows lit at this
 * hour (LIT) is above its own number, so a street's windows come on and go out one by one through the evening; a
 * sign glows in its own colour as long as the street lamps burn. A building drawn dark (abandoned) stays dark.
 */
export function seasonal(mat: THREE.MeshLambertMaterial, opts: { roofs?: boolean; shelter?: number; key?: string; windows?: boolean; atlas?: "park" } = {}): THREE.MeshLambertMaterial {
  const prev = mat.onBeforeCompile;
  mat.onBeforeCompile = (sh, r) => {
    prev?.call(mat, sh, r);
    Object.assign(sh.uniforms, ENV);
    if (opts.windows) Object.assign(sh.uniforms, LIT);
    const litVert = opts.windows
      ? `
    vLit = vec2(lit, 0.0);
#ifdef USE_INSTANCING
    vLit.y = fract(sin(dot(instanceMatrix[3].xz, vec2(12.9898, 78.233))) * 43758.5453);
#endif
#ifdef USE_INSTANCING_COLOR
    if (instanceColor.g < 0.4) vLit.x = 0.0;
#endif`
      : "";
    const litFrag = opts.windows
      ? `
    if (vLit.x > 0.5 && uNight.x + uNight.y > 0.002) {
      float kind = floor(vLit.x);
      float rnd = fract(fract(vLit.x) + vLit.y);
      if (kind > 4.5) {
        // a sign, a marquee: its own paint lit, as long as the lamps burn
        totalEmissiveRadiance += dc * 1.25 * uNight.x;
        diffuseColor.rgb *= 1.0 - 0.7 * uNight.x;
      } else {
        float occ = kind < 1.5 ? uLit.x : kind < 2.5 ? uLit.y : kind < 3.5 ? uLit.z : uLit.w;
        float on = step(rnd, occ) * smoothstep(0.08, 0.5, uNight.y);
        float r2 = fract(rnd * 7.13 + vLit.y * 3.7);
        // homes: lamplight behind curtains, each its own; shops: bright show windows, one warmer or dimmer than the
        // next; offices: a paler, steadier light
        vec3 glow = kind < 1.5 ? mix(vec3(1.0, 0.56, 0.2), vec3(1.0, 0.74, 0.4), r2) * (0.62 + 0.38 * fract(r2 * 5.3))
          : kind < 2.5 ? mix(vec3(1.0, 0.7, 0.34), vec3(1.0, 0.84, 0.52), r2) * (0.8 + 0.2 * fract(r2 * 5.3))
          : kind < 3.5 ? mix(vec3(0.98, 0.72, 0.4), vec3(0.94, 0.82, 0.56), r2) * (0.68 + 0.2 * fract(r2 * 3.7))
          : vec3(1.0, 0.76, 0.42);
        totalEmissiveRadiance += glow * on;
        diffuseColor.rgb *= 1.0 - on;
      }
    }`
      : "";
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", `#include <common>\nvarying vec3 vEnvW; varying vec3 vEnvN;${opts.windows ? "\nattribute float lit; varying vec2 vLit;" : ""}`)
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  {
    mat4 envM = modelMatrix;
#ifdef USE_INSTANCING
    envM = modelMatrix * instanceMatrix;
#endif
    vEnvW = (envM * vec4(position, 1.0)).xyz;
    vEnvN = normalize(mat3(envM) * normal);${litVert}
  }`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", `#include <common>\n${ENV_GLSL}\nvarying vec3 vEnvW; varying vec3 vEnvN;${opts.windows ? "\nuniform vec4 uLit; varying vec2 vLit;" : ""}`)
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
      // (a blue-green one is a pine: evergreen, whatever the others do)
      vec4 lf = envLeaf(dc, envHash(tc + 1.7), envHash(tc + 8.3), vec2(0.0, 0.6), 0.6, dc.b > dc.r ? 1.01 : 0.3);
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
    // after rain whatever faces up is darker for a while, paving most (a yard, a car park holds puddles); green
    // things a little
    float wMpp = fwidth(vEnvW.x) + fwidth(vEnvW.z);
    if (envWet > 0.001) {
      float wsat = max(dc.r, max(dc.g, dc.b)) - min(dc.r, min(dc.g, dc.b));
      float wl = dot(dc, vec3(0.2126, 0.7152, 0.0722));
      float up = smoothstep(0.5, 0.9, normalize(vEnvN).y);
      float pave = (1.0 - smoothstep(0.03, 0.07, wsat)) * (1.0 - smoothstep(0.15, 0.4, wl)) * (1.0 - smoothstep(0.3, 0.8, vEnvW.y));
      if (pave > 0.5 && up > 0.5) envPuddle(dc, vEnvW.xz, 0.6, wMpp);
      else dc *= 1.0 - envWet * up * mix(0.14, 0.08, green);
    }
    // far out the page is a road atlas (render/terrain3d.ts): a lot's lawn goes the built-up wash of its town, a
    // park its own pale green, paving near the paper, and whatever is built a warm block
    if (uEnvAtlas > 0.001) {
      float al = dot(dc, vec3(0.3, 0.55, 0.15));
      float asat = max(dc.r, max(dc.g, dc.b)) - min(dc.r, min(dc.g, dc.b));
      float low = 1.0 - smoothstep(0.5, 1.0, vEnvW.y);
      vec3 ac = mix(${v3(0x8a5340)}, ${v3(0xc99a80)}, smoothstep(0.08, 0.6, al));
      ac = mix(ac, ${v3(0xddd3bd)}, (1.0 - smoothstep(0.03, 0.08, asat)) * low);
      ac = mix(ac, mix(${v3(opts.atlas === "park" ? LAND.wood : LAND.town)}, ${v3(LAND.snow)}, envSnow * 0.55), green * low);
      ac = mix(ac, ${v3(LAND.woodInk)}, green * (1.0 - low) * 0.8);
      dc = mix(dc, ac, uEnvAtlas);
    }
    diffuseColor.rgb = envGrade(dc);${litFrag}
  }`,
      );
  };
  // (the program cache must tell this material's shader from another seasonal one with a different shader of its own)
  const own = mat.customProgramCacheKey !== THREE.Material.prototype.customProgramCacheKey ? mat.customProgramCacheKey() : prev?.toString() ?? "";
  const k = `${own}|${opts.key ?? "seasonal"}${opts.roofs ? "r" : ""}${opts.windows ? "w" : ""}${opts.atlas ?? ""}${opts.shelter ?? 0}`;
  mat.customProgramCacheKey = () => k;
  return mat;
}
