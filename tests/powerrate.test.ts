// A works short of power shows what it actually makes (owner, 2026-11-10: the late save's Iron Mine read "No power,
// working at 40%" over "10 loads a day, can 10" and a full bar in Economy). The sim works it at powerPace(share) of
// its pace (industry.ts), so the figure the panel and Economy share never goes above that.
import { describe, expect, it } from "vitest";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { UNPOWERED, powerPace } from "../src/game/industry";
import { canPerDay, shownRate } from "../src/ui/bottleneck";

const mine = (hist: Record<string, number>[], problem: string | null = "No power: working at 40%") =>
  ({ id: 1, kind: "ironmine", built: 1, problem, plant: { level: 1, yld: 0.65, hist } }) as unknown as Building;
const game = (share: number) => ({ time: 0, utilities: { supplyOf: () => share } }) as unknown as Game;

describe("a works short of power", () => {
  it("one load in its first hour reads at the 40% it works at, not all it could make (the late save's Iron Mine)", () => {
    const b = mine([{}, {}, {}, {}, {}, { ore: 1 }]);
    const g = game(0);
    const can = canPerDay(g, b, "ore");
    const r = shownRate(g, b, "ore");
    expect(r.can * 24).toBeCloseTo(can);
    expect(r.rate! * 24).toBeCloseTo(can * UNPOWERED);
    expect(r.rate! * 24).toBeLessThan(can * 0.5);
  });

  it("flat out at the pace power allows reads as that pace, never as all it can", () => {
    const g = game(0.5);
    const can = canPerDay(g, mine([]), "ore") / 24;
    const b = mine(Array.from({ length: 12 }, () => ({ ore: can })), "Short of power: working at 70%");
    expect(shownRate(g, b, "ore").rate).toBeCloseTo(can * powerPace(0.5));
  });

  it("with its power back it reads its pace again, up to all it can", () => {
    const g = game(1);
    const can = canPerDay(g, mine([]), "ore") / 24;
    const b = mine(Array.from({ length: 12 }, () => ({ ore: can })), null);
    expect(shownRate(g, b, "ore").rate).toBeCloseTo(can);
  });
});
