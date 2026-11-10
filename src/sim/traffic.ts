import { LANE_W, ROAD_TYPES, SIM, rightOnly } from "../config";
import { clamp, dot, norm, polyAt, polyClosest, polyDirSmooth, right, sub, type V2 } from "../core/math";
import type { ChangeSet, Connector, Edge, Lane, RoadNetwork, SignalPhase, SignalPlan } from "../roads/network";
import { Router, dkey, dkDir, dkSeg, type Access } from "./router";
import type { HaulRun } from "../game/industry";

export type TripKind = "shop" | "leisure" | "work" | "home" | "cargo" | "empty" | "bus";
/** A bus going round its line: the stop it is heading for (index into the line) and who is aboard. */
export interface BusRun {
  line: number; i: number; pax: { c: number; to: number; walk: number }[];
  /** finishes at its next stop */
  retire?: boolean;
  /** the stop it was driving to was taken away: where it pulls up is no stop, it just goes on to stop i */
  detour?: boolean;
}

export interface Trip {
  kind: TripKind;
  from: number; // building id
  to: number;
  resident: number; // resident id or -1
  cargo?: string;
  startT: number;
  freeFlow: number;
  bus?: BusRun;
  /** one of the company's trucks (see game/industry.ts) */
  haul?: HaulRun;
  /** a resident driving a car the company's Motor Works built (drawn as one, in its livery) */
  motor?: boolean;
}

/**
 * A rigid piece of an articulated vehicle (a road train's tractor or a trailer), measured from the vehicle's front
 * bumper (m): where it starts, how long it is, where it rides (its pivot: a tractor's front axle, a trailer's
 * kingpin) and where its rear wheels are. Each piece is drawn along the path the front has driven.
 */
export interface Unit { at: number; len: number; pivot: number; axle: number }

export interface Vehicle {
  id: number;
  truck: boolean;
  len: number;
  /** share of the speed limit it drives at (default: a car 1, a truck 0.85) */
  vf?: number;
  /** share of a car's acceleration (a heavy truck pulls away slower) */
  af?: number;
  /**
   * The driver, -1..1 (from the vehicle id, so the same car drives the same way): a brisk one (towards 1) keeps a
   * slightly shorter gap, pulls away a little harder and takes a slightly shorter gap at a give-way; a calm one the
   * other way. See DRIVERS.
   */
  drv: number;
  /** a speed it never goes above, whatever the limit (m/s): an escorted oversized load */
  vmax?: number;
  /** never changes lane to overtake (only when its route needs it): an escorted convoy holds its lane */
  keepLane?: boolean;
  /** an articulated vehicle's pieces, and each one's drawn pose now and last step ([x, y, h, angle] per piece) */
  units?: Unit[];
  uPose?: Float32Array;
  puPose?: Float32Array;
  /** the edges its front has driven through, oldest first (a long body still trails back over them) */
  hist?: Edge[];
  /** the stretch of each `hist` edge its front drove along, [from, to] (all of it, unless it changed lanes there) */
  histSpan?: [number, number][];
  /** where its front came onto the edge it is on now (past 0 after a lane change) */
  entS?: number;
  /** junction boxes a long body still trails through after its front got a go-ahead at the next one: still held */
  boxes?: Connector[];
  color: number;
  /** Picks its colour and body (car or van), chosen when the trip is asked for so it looks the same pulling out of its lot. */
  look: number;
  /** set as it reaches its destination (not when it gives up or its road goes) */
  arrived?: boolean;
  edge: Edge;
  s: number;
  v: number;
  acc: number;
  route: number[];
  ri: number;
  next: Connector | null;
  granted: boolean;
  holding: Connector | null; // reservation to release once clear
  lat: number;
  lcCool: number;
  wait: number;
  stuck: number;
  /** Distance driven so far (m), and when it last got PROGRESS m further on: a crawling queue isn't a jam to give up in. */
  odo?: number;
  progOdo?: number;
  progT?: number;
  dest: Access;
  destSide: 1 | -1; // side of the destination relative to the seg's a->b direction
  destS: number; // lane arc-length of the driveway on the final lane (-1 = not computed)
  /** its driveway is at the dead end of its road (see END_GATE): it drives straight in, whichever side it is on */
  destEnd?: boolean;
  trip: Trip;
  // render state
  x: number; y: number; h: number; ang: number;
  px: number; py: number; ph: number; pang: number;
  fade: number; // 0..1 spawn fade (and fading out again while it quits)
  quit?: number; // s left fading off the road, a driver giving up in a frozen jam (see JAM_BREAK)
  forced?: boolean; // let into the junction ahead by the jam breaker
  /** Path the front bumper has driven: TR_N [x, y, h] samples TR_STEP apart in a ring (newest at trH). The body is
   *  drawn along it, so the back follows the front through turns and lane changes instead of snapping per edge. */
  trail?: Float32Array;
  trH?: number;
  leaving: number; // >0 while turning into a driveway
  /** Time the trip would have taken without other traffic: real time while unimpeded, distance at free speed while held up. */
  ideal: number;
  born: number; // sim time it entered the road
  block?: string; // why the junction last refused entry (debug + inspector)
  stopAt?: Connector; // the stop sign it has already stopped at (and may now go on from, when clear)
  blockTo?: Lane; // the lane the car it last gave way to was heading into
  grantT?: number; // order in which it got its current go-ahead at the junction ahead (a sequence, never tied)
  overrode?: boolean; // that go-ahead was a driver with an earlier one letting it out (see letsOut)
  turnOk?: boolean; // its driveway was clear to turn into on the way up to it (it carries on rather than stop dead)
  latV?: number; // sideways speed while changing lanes / pulling out (m/s, signed like lat)
  slide?: number; // sideways creep more than steering at this speed could give: the whole body moves over (m, like lat)
  wish?: { lane: Lane; t: number }; // a lane it must change into but found no gap in (last tried at t)
  pocketAhead?: Lane; // the turn pocket it is heading for, still ahead of it (it eases off for the queue in there)
  lcFrom?: Lane; // the lane it is changing out of, while its body still sits partly in it
  lcS?: number; // where on its new lane it changed over
  crossing?: { lane: Lane; s: number }[]; // far lanes this car is still pulling out across (spot where it started)
  crossFrom?: number; // its own lane position when it started pulling out
  crossOut?: number; // how far on from there its nose was when it left the lanes it crosses
  v0e: number; // free-road desired speed this step (limits, curves, driveway approach)
  constrained: boolean; // held up by another vehicle, a stop line or a signal this step
  /** Leaves the map at its destination (outside connection): drives through at speed instead of turning in. */
  exit?: boolean;
  /** Missed its way and can't get back (its trip already counted as failed): leaves the road at the end of its lane. */
  lost?: boolean;
  /** A bus standing at its stop: seconds left before it pulls out again. */
  dwell?: number;
}

export interface PendingSpawn {
  from: Access;
  fromSide: 1 | -1;
  to: Access;
  toSide: 1 | -1;
  trip: Trip;
  truck: boolean;
  tries: number;
  wait: number;
  why?: string; // last reason the spawn had to wait (debug + inspector)
  blocker?: number;
  /** spots a queue should leave free so this car can pull out: no car comes to rest over [s - b, s + a] */
  clear?: { lane: Lane; s: number; b: number; a: number }[];
  /** Enters from an outside connection: appears in lane at speed, no driveway. */
  through?: boolean;
  /** Leaves through an outside connection at `to`. */
  exit?: boolean;
  /** When the trip was asked for: a car leaving a building first rolls out of its lot (EMERGE seconds). */
  t0?: number;
  look?: number;
  /** body colour (a bus wears its line's) */
  color?: number;
  /** the route it found, kept while it waits for a gap (network version, and when: see REPLAN) */
  plan?: { best: SpawnRoute; ver: number; t: number };
  /** a truck of a bigger class: its length, its share of the speed limit and of a car's acceleration, its pieces */
  len?: number;
  vf?: number;
  af?: number;
  units?: Unit[];
  /** an escorted convoy: its top speed (m/s), and it holds its lane */
  vmax?: number;
  keepLane?: boolean;
  /**
   * A long truck leaving a lot: when it starts rolling out of the gate (one at a time per lot, after the one before
   * it has pulled out); unset while it waits behind another.
   */
  go?: number;
}

/** An edge as saved: a lane's key, or a connector as its junction and the keys of the two lanes it joins. */
export type EdgeRef = string | [number, string, string];

/**
 * A vehicle on the road as saved (Traffic.toJSON): what it is, where it is on its lane or in its junction, the way
 * it is going and its trip (with its load), and what it holds at the junction it is at.
 */
export interface SavedVehicle {
  id: number; truck: boolean; len: number; look: number; color: number;
  vf?: number; af?: number; vmax?: number; keepLane?: boolean; units?: Unit[]; exit?: boolean;
  e: EdgeRef; s: number; v: number; lat: number; latV?: number; lcCool: number;
  route: number[]; ri: number; dest: Access; destSide: 1 | -1; destS: number; destEnd?: boolean;
  trip: Trip; born: number; ideal: number; wait: number; stuck: number;
  odo?: number; progOdo?: number; progT?: number; dwell?: number;
  next?: EdgeRef; granted?: boolean; grantT?: number; overrode?: boolean; forced?: boolean; turnOk?: boolean;
  hold?: EdgeRef; stopAt?: EdgeRef; boxes?: EdgeRef[];
  hist?: EdgeRef[]; histSpan?: [number, number][]; entS?: number;
  lcFrom?: string; lcS?: number; crossing?: { lane: string; s: number }[]; crossFrom?: number; crossOut?: number;
}

/** A trip waiting to set off as saved: in its lot, at the kerb, or beyond the edge of the map. */
export type SavedSpawn = Omit<PendingSpawn, "why" | "blocker" | "clear" | "plan">;

/** The traffic as saved: every vehicle and waiting trip, the lights' clocks, and the lots a long truck is pulling out of. */
export interface TrafficSave {
  nextId: number;
  grantSeq: number;
  vehicles: SavedVehicle[];
  pending: SavedSpawn[];
  /** per signalled junction: the phase that is on, its stage and how long it has been in it */
  signals: [number, number, 0 | 1 | 2, number][];
  /** per lot: the long truck last out of its gate (its id) and where the gate is */
  gates: [number, number, V2][];
}

type SpawnRoute = { keys: number[]; time: number; freeFlow: number; dir: 1 | -1 };
/** Seconds a car waiting to pull out keeps the route it found before looking again (traffic speeds change). */
const REPLAN = 3;

/** Seconds a car takes to come out of its lot to the kerb before it joins the road (drawn by the renderer). */
export const EMERGE = 2.6;
/** Whether a trip starts in a building's lot (and so rolls out of it first): not buses or traffic driving in at speed. */
export const fromLot = (p: PendingSpawn) => !p.through && !p.trip.bus;
/** Whether phase `ph` lets traffic from arm `seg` turning `turn` go (a left-turn phase: only left turns and U-turns). */
export const goesIn = (ph: SignalPhase, seg: number, turn?: string) => ph.arms.includes(seg) && (!ph.left || turn === "L" || turn === "U");
/** Fixed-time lights (see updateSignals): green s per phase, and for a left-turn arrow; amber; all red between. */
export const GREEN = 24, LEFT_GREEN = 8, AMBER = 3, ALL_RED = 1.5;
export const greenFor = (ph: SignalPhase) => (ph.left ? LEFT_GREEN : GREEN);

const TR_N = 100, TR_STEP = 0.35; // drawn-path samples per car (35 m: enough for a road train or an escorted convoy)
/**
 * A vehicle at least this long (a bus, a heavy truck, a road train) is tracked over the edges its body still trails
 * back across: it holds a junction box until its tail is out and books ring room by its length.
 */
export const LONG = 10;
/**
 * An articulated road train (22 m): it also waits its turn out of a lot (gating the rigid 12 m heavy trucks too held
 * whole fleets in queues at their gates and halved what they moved: tests/balance.test.ts).
 */
export const TRAIN = 16;
/**
 * The jam breaker, a last resort (owner, 2026-11-08: "let infinite traffic jams get a bit fixed into non infinite
 * ones"). The give-way rules are meant never to lock, but a city is big and odd layouts get built, and a spot that
 * locks solid would stand forever. So: where cars have stood JAM_BREAK s at a junction (the stuck alert has been up
 * half a minute by then), the one that has waited longest there is let in regardless of who it should give way to or
 * whether its exit has room (it squeezes in and waits in the box, as real drivers do; never through a car that is
 * physically in its path), and for a minute after that the next ones there go after a short wait. If the spot is
 * still frozen at GIVE_UP s, the car at the front of it quietly leaves the road (it shrinks away like a despawn) and
 * its trip fails, so the queue behind it can move. Both are rare: counted in jamBreaks / jamQuits.
 */
export const JAM_BREAK = 120;
/** ...and at a spot it has had to unlock in the last minute, how long (s) the next car there stands first. */
const JAM_BREAK_AGAIN = 15;
/** A driver gives up after this long (s) standing in traffic without getting PROGRESS m further on (see JAM_BREAK). */
export const GIVE_UP = 240;
/** How long (s) a driver giving up takes to fade off the road. */
const QUIT_FADE = 0.4;
const PROGRESS = 8;
/** Share of its usual pace a heavy truck or road train keeps on a dirt road (the ruts and the dust). */
const ROUGH_HEAVY = 0.85;
/**
 * Share of a roundabout's capacity (see ringLoad) past which its entries hold back. Round about this density a
 * ring's traffic moves at its best rate (cars a couple of seconds apart at ring speed); fuller, it slows, and
 * packed it can lock in a circle.
 */
const RING_FULL = 0.6;
/** How far along a near lane (m) a vehicle pulling out across it sweeps as it turns: kept clear while it crosses. */
const CROSS_SWEEP = 10;
/**
 * A driveway this close (m) to the dead end of a road is at the end of it: the road runs into the gate (the street a
 * works lays from its gate, or one drawn to it). A vehicle drives straight in off the lane it is on and straight out
 * onto the lane leading away: nothing crosses in the gate's throat. Before, the gate counted as beside the road, so
 * a truck driving up to it "turned in across" the lane the trucks leave by: with one waiting there to pull out onto
 * the road beyond, the one coming in stood in the throat (or went on to turn round at the dead end, which the one
 * leaving also blocked), the next one in stopped in the junction behind it, and that held the one leaving: a ring of
 * three, and with it the road past the gate (docs/playtest-2026-11-09.md, A1).
 */
export const END_GATE = 9;
/** Edges kept in a vehicle's history (a road train spans a lane, a junction and the lane before it). */
const HIST = 8;
/** A destination this close (m) past the start of its road: a car picks its lane for it on the road before. */
const PREP_AHEAD = 400;
/**
 * How much drivers differ, at the ends of the range (Vehicle.drv -1..1, most near the middle): the gap they keep
 * +-10% of SIM.idm.T, how hard they pull away +-8%, the gap they take at a give-way +-12%. Enough that a queue moves
 * off unevenly and a stream of cars isn't evenly spaced, as real ones aren't; the averages are unchanged. (Cruising
 * speed stays the same for everyone: +-4-6% of it made the oncoming stream at a crossing so lumpy that whether a
 * left-turn arrow helps came down to luck, and drew more go-aheads back at a busy four-way.)
 */
export const DRIVERS = { gap: 0.1, accept: 0.12, launch: 0.08 };

/** A vehicle's driver, -1..1 from its id: the sum of two hashes, so most drivers are near the middle. */
export function driver(id: number): number {
  const u1 = (Math.imul(id + 1, 2654435761) >>> 0) / 4294967296;
  const u2 = (Math.imul(id + 7919, 2246822519) >>> 0) / 4294967296;
  return u1 + u2 - 1;
}

/** A car's paint from its look. */
export const carColor = (look: number) => CAR_COLORS[look % CAR_COLORS.length];
// real traffic: mostly white, silver, grey and black, with some red, blue, beige and green
const CAR_COLORS = [0xf1f1ee, 0xe4e5e3, 0xbfc2c5, 0x8d9095, 0x2a2c30, 0x45484e, 0xa8302c, 0x263f6b, 0x4c6f99, 0xc8b48c, 0x3e5640, 0xd6d8da];

export interface TrafficEvents {
  arrive(v: Vehicle, now: number): void;
  fail(trip: Trip, reason: string, now: number): void;
  /** A bus reached its stop: where it goes next and how long it stands here first (null: it leaves the road). */
  busAt?(v: Vehicle): { to: Access; dwell: number } | null;
}

/** Segment-level flow statistics for overlays and objectives. */
export interface FlowStat {
  n: number;
  ratio: number; // smoothed share of travel time not lost to other traffic (1 = free flow); the overlay
  speed: number; // smoothed mean speed / limit; the router's travel-time estimate
  queue: number; // vehicles stopped
}

export class Traffic {
  vehicles: Vehicle[] = [];
  pending: PendingSpawn[] = [];
  router: Router;
  time = 0;
  private grantSeq = 0;
  private nextId = 1;
  private lcTimer = 0;
  private statTimer = 0;
  private turnBlockedByQueue = false; // set by canTurnIn: the car in the way is standing still
  private keepClear = new Map<Lane, { s: number; b: number; a: number }[]>(); // lane -> driveway spots queues leave free (this step)
  // lane -> cars beside it that need to get into it soon: the car behind each one holds back to make room
  private wishes = new Map<Lane, Vehicle[]>();
  private crossers = new Map<Lane, number[]>(); // lane -> spots where a car is pulling out across it (this step)
  private leavers = new Map<Lane, Vehicle[]>(); // lane -> cars changing out of it that still take up room in it (this step)
  // Where one lane divides in two (a taper into a slip lane, a fork), the two paths run on top of each other for a
  // while: a car on one branch there blocks the other too. Pairs of such branches with how far they overlap, built
  // lazily after each network change; and per edge the cars on its sibling branch that sit in that shared stretch.
  private tapers: { a: Connector; b: Connector; ov: number }[] | null = null;
  private shadows = new Map<Edge, Vehicle[]>();
  private shadowS = new Map<Vehicle, number>(); // a shadowing car's position mapped onto the edge it shadows
  // An unsignalled junction where a car has waited long for a gap that never comes: traffic that can still stop
  // lets it out (one car at a time, for a few seconds, then the main road gets a turn again).
  private courtesy = new Map<number, { v: Vehicle; until: number }>();
  private courtesyRest = new Map<number, number>(); // node -> time before another car may claim it
  // A backed-up exit lane: the car that has waited longest at its stop line for room on it gets the next gap,
  // instead of whoever happens to roll up at speed when the queue moves.
  private roomClaim = new Map<Lane, Vehicle>();

  // Traffic lights, on a fixed clock (see updateSignals): per signalled node, which phase is on, its stage (0 green,
  // 1 yellow, 2 all red) and how long it has been in it. Made the first time anything asks about that node's lights.
  private sigCtl = new Map<number, { plan: SignalPlan; i: number; st: 0 | 1 | 2; t: number }>();

  private ringLoads = new Map<number, number>(); // ring id -> share of its capacity in use (this step)
  private roomV = Infinity; // set by ringRoom: speed of what ends the room it found
  private ringClaim = new Map<number, Vehicle>(); // ring id -> the car that has waited longest at an entry for room on it
  private breakFor = new Map<number, Vehicle>(); // node -> the car stuck longest at it, past JAM_BREAK (this step)
  private breakHot = new Map<number, number>(); // node -> till when it counts as locked (the jam breaker has been at work)
  /** How often the jam breaker let a car in, and how many drivers gave up in a frozen jam (see JAM_BREAK). */
  jamBreaks = 0;
  jamQuits = 0;
  private ringCaps = new Map<number, number>(); // ring id -> how many car slots it has
  private forks = new Map<number, number>(); // connector pair -> where they part (see forkAt)
  private gates = new Map<number, { v: Vehicle; at: V2 }>(); // building -> its last long truck out, till its tail clears the gate
  flow = new Map<number, FlowStat>(); // by directed seg key
  trips: { ff: number; actual: number; t: number }[] = [];
  jams = new Map<number, number>(); // node id -> seconds of blockage recently

