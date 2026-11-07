import { describe, it, expect } from "vitest";
import { RoadNetwork, type Lane } from "../src/roads/network";
import { Traffic, type Trip, type Vehicle } from "../src/sim/traffic";
import { polyAt, polyDirSmooth, straightCubic, v2 } from "../src/core/math";
import { LANE_W, type RoadTypeId } from "../src/config";
import type { Access } from "../src/sim/router";

function road(net: RoadNetwork, a: number, b: number, type: RoadTypeId = "street") {
  return net.addSeg(a, b, type, straightCubic(net.nodes.get(a)!.p, net.nodes.get(b)!.p));
}
const acc = (net: RoadNetwork, seg: number, frac: number): Access => {
  const g = net.segGeom.get(seg)!;
  const s = g.center.length * frac;
  return { seg, s, p: polyAt(g.center, s) };
};
const trip = (): Trip => ({ kind: "shop", from: 0, to: 0, resident: -1, startT: 0, freeFlow: 0 });

/** Streets crossing at X (0,0): w from the west, e to the east, n to the north, s to the south (all one lane each way). */
function cross(type: RoadTypeId = "street") {
  const net = new RoadNetwork();
  net.begin();
  const X = net.addNode(v2(0, 0), 0);
  const W = net.addNode(v2(-400, 0), 0), E = net.addNode(v2(400, 0), 0), N = net.addNode(v2(0, -300), 0), S = net.addNode(v2(0, 300), 0);
  const w = road(net, W, X, type), e = road(net, X, E, type), n = road(net, X, N, type), s = road(net, X, S, type);
  net.commit();
  net.rebuild();
  return { net, X, w, e, n, s };
}

const into = (net: RoadNetwork, seg: number, dir: 1 | -1) => net.segGeom.get(seg)!.lanes.filter((l) => l.dir === dir).sort((a, b) => a.idx - b.idx);

