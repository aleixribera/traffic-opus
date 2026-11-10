// A town's needs in a child's words (src/ui/needs.ts): the four states and where they break, the crates, the "bring N
// more" count, the coming need, and what the town's map label shows. Each break is checked against the sim it stands
// for (towns.ts growthPerDay), so the words never drift from what the town really does.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import type { Town } from "../src/game/settlements";
import { SUPPLY_WARMUP, averageSupply, demandPerDay, growthPerDay, needsOf } from "../src/game/towns";
import type { Product } from "../src/game/industry";
import { deliveredLately } from "../src/game/supply";
import { townModel } from "../src/ui/inspect";
import { ENOUGH, STEPS, comingNeeds, growthOf, labelNeeds, labelSummary, loadsLately, loadStep, needState, needView, sinceFirstLoad, townNeeds } from "../src/ui/needs";

let g: Game, t: Town;

/** The town as if it had been getting `perDay` loads of food a day for a whole day. */
function feed(perDay: number) {
  t.hours = Array.from({ length: 24 }, () => ({ food: perDay / 24 }));
  t.hourNow = {};
  t.supply = { food: Math.min(1, perDay / demandPerDay("food", t.pop)) };
}

describe("a town's needs, read out", () => {
  beforeAll(() => {
    g = new Game(7);
    g.start();
    t = g.towns.list[0];
    // a hamlet of 40: food only, about 5 loads a day, one step a load
    t.pop = 40;
  });

  it("breaks between the states where the sim does", () => {
    const step = 0.2;
    expect(needState(1.4, step)).toBe("plenty");
    expect(needState(1, step)).toBe("plenty");
    expect(needState(0.99, step)).toBe("enough");
    expect(needState(ENOUGH, step)).toBe("enough");
    expect(needState(0.79, step)).toBe("low");
    expect(needState(step, step)).toBe("low");
    expect(needState(0.19, step)).toBe("none");
    expect(needState(0, step)).toBe("none");
  });

  it("a step is one load for a small town, a round number of loads for a big one, never more than ten steps", () => {
    expect(loadStep(5)).toBe(1);
    expect(loadStep(10)).toBe(1);
    expect(loadStep(11.25)).toBe(2);
    expect(loadStep(64)).toBe(8);
    expect(loadStep(90)).toBe(10);
    expect(loadStep(450)).toBe(50);
    for (const want of [1, 3.5, 11, 64, 333, 2500]) expect(Math.ceil(want / loadStep(want))).toBeLessThanOrEqual(STEPS);
  });

  it("none: no food coming, bring a full day's loads; an empty bar", () => {
    feed(0);
    const want = demandPerDay("food", t.pop), v = needView(t, "food");
    expect(want).toBeLessThanOrEqual(STEPS);
    expect(v.state).toBe("none");
    expect(v.word).toBe("None!");
    expect(v.fill).toBe(0);
    expect(v.more).toBe(Math.ceil(want));
    expect(v.say).toBe(`No food is coming. Bring ${Math.ceil(want)} loads a day.`);
    // a trickle under one step's worth is still none, and says so
    feed(0.5);
    expect(needView(t, "food").state).toBe("none");
    expect(needView(t, "food").say).toMatch(/^Almost no food is coming\. Bring \d+ more loads a day\.$/);
  });

  it("running low: the bar is what it gets of what it wants, and the advice is the rest", () => {
    const want = demandPerDay("food", t.pop);
    feed(2);
    const v = needView(t, "food");
    expect(v.state).toBe("low");
    expect(v.word).toBe("Running low");
    expect(v.fill).toBeCloseTo(2 / want);
    expect(v.more).toBe(Math.ceil(want - 2));
    expect(v.say).toBe(`Bring ${v.more} more loads of food a day.`);
  });

  it("enough: it grows; a load more a day and it has plenty", () => {
    const want = demandPerDay("food", t.pop);
    feed(want * 0.9);
    const v = needView(t, "food");
    expect(v.state).toBe("enough");
    expect(v.word).toBe("Enough");
    expect(v.more).toBe(1);
    expect(v.say).toBe("Enough to grow. 1 more load a day and it has plenty.");
  });

  it("plenty: a full bar, nothing to do", () => {
    feed(demandPerDay("food", t.pop) * 2);
    const v = needView(t, "food");
    expect(v.state).toBe("plenty");
    expect(v.word).toBe("Plenty");
    expect(v.fill).toBe(1);
    expect(v.more).toBe(0);
    expect(v.say).toBe("Food is fine.");
  });

  it("a load shows the moment it lands, not an hour later", () => {
    feed(0);
    expect(loadsLately(t, "food")).toBe(0);
    t.hourNow = { food: 1 };
    // (the first load of a new supply: read over the warm-up, the way the town's growth reads it)
    expect(loadsLately(t, "food")).toBeCloseTo(24 / SUPPLY_WARMUP);
    // into a steady supply, the load under way shows at once too
    feed(2.4);
    const was = loadsLately(t, "food");
    t.hourNow = { food: 1 };
    expect(loadsLately(t, "food")).toBeGreaterThan(was + 0.8);
  });

  it("a young supply reads as the town's growth reads it: over the hours since its first load", () => {
    // a Food Plant opened five hours ago and lands a load an hour: 24 a day, against the 5 this hamlet wants
    const young = [...Array.from({ length: 19 }, () => ({})), ...Array.from({ length: 5 }, () => ({ food: 1 }))];
    t.hours = young;
    t.hourNow = {};
    // (the sim's own average, towns.ts averageSupply: 5 loads over the warm-up's 8 hours)
    expect(averageSupply(young).food).toBeCloseTo((5 * 24) / SUPPLY_WARMUP);
    expect(sinceFirstLoad(t, "food")).toBeCloseTo(averageSupply(young).food!);
    expect(loadsLately(t, "food")).toBeCloseTo(averageSupply(young).food!);
    // (spread over the whole day gone by it read 5 a day or less: "Running low" under a town "Growing fast")
    expect(needView(t, "food").state).toBe("plenty");
    // the very first load: read over the warm-up, as the sim reads it
    t.hours = Array.from({ length: 24 }, () => ({}));
    t.hourNow = { food: 1 };
    expect(loadsLately(t, "food")).toBeCloseTo(24 / SUPPLY_WARMUP);
    // a supply a day old or more reads as what landed in the day
    feed(6);
    expect(sinceFirstLoad(t, "food")).toBeCloseTo(6, 0);
    expect(loadsLately(t, "food")).toBeCloseTo(6, 0);
    // one that stopped a day ago still reads as its growth reads it: 12 loads over the 30 hours since the first
    const stopped = [...Array.from({ length: 6 }, () => ({ food: 2 })), ...Array.from({ length: 24 }, () => ({}))];
    t.hours = stopped;
    t.hourNow = {};
    expect(sinceFirstLoad(t, "food")).toBeCloseTo((12 * 24) / 31);
    expect(sinceFirstLoad(t, "food")).toBeCloseTo((averageSupply(stopped).food! * 30) / 31);
    expect(loadsLately(t, "food")).toBeGreaterThanOrEqual(deliveredLately(t, "food"));
    // and a supply two days old with gaps in it is no young supply: the whole two days count (a dip must show)
    t.hours = Array.from({ length: 48 }, (_, i) => (i === 0 || i === 20 || i === 40 ? { food: 2 } : {}));
    expect(sinceFirstLoad(t, "food")).toBeCloseTo((6 * 24) / 49);
    expect(loadsLately(t, "food")).toBeCloseTo(Math.max(deliveredLately(t, "food"), (6 * 24) / 49));
  });

  it("a big town's need: a trickle under a step reads None!, half reads Running low with a half bar", () => {
    const pop = t.pop;
    t.pop = 1600;
    const want = demandPerDay("food", 1600), step = loadStep(want);
    expect(step).toBeGreaterThan(1);
    feed(step * 0.5);
    expect(needView(t, "food").state).toBe("none");
    feed(want / 2);
    const v = needView(t, "food");
    expect(v.state).toBe("low");
    expect(v.fill).toBeCloseTo(0.5, 1);
    expect(v.more).toBe(Math.ceil(want - v.got - 1e-6));
    t.pop = pop;
  });

  it("names the need to come, and the people it comes at", () => {
    expect(comingNeeds(40)).toEqual({ products: ["planks"], pop: 100 });
    expect(comingNeeds(150)).toEqual({ products: ["cement"], pop: 600 });
    expect(comingNeeds(700)?.products.sort()).toEqual(["fuel", "goods"]);
    expect(comingNeeds(700)?.pop).toBe(1500);
    expect(townNeeds(t).map((v) => v.p)).toEqual(["food"]);
  });

  it("the map label: calm while all is met, the needs tinted when one isn't, no road for a town nobody reaches", () => {
    const pop = t.pop;
    t.pop = 90;
    feed(demandPerDay("food", t.pop) * 2);
    expect(labelNeeds(t)).toEqual({ kind: "calm" });
    feed(4);
    expect(labelNeeds(t)).toEqual({ kind: "needs", needs: [{ p: "food", state: "low" }] });
    // (a settlement still filling its first streets asks nothing of the player)
    t.pop = 40;
    expect(labelNeeds(t)).toEqual({ kind: "calm" });
    const was = { spawned: t.spawned, today: t.today, yesterday: t.yesterday, days: t.hist.days };
    Object.assign(t, { spawned: true, today: {}, yesterday: {} });
    t.hist.days = [];
    expect(labelNeeds(t)).toEqual({ kind: "noroad", needs: ["food"], joined: false });
    // joined by road, it stops saying "no road" and waits for its first load (play-test 2026-11-09, A10)
    expect(labelNeeds(t, true)).toEqual({ kind: "noroad", needs: ["food"], joined: true });
    expect(needView(t, "food", true).say).toBe("A road reaches it now. It waits for its first load of food.");
    Object.assign(t, { spawned: was.spawned, today: was.today, yesterday: was.yesterday });
    t.hist.days = was.days;
    t.pop = pop;
  });

  it("growth in words, no numbers: against the town's own best, so a hamlet and a city read alike", () => {
    const pop = t.pop, trend = t.trend;
    /**
     * every need at this share of a day's want, and the town growing at `k` of its best pace (towns.ts grows a town
     * at its full pace on a proven supply and eases off as it nears what that supply supports, so the share of its
     * best pace is what the words read)
     */
    const at = (p: number, share: Partial<Record<Product, number>>, k = 1) => {
      t.pop = p;
      const want = (q: Product) => demandPerDay(q, p) * (share[q] ?? 1);
      t.hours = Array.from({ length: 24 }, () => Object.fromEntries(needsOf(p).map((q) => [q, want(q) / 24])));
      t.hourNow = {};
      t.supply = Object.fromEntries(needsOf(p).map((q) => [q, Math.min(1, share[q] ?? 1)]));
      t.trend = growthPerDay(p) * k;
      return growthOf(t);
    };
    for (const p of [400, 2500, 8000]) {
      expect(at(p, {}).word).toBe("Growing fast");
      expect(at(p, Object.fromEntries(needsOf(p).map((q) => [q, ENOUGH])), 0.7).word).toBe("Growing");
      // one need running low holds it to a trickle, and says which
      expect(at(p, { food: 0.6 }, 0.2)).toEqual({ word: "Growing slowly", tone: "", why: "needs more food" });
      expect(at(p, { food: 0.3 }, 0)).toMatchObject({ word: "Not growing", tone: "bad", why: "needs food" });
    }
    // two short: both named
    expect(at(400, { food: 0.3, planks: 0 }, 0).why).toBe("needs food and planks");
    // still growing on the days behind it while a need has run short over the last one: the line says both, never
    // "Growing fast" over a row that reads "Running low" (owner, 2026-11-10)
    expect(at(400, { food: 0.6 }, 1)).toEqual({ word: "Growing", tone: "", why: "but food is running low" });
    expect(at(400, { food: 0.6, planks: 0.5 }, 0.8).why).toBe("but food and planks are running low");
    expect(townModel(g, t).status.text).toBe("Growing, but food and planks are running low");
    // none at all: it loses households
    expect(at(400, { food: 0 }, -0.1)).toEqual({ word: "Shrinking", tone: "bad", why: "needs food" });
    // a landmark's boost on top still reads "fast"; a settlement just settles
    expect(at(400, {}, 1.3).word).toBe("Growing fast");
    t.pop = 40;
    expect(growthOf(t).word).toBe("Settling in");
    // and the panel's status line carries the word, never a figure
    expect(at(400, { food: 0.3 }, 0)).toBeTruthy();
    expect(townModel(g, t).status.text).toBe("Not growing, needs food");
    at(400, {});
    expect(townModel(g, t).status.text).toBe("Growing fast");
    expect(/\d/.test(townModel(g, t).status.text)).toBe(false);
    t.pop = pop;
    t.trend = trend;
  });

  it("the panel's keys count the needs met, with no percentages", () => {
    feed(2);
    const m = townModel(g, t);
    expect(m.keys[1]).toMatchObject({ value: "0", unit: "/1", label: "needs met", tone: "bad" });
    expect(m.keys.some((k) => /%/.test(k.value))).toBe(false);
    expect(m.flow.some((r) => r.label === "Needs")).toBe(false);
    feed(demandPerDay("food", t.pop));
    expect(townModel(g, t).keys[1]).toMatchObject({ value: "1", unit: "/1", tone: "good" });
  });
});