  constructor(public net: RoadNetwork, private ev: TrafficEvents) {
    this.router = new Router(net);
  }

  // ---------------------------------------------------------------- spawning

  request(p: PendingSpawn) {
    p.t0 ??= this.time;
    p.look ??= (Math.random() * 1e6) | 0;
    this.pending.push(p);
  }

  private trySpawn(p: PendingSpawn): "ok" | "wait" | "fail" {
    const net = this.net;
    if (!net.segs.has(p.from.seg) || !net.segs.has(p.to.seg)) return "fail";
    // pick a start direction: prefer the kerb side (no crossing), but take the faster route if much better.
    // A median can't be crossed: there you can only pull out to the right (and arrive from the right).
    const divided = (seg: number) => rightOnly(ROAD_TYPES[net.segs.get(seg)!.type]);
    const to: Access = { ...p.to, side: p.toSide };
    // (a car waiting for a gap asks again only every few seconds, or when the roads change: two searches every step
    // for each waiting car cost a big town milliseconds a frame)
    let best: SpawnRoute | null = p.plan && p.plan.ver === net.version && this.time - p.plan.t < REPLAN ? p.plan.best : null;
    // a gate at the dead end of its road (see END_GATE): straight out onto the lane leading away, crossing nothing
    const endOut = p.through ? 0 : this.endGate(p.from);
    if (!best) {
      for (const d of [1, -1] as const) {
        if (endOut && d !== endOut) continue;
        const crossing = !endOut && (d === 1 ? 1 : -1) !== p.fromSide;
        if (crossing && divided(p.from.seg) && !p.through) continue;
        const r = this.router.route(p.from, to, d);
        if (!r) continue;
        const t = r.time + (crossing ? 6 : 0);
        if (!best || t < best.time) best = { ...r, time: t, dir: d };
      }
      if (!best) return "fail";
      p.plan = { best, ver: net.version, t: this.time };
    }
    const k = best.keys[0];
    const lanes = this.lanesOf(k);
    const crossing = !endOut && (best.dir === 1 ? 1 : -1) !== p.fromSide;
    // joining from the far side you turn into the lane nearest the middle, as real drivers do
    const full = lanes.filter((l) => !l.pocket);
    const want = crossing ? Math.max(...full.map((l) => l.idx)) : 0;
    let lane = full.find((l) => l.idx === want) ?? full[0];
    if (!lane) return "fail";
    // traffic driving in from the edge of the map uses another lane when its own is backed up to the edge
    if (p.through && lanes.length > 1) {
      const room = (l: Lane) => {
        const s = polyClosest(l.pl, p.from.p).s;
        const ahead = (l.occ as Vehicle[]).find((o) => o.s > s - 2);
        return ahead ? ahead.s - ahead.len - s + ahead.v * 3 : 1e4;
      };
      let best = room(lane);
      if (best < 40) for (const l of full) { const r = room(l); if (r > best + 10) { best = r; lane = l; } }
    }
    const lc = polyClosest(lane.pl, p.from.p);
    const ls = lc.s;
    const len = p.len ?? (p.trip.bus ? SIM.busLen : p.truck ? SIM.truckLen : SIM.carLen);
    // gap check on the target lane (and traffic arriving soon)
    // gap acceptance like a real driver: ~4 s to oncoming traffic, shrinking as they get impatient,
    // so through traffic rarely has to brake for someone pulling out
    const headway = p.wait > 12 ? 2 : p.wait > 5 ? 2.5 : 3.2;
    // (a queue leaves the mouth clear for the whole of it: room behind for its body, and ahead for it to straighten up)
    p.clear = [{ lane, s: ls, b: len + 2, a: len + 3 }];
    // another vehicle still pulling out across this lane near here: wait till it is clear of it
    for (const k of this.crossers.get(lane) ?? []) if (k > ls - len - 4 && k < ls + len + 6) { p.why = "crossing"; return "wait"; }
    for (const o of lane.occ as Vehicle[]) {
      if (o.s > ls - 2 && o.s - o.len < ls + len + 3) { p.why = "occupied"; return "wait"; }
      // one still pulling out ahead needs its length on from where it came out to straighten up: not in front of it
      if (o.crossing && o.s <= ls && ls - len < (o.crossFrom ?? o.s) + o.len + 3) { p.why = "occupied"; p.blocker = o.id; return "wait"; }
      // slow or queued traffic lets you in when it can stop comfortably behind you
      const courtesy = o.v < 4 && ls - len - o.s > 1.5 + (o.v * o.v) / (2 * SIM.idm.b) + o.v * 0.8;
      if (o.s <= ls && ls - o.s < Math.max(10, o.v * headway) && !courtesy) { p.why = "oncoming"; p.blocker = o.id; return "wait"; }
    }
    // incoming vehicles from the connector feeding this lane near the start
    if (ls < 12) for (const c of lane.ins) if ((c.occ as Vehicle[]).length) { p.why = "junction"; return "wait"; }
    if (crossing) {
      // must cross the near lanes: wait for a gap there too
      for (const { lane: nl, s: ns } of this.lanesAt(dkey(p.from.seg, best.dir === 1 ? -1 : 1), p.from.p)) {
        p.clear.push({ lane: nl, s: ns, b: CROSS_SWEEP + 2.5, a: 3 });
        // (two pulling out across each other's lanes would each wait for the other's body to clear)
        for (const k of this.crossers.get(nl) ?? []) if (k > ns - len - 6 && k < ns + len + 6) { p.why = "crossing"; return "wait"; }
        for (const o of nl.occ as Vehicle[]) {
          // we drive on (towards falling s on this far lane) while we cross it: keep that stretch clear too
          // (and the stretch is as long as our turn out sweeps along it, not just the spot we come out at)
          const sw = ns - CROSS_SWEEP - 2;
          if (o.s > sw - (o.v < 1 ? 0 : 1) && o.s - o.len < ns + 3) { p.why = "cross-occupied"; p.blocker = o.id; return "wait"; }
          // someone on the far lane about to stop at their own driveway right where we'd cut across (about to: a few
          // seconds off, not a truck still a kilometre down a long feeder road heading for the same yard)
          if (o.destS >= 0 && o.s < o.destS + 1 && o.destS - o.s < Math.max(30, o.v * 6) && o.destS > ns - 12 && o.destS < ns + 4 && this.isFinal(o)) { p.why = "cross-occupied"; p.blocker = o.id; return "wait"; }
          // the far lane needs a real gap (crossing it takes a couple of seconds); slow traffic can stop for us
          const need = p.wait > 20 ? 1.6 : p.wait > 8 ? 2.2 : 3;
          const yields = o.v < 4 && sw - o.s > 1.5 + (o.v * o.v) / (2 * SIM.idm.b) + o.v * 0.8;
          if (o.s < ns && (sw + 2 - o.s) / Math.max(o.v, 0.5) < need && !yields) { p.why = "cross-oncoming"; return "wait"; }
        }
      }
    }
    const v: Vehicle = {
      id: this.nextId++, truck: p.truck, len, look: p.look ?? 0, color: p.color ?? (p.truck ? 0xf5f5f0 : carColor(p.look ?? 0)),
      edge: lane, s: ls, v: 5, acc: 0, route: best.keys, ri: 0, next: null, granted: false, holding: null,
      lat: 0, lcCool: 2, wait: 0, stuck: 0, dest: to, destSide: p.toSide, destS: -1,
      trip: { ...p.trip, freeFlow: best.freeFlow },
      x: 0, y: 0, h: 0, ang: 0, px: 0, py: 0, ph: 0, pang: 0, fade: 0, leaving: 0,
      ideal: 0, born: this.time, v0e: 1, constrained: false, drv: driver(this.nextId - 1),
    };
    if (p.vf !== undefined) v.vf = p.vf;
    if (p.af !== undefined) v.af = p.af;
    if (p.units) v.units = p.units;
    if (p.vmax !== undefined) v.vmax = p.vmax;
    if (p.keepLane) v.keepLane = true;
    if (p.exit) v.exit = true;
    if (p.through) {
      // driving in at speed, but never faster than it can comfortably slow to the car ahead (the tail of a queue)
      let sp = Math.min(ROAD_TYPES[net.segs.get(lane.seg)!.type].speed * 0.85, v.vmax ?? Infinity);
      const ahead = (lane.occ as Vehicle[]).find((o) => o.s > ls);
      if (ahead) {
        const gap = ahead.s - ahead.len - ls - SIM.idm.s0;
        if (gap < 3) { p.why = "occupied"; return "wait"; }
        sp = Math.min(sp, Math.sqrt(ahead.v * ahead.v + 2 * 1.5 * gap) - 1, ahead.v + gap / Math.max(SIM.idm.T, 0.5));
      }
      v.v = Math.max(0, sp);
      v.fade = 1;
      insertOcc(lane, v);
      this.vehicles.push(v);
      if (this.isFinal(v)) this.computeDestS(v);
      this.place(v, true);
      return "ok";
    }
    // slide out of the driveway: start offset towards the building
    const side = (lane.dir === 1 ? 1 : -1) * p.fromSide; // +1 = building on the right of travel
    // start at the kerb (less a little: the nose is already poking out) and slide across into the lane
    v.lat = endOut ? 0 : side * Math.max(LANE_W * 0.9, lc.d - 1.2);
    if (fromLot(p)) v.fade = 1; // it was drawn rolling out of its lot up to here
    if (crossing) {
      v.crossing = this.lanesAt(dkey(p.from.seg, best.dir === 1 ? -1 : 1), p.from.p);
      v.crossFrom = ls;
      // (at once: another pulling out this same step must see it)
      for (const c of v.crossing) { const a = this.crossers.get(c.lane); if (a) a.push(c.s - CROSS_SWEEP); else this.crossers.set(c.lane, [c.s - CROSS_SWEEP]); }
    }
    insertOcc(lane, v);
    this.vehicles.push(v);
    if (this.isFinal(v)) this.computeDestS(v);
    // nose out first: the tail is still in the driveway, angled back a little
    const ld = polyDirSmooth(lane.pl, clamp(ls, 0, lane.pl.length), 1), lr = right(ld);
    // (out of a gate at the end of the road: straight out, its tail still in the yard behind it)
    this.place(v, true, endOut ? { x: -ld.x, y: -ld.y } : norm({ x: lr.x * side - ld.x * 0.35, y: lr.y * side - ld.y * 0.35 }));
    return "ok";
  }

  /** Is the back of a vehicle's body over the lane its front is on (within half a lane of its line)? */
  /** Whether a car standing in a jam is at its front: nothing ahead of it close by that has stood as long. */
  private jamHead(v: Vehicle): boolean {
    const occ = v.edge.occ as Vehicle[];
    let ahead: Vehicle | undefined = occ[occ.indexOf(v) + 1];
    if (!ahead) {
      const nx = v.edge.kind === "lane" ? v.next : (v.edge as Connector).to;
      ahead = nx ? (nx.occ as Vehicle[])[0] : undefined;
    }
    return !ahead || ahead.stuck + 1 < v.stuck;
  }

  private tailIn(v: Vehicle): boolean {
    // (its back half straight enough along the lane that it doesn't swing out over the next: a body stopped still
    // at a slant, its tail out, is still in that lane's way). By the angle, not the place: a car drawn a little off
    // the lane's line (sliding across, at a lane's end) is no more in the way for that
    let ang = v.ang, half = v.len * 0.5;
    if (v.units && v.uPose) { const o = (v.units.length - 1) * 4; ang = v.uPose[o + 3]; half = v.units[v.units.length - 1].len * 0.5; }
    const e = v.edge as Lane, d = polyDirSmooth(e.pl, clamp(v.s - v.len * 0.5, 0, e.pl.length), 1);
    const sin = Math.abs(d.x * Math.sin(ang) - d.y * Math.cos(ang));
    return half * sin < 0.5;
  }

  /** The lanes one way along a road that a point beside it lies across from, with where (a turn lane only where it runs). */
  lanesAt(k: number, p: V2): { lane: Lane; s: number }[] {
    const out: { lane: Lane; s: number }[] = [];
    for (const l of this.lanesOf(k)) {
      const r = polyClosest(l.pl, p);
      if (l.pocket && r.d > 12) continue;
      out.push({ lane: l, s: r.s });
    }
    return out;
  }

  lanesOf(k: number): Lane[] {
    const g = this.net.segGeom.get(dkSeg(k));
    if (!g) return [];
    const d = dkDir(k);
    return g.lanes.filter((l) => l.dir === d);
  }

  // ---------------------------------------------------------------- main step

  step(dt: number) {
    this.time += dt;
    this.ringLoads.clear();
    this.updateSignals(dt);
    // spawns
    if (this.pending.length) {
      const keep: PendingSpawn[] = [];
      const gated = new Set<number>(); // lots whose gate a long truck already has this step
      const queued = new Set<number>(); // lots with a trip already held up this step (the ones after it wait their turn)
      for (const p of this.pending) {
        let t0 = p.t0 ?? 0;
        if (fromLot(p) && (p.len ?? 0) >= TRAIN) {
          // a long truck needs the lot's gate to itself: it rolls out once the one before it has pulled away
          const b = p.trip.from;
          if (gated.has(b)) { p.go = undefined; keep.push(p); continue; }
          gated.add(b);
          if (p.go === undefined) {
            // it waits in the yard till the one before it is out and its last trailer has cleared the kerb
            const gt = this.gates.get(b);
            if (gt && (gt.v.edge.occ as Vehicle[]).includes(gt.v) && Math.hypot(gt.v.x - gt.at.x, gt.v.y - gt.at.y) < gt.v.len / 2 + 5) { keep.push(p); continue; }
            this.gates.delete(b);
            p.go = Math.max(t0, this.time);
          }
          t0 = p.go;
        }
        if (fromLot(p) && this.time - t0 < EMERGE) { keep.push(p); continue; }
        const r = this.trySpawn(p);
        if (r === "ok" && p.go !== undefined) { this.gates.set(p.trip.from, { v: this.vehicles[this.vehicles.length - 1], at: p.from.p }); gated.delete(p.trip.from); } // (the next in line is up)
        if (r === "wait") {
          // (the first in a yard waiting for a gap is held up by the road; the ones after it are only waiting their
          // turn behind it: their time isn't a blocked driveway)
          const lot = fromLot(p) ? p.trip.from : -1;
          if (lot < 0 || !queued.has(lot)) p.wait += dt;
          if (lot >= 0) queued.add(lot);
          p.tries++;
          // (a car driving in from beyond the map waits its turn off-map, as at a CS outside connection)
          if (p.wait < (p.through ? 300 : 90)) keep.push(p); else this.ev.fail(p.trip, "blocked driveway", this.time);
        }
        else if (r === "fail") this.ev.fail(p.trip, "no route", this.time);
      }
      this.pending = keep;
    }

    const vs = this.vehicles;
    this.collectKeepClear();
    for (const [node, cl] of this.courtesy) {
      const cv = cl.v;
      const live = cv.edge.kind === "lane" && !cv.granted && cv.next?.node === node && (cv.edge.occ as Vehicle[]).includes(cv);
      // (a car waiting for room on its way out gives up its turn, unless that lane is only just pulling away)
      const full = cv.block === "box" && !(((cv.next?.to.occ as Vehicle[] | undefined)?.[0]?.v ?? 0) > 1);
      // (at lights it only lasts while its own light is green: its turn across traffic sharing that green)
      const sg = live ? this.signalState(node, cv.next!.armIn, cv.next!.turn) : "none";
      if (!live || this.time > cl.until || full || sg === "red" || sg === "yellow") {
        this.courtesy.delete(node);
        this.courtesyRest.set(node, this.time + 8);
      }
    }
    if (this.courtesyRest.size > 64) for (const [n, t] of this.courtesyRest) if (t < this.time) this.courtesyRest.delete(n);

    // where long bodies trail back over the edges behind their fronts
    this.collectTails();
    // the jam breaker's pick at each junction: whoever has stood there longest without moving at all, past JAM_BREAK
    this.breakFor.clear();
    for (const v of vs) {
      if (v.edge.kind !== "lane" || !v.next || v.granted) continue;
      // (where it has already had to break the lock, the cars after come on after a short wait, not two minutes each)
      if (v.wait < (this.time < (this.breakHot.get(v.next.node) ?? 0) ? JAM_BREAK_AGAIN : JAM_BREAK)) continue;
      const b = this.breakFor.get(v.next.node);
      if (!b || v.wait > b.wait) this.breakFor.set(v.next.node, v);
    }
    // junction permissions (only the front vehicle of each lane asks)
    for (const v of vs) this.planJunction(v);
    // accelerations
    for (const v of vs) v.acc = this.accel(v);
    // integrate + edge transitions
    const done: Vehicle[] = [];
    for (const v of vs) {
      v.px = v.x; v.py = v.y; v.ph = v.h; v.pang = v.ang;
      if (v.uPose) v.puPose!.set(v.uPose);
      if (v.quit !== undefined) {
        // giving up: it shrinks away where it stands, then it's gone
        v.v = 0;
        v.quit -= dt;
        v.fade = Math.max(0, v.quit / QUIT_FADE);
        if (v.quit <= 0) done.push(v);
        continue;
      }
      if (v.dwell !== undefined) {
        // a bus at its stop stands still (the traffic behind waits or goes round it), then plans its way on
        v.v = 0;
        v.wait = 0;
        v.stuck = 0;
        v.lcCool = Math.max(v.lcCool, 1);
        v.dwell -= dt;
        if (v.dwell <= 0) { v.dwell = undefined; this.reroute(v); }
        continue;
      }
      v.v = Math.max(0, v.v + v.acc * dt);
      v.s += v.v * dt;
      v.ideal += v.constrained ? (v.v * dt) / Math.max(v.v0e, 1) : dt;
      if (v.v < 0.3) { v.wait += dt; v.stuck += dt; } else { v.wait = 0; v.stuck = Math.max(0, v.stuck - dt * 2); }
      v.odo = (v.odo ?? 0) + v.v * dt;
      if (v.odo - (v.progOdo ?? 0) > PROGRESS) { v.progOdo = v.odo; v.progT = this.time; }
      if (v.fade < 1) v.fade = Math.min(1, v.fade + dt * 2.5);
      if (v.lat !== 0) {
        // steer across smoothly: sideways speed builds up and eases off (an S-curve), and it comes from driving
        // forward at an angle, so a car that stops mid-change stays where it is
        const aLat = 1.6;
        // (a little sideways creep even at a standstill, so a car that stops halfway never sits across two lanes)
        const cap = Math.min((LANE_W / SIM.laneChangeTime) * 1.7, Math.max(v.v * 0.26, 0.45));
        const want = -Math.sign(v.lat) * Math.min(cap, Math.sqrt(2 * aLat * Math.abs(v.lat)));
        let lv = v.latV ?? 0;
        lv += clamp(want - lv, -aLat * dt, aLat * dt);
        if (Math.abs(lv) > cap) lv = Math.sign(lv) * cap;
        const nl = v.lat + lv * dt;
        const was = v.lat;
        if (Math.abs(v.lat) < 0.02 || Math.sign(nl) !== Math.sign(v.lat)) { v.lat = 0; v.latV = 0; }
        else { v.lat = nl; v.latV = lv; }
        // what steering could give at this speed turns the car; the creep beyond it slides it across, pointing ahead
        const moved = v.lat - was, steer = v.v * 0.26 * dt;
        if (Math.abs(moved) > steer) v.slide = (v.slide ?? 0) + moved - Math.sign(moved) * steer;
      }
      v.lcCool -= dt;
      const r = this.advance(v);
      // the junction reservation ends once the whole car is out on the exit lane (a road train's tail can still be
      // in the box with its front a lane further on)
      const hc = v.holding;
      if (hc && v.edge !== hc.from && v.edge !== hc && !(v.edge === hc.to && v.s - v.len <= 0.5) && !this.bodyOn(v, hc, 0.5)) this.release(v);
      if (v.boxes) this.boxesOn(v);
      if (r) done.push(v);
      else if (v.stuck > GIVE_UP && this.time - (v.progT ?? v.born) > GIVE_UP && (this.jamHead(v) || v.stuck > GIVE_UP + 90)) {
        // last resort so a broken layout can never freeze the city (see JAM_BREAK): the driver gives up. Only where
        // it is really stuck: a queue that keeps crawling on (stop, roll a car length, stop again) gets there in the
        // end, and giving up in it would only send the load out again from the start, into the same queue. And only
        // the one at the front of the frozen queue (the rest move up once it's gone), unless that front can't be
        // told (a loop of cars each waiting on the next): then a while later anyone in it
        this.ev.fail(v.trip, "gave up in traffic", this.time);
        v.quit = QUIT_FADE;
        this.jamQuits++;
      }
    }
    for (const v of done) this.remove(v);
    // lane changes a few times a second
    this.lcTimer += dt;
    if (this.lcTimer > 0.25) {
      this.lcTimer = 0;
      for (const v of vs) if (v.edge.kind === "lane" && v.lcCool <= 0) this.laneChange(v);
      this.wishes.clear();
      for (const v of vs) {
        const w = v.wish;
        if (!w) continue;
        if (this.time - w.t > 0.6 || v.edge.kind !== "lane" || (v.edge as Lane).seg !== w.lane.seg) { v.wish = undefined; continue; }
        const a = this.wishes.get(w.lane);
        if (a) a.push(v); else this.wishes.set(w.lane, [v]);
      }
    }
    for (const v of vs) this.place(v, false);
    this.statTimer += dt;
    if (this.statTimer >= 1) {
      this.statTimer = 0;
      this.stats();
    }
  }

