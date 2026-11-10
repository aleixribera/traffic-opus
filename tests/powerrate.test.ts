// A works short of power shows what it actually makes (owner, 2026-11-10: the late save's Iron Mine read "No power,
// working at 40%" over "10 loads a day, can 10" and a full bar in Economy). The sim works it at powerPace(share) of
// its pace (industry.ts), so the figure the panel and Economy share never goes above that.
import { describe, expect, it } from "vitest";
import type { Game } from "../src/game/city";
import type { Building } from "../src/game/buildings";
import { UNPOWERED, powerPace } from "../src/game/industry";
import { canPerDay, shownRate } from "../src/ui/bottleneck";

const mine = (hist: Record<string, number>[], problem: string | null = "No power: working at 40%", cap?: number) =>
  ({ id: 1, kind: "ironmine", built: 1, problem, cap, plant: { level: 1, yld: 0.65, hist } }) as unknown as Building;
const game = (share: number, workers = 0) => ({ time: 0, utilities: { supplyOf: () => share }, people: { workersAt: () => workers } }) as unknown as Game;

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

// The same for a works short of workers: the sim works it at min(1, workers / jobs) of its pace (industry.ts produce).
describe("a works short of workers", () => {
  it("half staffed, one early load reads at half its pace, not all it could make", () => {
    const g = game(1, 5);
    const b = mine([{}, {}, {}, {}, {}, { ore: 1 }], "Short of workers", 10);
    const can = canPerDay(g, b, "ore");
    const r = shownRate(g, b, "ore");
    expect(r.can * 24).toBeCloseTo(can);
    expect(r.rate! * 24).toBeCloseTo(can * 0.5);
  });

  it("short of both, the two factors multiply, as in the sim", () => {
    const g = game(0, 5);
    const b = mine([{}, {}, {}, {}, {}, { ore: 1 }], "No power: working at 40%", 10);
    expect(shownRate(g, b, "ore").rate! * 24).toBeCloseTo(canPerDay(g, b, "ore") * 0.5 * UNPOWERED);
  });

  it("fully staffed, or a works with no jobs to fill, is not held back", () => {
    const can = canPerDay(game(1), mine([]), "ore") / 24;
    const steady = () => Array.from({ length: 12 }, () => ({ ore: can }));
    expect(shownRate(game(1, 10), mine(steady(), null, 10), "ore").rate).toBeCloseTo(can);
    expect(shownRate(game(1, 25), mine(steady(), null, 10), "ore").rate).toBeCloseTo(can);
    expect(shownRate(game(1, 0), mine(steady(), null), "ore").rate).toBeCloseTo(can);
  });
});
