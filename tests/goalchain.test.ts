// The goal's NOW line names the missing link of a two-step chain, read off the recipes (owner, 2026-11-10:
// "crops → Food Plant → food"). missingLink only reads the company's works, so a stub game will do.
import { describe, expect, it } from "vitest";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { MILESTONES } from "../src/game/progression";
import { PLANTS, type PlantKind } from "../src/game/industry";
import { FIRST_LOAD, goalNow, goalNowSay as say, missingLink } from "../src/ui/goalNow";

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
    expect({ ...n, fix: plain(n.fix) }).toEqual({
      who: "Your Farm", text: "No Food Plant to take its crops",
      fix: "Build a Food Plant: crops → Food Plant → food.", tone: "", works: farm.id, link: true,
    });
  });

  it("a food plant with no farm: build the Farm", () => {
    const fp = works("foodplant");
    const n = missingLink(game(fp), "food")!;
    expect(n).toMatchObject({ who: "Your Food Plant", works: fp.id });
    expect(goalNowSay(n)).toBe("Your Food Plant: waiting for crops, which nothing of yours makes. Build a Farm: crops → Food Plant → food.");
  });

  it("names every input missing, and only those, with the recipe in full", () => {
    const sm = works("smelter");
    expect(goalNowSay(missingLink(game(sm), "steel")!)).toBe(
      "Your Smelter: waiting for iron ore and coal, which nothing of yours makes. Build an Iron Mine and a Coal Mine: iron ore and coal → Smelter → steel.",
    );
    expect(goalNowSay(missingLink(game(sm, works("coalmine")), "steel")!)).toBe(
      "Your Smelter: waiting for iron ore, which nothing of yours makes. Build an Iron Mine: iron ore and coal → Smelter → steel.",
    );
    // a logging camp with no sawmill
    expect(plain(missingLink(game(works("loggingcamp")), "planks")!.fix)).toBe("Build a Sawmill: logs → Sawmill → planks.");
  });

  it("a works not open to build yet is named with the goal that opens it", () => {
    const g = { ...game(works("ironmine")), placedUnlocked: (k: string) => k !== "smelter" } as unknown as Game;
    expect(plain(missingLink(g, "steel")!.fix)).toBe("A Smelter opens with the goal “Village”: iron ore and coal → Smelter → steel.");
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
      expect(now?.text, mid).toMatch(/^Waiting for /);
      expect(plain(now!.fix), mid).toMatch(/^Build an? [A-Z].*: .+ → .+ → .+\.$/);
    }
  });
});
