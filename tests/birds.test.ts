// The birds (render/birds.ts): where the flocks are follows the map's own fields (woods and farmland, never open
// water), the same for the same map; a bird's path is a closed loop of the clock, so the clock can wrap; and the
// instances are only written when the view moves on to other cells.

import * as THREE from "three";
import { describe, expect, it } from "vitest";
import { F, NF } from "../src/world/gen";
import { ENV } from "../src/render/envShader";
import {
  BIRD_LOOP, BIRD_MPP, Birds, FLOCK_CELL, MAX_BIRDS, birdOf, flockAt, flying, habitat, wanderTurns, wheel,
  type Bird, type Flock,
} from "../src/render/birds";

/** a map that is all one thing */
const all = (set: Partial<Record<keyof typeof F, number>>) => {
  const o = new Float32Array(NF);
  for (const [k, v] of Object.entries(set)) o[F[k as keyof typeof F]] = v as number;
  return () => o;
};
const WOODS = all({ forest: 0.9 }), FARMS = all({ fert: 0.9 }), OPEN = all({}), LAKE = all({ lake: 0.9, forest: 0.9 });
const PEAKS = all({ mtn: 0.9, forest: 0.9 });

const flocks = (fields: () => Float32Array, n = 60) => {
  const f: Flock = { x: 0, y: 0, n: 0, seed: 0 };
  let c = 0;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) if (flockAt(i - 30, j - 30, fields, f)) c++;
  return c / (n * n);
};

describe("where the flocks are", () => {
  it("the birds like woods best, then farmland, open ground a little, the peaks hardly, water not at all", () => {
    expect(habitat(WOODS())).toBe(1);
    expect(habitat(FARMS())).toBeGreaterThan(habitat(OPEN()));
    expect(habitat(FARMS())).toBeLessThan(1);
    expect(habitat(OPEN())).toBeGreaterThan(0);
    expect(habitat(PEAKS())).toBeLessThan(habitat(OPEN()));
    expect(habitat(LAKE())).toBe(0);
  });

  it("so there are more flocks over the woods than over open country, and none over a lake", () => {
    const woods = flocks(WOODS), farms = flocks(FARMS), open = flocks(OPEN);
    expect(woods).toBeGreaterThan(0.4);
    expect(woods).toBeLessThan(0.6);
    expect(farms).toBeGreaterThan(open * 2);
    expect(woods).toBeGreaterThan(farms);
    expect(open).toBeGreaterThan(0.05);
    expect(flocks(LAKE)).toBe(0);
  });

  it("a cell's flock is the same every time, inside its cell, two to four birds", () => {
    const a: Flock = { x: 0, y: 0, n: 0, seed: 0 }, b: Flock = { x: 0, y: 0, n: 0, seed: 0 };
    let seen = 0;
    for (let j = -20; j < 20; j++) {
      for (let i = -20; i < 20; i++) {
        const has = flockAt(i, j, WOODS, a);
        expect(flockAt(i, j, WOODS, b)).toBe(has);
        if (!has) continue;
        seen++;
        expect(b).toEqual(a);
        expect(a.x).toBeGreaterThanOrEqual(i * FLOCK_CELL);
        expect(a.x).toBeLessThan((i + 1) * FLOCK_CELL);
        expect(a.y).toBeGreaterThanOrEqual(j * FLOCK_CELL);
        expect(a.y).toBeLessThan((j + 1) * FLOCK_CELL);
        expect(a.n).toBeGreaterThanOrEqual(2);
        expect(a.n).toBeLessThanOrEqual(4);
      }
    }
    expect(seen).toBeGreaterThan(400);
  });
});

