// The goal's NOW line names the missing link of a two-step chain, read off the recipes (owner, 2026-11-10:
// "crops → Food Plant → food"). missingLink only reads the company's works, so a stub game will do.
import { describe, expect, it, vi } from "vitest";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { MILESTONES } from "../src/game/progression";
import { PLANTS, type PlantKind } from "../src/game/industry";
import { FIRST_LOAD, goalNow, goalNowSay as say, missingLink } from "../src/ui/goalNow";

// (the ground a first works goes on is found on the map: here, one place for it)
vi.mock("../src/ui/goalPointer", () => ({ farmSpot: () => null, groundSpot: (_g: unknown, k: string) => (k === "loggingcamp" ? { x: 800, y: 0 } : null) }));

// (the chain keeps its end together with no-break spaces; the tests read it with plain ones)
const plain = (s: string | undefined) => s?.replace(/ /g, " ");
const goalNowSay = (n: Parameters<typeof say>[0]) => plain(say(n));

let id = 0;
const works = (kind: PlantKind, built = 1) => ({ id: ++id, kind, built, plant: {} }) as unknown as Building;
const game = (...bs: Building[]) => ({ industry: { plants: () => bs }, trips: () => [], placedUnlocked: () => true }) as unknown as Game;

describe("the missing link of a goal's chain", () => {
  it("a farm with no food plant: build the Food Plant", () => {
    const farm = works("farm");
    const n = missingLink(game(farm), "food")!;
    // (one sentence that names the works, then the fix, and the chain on a line of its own: docs/ui-words.md)
    expect(n).toMatchObject({ text: "Your Farm has no Food Plant to take its crops", tone: "", works: farm.id, link: true, p: "food" });
    expect(n.who).toBeUndefined();
    expect(goalNowSay(n)).toBe("Your Farm has no Food Plant to take its crops. Build a Food Plant: crops → Food Plant → food.");
  });

  it("a food plant with no farm: build the Farm", () => {
    const fp = works("foodplant");
    const n = missingLink(game(fp), "food")!;
    expect(n).toMatchObject({ works: fp.id });
    expect(goalNowSay(n)).toBe("Nothing of yours makes crops for your Food Plant. Build a Farm: crops → Food Plant → food.");
  });

  it("names every input missing, and only those, with the recipe in full", () => {
    const sm = works("smelter");
    expect(goalNowSay(missingLink(game(sm), "steel")!)).toBe(
      "Nothing of yours makes iron ore and coal for your Smelter. Build an Iron Mine and a Coal Mine: iron ore and coal → Smelter → steel.",
    );
    expect(goalNowSay(missingLink(game(sm, works("coalmine")), "steel")!)).toBe(
      "Nothing of yours makes iron ore for your Smelter. Build an Iron Mine: iron ore and coal → Smelter → steel.",
    );
    // a logging camp with no sawmill
    expect(goalNowSay(missingLink(game(works("loggingcamp")), "planks")!)).toBe("Your Logging Camp has no Sawmill to take its logs. Build a Sawmill: logs → Sawmill → planks.");
  });

  it("a works not open to build yet is named with the goal that opens it", () => {
    const g = { ...game(works("ironmine")), placedUnlocked: (k: string) => k !== "smelter" } as unknown as Game;
    expect(goalNowSay(missingLink(g, "steel")!)).toBe("Your Iron Mine has no Smelter to take its iron ore. A Smelter opens with the goal “Village”: iron ore and coal → Smelter → steel.");
  });

  it("a feeder whose goods another works takes is not blamed for a works not built (review 2026-11-10, B4)", () => {
    // a Coal Mine feeding a Smelter and a Power Plant, with the cement goal open and the Cement Works still locked
    const coal = works("coalmine");
    const locked = { ...game(coal, works("ironmine"), works("smelter"), works("coalplant")), placedUnlocked: (k: string) => k !== "cementworks" } as unknown as Game;
    const n = missingLink(locked, "cement")!;
    expect(n.who).toBeUndefined();
    expect(n.works).toBeUndefined();
    expect(goalNowSay(n)).toBe("No Cement Works yet. A Cement Works opens with the goal “Steady trade”: limestone and coal → Cement Works → cement.");
    // a coal mine with nothing else to take its coal is still the one to name
    expect(missingLink(game(coal), "cement")).toMatchObject({ text: expect.stringMatching(/^Your Coal Mine /), works: coal.id });
  });

  it("a site going up counts as there: no missing link while the chain is placed", () => {
    expect(missingLink(game(works("farm"), works("foodplant", 0.3)), "food")).toBeNull();
    expect(missingLink(game(works("ironmine"), works("coalmine"), works("smelter")), "steel")).toBeNull();
    // nothing of the chain at all: not this line's business (the tip says what to build)
    expect(missingLink(game(), "food")).toBeNull();
    // a raw good has no chain
    expect(missingLink(game(works("farm")), "crops")).toBeNull();
  });

  it("every goal that waits on a first load gets the line, by its own recipe", () => {
    for (const [mid, f] of Object.entries(FIRST_LOAD)) {
      const m = MILESTONES.find((x) => x.id === mid)!;
      expect(m, mid).toBeDefined();
      // (the works that makes it stands alone: the line asks for what feeds it, and ends on the goal's product)
      const k = (Object.keys(PLANTS) as PlantKind[]).find((x) => (PLANTS[x].outputs[f.p] ?? 0) > 0)!;
      const now = goalNow(game(works(k)), m, 0);
      expect(now?.text, mid).toMatch(/^Nothing of yours makes .+ for your [A-Z]/);
      expect(plain(now!.fix), mid).toMatch(/^Build an? [A-Z][^.]*\.?$/);
      expect(plain(now!.chain), mid).toMatch(/^.+ → .+ → .+$/);
    }
  });
});

