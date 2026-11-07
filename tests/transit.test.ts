import { describe, it, expect } from "vitest";
import { Game } from "../src/game/city";
import { v2 } from "../src/core/math";
import type { Lane } from "../src/roads/network";
import { okCells, road, run, zoneFor } from "./helpers";

/** Seed 7: shops and workplaces by the long street in, and a suburb a kilometre up the road (too far to walk). */
function town(g: Game) {
  road(g, v2(366, 473), v2(0, 0));
  road(g, v2(-200, 0), v2(0, 0));
  road(g, v2(0, 0), v2(0, -300));
  road(g, v2(-200, 0), v2(-200, -300));
  road(g, v2(-200, -300), v2(0, -300));
  road(g, v2(-200, -150), v2(0, -150));
  road(g, v2(-200, -300), v2(-200, -1000));
  road(g, v2(-200, -1000), v2(0, -1000));
  road(g, v2(0, -1000), v2(0, -850));
  road(g, v2(-200, -850), v2(0, -850));
  const cells = okCells(g);
  zoneFor(g, cells.filter((c) => c.c.y < -800), "resLow");
  zoneFor(g, cells.filter((c) => c.c.y >= -300), "comLow");
}

describe("Buses", () => {
  it("a line's buses go round its stops, stand at each one on their own kerb, and carry residents", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 12);
    const a = g.transit.addStop(v2(-120, -996))!;
    const b = g.transit.addStop(v2(-120, 4))!;
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    const line = g.transit.addLine([a.id, b.id])!;
    expect(line).not.toBeNull();
    expect(g.transit.loopTime(line)).toBeLessThan(Infinity);
    let dwells = 0, wrongSide = 0, maxBuses = 0, crossed = 0, fares = 0, upkeep = 0;
    const standing = new Set<number>();
    run(g, 20, () => {
      let n = 0;
      for (const v of g.traffic.vehicles) {
        if (!v.trip.bus) continue;
        n++;
        if (v.dwell === undefined) { standing.delete(v.id); continue; }
        if (standing.has(v.id)) continue;
        standing.add(v.id);
        dwells++;
        const l = v.edge as Lane;
        // stands in the kerb lane of its own side, at the stop
        const st = [a, b].find((s) => Math.hypot(s.p.x - v.x, s.p.y - v.y) < 14);
        if (!st || l.kind !== "lane" || l.idx !== 0 || (l.dir === 1 ? 1 : -1) !== st.access.side) wrongSide++;
        if (v.crossing) crossed++;
      }
      maxBuses = Math.max(maxBuses, n);
      fares = Math.max(fares, g.budget.income.transit);
      upkeep = Math.max(upkeep, g.budget.expense.transit);
    });
    expect(maxBuses).toBeGreaterThanOrEqual(1);
    expect(maxBuses).toBeLessThanOrEqual(line.want);
    expect(dwells).toBeGreaterThanOrEqual(6); // a few laps
    expect(wrongSide).toBe(0);
    expect(crossed).toBe(0);
    // people rode it, and paid
    expect(g.transit.boardings).toBeGreaterThan(5);
    expect(g.people.busTrips).toBeGreaterThan(5);
    expect(fares).toBeGreaterThan(0);
    expect(upkeep).toBeGreaterThan(0);
  });

  it("stops follow road edits; a stop whose road is pulled out goes, and so does a line left with one stop", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    const a = g.transit.addStop(v2(-120, -296))!;
    const b = g.transit.addStop(v2(-120, 4))!;
    const c = g.transit.addStop(v2(-196, -80))!;
    expect(a && b && c).toBeTruthy();
    const line = g.transit.addLine([a.id, b.id, c.id])!;
    // a new street meeting the top road splits it: the stop stays, on the new piece
    road(g, v2(-150, -300), v2(-150, -420));
    const seg0 = a.access.seg;
    expect(g.transit.stops.has(a.id)).toBe(true);
    expect(g.net.segs.has(seg0)).toBe(true);
    expect(Math.hypot(a.p.x + 120, a.p.y + 300)).toBeLessThan(8);
    expect(isFinite(g.transit.loopTime(line))).toBe(true);
    // pull out the bottom road under stop b
    const under = b.access.seg;
    g.bulldoze([under], []);
    expect(g.transit.stops.has(b.id)).toBe(false);
    expect(g.transit.lines.get(line.id)?.stops).toEqual([a.id, c.id]);
    g.bulldoze([c.access.seg], []);
    expect(g.transit.lines.has(line.id)).toBe(false);
  });

  it("stops stay on a street that is widened or narrowed", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    const a = g.transit.addStop(v2(-120, -296))!;
    const b = g.transit.addStop(v2(-120, 4))!;
    const line = g.transit.addLine([a.id, b.id])!;
    const money = g.money;
    expect(g.upgrade(a.access.seg, "avenue")).toBe(true);
    expect(g.transit.stops.has(a.id)).toBe(true);
    expect(g.transit.lines.has(line.id)).toBe(true);
    // on the new kerb, on the same side
    const sg = g.net.segGeom.get(a.access.seg)!;
    expect(Math.abs(Math.abs(a.p.y + 300) - sg.width / 2)).toBeLessThan(0.5);
    expect(isFinite(g.transit.loopTime(line))).toBe(true);
    expect(g.upgrade(a.access.seg, "street")).toBe(true);
    expect(g.transit.stops.has(a.id)).toBe(true);
    expect(g.money).toBeLessThan(money); // (paid for the roads, nothing refunded or charged for the stop)
  });

  it("riders going to a stop that is taken away still get where they were going", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    run(g, 12);
    const a = g.transit.addStop(v2(-120, -996))!;
    const m = g.transit.addStop(v2(-196, -500))!;
    const b = g.transit.addStop(v2(-120, 4))!;
    const line = g.transit.addLine([a.id, m.id, b.id])!;
    line.want = 4;
    const T = g.transit as any;
    // wait for a bus with riders aboard bound for b, then pull b out (the line keeps a and m)
    let removed = false;
    const aboard = new Set<number>();
    run(g, 24, () => {
      if (removed) return;
      for (const r of T.runs) for (const x of r.pax) if (x.to === b.id) aboard.add(x.c);
      for (const st of g.transit.stops.values()) for (const x of st.wait) if (x.to === b.id && st.id !== b.id) aboard.add(x.c);
      if (aboard.size >= 3) { g.transit.removeStop(b.id); removed = true; }
    });
    expect(removed).toBe(true);
    run(g, 6);
    // nobody still riding towards (or waiting for a bus to) the stop that went
    for (const r of T.runs) for (const x of r.pax) expect(x.to).not.toBe(b.id);
    for (const st of g.transit.stops.values()) for (const x of st.wait) expect(x.to).not.toBe(b.id);
    expect(g.transit.lines.get(line.id)?.stops).toEqual([a.id, m.id]);
  }, 120000);

  it("buses keep heading for the same stop when another one on the line is taken away", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    const s = [v2(-120, -996), v2(-196, -500), v2(-120, -296), v2(-120, 4)].map((p) => g.transit.addStop(p)!);
    expect(s.every(Boolean)).toBe(true);
    const line = g.transit.addLine(s.map((x) => x.id))!;
    const T = g.transit as any;
    const toC = { line: line.id, i: 2, pax: [] }, toB = { line: line.id, i: 1, pax: [] }, toD = { line: line.id, i: 3, pax: [] };
    T.runs.add(toC); T.runs.add(toB); T.runs.add(toD);
    g.transit.removeStop(s[0].id); // A: before every bus's stop
    expect(line.stops[toC.i]).toBe(s[2].id);
    expect(line.stops[toB.i]).toBe(s[1].id);
    expect(line.stops[toD.i]).toBe(s[3].id);
    g.transit.removeStop(s[1].id); // B: the stop one bus is driving to; it goes on to C instead
    expect(line.stops[toB.i]).toBe(s[2].id);
    expect((toB as any).detour).toBe(true);
    expect((toC as any).detour).toBeFalsy();
  });

  it("stops and lines are saved", () => {
    const g = new Game(7);
    town(g);
    g.money = 1e6;
    const a = g.transit.addStop(v2(-120, -296))!;
    const b = g.transit.addStop(v2(-120, 4))!;
    const line = g.transit.addLine([a.id, b.id])!;
    line.want = 3;
    const h = Game.load(JSON.parse(JSON.stringify(g.serialize())));
    expect([...h.transit.stops.keys()]).toEqual([a.id, b.id]);
    const l2 = h.transit.lines.get(line.id)!;
    expect(l2.stops).toEqual([a.id, b.id]);
    expect(l2.want).toBe(3);
    expect(h.transit.stops.get(a.id)!.access.seg).toBe(a.access.seg);
    expect(isFinite(h.transit.loopTime(l2))).toBe(true);
  });
});