  /** Returns true when the vehicle finished (arrived). */
  private advance(v: Vehicle): boolean {
    for (let guard = 0; guard < 4; guard++) {
      const e = v.edge;
      if (e.kind === "lane") {
        const lane = e as Lane;
        // arrival
        if (this.isFinal(v) && v.destS < 0 && lane.seg === v.dest.seg) this.computeDestS(v);
        if (this.isFinal(v) && v.destS >= 0) {
          if (v.exit) {
            if (v.s >= v.destS) {
              if (v.lost) return true;
              v.trip.freeFlow = v.ideal;
              v.arrived = true;
              this.ev.arrive(v, this.time);
              return true;
            }
          } else if (lane.idx === this.turnIdx(v, lane) && v.s >= v.destS - 1.5) {
            // pulled up just short of it, waiting to turn in (a car stops about 0.85 m short): the same patience
            // with a queue across the driveway as one right at it
            if (v.s < v.destS - 0.8) {
              if (v.v < 0.5 && v.wait > 8 && !this.canTurnIn(v, lane) && this.turnBlockedByQueue) this.goRound(v, lane);
              return false;
            }
            if ((v.turnOk && v.v > 1) || this.canTurnIn(v, lane)) {
              if (v.trip.bus && !v.lost) {
                const nx = this.ev.busAt?.(v);
                if (nx) {
                  // pulled up at the kerb: riders off and on, then on to the next stop
                  v.dwell = nx.dwell;
                  v.dest = nx.to;
                  v.destSide = nx.to.side ?? 1;
                  v.destS = -1;
                  v.v = 0;
                  v.turnOk = false;
                  return false;
                }
              }
              // pulling out of a driveway takes a moment even on a quiet street: the first seconds aren't delay
              v.trip.freeFlow = v.ideal + Math.min(6, v.born - v.trip.startT);
              v.arrived = true;
              this.ev.arrive(v, this.time);
              return true;
            }
            v.v = 0; // stopped at the driveway (never pulled back: that shows as a jump)
            // a stopped queue sits across the driveway: rather than wait it out (and maybe lock the
            // junction behind us), drive on and come back round to turn in from the near side
            if (v.wait > 8 && this.turnBlockedByQueue) this.goRound(v, lane);
            return false;
          }
          if (lane.idx !== this.turnIdx(v, lane) && v.s > v.destS + 1) {
            // missed the driveway (wrong lane): loop around
            this.reroute(v);
          }
        }
        // lost with nowhere to go: leave the road at the end of the lane rather than block it
        if (v.lost && this.isFinal(v) && (lane.seg !== v.dest.seg || v.destS < 0) && v.s >= lane.pl.length - 3) return true;
        if (v.s <= lane.pl.length) return false;
        if (!v.next || !v.granted) {
          v.s = lane.pl.length;
          v.v = 0;
          return false;
        }
        const c = v.next;
        const over = v.s - lane.pl.length;
        removeOcc(lane, v);
        this.leftEdge(v, lane);
        v.edge = c;
        v.s = over;
        insertOcc(c, v);
        v.next = null;
        v.granted = false;
        v.stopAt = undefined;
      } else {
        const c = e as Connector;
        if (v.s <= c.pl.length) return false;
        const over = v.s - c.pl.length;
        removeOcc(c, v);
        this.leftEdge(v, c);
        v.edge = c.to;
        v.s = over;
        insertOcc(c.to, v);
        // advance the route
        const k = dkey(c.to.seg, c.to.dir);
        const idx = v.route.indexOf(k, v.ri + 1);
        if (idx >= 0) v.ri = idx;
        else {
          v.route = [k];
          v.ri = 0;
          this.reroute(v);
        }
        v.destS = -1;
        if (this.isFinal(v)) this.computeDestS(v);
      }
    }
    return false;
  }

  private isFinal(v: Vehicle) {
    return v.ri >= v.route.length - 1;
  }

  /** The front of a vehicle left an edge for the next one: remember it while the body may still trail over it. */
  private leftEdge(v: Vehicle, e: Edge, end = e.pl.length) {
    const h = v.hist ?? (v.hist = []), sp = v.histSpan ?? (v.histSpan = []);
    h.push(e);
    sp.push([Math.min(v.entS ?? 0, end), end]);
    v.entS = undefined;
    if (h.length > HIST) { h.shift(); sp.shift(); }
  }

  /** How much of a vehicle's length is behind the start of the stretch of the edge it is on now. */
  private behind(v: Vehicle, margin = 0): number {
    return v.len - Math.max(0, v.s - (v.entS ?? 0)) + margin;
  }

  // edge -> long vehicles whose body (not their front) is on it, and where their rear is along it (this step)
  private tails = new Map<Edge, { v: Vehicle; rear: number }[]>();

  /** Where each long vehicle's body trails back over the edges its front has left (see tails). */
  private collectTails() {
    this.tails.clear();
    for (const v of this.vehicles) {
      if (v.len < LONG || !v.hist?.length) continue;
      let rem = this.behind(v);
      for (let k = v.hist.length - 1; k >= 0 && rem > 0; k--) {
        const e = v.hist[k];
        const [a0, a1] = v.histSpan?.[k] ?? [0, e.pl.length];
        const rear = Math.max(a0, a1 - rem);
        const a = this.tails.get(e);
        if (a) a.push({ v, rear }); else this.tails.set(e, [{ v, rear }]);
        rem -= a1 - a0;
      }
    }
  }

  /** Is part of a vehicle's body on edge `e` (its rear more than `margin` short of the end of it)? */
  private bodyOn(v: Vehicle, e: Edge, margin = 0): boolean {
    if (v.edge === e) return true;
    if (!v.hist?.length || v.len < LONG) return false;
    let rem = this.behind(v, margin);
    for (let k = v.hist.length - 1; k >= 0 && rem > 0; k--) {
      if (v.hist[k] === e) return true;
      const [a0, a1] = v.histSpan?.[k] ?? [0, v.hist[k].pl.length];
      rem -= a1 - a0;
    }
    return false;
  }

  /**
   * How far a vehicle's front is past the start of connector `o` (negative: still short of it), when it is on the
   * lane into it, on it, or (its body still trailing back through it) on an edge after it. NaN: none of those.
   */
  private posOn(h: Vehicle, o: Connector): number {
    const e = h.edge;
    if (e === o) return h.s;
    if (e === o.from) return h.s - o.from.pl.length;
    if (e === o.to) return o.pl.length + h.s;
    if (!h.hist?.length) return NaN;
    let acc = h.s - (h.entS ?? 0);
    for (let k = h.hist.length - 1; k >= 0; k--) {
      const x = h.hist[k];
      if (x === o) return acc + o.pl.length;
      const [a0, a1] = h.histSpan?.[k] ?? [0, x.pl.length];
      acc += a1 - a0;
      if (acc > h.len + o.pl.length) break;
    }
    return NaN;
  }

  /** The lane a car on its last road turns into its destination from: kerb lane, or the inner lane for the far side. */
  private turnIdx(v: Vehicle, lane: Lane): number {
    // (a gate at the end of the road is driven straight into: from the kerb lane, as on its own side)
    return v.destEnd || (lane.dir === 1 ? 1 : -1) * v.destSide > 0 ? 0 : lane.count - 1;
  }

  /**
   * Is a driveway at the dead end of its road (see END_GATE)? The way a vehicle leaves it: 1 along the road, -1
   * against it; 0 when it is beside a road like any other.
   */
  endGate(a: Access): 1 | -1 | 0 {
    const net = this.net, sg = net.segs.get(a.seg), g = net.segGeom.get(a.seg);
    if (!sg || !g) return 0;
    if (a.s < END_GATE && net.segsAt(sg.a).length === 1) return 1;
    if (a.s > g.center.length - END_GATE && net.segsAt(sg.b).length === 1) return -1;
    return 0;
  }

  private computeDestS(v: Vehicle) {
    const lane = v.edge as Lane;
    if (lane.kind !== "lane" || lane.seg !== v.dest.seg) { v.destS = -1; return; }
    // all lanes of this direction share roughly the same arc-length
    v.destS = polyClosest(lane.pl, v.dest.p).s;
    // (driving up to a gate at the end of this road: straight in)
    v.destEnd = this.endGate(v.dest) === -lane.dir;
    if (v.destS < v.s - 1) {
      // already past it on this lane: loop
      v.destS = -1;
      this.reroute(v);
    }
  }

  private canTurnIn(v: Vehicle, lane: Lane): boolean {
    const sideOfTravel = (lane.dir === 1 ? 1 : -1) * v.destSide; // +1 = on our right
    if (sideOfTravel > 0 || v.destEnd) return true;
    // crossing the opposite carriageway: wait for a gap, with growing impatience
    const opp = this.lanesAt(dkey(lane.seg, lane.dir === 1 ? -1 : 1), v.dest.p);
    const need = v.wait > 12 ? 0.8 : v.wait > 5 ? 1.6 : 2.6;
    this.turnBlockedByQueue = false;
    // judged for when we get there (asked from a way off, a car that will be long gone by then is no reason to stop)
    // (a cautious guess both ways: we may get there as soon as at our present speed, or as late as slowing to 5 m/s)
    const dd = v.destS >= 0 ? Math.max(0, v.destS - v.s) : 0;
    const tMe = dd / Math.max((v.v + 5) / 2, 1), tSoon = dd / Math.max(v.v, 5);
    for (const { lane: ol, s: os } of opp) {
      for (const o of ol.occ as Vehicle[]) {
        // two cars turning across each other into facing driveways: the older one goes first
        if (o.v < 0.5 && o.id > v.id && o.destS >= 0 && this.isFinal(o) && Math.abs(o.destS - 0.8 - o.s) < 1.5) continue;
        // (an oncoming car speeding up, e.g. just pulled out, gets there sooner than its present speed says)
        const ov = Math.max(o.v, 0.5), vm = Math.max(ov, ol.speed * (o.truck ? 0.85 : 1));
        const reach = (d: number) => { const t1 = (vm - ov) / 2, d1 = ((ov + vm) / 2) * t1; return d <= d1 ? (-ov + Math.sqrt(ov * ov + 4 * d)) / 2 : t1 + (d - d1) / vm; };
        if (o.s > os - 3 && o.s - o.len < os + 3) {
          // passing now, its tail clear before our nose is into its lane (about half a second after we reach the driveway)
          if (o.v > 0.5 && (os + 2 - (o.s - o.len)) / ov < tSoon + 0.3) continue;
          this.turnBlockedByQueue = o.v < 0.5;
          return false;
        }
        if (o.s < os) {
          const tO = o.v < 0.5 && o.wait > 1 ? (os - o.s) / ov : reach(os - o.s), gone = (os + 2 - (o.s - o.len)) / ov;
          if (tO < tMe + need && gone > tSoon + 0.3) return false;
        }
      }
    }
    return true;
  }

  // ---------------------------------------------------------------- junction logic

  private planJunction(v: Vehicle) {
    const e = v.edge;
    if (e.kind !== "lane") return;
    const lane = e as Lane;
    // only the vehicle closest to the stop line asks
    const occ = lane.occ as Vehicle[];
    if (occ[occ.length - 1] !== v) return;
    if (this.isFinal(v) && (lane.seg === v.dest.seg || !this.findWay(v, lane))) return;
    const toEnd = lane.pl.length - v.s;
    const check = this.askAt(v);
    if (toEnd > check) return;
    if (!v.next) {
      v.next = this.pickConnector(v, lane);
      v.granted = false;
      v.forced = false;
      if (!v.next) {
        // wrong lane at the end: after a short wait, take any exit and re-plan
        if (((toEnd < 2 && v.wait > 3.5 && !v.wish) || (v.wish && toEnd < 9 && (v.wait > 20 || (v.wait > 4 && this.swapLocked(v, lane))))) && lane.outs.length) {
          // prefer a way on from which the destination can still be reached
          const viable = lane.outs.filter((c) => this.router.routeFromKey(dkey(c.to.seg, c.to.dir), v.dest));
          const pool = viable.length ? viable : lane.outs;
          const alt = pool[(Math.random() * pool.length) | 0];
          v.route = [dkey(lane.seg, lane.dir), dkey(alt.to.seg, alt.to.dir)];
          v.ri = 0;
          v.next = alt;
          this.rerouteFrom(v, 1);
        }
        return;
      }
    }
    if (v.granted) {
      // a grant is only final once the car can't comfortably stop any more; until then it is re-checked,
      // so a reservation made far out can't hold up everyone else (or a full exit) for seconds on end
      // (and only while it can still stop gently: a late change of plan shows as an emergency stop)
      if (v.forced || this.committed(v, 0.5) || this.canEnter(v, v.next, toEnd)) return;
      v.granted = false;
      this.release(v);
      return;
    }
    let ok = this.canEnter(v, v.next, toEnd);
    const node = v.next.node;
    // the jam breaker (see JAM_BREAK): frozen this long, the longest waiter here goes in regardless of give-way or
    // room on its exit; never at a red light, nor through a car that is physically in its way
    if (!ok && this.breakFor.get(node) === v && toEnd < 3 && v.v < 0.3 && v.block !== "red" && v.block !== "crossing") {
      ok = true;
      v.forced = true;
      this.breakHot.set(node, this.time + 60);
      this.jamBreaks++;
    }
    // (at lights only a long truck, on its green: one that can't squeeze past oncoming traffic at all would
    // otherwise wait green after green. A car turning across oncoming traffic waits for a gap, or for a turn phase)
    const sg = this.signalState(node, v.next.armIn, v.next.turn);
    if (!ok && v.wait > 18 && toEnd < 3 && (v.block === "yield" || v.block === "reserved" || v.block === "crossing") && !this.courtesy.has(node) && this.time > (this.courtesyRest.get(node) ?? 0) && (sg === "none" || (sg === "green" && v.len >= LONG))) {
      this.courtesy.set(node, { v, until: this.time + 10 });
    }
    if (ok) {
      if (this.courtesy.get(node)?.v === v) { this.courtesy.delete(node); this.courtesyRest.set(node, this.time + 6); }
      if (this.roomClaim.get(v.next.to) === v) this.roomClaim.delete(v.next.to);
      v.granted = true;
      v.grantT = ++this.grantSeq;
      if (v.holding !== v.next) {
        this.letGo(v);
        v.next.holders.push(v);
      }
      v.holding = v.next;
    }
  }

  private pickConnector(v: Vehicle, lane: Lane): Connector | null {
    const nk = v.route[v.ri + 1];
    if (nk === undefined) return null;
    const opts = lane.outs.filter((c) => dkey(c.to.seg, c.to.dir) === nk);
    if (!opts.length) return null;
    if (opts.length === 1) return opts[0];
    // prefer target lanes that serve the move after, then the emptier one
    const nn = v.route[v.ri + 2];
    let best = opts[0], bestScore = -Infinity;
    for (const c of opts) {
      let score = 0;
      if (nn !== undefined && c.to.outs.some((x) => dkey(x.to.seg, x.to.dir) === nn)) score += 10;
      if (nn === undefined && c.to.idx === this.turnIdx(v, c.to)) score += 10;
      score -= (c.to.occ.length + c.holders.length) * 1.5;
      if (score > bestScore) { bestScore = score; best = c; }
    }
    return best;
  }

  /** The light for traffic from arm `armSeg` turning `turn` ("L", "S", "R", "U"; a left-turn phase greens only L and U). */
  signalState(nodeId: number, armSeg: number, turn?: string): "green" | "yellow" | "red" | "none" {
    const n = this.net.nodes.get(nodeId);
    if (!n || !n.signal || !n.signal.phases.length) return "none";
    let c = this.sigCtl.get(nodeId);
    if (!c) this.sigCtl.set(nodeId, (c = { plan: n.signal, i: Math.max(0, n.signal.phases.findIndex((p) => !p.left && p.arms.length)), st: 0, t: 0 }));
    else if (c.plan !== n.signal) this.resetSignal(c, n.signal);
    if (!goesIn(n.signal.phases[c.i], armSeg, turn)) return "red";
    return c.st === 0 ? "green" : c.st === 1 ? "yellow" : "red";
  }

  /**
   * A left turn at the change of the lights (a "sneaker"): on a green that lets it go but only through gaps in the
   * oncoming traffic, a turn standing at the line may still go once its light turns amber, and in the moment of all
   * red after: the oncoming cars stop for their light then. Without it, a left turn on a single-lane road facing a
   * steady stream stood there round after round, and the whole queue behind it with it.
   */
  private sneaks(v: Vehicle, c: Connector, toEnd: number): boolean {
    if ((c.turn !== "L" && c.turn !== "U") || toEnd > 2.5 || v.v > 0.5 || v.wait < 1) return false;
    const ctl = this.sigCtl.get(c.node);
    if (!ctl || ctl.st === 0) return false;
    const ph = ctl.plan.phases[ctl.i];
    return !!ph && !ph.left && goesIn(ph, c.armIn, c.turn);
  }

