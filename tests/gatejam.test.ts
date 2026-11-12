// The play-test's dead company (docs/playtest-2026-11-09.md, A1, A2, A17, B2, E1), as a regression test: one sawmill
// on a single road, feeding two towns and the steel chain's building sites, here with twice the sites the tester had.
// Before the fixes of 2026-11-10 the road past its gate seized inside two game days and stayed seized: 125 of 157
// vehicles standing five game minutes and more (the longest for 34), 38 of its 42 trucks out for less than one load
// an hour, both towns at "None" from the third day, no site half built after six. The road may be slow now, and
// the sites late; it may not stop.
//
// The long version (six game days, the report's four sites and the overload, the minutes to the first mine and the
// first steel) is tools/gatejam.build.ts.

import { describe, expect, it } from "vitest";
import { GATE_QUEUE, Industry } from "../src/game/industry";
import { SITE_BANDS, siteStatus } from "../src/ui/bottleneck";
import { buildTime } from "../src/game/construction";
import { HOUR } from "../src/game/society";
import { buildGateJam, runGateJam } from "./gatejam.scenario";

describe("one sawmill, two towns and eight building sites on one road", () => {
  it("gets slow, never seizes: nobody stands, its trucks keep moving, the towns keep their planks, the sites go up", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    // (each hour: the sites part-way through their planks, and what each says of how long it will be)
    let partBuilt = 0, timed = 0;
    const r = runGateJam(s, 2.5, () => {
      for (const b of s.sites) {
        const site = b.plant!.site;
        if (!site || !((site.got.planks ?? 0) > 0)) continue;
        partBuilt++;
        const e = Industry.siteEta(b)!;
        expect(e.need).toBe(site.need.planks);
        expect(e.got).toBe(site.got.planks);
        expect(e.got).toBeLessThan(e.need);
        if (!(e.perHour > 0 && e.hours !== null && e.hours > 0 && e.hours < 24 * 6)) continue;
        timed++;
        // (what its panel says: the same count, in the interface's words, with the build added to the wait)
        const st = siteStatus(s.g, b);
        expect(st.line).toMatch(new RegExp(`^${e.got} of ${e.need} loads delivered, (${SITE_BANDS.map((x) => x.say).join("|")}) to go$`));
        expect(st.hours!).toBeGreaterThan(buildTime(b.kind) / HOUR);
      }
    });
    // no vehicle stands five game minutes (it was 25 by the end of the first day and 98 and more by the fourth);
    // nobody waits two at a junction, and the jam breaker and the drivers' giving up, the last resorts, never fire
    expect(r.standing).toBe(0);
    expect(r.longest).toBeLessThan(120);
    expect(r.breaks).toBe(0);
    expect(r.quits).toBe(0);
    // the sawmill's trucks: never more than a couple of them standing in traffic (it was 28), never a queue in its
    // yard longer than the gate takes (the rest are held at the dock, their loads in the yard)
    expect(r.held).toBeLessThanOrEqual(3);
    for (const st of r.samples) expect(st.atGate, `day ${st.day}`).toBeLessThanOrEqual(GATE_QUEUE);
    // and it works at its rate with them: three loads an hour at level 3 (it was 0 to 1.3)
    const late = r.samples.slice(-24);
    expect(late.reduce((a, st) => a + st.perHour, 0) / late.length).toBeGreaterThan(2.4);
    // the towns come first: neither reads "None" (or anywhere near) while the sites are fed
    expect(r.minA).toBeGreaterThan(35);
    expect(r.minB).toBeGreaterThan(35);
    // the sites go up all the same, nearest done first: the first mine inside half a real hour
    expect(r.firstMine).not.toBeNull();
    expect(r.firstMine!).toBeLessThan(30);
    // and every site part-way through says how long it will be, from the loads it has had (one at a time gets the
    // planks, nearest first: at any one hour there may be none part-way)
    expect(partBuilt).toBeGreaterThan(5);
    expect(timed).toBeGreaterThan(partBuilt / 2);
  }, 240000);
});
