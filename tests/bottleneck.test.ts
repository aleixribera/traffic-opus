// The game names the bottleneck (play-test 2026-11-09, B1, D2, D3, D4, A13, E2): the words a works at full output, a
// short town and a building site say, and the sums under them. The wording is checked as plain strings so a change
// to it is a choice; the readings are checked against a real first chain on seed 7.

import { beforeAll, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { blockOf, demandPerDay, gridPt } from "../src/game/towns";
import { Industry } from "../src/game/industry";
import { F } from "../src/world/gen";
import type { V2 } from "../src/core/math";
import type { Building } from "../src/game/buildings";
import type { Town } from "../src/game/settlements";
import {
  FULL_OUTPUT, aboutHours, atFullOutput, blockFix, blockWords, buildOrder, canPerDay, ceilingFix, ceilingOf, flatOut, hasMade, needHelp, needHelpSay,
  nextLoad, shortOf, shortfalls, siteHours, siteLine, sitePace, siteStatus, steadyProblem, tally, townWants, watchSites, worksFor, worstCeiling,
} from "../src/ui/bottleneck";
import { noBuyer, siteModel, takenBy } from "../src/ui/inspect";
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
    expect(buildOrder(["smelter", "coalplant", "coalmine", "ironmine"])).toEqual(["coalmine", "coalplant", "ironmine", "smelter"]);
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
  });

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
    expect(st.fix).toBe(`${n.say}.`);
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

  it("a building site counts its loads and guesses its hours from the pace they come at (D4)", () => {
    const P = foodplant.plant!;
    P.site = { need: { planks: 50 }, got: { planks: 10 } } as NonNullable<typeof P.site>;
    watchSites(g);
    // no pace yet: the count alone
    expect(siteStatus(g, foodplant).line).toBe("10 of 50 loads delivered");
    // two hours on, eight more loads in: four an hour, thirty-two to go, then the build
    g.time += 2 * HOUR;
    P.site!.got.planks = 18;
    watchSites(g);
    expect(sitePace(foodplant, g.time)).toBeCloseTo(4);
    const s = siteStatus(g, foodplant);
    expect(s.hours!).toBeGreaterThan(8);
    expect(s.line).toMatch(/^18 of 50 loads delivered, about \d+ hours to go$/);
    expect(s.slow).toBe(false);
    const st = siteModel(g, foodplant).status;
    expect(st.text).toBe("Building site");
    expect(st.fix).toContain(s.line);
    expect(st.fix).toContain("Nothing of yours makes planks yet. Build a Sawmill.");
    P.site = undefined;
    expect(Industry.madeLately(foodplant, "food").hours).toBeGreaterThan(0);
  });
});
