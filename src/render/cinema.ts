// The camera's automatic modes, as pure logic (no DOM, no three.js): following a vehicle with a damped look-ahead,
// and the cinematic camera's spots, shots and fades. The director (ui/camera.ts) feeds these the game's state and
// moves the view with them. Nothing here allocates per frame: the per-shot work (gathering spots, picking the next)
// runs once every ten seconds or so.

/** Where the camera is: centre (world m), half the visible height (m) and turn (radians, as View.rot). */
export interface Pose { x: number; y: number; h: number; rot: number }

// ------------------------------------------------------------------------------------------- follow damping

/**
 * A critically damped spring in 2D, stepped with its exact solution: stable and free of overshoot from rest at any
 * time step (a 0.1 s frame hitch or a long one), so a followed vehicle never shakes the camera.
 */
export class Spring2 {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  /** stiffness (1/s): ~4 settles in about a second */
  constructor(public omega = 4) {}

  reset(x: number, y: number) {
    this.x = x;
    this.y = y;
    this.vx = 0;
    this.vy = 0;
  }

  /** Move toward (tx, ty) over dt seconds. */
  step(tx: number, ty: number, dt: number) {
    if (!(dt > 0)) return;
    const w = this.omega, e = Math.exp(-w * dt);
    const dx = this.x - tx, dy = this.y - ty;
    const cx = this.vx + w * dx, cy = this.vy + w * dy;
    this.x = tx + (dx + cx * dt) * e;
    this.y = ty + (dy + cy * dt) * e;
    this.vx = (this.vx - w * cx * dt) * e;
    this.vy = (this.vy - w * cy * dt) * e;
  }
}

/**
 * The follow camera: locked to the vehicle plus an offset that springs toward a look-ahead along its heading. Locking
 * to the vehicle (drawn smoothly, between sim steps) keeps it still on screen at any game speed; the spring makes the
 * start, turns and stops glide.
 */
export class FollowCam {
  /** the camera's offset from the vehicle (springs toward the lead) */
  readonly off = new Spring2(3.2);
  /** the look-ahead, eased so a turn at a junction swings it gently */
  lx = 0;
  ly = 0;
  /** where the camera centre is now */
  x = 0;
  y = 0;
  /** seconds of travel to look ahead, and the most of the half height it may lead by */
  leadT = 1.6;
  leadMax = 0.25;

  /** Start following a vehicle at (vx, vy) from the camera centre (cx, cy): the offset carries the camera over. */
  start(cx: number, cy: number, vx: number, vy: number) {
    this.off.reset(cx - vx, cy - vy);
    this.lx = 0;
    this.ly = 0;
    this.x = cx;
    this.y = cy;
  }

  /**
   * A frame: the vehicle at (vx, vy) heading (dx, dy) (a unit vector) at `speed` m/s of real time (sim speed times
   * game speed), with the camera `halfH` m high. Updates x, y.
   */
  step(vx: number, vy: number, dx: number, dy: number, speed: number, halfH: number, dt: number) {
    const lead = Math.min(Math.max(0, speed) * this.leadT, halfH * this.leadMax);
    const k = 1 - Math.exp(-Math.max(0, dt) * 1.6);
    this.lx += (dx * lead - this.lx) * k;
    this.ly += (dy * lead - this.ly) * k;
    this.off.step(this.lx, this.ly, dt);
    this.x = vx + this.off.x;
    this.y = vy + this.off.y;
  }
}

/** What a followed truck was doing, to find the same truck setting off again after it arrives. */
export interface HaulKey { plant: number; dest: number; leg: "out" | "back"; cls?: string; t: number }

/** The fields of a vehicle the camera looks at (sim/traffic.ts Vehicle fits it). */
export interface CamVehicle {
  id: number;
  truck: boolean;
  v: number;
  arrived?: boolean;
  trip: { startT: number; bus?: unknown; haul?: { plant: number; dest: number; leg: "out" | "back"; cls?: string; big?: string; done?: boolean } };
}

/**
 * The same truck on its next run after it arrived at `t` (sim time): from the plant it delivered to back home, or
 * from home out again, in the same class, set off since. Null while it hasn't pulled out yet.
 */
