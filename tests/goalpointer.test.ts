// The first goal points at its ground, and a works' gate is marked (owner, 2026-11-10: the soil the first farm needs
// is about 1 km off screen at the opening view and only a small pointer said so; a works' gate was not drawn as a
// clear mark). Where the pointer stands, which way it points at any turn and tilt, where the farm can go and where
// the gate's plate hangs are all pure, so their rules are checked here.

import { describe, expect, it } from "vitest";
import { Game } from "../src/game/city";
import { siteFrame } from "../src/game/sites";
import { MILESTONES } from "../src/game/progression";
import { worldToScreen, type ViewPose } from "../src/render/viewmath";
import { F } from "../src/world/gen";
import { edgeSpot, farmSpot, groundSpot, inFrame, screenWay, type Frame } from "../src/ui/goalPointer";
import { GATE_MARK_MIN, GATE_PLATE_OUT, gateSpot } from "../src/ui/gateMark";
import { goalNow, goalNowSay } from "../src/ui/goalNow";

const view = (o: Partial<ViewPose> = {}) => {
  const v: ViewPose = { cx: 1000, cy: 2000, halfH: 320, rot: 0, tilt: 0, w: 1600, h: 900, ...o };
  return { ...v, worldToScreen: (x: number, y: number) => worldToScreen(v, x, y) };
};
const frame: Frame = { l: 24, t: 84, r: 1576, b: 772 };

describe("the pointer at the screen's edge", () => {
  it("stands as far along its way as its whole box fits in the frame, all the way round", () => {
    const hw = 120, hh = 34, cx = (frame.l + frame.r) / 2, cy = (frame.t + frame.b) / 2;
    for (let k = 0; k < 72; k++) {
      const a = (k / 72) * Math.PI * 2, dx = Math.cos(a) * 9000, dy = Math.sin(a) * 9000;
      const p = edgeSpot(dx, dy, frame, hw, hh);
      // inside, box and all
      expect(p.x - hw).toBeGreaterThanOrEqual(frame.l - 1e-6);
      expect(p.x + hw).toBeLessThanOrEqual(frame.r + 1e-6);
      expect(p.y - hh).toBeGreaterThanOrEqual(frame.t - 1e-6);
      expect(p.y + hh).toBeLessThanOrEqual(frame.b + 1e-6);
      // on its way from the middle, and hard against one side
      expect(Math.atan2(p.y - cy, p.x - cx)).toBeCloseTo(Math.atan2(dy, dx), 6);
      const slack = Math.min(p.x - hw - frame.l, frame.r - p.x - hw, p.y - hh - frame.t, frame.b - p.y - hh);
      expect(slack).toBeLessThan(1e-6);
    }
  });

  it("the length of the way does not matter, and no way at all stays in the middle", () => {
    expect(edgeSpot(3, -4, frame, 100, 30)).toEqual(edgeSpot(3000, -4000, frame, 100, 30));
    expect(edgeSpot(0, 0, frame, 100, 30)).toEqual({ x: 800, y: 428 });
  });

  it("points up the screen at soil to the north with the camera straight, and follows every turn of the camera", () => {
    // 1 km north of the middle of the view (north is -y)
    const soil = { x: 1000, y: 1000 };
    const up = screenWay(view(), soil);
    expect(up.dx).toBeCloseTo(0, 6);
    expect(up.dy).toBeLessThan(0);
    expect(up.dist).toBeCloseTo(1000, 6);
    for (const rot of [0.4, 1.3, Math.PI / 2, 2.6, Math.PI, -1.1, -2.9]) for (const tilt of [0, 0.35, 0.7, 1.0]) {
      const v = view({ rot, tilt });
      const w = screenWay(v, soil);
      // the pointer's way is the way the soil really lies on this screen: a step toward it along that way gets nearer
      const s = v.worldToScreen(soil.x, soil.y), mid = v.worldToScreen(v.cx, v.cy);
      const L = Math.hypot(w.dx, w.dy);
      const near = Math.hypot(s.x - (mid.x + (w.dx / L) * 50), s.y - (mid.y + (w.dy / L) * 50));
      expect(near).toBeLessThan(Math.hypot(s.x - mid.x, s.y - mid.y));
      expect(Math.atan2(w.dy, w.dx)).toBeCloseTo(Math.atan2(s.y - mid.y, s.x - mid.x), 6);
      // and the distance is the ground's, however the screen squashes it
      expect(w.dist).toBeCloseTo(1000, 6);
    }
    // a quarter turn of the camera is a quarter turn of the pointer
    const a0 = Math.atan2(up.dy, up.dx), q = screenWay(view({ rot: Math.PI / 2 }), soil), a1 = Math.atan2(q.dy, q.dx);
    expect(Math.abs(Math.abs(a1 - a0) - Math.PI / 2)).toBeLessThan(1e-6);
  });

  it("knows when the soil is on screen (a pin then, no pointer), at any zoom", () => {
    const soil = { x: 1000, y: 1000 };
    expect(inFrame(view(), soil, frame)).toBe(false);
    expect(inFrame(view({ halfH: 1500 }), soil, frame)).toBe(true);
    expect(inFrame(view({ cx: 1000, cy: 1100 }), soil, frame)).toBe(true);
    // off to the side with the camera turned: still off
    expect(inFrame(view({ rot: Math.PI / 2 }), soil, frame)).toBe(false);
  });
});

