import { ROAD_TYPES } from "../config";
import type { RoadNetwork, Lane } from "../roads/network";
import { dist, type V2 } from "../core/math";

/** Directed segment key: seg*2 + (dir === 1 ? 0 : 1). */
export const dkey = (seg: number, dir: 1 | -1) => seg * 2 + (dir === 1 ? 0 : 1);
export const dkSeg = (k: number) => k >> 1;
export const dkDir = (k: number): 1 | -1 => ((k & 1) === 0 ? 1 : -1);

export interface Access {
  seg: number;
  s: number; // centreline arc-length on the seg
  p: V2; // kerb point the driveway meets
  /** Side of the seg (relative to a->b) the building stands on. On a road with a median only that side's lanes reach it. */
  side?: 1 | -1;
  /** Only reachable from its own side's lanes on any road (a bus stop): never by crossing the oncoming traffic. */
  strict?: boolean;
}

class Heap {
  private k: number[] = [];
  private p: number[] = [];
  get size() { return this.k.length; }
  push(key: number, pri: number) {
    const k = this.k, p = this.p;
    k.push(key); p.push(pri);
    let i = k.length - 1;
    while (i > 0) {
      const j = (i - 1) >> 1;
      if (p[j] <= p[i]) break;
      [k[i], k[j]] = [k[j], k[i]];
      [p[i], p[j]] = [p[j], p[i]];
      i = j;
    }
  }
  pop(): number {
    const k = this.k, p = this.p;
    const top = k[0];
    const lk = k.pop()!, lp = p.pop()!;
    if (k.length) {
      k[0] = lk; p[0] = lp;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1, r = l + 1;
        let m = i;
        if (l < k.length && p[l] < p[m]) m = l;
        if (r < k.length && p[r] < p[m]) m = r;
        if (m === i) break;
        [k[i], k[m]] = [k[m], k[i]];
        [p[i], p[m]] = [p[m], p[i]];
        i = m;
      }
    }
    return top;
  }
}

export interface RouteResult {
  keys: number[];
  time: number; // estimated travel time
  freeFlow: number; // time at speed limits
}

/**
 * A* over directed segments. Edge costs use the measured speed on each directed segment, so routes
 * spread away from jams; junction costs penalise left turns, U-turns and signals.
 */
export class Router {
  /** measured mean speed per directed seg (m/s); missing = speed limit */
  speeds = new Map<number, number>();
  private succCache = new Map<number, { k: number; turn: string; signal: boolean; stop: boolean }[]>();
  private cacheVersion = -1;

  constructor(private net: RoadNetwork) {}

  private lanesOf(k: number): Lane[] {
    const g = this.net.segGeom.get(dkSeg(k));
    if (!g) return [];
    const d = dkDir(k);
    return g.lanes.filter((l) => l.dir === d);
  }

  succ(k: number) {
    if (this.cacheVersion !== this.net.version) {
      this.succCache.clear();
      this.cacheVersion = this.net.version;
    }
    let out = this.succCache.get(k);
    if (out) return out;
    out = [];
    const seen = new Set<number>();
    for (const l of this.lanesOf(k)) {
      for (const c of l.outs) {
        const nk = dkey(c.to.seg, c.to.dir);
        if (seen.has(nk)) continue;
        seen.add(nk);
        out.push({ k: nk, turn: c.turn, signal: !!this.net.nodes.get(c.node)?.signal, stop: c.prio < 0 });
      }
    }
    this.succCache.set(k, out);
    return out;
  }

  segLen(k: number): number {
    return this.net.segGeom.get(dkSeg(k))?.center.length ?? 0;
  }

  limit(k: number): number {
    const l = this.lanesOf(k)[0];
    return l ? l.speed : 13;
  }

  private cost(k: number, frac = 1): number {
    const L = this.segLen(k) * frac;
    const lim = this.limit(k);
    const meas = this.speeds.get(k);
    const v = meas === undefined ? lim : Math.max(1.2, Math.min(lim, meas));
    return L / v;
  }

  hasLanes(seg: number, dir: 1 | -1): boolean {
    return this.lanesOf(dkey(seg, dir)).length > 0;
  }

  /** Centre arc-length of a directed seg, measured from where a vehicle on it starts. */
  private along(seg: number, dir: 1 | -1, s: number): number {
    const L = this.net.segGeom.get(seg)?.center.length ?? 0;
    return dir === 1 ? s : L - s;
  }

