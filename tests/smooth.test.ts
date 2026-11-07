import { describe, it, expect } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import { polyAt, straightCubic, v2 } from "../src/core/math";
import type { RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

// What a player sees, frame by frame: every car's drawn pose moves continuously (no jumps, no freezing while
// it is driving, no heading snaps), cars don't brake for junctions nothing is crossing, and a car's go-ahead
// at a junction doesn't flicker on and off (which shows as stop-start driving).

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "street") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
const acc = (net: RoadNetwork, seg: number, frac: number): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s) };
};
const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });
const DT = 1 / 30;

interface Track { hard: number; jumps: number; freezes: number; snaps: number; maxYaw: number; stops: number; moving: boolean; revoked: number; granted: boolean; flips: number; braking: number; minV: number }

/** Watches every vehicle each step. */
class Probe {
  t = new Map<number, Track>();
  worst = { jump: 0, yaw: 0 };
  hits = 0; // two cars drawn on top of each other
  log: string[] = [];
  /** `near`: where stop-start counts (default everywhere); arriving at a driveway is a legitimate stop. */
  constructor(private tr: Traffic, private near: (v: Vehicle) => boolean = () => true) {}
  step() {
    this.tr.step(DT);
    const vs = this.tr.vehicles as Vehicle[];
    for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i], b = vs[j];
      if (Math.abs(a.x - b.x) < 2 && Math.abs(a.y - b.y) < 2 && Math.hypot(a.x - b.x, a.y - b.y) < 2 && Math.abs(a.h - b.h) < 2) {
        this.hits++;
        if (this.log.length < 12) this.log.push(`hit ${a.id}/${b.id} ${(a.edge as any).kind}/${(b.edge as any).kind} at ${a.x.toFixed(0)},${a.y.toFixed(0)}`);
      }
    }
    for (const v of this.tr.vehicles as Vehicle[]) {
      let k = this.t.get(v.id);
      if (!k) { this.t.set(v.id, (k = { hard: 0, jumps: 0, freezes: 0, snaps: 0, maxYaw: 0, stops: 0, moving: false, revoked: 0, granted: v.granted, flips: 0, braking: 0, minV: Infinity })); continue; }
      if (v.fade < 1 || v.leaving > 0) continue; // pulling out of / into a driveway
      const d = Math.hypot(v.x - v.px, v.y - v.py);
      const exp = v.v * DT;
      if (d > exp * 1.6 + 0.12) { k.jumps++; this.worst.jump = Math.max(this.worst.jump, d - exp); if (this.log.length < 12) this.log.push(`jump car ${v.id} ${(v.edge as any).kind} d=${d.toFixed(2)} exp=${exp.toFixed(2)} s=${v.s.toFixed(2)} lat=${v.lat.toFixed(2)} dang=${(v.ang - v.pang).toFixed(3)} destS=${v.destS.toFixed(1)} block=${v.block}`); }
      if (v.v > 2 && d < exp * 0.4) { k.freezes++; if (this.log.length < 12) this.log.push(`freeze car ${v.id} ${(v.edge as any).kind} s=${v.s.toFixed(1)} d=${d.toFixed(3)} exp=${exp.toFixed(2)}`); }
      let da = v.ang - v.pang;
      while (da > Math.PI) da -= 2 * Math.PI;
      while (da < -Math.PI) da += 2 * Math.PI;
      const yaw = Math.abs(da) / DT;
      k.maxYaw = Math.max(k.maxYaw, yaw);
      this.worst.yaw = Math.max(this.worst.yaw, yaw);
      if (yaw > 1.6) k.snaps++;
      if (v.v > 3) k.moving = true;
      if (k.moving && v.v < 0.3) { k.stops++; k.moving = false; }
      if (k.granted && !v.granted && v.edge.kind === "lane" && v.next) k.revoked++;
      k.granted = v.granted;
      // braking then accelerating then braking again: count each switch into braking
      const br = v.acc < -0.8, ac = v.acc > 0.8;
      if (br && k.braking === 1 && this.near(v)) k.flips++;
      // an emergency stop (at speed; counted once each, until it next speeds up)
      if (v.acc < -4 && v.v > 3 && k.braking !== -2) { k.hard++; k.braking = -2; }
      else if (br && k.braking !== -2) k.braking = -1;
      else if (ac) k.braking = 1;
      k.minV = Math.min(k.minV, v.v);
    }
  }
  sum(f: (k: Track) => number) { let s = 0; for (const k of this.t.values()) s += f(k); return s; }
  max(f: (k: Track) => number) { let s = 0; for (const k of this.t.values()) s = Math.max(s, f(k)); return s; }
}

function cross(type: RoadTypeId = "street") {
  const net = new RoadNetwork();
  net.begin();
  const C = net.addNode(v2(300, 300), 0);
  const ends = [v2(600, 300), v2(0, 300), v2(300, 0), v2(300, 600)].map((p) => net.addNode(p, 0));
  const segs = ends.map((e) => road(net, e, C, type)); // E, W, N, S arms, each pointing into the junction
  net.commit();
  net.rebuild();
  return { net, segs, C };
}