describe("the need word holds still (display hysteresis)", () => {
  // its own town, so the word it showed last is not left over from the tests above
  let h: Town;
  const want = () => demandPerDay("food", h.pop);
  const at = (share: number) => {
    h.hours = Array.from({ length: 24 }, () => ({ food: (share * want()) / 24 }));
    h.hourNow = {};
    delete h.grace;
    return needView(h, "food");
  };
  beforeAll(() => {
    const game = new Game(7);
    game.start();
    h = game.towns.list[0];
    // settled (its map label speaks up) and food its only need
    h.pop = 80;
    h.spawned = false;
  });

  it("a town fed about right does not flip between Plenty and Enough each hour", () => {
    expect(at(0.9).word).toBe("Enough");
    expect(at(0.99).word).toBe("Enough"); // not earned until the full day's need
    expect(at(1).word).toBe("Plenty");
    for (const s of [0.97, 1.02, 0.96, 1, 0.95]) {
      const v = at(s);
      expect(v.word).toBe("Plenty");
      // the bar agrees with the word, and the figure under it is the real one
      expect(v.fill).toBe(1);
      expect(v.more).toBe(0);
      expect(v.got).toBeCloseTo(s * want());
    }
    expect(at(0.94).word).toBe("Enough");
    expect(at(0.99).word).toBe("Enough");
    expect(at(1.01).word).toBe("Plenty");
  });

  it("no band at the Enough line: under it the panel says short, as growth counts it (the grace covers a short dip)", () => {
    expect(at(0.79).word).toBe("Running low");
    expect(at(ENOUGH + 0.01).word).toBe("Enough");
    expect(labelNeeds(h).kind).toBe("calm");
    expect(at(0.79).word).toBe("Running low");
    expect(labelNeeds(h).kind).toBe("needs");
    // a fall straight from a held "Plenty" to under the line says short at once
    at(1);
    expect(at(0.96).word).toBe("Plenty");
    expect(at(0.79).word).toBe("Running low");
    expect(labelNeeds(h).kind).toBe("needs");
  });
});

