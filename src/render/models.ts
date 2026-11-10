import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { FxKind, FxSpot } from "./plumes";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import type { BuildingKind } from "../config";
import { SITE_MODELS } from "../game/sites";
import { CIVIC_KINDS } from "../game/civics";
import { CON_MODELS } from "./construction3d";
import { PILE_MODELS } from "./stockpiles3d";
import { TOWN_VARIANTS } from "./townmodels";

/** A Blender model flattened into one vertex-coloured geometry (one draw call per instanced kind). */
export interface MergedModel {
  geo: THREE.BufferGeometry;
  /** Parking bays (model space): car origin + yaw so the car's nose (+z) faces the bay direction. */
  bays: THREE.Matrix4[];
  /** Where it smokes, steams or raises dust (the GLB's `stack_N`, `steam_N`... empties; model space). */
  fx: FxSpot[];
  /** A town model's alley end (model x, z): cars drive in along it to the yard behind (the GLB's `via_0`). */
  via?: [number, number];
  /** A town model's building without its yard: x0, x1, z0, z1, top (the GLB's `body_0`). */
  body?: [number, number, number, number, number];
  /** The lot scale and height stretch a town model was made for (the GLB's `design_0`; render/townmodels.ts). */
  design?: [number, number];
}

/**
 * Glass that lights at night: a material named `win_<kind>` (tools/blender/town_a_kit.py). Its vertices carry
 * `lit` = 1 + the kind's index + a random share per pane, which the buildings' shader (envShader `windows`) turns
 * into lit and dark windows by the hour. Signs (`win_sign_*`) glow in their own colour while the lamps are on.
 */
export const LIT_KINDS = ["home", "shop", "office", "hall", "sign"] as const;
export const litKind = (material: string): number => {
  const m = /^win_([a-z]+)/.exec(material);
  return m ? LIT_KINDS.indexOf(m[1] as (typeof LIT_KINDS)[number]) : -1;
};

/** The `lit` attribute for one material's geometry: 0 for walls; for glass, each pane (a quad's two triangles share
 * their bounds) its own steady random share. */
function litAttribute(g: THREE.BufferGeometry, kind: number): THREE.BufferAttribute {
  const pos = g.getAttribute("position");
  const out = new Float32Array(pos.count);
  if (kind >= 0) {
    const q = (v: number) => Math.round(v * 50);
    for (let i = 0; i + 2 < pos.count; i += 3) {
      let x0 = Infinity, y0 = Infinity, z0 = Infinity, x1 = -Infinity, y1 = -Infinity, z1 = -Infinity;
      for (let k = i; k < i + 3; k++) {
        const x = pos.getX(k), y = pos.getY(k), z = pos.getZ(k);
        x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y); z0 = Math.min(z0, z); z1 = Math.max(z1, z);
      }
      let h = 2166136261;
      for (const v of [q(x0), q(x1), q(y0), q(y1), q(z0), q(z1)]) h = Math.imul(h ^ (v & 0xffff), 16777619);
      h ^= h >>> 15; h = Math.imul(h, 2246822519); h ^= h >>> 13;
      const v = 1 + kind + 0.04 + (((h >>> 0) % 1000) / 1000) * 0.92;
      out[i] = out[i + 1] = out[i + 2] = v;
    }
  }
  return new THREE.BufferAttribute(out, 1);
}

/**
 * A vehicle model (tools/blender/vehicles_a_kit.py), merged so a kind is one draw call. `geo` is the whole vehicle:
 * `color` is each part's own colour, white where the vehicle's paint goes, and `role` says whose paint that is (see
 * PAINT_ROLES; render/vehiclepaint.ts lays it on). `far` is the same vehicle in a few dozen triangles (the cars: drawn
 * when one is a handful of pixels long). `beacon` (a convoy's amber lamps) is drawn on its own so it can flash.
 */
export interface VehicleModel {
  geo: THREE.BufferGeometry;
  far: THREE.BufferGeometry | null;
  beacon: THREE.BufferGeometry | null;
  /** Model space (front +z): the bumpers, the half width, and how far out from the middle the head and tail lamps sit. */
  ends: { front: number; rear: number; half: number; head: number; tail: number };
  tris: number;
}
/** What a material's name asks for: 0 its own colour, else the instance's body, second or cargo paint. */
export const PAINT_ROLES = ["", "body", "second", "cargo"] as const;

export const BUILDING_MODELS: BuildingKind[] = [
  "house", "terrace", "apartments", "modernflats", "aptower", "highstreet", "shop", "store", "fuelstation", "office", "mall", "tower", "glasstower",
  "hamlethall", "villagehall", "townhall", "cityhall", "farm", "loggingcamp", "foodplant", "sawmill", "coalplant",
  "ironmine", "coalmine", "quarry", "smelter", "cementworks",
  // the towns' civic buildings, each the reward of a town order (game/civics.ts)
  ...CIVIC_KINDS,
];
/**
 * Other looks of a grown kind (a street shouldn't be one building stamped down): same footprint as the kind's own
 * model, a different building on it, made for a lot size and height (render/townmodels.ts, Buildings3D.modelOf).
 */
