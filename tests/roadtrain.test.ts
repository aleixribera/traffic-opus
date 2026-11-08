// Road trains in traffic (a sibling of smooth.test.ts): a 22 m articulated truck turns through a junction and round
// a small roundabout along the path its front drove, never drawn through another vehicle, its pieces moving
// smoothly; and mixed with cars it doesn't jam either.

import { describe, expect, it } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { commitRoundabout, planRoundabout, type BuildWorld } from "../src/roads/planner";
import { Traffic, type PendingSpawn, type Trip, type Vehicle } from "../src/sim/traffic";
import { polyAt, polyClosest, straightCubic, v2 } from "../src/core/math";
import type { Access } from "../src/sim/router";
import { Industry } from "../src/game/industry";
import { TRUCK_CLASSES, type TruckClass } from "../src/game/trucks";

const DT = 1 / 30;
const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
const world: BuildWorld = { isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9 };

function road(net: RoadNetwork, a: number, b: number) {
  return net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
const acc = (net: RoadNetwork, seg: number, frac: number): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s) };
};

/** Four arms meeting at (300, 300): E, W, N, S, each pointing into the middle; a roundabout there if asked. */
function net4(ring: 0 | 1 | 2) {
  const net = new RoadNetwork();
  net.begin();
  const C = net.addNode(v2(300, 300), 0);
  const ends = [v2(600, 300), v2(0, 300), v2(300, 0), v2(300, 600)].map((p) => net.addNode(p, 0));
  for (const e of ends) road(net, e, C);
  net.commit();
  net.rebuild();
  if (ring) {
    const plan = planRoundabout(net, world, v2(300, 300), ring, 0);
    expect(plan.errors).toEqual([]);
    net.begin();
    commitRoundabout(net, plan);
    net.rebuild();
    net.commit();
  }
  // the arms: the segments that reach the far ends
  // (by where they end: the roundabout rebuilds the arms)
  const P = [v2(600, 300), v2(0, 300), v2(300, 0), v2(300, 600)];
  const near = (n: number, q: { x: number; y: number }) => Math.hypot(net.nodes.get(n)!.p.x - q.x, net.nodes.get(n)!.p.y - q.y) < 1;
  const arms = P.map((q) => [...net.segs.values()].find((s) => near(s.a, q) || near(s.b, q))!.id);
  return { net, arms };
}

const want = (net: RoadNetwork, from: number, to: number, cls: TruckClass | null): PendingSpawn => ({
  from: acc(net, from, 0.04), fromSide: 1, to: acc(net, to, 0.5), toSide: 1, trip: cls ? { ...trip(), haul: { plant: 0, leg: "out", product: "coal", n: 1, dest: 0, cls } } : trip(),
  truck: !!cls, tries: 0, wait: 0, through: true, ...Industry.body(cls ?? undefined),
});

/** Each drawn piece of each vehicle: where it is, which way it faces, how long and wide. */
function pieces(v: Vehicle): { x: number; y: number; a: number; hl: number; hw: number }[] {
  if (v.units && v.uPose) return v.units.map((u, i) => ({ x: v.uPose![i * 4], y: v.uPose![i * 4 + 1], a: v.uPose![i * 4 + 3], hl: u.len / 2, hw: 1.25 }));
  return [{ x: v.x, y: v.y, a: v.ang, hl: v.len / 2, hw: v.truck ? 1.25 : 0.95 }];
}

/** Do two drawn pieces overlap (oriented rectangles, separating axes, with a little give)? */
function overlap(p: ReturnType<typeof pieces>[number], q: ReturnType<typeof pieces>[number], give = 0.35): boolean {
  const ax = [p.a, p.a + Math.PI / 2, q.a, q.a + Math.PI / 2];
  for (const t of ax) {
    const ux = Math.cos(t), uy = Math.sin(t);
    const r = (o: typeof p) => Math.abs(o.hl * (Math.cos(o.a) * ux + Math.sin(o.a) * uy)) + Math.abs(o.hw * (-Math.sin(o.a) * ux + Math.cos(o.a) * uy));
    const d = Math.abs((q.x - p.x) * ux + (q.y - p.y) * uy);
    if (d > r(p) + r(q) - give) return false;
  }
  return true;
}

