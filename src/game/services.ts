// City services, the CS2 way. The player places stations; each one covers the buildings its vehicles can reach
// within a set drive time over the real roads (so a station behind a slow detour covers less). Calls (garbage,
// fires, crime, sick residents) send a real vehicle from the closest covering station that has one free: it drives
// out through traffic, deals with the call, and drives back. Schools take children and students for the day.
// Coverage and service levels feed land value, happiness, residential demand and abandonment.

import { BUILDING_TYPES, type BuildingKind } from "../config";
import { dist } from "../core/math";
import { dkSeg } from "../sim/router";
import type { Trip, Vehicle } from "../sim/traffic";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP } from "./growables";
import { Age, DAY, HOUR, St, type Citizen } from "./society";

export type ServiceId = "garbage" | "fire" | "police" | "health" | "school" | "parks";
export type ServiceKind = "garbage" | "firestation" | "police" | "clinic" | "hospital" | "school" | "highschool" | "university" | "park" | "parklarge";
export type ServiceVehicle = "garbagetruck" | "firetruck" | "ambulance" | "policecar";

export interface ServiceDef {
  kind: ServiceKind;
  svc: ServiceId;
  cost: number;
  upkeep: number; // per game hour
  /** Drive seconds a vehicle (or a pupil) is willing to cover; metres for parks. */
  range: number;
  vehicles: number;
  /** Pupils or patients it takes at once. */
  cap: number;
  /** School level: 0 elementary (children), 1 high school (edu 0 -> 1), 2 university (edu 1 -> 2). */
  tier?: 0 | 1 | 2;
  unlock: number; // milestone index
  vehicle?: ServiceVehicle;
}

export const SERVICES: Record<ServiceKind, ServiceDef> = {
  garbage: { kind: "garbage", svc: "garbage", cost: 12000, upkeep: 36, range: 170, vehicles: 6, cap: 0, unlock: 0, vehicle: "garbagetruck" },
  firestation: { kind: "firestation", svc: "fire", cost: 10000, upkeep: 30, range: 110, vehicles: 3, cap: 0, unlock: 1, vehicle: "firetruck" },
  police: { kind: "police", svc: "police", cost: 9000, upkeep: 28, range: 120, vehicles: 3, cap: 0, unlock: 1, vehicle: "policecar" },
  clinic: { kind: "clinic", svc: "health", cost: 9000, upkeep: 30, range: 120, vehicles: 2, cap: 12, unlock: 1, vehicle: "ambulance" },
  hospital: { kind: "hospital", svc: "health", cost: 45000, upkeep: 120, range: 230, vehicles: 6, cap: 60, unlock: 3, vehicle: "ambulance" },
  school: { kind: "school", svc: "school", cost: 14000, upkeep: 40, range: 110, vehicles: 0, cap: 140, tier: 0, unlock: 1 },
  highschool: { kind: "highschool", svc: "school", cost: 30000, upkeep: 70, range: 220, vehicles: 0, cap: 120, tier: 1, unlock: 2 },
  university: { kind: "university", svc: "school", cost: 80000, upkeep: 150, range: 400, vehicles: 0, cap: 200, tier: 2, unlock: 4 },
  park: { kind: "park", svc: "parks", cost: 1500, upkeep: 3, range: 170, vehicles: 0, cap: 0, unlock: 0 },
  parklarge: { kind: "parklarge", svc: "parks", cost: 8000, upkeep: 10, range: 320, vehicles: 0, cap: 0, unlock: 2 },
};

export const SERVICE_KINDS = Object.keys(SERVICES) as ServiceKind[];
export const isServiceKind = (k: BuildingKind): k is ServiceKind => k in SERVICES;

/** Service tabs in the build menu, in CS2's order. */
export const SERVICE_TABS: { id: ServiceId; label: string; kinds: ServiceKind[]; blurb: string }[] = [
  { id: "garbage", label: "Garbage", kinds: ["garbage"], blurb: "Trucks empty the bins of every building they can reach." },
  { id: "health", label: "Healthcare", kinds: ["clinic", "hospital"], blurb: "Ambulances bring sick residents in. Without care, families leave." },
  { id: "fire", label: "Fire", kinds: ["firestation"], blurb: "Engines put fires out before a building burns down." },
  { id: "police", label: "Police", kinds: ["police"], blurb: "Patrols keep crime down. High crime drives residents away." },
  { id: "school", label: "Education", kinds: ["school", "highschool", "university"], blurb: "Schools for children, and the education offices need." },
  { id: "parks", label: "Parks", kinds: ["park", "parklarge"], blurb: "Raise land value and happiness nearby." },
];

