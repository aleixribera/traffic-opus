// The late save as a traffic load test (review 2026-11-12, top 5 #5, and B1): three supplied towns and the company's
// trucks, about 250 vehicles at the daily peak, run for ten game days from the save the builder writes
// (tools/lategame.build.ts, which also writes this fixture). Jams may come and go; a deadlock may not last, and the
// standing traffic must not build up from one day to the next. Half an hour to an hour of CPU: the soak project
// (`npm run test:soak`), run after a change to the traffic sim.

import { expect, it } from "vitest";
import { Game } from "../src/game/city";
import { DAY, HOUR } from "../src/game/society";
import { CYCLE_RELEASE, stuckNow, type Vehicle } from "../src/sim/traffic";

const DT = 1 / 30;
const DAYS = 10;
/**
 * The longest any vehicle may stand without moving at all (s), outside a loading bay. A ring of cars each held by the
 * next is released after CYCLE_RELEASE; one release, and the ring moving up into the slot it opened, takes no more
 * than as long again. The longest red at fixed-time lights (24 s a phase) is well under it.
 */
const LIMIT = 2 * CYCLE_RELEASE;
/** The review's own check: "Standing still" (the Traffic window: 15 s or more) above this for over a game hour fails. */
const STANDING_S = 15, STANDING_MAX = 5;
/** Sampled every this many sim seconds. */
const EVERY = 10;

it("ten days of the late save: no deadlock lasts, and standing traffic doesn't build up", async () => {
  // (node's fs and zlib, untyped here: the project's types are the browser's)
  const node = (m: string) => import(/* @vite-ignore */ ["node", m].join(":"));
  const { readFileSync } = await node("fs"), { gunzipSync } = await node("zlib");
  const g = Game.load(JSON.parse(gunzipSync(readFileSync(new URL("./fixtures/lategame.json.gz", import.meta.url))).toString()));
  const per = Math.round(EVERY / DT), perDay = Math.round(DAY / DT), steps = DAYS * perDay;
  // how long each vehicle has stood quite still, and the worst seen
  const still = new Map<Vehicle, number>();
  let worst = { s: 0, at: "", t: 0 };
  // the standing count's samples, a day at a time; how long it has been above STANDING_MAX
  const days: { standing: number[]; peak: number; quits: number; breaks: number; releases: number }[] = [];
  let above = 0, longestAbove = 0, rings = 0;
  const q0 = g.traffic.jamQuits, b0 = g.traffic.jamBreaks, r0 = g.traffic.cycleReleases;
  for (let i = 1; i <= steps; i++) {
    g.step(DT);
    const vs = g.traffic.vehicles;
    for (const v of vs) {
      if (v.v < 0.3 && v.dwell === undefined && v.quit === undefined) {
        const s = (still.get(v) ?? 0) + DT;
        still.set(v, s);
        if (s > worst.s) worst = { s, at: `${v.trip.haul ? "truck" : "car"} ${v.id} at ${v.x.toFixed(0)},${v.y.toFixed(0)}`, t: g.traffic.time };
      } else still.delete(v);
    }
    if (i % per) continue;
    for (const v of still.keys()) if (!vs.includes(v)) still.delete(v);
    const d = Math.floor((i - 1) / perDay);
    const day = (days[d] ??= { standing: [], peak: 0, quits: 0, breaks: 0, releases: 0 });
    const n = vs.filter((v) => stuckNow(v, STANDING_S)).length;
    day.standing.push(n);
    day.peak = Math.max(day.peak, vs.length);
    day.quits = g.traffic.jamQuits - q0;
    day.breaks = g.traffic.jamBreaks - b0;
    day.releases = g.traffic.cycleReleases - r0;
    above = n > STANDING_MAX ? above + EVERY : 0;
    longestAbove = Math.max(longestAbove, above);
    rings += g.traffic.waitCycles(LIMIT).length;
    // (a line a day as it goes: a long run shows how far it got)
    if (i % perDay === 0) console.log(`day ${d + 1}: peak ${day.peak} vehicles, standing mean ${(day.standing.reduce((s, x) => s + x, 0) / day.standing.length).toFixed(2)}, stood still longest ${worst.s.toFixed(0)} s, towns ${g.towns.list.map((t) => t.pop).join("/")}`);
  }
  const mean = (a: number[]) => a.reduce((s, x) => s + x, 0) / Math.max(1, a.length);
  const means = days.map((d) => mean(d.standing));
  const report = days.map((d, k) => `day ${k + 1}: peak ${d.peak} vehicles, standing mean ${means[k].toFixed(2)} max ${Math.max(...d.standing)}, releases ${d.releases} breaks ${d.breaks} quits ${d.quits} (to date)`);
  report.push(`stood still longest ${worst.s.toFixed(0)} s (${worst.at}, at ${(worst.t / HOUR).toFixed(1)} h); standing over ${STANDING_MAX} for ${(longestAbove / HOUR).toFixed(2)} h at most; rings older than ${LIMIT} s seen ${rings} times; towns ${g.towns.list.map((t) => `${t.name} ${t.pop}`).join(", ")}`);
  console.log(report.join("\n"));

  // no deadlock lasts: no vehicle stands still past LIMIT, and no ring of waits is ever older than it
  expect(worst.s, report.join("\n")).toBeLessThanOrEqual(LIMIT);
  expect(rings).toBe(0);
  // jams clear: never more than STANDING_MAX standing for over a game hour
  expect(longestAbove).toBeLessThanOrEqual(HOUR);
  // and don't build up: the last three days stand no more than the first three, give or take a car or two
  const first = mean(means.slice(0, 3)), last = mean(means.slice(-3));
  expect(last, report.join("\n")).toBeLessThanOrEqual(first * 1.5 + 1);
  // (and it is the load it should be: the daily peak about 250)
  expect(Math.max(...days.map((d) => d.peak))).toBeGreaterThan(200);
}, 7_200_000);