export function successorOf(prev: HaulKey, vehicles: ArrayLike<CamVehicle>): number | null {
  let best: number | null = null, bt = Infinity;
  for (let i = 0; i < vehicles.length; i++) {
    const v = vehicles[i], r = v.trip.haul;
    if (!r || r.big || r.plant !== prev.plant || (r.cls ?? "light") !== (prev.cls ?? "light")) continue;
    if (v.trip.startT < prev.t - 0.5) continue;
    // home from the drop it made, or out again from home
    const ok = prev.leg === "out" ? r.leg === "back" && r.dest === prev.dest : r.leg === "out";
    if (ok && v.trip.startT < bt) { bt = v.trip.startT; best = v.id; }
  }
  return best;
}

export type FollowPhase = "track" | "hold" | "done";

/**
 * A follow's life: tracking while the vehicle is on the road; when it goes (arrived, or gave up), holding on the
 * spot for a few seconds in case the same truck sets off again (`retarget`), then done.
 */
export class FollowSession {
  phase: FollowPhase = "track";
  holdLeft = 0;
  constructor(public id: number, readonly holdTime = 4) {}

  /** A frame: is the vehicle still on the road? Returns the phase. */
  update(present: boolean, dt: number): FollowPhase {
    if (this.phase === "done") return "done";
    if (this.phase === "track") {
      if (present) return "track";
      this.phase = "hold";
      this.holdLeft = this.holdTime;
      return "hold";
    }
    this.holdLeft -= dt;
    if (this.holdLeft <= 0) this.phase = "done";
    return this.phase;
  }

  /** Its next run turned up: follow that vehicle. */
  retarget(id: number) {
    this.id = id;
    this.phase = "track";
    this.holdLeft = 0;
  }
}

// ------------------------------------------------------------------------------------------- spots

export type SpotKind = "junction" | "town" | "site" | "convoy" | "bridge" | "busy" | "event";

/** A place worth a shot: where, how high to frame it (half height, m), how much it is worth showing, and a key. */
export interface Spot { kind: SpotKind; x: number; y: number; h: number; w: number; key: string; vehicle?: number }

/** Vehicle counts on a coarse grid: how busy a place is right now. */
export class ActivityGrid {
  private cells = new Map<number, number>();
  constructor(readonly cell = 100) {}

  private static key(ix: number, iy: number) {
    return (ix + 32768) * 65536 + (iy + 32768);
  }

  clear() {
    this.cells.clear();
  }

  add(x: number, y: number, n = 1) {
    const k = ActivityGrid.key(Math.floor(x / this.cell), Math.floor(y / this.cell));
    this.cells.set(k, (this.cells.get(k) ?? 0) + n);
  }

  /** Vehicles in the cells within r of (x, y). */
  count(x: number, y: number, r: number): number {
    const c = this.cell;
    const x0 = Math.floor((x - r) / c), x1 = Math.floor((x + r) / c), y0 = Math.floor((y - r) / c), y1 = Math.floor((y + r) / c);
    let n = 0;
    for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) n += this.cells.get(ActivityGrid.key(ix, iy)) ?? 0;
    return n;
  }

  /** The busiest cells: their centres and counts, most first. */
  top(n: number): { x: number; y: number; n: number }[] {
    const all: { x: number; y: number; n: number }[] = [];
    for (const [k, v] of this.cells) {
      const ix = Math.floor(k / 65536) - 32768, iy = (k % 65536) - 32768;
      all.push({ x: (ix + 0.5) * this.cell, y: (iy + 0.5) * this.cell, n: v });
    }
    all.sort((a, b) => b.n - a.n);
    return all.slice(0, n);
  }
}