/** Problems only start once the town is a Hamlet, so a new player can lay out a first neighbourhood in peace. */
const PRESSURE_MILESTONE = 1;
const GARBAGE_CALL = 12; // units before a building asks for a pickup
const GARBAGE_BAD = 45;
/** What a garbage truck carries before it heads home to tip: it works its way round the waiting bins till then. */
const TRUCK_LOAD = 8000;
/** How far (straight line, m) a truck on its round goes on to the next waiting bin rather than home. */
const ROUND_HOP = 600;
/** Bins a passing truck bothers to empty (CS trucks pick up from every building on the streets they drive). */
const SWEEP_MIN = 4;
const CRIME_CALL = 22;
const CRIME_BAD = 45;
const FIRE_BURN = HOUR * 4; // unattended, a fire destroys the building
const SICK_LEAVE = DAY * 1.5; // a sick resident nobody can treat: the family moves away
const TREAT = HOUR * 10;
const STUDY_DAYS: Record<number, number> = { 1: 3, 2: 4 };

export interface Coverage { garbage: number; fire: number; police: number; health: number; school: number; parks: number }

interface StationReach { version: number; segs: Map<number, number> }

export class Services {
  /** Drive-time reach of each station (seg -> seconds), rebuilt when the roads change. */
  private reach = new Map<number, StationReach>();
  /** Calls waiting for a vehicle: building id -> service. */
  private calls = new Map<number, Set<ServiceId>>();
  private stationCache: Building[] | null = null;
  /** Coverage per building id, refreshed each tick. */
  cov = new Map<number, Coverage>();
  /** Last burnt-down toast, so the player isn't spammed. */
  private lastToast = -Infinity;
  /** City-wide numbers for the UI. */
  stats = { sick: 0, untreated: 0, fires: 0, garbage: 0, crime: 0, pupils: 0, students: 0, burnt: 0 };

  constructor(private g: Game) {}

  get active() { return this.g.milestone >= PRESSURE_MILESTONE; }

  def(b: Building): ServiceDef | null {
    return b.svc && isServiceKind(b.kind) ? SERVICES[b.kind] : null;
  }

  stations(): Building[] {
    if (!this.stationCache) this.stationCache = this.g.buildings.list.filter((b) => b.svc);
    return this.stationCache;
  }

  /** Buildings were added or removed. */
  dirty() {
    this.stationCache = null;
  }

  /** A station came back (undo/redo): its counters may have drifted while it was gone, so count them afresh. */
  restored(b: Building) {
    if (!b.svc) return;
    const g = this.g;
    let busy = 0;
    const mine = (r?: { station: number; done?: boolean }) => !!r && r.station === b.id && !r.done;
    for (const v of g.traffic.vehicles) if (mine(v.trip.run)) busy++;
    for (const p of g.traffic.pending) if (mine(p.trip.run)) busy++;
    // every live leg (out, or heading home) holds one of its vehicles
    b.busy = busy;
    let users = 0;
    for (const c of g.people.citizens.values()) {
      if (c.school === b.id) users++;
      else if (c.kind === "service" && c.st === St.Away && c.at === b.id) users++;
    }
    b.users = users;
    this.dirty();
  }

  /** Someone sick is home here, waiting for an ambulance. */
  private sickAt(b: Building): boolean {
    for (const hh of this.g.people.hhAt.get(b.id) ?? []) for (const c of hh.members) if (c.sick && c.st === St.Home) return true;
    return false;
  }

  onBuildingRemoved(id: number) {
    this.reach.delete(id);
    this.calls.delete(id);
    this.cov.delete(id);
    this.stationCache = null;
  }

