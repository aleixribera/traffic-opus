// Where traffic queues, and what holds each queue (review 2026-11-12, category 4: CS's traffic view lets you find a
// bottleneck and fix it; here the Traffic window said only "Standing still 60 of 340"). Every standing vehicle is
// followed along what holds it (the vehicle whose gap it waits on, or the one that fills the road past the junction
// ahead) to the front of its queue, across junctions; the queues are then gathered by the place that holds their
// front (a junction, a stretch of road, a works gate) and that place is classed by what holds it there.
//
// The class decides the advice (src/ui/queues.ts), and each piece of advice was measured in the sim, not guessed
// (2026-11-12, a four-way and a T at 700-1500 vehicles an hour an arm, and the late save's works hub):
// - traffic lights never moved more than give-way did, saturated or not: the 24 s phases halve each arm's time
//   (a four-way at 900 an arm: 31 standing with lights against 4 without; a T whose side road queued: 26 against 2).
//   Lights are advised only to break a deadlock, where taking turns is the point, and for a works' gate street
//   where no roundabout fits (tests/gatecures.test.ts);
// - where one road waits for gaps, a Medium roundabout left the least standing (that four-way: 0.3, 384 trips in
//   10 min against 313; the T: 0.4 against 3.7), two lanes each way the most trips (458; the T 433) with more standing;
// - the late save's works hub (four streets, two or more queued at once, mostly trucks), in four 12-hour windows:
//   Avenue on its arms carried more freight in every one (940 truck trips against 883), with standing about the same
//   (16.5 against 15.2; over two game days 17.0 to 9.2 once and 7.4 to 11.9 the other); a Medium roundabout carried
//   less (861) and left more standing (20.9); lights left 28.2 and 19.1 standing over those two days. So a full
//   junction is widened, and a roundabout is for one road waiting for gaps.

import { ROAD_TYPES } from "../config";
import type { V2 } from "../core/math";
import type { Connector, Lane, RoadNetwork } from "../roads/network";
import { STUCK_SPEED, stuckNow, type Vehicle } from "./traffic";

/** Seconds standing before a vehicle counts in a queue: the Traffic window's "Standing still". */
export const QUEUE_STAND = 15;
/** Standing vehicles on one approach before that approach counts as queued (one or two is a light's red). */
const APPROACH_QUEUED = 3;
/** A vehicle that has stood and rolls on slower than this (m/s) is still queued: the queue behind it creeps on. */
const CREEP = 6;
/** A vehicle this close to the end of its lane (m, past its own length) is at the junction's stop line. */
const AT_LINE = 6;
/** Slower than this (m/s) is stopped dead: the sim's own deadlock test (Traffic.waitCycles). */
const DEAD = 0.3;

/**
 * What holds a queue's front:
 * - `deadlock`: a ring of vehicles each waiting on the next;
 * - `full`: a junction without lights with two or more approaches queued: more traffic than it can pass;
 * - `giveway`: a junction without lights where one approach waits for gaps in traffic that flows;
 * - `lights`: a junction with lights;
 * - `ring`: a roundabout's entry;
 * - `road`: a stretch of road with no junction ahead holding it: the road is full;
 * - `gate`: company trucks waiting to turn in at a works gate;
 * - `turn`: cars waiting to turn in at a driveway;
 * - `lane`: a vehicle that can't get into the lane its route needs;
 * - `other`: anything else (a bus at its stop, a car pulling out).
 */
export type QueueCause = "deadlock" | "full" | "giveway" | "lights" | "ring" | "road" | "gate" | "turn" | "lane" | "other";

export interface Queue {
  /** where it is held, stable while it lasts: "node:12", "seg:40", "gate:7" (a building), "lock:12" */
  key: string;
  cause: QueueCause;
  /** the junction holding it (node causes and deadlocks), the road (road, lane), the building (gate, turn) */
  node?: number;
  seg?: number;
  building?: number;
  /** where its front is held */
  at: V2;
  /** the standing vehicles behind that front, the longest-standing first */
  vehicles: Vehicle[];
  trucks: number;
  /** the longest any of them has stood (s) */
  worst: number;
  /** the roads they stand on, the most vehicles first */
  segs: number[];
  /** the approaches into its junction that are queued (node causes): their roads, the most queued first */
  approaches: number[];
}

