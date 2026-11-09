// 2D math on the ground plane. x = east, y = south (world z). Screen-aligned when the camera looks straight down.

export interface V2 {
  x: number;
  y: number;
}

export const v2 = (x: number, y: number): V2 => ({ x, y });
export const add = (a: V2, b: V2): V2 => ({ x: a.x + b.x, y: a.y + b.y });
export const sub = (a: V2, b: V2): V2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scale = (a: V2, s: number): V2 => ({ x: a.x * s, y: a.y * s });
export const dot = (a: V2, b: V2): number => a.x * b.x + a.y * b.y;
export const cross = (a: V2, b: V2): number => a.x * b.y - a.y * b.x;
export const len = (a: V2): number => Math.hypot(a.x, a.y);
export const dist = (a: V2, b: V2): number => Math.hypot(a.x - b.x, a.y - b.y);
export const dist2 = (a: V2, b: V2): number => (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
export const lerpV = (a: V2, b: V2, t: number): V2 => ({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t });
export const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);
export const norm = (a: V2): V2 => {
  const l = Math.hypot(a.x, a.y);
  return l > 1e-9 ? { x: a.x / l, y: a.y / l } : { x: 1, y: 0 };
};
/** Right-hand normal of a direction (screen space, y down): east -> south. */
export const right = (d: V2): V2 => ({ x: -d.y, y: d.x });
export const angleOf = (d: V2): number => Math.atan2(d.y, d.x);
export const fromAngle = (a: number): V2 => ({ x: Math.cos(a), y: Math.sin(a) });
/** Signed angle from a to b in (-PI, PI]. Positive = clockwise on screen (towards the right). */
export const signedAngle = (a: V2, b: V2): number => Math.atan2(cross(a, b), dot(a, b));
export const wrapAngle = (a: number): number => {
  while (a <= -Math.PI) a += Math.PI * 2;
  while (a > Math.PI) a -= Math.PI * 2;
  return a;
};
export const smoothstep = (t: number): number => t * t * (3 - 2 * t);

/** Intersection of segments p1-p2 and p3-p4. Returns parameters along each, or null. */
export function segIntersect(p1: V2, p2: V2, p3: V2, p4: V2): { t: number; u: number } | null {
  const d1x = p2.x - p1.x, d1y = p2.y - p1.y;
  const d2x = p4.x - p3.x, d2y = p4.y - p3.y;
  const den = d1x * d2y - d1y * d2x;
  if (Math.abs(den) < 1e-12) return null;
  const ex = p3.x - p1.x, ey = p3.y - p1.y;
  const t = (ex * d2y - ey * d2x) / den;
  const u = (ex * d1y - ey * d1x) / den;
  if (t < 0 || t > 1 || u < 0 || u > 1) return null;
  return { t, u };
}

/** Intersection of two infinite lines (point + direction). */
export function lineIntersect(p: V2, d: V2, q: V2, e: V2): { t: number; u: number } | null {
  const den = cross(d, e);
  if (Math.abs(den) < 1e-9) return null;
  const w = sub(q, p);
  return { t: cross(w, e) / den, u: cross(w, d) / den };
}

export function pointSegDist2(p: V2, a: V2, b: V2): { d2: number; t: number } {
  const abx = b.x - a.x, aby = b.y - a.y;
  const l2 = abx * abx + aby * aby;
  let t = l2 > 0 ? ((p.x - a.x) * abx + (p.y - a.y) * aby) / l2 : 0;
  t = clamp(t, 0, 1);
  const x = a.x + abx * t - p.x, y = a.y + aby * t - p.y;
  return { d2: x * x + y * y, t };
}

// ---------- Cubic Bezier ----------

export interface Cubic {
  p0: V2;
  p1: V2;
  p2: V2;
  p3: V2;
}

export function cubicAt(c: Cubic, t: number): V2 {
  const u = 1 - t;
  const a = u * u * u, b = 3 * u * u * t, d = 3 * u * t * t, e = t * t * t;
  return {
    x: a * c.p0.x + b * c.p1.x + d * c.p2.x + e * c.p3.x,
    y: a * c.p0.y + b * c.p1.y + d * c.p2.y + e * c.p3.y,
  };
}