  /** Vehicles a station can run with the staff it has (a few staff run at least one). */
  fleet(b: Building): number {
    const d = this.def(b);
    if (!d || !d.vehicles || !b.access) return 0;
    const staff = this.g.people.workersAt(b.id);
    if (staff <= 0) return 0;
    return Math.max(1, Math.min(d.vehicles, Math.round(d.vehicles * Math.min(1, (staff / Math.max(1, b.cap)) * 1.25))));
  }

  /** Seg -> drive seconds from a station (cached per road-network version). */
  reachOf(b: Building): Map<number, number> {
    const d = this.def(b);
    if (!d || !b.access) return new Map();
    const v = this.g.net.version;
    let r = this.reach.get(b.id);
    if (!r || r.version !== v) {
      r = { version: v, segs: d.svc === "parks" ? new Map() : this.g.traffic.router.reach(b.access, d.range) };
      this.reach.set(b.id, r);
    }
    return r.segs;
  }

  /** How well a spot (a building's driveway, or a point for parks) is served by one station: 0..1. */
  private level(st: Building, d: ServiceDef, b: Building): number {
    if (d.svc === "parks") {
      const dd = dist(st.c, b.c);
      return dd < d.range ? 1 - (dd / d.range) * 0.7 : 0;
    }
    if (!b.access) return 0;
    const t = this.reachOf(st).get(b.access.seg);
    if (t === undefined) return 0;
    return 1 - (t / d.range) * 0.6;
  }

  /** Coverage of a building by each service (best station; schools: the elementary tier). */
  coverageOf(b: Building): Coverage {
    const c: Coverage = { garbage: 0, fire: 0, police: 0, health: 0, school: 0, parks: 0 };
    for (const st of this.stations()) {
      const d = this.def(st)!;
      if (st.built < 1 || st.abandoned) continue;
      if (d.svc === "school" && d.tier !== 0) continue;
      if (d.svc !== "parks" && !this.staffed(st)) continue;
      const l = this.level(st, d, b);
      if (l > c[d.svc]) c[d.svc] = l;
    }
    return c;
  }

  private staffed(st: Building): boolean {
    return this.g.people.workersAt(st.id) > 0;
  }

  /** A preview of what a station placed here would cover: seg -> 0..1 (for the placement tool). */
  previewReach(kind: ServiceKind, access: Building["access"]): Map<number, number> {
    const d = SERVICES[kind];
    const out = new Map<number, number>();
    if (!access || d.svc === "parks") return out;
    for (const [seg, t] of this.g.traffic.router.reach(access, d.range)) out.set(seg, 1 - (t / d.range) * 0.6);
    return out;
  }

  /** Coverage of every seg by one service (for the info view). */
  segCoverage(svc: ServiceId): Map<number, number> {
    const out = new Map<number, number>();
    for (const st of this.stations()) {
      const d = this.def(st)!;
      if (d.svc !== svc || d.svc === "parks" || (d.svc === "school" && d.tier !== 0)) continue;
      for (const [seg, t] of this.reachOf(st)) {
        const l = 1 - (t / d.range) * 0.6;
        if (l > (out.get(seg) ?? 0)) out.set(seg, l);
      }
    }
    return out;
  }

  // ------------------------------------------------------------------ simulation

