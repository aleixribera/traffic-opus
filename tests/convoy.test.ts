// Oversized-load convoys in traffic (beside roadtrain.test.ts): a 33 m escorted convoy crawls through a junction
// and round a roundabout as one unit, its pieces on the path its front drove, never through another vehicle; cars
// queue behind it rather than slip past; and with cars and trucks about, nothing jams for good.

import { describe, expect, it } from "vitest";
import { Traffic, type PendingSpawn, type Vehicle } from "../src/sim/traffic";
import { Industry } from "../src/game/industry";
import { CONVOY_LEN, CONVOY_VMAX, convoyBody } from "../src/game/convoys";
import type { TruckClass } from "../src/game/trucks";
import { DT, Watch, acc, net4, trip } from "./trafficWatch";
import type { RoadNetwork } from "../src/roads/network";

const convoy = (net: RoadNetwork, from: number, to: number): PendingSpawn => ({
  // (its whole 33 m on the arm at the start: in play it rolls out of a works' gate)
  from: acc(net, from, 0.15), fromSide: 1, to: acc(net, to, 0.5), toSide: 1,
  trip: { ...trip(), kind: "cargo", cargo: "big", haul: { plant: 0, leg: "out", product: "machinery", n: 0, dest: 0, big: "turbine" } },
  truck: true, tries: 0, wait: 0, through: true, ...convoyBody(),
});
const other = (net: RoadNetwork, from: number, to: number, cls: TruckClass | null): PendingSpawn => ({
  from: acc(net, from, 0.04), fromSide: 1, to: acc(net, to, 0.5), toSide: 1,
  trip: cls ? { ...trip(), haul: { plant: 0, leg: "out", product: "coal", n: 1, dest: 0, cls } } : trip(),
  truck: !!cls, tries: 0, wait: 0, through: true, ...Industry.body(cls ?? undefined),
});

describe("Oversized-load convoys", () => {
  it("crawl through an empty junction and round a roundabout as one unit, along the driven path", () => {
    for (const ring of [0, 1, 2] as const) for (const [from, to] of [[1, 3], [2, 0], [1, 0], [0, 2]]) {
      const { net, arms } = net4(ring);
      const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
      tr.request(convoy(net, arms[from], arms[to]));
      const w = new Watch(net, tr);
      let seen = false, top = 0, t = 0;
      for (; t < 240 && (t < 1 || tr.vehicles.length || tr.pending.length); t += DT) {
        w.step();
        const v = (tr.vehicles as Vehicle[])[0];
        if (v) { seen = true; expect(v.len).toBe(CONVOY_LEN); top = Math.max(top, v.v); }
      }
      const why = `ring ${ring} ${from}->${to}\n${w.log.join("\n")}`;
      expect(seen, why).toBe(true);
      expect(tr.vehicles.length, `still driving after ${t.toFixed(0)} s: ${why}`).toBe(0);
      // slow: never above its crawl, on a street whose limit is well over it
      expect(top, why).toBeLessThanOrEqual(CONVOY_VMAX + 0.05);
      expect(w.jumps, why).toBe(0);
      expect(w.snaps, why).toBe(0);
      expect(w.offRoad, why).toBe(0);
    }
  });

  it("holds its lane: the cars behind it queue rather than pass", () => {
    const { net, arms } = net4(0);
    const tr = new Traffic(net, { arrive: () => {}, fail: () => {} });
    tr.request(convoy(net, arms[1], arms[0]));
    // cars set off behind it a little later, all along the same way
    let t = 0;
    for (; t < 3; t += DT) tr.step(DT);
    const c = tr.vehicles[0] as Vehicle;
    expect(c?.keepLane).toBe(true);
    for (let k = 0; k < 4; k++) { tr.request(other(net, arms[1], arms[0], null)); for (let s = 0; s < 1.5; s += DT) tr.step(DT); }
    let passed = false, slowed = 0;
    for (; t < 200 && tr.vehicles.includes(c); t += DT) {
      tr.step(DT);
      // (all on the same road eastward: a car further east than the convoy's front has got past it)
      for (const v of tr.vehicles as Vehicle[]) {
        if (v === c || v.fade < 1) continue;
        if (v.x > c.x + 2 && v.x < 590) passed = true;
        if (v.x < c.x && c.x - v.x < 60 && v.v < CONVOY_VMAX + 1) slowed += DT;
      }
    }
    expect(passed).toBe(false);
    expect(slowed).toBeGreaterThan(5);
  });

  it("mixed with cars and trucks through a busy junction and a roundabout: nothing drawn through anything, no jam", () => {
    for (const ring of [0, 1, 2] as const) {
      const { net, arms } = net4(ring);
      let done = 0;
      const tr = new Traffic(net, { arrive: () => { done++; }, fail: () => { done++; } });
      const w = new Watch(net, tr);
      let k = 0, asked = 0;
      for (let t = 0; t < 200; t += DT) {
        if (t > k * 2.4 && k < 60) {
          const a = arms[k % 4], b = arms[(k * 3 + 1 + (k >> 2)) % 4];
          if (a !== b) {
            tr.request(k % 15 === 0 ? convoy(net, a, b) : other(net, a, b, k % 5 === 0 ? "roadtrain" : k % 3 === 0 ? "heavy" : null));
            asked++;
          }
          k++;
        }
        w.step();
      }
      let t = 0;
      for (; t < 300 && (tr.vehicles.length || tr.pending.length); t += DT) w.step();
      const why = `ring ${ring}: ${done}/${asked} done, ${tr.vehicles.length} on the road after ${t.toFixed(0)} s more\n${w.log.join("\n")}`;
      expect(tr.vehicles.length + tr.pending.length, why).toBe(0);
      expect(w.clips, why).toBe(0);
      expect(w.jumps, why).toBe(0);
      expect(w.offRoad, why).toBe(0);
    }
  });
});
