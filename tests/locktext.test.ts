// A locked catalog card says what opens it in plain words, not the goal's name (interface text rework, 2026-11-10).

import { describe, expect, it } from "vitest";
import { MILESTONES } from "../src/game/progression";
import { LOCK_SHORT, lockShort } from "../src/ui/lockText";

describe("what a locked card says", () => {
  it("every goal has its own short words", () => {
    for (const m of MILESTONES) expect(LOCK_SHORT[m.id], m.id).toBeTruthy();
  });

  it("the numbers in the words are the goal's own", () => {
    const nums = (s: string) => (s.match(/\d[\d,]*/g) ?? []).map((n) => n.replace(/,/g, ""));
    for (const m of MILESTONES) for (const n of nums(lockShort(m))) expect(nums(m.goal), `${m.id}: ${lockShort(m)}`).toContain(n);
  });

  it("is short enough for a card", () => {
    for (const m of MILESTONES) expect(lockShort(m).length, m.id).toBeLessThanOrEqual(26);
  });
});