  /** Every 1/8 game hour. */
  tick(span: number) {
    const g = this.g;
    const h = span / HOUR;
    const on = this.active;
    const rng = g.rng;
    const s = this.stats;
    s.fires = 0; s.garbage = 0; s.crime = 0;
    for (const b of [...g.buildings.list]) {
      if (b.svc) { this.stepStation(b, span); continue; }
      if (!b.zone || b.built < 1 || b.abandoned) continue;
      const c = this.coverageOf(b);
      this.cov.set(b.id, c);
      if (!on) continue;
      if (!b.access) {
        // cut off from the roads: no calls can be answered, but a fire still runs its course
        if (b.fire && g.time - b.fire > FIRE_BURN) this.burnDown(b);
        continue;
      }
      const grp = ZONE_GROUP[b.zone];
      const people = grp === "res" ? g.people.householdsIn(b.id) : g.people.workersAt(b.id);
      if (people <= 0) continue;
      // garbage: every household and workplace fills bins
      b.garbage = Math.min(200, (b.garbage ?? 0) + people * (grp === "res" ? 0.6 : grp === "ind" ? 0.15 : 0.12) * h);
      if (b.garbage >= GARBAGE_CALL) this.call(b, "garbage");
      if (b.garbage >= GARBAGE_BAD) s.garbage++;
      // crime: patrols in the area keep it down
      const cr = people * (grp === "res" ? 0.22 : 0.1) * (1 - 0.85 * c.police) * h;
      b.crime = Math.min(100, (b.crime ?? 0) + cr);
      if (b.crime >= CRIME_CALL) this.call(b, "police");
      if (b.crime >= CRIME_BAD) s.crime++;
      // fires: rare, likelier in industry, much rarer where engines are close
      if (b.fire) {
        s.fires++;
        this.call(b, "fire");
        if (g.time - b.fire > FIRE_BURN) this.burnDown(b);
      } else if (rng() < (grp === "ind" ? 0.0012 : 0.0004) * (1 - 0.8 * c.fire) * h) {
        b.fire = g.time;
      }
    }
    this.sweep();
    this.dispatch();
  }

  /** Garbage trucks empty the bins of every building on the streets they drive along, on the way out and back. */
  private sweep() {
    const g = this.g;
    let bySeg: Map<number, Building[]> | null = null;
    for (const v of g.traffic.vehicles as Vehicle[]) {
      const run = v.trip.run;
      if (!run || run.svc !== "garbage" || run.done || (run.load ?? 0) >= TRUCK_LOAD) continue;
      if (!bySeg) {
        bySeg = new Map();
        for (const b of g.buildings.list) {
          if (!b.access || b.svc || (b.garbage ?? 0) < SWEEP_MIN) continue;
          const l = bySeg.get(b.access.seg);
          if (l) l.push(b); else bySeg.set(b.access.seg, [b]);
        }
      }
      let load = run.load ?? 0;
      const upTo = Math.min(v.ri, v.route.length - 1);
      for (let i = run.swept ?? 0; i <= upTo && load < TRUCK_LOAD; i++) {
        for (const b of bySeg.get(dkSeg(v.route[i])) ?? []) {
          if (!b.garbage) continue;
          load += b.garbage;
          b.garbage = 0;
          if (load >= TRUCK_LOAD) break;
        }
      }
      run.swept = upTo + 1;
      run.load = load;
    }
  }

  private stepStation(b: Building, span: number) {
    const d = this.def(b);
    if (!d) return;
    b.visits *= Math.exp(-span / (HOUR * 6));
    let problem: string | null = null;
    if (!b.access) problem = "No road access";
    else if (d.cap === 0 && d.vehicles === 0) problem = null;
    else if (this.g.people.workersAt(b.id) < b.cap * 0.5) problem = this.staffed(b) ? "Short of staff" : "No staff yet";
    if (d.vehicles && this.fleet(b) > 0 && (b.busy ?? 0) >= this.fleet(b)) problem ??= "All vehicles out";
    b.problem = problem;
  }

  private call(b: Building, svc: ServiceId) {
    let set = this.calls.get(b.id);
    if (!set) this.calls.set(b.id, (set = new Set()));
    set.add(svc);
  }

  /** Send vehicles to waiting calls: the closest covering station with one free. */
  private dispatch() {
    const g = this.g;
    for (const [id, set] of this.calls) {
      const b = g.buildings.byId.get(id);
      if (!b || !b.access) { this.calls.delete(id); continue; }
      for (const svc of [...set]) {
        if (svc === "garbage" && (b.garbage ?? 0) < GARBAGE_CALL) { set.delete(svc); continue; }
        if (svc === "police" && (b.crime ?? 0) < CRIME_CALL) { set.delete(svc); continue; }
        if (svc === "fire" && !b.fire) { set.delete(svc); continue; }
        if (svc === "health" && !this.sickAt(b)) { set.delete(svc); continue; }
        if (this.enRoute(b, svc)) { set.delete(svc); continue; }
        const st = this.closest(b, svc);
        if (!st) continue; // stays waiting until a vehicle is free
        if (this.send(st, b, svc)) set.delete(svc);
      }
      if (!set.size) this.calls.delete(id);
    }
  }

