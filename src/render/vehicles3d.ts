import * as THREE from "three";
import { SIM } from "../config";
import { carColor, EMERGE, fromLot, LONG, type PendingSpawn, type Traffic, type Trip, type Vehicle } from "../sim/traffic";
import type { V2 } from "../core/math";
import type { LotWay } from "./buildings3d";
import { VEHICLE_MODELS, type ModelSet, type VehicleKind } from "./models";
import { CARGO_COLOR, MOTOR_LIVERY } from "./palette";
import { TRUCK_CLASSES } from "../game/trucks";
import type { Unit } from "../sim/traffic";

interface Batch {
  kind: VehicleKind;
  meshes: { mesh: THREE.InstancedMesh; tint: "body" | "cargo" | null }[];
  cap: number;
}

const LIFT = 0.07;

/** One piece of a car's way into or out of a lot: a cubic, driven forwards or backed along. */
interface Leg { a: V2; b: V2; c: V2; d: V2; len: number; back: boolean }
/** A car drawn driving into its lot (after it left the road) or out of it (before it joins the road). */
interface Ghost { kind: VehicleKind; color: number; load: number | null; legs: Leg[]; total: number; t0: number; dur: number; out: boolean; pieces?: Piece[] }
/** One drawn piece of a vehicle: its model, and (a road train's trailers) how far its middle is behind the front piece's. */
interface Piece { kind: VehicleKind; back: number }

/** The truck body that carries each product: loose bulk in tippers, liquids in tankers, long loads on flatbeds. */
const TRUCK_BODY: Record<string, VehicleKind> = {
  crops: "tipper", ore: "tipper", coal: "tipper", lime: "tipper", sand: "tipper", gravel: "tipper", copperore: "tipper",
  crude: "tanker", fuel: "tanker", chemicals: "tanker", cement: "tanker",
  logs: "flatbed", planks: "flatbed", steel: "flatbed", parts: "flatbed", machinery: "flatbed", copper: "flatbed",
  slag: "tipper", chips: "tipper",
  // the Motor Works' cars ride two decks of a car transporter
  cars: "carrier",
  // perishables ride chilled, in refrigerated box bodies with the cold unit on the front
  milk: "reefer", cheese: "reefer",
  // (glass, plastics, household goods, electronics, fertilizer, explosives and rubber ride in box trucks: the default)
};
type Body = "truck" | "tipper" | "tanker" | "flatbed" | "reefer" | "carrier";
const truckBody = (t: Trip): Body => (TRUCK_BODY[t.haul?.product ?? t.cargo ?? ""] ?? "truck") as Body;
/**
 * The models a truck is drawn with, front first: its class's (a light truck's, a heavy rigid's, or a road train's
 * tractor and two trailers) with the body for what it carries.
 */
function truckPieces(t: Trip): Piece[] {
  const b = truckBody(t);
  if (t.haul?.cls === "heavy") return [{ kind: `heavy_${b}`, back: 0 }];
  if (t.haul?.cls === "roadtrain") {
    const U = TRUCK_CLASSES.roadtrain.units!, mid = (u: Unit) => u.at + u.len / 2;
    return [{ kind: "rt_tractor", back: 0 }, { kind: `rt_${b}_a`, back: mid(U[1]) - mid(U[0]) }, { kind: `rt_${b}_b`, back: mid(U[2]) - mid(U[0]) }];
  }
  return [{ kind: b, back: 0 }];
}
const EMPTY_BOX = 0xf2f2ee;
/** A Motor Works car's paint: one of the company's liveries. */
const livery = (look: number) => MOTOR_LIVERY[look % MOTOR_LIVERY.length];
/** What a truck's load part shows: the cargo's colour, or null for nothing on an open body (tipper, flatbed) running empty. */
function loadOf(kind: Body, t: Trip): number | null {
  // (a transporter's cars are one batch off the line, in one of the Motor Works' liveries)
  if (kind === "carrier" && t.cargo) return MOTOR_LIVERY[Math.floor(t.startT) % MOTOR_LIVERY.length];
  if (t.cargo) return CARGO_COLOR[t.cargo] ?? EMPTY_BOX;
  if (kind === "tanker") return CARGO_COLOR[t.haul?.product ?? ""] ?? EMPTY_BOX; // the tank stays its product's colour
  if (kind === "reefer") return CARGO_COLOR[t.haul?.product ?? ""] ?? EMPTY_BOX; // (and a reefer its product's livery band)
  return kind === "tipper" || kind === "flatbed" || kind === "carrier" ? null : EMPTY_BOX;
}

