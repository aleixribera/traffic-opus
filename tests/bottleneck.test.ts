// The game names the bottleneck (play-test 2026-11-09, B1, D2, D3, D4, A13, E2): the words a works at full output, a
// short town and a building site say, and the sums under them. The wording is checked as plain strings so a change
// to it is a choice; the readings are checked against a real first chain on seed 7.

import { beforeAll, describe, expect, it, vi } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { buildTime } from "../src/game/construction";
import { MILESTONES } from "../src/game/progression";
import { blockOf, demandPerDay, gridPt } from "../src/game/towns";
import { HIST_HOURS, Industry, PLANTS } from "../src/game/industry";
import { F } from "../src/world/gen";
import type { V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import type { Town } from "../src/game/settlements";
import {
  FULL_OUTPUT, START_HOURS, aboutHours, atFullOutput, batchHours, blockFix, blockWords, buildOrder, canPerDay, ceilingFix, ceilingOf, flatOut, hasMade,
  needHelp, needHelpSay, nextLoad, shortOf, shortfalls, shownRate, siteHours, siteLine, siteStatus, startUp, steadyProblem, tally, townAdvice, townWants,
  powerFix, waitsForSite, worksFor, worstCeiling,
} from "../src/ui/bottleneck";
import { noBuyer, powerCeiling, signedMoney, siteModel, takenBy, townModel, worksCalm, worksStatus } from "../src/ui/inspect";
import { goalNow, goalNowSay } from "../src/ui/goalNow";
import { DEAR_MIN, DEAR_SHARE, dearShare } from "../src/ui/cost";
import { tipFor } from "../src/ui/tips";
import { placeAlong, road } from "./helpers";

describe("the sums", () => {
  it("full output is the last tenth of what a works can make", () => {
    expect(atFullOutput(9, 10)).toBe(true);
    expect(atFullOutput(10 * FULL_OUTPUT - 0.01, 10)).toBe(false);
    // (a works that can make nothing is not "at full output")
    expect(atFullOutput(0, 0)).toBe(false);
  });

  it("works to build for a shortfall: at least one, and a sliver over does not ask for one more", () => {
    expect(worksFor(0, 12)).toBe(0);
    expect(worksFor(1, 12)).toBe(1);
    expect(worksFor(30, 12)).toBe(3);
    expect(worksFor(25, 12)).toBe(2);
    expect(worksFor(264, 96)).toBe(3);
  });

  it("a wait in words", () => {
    expect(aboutHours(0.3)).toBe("under an hour");
    expect(aboutHours(1.2)).toBe("about 1 hour");
    expect(aboutHours(6.4)).toBe("about 6 hours");
    expect(aboutHours(30)).toBe("about 30 hours");
    expect(aboutHours(60)).toBe("about 3 days");
  });

  it("hours till a site opens: the loads still to come at their pace, then the build", () => {
    // 37 loads left at 8 an hour, then 2 hours of building
    expect(siteHours(37, 8, 2)).toBeCloseTo(37 / 8 + 2);
    // all in: only the build
    expect(siteHours(0, 0, 2)).toBe(2);
    // nothing has come yet: no pace to judge by, so no guess
    expect(siteHours(50, 0, 2)).toBeNull();
  });

  it("a building site's line", () => {
    expect(siteLine(13, 50, 6.6)).toBe("13 of 50 loads delivered, about 7 hours to go");
    expect(siteLine(0, 50, null)).toBe("0 of 50 loads delivered");
    expect(siteLine(50, 50, 2)).toBe("All 50 loads delivered, going up: about 2 hours to go");
    // (a part load on a truck is not a load delivered)
    expect(siteLine(12.7, 50, null)).toBe("12 of 50 loads delivered");
  });
});

describe("what a click costs", () => {
  it("is called out from a quarter of the cash, and never for small change (C5)", () => {
    expect(dearShare(7778, 25000)).toBe(31);
    expect(dearShare(16722, 50000)).toBe(33);
    expect(dearShare(6000, 25000)).toBe(0);
    // (a street stub with an empty bank is not "dear", it is unaffordable or trivial)
    expect(dearShare(DEAR_MIN - 1, 3000)).toBe(0);
    expect(dearShare(DEAR_SHARE * 100000, 100000)).toBe(25);
  });
});

describe("the words", () => {
  it("a works at full output says who would take more and the two ways out", () => {
    expect(ceilingFix({ works: "Food Plant", product: "food", taker: "Alder Run", more: 30, nextLevel: 3 }))
      .toBe("Alder Run would take 30 more loads of food a day. Build another Food Plant, or wait for level 3.");
    expect(ceilingFix({ works: "Food Plant", product: "food", taker: "Alder Run", more: 1, others: 2, nextLevel: null }))
      .toBe("Alder Run and 2 more towns would take 1 more load of food a day. Build another Food Plant.");
    expect(ceilingFix({ works: "Food Plant", product: "food", taker: "Quimbyton", more: 1055 })).toContain("would take 1,055 more loads of food a day");
    expect(ceilingFix({ works: "Farm", product: "crops", taker: "Your Food Plant", nextLevel: null }))
      .toBe("Your Food Plant is waiting for crops. Build another Farm.");
  });

  it("a town's short need says what to build, how many, or which works to look at", () => {
    expect(needHelpSay({ kind: "none", works: "Sawmill", product: "planks" })).toBe("Nothing of yours makes planks yet. Build a Sawmill.");
    expect(needHelpSay({ kind: "none", works: "Oil Well", product: "oil" })).toBe("Nothing of yours makes oil yet. Build an Oil Well.");
    expect(needHelpSay({ kind: "full", works: "Food Plant", have: 1, n: 1 })).toBe("Your Food Plant is at full output. Build another.");
    expect(needHelpSay({ kind: "full", works: "Food Plant", have: 5, n: 3 })).toBe("Your 5 Food Plants are at full output. Build about 3 more.");
    expect(needHelpSay({ kind: "full", works: "Cement Works", have: 2, n: 1 })).toBe("Your 2 Cement Works are at full output. Build another.");
    expect(needHelpSay({ kind: "held", works: "Sawmill", problem: "Waiting for logs" })).toBe("Your Sawmill is held up: waiting for logs.");
  });

  it("a power plant in hand lists the works it will power, building sites too (A12)", () => {
    expect(tally(["Coal Mine", "Smelter"])).toBe("Coal Mine, Smelter");
    expect(tally(["Coal Mine", "Smelter", "Coal Mine"])).toBe("2 Coal Mines, Smelter");
    expect(tally(["Quarry", "Cement Works", "Cement Works", "Smelter", "Iron Mine", "Iron Mine"])).toBe("Quarry, 2 Cement Works, Smelter and 2 more");
  });

  it("newly unlocked works are listed in the order to build them: what feeds another comes first (B5)", () => {
    // the works that powers the others first (they stand at 40% without it; it burns the sawmills' wood chips till
    // the coal comes), then what feeds it, then the rest feeder first (owner, 2026-11-10: it was listed third)
    expect(buildOrder(["smelter", "coalplant", "coalmine", "ironmine"])).toEqual(["coalplant", "coalmine", "ironmine", "smelter"]);
    expect(buildOrder(MILESTONES.find((m) => m.id === "village")!.unlocks.buildings!)).toEqual(["coalplant", "coalmine", "ironmine", "smelter"]);
    // (the goal's own list is kept in that order, so the Goals card and the banner say the same)
    expect(MILESTONES.find((m) => m.id === "village")!.unlocks.buildings).toEqual(["coalplant", "coalmine", "ironmine", "smelter"]);
    // every goal's new works: a power plant never listed after a works that draws power, a feeder never after its taker
    for (const m of MILESTONES) {
      const ks = buildOrder(m.unlocks.buildings ?? []);
      expect([...ks].sort()).toEqual([...(m.unlocks.buildings ?? [])].sort());
    }
    expect(buildOrder(["cementworks", "quarry"])).toEqual(["quarry", "cementworks"]);
    expect(buildOrder(["farm"])).toEqual(["farm"]);
  });

  it("why a junction holds a vehicle is said in words, never the sim's own name for it (D3)", () => {
    for (const k of ["box", "red", "yield", "stop", "courtesy", "crossing", "reserved"]) {
      expect(blockWords(k)).not.toBe(k);
      expect(blockWords(k)).not.toMatch(/\bbox\b|reserved|courtesy/);
      expect(blockWords(k).length).toBeGreaterThan(12);
    }
    // (a reason added to the sim later still reads as a sentence)
    expect(blockWords("something-new")).toBe("it waits for the junction ahead to clear");
    expect(blockFix("box")).toMatch(/further on/);
  });
});

/** The first chain a player builds on seed 7 (as in inspect.test.ts): a farm on fertile soil and a food plant by the town. */
function chain(g: Game) {
  g.start();
  const t = g.towns.list[0];
  const end = gridPt(t.c, t.ang, 1 + 320 / blockOf(t), 0, blockOf(t));
  let f: V2 | null = null, bd = Infinity;
  for (let r = 50; r < 1200 && !f; r += 25) for (let k = 0; k < 48; k++) {
    const p = { x: end.x + Math.cos((k / 48) * 6.283) * r, y: end.y + Math.sin((k / 48) * 6.283) * r };
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(F.fert, { x: p.x + i * 15, y: p.y + j * 15 })) ok++;
    if (ok >= 20 && r < bd) { bd = r; f = p; }
  }
  const far = { x: f!.x + ((f!.x - end.x) / bd) * 80, y: f!.y + ((f!.y - end.y) / bd) * 80 };
  road(g, end, far);
  const farm = placeAlong(g, "farm", end, far, 35);
  const foodplant = placeAlong(g, "foodplant", gridPt(t.c, t.ang, 1, 0, blockOf(t)), end, 35);
  return { t, farm, foodplant };
}