describe("a goal to grow a town says what holds it (review 2026-11-10, First hour)", () => {
  // (the home hamlet, fed in full, its first food sold, past "First customers")
  const hamlet = (pop: number, rate: Record<string, number>, bs: Building[] = [], sold: Record<string, number> = { food: 3 }) => {
    const t = { id: 1, name: "Alder Run", pop, rate, c: { x: 0, y: 0 } };
    const done = ["food10"];
    const g = {
      ...game(...bs), towns: { list: [t], byId: new Map([[1, t]]) }, buildings: { byId: new Map() },
      progress: { sold, done, open: () => MILESTONES.filter((m) => !done.includes(m.id)).slice(0, 3) },
    } as unknown as Game;
    return g;
  };
  const growing = MILESTONES.find((m) => m.id === "hamlet150")!, village = MILESTONES.find((m) => m.id === "village")!;

  it("held for want of planks with nothing of the chain placed: the town, the need and the chain to build", () => {
    const g = hamlet(127, { food: 50 });
    const n = goalNow(g, growing, 127)!;
    expect(n.tone).toBe("bad");
    // (and flies to the forest for the camp)
    expect(n.spot).toEqual({ x: 800, y: 0 });
    expect(goalNowSay(n)).toBe("Alder Run holds at 127 people, short of planks. Build a Logging Camp and a Sawmill: logs → Sawmill → planks. Forest lies 800 m east of Alder Run.");
    // (once, under the first goal that grows a town: the Village goal after it would only say it again)
    expect(goalNow(g, village, 127)).toBeNull();
  });

  it("with part of the chain placed, the link it lacks", () => {
    const n = goalNow(hamlet(127, { food: 50 }, [works("loggingcamp")]), growing, 127)!;
    expect(goalNowSay(n)).toBe("Alder Run holds at 127 people, short of planks. Build a Sawmill: logs → Sawmill → planks.");
  });

  it("growing toward the need, its first food in: planks named before they hold it", () => {
    expect(goalNowSay(goalNow(hamlet(81, { food: 50 }), growing, 81)!)).toBe(
      "Alder Run will want planks from 100 people. Build a Logging Camp and a Sawmill: logs → Sawmill → planks.",
    );
    // (why it matters is in the tooltip)
    expect(goalNow(hamlet(81, { food: 50 }), growing, 81)!.more).toBe("Without a supply it stops growing there.");
    // (not before its first food is sold: one chain at a time)
    expect(goalNow(hamlet(81, { food: 50 }, [], {}), growing, 81)).toBeNull();
    // (nor with a sawmill placed: it is on its way)
    expect(goalNow(hamlet(81, { food: 50 }, [works("sawmill")]), growing, 81)).toBeNull();
  });
});
