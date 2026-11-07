// Every resident is simulated: households move into homes that grow on zoned land, adults find jobs by commute
// distance (in any city, or outside the region), and everyone keeps a daily schedule: staggered work shifts give
// morning and evening rush hours, and shopping and leisure trips fill the rest of the day. Each trip is a car on
// the player's roads; in big cities one car can stand for several trips (`tripScale`), the rest resolve with an
// estimated travel time.

import { dist, type V2 } from "../core/math";
import type { Access } from "../sim/router";
import type { Trip, TripKind, Vehicle } from "../sim/traffic";
import type { Building } from "./buildings";
import type { Game } from "./city";
import { ZONE_GROUP } from "./growables";
import { EFFECT } from "./policies";

/** Sim seconds per game hour; the clock starts at 06:00 on day 1. */
export const HOUR = 40;
export const DAY = 24 * HOUR;
export const START_HOUR = 6;

export const enum Age { Child = 0, Adult = 1, Senior = 2 }
export const enum St { Home = 0, Travel = 1, Away = 2, Gone = 3 }

export interface Citizen {
  id: number;
  hh: number; // household id; -1 for commuters from outside
  home: number; // building id; -1 = lives outside the region
  gate: number; // outside connection used by a commuter (-1 = local)
  age: Age;
  edu: number; // 0 none, 1 high school, 2 college
  job: number; // building id, -1 = none
  shift: number; // hour the shift starts
  st: St;
  at: number; // building id while away (or heading to); -1 = outside
  kind: TripKind;
  next: number; // sim time of the next decision; Infinity = none
  commute: number; // EWMA seconds, -1 = unknown
  tStart: number; // sim time the current trip started
  jobless: number; // sim time they became unemployed (adults)
  /** School or college they attend (building id), -1 = none. */
  school: number;
  /** Days of classes done at the current school (high school and university graduate after a few). */
  studied: number;
  /** Sim time they fell ill; 0 = healthy. */
  sick: number;
}

export interface Household {
  id: number;
  home: number;
  members: Citizen[];
  arrived: boolean; // false while the moving van is on its way
  since: number;
}

/** A point where vehicles enter or leave the region (on the pre-built motorway, as in CS2's map edge). */
export interface Port {
  gate: number; // gateway city it leads to
  a: Access;
  side: 1 | -1;
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
  commuters: number; // workers living outside the region
  movingIn: number;
  edu: [number, number, number];
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
    return { population: 0, households: 0, adults: 0, children: 0, seniors: 0, workers: 0, employed: 0, unemployed: 0, commuters: 0, movingIn: 0, edu: [0, 0, 0] };
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

  /** A household moves into `home`; it drives in from outside (or appears at once with no link). */
  moveIn(home: Building, link: Port | null): Household {
    const rng = this.g.rng;
    const hh: Household = { id: this.nextH++, home: home.id, members: [], arrived: false, since: this.now };
    const high = home.zone === "resHigh" || home.zone === "resMed";
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
    // the moving van
    const lead = hh.members[0];
    if (link && home.access) {
      lead.st = St.Travel;
      lead.kind = "move";
      lead.at = home.id;
      lead.tStart = this.now;
      this.travel(lead, null, home, "move");
    } else this.arrive(lead);
    return hh;
  }