const cub = (l: Leg, t: number): V2 => {
  const u = 1 - t;
  return {
    x: u * u * u * l.a.x + 3 * u * u * t * l.b.x + 3 * u * t * t * l.c.x + t * t * t * l.d.x,
    y: u * u * u * l.a.y + 3 * u * u * t * l.b.y + 3 * u * t * t * l.c.y + t * t * t * l.d.y,
  };
};
const cubDir = (l: Leg, t: number): V2 => {
  const u = 1 - t;
  const x = 3 * u * u * (l.b.x - l.a.x) + 6 * u * t * (l.c.x - l.b.x) + 3 * t * t * (l.d.x - l.c.x);
  const y = 3 * u * u * (l.b.y - l.a.y) + 6 * u * t * (l.c.y - l.b.y) + 3 * t * t * (l.d.y - l.c.y);
  return { x, y };
};
const add = (p: V2, d: V2, k: number): V2 => ({ x: p.x + d.x * k, y: p.y + d.y * k });
const dst = (p: V2, q: V2) => Math.hypot(p.x - q.x, p.y - q.y);
/** A leg leaving `a` heading `da` and arriving at `d` heading `dd`. */
function leg(a: V2, da: V2, d: V2, dd: V2, back = false): Leg {
  const k = dst(a, d) * 0.42;
  const l: Leg = { a, b: add(a, da, k), c: add(d, dd, -k), d, len: 0, back };
  let n = 0, prev = a;
  for (let i = 1; i <= 8; i++) { const q = cub(l, i / 8); n += dst(q, prev); prev = q; }
  l.len = Math.max(0.1, n);
  return l;
}

/** All moving vehicles as instanced Blender models, interpolated between sim steps. */
export class Vehicles3D {
  readonly group = new THREE.Group();
  private batches = new Map<VehicleKind, Batch>();
  private mat = new THREE.MeshLambertMaterial({ vertexColors: true });
  private tintMat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  private m = new THREE.Matrix4();
  /** Collapses a part to nothing (the empty load of an open truck body). */
  private none = new THREE.Matrix4().makeScale(0, 0, 0);
  private c = new THREE.Color();
  private X = new THREE.Vector3();
  private Y = new THREE.Vector3(0, 1, 0);
  private Z = new THREE.Vector3();
  private S = new THREE.Vector3();
  /** How cars get into a building's lot (set by the app); null when the building is gone. */
  lotOf: ((building: number) => LotWay | null) | null = null;
  private seen = new Map<number, Vehicle>();
  private arriving: Ghost[] = [];
  private leaving = new Map<PendingSpawn, Ghost>();

  constructor(private models: ModelSet) {
    for (const k of VEHICLE_MODELS) this.batches.set(k, this.makeBatch(k, k === "car" || k === "van" || k === "truck" ? 256 : k === "bus" ? 16 : 64));
  }

  private makeBatch(kind: VehicleKind, cap: number): Batch {
    const vm = this.models.vehicles.get(kind)!;
    const meshes = vm.parts.map((p) => {
      const mesh = new THREE.InstancedMesh(p.geo, p.tint ? this.tintMat : this.mat, cap);
      mesh.count = 0;
      mesh.castShadow = true;
      mesh.frustumCulled = false;
      if (p.tint) mesh.setColorAt(0, new THREE.Color(1, 1, 1));
      this.group.add(mesh);
      return { mesh, tint: p.tint ? (p.name === "cargo" ? "cargo" as const : "body" as const) : null };
    });
    return { kind, meshes, cap };
  }

