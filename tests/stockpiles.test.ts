import { describe, expect, it } from "vitest";
import { SCENERY_FILL, pileFills, storeFill, yardProduct } from "../src/game/stockpiles";
import type { Building } from "../src/game/buildings";

const works = (kind: string, stock: Record<string, number>, out: Record<string, number> = {}): Building =>
  ({ kind, placed: true, plant: { stock, out, prog: 0, yld: 1, level: 1 } }) as unknown as Building;

describe("stockpiles", () => {
  it("a yard holds what its works takes in or turns out", () => {
    expect(yardProduct("coalmine", "site_heap_coal")).toBe("coal");
    expect(yardProduct("glassworks", "site_heap_sand")).toBe("sand");
    expect(yardProduct("sawmill", "site_logyard")).toBe("logs");
    expect(yardProduct("furniture", "site_logyard")).toBe("planks");
    // (a coal bay at a works that burns none is scenery)
    expect(yardProduct("sawmill", "site_heap_coal")).toBeNull();
  });

  it("the store and the output waiting for a truck both lie in the yard, never more than it holds", () => {
    const b = works("glassworks", { sand: 2 }, { glass: 3 });
    expect(storeFill(b, "sand", 8)).toBeCloseTo(0.25);
    expect(storeFill(works("coalmine", {}, { coal: 20 }), "coal", 8)).toBe(1);
    expect(storeFill(works("coalmine", {}, {}), "coal", 8)).toBe(0);
  });

  it("the heaps of a product fill one after another across its yards, and empty the same way", () => {
    const slots = ["site_heap_coal", "site_heap_coal", "site_workshop", "coalmine", "site_heap_coal"];
    // half the store: three of the six heaps full, the rest empty
    const half = pileFills(works("coalmine", {}, { coal: 4 }), slots, 8);
    expect(half[2]).toBeNull();
    expect(half[3]).toBeNull();
    expect(half[0]).toEqual([1, 1]);
    expect(half[1]![0]).toBe(1);
    expect(half[1]![1]).toBe(0);
    expect(half[4]).toEqual([0, 0]);
    // a quarter more: the next heap half up
    const more = pileFills(works("coalmine", {}, { coal: 5 }), slots, 8);
    expect(more[1]![1]).toBeCloseTo(0.75);
    // full: every heap full
    expect(pileFills(works("coalmine", {}, { coal: 8 }), slots, 8).flatMap((f) => f ?? [])).toEqual([1, 1, 1, 1, 1, 1]);
    // hauled away: only the scrapings in the first bay
    const empty = pileFills(works("coalmine", {}, {}), slots, 8).flatMap((f) => f ?? []);
    expect(empty[0]).toBeGreaterThan(0);
    expect(empty[0]).toBeLessThan(0.5);
    expect(empty.slice(1).every((u) => u === 0)).toBe(true);
  });

  it("different products fill their own yards; a yard the works doesn't use stays dressed", () => {
    const slots = ["site_heap_sand", "site_hall_l", "site_heap_coal", "glassworks"];
    const f = pileFills(works("glassworks", { sand: 8, coal: 0 }), slots, 8);
    expect(f[0]).toEqual([1, 1]);
    expect(f[2]![0]).toBeLessThan(0.5);
    const s = pileFills(works("sawmill", {}), ["site_heap_coal"], 8)[0]!;
    expect(s[0] + s[1]).toBeCloseTo(SCENERY_FILL * 2);
  });

  it("a log yard's stacks come in one by one", () => {
    const f = pileFills(works("sawmill", { logs: 4 }), ["site_logyard", "site_hall_l", "sawmill", "site_logyard"], 8);
    expect(f[0]).toEqual([1, 1, 1, 1, 1]);
    expect(f[3]).toEqual([0, 0, 0, 0, 0]);
  });
});
