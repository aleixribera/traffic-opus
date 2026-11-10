// Labels that would sit on each other (owner, 2026-11-10: three town names in a heap at far zoom, and names over the
// works' plates), and the one line at the pointer (seven chips on a long road). Both are choices of what to leave
// out, so both are pure functions with their rules checked here.

import { describe, expect, it } from "vitest";
import { LABEL_GAP, LABEL_SHIFT, declutter, type Ask, type Rect } from "../src/ui/labels";
import { PLATE_HALF, underAny } from "../src/ui/mapIcons";
import { pointerLine, type PointerChip } from "../src/ui/pointer";
import { CARDS_PER_ROW, WIDE_CARDS, catalogLayout } from "../src/ui/catalog";

const box = (w: number, h: number): Rect => ({ l: -w / 2, t: -h / 2, r: w / 2, b: h / 2 });
/** A town's label: 130 x 70 in full (name, size tab, needs), 100 x 20 as its name alone. */
const town = (x: number, y: number, rank: number, was?: Ask["was"]): Ask => ({ x, y, rank, full: box(130, 70), name: box(100, 20), was });
const placed = (a: Ask, f: { mode: string; dy: number }): Rect => {
  const r = f.mode === "full" ? a.full : a.name;
  return { l: a.x + r.l, t: a.y + f.dy + r.t, r: a.x + r.r, b: a.y + f.dy + r.b };
};
const touch = (a: Rect, b: Rect) => a.l < b.r && a.r > b.l && a.t < b.b && a.b > b.t;

describe("town labels that would sit on each other", () => {
  it("labels with room all stand in full, where their towns are", () => {
    const asks = [town(200, 200, 300), town(600, 200, 1500), town(400, 500, 40)];
    expect(declutter(asks)).toEqual([{ mode: "full", dy: 0 }, { mode: "full", dy: 0 }, { mode: "full", dy: 0 }]);
  });

  it("the bigger town keeps its place in full; the smaller is cut to its name", () => {
    // 60 px apart: the full labels overlap, the smaller one's name clears the bigger's box
    const asks = [town(400, 300, 1382), town(400, 360, 1618)];
    const fits = declutter(asks);
    expect(fits[1]).toEqual({ mode: "full", dy: 0 });
    expect(fits[0].mode).toBe("name");
    expect(touch(placed(asks[0], fits[0]), placed(asks[1], fits[1]))).toBe(false);
  });

  it("a name that still touches is stacked just clear of the bigger label, the nearer way", () => {
    // 20 px above the big one's middle: its name would sit on the big label; over it is nearer than under
    const asks = [town(400, 280, 900), town(400, 300, 1618)];
    const fits = declutter(asks);
    expect(fits[0].mode).toBe("name");
    expect(fits[0].dy).toBeLessThan(0);
    expect(Math.abs(fits[0].dy)).toBeLessThanOrEqual(LABEL_SHIFT);
    const a = placed(asks[0], fits[0]), b = placed(asks[1], fits[1]);
    expect(touch(a, b)).toBe(false);
    // (just clear: no more than the gap and a pixel between them)
    expect(b.t - a.b).toBeLessThanOrEqual(LABEL_GAP + 1);
    expect(b.t - a.b).toBeGreaterThanOrEqual(LABEL_GAP - 0.01);
  });

  it("three in a heap: the biggest in full, the others as names, none touching (the late save at 30 km)", () => {
    const asks = [town(790, 465, 1618), town(825, 400, 1532), town(760, 418, 1382)];
    const fits = declutter(asks);
    expect(fits[0].mode).toBe("full");
    expect(fits.filter((f) => f.mode === "full")).toHaveLength(1);
    const shown = asks.map((a, i) => ({ a, f: fits[i] })).filter((x) => x.f.mode !== "hidden");
    expect(shown.length).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < shown.length; i++) for (let j = i + 1; j < shown.length; j++) {
      expect(touch(placed(shown[i].a, shown[i].f), placed(shown[j].a, shown[j].f))).toBe(false);
    }
  });

  it("a name with nowhere to go within reach of its town is left out, not flung across the map", () => {
    // five towns on one spot: there is not room within LABEL_SHIFT for all their names
    const asks = [1, 2, 3, 4, 5, 6, 7].map((k) => town(400, 300, k * 100));
    const fits = declutter(asks);
    expect(fits[6].mode).toBe("full");
    expect(fits.some((f) => f.mode === "hidden")).toBe(true);
    for (const f of fits) expect(Math.abs(f.dy)).toBeLessThanOrEqual(LABEL_SHIFT);
  });

  it("order given does not matter, only size; equals keep the order they came in", () => {
    const a = town(400, 300, 500), b = town(400, 330, 2000);
    expect(declutter([a, b])[1].mode).toBe("full");
    expect(declutter([b, a])[0].mode).toBe("full");
    const same = declutter([town(400, 300, 500), town(400, 330, 500)]);
    expect(same[0].mode).toBe("full");
    expect(same[1].mode).not.toBe("full");
  });

  it("a label cut down comes back in full only with room to spare, so it does not flicker at the edge", () => {
    // the two full boxes clear each other by 4 px: enough for one that was in full, not for one coming back
    const big = town(400, 300, 2000);
    const gap = 70 + LABEL_GAP + 1;
    expect(declutter([town(400, 300 + gap, 500, "full"), big])[0].mode).toBe("full");
    expect(declutter([town(400, 300 + gap, 500), big])[0].mode).toBe("full");
    expect(declutter([town(400, 300 + gap, 500, "name"), big])[0].mode).toBe("name");
    expect(declutter([town(400, 300 + gap + 20, 500, "name"), big])[0].mode).toBe("full");
  });

  it("a works' plate keeps out from under a town's name", () => {
    const names: Rect[] = [{ l: 300, t: 200, r: 430, b: 270 }];
    expect(underAny(names, 365, 235)).toBe(true);
    // (its rim counts: a plate half under a name reads as neither)
    expect(underAny(names, 430 + PLATE_HALF - 1, 235)).toBe(true);
    expect(underAny(names, 430 + PLATE_HALF + 1, 235)).toBe(false);
    expect(underAny(names, 365, 200 - PLATE_HALF - 1)).toBe(false);
    expect(underAny([], 365, 235)).toBe(false);
  });
});