/** The map's places, as plain data. */
export interface SpotInputs {
  /** every vehicle on the road */
  vehicles: { x: number; y: number }[];
  /** junctions of three or more arms */
  junctions: { id: number; x: number; y: number; arms: number }[];
  towns: { id: number; x: number; y: number; pop: number }[];
  /** the company's sites: size is half their longer side (m) */
  sites: { id: number; x: number; y: number; size: number; level: number; running: boolean }[];
  /** oversized-load convoys on the way */
  convoys: { id: number; x: number; y: number }[];
  /** raised roads: where they are highest, and how long */
  bridges: { id: number; x: number; y: number; len: number }[];
  /** things that just happened (a delivery, a town grown): age in seconds */
  events: { x: number; y: number; age: number }[];
}

/** How much each kind of spot is worth before activity, and how far round it counts as its activity (m). */
const SPOT_BASE: Record<SpotKind, { w: number; r: number }> = {
  junction: { w: 1, r: 70 },
  town: { w: 1.4, r: 260 },
  site: { w: 1.3, r: 160 },
  convoy: { w: 4, r: 0 },
  bridge: { w: 1.2, r: 90 },
  busy: { w: 1.4, r: 120 },
  event: { w: 1.6, r: 120 },
};
/** Of each many-of-a-kind spot, only the busiest are kept: a big map has hundreds of junctions. */
const KEEP_JUNCTIONS = 24;
const KEEP_BRIDGES = 8;
/** How long a delivery or a town growing stays worth a look (s). */
export const EVENT_LIFE = 90;

const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));

/**
 * Gather the spots worth a shot, each weighted by how much is happening there now: an empty junction or an idle
 * site still counts a little, a busy one many times more, so the tour spends its time where the traffic is.
 */
export function gatherSpots(inp: SpotInputs, grid = new ActivityGrid()): Spot[] {
  grid.clear();
  for (const v of inp.vehicles) grid.add(v.x, v.y);
  // each spot with its activity now (s.w for the moment) and what its kind multiplies that by
  const out: Spot[] = [], mult: number[] = [];
  const add = (s: Spot, m = 1) => { out.push(s); mult.push(m); };
  const act = (x: number, y: number, kind: SpotKind, r = SPOT_BASE[kind].r) => grid.count(x, y, r);
  // junctions and bridges: the busiest few
  const js = inp.junctions.map((j) => ({ j, a: act(j.x, j.y, "junction") })).sort((a, b) => b.a - a.a).slice(0, KEEP_JUNCTIONS);
  for (const { j, a } of js) add({ kind: "junction", x: j.x, y: j.y, h: clamp(70 + j.arms * 8, 70, 120), w: a, key: `j${j.id}` });
  for (const t of inp.towns) {
    add({ kind: "town", x: t.x, y: t.y, h: clamp(170 + Math.sqrt(Math.max(0, t.pop)) * 5, 190, 650), w: act(t.x, t.y, "town"), key: `t${t.id}` },
      0.6 + Math.min(1, Math.log10(1 + Math.max(0, t.pop)) / 4));
  }
  for (const s of inp.sites) {
    add({ kind: "site", x: s.x, y: s.y, h: clamp(s.size * 1.35, 110, 380), w: act(s.x, s.y, "site", Math.max(SPOT_BASE.site.r, s.size)), key: `s${s.id}` },
      (0.8 + 0.15 * s.level) * (s.running ? 1 : 0.5));
  }
  const bs = inp.bridges.map((b) => ({ b, a: act(b.x, b.y, "bridge") })).sort((a, b) => b.a - a.a || b.b.len - a.b.len).slice(0, KEEP_BRIDGES);
  for (const { b, a } of bs) add({ kind: "bridge", x: b.x, y: b.y, h: clamp(b.len * 0.55, 80, 260), w: a, key: `b${b.id}` });
  for (const c of grid.top(5)) {
    if (c.n < 3) break;
    add({ kind: "busy", x: c.x, y: c.y, h: 130, w: c.n, key: `g${Math.round(c.x)}_${Math.round(c.y)}` });
  }
  for (const e of inp.events) {
    if (e.age > EVENT_LIFE) continue;
    add({ kind: "event", x: e.x, y: e.y, h: 120, w: act(e.x, e.y, "event"), key: `e${Math.round(e.x / 50)}_${Math.round(e.y / 50)}` }, 1 - e.age / EVENT_LIFE / 2);
  }
  // activity relative to the busiest spot: a quiet place keeps a small share, a busy one many times more
  let maxA = 0;
  for (const s of out) maxA = Math.max(maxA, s.w);
  for (let i = 0; i < out.length; i++) {
    const s = out[i];
    s.w = SPOT_BASE[s.kind].w * (0.06 + (maxA > 0 ? s.w / maxA : 0)) * mult[i];
  }
  // convoys are always worth a look: something special on the move
  for (const c of inp.convoys) out.push({ kind: "convoy", x: c.x, y: c.y, h: 75, w: SPOT_BASE.convoy.w, key: `c${c.id}`, vehicle: c.id });
  return out;
}