/**
 * The junction a vehicle is held at: the one it is in, the one at the end of its lane when it stands at the line, or
 * the one behind it when its body still stands in that junction's box (a long truck stopped just past it: a car
 * pulling out of a driveway across its way can hold it there, and everything behind it waits at that junction).
 */
const atNode = (v: Vehicle): number | undefined => {
  if (v.edge.kind === "conn") return (v.edge as Connector).node;
  const l = v.edge as Lane;
  if (l.pl.length - v.s < v.len + AT_LINE) return v.next?.node ?? l.to;
  if (v.s < v.len + 1) return l.from;
  return undefined;
};

/** Waiting at its own driveway to turn in (the sim's arrival test, read only). */
const atDriveway = (v: Vehicle): boolean =>
  v.edge.kind === "lane" && v.ri >= v.route.length - 1 && v.destS >= 0 && !v.exit && v.s >= v.destS - 2 && v.s <= v.destS + 1;

/**
 * The queues on the road now, the most vehicles first. Each standing vehicle (QUEUE_STAND s or more, not a bus at its
 * stop) is followed to its front through what holds it: the vehicle whose gap it waits on, or the one filling the road
 * past the junction ahead, as long as that one is crawling or standing too. Pure over the sim's state.
 */
export function findQueues(vehicles: readonly Vehicle[], net: RoadNetwork, min = QUEUE_STAND): Queue[] {
  // (a queue that creeps on is still a queue: one that has stood a while and rolls on at a walk holds those behind)
  const slow = (u: Vehicle) => (u.v < STUCK_SPEED || (u.v < CREEP && u.stuck >= 5)) && u.quit === undefined && !u.dwell;
  const leader = (u: Vehicle): Vehicle | null => {
    const l = u.waitOn ?? u.blockBy ?? null;
    return l && l !== u && slow(l) ? l : null;
  };
  // each vehicle's front (memoised along the way), or a ring
  const front = new Map<Vehicle, Vehicle | Vehicle[]>();
  const headOf = (v0: Vehicle): Vehicle | Vehicle[] => {
    const path: Vehicle[] = [];
    const on = new Map<Vehicle, number>();
    let u: Vehicle | null = v0;
    let out: Vehicle | Vehicle[] | undefined;
    while (u) {
      const known = front.get(u);
      if (known) { out = known; break; }
      const i = on.get(u);
      if (i !== undefined) { out = path.slice(i); break; }
      on.set(u, path.length);
      path.push(u);
      const n = leader(u);
      if (!n || path.length > 600) { out = u; break; }
      u = n;
    }
    for (const p of path) front.set(p, out!);
    return out!;
  };
  const groups = new Map<string, { q: Queue }>();
  const put = (key: string, mk: () => Omit<Queue, "key" | "vehicles" | "trucks" | "worst" | "segs" | "approaches">, v: Vehicle) => {
    let e = groups.get(key);
    if (!e) groups.set(key, (e = { q: { key, ...mk(), vehicles: [], trucks: 0, worst: 0, segs: [], approaches: [] } }));
    e.q.vehicles.push(v);
  };
  for (const v of vehicles) {
    if (!stuckNow(v, min)) continue;
    const f = headOf(v);
    let h: Vehicle;
    if (Array.isArray(f)) {
      // a ring: held at the junction most of it waits at
      const at = new Map<number, number>();
      for (const u of f) { const n = atNode(u); if (n !== undefined) at.set(n, (at.get(n) ?? 0) + 1); }
      const node = [...at].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      // (all of it stopped, as the sim's own deadlock test has it: a deadlock; a ring that crawls, as a full
      // roundabout's does, is a queue at that junction like any other)
      if (f.every((u) => u.v < DEAD)) {
        const p = node !== undefined ? net.nodes.get(node)?.p : undefined;
        put(`lock:${node ?? f[0].id}`, () => ({ cause: "deadlock", node, at: p ?? { x: f[0].x, y: f[0].y } }), v);
        continue;
      }
      h = f.find((u) => atNode(u) === node) ?? f[0];
    } else h = f;
    const lane = h.edge.kind === "lane" ? (h.edge as Lane) : null;
    if (lane && atDriveway(h)) {
      const b = h.trip.to;
      put(`gate:${b}`, () => ({ cause: h.trip.haul ? "gate" : "turn", building: b, seg: lane.seg, at: { x: h.x, y: h.y } }), v);
      continue;
    }
    if (lane && h.wish) {
      put(`seg:${lane.seg}`, () => ({ cause: "lane", seg: lane.seg, at: { x: h.x, y: h.y } }), v);
      continue;
    }
    // (a front rolling off again mid-road, or standing behind one that already rolls: the queue is draining from the
    // junction it formed at, ahead of it; one queue, under one key, as it stops and goes)
    const node = atNode(h) ?? (lane && (h.v >= DEAD || h.waitOn || h.blockBy) ? lane.to : undefined);
    if (node !== undefined && net.nodeGeom.get(node)?.kind === "junction") {
      put(`node:${node}`, () => ({ cause: "full", node, at: net.nodes.get(node)?.p ?? { x: h.x, y: h.y } }), v);
      continue;
    }
    if (lane) {
      // standing mid-road with nothing at a junction holding it: the road itself is full
      put(`seg:${lane.seg}`, () => ({ cause: "road", seg: lane.seg, at: { x: h.x, y: h.y } }), v);
      continue;
    }
    put(`veh:${h.id}`, () => ({ cause: "other", at: { x: h.x, y: h.y } }), v);
  }
  const out: Queue[] = [];
  for (const { q } of groups.values()) {
    q.vehicles.sort((a, b) => b.stuck - a.stuck);
    q.worst = q.vehicles[0].stuck;
    const segN = new Map<number, number>();
    for (const v of q.vehicles) {
      if (v.truck) q.trucks++;
      if (v.edge.kind === "lane") { const s = (v.edge as Lane).seg; segN.set(s, (segN.get(s) ?? 0) + 1); }
    }
    q.segs = [...segN].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([s]) => s);
    if (q.cause === "full" && q.node !== undefined) classifyJunction(q, q.node, net);
    out.push(q);
  }
  return out.sort((a, b) => b.vehicles.length - a.vehicles.length || b.worst - a.worst);
}

