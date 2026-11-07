// Buses, the CS2 way: the player puts stops on the kerb and strings them into lines (always loops); each line runs
// a fleet of buses that drive in the ordinary traffic, pull up at every stop, let riders off and on, and go on to
// the next. Residents take the bus when it gets them there about as fast as driving would (walk to the stop,
// wait, ride, walk on); every rider is a car that isn't on the road. Fares come in, buses cost upkeep.

import { ROAD_TYPES } from "../config";
import { add, dist, dot, polyAt, polyClosest, polyDirSmooth, right, scale, sub, type V2 } from "../core/math";
import type { Access } from "../sim/router";
import type { BusRun, Vehicle } from "../sim/traffic";
import type { Game } from "./city";
import { HOUR, estTime } from "./society";

export interface BusStop {
  id: number;
  /** kerb point (what the stop is kept by when roads change under it) */
  p: V2;
  access: Access;
  /** riders waiting here */
  wait: Pax[];
}

export interface BusLine {
  id: number;
  name: string;
  color: number;
  /** stop ids in order; the bus goes round them and back to the first */
  stops: number[];
  /** buses the player wants on it */
  want: number;
  /** boardings last hour, and so far this hour */
  riders: number;
  count: number;
  /** drive time between stop i and i+1 (null: no way there) */
  legs: (number | null)[];
}

interface Pax {
  c: number; // citizen id
  line: number;
  to: number; // stop id they get off at
  t: number; // sim time they started waiting
  walk: number; // walk from that stop to where they're going
}

export const BUS_CAP = 40;
export const STOP_COST = 500;
export const BUS_UPKEEP = 24; // per bus per hour
export const FARE = 2;
/** how far people walk to and from a stop (m) */
export const STOP_WALK = 350;
const GIVE_UP = HOUR * 3;
const LINE_COLORS = [0xe0533d, 0x2f7fd8, 0x2ea86b, 0xe39b1b, 0x8e5bd6, 0x1aa7b8, 0xd64f9a, 0x6b7a2b];
const LINE_NAMES = ["Red", "Blue", "Green", "Amber", "Violet", "Teal", "Rose", "Olive"];

export class Transit {
  stops = new Map<number, BusStop>();
  lines = new Map<number, BusLine>();
  /** buses on the road (or about to pull out) */
  runs = new Set<BusRun>();
  nextStop = 1;
  nextLine = 1;
  /** fares and upkeep this hour (read by the budget) */
  fares = 0;
  boardings = 0;
  /** bumped whenever stops or lines change (the renderer redraws) */
  version = 0;

  constructor(private g: Game) {}

  // ------------------------------------------------------------------ stops

  /** Where a stop would go near p: on the kerb of the nearest street, on its near side. */
  stopPlan(p: V2): { access: Access; p: V2; ok: boolean; why?: string } | null {
    const net = this.g.net;
    let best: { seg: number; d: number } | null = null;
    for (const id of net.segsNear(p.x - 20, p.y - 20, p.x + 20, p.y + 20)) {
      const s = net.segs.get(id)!;
      const T = ROAD_TYPES[s.type];
      if (!T.allowsAccess) continue;
      const g = net.segGeom.get(id)!;
      const r = polyClosest(g.center, p);
      if (r.d > g.width / 2 + 12) continue;
      if (!best || r.d < best.d) best = { seg: id, d: r.d };
    }
    if (!best) return null;
    const g = net.segGeom.get(best.seg)!;
    const r = polyClosest(g.center, p);
    const q = polyAt(g.center, r.s), t = polyDirSmooth(g.center, r.s, 2), n = right(t);
    const side: 1 | -1 = dot(sub(p, q), n) >= 0 ? 1 : -1;
    const kerb = add(q, scale(n, side * (g.width / 2)));
    const access: Access = { seg: best.seg, s: r.s, p: kerb, side, strict: true };
    const out = { access, p: kerb, ok: true } as { access: Access; p: V2; ok: boolean; why?: string };
    // the bus pulls up in the kerb lane of the traffic on this side
    const flows = g.lanes.some((l) => (l.dir === 1 ? 1 : -1) === side) || !g.lanes.some((l) => (l.dir === 1 ? 1 : -1) === -side);
    if (!flows) { out.ok = false; out.why = "Traffic doesn't drive on this side"; }
    else if (r.s < 14 || r.s > g.center.length - 14) { out.ok = false; out.why = "Too close to the junction"; }
    else if (net.heightOnSeg(best.seg, 0.5) > 0.5) { out.ok = false; out.why = "Not on a bridge"; }
    else if ([...this.stops.values()].some((o) => dist(o.p, kerb) < 30)) { out.ok = false; out.why = "Another stop is right here"; }
    else if (this.g.money < STOP_COST) { out.ok = false; out.why = "Not enough money"; }
    return out;
  }

