// The Diorama camera's geometry, as pure maths (no three.js, no DOM): an orthographic camera looking at the ground
// point (cx, cy), turned by `rot` about the vertical and pitched by `tilt` from straight down. World (x, y) is the
// ground plane (three's x, z); h is the height above it (three's y).
//
// Screen right is (cos rot, sin rot) on the ground whatever the tilt; screen up is "away from the camera", along
// f = (sin rot, -cos rot), foreshortened by cos tilt; a metre of height lifts a point sin tilt metres up the screen.
// So a pixel is not a ground point any more but a line of sight: it meets each height at a different ground point
// (GroundRay), and everything that turns pixels into world or back goes through the two helpers here.

import type { V2 } from "../core/math";

/** The lowest the camera pitches: 58° from straight down (32° above the horizon). */
export const TILT_MAX = (58 * Math.PI) / 180;
/** The Diorama's own pitch: 40° from straight down (50° above the horizon). */
export const TILT_DEFAULT = (40 * Math.PI) / 180;
/** Below this the view counts as the Map view (straight down). */
export const TILT_MAP = (0.5 * Math.PI) / 180;

/** The closest the camera comes: half the visible height, in metres. */
export const MIN_HALF_H = 28;

/**
 * The camera rises as it pulls back. Up to RISE_FROM (half the visible height, m) the pitch drawn is the pitch
 * asked for; from there it eases up to straight down at RISE_TO, and stays there. Far out a tilt shows no building's
 * side (they are specks) and only squashes the map, so the far view is the map itself; zooming back in brings the
 * pitch back. Eased on the logarithm of the zoom, so each wheel notch lifts the camera by a like amount.
 */
export const RISE_FROM = 480;
export const RISE_TO = 2200;

/** How much of the pitch asked for is drawn at this zoom: 1 close in, 0 far out. */
export function riseShare(halfH: number): number {
  if (halfH <= RISE_FROM) return 1;
  if (halfH >= RISE_TO) return 0;
  const k = Math.log(halfH / RISE_FROM) / Math.log(RISE_TO / RISE_FROM);
  // (smootherstep: no kink where the rise begins or ends, in the pitch or in how fast it changes)
  return 1 - k * k * k * (k * (k * 6 - 15) + 10);
}

/** The pitch drawn at a zoom for the pitch asked for (radians from straight down). */
export function risenTilt(pitch: number, halfH: number): number {
  return pitch * riseShare(halfH);
}

export interface ViewPose {
  /** the ground point at the middle of the screen (m) */
  cx: number;
  cy: number;
  /** half the visible height, in metres across the line of sight (the scale: a pixel is 2·halfH/h metres wide) */
  halfH: number;
  /** the turn about the vertical (radians; 0: north, -y, is up the screen) */
  rot: number;
  /** the pitch from straight down (radians; 0: the Map view) */
  tilt: number;
  /** the canvas, in CSS pixels */
  w: number;
  h: number;
}

/** The line of sight through a pixel: it meets height h at the ground point (x + kx·h, y + ky·h). */
export interface GroundRay { x: number; y: number; kx: number; ky: number }

/** Where a line of sight meets height h. */
export function rayAt(r: GroundRay, h: number): V2 {
  return { x: r.x + r.kx * h, y: r.y + r.ky * h };
}

/** Metres per CSS pixel, across the screen. */
export const mppOf = (v: ViewPose) => (v.halfH * 2) / v.h;

/** CSS pixel -> the ground point seen there on the plane at height h. */
export function screenToGround(v: ViewPose, px: number, py: number, h = 0): V2 {
  const m = mppOf(v), c = Math.cos(v.rot), s = Math.sin(v.rot);
  const a = (px - v.w / 2) * m;
  const d = ((py - v.h / 2) * m + h * Math.sin(v.tilt)) / Math.cos(v.tilt);
  return { x: v.cx + a * c - d * s, y: v.cy + a * s + d * c };
}

/** A world point (x, y on the ground, h above it) -> CSS pixel. */
export function worldToScreen(v: ViewPose, x: number, y: number, h = 0): V2 {
  const m = mppOf(v), c = Math.cos(v.rot), s = Math.sin(v.rot);
  const dx = x - v.cx, dy = y - v.cy;
  return { x: (dx * c + dy * s) / m + v.w / 2, y: ((-dx * s + dy * c) * Math.cos(v.tilt) - h * Math.sin(v.tilt)) / m + v.h / 2 };
}

/** The line of sight through a CSS pixel. */
export function groundRay(v: ViewPose, px: number, py: number): GroundRay {
  const p = screenToGround(v, px, py, 0), k = Math.tan(v.tilt);
  return { x: p.x, y: p.y, kx: -Math.sin(v.rot) * k, ky: Math.cos(v.rot) * k };
}

/**
 * Frame a set of world points (x, y on the ground, h above it): the closest view, at this turn and pitch, that
 * holds them all inside the screen less `inset` (CSS pixels kept clear at each edge: the bars and panels), and the
 * centre that puts them in the middle of what is left. The zoom is kept between `minH` and `maxH` (half heights): a
 * place too big for maxH is shown centred, with its edges off screen.
 */
