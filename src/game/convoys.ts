// Oversized loads (docs/design.md, "Freight: oversized loads"): now and then a machine works builds a piece too big
// for any truck (a turbine, or a bridge girder for a landmark) and ships it by itself as an escorted convoy: a pilot
// car with flashing lights, a low-loader with the piece, and a trailing escort. Nothing to plan or approve: the
// convoy takes the route any truck would, at a crawl, holding its lane, so traffic queues behind it. A turbine
// goes to a landmark that waits for one, or else to one of the company's power plants, which then makes more power
// for good; a girder goes to a landmark that needs girders. The convoy drives as one vehicle in the traffic sim,
// drawn piece by piece along the path its front drove, like a road train.

import type { Building } from "./buildings";
import { PLANTS, Industry, type HaulRun, type PlantKind } from "./industry";
import type { PendingSpawn, Trip, Unit, Vehicle } from "../sim/traffic";

/** What an oversized piece is: a turbine (power plants and the dam) or a steel girder (towers and halls). */
export type BigKind = "turbine" | "girder";
export const BIG_NAME: Record<BigKind, string> = { turbine: "Turbine", girder: "Steel girder" };

/** Loads of machinery a machine works makes for each oversized piece it builds besides (at no extra input). */
export const LOADS_PER_PIECE = 12;
/** Pieces a machine works keeps in its yard waiting for somewhere to go (it builds no more till one ships). */
export const PIECE_YARD = 2;
/** Turbines a power plant can take, and what each adds to its rated output for good. */
export const MAX_TURBINES = 3;
export const TURBINE_BOOST = 0.25;

/**
 * The convoy, front to back, measured from the pilot car's front bumper (m): the pilot car, the low-loader's
 * tractor, the low-loader riding the tractor's fifth wheel, the escort. Each piece rides the driven path on its
 * pivot (a car's front axle, the trailer's kingpin) and rear axle. The Blender models are built to these numbers.
 */
export const CONVOY_UNITS: Unit[] = [
  { at: 0, len: 4.6, pivot: 1.0, axle: 3.6 },
  { at: 7.4, len: 6.6, pivot: 1.3, axle: 4.6 },
  { at: 11.2, len: 14.0, pivot: 0.8, axle: 12.4 },
  { at: 28.0, len: 4.6, pivot: 1.0, axle: 3.6 },
];
export const CONVOY_LEN = 32.6;
/** Top speed of a convoy (m/s, ~30 km/h on any road), and its share of a car's pull-away. */
export const CONVOY_VMAX = 8.5;
export const CONVOY_ACCEL = 0.45;

/** How a convoy drives, for the traffic sim. */
export function convoyBody(): Pick<PendingSpawn, "len" | "vf" | "af" | "units" | "vmax" | "keepLane"> {
  return { len: CONVOY_LEN, vf: 0.6, af: CONVOY_ACCEL, units: CONVOY_UNITS, vmax: CONVOY_VMAX, keepLane: true };
}

/** A machine works' oversized piece in the making, and those waiting in its yard (kept on its PlantState). */
export interface BigState { prog: number; n: number; shipped?: number }

/** What the convoys need from the game. */
export interface ConvoyHost {
  readonly time: number;
  readonly buildings: { list: Building[]; byId: Map<number, Building> };
  connected(a: number, b: number): boolean;
  request(p: PendingSpawn): void;
  trips(): Iterable<Trip>;
  /** a piece reached a landmark's site: it counts it (and may finish the site) */
  pieceIn(site: Building, kind: BigKind): void;
  /** pieces a landmark's site still waits for, and of what kind (null: it isn't one, or needs none) */
  piecesLeft(site: Building): { kind: BigKind; n: number } | null;
  /** a convoy got through (the milestones count it) */
  delivered?(kind: BigKind, to: Building): void;
  /** a convoy set off (the news ticker and the map follow it) */
  departed?(kind: BigKind, from: Building, to: Building): void;
  toast?(msg: string): void;
}

export interface BigRun { kind: BigKind }

/** The convoys out on the road now, by where they are headed: the pieces on their way to each building. */
function onTheWay(h: ConvoyHost) {
  const to = new Map<number, number>(), from = new Map<number, number>();
  for (const t of h.trips()) {
    const r = t.haul;
    if (!r?.big || r.done) continue;
    to.set(r.dest, (to.get(r.dest) ?? 0) + 1);
    from.set(r.plant, (from.get(r.plant) ?? 0) + 1);
  }
  return { to, from };
}

export class Convoys {
  constructor(private h: ConvoyHost) {}

