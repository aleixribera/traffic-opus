// Trucks at a works' gate under load (docs/playtest-2026-11-09.md, A16): "in the gate throat trailers jack-knife onto
// the grass and sit through other trucks". Three causes, none of them the trailers' own: a gate at the dead end of
// its street was treated as a driveway beside it, so every truck started with its tail laid sideways across the
// verge (END_GATE, sitegate.test.ts); the road past the gate seized, so they stood like that (gatejam.test.ts); and
// a truck rolled out of the gate while the body of the one before it, its front already in the junction, was still
// across the mouth. Here: the last of those, and the limit on how far a trailer is ever drawn folded.

import { describe, expect, it } from "vitest";
import { RoadNetwork } from "../src/roads/network";
import { MAX_BEND, Traffic, type Vehicle } from "../src/sim/traffic";
import { polyClosest, straightCubic, v2 } from "../src/core/math";
import { Industry } from "../src/game/industry";
import { DAY } from "../src/game/society";
import type { Game } from "../src/game/city";
import { buildGateJam, feed } from "./gatejam.scenario";
import { DT, Watch, acc, overlap, pieces, trip } from "./trafficWatch";

const wrap = (d: number) => { while (d > Math.PI) d -= 2 * Math.PI; while (d < -Math.PI) d += 2 * Math.PI; return Math.abs(d); };
/** The sharpest fold between a vehicle's pieces as drawn (rad). */
function bend(v: Vehicle): number {
  let m = 0;
  if (v.units && v.uPose) for (let k = 1; k < v.units.length; k++) m = Math.max(m, wrap(v.uPose[k * 4 + 3] - v.uPose[(k - 1) * 4 + 3]));
  return m;
}

/** A day of the play-test's company, watching every truck as it is drawn. */
function watchDay(g: Game) {
  const r = { fresh: 0, standing: 0, bend: 0, grass: 0, trains: 0, log: [] as string[] };
  const offRoad = (v: Vehicle, at: { x: number; y: number }) => {
    let best = polyClosest(v.edge.pl, at).d;
    for (const e of v.hist ?? []) best = Math.min(best, polyClosest(e.pl, at).d);
    if (best <= 4.5) return false;
    for (const sg of g.net.segGeom.values()) for (const l of sg.lanes) if (polyClosest(l.pl, at).d <= 4.5) return false;
    for (const ng of g.net.nodeGeom.values()) for (const c of ng.conns) if (polyClosest(c.pl, at).d <= 4.5) return false;
    return true;
  };
  let n = 0;
  for (const end = g.time + DAY; g.time < end;) {
    feed(g); g.step(g.dt);
    if (++n % 3) continue;
    const vs = g.traffic.vehicles as Vehicle[];
    const P = vs.map(pieces);
    for (let i = 0; i < vs.length; i++) {
      const v = vs[i];
      if (v.fade < 1) continue;
      if (v.units && v.units.length > 1) { r.trains++; r.bend = Math.max(r.bend, bend(v)); }
      // (out of its gate and standing in the queue: every piece of it over the road, none on the grass beside it)
      if (v.units && v.uPose && v.v < 0.3 && (v.odo ?? 0) > v.len + 5) for (let k = 0; k < v.units.length; k++) if (offRoad(v, { x: v.uPose[k * 4], y: v.uPose[k * 4 + 1] })) r.grass++;
      for (let j = i + 1; j < vs.length; j++) {
        const w = vs[j];
        if (w.fade < 1 || (!v.truck && !w.truck) || Math.hypot(v.x - w.x, v.y - w.y) > 40) continue;
        const fresh = g.time - v.born < 2 || g.time - w.born < 2, standing = v.v < 0.3 && w.v < 0.3;
        if (!fresh && !standing) continue;
        if (!P[i].some((p) => P[j].some((q) => overlap(p, q)))) continue;
        if (fresh) r.fresh++;
        if (standing) r.standing++;
        if (r.log.length < 8) r.log.push(`${v.id} (${v.len} m, ${v.v.toFixed(1)} m/s, out ${(g.time - v.born).toFixed(0)} s) through ${w.id} (${w.len} m, ${w.v.toFixed(1)} m/s, out ${(g.time - w.born).toFixed(0)} s) at ${v.x.toFixed(0)},${v.y.toFixed(0)}`);
      }
    }
  }
  return r;
}