  addStop(p: V2): BusStop | null {
    const pl = this.stopPlan(p);
    if (!pl || !pl.ok) return null;
    const st: BusStop = { id: this.nextStop++, p: pl.p, access: pl.access, wait: [] };
    this.stops.set(st.id, st);
    this.g.money -= STOP_COST;
    this.version++;
    return st;
  }

  removeStop(id: number) {
    const st = this.stops.get(id);
    if (!st) return;
    this.stops.delete(id);
    this.version++;
    this.g.money += STOP_COST * 0.5;
    for (const x of st.wait) this.giveUp(x, st.p);
    // anyone bound for it (waiting elsewhere, or aboard) makes their own way from here
    for (const o of this.stops.values()) {
      const keep: Pax[] = [];
      for (const x of o.wait) if (x.to === id) this.giveUp(x, o.p); else keep.push(x);
      o.wait = keep;
    }
    for (const r of this.runs) {
      const keep: BusRun["pax"] = [];
      for (const x of r.pax) if (x.to === id) this.g.people.resume(x.c, 30 + x.walk); else keep.push(x);
      r.pax = keep;
    }
    for (const l of [...this.lines.values()]) {
      if (!l.stops.includes(id)) continue;
      const old = l.stops;
      l.stops = l.stops.filter((s) => s !== id);
      // (the same stop twice in a row once its neighbour is gone)
      l.stops = l.stops.filter((s, i) => s !== l.stops[(i + 1) % l.stops.length] || l.stops.length < 2);
      if (l.stops.length < 2) { this.removeLine(l.id); continue; }
      // each bus keeps heading for the same stop (or, if that was this one, the next one still on the line)
      for (const r of this.runs) {
        if (r.line !== l.id) continue;
        const k = old.length;
        for (let j = 0; j < k; j++) {
          const at = l.stops.indexOf(old[(r.i + j) % k]);
          if (at < 0) continue;
          if (j > 0 && old[r.i % k] === id) r.detour = true;
          r.i = at;
          break;
        }
      }
      this.refreshLine(l);
    }
  }

  /** After road edits: keep each stop on whatever kerb now runs past it; a stop whose road is gone goes too. */
  afterRoads() {
    const net = this.g.net;
    for (const st of [...this.stops.values()]) {
      // (a street widened or narrowed moves its kerb a few metres: the stop moves out or in with it)
      let best: Access | null = null, bd = 4.5;
      for (const id of net.segsNear(st.p.x - 10, st.p.y - 10, st.p.x + 10, st.p.y + 10)) {
        const s = net.segs.get(id)!;
        if (!ROAD_TYPES[s.type].allowsAccess) continue;
        const g = net.segGeom.get(id)!;
        const r = polyClosest(g.center, st.p);
        const d = Math.abs(r.d - g.width / 2);
        if (d >= bd) continue;
        const q = polyAt(g.center, r.s), t = polyDirSmooth(g.center, r.s, 2), n = right(t);
        const side: 1 | -1 = dot(sub(st.p, q), n) >= 0 ? 1 : -1;
        bd = d;
        best = { seg: id, s: r.s, p: add(q, scale(n, side * (g.width / 2))), side, strict: true };
      }
      if (!best) { this.removeStop(st.id); this.g.money -= STOP_COST * 0.5; continue; } // (no refund: the road was pulled out from under it)
      st.access = best;
      st.p = best.p;
    }
    for (const l of this.lines.values()) this.refreshLine(l);
    this.version++;
  }

  // ------------------------------------------------------------------ lines

  /** The colour (index) the next line gets: the first one no line wears yet. */
  private nextColorIndex(): number {
    const used = new Set([...this.lines.values()].map((l) => l.color));
    const i = LINE_COLORS.findIndex((c) => !used.has(c));
    return i < 0 ? this.lines.size % LINE_COLORS.length : i;
  }

  nextColor(): number {
    return LINE_COLORS[this.nextColorIndex()];
  }

  addLine(stops: number[]): BusLine | null {
    const ids = stops.filter((s) => this.stops.has(s));
    if (ids.length < 2) return null;
    const k = this.nextLine++;
    const ci = this.nextColorIndex();
    const l: BusLine = {
      id: k, name: `${LINE_NAMES[ci]} line`, color: LINE_COLORS[ci], stops: ids,
      want: Math.max(1, Math.ceil(ids.length / 3)), riders: 0, count: 0, legs: [],
    };
    this.lines.set(k, l);
    this.version++;
    this.refreshLine(l);
    // enough buses for one every couple of hours or so
    const loop = this.loopTime(l);
    if (isFinite(loop)) l.want = Math.max(1, Math.min(8, Math.ceil(loop / (HOUR * 2.2))));
    return l;
  }

