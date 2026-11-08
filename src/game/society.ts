// Every resident is simulated: households move into homes that grow on zoned land, adults find jobs by commute
// distance, and everyone keeps a daily schedule: staggered work shifts give
// morning and evening rush hours, and shopping and leisure trips fill the rest of the day. Each trip is a car on
// the player's roads; in big cities one car can stand for several trips (`tripScale`), the rest resolve with an
// estimated travel time.

import { dist, type V2 } from "../core/math";
import type { Trip, TripKind, Vehicle } from "../sim/traffic";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP } from "./growables";
import { MOTOR_MAX } from "./towns";

/** Sim seconds per game hour; the clock starts at 06:00 on day 1. */
export const HOUR = 40;
export const DAY = 24 * HOUR;
export const START_HOUR = 6;

export const enum Age { Child = 0, Adult = 1, Senior = 2 }
export const enum St { Home = 0, Travel = 1, Away = 2, Gone = 3 }

export interface Citizen {
  id: number;
  hh: number; // household id
  home: number; // building id
  age: Age;
  job: number; // building id, -1 = none
  shift: number; // hour the shift starts
  st: St;
  at: number; // building id while away (or heading to)
  kind: TripKind;
  next: number; // sim time of the next decision; Infinity = none
  commute: number; // EWMA seconds, -1 = unknown
  tStart: number; // sim time the current trip started
  jobless: number; // sim time they became unemployed (adults)
}

export interface Household {
  id: number;
  home: number;
  members: Citizen[];
  since: number;
}

class Heap {
  t: number[] = [];
  id: number[] = [];
  push(t: number, id: number) {
    const T = this.t, I = this.id;
    T.push(t); I.push(id);
    let i = T.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (T[j] <= T[i]) break;
      [T[i], T[j]] = [T[j], T[i]]; [I[i], I[j]] = [I[j], I[i]];
      i = j;
    }
  }
  get size() { return this.t.length; }
  peek() { return this.t[0]; }
  pop(): number {
    const T = this.t, I = this.id;
    const top = I[0];
    const lt = T.pop()!, li = I.pop()!;
    if (T.length) {
      T[0] = lt; I[0] = li;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < T.length && T[l] < T[m]) m = l;
        if (r < T.length && T[r] < T[m]) m = r;
        if (m === i) break;
        [T[i], T[m]] = [T[m], T[i]]; [I[i], I[m]] = [I[m], I[i]];
        i = m;
      }
    }
    return top;
  }
  clear() { this.t = []; this.id = []; }
}

export interface PeopleStats {
  population: number;
  households: number;
  adults: number;
  children: number;
  seniors: number;
  workers: number; // adults who want work
  employed: number;
  unemployed: number;
}

export class Society {
  citizens = new Map<number, Citizen>();
  households = new Map<number, Household>();
  private q = new Heap();
  private nextC = 1;
  private nextH = 1;
  /** Workers per workplace; residents (households) per home. */
  staff = new Map<number, number>();
  hhAt = new Map<number, Household[]>();
  stats: PeopleStats = this.emptyStats();
  /** Trips that were real cars, and all trips, in the last game hour window (for the statistics panel). */
  carTrips = 0;
  busTrips = 0;
  allTrips = 0;
  private matchT = 0;

  constructor(private g: Game) {}

  private emptyStats(): PeopleStats {
    return { population: 0, households: 0, adults: 0, children: 0, seniors: 0, workers: 0, employed: 0, unemployed: 0 };
  }

  get now() { return this.g.time; }
  hourOf(t = this.now) { return ((t / HOUR + START_HOUR) % 24 + 24) % 24; }
  dayOf(t = this.now) { return Math.floor((t / HOUR + START_HOUR) / 24) + 1; }
  /** Sim time of the next time the clock shows hour h (strictly after now + minGap). */
  nextAt(h: number, minGap = 0): number {
    const t0 = this.now + minGap;
    const cur = this.hourOf(t0);
    let dh = (h - cur + 24) % 24;
    if (dh < 1e-6) dh = 24;
    return t0 + dh * HOUR;
  }

