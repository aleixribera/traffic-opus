import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingKind } from "../config";

/** A Blender model flattened into one vertex-coloured geometry (one draw call per instanced kind). */
export interface MergedModel {
  geo: THREE.BufferGeometry;
  /** Parking bays (model space): car origin + yaw so the car's nose (+z) faces the bay direction. */
  bays: THREE.Matrix4[];
}

/** A vehicle split by material: tinted parts get the per-vehicle colour. */
export interface VehicleModel {
  parts: { geo: THREE.BufferGeometry; tint: boolean; name: string }[];
}

export const BUILDING_MODELS: BuildingKind[] = [
  "house", "terrace", "apartments", "shop", "store", "mall", "office", "tower", "mine", "farm", "works", "foodplant",
  "garbage", "firestation", "police", "clinic", "hospital", "school", "highschool", "university", "park", "parklarge",
];
export const VEHICLE_MODELS = ["car", "van", "truck", "bus", "garbagetruck", "firetruck", "ambulance", "policecar"] as const;
/** Street furniture, drawn on its own (not a lot). */
export const PROP_MODELS = ["busstop"] as const;
export type VehicleKind = (typeof VEHICLE_MODELS)[number];

export interface ModelSet {
  buildings: Map<BuildingKind, MergedModel>;
  vehicles: Map<VehicleKind, VehicleModel>;
  props: Map<string, MergedModel>;
}

const base = import.meta.env.BASE_URL + "models/";

export async function loadModels(onProgress?: (k: number) => void): Promise<ModelSet> {
  const loader = new GLTFLoader();
  const all = [...BUILDING_MODELS, ...VEHICLE_MODELS, ...PROP_MODELS];
  let done = 0;
  const scenes = await Promise.all(
    all.map((n) =>
      loader.loadAsync(base + n + ".glb").then((g) => {
        done++;
        onProgress?.(done / all.length);
        return g.scene;
      }),
    ),
  );
  const buildings = new Map<BuildingKind, MergedModel>();
  const vehicles = new Map<VehicleKind, VehicleModel>();
  const props = new Map<string, MergedModel>();
  all.forEach((n, i) => {
    const sc = scenes[i];
    sc.updateMatrixWorld(true);
    if ((VEHICLE_MODELS as readonly string[]).includes(n)) vehicles.set(n as VehicleKind, splitVehicle(sc));
    else if ((PROP_MODELS as readonly string[]).includes(n)) props.set(n, mergeModel(sc));
    else buildings.set(n as BuildingKind, mergeModel(sc));
  });
  return { buildings, vehicles, props };
}

function prepGeometry(m: THREE.Mesh, color: THREE.Color | null): THREE.BufferGeometry {
  let g = m.geometry.clone();
  g.applyMatrix4(m.matrixWorld);
  for (const k of Object.keys(g.attributes)) if (k !== "position" && k !== "normal") g.deleteAttribute(k);
  if (!g.getAttribute("normal")) g.computeVertexNormals();
  if (g.index) g = g.toNonIndexed();
  if (color) {
    const n = g.getAttribute("position").count;
    const c = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) c.set([color.r, color.g, color.b], i * 3);
    g.setAttribute("color", new THREE.BufferAttribute(c, 3));
  }
  return g;
}

function meshColor(m: THREE.Mesh): THREE.Color {
  const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.MeshStandardMaterial;
  return mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1);
}

function mergeModel(sc: THREE.Object3D): MergedModel {
  const geos: THREE.BufferGeometry[] = [];
  const bays: THREE.Matrix4[] = [];
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  sc.traverse((o) => {
    const m = o as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      if (mats.length > 1 && m.geometry.groups.length) {
        // multi-material mesh: split by group so every part keeps its colour
        for (const gr of m.geometry.groups) {
          const sub = m.geometry.clone();
          const idx = sub.index;
          if (idx) {
            sub.setIndex(Array.from(idx.array).slice(gr.start, gr.start + gr.count));
          }
          const mm = new THREE.Mesh(sub, mats[gr.materialIndex ?? 0]);
          mm.matrixWorld.copy(m.matrixWorld);
          geos.push(prepGeometry(mm, meshColor(mm)));
        }
      } else geos.push(prepGeometry(m, meshColor(m)));
    } else if (/^park_?\d+/i.test(o.name)) {
      // empty: its -z (Blender +Y) is where the car's nose points; car models face +z
      bays.push(o.matrixWorld.clone().multiply(flip));
    }
  });
  const geo = mergeGeometries(geos, false)!;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, bays };
}

function splitVehicle(sc: THREE.Object3D): VehicleModel {
  const parts: VehicleModel["parts"] = [];
  sc.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const name = (m.name || (m.material as THREE.Material).name || "").toLowerCase();
    const tint = /body|cargo/.test(name) || /body|cargo/.test(((m.material as THREE.Material).name || "").toLowerCase());
    const col = meshColor(m);
    parts.push({ geo: prepGeometry(m, tint ? null : col), tint, name });
  });
  // merge by role so a vehicle kind is at most 3 draw calls: body (tinted), cargo (tinted), fixed
  const out: VehicleModel["parts"] = [];
  const groups: [string, (p: VehicleModel["parts"][number]) => boolean, boolean][] = [
    ["body", (p) => p.tint && !p.name.includes("cargo"), true],
    ["cargo", (p) => p.tint && p.name.includes("cargo"), true],
    ["fixed", (p) => !p.tint, false],
  ];
  for (const [name, pick, tint] of groups) {
    const ps = parts.filter(pick);
    if (ps.length) out.push({ geo: mergeGeometries(ps.map((p) => p.geo), false)!, tint, name });
  }
  return { parts: out };
}