describe("a power plant at its limit", () => {
  // (the late save read "Working normally" on a plant beside three works short of its power)
  const plant = { id: 1, plant: { level: 1 } } as unknown as Building;
  const works = [2, 3, 4].map((id) => ({ id }) as unknown as Building);
  const game = (made: number, used: number, short: number[]) => ({
    buildings: { list: [plant, ...works] },
    utilities: { plants: new Map([[1, { made, used, users: 3 }]]), supplyOf: (o: Building) => (short.includes(o.id) ? 0.4 : 1), reaches: () => true },
  }) as unknown as Game;
  it("says how much its reach wants against what it makes, and the way out", () => {
    expect(powerCeiling(game(60, 90, [2, 3, 4]), plant)!.fix).toBe("The 3 works in its reach want 90 MW. It makes 60. Build another Power Plant nearby, or wait for level 2.");
    expect(powerCeiling(game(60, 70, [4]), plant)!.fix).toMatch(/^The works in its reach want 70 MW\./);
  });
  it("a works whose power came back since its hourly line says so, not that the plant is short", () => {
    const pp = { id: 1, kind: "coalplant", built: 1, c: { x: 0, y: 0 }, plant: { stock: { coal: 5 } } } as unknown as Building;
    const mine = { id: 2, kind: "coalmine", built: 1, c: { x: 300, y: 0 }, plant: {}, problem: "No power: working at 40%" } as unknown as Building;
    const at = (supply: number) => ({
      buildings: { list: [pp, mine] },
      utilities: { plants: new Map([[1, { made: 40, used: 50, users: 2 }]]), supplyOf: () => supply, reaches: () => true, outputOf: () => 40 },
    }) as unknown as Game;
    expect(powerFix(at(1), mine)).toEqual({ fix: "It is up to pace again within the hour.", show: 1, back: true });
    expect(powerFix(at(0.4), mine)).toEqual({ fix: "Your Power Plant (300 m) cannot power everything in its reach. Build another Power Plant nearby.", show: 1 });
  });
  it("makes no such claim with power to spare, or with none made (that is its coal's line)", () => {
    expect(powerCeiling(game(60, 60, []), plant)).toBeNull();
    expect(powerCeiling(game(0, 90, [2, 3, 4]), plant)).toBeNull();
  });
});