  /** A machine works made loads of machinery: its next oversized piece takes shape alongside. */
  made(b: Building, n: number) {
    if (b.kind !== "machineworks" || !b.plant) return;
    const B = (b.plant.big ??= { prog: 0, n: 0 });
    if (B.n >= PIECE_YARD) return;
    B.prog += n / LOADS_PER_PIECE;
    while (B.prog >= 1 && B.n < PIECE_YARD) { B.prog -= 1; B.n++; }
    if (B.n >= PIECE_YARD) B.prog = Math.min(B.prog, 0.999);
  }

  /** Where a piece of this machine works' should go now: a landmark that waits for it first, then a power plant. */
  destination(from: Building, kind?: BigKind, coming = onTheWay(this.h).to): { b: Building; kind: BigKind } | null {
    const seg = from.access?.seg;
    if (seg === undefined) return null;
    let best: { b: Building; kind: BigKind; v: number } | null = null;
    const km = (o: Building) => Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y) / 1000;
    for (const o of this.h.buildings.list) {
      if (!o.plant || !o.access || o.id === from.id || !this.h.connected(seg, o.access.seg)) continue;
      const left = this.h.piecesLeft(o);
      let v = -Infinity, k: BigKind = "turbine";
      if (left && (!kind || left.kind === kind) && left.n - (coming.get(o.id) ?? 0) >= 1) { v = 1000 - km(o); k = left.kind; }
      else if (PLANTS[o.kind as PlantKind]?.makes && !PLANTS[o.kind as PlantKind].mega && Industry.running(o) && (!kind || kind === "turbine")) {
        if ((o.plant.turbines ?? 0) + (coming.get(o.id) ?? 0) < MAX_TURBINES) v = 500 - km(o);
      }
      if (v > (best?.v ?? -Infinity)) best = { b: o, kind: k, v };
    }
    return best ? { b: best.b, kind: best.kind } : null;
  }

  /** Every tick: each machine works with a piece in its yard and none on the road sends it off. */
  tick() {
    const way = onTheWay(this.h);
    for (const b of this.h.buildings.list) {
      if (b.kind !== "machineworks" || !b.plant?.big || b.plant.big.n < 1 || !b.access || !Industry.running(b)) continue;
      // (one convoy at a time from a works: its escorts are the same crew)
      if ((way.from.get(b.id) ?? 0) > 0) continue;
      const d = this.destination(b, undefined, way.to);
      if (!d) continue;
      this.send(b, d.b, d.kind);
      way.from.set(b.id, 1);
      way.to.set(d.b.id, (way.to.get(d.b.id) ?? 0) + 1);
    }
  }

  private send(from: Building, to: Building, kind: BigKind) {
    from.plant!.big!.n--;
    const haul: HaulRun = { plant: from.id, leg: "out", product: "machinery", n: 0, dest: to.id, big: kind };
    this.h.request({
      from: from.access!, fromSide: from.side, to: to.access!, toSide: to.side, truck: true, tries: 0, wait: 0, ...convoyBody(),
      trip: { kind: "cargo", from: from.id, to: to.id, resident: -1, cargo: "big", startT: this.h.time, freeFlow: 0, haul },
    });
    this.h.departed?.(kind, from, to);
  }

  /** A convoy reached its destination: the piece goes into the landmark, or onto the power plant's turbine hall. */
  arrive(v: Vehicle) {
    const r = v.trip.haul!;
    if (r.done || !r.big) return;
    r.done = true;
    const to = this.h.buildings.byId.get(r.dest);
    if (!to?.plant) { this.back(r); return; }
    const left = this.h.piecesLeft(to);
    if (left && left.kind === r.big && left.n >= 1) this.h.pieceIn(to, r.big);
    else if (PLANTS[to.kind as PlantKind]?.makes && (to.plant.turbines ?? 0) < MAX_TURBINES && r.big === "turbine") {
      to.plant.turbines = (to.plant.turbines ?? 0) + 1;
    } else { this.back(r); return; }
    const home = this.h.buildings.byId.get(r.plant);
    if (home?.plant?.big) home.plant.big.shipped = (home.plant.big.shipped ?? 0) + 1;
    this.h.delivered?.(r.big, to);
  }

  /** A convoy gave up or lost its road: the piece goes back to the works' yard, to be sent again. */
  fail(trip: Trip) {
    const r = trip.haul!;
    if (r.done || !r.big) return;
    r.done = true;
    this.back(r);
  }

  private back(r: HaulRun) {
    const home = this.h.buildings.byId.get(r.plant);
    if (home?.plant) { const B = (home.plant.big ??= { prog: 0, n: 0 }); B.n++; }
  }
}

/** The convoys from a machine works out on the road now (for the panel). */
export function convoysOut(trips: Iterable<Trip>, plant: number): HaulRun[] {
  const out: HaulRun[] = [];
  for (const t of trips) if (t.haul?.big && !t.haul.done && t.haul.plant === plant) out.push(t.haul);
  return out;
}