  private ensure(kind: VehicleKind, n: number): Batch {
    let b = this.batches.get(kind)!;
    if (n <= b.cap) return b;
    for (const x of b.meshes) { this.group.remove(x.mesh); x.mesh.dispose(); }
    b = this.makeBatch(kind, Math.max(n, b.cap * 2));
    this.batches.set(kind, b);
    return b;
  }

  /** The model a vehicle is drawn with (a road train: its tractor's; its trailers are drawn too, see update). */
  static kindOf(v: Vehicle): VehicleKind {
    if (v.trip.bus) return "bus";
    if (v.truck) return truckPieces(v.trip)[0].kind;
    if (v.trip.motor) return "motorcar";
    return v.look % 6 === 0 ? "van" : "car";
  }

  /** Write one vehicle pose into a matrix (also used for parked cars). */
  pose(out: THREE.Matrix4, x: number, y: number, h: number, ang: number, s = 1) {
    const cx = Math.cos(ang), sz = Math.sin(ang);
    this.Z.set(cx, 0, sz);
    this.X.set(sz, 0, -cx);
    out.makeBasis(this.X, this.Y, this.Z);
    if (s !== 1) out.scale(this.S.set(s, s, s));
    out.setPosition(x, h + LIFT, y);
  }

  /** Cars that just reached their driveway: they drive on into the lot (a free bay, else up the drive) and park. */
  private noteArrivals(traffic: Traffic, now: number) {
    const live = new Set<number>();
    for (const v of traffic.vehicles) live.add(v.id);
    for (const [id, v] of this.seen) {
      if (live.has(id)) continue;
      this.seen.delete(id);
      if (!this.lotOf || !v.arrived || v.exit || v.trip.to < 0 || v.edge.kind !== "lane") continue;
      const w = this.lotOf(v.trip.to);
      if (!w) continue;
      const P = { x: v.x, y: v.y }, d0 = { x: Math.cos(v.ang), y: Math.sin(v.ang) };
      const legs = [leg(P, d0, w.kerb, w.into)];
      // (a heavy rigid or a road train doesn't fit a car bay: it drives straight up the drive to the yard)
      if (w.bays.length && v.len < LONG) {
        const bay = w.bays[v.id % w.bays.length];
        legs.push(leg(w.kerb, w.into, bay.p, bay.dir));
      } else if (dst(w.kerb, w.drive) > 2) legs.push(leg(w.kerb, w.into, add(w.drive, w.into, -1), w.into));
      const total = legs.reduce((n, l) => n + l.len, 0);
      const kind = Vehicles3D.kindOf(v);
      const pieces = v.truck ? truckPieces(v.trip) : undefined;
      this.arriving.push({ kind, color: v.trip.motor ? livery(v.look) : v.color, load: v.truck ? loadOf(truckBody(v.trip), v.trip) : EMPTY_BOX, legs, total, t0: now, dur: Math.min(4, Math.max(1.1, total / 4.5)), out: false, pieces });
    }
    for (const v of traffic.vehicles) if (!this.seen.has(v.id)) this.seen.set(v.id, v);
    if (this.arriving.length > 400) this.arriving.splice(0, this.arriving.length - 400);
  }