  route(from: Access, to: Access, startDir?: 1 | -1, maxExpand = 6000): RouteResult | null {
    if (!this.net.segs.has(from.seg) || !this.net.segs.has(to.seg)) return null;
    const goalP = to.p;
    const H = (k: number) => {
      const seg = this.net.segs.get(dkSeg(k));
      if (!seg) return 0;
      const end = dkDir(k) === 1 ? seg.c.p3 : seg.c.p0;
      return dist(end, goalP) / 30;
    };
    const g = new Map<number, number>();
    const ff = new Map<number, number>();
    const prev = new Map<number, number>();
    const heap = new Heap();
    const goalKeys = new Map<number, number>(); // key -> remaining fraction cost
    const toSeg = this.net.segs.get(to.seg)!;
    const divided = (ROAD_TYPES[toSeg.type].median ?? 0) > 0;
    for (const d of [1, -1] as const) {
      if (!this.hasLanes(to.seg, d)) continue;
      if (divided && to.side && d !== to.side) continue; // across the median: go round and come back on the right side
      if (to.strict && to.side && d !== to.side && this.hasLanes(to.seg, to.side)) continue; // a bus pulls in at its own kerb
      goalKeys.set(dkey(to.seg, d), this.along(to.seg, d, to.s));
    }
    for (const d of [1, -1] as const) {
      if (!this.hasLanes(from.seg, d)) continue;
      if (startDir !== undefined && d !== startDir) continue;
      const k = dkey(from.seg, d);
      const L = this.segLen(k) || 1;
      const done = this.along(from.seg, d, from.s);
      // same seg, destination ahead: direct
      if (from.seg === to.seg && goalKeys.has(k) && goalKeys.get(k)! > done + 2) {
        const t = this.cost(k, (goalKeys.get(k)! - done) / L);
        return { keys: [k], time: t, freeFlow: (goalKeys.get(k)! - done) / this.limit(k) };
      }
      const c0 = this.cost(k, Math.max(0, 1 - done / L));
      g.set(k, c0);
      ff.set(k, ((L - done) / this.limit(k)));
      heap.push(k, c0 + H(k));
    }
    let expanded = 0;
    let bestGoal = -1, bestCost = Infinity;
    const closed = new Set<number>();
    while (heap.size && expanded++ < maxExpand) {
      const k = heap.pop();
      if (closed.has(k)) continue;
      closed.add(k);
      const gk = g.get(k)!;
      if (gk >= bestCost) break;
      for (const sc of this.succ(k)) {
        const nk = sc.k;
        let step = (sc.turn === "L" ? 2.5 : sc.turn === "U" ? 9 : sc.turn === "R" ? 1 : 0.3) + (sc.signal ? 4 : sc.stop ? 3 : 0);
        let ffStep = 0;
        const gl = goalKeys.get(nk);
        if (gl !== undefined) {
          const L = this.segLen(nk) || 1;
          const c = gk + step + this.cost(nk, gl / L);
          if (c < bestCost) {
            bestCost = c;
            bestGoal = nk;
            prev.set(-nk - 1, k); // goal marker
            ff.set(-nk - 1, (ff.get(k) ?? 0) + gl / this.limit(nk));
          }
        }
        step += this.cost(nk);
        ffStep = this.segLen(nk) / this.limit(nk);
        const ng = gk + step;
        if (ng < (g.get(nk) ?? Infinity)) {
          g.set(nk, ng);
          ff.set(nk, (ff.get(k) ?? 0) + ffStep);
          prev.set(nk, k);
          heap.push(nk, ng + H(nk));
        }
      }
    }
    if (bestGoal < 0) return null;
    const keys = [bestGoal];
    let cur = prev.get(-bestGoal - 1)!;
    const guard = new Set<number>();
    while (cur !== undefined && !guard.has(cur)) {
      guard.add(cur);
      keys.push(cur);
      cur = prev.get(cur)!;
    }
    keys.reverse();
    return { keys, time: bestCost, freeFlow: ff.get(-bestGoal - 1) ?? bestCost };
  }

  /**
   * Every seg a vehicle leaving `from` can reach within `maxT` seconds at the speed limits (with the same turn
   * and signal costs as routing): seg -> soonest arrival at its far end. A service's coverage area.
   */
  reach(from: Access, maxT: number): Map<number, number> {
    const out = new Map<number, number>();
    if (!this.net.segs.has(from.seg)) return out;
    const g = new Map<number, number>();
    const heap = new Heap();
    for (const d of [1, -1] as const) {
      if (!this.hasLanes(from.seg, d)) continue;
      const k = dkey(from.seg, d);
      const L = this.segLen(k) || 1;
      const t = (L - this.along(from.seg, d, from.s)) / this.limit(k);
      g.set(k, t);
      heap.push(k, t);
    }
    out.set(from.seg, 0);
    const closed = new Set<number>();
    while (heap.size) {
      const k = heap.pop();
      if (closed.has(k)) continue; // a stale entry: this key was already settled at a lower cost
      closed.add(k);
      const gk = g.get(k)!;
      if (gk > maxT) continue;
      const seg = dkSeg(k);
      // the whole seg is reachable once its far end is; its near end a bit sooner, so keep the better estimate
      const near = Math.max(0, gk - this.segLen(k) / this.limit(k));
      if (near < (out.get(seg) ?? Infinity)) out.set(seg, near);
      for (const sc of this.succ(k)) {
        const step = (sc.turn === "L" ? 2.5 : sc.turn === "U" ? 9 : sc.turn === "R" ? 1 : 0.3) + (sc.signal ? 4 : sc.stop ? 3 : 0);
        const ng = gk + step + this.segLen(sc.k) / this.limit(sc.k);
        if (ng < (g.get(sc.k) ?? Infinity)) { g.set(sc.k, ng); heap.push(sc.k, ng); }
      }
    }
    return out;
  }

  /** Route from the end of a directed seg (vehicle already on it, about to leave it) to a destination. */
  routeFromKey(k: number, to: Access): number[] | null {
    const seg = dkSeg(k), d = dkDir(k);
    const L = this.segLen(k);
    const r = this.route({ seg, s: d === 1 ? L - 0.1 : 0.1, p: { x: 0, y: 0 } }, to, d);
    if (!r) return null;
    if (r.keys[0] !== k) return null;
    return r.keys;
  }
}
