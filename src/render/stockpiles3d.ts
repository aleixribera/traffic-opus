import * as THREE from "three";
import { YARDS } from "../game/stockpiles";
import type { ModelSet } from "./models";

/**
 * The heaps and log stacks in a works' yards (docs/design.md "Stockpiles"), drawn as full as its stores: a heap grows
 * taller and wider as the store fills and shrinks as trucks haul it off; a log yard's stacks come and go stack by
 * stack, layer by layer. Blender models (tools/blender/build_models.py, "stockpiles"), set where the bay models
 * (site_heap_*, site_logyard) leave room for them.
 */

const HEAP_MODELS: Record<string, [string, string]> = {
  site_heap_ore: ["pile_ore_a", "pile_ore_b"],
  site_heap_coal: ["pile_coal_a", "pile_coal_b"],
  site_heap_lime: ["pile_lime_a", "pile_lime_b"],
  site_heap_sand: ["pile_sand_a", "pile_sand_b"],
  site_heap_cu: ["pile_cu_a", "pile_cu_b"],
};
export const PILE_MODELS: string[] = [...Object.values(HEAP_MODELS).flat(), "pile_logs_1", "pile_logs_2", "pile_logs_3"];

/** Where a bay's piles stand in its model's space (x, z: +z toward its front), in the order they fill. */
const HEAPS: [number, number][] = [[-6.5, -3.25], [6.5, -3.25]];
const STACKS: [number, number][] = [[-11.25, 4.9], [2.75, 4.9], [-11.25, -0.9], [2.75, -0.9], [-11.25, -6.7]];

/** One yard: its bay model's world matrix and how full each of its piles is. */
export interface YardJob {
  model: string;
  base: THREE.Matrix4;
  fills: number[];
  seed: number;
}

export class Stockpiles3D {
  readonly group = new THREE.Group();
  /** one mesh per pile model, kept from one update to the next (grown when it runs out of room) */
  private meshes = new Map<string, THREE.InstancedMesh>();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();

  constructor(private models: ModelSet, private mat: THREE.Material) {}

  /** Lay out every yard's piles again (call when a works' stores have moved on, or its yards were rebuilt). */
  update(yards: YardJob[]) {
    const list = new Map<string, THREE.Matrix4[]>();
    const put = (model: string, m: THREE.Matrix4) => {
      let a = list.get(model);
      if (!a) list.set(model, (a = []));
      a.push(m.clone());
    };
    for (const y of yards) {
      const def = YARDS[y.model];
      if (!def) continue;
      y.fills.forEach((u, i) => {
        if (def.logs) {
          // a stack of one, two or three layers (logs don't squash: a part-filled stack is a lower one)
          const at = STACKS[i];
          if (!at || u <= 0.02) return;
          const model = u >= 0.67 ? "pile_logs_3" : u >= 0.34 ? "pile_logs_2" : "pile_logs_1";
          this.tmp.makeTranslation(at[0], 0, at[1]);
          put(model, this.tmp.premultiply(y.base));
          return;
        }
        // a heap: taller and wider as it fills, turned a little per heap so the bays don't repeat
        const at = HEAPS[i];
        if (!at || u <= 0.01) return;
        const h = 0.18 + 0.82 * u, w = 0.5 + 0.5 * Math.sqrt(u);
        const yaw = ((y.seed * 7 + i * 3) % 12) * (Math.PI / 6);
        this.tmp.makeRotationY(yaw).setPosition(at[0], 0, at[1]).multiply(this.tmp2.makeScale(w, h, w));
        put(HEAP_MODELS[y.model][i % 2], this.tmp.premultiply(y.base));
      });
    }
    for (const model of PILE_MODELS) {
      const a = list.get(model) ?? [];
      let mesh = this.meshes.get(model);
      if (!a.length && !mesh) continue;
      if (!mesh || mesh.instanceMatrix.count < a.length) {
        const geo = this.models.sites.get(model)?.geo;
        if (!geo) continue;
        if (mesh) { this.group.remove(mesh); mesh.dispose(); }
        let cap = 16;
        while (cap < a.length) cap *= 2;
        mesh = new THREE.InstancedMesh(geo, this.mat, cap);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.meshes.set(model, mesh);
        this.group.add(mesh);
      }
      a.forEach((m, i) => mesh!.setMatrixAt(i, m));
      mesh.count = a.length;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.computeBoundingSphere();
    }
  }

  dispose() {
    for (const m of this.meshes.values()) { this.group.remove(m); m.dispose(); }
    this.meshes.clear();
  }
}