  /**
   * Right turn on red: from a standstill at the line, when nothing with a green is coming its way (a car going
   * through on its green, or still in the junction). The usual checks (room on the exit, the box) come after.
   */
  private rightOnRed(v: Vehicle, c: Connector, toEnd: number): boolean {
    if (!v.granted && (toEnd > 2.5 || v.v > 0.5 || v.wait < 1)) return false;
    for (const cf of c.conflicts) {
      const o = cf.c;
      for (const h of o.holders as Vehicle[]) if (h !== v && !this.clearsBefore(h, o, cf, 6, false, 1)) return false;
      if (this.signalState(o.node, o.armIn, o.turn) === "red") continue;
      const ap = o.from.occ as Vehicle[];
      for (let k = ap.length - 1; k >= 0; k--) {
        const w = ap[k];
        const d = o.from.pl.length - w.s;
        if (d > 90) break;
        const goes = w.next ? w.next === o : w.route[w.ri + 1] === dkey(o.to.seg, o.to.dir);
        if (!goes || w === v) continue;
        if (d / Math.max(w.v, 0.5) < 6 && (w.v > 1 || d < 8)) return false;
        break; // (the one nearest the line decides: those behind it come later still)
      }
    }
    return true;
  }

  /**
   * The player edited the lights' plan. If the phase that is on still lets the same arms go, the light carries
   * on as it was (a change of time elsewhere changes nothing now); otherwise it goes to all red, and on from there.
   */
  private resetSignal(c: { plan: SignalPlan; i: number; st: 0 | 1 | 2; t: number }, plan: SignalPlan) {
    const wasPh = c.plan.phases[c.i];
    const was = wasPh?.arms ?? [];
    c.plan = plan;
    c.i = Math.min(c.i, plan.phases.length - 1);
    const now = plan.phases[c.i].arms;
    if (was.length === now.length && was.every((a) => now.includes(a)) && !wasPh?.left === !plan.phases[c.i].left) return;
    c.st = 2;
    c.t = 0;
  }

  /**
   * The lights are dumb, on a fixed clock (owner, 2026-11-08: "keep lights dumb, they don't read traffic ... 24
   * seconds for each is enough"): every phase is green for GREEN s (a left-turn arrow LEFT_GREEN s), then amber,
   * then all red, then the next phase, round and round whatever the traffic does. A long steady green lets a whole
   * queue go at once, where cutting greens short to follow the cars made them stop and start. Only a phase that
   * lets nobody go at all is passed over. (Stored per-phase times, from older saves, aren't used.)
   */
  private updateSignals(dt: number) {
    for (const [id, c] of this.sigCtl) {
      const n = this.net.nodes.get(id);
      if (!n?.signal || !n.signal.phases.length) { this.sigCtl.delete(id); continue; }
      if (c.plan !== n.signal) this.resetSignal(c, n.signal);
      c.t += dt;
      const ph = c.plan.phases;
      if (c.st === 0) { if (ph.length > 1 && c.t >= greenFor(ph[c.i])) { c.st = 1; c.t = 0; } continue; }
      if (c.st === 1) { if (c.t >= AMBER) { c.st = 2; c.t = 0; } continue; }
      if (c.t < ALL_RED) continue;
      let to = c.i;
      for (let k = 1; k <= ph.length; k++) if (ph[(c.i + k) % ph.length].arms.length) { to = (c.i + k) % ph.length; break; }
      c.i = to; c.st = 0; c.t = 0;
    }
  }

  private canEnter(v: Vehicle, c: Connector, toEnd: number): boolean {
    v.blockTo = undefined;
    const ng = this.net.nodeGeom.get(c.node);
    if (!ng) return false;
    if (ng.kind === "cont" || ng.kind === "bend") return true;
    if (ng.kind === "split" || ng.kind === "lane") {
      // the main line never stops for a slip road: a merging car finds a gap and falls in (car-following does the rest)
      // (at a weave the carriageway's traffic is free and the slip lane's gives way, to it crossing over as well)
      if (c.free || (c.turn === "S" && c.free !== false)) return true;
      for (const cf of c.conflicts) if ((cf.merge || cf.c.free) && !this.mergeOk(v, c, cf.c)) { v.block = "yield"; return false; }
      return true;
    }
    // two roads meeting (one road changing type, or what's left of a removed crossing): nothing crosses here, so
    // there is no box to keep clear. Cars just follow on; where lanes narrow they zip in turn.
    if (ng.arms.length === 2 && c.conflicts.every((cf) => cf.merge) && !this.net.nodes.get(c.node)?.signal && !this.net.segs.get(c.to.seg)?.ring && !this.net.segs.get((c.from as Lane).seg)?.ring) {
      for (const cf of c.conflicts) if (cf.merge && !this.mergeOk(v, c, cf.c)) { v.block = "yield"; return false; }
      return true;
    }
    // a stop sign: a full stop at the line first (then the usual giving way, to everyone: its arm ranks lowest)
    if (c.prio <= -1 && !v.granted && v.stopAt !== c) {
      if (toEnd > 2.5 || v.v > 0.3) { v.block = "stop"; return false; }
      v.stopAt = c;
    }
    // signals
    const sig = this.signalState(c.node, c.armIn, c.turn);
    const sneak = sig !== "none" && sig !== "green" && this.sneaks(v, c, toEnd);
    if (sig === "red" && !sneak && !(c.turn === "R" && this.rightOnRed(v, c, toEnd))) { v.block = "red"; return false; }
    // letting a long-waiting car out: hold back if our path crosses its and we can still stop
    const cl = this.courtesy.get(c.node);
    if (cl && cl.v !== v && cl.v.next && !this.committed(v) && this.crossesCourtesy(cl.v, c, v)) { v.block = "courtesy"; return false; }
    if (sig === "yellow" && !sneak && toEnd > (v.v * v.v) / (2 * SIM.idm.b) + 1) { v.block = "red"; return false; }
    // don't block the box: room on the exit lane. Not between arcs of the same roundabout:
    // circulating cars just follow each other (requiring a free arc ahead gridlocks a full ring)
    const out = c.to;
    const ringIn = this.net.segs.get((c.from as Lane).seg)?.ring ?? 0;
    const ringId = this.net.segs.get(out.seg)?.ring ?? 0;
    if (ringIn && ringId === ringIn) return this.conflictsClear(v, c, sig, toEnd);
    if (ringId) return this.ringEntry(v, c, ringId, sig, toEnd);
    let free = out.pl.length;
    const first = (out.occ as Vehicle[])[0];
    // (a road train whose front is already further on still fills this lane with its trailers)
    const tl = this.tails.get(out);
    if (tl) for (const t of tl) if (t.v !== v) free = Math.min(free, t.rear);
    // how far the last one on the exit lane can still roll on without a go-ahead of its own: to its stop line, or
    // to the driveway it will stand at waiting to turn in across the road (one that turns in on its own side, or
    // has its go-ahead at the next junction, is on its way out of the lane)
    let run = Infinity;
    if (first) {
      free = first.s - first.len;
      if (this.isFinal(first) && first.destS >= 0 && !first.exit) run = (out.dir === 1 ? 1 : -1) * first.destSide > 0 || first.destEnd ? Infinity : Math.max(0, first.destS - first.s);
      else if (!first.granted) run = Math.max(0, out.pl.length - first.s);
      // still some way off: what matters is the room there will be when we get there. A crawling queue
      // keeps creeping on, so a car isn't stopped (and then waved on again) every time it bunches up.
      // (at most about a car's length: a queue that stalls after all mustn't leave us standing in the junction)
      if (first.v > 0.5 && toEnd > 3) free += Math.min(v.len + 2, run, first.v * 0.7 * ((toEnd + c.pl.length) / Math.max(v.v, 2)));
    }
    for (const h of this.holdersInto(out)) {
      if (h === v) continue;
      if (this.outranks(v, h)) continue; // still far off and able to stop: it re-checks and waits for us
      free -= h.len + 2;
    }
    // (moving, and with the road to move on far enough for us to fit in behind it: a car rolling up to the stop
    // line of a short link, or to a driveway it must wait at, is about to stand right where we would need to be,
    // and following it in left us stopped in the junction, across everyone else's way)
    const moving = first && first.v > 3 && first.s - first.len + run >= v.len + 0.5;
    // someone else has been waiting at their line for room on this lane: they get it first
    const claim = this.roomClaim.get(out);
    if (claim && claim !== v) {
      if (!this.claimLive(claim, out)) this.roomClaim.delete(out);
      // (it holds back new go-aheads; one already given stands, or the car would brake and go again)
      else if (!v.granted && claim.wait > v.wait + 2 && !(v.v > 2 && toEnd <= (v.v * v.v) / (2 * 3.5) + 0.5)) { v.block = "box"; return false; }
    }
    if (free < v.len + (v.granted ? 0.5 : 1.5) && !(moving && free > 0.5)) {
      // a short link lane can't hold a car: allow if the lane after it is clear (chain of cont nodes)
      if (!(out.pl.length < v.len + 2 && !first)) {
        v.block = "box";
        if (toEnd < 3 && (!claim || claim === v || !this.claimLive(claim, out) || v.wait > claim.wait)) this.roomClaim.set(out, v);
        return false;
      }
    }
    return this.conflictsClear(v, c, sig, toEnd);
  }

  /**
   * Will `h`, driving through connector `o`, be clear of the spot `sOther` along it (rear past it) by time `t`
   * from now? A car with its go-ahead (or `go`: as if it had one) pulls away and takes the junction at its speed;
   * one without keeps its present speed, and if it is stopped, it isn't going anywhere.
   * Both cars at a crossing judge each other with this, so a go-ahead given on it is never taken back by it.
   */
  private clearsBefore(h: Vehicle, o: Connector, cf: { sOther: number }, t: number, go = false, margin = 0.8): boolean {
    const e = h.edge;
    const pos = this.posOn(h, o);
    if (Number.isNaN(pos)) return false;
    const need = cf.sOther + 1.2 + h.len - pos;
    if (need <= 0) return true;
    let time: number;
    if (go || h.granted || e !== o.from) {
      const vm = Math.max(o.speed, 2);
      if (h.v >= vm) time = need / ((h.v + vm) / 2);
      else {
        // (a heavy truck pulls away slower: it takes longer to clear)
        const A = 1.5 * Math.min(1, h.af ?? 1), t1 = (vm - h.v) / A, d1 = ((h.v + vm) / 2) * t1;
        time = need <= d1 ? (-h.v + Math.sqrt(h.v * h.v + 2 * A * need)) / A : t1 + (need - d1) / vm;
      }
    } else {
      if (h.v < 1) return false;
      time = need / ((h.v + Math.min(h.v, o.speed)) / 2);
    }
    return time + margin < t;
  }

  /** Soonest a car could reach the spot `sOn` along connector `c` (at its speed, or the junction's if faster). */
  private reachIn(v: Vehicle, c: Connector, sOn: number): number {
    const e = v.edge;
    const d = e === c.from ? e.pl.length - v.s + sOn : e === c ? sOn - v.s : 0;
    return Math.max(0, d - 1) / Math.max(v.v, c.speed, 1);
  }

  private conflictsClear(v: Vehicle, c: Connector, sig: ReturnType<Traffic["signalState"]>, toEnd: number): boolean {
    const ringMerge = !!this.net.segs.get(c.to.seg)?.ring;
    const sneak = sig !== "none" && sig !== "green" && this.sneaks(v, c, toEnd);
    v.overrode = false;
    // (near misses only matter to long bodies: a long one waits for any holder, anyone waits for a long holder)
    const near = c.near ?? [];
    for (const cf of near.length ? c.conflicts.concat(near) : c.conflicts) {
      const o = cf.c;
      const isNear = near.includes(cf);
      if (ringMerge && cf.merge) {
        // (traffic already going round has the right of way: it never stops for a car waiting to come on, only
        // follows one that has come on ahead of it, which car-following does)
        if (c.prio > o.prio) continue;
        if (!this.mergeOk(v, c, o)) { v.block = "yield"; return false; }
        continue;
      }
      const tMe = this.reachIn(v, c, cf.sSelf);
      // re-checking a go-ahead already given: estimates drift a little as cars slow for turns, and that alone
      // mustn't take it back (only a real hold-up does)
      const m = v.granted ? -0.3 : 0.8;
      for (const h of o.holders as Vehicle[]) {
        if (h === v) continue;
        if (isNear && (cf.wide ? v.len < LONG || h.len < LONG : v.len < LONG && h.len < LONG)) continue;
        // it got its go-ahead after ours, knowing about us: it fits round us, not we round it
        // (unless it was let out ahead of us: then it is us who hold back)
        if (v.granted && (h.grantT ?? 0) > (v.grantT ?? 0) && h.edge === o.from && !h.overrode) continue;
        if (this.clearsBefore(h, o, cf, tMe, false, m)) continue; // long gone by the time we get there
        // both heading into the same lane and still short of it: one falls in behind the other, so this only
        // decides who goes first. Once we have our go-ahead, following does the rest (no going back on it).
        if (cf.merge && h.edge === o.from) {
          const tH = this.reachIn(h, o, cf.sOther);
          if (v.granted || tH + 1.2 < tMe || tMe + 1.5 < tH) continue;
        }
        const hp = h.edge === o.from ? NaN : this.posOn(h, o);
        if (!Number.isNaN(hp)) {
          // on the connector, or already out on its exit lane (or past it: a road train) with the tail still in the box
          const rear = hp - h.len;
          if (rear < cf.sOther + 1.2) { v.block = "crossing"; v.blockTo = o.to; return false; }
        } else if (this.clearsBefore(v, c, { sOther: cf.sSelf }, this.reachIn(h, o, cf.sOther), true, m)) {
          continue; // we're through before it gets there: it needn't even slow down
        } else if (!this.letsOut(v, h)) {
          v.block = "reserved"; v.blockTo = o.to; return false; // it has the junction; we wait our turn
        } else v.overrode = true;
      }
      // yield to higher-priority traffic that is about to arrive (unless it is stopping to let us out, or
      // waiting for room on the same lane behind us)
      // (traffic on the crossing road holds back for a courtesy car itself: see "courtesy" in canEnter)
      if (isNear || this.courtesy.get(c.node)?.v === v) continue;
      const exempt = cf.merge && o.to === c.to && this.roomClaim.get(c.to) === v;
      const yieldTo = o.prio > c.prio || (sig !== "none" && c.turn === "L" && o.turn !== "L" && !cf.merge) || (cf.merge && o.prio === c.prio && o.turn === "S" && c.turn !== "S");
      if (yieldTo) {
        if (sig !== "none" && this.signalState(o.node, o.armIn, o.turn) === "red") continue;
        const ap = o.from.occ as Vehicle[];
        const w = ap[ap.length - 1];
        if (w && w !== v && (w.next === o || (w.next === null && !this.isFinal(w)))) {
          if (exempt && !this.committed(w)) continue; // it can still stop for us
          // it stands at its line waiting for room on its way out (not for us): it is not about to come through.
          // Giving way to it all the same could lock a junction: it waits for room, the room waits for us.
          if (w.next === o && !w.granted && w.block === "box" && w.v < 0.3 && w.wait > 1 && o.to !== c.to) continue;
          if (this.clearsBefore(w, o, cf, tMe, false, m)) continue; // it goes through before we get there
          // (turning off at the change of the lights: one that can still stop for its own amber or red, does)
          if (sneak && !w.granted && this.signalState(o.node, o.armIn, o.turn) !== "green" && o.from.pl.length - w.s > (w.v * w.v) / (2 * SIM.idm.b) + 1) continue;
          // with a go-ahead: only give it up if we wouldn't be through before it gets there (or, into the same
          // lane, wouldn't get there first: then it falls in behind us)
          if (v.granted && this.clearsBefore(v, c, { sOther: cf.sSelf }, this.reachIn(w, o, cf.sOther), true, m)) continue;
          if (v.granted && cf.merge) continue;
          const d = o.from.pl.length - w.s;
          const tArr = d / Math.max(w.v, 0.5);
          const patience = v.wait > 20 ? 0.45 : v.wait > 8 ? 0.7 : 1;
          // the gap it needs is counted from when we get to the line, not from now
          const tLine = toEnd / Math.max((v.v + Math.min(v.v, c.speed)) / 2, 1);
          if (tArr < tLine + SIM.yieldGap * patience * (1 - v.drv * DRIVERS.accept) && (w.v > 1 || d < 6)) {
            if (!(w.next === null && w.v < 0.5 && d > 3)) { v.block = "yield"; v.blockTo = o.to; return false; }
          }
        }
      }
    }
    return true;
  }

  /** Driveway spots that queues should leave free this step: cars waiting to turn in across a lane, and cars waiting to pull out. */
  private collectKeepClear() {
    this.keepClear.clear();
    const add = (l: Lane, s: number, b = 6.5, a = 7.5) => { const x = { s, b, a }, k = this.keepClear.get(l); if (k) k.push(x); else this.keepClear.set(l, [x]); };
    for (const v of this.vehicles) {
      if (v.edge.kind !== "lane" || v.v > 0.5 || v.destS < 0 || !this.isFinal(v)) continue;
      const lane = v.edge as Lane;
      if (lane.idx !== this.turnIdx(v, lane) || v.s < v.destS - 2) continue;
      if ((lane.dir === 1 ? 1 : -1) * v.destSide > 0 || v.destEnd) continue; // turning in on its own side: crosses nothing
      for (const o of this.lanesAt(dkey(lane.seg, lane.dir === 1 ? -1 : 1), v.dest.p)) add(o.lane, o.s);
    }
    for (const p of this.pending) if (p.wait > 1.5 && p.clear) for (const c of p.clear) add(c.lane, c.s, c.b, c.a);
    // cars pulling out across a far lane are obstacles on it until they're clear of it
    this.crossers.clear();
    for (const v of this.vehicles) {
      if (!v.crossing) continue;
      // (across once its tail is too: a long body pulled out at an angle still lies over the near lane until it
      // has driven on about its length, whatever its front has done)
      // (and never for long once it stands in its lane: a car stuck there must not hold up the very traffic it
      // waits on)
      if (v.edge.kind !== "lane" || (Math.abs(v.lat) < LANE_W * 0.45 && (this.tailIn(v) || v.wait > 8))) { v.crossing = undefined; continue; }
      // it drives on while it crosses, towards the traffic on the far lane (which runs the other way): the stretch
      // it will sweep is kept clear from the start (as far as it checked for room when it set off), not just where
      // its nose has got to, or a queue creeping up meets it head on
      // (once its nose is over its own lane the swept stretch ends where it was then: the body follows that path)
      const fwd = v.s - (v.crossFrom ?? v.s);
      if (v.crossOut === undefined && Math.abs(v.lat) < LANE_W * 0.5) v.crossOut = fwd;
      const moved = Math.max(CROSS_SWEEP, v.crossOut ?? fwd);
      for (const c of v.crossing) { const k = c.s - moved; const a = this.crossers.get(c.lane); if (a) a.push(k); else this.crossers.set(c.lane, [k]); }
    }
    // a car changing lanes stays in the way in the lane it left until it is mostly across
    this.leavers.clear();
    for (const v of this.vehicles) {
      const f = v.lcFrom;
      if (!f) continue;
      // (its tail follows the path its nose took: across only once it has driven on about a car's length)
      if (v.edge.kind !== "lane") { if (v.lat === 0) v.lcFrom = undefined; continue; } // (picked up again on the next road)
      const cur = v.edge as Lane;
      if (cur.seg !== f.seg || cur.dir !== f.dir) {
        // drove on to the next road still part-way across: it is leaving the lane there that it sits in now
        if (v.lat === 0) { v.lcFrom = undefined; continue; }
        const at = cur.offset + (cur.dir === 1 ? 1 : -1) * v.lat;
        let best: Lane | undefined, bd = LANE_W * 0.5;
        for (const l of this.lanesOf(dkey(cur.seg, cur.dir))) if (l !== cur && Math.abs(l.offset - at) < bd) { bd = Math.abs(l.offset - at); best = l; }
        if (!best) { v.lcFrom = undefined; continue; }
        v.lcFrom = best;
        v.lcS = v.s - v.len;
      }
      const f2 = v.lcFrom!;
      if (Math.abs(v.lat) < 0.5 && v.s - (v.lcS ?? 0) > v.len * 0.8) {
        // across once its tail is too (a car that crept over slowly still trails back into the old lane)
        const l = v.edge as Lane, q = polyAt(l.pl, Math.max(0, v.s - v.len * 0.9));
        const rx = v.x - Math.cos(v.ang) * v.len * 0.4, ry = v.y - Math.sin(v.ang) * v.len * 0.4;
        if (Math.hypot(rx - q.x, ry - q.y) < 0.7) { v.lcFrom = undefined; continue; }
      }
      const a = this.leavers.get(f2);
      if (a) a.push(v); else this.leavers.set(f2, [v]);
    }
    this.collectShadows();
  }