export function cubicTangent(c: Cubic, t: number): V2 {
  const u = 1 - t;
  const a = 3 * u * u, b = 6 * u * t, d = 3 * t * t;
  const x = a * (c.p1.x - c.p0.x) + b * (c.p2.x - c.p1.x) + d * (c.p3.x - c.p2.x);
  const y = a * (c.p1.y - c.p0.y) + b * (c.p2.y - c.p1.y) + d * (c.p3.y - c.p2.y);
  if (x * x + y * y < 1e-12) return norm(sub(c.p3, c.p0));
  return norm({ x, y });
}

export function straightCubic(a: V2, b: V2): Cubic {
  return { p0: a, p1: lerpV(a, b, 1 / 3), p2: lerpV(a, b, 2 / 3), p3: b };
}

/** Quadratic (single control point) as a cubic. */
export function quadCubic(a: V2, q: V2, b: V2): Cubic {
  return { p0: a, p1: lerpV(a, q, 2 / 3), p2: lerpV(b, q, 2 / 3), p3: b };
}

/** Hermite-style cubic with given unit tangents at both ends. */
export function hermiteCubic(a: V2, ta: V2, b: V2, tb: V2, k = 0.38): Cubic {
  const d = dist(a, b) * k;
  return { p0: a, p1: add(a, scale(ta, d)), p2: sub(b, scale(tb, d)), p3: b };
}

/**
 * Circular arc that leaves `a` with unit tangent `ta` and passes through `b`, as cubic pieces of <= 90 deg each.
 * Falls back to a straight line when b lies (almost) on the tangent ray.
 */
export function tangentArc(a: V2, ta: V2, b: V2, maxPiece = Math.PI / 2): Cubic[] {
  const ab = sub(b, a);
  const n = right(ta);
  const h = dot(ab, n);
  const along = dot(ab, ta);
  // (only a straight when the end is in line to within ~0.1°: a curve carried on from the last must keep its heading)
  if (Math.abs(h) < 0.002 * Math.max(1, len(ab))) {
    return along > 0 ? [straightCubic(a, b)] : [];
  }
  const r = dot(ab, ab) / (2 * h); // signed radius along right normal
  const c = add(a, scale(n, r));
  const a0 = angleOf(sub(a, c));
  const a1 = angleOf(sub(b, c));
  // turning direction: r>0 means turning right (clockwise on screen, increasing angle)
  let sweep = wrapAngle(a1 - a0);
  if (r > 0 && sweep < 0) sweep += Math.PI * 2;
  if (r < 0 && sweep > 0) sweep -= Math.PI * 2;
  // (an end just behind the start would need a loop kilometres round: no road)
  if (Math.abs(sweep) > Math.PI * 1.5) return [];
  return arcCubics(c, Math.abs(r), a0, sweep, maxPiece);
}

/**
 * A slip road peeling off a carriageway as one easing curve: it leaves `a` exactly along `ta` with no curvature at all
 * (like a railway transition curve, so it drifts off the lane rather than swerving), and the bend tightens towards `b`.
 * Among a few shapes of that family, the first whose sharpest bend is no tighter than `rMin`; [] when none is.
 */
export function rampCurve(a: V2, ta: V2, b: V2, rMin: number): Cubic[] {
  const ab = sub(b, a);
  const n = right(ta);
  const along = dot(ab, ta), h = dot(ab, n);
  if (along < 8 || Math.abs(h) < 0.05 * len(ab)) return [];
  for (const k of [0, 0.15, 0.3, 0.45]) {
    // k = 0 is the cubic parabola y = h (x / along)^3; larger k starts bending sooner and arrives less steeply
    const c: Cubic = { p0: a, p1: add(a, scale(ta, along / 3)), p2: add(add(a, scale(ta, (2 * along) / 3)), scale(n, h * k)), p3: b };
    if (minRadius(sampleCubic(c, 1.5), 4) >= rMin) return [c];
  }
  return [];
}