export const HOME_VARIANTS: string[] = TOWN_VARIANTS;
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
  // the townspeople's cars (render/carlook.ts picks one for each): a saloon, a coupe, an open tourer, a pickup
  "car", "car_coupe", "car_tourer", "car_pickup",
  "van", "truck", "tipper", "tanker", "flatbed", "bus",
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
export const PROP_MODELS = ["busstop", "fence", "hedge", "picket", "bridge_pier", "bridge_abutment", "bridge_pylon", "bridge_truss", "streetlamp", "signal", "floodmast", "telegraphpole", "telegraphwire", "billboard_a", "billboard_b", "billboard_c", ...CON_MODELS] as const;
export type VehicleKind = (typeof VEHICLE_MODELS)[number];

/**
 * A tree (tools/blender/build_trees.py), every part merged into one geometry: the full model and the one drawn when
 * it is a few pixels tall. Besides position and normal, each vertex carries `aPart` (0 trunk, 1 leaves, 2 bare limbs,
 * 3 needles, 4 a shrub's foliage) and `aClump` (the middle of the clump of foliage it belongs to, and the clump's own
 * random number) and `aTwig` (where the vertex goes when the leaves fall: each facet of a clump thins to a twig), which the tree shader sways, colours and sheds by (render/trees3d.ts).
 */
export interface TreeShape {
  full: THREE.BufferGeometry;
  lod: THREE.BufferGeometry;
}

export interface ModelSet {
  /** The trees and shrubs, by name (render/forest.ts TREE_MODELS). */
  trees: Map<string, TreeShape>;
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
  const treesDue = load("trees");
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
  const treeScene = await treesDue;
  treeScene.updateMatrixWorld(true);
  return { buildings, vehicles, props, sites, trees: splitTrees(treeScene) };
}

const TREE_PARTS: Record<string, number> = { trunk: 0, leaf: 1, bare: 2, needle: 3, bush: 4 };

/** The trees' GLB: one mesh per part, named <tree>__<part> (lod_<part> for the far model). */
function splitTrees(sc: THREE.Object3D): Map<string, TreeShape> {
  const by = new Map<string, { full: THREE.BufferGeometry[]; lod: THREE.BufferGeometry[] }>();
  sc.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const [tree, part] = m.name.split("__");
    if (!part) return;
    const lod = part.startsWith("lod_");
    const bit = /^(?:lod_)?([a-z]+)(\d*)$/.exec(part);
    if (!bit || !(bit[1] in TREE_PARTS)) return;
    const code = TREE_PARTS[bit[1]];
    let g = m.geometry.clone();
    g.applyMatrix4(m.matrixWorld);
    for (const k of Object.keys(g.attributes)) if (k !== "position") g.deleteAttribute(k);
    if (g.index) g = g.toNonIndexed();
    // (flat faces, like the buildings)
    g.computeVertexNormals();
    const pos = g.getAttribute("position"), n = pos.count;
    // the clump's middle: a trunk's and the limbs' is their foot on the tree's axis, foliage's the mean of its points
    let cx = 0, cy = 0, cz = 0, lo = Infinity;
    for (let i = 0; i < n; i++) { cx += pos.getX(i); cy += pos.getY(i); cz += pos.getZ(i); lo = Math.min(lo, pos.getY(i)); }
    if (code === 0 || code === 2) { cx = 0; cy = lo; cz = 0; } else { cx /= n; cy /= n; cz /= n; }
    const rnd = ((Number(bit[2] || 0) + 1) * 0.618034 + tree.length * 0.137) % 1;
    const clump = new Float32Array(n * 4), kind = new Float32Array(n);
    for (let i = 0; i < n; i++) { clump.set([cx, cy, cz, rnd], i * 4); kind[i] = code; }
    // a leaf clump in winter: each facet thins to a twig running out from the clump's middle to one of its corners
    const twig = new Float32Array(pos.array as Float32Array);
    if (code === 1) {
      const C = new THREE.Vector3(cx, cy, cz), tip = new THREE.Vector3(), side = new THREE.Vector3(), foot = new THREE.Vector3();
      for (let f = 0; f < n / 3; f++) {
        const k = f % 3, h = ((f + 1) * 0.754877 + rnd) % 1;
        tip.fromBufferAttribute(pos, f * 3 + k).sub(C);
        side.set(tip.z, 0, -tip.x);
        if (side.lengthSq() < 1e-6) side.set(1, 0, 0);
        side.normalize().multiplyScalar(0.035);
        foot.copy(C).addScaledVector(tip, 0.1);
        tip.multiplyScalar(0.78 + 0.34 * h).add(C);
        tip.toArray(twig, (f * 3 + k) * 3);
        foot.clone().add(side).toArray(twig, (f * 3 + (k + 1) % 3) * 3);
        foot.clone().sub(side).toArray(twig, (f * 3 + (k + 2) % 3) * 3);
      }
    }
    g.setAttribute("aTwig", new THREE.BufferAttribute(twig, 3));
    g.setAttribute("aClump", new THREE.BufferAttribute(clump, 4));
    g.setAttribute("aPart", new THREE.BufferAttribute(kind, 1));
    let e = by.get(tree);
    if (!e) by.set(tree, (e = { full: [], lod: [] }));
    (lod ? e.lod : e.full).push(g);
  });
  const out = new Map<string, TreeShape>();
  for (const [name, e] of by) out.set(name, { full: mergeGeometries(e.full, false)!, lod: mergeGeometries(e.lod, false)! });
  return out;
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
  const fx: FxSpot[] = [];
  let via: MergedModel["via"], body: MergedModel["body"], design: MergedModel["design"];
  const flip = new THREE.Matrix4().makeRotationY(Math.PI);
  const prep = (mesh: THREE.Mesh) => {
    const g = prepGeometry(mesh, meshColor(mesh));
    const mat = (Array.isArray(mesh.material) ? mesh.material[0] : mesh.material) as THREE.Material | undefined;
    g.setAttribute("lit", litAttribute(g, litKind(mat?.name ?? "")));
    return g;
  };
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
          geos.push(prep(mm));
        }
      } else geos.push(prep(m));
    } else if (/^park_?\d+/i.test(o.name)) {
      // empty: its -z (Blender +Y) is where the car's nose points; car models face +z
      const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
      o.matrixWorld.decompose(pos, q, sc);
      bays.push(new THREE.Matrix4().compose(pos, q, new THREE.Vector3(1, 1, 1)).multiply(flip));
    } else {
      // an emitter: its place is the plume's mouth, its scale the plume's width there
      const k = /^(stack|steam|dust|haze|flare|chimney)_?\d+/i.exec(o.name);
      if (k) {
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        o.matrixWorld.decompose(pos, q, sc);
        fx.push({ kind: k[1].toLowerCase() as FxKind, x: pos.x, y: pos.y, z: pos.z, size: sc.x });
      } else if (/^(via|body|design)_?\d+/i.test(o.name)) {
        // a town model's own notes (tools/blender/town_a_kit.py)
        const pos = new THREE.Vector3(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
        o.matrixWorld.decompose(pos, q, sc);
        const n = o.name.toLowerCase();
        if (n.startsWith("via")) via = [pos.x, pos.z];
        else if (n.startsWith("body")) body = [pos.x - sc.x, pos.x + sc.x, pos.z - sc.z, pos.z + sc.z, pos.y];
        else design = [sc.x, sc.z];
      }
    }
  });
  const geo = mergeGeometries(geos, false)!;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return { geo, bays, fx, via, body, design };
}