  private newCitizen(hh: Household | null, home: number, age: Age): Citizen {
    const rng = this.g.rng;
    const e = rng();
    const c: Citizen = {
      id: this.nextC++, hh: hh ? hh.id : -1, home, gate: -1, age, edu: age === Age.Child ? 0 : e < 0.4 ? 0 : e < 0.83 ? 1 : 2,
      job: -1, shift: pickShift(rng), st: St.Home, at: -1, kind: "home", next: Infinity, commute: -1, tStart: 0, jobless: this.now,
      school: -1, studied: 0, sick: 0,
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
    this.leaveSchool(c);
    if (c.sick && c.kind === "service" && c.st === St.Away) this.g.services.discharged(this.g.buildings.byId.get(c.at));
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
    if (c.home < 0) this.dropCitizen(c); // commuters only come for the job
  }

  private leaveSchool(c: Citizen) {
    if (c.school < 0) return;
    const st = this.g.buildings.byId.get(c.school);
    if (st) st.users = Math.max(0, (st.users ?? 0) - 1);
    c.school = -1;
    c.studied = 0;
  }

  private enrol(c: Citizen, st: Building) {
    c.school = st.id;
    c.studied = 0;
    st.users = (st.users ?? 0) + 1;
  }

  /** A building is gone: its households leave, its workers lose their jobs, visitors go home. */
  onBuildingRemoved(id: number) {
    for (const hh of [...(this.hhAt.get(id) ?? [])]) this.moveOut(hh);
    for (const c of [...this.citizens.values()]) {
      if (c.job === id) this.leaveJob(c);
      if (c.school === id) { c.school = -1; c.studied = 0; }
      if (c.st === St.Away && c.at === id && c.home !== id) {
        if (c.kind === "service" && c.sick) c.sick = this.now;
        this.goHome(c);
      }
    }
  }

  householdsIn(id: number): number {
    return this.hhAt.get(id)?.length ?? 0;
  }

  workersAt(id: number): number {
    return this.staff.get(id) ?? 0;
  }

  // ------------------------------------------------------------------ jobs

  /** Match job seekers to open jobs, closest first (with some randomness), across every city. */
  matchJobs() {
    const g = this.g;
    const open: { b: Building; free: number; office: boolean }[] = [];
    for (const b of g.buildings.list) {
      if (!b.access || b.built < 1 || b.abandoned) continue;
      if (b.zone ? ZONE_GROUP[b.zone] === "res" : !b.svc) continue;
      const free = b.cap - this.workersAt(b.id);
      if (free > 0) open.push({ b, free, office: !!b.zone && ZONE_GROUP[b.zone] === "off" });
    }
    if (!open.length) return;
    // public services are staffed first (their jobs are secure and they keep the city running)
    open.sort((a, b) => (b.b.svc ? 1 : 0) - (a.b.svc ? 1 : 0));
    const rng = g.rng;
    let budget = 400;
    for (const c of this.citizens.values()) {
      if (budget <= 0) break;
      if (c.age !== Age.Adult || c.job >= 0 || c.home < 0 || c.school >= 0) continue;
      const hh = this.households.get(c.hh);
      if (!hh?.arrived) continue;
      const home = g.buildings.byId.get(c.home);
      if (!home?.access) continue;
      budget--;
      let best: (typeof open)[number] | null = null, bs = Infinity;
      for (let k = 0; k < Math.min(open.length, 48); k++) {
        const o = open.length <= 48 ? open[k] : open[(rng() * open.length) | 0];
        if (o.free <= 0 || (o.office && c.edu < 1)) continue;
        if (!g.connected(home.access.seg, o.b.access!.seg)) continue;
        const s = dist(home.c, o.b.c) * (0.8 + rng() * 0.4) - c.edu * (o.office ? 150 : 0) - (o.b.svc ? 250 : 0);
        if (s < bs) { bs = s; best = o; }
      }
      if (!best) continue;
      this.takeJob(c, best.b);
      best.free--;
    }
    // jobs nobody local can fill are taken by commuters from outside the region (up to a share of all jobs)
    if (!g.entries.length) return;
    const totalJobs = open.reduce((a, o) => a + o.free, 0);
    if (totalJobs <= 0 || this.stats.unemployed > Math.max(3, this.stats.workers * 0.04)) return;
    const cap = Math.max(4, Math.round((this.stats.employed + this.stats.commuters) * 0.3));
    let room = Math.min(12, cap - this.stats.commuters);
    // public services also hire from outside beyond that share, so a small town can still run its stations
    let svcRoom = 4;
    for (const o of open) {
      if (room <= 0 && (svcRoom <= 0 || !o.b.svc)) continue;
      if (o.free <= 0 || !g.entryFor(o.b.access!.seg) || !g.exitFor(o.b.access!.seg)) continue;
      const fromSvc = room <= 0;
      const n = Math.min(o.free, fromSvc ? svcRoom : room, 2);
      for (let i = 0; i < n; i++) {
        const c = this.newCitizen(null, -1, Age.Adult);
        c.edu = 1 + (rng() < 0.4 ? 1 : 0);
        c.gate = g.entryFor(o.b.access!.seg)!.gate;
        this.takeJob(c, o.b);
        // first commute: drive in at the next shift
        this.schedule(c, this.leaveFor(c));
      }
      o.free -= n;
      if (fromSvc) svcRoom -= n; else room -= n;
    }
  }

  private takeJob(c: Citizen, b: Building) {
    c.job = b.id;
    this.staff.set(b.id, this.workersAt(b.id) + 1);
    // industry runs shifts round the clock; shops open late; offices keep office hours
    const grp = b.zone ? ZONE_GROUP[b.zone] : b.kind === "school" || b.kind === "highschool" || b.kind === "university" ? "off" : "ind";
    const r = this.g.rng();
    c.shift = grp === "off" ? 8 + (r < 0.5 ? 0 : 1) : grp === "com" ? (r < 0.6 ? 9 : 14) : r < 0.55 ? 7 : r < 0.85 ? 15 : 23;
    if (c.st === St.Home && c.home >= 0) this.schedule(c, Math.min(c.next, this.leaveFor(c)));
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
      // treated: back home
      if (c.kind === "service") {
        c.sick = 0;
        g.services.discharged(g.buildings.byId.get(c.at));
        this.goHome(c);
        return;
      }
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
        const to = from && (c.kind === "leisure" ? this.pickLeisure(from) : this.pickShop(from));
        if (from && to && to.id !== from.id) { this.travel(c, from, to, "shop"); return; }
      }
      this.goHome(c);
      return;
    }
    // at home
    const home = c.home >= 0 ? g.buildings.byId.get(c.home) : null;
    if (c.home >= 0 && !home) return;
    // ill: stays in until an ambulance comes
    if (c.sick) { this.schedule(c, this.now + HOUR * 2); return; }
    if (c.age === Age.Child) {
      // a parent drives them to elementary school in the morning (children need a school place within reach)
      if (home && c.school < 0) { const st = g.services.schoolFor(home, 0); if (st) this.enrol(c, st); }
      const st = c.school >= 0 ? g.buildings.byId.get(c.school) : undefined;
      if (home && st?.access && h >= 7 && h < 9.5) { this.travel(c, home, st, "school"); return; }
      this.schedule(c, this.nextAt(7 + rng() * 1.2));
      return;
    }
    // students go to classes instead of looking for work
    if (c.school >= 0 && c.job < 0) {
      const st = g.buildings.byId.get(c.school);
      if (!st) { this.leaveSchool(c); this.scheduleFree(c); return; }
      if (home && st.access && h >= 7.5 && h < 10) { this.travel(c, home, st, "school"); return; }
      this.schedule(c, this.nextAt(7.6 + rng() * 1.2));
      return;
    }
    if (c.job >= 0) {
      const job = g.buildings.byId.get(c.job);
      if (!job) { this.leaveJob(c); this.scheduleFree(c); return; }
      const start = c.shift;
      const late = (((h - start) % 24) + 24) % 24; // hours since the shift began (0..24)
      const early = 24 - late; // hours until it begins
      const est = (c.commute > 0 ? c.commute : 60) / HOUR;
      if (early <= est + 1.5 || late < 2) {
        if (job.access && job.built >= 1 && !job.abandoned) { this.travel(c, home ?? null, job, "work"); return; }
      }
      // an evening out on the way through the day
      if (home && h >= 16 && h < 21 && rng() < 0.4) {
        const shop = this.pickLeisure(home);
        if (shop) { this.travel(c, home, shop, "leisure"); return; }
      }
      // look again in a while (evening outings), never later than the time to leave for work
      this.schedule(c, Math.min(this.leaveFor(c), this.now + HOUR * (1.5 + rng() * 2.5)));
      return;
    }
    if (c.home < 0) { c.st = St.Gone; return; }
    // out of work a while: go back to school for a better job, if there is a place within reach
    if (home && c.age === Age.Adult && c.edu < 2 && this.now - c.jobless > HOUR * 10 && rng() < 0.35) {
      const st = g.services.schoolFor(home, (c.edu + 1) as 1 | 2);
      if (st) { this.enrol(c, st); this.schedule(c, this.nextAt(7.6 + rng() * 1.2)); return; }
    }
    // no job: errands in the daytime
    if (home && h >= 9 && h < 19 && rng() < 0.55) {
      const senior = c.age === Age.Senior;
      const shop = senior ? this.pickLeisure(home) : this.pickShop(home);
      if (shop) { this.travel(c, home, shop, senior ? "leisure" : "shop"); return; }
    }
    this.scheduleFree(c);
  }

  /** Somewhere for an outing: a park or a landmark within reach now and then, else the shops. */
  pickLeisure(near: Building): Building | undefined {
    const g = this.g;
    const rng = g.rng;
    if (rng() < 0.4) {
      let best: Building | undefined, bs = Infinity;
      for (const b of g.services.stations()) {
        const pull = OUTING_PULL[b.kind];
        if (!pull || !b.access || b.built < 1) continue;
        const d = dist(b.c, near.c);
        if (d > pull.reach) continue;
        if (near.access && !g.connected(near.access.seg, b.access.seg)) continue;
        const s = (d * (0.6 + rng() * 0.8)) / pull.draw;
        if (s < bs) { bs = s; best = b; }
      }
      if (best) return best;
    }
    return this.pickShop(near);
  }

  private scheduleFree(c: Citizen) {
    const rng = this.g.rng;
    this.schedule(c, this.nextAt(9 + rng() * 9, HOUR * (2 + rng() * 6)));
  }

  private goHome(c: Citizen) {
    const g = this.g;
    const from = c.at >= 0 ? g.buildings.byId.get(c.at) ?? null : null;
    if (c.home < 0) {
      if (!from) { c.st = St.Home; c.at = -1; this.schedule(c, this.leaveFor(c)); return; }
      this.travel(c, from, null, "home");
      return;
    }
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
      const pull = b.zone === "comHigh" ? 1.8 : 1;
      const s = (dist(b.c, near.c) / pull) * (0.6 + rng() * 0.8);
      if (s < bs) { bs = s; best = b; }
    }
    return best;
  }

  // ------------------------------------------------------------------ trips

  /** Start a trip. `from`/`to` null = outside the region (through the nearest connected motorway border). */
  private travel(c: Citizen, from: Building | null, to: Building | null, kind: TripKind) {
    const g = this.g;
    const inP = !from && to?.access ? g.entryFor(to.access.seg) : null;
    const outP = !to && from?.access ? g.exitFor(from.access.seg) : null;
    const a = from ? from.access : inP?.a;
    const b = to ? to.access : outP?.a;
    if (!a || !b || !g.connected(a.seg, b.seg)) {
      // no way there: try again later
      if (kind === "move") { this.arrive(c); return; }
      c.st = from ? (from.id === c.home ? St.Home : St.Away) : St.Home;
      this.schedule(c, this.now + HOUR * (1 + g.rng()));
      g.noRoute(to ?? from);
      return;
    }
    c.st = St.Travel;
    c.kind = kind;
    c.at = to ? to.id : -1;
    c.tStart = this.now;
    this.allTrips++;
    const fromP = from ? from.c : a.p, toP = to ? to.c : b.p;
    // round the corner to work, the shops, the school or a park: people walk
    const walk = !!from && !!to && kind !== "move" && dist(fromP, toP) < WALK;
    // a bus that goes their way, about as quick as driving: they take it (and leave the car at home)
    if (!walk && from && to && kind !== "move" && g.transit.lines.size) {
      // (about one household in four has no car; more in flats)
      const home = g.buildings.byId.get(c.home);
      const carless = c.hh >= 0 && (c.hh * 7919) % 100 < (home?.zone === "resHigh" || home?.zone === "resMed" ? 40 : 22);
      const bus = g.transit.plan(fromP, toP, carless);
      if (bus && g.rng() < Math.min(0.95, bus.p * (g.policies.has("freebus") ? EFFECT.freeBus : 1))) {
        this.busTrips++;
        g.transit.wait(c.id, bus);
        c.next = Infinity;
        return;
      }
    }
    const real = !walk && g.rng() * g.tripScale < 1;
    if (real) {
      this.carTrips++;
      g.traffic.request({
        from: a, fromSide: from ? from.side : inP!.side, to: b, toSide: to ? to.side : outP!.side,
        trip: { kind, from: from ? from.id : -1, to: to ? to.id : -1, resident: c.id, startT: this.now, freeFlow: 0 },
        truck: kind === "move", tries: 0, wait: 0, through: !from, exit: !to,
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
    if (trip.kind === "move") { this.arrive(c); return; }
    // give up and resolve the trip as a slow one
    this.schedule(c, this.now + 30);
  }

  private arrive(c: Citizen) {
    const g = this.g;
    const dur = this.now - c.tStart;
    const kind = c.kind;
    if (kind === "move") {
      const hh = this.households.get(c.hh);
      if (hh && !hh.arrived) {
        hh.arrived = true;
        for (const m of hh.members) this.arriveHome(m);
      }
      return;
    }
    if (kind === "home" || c.at < 0 && c.home < 0) { this.arriveHome(c); return; }
    const to = g.buildings.byId.get(c.at);
    if (!to) { this.goHome(c); return; }
    c.st = St.Away;
    if (kind === "work") {
      c.commute = c.commute < 0 ? dur : c.commute + (dur - c.commute) * 0.3;
      // stay until 8 hours after the shift started
      const sinceStart = (((this.hourOf() - c.shift) % 24) + 24) % 24;
      const left = sinceStart < 10 ? 8 - sinceStart : 8;
      this.schedule(c, this.now + Math.max(0.5, left) * HOUR);
    } else if (kind === "school") {
      // a day of classes; older students graduate after a few
      if (c.age === Age.Adult && c.school === to.id) {
        c.studied++;
        if (c.studied >= g.services.studyDays(to)) { c.edu = Math.min(2, c.edu + 1); this.leaveSchool(c); c.jobless = this.now; }
      }
      this.schedule(c, this.nextAt(c.age === Age.Child ? 15 : 16, HOUR * 2));
    } else {
      to.visits += 1;
      if (!to.svc) g.sale(to);
      this.schedule(c, this.now + HOUR * (0.6 + g.rng() * 1.4));
    }
  }

  private arriveHome(c: Citizen) {
    c.st = St.Home;
    c.at = c.home;
    c.kind = "home";
    if (c.home < 0) { this.schedule(c, this.leaveFor(c)); return; }
    if (c.job >= 0) this.schedule(c, Math.min(this.leaveFor(c), this.now + HOUR * (0.5 + this.g.rng() * 2)));
    else if (c.age === Age.Child || c.school >= 0) this.schedule(c, this.nextAt(7 + this.g.rng() * 1.2, HOUR * 2));
    else this.scheduleFree(c);
  }

  /** An ambulance picked a patient up: they ride along (no trip of their own). */
  hold(c: Citizen) {
    c.st = St.Travel;
    c.kind = "service";
    c.at = -1;
    c.next = Infinity;
  }

  /** The ambulance is back: the patient stays at the clinic for treatment, then goes home. */
  release(c: Citizen, st: Building | null, dur: number) {
    if (!st) { c.sick = 0; this.arriveHome(c); return; }
    c.st = St.Away;
    c.kind = "service";
    c.at = st.id;
    this.schedule(c, this.now + dur);
  }

  // ------------------------------------------------------------------ statistics

  refreshStats() {
    const s = this.emptyStats();
    for (const hh of this.households.values()) {
      if (!hh.arrived) { s.movingIn++; continue; }
      s.households++;
      for (const c of hh.members) {
        s.population++;
        if (c.age === Age.Child) s.children++;
        else if (c.age === Age.Senior) s.seniors++;
        else {
          s.adults++;
          s.workers++;
          s.edu[c.edu]++;
          if (c.job >= 0) s.employed++;
          else s.unemployed++;
        }
      }
    }
    for (const c of this.citizens.values()) if (c.home < 0) s.commuters++;
    this.stats = s;
  }

  // ------------------------------------------------------------------ save / load

  toJSON() {
    const hhs = [...this.households.values()].map((h) => ({
      id: h.id, home: h.home, arrived: h.arrived, since: h.since,
      m: h.members.map((c) => [c.id, c.age, c.edu, c.job, c.shift, c.school, c.studied]),
    }));
    const commuters = [...this.citizens.values()].filter((c) => c.home < 0).map((c) => [c.id, c.edu, c.job, c.shift, c.gate]);
    return { hhs, commuters, nextC: this.nextC, nextH: this.nextH };
  }

  load(d: ReturnType<Society["toJSON"]>) {
    this.citizens.clear(); this.households.clear(); this.staff.clear(); this.hhAt.clear(); this.q.clear();
    const rng = this.g.rng;
    for (const h of d.hhs) {
      const hh: Household = { id: h.id, home: h.home, members: [], arrived: true, since: h.since };
      for (const [id, age, edu, job, shift, school, studied] of h.m) {
        const c: Citizen = { id, hh: h.id, home: h.home, gate: -1, age: age as Age, edu, job: -1, shift, st: St.Home, at: h.home, kind: "home", next: Infinity, commute: -1, tStart: 0, jobless: 0, school: -1, studied: 0, sick: 0 };
        const sb = school !== undefined && school >= 0 ? this.g.buildings.byId.get(school) : undefined;
        if (sb) { this.enrol(c, sb); c.studied = studied ?? 0; }
        this.citizens.set(id, c);
        hh.members.push(c);
        if (job >= 0 && this.g.buildings.byId.has(job)) { c.job = job; this.staff.set(job, this.workersAt(job) + 1); }
      }
      this.households.set(hh.id, hh);
      let L = this.hhAt.get(hh.home);
      if (!L) this.hhAt.set(hh.home, (L = []));
      L.push(hh);
      for (const c of hh.members) {
        if (c.age === Age.Child || c.school >= 0) this.schedule(c, this.nextAt(7 + rng() * 1.2));
        else if (c.job >= 0) this.schedule(c, this.now + rng() * HOUR * 3);
        else this.scheduleFree(c);
      }
    }
    for (const [id, edu, job, shift, gate] of d.commuters) {
      if (!this.g.buildings.byId.has(job)) continue;
      const c: Citizen = { id, hh: -1, home: -1, gate, age: Age.Adult, edu, job, shift, st: St.Home, at: -1, kind: "home", next: Infinity, commute: -1, tStart: 0, jobless: 0, school: -1, studied: 0, sick: 0 };
      this.citizens.set(id, c);
      this.staff.set(job, this.workersAt(job) + 1);
      this.schedule(c, this.now + rng() * HOUR * 3);
    }
    this.nextC = d.nextC;
    this.nextH = d.nextH;
    this.refreshStats();
  }
}

/** Trips shorter than this (straight line, m) between two buildings are walked rather than driven. */
export const WALK = 400;

/** Rough door-to-door time for a trip that isn't simulated as a car. */
/** Places people go for an outing: how far they will drive (m) and how strongly each draws them. */
const OUTING_PULL: Partial<Record<string, { reach: number; draw: number }>> = {
  park: { reach: 450, draw: 1 }, parklarge: { reach: 900, draw: 1.8 },
  townhall: { reach: 1600, draw: 2.2 }, stadium: { reach: 2600, draw: 3.2 }, obstower: { reach: 2600, draw: 3 },
  concerthall: { reach: 2600, draw: 3 }, skytower: { reach: 3000, draw: 3.4 },
};

export function estTime(a: V2, b: V2): number {
  return 12 + (dist(a, b) * 1.35) / 11;
}

function pickShift(rng: () => number) {
  const r = rng();
  return r < 0.5 ? 8 : r < 0.8 ? 7 : 9;
}
