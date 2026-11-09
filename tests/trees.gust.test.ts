// The gusts over the trees (render/trees3d.ts): waves along the wind, the same slow waves wherever on the map the
// view is and however fast the game runs. The wind turns through the day; the waves must not swing round the map's
// origin as it does (kilometres out they would race, and at 4x flutter), so their phase is carried with the view.

import { describe, it, expect } from "vitest";
import { GUST_ACROSS, GUST_K, GUST_RATE, gustCarry } from "../src/render/trees3d";
import { windAt, type Wind } from "../src/render/wind";
import { DAY } from "../src/game/society";

/** the two phases the shader works out for a tree at (x, y): along the wind and across it */
const phases = (x: number, y: number, w: Wind, fx: { z: number; w: number }) =>
  [GUST_K * (x * w.x + y * w.y) + fx.z, GUST_ACROSS * (-x * w.y + y * w.x) + fx.w];
const turn = (a: number, b: number) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));

/** Play 20 game days at `speed`, 60 frames a second, the view held over (cx, cy); the fastest either phase of a tree
 *  at (cx + dx, cy + dy) moved from the wind's turning alone (rad a real second). */
function fastest(cx: number, cy: number, dx: number, dy: number, speed: number, carried: boolean) {
  const fx = { z: 0, w: 0 }, dt = 1 / 60;
  let w0 = windAt(0), worst = 0;
  for (let s = speed * dt; s < DAY * 20; s += speed * dt) {
    const w1 = windAt(s);
    const before = phases(cx + dx, cy + dy, w0, fx);
    if (carried) gustCarry(fx, cx, cy, w0.x, w0.y, w1.x, w1.y);
    const after = phases(cx + dx, cy + dy, w1, fx);
    worst = Math.max(worst, turn(after[0], before[0]) / dt, turn(after[1], before[1]) / dt);
    w0 = w1;
  }
  return { worst, fx };
}

describe("the gusts over the trees", () => {
  it("written against the map's origin they would race far from it: faster than the gusts themselves travel", () => {
    // (what the carried phase is for: 6 km out at 4x the fronts would swing past many times faster than they run)
    expect(fastest(4500, 4000, 0, 0, 4, false).worst).toBeGreaterThan(GUST_RATE * 5);
    expect(fastest(0, 0, 0, 0, 4, false).worst).toBe(0);
  });

  it("carried with the view they stand still at its middle as the wind turns, wherever on the map it is", () => {
    for (const [cx, cy] of [[0, 0], [3078, 1474], [4500, 4000], [-7000, 6500]]) {
      for (const speed of [1, 4]) expect(fastest(cx, cy, 0, 0, speed, true).worst).toBeLessThan(1e-6);
    }
  });

  it("and at the edge of a near view they turn no faster than they would beside the origin", () => {
    // (300 m from the middle of the view: as far as a tree is seen swaying)
    const far = fastest(4500, 4000, 210, -210, 1, true).worst, home = fastest(0, 0, 210, -210, 1, false).worst;
    expect(far).toBeCloseTo(home, 6);
    expect(far).toBeLessThan(GUST_RATE * 0.6);
  });

  it("a steady wind carries nothing, however the view moves; the phases stay small numbers", () => {
    const fx = { z: 0.3, w: -1.1 };
    gustCarry(fx, 5000, -3000, 0.6, 0.8, 0.6, 0.8);
    gustCarry(fx, -200, 9000, 0.6, 0.8, 0.6, 0.8);
    expect(fx).toEqual({ z: 0.3, w: -1.1 });
    const run = fastest(-7000, 6500, 0, 0, 4, true).fx;
    expect(Math.abs(run.z)).toBeLessThanOrEqual(Math.PI + 1e-9);
    expect(Math.abs(run.w)).toBeLessThanOrEqual(Math.PI + 1e-9);
  });
});