/**
 * More single-curve shapes for a slip road leaving `a` along `ta` for `b`: the transition-curve family of rampCurve,
 * and curves that arrive a little steeper than the line from `a` to `b` (10 to 45 degrees more), with short to long
 * handles. The planner picks among them by how they come out once built.
 */
export function rampCurves(a: V2, ta: V2, b: V2): Cubic[] {
  const ab = sub(b, a), n = right(ta), along = dot(ab, ta), h = dot(ab, n), L = len(ab);
  if (L < 8 || Math.abs(h) < 0.05 * L) return [];
  const out: Cubic[] = [];
  if (along > 8) {
    for (const k of [0, 0.15, 0.3, 0.45]) {
      out.push({ p0: a, p1: add(a, scale(ta, along / 3)), p2: add(add(a, scale(ta, (2 * along) / 3)), scale(n, h * k)), p3: b });
    }
  }
  const s = Math.sign(h), chord = Math.atan2(Math.abs(h), along);
  for (const extra of [10, 20, 30, 45]) {
    const phi = Math.min(chord + (extra * Math.PI) / 180, (150 * Math.PI) / 180);
    const te = add(scale(ta, Math.cos(phi)), scale(n, s * Math.sin(phi)));
    for (const lam of [0.3, 0.42, 0.55]) out.push({ p0: a, p1: add(a, scale(ta, lam * L)), p2: sub(b, scale(te, lam * L)), p3: b });
  }
  return out;
}

/**
 * A ramp off a carriageway: leave `a` heading `ta`, turn on an arc of radius `rMax` until facing `b`, then run
 * straight to `b`. When `b` is inside that circle, a tighter arc (70% of the single arc through `b`, but no tighter
 * than `rMin`) and a short straight, so it doesn't swing round twice the angle it was drawn at. [] if b is behind.
 */
export function arcThenLine(a: V2, ta: V2, b: V2, rMax: number, rMin = 0): Cubic[] {
  const ab = sub(b, a);
  const n = right(ta);
  const h = dot(ab, n);
  if (Math.abs(h) < 0.05 * Math.max(1, len(ab))) return dot(ab, ta) > 0 ? [straightCubic(a, b)] : [];
  // pieces up to 150 deg (true to the circle within ~0.6% of the radius): the piece meeting the carriageway is one road
  // long enough to ease out beside it
  const piece = (5 * Math.PI) / 6;
  const r0 = dot(ab, ab) / (2 * Math.abs(h));
  if (r0 <= rMax) {
    const r = Math.max(rMin, r0 * 0.7);
    return r >= r0 - 0.5 ? tangentArc(a, ta, b, piece) : arcThenLine(a, ta, b, r, rMin);
  }
  const s = Math.sign(h); // +1: turning right (angles increase), as in tangentArc
  const c = add(a, scale(n, s * rMax));
  const cb = sub(b, c);
  const beta = Math.acos(clamp(rMax / len(cb), -1, 1));
  const phi = angleOf(cb);
  const a0 = angleOf(sub(a, c));
  for (const th of [phi + beta, phi - beta]) {
    const T = add(c, scale(fromAngle(th), rMax));
    // the tangent point where the arc's heading looks straight at b
    if (dot(fromAngle(th + (s * Math.PI) / 2), sub(b, T)) <= 0) continue;
    let sweep = wrapAngle(th - a0);
    if (s > 0 && sweep < 0) sweep += Math.PI * 2;
    if (s < 0 && sweep > 0) sweep -= Math.PI * 2;
    const arc = Math.abs(sweep) > 1e-4 ? arcCubics(c, rMax, a0, sweep, piece) : [];
    return dist(T, b) > 0.5 ? [...arc, straightCubic(T, b)] : arc;
  }
  return tangentArc(a, ta, b, piece);
}