export function frameFit(
  pts: readonly { x: number; y: number; h?: number }[], rot: number, tilt: number, w: number, h: number,
  inset: { l: number; t: number; r: number; b: number }, minH: number, maxH: number,
): { cx: number; cy: number; halfH: number } {
  const c = Math.cos(rot), s = Math.sin(rot), ct = Math.cos(tilt), st = Math.sin(tilt);
  // each point across the screen (u, m) and down it (v, m of screen, the ground foreshortened and heights lifted)
  let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
  for (const p of pts) {
    const u = p.x * c + p.y * s, v = (-p.x * s + p.y * c) * ct - (p.h ?? 0) * st;
    if (u < u0) u0 = u;
    if (u > u1) u1 = u;
    if (v < v0) v0 = v;
    if (v > v1) v1 = v;
  }
  if (!pts.length) u0 = u1 = v0 = v1 = 0;
  const sw = Math.max(1, w - inset.l - inset.r), sh = Math.max(1, h - inset.t - inset.b);
  const mpp = Math.max((u1 - u0) / sw, (v1 - v0) / sh);
  const halfH = Math.min(maxH, Math.max(minH, (mpp * h) / 2));
  // the middle of the points sits at the middle of the clear part of the screen
  const m = (halfH * 2) / h;
  const u = (u0 + u1) / 2 - ((inset.l - inset.r) / 2) * m, v = (v0 + v1) / 2 - ((inset.t - inset.b) / 2) * m;
  const d = v / ct;
  return { cx: u * c - d * s, cy: u * s + d * c, halfH };
}

/**
 * The ground the screen shows, as a quad (top-left, top-right, bottom-right, bottom-left of the screen). With
 * `hMax`, the quad reaches toward the camera far enough to hold whatever stands just below the screen's bottom edge
 * and is tall enough (up to hMax) to lean into view.
 */
export function footprint(v: ViewPose, hMax = 0): [V2, V2, V2, V2] {
  return [screenToGround(v, 0, 0, 0), screenToGround(v, v.w, 0, 0), screenToGround(v, v.w, v.h, hMax), screenToGround(v, 0, v.h, hMax)];
}

/** The world-axis box round the footprint (plus `pad` metres all round). */
export function groundBounds(v: ViewPose, hMax = 0, pad = 0): { x0: number; y0: number; x1: number; y1: number } {
  const q = footprint(v, hMax);
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const p of q) {
    if (p.x < x0) x0 = p.x;
    if (p.x > x1) x1 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.y > y1) y1 = p.y;
  }
  return { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
}

/** How far back the camera stands beyond the furthest ground it sees (m): room for anything up to ~500 m tall. */
const STANDOFF = 1000;

/**
 * Where the three.js camera goes (three coordinates: x, height, y): its position, its up vector, and the near and
 * far planes that hold everything on screen at this zoom and pitch (the ground to the screen's far edge, and
 * anything a few hundred metres tall at its near edge). Orthographic, so the distance only matters for clipping.
 */
export function cameraRig(v: ViewPose): { pos: [number, number, number]; up: [number, number, number]; near: number; far: number } {
  const fx = Math.sin(v.rot), fy = -Math.cos(v.rot), st = Math.sin(v.tilt), ct = Math.cos(v.tilt);
  const reach = v.halfH * Math.tan(v.tilt);
  const D = reach + STANDOFF;
  return {
    pos: [v.cx - fx * st * D, ct * D, v.cy - fy * st * D],
    up: [fx * ct, st, fy * ct],
    near: 1,
    far: D + reach + 300,
  };
}

/** The tallest thing whose shadow (and whose top, leaning in from below the screen) the sun's frustum is fitted to (m). */
export const CASTER_H = 70;

export interface ShadowFit {
  /** what the light aims at and where it stands (three coordinates) */
  target: [number, number, number];
  pos: [number, number, number];
  /** half the side of the square the shadow map covers, across the light (m) */
  ext: number;
  near: number;
  far: number;
  /** a shadow-map texel on the ground (m) */
  texel: number;
}

/**
 * Fit the sun's shadow frustum to what is on screen: a square across the light that holds the whole ground
 * footprint (and the tall things leaning in from below it) at any turn, deep enough along the light for the long
 * shadows of a low sun, and snapped to whole shadow texels in the light's own frame so shadows stay still while
 * the map pans. `sun` points from the ground to the sun (unit, three coordinates).
 */
export function shadowFit(v: ViewPose, sun: readonly [number, number, number], mapSize: number): ShadowFit {
  const halfW = v.halfH * (v.w / v.h);
  const lean = CASTER_H * Math.tan(v.tilt);
  const depth = v.halfH / Math.cos(v.tilt) + lean / 2;
  // the middle of the footprint: toward the camera from the screen's centre by half the lean
  const fx = Math.sin(v.rot), fy = -Math.cos(v.rot);
  const mx = v.cx - (fx * lean) / 2, my = v.cy - (fy * lean) / 2;
  // (the circle round the footprint: the same at every turn, so turning the view never resizes the map)
  const ext = Math.hypot(halfW, depth) * 1.04 + 24;
  const texel = (ext * 2) / mapSize;
  // the light's frame: z toward the sun, x level, y the rest (as three's lookAt builds it)
  const [zx, zy, zz] = sun;
  let xx = zz, xz = -zx;
  const xl = Math.hypot(xx, xz);
  if (xl < 1e-5) { xx = 1; xz = 0; } else { xx /= xl; xz /= xl; }
  const yx = zy * xz, yy = zz * xx - zx * xz, yz = -zy * xx;
  // snap the target to whole texels along the light's x and y
  const a = mx * xx + my * xz, b = mx * yx + my * yz;
  const da = Math.round(a / texel) * texel - a, db = Math.round(b / texel) * texel - b;
  const tx = mx + xx * da + yx * db, ty = yy * db, tz = my + xz * da + yz * db;
  // along the light: back far enough for a tall caster's shadow reaching the far side of the footprint
  const dist = ext + CASTER_H / Math.max(0.12, zy) + 20;
  return { target: [tx, ty, tz], pos: [tx + zx * dist, ty + zy * dist, tz + zz * dist], ext, near: 1, far: dist + ext + 60, texel };
}