describe("read off the game", () => {
  let g: Game, t: Town, farm: Building, foodplant: Building;
  /** Its last hours of output, as a share of what it can make. */
  const made = (b: Building, p: "food" | "crops", share: number, hours = 6) => {
    b.plant!.hist = Array.from({ length: hours }, () => ({ [p]: (canPerDay(g, b, p) / 24) * share }));
  };
  beforeAll(() => {
    g = new Game(7);
    ({ t, farm, foodplant } = chain(g));
    for (const b of [farm, foodplant]) { b.built = 1; b.problem = null; if (b.plant) b.plant.site = undefined; }
  }, 120000);

  it("a new town with nothing coming would take its whole day's food", () => {
    expect(townWants(t, "food")).toBe(Math.max(1, Math.ceil(demandPerDay("food", t.pop) - 1e-6)));
    expect(townWants(t, "cars")).toBe(0);
  });

  it("a Food Plant flat out with its town still short reads 'At full output', not 'Working normally' (B1, D2)", () => {
    made(foodplant, "food", 1);
    const c = ceilingOf(g, foodplant)!;
    expect(c).not.toBeNull();
    expect(c.town!.t).toBe(t);
    expect(c.fix).toMatch(new RegExp(`^${t.name} would take \\d+ more loads? of food a day\\. Build another Food Plant`));
    const m = siteModel(g, foodplant);
    expect(m.status.text).toBe("At full output");
    expect(m.status.fix).toBe(c.fix);
    expect(worstCeiling(g)!.b).toBe(foodplant);
    // the town's row points at it, with how many more
    const h = needHelp(g, t, "food")!;
    expect(h.kind).toBe("full");
    if (h.kind === "full") {
      expect(h.works).toBe(foodplant.id);
      expect(h.n).toBe(worksFor(townWants(t, "food"), canPerDay(g, foodplant, "food")));
      expect(h.say).toMatch(/^Your Food Plant is at full output\. Build /);
    }
    // and so does the tip under the goals
    const tip = tipFor(g)!;
    expect(tip.id).toBe("ceiling");
    expect(tip.html).toContain("Your Food Plant is at full output.");
    // the Goals card's list once the goals run out names the same job
    expect(shortfalls(g)[0]).toMatchObject({ p: "food", worst: t });
    expect(shortfalls(g)[0].say).toContain("Your Food Plant is at full output.");
  });

  it("a works under its ceiling, or with no pace yet, makes no such claim", () => {
    made(foodplant, "food", 0.5);
    expect(ceilingOf(g, foodplant)).toBeNull();
    // (with crops in its yard: at half pace on an empty yard it would be waiting for them)
    const yard = foodplant.plant!.stock.crops;
    foodplant.plant!.stock.crops = 8;
    expect(siteModel(g, foodplant).status.text).toBe("Working normally");
    expect(needHelp(g, t, "food")).toBeNull();
    foodplant.plant!.stock.crops = yard;
    // (two hours in: still filling its first trucks)
    made(foodplant, "food", 1, 2);
    expect(ceilingOf(g, foodplant)).toBeNull();
  });

  it("one big batch in its first hours does not make a works flat out", () => {
    // (half its pace over three hours, all of it in one batch: the batch counted twice once read as full)
    const per = canPerDay(g, foodplant, "food") / 24;
    foodplant.plant!.hist = [{ food: per * 1.5 }, {}, {}];
    expect(flatOut(g, foodplant, "food")).toBe(false);
    // a Farm's one load every three hours or so still is, give or take the load that fell outside the hours read
    const each = canPerDay(g, farm, "crops") / 24;
    farm.plant!.hist = Array.from({ length: 12 }, (_, i) => (i % 4 === 0 ? { crops: each * 4 * 0.8 } : {}));
    expect(flatOut(g, farm, "crops")).toBe(true);
  });

  it("a works held up is the thing to look at, not another one", () => {
    made(foodplant, "food", 1);
    foodplant.problem = "Waiting for crops: the loads on their way are stuck in traffic";
    expect(ceilingOf(g, foodplant)).toBeNull();
    const h = needHelp(g, t, "food")!;
    expect(h.kind).toBe("held");
    expect(h.say).toBe("Your Food Plant is held up: waiting for crops.");
    // in a jam the panel never says to build more (D3: "building more makes it worse")
    const fix = siteModel(g, foodplant).status.fix!;
    expect(fix).toMatch(/Clear that jam/);
    expect(fix).not.toMatch(/Build or connect/);
    foodplant.problem = null;
  });

  it("a new works waiting for its first load is starting up, and says where the load comes from (A13)", () => {
    foodplant.plant!.hist = [];
    foodplant.plant!.last.made = 0;
    foodplant.plant!.now.made = 0;
    foodplant.problem = "Waiting for crops";
    expect(hasMade(foodplant)).toBe(false);
    const n = nextLoad(g, foodplant, "crops");
    expect(n.from).toBe(farm);
    expect(n.say).toMatch(/^Your Farm \(\d+(\.\d)? k?m\) sends the next crops: (under an hour|about \d+ hours?)$/);
    const st = siteModel(g, foodplant).status;
    expect(st.text).toBe("Starting up");
    expect(st.tone).toBe("");
    // (where its load is, and how long its own first batch takes after that: when its first truck leaves)
    expect(st.fix!.startsWith(`${n.say}. Its first load of food follows `)).toBe(true);
    expect(st.fix).toMatch(/follows (under an hour|about \d+ hours?) after that\.$/);
    // the town's advice does not call it "held up" either
    expect(needHelp(g, t, "food")!.say.startsWith("Your Food Plant is starting up. ")).toBe(true);
    // once it has made something, the same wait is a problem again, and a Farm flat out is named as the answer
    made(foodplant, "food", 0.3);
    made(farm, "crops", 1);
    const st2 = siteModel(g, foodplant).status;
    expect(st2.text).toBe("Waiting for crops");
    expect(st2.tone).toBe("bad");
    expect(st2.fix).toMatch(/^Your Farm is at full output\. Build another\./);
    // and the Farm says so itself: its customer is one of the company's own works
    expect(siteModel(g, farm).status.text).toBe("At full output");
    expect(siteModel(g, farm).status.fix).toMatch(/^Your Food Plant is waiting for crops\. Build another Farm/);
    // the town's row goes straight to the Farm: the works to build is a step up the chain
    const h = needHelp(g, t, "food")!;
    expect(h).toMatchObject({ kind: "full", build: "farm", works: farm.id });
    expect(h.say).toMatch(/^Your Food Plant is short of crops\. Your Farm is at full output\. Build (another|about \d+ more)\.$/);
    // (how many: crops for what the Food Plant could still make, at what one Farm grows)
    if (h.kind === "full") {
      const spare = canPerDay(g, foodplant, "food") * 0.7, each = canPerDay(g, farm, "crops");
      expect(h.n).toBe(Math.max(1, worksFor(Math.min(townWants(t, "food"), spare), each)));
    }
    // between two loads the sim's own line goes quiet: the reading does not flick back to "Working normally"
    foodplant.problem = null;
    expect(shortOf(g, foodplant)).toBe("crops");
    expect(steadyProblem(g, foodplant)).toBe("Waiting for crops");
    expect(siteModel(g, foodplant).status).toMatchObject({ text: "Waiting for crops", tone: "bad" });
    // nor does the town's row lose its advice, and the tip names the same works: a step up the chain
    expect(needHelp(g, t, "food")).toMatchObject({ kind: "full", build: "farm", works: farm.id });
    const tip = tipFor(g)!;
    expect(tip.id).toBe("ceiling");
    expect(tip.html).toContain(`<b>${t.name} needs more food.</b> Your Food Plant is short of crops. Your Farm is at full output.`);
  });

  it("a works nobody buys from yet says which town will, and from how many people (D7)", () => {
    // what towns buy is bought by towns; a by-product by the works that takes it
    expect(takenBy("planks")).toBe("towns buy them from 100 people");
    expect(takenBy("chips")).toBe("a power plant takes them");
    const mill = { kind: "sawmill", problem: "Nobody your roads reach buys planks" } as Building;
    const pop = t.pop;
    t.pop = 77;
    expect(noBuyer(g, mill)).toEqual({ text: "No buyer for planks yet", tone: "", fix: `Towns buy planks from 100 people. ${t.name} has 77. Until then it fills its yard` });
    t.pop = 140;
    expect(noBuyer(g, mill)).toEqual({ text: "No buyer for planks yet", tone: "bad", fix: `${t.name} buys planks. Join this works to it by road` });
    t.pop = pop;
    // any other trouble is not this one
    expect(noBuyer(g, { kind: "sawmill", problem: "Waiting for logs" } as Building)).toBeNull();
    expect(noBuyer(g, { kind: "sawmill", problem: null } as Building)).toBeNull();
  });

  it("with nothing of the company's making it, the line says what to build", () => {
    expect(nextLoad(g, foodplant, "planks").say).toBe("Nothing of yours makes planks yet. Build a Sawmill");
  });

  it("a building site counts its loads and guesses its hours from the pace the sim counted them at (D4)", () => {
    const P = foodplant.plant!;
    P.site = { need: { planks: 50 }, got: { planks: 10 } } as NonNullable<typeof P.site>;
    // no load has landed in an hour it remembers: the count alone
    expect(siteStatus(foodplant).line).toBe("10 of 50 loads delivered");
    // two full hours on, eight more loads in: four an hour, thirty-two to go, then the build
    P.site!.got.planks = 18;
    P.site!.hours = [4, 4];
    P.site!.hour = 0;
    // (the figures are the sim's own: the interface keeps no count of its own beside them)
    const e = Industry.siteEta(foodplant)!;
    expect(e).toMatchObject({ got: 18, need: 50, perHour: 4, hours: 8 });
    const s = siteStatus(foodplant);
    expect(s).toMatchObject({ got: e.got, need: e.need });
    expect(s.hours!).toBeCloseTo(e.hours! + buildTime("foodplant") / HOUR);
    expect(s.line).toMatch(/^18 of 50 loads delivered, about \d+ hours to go$/);
    expect(s.slow).toBe(false);
    const st = siteModel(g, foodplant).status;
    expect(st.text).toBe("Building site");
    expect(st.fix).toContain(s.line);
    expect(st.fix).toContain("Nothing of yours makes planks yet. Build a Sawmill.");
    P.site = undefined;
    expect(Industry.madeLately(foodplant, "food").hours).toBeGreaterThan(0);
  });

  it("a site or a works going up with no road to its gate says so first: nothing can come till it has one", () => {
    const P = foodplant.plant!, acc = foodplant.access;
    foodplant.access = null;
    P.site = { need: { planks: 50 }, got: { planks: 10 } } as NonNullable<typeof P.site>;
    const st = siteModel(g, foodplant).status;
    expect(st).toMatchObject({ text: "Building site", tone: "bad" });
    expect(st.fix).toBe("No road reaches its gate, so no loads can come. Draw a road to the gate marker. 10 of 50 loads delivered.");
    // (a red line, so the map marks it too)
    expect(worksCalm(g, foodplant)).toBe(false);
    P.site = undefined;
    foodplant.built = 0.5;
    const uc = siteModel(g, foodplant).status;
    expect(uc.text).toBe("Under construction · 50%");
    expect(uc.fix).toMatch(/^Opens in .+\. It has no road to its gate yet: draw one to the gate marker before it opens\.$/);
    foodplant.built = 1;
    foodplant.access = acc;
    expect(siteModel(g, foodplant).status.fix ?? "").not.toMatch(/no road/i);
  });

  it("a works a day open and still with nothing made is not starting up: its own problem line speaks (no 'starting up' for ever)", () => {
    const P = foodplant.plant!, keep = { hist: P.hist, last: P.last.made, now: P.now.made };
    P.last.made = 0;
    P.now.made = 0;
    foodplant.problem = "Waiting for crops";
    P.hist = [];
    expect(hasMade(foodplant)).toBe(false);
    expect(startUp(g, foodplant)).not.toBeNull();
    P.hist = Array.from({ length: HIST_HOURS }, () => ({}));
    expect(hasMade(foodplant)).toBe(false);
    expect(startUp(g, foodplant)).toBeNull();
    expect(siteModel(g, foodplant).status.text).not.toBe("Starting up");
    Object.assign(P, { hist: keep.hist });
    P.last.made = keep.last;
    P.now.made = keep.now;
    foodplant.problem = null;
  });

  it("a works short of power says where its power would come from: the plant to build, feed or reach", () => {
    // no power plant anywhere: build one, within its reach, on its roads
    expect(g.buildings.list.some((o) => o.kind === "coalplant")).toBe(false);
    foodplant.problem = "No power: working at 50%";
    const pf = powerFix(g, foodplant)!;
    expect(pf.fix).toBe(`Build a Power Plant within ${PLANTS.coalplant.reach! / 1000} km of it, on its roads. It burns coal, or your sawmills' wood chips.`);
    expect(pf.show).toBeUndefined();
    const st = siteModel(g, foodplant).status;
    expect(st).toMatchObject({ text: "No power", tone: "bad" });
    expect(st.fix).toBe(`Working at 50%. ${pf.fix}`);
    // any other trouble is not this one
    foodplant.problem = "Waiting for crops";
    expect(powerFix(g, foodplant)).toBeNull();
    foodplant.problem = null;
    expect(powerFix(g, foodplant)).toBeNull();
  });

  it("what a works shows it makes is its one pace, never above what it can make (owner, 2026-11-10: \"0.7/h, can 0.6\")", () => {
    const can = canPerDay(g, farm, "crops") / 24;
    // a camp or a farm ships whole batches: three hours read can hold one more than its pace allows
    farm.plant!.hist = [{ crops: can * 3 * 0.6 }, {}, { crops: can * 3 * 0.6 }];
    const r = shownRate(g, farm, "crops");
    expect(r.can).toBeCloseTo(can);
    expect(r.rate!).toBeLessThanOrEqual(can + 1e-9);
    // flat out by the status: the figure is what it can make, the same number twice
    made(farm, "crops", 1, 12);
    expect(flatOut(g, farm, "crops")).toBe(true);
    expect(shownRate(g, farm, "crops").rate).toBeCloseTo(can);
    // at half pace it says half
    made(farm, "crops", 0.5, 12);
    expect(shownRate(g, farm, "crops").rate).toBeCloseTo(can / 2);
    // nothing made yet: no figure at all, not "0.0/h"
    farm.plant!.hist = [{}, {}];
    expect(shownRate(g, farm, "crops").rate).toBeNull();
  });

  it("a works short of power never reads as making all it can, nor in the good green (design audit 2026-11-10: a green 0.4/h under 'No power')", () => {
    const can = canPerDay(g, farm, "crops") / 24;
    // lumpy hours a flat-out reading would round up to what it can make
    farm.plant!.hist = [{ crops: can * 3 * 0.8 }, {}, {}, {}];
    expect(flatOut(g, farm, "crops")).toBe(true);
    farm.problem = "No power: working at 40%";
    expect(shownRate(g, farm, "crops").rate!).toBeCloseTo(can * 0.6);
    const m = siteModel(g, farm);
    expect(m.status.tone).toBe("bad");
    expect(m.keys[0].tone).not.toBe("good");
    // its level line in the status's own words
    farm.plant!.why = "Short of power";
    expect(siteModel(g, farm).level?.line).toBe("held back: No power");
    farm.problem = null;
    farm.plant!.why = null;
  });

  it("a works that has made nothing yet is starting up, and says when its first truck leaves (owner, 2026-11-10)", () => {
    const fresh = (b: Building) => { b.plant!.hist = []; b.plant!.last.made = 0; b.plant!.now.made = 0; b.problem = null; };
    fresh(farm); fresh(foodplant);
    // no staff in its first hours: its workers are on their way, not "No workers" in red
    farm.problem = "No workers";
    expect(startUp(g, farm)!.fix).toMatch(/^Its first workers are on their way from town\. Once they start, its first load of crops takes (under an hour|about \d+ hours?)\.$/);
    expect(siteModel(g, farm).status).toMatchObject({ text: "Starting up", tone: "" });
    expect(worksCalm(g, farm)).toBe(true);
    // (and its key number claims no pace: it read "Working normally, 0.0/h")
    expect(siteModel(g, farm).keys[0]).toMatchObject({ value: "–", label: "no output yet" });
    // at work on its first batch: how long that has to go at the staff it has, and where the load goes
    farm.problem = null;
    farm.plant!.prog = 0.5;
    const staff = vi.spyOn(g.people, "workersAt").mockReturnValue(farm.cap);
    const bh = batchHours(g, farm, "crops");
    expect(bh.left!).toBeCloseTo(bh.whole / 2);
    const st = siteModel(g, farm).status;
    expect(st.text).toBe("Starting up");
    expect(st.fix).toMatch(new RegExp(`^Its first load of crops is ready in ${aboutHours(bh.left!)}\\. Then its first truck leaves for your Food Plant \\(\\d+(\\.\\d)? k?m\\)\\.$`));
    // half its staff: the batch takes twice as long; nobody at work: no guess
    staff.mockReturnValue(farm.cap / 2);
    expect(batchHours(g, farm, "crops").left!).toBeCloseTo(bh.whole);
    staff.mockReturnValue(0);
    expect(batchHours(g, farm, "crops").left).toBeNull();
    staff.mockRestore();
    // still no staff after START_HOURS game hours: that is trouble now, and it says so
    farm.problem = "No workers";
    const was = g.time;
    g.time += (START_HOURS + 1) * HOUR;
    expect(startUp(g, farm)).toBeNull();
    expect(siteModel(g, farm).status).toMatchObject({ text: "No workers", tone: "bad" });
    expect(worksCalm(g, farm)).toBe(false);
    g.time = was;
    // nothing of the company's makes its input: that is the thing to build, not a wait
    farm.problem = null;
    foodplant.problem = "Waiting for crops: the loads on their way are stuck in traffic";
    expect(startUp(g, foodplant)).toBeNull();
    foodplant.problem = null;
    // going up: when it opens, and when its first load follows
    farm.built = 0.5;
    const up = worksStatus(g, farm);
    expect(up.text).toBe("Under construction · 50%");
    expect(up.fix).toMatch(/^Opens in (under an hour|about \d+ hours?)\. Its first load of crops follows (under an hour|about \d+ hours?) later\.$/);
    foodplant.built = 0.5;
    expect(worksStatus(g, foodplant).fix).toMatch(/^Opens in (under an hour|about \d+ hours?)\. Your Farm \(\d+(\.\d)? k?m\) is still being built\. It sends crops once it opens\.$/);
    farm.built = 1;
    expect(worksStatus(g, foodplant).fix).toMatch(/\. Then it takes crops from your Farm \(\d+(\.\d)? k?m\)\.$/);
    foodplant.built = 1;
    // once it has made something it is a works like any other
    made(farm, "crops", 0.5);
    expect(startUp(g, farm)).toBeNull();
  });

  it("a works whose buyer is still being built waits for it, and says how far along that is (owner, 2026-11-10)", () => {
    made(farm, "crops", 0.5);
    const full = `Full of crops: its trucks can't keep up (a long or jammed haul), or no ${Industry.takers("crops")} on its roads`;
    farm.problem = full;
    // its Food Plant open: the haul is the story, as the sim says it
    expect(waitsForSite(g, farm)).toBeNull();
    expect(siteModel(g, farm).status).toMatchObject({ text: "Full of crops", tone: "bad" });
    // its Food Plant a building site: it waits for that, and points at it
    const P = foodplant.plant!;
    P.site = { need: { planks: 12 }, got: { planks: 3 } } as NonNullable<typeof P.site>;
    const w = waitsForSite(g, farm)!;
    expect(w.text).toBe("Waiting for your Food Plant to open");
    expect(w.tone).toBe("");
    expect(w.fix).toMatch(/^Your Food Plant \(\d+(\.\d)? k?m\) is a building site: 3 of 12 loads delivered\. It takes crops once it opens\. Until then this yard fills\.$/);
    expect(w.show).toBe(foodplant.id);
    const st = siteModel(g, farm).status;
    expect(st).toMatchObject({ text: w.text, tone: "", fix: w.fix, show: { id: foodplant.id, kind: "foodplant" } });
    // (no mark on the map for it: nothing to fix, the site has to finish)
    expect(worksCalm(g, farm)).toBe(true);
    // the sim's other line for the same wait reads the same way
    farm.problem = "The plants that will use crops are still building sites";
    expect(waitsForSite(g, farm)!.text).toBe("Waiting for your Food Plant to open");
    // its materials in and the crews at work: when it opens
    P.site = undefined;
    foodplant.built = 0.25;
    expect(waitsForSite(g, farm)!.fix).toMatch(/is going up: it opens in (under an hour|about \d+ hours?)\. It takes crops once it opens\./);
    foodplant.built = 1;
    farm.problem = null;
    // a product the towns buy is never this story
    foodplant.problem = "Full of food: its trucks can't keep up (a long or jammed haul), or nobody to sell to";
    expect(waitsForSite(g, foodplant)).toBeNull();
    foodplant.problem = null;
  });

  it("a town's panel says one thing: its status, one piece of advice with the works to show, then figures (owner, 2026-11-10)", () => {
    const pop = t.pop, hours = t.hours, trend = t.trend, supply = t.supply;
    t.pop = 400;
    t.trend = 0;
    t.hours = Array.from({ length: 24 }, () => ({}));
    t.hourNow = {};
    t.supply = {};
    made(foodplant, "food", 1);
    foodplant.plant!.stock.crops = 8;
    // food and planks both short: one piece of advice, about the first, and it says which
    const a = townAdvice(g, t, true)!;
    expect(a.p).toBe("food");
    expect(a.say).toMatch(/^Start with food\. Your Food Plant is at full output\. Build /);
    expect(a.works).toBe(foodplant.id);
    const m = townModel(g, t);
    expect(m.status.text).toBe("Not growing, needs food and planks");
    expect(m.status.fix).toBe(a.say);
    expect(m.status.show).toEqual({ id: foodplant.id, kind: "foodplant" });
    // food in full, planks still none: the advice moves on to planks, with nothing to show (no sawmill yet)
    t.hours = Array.from({ length: 24 }, () => ({ food: demandPerDay("food", t.pop) / 24 }));
    const b = townAdvice(g, t, true)!;
    expect(b).toMatchObject({ p: "planks", say: "Nothing of yours makes planks yet. Build a Sawmill." });
    expect(b.works).toBeUndefined();
    expect(townModel(g, t).status.show).toBeUndefined();
    // everything it needs coming in full: no advice at all
    t.hours = Array.from({ length: 24 }, () => ({ food: demandPerDay("food", t.pop) / 24, planks: demandPerDay("planks", t.pop) / 24 }));
    t.trend = 5;
    expect(townAdvice(g, t, true)).toBeNull();
    expect(townModel(g, t).status.fix).toBeUndefined();
    // a hamlet still settling in keeps its own line
    t.pop = 30;
    expect(townAdvice(g, t, true)).toBeNull();
    Object.assign(t, { pop, hours, trend, supply });
  });

  it("the first goal says what the chain is doing now, in the works' own words (owner, 2026-11-10: the quiet first hours)", () => {
    const food = MILESTONES.find((m) => m.id === "food10")!;
    // a goal that does not wait on a first load, or has it already: nothing under it
    expect(goalNow(g, MILESTONES.find((m) => m.id === "village")!, 0)).toBeNull();
    expect(goalNow(g, food, 1)).toBeNull();
    // nothing of the chain placed yet: the tip says what to build, and the first goal where its ground lies
    // (goalpointer.test.ts); a later goal says nothing
    const none = new Game(7);
    none.start();
    expect(goalNow(none, food, 0)?.key).toBe("Where");
    expect(goalNow(none, MILESTONES.find((m) => m.id === "planks10")!, 0)).toBeNull();
    // the food plant starting up: its panel's very status and advice
    foodplant.plant!.hist = []; foodplant.plant!.last.made = 0; foodplant.plant!.now.made = 0; foodplant.problem = null;
    foodplant.plant!.out.food = 0;
    const st = worksStatus(g, foodplant);
    const now = goalNow(g, food, 0)!;
    expect(now).toMatchObject({ who: "Your Food Plant", text: st.text, fix: st.fix, tone: st.tone, works: foodplant.id });
    expect(st.text).toBe("Starting up");
    expect(goalNowSay(now)).toBe(`Your Food Plant: starting up. ${st.fix}`);
    // trouble there shows as trouble here
    foodplant.problem = "No road to the gate";
    expect(goalNow(g, food, 0)!.tone).toBe("bad");
    foodplant.problem = null;
    // its first load made and at the dock: the truck is next
    foodplant.plant!.out.food = 1;
    expect(goalNowSay(goalNow(g, food, 0)!)).toBe("Your Food Plant: its first food is at the dock. Its truck sets off within the hour.");
    foodplant.plant!.out.food = 0;
    // only the farm so far (no food plant): the goal follows the chain up to it
    const k = foodplant.kind;
    (foodplant as { kind: string }).kind = "sawmill";
    expect(goalNow(g, food, 0)).toMatchObject({ who: "Your Farm", works: farm.id });
    (foodplant as { kind: string }).kind = k;
  });

  it("no money is $0, not a gain: the Economy window read +$0 in green", () => {
    expect(signedMoney(0)).toBe("$0");
    expect(signedMoney(0.3)).toBe("$0");
    expect(signedMoney(1200)).toMatch(/^\+\$/);
    expect(signedMoney(-1200)).toMatch(/^[-−]\$/);
  });

  // (last: it places a second Food Plant in the shared game)
  it("a new works starting up beside one flat out: the advice is still how many more, the new one counted in (late save's Food row)", () => {
    const second = placeAlong(g, "foodplant", gridPt(t.c, t.ang, 1, 0, blockOf(t)), gridPt(t.c, t.ang, 1 + 320 / blockOf(t), 0, blockOf(t)), 90);
    Object.assign(second, { built: 1, problem: "Waiting for crops" });
    second.plant!.site = undefined;
    second.plant!.hist = [];
    foodplant.problem = null;
    made(foodplant, "food", 1);
    expect(startUp(g, second)).not.toBeNull();
    expect(flatOut(g, foodplant, "food")).toBe(true);
    // (a town short of more than the new one will make: a town of 3,000 wants about 69 loads of food a day, more than
    // the two works make, 48; at 1,500, 46 since the demand rework of 2026-11-10, it no longer is)
    const pop = t.pop, BIG = 3000;
    t.pop = BIG;
    expect(townWants(t, "food")).toBeGreaterThan(canPerDay(g, second, "food") + canPerDay(g, foodplant, "food"));
    const h = needHelp(g, t, "food")!;
    expect(h).toMatchObject({ kind: "full", build: "foodplant", works: foodplant.id });
    if (h.kind === "full") {
      expect(h.n).toBe(worksFor(townWants(t, "food") - canPerDay(g, second, "food"), canPerDay(g, foodplant, "food")));
      expect(h.say).toBe(`Your Food Plant is at full output. Build ${h.n === 1 ? "another" : `about ${h.n} more`}. Your new Food Plant is starting up.`);
    }
    // short of no more than the new one will make: it says when its first load comes
    t.pop = pop;
    expect(needHelp(g, t, "food")!.say.startsWith("Your Food Plant is starting up. ")).toBe(true);
    // nor while the old one still has room: the new one is the news
    t.pop = BIG;
    made(foodplant, "food", 0.2);
    expect(needHelp(g, t, "food")!.say.startsWith("Your Food Plant is starting up. ")).toBe(true);
    t.pop = pop;
  });
});