  /** How far two connectors leaving the same lane (with the lanes they lead to) stay within a car's width of each other. */
  private overlap(a: Connector, b: Connector): number {
    const pb = [b.pl, b.to.pl];
    const at = (pls: typeof pb, s: number) => (s <= pls[0].length ? polyAt(pls[0], s) : polyAt(pls[1], Math.min(s - pls[0].length, pls[1].length)));
    const lenA = a.pl.length + Math.min(a.to.pl.length, 120);
    let s = 0;
    for (; s < lenA; s += 1) {
      const p = at([a.pl, a.to.pl], s);
      const d = Math.min(polyClosest(pb[0], p).d, polyClosest(pb[1], p).d);
      if (d > 2.4) break;
    }
    return s;
  }

  private collectShadows() {
    this.shadows.clear();
    this.shadowS.clear();
    if (!this.tapers) {
      this.tapers = [];
      for (const ng of this.net.nodeGeom.values()) {
        if (ng.kind === "junction") continue; // a junction's turns fan out within the box, and cars there ask first
        const byFrom = new Map<Lane, Connector[]>();
        for (const c of ng.conns) { const l = byFrom.get(c.from); if (l) l.push(c); else byFrom.set(c.from, [c]); }
        for (const cs of byFrom.values()) for (const a of cs) for (const b of cs) {
          if (a === b || a.to === b.to) continue;
          const ov = this.overlap(a, b);
          if (ov > 3) this.tapers.push({ a, b, ov });
        }
      }
    }
    const add = (e: Edge, u: Vehicle, s: number) => {
      const l = this.shadows.get(e);
      if (l) l.push(u); else this.shadows.set(e, [u]);
      this.shadowS.set(u, s); // (one car shadows one sibling branch at a time in practice)
    };
    for (const { a, b, ov } of this.tapers) {
      // cars on branch a (its connector or the start of the lane it leads to) that are still in the shared stretch
      const put = (u: Vehicle, pos: number) => {
        if (pos - u.len >= ov) return;
        if (pos <= b.pl.length) add(b, u, pos); else add(b.to, u, pos - b.pl.length);
      };
      for (const u of a.occ as Vehicle[]) put(u, u.s);
      for (const u of a.to.occ as Vehicle[]) { if (a.pl.length + u.s - u.len >= ov) break; put(u, a.pl.length + u.s); }
    }
  }

  /** Vehicles on a roundabout (its arcs and junction connectors) as a share of what it can hold. */
  private ringLoad(id: number): number {
    const cached = this.ringLoads.get(id);
    if (cached !== undefined) return cached;
    let n = 0, len = 0;
    const nodes = new Set<number>();
    for (const sg of this.net.segs.values()) {
      if (sg.ring !== id) continue;
      nodes.add(sg.a);
      const g = this.net.segGeom.get(sg.id);
      if (!g) continue;
      for (const l of g.lanes) { for (const u of l.occ as Vehicle[]) n += this.slots(u); len += l.pl.length; }
    }
    for (const nid of nodes) {
      const ng = this.net.nodeGeom.get(nid);
      if (!ng) continue;
      for (const c of ng.conns) {
        const fromRing = this.net.segs.get(c.from.seg)?.ring === id;
        if (fromRing) for (const u of c.occ as Vehicle[]) n += this.slots(u);
        if (fromRing && this.net.segs.get(c.to.seg)?.ring === id) len += c.pl.length;
      }
    }
    const cap = Math.max(1, len / (SIM.carLen + SIM.idm.s0 + 1));
    const load = n / cap;
    this.ringLoads.set(id, load);
    this.ringCaps.set(id, cap);
    return load;
  }

  /** How far along connector `a` it runs too close beside `b` (out of the same lane) for a car to pass a trailer. */
  private forkAt(a: Connector, b: Connector): number {
    const k = a.uid * 100003 + b.uid;
    let f = this.forks.get(k);
    if (f === undefined) {
      f = 0;
      for (let i = 0; i < a.pl.pts.length; i++) {
        if (polyClosest(b.pl, a.pl.pts[i]).d > 3.4) break;
        f = a.pl.cum[i];
      }
      if (this.forks.size > 20000) this.forks.clear();
      this.forks.set(k, f);
    }
    return f;
  }

  /**
   * Car slots already promised to a ring, not counted on it yet: vehicles on its entries' connectors, and those with
   * a go-ahead onto it still on their way up to the line.
   */
  private ringBooked(ring: number, v: Vehicle): number {
    let n = 0;
    for (const sg of this.net.segs.values()) {
      if (sg.ring !== ring) continue;
      for (const l of this.net.segGeom.get(sg.id)?.lanes ?? []) for (const c of l.ins) {
        if (this.net.segs.get(c.from.seg)?.ring === ring) continue;
        for (const h of c.occ as Vehicle[]) if (h !== v) n += this.slots(h);
        for (const h of c.holders as Vehicle[]) if (h !== v && h.edge === c.from) n += this.slots(h);
      }
    }
    return n;
  }

  /** How many car slots a vehicle takes on a ring (a long one counts by its length). */
  private slots(u: Vehicle): number {
    return u.len < LONG ? 1 : (u.len + SIM.idm.s0 + 1) / (SIM.carLen + SIM.idm.s0 + 1);
  }

  /**
   * Free road ahead from the start of ring lane `out`, round the ring (up to `need`): the room a vehicle joining
   * has. `roomV` is set to the speed of whatever ends that room (Infinity: nothing within `need`).
   */
  private ringRoom(out: Lane, ring: number, need: number, v: Vehicle): number {
    let d = 0;
    let e: Edge | null = out;
    this.roomV = Infinity;
    for (let hops = 0; e && hops < 12 && d < need; hops++) {
      const first = (e.occ as Vehicle[]).find((u) => u !== v);
      let stop = Infinity;
      if (first) { stop = first.s - first.len; this.roomV = first.v; }
      const tl = this.tails.get(e);
      if (tl) for (const t of tl) if (t.v !== v && t.rear < stop) { stop = t.rear; this.roomV = t.v.v; }
      if (stop < Infinity) return d + stop;
      d += e.pl.length;
      if (e.kind === "conn") e = (e as Connector).to;
      else {
        const lane = e as Lane;
        e = lane.outs.find((c) => this.net.segs.get(c.to.seg)?.ring === ring) ?? null;
      }
    }
    return d;
  }

  /**
   * Joining a roundabout like a driver: fall in behind a circulating car that gets to the merge
   * first (car-following keeps the spacing), or go ahead of one only with a clear time margin.
   */
  private mergeOk(v: Vehicle, c: Connector, o: Connector): boolean {
    const myRem = (c.from.pl.length - v.s) + c.pl.length;
    const a = SIM.idm.a * (v.af ?? 1);
    const tMe = (-v.v + Math.sqrt(v.v * v.v + 2 * a * myRem)) / a;
    const ring = this.net.segs.get(o.to.seg)?.ring ?? 0;
    const tgt = dkey(o.to.seg, o.to.dir);
    // (one whose way goes on through the merge: its route says so, not only the turn it has picked so far. A car
    // on the arc before it that is about to turn off at this exit is nothing to give way to)
    const via = (w: Vehicle) => { const i = w.route.indexOf(tgt, w.ri + 1); return i > 0 && i <= w.ri + 4; };
    const clash = (h: Vehicle, hRem: number) => {
      if (h === v || hRem < 0 || hRem > 60) return false;
      const tH = hRem / Math.max(h.v, 1);
      if (tH <= tMe - 0.3 && hRem < myRem) return false; // it's through first: follow it in
      if (tH - tMe >= 1.5) return false; // we're in well ahead of it
      return true;
    };
    for (const h of o.occ as Vehicle[]) if (clash(h, o.pl.length - h.s)) return false;
    // the traffic coming round towards the merge: on a small roundabout the arcs and links are only a few metres
    // long, so a car two or three pieces back is a couple of seconds away. Look back along the ring as far as a
    // driver would (the gap that matters, not just the stretch nearest the line)
    let e = o.from as Lane, back = o.pl.length;
    for (let hops = 0; hops < 6 && back < 60; hops++) {
      const L = e.pl.length;
      for (const h of e.occ as Vehicle[]) {
        if (hops === 0 ? (h.next ? h.next !== o : !via(h)) : !via(h)) continue;
        if (clash(h, L - h.s + back)) return false;
      }
      if (!ring) break;
      back += L;
      const up = e.ins.find((x) => this.net.segs.get(x.from.seg)?.ring === ring);
      if (!up) break;
      for (const h of up.occ as Vehicle[]) if (via(h) && clash(h, up.pl.length - h.s + back)) return false;
      back += up.pl.length;
      e = up.from as Lane;
    }
    return true;
  }

  /**
   * Joining a roundabout from one of its roads, as a driver does: give way to the traffic going round and take a
   * real gap in it, with room to drive into past the entry. And never fill it: a ring packed so full that every car
   * waits on the one ahead is a circle nobody can leave, so an entry holds back while the ring (with what is already
   * on its way onto it) is past the density where traffic still flows round it at a steady pace.
   */
  private ringEntry(v: Vehicle, c: Connector, ring: number, sig: ReturnType<Traffic["signalState"]>, toEnd: number): boolean {
    // the entry that has waited longest for room gets the next turn: the others hold back for it (a busy ring
    // would otherwise keep taking the cars from the arms that happen to see gaps first, and starve one arm for good)
    const claim = this.ringClaim.get(ring);
    if (claim && claim !== v && !v.granted) {
      if (!this.ringClaimLive(claim, ring)) this.ringClaim.delete(ring);
      else if (claim.wait > v.wait + 4) { v.block = "box"; return false; }
    }
    const refuse = () => {
      v.block = "box";
      if (toEnd < 3 && v.wait > 6 && (!claim || claim === v || !this.ringClaimLive(claim, ring) || v.wait > claim.wait)) this.ringClaim.set(ring, v);
      return false;
    };
    if (!v.granted) {
      const load = this.ringLoad(ring) + (this.ringBooked(ring, v) + this.slots(v)) / (this.ringCaps.get(ring) ?? 1);
      if (load > RING_FULL) return refuse();
    }
    // room past the entry for the whole vehicle (a moving queue ahead opens up as we get there; a long body needs
    // half its length clear even then)
    const need = v.len + SIM.idm.s0 + (v.granted ? 0 : 1);
    const room = this.ringRoom(c.to, ring, need, v);
    if (room < need && !(this.roomV > 2 && room > (v.len < LONG ? 1 : v.len * 0.5))) return refuse();
    if (!this.conflictsClear(v, c, sig, toEnd)) return false;
    if (claim === v) this.ringClaim.delete(ring);
    return true;
  }

  /** A ring claim stands while its car is still first at its entry's line, waiting to come onto that ring. */
  private ringClaimLive(c: Vehicle, ring: number): boolean {
    if (c.edge.kind !== "lane" || c.granted || !c.next || this.net.segs.get(c.next.to.seg)?.ring !== ring) return false;
    const occ = c.edge.occ as Vehicle[];
    return occ[occ.length - 1] === c && c.edge.pl.length - c.s < 4;
  }

  /** How far from its stop line a car asks the junction: its comfortable stopping distance plus a margin. */
  private askAt(v: Vehicle): number {
    return Math.max(14, (v.v * v.v) / (2 * 2.4) + v.v * 1.2 + 8);
  }

  /**
   * A room claim still stands: its car is still first in its lane, waiting to go into `out`, and only for room
   * there or for cars going into the same lane (so claims at one junction can never wait on each other).
   */
  private claimLive(c: Vehicle, out: Lane): boolean {
    if (c.edge.kind !== "lane" || c.granted || c.next?.to !== out) return false;
    if (c.block !== "box" && c.blockTo !== out) return false;
    const occ = c.edge.occ as Vehicle[];
    return occ[occ.length - 1] === c;
  }

  /** Past the point where it could still stop comfortably for its stop line (or already in the junction). */
  private committed(h: Vehicle, react = 0): boolean {
    const e = h.edge;
    if (e.kind !== "lane") return true;
    return e.pl.length - h.s <= (h.v * h.v) / (2 * 3.5) + 3 + h.v * react; // (a car waiting at the line that got its go is committed)
  }

  /** Seconds until a car reaches its stop line at its current speed. */
  private tArr(h: Vehicle): number {
    const e = h.edge;
    return e.kind === "lane" ? Math.max(0, e.pl.length - h.s) / Math.max(h.v, 1) : 0;
  }

  /**
   * May `v` go ahead of `h`'s reservation? Only if `h` can still stop, and `v` gets there clearly first, or `v` has
   * waited a long time while `h` is still rolling up (a driver letting a waiting car out). Never true both ways round.
   */
  /** A driver with a go-ahead holding back after all to let a long-waiting car out (only while it can still stop). */
  private letsOut(v: Vehicle, h: Vehicle): boolean {
    if (this.committed(h, 1.5)) return false;
    if (v.next && this.courtesy.get(v.next.node)?.v === v) return true;
    return v.wait > 12 && h.wait < 1 && v.v < 1;
  }

  private outranks(v: Vehicle, h: Vehicle): boolean {
    if (this.committed(h, 1.5)) return false; // well short of the point of no return, not just this step
    if (v.next && this.courtesy.get(v.next.node)?.v === v) return true; // it is letting us out
    if (this.tArr(v) + 1 < this.tArr(h)) return true;
    return v.wait > 12 && h.wait < 1 && v.v < 1;
  }

  private holdersInto(out: Lane): Vehicle[] {
    const r: Vehicle[] = [];
    for (const c of out.ins) for (const h of c.holders as Vehicle[]) if (h.edge !== out && !h.boxes?.includes(c)) r.push(h);
    return r;
  }

  /** Give up the junction it holds: at once, or (a long body still trailing through it) once its tail is out. */
  private letGo(v: Vehicle) {
    if (v.holding && v.len >= LONG && v.edge !== v.holding.from && this.bodyOn(v, v.holding, 0.5)) {
      (v.boxes ??= []).push(v.holding);
      v.holding = null;
    }
    if (v.holding) this.release(v);
  }

  /** Let go of the boxes in `boxes` that the body has cleared (all of them: `all`). */
  private boxesOn(v: Vehicle, all = false) {
    v.boxes = v.boxes!.filter((c) => {
      if (!all && this.bodyOn(v, c, 0.5)) return true;
      const i = c.holders.indexOf(v);
      if (i >= 0) c.holders.splice(i, 1);
      return false;
    });
    if (!v.boxes.length) v.boxes = undefined;
  }

  private release(v: Vehicle) {
    if (v.holding) {
      const i = v.holding.holders.indexOf(v);
      if (i >= 0) v.holding.holders.splice(i, 1);
      v.holding = null;
    }
  }

  // ---------------------------------------------------------------- car following