function splitVehicle(sc: THREE.Object3D): VehicleModel {
  const near: THREE.BufferGeometry[] = [], far: THREE.BufferGeometry[] = [], beacon: THREE.BufferGeometry[] = [];
  const white = new THREE.Color(1, 1, 1);
  // (where the lamp lenses are: the mean distance of their vertices from the middle)
  const lamps = { lamp: [0, 0], tail: [0, 0] };
  sc.traverse((o) => {
    const m = o as THREE.Mesh;
    if (!m.isMesh) return;
    const mat = (Array.isArray(m.material) ? m.material[0] : m.material) as THREE.Material | undefined;
    const name = (mat?.name ?? "").toLowerCase();
    const isFar = /^far/i.test(m.name) || /^far/i.test(m.parent?.name ?? "");
    if (name === "beacon") {
      if (!isFar) beacon.push(prepGeometry(m, meshColor(m)));
      return;
    }
    const role = Math.max(0, (PAINT_ROLES as readonly string[]).indexOf(name));
    const g = prepGeometry(m, role ? white : meshColor(m));
    const pos = g.getAttribute("position");
    g.setAttribute("role", new THREE.BufferAttribute(new Float32Array(pos.count).fill(role), 1));
    (isFar ? far : near).push(g);
    if (!isFar && (name === "lamp" || name === "tail")) {
      const L = lamps[name];
      for (let i = 0; i < pos.count; i++) { L[0] += Math.abs(pos.getX(i)); L[1]++; }
    }
  });
  const geo = mergeGeometries(near, false)!;
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  const b = geo.boundingBox!;
  const half = Math.max(-b.min.x, b.max.x), side = Math.max(0.45, half - 0.25);
  return {
    geo,
    far: far.length ? mergeGeometries(far, false)! : null,
    beacon: beacon.length ? mergeGeometries(beacon, false)! : null,
    ends: {
      front: b.max.z, rear: b.min.z, half,
      head: lamps.lamp[1] ? lamps.lamp[0] / lamps.lamp[1] : side,
      tail: lamps.tail[1] ? lamps.tail[0] / lamps.tail[1] : side,
    },
    tris: geo.getAttribute("position").count / 3,
  };
}
