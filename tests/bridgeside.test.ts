// A raised road seen from the side (the Diorama looks at it that way): its parapet is a clean wall that grows out
// of the ramp, none of it lying in the deck's own side (the two used to flicker into each other), every face of it
// lit (its normals used to cancel out to nothing); and a ramp's foot stands on a solid approach instead of a thin
// slab with daylight under it.

import { describe, it, expect } from "vitest";
import * as THREE from "three";
import { approachGeo, parapetGeo, parapetRise } from "../src/render/roads3d";
import type { V2 } from "../src/core/math";

/** A straight ramp along +x: 0 m up at x = 0, 6 m up at x = 120, level from there to x = 160. */
const N = 81;
const pts: V2[] = Array.from({ length: N }, (_, i) => ({ x: i * 2, y: 0 }));
const hs = pts.map((p) => Math.min(6, p.x / 20));
const HALF = 5;
const edge = (_: number, side: number) => HALF * side;

function tris(g: THREE.BufferGeometry) {
  const p = g.getAttribute("position"), n = g.getAttribute("normal");
  const out: { v: THREE.Vector3[]; n: THREE.Vector3 }[] = [];
  for (let i = 0; i < p.count; i += 3) {
    out.push({ v: [0, 1, 2].map((k) => new THREE.Vector3().fromBufferAttribute(p, i + k)), n: new THREE.Vector3().fromBufferAttribute(n, i) });
  }
  return out;
}

describe("a raised road from the side", () => {
  it("the parapet rises with the ramp: none on the ground, full height from about 1.8 m up, never a step", () => {
    expect(parapetRise(0)).toBe(0);
    expect(parapetRise(0.5)).toBe(0);
    expect(parapetRise(1.8)).toBe(1);
    expect(parapetRise(12)).toBe(1);
    let prev = 0;
    for (let h = 0; h <= 3; h += 0.05) {
      const k = parapetRise(h);
      expect(k).toBeGreaterThanOrEqual(prev);
      expect(k - prev).toBeLessThan(0.08);
      prev = k;
    }
  });

  it("the parapet is a lit, closed wall, and no face of it lies in the deck's side", () => {
    const g = parapetGeo(pts, hs, edge)!;
    expect(g).not.toBeNull();
    const T = tris(g);
    expect(T.length).toBeGreaterThan(100);
    let top = 0;
    for (const t of T) {
      // every face has a real normal, and is wound the way it faces
      expect(Math.abs(t.n.length() - 1)).toBeLessThan(1e-3);
      const w = new THREE.Vector3().subVectors(t.v[1], t.v[0]).cross(new THREE.Vector3().subVectors(t.v[2], t.v[0]));
      if (w.length() > 1e-9) expect(w.dot(t.n)).toBeGreaterThan(0);
      // no vertical face in the plane of the deck's edge (z = ±5), where the deck's own side is drawn
      const onEdge = t.v.every((v) => Math.abs(Math.abs(v.z) - HALF) < 1e-4);
      if (onEdge) expect(Math.abs(t.n.y)).toBeGreaterThan(0.9);
      for (const v of t.v) top = Math.max(top, v.y - Math.min(6, v.x / 20));
      // nothing where the road is on the ground
      for (const v of t.v) expect(v.x).toBeGreaterThanOrEqual(8);
    }
    // 0.95 m over the road (and its 0.06 m lift) where it is well up
    expect(top).toBeCloseTo(0.95 + 0.06, 2);
    // the outward faces look away from the road on both sides
    for (const t of T) if (Math.abs(t.n.z) > 0.9 && t.v.every((v) => Math.abs(v.z) > HALF)) expect(Math.sign(t.n.z)).toBe(Math.sign(t.v[0].z));
  });

  it("a road on the ground has no parapet and no approach", () => {
    const flat = pts.map(() => 0);
    expect(parapetGeo(pts, flat, edge)).toBeNull();
    expect(approachGeo(pts, flat, edge, 0.5)).toBeNull();
  });

  it("a ramp's foot stands on a solid approach: walls from the ground to its underside, up to where the piers take over", () => {
    const g = approachGeo(pts, hs, edge, 0.5)!;
    expect(g).not.toBeNull();
    const T = tris(g);
    let x0 = Infinity, x1 = -Infinity, cross = 0;
    for (const t of T) {
      expect(Math.abs(t.n.length() - 1)).toBeLessThan(1e-3);
      for (const v of t.v) {
        x0 = Math.min(x0, v.x); x1 = Math.max(x1, v.x);
        // never above the deck's underside (0.9 m under the road, which is lifted 0.06 m), never under the ground
        expect(v.y).toBeGreaterThanOrEqual(0);
        expect(v.y).toBeLessThanOrEqual(Math.max(0.02, v.x / 20 + 0.06 - 0.9) + 1e-4);
        // its walls stand out past the deck's edge by the ledge
        expect(Math.abs(v.z)).toBeLessThanOrEqual(HALF + 0.5 + 1e-4);
      }
      if (Math.abs(t.n.x) > 0.9) cross++;
    }
    // from where the underside leaves the ground (the road 0.84 m up: x = 16.8, the sample before it) to just
    // under 2.6 m up (x = 51)
    expect(x0).toBe(16);
    expect(x1).toBeCloseTo(51, 0);
    // one wall across, at its high end, facing up the ramp
    expect(cross).toBe(2);
    for (const t of T) if (Math.abs(t.n.x) > 0.9) expect(t.n.x).toBeGreaterThan(0);
    // not over water
    expect(approachGeo(pts, hs, edge, 0.5, undefined, () => true)).toBeNull();
  });
});
