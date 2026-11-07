import { LANE_W, ROAD_TYPES, SIM } from "../config";
import { clamp, dist, dot, norm, polyAt, polyClosest, polyDirSmooth, right, sub, type V2 } from "../core/math";
import type { ChangeSet, Connector, Edge, Lane, RoadNetwork } from "../roads/network";
import { Router, dkey, dkDir, dkSeg, type Access } from "./router";

export type TripKind = "shop" | "leisure" | "work" | "home" | "cargo" | "move" | "empty";

export interface Trip {
  kind: TripKind;
  from: number; // building id
  to: number;
  resident: number; // resident id or -1
  cargo?: string;
  startT: number;
  freeFlow: number;
}

export interface Vehicle {
  id: number;
  truck: boolean;
  len: number;
  color: number;
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
  dest: Access;
  destSide: 1 | -1; // side of the destination relative to the seg's a->b direction
  destS: number; // lane arc-length of the driveway on the final lane (-1 = not computed)
  trip: Trip;
  // render state
  x: number; y: number; h: number; ang: number;
  px: number; py: number; ph: number; pang: number;
  fade: number; // 0..1 spawn fade
  /** Path the front bumper has driven: TR_N [x, y, h] samples TR_STEP apart in a ring (newest at trH). The body is
   *  drawn along it, so the back follows the front through turns and lane changes instead of snapping per edge. */
  trail?: Float32Array;
  trH?: number;
  leaving: number; // >0 while turning into a driveway
  /** Time the trip would have taken without other traffic: real time while unimpeded, distance at free speed while held up. */
  ideal: number;
  born: number; // sim time it entered the road
  block?: string; // why the junction last refused entry (debug + inspector)
  blockTo?: Lane; // the lane the car it last gave way to was heading into
  grantT?: number; // order in which it got its current go-ahead at the junction ahead (a sequence, never tied)
  overrode?: boolean; // that go-ahead was a driver with an earlier one letting it out (see letsOut)
  turnOk?: boolean; // its driveway was clear to turn into on the way up to it (it carries on rather than stop dead)
  latV?: number; // sideways speed while changing lanes / pulling out (m/s, signed like lat)
  wish?: { lane: Lane; t: number }; // a lane it must change into but found no gap in (last tried at t)
  crossing?: { lane: Lane; s: number }[]; // far lanes this car is still pulling out across (spot where it started)
  crossFrom?: number; // its own lane position when it started pulling out
  v0e: number; // free-road desired speed this step (limits, curves, driveway approach)
  constrained: boolean; // held up by another vehicle, a stop line or a signal this step
  /** Leaves the map at its destination (outside connection): drives through at speed instead of turning in. */
  exit?: boolean;
  /** Missed its way and can't get back (its trip already counted as failed): drives out of the region, or just leaves. */
  lost?: boolean;
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
  clear?: { lane: Lane; s: number }[]; // spots a queue should leave free so this car can pull out
  /** Enters from an outside connection: appears in lane at speed, no driveway. */
  through?: boolean;
  /** Leaves through an outside connection at `to`. */
  exit?: boolean;
}

const TR_N = 40, TR_STEP = 0.35; // drawn-path samples per car (14 m: enough for the longest truck)
const CAR_COLORS = [0xe8534a, 0x3c8de0, 0xf2b632, 0x55b85b, 0x9b6ce0, 0xef7fb6, 0x40c2c9, 0xf08a3a, 0x4a5568, 0xf5f5f0];

export interface TrafficEvents {
  arrive(v: Vehicle, now: number): void;
  fail(trip: Trip, reason: string, now: number): void;
  /** Where cars leave the region (a car that lost its way heads for one). */
  exits?(): Access[];
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
  private keepClear = new Map<Lane, number[]>(); // lane -> driveway spots queues leave free (this step)
  // lane -> cars beside it that need to get into it soon: the car behind each one holds back to make room
  private wishes = new Map<Lane, Vehicle[]>();
  private crossers = new Map<Lane, number[]>(); // lane -> spots where a car is pulling out across it (this step)
  // An unsignalled junction where a car has waited long for a gap that never comes: traffic that can still stop
  // lets it out (one car at a time, for a few seconds, then the main road gets a turn again).
  private courtesy = new Map<number, { v: Vehicle; until: number }>();
  private courtesyRest = new Map<number, number>(); // node -> time before another car may claim it
  // A backed-up exit lane: the car that has waited longest at its stop line for room on it gets the next gap,
  // instead of whoever happens to roll up at speed when the queue moves.
  private roomClaim = new Map<Lane, Vehicle>();

  private ringLoads = new Map<number, number>(); // ring id -> share of its capacity in use (this step)
  flow = new Map<number, FlowStat>(); // by directed seg key
  trips: { ff: number; actual: number; t: number }[] = [];
  jams = new Map<number, number>(); // node id -> seconds of blockage recently

  constructor(public net: RoadNetwork, private ev: TrafficEvents) {
    this.router = new Router(net);
  }