  private schedule(c: Citizen, t: number) {
    c.next = t;
    if (t < Infinity) this.q.push(t, c.id);
  }

  // ------------------------------------------------------------------ households

  /** A household moves into `home` (it appears there at once). */
  moveIn(home: Building): Household {
    const rng = this.g.rng;
    const hh: Household = { id: this.nextH++, home: home.id, members: [], since: this.now };
    const high = home.zone === "resHigh" || home.zone === "resMed" || home.zone === "resTower";
    const r = rng();
    const adults = r < 0.3 ? 1 : 2;
    const seniorHh = rng() < 0.14;
    const kids = seniorHh ? 0 : rng() < (high ? 0.35 : 0.55) ? 1 + (rng() < 0.45 ? 1 : 0) : 0;
    for (let i = 0; i < adults; i++) hh.members.push(this.newCitizen(hh, home.id, seniorHh ? Age.Senior : Age.Adult));
    for (let i = 0; i < kids; i++) hh.members.push(this.newCitizen(hh, home.id, Age.Child));
    this.households.set(hh.id, hh);
    let L = this.hhAt.get(home.id);
    if (!L) this.hhAt.set(home.id, (L = []));
    L.push(hh);
    for (const m of hh.members) this.arriveHome(m);
    return hh;
  }

  private newCitizen(hh: Household, home: number, age: Age): Citizen {
    const rng = this.g.rng;
    const c: Citizen = {
      id: this.nextC++, hh: hh.id, home, age,
      job: -1, shift: pickShift(rng), st: St.Home, at: -1, kind: "home", next: Infinity, commute: -1, tStart: 0, jobless: this.now,
    };
    this.citizens.set(c.id, c);
    return c;
  }

  /** The household leaves the region (home demolished, or unhappy). */
  moveOut(hh: Household) {
    for (const c of hh.members) this.dropCitizen(c);
    this.households.delete(hh.id);
    const L = this.hhAt.get(hh.home);
    if (L) {
      const i = L.indexOf(hh);
      if (i >= 0) L.splice(i, 1);
      if (!L.length) this.hhAt.delete(hh.home);
    }
  }

  private dropCitizen(c: Citizen) {
    if (c.job >= 0) this.leaveJob(c);
    c.st = St.Gone;
    c.next = Infinity;
    this.citizens.delete(c.id);
  }

  private leaveJob(c: Citizen) {
    const n = (this.staff.get(c.job) ?? 1) - 1;
    if (n > 0) this.staff.set(c.job, n);
    else this.staff.delete(c.job);
    c.job = -1;
    c.jobless = this.now;
  }

  /** A building is gone: its households leave, its workers lose their jobs, visitors go home. */
  onBuildingRemoved(id: number) {
    for (const hh of [...(this.hhAt.get(id) ?? [])]) this.moveOut(hh);
    for (const c of [...this.citizens.values()]) {
      if (c.job === id) this.leaveJob(c);
      if (c.st === St.Away && c.at === id && c.home !== id) this.goHome(c);
    }
  }

  householdsIn(id: number): number {
    return this.hhAt.get(id)?.length ?? 0;
  }

  workersAt(id: number): number {
    return this.staff.get(id) ?? 0;
  }

  // ------------------------------------------------------------------ jobs

