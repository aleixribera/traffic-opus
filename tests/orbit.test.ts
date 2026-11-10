import { describe, expect, it } from "vitest";
import { newOrbit, orbitStep } from "../src/ui/orbit";

/** Drag along a list of mouse steps: the pixels that turned the camera and the pixels that tilted it. */
function drag(steps: [number, number][], map = false) {
  const o = newOrbit();
  let turn = 0, tilt = 0;
  for (const [dx, dy] of steps) {
    const s = orbitStep(o, dx, dy, map);
    turn += s.turn;
    tilt += s.tilt;
  }
  return { turn, tilt, o };
}
const line = (dx: number, dy: number, n: number): [number, number][] => Array.from({ length: n }, () => [dx, dy]);

describe("the drag that turns and tilts the camera", () => {
  it("a sideways drag turns the map and leaves the pitch alone, however far it goes", () => {
    const r = drag(line(4, 0, 100));
    expect(r.tilt).toBe(0);
    expect(r.turn).toBeGreaterThan(390);
    expect(r.turn).toBeLessThanOrEqual(400);
  });

  it("a sideways drag that wanders up and down still does not move the pitch", () => {
    // 400 px across, drifting 40 px up on the way, with a wobble on top
    const steps: [number, number][] = [];
    for (let i = 0; i < 100; i++) steps.push([4, -0.4 + (i % 2 ? 1 : -1)]);
    const r = drag(steps);
    expect(r.tilt).toBe(0);
    expect(r.turn).toBeGreaterThan(390);
    // and with the mouse reporting the two directions in separate steps, as a real one does
    const split: [number, number][] = [];
    for (let i = 0; i < 100; i++) { split.push([4, 0]); if (i % 3 === 0) split.push([0, -1]); }
    expect(drag(split).tilt).toBe(0);
  });

  it("a drag up or down tilts and does not turn the map", () => {
    const up = drag(line(0, -3, 60));
    expect(up.turn).toBe(0);
    expect(up.tilt).toBeLessThan(-160);
    // wandering sideways on the way
    const steps: [number, number][] = [];
    for (let i = 0; i < 60; i++) steps.push([i % 2 ? 1 : -0.4, 3]);
    const down = drag(steps);
    expect(down.turn).toBe(0);
    expect(down.tilt).toBeGreaterThan(160);
  });

  it("a diagonal drag does both", () => {
    const r = drag(line(3, -3, 60));
    expect(r.turn).toBeGreaterThan(150);
    expect(r.tilt).toBeLessThan(-140);
  });

  it("nothing jumps when a direction starts, and it follows the hand one to one from there, both ways", () => {
    const o = newOrbit();
    let most = 0, tilt = 0;
    for (let i = 0; i < 40; i++) { const s = orbitStep(o, 0, -2); most = Math.max(most, Math.abs(s.tilt)); tilt += s.tilt; }
    expect(most).toBeLessThanOrEqual(2);
    // turning back: no dead zone, the very next step tilts the other way
    const back = orbitStep(o, 0, 2);
    expect(back.tilt).toBe(2);
    expect(tilt).toBeLessThan(-60);
  });

  it("after turning for a while, a drag up tilts within a few pixels", () => {
    const o = newOrbit();
    for (let i = 0; i < 150; i++) expect(orbitStep(o, 4, 0).tilt).toBe(0);
    let px = 0, tilt = 0;
    while (!tilt && px < 100) { tilt = orbitStep(o, 0, -2).tilt; px += 2; }
    expect(px).toBeLessThanOrEqual(16);
  });

  it("after tilting, a long sideways sweep lets go of the pitch again", () => {
    const o = newOrbit();
    for (let i = 0; i < 30; i++) orbitStep(o, 0, -3);
    let tilt = 0;
    for (let i = 0; i < 100; i++) tilt += orbitStep(o, 4, i % 2 ? 0.5 : -0.4).tilt;
    // (a little of the wander gets through before it lets go: a few pixels, a degree or so)
    expect(Math.abs(tilt)).toBeLessThan(8);
  });

  it("the Map view only tips on a drag that plainly goes up the screen", () => {
    // sideways, and diagonal: the map turns, and stays a map
    expect(drag(line(4, -1, 100), true).tilt).toBe(0);
    expect(drag(line(3, -2.5, 80), true).tilt).toBe(0);
    // down: it is as high as it goes
    expect(drag(line(0, 3, 60), true).tilt).toBe(0);
    // up: it tips, after more travel than the Diorama asks for
    const o = newOrbit();
    let px = 0, tilt = 0;
    while (!tilt && px < 200) { tilt = orbitStep(o, 0, -2, true).tilt; px += 2; }
    expect(tilt).toBeLessThan(0);
    expect(px).toBeGreaterThan(20);
    expect(px).toBeLessThan(40);
  });
});