  /** Calls already answered (a vehicle is on its way). */
  private answered = new Map<number, Set<ServiceId>>();
  private enRoute(b: Building, svc: ServiceId) {
    return this.answered.get(b.id)?.has(svc) ?? false;
  }

  private closest(b: Building, svc: ServiceId): Building | null {
    let best: Building | null = null, bt = Infinity;
    for (const st of this.stations()) {
      const d = this.def(st)!;
      if (d.svc !== svc || !st.access || st.built < 1) continue;
      if ((st.busy ?? 0) >= this.fleet(st)) continue;
      if (d.svc === "health" && (st.users ?? 0) + (st.busy ?? 0) >= d.cap) continue;
      const t = this.reachOf(st).get(b.access!.seg);
      if (t !== undefined && t < bt) { bt = t; best = st; }
    }
    return best;
  }

  private send(st: Building, to: Building, svc: ServiceId, patient?: number): boolean {
    const g = this.g;
    if (!st.access || !to.access || !g.connected(st.access.seg, to.access.seg)) return false;
    st.busy = (st.busy ?? 0) + 1;
    let set = this.answered.get(to.id);
    if (!set) this.answered.set(to.id, (set = new Set()));
    set.add(svc);
    g.traffic.request({
      from: st.access, fromSide: st.side, to: to.access, toSide: to.side,
      trip: { kind: "service", from: st.id, to: to.id, resident: -1, startT: g.time, freeFlow: 0, run: { svc, station: st.id, target: to.id, leg: "out", patient } },
      truck: svc === "garbage" || svc === "fire", tries: 0, wait: 0,
    });
    return true;
  }

  /** A garbage truck on its round with room left: the nearest waiting bin its station covers, if one is close. */
  private nextStop(from: Building, st: Building, load: number): boolean {
    const g = this.g;
    if (!from.access) return false;
    const reach = this.reachOf(st);
    let best: Building | null = null, bd = ROUND_HOP;
    for (const [id, set] of this.calls) {
      if (!set.has("garbage")) continue;
      const o = g.buildings.byId.get(id);
      if (!o || !o.access || (o.garbage ?? 0) < GARBAGE_CALL || this.enRoute(o, "garbage") || !reach.has(o.access.seg)) continue;
      const d = dist(o.c, from.c);
      if (d < bd) { bd = d; best = o; }
    }
    if (!best || !g.connected(from.access.seg, best.access!.seg)) return false;
    this.calls.get(best.id)!.delete("garbage");
    let set = this.answered.get(best.id);
    if (!set) this.answered.set(best.id, (set = new Set()));
    set.add("garbage");
    g.traffic.request({
      from: from.access, fromSide: from.side, to: best.access!, toSide: best.side,
      trip: { kind: "service", from: from.id, to: best.id, resident: -1, startT: g.time, freeFlow: 0, run: { svc: "garbage", station: st.id, target: best.id, leg: "out", load } },
      truck: true, tries: 0, wait: 0,
    });
    return true;
  }

  private sendBack(from: Building, st: Building, svc: ServiceId, patient?: number, load?: number) {
    const g = this.g;
    if (!from.access || !st.access) { this.back(st, patient); return; }
    g.traffic.request({
      from: from.access, fromSide: from.side, to: st.access, toSide: st.side,
      trip: { kind: "service", from: from.id, to: st.id, resident: -1, startT: g.time, freeFlow: 0, run: { svc, station: st.id, target: from.id, leg: "back", patient, load } },
      truck: svc === "garbage" || svc === "fire", tries: 0, wait: 0,
    });
  }

  /** A vehicle is home: free again; a patient is admitted. */
  private back(st: Building | undefined, patient?: number) {
    if (st) st.busy = Math.max(0, (st.busy ?? 0) - 1);
    if (patient !== undefined) {
      const c = this.g.people.citizens.get(patient);
      if (c) this.admit(c, st);
    }
  }

