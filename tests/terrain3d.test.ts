// The ground (render/terrain3d.ts) holds a few textures and a material for every chunk it has drawn. A new game or a
// loaded save makes a new ground: the old one must hand all of that back, or every load leaks it on the GPU.

import * as THREE from "three";
import { describe, it, expect, vi } from "vitest";
import { Terrain } from "../src/world/terrain";
import { Forest } from "../src/render/forest";
import { Terrain3D } from "../src/render/terrain3d";
import type { View } from "../src/render/view";

/** a view looking at (cx, cy), `half` m from its middle to its edges, at `mpp` metres a pixel */
const viewOver = (cx: number, cy: number, half: number, mpp: number) =>
  ({ cx, cy, mpp, rot: 0, tilt: 0.7, bounds: () => ({ x0: cx - half, y0: cy - half, x1: cx + half, y1: cy + half }) }) as unknown as View;

describe("the ground's chunks", () => {
  it("are all handed back when the ground is done with: every texture, every material, the painted crowns too", () => {
    const terrain = new Terrain(7);
    const ground = new Terrain3D(terrain, new Forest(terrain), false);
    // near in (the fine chunks, their crowns painted) and then from far off (coarse ones)
    ground.crownsSoon = true;
    for (const v of [viewOver(300, 300, 700, 1), viewOver(0, 0, 9000, 20)]) {
      for (let i = 0; i < 400; i++) { ground.update(v); if (ground.settled) break; }
      expect(ground.settled).toBe(true);
    }
    const chunks = ground.group.children.filter((m) => (m as THREE.Mesh).material instanceof THREE.MeshLambertMaterial) as THREE.Mesh[];
    expect(chunks.length).toBeGreaterThan(8);
    const textures = vi.spyOn(THREE.Texture.prototype, "dispose"), materials = vi.spyOn(THREE.Material.prototype, "dispose");
    const gone = new Set<THREE.Material>();
    for (const m of chunks) (m.material as THREE.Material).addEventListener("dispose", (e) => gone.add(e.target as THREE.Material));
    ground.dispose();
    // three field textures a chunk and its relief, and the crowns of the ones that had them painted
    expect(textures.mock.calls.length).toBeGreaterThan(chunks.length * 4);
    expect(gone.size).toBe(chunks.length);
    expect(materials.mock.calls.length).toBeGreaterThanOrEqual(chunks.length);
    expect(ground.group.children.length).toBe(0);
    textures.mockRestore();
    materials.mockRestore();
  });
});