  private accel(v: Vehicle): number {
    const P = SIM.idm;
    const e = v.edge;
    const tf = v.vf ?? (v.truck ? 0.85 : 1); // trucks take everything a bit slower
    let v0 = e.speed * tf;
    // a heavy truck or a road train on a dirt road eases off more (it pulls away slower: af < 1)
    if (e.kind === "lane" && (e as Lane).rough && v.af !== undefined && v.af < 1) v0 *= ROUGH_HEAVY;
    if (v.vmax !== undefined) v0 = Math.min(v0, v.vmax);
    // everything ahead to keep behind, as (gap, its speed): the hardest one to follow decides
    const G = this.conG, L = this.conL;
    G.length = 0; L.length = 0;
    let gap = Infinity, lv = 0; // the nearest so far
    const con = (g: number, speed: number) => {
      G.push(g); L.push(speed);
      if (g < gap) { gap = g; lv = speed; }
    };
    let capA = Infinity; // a plain limit on acceleration from rules that aren't a leader to follow
    // leader on the same edge
    const occ = e.occ as Vehicle[];
    const i = occ.indexOf(v);
    const lead = occ[i + 1];
    // slowing for and turning into the driveway: whatever is ahead in the lane
    const drive = e.kind === "lane" && this.isFinal(v) && v.destS >= 0 && !v.exit;
    if (drive) {
      const lane = e as Lane;
      const dd = v.destS - v.s;
      if (lane.idx === this.turnIdx(v, lane) && dd > -1) {
        v0 = Math.min(v0, Math.sqrt(5 * 5 + 2 * 2 * Math.max(0, dd)));
        // stop with the nose at the driveway (s0 is the standstill gap IDM keeps to an obstacle)
        // once it can't comfortably stop short of the driveway any more, its decision to turn in stands
        if (!(v.turnOk && v.v > 1 && dd < (v.v * v.v) / (2 * 2.5) + 1.5)) v.turnOk = this.canTurnInCheap(v, lane);
        if (!v.turnOk) con(Math.max(0.1, dd - 0.85 + P.s0), 0);
      } else v.turnOk = false;
    }
    // a long vehicle's trailers still on this edge, its front already on the next
    const TL = this.tails.get(e);
    if (TL) for (const t of TL) if (t.v !== v && t.rear > v.s - 0.5) con(Math.max(0.1, t.rear - v.s), t.v.v);
    // ...or one that went the other way where our paths fork, its trailers still where the two run side by side
    const fc = e.kind === "conn" ? (e as Connector) : e.kind === "lane" ? v.next : null;
    if (fc && this.tails.size) {
      const before = e.kind === "conn" ? -v.s : e.pl.length - v.s; // from our front to where the paths fork
      if (before < 40) for (const c2 of fc.from.outs) {
        const tl2 = c2 === fc ? undefined : this.tails.get(c2);
        if (!tl2) continue;
        const fork = this.forkAt(c2, fc);
        for (const t of tl2) if (t.v !== v && t.rear < fork && before + t.rear > -0.5) con(Math.max(0.1, before + t.rear), t.v.v);
      }
    }
    if (lead) {
      con(lead.s - lead.len - v.s, lead.v);
      // drivers watch the brake lights a car further on too, so a queue's slowdown reaches them sooner and
      // doesn't build into a stop-and-go wave down the line
      const lead2 = occ[i + 2];
      if (lead2 && lead2.v < lead.v) con(lead2.s - lead2.len - v.s - lead.len - P.s0, lead2.v);
    } else {
      // look ahead along the planned path, through the junction too (also before the go-ahead: a car turning
      // ahead of us is something to slow for in good time, not something that appears when we're let through)
      let d = e.pl.length - v.s;
      let next: Edge | null = null;
      if (e.kind === "lane") {
        const lane = e as Lane;
        const c = v.next;
        if (!drive) {
          // stop line: only there once the junction has been asked and said no (it is asked while the car can
          // still stop comfortably, so a car with a clear way never brakes for it)
          if ((!c || !v.granted) && (c || d < this.askAt(v) - 0.5)) con(d + 0.5, 0);
          // further back in the queue too: a driver letting a long-waiting car out starts easing off in good time
          else if (!c && this.courtesyAhead(v, lane)) con(d + 0.5, 0);
          if (c) {
            next = c;
            // slow to the junction's speed along a gentle, steady braking curve
            const cs = c.speed * tf;
            v0 = Math.min(v0, Math.sqrt(cs * cs + 2 * SIM.approachDecel * Math.max(0, d)));
          }
        }
      } else {
        next = (e as Connector).to;
      }
      let hops = 0;
      while (next && hops++ < 3 && d < 140) {
        const o = next.occ as Vehicle[];
        const sh = this.shadows.get(next);
        if (sh) for (const u of sh) if (u !== v) con(d + this.shadowS.get(u)! - u.len, u.v);
        const lx = next.kind === "lane" ? this.leavers.get(next as Lane) : undefined;
        if (lx) for (const u of lx) if (u !== v) con(d + this.mapS(u.edge as Lane, next as Lane, u.s) - u.len, u.v);
        const tn = this.tails.get(next);
        if (tn) for (const t of tn) if (t.v !== v) con(d + t.rear, t.v.v);
        // (one that has just turned off at its end, whichever way, still sticks back into it: a short ring arc)
        if (next.kind === "lane" && !o.length) for (const c2 of (next as Lane).outs) {
          const u = (c2.occ as Vehicle[])[0];
          if (u && u !== v && u.s < u.len) con(d + next.pl.length + u.s - u.len, u.v);
        }
        if (o.length) {
          const l = o[0];
          con(d + l.s - l.len, l.v);
          break;
        }
        d += next.pl.length;
        if (next.kind === "conn") next = (next as Connector).to;
        else break;
      }
    }
    // merging: a car already on another connector into the same lane, nearer the merge, is a leader
    const mc = e.kind === "conn" ? (e as Connector) : v.granted ? v.next : null;
    if (mc) {
      const vRem = e.kind === "conn" ? mc.pl.length - v.s : e.pl.length - v.s + mc.pl.length;
      const tV = vRem / Math.max(v.v, 1);
      if (vRem < 60) for (const cf of mc.conflicts) {
        if (!cf.merge) continue;
        const myPos = vRem - (mc.pl.length - (cf.jSelf ?? cf.sSelf)); // still to go to where the paths meet
        const ld = (u: Vehicle, uRem: number) => {
          const uPos = uRem - (cf.c.pl.length - (cf.jOther ?? cf.sOther));
          const tU = uRem / Math.max(u.v, 1);
          // who goes first: once either is where the paths meet, whoever is ahead; before that, whoever gets
          // there first at the speeds they're doing (a fast car further back doesn't brake for a slow one just
          // ahead that hasn't merged yet: that one eases off), unless only the other one can still stop
          let uFirst = uRem < vRem;
          if (myPos > 0 && uPos > 0) {
            const iCan = (v.v * v.v) / 6 + 0.5 < myPos, uCan = (u.v * u.v) / 6 + 0.5 < uPos;
            uFirst = iCan === uCan ? tU < tV || (tU === tV && u.id < v.id) : iCan;
          }
          if (!uFirst) return; // it falls in behind us
          // (side by side short of where the paths meet, it only has to be past that point when we get there)
          if (uRem < vRem) {
            const real = vRem - uRem - u.len;
            if (myPos > 0 && myPos - 0.5 > real) {
              con(myPos - 0.5, u.v);
              // and get there no sooner than its tail is past that point (the point itself doesn't move on)
              const clr = Math.max(0, uPos + u.len + P.s0) / Math.max(u.v, 1);
              if (clr > 0) v0 = Math.min(v0, Math.max(myPos / clr, 0.5));
            } else con(real, u.v);
          } else if (myPos > 0) {
            // further back but there first: time our arrival for just after it has gone by
            const after = tU + (u.len + P.s0 + u.v * 0.6) / Math.max(u.v, 1);
            v0 = Math.min(v0, Math.max(myPos / after, 0.5));
          }
        };
        for (const u of cf.c.occ as Vehicle[]) ld(u, cf.c.pl.length - u.s);
        // a long body that has merged already, its trailers still over the other path past where the two meet
        const tc = this.tails.get(cf.c);
        if (tc) for (const t of tc) {
          if (t.v === v || t.rear >= cf.c.pl.length) continue;
          const at = (cf.jSelf ?? cf.sSelf) + Math.max(0, t.rear - (cf.jOther ?? cf.sOther)); // its rear, on our path
          con(vRem - (mc.pl.length - at), t.v.v);
        }
        // and one with its go-ahead still on its way up to the junction: line up behind it in good time
        for (const u of cf.c.holders as Vehicle[]) if (u !== v && u.edge === cf.c.from && u.v > 2) ld(u, cf.c.from.pl.length - u.s + cf.c.pl.length);
      }
    }
    // a turn pocket coming up with a queue in it: ease off to join its tail rather than swing in fast and brake hard
    if (e.kind === "lane" && v.pocketAhead && v.pocketAhead.seg === (e as Lane).seg) {
      const pk = v.pocketAhead, tail = (pk.occ as Vehicle[])[0];
      if (tail) con(Math.max(0.1, this.mapRaw(pk, e as Lane, tail.s - tail.len) - v.s - 1.5), tail.v);
    }
    // cooperative merging (see laneChange): line up behind a car in the lane we must get into...
    if (e.kind === "lane" && v.wish) {
      const tl = v.wish.lane;
      const ts = this.mapS(e as Lane, tl, v.s);
      // (a car dropping back for us whose nose is still level with our tail: pull further up so it's clear)
      let pullUp = false;
      for (const o of tl.occ as Vehicle[]) {
        // two cars that each need the other's lane: the older one goes first, the other drops back behind it
        const mutual = o.wish?.lane === e && o.id > v.id;
        if (mutual && o.s > ts - v.len - 2.5 && o.s < ts + 1) pullUp = true;
        // already behind us: it makes room (below). Level with our tail at speed it can't any more: drop behind it
        if (mutual || o.s <= ts - v.len - (o.v * o.v > 6 * 6 ? 6 : 0)) continue;
        const g2 = this.mapS(tl, e as Lane, o.s - o.len) - v.s - 1.5;
        if (g2 >= P.s0) con(g2, o.v);
        else {
          // still alongside it: drop back to a little under its speed (comfortable braking) rather than
          // stopping dead beside it, or creeping along level with it
          const tv = Math.max(0, o.v - 2);
          capA = Math.min(capA, v.v > tv ? Math.max(-3.5, (tv - v.v) * 1.5) : 0);
          // it needs our lane too (and goes first): stop a car's length short of where it waits to pull
          // across, or it never finds room beside us
          if (o.wish?.lane === e) {
            const back = e.pl.length - 1.5 - o.len - 1.6 - v.s;
            if (back > -2) con(Math.max(0.1, back + P.s0), 0);
          }
        }
        break;
      }
      // wait short of the end of the lane, where there's still room to pull across (laneChange takes a crawling car up to 1 m from it)
      // (s0 is the standstill gap car-following keeps to an obstacle: without it the car stops 2 m short)
      const hold = e.pl.length - (pullUp ? 1.5 : 7) - v.s;
      if (hold > -2) con(Math.max(0.1, hold + P.s0), 0);
    }
    // ...and hold back for a car beside us that needs to get into our lane ahead of us
    if (e.kind === "lane") {
      const W = this.wishes.get(e as Lane);
      if (W) for (const w of W) {
        if (w === v || !w.wish) continue;
        const wRear = this.mapS(w.edge as Lane, e as Lane, w.s) - w.len;
        const g2 = wRear - v.s - 1.5;
        if (g2 <= 0 || g2 > 60 || (v.v * v.v) / (2 * 3) > g2 + 1) continue; // alongside already, far off, or too late to stop
        con(g2, w.v);
      }
    }
    // brake for a car pulling out across this lane
    if (e.kind === "lane") {
      const X = this.crossers.get(e as Lane);
      if (X) for (const k of X) {
        if (v.s > k - 1.5) continue;
        con(Math.max(0.1, k - 2 - v.s), 0);
      }
    }
    // a car on a sibling branch of a taper, still on top of our path
    const SH = this.shadows.get(e);
    if (SH) for (const u of SH) {
      if (u === v) continue;
      const us = this.shadowS.get(u)!;
      if (us <= v.s) continue;
      con(Math.max(0.1, us - u.len - v.s), u.v);
    }
    // a car changing out of this lane ahead of us is still (partly) in it
    if (e.kind === "lane") {
      const X = this.leavers.get(e as Lane);
      if (X) for (const u of X) {
        if (u === v) continue;
        const rear = this.mapS(u.edge as Lane, e as Lane, u.s) - u.len;
        if (rear + u.len <= v.s) continue; // behind us
        con(Math.max(0.1, rear - v.s), u.v);
      }
      // and while we're still partly in the lane we're leaving, we don't drive into the car ahead in it
      const f = v.lcFrom;
      if (f && f.seg === (e as Lane).seg) {
        const ms = this.mapS(e as Lane, f, v.s);
        for (const o of f.occ as Vehicle[]) if (o !== v && o.s > ms) { con(Math.max(0.1, o.s - o.len - ms), o.v); break; }
      }
    }
    // keep driveways clear: don't come to rest across a spot where someone waits to turn in or pull out
    // Only when what's ahead is (nearly) stopped, i.e. a queue is forming: a moving leader won't leave us there.
    // The spot needs our front 6.5 m short of it (a car pulling out needs that much to fit in ahead of us)
    // and our rear well past it; we come to rest s0 behind whatever we follow.
    if (e.kind === "lane" && gap !== Infinity && lv < 2) {
      // (not one still pulling out itself: held there, it would only block the lane it is across for longer)
      const K = v.crossing ? undefined : this.keepClear.get(e as Lane);
      const mine = v.destS >= 0 && this.isFinal(v) ? v.destS : -1e9;
      if (K) for (const { s: k, b, a: after } of K) {
        const hold = k - b;
        if (v.s + (v.v * v.v) / 8 > hold) continue; // too close to stop short of it now: carry on through
        if (Math.abs(k - mine) < 6) continue; // that's our own driveway: we're turning in there
        const restFront = v.s + gap - P.s0;
        if (restFront > hold && restFront - v.len < k + after) con(hold + P.s0 - v.s, 0);
      }
    }
    // diverging: a car that just left the same lane on a sibling connector is still right ahead
    // until the paths separate
    {
      const src = (e.kind === "conn" ? (e as Connector).from : e) as Lane;
      const myPos = e.kind === "conn" ? v.s : v.s - e.pl.length;
      const mine = e.kind === "conn" ? (e as Connector) : v.next;
      if (myPos > -30 && src.outs) for (const sib of src.outs) {
        if (sib === e) continue;
        // (only while its tail is still where the two paths run side by side: past the fork it is on its own way,
        // and a car leaving a roundabout mustn't wait on one still going round)
        const shared = mine && mine.from === src ? Math.min(7, this.forkAt(sib, mine)) : 7;
        for (const u of sib.occ as Vehicle[]) {
          const rear = u.s - u.len;
          if (rear > shared) continue;
          const g2 = rear - myPos;
          if (g2 > -0.5) con(Math.max(g2, 0.1), u.v);
        }
      }
    }
    v.v0e = v0;
    // free road (IIDM: above the desired speed, ease down to it at no more than comfortable braking)
    const vf = Math.max(v0, 0.1);
    const pa = P.a * (v.af ?? 1) * (1 + v.drv * DRIVERS.launch);
    const aFree = v.v <= vf ? pa * (1 - Math.pow(v.v / vf, 4)) : -P.b * (1 - Math.pow(vf / v.v, (pa * 4) / P.b));
    let a = aFree;
    for (let k = 0; k < G.length; k++) a = Math.min(a, this.follow(v, vf, aFree, G[k], L[k]));
    if (a < -8) a = -8;
    a = Math.min(a, capA);
    v.constrained = a < aFree - 0.25;
    return a;
  }

  /**
   * Following one leader (or stopping for an obstacle, speed 0) the way a driver does: the improved IDM, blended
   * with "constant-acceleration" reasoning (the ACC model of Treiber and Kesting) so that a car that turns up
   * close ahead at about our speed (a merge, a lane change, a turn) is no reason to stamp on the brakes:
   * we ease off and let the gap open, braking hard only if a collision really is coming.
   */
  private follow(v: Vehicle, v0: number, aFree: number, gap: number, lv: number): number {
    const P = SIM.idm;
    const g = Math.max(gap, 0.1);
    const pa = P.a * (v.af ?? 1) * (1 + v.drv * DRIVERS.launch);
    const sStar = P.s0 + Math.max(0, v.v * P.T * (1 - v.drv * DRIVERS.gap) + (v.v * (v.v - lv)) / (2 * Math.sqrt(pa * P.b)));
    const z = sStar / g;
    let aI: number;
    if (v.v <= v0) aI = z >= 1 ? pa * (1 - z * z) : aFree * (1 - Math.pow(z, (2 * pa) / Math.max(aFree, 0.01)));
    else aI = z >= 1 ? aFree + pa * (1 - z * z) : aFree;
    // what it takes to not close in to less than the standstill gap, assuming it holds its speed
    // (a standstill obstacle: to stop that far short of it)
    const ge = Math.max(g - P.s0, 0.1);
    const aC = lv < 0.1 ? -(v.v * v.v) / (2 * ge) : v.v <= lv ? 0 : -((v.v - lv) * (v.v - lv)) / (2 * ge);
    if (aI >= aC) return aI;
    const c = 0.99;
    return (1 - c) * aI + c * (aC + P.b * Math.tanh((aI - aC) / P.b));
  }

  /** A car further back in the lane, not yet at the line, whose way on crosses a car being let out at the junction ahead. */
  private courtesyAhead(v: Vehicle, lane: Lane): boolean {
    if (!this.courtesy.size || !lane.outs.length) return false;
    const cl = this.courtesy.get(lane.outs[0].node);
    if (!cl || cl.v === v || !cl.v.next || this.committed(v)) return false;
    const nk = v.route[v.ri + 1];
    return lane.outs.some((c) => dkey(c.to.seg, c.to.dir) === nk && this.crossesCourtesy(cl.v, c, v));
  }

  /** Whether a car on connector `c` must hold back for courtesy car `w`: their paths cross, or pass too close for
   *  `w`'s long body (a truck going straight on past oncoming traffic it can't squeeze by). */
  private crossesCourtesy(w: Vehicle, c: Connector, v: Vehicle): boolean {
    const mine = w.next!;
    if (mine.conflicts.some((cf) => cf.c === c)) return true;
    return w.len >= LONG && !!mine.near?.some((cf) => cf.c === c && (!cf.wide || v.len >= LONG));
  }

  private canTurnInCheap(v: Vehicle, lane: Lane): boolean {
    const sideOfTravel = (lane.dir === 1 ? 1 : -1) * v.destSide;
    // (across oncoming traffic, it looks once it is about its stopping distance off)
    return sideOfTravel > 0 || v.destEnd || v.s < v.destS - Math.max(25, this.askAt(v)) ? true : this.canTurnIn(v, lane);
  }

  // ---------------------------------------------------------------- lane changes

  private laneChange(v: Vehicle) {
    const lane = v.edge as Lane;
    if (Math.abs(v.lat) > 0.4) return;
    if (v.s < 3 || lane.pl.length - v.s < (v.v < 2 ? 1 : 4)) return;
    const all = this.lanesOf(dkey(lane.seg, lane.dir));
    if (all.length < 2) return;
    const nk = v.route[v.ri + 1];
    const final = this.isFinal(v);
    // look one road further: a short next road (an exit right after a lane gain) leaves no room to change there
    const nn = v.route[v.ri + 2];
    const reach = (l: Lane) => nk !== undefined && l.outs.some((c) => dkey(c.to.seg, c.to.dir) === nk);
    // a long next road normally leaves room to pick the lane there, unless the queue for the lane we'll need
    // already reaches back to its start: then join that queue's tail here, as drivers do
    const serves = (x: Lane) => nn !== undefined && x.outs.some((y) => dkey(y.to.seg, y.to.dir) === nn);
    const queuedBack = (x: Lane) => { const o = x.occ as Vehicle[]; return o.length > 0 && o[0].s < 50 && o[0].v < 5; };
    const needLanes = nk !== undefined && nn !== undefined ? this.lanesOf(nk).filter(serves) : [];
    const needQueued = needLanes.length > 0 && needLanes.every(queuedBack);
    const ahead = (l: Lane) => l.outs.some((c) => dkey(c.to.seg, c.to.dir) === nk && (nn === undefined || serves(c.to) || (c.to.pl.length > 160 && !needQueued)));
    const strict = !final && all.some(ahead);
    // the last road but one, running straight on into the last (a merge, a lane gain, a bend: no junction to pick
    // a lane at), with the destination soon after the start of the last: get into the lane that leads into the
    // destination's lane now. (On a carriageway with the on-ramp's traffic coming into the near lane there can be no
    // gap to get over in the few hundred metres left, and the car missed its turn. At a junction drivers keep to
    // both lanes and get over after it, or the near lane's queue would be twice as long.)
    let prep: ((l: Lane) => boolean) | null = null;
    if (!final && nn === undefined && nk !== undefined && dkSeg(nk) === v.dest.seg && this.net.nodeGeom.get(lane.to)?.kind !== "junction") {
      const nl = this.lanesOf(nk);
      if (nl.length > 1) {
        const need = this.turnIdx(v, nl[0]);
        const into = dkDir(nk) === 1 ? v.dest.s : this.router.segLen(nk) - v.dest.s;
        const leads = (l: Lane) => l.outs.some((c) => dkey(c.to.seg, c.to.dir) === nk && c.to.idx === need);
        if (into < PREP_AHEAD && all.some(leads)) prep = leads;
      }
    }
    const good = (l: Lane) => (final ? l.idx === this.turnIdx(v, l) : (strict ? ahead(l) : reach(l)) && (!prep || prep(l)));
    let target: Lane | null = null;
    let mandatory = false;
    // (only the early pick wants another lane: this one still leads on, so without a gap the car keeps going and
    // tries again on the next road, never stopping for one)
    let early = false;
    v.wish = undefined;
    v.pocketAhead = undefined;
    if (!good(lane)) {
      early = !!prep && (final ? false : strict ? ahead(lane) : reach(lane));
      const goods = all.filter(good);
      if (!goods.length) return;
      goods.sort((a, b) => Math.abs(a.idx - lane.idx) - Math.abs(b.idx - lane.idx));
      const dirIdx = Math.sign(goods[0].idx - lane.idx);
      target = all.find((l) => l.idx === lane.idx + dirIdx) ?? null;
      mandatory = true;
    } else {
      // discretionary: overtake a slow leader if a neighbouring good lane is clearly better (an escorted convoy
      // holds its lane: traffic goes round it, never it round traffic)
      if (v.keepLane) return;
      const occ = lane.occ as Vehicle[];
      const lead = occ[occ.indexOf(v) + 1];
      if (!lead || lead.s - v.s > 45 || lead.v > v.edge.speed * 0.75) return;
      const toEnd = lane.pl.length - v.s;
      if (toEnd < 40 && !final) return;
      let bestGain = 12;
      for (const l of all) {
        if (Math.abs(l.idx - lane.idx) !== 1 || !good(l)) continue;
        const ls = this.mapS(lane, l, v.s);
        const lo = l.occ as Vehicle[];
        let lg = Infinity;
        for (const o of lo) if (o.s > ls) { lg = o.s - o.len - ls; break; }
        const gain = Math.min(lg, 80) - (lead.s - lead.len - v.s);
        if (gain > bestGain) { bestGain = gain; target = l; }
      }
    }
    if (!target) return;
    // a turn pocket opens out of the road just before the junction: over into it only once it's beside us
    // (till then the car just drives on in its lane, and doesn't ask anyone to make room)
    if (target.pocket && this.mapRaw(lane, target, v.s) < 2) { if (mandatory) v.pocketAhead = target; return; }
    const ts = this.mapS(lane, target, v.s);
    // (on the last road the lane is needed by the destination, not the end of the road)
    const toEnd = (final && v.destS >= 0 ? Math.min(v.destS, lane.pl.length) : lane.pl.length) - v.s;
    const urgency = mandatory ? clamp(1 - toEnd / 90, 0, 1) : 0;
    const k = 1 - urgency * 0.6;
    const to = target.occ as Vehicle[];
    let lead: Vehicle | null = null, follow: Vehicle | null = null;
    for (const o of to) {
      if (o.s >= ts) { lead = o; break; }
      follow = o;
    }
    // (in a standing queue a car that has to get over noses in ahead of a waiting one with less room)
    // (one stopped beside us that needs our lane in turn is waiting for us to go: clear of its nose will do)
    const squeeze = mandatory && v.v < 1 && follow && follow.v < 0.5 ? (follow.wish?.lane === lane ? 0.3 : 1.2) : 2.5;
    // (and room ahead to slow to the speed of the lane we're moving into: no diving into a queue at speed)
    // (a long body whose front has gone on ahead still fills the lane back to its rear)
    const TT = this.tails.get(target);
    const besideTail = !!TT && TT.some((t) => t.v !== v && ts > t.rear - 2.5);
    const noGap = besideTail || (lead && lead.s - lead.len - ts < Math.max(2.5, v.v * 0.6 * k, (SIM.idm.s0 + Math.max(0, v.v * v.v - lead.v * lead.v) / (2 * (mandatory ? 3.2 : 2.2))) * k)) || (follow && ts - v.len - follow.s < Math.max(squeeze, follow.v * 0.9 * k + (follow.v - v.v) * 0.8));
    if (noGap) {
      // must get over soon and there's no gap: say so. We line up behind a car there, and the one behind it lets us in.
      if (mandatory && !early && toEnd < Math.max(160, v.v * 7)) v.wish = { lane: target, t: this.time };
      return;
    }
    // commit
    removeOcc(lane, v);
    this.letGo(v);
    v.next = null;
    v.granted = false;
    const off = lane.offset - target.offset;
    v.lat += (lane.dir === 1 ? 1 : -1) * off;
    // (a long body still trailing back over the lane it leaves: that lane stays in its history, up to here)
    if (v.len >= LONG) { this.leftEdge(v, lane, v.s); v.entS = ts; }
    v.edge = target;
    v.s = ts;
    insertOcc(target, v);
    v.lcFrom = lane;
    v.lcS = ts;
    v.lcCool = mandatory ? 1.2 : 5;
    if (final) this.computeDestS(v);
  }