  removeLine(id: number) {
    const l = this.lines.get(id);
    if (!l) return;
    this.lines.delete(id);
    this.version++;
    for (const r of this.runs) if (r.line === id) r.retire = true;
    for (const st of this.stops.values()) {
      const keep: Pax[] = [];
      for (const x of st.wait) if (x.line === id) this.giveUp(x, st.p); else keep.push(x);
      st.wait = keep;
    }
    // its buses finish at their next stop
  }

  /** Route each leg again (after the stops or the roads changed). */
  refreshLine(l: BusLine) {
    const r = this.g.traffic.router;
    l.legs = l.stops.map((id, i) => {
      const a = this.stops.get(id), b = this.stops.get(l.stops[(i + 1) % l.stops.length]);
      if (!a || !b) return null;
      const rr = r.route(a.access, b.access, a.access.side);

      return rr ? rr.freeFlow * 1.35 + 8 : null;
    });
  }

  /** The roads a bus drives from one stop to the next (null: no way). */
  routeKeys(a: Access, b: Access): number[] | null {
    return this.g.traffic.router.route(a, b, a.side)?.keys ?? null;
  }

  /** Round trip time of a line (Infinity when a leg has no way through). */
  loopTime(l: BusLine): number {
    let t = 0;
    for (const x of l.legs) { if (x === null) return Infinity; t += x; }
    return t;
  }

  /** Buses now running on a line. */
  busesOn(id: number): number {
    let n = 0;
    for (const r of this.runs) if (r.line === id && !r.retire) n++;
    return n;
  }

  // ------------------------------------------------------------------ riders

  /**
   * A resident deciding how to get from a to b: the best line with a stop near each end, and how likely they take
   * it (the quicker the bus is next to the car, the likelier; nearly always for one without a car). Null: no bus
   * goes that way.
   */
  plan(a: V2, b: V2, carless = false): { line: BusLine; from: BusStop; to: BusStop; p: number; walk: number } | null {
    const car = estTime(a, b);
    let best: { line: BusLine; from: BusStop; to: BusStop; p: number; walk: number; t: number } | null = null;
    for (const l of this.lines.values()) {
      const loop = this.loopTime(l);
      if (!isFinite(loop)) continue;
      const n = this.busesOn(l.id);
      if (!n) continue;
      let ia = -1, ib = -1, da = STOP_WALK, db = STOP_WALK;
      l.stops.forEach((id, i) => {
        const st = this.stops.get(id)!;
        const x = dist(st.p, a), y = dist(st.p, b);
        if (x < da) { da = x; ia = i; }
        if (y < db) { db = y; ib = i; }
      });
      if (ia < 0 || ib < 0 || ia === ib) continue;
      let ride = 0;
      for (let i = ia; i !== ib; i = (i + 1) % l.stops.length) ride += l.legs[i]!;
      const walkOn = (db * 1.35) / 11;
      // (people know roughly when the bus comes, and so only count part of the wait against it)
      const t = (da * 1.35) / 11 + Math.min(loop / n / 2, 20) + ride + walkOn;
      if (!best || t < best.t) {
        const r = t / car;
        // (someone with no car of their own takes it whenever it goes their way at all)
        const p = carless ? (r < 6 ? 0.9 : 0) : r < 1.3 ? 0.6 : r < 2 ? 0.35 : r < 3 ? 0.15 : r < 4.5 ? 0.04 : 0;
        best = { line: l, from: this.stops.get(l.stops[ia])!, to: this.stops.get(l.stops[ib])!, p, walk: walkOn, t };
      }
    }
    return best && best.p > 0 ? best : null;
  }

  /** A resident walks to the stop and waits there. */
  wait(c: number, pl: { line: BusLine; from: BusStop; to: BusStop; walk: number }) {
    pl.from.wait.push({ c, line: pl.line.id, to: pl.to.id, t: this.g.time, walk: pl.walk });
  }

  /** Waited too long (or the line went): they make their own way, resolved off the road. */
  private giveUp(x: Pax, at: V2) {
    const to = this.stops.get(x.to);
    this.g.people.resume(x.c, estTime(at, to ? to.p : at) + x.walk);
  }

  // ------------------------------------------------------------------ buses

