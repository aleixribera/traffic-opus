// Handing back what a layer of the map holds on the GPU when a game is closed. Nothing else frees a mesh's buffers
// or a material's textures: three.js keeps every geometry it ever drew until it is told, so each game loaded on top
// of another would leave the last one's roads, cars and lamps behind in video memory.

import * as THREE from "three";
import type { ModelSet } from "./models";

/** The Blender models' geometries: loaded once and shared by every game, so never freed with one. */
export function modelGeometries(models: ModelSet): Set<THREE.BufferGeometry> {
  const keep = new Set<THREE.BufferGeometry>();
  for (const t of models.trees.values()) keep.add(t.full).add(t.lod);
  for (const m of [...models.buildings.values(), ...models.props.values(), ...models.sites.values(), ...(models.far?.values() ?? [])]) keep.add(m.geo);
  for (const v of models.vehicles.values()) {
    keep.add(v.geo);
    if (v.far) keep.add(v.far);
    if (v.beacon) keep.add(v.beacon);
  }
  return keep;
}

/**
 * Free every geometry, material and texture under `root`, and the instance buffers of its instanced meshes, except
 * the shared ones in `keep`. (Freeing one twice, or one that is drawn again later, does no harm: three.js uploads it
 * afresh.)
 */
export function disposeTree(root: THREE.Object3D, keep: ReadonlySet<unknown>) {
  const geos = new Set<THREE.BufferGeometry>(), mats = new Set<THREE.Material>();
  root.traverse((o) => {
    if (o instanceof THREE.InstancedMesh) o.dispose();
    const m = o as THREE.Mesh;
    if (m.geometry instanceof THREE.BufferGeometry) geos.add(m.geometry);
    const mat = m.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) for (const x of mat) mats.add(x);
    else if (mat instanceof THREE.Material) mats.add(mat);
    for (const k of ["customDepthMaterial", "customDistanceMaterial"] as const) if (o[k]) mats.add(o[k]);
  });
  for (const g of geos) if (!keep.has(g)) g.dispose();
  for (const mat of mats) {
    if (keep.has(mat)) continue;
    for (const v of Object.values(mat)) if (v instanceof THREE.Texture && !keep.has(v)) v.dispose();
    mat.dispose();
  }
}