  /** A service vehicle reached the end of a leg. */
  onArrive(v: Vehicle) {
    const run = v.trip.run!;
    if (run.done) return;
    run.done = true;
    const g = this.g;
    const st = g.buildings.byId.get(run.station);
    const svc = run.svc as ServiceId;
    if (run.leg === "back") { this.back(st, run.patient); return; }
    this.answered.get(run.target)?.delete(svc);
    const b = g.buildings.byId.get(run.target);
    if (!b) { if (st) st.busy = Math.max(0, (st.busy ?? 0) - 1); return; }
    let patient: number | undefined;
    let load: number | undefined;
    if (svc === "garbage") {
      // the truck works the street: every bin within a short walk of the stop
      load = run.load ?? 0;
      for (const o of g.buildings.list) {
        if (load >= TRUCK_LOAD) break;
        if (!o.garbage || dist(o.c, b.c) > 110) continue;
        load += o.garbage;
        o.garbage = 0;
      }
      // room left: on to the next street with full bins (as CS trucks do), home only when full or done
      if (st && load < TRUCK_LOAD * 0.9 && this.nextStop(b, st, load)) return;
    } else if (svc === "police") {
      for (const o of g.buildings.list) {
        if (!o.crime) continue;
        const d = dist(o.c, b.c);
        if (d < 150) o.crime *= d < 40 ? 0 : 0.35;
      }
    } else if (svc === "fire") {
      b.fire = 0;
    } else if (svc === "health" && st) {
      // only with a clinic to take them to (it may have been demolished on the way)
      patient = this.pickUp(b);
    }
    if (st) this.sendBack(b, st, svc, patient, load);
  }

  /** A vehicle couldn't get there (or back). */
  onFail(trip: Trip) {
    const run = trip.run!;
    if (run.done) return;
    run.done = true;
    const st = this.g.buildings.byId.get(run.station);
    if (run.leg === "out") {
      this.answered.get(run.target)?.delete(run.svc as ServiceId);
      if (st) st.busy = Math.max(0, (st.busy ?? 0) - 1);
      // the patient is still waiting at home
      return;
    }
    this.back(st, run.patient);
  }

  // ------------------------------------------------------------------ fires

  private burnDown(b: Building) {
    const g = this.g;
    this.stats.burnt++;
    b.fire = 0;
    if (g.time - this.lastToast > DAY * 0.5) {
      this.lastToast = g.time;
      g.toast(this.hasService("fire") ? "A building burnt down: the fire engines couldn't get there in time" : "A building burnt down. Build a fire station (Services menu)");
    }
    g.burnDown(b);
  }

  hasService(svc: ServiceId): boolean {
    return this.stations().some((s) => this.def(s)!.svc === svc);
  }

  // ------------------------------------------------------------------ healthcare

  /** Every game hour: some residents fall ill; untreated ones eventually move away with their family. */
  hourly() {
    const g = this.g;
    const people = g.people;
    const rng = g.rng;
    let sick = 0, untreated = 0, pupils = 0, students = 0;
    for (const c of people.citizens.values()) {
      if (c.school >= 0) { if (c.age === Age.Child) pupils++; else students++; }
      if (c.sick) {
        sick++;
        if (c.st === St.Home && g.time - c.sick > SICK_LEAVE) {
          const hh = people.households.get(c.hh);
          if (hh) { people.moveOut(hh); continue; }
        }
        if (c.st === St.Home) {
          untreated++;
          const home = g.buildings.byId.get(c.home);
          if (home) this.call(home, "health");
        }
        continue;
      }
      if (!this.active || c.home < 0 || c.st !== St.Home) continue;
      const home = g.buildings.byId.get(c.home);
      if (!home) continue;
      const cov = this.cov.get(home.id)?.health ?? 0;
      const p = 0.0007 * (c.age === Age.Senior ? 2.5 : 1) * (1 - 0.35 * cov);
      if (rng() < p) { c.sick = g.time; sick++; untreated++; this.call(home, "health"); }
    }
    this.stats.sick = sick;
    this.stats.untreated = untreated;
    this.stats.pupils = pupils;
    this.stats.students = students;
  }

  /** The ambulance at a home takes one sick resident who is in. */
  private pickUp(home: Building): number | undefined {
    const ppl = this.g.people;
    for (const hh of ppl.hhAt.get(home.id) ?? []) {
      for (const c of hh.members) {
        if (c.sick && c.st === St.Home) {
          ppl.hold(c);
          return c.id;
        }
      }
    }
    return undefined;
  }