  /**
   * A bus pulled up at its stop: riders get off and on. Returns the next stop and how long it stands here,
   * or null when it is done (its line is gone or has too many buses): it leaves the road.
   */
  busAt(v: Vehicle): { to: Access; dwell: number } | null {
    const run = v.trip.bus!;
    const l = this.lines.get(run.line);
    if (run.detour && l && !run.retire) {
      // pulled up where a stop used to be: on to the next one
      run.detour = false;
      const nx = this.stops.get(l.stops[run.i % l.stops.length]);
      if (nx) return { to: nx.access, dwell: 0 };
    }
    const st = this.stops.get(l?.stops[run.i % l.stops.length] ?? -1);
    let moves = 0;
    if (st) {
      // off
      const keep: typeof run.pax = [];
      for (const x of run.pax) {
        if (x.to === st.id || !l || run.retire) { this.g.people.resume(x.c, x.walk); moves++; }
        else keep.push(x);
      }
      run.pax = keep;
      // on
      if (l && !run.retire) {
        const stay: Pax[] = [];
        for (const x of st.wait) {
          if (x.line === l.id && run.pax.length < BUS_CAP) {
            run.pax.push({ c: x.c, to: x.to, walk: x.walk });
            moves++;
            l.count++;
            this.boardings++;
            if (!this.g.policies.has("freebus")) this.fares += FARE;
          } else stay.push(x);
        }
        st.wait = stay;
      }
    }
    if (!l || run.retire) {
      for (const x of run.pax) this.g.people.resume(x.c, x.walk + 20);
      run.pax = [];
      return null;
    }
    run.i = (run.i + 1) % l.stops.length;
    const nx = this.stops.get(l.stops[run.i]);
    if (!nx) return null;
    return { to: nx.access, dwell: Math.min(12, 4 + moves * 0.25) };
  }

  /** A bus left the road for good (done, or lost in traffic): anyone aboard finishes their trip off the road. */
  onGone(run: BusRun, at?: V2) {
    this.runs.delete(run);
    for (const x of run.pax) {
      const to = this.stops.get(x.to);
      this.g.people.resume(x.c, (at && to ? estTime(at, to.p) : 30) + x.walk);
    }
    run.pax = [];
  }

  /** Every 1/8 hour: keep each line's fleet, send home riders tired of waiting. */
  tick() {
    const now = this.g.time;
    for (const st of this.stops.values()) {
      if (!st.wait.length) continue;
      const keep: Pax[] = [];
      for (const x of st.wait) if (now - x.t > GIVE_UP || !this.lines.has(x.line)) this.giveUp(x, st.p); else keep.push(x);
      st.wait = keep;
    }
    for (const l of this.lines.values()) {
      let n = this.busesOn(l.id);
      // too many: the last ones finish at their next stop
      if (n > l.want) for (const r of this.runs) if (r.line === l.id && !r.retire && n > l.want) { r.retire = true; n--; }
      if (n >= l.want || !isFinite(this.loopTime(l))) continue;
      // one more pulls out, at the stop furthest (in stop order) from the buses already out
      const at = new Set<number>();
      for (const r of this.runs) if (r.line === l.id && !r.retire) at.add(r.i);
      const k = l.stops.length;
      let i = 0, gap = -1;
      for (let j = 0; j < k; j++) {
        let d = k;
        for (const a of at) d = Math.min(d, (j - a + k) % k, (a - j + k) % k);
        if (d > gap) { gap = d; i = j; }
      }
      const a = this.stops.get(l.stops[i])!, b = this.stops.get(l.stops[(i + 1) % k])!;
      const run: BusRun = { line: l.id, i: (i + 1) % k, pax: [] };
      this.runs.add(run);
      this.g.traffic.request({
        from: a.access, fromSide: a.access.side!, to: b.access, toSide: b.access.side!,
        trip: { kind: "bus", from: -1, to: -1, resident: -1, startT: now, freeFlow: 0, bus: run },
        truck: false, tries: 0, wait: 0, color: l.color,
      });
    }
  }

  /** The hour's fares and upkeep (and the riders count). */
  hourly(): { fares: number; upkeep: number } {
    let buses = 0;
    for (const r of this.runs) if (!r.retire) buses++;
    for (const l of this.lines.values()) { l.riders = l.count; l.count = 0; }
    const out = { fares: this.fares, upkeep: buses * BUS_UPKEEP + this.stops.size * 2 };
    this.fares = 0;
    return out;
  }

  /** riders waiting at every stop */
  waiting(): number {
    let n = 0;
    for (const st of this.stops.values()) n += st.wait.length;
    return n;
  }

  toJSON() {
    return {
      stops: [...this.stops.values()].map((s) => ({ id: s.id, p: s.p })),
      lines: [...this.lines.values()].map((l) => ({ id: l.id, name: l.name, color: l.color, stops: l.stops, want: l.want })),
      nextStop: this.nextStop,
      nextLine: this.nextLine,
    };
  }

  load(d: ReturnType<Transit["toJSON"]> | undefined) {
    if (!d) return;
    for (const s of d.stops) this.stops.set(s.id, { id: s.id, p: s.p, access: { seg: -1, s: 0, p: s.p, side: 1, strict: true }, wait: [] });
    for (const l of d.lines) this.lines.set(l.id, { ...l, riders: 0, count: 0, legs: [] });
    this.nextStop = d.nextStop;
    this.nextLine = d.nextLine;
    this.afterRoads();
  }
}