describe("one line at the pointer", () => {
  const info = (text: string, lead?: number): PointerChip => ({ text, kind: "info", lead });
  const cost: PointerChip = { text: "$12,400", kind: "cost" };

  it("nothing said: no line", () => {
    expect(pointerLine([])).toEqual({ head: null, cost: null, rest: [] });
  });

  it("a long road: what it joins and the price at the pointer, the other five notes for the tool options", () => {
    const length = info("1.24 km"), climb = info("Steepest climb 4.2%"), bridge = info("Bridge 60 m over water · $8,000", 1);
    const joins = info("Joins the street at 90°", 2), angle = info("34.5°"), note = info("Curve eased to fit");
    const line = pointerLine([length, cost, climb, bridge, joins, angle, note]);
    expect(line.head).toBe(joins);
    expect(line.cost).toBe(cost);
    expect(line.rest).toEqual([length, climb, bridge, angle, note]);
  });

  it("with nothing that matters more, a road's length leads (the first thing said)", () => {
    const length = info("240 m"), climb = info("Steepest climb 1.1%");
    expect(pointerLine([length, cost, climb])).toEqual({ head: length, cost, rest: [climb] });
  });

  it("the works a road connects beats the road it joins", () => {
    const connects = info("Connects your Farm", 3), joins = info("Joins the street", 2);
    expect(pointerLine([info("80 m"), cost, joins, connects]).head).toBe(connects);
  });

  it("whatever stops the click stands alone: its price is no news", () => {
    const err: PointerChip = { text: "Too steep here", kind: "error" };
    const line = pointerLine([err, info("240 m"), cost, info("Joins the street", 2)]);
    expect(line.head).toBe(err);
    expect(line.cost).toBeNull();
    expect(line.rest).toContain(cost);
    // not enough money is such a stop, and it is the price
    const broke: PointerChip = { text: "$48,000 · not enough money", kind: "error" };
    expect(pointerLine([info("2.1 km"), broke])).toEqual({ head: broke, cost: null, rest: [info("2.1 km")] });
  });

  it("a warning that does not stop the click leads, with the price beside it", () => {
    const warn: PointerChip = { text: "Demolishes 2 buildings, $4,000 compensation", kind: "error", warn: true };
    const line = pointerLine([info("240 m"), cost, info("Joins the street", 2), warn]);
    expect(line.head).toBe(warn);
    expect(line.cost).toBe(cost);
    // a real stop still beats it
    const stop: PointerChip = { text: "Crosses a building", kind: "error" };
    expect(pointerLine([warn, stop, cost]).head).toBe(stop);
  });

  it("a dear price is still the price, and a price alone is the line", () => {
    const dear: PointerChip = { text: "$48,000 · 34% of your cash", kind: "dear" };
    expect(pointerLine([info("2.1 km"), dear])).toEqual({ head: info("2.1 km"), cost: dear, rest: [] });
    expect(pointerLine([dear])).toEqual({ head: dear, cost: null, rest: [] });
  });
});

describe("the catalog fits its cards to the window", () => {
  it("a few cards are one row of wide plates", () => {
    for (const n of [1, 2, 3, WIDE_CARDS]) expect(catalogLayout(n)).toEqual({ cols: n, rows: 1, wide: true });
  });

  it("up to a row's worth share one row in equal columns", () => {
    for (let n = WIDE_CARDS + 1; n <= CARDS_PER_ROW; n++) expect(catalogLayout(n)).toEqual({ cols: n, rows: 1, wide: false });
  });

  it("a longer tab is split into even rows: nine are five and four, never eight and one alone", () => {
    expect(catalogLayout(9)).toEqual({ cols: 5, rows: 2, wide: false });
    expect(catalogLayout(12)).toEqual({ cols: 6, rows: 2, wide: false });
    expect(catalogLayout(16)).toEqual({ cols: 8, rows: 2, wide: false });
    expect(catalogLayout(17)).toEqual({ cols: 6, rows: 3, wide: false });
    // every card has a cell, and no row but the last has an empty one
    for (let n = 1; n <= 40; n++) {
      const l = catalogLayout(n);
      expect(l.cols * l.rows).toBeGreaterThanOrEqual(n);
      expect(l.cols * (l.rows - 1)).toBeLessThan(n);
      expect(l.cols).toBeLessThanOrEqual(CARDS_PER_ROW);
    }
  });

  it("no cards, no rows", () => {
    expect(catalogLayout(0).rows).toBe(0);
  });
});
