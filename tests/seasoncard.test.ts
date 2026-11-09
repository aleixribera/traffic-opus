// The season's title card (owner, 2026-11-09: "a cool visual text when changing seasons, and show a bit which building
// bonuses/debuffs that means"): it fires once per live crossing and never on a load, its lines come from SEASONAL's
// mid-season values, and it lists only the seasonal kinds the player runs.

import { describe, expect, it } from "vitest";
import { DAY } from "../src/game/society";
import { SEASONAL, SEASONS, SEASON_DAYS, seasonOf } from "../src/game/calendar";
import { SeasonWatch, effectLine, ownedSeasonal, seasonCardHtml, seasonEffects, seasonPopHtml } from "../src/ui/seasonCard";

/** Walk the clock from `t0` to `t1` in `dt` steps, as the HUD looks at it, and collect what the watch fires. */
function walk(w: SeasonWatch, game: object, t0: number, t1: number, dt: number) {
  const fired: { t: number; s: string }[] = [];
  for (let t = t0; t <= t1; t += dt) {
    const s = w.see(game, t);
    if (s) fired.push({ t, s });
  }
  return fired;
}

describe("the season watch", () => {
  it("fires once per crossing, for the season entered, over two years of play", () => {
    const w = new SeasonWatch(), g = {};
    const fired = walk(w, g, 0, 2 * 4 * SEASON_DAYS * DAY, 10);
    expect(fired.length).toBe(8);
    // (a new game starts in spring: summer comes first, then round the year twice)
    expect(fired.map((f) => f.s)).toEqual(["summer", "autumn", "winter", "spring", "summer", "autumn", "winter", "spring"]);
    for (const f of fired) {
      expect(seasonOf(f.t)).toBe(f.s);
      expect(seasonOf(f.t - 10)).not.toBe(f.s);
    }
  });

  it("never fires on the first look at a game: a new game, or a save loaded in another season", () => {
    const w = new SeasonWatch();
    const a = {};
    expect(w.see(a, 0)).toBeNull();
    // a save from later in the year loaded: a different game, a different season, no card
    const b = {};
    const later = 12 * DAY;
    expect(seasonOf(later)).not.toBe(seasonOf(0));
    expect(w.see(b, later)).toBeNull();
    expect(w.see(b, later + 5)).toBeNull();
    // the same game object loaded back from an earlier save (the clock went backwards): no card either
    expect(w.see(b, 0)).toBeNull();
    // and after a reset (the HUD's clear on a load) the first look only takes note
    w.reset();
    expect(w.see(b, later)).toBeNull();
  });

  it("fires a crossing only once, however often the clock is looked at in the new season", () => {
    const w = new SeasonWatch(), g = {};
    const fired = walk(w, g, 0, 10 * DAY, 1);
    expect(fired.length).toBe(1);
  });
});

describe("the season's effects", () => {
  it("match SEASONAL's mid-season values, in sign and percent, for every kind and season", () => {
    for (const kind of Object.keys(SEASONAL)) {
      SEASONS.forEach((s, i) => {
        const L = effectLine(kind, s), v = SEASONAL[kind][i];
        expect(L.pct).toBe(Math.round((v - 1) * 100));
        if (L.dir === "steady") {
          expect(Math.abs(L.pct)).toBeLessThanOrEqual(2);
          expect(L.value).toBe("≈ steady");
        } else if (L.dir === "up") {
          expect(v).toBeGreaterThan(1);
          expect(L.value).toBe(`▲ +${L.pct}%`);
        } else {
          expect(v).toBeLessThan(1);
          expect(L.value).toBe(`▼ −${-L.pct}%`);
        }
        expect(L.text.startsWith(L.label)).toBe(true);
      });
    }
  });

  it("reads as the owner's examples", () => {
    expect(effectLine("farm", "autumn").text).toBe("Farms ▲ +60%");
    expect(effectLine("farm", "winter").text).toBe("Farms ▼ −50%");
    expect(effectLine("loggingcamp", "autumn").text).toBe("Logging camps ≈ steady");
    expect(effectLine("loggingcamp", "summer").text).toBe("Logging camps ▼ −25%");
    expect(effectLine("loggingcamp", "winter").text).toBe("Logging camps ▲ +35%");
  });

  it("lists only the seasonal kinds the player runs, with a hint where it matters", () => {
    const sites = [{ kind: "farm" }, { kind: "foodplant" }, { kind: "farm" }, { kind: "warehouse" }];
    const owned = ownedSeasonal(sites);
    expect(owned).toEqual(["farm"]);
    const fx = seasonEffects("autumn", owned);
    expect(fx.general).toBe(false);
    expect(fx.lines.map((l) => l.kind)).toEqual(["farm"]);
    expect(fx.hint).toBe("Warehouses bank the surplus for winter");
    const html = seasonCardHtml("autumn", 1, fx);
    expect(html).toContain("Farms");
    expect(html).not.toContain("Logging camps");
    expect(html).toContain("The harvest rush is on");
    // a logging camp only: winter's hint is about the logs, not the farms
    const logs = seasonEffects("winter", ownedSeasonal([{ kind: "loggingcamp" }]));
    expect(logs.lines.map((l) => l.text)).toEqual(["Logging camps ▲ +35%"]);
    expect(logs.hint).not.toMatch(/farm/i);
  });

  it("with no seasonal sites, gives the general effect as one line and no hint", () => {
    const fx = seasonEffects("autumn", ownedSeasonal([{ kind: "sawmill" }]));
    expect(fx.general).toBe(true);
    expect(fx.lines.map((l) => l.kind)).toEqual(Object.keys(SEASONAL));
    expect(fx.hint).toBeNull();
    const html = seasonCardHtml("autumn", 2, fx);
    expect(html).toContain("sc-general");
    expect(html).not.toContain("sc-fx");
    expect(html).toContain("Year 2");
  });

  it("puts the same lines in the clock's popover", () => {
    const fx = seasonEffects("winter", ["farm", "loggingcamp"]);
    const html = seasonPopHtml(13 * DAY, { ...fx, season: seasonOf(13 * DAY) });
    expect(html).toContain("Farms");
    expect(html).toContain("Logging camps");
  });
});
