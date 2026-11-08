// Traffic test fixtures shared by the convoy tests (copied from roadtrain.test.ts, which keeps its own): a four-arm
// junction with an optional roundabout, and a watcher that counts long vehicles' pieces drawn through others,
// jumping, snapping round or leaving the carriageway.

import { expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { commitRoundabout, planRoundabout, type BuildWorld } from "../src/roads/planner";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import { polyAt, polyClosest, straightCubic, v2 } from "../src/core/math";
import type { Access } from "../src/sim/router";

export const DT = 1 / 30;
export const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
export const world: BuildWorld = { isWater: () => false, isMountain: () => false, inBounds: () => true, buildingsHit: () => [], money: () => 1e9 };

export function road(net: RoadNetwork, a: number, b: number) {
  return net.addSeg(a, b, "street", straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
export const acc = (net: RoadNetwork, seg: number, frac: number): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s) };
};

/** Four arms meeting at (300, 300): E, W, N, S, each pointing into the middle; a roundabout there if asked. */
export function net4(ring: 0 | 1 | 2) {
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

/** Each drawn piece of each vehicle: where it is, which way it faces, how long and wide. */
export function pieces(v: Vehicle): { x: number; y: number; a: number; hl: number; hw: number }[] {
  if (v.units && v.uPose) return v.units.map((u, i) => ({ x: v.uPose![i * 4], y: v.uPose![i * 4 + 1], a: v.uPose![i * 4 + 3], hl: u.len / 2, hw: 1.25 }));
  return [{ x: v.x, y: v.y, a: v.ang, hl: v.len / 2, hw: v.truck ? 1.25 : 0.95 }];
}

/** Do two drawn pieces overlap (oriented rectangles, separating axes, with a little give)? */
export function overlap(p: ReturnType<typeof pieces>[number], q: ReturnType<typeof pieces>[number], give = 0.35): boolean {
  const ax = [p.a, p.a + Math.PI / 2, q.a, q.a + Math.PI / 2];
  for (const t of ax) {
    const ux = Math.cos(t), uy = Math.sin(t);
    const r = (o: typeof p) => Math.abs(o.hl * (Math.cos(o.a) * ux + Math.sin(o.a) * uy)) + Math.abs(o.hw * (-Math.sin(o.a) * ux + Math.cos(o.a) * uy));
    const d = Math.abs((q.x - p.x) * ux + (q.y - p.y) * uy);
    if (d > r(p) + r(q) - give) return false;
  }
  return true;
}

export class Watch {
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