class Watch {
  clips = 0;
  jumps = 0;
  snaps = 0;
  offRoad = 0;
  log: string[] = [];
  private last = new Map<number, Float32Array>();
  constructor(private net: RoadNetwork, private tr: Traffic) {}
  step() {
    this.tr.step(DT);
    const vs = this.tr.vehicles as Vehicle[];
    const P = vs.map(pieces);
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      // (only the bodies of two vehicles: a car can't be inside a trailer)
      if (Math.hypot(vs[i].x - vs[j].x, vs[i].y - vs[j].y) > 40) continue;
      if (vs[i].fade < 1 || vs[j].fade < 1) continue;
      for (const p of P[i]) for (const q of P[j]) if (overlap(p, q)) {
        this.clips++;
        if (this.log.length < 10) this.log.push(`clip ${vs[i].id}(${vs[i].len}) ${vs[j].id}(${vs[j].len}) at ${p.x.toFixed(0)},${p.y.toFixed(0)} edges ${vs[i].edge.kind}/${vs[j].edge.kind}`);
      }
    }
    for (const v of vs) {
      if (!v.units || !v.uPose) continue;
      const prev = this.last.get(v.id);
      if (prev && v.fade >= 1) for (let k = 0; k < v.units.length; k++) {
        const o = k * 4, d = Math.hypot(v.uPose[o] - prev[o], v.uPose[o + 1] - prev[o + 1]);
        if (d > v.v * DT * 1.8 + 0.15) { this.jumps++; if (this.log.length < 10) this.log.push(`piece ${k} of ${v.id} jumped ${d.toFixed(2)} at v=${v.v.toFixed(1)}`); }
        let da = v.uPose[o + 3] - prev[o + 3];
        while (da > Math.PI) da -= 2 * Math.PI;
        while (da < -Math.PI) da += 2 * Math.PI;
        if (Math.abs(da) / DT > 1.6) this.snaps++;
        // each trailer's middle stays over the carriageway (the nearest lane's centre within a lane and a half)
        let best = Infinity;
        const at = { x: v.uPose[o], y: v.uPose[o + 1] };
        for (const g of this.net.segGeom.values()) for (const l of g.lanes) best = Math.min(best, polyClosest(l.pl, at).d);
        for (const n of this.net.nodeGeom.values()) for (const c of n.conns) best = Math.min(best, polyClosest(c.pl, at).d);
        if (best > 4.5) { this.offRoad++; if (this.log.length < 10) this.log.push(`piece ${k} of ${v.id} ${best.toFixed(1)} m off the road`); }
      }
      this.last.set(v.id, Float32Array.from(v.uPose));
    }
  }
}

