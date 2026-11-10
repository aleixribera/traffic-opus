import { describe, expect, it } from "vitest";
import { EDGE_ZONE, edgePush, panRate } from "../src/ui/panning";

describe("the keys' pan speed", () => {
  it("starts slow, so a tap is a small step at any zoom", () => {
    expect(panRate(0)).toBeCloseTo(0.32, 5);
    // a quarter-second tap covers well under a tenth of the screen
    let s = 0;
    for (let t = 0; t < 0.25; t += 1 / 120) s += panRate(t) / 120;
    expect(s).toBeLessThan(0.1);
  });

  it("speeds up while held, to a screen a second, and no further", () => {
    expect(panRate(0.75)).toBeGreaterThan(panRate(0.25));
    expect(panRate(1.5)).toBeCloseTo(1, 5);
    expect(panRate(10)).toBeCloseTo(1, 5);
    expect(panRate(-1)).toBeCloseTo(0.32, 5);
  });
});

describe("edge scrolling", () => {
  const W = 1600, H = 900;

  it("does nothing away from the edges", () => {
    expect(edgePush(800, 450, W, H)).toEqual({ x: 0, y: 0 });
    expect(edgePush(EDGE_ZONE, EDGE_ZONE, W, H)).toEqual({ x: 0, y: 0 });
  });

  it("pushes fully on the outermost pixels, toward that edge", () => {
    expect(edgePush(0, 450, W, H)).toEqual({ x: -1, y: 0 });
    expect(edgePush(W - 1, 450, W, H)).toEqual({ x: 1, y: 0 });
    expect(edgePush(800, 0, W, H)).toEqual({ x: 0, y: -1 });
    expect(edgePush(800, H - 1, W, H)).toEqual({ x: 0, y: 1 });
  });

  it("eases in across the zone and pushes both ways in a corner", () => {
    const half = edgePush(EDGE_ZONE / 2, 450, W, H).x;
    expect(half).toBeCloseTo(-0.5, 5);
    expect(edgePush(0, H - 1, W, H)).toEqual({ x: -1, y: 1 });
  });

  it("never in a window too small to have a middle", () => {
    expect(edgePush(0, 0, EDGE_ZONE * 3, EDGE_ZONE * 3)).toEqual({ x: 0, y: 0 });
  });
});
