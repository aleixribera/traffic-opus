// What a locked catalog card says opens it (interface text rework, 2026-11-10: "Two villages", "Steady trade" and
// "Big village" named a goal, and the player had to look it up to learn what to do). The card says the thing to do
// in a few words; the goal's name is in the catalog's line and the card's label. Pure, so a test can hold every
// goal to it and the numbers to the goal's own.

import type { Milestone } from "../game/progression";

export const LOCK_SHORT: Record<string, string> = {
  food10: "First food delivered",
  hamlet150: "A town of 150",
  village: "A town of 300",
  planks10: "10 loads of planks",
  heavy: "150 loads delivered",
  steel: "First steel",
  cement: "First cement",
  villages2: "Two towns of 300",
  pop1000: "A town of 1,000",
  fuel1: "First fuel",
  goods1: "First household goods",
  town: "A town of 1,500",
  townSupplied: "A town of 1,500 supplied",
  pop4000: "A town of 4,000",
  city: "A town of 6,000",
  machinery1: "First machinery",
  citySupplied: "A city of 6,000 supplied",
  bigiron: "First oversized load",
  worldsfair: "A finished landmark",
  cars1: "First cars delivered",
};

/** What opens a card locked behind `m`, in a few words: "A town of 1,000", "First steel". */
export function lockShort(m: Pick<Milestone, "id" | "name">): string {
  return LOCK_SHORT[m.id] ?? m.name;
}