  /** Cars about to start a trip: they back out of a bay (or come down the drive) to the kerb. */
  private noteDepartures(traffic: Traffic) {
    const want = new Set<PendingSpawn>();
    for (const p of traffic.pending) {
      if (!fromLot(p) || !this.lotOf) continue;
      // (a long truck waiting behind another at its lot's gate stays out of sight till its turn)
      if ((p.len ?? 0) >= LONG && p.go === undefined) continue;
      want.add(p);
      if (this.leaving.has(p)) continue;
      const w = this.lotOf(p.trip.from);
      if (!w) continue;
      const out = { x: -w.into.x, y: -w.into.y };
      const legs: Leg[] = [];
      if (w.bays.length && (p.len ?? 0) < LONG) {
        const bay = w.bays[(p.look ?? 0) % w.bays.length];
        const R = add(bay.p, bay.dir, -5.5);
        const ex = { x: w.kerb.x - R.x, y: w.kerb.y - R.y }, el = Math.hypot(ex.x, ex.y) || 1;
        const exd = { x: ex.x / el, y: ex.y / el };
        // backed out along an arc till its nose points the way out, then forward to the kerb
        legs.push(leg(bay.p, { x: -bay.dir.x, y: -bay.dir.y }, R, { x: -exd.x, y: -exd.y }, true));
        legs.push(leg(R, exd, w.kerb, out));
      } else {
        const E = dst(w.kerb, w.drive) > 2 ? add(w.drive, w.into, -1) : add(w.kerb, w.into, 4);
        legs.push(leg(E, out, w.kerb, out));
      }
      const total = legs.reduce((n, l) => n + l.len, 0);
      const look = p.look ?? 0;
      const pieces = p.truck ? truckPieces(p.trip) : undefined;
      const kind: VehicleKind = pieces ? pieces[0].kind : p.trip.motor ? "motorcar" : look % 6 === 0 ? "van" : "car";
      this.leaving.set(p, { kind, color: p.truck ? 0xf5f5f0 : p.trip.motor ? livery(look) : carColor(look), load: p.truck ? loadOf(truckBody(p.trip), p.trip) : EMPTY_BOX, legs, total, t0: p.go ?? p.t0 ?? traffic.time, dur: Math.min(EMERGE - 0.15, Math.max(1, total / 3.5)), out: true, pieces });
    }
    for (const p of this.leaving.keys()) if (!want.has(p)) this.leaving.delete(p);
  }

  /** Where a lot car is now, its heading and size (it grows in as it appears, shrinks away once parked). */
  private ghostPose(g: Ghost, now: number): { x: number; y: number; ang: number; s: number } | null {
    const el = now - g.t0;
    let f = Math.min(1, Math.max(0, el / g.dur));
    // arriving cars slow to a stop in the bay; leaving ones pull away gently and slow for the kerb
    f = g.out ? f * f * (3 - 2 * f) : 1 - (1 - f) * (1 - f);
    let at = f * g.total;
    let l = g.legs[g.legs.length - 1], t = 1;
    for (const x of g.legs) { if (at <= x.len) { l = x; t = at / x.len; break; } at -= x.len; }
    const p = cub(l, t), d = cubDir(l, t);
    let ang = Math.atan2(d.y, d.x);
    if (l.back) ang += Math.PI;
    let s = 1;
    if (g.out) s = 0.55 + 0.45 * Math.min(1, el / 0.35);
    else {
      const after = el - g.dur;
      if (after > 1.2) return null;
      if (after > 0.8) s = 1 - ((after - 0.8) / 0.4) * 0.45;
    }
    return { x: p.x, y: p.y, ang, s };
  }