describe("Smooth driving", () => {
  it("drives straight through an empty junction without braking", () => {
    const { net, segs } = cross();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    // W arm -> E arm (straight across)
    tr.request({ from: acc(net, segs[1], 0.1), fromSide: 1, to: acc(net, segs[0], 0.2), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
    const p = new Probe(tr);
    let minV = Infinity, cruise = 0;
    for (let t = 0; t < 60 && (t < 1 || tr.vehicles.length); t += DT) {
      p.step();
      const v = (tr.vehicles as Vehicle[])[0];
      if (!v) continue;
      cruise = Math.max(cruise, v.v);
      // from first reaching cruising speed until well past the junction
      if (cruise > 0.95 * net.segGeom.get(segs[1])!.lanes[0].speed && Math.hypot(v.x - 300, v.y - 300) < 120) minV = Math.min(minV, v.v);
    }
    const lim = net.segGeom.get(segs[1])!.lanes[0].speed;
    expect(minV / lim, `slowed to ${minV.toFixed(1)} of ${lim.toFixed(1)} m/s`).toBeGreaterThan(0.9);
    expect(p.sum((k) => k.jumps + k.freezes), p.log.join("\n")).toBe(0);
  });

  it("turns at an empty junction at turning speed, without stopping, along a smooth path", () => {
    // W arm -> S arm (a right turn, driving on the right), N arm -> E arm (a left turn), by car and by truck
    for (const [truck, from, to] of [[false, 1, 3], [false, 2, 0], [true, 1, 3], [true, 2, 0]] as [boolean, number, number][]) {
      const { net, segs } = cross();
      const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
      tr.request({ from: acc(net, segs[from], 0.1), fromSide: 1, to: acc(net, segs[to], 0.2), toSide: 1, trip: trip(), truck, tries: 0, wait: 0, through: true });
      const p = new Probe(tr, (v) => Math.hypot(v.x - 300, v.y - 300) < 150);
      for (let t = 0; t < 60 && (t < 1 || tr.vehicles.length); t += DT) p.step();
      expect(p.sum((k) => k.stops), "stopped at an empty junction").toBe(0);
      expect(p.sum((k) => k.jumps + k.freezes), p.log.join("\n")).toBe(0);
      expect(p.worst.yaw, "heading snapped").toBeLessThan(1.6);
      expect(p.max((k) => k.flips), "braked, sped up and braked again").toBeLessThanOrEqual(1);
    }
  });

  it("keeps a busy four-way junction smooth: no pose glitches, grants that stick, no emergency stops, few stop-starts", () => {
    const { net, segs } = cross();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    // stop-start counted round the junction (cars arrive at driveways further out: a legitimate stop).
    // Through traffic comes in at the far ends of the arms, as it would from the edge of the map.
    const p = new Probe(tr, (v) => Math.hypot(v.x - 300, v.y - 300) < 150);
    let k = 0;
    for (let t = 0; t < 240; t += DT) {
      if (t > k * 1.6 && k < 120) {
        const a = segs[k % 4], b = segs[(k * 3 + 1 + (k >> 2)) % 4];
        k++;
        if (a !== b) tr.request({ from: acc(net, a, 0.02), fromSide: 1, to: acc(net, b, 0.3), toSide: 1, trip: trip(), truck: k % 5 === 0, tries: 0, wait: 0, through: true });
      }
      p.step();
    }
    const n = p.t.size;
    const rep = `cars ${n} hits ${p.hits} jumps ${p.sum((k) => k.jumps)} freezes ${p.sum((k) => k.freezes)} snaps ${p.sum((k) => k.snaps)} worstYaw ${p.worst.yaw.toFixed(2)} revoked ${p.sum((k) => k.revoked)} hardBrakes ${p.sum((k) => k.hard)} stops/car ${(p.sum((k) => k.stops) / n).toFixed(2)} flips/car ${(p.sum((k) => k.flips) / n).toFixed(2)} maxFlips ${p.max((k) => k.flips)}`;
    const why = rep + "\n" + p.log.join("\n");
    expect(p.hits, why).toBe(0);
    expect(p.sum((k) => k.jumps + k.freezes), why).toBe(0);
    expect(p.sum((k) => k.snaps), rep).toBe(0);
    expect(p.sum((k) => k.revoked) / n, rep).toBeLessThan(0.03);
    // emergency stops: a car that has to brake harder than a driver would choose to
    expect(p.sum((k) => k.hard) / n, rep).toBeLessThan(0.05);
    // most cars roll through without coming to a halt; stop-start is rare and never repeated much
    expect(p.sum((k) => k.stops) / n, rep).toBeLessThan(0.3);
    expect(p.sum((k) => k.flips) / n, rep).toBeLessThan(0.8);
    expect(p.max((k) => k.flips), rep).toBeLessThanOrEqual(2);
  });
});