  /**
   * Stopped level at the end of the lane with an older car that needs our lane while we need its: neither can
   * pull across, so we (the younger) give way by driving on in our own lane and re-planning.
   */
  private swapLocked(v: Vehicle, lane: Lane): boolean {
    const tl = v.wish?.lane;
    if (!tl) return false;
    const ts = this.mapS(lane, tl, v.s);
    for (const o of tl.occ as Vehicle[]) {
      if (o.id < v.id && o.wish?.lane === lane && o.v < 0.5 && o.wait > 4 && o.s > ts - v.len - 0.3 && o.s - o.len < ts + 0.3) return true;
    }
    return false;
  }

  private mapS(a: Lane, b: Lane, s: number): number {
    return clamp(this.mapRaw(a, b, s), 0, b.pl.length);
  }

  /** The point beside s on lane a, on lane b (by where both run along their road's centreline; < 0: before b starts). */
  private mapRaw(a: Lane, b: Lane, s: number): number {
    if (a.seg !== b.seg || a.dir !== b.dir) return (s / (a.pl.length || 1)) * b.pl.length;
    const c = a.dir === 1 ? a.c0 + (s / (a.pl.length || 1)) * (a.c1 - a.c0) : a.c1 - (s / (a.pl.length || 1)) * (a.c1 - a.c0);
    const f = a.dir === 1 ? (c - b.c0) / (b.c1 - b.c0 || 1) : (b.c1 - c) / (b.c1 - b.c0 || 1);
    return f * b.pl.length;
  }

  // ---------------------------------------------------------------- rerouting

  /**
   * A car on the last road of its plan that isn't its destination (it was squeezed into the wrong exit):
   * plan again from here; if there's no way back, give up the trip and leave the road.
   * Returns true when it has a road to go on to.
   */
  private findWay(v: Vehicle, lane: Lane): boolean {
    if (v.lost) return false;
    this.reroute(v);
    return !this.isFinal(v) || (!v.lost && lane.seg === v.dest.seg);
  }

  /**
   * Plan again from the end of the current lane. A plan from a lane end always has at least one more road in it,
   * so this never lands back on a final lane it has already overshot. With no way to the destination at all
   * (a dead-end one-way, a road removed behind it) the trip is given up and the car leaves the road at the end of
   * this lane instead of parking there.
   */
  private reroute(v: Vehicle) {
    const e = v.edge;
    if (e.kind !== "lane") return;
    const lane = e as Lane;
    const k = dkey(lane.seg, lane.dir);
    if (v.holding) this.release(v);
    v.next = null;
    v.granted = false;
    v.destS = -1;
    v.ri = 0;
    const r = this.router.routeFromKey(k, v.dest);
    if (r) { v.route = r; return; }
    v.route = [k];
    if (v.lost) return;
    this.ev.fail(v.trip, "missed its turn", this.time);
    v.lost = true;
  }

  /**
   * Drive on past the driveway and come back round to it: the way on from the end of this road that gets back
   * soonest. (Planning afresh from this road would only lead straight back to the driveway it is stopped at: a car
   * that did that stood there for good, its lane and the junction behind it locked, at lights above all, where the
   * queue for the red sits across the driveways.)
   */
  private goRound(v: Vehicle, lane: Lane) {
    const k = dkey(lane.seg, lane.dir);
    let best: number[] | null = null, bl = Infinity;
    for (const c of lane.outs) {
      const r = this.router.routeFromKey(dkey(c.to.seg, c.to.dir), v.dest);
      if (!r) continue;
      let L = 0;
      for (const x of r) L += this.router.segLen(x);
      if (L < bl) { bl = L; best = r; }
    }
    if (!best) { this.reroute(v); return; }
    if (v.holding) this.release(v);
    v.next = null;
    v.granted = false;
    v.destS = -1;
    v.turnOk = false;
    v.ri = 0;
    v.route = [k, ...best];
  }

  /** The lights at a node now (inspector): the phase that is on, its stage (0 green, 1 yellow, 2 all red) and for how long; null unsignalled or not yet run. */
  signalNow(node: number): { i: number; st: 0 | 1 | 2; t: number } | null {
    const c = this.sigCtl.get(node);
    return c ? { i: c.i, st: c.st, t: c.t } : null;
  }

  /** The cars that have stood still at least `min` seconds (ui/stuckAlerts.ts): where each is, and for how long. */
  stuckCars(min: number): { p: V2; t: number }[] {
    const out: { p: V2; t: number }[] = [];
    for (const v of this.vehicles) if (v.stuck >= min && !v.dwell) out.push({ p: { x: v.x, y: v.y }, t: v.stuck });
    return out;
  }

  /** Keep route[0..from] and plan the rest from route[from]. */
  private rerouteFrom(v: Vehicle, from: number) {
    const k = v.route[from];
    const r = this.router.routeFromKey(k, v.dest);
    if (r) v.route = v.route.slice(0, from).concat(r);
  }

  // ---------------------------------------------------------------- network edits

  /** Carry vehicles over to rebuilt lanes/connectors; drop only those whose road is gone. */
  onNetworkChange(cs: ChangeSet) {
    const net = this.net;
    this.roomClaim.clear();
    this.ringClaim.clear();
    this.courtesy.clear();
    this.courtesyRest.clear();
    this.breakHot.clear();
    this.wishes.clear();
    this.tapers = null;
    const lost: Vehicle[] = [];
    // all connector holder lists at rebuilt nodes are fresh: recompute them from vehicle state
    for (const v of this.vehicles) {
      // destination seg removed or split: find it again first, so any new plan below heads for the right road
      // (the old route ends on the removed seg, so it gets re-planned)
      if (!net.segs.has(v.dest.seg)) {
        const nd = this.remapAccess(v.dest);
        if (nd) v.dest = nd;
        else { lost.push(v); continue; }
      }
      const e = v.edge;
      let ok = true;
      if (e.kind === "lane") {
        const l = e as Lane;
        const cur = net.lanes.get(l.key);
        if (cur !== l) {
          const target = cur ?? this.findLaneNear(v, cs);
          if (target) this.moveTo(v, target);
          else ok = false;
        }
      } else {
        const c = e as Connector;
        const ng = net.nodeGeom.get(c.node);
        if (!ng || !ng.conns.includes(c)) {
          const nc = ng?.conns.find((x) => x.from.key === c.from.key && x.to.key === c.to.key);
          if (nc) this.moveTo(v, nc);
          else {
            const tl = net.lanes.get(c.to.key);
            if (tl) this.moveTo(v, tl, 0.5);
            else {
              // the lane it was turning into was replaced (a slip lane redrawn longer): whatever lane is under it now,
              // or back onto the one it was leaving
              const near = this.findLaneNear(v, cs) ?? net.lanes.get(c.from.key);
              if (near) this.moveTo(v, near);
              else ok = false;
            }
          }
        }
      }
      if (!ok) { lost.push(v); continue; }
      // stale plan near rebuilt nodes
      if (v.next) {
        const ng = net.nodeGeom.get(v.next.node);
        if (!ng || !ng.conns.includes(v.next)) {
          v.next = null;
          v.granted = false;
        }
      }
      if (v.holding) {
        const ng = net.nodeGeom.get(v.holding.node);
        if (!ng || !ng.conns.includes(v.holding)) v.holding = null;
      }
      if (v.boxes) {
        v.boxes = v.boxes.filter((c) => net.nodeGeom.get(c.node)?.conns.includes(c));
        for (const c of v.boxes) if (!c.holders.includes(v)) c.holders.push(v);
        if (!v.boxes.length) v.boxes = undefined;
      }
      // route touches removed segs?
      if (v.route.some((k) => cs.removedSegs.has(dkSeg(k)) || !net.segs.has(dkSeg(k)))) {
        if (v.edge.kind === "lane") this.reroute(v);
        else {
          const c = v.edge as Connector;
          v.route = [dkey(c.to.seg, c.to.dir)];
          v.ri = -1;
          v.ri = 0;
          this.rerouteFrom(v, 0);
          v.ri = -1;
          // ri will advance to 0 when entering the to-lane
        }
      } else if (cs.dirtySegs.size) {
        // network changed: the route still exists, but junction layout may differ; recompute dest slot
        if (v.edge.kind === "lane" && this.isFinal(v)) this.computeDestS(v);
      }
    }
    // rebuild holder lists from vehicles that are on or reserved a connector
    for (const v of this.vehicles) {
      if (v.edge.kind === "conn") {
        const c = v.edge as Connector;
        if (!c.holders.includes(v)) c.holders.push(v);
        v.holding = c;
      } else if (v.holding && !v.holding.holders.includes(v)) {
        v.holding.holders.push(v);
      }
    }
    for (const v of lost) {
      this.ev.fail(v.trip, "road removed", this.time);
      this.remove(v);
    }
    // pending spawns whose access seg vanished
    for (const p of this.pending) {
      if (!net.segs.has(p.from.seg)) { const a = this.remapAccess(p.from); if (a) p.from = a; }
      if (!net.segs.has(p.to.seg)) { const a = this.remapAccess(p.to); if (a) p.to = a; }
    }
  }

  /** Find the segment now under a driveway point (after a split or rebuild). */
  remapAccess(a: Access): Access | null {
    let best: Access | null = null, bd = 3;
    for (const id of this.net.segsNear(a.p.x - 8, a.p.y - 8, a.p.x + 8, a.p.y + 8)) {
      const g = this.net.segGeom.get(id)!;
      const r = polyClosest(g.center, a.p);
      const d = Math.max(0, r.d - g.width / 2);
      if (d < bd) {
        bd = d;
        const q = polyAt(g.center, r.s), t = polyDirSmooth(g.center, r.s, 2);
        best = { seg: id, s: r.s, p: a.p, side: dot(sub(a.p, q), right(t)) >= 0 ? 1 : -1, strict: a.strict };
      }
    }
    return best;
  }

  /** Where a car's front bumper is on its edge (v.x, v.y is the middle of its body, which trails behind). */
  private front(v: Vehicle): V2 {
    const e = v.edge;
    return polyAt(e.pl, clamp(v.s, 0, e.pl.length));
  }

  private findLaneNear(v: Vehicle, cs: ChangeSet): Lane | null {
    const p = this.front(v);
    const dirNow = { x: Math.cos(v.ang), y: Math.sin(v.ang) };
    let best: Lane | null = null, bd = 2.6;
    for (const id of cs.dirtySegs) {
      const g = this.net.segGeom.get(id);
      if (!g) continue;
      for (const l of g.lanes) {
        const r = polyClosest(l.pl, p);
        if (r.d < bd) {
          const d = polyDirSmooth(l.pl, r.s);
          if (dot(d, dirNow) > 0.7) { bd = r.d; best = l; }
        }
      }
    }
    return best;
  }

  private moveTo(v: Vehicle, e: Edge, fixedS?: number) {
    const s = fixedS ?? polyClosest(e.pl, this.front(v)).s;
    removeOcc(v.edge, v);
    // (moved by a change of the roads, or across to the next lane: what lay behind it no longer leads here)
    if (e.kind !== "lane" || v.edge.kind !== "lane" || (e as Lane).seg !== (v.edge as Lane).seg) { v.hist = v.histSpan = v.entS = undefined; }
    v.edge = e;
    v.s = s;
    insertOcc(e, v);
    if (e.kind === "lane") {
      const l = e as Lane;
      const k = dkey(l.seg, l.dir);
      const idx = v.route.indexOf(k);
      if (idx >= 0) v.ri = idx;
      else { v.route = [k]; v.ri = 0; this.reroute(v); }
    }
  }

  remove(v: Vehicle) {
    removeOcc(v.edge, v);
    this.release(v);
    if (v.boxes) this.boxesOn(v, true);
    for (const c of this.net.nodeGeom.values()) void c; // no-op: holders cleaned by release
    const i = this.vehicles.indexOf(v);
    if (i >= 0) {
      const last = this.vehicles.pop()!;
      if (last !== v) this.vehicles[i] = last;
    }
  }

  // ---------------------------------------------------------------- save / load

  /**
   * The traffic as saved (A3 of docs/playtest-2026-11-09.md: loading a save emptied the roads, and every load on
   * them with it): every vehicle where it is, with its trip, its way and what it holds at its junction, and every
   * trip still waiting to set off. Lanes are named by their keys and a junction's paths by the lanes they join, which
   * the same roads build again the same. Left out: a driver giving up or one that lost its way (its trip has already
   * failed and been dealt with).
   */
  toJSON(): TrafficSave {
    const ref = (e: Edge): EdgeRef => (e.kind === "lane" ? (e as Lane).key : [(e as Connector).node, (e as Connector).from.key, (e as Connector).to.key]);
    const vehicles: SavedVehicle[] = [];
    for (const v of this.vehicles) {
      if (v.quit !== undefined || v.lost) continue;
      // (the roads it has already driven aren't kept, but for the last two: its tail may still be on them)
      const r0 = Math.max(0, v.ri - 2);
      const d: SavedVehicle = {
        id: v.id, truck: v.truck, len: v.len, look: v.look, color: v.color,
        e: ref(v.edge), s: v.s, v: v.v, lat: v.lat, lcCool: v.lcCool,
        route: r0 ? v.route.slice(r0) : v.route, ri: v.ri - r0, dest: v.dest, destSide: v.destSide, destS: v.destS,
        trip: v.trip, born: v.born, ideal: v.ideal, wait: v.wait, stuck: v.stuck,
      };
      if (v.vf !== undefined) d.vf = v.vf;
      if (v.af !== undefined) d.af = v.af;
      if (v.vmax !== undefined) d.vmax = v.vmax;
      if (v.keepLane) d.keepLane = true;
      if (v.units) d.units = v.units;
      if (v.exit) d.exit = true;
      if (v.latV) d.latV = v.latV;
      if (v.destEnd) d.destEnd = true;
      if (v.odo !== undefined) d.odo = v.odo;
      if (v.progOdo !== undefined) d.progOdo = v.progOdo;
      if (v.progT !== undefined) d.progT = v.progT;
      if (v.dwell !== undefined) d.dwell = v.dwell;
      if (v.next) { d.next = ref(v.next); if (v.granted) d.granted = true; if (v.grantT !== undefined) d.grantT = v.grantT; }
      if (v.overrode) d.overrode = true;
      if (v.forced) d.forced = true;
      if (v.turnOk) d.turnOk = true;
      if (v.holding) d.hold = ref(v.holding);
      if (v.stopAt) d.stopAt = ref(v.stopAt);
      if (v.boxes?.length) d.boxes = v.boxes.map(ref);
      if (v.hist?.length) { d.hist = v.hist.map(ref); d.histSpan = v.histSpan; }
      if (v.entS !== undefined) d.entS = v.entS;
      if (v.lcFrom) { d.lcFrom = v.lcFrom.key; d.lcS = v.lcS; }
      if (v.crossing?.length) { d.crossing = v.crossing.map((c) => ({ lane: c.lane.key, s: c.s })); d.crossFrom = v.crossFrom; d.crossOut = v.crossOut; }
      vehicles.push(d);
    }
    const pending = this.pending.map((p): SavedSpawn => {
      const { why: _w, blocker: _b, clear: _c, plan: _p, ...rest } = p;
      return rest;
    });
    const signals: TrafficSave["signals"] = [];
    for (const [id, c] of this.sigCtl) signals.push([id, c.i, c.st, c.t]);
    const gates: TrafficSave["gates"] = [];
    for (const [b, gt] of this.gates) if (this.vehicles.includes(gt.v)) gates.push([b, gt.v.id, gt.at]);
    return { nextId: this.nextId, grantSeq: this.grantSeq, vehicles, pending, signals, gates };
  }