describe("where the first farm can go", () => {
  it("is a place a farm really fits, on soil, with a road in reach of its gate; nearest the town", () => {
    const g = new Game(7);
    g.start();
    const home = g.towns.list[0];
    const at = farmSpot(g)!;
    expect(at).toBeTruthy();
    expect(g.terrain.has(F.fert, at)).toBe(true);
    const pl = g.placedPlan("farm", at)!;
    expect(pl.ok).toBe(true);
    expect(!!(pl.access || pl.link)).toBe(true);
    // within the first walk out of town, and the same answer asked twice
    expect(Math.hypot(at.x - home.c.x, at.y - home.c.y)).toBeLessThan(4000);
    expect(farmSpot(g)).toBe(at);
    // the goal line says where, in the town's own terms, and gives the place to fly to
    const food = MILESTONES.find((m) => m.id === "food10")!;
    const now = goalNow(g, food, 0)!;
    expect(now.key).toBe("Where");
    expect(now.spot).toEqual(at);
    expect(goalNowSay(now)).toMatch(new RegExp(`^Place a Farm on the fertile soil [\\d.]+ (m|km) [a-z-]+ of ${home.name}\\.$`));
    // a farm placed there: nothing more to point at, and the goal line is the farm's own
    expect(g.place("farm", at)).toBeTruthy();
    expect(farmSpot(g)).toBeNull();
    const after = goalNow(g, food, 0)!;
    expect(after.spot).toBeUndefined();
    expect(after.text).toMatch(/^Your Farm /);
  }, 120000);
});

describe("where the first logging camp can go", () => {
  it("is the nearest forest a camp fits, a road in reach where one is near, once the first food is sold: the timber goal says where", () => {
    const g = new Game(7);
    g.start();
    const home = g.towns.list[0];
    const at = groundSpot(g, "loggingcamp")!;
    expect(at).toBeTruthy();
    expect(g.terrain.has(F.forest, at)).toBe(true);
    // (a place it fits: with a road in reach of its gate where one is near, else the nearest it fits at all)
    expect(g.placedPlan("loggingcamp", at)!.ok).toBe(true);
    // nearer the town than the big patch of forest the map was generated with (the old pointer's only answer)
    const patch = g.terrain.gen.depositsNear(F.forest, home.c.x, home.c.y, 24000)[0];
    const d = (p: { x: number; y: number }) => Math.hypot(p.x - home.c.x, p.y - home.c.y);
    if (patch) expect(d(at)).toBeLessThanOrEqual(d(patch) + 1);
    expect(groundSpot(g, "loggingcamp")).toBe(at);
    // the timber goal: nothing said before the first food is sold (one chain at a time), then where its forest is
    const planks = MILESTONES.find((m) => m.id === "planks10")!;
    expect(goalNow(g, planks, 0)).toBeNull();
    g.progress.sold.food = 1;
    const now = goalNow(g, planks, 0)!;
    expect(now.key).toBe("Where");
    expect(now.spot).toEqual(at);
    expect(goalNowSay(now)).toMatch(new RegExp(`^Place a Logging Camp in the forest [\\d.]+ (m|km) [a-z-]+ of ${home.name}\\.$`));
    // a camp placed: the goal line is the camp's own
    expect(g.place("loggingcamp", at)).toBeTruthy();
    expect(goalNow(g, planks, 0)?.key).not.toBe("Where");
  }, 120000);
});

describe("a works' gate, marked", () => {
  // a works 120 m wide and 80 m deep at (500, 500), its gate on the south fence
  const f = siteFrame({ x: 500, y: 500 }, 0, 1, 40);
  const at = (v: ReturnType<typeof view>) => gateSpot((x, y) => v.worldToScreen(x, y), f, 60);

  it("the ring is on the gate and the plate stands out from the fence, away from the works", () => {
    for (const rot of [0, 0.7, 2.2, -1.4]) for (const tilt of [0, 0.5, 0.9]) {
      const v = view({ cx: 500, cy: 500, halfH: 200, rot, tilt });
      const g = at(v);
      const gate = v.worldToScreen(f.gate.x, f.gate.y), mid = v.worldToScreen(500, 500);
      expect(g.x).toBeCloseTo(gate.x, 6);
      expect(g.y).toBeCloseTo(gate.y, 6);
      expect(g.show).toBe(true);
      expect(g.out).toBeGreaterThanOrEqual(GATE_PLATE_OUT);
      // the plate is further from the middle of the works than the gate is
      const px = g.x + Math.cos(g.angle) * g.out, py = g.y + Math.sin(g.angle) * g.out;
      expect(Math.hypot(px - mid.x, py - mid.y)).toBeGreaterThan(Math.hypot(gate.x - mid.x, gate.y - mid.y));
    }
  });

  it("the ghost's plate clears the arrow out of its gate", () => {
    const v = view({ cx: 500, cy: 500, halfH: 150 });
    // 26 m of arrow at 3 px a metre
    expect(gateSpot((x, y) => v.worldToScreen(x, y), f, 60, 26).out).toBeGreaterThan(26 * 3);
    expect(at(v).out).toBe(GATE_PLATE_OUT);
  });

  it("is left out once the works is a speck on screen", () => {
    // 120 m wide: 70 px at about 0.58 px a metre
    expect(at(view({ cx: 500, cy: 500, halfH: 600 })).show).toBe(true);
    const tiny = at(view({ cx: 500, cy: 500, halfH: 3000 }));
    expect(tiny.show).toBe(false);
    expect(120 * (900 / 6000)).toBeLessThan(GATE_MARK_MIN);
  });
});