describe("Turn pockets", () => {
  it("a left-turn pocket is a short extra lane that takes the left turns; the through lane swings over for it", () => {
    const { net, X, w, n, s, e } = cross();
    net.begin();
    net.setPocket(w, "b", { r: 0, l: 40 });
    const ops = net.commit();
    net.rebuild();
    const ls = into(net, w, 1);
    expect(ls.map((l) => l.pocket ?? "-")).toEqual(["-", "l"]);
    const [thru, pk] = ls;
    expect(pk.pl.length).toBeGreaterThan(38);
    expect(pk.pl.length).toBeLessThan(42);
    expect(thru.pl.length).toBeGreaterThan(300);
    // at the stop line the pocket sits where the through lane was, and the through lane a lane further out
    const end = (l: typeof pk) => l.pl.pts[l.pl.pts.length - 1];
    expect(end(pk).y).toBeCloseTo(0.5 * LANE_W, 1); // (+y is the right of a west->east road)
    expect(end(thru).y).toBeCloseTo(1.5 * LANE_W, 1);
    // well back from the junction the through lane is on its usual line
    expect(thru.pl.pts[0].y).toBeCloseTo(0.5 * LANE_W, 1);
    const conns = net.nodeGeom.get(X)!.conns.filter((c) => c.from.seg === w);
    const turns = (l: typeof pk) => conns.filter((c) => c.from === l).map((c) => `${c.turn}:${c.to.seg}`).sort();
    expect(turns(pk)).toEqual([`L:${n}`]);
    expect(turns(thru)).toEqual([`R:${s}`, `S:${e}`]);
    // the road is wider there: the junction's mouth on that arm widens too
    const arm = net.nodeGeom.get(X)!.arms.find((a) => a.seg === w)!;
    expect(arm.wL).toBeCloseTo(LANE_W);
    // undo takes it away again
    net.undo(ops);
    net.rebuild();
    expect(into(net, w, 1).length).toBe(1);
    expect(net.segs.get(w)!.pk).toBeUndefined();
  });

  it("a right-turn pocket takes the right turns; both pockets together", () => {
    const { net, X, w, n, s, e } = cross();
    net.begin();
    net.setPocket(w, "b", { r: 30, l: 50 });
    net.commit();
    net.rebuild();
    const ls = into(net, w, 1);
    expect(ls.map((l) => l.idx)).toEqual([-1, 0, 1]);
    const conns = net.nodeGeom.get(X)!.conns.filter((c) => c.from.seg === w);
    const turns = (idx: number) => conns.filter((c) => c.from.idx === idx).map((c) => `${c.turn}:${c.to.seg}`).sort();
    expect(turns(-1)).toEqual([`R:${s}`]);
    expect(turns(0)).toEqual([`S:${e}`]);
    expect(turns(1)).toEqual([`L:${n}`]);
    // right pocket outside the swung-over through lane
    const end = (l: (typeof ls)[number]) => l.pl.pts[l.pl.pts.length - 1];
    expect(end(ls[0]).y).toBeCloseTo(2.5 * LANE_W, 1);
    expect(end(ls[1]).y).toBeCloseTo(1.5 * LANE_W, 1);
  });

  it("pockets survive a save, a split of the road and a flip of a one-way", () => {
    const { net, w } = cross();
    net.begin();
    net.setPocket(w, "b", { r: 0, l: 40 });
    net.commit();
    net.rebuild();
    const copy = new RoadNetwork();
    copy.load(JSON.parse(JSON.stringify(net.toJSON())));
    copy.rebuildAll();
    expect(into(copy, w, 1).map((l) => l.pocket ?? "-")).toEqual(["-", "l"]);
    // a road joining part-way along: the pocket stays before the junction
    net.begin();
    const mid = net.splitSeg(w, 0.4);
    net.commit();
    net.rebuild();
    const near = [...net.segs.values()].find((x) => x.a === mid && x.b !== mid)!;
    expect(near.pk?.b).toEqual({ r: 0, l: 40 });
    expect(into(net, near.id, 1).map((l) => l.pocket ?? "-")).toEqual(["-", "l"]);
  });

  it("through traffic keeps moving past cars waiting to turn left across oncoming traffic", () => {
    const run = (pocket: boolean) => {
      const { net, w, e, n } = cross();
      if (pocket) {
        net.begin();
        net.setPocket(w, "b", { r: 0, l: 45 });
        net.commit();
        net.rebuild();
      }
      let through = 0, hard = 0, sideways = 0;
      const tr = new Traffic(net, { arrive: (v: Vehicle) => { if (v.trip.kind === "work") through++; }, fail: () => {} });
      let k = 0;
      for (let t = 0; t < 240; t += 1 / 30) {
        if (t > k * 2.4) {
          k++;
          // eastbound: one in three turns left (north) across a steady westbound stream
          const left = k % 3 === 0;
          tr.request({ from: acc(net, w, 0.05), fromSide: 1, to: left ? acc(net, n, 0.9) : acc(net, e, 0.9), toSide: 1, trip: { ...trip(), kind: left ? "shop" : "work" }, truck: false, tries: 0, wait: 0, through: true });
          tr.request({ from: acc(net, e, 0.95), fromSide: -1, to: acc(net, w, 0.05), toSide: -1, trip: trip(), truck: k % 5 === 0, tries: 0, wait: 0, through: true });
        }
        tr.step(1 / 30);
        for (const v of tr.vehicles as Vehicle[]) {
          if (v.acc < -4 && v.v > 3) hard++;
          // a car moving over into the pocket points along the road, never across it (even from a standstill)
          if (v.edge.kind === "lane" && v.lcFrom) {
            const d = polyDirSmooth(v.edge.pl, Math.min(v.s, v.edge.pl.length), 1);
            const off = Math.abs(Math.atan2(Math.sin(v.ang - Math.atan2(d.y, d.x)), Math.cos(v.ang - Math.atan2(d.y, d.x))));
            if (off > 0.6) sideways++;
          }
        }
      }
      return { through, hard, sideways };
    };
    const without = run(false), withP = run(true);
    expect(withP.through, `through cars delivered: ${without.through} without a pocket, ${withP.through} with`).toBeGreaterThan(without.through * 1.15);
    expect(withP.hard).toBeLessThan(60);
    expect(withP.sideways, "frames a lane-changing car pointed more than 35° off its lane").toBe(0);
  }, 60000);

  it("a car that moves over at a standstill slides across, still pointing along the road", () => {
    // a two-lane one-way road; the car stops, then changes lane where it stands (as into a pocket beside a queue)
    const net = new RoadNetwork();
    net.begin();
    const w = road(net, net.addNode(v2(-400, 0), 0), net.addNode(v2(400, 0), 0), "one2");
    net.commit();
    net.rebuild();
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    tr.request({ from: acc(net, w, 0.1), fromSide: 1, to: acc(net, w, 0.9), toSide: 1, trip: trip(), truck: false, tries: 0, wait: 0, through: true });
    let v: Vehicle | undefined;
    for (let i = 0; i < 30 * 30 && !(v && v.edge.kind === "lane" && v.lat === 0 && v.v > 5); i++) { tr.step(1 / 30); v = (tr.vehicles as Vehicle[])[0]; }
    expect(v?.edge.kind).toBe("lane");
    const hold = () => { v!.v = 0; tr.step(1 / 30); };
    for (let i = 0; i < 60; i++) hold();
    // what laneChange's commit does: same spot, the other lane, the offset still to steer across
    const from = v!.edge as Lane, to = net.segGeom.get(w)!.lanes.find((l) => l !== from)!;
    (from.occ as Vehicle[]).splice((from.occ as Vehicle[]).indexOf(v!), 1);
    v!.lat += from.offset - to.offset;
    v!.edge = to;
    (to.occ as Vehicle[]).push(v!);
    v!.lcFrom = from;
    v!.lcCool = 99;
    let worst = 0;
    for (let i = 0; i < 30 * 10; i++) {
      hold();
      worst = Math.max(worst, Math.abs(Math.atan2(Math.sin(v!.ang), Math.cos(v!.ang)))); // the road runs along +x
    }
    expect(Math.abs(v!.lat), "it still gets over").toBeLessThan(0.5);
    expect(worst, "most it turned away from the road (rad)").toBeLessThan(0.1);
  });
});
