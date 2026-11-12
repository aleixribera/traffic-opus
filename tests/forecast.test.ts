// Advice that holds (review 2026-11-12, "advice that changes its mind"): a building site's wait is forecast from what
// supplies it and said in bands that move one step at a time (C2), and a town's advice holds for hours before it
// names another works (C6). The band and the hold are checked as plain sums; the forecast on the play-test's own
// company (tests/gatejam.scenario.ts), where one sawmill feeds two towns and the steel chain's sites in bursts.

import { describe, expect, it } from "vitest";
import type { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { Industry, aboutHours } from "../src/game/industry";
import { ADVICE_HOLD, BAND_HOLD, SITE_BANDS, bandOf, holdAdvice, moreSaves, nextBand, siteStatus, townsFirst, type BandState, type SiteForecast } from "../src/ui/bottleneck";
import { buildGateJam, runGateJam } from "./gatejam.scenario";

declare const process: { env: Record<string, string | undefined> };

describe("a site's wait, in bands", () => {
  it("bands: a few hours, about half a day, about a day, 2 to 3 days", () => {
    expect(SITE_BANDS[bandOf(0.4)].say).toBe("under an hour");
    expect(SITE_BANDS[bandOf(5)].say).toBe("a few hours");
    expect(SITE_BANDS[bandOf(12)].say).toBe("about half a day");
    expect(SITE_BANDS[bandOf(24)].say).toBe("about a day");
    expect(SITE_BANDS[bandOf(60)].say).toBe("2 to 3 days");
    expect(SITE_BANDS[bandOf(300)].say).toBe("more than 3 days");
  });

  it("a forecast that swings from hour to hour keeps its band, moving one step at a time and only once it holds", () => {
    // (the review's Smelter: 2, 3, 4, then 11 days, then 13 hours and 7 hours)
    const swings = [30, 60, 90, 260, 13, 7, 40, 20, 70, 9, 30, 25];
    let st: BandState | undefined;
    const seen: number[] = [];
    for (let h = 0; h < 48; h++) {
      st = nextBand(st, swings[h % swings.length], "mill", h);
      seen.push(st.i);
    }
    for (let k = 1; k < seen.length; k++) expect(Math.abs(seen[k] - seen[k - 1])).toBeLessThanOrEqual(1);
    expect(Math.max(...seen) - Math.min(...seen)).toBeLessThanOrEqual(1);
  });

  it("a forecast that has really moved gets there, a band at a time, each held BAND_HOLD hours", () => {
    let st = nextBand(undefined, 60, "mill", 0);
    expect(st.i).toBe(bandOf(60));
    const moves: number[] = [];
    for (let h = 1; h <= 12; h++) {
      const before = st.i;
      st = nextBand(st, 3, "mill", h);
      if (st.i !== before) moves.push(h);
    }
    expect(st.i).toBe(bandOf(3));
    expect(moves.length).toBe(bandOf(60) - bandOf(3));
    for (let k = 1; k < moves.length; k++) expect(moves[k] - moves[k - 1]).toBeGreaterThanOrEqual(BAND_HOLD);
  });

  it("a works built or lost says the new wait at once, as does a line nobody has read for hours", () => {
    let st = nextBand(undefined, 60, "mill", 0);
    st = nextBand(st, 3, "mill,mill2", 1);
    expect(st.i).toBe(bandOf(3));
    st = nextBand(st, 60, "mill,mill2", 1 + BAND_HOLD + 1);
    expect(st.i).toBe(bandOf(60));
  });
});

describe("what a slow site says about it", () => {
  const supply = (out: number, towns: number) => ({ p: "planks", left: 20, onWay: 0, ahead: 0, out, towns, rate: Math.max(out / 4, out - towns), drive: 0.3, makers: [], hours: 1 }) as unknown as SiteForecast["by"][number];

  it("towns buying most of what it waits for is the reason it is slow, said plainly", () => {
    expect(townsFirst({ hours: 40, key: "", by: [supply(2, 1.7)] })).toBe("planks");
    expect(townsFirst({ hours: 12, key: "", by: [supply(2, 0.7)] })).toBeNull();
    expect(townsFirst({ hours: null, key: "", by: [supply(0, 1)] })).toBeNull();
  });

  it("another works is advised only when it would open the site sooner, its own build counted", () => {
    // the review's Sawmill: 21 planks to come at about one an hour, and a new one makes its first load in 9 hours: the
    // site would have most of them before it opened, so it is no help worth $16,000
    expect(moreSaves({ loads: 21, out: 2, towns: 0.7, add: 1, opens: 9 })).toBe(false);
    // the site fills before the new one opens at all
    expect(moreSaves({ loads: 8, out: 2, towns: 0.7, add: 1, opens: 9 })).toBe(false);
    // 40 loads with the towns taking most of the one sawmill's output: days, and a second one halves it
    expect(moreSaves({ loads: 40, out: 2, towns: 1.7, add: 2, opens: 9 })).toBe(true);
  });
});

describe("advice holds", () => {
  const game = (time: number, works: number[]) => ({ time, industry: { plants: () => works.map((id) => ({ id, built: 1, plant: { level: 1 } })) } }) as unknown as Game;
  const sig = (x: string) => x;

  it("a different piece of advice waits ADVICE_HOLD game hours; the same one comes through with fresh figures", () => {
    const g = game(0, [1, 2]);
    expect(holdAdvice(g, "food", "farm", sig)).toBe("farm");
    g.time = HOUR;
    expect(holdAdvice(g, "food", "foodplant", sig)).toBe("farm");
    g.time = (ADVICE_HOLD - 0.1) * HOUR;
    expect(holdAdvice(g, "food", "foodplant", sig)).toBe("farm");
    // (nothing to advise passes through, and keeps the clock)
    expect(holdAdvice<string>(g, "food", null, sig)).toBeNull();
    g.time = ADVICE_HOLD * HOUR;
    expect(holdAdvice(g, "food", "foodplant", sig)).toBe("foodplant");
    // and it holds in its turn: no flip back within the hour
    g.time = (ADVICE_HOLD + 1) * HOUR;
    expect(holdAdvice(g, "food", "farm", sig)).toBe("foodplant");
    // another chain's advice is its own
    expect(holdAdvice(g, "planks", "sawmill", sig)).toBe("sawmill");
  });

  it("a works built or lost changes it at once", () => {
    const works = [1, 2];
    const g = { time: 0, industry: { plants: () => works.map((id) => ({ id, built: 1, plant: { level: 1 } })) } } as unknown as Game;
    expect(holdAdvice(g, "food", "farm", sig)).toBe("farm");
    works.push(3);
    g.time = HOUR / 2;
    expect(holdAdvice(g, "food", "foodplant", sig)).toBe("foodplant");
  });

  it("a works' own trouble is never held past its mending, and a road reaching a works is a change", () => {
    const works = [{ id: 1, built: 1, plant: { level: 1 }, access: undefined as unknown }];
    const g = { time: 0, industry: { plants: () => works } } as unknown as Game;
    const fixable = (x: string) => !x.startsWith("held:");
    expect(holdAdvice(g, "food", "held:no road", sig, fixable)).toBe("held:no road");
    g.time = HOUR / 2;
    // (the road is built: the works now has it, and the advice moves on to what to build next)
    expect(holdAdvice(g, "food", "full:foodplant", sig, fixable)).toBe("full:foodplant");
    // what to build does hold
    g.time = HOUR;
    expect(holdAdvice(g, "food", "full:farm", sig, fixable)).toBe("full:foodplant");
    // and a road reaching a works lets it change at once
    works[0].access = { seg: 1 };
    expect(holdAdvice(g, "food", "full:farm", sig, fixable)).toBe("full:farm");
  });
});

describe("one sawmill feeding two towns and the steel chain's sites, in bursts", () => {
  it("each site's line keeps its band within a step from hour to hour over two game days, and only moves on", () => {
    const s = buildGateJam({ sites: 1, pop: 600 });
    // per site, the band its line said each game hour (and, for the record, the old hour-exact wait)
    const bands = new Map<number, number[]>(), old = new Map<number, string[]>();
    runGateJam(s, 2, () => {
      for (const b of s.sites) {
        if (!b.plant!.site) continue;
        const st = siteStatus(s.g, b);
        const e = Industry.siteEta(b)!;
        if (st.hours === null || e.got >= e.need) continue;
        const band = b.plant!.site!.band!.i;
        (bands.get(b.id) ?? bands.set(b.id, []).get(b.id)!).push(band);
        (old.get(b.id) ?? old.set(b.id, []).get(b.id)!).push(e.hours === null ? "-" : aboutHours(e.hours));
        expect(st.line).toContain(SITE_BANDS[band].say);
      }
    });
    if (process.env.FORECAST_LOG) for (const [id, xs] of bands) console.log(id, xs.join(" "), "\nold:", old.get(id)!.join(" | "));
    expect(bands.size).toBeGreaterThan(0);
    for (const [, xs] of bands) {
      // never more than a step from one hour to the next
      for (let k = 1; k < xs.length; k++) expect(Math.abs(xs[k] - xs[k - 1])).toBeLessThanOrEqual(1);
      // and no going back and forth: once it has moved one way, it does not move back within BAND_HOLD hours
      let last = -1, dir = 0;
      for (let k = 1; k < xs.length; k++) {
        if (xs[k] === xs[k - 1]) continue;
        const d = Math.sign(xs[k] - xs[k - 1]);
        if (dir && d !== dir) expect(k - last).toBeGreaterThanOrEqual(BAND_HOLD);
        last = k; dir = d;
      }
    }
  }, 240000);
});