  private admit(c: Citizen, st: Building | undefined) {
    if (!st) { this.g.people.release(c, null, 0); return; }
    st.users = (st.users ?? 0) + 1;
    this.g.people.release(c, st, TREAT);
  }

  /** A patient leaves the clinic. */
  discharged(st: Building | undefined) {
    if (st) st.users = Math.max(0, (st.users ?? 0) - 1);
  }

  // ------------------------------------------------------------------ education

  /** A school of `tier` with a free seat covering the home, closest first. */
  schoolFor(home: Building, tier: 0 | 1 | 2): Building | null {
    if (!home.access) return null;
    let best: Building | null = null, bt = Infinity;
    for (const st of this.stations()) {
      const d = this.def(st)!;
      if (d.svc !== "school" || d.tier !== tier || st.built < 1 || !st.access || !this.staffed(st)) continue;
      if ((st.users ?? 0) >= d.cap) continue;
      const t = this.reachOf(st).get(home.access.seg);
      if (t !== undefined && t < bt) { bt = t; best = st; }
    }
    return best;
  }

  studyDays(st: Building): number {
    const d = this.def(st);
    return d?.tier ? STUDY_DAYS[d.tier] : Infinity;
  }

  // ------------------------------------------------------------------ effects

  /** Land value from services: coverage raises it, garbage and crime lower it. */
  landValueOf(b: Building): number {
    const c = this.cov.get(b.id);
    let lv = 0;
    if (c) lv += c.health * 4 + c.police * 3 + c.fire * 3 + c.school * 4 + c.parks * 9 + c.garbage * 2;
    if ((b.garbage ?? 0) > GARBAGE_BAD) lv -= Math.min(12, ((b.garbage ?? 0) - GARBAGE_BAD) / 6);
    if ((b.crime ?? 0) > CRIME_BAD) lv -= Math.min(10, ((b.crime ?? 0) - CRIME_BAD) / 5);
    return lv;
  }

  /** How content a home's residents are with their services (0..1); low for long means they leave. */
  happiness(b: Building): number {
    const c = this.cov.get(b.id) ?? { garbage: 0, fire: 0, police: 0, health: 0, school: 0, parks: 0 };
    let h = 0.56 + c.health * 0.1 + c.police * 0.07 + c.fire * 0.06 + c.school * 0.06 + c.parks * 0.08 + c.garbage * 0.03;
    const gb = b.garbage ?? 0, cr = b.crime ?? 0;
    if (gb > GARBAGE_BAD) h -= Math.min(0.32, (gb - GARBAGE_BAD) / 160);
    if (cr > CRIME_BAD) h -= Math.min(0.26, (cr - CRIME_BAD) / 140);
    if (b.fire) h -= 0.3;
    return Math.max(0, Math.min(1, h));
  }

  /** The most pressing service problem at a building, for its icon and the inspector. */
  problemOf(b: Building): string | null {
    if (b.fire) return "On fire!";
    if ((b.garbage ?? 0) > GARBAGE_BAD) return "Garbage piling up";
    if ((b.crime ?? 0) > CRIME_BAD) return "High crime";
    if (b.zone && ZONE_GROUP[b.zone] === "res") {
      for (const hh of this.g.people.hhAt.get(b.id) ?? []) for (const c of hh.members) if (c.sick && c.st === St.Home) return "Sick resident waiting for an ambulance";
    }
    return null;
  }

  /** Upkeep of every station this hour. */
  upkeep(): number {
    let u = 0;
    for (const st of this.stations()) u += this.def(st)!.upkeep;
    return u;
  }

  /** Drop all transient state (after loading a save: no vehicles are on the road). */
  reset() {
    this.calls.clear();
    this.answered.clear();
    this.reach.clear();
    this.stationCache = null;
    for (const b of this.g.buildings.list) { b.busy = 0; if (b.svc) b.users = 0; }
  }
}

/** Display name of a service kind. */
export const serviceName = (k: ServiceKind) => BUILDING_TYPES[k].name;
