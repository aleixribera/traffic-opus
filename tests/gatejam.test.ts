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
import { buildGateJam, runGateJam } from "./gatejam.scenario";

describe("one sawmill, two towns and eight building sites on one road", () => {
  it("gets slow, never seizes: nobody stands, its trucks keep moving, the towns keep their planks, the sites go up", () => {
    const s = buildGateJam({ sites: 2, pop: 600 });
    const r = runGateJam(s, 2.5);
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
    // and every site still waiting says how long it will be, from the loads it has had
    const waiting = s.sites.filter((b) => b.plant!.site && (b.plant!.site.got.planks ?? 0) > 0);
    expect(waiting.length).toBeGreaterThan(0);
    for (const b of waiting) {
      const e = Industry.siteEta(b)!;
      expect(e.need).toBe(b.plant!.site!.need.planks);
      expect(e.got).toBe(b.plant!.site!.got.planks);
      expect(e.got).toBeLessThan(e.need);
    }
    expect(waiting.some((b) => { const e = Industry.siteEta(b)!; return e.perHour > 0 && e.hours !== null && e.hours > 0 && e.hours < 24 * 6; })).toBe(true);
  }, 240000);
});
