// The townspeople (src/render/townlife.ts): out by day and home by night, busier near the hall, walking only along
// their pavement, and drawn only close in and only where the camera looks.

import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { LIFE_MODELS, PEOPLE, PEOPLE_FULL, PEOPLE_SEE, TownLife, outdoors, type LifeFront } from "../src/render/townlife";
import type { MergedModel } from "../src/render/models";

const models = new Map<string, MergedModel>(LIFE_MODELS.map((m) => [m, { geo: new THREE.BoxGeometry(0.4, 1.7, 0.3), bays: [], fx: [] }]));

/** A row of shop fronts along the x axis, their pavement 2 m wide (lot z 8..10, the lot's +z turned to world -z). */
function row(n: number, centre: number): LifeFront[] {
  return Array.from({ length: n }, (_, i) => {
    const base = new THREE.Matrix4().makeRotationY(Math.PI).setPosition(i * 12, 0, 0);
    return { base, hw: 6, z0: 8, z1: 10, kind: "shop" as const, centre, seed: i + 1 };
  });
}

/** A camera looking straight down on the ground round (x, z), `half` m either way. */
function camera(x: number, z: number, half: number): THREE.OrthographicCamera {
  const c = new THREE.OrthographicCamera(-half, half, half, -half, 1, 500);
  c.position.set(x, 200, z);
  c.up.set(0, 0, -1);
  c.lookAt(x, 0, z);
  c.updateMatrixWorld();
  return c;
}

describe("the townspeople", () => {
  it("are out by day, few at night, fewer in winter", () => {
    expect(outdoors(13, 1)).toBeGreaterThan(0.9);
    expect(outdoors(3, 1)).toBeLessThan(0.1);
    expect(outdoors(8, 1)).toBeLessThan(outdoors(12, 1));
    expect(outdoors(13, 3)).toBeLessThan(outdoors(13, 1));
    for (let h = 0; h < 24; h += 0.25) {
      expect(outdoors(h, 1)).toBeGreaterThanOrEqual(0);
      expect(outdoors(h, 1)).toBeLessThanOrEqual(1);
    }
  });

  it("are more of them on the pavements near the hall than out at the edge", () => {
    const busy = new TownLife(models), quiet = new TownLife(models);
    busy.set([], row(20, 1));
    quiet.set([], row(20, 0.15));
    expect(busy.population).toBeGreaterThan(quiet.population * 3);
    expect(busy.population).toBeGreaterThan(20);
  });

  it("are busier in a city than a hamlet, and keep the parks' and bus stops' people when the pavements change", () => {
    const city = new TownLife(models), hamlet = new TownLife(models);
    city.set([], row(20, 1).map((f) => ({ ...f, band: 1.3 })));
    hamlet.set([], row(20, 1).map((f) => ({ ...f, band: 0.7 })));
    expect(city.population).toBeGreaterThan(hamlet.population);
    const life = new TownLife(models);
    life.set([], row(4, 1));
    const base = life.population;
    life.setExtra("parks", Array.from({ length: 30 }, (_, i) => ({ a: { x: i * 2, y: 30 }, b: { x: i * 2, y: 40 }, rot: 0 })));
    life.setExtra("stops", [{ a: { x: 0, y: -20 }, rot: 1 }]);
    expect(life.population).toBe(base + 31);
    // (the pavements laid out again: the others stay)
    life.set([], row(4, 1));
    expect(life.population).toBe(base + 31);
    life.frame(camera(30, 30, 70), PEOPLE_FULL * 0.5, 100, 13, 20);
    expect(life.drawn).toBeGreaterThan(base);
    life.setExtra("parks", []);
    expect(life.population).toBe(base + 1);
  });

  it("walk along their pavement, and are drawn only close in and in view", () => {
    const life = new TownLife(models);
    life.set([], row(10, 1));
    const cam = camera(54, -9, 70);
    life.frame(cam, PEOPLE_FULL * 0.5, 100, 13, 20);
    const shown = life.drawn;
    expect(shown).toBeGreaterThan(5);
    // every one on the pavement (world z -10..-8), within the row (and a few metres past its ends)
    const near = life.group.children.slice(-PEOPLE.length * 2, -PEOPLE.length) as THREE.InstancedMesh[];
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    for (let t = 0; t < 60; t += 7.3) {
      life.frame(cam, PEOPLE_FULL * 0.5, t, 13, 20);
      for (const mesh of near) for (let i = 0; i < mesh.count; i++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        expect(p.z).toBeGreaterThanOrEqual(-10);
        expect(p.z).toBeLessThanOrEqual(-8);
        expect(p.x).toBeGreaterThanOrEqual(-6 - 3 - 1e-6);
        expect(p.x).toBeLessThanOrEqual(9 * 12 + 6 + 3 + 1e-6);
      }
    }
    // far out, nobody; at night, fewer; looking elsewhere, nobody
    life.frame(cam, PEOPLE_SEE * 1.5, 100, 13, 20);
    expect(life.drawn).toBe(0);
    life.frame(cam, PEOPLE_FULL * 0.5, 100, 3, 20);
    expect(life.drawn).toBeLessThan(shown / 3);
    life.frame(camera(2000, 2000, 70), PEOPLE_FULL * 0.5, 100, 13, 20);
    expect(life.drawn).toBe(0);
  });

  it("stop short of a side street at a corner", () => {
    const life = new TownLife(models);
    // one shop, a side street's kerb just past its -x end, open ground past its +x end
    life.set([], [{ ...row(1, 1)[0], hw: 20, past: [0, 1] }]);
    const cam = camera(0, -9, 70);
    const near = life.group.children.slice(-PEOPLE.length * 2, -PEOPLE.length) as THREE.InstancedMesh[];
    const m = new THREE.Matrix4(), p = new THREE.Vector3();
    let seen = 0;
    for (let t = 0; t < 120; t += 3.1) {
      life.frame(cam, PEOPLE_FULL * 0.5, t, 13, 20);
      for (const mesh of near) for (let i = 0; i < mesh.count; i++, seen++) {
        mesh.getMatrixAt(i, m);
        p.setFromMatrixPosition(m);
        // (the lot is turned half round: its -x end lies at world +x)
        expect(p.x).toBeLessThanOrEqual(20 + 1e-6);
        expect(p.x).toBeGreaterThanOrEqual(-21 - 1e-6);
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