describe("Road trains", () => {
  it("turn through an empty junction and round a small roundabout along the driven path, pieces smooth", () => {
    for (const ring of [0, 1] as const) for (const [from, to] of [[1, 3], [2, 0], [1, 0], [0, 2]]) {
      const { net, arms } = net4(ring);
      const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
      tr.request(want(net, arms[from], arms[to], "roadtrain"));
      const w = new Watch(net, tr);
      let seen = false, t = 0;
      for (; t < 120 && (t < 1 || tr.vehicles.length || tr.pending.length); t += DT) {
        w.step();
        const v = (tr.vehicles as Vehicle[])[0];
        if (v) { seen = true; expect(v.len).toBe(TRUCK_CLASSES.roadtrain.len); }
      }
      const why = `ring ${ring} ${from}->${to}\n${w.log.join("\n")}`;
      expect(seen, why).toBe(true);
      expect(tr.vehicles.length, `still driving after ${t.toFixed(0)} s: ${why}`).toBe(0);
      expect(w.jumps, why).toBe(0);
      expect(w.snaps, why).toBe(0);
      expect(w.offRoad, why).toBe(0);
    }
  });

  it("mixed with cars through a busy junction and a roundabout: nothing drawn through anything, no jam", () => {
    for (const ring of [0, 1, 2] as const) {
      const { net, arms } = net4(ring);
      let done = 0;
      const tr = new Traffic(net, { arrive: () => { done++; }, fail: () => { done++; } });
      const w = new Watch(net, tr);
      let k = 0, asked = 0;
      // a burst first, from every arm at once (long ones get go-aheads early: together they mustn't overfill a ring)
      for (; k < 12; k++) {
        const a = arms[k % 4], b = arms[(k * 3 + 1 + (k >> 2)) % 4];
        if (a !== b) { tr.request(want(net, a, b, k % 3 === 0 ? "roadtrain" : k % 3 === 1 ? "heavy" : null)); asked++; }
      }
      for (let t = 0; t < 200; t += DT) {
        if (t > (k - 12) * 2.2 && k < 72) {
          const a = arms[k % 4], b = arms[(k * 3 + 1 + (k >> 2)) % 4];
          const cls: TruckClass | null = k % 3 === 0 ? "roadtrain" : k % 7 === 0 ? "heavy" : null;
          k++;
          if (a !== b) { tr.request(want(net, a, b, cls)); asked++; }
        }
        w.step();
      }
      // then let it drain
      let t = 0;
      for (; t < 240 && (tr.vehicles.length || tr.pending.length); t += DT) w.step();
      const why = `ring ${ring}: ${done}/${asked} done, ${tr.vehicles.length} on the road after ${t.toFixed(0)} s more\n${w.log.join("\n")}`;
      expect(tr.vehicles.length + tr.pending.length, why).toBe(0);
      expect(w.clips, why).toBe(0);
      expect(w.jumps, why).toBe(0);
      expect(w.offRoad, why).toBe(0);
    }
  });

  it("holds a junction longer than a light truck: its whole length has to clear the box", () => {
    const time = (cls: TruckClass) => {
      const { net, arms } = net4(0);
      const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
      tr.request(want(net, arms[1], arms[3], cls));
      let held = 0;
      for (let t = 0; t < 120 && (t < 1 || tr.vehicles.length || tr.pending.length); t += DT) {
        tr.step(DT);
        // in the box: from its front crossing the line until it lets the junction go
        if ((tr.vehicles as Vehicle[]).some((v) => v.holding && v.edge !== v.holding.from)) held += DT;
      }
      return held;
    };
    const light = time("light"), rt = time("roadtrain");
    expect(light).toBeGreaterThan(1);
    expect(rt, `road train ${rt.toFixed(2)} s, light ${light.toFixed(2)} s`).toBeGreaterThan(light * 1.4);
  });
});

describe("a lot's gate", () => {
  it("lets one long truck at a time roll out of a lot, the next only once the last one's tail has cleared the kerb", () => {
    const { net, arms } = net4(0);
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    // three road trains and a car asked for at once from the same building (lot 7), not entering from off-map
    const lot = (cls: TruckClass | null): PendingSpawn => {
      const p = want(net, arms[0], arms[1], cls);
      p.through = false; p.t0 = 0; p.trip.from = 7;
      return p;
    };
    const ps = [lot("roadtrain"), lot("roadtrain"), lot(null), lot("roadtrain")];
    for (const p of ps) tr.request(p);
    const out = new Map<PendingSpawn, number>();
    let last: Vehicle | undefined;
    let starts = 0;
    for (let t = 0; t < 90 && out.size < ps.length; t += DT) {
      const before = new Set(tr.pending.filter((p) => p.go !== undefined));
      tr.step(DT);
      // only one long truck rolls out of the gate at a time (the renderer draws just that one)
      const going = tr.pending.filter((p) => (p.len ?? 0) >= 10 && p.go !== undefined);
      expect(going.length).toBeLessThanOrEqual(1);
      for (const p of going) {
        if (before.has(p)) continue;
        // it starts only once the road train before it has pulled clear of the kerb (or gone)
        starts++;
        if (last && tr.vehicles.includes(last)) expect(Math.hypot(last.x - p.from.p.x, last.y - p.from.p.y)).toBeGreaterThanOrEqual(last.len / 2 + 5);
      }
      for (const p of ps) if (!out.has(p) && !tr.pending.includes(p)) {
        out.set(p, tr.time);
        if (p.len) last = tr.vehicles.find((v) => v.trip.haul === p.trip.haul);
      }
    }
    expect(out.size).toBe(ps.length);
    expect(starts).toBe(3);
    const rt = [ps[0], ps[1], ps[3]].map((p) => out.get(p)!).sort((a, b) => a - b);
    // each road train has the gate to itself for at least the time it takes to roll out of the lot
    expect(rt[1] - rt[0]).toBeGreaterThanOrEqual(2.5);
    expect(rt[2] - rt[1]).toBeGreaterThanOrEqual(2.5);
    // a car doesn't queue for the gate
    expect(out.get(ps[2])!).toBeLessThan(rt[1]);
  });
});
