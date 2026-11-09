// The signals standing at a junction with lights (render/signals3d.ts): one at each arm, on the pavement to the
// right of the traffic it holds, a step back from the stop line and facing the cars coming, showing what the arm's
// straight-on traffic may do.

import { describe, it, expect } from "vitest";
import { armLight, signalPost } from "../src/render/signals3d";
import { right } from "../src/core/math";
import type { Arm } from "../src/roads/network";

const arm = (over: Partial<Arm> = {}): Arm => ({ seg: 1, end: "a", dir: { x: 1, y: 0 }, angle: 0, halfW: 5, trim: 8, ...over });

describe("a junction's signals", () => {
  it("stand off the road, on the right of the traffic arriving, behind the stop line, facing it", () => {
    const p = signalPost({ x: 100, y: 50 }, arm());
    // the cars arrive heading -x; their right-hand side is right(-dir)
    const rt = right({ x: -1, y: 0 });
    const out = (p.x - 100) * rt.x + (p.y - 50) * rt.y;
    expect(out).toBeGreaterThan(5.3); // past the road's edge, on the pavement
    expect(out).toBeLessThan(6);
    expect(p.x - 100).toBeGreaterThan(8.3); // back from the mouth (8 m out), not in the junction
    expect(p.x - 100).toBeLessThan(9.2);
    expect([p.dx, p.dy]).toEqual([1, 0]); // looking out along the arm
  });

  it("stand past the turn pockets of a widened arm", () => {
    const plain = signalPost({ x: 0, y: 0 }, arm()), wide = signalPost({ x: 0, y: 0 }, arm({ wL: 3.2 }));
    expect(Math.abs(wide.y) - Math.abs(plain.y)).toBeCloseTo(3.2, 6);
    expect(Math.sign(wide.y)).toBe(Math.sign(plain.y));
  });

  it("follow a curving road's mouth, and stand inside the edge of a deck", () => {
    const d = { x: Math.SQRT1_2, y: Math.SQRT1_2 };
    const p = signalPost({ x: 0, y: 0 }, arm({ mouth: { p: { x: 6, y: 7 }, dir: d } }));
    expect([p.dx, p.dy]).toEqual([d.x, d.y]);
    const along = (p.x - 6) * d.x + (p.y - 7) * d.y, across = (p.x - 6) * -d.y + (p.y - 7) * d.x;
    expect(along).toBeCloseTo(0.7, 6);
    expect(-across).toBeGreaterThan(5);
    const up = signalPost({ x: 0, y: 0 }, arm(), true);
    expect(Math.abs(up.y)).toBeLessThan(5);
    expect(Math.abs(up.y)).toBeGreaterThan(4.4);
  });

  it("show the straight-on light when the arm has one, else the best of its turns", () => {
    const st = (m: Record<string, string>) => (t: string) => m[t] ?? "red";
    expect(armLight(["L", "S", "R"], st({ L: "green", S: "red" }))).toBe("red");
    expect(armLight(["L", "S"], st({ S: "yellow", L: "green" }))).toBe("yellow");
    expect(armLight(["L", "R"], st({ L: "red", R: "green" }))).toBe("green");
    expect(armLight(["L", "R"], st({ L: "yellow", R: "red" }))).toBe("yellow");
    expect(armLight(["L"], st({}))).toBe("red");
    expect(armLight([], st({}))).toBe("red");
  });
});