  // ---------------------------------------------------------------- spawning

  request(p: PendingSpawn) {
    this.pending.push(p);
  }

  private trySpawn(p: PendingSpawn): "ok" | "wait" | "fail" {
    const net = this.net;
    if (!net.segs.has(p.from.seg) || !net.segs.has(p.to.seg)) return "fail";
    // pick a start direction: prefer the kerb side (no crossing), but take the faster route if much better.
    // A median can't be crossed: there you can only pull out to the right (and arrive from the right).
    const divided = (seg: number) => (ROAD_TYPES[net.segs.get(seg)!.type].median ?? 0) > 0;
    const to: Access = { ...p.to, side: p.toSide };
    let best: { keys: number[]; time: number; freeFlow: number; dir: 1 | -1 } | null = null;
    for (const d of [1, -1] as const) {
      const crossing = (d === 1 ? 1 : -1) !== p.fromSide;
      if (crossing && divided(p.from.seg) && !p.through) continue;
      const r = this.router.route(p.from, to, d);
      if (!r) continue;
      const t = r.time + (crossing ? 6 : 0);
      if (!best || t < best.time) best = { ...r, time: t, dir: d };
    }
    if (!best) return "fail";
    const k = best.keys[0];
    const lanes = this.lanesOf(k);
    const crossing = (best.dir === 1 ? 1 : -1) !== p.fromSide;
    // joining from the far side you turn into the lane nearest the middle, as real drivers do
    const want = crossing ? Math.max(...lanes.map((l) => l.idx)) : 0;
    const lane = lanes.find((l) => l.idx === want) ?? lanes[0];
    if (!lane) return "fail";
    const lc = polyClosest(lane.pl, p.from.p);
    const ls = lc.s;
    const len = p.truck ? SIM.truckLen : SIM.carLen;
    // gap check on the target lane (and traffic arriving soon)
    // gap acceptance like a real driver: ~4 s to oncoming traffic, shrinking as they get impatient,
    // so through traffic rarely has to brake for someone pulling out
    const headway = p.wait > 12 ? 2 : p.wait > 5 ? 2.5 : 3.2;
    p.clear = [{ lane, s: ls }];
    for (const o of lane.occ as Vehicle[]) {
      if (o.s > ls - 2 && o.s - o.len < ls + len + 3) { p.why = "occupied"; return "wait"; }
      // slow or queued traffic lets you in when it can stop comfortably behind you
      const courtesy = o.v < 4 && ls - len - o.s > 1.5 + (o.v * o.v) / (2 * SIM.idm.b) + o.v * 0.8;
      if (o.s <= ls && ls - o.s < Math.max(10, o.v * headway) && !courtesy) { p.why = "oncoming"; p.blocker = o.id; return "wait"; }
    }
    // incoming vehicles from the connector feeding this lane near the start
    if (ls < 12) for (const c of lane.ins) if ((c.occ as Vehicle[]).length) { p.why = "junction"; return "wait"; }
    if (crossing) {
      // must cross the near lanes: wait for a gap there too
      const near = this.lanesOf(dkey(p.from.seg, best.dir === 1 ? -1 : 1));
      for (const nl of near) {
        const ns = polyClosest(nl.pl, p.from.p).s;
        p.clear.push({ lane: nl, s: ns });
        for (const o of nl.occ as Vehicle[]) {
          // we drive on (towards falling s on this far lane) while we cross it: keep that stretch clear too
          if (o.s > ns - (o.v < 1 ? 12 : 3) && o.s - o.len < ns + 3) { p.why = "cross-occupied"; return "wait"; }
          // someone on the far lane about to stop at their own driveway right where we'd cut across
          if (o.destS >= 0 && o.s < o.destS + 1 && o.destS > ns - 12 && o.destS < ns + 4 && this.isFinal(o)) { p.why = "cross-occupied"; return "wait"; }
          // the far lane needs a real gap (crossing it takes a couple of seconds); slow traffic can stop for us
          const need = p.wait > 20 ? 1.6 : p.wait > 8 ? 2.2 : 3;
          const yields = o.v < 4 && ns - 3 - o.s > 1.5 + (o.v * o.v) / (2 * SIM.idm.b) + o.v * 0.8;
          if (o.s < ns && (ns - o.s) / Math.max(o.v, 0.5) < need && !yields) { p.why = "cross-oncoming"; return "wait"; }
        }
      }
    }
    const v: Vehicle = {
      id: this.nextId++, truck: p.truck, len, color: p.truck ? 0xf5f5f0 : CAR_COLORS[(Math.random() * CAR_COLORS.length) | 0],
      edge: lane, s: ls, v: 5, acc: 0, route: best.keys, ri: 0, next: null, granted: false, holding: null,
      lat: 0, lcCool: 2, wait: 0, stuck: 0, dest: to, destSide: p.toSide, destS: -1,
      trip: { ...p.trip, freeFlow: best.freeFlow },
      x: 0, y: 0, h: 0, ang: 0, px: 0, py: 0, ph: 0, pang: 0, fade: 0, leaving: 0,
      ideal: 0, born: this.time, v0e: 1, constrained: false,
    };
    if (p.exit) v.exit = true;
    if (p.through) {
      v.v = ROAD_TYPES[net.segs.get(lane.seg)!.type].speed * 0.85;
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
    v.lat = side * Math.max(LANE_W * 0.9, lc.d - 1.2);
    if (crossing) { v.crossing = this.lanesOf(dkey(p.from.seg, best.dir === 1 ? -1 : 1)).map((nl) => ({ lane: nl, s: polyClosest(nl.pl, p.from.p).s })); v.crossFrom = ls; }
    insertOcc(lane, v);
    this.vehicles.push(v);
    if (this.isFinal(v)) this.computeDestS(v);
    // nose out first: the tail is still in the driveway, angled back a little
    const ld = polyDirSmooth(lane.pl, clamp(ls, 0, lane.pl.length), 1), lr = right(ld);
    this.place(v, true, norm({ x: lr.x * side - ld.x * 0.35, y: lr.y * side - ld.y * 0.35 }));
    return "ok";
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
    // spawns
    if (this.pending.length) {
      const keep: PendingSpawn[] = [];
      for (const p of this.pending) {
        const r = this.trySpawn(p);
        if (r === "wait") { p.wait += dt; p.tries++; if (p.wait < 90) keep.push(p); else this.ev.fail(p.trip, "blocked driveway", this.time); }
        else if (r === "fail") this.ev.fail(p.trip, "no route", this.time);
      }
      this.pending = keep;
    }

    const vs = this.vehicles;
    this.collectKeepClear();
    for (const [node, cl] of this.courtesy) {
      const cv = cl.v;
      const live = cv.edge.kind === "lane" && !cv.granted && cv.next?.node === node && (cv.edge.occ as Vehicle[]).includes(cv);
      if (!live || this.time > cl.until || cv.block === "box") {
        this.courtesy.delete(node);
        this.courtesyRest.set(node, this.time + 8);
      }
    }
    if (this.courtesyRest.size > 64) for (const [n, t] of this.courtesyRest) if (t < this.time) this.courtesyRest.delete(n);

    // junction permissions (only the front vehicle of each lane asks)
    for (const v of vs) this.planJunction(v);
    // accelerations
    for (const v of vs) v.acc = this.accel(v);
    // integrate + edge transitions
    const done: Vehicle[] = [];
    for (const v of vs) {
      v.px = v.x; v.py = v.y; v.ph = v.h; v.pang = v.ang;
      v.v = Math.max(0, v.v + v.acc * dt);
      v.s += v.v * dt;
      v.ideal += v.constrained ? (v.v * dt) / Math.max(v.v0e, 1) : dt;
      if (v.v < 0.3) { v.wait += dt; v.stuck += dt; } else { v.wait = 0; v.stuck = Math.max(0, v.stuck - dt * 2); }
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
        if (Math.abs(v.lat) < 0.02 || Math.sign(nl) !== Math.sign(v.lat)) { v.lat = 0; v.latV = 0; }
        else { v.lat = nl; v.latV = lv; }
      }
      v.lcCool -= dt;
      const r = this.advance(v);
      // the junction reservation ends once the whole car is out on the exit lane
      const hc = v.holding;
      if (hc && v.edge !== hc.from && v.edge !== hc && !(v.edge === hc.to && v.s - v.len <= 0.5)) this.release(v);
      if (r) done.push(v);
      else if (v.stuck > 150) {
        // last resort so a broken layout can never freeze the city: the driver gives up
        this.ev.fail(v.trip, "gave up in traffic", this.time);
        done.push(v);
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
              this.ev.arrive(v, this.time);
              return true;
            }
          } else if (lane.idx === this.turnIdx(v, lane) && v.s >= v.destS - 0.8) {
            if ((v.turnOk && v.v > 1) || this.canTurnIn(v, lane)) {
              // pulling out of a driveway takes a moment even on a quiet street: the first seconds aren't delay
              v.trip.freeFlow = v.ideal + Math.min(6, v.born - v.trip.startT);
              this.ev.arrive(v, this.time);
              return true;
            }
            v.v = 0; // stopped at the driveway (never pulled back: that shows as a jump)
            // a stopped queue sits across the driveway: rather than wait it out (and maybe lock the
            // junction behind us), drive on and come back round to turn in from the near side
            if (v.wait > 8 && this.turnBlockedByQueue) this.reroute(v);
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
        v.edge = c;
        v.s = over;
        insertOcc(c, v);
        v.next = null;
        v.granted = false;
      } else {
        const c = e as Connector;
        if (v.s <= c.pl.length) return false;
        const over = v.s - c.pl.length;
        removeOcc(c, v);
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

  /** The lane a car on its last road turns into its destination from: kerb lane, or the inner lane for the far side. */
  private turnIdx(v: Vehicle, lane: Lane): number {
    return (lane.dir === 1 ? 1 : -1) * v.destSide > 0 ? 0 : lane.count - 1;
  }

  private computeDestS(v: Vehicle) {
    const lane = v.edge as Lane;
    if (lane.kind !== "lane" || lane.seg !== v.dest.seg) { v.destS = -1; return; }
    // all lanes of this direction share roughly the same arc-length
    v.destS = polyClosest(lane.pl, v.dest.p).s;
    if (v.destS < v.s - 1) {
      // already past it on this lane: loop
      v.destS = -1;
      this.reroute(v);
    }
  }

  private canTurnIn(v: Vehicle, lane: Lane): boolean {
    const sideOfTravel = (lane.dir === 1 ? 1 : -1) * v.destSide; // +1 = on our right
    if (sideOfTravel > 0) return true;
    // crossing the opposite carriageway: wait for a gap, with growing impatience
    const opp = this.lanesOf(dkey(lane.seg, lane.dir === 1 ? -1 : 1));
    const need = v.wait > 12 ? 0.8 : v.wait > 5 ? 1.6 : 2.6;
    this.turnBlockedByQueue = false;
    // judged for when we get there (asked from a way off, a car that will be long gone by then is no reason to stop)
    // (a cautious guess both ways: we may get there as soon as at our present speed, or as late as slowing to 5 m/s)
    const dd = v.destS >= 0 ? Math.max(0, v.destS - v.s) : 0;
    const tMe = dd / Math.max((v.v + 5) / 2, 1), tSoon = dd / Math.max(v.v, 5);
    for (const ol of opp) {
      const os = polyClosest(ol.pl, v.dest.p).s;
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
      if (!v.next) {
        // wrong lane at the end: after a short wait, take any exit and re-plan
        if (((toEnd < 2 && v.wait > 3.5) || (v.wish && toEnd < 9 && v.wait > 20)) && lane.outs.length) {
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
      if (this.committed(v, 0.5) || this.canEnter(v, v.next, toEnd)) return;
      v.granted = false;
      this.release(v);
      return;
    }
    const ok = this.canEnter(v, v.next, toEnd);
    const node = v.next.node;
    if (!ok && v.wait > 18 && toEnd < 3 && (v.block === "yield" || v.block === "reserved" || v.block === "crossing") && !this.courtesy.has(node) && this.time > (this.courtesyRest.get(node) ?? 0) && this.signalState(node, v.next.armIn) === "none") {
      this.courtesy.set(node, { v, until: this.time + 10 });
    }
    if (ok) {
      if (this.courtesy.get(node)?.v === v) { this.courtesy.delete(node); this.courtesyRest.set(node, this.time + 6); }
      if (this.roomClaim.get(v.next.to) === v) this.roomClaim.delete(v.next.to);
      v.granted = true;
      v.grantT = ++this.grantSeq;
      if (v.holding) this.release(v);
      v.next.holders.push(v);
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

  signalState(nodeId: number, armSeg: number): "green" | "yellow" | "red" | "none" {
    const n = this.net.nodes.get(nodeId);
    if (!n || !n.signal || !n.signal.phases.length) return "none";
    const Y = 3, AR = 1.5;
    const ph = n.signal.phases;
    let cycle = 0;
    for (const p of ph) cycle += p.dur + Y + AR;
    let t = (this.time + nodeId * 3.7) % cycle;
    for (const p of ph) {
      const span = p.dur + Y + AR;
      if (t < span) {
        if (!p.arms.includes(armSeg)) return "red";
        if (t < p.dur) return "green";
        if (t < p.dur + Y) return "yellow";
        return "red";
      }
      t -= span;
    }
    return "red";
  }

  private canEnter(v: Vehicle, c: Connector, toEnd: number): boolean {
    v.blockTo = undefined;
    const ng = this.net.nodeGeom.get(c.node);
    if (!ng) return false;
    if (ng.kind === "cont" || ng.kind === "bend") return true;
    if (ng.kind === "split" || ng.kind === "lane") {
      // the main line never stops for a slip road: a merging car finds a gap and falls in (car-following does the rest)
      if (c.turn === "S") return true;
      for (const cf of c.conflicts) if (cf.merge && !this.mergeOk(v, c, cf.c)) { v.block = "yield"; return false; }
      return true;
    }
    // two roads meeting (one road changing type, or what's left of a removed crossing): nothing crosses here, so
    // there is no box to keep clear. Cars just follow on; where lanes narrow they zip in turn.
    if (ng.arms.length === 2 && c.conflicts.every((cf) => cf.merge) && !this.net.nodes.get(c.node)?.signal && !this.net.segs.get(c.to.seg)?.ring && !this.net.segs.get((c.from as Lane).seg)?.ring) {
      for (const cf of c.conflicts) if (cf.merge && !this.mergeOk(v, c, cf.c)) { v.block = "yield"; return false; }
      return true;
    }
    // signals
    const sig = this.signalState(c.node, c.armIn);
    if (sig === "red") { v.block = "red"; return false; }
    // letting a long-waiting car out: hold back if our path crosses its and we can still stop
    const cl = this.courtesy.get(c.node);
    if (cl && cl.v !== v && cl.v.next && !this.committed(v) && cl.v.next.conflicts.some((cf) => cf.c === c)) { v.block = "courtesy"; return false; }
    if (sig === "yellow" && toEnd > (v.v * v.v) / (2 * SIM.idm.b) + 1) { v.block = "red"; return false; }
    // don't block the box: room on the exit lane. Not between arcs of the same roundabout:
    // circulating cars just follow each other (requiring a free arc ahead gridlocks a full ring)
    const out = c.to;
    const ringIn = this.net.segs.get((c.from as Lane).seg)?.ring ?? 0;
    if (ringIn && this.net.segs.get(out.seg)?.ring === ringIn) return this.conflictsClear(v, c, sig, toEnd);
    let free = out.pl.length;
    const first = (out.occ as Vehicle[])[0];
    if (first) {
      free = first.s - first.len;
      // still some way off: what matters is the room there will be when we get there. A crawling queue
      // keeps creeping on, so a car isn't stopped (and then waved on again) every time it bunches up.
      // (at most about a car's length: a queue that stalls after all mustn't leave us standing in the junction)
      if (first.v > 0.5 && toEnd > 3) free += Math.min(v.len + 2, first.v * 0.7 * ((toEnd + c.pl.length) / Math.max(v.v, 2)));
    }
    // joining a roundabout with room on the ring: moving circulating traffic is something to fall in
    // behind, not a full box. A crowded ring gets the strict rule so entries can't fill it into gridlock.
    const ringId = this.net.segs.get(out.seg)?.ring ?? 0;
    const ringOut = !!ringId && this.ringLoad(ringId) < 0.5;
    const myRem = (c.from.pl.length - v.s) + c.pl.length;
    for (const h of this.holdersInto(out)) {
      if (h === v) continue;
      if (ringOut && (this.remTo(h, out) > myRem || h.v > 1)) continue;
      if (this.outranks(v, h)) continue; // still far off and able to stop: it re-checks and waits for us
      free -= h.len + 2;
    }
    if (ringOut && first && first.v > 1) free = Infinity;
    const moving = first && first.v > 3;
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
    const pos = e === o ? h.s : e === o.to ? o.pl.length + h.s : e === o.from ? h.s - o.from.pl.length : NaN;
    if (Number.isNaN(pos)) return false;
    const need = cf.sOther + 1.2 + h.len - pos;
    if (need <= 0) return true;
    let time: number;
    if (go || h.granted || e !== o.from) {
      const vm = Math.max(o.speed, 2);
      if (h.v >= vm) time = need / ((h.v + vm) / 2);
      else {
        const A = 1.5, t1 = (vm - h.v) / A, d1 = ((h.v + vm) / 2) * t1;
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
    v.overrode = false;
    for (const cf of c.conflicts) {
      const o = cf.c;
      if (ringMerge && cf.merge) {
        if (!this.mergeOk(v, c, o)) { v.block = "yield"; return false; }
        continue;
      }
      const tMe = this.reachIn(v, c, cf.sSelf);
      // re-checking a go-ahead already given: estimates drift a little as cars slow for turns, and that alone
      // mustn't take it back (only a real hold-up does)
      const m = v.granted ? -0.3 : 0.8;
      for (const h of o.holders as Vehicle[]) {
        if (h === v) continue;
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
        if (h.edge === o || h.edge === o.to) {
          // on the connector, or already out on its exit lane with the tail still in the box
          const rear = (h.edge === o ? h.s : o.pl.length + h.s) - h.len;
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
      if (this.courtesy.get(c.node)?.v === v) continue;
      const exempt = cf.merge && o.to === c.to && this.roomClaim.get(c.to) === v;
      const yieldTo = o.prio > c.prio || (sig !== "none" && c.turn === "L" && o.turn !== "L" && !cf.merge) || (cf.merge && o.prio === c.prio && o.turn === "S" && c.turn !== "S");
      if (yieldTo) {
        if (sig !== "none" && this.signalState(o.node, o.armIn) === "red") continue;
        const ap = o.from.occ as Vehicle[];
        const w = ap[ap.length - 1];
        if (w && w !== v && (w.next === o || (w.next === null && !this.isFinal(w)))) {
          if (exempt && !this.committed(w)) continue; // it can still stop for us
          if (this.clearsBefore(w, o, cf, tMe, false, m)) continue; // it goes through before we get there
          // with a go-ahead: only give it up if we wouldn't be through before it gets there (or, into the same
          // lane, wouldn't get there first: then it falls in behind us)
          if (v.granted && this.clearsBefore(v, c, { sOther: cf.sSelf }, this.reachIn(w, o, cf.sOther), true, m)) continue;
          if (v.granted && cf.merge) continue;
          const d = o.from.pl.length - w.s;
          const tArr = d / Math.max(w.v, 0.5);
          const patience = v.wait > 20 ? 0.45 : v.wait > 8 ? 0.7 : 1;
          // the gap it needs is counted from when we get to the line, not from now
          const tLine = toEnd / Math.max((v.v + Math.min(v.v, c.speed)) / 2, 1);
          if (tArr < tLine + SIM.yieldGap * patience && (w.v > 1 || d < 6)) {
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
    const add = (l: Lane, s: number) => { const a = this.keepClear.get(l); if (a) a.push(s); else this.keepClear.set(l, [s]); };
    for (const v of this.vehicles) {
      if (v.edge.kind !== "lane" || v.v > 0.5 || v.destS < 0 || !this.isFinal(v)) continue;
      const lane = v.edge as Lane;
      if (lane.idx !== this.turnIdx(v, lane) || v.s < v.destS - 2) continue;
      if ((lane.dir === 1 ? 1 : -1) * v.destSide > 0) continue; // turning in on its own side: crosses nothing
      for (const ol of this.lanesOf(dkey(lane.seg, lane.dir === 1 ? -1 : 1))) add(ol, polyClosest(ol.pl, v.dest.p).s);
    }
    for (const p of this.pending) if (p.wait > 1.5 && p.clear) for (const c of p.clear) add(c.lane, c.s);
    // cars pulling out across a far lane are obstacles on it until they're clear of it
    this.crossers.clear();
    for (const v of this.vehicles) {
      if (!v.crossing) continue;
      if (Math.abs(v.lat) < LANE_W * 0.45) { v.crossing = undefined; continue; }
      // it drives on while it crosses, towards the traffic on the far lane (which runs the other way)
      const moved = v.edge.kind === "lane" ? Math.max(0, v.s - (v.crossFrom ?? v.s)) : 0;
      for (const c of v.crossing) { const k = c.s - moved; const a = this.crossers.get(c.lane); if (a) a.push(k); else this.crossers.set(c.lane, [k]); }
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
      for (const l of g.lanes) { n += l.occ.length; len += l.pl.length; }
    }
    for (const nid of nodes) {
      const ng = this.net.nodeGeom.get(nid);
      if (!ng) continue;
      for (const c of ng.conns) {
        const fromRing = this.net.segs.get(c.from.seg)?.ring === id;
        if (fromRing) n += c.occ.length;
        if (fromRing && this.net.segs.get(c.to.seg)?.ring === id) len += c.pl.length;
      }
    }
    const load = n / Math.max(1, len / (SIM.carLen + SIM.idm.s0 + 1));
    this.ringLoads.set(id, load);
    return load;
  }

  /** Distance a vehicle still has to go to reach the start of lane `out` along its granted path (Infinity if not headed there). */
  private remTo(h: Vehicle, out: Lane): number {
    const c = h.edge.kind === "conn" ? (h.edge as Connector) : h.next;
    if (!c || c.to !== out) return Infinity;
    return h.edge.kind === "conn" ? c.pl.length - h.s : h.edge.pl.length - h.s + c.pl.length;
  }

  /**
   * Joining a roundabout like a driver: fall in behind a circulating car that gets to the merge
   * first (car-following keeps the spacing), or go ahead of one only with a clear time margin.
   */
  private mergeOk(v: Vehicle, c: Connector, o: Connector): boolean {
    const myRem = (c.from.pl.length - v.s) + c.pl.length;
    const a = SIM.idm.a;
    const tMe = (-v.v + Math.sqrt(v.v * v.v + 2 * a * myRem)) / a;
    const cands = [...(o.occ as Vehicle[]), ...(o.from.occ as Vehicle[]).filter((w) => w.next === o || (w.next === null && !this.isFinal(w)))];
    for (const h of cands) {
      if (h === v) continue;
      const hRem = h.edge === o ? o.pl.length - h.s : o.from.pl.length - h.s + o.pl.length;
      if (hRem < 0) continue;
      const tH = hRem / Math.max(h.v, 1);
      if (tH <= tMe - 0.3 && hRem < myRem) continue; // it's through first: follow it in
      if (tH - tMe >= 1.5) continue; // we're in well ahead of it
      if (hRem > 60) continue;
      return false;
    }
    return true;
  }

  /** How far from its stop line a car asks the junction: its comfortable stopping distance plus a margin. */
  private askAt(v: Vehicle): number {
    return Math.max(14, (v.v * v.v) / (2 * 2) + v.v * 1.5 + 8);
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
    for (const c of out.ins) for (const h of c.holders as Vehicle[]) if (h.edge !== out) r.push(h);
    return r;
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
    const tf = v.truck ? 0.85 : 1; // trucks take everything a bit slower
    let v0 = e.speed * tf;
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
    if (lead) con(lead.s - lead.len - v.s, lead.v);
    else {
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
            v0 = Math.min(v0, Math.sqrt(cs * cs + 2 * 1.6 * Math.max(0, d)));
          }
        }
      } else {
        next = (e as Connector).to;
      }
      let hops = 0;
      while (next && hops++ < 3 && d < 140) {
        const o = next.occ as Vehicle[];
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
        // and one with its go-ahead still on its way up to the junction: line up behind it in good time
        for (const u of cf.c.holders as Vehicle[]) if (u !== v && u.edge === cf.c.from && u.v > 2) ld(u, cf.c.from.pl.length - u.s + cf.c.pl.length);
      }
    }
    // cooperative merging (see laneChange): line up behind a car in the lane we must get into...
    if (e.kind === "lane" && v.wish) {
      const tl = v.wish.lane;
      // and wait short of the end of the lane, where there's still room to pull across
      const hold = e.pl.length - 7 - v.s;
      if (hold > -2) con(Math.max(0.1, hold), 0);
      const ts = this.mapS(e as Lane, tl, v.s);
      for (const o of tl.occ as Vehicle[]) {
        if (o.s <= ts - v.len) continue; // already behind us: it makes room (below)
        // two cars that each need the other's lane: the older one goes first, the other drops back behind it
        if (o.wish?.lane === e && o.id > v.id) continue;
        const g2 = this.mapS(tl, e as Lane, o.s - o.len) - v.s - 1.5;
        if (g2 >= P.s0) con(g2, o.v);
        else {
          // still alongside it: drop back to a little under its speed (comfortable braking) rather than
          // stopping dead beside it, or creeping along level with it
          const tv = Math.max(0, o.v - 2);
          capA = Math.min(capA, v.v > tv ? Math.max(-3.5, (tv - v.v) * 1.5) : 0);
        }
        break;
      }
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
    // keep driveways clear: don't come to rest across a spot where someone waits to turn in or pull out
    // Only when what's ahead is (nearly) stopped, i.e. a queue is forming: a moving leader won't leave us there.
    // The spot needs our front 6.5 m short of it (a car pulling out needs that much to fit in ahead of us)
    // and our rear well past it; we come to rest s0 behind whatever we follow.
    if (e.kind === "lane" && gap !== Infinity && lv < 2) {
      const K = this.keepClear.get(e as Lane);
      const mine = v.destS >= 0 && this.isFinal(v) ? v.destS : -1e9;
      if (K) for (const k of K) {
        const hold = k - 6.5;
        if (v.s + (v.v * v.v) / 8 > hold) continue; // too close to stop short of it now: carry on through
        if (Math.abs(k - mine) < 6) continue; // that's our own driveway: we're turning in there
        const restFront = v.s + gap - P.s0;
        if (restFront > hold && restFront - v.len < k + 7.5) con(hold + P.s0 - v.s, 0);
      }
    }
    // diverging: a car that just left the same lane on a sibling connector is still right ahead
    // until the paths separate
    {
      const src = (e.kind === "conn" ? (e as Connector).from : e) as Lane;
      const myPos = e.kind === "conn" ? v.s : v.s - e.pl.length;
      if (myPos > -30 && src.outs) for (const sib of src.outs) {
        if (sib === e) continue;
        for (const u of sib.occ as Vehicle[]) {
          const rear = u.s - u.len;
          if (rear > 7) continue;
          const g2 = rear - myPos;
          if (g2 > -0.5) con(Math.max(g2, 0.1), u.v);
        }
      }
    }
    v.v0e = v0;
    // free road (IIDM: above the desired speed, ease down to it at no more than comfortable braking)
    const vf = Math.max(v0, 0.1);
    const aFree = v.v <= vf ? P.a * (1 - Math.pow(v.v / vf, 4)) : -P.b * (1 - Math.pow(vf / v.v, (P.a * 4) / P.b));
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
    const sStar = P.s0 + Math.max(0, v.v * P.T + (v.v * (v.v - lv)) / (2 * Math.sqrt(P.a * P.b)));
    const z = sStar / g;
    let aI: number;
    if (v.v <= v0) aI = z >= 1 ? P.a * (1 - z * z) : aFree * (1 - Math.pow(z, (2 * P.a) / Math.max(aFree, 0.01)));
    else aI = z >= 1 ? aFree + P.a * (1 - z * z) : aFree;
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
    const mine = cl.v.next;
    return lane.outs.some((c) => dkey(c.to.seg, c.to.dir) === nk && mine.conflicts.some((cf) => cf.c === c));
  }

  private canTurnInCheap(v: Vehicle, lane: Lane): boolean {
    const sideOfTravel = (lane.dir === 1 ? 1 : -1) * v.destSide;
    // (across oncoming traffic, it looks once it is about its stopping distance off)
    return sideOfTravel > 0 || v.s < v.destS - Math.max(25, this.askAt(v)) ? true : this.canTurnIn(v, lane);
  }

  // ---------------------------------------------------------------- lane changes

  private laneChange(v: Vehicle) {
    const lane = v.edge as Lane;
    if (lane.count < 2 || Math.abs(v.lat) > 0.4) return;
    if (v.s < 3 || lane.pl.length - v.s < 4) return;
    const all = this.lanesOf(dkey(lane.seg, lane.dir));
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
    const good = (l: Lane) => (final ? l.idx === this.turnIdx(v, l) : strict ? ahead(l) : reach(l));
    let target: Lane | null = null;
    let mandatory = false;
    v.wish = undefined;
    if (!good(lane)) {
      const goods = all.filter(good);
      if (!goods.length) return;
      goods.sort((a, b) => Math.abs(a.idx - lane.idx) - Math.abs(b.idx - lane.idx));
      const dirIdx = Math.sign(goods[0].idx - lane.idx);
      target = all.find((l) => l.idx === lane.idx + dirIdx) ?? null;
      mandatory = true;
    } else {
      // discretionary: overtake a slow leader if a neighbouring good lane is clearly better
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
    const ts = this.mapS(lane, target, v.s);
    const toEnd = lane.pl.length - v.s;
    const urgency = mandatory ? clamp(1 - toEnd / 90, 0, 1) : 0;
    const k = 1 - urgency * 0.6;
    const to = target.occ as Vehicle[];
    let lead: Vehicle | null = null, follow: Vehicle | null = null;
    for (const o of to) {
      if (o.s >= ts) { lead = o; break; }
      follow = o;
    }
    // (in a standing queue a car that has to get over noses in ahead of a waiting one with less room)
    const squeeze = mandatory && v.v < 1 && follow && follow.v < 0.5 ? 1.2 : 2.5;
    const noGap = (lead && lead.s - lead.len - ts < Math.max(2.5, v.v * 0.6 * k)) || (follow && ts - v.len - follow.s < Math.max(squeeze, follow.v * 0.9 * k + (follow.v - v.v) * 0.8));
    if (noGap) {
      // must get over soon and there's no gap: say so. We line up behind a car there, and the one behind it lets us in.
      if (mandatory && toEnd < 160) v.wish = { lane: target, t: this.time };
      return;
    }
    // commit
    removeOcc(lane, v);
    if (v.holding) this.release(v);
    v.next = null;
    v.granted = false;
    const off = lane.offset - target.offset;
    v.lat += (lane.dir === 1 ? 1 : -1) * off;
    v.edge = target;
    v.s = ts;
    insertOcc(target, v);
    v.lcCool = mandatory ? 1.2 : 5;
    if (final) this.computeDestS(v);
  }

  private mapS(a: Lane, b: Lane, s: number): number {
    return clamp((s / (a.pl.length || 1)) * b.pl.length, 0, b.pl.length);
  }

  // ---------------------------------------------------------------- rerouting

  /**
   * A car on the last road of its plan that isn't its destination (it was squeezed into the wrong exit):
   * plan again from here; if there's no way back, give up the trip and drive out of the region instead.
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
   * (a dead-end one-way, a road removed behind it) the trip is given up and the car heads out of the region;
   * if it can't even do that it leaves the road at the end of this lane instead of parking there.
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
    for (const a of this.ev.exits?.() ?? []) {
      const r2 = this.router.routeFromKey(k, a);
      if (!r2) continue;
      v.dest = a;
      v.exit = true;
      v.route = r2;
      return;
    }
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
    this.courtesy.clear();
    this.courtesyRest.clear();
    this.wishes.clear();
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
            else ok = false;
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
        best = { seg: id, s: r.s, p: a.p, side: dot(sub(a.p, q), right(t)) >= 0 ? 1 : -1 };
      }
    }
    return best;
  }

  private findLaneNear(v: Vehicle, cs: ChangeSet): Lane | null {
    const p = { x: v.x, y: v.y };
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
    removeOcc(v.edge, v);
    const s = fixedS ?? polyClosest(e.pl, { x: v.x, y: v.y }).s;
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
    for (const c of this.net.nodeGeom.values()) void c; // no-op: holders cleaned by release
    const i = this.vehicles.indexOf(v);
    if (i >= 0) {
      const last = this.vehicles.pop()!;
      if (last !== v) this.vehicles[i] = last;
    }
  }

  clearAll() {
    for (const v of [...this.vehicles]) this.remove(v);
    this.pending = [];
    this.roomClaim.clear();
    this.courtesy.clear();
    this.courtesyRest.clear();
    this.wishes.clear();
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
    if (snap) { v.px = v.x; v.py = v.y; v.ph = v.h; v.pang = ang; }
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

  vehicleNear(p: V2, r: number): Vehicle | null {
    let best: Vehicle | null = null, bd = r;
    for (const v of this.vehicles) {
      const d = dist(p, { x: v.x, y: v.y });
      if (d < bd) { bd = d; best = v; }
    }
    return best;
  }

  dirOf(v: Vehicle): V2 {
    return norm({ x: Math.cos(v.ang), y: Math.sin(v.ang) });
  }

  subPos(a: V2, b: V2) {
    return sub(a, b);
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