/** A junction's queue: lights, a roundabout's entry, or without either one queued approach (give way) or more (full). */
function classifyJunction(q: Queue, node: number, net: RoadNetwork) {
  const per = new Map<number, number>();
  for (const v of q.vehicles) {
    if (v.edge.kind !== "lane") continue;
    const l = v.edge as Lane;
    if (l.to === node) per.set(l.seg, (per.get(l.seg) ?? 0) + 1);
  }
  q.approaches = [...per].filter(([, n]) => n >= APPROACH_QUEUED).sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([s]) => s);
  const ng = net.nodeGeom.get(node);
  if (net.nodes.get(node)?.signal) q.cause = "lights";
  else if (ng?.arms.some((a) => net.segs.get(a.seg)?.ring)) q.cause = "ring";
  else q.cause = q.approaches.length >= 2 ? "full" : "giveway";
  if (!q.approaches.length) q.approaches = [...per].sort((a, b) => b[1] - a[1] || a[0] - b[0]).map(([s]) => s).slice(0, 1);
}

/** Lanes each way on a road (the most of the two), for "widen it" against "it is wide already". */
export function lanesEachWay(net: RoadNetwork, seg: number): number {
  const s = net.segs.get(seg);
  if (!s) return 0;
  const T = ROAD_TYPES[s.type];
  return Math.max(T.fwd, T.bwd);
}