  /**
   * Match job seekers to open jobs, closest first (with some randomness). Jobs nobody local can fill stay empty. The
   * company's plants come first: while one is short-handed, people working in the towns' shops move over to it.
   */
  matchJobs() {
    const g = this.g;
    const open: { b: Building; free: number }[] = [];
    for (const b of g.buildings.list) {
      if (!b.access || b.built < 1 || b.abandoned) continue;
      if (b.zone ? ZONE_GROUP[b.zone] === "res" : !b.placed) continue;
      const free = b.cap - this.workersAt(b.id);
      if (free > 0) open.push({ b, free });
    }
    if (!open.length) return;
    // the player's own buildings are staffed first (they keep the company running)
    open.sort((a, b) => (b.b.placed ? 1 : 0) - (a.b.placed ? 1 : 0));
    let placedOpen = 0;
    for (const o of open) if (o.b.placed) placedOpen += o.free;
    const rng = g.rng;
    let budget = 400;
    for (const c of this.citizens.values()) {
      if (budget <= 0) break;
      if (c.age !== Age.Adult) continue;
      if (c.job >= 0) {
        // (a town job is given up for one at the company's plants, at a quarter-hour's notice)
        if (placedOpen <= 0 || c.st !== St.Home || g.buildings.byId.get(c.job)?.placed) continue;
        const home = g.buildings.byId.get(c.home);
        let to: (typeof open)[number] | null = null;
        for (const o of open) {
          if (!o.b.placed || o.free <= 0 || !home?.access || !g.connected(home.access.seg, o.b.access!.seg)) continue;
          if (!to || o.free / o.b.cap > to.free / to.b.cap) to = o;
        }
        if (!to) continue;
        budget--;
        this.leaveJob(c);
        this.takeJob(c, to.b);
        to.free--;
        placedOpen--;
        continue;
      }
      const home = g.buildings.byId.get(c.home);
      if (!home?.access) continue;
      budget--;
      let best: (typeof open)[number] | null = null, bs = Infinity;
      for (let k = 0; k < Math.min(open.length, 48); k++) {
        const o = open.length <= 48 ? open[k] : open[(rng() * open.length) | 0];
        if (o.free <= 0) continue;
        if (!g.connected(home.access.seg, o.b.access!.seg)) continue;
        // (the company's plants first, the most short-handed of them first, so every plant gets a crew)
        const s = o.b.placed ? -1e6 - (o.free / o.b.cap) * 1e5 + dist(home.c, o.b.c) : dist(home.c, o.b.c) * (0.8 + rng() * 0.4);
        if (s < bs) { bs = s; best = o; }
      }
      if (!best) continue;
      this.takeJob(c, best.b);
      best.free--;
      if (best.b.placed) placedOpen--;
    }
  }

  private takeJob(c: Citizen, b: Building) {
    c.job = b.id;
    this.staff.set(b.id, this.workersAt(b.id) + 1);
    // industry (and the company's own buildings) runs shifts round the clock; shops open late
    const grp = b.zone ? ZONE_GROUP[b.zone] : "plant";
    const r = this.g.rng();
    c.shift = grp === "com" ? (r < 0.6 ? 9 : 14) : r < 0.55 ? 7 : r < 0.85 ? 15 : 23;
    if (c.st === St.Home) this.schedule(c, Math.min(c.next, this.leaveFor(c)));
  }

  /** When to leave home to start the next shift on time. */
  private leaveFor(c: Citizen): number {
    const est = c.commute > 0 ? c.commute : 60;
    const lead = Math.min(est / HOUR + 0.25, 4);
    return this.nextAt((((c.shift - lead) % 24) + 24) % 24, 30);
  }

  // ------------------------------------------------------------------ schedule

  step() {
    const now = this.now;
    let guard = 2000;
    while (this.q.size && this.q.peek() <= now && guard-- > 0) {
      const t = this.q.peek();
      const id = this.q.pop();
      const c = this.citizens.get(id);
      if (!c || c.next !== t) continue; // stale entry
      c.next = Infinity;
      this.decide(c);
    }
    this.matchT -= this.g.dt;
    if (this.matchT <= 0) { this.matchT = HOUR / 4; this.matchJobs(); this.refreshStats(); }
  }