/** The last few shots' places, to keep the tour moving round the map. */
export class ShotHistory {
  readonly recent: { x: number; y: number; h: number; key: string }[] = [];
  constructor(readonly keep = 6) {}

  push(s: { x: number; y: number; h: number; key: string }) {
    this.recent.push({ x: s.x, y: s.y, h: s.h, key: s.key });
    while (this.recent.length > this.keep) this.recent.shift();
  }

  get last() {
    return this.recent.length ? this.recent[this.recent.length - 1] : null;
  }

  clear() {
    this.recent.length = 0;
  }
}

/** How far the next shot must be from the last to count as a different place (m). */
export function minSeparation(last: { h: number }): number {
  return Math.max(220, last.h * 1.3);
}

/** Is this spot the same place as the last shot? (the same thing, or within sight of it) */
export function samePlace(s: { x: number; y: number; key: string }, last: { x: number; y: number; h: number; key: string }): boolean {
  return s.key === last.key || Math.hypot(s.x - last.x, s.y - last.y) < minSeparation(last);
}

/**
 * The next spot: weighted by activity, never the same place as the last shot, and rarely one of the few before.
 * On a small map where everything is in sight of the last shot: the other spot farthest from it. Null only when there
 * is no other spot at all.
 */
export function pickSpot(spots: readonly Spot[], hist: ShotHistory, rand: () => number): Spot | null {
  const last = hist.last;
  let total = 0;
  const ws = new Array<number>(spots.length);
  for (let i = 0; i < spots.length; i++) {
    const s = spots[i];
    let w = Math.max(0, s.w);
    if (last && samePlace(s, last)) w = 0;
    else for (const r of hist.recent) if (samePlace(s, r)) { w *= 0.15; break; }
    ws[i] = w;
    total += w;
  }
  if (total <= 0) {
    // (everything is close by: at least a different thing, as far off as there is)
    let best: Spot | null = null, bd = -1;
    for (const s of spots) {
      if (last && s.key === last.key) continue;
      const d = last ? Math.hypot(s.x - last.x, s.y - last.y) : 0;
      if (d > bd) { bd = d; best = s; }
    }
    return best;
  }
  let r = rand() * total;
  for (let i = 0; i < spots.length; i++) {
    r -= ws[i];
    if (r < 0 && ws[i] > 0) return spots[i];
  }
  for (let i = spots.length - 1; i >= 0; i--) if (ws[i] > 0) return spots[i];
  return null;
}

// ------------------------------------------------------------------------------------------- shots

export type ShotMove = "push" | "pull" | "pan" | "orbit" | "track";

/** A shot: a slow move from one pose to another (or riding along with a vehicle), faded in and out. */
export interface Shot {
  move: ShotMove;
  from: Pose;
  to: Pose;
  dur: number;
  /** the vehicle a track shot rides with; its from/to x, y are then offsets from it */
  vehicle?: number;
  /** a track shot turns the view so the vehicle heads up the screen */
  chase?: boolean;
  spot?: Spot;
}

/** Fades between shots: out over the last FADE s of one, in over the first FADE s of the next (~0.8 s through black). */
export const FADE = 0.4;

/** Shot lengths (s): the places, and riding with a vehicle. */
export const SHOT_LEN: [number, number] = [8, 14];
export const RIDE_LEN: [number, number] = [10, 15];

const lerp = (a: number, b: number, k: number) => a + (b - a) * k;