describe("trucks at a busy works gate", () => {
  it("none rolls out of the gate into the one before it, none stands in another", () => {
    // the play-test's fleet: heavy rigid trucks, 12 m, out of a gate 15 m from the junction they wait at
    // (before: 98 sightings in this day of a truck drawn through another in its first two seconds out of the gate,
    // watching every third step; 181 with road trains)
    const s = buildGateJam({ sites: 2, pop: 600 });
    const r = watchDay(s.g);
    expect(r.fresh, r.log.join("\n")).toBe(0);
    expect(r.standing, r.log.join("\n")).toBe(0);
    expect(r.grass).toBe(0);
  }, 240000);

  it("road trains too, and their trailers are never folded past what a real one could be, least of all in the queue", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    (s.g as unknown as { bestTruck: () => string }).bestTruck = () => "roadtrain";
    const r = watchDay(s.g);
    expect(r.trains).toBeGreaterThan(2000);
    expect(r.fresh, r.log.join("\n")).toBe(0);
    expect(r.standing, r.log.join("\n")).toBe(0);
    expect(r.grass).toBe(0);
    expect(r.bend).toBeLessThanOrEqual(MAX_BEND + 1e-4);
  }, 240000);
});

describe("a road train's trailers", () => {
  /** Two streets meeting end to end at an angle (the interior angle, degrees), and a road train driven round it. */
  function hairpin(deg: number) {
    const net = new RoadNetwork();
    net.begin();
    const r = (deg * Math.PI) / 180;
    const A = net.addNode(v2(0, 0), 0), C = net.addNode(v2(200, 0), 0), B = net.addNode(v2(200 - Math.cos(r) * 200, Math.sin(r) * 200), 0);
    const s1 = net.addSeg(A, C, "street", straightCubic(net.nodes.get(A)!.p, net.nodes.get(C)!.p));
    const s2 = net.addSeg(C, B, "street", straightCubic(net.nodes.get(C)!.p, net.nodes.get(B)!.p));
    net.commit();
    net.rebuild();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    tr.request({
      from: acc(net, s1, 0.2), fromSide: 1, to: acc(net, s2, 0.9), toSide: 1, truck: true, tries: 0, wait: 0, through: true,
      trip: { ...trip(), haul: { plant: 0, leg: "out", product: "coal", n: 1, dest: 0, cls: "roadtrain" } }, ...Industry.body("roadtrain"),
    });
    const w = new Watch(net, tr);
    let worst = 0, t = 0;
    for (; t < 200 && (t < 1 || tr.vehicles.length || tr.pending.length); t += DT) {
      w.step();
      const v = (tr.vehicles as Vehicle[])[0];
      if (v) worst = Math.max(worst, bend(v));
    }
    return { worst: (worst * 180) / Math.PI, w, left: tr.vehicles.length };
  }

  it("follow the tractor round any corner a road can make, and fold no further than 75 degrees round one it can't", () => {
    // a right angle, and a corner sharper than the road tool lets anyone draw: the trailers ride the driven path
    for (const deg of [90, 40]) {
      const r = hairpin(deg);
      expect(r.left).toBe(0);
      expect(r.worst, `${deg} degrees`).toBeGreaterThan(40);
      expect(r.worst, `${deg} degrees`).toBeLessThan(66);
      expect(r.w.jumps + r.w.snaps + r.w.offRoad, `${deg} degrees\n${r.w.log.join("\n")}`).toBe(0);
    }
    // doubled back on itself (15 degrees between the two roads; unlimited, a trailer was drawn folded 101 degrees
    // round): at the limit and no further, and no piece jumps as the limit takes hold or lets go
    const r = hairpin(15);
    expect(r.left).toBe(0);
    expect(r.worst).toBeGreaterThan(74.9);
    expect(r.worst).toBeLessThanOrEqual((MAX_BEND * 180) / Math.PI + 1e-3);
    expect(r.w.jumps, r.w.log.join(" | ")).toBe(0);
  });
});