describe("a bird's flight", () => {
  const birds = (): Bird[] => {
    const out: Bird[] = [], f: Flock = { x: 0, y: 0, n: 0, seed: 0 };
    for (let i = 0; i < 40; i++) {
      if (!flockAt(i, 3, WOODS, f)) continue;
      for (let k = 0; k < f.n; k++) out.push(birdOf(f, k, { x: 0, y: 0, r: 0, h: 0, phase: 0, turns: 1, span: 1, seed: 0 }));
    }
    return out;
  };

  it("wheels near its flock, well above the trees, at a bird's pace", () => {
    const bs = birds();
    expect(bs.length).toBeGreaterThan(30);
    const p = { x: 0, y: 0, h: 0 }, q = { x: 0, y: 0, h: 0 };
    for (const b of bs) {
      expect(Number.isInteger(b.turns)).toBe(true);
      expect(Math.abs(b.turns)).toBeGreaterThan(60);
      expect(wanderTurns(b.turns)).toBeGreaterThan(0);
      for (let t = 0; t < 300; t += 3.7) {
        wheel(b, t, p);
        wheel(b, t + 0.1, q);
        expect(Math.hypot(p.x - b.x, p.y - b.y)).toBeLessThan(b.r * 1.46);
        expect(p.h).toBeGreaterThan(25);
        expect(p.h).toBeLessThan(90);
        const v = Math.hypot(q.x - p.x, q.y - p.y) / 0.1;
        expect(v).toBeGreaterThan(1.5);
        expect(v).toBeLessThan(16);
      }
    }
  });

  it("is where it began when the clock wraps", () => {
    const p = { x: 0, y: 0, h: 0 }, q = { x: 0, y: 0, h: 0 };
    for (const b of birds()) {
      wheel(b, 0, p);
      wheel(b, BIRD_LOOP, q);
      expect(q.x).toBeCloseTo(p.x, 6);
      expect(q.y).toBeCloseTo(p.y, 6);
      expect(q.h).toBeCloseTo(p.h, 6);
    }
  });

  it("fewer fly in the cold", () => {
    expect(flying(0)).toBe(1);
    expect(flying(1)).toBeCloseTo(0.4, 6);
    expect(flying(0.5)).toBeLessThan(1);
  });
});

describe("the birds in view", () => {
  /** a camera looking straight down on (x, y), `half` m from the middle to the top of the screen */
  const cameraOver = (x: number, y: number, half: number) => {
    const c = new THREE.OrthographicCamera(-half * 1.6, half * 1.6, half, -half, -3000, 6000);
    c.position.set(x, 900, y);
    c.up.set(0, 0, -1);
    c.lookAt(x, 0, y);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    return c;
  };
  const mpp = (c: THREE.OrthographicCamera) => (c.top * 2) / 900;
  const version = (b: Birds) => ((b.mesh.geometry as THREE.InstancedBufferGeometry).getAttribute("aA") as THREE.InterleavedBufferAttribute).data.version;

  it("are written for the cells under the view, each with its shadow, and never more than the pool", () => {
    const b = new Birds();
    b.setWorld(WOODS);
    const cam = cameraOver(0, 0, 250);
    b.update(cam, mpp(cam), 1 / 60);
    expect(b.mesh.visible).toBe(true);
    expect(b.count).toBeGreaterThan(4);
    expect(b.count).toBeLessThanOrEqual(MAX_BIRDS);
    expect((b.mesh.geometry as THREE.InstancedBufferGeometry).instanceCount).toBe(b.count * 2);
    // (from as far off as they are drawn at all, over nothing but woods: still within the pool)
    const far = cameraOver(0, 0, BIRD_MPP * 0.7 * 450);
    b.update(far, mpp(far), 1 / 60);
    expect(b.count).toBeGreaterThan(10);
    expect(b.count).toBeLessThanOrEqual(MAX_BIRDS);
    b.dispose();
  });

  it("are not written again while the view stays over the same cells", () => {
    const b = new Birds();
    b.setWorld(WOODS);
    const cam = cameraOver(100, 100, 100);
    b.update(cam, mpp(cam), 1 / 60);
    const v = version(b), n = b.count;
    const near = cameraOver(104, 97, 100);
    for (let i = 0; i < 30; i++) b.update(near, mpp(near), 1 / 60);
    expect(version(b)).toBe(v);
    expect(b.count).toBe(n);
    const away = cameraOver(100 + FLOCK_CELL * 6, 100, 100);
    b.update(away, mpp(away), 1 / 60);
    expect(version(b)).toBeGreaterThan(v);
    b.dispose();
  });

  it("none over a lake, none at night, none from too far off", () => {
    const b = new Birds();
    b.setWorld(LAKE);
    const cam = cameraOver(0, 0, 250);
    b.update(cam, mpp(cam), 1 / 60);
    expect(b.count).toBe(0);
    b.setWorld(WOODS);
    b.update(cam, mpp(cam), 1 / 60);
    expect(b.mesh.visible).toBe(true);
    const lamps = ENV.uNight.value.x;
    ENV.uNight.value.x = 1;
    b.update(cam, mpp(cam), 1 / 60);
    expect(b.mesh.visible).toBe(false);
    ENV.uNight.value.x = lamps;
    const far = cameraOver(0, 0, BIRD_MPP * 1.2 * 450);
    b.update(far, mpp(far), 1 / 60);
    expect(b.mesh.visible).toBe(false);
    b.dispose();
  });
});