/**
 * Plan a shot of a spot, starting from turn `rot`. The zoom is varied against the last shot's (`prevH`): a close
 * shot after a wide one and the other way round, so cuts read. `still`: no movement (reduced motion).
 */
export function planShot(spot: Spot, rot: number, prevH: number, rand: () => number, aspect = 16 / 9, still = false): Shot {
  const dur = lerp(SHOT_LEN[0], SHOT_LEN[1], rand());
  if (spot.vehicle !== undefined) return planRide(spot.vehicle, prevH, rand, still, spot);
  // zoom: tighter or wider than the spot's own framing, whichever differs more from the last shot
  const scales = [0.7, 1, 1.5];
  let sc = scales[Math.floor(rand() * 3)];
  if (prevH > 0 && rand() < 0.7) {
    let bd = -1;
    for (const s of scales) { const d = Math.abs(Math.log((spot.h * s) / prevH)); if (d > bd) { bd = d; sc = s; } }
  }
  const h = spot.h * sc;
  const r0 = rot + (rand() - 0.5) * 0.5;
  const base: Pose = { x: spot.x, y: spot.y, h, rot: r0 };
  if (still) return { move: "pan", from: base, to: { ...base }, dur, spot };
  const roll = rand();
  const move: ShotMove = roll < 0.3 ? "push" : roll < 0.55 ? "pull" : roll < 0.85 ? "pan" : "orbit";
  const from = { ...base }, to = { ...base };
  // a slow drift across in any direction, a fraction of the frame
  const a = rand() * Math.PI * 2, d = h * aspect * (move === "pan" ? 0.32 : 0.1);
  from.x -= Math.cos(a) * d; from.y -= Math.sin(a) * d;
  to.x += Math.cos(a) * d; to.y += Math.sin(a) * d;
  if (move === "push") { from.h = h * 1.3; to.h = h * 0.8; }
  else if (move === "pull") { from.h = h * 0.8; to.h = h * 1.3; }
  else if (move === "pan") { from.h = h; to.h = h * 1.05; }
  else { from.rot = r0 - 0.16; to.rot = r0 + 0.16; from.h = h * 1.05; to.h = h * 0.95; }
  return { move, from, to, dur, spot };
}

/** A shot riding along with a vehicle: close or medium, a slow zoom, sometimes turned to its heading. */
export function planRide(vehicle: number, prevH: number, rand: () => number, still = false, spot?: Spot): Shot {
  const dur = lerp(RIDE_LEN[0], RIDE_LEN[1], rand());
  // close (a cab's-eye) or medium (the road around it): the other one from last time, mostly
  let close = rand() < 0.5;
  if (prevH > 0 && rand() < 0.7) close = prevH > 100;
  const h = close ? lerp(42, 62, rand()) : lerp(95, 140, rand());
  const z = still ? 1 : rand() < 0.5 ? 0.85 : 1.15;
  return {
    move: "track", vehicle, chase: !still && rand() < 0.4, dur, spot,
    from: { x: 0, y: 0, h, rot: 0 }, to: { x: 0, y: 0, h: h * z, rot: 0 },
  };
}

/** Gentle ease: half constant speed, half eased in and out (a drone glides, it doesn't lurch). */
export function shotEase(k: number): number {
  const t = Math.max(0, Math.min(1, k));
  return 0.5 * t + 0.5 * (0.5 - 0.5 * Math.cos(Math.PI * t));
}

/** The shot's pose t seconds in, written into `out` (no allocation). A track shot's x, y are offsets. */
export function evalShot(s: Shot, t: number, out: Pose): Pose {
  const e = shotEase(t / s.dur);
  out.x = s.from.x + (s.to.x - s.from.x) * e;
  out.y = s.from.y + (s.to.y - s.from.y) * e;
  out.h = s.from.h * Math.pow(s.to.h / s.from.h, e);
  out.rot = s.from.rot + (s.to.rot - s.from.rot) * e;
  return out;
}