export function arcCubics(c: V2, r: number, a0: number, sweep: number, maxPiece = Math.PI / 2): Cubic[] {
  const pieces = Math.max(1, Math.ceil(Math.abs(sweep) / maxPiece - 1e-6));
  const out: Cubic[] = [];
  const step = sweep / pieces;
  const k = (4 / 3) * Math.tan(step / 4);
  for (let i = 0; i < pieces; i++) {
    const s0 = a0 + step * i, s1 = s0 + step;
    const p0 = add(c, scale(fromAngle(s0), r));
    const p3 = add(c, scale(fromAngle(s1), r));
    const t0 = scale(fromAngle(s0 + Math.PI / 2), r * k);
    const t1 = scale(fromAngle(s1 + Math.PI / 2), r * k);
    out.push({ p0, p1: add(p0, t0), p2: sub(p3, t1), p3 });
  }
  return out;
}

/** Split a cubic at t (de Casteljau). */
export function splitCubic(c: Cubic, t: number): [Cubic, Cubic] {
  const p01 = lerpV(c.p0, c.p1, t), p12 = lerpV(c.p1, c.p2, t), p23 = lerpV(c.p2, c.p3, t);
  const p012 = lerpV(p01, p12, t), p123 = lerpV(p12, p23, t);
  const m = lerpV(p012, p123, t);
  return [
    { p0: c.p0, p1: p01, p2: p012, p3: m },
    { p0: m, p1: p123, p2: p23, p3: c.p3 },
  ];
}

// ---------- Polylines with arc-length ----------

export interface Polyline {
  pts: V2[];
  cum: number[]; // cumulative length at each point
  length: number;
}

export function makePolyline(pts: V2[]): Polyline {
  const cum = [0];
  for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1], pts[i]));
  return { pts, cum, length: cum[cum.length - 1] };
}

/** Binary search for the segment containing arc-length s. */
function findSeg(pl: Polyline, s: number): number {
  const cum = pl.cum;
  let lo = 0, hi = cum.length - 1;
  if (s <= 0) return 0;
  if (s >= pl.length) return Math.max(0, cum.length - 2);
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  return lo;
}

export function polyAt(pl: Polyline, s: number, out?: V2): V2 {
  const i = findSeg(pl, s);
  const a = pl.pts[i], b = pl.pts[Math.min(i + 1, pl.pts.length - 1)];
  const segLen = pl.cum[i + 1] - pl.cum[i] || 1;
  const t = clamp((s - pl.cum[i]) / segLen, 0, 1);
  const o = out ?? { x: 0, y: 0 };
  o.x = a.x + (b.x - a.x) * t;
  o.y = a.y + (b.y - a.y) * t;
  return o;
}

export function polyDir(pl: Polyline, s: number): V2 {
  const i = findSeg(pl, s);
  const a = pl.pts[i], b = pl.pts[Math.min(i + 1, pl.pts.length - 1)];
  return norm(sub(b, a));
}

/** Smoothed direction: average of directions slightly behind and ahead (avoids visible kinks on vehicles). */
export function polyDirSmooth(pl: Polyline, s: number, w = 1.5): V2 {
  const a = polyAt(pl, Math.max(0, s - w));
  const b = polyAt(pl, Math.min(pl.length, s + w));
  if (dist2(a, b) < 1e-8) return polyDir(pl, s);
  return norm(sub(b, a));
}

/** Closest point on polyline; returns arc-length and distance. */
export function polyClosest(pl: Polyline, p: V2): { s: number; d: number } {
  let best = Infinity, bestS = 0;
  for (let i = 0; i < pl.pts.length - 1; i++) {
    const r = pointSegDist2(p, pl.pts[i], pl.pts[i + 1]);
    if (r.d2 < best) {
      best = r.d2;
      bestS = pl.cum[i] + (pl.cum[i + 1] - pl.cum[i]) * r.t;
    }
  }
  return { s: bestS, d: Math.sqrt(best) };
}