  update(traffic: Traffic, alpha: number) {
    const now = traffic.time + (alpha - 1) * SIM.dt;
    this.noteArrivals(traffic, now);
    this.noteDepartures(traffic);
    const lists = {} as Record<VehicleKind, { v: Vehicle; unit: number; load: number | null }[]>;
    const ghosts = {} as Record<VehicleKind, { g: Ghost; x: number; y: number; ang: number; s: number }[]>;
    for (const k of VEHICLE_MODELS) { lists[k] = []; ghosts[k] = []; }
    for (const v of traffic.vehicles) {
      if (!v.truck) { lists[Vehicles3D.kindOf(v)].push({ v, unit: -1, load: EMPTY_BOX }); continue; }
      const P = truckPieces(v.trip), load = loadOf(truckBody(v.trip), v.trip);
      // (a road train's pieces, or a heavy rigid on its axles, each have their own pose on the path; until the sim has
      // placed them, one rigid piece)
      if (v.uPose && v.puPose && P.length === v.uPose.length / 4) P.forEach((p, i) => lists[p.kind].push({ v, unit: i, load }));
      else lists[P[0].kind].push({ v, unit: -1, load });
    }
    const addGhost = (g: Ghost, q: { x: number; y: number; ang: number; s: number }) => {
      if (!g.pieces || g.pieces.length < 2) { ghosts[g.kind].push({ g, ...q }); return; }
      // a road train in a lot: drawn straight, the trailers behind the tractor
      const cx = Math.cos(q.ang), sy = Math.sin(q.ang);
      for (const p of g.pieces) ghosts[p.kind].push({ g, ...q, x: q.x - cx * p.back * q.s, y: q.y - sy * p.back * q.s });
    };
    this.arriving = this.arriving.filter((g) => {
      const q = this.ghostPose(g, now);
      if (q) addGhost(g, q);
      return !!q;
    });
    for (const g of this.leaving.values()) { const q = this.ghostPose(g, now); if (q) addGhost(g, q); }
    for (const kind of VEHICLE_MODELS) {
      const vs = lists[kind], gs = ghosts[kind];
      const b = this.ensure(kind, vs.length + gs.length);
      for (const { mesh } of b.meshes) mesh.count = vs.length + gs.length;
      for (let j = 0; j < gs.length; j++) {
        const q = gs[j];
        this.pose(this.m, q.x, q.y, 0, q.ang, q.s);
        for (const { mesh, tint } of b.meshes) {
          const bare = tint === "cargo" && q.g.load === null;
          mesh.setMatrixAt(vs.length + j, bare ? this.none : this.m);
          if (tint === "body") mesh.setColorAt(vs.length + j, this.c.setHex(q.g.color));
          else if (tint === "cargo") mesh.setColorAt(vs.length + j, this.c.setHex(q.g.load ?? EMPTY_BOX));
        }
      }
      for (let i = 0; i < vs.length; i++) {
        const { v, unit, load } = vs[i];
        let x: number, y: number, h: number, ang: number;
        if (unit >= 0) {
          // one piece of an articulated vehicle, between its last pose and this one
          const o = unit * 4, P = v.puPose!, Q = v.uPose!;
          x = P[o] + (Q[o] - P[o]) * alpha;
          y = P[o + 1] + (Q[o + 1] - P[o + 1]) * alpha;
          h = P[o + 2] + (Q[o + 2] - P[o + 2]) * alpha;
          let da = Q[o + 3] - P[o + 3];
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          ang = P[o + 3] + da * alpha;
        } else {
          x = v.px + (v.x - v.px) * alpha;
          y = v.py + (v.y - v.py) * alpha;
          h = v.ph + (v.h - v.ph) * alpha;
          let da = v.ang - v.pang;
          if (da > Math.PI) da -= Math.PI * 2;
          if (da < -Math.PI) da += Math.PI * 2;
          ang = v.pang + da * alpha;
        }
        const f = v.fade < 1 ? 0.55 + 0.45 * v.fade : 1;
        this.pose(this.m, x, y, h, ang, f);
        for (const { mesh, tint } of b.meshes) {
          mesh.setMatrixAt(i, tint === "cargo" && load === null ? this.none : this.m);
          if (tint === "body") mesh.setColorAt(i, this.c.setHex(v.trip.motor ? livery(v.look) : v.color));
          else if (tint === "cargo") mesh.setColorAt(i, this.c.setHex(load ?? EMPTY_BOX));
        }
      }
      for (const { mesh } of b.meshes) {
        mesh.instanceMatrix.needsUpdate = true;
        if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      }
    }
  }
}