  private decide(c: Citizen) {
    const g = this.g;
    if (c.st === St.Travel) { this.arrive(c); return; } // a virtual trip reached its end
    const h = this.hourOf();
    const rng = g.rng;
    if (c.st === St.Away) {
      // at work until the shift ends; shoppers browse a while, then maybe one more stop
      if (c.kind === "work" && c.job >= 0 && c.at === c.job) {
        // a stop at the shops on the way home now and then
        const job = g.buildings.byId.get(c.job);
        const shop = job && rng() < 0.25 ? this.pickShop(job) : undefined;
        if (job && shop) { this.travel(c, job, shop, "shop"); return; }
        this.goHome(c);
        return;
      }
      if ((c.kind === "shop" || c.kind === "leisure") && rng() < 0.18) {
        const from = g.buildings.byId.get(c.at);
        const to = from && this.pickShop(from);
        if (from && to && to.id !== from.id) { this.travel(c, from, to, "shop"); return; }
      }
      this.goHome(c);
      return;
    }
    // at home
    const home = g.buildings.byId.get(c.home);
    if (!home) return;
    // children stay home (they make no trips of their own)
    if (c.age === Age.Child) return;
    if (c.job >= 0) {
      const job = g.buildings.byId.get(c.job);
      if (!job) { this.leaveJob(c); this.scheduleFree(c); return; }
      const start = c.shift;
      const late = (((h - start) % 24) + 24) % 24; // hours since the shift began (0..24)
      const early = 24 - late; // hours until it begins
      const est = (c.commute > 0 ? c.commute : 60) / HOUR;
      if (early <= est + 1.5 || late < 2) {
        if (job.access && job.built >= 1 && !job.abandoned) { this.travel(c, home, job, "work"); return; }
      }
      // an evening out on the way through the day
      if (h >= 16 && h < 21 && rng() < 0.4) {
        const shop = this.pickShop(home);
        if (shop) { this.travel(c, home, shop, "leisure"); return; }
      }
      // look again in a while (evening outings), never later than the time to leave for work
      this.schedule(c, Math.min(this.leaveFor(c), this.now + HOUR * (1.5 + rng() * 2.5)));
      return;
    }
    // no job: errands in the daytime
    if (h >= 9 && h < 19 && rng() < 0.55) {
      const senior = c.age === Age.Senior;
      const shop = this.pickShop(home);
      if (shop) { this.travel(c, home, shop, senior ? "leisure" : "shop"); return; }
    }
    this.scheduleFree(c);
  }

  /** Someone with no job to go to: out again later today if the day has hours left, else tomorrow. */
  private scheduleFree(c: Citizen) {
    const rng = this.g.rng;
    const t = this.now + HOUR * (1.5 + rng() * 3);
    const h = this.hourOf(t);
    this.schedule(c, h >= 9 && h < 19 ? t : this.nextAt(9 + rng() * 9, HOUR * 2));
  }

  private goHome(c: Citizen) {
    const g = this.g;
    const from = c.at >= 0 ? g.buildings.byId.get(c.at) ?? null : null;
    const home = g.buildings.byId.get(c.home);
    if (!home) return;
    if (!from) { this.arriveHome(c); return; }
    this.travel(c, from, home, "home");
  }