/** How black the screen is t seconds into a shot of `dur` s: fading in at the start, out at the end. */
export function fadeAt(t: number, dur: number, fade = FADE): number {
  // (both ends at once on a shot cut short in its first moments: it stays dark rather than flash clear)
  const k = Math.max(1 - t / fade, (t - (dur - fade)) / fade);
  const c = Math.max(0, Math.min(1, k));
  return c * c * (3 - 2 * c);
}

/**
 * A shot cut short at `t` (its vehicle gone): the length that fades to black from wherever the fade is now, without
 * brightening first (a cut in the fade-in starts the fade-out at the same darkness).
 */
export function cutShort(t: number, fade = FADE): number {
  return t + Math.min(fade, Math.max(0, t));
}

// ------------------------------------------------------------------------------------------- vehicle cam

/** A vehicle the vehicle cam could ride with. */
export interface RideCandidate { id: number; x: number; y: number; truck: boolean; cls?: string; big?: boolean; speed: number; bus?: boolean }

/** How much a vehicle is worth riding with: convoys and heavy trucks first, anything moving over anything parked. */
export function rideScore(c: RideCandidate): number {
  let s = c.big ? 14 : c.truck ? (c.cls === "roadtrain" ? 6 : c.cls === "heavy" ? 4 : 2.5) : c.bus ? 1.5 : 0.6;
  s *= c.speed > 3 ? 1 : c.speed > 0.5 ? 0.4 : 0.08;
  return s;
}

/** Pick the next vehicle to ride with: weighted by rideScore, never one of the last few, preferably somewhere else. */
export function pickRide(cands: readonly RideCandidate[], recent: readonly number[], last: { x: number; y: number } | null, rand: () => number): RideCandidate | null {
  let total = 0;
  const ws = new Array<number>(cands.length);
  for (let i = 0; i < cands.length; i++) {
    const c = cands[i];
    let w = recent.includes(c.id) ? 0 : rideScore(c);
    if (w > 0 && last && Math.hypot(c.x - last.x, c.y - last.y) < 250) w *= 0.25;
    ws[i] = w;
    total += w;
  }
  if (total <= 0) return null;
  let r = rand() * total;
  for (let i = 0; i < cands.length; i++) { r -= ws[i]; if (r < 0 && ws[i] > 0) return cands[i]; }
  for (let i = cands.length - 1; i >= 0; i--) if (ws[i] > 0) return cands[i];
  return null;
}

/** The truck to follow from the camera menu: nearest the middle of the screen, a moving one over a parked one. */
export function nearestRide(cands: readonly RideCandidate[], cx: number, cy: number, maxD: number): RideCandidate | null {
  let best: RideCandidate | null = null, bd = Infinity;
  for (const c of cands) {
    if (!c.truck && !c.big) continue;
    const d = Math.hypot(c.x - cx, c.y - cy) * (c.speed > 0.5 ? 1 : 2);
    if (d < bd && d <= maxD) { bd = d; best = c; }
  }
  return best;
}

/** Turn the view to so a heading `ang` points up the screen (View.rot). */
export function chaseRot(ang: number): number {
  return ang + Math.PI / 2;
}

/** Ease angle a toward b by share k, the short way round. */
export function easeAngle(a: number, b: number, k: number): number {
  const d = Math.atan2(Math.sin(b - a), Math.cos(b - a));
  return a + d * k;
}

/** What the player did while the camera follows a vehicle. */
export type FollowInput = "pan" | "zoom" | "esc" | "select" | "build" | "stop";

/**
 * What a follow does on the player's input (owner, 2026-11-08: Esc clears the HUD and keeps following; only taking the
 * camera lets go): "end" on a pan, drag or key scroll, the chip's Stop, or a click with a build tool (the map can't
 * slide under a road being drawn); "switch" to a vehicle clicked on; "keep" on the wheel, Esc, a click on empty
 * ground or on anything else (its panel opens and the ride goes on).
 */
export function followOn(input: FollowInput, picked: "vehicle" | "other" | null = null): "keep" | "end" | "switch" {
  if (input === "pan" || input === "stop" || input === "build") return "end";
  if (input === "select" && picked === "vehicle") return "switch";
  return "keep";
}