/** Sample a cubic into a polyline with roughly `step` metre spacing (adaptive on curvature). */
export function sampleCubic(c: Cubic, step = 1.5): V2[] {
  // estimate length
  let est = 0;
  let prev = c.p0;
  for (let i = 1; i <= 16; i++) {
    const p = cubicAt(c, i / 16);
    est += dist(prev, p);
    prev = p;
  }
  const n = clamp(Math.ceil(est / step), 2, 600);
  // arc-length reparameterisation via a dense table so points are evenly spaced
  const dense = n * 4;
  const ts: number[] = [0];
  const cl: number[] = [0];
  prev = c.p0;
  for (let i = 1; i <= dense; i++) {
    const t = i / dense;
    const p = cubicAt(c, t);
    cl.push(cl[i - 1] + dist(prev, p));
    ts.push(t);
    prev = p;
  }
  const total = cl[dense];
  const pts: V2[] = [c.p0];
  let j = 0;
  for (let i = 1; i < n; i++) {
    const target = (total * i) / n;
    while (j < dense && cl[j + 1] < target) j++;
    const f = (target - cl[j]) / (cl[j + 1] - cl[j] || 1);
    pts.push(cubicAt(c, ts[j] + (ts[j + 1] - ts[j]) * f));
  }
  pts.push(c.p3);
  return pts;
}

/** Offset a polyline sideways (positive = right of travel direction). Uses averaged vertex normals. */
export function offsetPolyline(pts: V2[], off: number): V2[] {
  if (off === 0) return pts.slice();
  const out: V2[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)], b = pts[Math.min(pts.length - 1, i + 1)];
    const d = norm(sub(b, a));
    const r = right(d);
    out.push({ x: pts[i].x + r.x * off, y: pts[i].y + r.y * off });
  }
  return out;
}

/** Trim a polyline to arc-length range [s0, s1]. */
export function trimPolyline(pl: Polyline, s0: number, s1: number): V2[] {
  s0 = clamp(s0, 0, pl.length);
  s1 = clamp(s1, s0, pl.length);
  const out: V2[] = [polyAt(pl, s0)];
  for (let i = 0; i < pl.pts.length; i++) {
    if (pl.cum[i] > s0 + 1e-6 && pl.cum[i] < s1 - 1e-6) out.push(pl.pts[i]);
  }
  out.push(polyAt(pl, s1));
  return out;
}

/** Minimum turning radius along a polyline (approximate, via three-point circles). */
export function minRadius(pts: V2[], spacing = 4): number {
  const pl = makePolyline(pts);
  if (pl.length < spacing * 2.5) return Infinity;
  let minR = Infinity;
  for (let s = spacing; s < pl.length - spacing; s += spacing / 2) {
    const a = polyAt(pl, s - spacing), b = polyAt(pl, s), c = polyAt(pl, s + spacing);
    const ab = dist(a, b), bc = dist(b, c), ca = dist(c, a);
    const area2 = Math.abs(cross(sub(b, a), sub(c, a)));
    if (area2 < 1e-6) continue;
    const r = (ab * bc * ca) / (2 * area2);
    if (r < minR) minR = r;
  }
  return minR;
}

export function polygonContains(poly: V2[], p: V2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/** Oriented rectangle corners (center, half extents, rotation in radians). */
export function rectCorners(c: V2, hw: number, hd: number, rot: number): V2[] {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const ax = { x: cs, y: sn }, ay = { x: -sn, y: cs };
  return [
    add(c, add(scale(ax, -hw), scale(ay, -hd))),
    add(c, add(scale(ax, hw), scale(ay, -hd))),
    add(c, add(scale(ax, hw), scale(ay, hd))),
    add(c, add(scale(ax, -hw), scale(ay, hd))),
  ];
}

/** Distance from a point to an oriented rectangle (0 inside). */
export function rectDistance(p: V2, c: V2, hw: number, hd: number, rot: number): number {
  const cs = Math.cos(rot), sn = Math.sin(rot);
  const dx = p.x - c.x, dy = p.y - c.y;
  const lx = dx * cs + dy * sn, ly = -dx * sn + dy * cs;
  const qx = Math.max(Math.abs(lx) - hw, 0), qy = Math.max(Math.abs(ly) - hd, 0);
  return Math.hypot(qx, qy);
}

export function formatMoney(n: number): string {
  const s = Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return (n < 0 ? "-$" : "$") + s;
}