describe("a town's map label zoomed far out: one chip in the town's own words (design audit 2026-11-10, F27, F41, F42)", () => {
  it("names one or two needs in trouble, counts more, and is red while one has none coming", () => {
    expect(labelSummary({ kind: "calm" })).toBeNull();
    expect(labelSummary({ kind: "needs", needs: [{ p: "food", state: "plenty" }, { p: "planks", state: "enough" }] })).toBeNull();
    expect(labelSummary({ kind: "needs", needs: [{ p: "food", state: "low" }, { p: "planks", state: "plenty" }] })).toEqual({ text: "Needs food", tone: "low" });
    expect(labelSummary({ kind: "needs", needs: [{ p: "food", state: "none" }, { p: "planks", state: "low" }] })).toEqual({ text: "Needs food and planks", tone: "bad" });
    expect(labelSummary({ kind: "needs", needs: [{ p: "food", state: "none" }, { p: "planks", state: "low" }, { p: "cement", state: "none" }] })).toEqual({ text: "Short of 3 needs", tone: "bad" });
  });

  it("a town with no road says so, and once joined that its first load is due", () => {
    expect(labelSummary({ kind: "noroad", needs: ["food"], joined: false })).toEqual({ text: "No road yet", tone: "" });
    expect(labelSummary({ kind: "noroad", needs: ["food"], joined: true })).toEqual({ text: "First load due", tone: "" });
  });
});
