import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingKind } from "../config";
import { SITE_MODELS } from "../game/sites";
import { CIVIC_KINDS } from "../game/civics";
import { CON_MODELS } from "./construction3d";
import { PILE_MODELS } from "./stockpiles3d";

/** A Blender model flattened into one vertex-coloured geometry (one draw call per instanced kind). */
export interface MergedModel {
  geo: THREE.BufferGeometry;
  /** Parking bays (model space): car origin + yaw so the car's nose (+z) faces the bay direction. */
  bays: THREE.Matrix4[];
}

/** A vehicle split by material: tinted parts get the per-vehicle colour; a "beacon" part (a convoy's amber lamps)
 * is drawn on its own so it can flash. */
export interface VehicleModel {
  parts: { geo: THREE.BufferGeometry; tint: boolean; name: string }[];
}

export const BUILDING_MODELS: BuildingKind[] = [
  "house", "terrace", "apartments", "modernflats", "aptower", "highstreet", "shop", "store", "fuelstation", "office", "mall", "tower", "glasstower",
  "hamlethall", "villagehall", "townhall", "cityhall", "farm", "loggingcamp", "foodplant", "sawmill", "coalplant",
  "ironmine", "coalmine", "quarry", "smelter", "cementworks",
  // the towns' civic buildings, each the reward of a town order (game/civics.ts)
  ...CIVIC_KINDS,
];
/**
 * Other looks of a kind (a street of homes shouldn't be one house stamped down): same lot, driveway and parking bay
 * as the kind's own model, a different house on it (see Buildings3D.modelOf).
 */
export const HOME_VARIANTS: string[] = ["house_b", "house_c"];
/**
 * What industry sites are built from besides the kinds' own models: the shared modules (halls, silos, heaps, the
 * truck yard...) and the plants of the later tiers, ready for their chains.
 */
export const SITE_PIECES: string[] = [
  ...SITE_MODELS, "oilwell", "sandpit", "refinery", "glassworks", "furniture", "constructionplant", "coppermine",
  "coppersmelter", "electronics", "machineworks",
  // deeper chains: the chemical works, the dairy and creamery, the rubber plant and the Motor Works
  "chemworks", "dairyfarm", "creamery", "rubberplant", "motorworks",
  // logistics (a warehouse, a fuel depot)
  "warehouse", "fueldepot",
  // the company's landmarks, three stages each (foundations, the structure rising, finished)
  "mega_hydrodam_1", "mega_hydrodam_2", "mega_hydrodam_3", "mega_skylinetower_1", "mega_skylinetower_2", "mega_skylinetower_3",
  "mega_exposition_1", "mega_exposition_2", "mega_exposition_3",
  // the farms' fields through the year (see calendar.fieldModel)
  "site_field_young", "site_field_cut", "site_field_bare", "farm_young", "farm_ripe", "farm_cut", "farm_bare",
  // industrial-park links: a belt or pipe segment, the transfer towers at its ends, and what moves along them
  "link_conveyor", "link_pipe", "link_tower", "link_load", "link_flow",
  // what lies in the works' yards, as full as their stores (render/stockpiles3d.ts)
  ...PILE_MODELS,
];
export const VEHICLE_MODELS = [
  "car", "van", "truck", "tipper", "tanker", "flatbed", "bus",
  // the bigger truck classes (game/trucks.ts): heavy rigids, and a road train's tractor and its lead (a) and rear (b)
  // trailers, drawn piece by piece along the path
  "heavy_truck", "heavy_tipper", "heavy_tanker", "heavy_flatbed",
  "rt_tractor", "rt_truck_a", "rt_truck_b", "rt_tipper_a", "rt_tipper_b", "rt_tanker_a", "rt_tanker_b",
  "rt_flatbed_a", "rt_flatbed_b",
  // an oversized-load convoy (game/convoys.ts): escort cars front and back, the heavy-haul tractor and its low-loader
  "escort_car", "ll_tractor", "ll_trailer_turbine", "ll_trailer_girder",
  // refrigerated bodies for perishables (milk, cheese), in every class
  "reefer", "heavy_reefer", "rt_reefer_a", "rt_reefer_b",
  // car transporters for the Motor Works' cars, in every class, and a Motor Works car out on a town's streets
  "carrier", "heavy_carrier", "rt_carrier_a", "rt_carrier_b", "motorcar",
] as const;
/** Street furniture, drawn on its own (not a lot). */
export const PROP_MODELS = ["busstop", "fence", "hedge", "picket", "bridge_pier", "bridge_abutment", "bridge_pylon", "bridge_truss", "streetlamp", "floodmast", ...CON_MODELS] as const;
export type VehicleKind = (typeof VEHICLE_MODELS)[number];

export interface ModelSet {
  buildings: Map<BuildingKind, MergedModel>;
  vehicles: Map<VehicleKind, VehicleModel>;
  props: Map<string, MergedModel>;
  /** Site modules and later-tier plants, by name (see SITE_PIECES). */
  sites: Map<string, MergedModel>;
}

const base = import.meta.env.BASE_URL + "models/";

export async function loadModels(onProgress?: (k: number) => void): Promise<ModelSet> {
  const loader = new GLTFLoader();
  const all = [...BUILDING_MODELS, ...HOME_VARIANTS, ...VEHICLE_MODELS, ...PROP_MODELS, ...SITE_PIECES];
  let done = 0;
  const load = (n: string) => loader.loadAsync(base + n + ".glb").then((g) => g.scene);
  const scenes = await Promise.all(
    all.map((n) =>
      load(n).then((s) => {
        done++;
        onProgress?.(done / all.length);
        return s;
      }),
    ),
  );
  const buildings = new Map<BuildingKind, MergedModel>();
  const vehicles = new Map<VehicleKind, VehicleModel>();
  const props = new Map<string, MergedModel>();
  const sites = new Map<string, MergedModel>();
  all.forEach((n, i) => {
    const sc = scenes[i];
    sc.updateMatrixWorld(true);
    if ((VEHICLE_MODELS as readonly string[]).includes(n)) vehicles.set(n as VehicleKind, splitVehicle(sc));
    else if ((PROP_MODELS as readonly string[]).includes(n)) props.set(n, mergeModel(sc));
    else if (SITE_PIECES.includes(n)) sites.set(n, mergeModel(sc));
    else buildings.set(n as BuildingKind, mergeModel(sc));
  });
  return { buildings, vehicles, props, sites };
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
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      o.matrixWorld.decompose(pos, q, sc);
      bays.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).multiply(flip));
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
  // merge by role so a vehicle kind is at most 3 draw calls: body (tinted), cargo (tinted), fixed (and a convoy's
  // flashing beacons)
  const out: VehicleModel["parts"] = [];
  const beacon = (p: VehicleModel["parts"][number]) => p.name.includes("beacon");
  const groups: [string, (p: VehicleModel["parts"][number]) => boolean, boolean][] = [
    ["body", (p) => p.tint && !p.name.includes("cargo"), true],
    ["cargo", (p) => p.tint && p.name.includes("cargo"), true],
    ["fixed", (p) => !p.tint && !beacon(p), false],
    ["beacon", (p) => !p.tint && beacon(p), false],
  ];
  for (const [name, pick, tint] of groups) {
    const ps = parts.filter(pick);
    if (ps.length) out.push({ geo: mergeGeometries(ps.map((p) => p.geo), false)!, tint, name });
  }
  return { parts: out };
}