  /**
   * Put a saved traffic back on the roads (which must be built, and the clock set, first). Every vehicle goes back on
   * its lane or junction path at its place and speed, with its trip and its load, its route, its go-ahead and the
   * junction boxes it held; every waiting trip back in its queue. A vehicle whose lane isn't there (a save whose
   * junction is laid out differently now) goes on the lane it was heading into, or, with no road left under it at
   * all, fails its trip as when a road is taken away under it: no load is dropped silently. Returns how many
   * vehicles are back.
   */
  load(d: TrafficSave | undefined): number {
    if (!d) return 0;
    const net = this.net;
    const edge = (r: EdgeRef | undefined): Edge | null => {
      if (r === undefined) return null;
      if (typeof r === "string") return net.lanes.get(r) ?? null;
      return net.nodeGeom.get(r[0])?.conns.find((c) => c.from.key === r[1] && c.to.key === r[2]) ?? null;
    };
    const conn = (r: EdgeRef | undefined): Connector | null => { const e = edge(r); return e && e.kind === "conn" ? (e as Connector) : null; };
    this.nextId = Math.max(this.nextId, d.nextId);
    this.grantSeq = Math.max(this.grantSeq, d.grantSeq ?? 0);
    const byId = new Map<number, Vehicle>();
    for (const s of d.vehicles) {
      let e = edge(s.e), at = s.s, moved = false;
      if (!e && typeof s.e !== "string") { e = net.lanes.get(s.e[2]) ?? null; at = 0.5; moved = true; }
      if (!e || !net.segs.has(s.dest.seg)) { this.ev.fail(s.trip, "road removed", this.time); continue; }
      const v: Vehicle = {
        id: s.id, truck: s.truck, len: s.len, look: s.look, color: s.color,
        edge: e, s: clamp(at, 0, e.pl.length), v: s.v, acc: 0, route: s.route, ri: s.ri, next: null, granted: false, holding: null,
        lat: s.lat, lcCool: s.lcCool, wait: s.wait, stuck: s.stuck, dest: s.dest, destSide: s.destSide, destS: -1,
        trip: s.trip, x: 0, y: 0, h: 0, ang: 0, px: 0, py: 0, ph: 0, pang: 0, fade: 1, leaving: 0,
        ideal: s.ideal, born: s.born, v0e: 1, constrained: false, drv: driver(s.id),
      };
      if (s.vf !== undefined) v.vf = s.vf;
      if (s.af !== undefined) v.af = s.af;
      if (s.vmax !== undefined) v.vmax = s.vmax;
      if (s.keepLane) v.keepLane = true;
      if (s.units) v.units = s.units;
      if (s.exit) v.exit = true;
      if (s.latV) v.latV = s.latV;
      if (s.odo !== undefined) v.odo = s.odo;
      if (s.progOdo !== undefined) v.progOdo = s.progOdo;
      if (s.progT !== undefined) v.progT = s.progT;
      if (s.dwell !== undefined) v.dwell = s.dwell;
      insertOcc(e, v);
      this.vehicles.push(v);
      byId.set(v.id, v);
      this.nextId = Math.max(this.nextId, v.id + 1);
      if (e.kind === "conn") {
        // in a junction: it holds its path through it, as it did
        const c = e as Connector;
        c.holders.push(v);
        v.holding = c;
      } else {
        const lane = e as Lane, k = dkey(lane.seg, lane.dir);
        if (moved || v.route[v.ri] !== k) {
          // not where its route says (see above): it plans again from here
          const i = v.route.indexOf(k);
          if (i >= 0) v.ri = i; else { v.route = [k]; v.ri = 0; this.reroute(v); }
        } else {
          v.destS = lane.seg === v.dest.seg ? s.destS : -1;
          if (s.destEnd) v.destEnd = true;
          if (s.turnOk) v.turnOk = true;
          const nx = conn(s.next);
          if (nx && nx.from === lane) {
            v.next = nx;
            v.granted = !!s.granted;
            if (s.grantT !== undefined) v.grantT = s.grantT;
            if (s.overrode) v.overrode = true;
            if (s.forced) v.forced = true;
          }
          const st = conn(s.stopAt);
          if (st) v.stopAt = st;
          // the junction it has a go-ahead into, or the one its tail is still coming out of
          const hc = conn(s.hold);
          if (hc) { hc.holders.push(v); v.holding = hc; }
        }
      }
      if (!moved) {
        // a long body's tail: the edges it still trails back over, and the boxes it still holds with it
        const hist = s.hist?.map(edge);
        if (hist && hist.every((x) => x)) { v.hist = hist as Edge[]; v.histSpan = s.histSpan; }
        if (s.entS !== undefined) v.entS = s.entS;
        const boxes = (s.boxes ?? []).map(conn).filter((c): c is Connector => !!c);
        if (boxes.length) { v.boxes = boxes; for (const c of boxes) if (!c.holders.includes(v)) c.holders.push(v); }
        // half way through a lane change, or still pulling out across the far lanes
        const lf = s.lcFrom ? net.lanes.get(s.lcFrom) : undefined;
        if (lf) { v.lcFrom = lf; v.lcS = s.lcS; }
        const cr = (s.crossing ?? []).map((c) => ({ lane: net.lanes.get(c.lane), s: c.s })).filter((c): c is { lane: Lane; s: number } => !!c.lane);
        if (cr.length) { v.crossing = cr; v.crossFrom = s.crossFrom; v.crossOut = s.crossOut; }
      } else v.lat = 0;
      this.layTrail(v);
      this.place(v, false);
      v.px = v.x; v.py = v.y; v.ph = v.h; v.pang = v.ang;
      if (v.uPose) v.puPose!.set(v.uPose);
    }
    for (const p of d.pending) this.pending.push({ ...p });
    for (const [id, i, st, t] of d.signals ?? []) {
      const n = net.nodes.get(id);
      if (n?.signal && i < n.signal.phases.length) this.sigCtl.set(id, { plan: n.signal, i, st, t });
    }
    for (const [b, id, at] of d.gates ?? []) { const v = byId.get(id); if (v) this.gates.set(b, { v, at }); }
    return byId.size;
  }

  /**
   * The path behind a vehicle put back on the road (its body and trailers are drawn along the way its front drove):
   * back along the edge it is on, then the edges before it, from its history or, for a short vehicle, the way its
   * route came. Past what is known, straight on behind.
   */
  private layTrail(v: Vehicle) {
    const T = (v.trail ??= new Float32Array(TR_N * 3));
    v.trH = 0;
    // the stretches behind the front, nearest first: [edge, from s, down to s]
    const legs: [Edge, number, number][] = [[v.edge, clamp(v.s, 0, v.edge.pl.length), Math.min(v.entS ?? 0, v.s)]];
    if (v.hist?.length) {
      for (let k = v.hist.length - 1; k >= 0; k--) { const sp = v.histSpan?.[k] ?? [0, v.hist[k].pl.length]; legs.push([v.hist[k], sp[1], sp[0]]); }
    } else {
      let e: Edge | undefined = v.edge, ri = v.ri, len = v.s;
      for (let n = 0; e && n < 4 && len < TR_N * TR_STEP; n++) {
        let prev: Edge | undefined;
        if (e.kind === "conn") prev = (e as Connector).from;
        else if (ri > 0) { const pk = v.route[--ri]; prev = (e as Lane).ins.find((c) => dkey(c.from.seg, c.from.dir) === pk); }
        if (!prev) break;
        legs.push([prev, prev.pl.length, 0]);
        len += prev.pl.length;
        e = prev;
      }
    }
    let li = 0, [e, s, lo] = legs[0];
    let x = 0, y = 0, h = 0, bx = 0, by = 0, over = 0;
    // still coming out of its driveway: the way it has driven since lies beside the lane as far as it is still off its
    // line, and behind that its tail points back into the lot (as trySpawn starts it)
    const pull = v.lat !== 0 && !v.lcFrom, odo = v.odo ?? 0;
    for (let k = 0; k < TR_N; k++) {
      const i = ((TR_N - k) % TR_N) * 3;
      if (over > 0) { over += TR_STEP; T[i] = x + bx * over; T[i + 1] = y + by * over; T[i + 2] = h; continue; }
      const p = polyAt(e.pl, s), dir = polyDirSmooth(e.pl, s, 1), r = right(dir);
      if (pull) {
        x = p.x + r.x * v.lat; y = p.y + r.y * v.lat;
        if (k * TR_STEP >= odo) {
          const sd = Math.sign(v.lat), b = norm({ x: r.x * sd - dir.x * 0.35, y: r.y * sd - dir.y * 0.35 });
          bx = b.x; by = b.y; over = 1e-9;
        }
      } else {
        // (a body still coming across from the next lane: its front is off the line, its tail less so)
        const off = v.lat * Math.max(0, 1 - (k * TR_STEP) / Math.max(6, v.len));
        x = p.x + r.x * off; y = p.y + r.y * off; bx = -dir.x; by = -dir.y;
      }
      h = this.hOn(e, s);
      T[i] = x; T[i + 1] = y; T[i + 2] = h;
      if (over > 0) continue;
      s -= TR_STEP;
      while (s < lo) {
        const short = lo - s;
        if (++li >= legs.length) { over = 1e-9; break; }
        [e, s, lo] = legs[li];
        s -= short;
      }
    }
  }

  /** How high an edge is at `s` along it. */
  private hOn(e: Edge, s: number): number {
    const n = e.pl.pts.length;
    if (!n) return 0;
    const f = (clamp(s, 0, e.pl.length) / (e.pl.length || 1)) * (n - 1), i0 = Math.floor(f), i1 = Math.min(n - 1, i0 + 1);
    return e.hs[i0] + (e.hs[i1] - e.hs[i0]) * (f - i0);
  }

  // ---------------------------------------------------------------- render placement + stats

  /**
   * Work out where the car is drawn. The front bumper sits on its lane (plus any lane-change offset); the body
   * follows the path the front has actually driven, so it swings smoothly through turns, lane changes and the
   * hand-over from a lane to a junction and back. `back` (snap only): the direction the car's tail points at
   * the start, e.g. into the driveway it is pulling out of.
   */
  place(v: Vehicle, snap: boolean, back?: V2) {
    const e = v.edge;
    const s = clamp(v.s, 0, e.pl.length);
    const p = polyAt(e.pl, s);
    const d = polyDirSmooth(e.pl, s, 1);
    let fx = p.x, fy = p.y;
    if (v.lat !== 0) {
      const r = right(d);
      fx += r.x * v.lat;
      fy += r.y * v.lat;
    }
    const pts = e.pl.pts;
    let fh = 0;
    if (pts.length) {
      const f = (s / (e.pl.length || 1)) * (pts.length - 1);
      const i0 = Math.floor(f), i1 = Math.min(pts.length - 1, i0 + 1);
      fh = e.hs[i0] + (e.hs[i1] - e.hs[i0]) * (f - i0);
    }
    let T = v.trail;
    if (!T) { T = v.trail = new Float32Array(TR_N * 3); snap = true; }
    if (v.slide) {
      // a creep sideways at a crawl: the path driven so far moves over with it, so the body slides, not turns
      if (!snap) {
        const r = right(d), ox = r.x * v.slide, oy = r.y * v.slide;
        for (let k = 0; k < TR_N; k++) { T[k * 3] += ox; T[k * 3 + 1] += oy; }
      }
      v.slide = 0;
    }
    if (snap) {
      // a straight tail behind the front
      const bx = back ? back.x : -d.x, by = back ? back.y : -d.y;
      v.trH = 0;
      for (let k = 0; k < TR_N; k++) {
        const i = ((TR_N - k) % TR_N) * 3;
        T[i] = fx + bx * TR_STEP * k; T[i + 1] = fy + by * TR_STEP * k; T[i + 2] = fh;
      }
    } else {
      // lay down samples along the way from the newest one to the front
      let hi = v.trH! * 3;
      let qx = T[hi], qy = T[hi + 1], qh = T[hi + 2];
      let dd = Math.sqrt((fx - qx) * (fx - qx) + (fy - qy) * (fy - qy));
      while (dd >= TR_STEP) {
        const f = TR_STEP / dd;
        qx += (fx - qx) * f; qy += (fy - qy) * f; qh += (fh - qh) * f;
        v.trH = (v.trH! + 1) % TR_N;
        hi = v.trH * 3;
        T[hi] = qx; T[hi + 1] = qy; T[hi + 2] = qh;
        dd -= TR_STEP;
      }
    }
    // points on the driven path a given distance behind the front bumper (front axle, middle, rear axle: one walk)
    const c = this.tmpA, fa = this.tmpB, ra = this.tmpC;
    const outs = this.tmpOuts, want = this.tmpWant;
    outs[0] = fa; outs[1] = c; outs[2] = ra;
    want[0] = v.len * 0.18; want[1] = v.len * 0.5; want[2] = v.len * 0.82;
    let j = 0;
    let px = fx, py = fy, ph = fh, acc = 0;
    for (let k = 0; k < TR_N && j < 3; k++) {
      const i = ((v.trH! - k + TR_N) % TR_N) * 3;
      const qx = T[i], qy = T[i + 1], qh = T[i + 2];
      const ex = qx - px, ey = qy - py, l = Math.sqrt(ex * ex + ey * ey);
      while (j < 3 && acc + l >= want[j] && l > 1e-6) {
        const f = (want[j] - acc) / l, out = outs[j++];
        out[0] = px + (qx - px) * f; out[1] = py + (qy - py) * f; out[2] = ph + (qh - ph) * f;
      }
      acc += l;
      px = qx; py = qy; ph = qh;
    }
    for (; j < 3; j++) { const out = outs[j]; out[0] = px; out[1] = py; out[2] = ph; }
    const ang = Math.atan2(fa[1] - ra[1], fa[0] - ra[0]);
    v.x = c[0]; v.y = c[1]; v.h = c[2]; v.ang = ang;
    if (v.units) this.placeUnits(v, T, fx, fy, fh);
    if (snap) {
      v.px = v.x; v.py = v.y; v.ph = v.h; v.pang = ang;
      if (v.uPose) v.puPose!.set(v.uPose);
    }
  }

  /**
   * An articulated vehicle's pieces: each one's pivot and rear axle sit on the path the front has driven, so the
   * trailers swing through a turn behind the tractor. Its pose is the middle of the piece, facing pivot-ward.
   */
  private placeUnits(v: Vehicle, T: Float32Array, fx: number, fy: number, fh: number) {
    const U = v.units!;
    if (!v.uPose) { v.uPose = new Float32Array(U.length * 4); v.puPose = new Float32Array(U.length * 4); }
    const want: number[] = [];
    for (const u of U) want.push(u.at + u.pivot, u.at + u.axle);
    // (the distances in order along the path: one walk back finds them all)
    const order = want.map((d, i) => i).sort((a, b) => want[a] - want[b]);
    const pts = new Float32Array(want.length * 3);
    let j = 0, px = fx, py = fy, ph = fh, acc = 0;
    for (let k = 0; k < TR_N && j < order.length; k++) {
      const i = ((v.trH! - k + TR_N) % TR_N) * 3;
      const qx = T[i], qy = T[i + 1], qh = T[i + 2];
      const ex = qx - px, ey = qy - py, l = Math.sqrt(ex * ex + ey * ey);
      while (j < order.length && acc + l >= want[order[j]] && l > 1e-6) {
        const f = (want[order[j]] - acc) / l, o = order[j++] * 3;
        pts[o] = px + ex * f; pts[o + 1] = py + ey * f; pts[o + 2] = ph + (qh - ph) * f;
      }
      acc += l;
      px = qx; py = qy; ph = qh;
    }
    // (past the end of the path driven so far: straight on behind the last point)
    const bx = Math.cos(v.ang), by = Math.sin(v.ang);
    for (; j < order.length; j++) {
      const o = order[j] * 3, extra = want[order[j]] - acc;
      pts[o] = px - bx * extra; pts[o + 1] = py - by * extra; pts[o + 2] = ph;
    }
    for (let n = 0; n < U.length; n++) {
      const u = U[n], p = n * 6, q = p + 3;
      const dx = pts[p] - pts[q], dy = pts[p + 1] - pts[q + 1];
      const a = Math.atan2(dy, dx), cx = Math.cos(a), sy = Math.sin(a);
      // the middle of the piece, from its pivot back along its heading
      const back = u.len / 2 - u.pivot;
      const o = n * 4;
      v.uPose![o] = pts[p] - cx * back; v.uPose![o + 1] = pts[p + 1] - sy * back;
      v.uPose![o + 2] = (pts[p + 2] + pts[q + 2]) / 2; v.uPose![o + 3] = a;
    }
  }
  private tmpA = [0, 0, 0];
  private tmpB = [0, 0, 0];
  private tmpC = [0, 0, 0];
  private tmpOuts: number[][] = [this.tmpB, this.tmpA, this.tmpC];
  private tmpWant = [0, 0, 0];
  private conG: number[] = [];
  private conL: number[] = [];

  private stats() {
    const acc = new Map<number, { eff: number; sp: number; lim: number; n: number; q: number }>();
    for (const v of this.vehicles) {
      if (v.edge.kind !== "lane") {
        const c = v.edge as Connector;
        if (v.v < 0.3) this.jams.set(c.node, (this.jams.get(c.node) ?? 0) + 1);
        continue;
      }
      const l = v.edge as Lane;
      const k = dkey(l.seg, l.dir);
      let a = acc.get(k);
      if (!a) acc.set(k, (a = { eff: 0, sp: 0, lim: 0, n: 0, q: 0 }));
      // share of real time this car is making progress it would make on an empty road: slowing for
      // a turn, a driveway or pulling out is free; queueing, yielding and red lights are not
      a.eff += v.constrained ? Math.min(1, v.v / Math.max(v.v0e, 1)) : 1;
      a.sp += v.v;
      a.lim += l.speed;
      a.n++;
      if (v.v < 0.5 && !(this.isFinal(v))) {
        a.q++;
        if (l.pl.length - v.s < 30) this.jams.set(l.to, (this.jams.get(l.to) ?? 0) + 1);
      }
    }
    // decay
    for (const [k, f] of this.flow) {
      const a = acc.get(k);
      f.ratio += ((a ? a.eff / a.n : 1) - f.ratio) * 0.12;
      f.speed += ((a ? a.sp / a.lim : 1) - f.speed) * 0.12;
      f.queue = a ? a.q : 0;
      f.n = a ? a.n : 0;
      if (!a && f.ratio > 0.99 && f.speed > 0.99 && !this.net.segs.has(dkSeg(k))) this.flow.delete(k);
    }
    for (const [k, a] of acc) {
      if (!this.flow.has(k)) this.flow.set(k, { n: a.n, ratio: a.eff / a.n, speed: Math.min(1, a.sp / a.lim), queue: a.q });
    }
    for (const [n, t] of this.jams) {
      const nt = t * 0.92;
      if (nt < 0.2) this.jams.delete(n);
      else this.jams.set(n, nt);
    }
    // feed measured speeds into the router (only where congested; else limit)
    for (const [k, f] of this.flow) {
      const lim = this.router.limit(k);
      if (f.speed < 0.85) this.router.speeds.set(k, lim * Math.max(0.15, f.speed));
      else this.router.speeds.delete(k);
    }
    // trim trip window
    const cut = this.time - 300;
    while (this.trips.length && this.trips[0].t < cut) this.trips.shift();
  }

  recordTrip(ff: number, actual: number) {
    this.trips.push({ ff, actual, t: this.time });
  }

  /** City-wide traffic flow: sum of free-flow times / sum of actual times over recent trips. */
  flowScore(): number {
    // a small prior of on-time travel keeps the first handful of trips from swinging the score wildly;
    // a busy city logs well over a thousand seconds of trips per window, so it fades out quickly
    let a = 90, b = 90;
    // a few seconds lost to a turn-in or a car pulling out isn't congestion: only delay beyond that counts
    for (const t of this.trips) { a += t.ff; b += t.ff + Math.max(0, t.actual - t.ff - (4 + t.ff * 0.12)); }
    return a / b;
  }
}

export function insertOcc(e: Edge, v: Vehicle) {
  const o = e.occ as Vehicle[];
  let lo = 0, hi = o.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (o[m].s < v.s) lo = m + 1;
    else hi = m;
  }
  o.splice(lo, 0, v);
}

export function removeOcc(e: Edge, v: Vehicle) {
  const o = e.occ as Vehicle[];
  const i = o.indexOf(v);
  if (i >= 0) o.splice(i, 1);
}
