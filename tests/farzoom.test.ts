import { describe, expect, it } from "vitest";
import { fixable } from "../src/ui/mapIcons";
import { FAR_FROM, FAR_FULL, FAR_LIFT, OVERLAY_LIFT, farLift } from "../src/render/daycycle";

describe("trouble roundels are only for what the company can fix (play-test 2026-11-09, A18)", () => {
  it("a town's shop short of customers or staff gets none", () => {
    expect(fixable({ town: 0, zone: "com" } as never, "Not enough customers")).toBe(false);
    expect(fixable({ town: 0, zone: "com" } as never, "Not enough workers")).toBe(false);
  });

  it("a town's shop out of food, or cut off from the roads, still does: a load or a road answers it", () => {
    expect(fixable({ town: 0, zone: "com" } as never, "Out of food")).toBe(true);
    expect(fixable({ town: 0, zone: "res" } as never, "No road access")).toBe(true);
  });

  it("every trouble of the company's own works does", () => {
    expect(fixable({} as never, "Waiting for crops")).toBe(true);
    expect(fixable({} as never, "No road to the gate")).toBe(true);
    expect(fixable({} as never, null)).toBe(false);
  });
});

describe("the night's floor from far out (play-test 2026-11-09, D5)", () => {
  it("close in the night is untouched", () => {
    expect(farLift(120)).toBe(0);
    expect(farLift(FAR_FROM)).toBe(0);
  });

  it("it lifts as the camera pulls out and is whole from the far view on", () => {
    const mid = farLift((FAR_FROM + FAR_FULL) / 2);
    expect(mid).toBeGreaterThan(0.3);
    expect(mid).toBeLessThan(0.7);
    expect(farLift(FAR_FULL)).toBe(1);
    expect(farLift(9000)).toBe(1);
    let last = 0;
    for (let h = 100; h < 4000; h += 50) { expect(farLift(h)).toBeGreaterThanOrEqual(last); last = farLift(h); }
  });

  it("never lifts as far as an overlay does: it is still night", () => {
    expect(FAR_LIFT).toBeLessThan(OVERLAY_LIFT);
  });
});