  /** Commercial nearby, weighted to the closest few (bigger shops pull from further). */
  pickShop(near: Building): Building | undefined {
    const g = this.g;
    const shops = g.shops;
    if (!shops.length) return undefined;
    const rng = g.rng;
    let best: Building | undefined, bs = Infinity;
    for (let k = 0; k < Math.min(shops.length, 24); k++) {
      const b = shops.length <= 24 ? shops[k] : shops[(rng() * shops.length) | 0];
      if (!b.access || b.built < 1 || b.abandoned) continue;
      if (near.access && !g.connected(near.access.seg, b.access.seg)) continue;
      const pull = b.zone === "comHigh" || b.zone === "comTower" ? 1.8 : 1;
      const s = (dist(b.c, near.c) / pull) * (0.6 + rng() * 0.8);
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  }

  // ------------------------------------------------------------------ trips

  /** Start a trip. */
  private travel(c: Citizen, from: Building, to: Building, kind: TripKind) {
    const g = this.g;
    const a = from.access;
    const b = to.access;
    if (!a || !b || !g.connected(a.seg, b.seg)) {
      // no way there: try again later
      c.st = from.id === c.home ? St.Home : St.Away;
      this.schedule(c, this.now + HOUR * (1 + g.rng()));
      g.noRoute(to);
      return;
    }
    c.st = St.Travel;
    c.kind = kind;
    c.at = to.id;
    c.tStart = this.now;
    this.allTrips++;
    const fromP = from.c, toP = to.c;
    // a town the company has sold cars to drives more: further before they walk, more of their trips as real cars
    const home = g.buildings.byId.get(c.home);
    const motor = g.towns.motorOf(home?.town);
    // round the corner to work or the shops: people walk
    const walk = dist(fromP, toP) < walkReach(motor);
    // a bus that goes their way, about as quick as driving: they take it (and leave the car at home)
    if (!walk && g.transit.lines.size) {
      // (about one household in four has no car; more in flats)
      const carless = c.hh >= 0 && (c.hh * 7919) % 100 < (home?.zone === "resHigh" || home?.zone === "resMed" || home?.zone === "resTower" ? 40 : 22);
      const bus = g.transit.plan(fromP, toP, carless);
      if (bus && g.rng() < Math.min(0.95, bus.p)) {
        this.busTrips++;
        g.transit.wait(c.id, bus);
        c.next = Infinity;
        return;
      }
    }
    const real = !walk && g.rng() < carOdds(g.tripScale, motor);
    if (real) {
      this.carTrips++;
      // (the households the company's cars went to drive them: motor / MOTOR_MAX is the share of households with one,
      // and the same households keep theirs, picked by a hash of the household)
      const built = motor > 0 && c.hh >= 0 && ((Math.imul(c.hh + 1, 2654435761) >>> 0) % 1000) / 1000 < motor / MOTOR_MAX;
      g.traffic.request({
        from: a, fromSide: from.side, to: b, toSide: to.side,
        trip: { kind, from: from.id, to: to.id, resident: c.id, startT: this.now, freeFlow: 0, ...(built ? { motor: true } : {}) },
        truck: false, tries: 0, wait: 0,
      });
      c.next = Infinity;
    } else {
      this.schedule(c, this.now + estTime(fromP, toP));
    }
  }

  /** A bus rider got off (or gave up on the bus): they get where they were going `dt` from now. */
  resume(id: number, dt: number) {
    const c = this.citizens.get(id);
    if (!c || c.st !== St.Travel) return;
    this.schedule(c, this.now + Math.max(1, dt));
  }

  /** A car reached its destination. */
  onArrive(v: Vehicle) {
    const c = this.citizens.get(v.trip.resident);
    if (!c || c.st !== St.Travel) return;
    this.arrive(c);
  }

  /** A car couldn't find a way. */
  onFail(trip: Trip) {
    const c = this.citizens.get(trip.resident);
    if (!c || c.st !== St.Travel) return;
    // give up and resolve the trip as a slow one
    this.schedule(c, this.now + 30);
  }

  private arrive(c: Citizen) {
    const g = this.g;
    const dur = this.now - c.tStart;
    const kind = c.kind;
    if (kind === "home") { this.arriveHome(c); return; }
    const to = g.buildings.byId.get(c.at);
    if (!to) { this.goHome(c); return; }
    c.st = St.Away;
    if (kind === "work") {
      c.commute = c.commute < 0 ? dur : c.commute + (dur - c.commute) * 0.3;
      // stay until 8 hours after the shift started
      const sinceStart = (((this.hourOf() - c.shift) % 24) + 24) % 24;
      const left = sinceStart < 10 ? 8 - sinceStart : 8;
      this.schedule(c, this.now + Math.max(0.5, left) * HOUR);
    } else {
      to.visits += 1;
      to.custToday = (to.custToday ?? 0) + 1;
      if (!to.placed) g.sale(to);
      this.schedule(c, this.now + HOUR * (0.6 + g.rng() * 1.4));
    }
  }

  private arriveHome(c: Citizen) {
    c.st = St.Home;
    c.at = c.home;
    c.kind = "home";
    if (c.job >= 0) this.schedule(c, Math.min(this.leaveFor(c), this.now + HOUR * (0.5 + this.g.rng() * 2)));
    else if (c.age !== Age.Child) this.scheduleFree(c);
  }

  // ------------------------------------------------------------------ statistics

  refreshStats() {
    const s = this.emptyStats();
    for (const hh of this.households.values()) {
      s.households++;
      for (const c of hh.members) {
        s.population++;
        if (c.age === Age.Child) s.children++;
        else if (c.age === Age.Senior) s.seniors++;
        else {
          s.adults++;
          s.workers++;
          if (c.job >= 0) s.employed++;
          else s.unemployed++;
        }
      }
    }
    this.stats = s;
  }

  // ------------------------------------------------------------------ save / load

  toJSON() {
    const hhs = [...this.households.values()].map((h) => ({
      id: h.id, home: h.home, since: h.since,
      m: h.members.map((c) => [c.id, c.age, c.job, c.shift]),
    }));
    return { hhs, nextC: this.nextC, nextH: this.nextH };
  }

  load(d: ReturnType<Society["toJSON"]>) {
    this.citizens.clear(); this.households.clear(); this.staff.clear(); this.hhAt.clear(); this.q.clear();
    const rng = this.g.rng;
    for (const h of d.hhs) {
      const hh: Household = { id: h.id, home: h.home, members: [], since: h.since };
      for (const [id, age, job, shift] of h.m) {
        const c: Citizen = { id, hh: h.id, home: h.home, age: age as Age, job: -1, shift, st: St.Home, at: h.home, kind: "home", next: Infinity, commute: -1, tStart: 0, jobless: 0 };
        this.citizens.set(id, c);
        hh.members.push(c);
        if (job >= 0 && this.g.buildings.byId.has(job)) { c.job = job; this.staff.set(job, this.workersAt(job) + 1); }
      }
      this.households.set(hh.id, hh);
      let L = this.hhAt.get(hh.home);
      if (!L) this.hhAt.set(hh.home, (L = []));
      L.push(hh);
      for (const c of hh.members) {
        if (c.age === Age.Child) continue;
        if (c.job >= 0) this.schedule(c, this.now + rng() * HOUR * 3);
        else this.scheduleFree(c);
      }
    }
    this.nextC = d.nextC;
    this.nextH = d.nextH;
    this.refreshStats();
  }
}

/**
 * Trips shorter than this (straight line, m) between two buildings are walked rather than driven. (Short: the towns
 * are small, and a town's own cars going about its streets are much of what makes it look alive.)
 */
export const WALK = 200;

/**
 * How far (m) people walk rather than drive: WALK, and down to half that in a town fully motored by the company's cars
 * (`motor` 0..MOTOR_MAX, towns.ts motoring).
 */
export const walkReach = (motor: number) => WALK * (1 - Math.max(0, Math.min(0.5, motor)));

/**
 * The chance a driven trip is a real car on the roads: one in `tripScale` (big towns stand one car for several
 * trips), times 1 + motor for a town with the company's cars, so every car sold is more traffic.
 */
export const carOdds = (tripScale: number, motor: number) => Math.min(1, (1 + Math.max(0, motor)) / Math.max(1, tripScale));

/** Rough door-to-door time for a trip that isn't simulated as a car. */
export function estTime(a: V2, b: V2): number {
  return 12 + (dist(a, b) * 1.35) / 11;
}

function pickShift(rng: () => number) {
  const r = rng();
  return r < 0.5 ? 8 : r < 0.8 ? 7 : 9;
}
