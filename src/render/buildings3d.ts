import * as THREE from "three";
import { BUILDING_TYPES, ROAD_TYPES, SIDEWALK, roadGroup, type BuildingKind } from "../config";
import { add, dot, fromAngle, pointSegDist2, rectCorners, right, scale, type V2 } from "../core/math";
import type { RoadNetwork } from "../roads/network";
import type { Building } from "../game/buildings";
import { ZONE_GROUP } from "../game/growables";
import type { PlantKind } from "../game/industry";
import { GATE_GAP, GROW_ANIM, siteDir, siteFrame, siteLayout, siteToWorld, slotHalf, type SiteFrame, type SiteLayout, type SiteSlot } from "../game/sites";
import type { MergedModel, ModelSet } from "./models";
import { isHall } from "../game/towns";
import { isCivic } from "../game/civics";
import { PAL } from "./palette";
import { PARKED, setParked, type ParkSlot } from "./parked3d";
import { parkedStance } from "./carlook";
import { clockOf } from "./daylight";
import { HALL_TIER, squarePlan, type SquarePlan } from "./civic";
import type { PlantedTree } from "./trees3d";
import type { FxEmitter } from "./plumes";
import { PLANTS } from "../game/industry";
import { isMega, megaStage } from "../game/megaprojects";
import { fieldLook, fieldModel } from "../game/calendar";
import { seasonal } from "./envShader";
import type { LampSpot, WindowSpot } from "./lamps3d";
import { TOWN_MODELS, Variety, townChoices, wallChoices } from "./townmodels";
import { LOTS } from "./furniture";
import type { Solid } from "../ui/pick";
import type { WindowKind } from "./daylight";
import { stageAt, stageOf, type StageInfo } from "../game/construction";
import { Construction3D, type ConJob } from "./construction3d";
import { Stockpiles3D, type YardJob } from "./stockpiles3d";
import { YARDS, pileFills } from "../game/stockpiles";

/**
 * The model a site's slot is drawn with now: a landmark's core by how far its building has got (foundations, the
 * structure in scaffolding, finished), a farm's fields by the season; anything else as planned. `stage` overrides
 * the landmark's (the placement ghost shows it finished).
 */
/** What a building's lit windows look like at night: none for a works (it has floodlights) or a building site. */
function windowKind(b: Building): WindowKind | null {
  if (b.zone) {
    if (ZONE_GROUP[b.zone] === "res") return "home";
    return b.zone === "comHigh" || b.zone === "comTower" ? "office" : "shop";
  }
  if (isHall(b.kind) || isCivic(b.kind)) return "hall";
  if (b.plant || b.placed) return null;
  return "office";
}

function slotModel(b: Building | null, model: string, time: number, stage?: 1 | 2 | 3): string {
  if (model.startsWith("mega_")) return `${model}_${stage ?? (b ? megaStage(b, PLANTS[b.kind as PlantKind]) : 3)}`;
  if (model === "site_field_g" || model === "site_field_w" || model === "farm") return fieldModel(model, fieldLook(time));
  return model;
}

/** Model matrix for a lot: model +z (its front) faces the road, origin at the footprint centre. */
export function lotMatrix(out: THREE.Matrix4, c: V2, rot: number, side: 1 | -1, y = 0) {
  const u = fromAngle(rot);
  const away = right(u);
  return faceMatrix(out, c, { x: -away.x * side, y: -away.y * side }, y);
}

/** Model matrix with the model's front (+z) facing the unit direction f, origin at p. */
export function faceMatrix(out: THREE.Matrix4, p: V2, f: V2, y = 0) {
  out.makeBasis(new THREE.Vector3(f.y, 0, -f.x), new THREE.Vector3(0, 1, 0), new THREE.Vector3(f.x, 0, f.y));
  out.setPosition(p.x, y, p.y);
  return out;
}

/** Where a car goes in and out of a lot: the kerb, the end of the driveway, the way into the lot, and its empty bays. */
export interface LotWay {
  kerb: V2;
  drive: V2;
  into: V2; // unit, from the road into the lot
  h: number;
  bays: { p: V2; dir: V2 }[]; // empty parking bays: centre, and where a parked car's nose points
  /** a car park behind the building: the end of the alley down the side of it, where cars turn in to the bays */
  via?: V2;
}

/** A bay a static parked car fills (the rest are free for cars that come and go). */
const bayTaken = (b: Building, k: number) => (((b.id * 73856093) ^ (k * 19349663)) >>> 0) % 10 >= 4;

/** How the car that keeps a bay stands in it (carlook.parkedStance), as a matrix in the car's own space. */
function parkedHow(look: number, out: THREE.Matrix4): THREE.Matrix4 {
  const s = parkedStance(look);
  return out.makeRotationY(s.yaw).setPosition(s.across, 0, s.along);
}

/** How far out from the kerb a car stands that has pulled up at a front of the street wall (m). */
const KERB_STOP = 1.3;

/**
 * How far behind its lot's front line a model stands (m), on a lot with this much depth to spare around it: hardly
 * at all. Its front garden is the front strip before the lot (config ZONE_SETBACK) and its model's own front yard;
 * the depth to spare is its back garden, so a street of homes stands along its street, not lost behind it.
 */
const setback = (spare: number) => Math.min(spare * 0.68, 1.2);

const SITE = 0xb59d6a; // construction site: bare earth
/** A building getting its roof on: raw timber, brick and concrete before the paint. */
const RAW = 0xd6c6a4;
/** A lot's driveway off its middle (model x, m): a home's runs down the side to its garage. (A town building with
 * its yard behind it has an alley instead, where its model says: MergedModel.via.) */
const DRIVE_X: Partial<Record<string, number>> = { house: -4.0 };
/** Where a home's own walls start (model x, z): what stands left of or behind that is its garage and shed. */
const HOME_FOOT: Partial<Record<string, [number, number]>> = Object.fromEntries(TOWN_MODELS.house.map((m) => [m, [-1.9, -4.9]]));
/** Homes, shops and the small halls go up on a timber frame; blocks, towers and big halls on a steel skeleton. */
const TIMBER = new Set<string>(["house", "terrace", "highstreet", "shop", "fuelstation", "hamlethall", "villagehall"]);
/** ...up to this height (m): a five-storey tenement on a row-house lot is a steel and brick job. */
const TIMBER_TOP = 13;
/** Tints multiplied over a model's own colours, picked per building. */
/** (fresh, sun-warmed, sooty, rosy, cool: brick and paint a shade apart from the same model next door) */
// (never greener than it is red: the seasons' shader takes green for grass and leaves, and turns it in autumn)
const VARY = [0xffffff, 0xffffff, 0xf6eadc, 0xe4dcd6, 0xfbf3e6, 0xd9d6d4, 0xf4ecec, 0xe9e6e4, 0xf0e2d2, 0xe2dcd4, 0xffffff];
/** Ground of a grown lot: lawn for homes, paving for business. */
const YARD: Record<string, number> = { res: 0x99994f, com: 0xb3ae9b, ind: 0xaaa490, off: 0xb3ae9b };
/** A business paves this far behind its building (m); a lot with more than BACK_WILD m beyond that keeps it as grass. */
const BACK_YARD = 1.2, BACK_WILD = 4;
const ABANDONED = 0x77736b;
/** A town hall's square (src/render/civic.ts): lawn, stone paving laid in slabs with a darker border, a path of setts. */
const SQUARE_LAWN = 0x8f9a4c;
const SQUARE_PAVING = 0xc9c2ae;
const SQUARE_PATH = 0xd4ccb7;
/** Paving pattern per piece: slab size (m, 0 for none), border band (m). */
const PAVE_FIELD = [2, 1.4], PAVE_RECT = [1.4, 0.8], PAVE_PATH = [0.7, 0.4], PAVE_NONE = [0, 0];
/** A shop's apron, between its lot and the pavement: concrete flags a shade warmer than the pavement's. */
const APRON = 0xc2b9a1;
const PAVE_APRON = [1.2, 0.25];
/** The pavement before a front of the street wall, from its doors to the kerb: flagstones. */
const FORECOURT = 0xc9c2ae;
const PAVE_FORECOURT = [1.4, 0.8];
/** A court behind a front of the street wall has a tree for about every square of this side (m). */
const COURT_TREE = 9;
/** Front gardens: a hedge or picket fence comes in runs of this length (m; the Blender models), scaled to fit. */
const FRONT_RUN = 4;
/** The roads round a lot as last seen (Buildings3D.sidesOf): which, and each one's geometry then. */
interface SegDeps { c: V2; r: number; ids: number[]; geos: unknown[] }
/**
 * Past this many metres a pixel the garden hedges and picket fences are drawn as their far models (the same shapes in
 * a fifth of the faces: a picket is then a third of a pixel wide). A big town has some twenty thousand of them.
 */
export const STRIP_FAR_FROM = 0.2;
/** Near in, they are drawn by squares of the map this many metres a side, so only those on screen are drawn. */
const STRIP_CHUNK = 256;
/**
 * The buildings likewise: up to this many metres a pixel each model is drawn by squares of BUILD_CHUNK metres (only
 * the squares on screen, and in the sun's shadow box, are drawn: a few hundred of a big map's thousands of buildings);
 * farther out, as one mesh for the whole map, which is then nearly all in view and far fewer draw calls. (On a late
 * map, near in, the squares took a third to a half off the GPU's frame for a few hundred more draw calls; past about
 * this zoom the calls cost more than the squares left undrawn save.)
 */
export const BUILD_NEAR_TO = 0.55;
const BUILD_CHUNK = 512;
/** How far a corner lot's side, and a town square's edges, reach out to a kerb (m). */
const SIDE_REACH = 14, SQUARE_REACH = 16;

/** Paving seen from above: slabs in running bond with faint joints and a little tone each, a darker kerb band round. */
function pavingMaterial(): THREE.MeshLambertMaterial {
  const mat = new THREE.MeshLambertMaterial({ color: 0xffffff });
  mat.onBeforeCompile = (sh) => {
    sh.vertexShader = sh.vertexShader
      .replace("#include <common>", "#include <common>\nattribute vec2 aPat;\nvarying vec2 vLoc; varying vec2 vHalf; varying vec2 vPat;")
      .replace(
        "#include <begin_vertex>",
        `#include <begin_vertex>
  // the piece's own metres (its instance scales the unit quad)
  vec2 sz = vec2(length(instanceMatrix[0].xyz), length(instanceMatrix[2].xyz));
  vLoc = position.xz * sz; vHalf = sz * 0.5; vPat = aPat;`,
      );
    sh.fragmentShader = sh.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying vec2 vLoc; varying vec2 vHalf; varying vec2 vPat;")
      .replace(
        "#include <color_fragment>",
        `#include <color_fragment>
  if (vPat.x > 0.0) {
    vec2 fw = fwidth(vLoc) + 1e-5;
    vec2 q = vLoc / vPat.x;
    q.x += 0.5 * mod(floor(q.y + 0.5), 2.0);
    vec2 g = abs(fract(q + 0.5) - 0.5) * vPat.x; // metres to the nearest joint
    float near = 1.0 - smoothstep(vPat.x * 0.08, vPat.x * 0.25, max(fw.x, fw.y)); // joints fade out from afar
    float joint = max(1.0 - smoothstep(0.05, 0.05 + fw.x, g.x), 1.0 - smoothstep(0.05, 0.05 + fw.y, g.y)) * near;
    float tone = fract(sin(dot(floor(q + 0.5), vec2(12.9898, 78.233))) * 43758.5453);
    diffuseColor.rgb *= (1.0 - 0.12 * joint) * (1.0 + (tone - 0.5) * 0.06 * near);
    float edge = min(vHalf.x - abs(vLoc.x), vHalf.y - abs(vLoc.y));
    float band = 1.0 - smoothstep(vPat.y - fw.x, vPat.y + fw.x, edge);
    diffuseColor.rgb *= 1.0 - 0.2 * band;
  }`,
      );
  };
  return mat;
}

// industry sites: a galvanised fence (the Blender "fence" model, its chain-link a see-through panel), worn concrete service roads, faint pads where the next buildings go
const FENCE_H = 2.1;
const POST_EVERY = 9;
const FENCE_MESH = 0x5d605d;
const SERVICE_ROAD = 0x85847c;
const PAD = 0xd9d2b8;

/**
 * One model drawn for a building: a whole zoned building, or one slot of a company site. `m`: its matrix as laid out
 * by the last rebuild (worked out once there, for the meshes, the lights and the parked cars); `nm`, `ni`: the mesh of
 * its square of the map that draws it near in (BUILD_NEAR_TO), and its place in it.
 */
interface Piece { b: Building; model: string; slot: SiteSlot | null; m?: THREE.Matrix4; nm?: THREE.InstancedMesh; ni?: number }

/** Flat and upright quads gathered into one geometry (fences, service roads, pads: one draw call for every site). */
class Quads {
  pos: number[] = [];
  nrm: number[] = [];
  private quad(ps: number[][], n: number[]) {
    const [a, b, c, d] = ps, P = this.pos, N = this.nrm;
    for (const p of [a, b, c, a, c, d]) { P.push(p[0], p[1], p[2]); N.push(n[0], n[1], n[2]); }
  }
  /** A flat strip from a to b, w wide, at height y. */
  strip(a: V2, b: V2, w: number, y: number) {
    const L = Math.hypot(b.x - a.x, b.y - a.y);
    if (L < 1e-3) return;
    const nx = (-(b.y - a.y) / L) * (w / 2), ny = ((b.x - a.x) / L) * (w / 2);
    this.flat([{ x: a.x + nx, y: a.y + ny }, { x: b.x + nx, y: b.y + ny }, { x: b.x - nx, y: b.y - ny }, { x: a.x - nx, y: a.y - ny }], y);
  }
  /** A flat quad through four corners (either winding; it faces up). */
  flat(c: V2[], y: number) {
    const cross = (c[1].x - c[0].x) * (c[2].y - c[0].y) - (c[1].y - c[0].y) * (c[2].x - c[0].x);
    const q = cross > 0 ? c : [c[0], c[3], c[2], c[1]];
    // three.js: x right, z toward the viewer; a quad counter-clockwise seen from above has z = map y, so flip
    this.quad([[q[0].x, y, q[0].y], [q[3].x, y, q[3].y], [q[2].x, y, q[2].y], [q[1].x, y, q[1].y]], [0, 1, 0]);
  }
  /** An upright quad from a to b, y0 to y1 (seen from both sides). */
  wall(a: V2, b: V2, y0: number, y1: number) {
    const L = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    this.quad([[a.x, y0, a.y], [b.x, y0, b.y], [b.x, y1, b.y], [a.x, y1, a.y]], [-(b.y - a.y) / L, 0, (b.x - a.x) / L]);
  }
  mesh(mat: THREE.Material, order: number): THREE.Mesh | null {
    if (!this.pos.length) return null;
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute("normal", new THREE.Float32BufferAttribute(this.nrm, 3));
    g.computeBoundingSphere();
    const m = new THREE.Mesh(g, mat);
    m.renderOrder = order;
    return m;
  }
}

/** The front strips laid out (render/buildings3d.ts stripsPlan): what commitStrips draws. */
interface StripPlan {
  /** the strips' lawns, paving, hedges and fences, made ahead and not yet shown (the hedges' and fences' near or far: userData.lod) */
  meshes: THREE.InstancedMesh[];
  trees: PlantedTree[];
}

/** A model's pieces, made into meshes ahead and not yet shown: the whole map's, and one by square of the map. */
interface ModelPlan {
  model: string;
  ps: Piece[];
  mesh: THREE.InstancedMesh;
  squares: { ps: Piece[]; nm: THREE.InstancedMesh }[];
}

const _sph = new THREE.Sphere(), _mat = new THREE.Matrix4();
/** The sphere round every copy of a model placed by the matrices arr[from..to): the one InstancedMesh.computeBoundingSphere finds, worked out ahead, off the mesh. */
function sphereOf(geo: THREE.BufferGeometry, arr: Float32Array, from = 0, to = arr.length / 16): THREE.Sphere {
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const out = new THREE.Sphere().makeEmpty();
  for (let i = from; i < to; i++) out.union(_sph.copy(geo.boundingSphere!).applyMatrix4(_mat.fromArray(arr, i * 16)));
  return out;
}

/** The sphere round a set of spheres. */
function sphereAround(xs: THREE.Sphere[]): THREE.Sphere {
  const out = new THREE.Sphere().makeEmpty();
  for (const x of xs) out.union(x);
  return out;
}

export class Buildings3D {
  readonly group = new THREE.Group();
  private meshes = new Map<string, THREE.InstancedMesh>();
  /** The same buildings by squares of the map, drawn instead near in (see BUILD_NEAR_TO). */
  private nearMeshes: THREE.InstancedMesh[] = [];
  private nearOn = true;
  private yards: THREE.InstancedMesh | null = null;
  private yardMat = seasonal(new THREE.MeshLambertMaterial({ color: 0xffffff }));
  /** Town hall squares: their paving, and their trees. */
  private paving: THREE.InstancedMesh | null = null;
  private paveMat = seasonal(pavingMaterial(), { shelter: 0.3 });
  /** The trees on the halls' squares and in front gardens (the 3D trees draw them, render/trees3d.ts), and a count of
   * how often either list changed. */
  squareTrees: PlantedTree[] = [];
  stripTrees: PlantedTree[] = [];
  treeVersion = 0;
  private yardGeo = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
  private drives: THREE.Mesh | null = null;
  /** The front strips' lawns, aprons, hedges, fences and trees (rebuilt with the driveways, on any road edit). */
  private strips: THREE.Object3D[] = [];
  private siteParts: THREE.Object3D[] = [];
  /** Every model, under the season (snow on its roofs, its lawns and trees in the season's colours). */
  private mat = seasonal(new THREE.MeshLambertMaterial({ vertexColors: true }), { roofs: true, windows: true });
  private driveMat = new THREE.MeshLambertMaterial({ color: PAL.driveway });
  private roadMat = new THREE.MeshLambertMaterial({ color: SERVICE_ROAD });
  private meshMat = new THREE.MeshLambertMaterial({ color: FENCE_MESH, transparent: true, opacity: 0.42, side: THREE.DoubleSide, depthWrite: false });
  private padMat = new THREE.MeshLambertMaterial({ color: PAD, transparent: true, opacity: 0.22, depthWrite: false });
  private order = new Map<string, Piece[]>();
  private layouts = new Map<number, { key: string; L: SiteLayout }>();
  private tmp = new THREE.Matrix4();
  private tmp2 = new THREE.Matrix4();
  private col = new THREE.Color();
  private v3 = new THREE.Vector3();
  private tintFn: ((b: Building) => number | null) | null = null;
  /** Pieces still going up: zoned buildings under construction, and a site's newest buildings after it grows. */
  private building: { p: Piece; i: number; fin?: boolean }[] = [];

  /**
   * `clock` gives the sim time (a site's new buildings rise for a while after it grows); `net`, the roads the front
   * strips run out to.
   */
  constructor(private models: ModelSet, private clock: () => number = () => 0, private net: RoadNetwork | null = null) {
    this.con = new Construction3D(models, this.mat, (p, dir, len) => this.roadOut(p, dir, len));
    this.group.add(this.con.group);
    this.piles = new Stockpiles3D(models, this.mat);
    this.group.add(this.piles.group);
  }
  /** The stakes, slabs, frames, walls, scaffolds, piles, cranes and trucks of everything going up. */
  private con: Construction3D;
  /** The heaps and log stacks in the works' yards, and the works that have yards (set on rebuild). */
  private piles: Stockpiles3D;
  private yardSites: Building[] = [];
  /** each works' yards as last drawn: its fills (quantized) and their piles, to redo only a works whose stores moved on */
  private yardCache = new Map<number, { key: string; jobs: YardJob[] }>();
  private yardTick = 0;

  /** Every yard's piles, as full as its works' stores; null when none has moved on since they were last drawn. */
  private yardJobs(force: boolean): YardJob[] | null {
    // (stores move on a load at a time: once a second is plenty)
    if (!force && this.yardTick++ % 4) return null;
    if (force) this.yardCache.clear();
    let moved = force;
    const jobs: YardJob[] = [];
    const live = new Set<number>();
    for (const b of this.yardSites) {
      live.add(b.id);
      const level = b.plant?.level ?? 1;
      const slots = this.layoutOf(b).slots.filter((s) => s.level <= level);
      const fills = pileFills(b, slots.map((s) => s.model));
      // (a yard still going up has nothing in it yet)
      const q = slots.map((s, i) => (fills[i] && this.riseOf(b, s) >= 1 ? fills[i]!.map((u) => Math.round(u * 12) / 12) : null));
      const key = q.map((f) => (f ? f.join(" ") : "-")).join("|");
      let c = this.yardCache.get(b.id);
      if (!c || c.key !== key) {
        const f = siteFrame(b.c, b.rot, b.side, b.hd);
        const js: YardJob[] = [];
        slots.forEach((s, i) => {
          const fl = q[i];
          if (fl) js.push({ model: s.model, base: this.slotMatrix(new THREE.Matrix4(), f, s, 1), fills: fl, seed: b.id + i });
        });
        this.yardCache.set(b.id, (c = { key, jobs: js }));
        moved = true;
      }
      jobs.push(...c.jobs);
    }
    for (const id of this.yardCache.keys()) if (!live.has(id)) { this.yardCache.delete(id); moved = true; }
    return moved ? jobs : null;
  }

  /** The time whose season the fields show (the day cycle's: the title menu and the dev hook can show another). */
  seasonClock: (() => number) | null = null;
  /** At night: every lit building's windows, and the works' floodlight masts (laid out with the buildings). */
  windows: WindowSpot[] = [];
  floods: LampSpot[] = [];
  /** Counts up whenever the buildings are laid out again. */
  version = 0;
  /** The boxes each building's models fill (walls and roof), by building id: what a click through the tilted view hits. */
  private solids = new Map<number, Solid[]>();

  /** The boxes a building's models fill, as it stands now (none while it is a bare building site). */
  solidsOf = (b: Building): readonly Solid[] | undefined => this.solids.get(b.id);

  /** How high a building stands (m): its tallest model's roof; 0 for bare ground. For what is pinned over it. */
  topOf(b: Building): number {
    let top = 0;
    for (const s of this.solids.get(b.id) ?? []) if (s.tall > top) top = s.tall;
    return top;
  }
  /** Where the buildings smoke, steam and raise dust (render/smoke.ts draws the plumes), laid out with them. */
  emitters: FxEmitter[] = [];
  /** Each model's footprint above the ground floor's sill (model space; x0, x1, z0, z1, top), measured once. */
  private feet = new Map<string, [number, number, number, number, number] | null>();

  private geoOf(name: string): MergedModel | undefined {
    return this.models.buildings.get(name as BuildingKind) ?? this.models.sites.get(name);
  }

  /** The plan of a company site (cached; it only depends on the kind, the plot and the id). */
  layoutOf(b: Building): SiteLayout {
    const key = `${b.kind}:${b.hw}:${b.hd}`;
    const got = this.layouts.get(b.id);
    if (got?.key === key) return got.L;
    const L = siteLayout(b.kind as PlantKind, b.hw * 2, b.hd * 2, b.id);
    this.layouts.set(b.id, { key, L });
    return L;
  }

  /** A town hall's square: its lawns, paving, path and trees, for the hall standing on it. */
  squareOf(b: Building): SquarePlan {
    const bb = this.models.buildings.get(b.kind)?.geo.boundingBox;
    const fp = bb ? { x0: bb.min.x, x1: bb.max.x, z0: bb.min.z, z1: bb.max.z } : { x0: -10, x1: 10, z0: -9, z1: 9 };
    // the path runs from the door (the model's front, +z) to the kerb in front of the square
    const inv = lotMatrix(this.tmp, b.c, b.rot, b.side, 0).invert();
    const k = this.v3.set(b.front.x, 0, b.front.y).applyMatrix4(inv);
    return squarePlan(HALL_TIER[b.kind] ?? 0, b.hw, fp, { x: 0, z: fp.z1 }, { x: k.x, z: k.z }, b.id);
  }

  /** Models and matrices for a building that isn't placed yet (the placement ghost): a site shows its first level. */
  ghost(kind: BuildingKind, c: V2, rot: number, side: 1 | -1, seed = 0): { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[] {
    const T = BUILDING_TYPES[kind];
    if (T.zone !== "placed") {
      const mm = this.geoOf(kind);
      return mm ? [{ geo: mm.geo, m: lotMatrix(new THREE.Matrix4(), c, rot, side, 0.1) }] : [];
    }
    const f = siteFrame(c, rot, side, T.d / 2);
    const L = siteLayout(kind as PlantKind, T.w, T.d, seed);
    const out: { geo: THREE.BufferGeometry; m: THREE.Matrix4 }[] = [];
    for (const s of L.slots) {
      const mm = s.level <= 1 ? this.geoOf(slotModel(null, s.model, this.seasonClock?.() ?? this.clock(), 3)) : undefined;
      if (mm) out.push({ geo: mm.geo, m: this.slotMatrix(new THREE.Matrix4(), f, s, 1, 0.1) });
    }
    return out;
  }

  /** Model depth (m) after fitting the lot. */
  private depth(b: Building): number {
    const mm = this.geoOf(b.kind)!;
    const bb = mm.geo.boundingBox!;
    return (bb.max.z - bb.min.z) * b.fit;
  }

  /** Half the depth of a building's model as it stands (unfitted). */
  private halfDepth(b: Building): number {
    const bb = this.geoOf(b.kind)?.geo.boundingBox;
    return bb ? (bb.max.z - bb.min.z) / 2 : b.hd;
  }

  private slotMatrix(out: THREE.Matrix4, f: SiteFrame, s: SiteSlot, rise: number, y = 0): THREE.Matrix4 {
    // (nothing of the model shows till its roof goes on: the construction pieces stand in for it)
    if (rise <= 0) return out.makeScale(0, 0, 0);
    faceMatrix(out, siteToWorld(f, s.x, s.y), siteDir(f, s.fx, s.fy), y);
    if (rise < 1) out.multiply(this.tmp2.makeScale(1, rise, 1));
    return out;
  }

  /** How far a piece's building has got (0..1; 1: standing): its own build, or a site's newest level going up. */
  private progressOf(p: Piece): number {
    const b = p.b;
    // (a landmark is drawn by its stage models instead: its site stands at full height from the start)
    if (isMega(b.kind)) return 1;
    if (b.built < 1) return b.built;
    const P = b.plant;
    if (!p.slot || !P || p.slot.level !== P.level || P.level <= 1) return 1;
    return Math.min(1, Math.max(0, (this.clock() - P.upAt) / GROW_ANIM));
  }

  /** The construction step a piece is at (see game/construction.ts). */
  private stageOfPiece(p: Piece): StageInfo {
    const b = p.b;
    if (b.built < 1 && !isMega(b.kind)) return stageOf(b);
    return stageAt(this.progressOf(p));
  }

  /**
   * How far a piece's model has gone up (1: standing). A building is drawn by its construction pieces till the roof
   * goes on (0: hidden); a flat piece of a site (its truck yard) comes up out of the bare earth as before.
   */
  private rise(p: Piece): number {
    const prog = this.progressOf(p);
    if (prog >= 1) return 1;
    if (this.footOf(p.model)) {
      const st = this.stageOfPiece(p);
      return st.stage === "roof" ? 0.9 + 0.1 * st.k : st.stage === "done" ? 1 : 0;
    }
    const k = Math.max(0, prog);
    return 0.06 + 0.94 * k * k * (3 - 2 * k);
  }

  /** Full matrix of a piece: a zoned building fitted to its lot and set back from the road; a site's slot. */
  private matrix(out: THREE.Matrix4, p: Piece): THREE.Matrix4 {
    const b = p.b;
    if (p.slot) return this.slotMatrix(out, siteFrame(b.c, b.rot, b.side, b.hd), p.slot, this.rise(p));
    const grow = this.rise(p);
    if (grow <= 0) return out.makeScale(0, 0, 0);
    lotMatrix(out, b.c, b.rot, b.side);
    if (!b.zone) {
      // a town hall, or a civic building, goes up from its building site like the town's other buildings
      if (grow < 1) out.multiply(this.tmp2.makeScale(1, grow, 1));
      return out;
    }
    // the model stands near the street; deep lots keep the rest as a back yard
    this.tmp2.makeScale(b.fit, b.fit * b.tall * grow, b.fit).setPosition(0, 0, this.zOf(b));
    return out.multiply(this.tmp2);
  }

  /** A piece's matrix once it stands at its full height (whatever it is at now). */
  private standMatrix(out: THREE.Matrix4, p: Piece): THREE.Matrix4 {
    const b = p.b;
    if (p.slot) return this.slotMatrix(out, siteFrame(b.c, b.rot, b.side, b.hd), p.slot, 1);
    lotMatrix(out, b.c, b.rot, b.side);
    if (!b.zone) return out;
    this.tmp2.makeScale(b.fit, b.fit * b.tall, b.fit).setPosition(0, 0, this.zOf(b));
    return out.multiply(this.tmp2);
  }

  /**
   * A model of the street wall, if this building is drawn with one (townmodels.ts WALL_MODELS): it then stands with
   * its front wall on the lot's front line, as wide as the lot, wall to wall with its neighbours.
   */
  private wallOf(b: Building): MergedModel | undefined {
    if (!b.wall || !b.zone) return undefined;
    const mm = this.geoOf(this.modelOf(b));
    return mm?.body && this.walled.has(b.id) ? mm : undefined;
  }
  /** the buildings drawn with a wall model (modelOf) */
  private walled = new Set<number>();

  /**
   * Where a zoned building's model stands on its lot (lot z of its middle): near the street, a deep lot keeping the
   * rest as a back yard; a front of the street wall, its front wall on the lot's front line.
   */
  private zOf(b: Building): number {
    const w = this.wallOf(b);
    if (w) return b.hd - w.body![3] * b.fit;
    const spare = Math.max(0, b.hd * 2 - this.depth(b));
    return spare / 2 - this.setbackOf(b, spare);
  }

  /** How deep a zoned building's lot is in use (m, from its front line): the model, its front yard and its own yard. */
  private usedDepth(b: Building): number {
    const w = this.wallOf(b);
    if (w) return (w.body![3] - w.geo.boundingBox!.min.z) * b.fit;
    const spare = Math.max(0, b.hd * 2 - this.depth(b));
    return b.hd * 2 - spare + this.setbackOf(b, spare) + BACK_YARD;
  }

  /** How deep the garden behind a building is (m, from its back wall to the lot's back line). */
  private lotBack(b: Building): number {
    if (!this.geoOf(b.kind)) return 0;
    const spare = Math.max(0, b.hd * 2 - this.depth(b));
    return Math.max(0, spare - this.setbackOf(b, spare));
  }

  /** Which side of a lot a side street passes (-1: its left, lot -x; 1: its right; 0: neither), for corner buildings. */
  private cornerOf(b: Building): -1 | 0 | 1 {
    if (!b.access) return 0;
    const toward = scale(right(fromAngle(b.rot)), -b.side);
    const e = this.sidesOf(b, { x: toward.y, y: -toward.x }, b.hw - 0.4);
    return e[1] > 0.2 ? -1 : e[0] > 0.2 ? 1 : 0;
  }

  private baseColor(b: Building): number | null {
    if (b.abandoned) return ABANDONED;
    // a street of the same model shouldn't look stamped: weathering and paint vary a little from one to the next
    return VARY[(Math.imul(b.id, 2654435761) >>> 20) % VARY.length];
  }

  /**
   * The model a zoned building is drawn with: the one of its kind's models made for a lot and a height nearest its
   * own (render/townmodels.ts), so its doors and storeys stand at their true size; among equals, by its id, but not
   * the one a building of its kind near it already has.
   */
  private modelOf(b: Building): string {
    if (!b.zone || !TOWN_MODELS[b.kind]) return b.kind;
    // (a front of the street wall: a model made for a lot of its width; a corner building where a side street passes)
    const corner = b.wall ? this.cornerOf(b) : 0;
    const got = this.picked.get(b.id);
    if (got && got.kind === b.kind && got.fit === b.fit && got.tall === b.tall && got.corner === corner) return got.model;
    const design = (m: string) => this.geoOf(m)?.design;
    let choices = b.wall ? wallChoices(b.kind, b.fit, b.tall, b.id, corner, design).filter((m) => this.geoOf(m)?.body) : [];
    if (choices.length) this.walled.add(b.id);
    else {
      this.walled.delete(b.id);
      choices = townChoices(b.kind, b.fit, b.tall, b.id, design).filter((m) => this.geoOf(m));
    }
    const model = choices.length ? this.variety.pick(b.id, b.kind, b.c.x, b.c.y, Math.max(44, b.hw * 7), choices) : b.kind;
    this.picked.set(b.id, { kind: b.kind, fit: b.fit, tall: b.tall, corner, model });
    return model;
  }
  private picked = new Map<number, { kind: string; fit: number; tall: number; corner: number; model: string }>();
  private variety = new Variety();

  /**
   * Where a town building's alley ends (model x, z): it stands on the pavement (owner, 2026-11-09: no car parks in
   * front), its yard and parking behind it down an alley beside it. Undefined: a home, a filling station, a hall.
   */
  private viaOf(b: Building): [number, number] | undefined {
    return b.zone && !this.wallOf(b) ? this.geoOf(this.modelOf(b))?.via : undefined;
  }

  /** A zoned building's front yard: none for one that stands on the pavement. */
  private setbackOf(b: Building, spare: number): number {
    return this.viaOf(b) ? 0 : setback(spare);
  }

  /** How far along the street (lot x, m) a lot's driveway runs from its middle (a home's down the side to its garage,
   * a town building's alley beside it). */
  private driveX(b: Building): number {
    return (this.viaOf(b)?.[0] ?? DRIVE_X[b.kind] ?? 0) * (b.zone ? b.fit : 1);
  }

  /** Where a lot's driveway meets the kerb (a home's off to the side, toward its garage): verge trees and lamps keep clear. */
  driveFront(b: Building): V2 {
    const dx = this.driveX(b);
    if (!dx) return b.front;
    const away = right(fromAngle(b.rot));
    return { x: b.front.x - away.y * b.side * dx, y: b.front.y + away.x * b.side * dx };
  }

  /**
   * How far toward the road from a lot's middle its driveway strip ends: placed buildings at the lot edge; zoned
   * lots start at the kerb, so to the model's front (a home's own driveway runs from there, so a little into it); a
   * town hall, across its square to its door.
   */
  private reachOf(b: Building): number {
    if (!b.zone) return isHall(b.kind) ? this.halfDepth(b) : b.hd;
    if (this.wallOf(b)) return b.hd;
    return b.hd - this.setbackOf(b, Math.max(0, b.hd * 2 - this.depth(b))) + (DRIVE_X[b.kind] !== undefined || this.viaOf(b) ? -0.3 : 0.5);
  }

  /** The pieces a building is drawn with: one model, or a site's buildings up to its level. */
  private piecesOf(b: Building): Piece[] {
    if (!b.placed || !b.plant) return [{ b, model: this.modelOf(b), slot: null }];
    const level = b.plant.level ?? 1;
    const now = this.seasonClock?.() ?? this.clock();
    return this.layoutOf(b).slots.filter((s) => s.level <= level).map((s) => ({ b, model: slotModel(b, s.model, now), slot: s }));
  }

  // ---------------------------------------------------------------- laying out, all at once or a slice a frame
  //
  // A late town has thousands of buildings, and laying them all out takes some 80 ms: done whenever one finished,
  // the game hitched every few seconds (review 2026-11-10, B12). So the sim's changes are laid out in slices, a few
  // ms a frame (rebuildSoon, work): the layout as it was stays drawn, and the new one goes in whole, in one frame,
  // when it is ready. The player's own edits and a loaded game are laid out at once (rebuild).

  /** The layout under way in slices, whether it is only the driveways and strips, and the one asked for next. */
  private job: Generator<void, void> | null = null;
  private jobDrives = false;
  private due: { list: Building[]; drives: boolean } | null = null;
  /** When this frame's slice must stop (performance.now ms; Infinity: laying out at once). */
  private until = Infinity;
  private steps = 0;
  /** Time this slice stopped (checked every few steps). */
  private late(): boolean {
    return (++this.steps & 15) === 0 && performance.now() > this.until;
  }

  /** Lay every building out now (a loaded game, the player's own edit). Drops a layout under way in slices. */
  rebuild(list: Building[]) {
    this.job = null;
    this.due = null;
    this.run(this.layout(list));
  }

  /** The driveways and front strips again now (the roads changed). */
  rebuildDrives(list: Building[]) {
    // (a whole layout under way lays them out from the roads as they were: it goes in, then they are done again)
    if (this.job && !this.jobDrives && !this.due) this.due = { list, drives: true };
    this.run(this.drivesJob(list));
  }

  /**
   * Lay out again over the next frames (work): the whole layout, or only the driveways and strips. Asked again while
   * one is under way, the newest list is laid out after it.
   */
  rebuildSoon(list: Building[], drivesOnly = false) {
    this.due = { list, drives: drivesOnly && (!this.due || this.due.drives) };
  }

  /** A layout is under way, or waiting to start. */
  get busy(): boolean {
    return !!this.job || !!this.due;
  }

  /**
   * Carry the layout under way on for about `ms` milliseconds. True on the frame a new layout went in (its lights,
   * emitters and trees may have changed: version and treeVersion have moved on).
   */
  work(ms: number): boolean {
    if (!this.job && this.due) {
      const d = this.due;
      this.due = null;
      this.jobDrives = d.drives;
      // (a copy: the sim's list changes under a layout spread over several frames)
      this.job = d.drives ? this.drivesJob(d.list.slice()) : this.layout(d.list.slice());
    }
    if (!this.job) return false;
    this.until = performance.now() + ms;
    const r = this.job.next();
    this.until = Infinity;
    if (!r.done) return false;
    this.job = null;
    return true;
  }

  private run(g: Generator<void, void>) {
    const was = this.until;
    this.until = Infinity;
    try { while (!g.next().done); } finally { this.until = was; }
  }

  private *layout(list: Building[]): Generator<void, void> {
    const live = new Set(list.map((b) => b.id));
    for (const id of this.layouts.keys()) if (!live.has(id)) this.layouts.delete(id);
    for (const id of this.picked.keys()) if (!live.has(id)) { this.picked.delete(id); this.walled.delete(id); this.variety.drop(id); }
    // every building's pieces (models), and where each stack and vent will smoke
    const order = new Map<string, Piece[]>();
    const emitters: FxEmitter[] = [];
    const tmp = new THREE.Matrix4(), v3 = new THREE.Vector3();
    for (const b of list) {
      if (this.late()) yield;
      for (const p of this.piecesOf(b)) {
        const mm = this.geoOf(p.model);
        if (!mm) continue;
        let a = order.get(p.model);
        if (!a) order.set(p.model, (a = []));
        a.push(p);
        // its stacks and vents, where they will stand once it is up
        if (!mm.fx.length || isMega(b.kind)) continue;
        this.standMatrix(tmp, p);
        const up = () => b.built >= 1 && this.rise(p) >= 1;
        for (const f of mm.fx) {
          const w = v3.set(f.x, f.y, f.z).applyMatrix4(tmp);
          emitters.push({ b, kind: f.kind, x: w.x, y: w.z, h: w.y, size: f.size * (b.zone ? b.fit : 1), up });
        }
      }
    }
    // each piece's matrix
    for (const ps of order.values()) {
      for (const p of ps) {
        if (this.late()) yield;
        p.m = this.matrix(new THREE.Matrix4(), p);
      }
    }
    // the lots' lawns and the halls' squares, then the driveways and front strips
    const ground = this.groundOf(list);
    if (this.late()) yield;
    const drives = yield* this.drivesPlan(list);
    // every model's meshes, made now and shown at the commit: the whole map's, and again by squares of the map for
    // near in (only those on screen drawn)
    const plans: ModelPlan[] = [];
    const meshOf = (geo: THREE.BufferGeometry, ps: Piece[], near: boolean) => {
      const m = new THREE.InstancedMesh(geo, this.mat, ps.length);
      m.castShadow = true;
      m.receiveShadow = true;
      if (near) m.userData.near = true;
      const arr = m.instanceMatrix.array as Float32Array;
      ps.forEach((p, i) => p.m!.toArray(arr, i * 16));
      return m;
    };
    for (const [model, ps] of order) {
      if (this.late()) yield;
      const mm = this.geoOf(model)!;
      const bySquare = new Map<number, Piece[]>();
      for (const p of ps) {
        const k = (Math.floor(p.b.c.x / BUILD_CHUNK) + 4096) * 8192 + Math.floor(p.b.c.y / BUILD_CHUNK) + 4096;
        const a = bySquare.get(k);
        if (a) a.push(p);
        else bySquare.set(k, [p]);
      }
      const squares = [...bySquare.values()].map((sq) => {
        const nm = meshOf(mm.geo, sq, true);
        nm.boundingSphere = sphereOf(mm.geo, nm.instanceMatrix.array as Float32Array);
        return { ps: sq, nm };
      });
      const mesh = meshOf(mm.geo, ps, false);
      mesh.userData.model = model;
      mesh.boundingSphere = sphereAround(squares.map((q) => q.nm.boundingSphere!));
      plans.push({ model, ps, mesh, squares });
    }
    // ---- and in it all goes: the buildings and their lots in one frame, their driveways and gardens the next
    this.commitGround(ground);
    this.drop([...this.meshes.values(), ...this.nearMeshes]);
    this.meshes.clear();
    this.nearMeshes = [];
    this.order = order;
    this.emitters = emitters;
    this.building = [];
    for (const { model, ps, mesh, squares } of plans) {
      ps.forEach((p, i) => { if (this.rise(p) < 1 || p.b.built < 1) this.building.push({ p, i }); });
      mesh.visible = !this.nearOn;
      this.meshes.set(model, mesh);
      this.group.add(mesh);
      for (const { ps: sq, nm } of squares) {
        sq.forEach((p, i) => { p.nm = nm; p.ni = i; });
        nm.visible = this.nearOn;
        this.nearMeshes.push(nm);
        this.group.add(nm);
      }
    }
    this.applyColors();
    this.lights(list);
    this.parked();
    this.rebuildSites(list);
    yield;
    this.commitDrives(drives);
    // what is built, for the roadside furniture to keep off (render/furniture.ts): every lot and works site
    let sig = list.length;
    for (const b of list) sig = (Math.imul(sig, 31) + b.id) | 0;
    LOTS.set("buildings", list.map((b) => rectCorners(b.c, b.hw, b.hd, b.rot)), sig);
    this.yardSites = list.filter((b) => b.placed && b.plant && this.layoutOf(b).slots.some((s) => YARDS[s.model]));
    this.piles.update(this.yardJobs(true)!);
  }

  /** The lots' yards and the town halls' squares: their lawns, their paving, and the squares' trees. */
  private groundOf(list: Building[]) {
    const tmp = new THREE.Matrix4(), v3 = new THREE.Vector3();
    const lawn: { m: THREE.Matrix4; c: number }[] = [];
    const pave: { m: THREE.Matrix4; c: number; pat: number[] }[] = [];
    const trees: PlantedTree[] = [];
    const sc = new THREE.Matrix4(), rt = new THREE.Matrix4();
    for (const b of list) {
      if (!b.zone) continue;
      lotMatrix(tmp, b.c, b.rot, b.side, 0.04);
      // the lot is hw along the road and hd deep; in lot space x runs along the road
      const home = ZONE_GROUP[b.zone] === "res";
      // a business paves its lot edge to edge (two side by side share one yard, with no strip of grass between),
      // but only as far back as it is built: a deep lot's back is left to the grass, not an empty paved field
      const edge = home ? 0.8 : 0;
      const used = home || (b.built < 1 && !b.wall) ? b.hd * 2 : this.usedDepth(b);
      // (a front of the street wall too: a short yard behind it, then its court is grass with a tree or two)
      const deep = used < b.hd * 2 - BACK_WILD ? used : b.hd * 2;
      lawn.push({ m: tmp.clone().multiply(sc.makeScale(b.hw * 2 - edge, 1, deep - edge).setPosition(0, 0, b.hd - deep / 2)), c: b.built < 1 ? SITE : YARD[ZONE_GROUP[b.zone]] });
    }
    // a hall's square: lawn and paving to the pavements, its path to the hall's door, its trees (bare earth, and no
    // trees yet, while the hall is being built)
    for (const b of list) {
      if (!isHall(b.kind)) continue;
      const plan = this.squareOf(b);
      const site = b.built < 1;
      const H = b.hw - 0.4;
      const pieces = [{ x: 0, z: 0, w: H * 2, d: H * 2, rot: 0, kind: plan.base, y: 0.04 }, ...plan.rects.map((r) => ({ ...r, y: r.kind === "path" ? 0.07 : 0.06 }))];
      pieces.forEach((r, k) => {
        lotMatrix(tmp, b.c, b.rot, b.side, r.y);
        tmp.multiply(rt.makeRotationY(r.rot).setPosition(r.x, 0, r.z)).multiply(sc.makeScale(r.w, 1, r.d));
        if (r.kind === "lawn") { lawn.push({ m: tmp.clone(), c: site ? SITE : SQUARE_LAWN }); return; }
        const bare = site && r.kind !== "path";
        const p = bare ? PAVE_NONE : r.kind === "path" ? PAVE_PATH : k === 0 ? PAVE_FIELD : PAVE_RECT;
        pave.push({ m: tmp.clone(), c: bare ? SITE : r.kind === "path" ? SQUARE_PATH : SQUARE_PAVING, pat: p });
      });
      if (site) continue;
      lotMatrix(tmp, b.c, b.rot, b.side, 0);
      for (const t of plan.trees) {
        const w = v3.set(t.x, 0, t.z).applyMatrix4(tmp);
        trees.push({ x: w.x, y: w.z, r: t.r, style: "park" });
      }
    }
    return { lawn, pave, trees };
  }

  /** The lots' and squares' ground in (and the old taken out). */
  private commitGround(G: ReturnType<Buildings3D["groundOf"]>) {
    if (this.yards) { this.group.remove(this.yards); this.yards.dispose(); this.yards = null; }
    if (this.paving) { this.group.remove(this.paving); this.paving.geometry.dispose(); this.paving.dispose(); this.paving = null; }
    if (G.lawn.length) {
      const ym = new THREE.InstancedMesh(this.yardGeo, this.yardMat, G.lawn.length);
      ym.receiveShadow = true;
      ym.renderOrder = 1;
      G.lawn.forEach((q, i) => { ym.setMatrixAt(i, q.m); ym.setColorAt(i, this.col.setHex(q.c)); });
      ym.computeBoundingSphere();
      this.yards = ym;
      this.group.add(ym);
    }
    if (G.pave.length) {
      const pm = new THREE.InstancedMesh(this.yardGeo.clone(), this.paveMat, G.pave.length);
      const pat = new THREE.InstancedBufferAttribute(new Float32Array(G.pave.length * 2), 2);
      pm.geometry.setAttribute("aPat", pat);
      G.pave.forEach((q, i) => { pm.setMatrixAt(i, q.m); pm.setColorAt(i, this.col.setHex(q.c)); pat.setXY(i, q.pat[0], q.pat[1]); });
      pm.receiveShadow = true;
      pm.renderOrder = 1;
      pm.computeBoundingSphere();
      this.paving = pm;
      this.group.add(pm);
    }
    this.squareTrees = G.trees;
    this.treeVersion++;
  }

  /**
   * Parked cars: a fixed share of the bays keep a car (it keeps its size whatever the model's scale), which is in or
   * out by the hour (render/parked3d.ts draws them); a site's truck yard stays free for its trucks.
   */
  private parked() {
    const slots: ParkSlot[] = [];
    const inv = new THREE.Matrix4(), jig = new THREE.Matrix4();
    for (const [model, ps] of this.order) {
      const mm = this.geoOf(model)!;
      if (!mm.bays.length) continue;
      for (const p of ps) {
        const b = p.b;
        if (b.built < 1 || b.abandoned || p.slot?.role === "yard" || this.rise(p) < 1) continue;
        const M = p.m ?? this.matrix(new THREE.Matrix4(), p);
        const s = b.zone ? b.fit : 1;
        const tall = b.zone ? b.tall : 1;
        inv.makeScale(1 / s, 1 / (s * tall), 1 / s);
        const home = BUILDING_TYPES[b.kind]?.zone === "res";
        mm.bays.forEach((bay, k) => {
          if (!bayTaken(b, k)) return; // ~60% keep a car
          const look = ((b.id * 73856093) ^ (k * 19349663)) >>> 3;
          slots.push({ m: M.clone().multiply(bay).multiply(inv).multiply(parkedHow(look, jig)), look, home });
        });
      }
    }
    setParked(slots);
    PARKED.hour = () => clockOf(this.seasonClock?.() ?? this.clock()).hour;
  }

  /** Fences, service roads and the pads of buildings to come, for every company site at once (a few draw calls). */
  /** A model's walls seen from above: the bounds of everything over 1.2 m (the lot's yard and parking excluded). */
  private footOf(model: string) {
    if (this.feet.has(model)) return this.feet.get(model)!;
    const mm = this.geoOf(model);
    // (a town model says where its building stands on its lot)
    if (mm?.body) {
      this.feet.set(model, mm.body);
      return mm.body;
    }
    const pos = mm?.geo.getAttribute("position");
    let f: [number, number, number, number, number] | null = null;
    // (a home's walls only: not its garage down the side, nor the shed in its back yard)
    const clip = HOME_FOOT[model];
    if (pos) {
      let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity, top = 0;
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i);
        if (y < 1.2) continue;
        const x = pos.getX(i), z = pos.getZ(i);
        if (clip && (x < clip[0] || z < clip[1])) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (z < z0) z0 = z;
        if (z > z1) z1 = z;
        if (y > top) top = y;
      }
      if (x1 > x0 && z1 > z0) f = [x0, x1, z0, z1, top];
    }
    this.feet.set(model, f);
    return f;
  }

  /** The night's lights the buildings give: windows round every finished home, shop, office and hall; floodlight masts round each works. */
  private lights(list: Building[]) {
    this.windows = [];
    this.floods = [];
    const c = new THREE.Vector3(), ax = new THREE.Vector3(), ay = new THREE.Vector3(), az = new THREE.Vector3();
    this.solids.clear();
    for (const [model, ps] of this.order) {
      const f = this.footOf(model);
      if (!f) continue;
      for (const p of ps) {
        const b = p.b;
        const M = p.m ?? this.matrix(this.tmp, p);
        M.extractBasis(ax, ay, az);
        const sx = ax.length(), sz = az.length(), tall = f[4] * ay.length();
        if (!(sx > 0 && sz > 0 && tall > 0.5)) continue;
        c.set((f[0] + f[1]) / 2, 0, (f[2] + f[3]) / 2).applyMatrix4(M);
        const box = { x: c.x, y: c.z, ux: ax.x / sx, uy: ax.z / sx, hx: ((f[1] - f[0]) / 2) * sx, hz: ((f[3] - f[2]) / 2) * sz, tall };
        // (what it fills, for clicks and for whatever is pinned over its roof)
        const list = this.solids.get(b.id);
        if (list) list.push(box);
        else this.solids.set(b.id, [box]);
        if (p.slot || b.built < 1 || b.abandoned) continue;
        const kind = windowKind(b);
        if (kind) this.windows.push({ ...box, kind, seed: b.id });
      }
    }
    for (const b of list) {
      // (a farm works by daylight: no masts over its fields)
      if (!b.placed || !b.plant || b.built < 1 || b.kind === "farm") continue;
      const fr = siteFrame(b.c, b.rot, b.side, b.hd);
      const hw = b.hw, d = b.hd * 2, inset = 3;
      // the yard as built so far (a young works stands in a corner of its fence: the masts light that, not the
      // empty ground it will grow into)
      let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
      for (const pc of this.piecesOf(b)) {
        const s = pc.slot;
        if (!s) continue;
        const r = Math.max(s.w, s.d) / 2 + 7;
        x0 = Math.min(x0, s.x - r); x1 = Math.max(x1, s.x + r);
        y0 = Math.min(y0, s.y - r); y1 = Math.max(y1, s.y + r);
      }
      if (!(x1 > x0)) continue;
      x0 = Math.max(x0, -hw + inset); x1 = Math.min(x1, hw - inset);
      y0 = Math.max(y0, inset); y1 = Math.min(y1, d - inset);
      const mid = siteToWorld(fr, (x0 + x1) / 2, (y0 + y1) / 2);
      // (each mast throws about half way across a small yard, never more than a big one's 24 m)
      const r = Math.max(11, Math.min(24, Math.min(x1 - x0, y1 - y0) * 0.42));
      // a mast at each corner of it, and more along a long side, about every 60 m
      const spots: V2[] = [];
      const nx = Math.max(1, Math.round((x1 - x0) / 60)), ny = Math.max(1, Math.round((y1 - y0) / 60));
      for (let k = 0; k < nx; k++) {
        spots.push(siteToWorld(fr, x0 + ((x1 - x0) * k) / nx, y0));
        spots.push(siteToWorld(fr, x1 - ((x1 - x0) * k) / nx, y1));
      }
      for (let k = 0; k < ny; k++) {
        spots.push(siteToWorld(fr, x1, y0 + ((y1 - y0) * k) / ny));
        spots.push(siteToWorld(fr, x0, y1 - ((y1 - y0) * k) / ny));
      }
      for (const s of spots) {
        const dx = mid.x - s.x, dy = mid.y - s.y, l = Math.hypot(dx, dy) || 1;
        this.floods.push({ x: s.x, y: s.y, h: 0, dx: dx / l, dy: dy / l, kind: "flood", r });
      }
    }
    this.version++;
  }

  private rebuildSites(list: Building[]) {
    for (const o of this.siteParts) {
      this.group.remove(o);
      if (o instanceof THREE.InstancedMesh) { o.dispose(); continue; }
      if (o instanceof THREE.Mesh) o.geometry.dispose();
    }
    this.siteParts = [];
    const sites = list.filter((b) => b.placed && b.plant);
    if (!sites.length) return;
    const mesh = new Quads(), roads = new Quads(), pads = new Quads();
    // the fence's posts, rails and kerb: the Blender "fence" model, one 9 m bay at a time
    const bays: THREE.Matrix4[] = [];
    const yaw = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
    for (const b of sites) {
      const f = siteFrame(b.c, b.rot, b.side, b.hd);
      const L = this.layoutOf(b);
      const level = b.plant!.level ?? 1;
      const W = (x: number, y: number) => siteToWorld(f, x, y);
      // the fence: round the plot, open at the gate
      const hw = b.hw, d = b.hd * 2, g = GATE_GAP / 2;
      const runs: [number, number, number, number][] = [
        [-g, 0, -hw, 0], [-hw, 0, -hw, d], [-hw, d, hw, d], [hw, d, hw, 0], [hw, 0, g, 0],
      ];
      for (const [x0, y0, x1, y1] of runs) {
        const a = W(x0, y0), e = W(x1, y1);
        mesh.wall(a, e, 0.28, FENCE_H - 0.1);
        const len = Math.hypot(e.x - a.x, e.y - a.y), n = Math.max(1, Math.round(len / POST_EVERY));
        yaw.setFromAxisAngle(up, -Math.atan2(e.y - a.y, e.x - a.x));
        for (let k = 0; k < n; k++) {
          const m = { x: a.x + ((e.x - a.x) * (k + 0.5)) / n, y: a.y + ((e.y - a.y) * (k + 0.5)) / n };
          bays.push(new THREE.Matrix4().compose(new THREE.Vector3(m.x, 0, m.y), yaw, new THREE.Vector3(len / n / POST_EVERY, 1, 1)));
        }
      }
      // service roads: built as far as the buildings they serve; the rest is still a faint pad
      const built = L.slots.filter((s) => s.level <= level);
      const served = (r: SiteLayout["roads"][number]) => built.some((s) => {
        const { hy } = slotHalf(s);
        return Math.abs(s.y - r.a.y) <= r.w / 2 + 2.5 + hy * 2 && Math.abs(r.a.y - r.b.y) < 0.1;
      });
      const branches = L.roads.slice(1);
      let reach = 0;
      for (const r of branches) {
        const on = served(r);
        (on ? roads : pads).strip(W(r.a.x, r.a.y), W(r.b.x, r.b.y), r.w, on ? 0.07 : 0.05);
        if (on) reach = Math.max(reach, r.a.y + r.w / 2);
      }
      const spine = L.roads[0];
      if (spine) {
        // (from the road outside the gate, through the gate, as far as the last road in use)
        const core = Math.max(...L.slots.filter((s) => s.role).map((s) => s.y + slotHalf(s).hy));
        const end = Math.min(spine.b.y, Math.max(reach, core));
        roads.strip(W(0, -0.5), W(0, end), spine.w, 0.07);
        if (end < spine.b.y) pads.strip(W(0, end), W(0, spine.b.y), spine.w, 0.05);
      }
      // the pads of the buildings to come
      for (const s of L.slots) {
        if (s.level <= level && this.riseOf(b, s) >= 1) continue;
        const { hx, hy } = slotHalf(s);
        pads.flat([W(s.x - hx, s.y - hy), W(s.x + hx, s.y - hy), W(s.x + hx, s.y + hy), W(s.x - hx, s.y + hy)], 0.05);
      }
    }
    const parts = [
      mesh.mesh(this.meshMat, 7),
      roads.mesh(this.roadMat, 3),
      pads.mesh(this.padMat, 2),
    ];
    for (const m of parts) {
      if (!m) continue;
      m.receiveShadow = true;
      this.siteParts.push(m);
      this.group.add(m);
    }
    const fence = this.models.props.get("fence");
    if (fence && bays.length) {
      const fm = new THREE.InstancedMesh(fence.geo, this.mat, bays.length);
      fm.castShadow = true;
      bays.forEach((m, i) => fm.setMatrixAt(i, m));
      fm.computeBoundingSphere();
      this.siteParts.push(fm);
      this.group.add(fm);
    }
  }

  /** How far a site's slot has gone up. */
  private riseOf(b: Building, s: SiteSlot): number {
    return this.rise({ b, model: s.model, slot: s });
  }

  /**
   * Raise buildings under construction (cheap; call a few times a second). True when a site's new building has just
   * finished rising: its pad and parked cars need a rebuild.
   */
  updateConstruction(): boolean {
    const jobs: ConJob[] = [];
    for (const it of this.building) {
      const j = this.jobOf(it.p);
      if (j) jobs.push(j);
    }
    this.con.update(jobs, this.clock());
    const yards = this.yardJobs(false);
    if (yards) this.piles.update(yards);
    if (!this.building.length) return false;
    let done = false;
    const touched = new Set<THREE.InstancedMesh>();
    const still: { p: Piece; i: number; fin?: boolean }[] = [];
    const regrow = new Set<THREE.InstancedMesh>();
    for (const it of this.building) {
      const mesh = this.meshes.get(it.p.model);
      if (!mesh) continue;
      const M = this.matrix(this.tmp, it.p), c = this.colorOf(it.p);
      mesh.setMatrixAt(it.i, M);
      mesh.setColorAt(it.i, c);
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
      touched.add(mesh);
      const nm = it.p.nm;
      if (nm) {
        nm.setMatrixAt(it.p.ni!, M);
        nm.setColorAt(it.p.ni!, c);
        if (nm.instanceColor) nm.instanceColor.needsUpdate = true;
        touched.add(nm);
        // (a square's mesh is culled by its bounds: a building going up grows out of the ones it had. Once more
        // when it is up, then not again while it waits on the list for the next rebuild)
        if (!it.fin) regrow.add(nm);
        it.fin = this.rise(it.p) >= 1 && it.p.b.built >= 1;
      }
      // (zoned buildings stay on the list till the next rebuild: they finish with a change of colour)
      if (it.p.b.built < 1 || this.rise(it.p) < 1 || !it.p.slot) still.push(it);
      else done = true;
    }
    this.building = still;
    for (const m of touched) m.instanceMatrix.needsUpdate = true;
    for (const m of regrow) m.computeBoundingSphere();
    return done;
  }

  /** How cars get into and out of this building's lot (a site's: through the gate to its truck yard). */
  lotWay(b: Building): LotWay {
    if (b.placed && b.plant) return this.siteWay(b);
    const u = fromAngle(b.rot);
    const away = right(u);
    const into = { x: away.x * b.side, y: away.y * b.side };
    if (this.wallOf(b)) {
      // a front of the street wall has no driveway: its customers and its deliveries pull up at the kerb before it,
      // along the street the way its traffic runs
      const go = scale(u, b.side);
      const kerb = { x: b.front.x - into.x * KERB_STOP, y: b.front.y - into.y * KERB_STOP };
      return { kerb, drive: add(kerb, scale(go, 2.1)), into: go, h: 0, bays: [] };
    }
    const reach = this.reachOf(b);
    // (a home's driveway runs down the side of its lot: the way in shifts along the street with it)
    const dx = this.driveX(b), al = { x: -into.y * dx, y: into.x * dx };
    const drive = { x: b.c.x - into.x * reach + al.x, y: b.c.y - into.y * reach + al.y };
    const kerb = { x: b.front.x + al.x, y: b.front.y + al.y };
    const bays: LotWay["bays"] = [];
    const model = this.modelOf(b);
    const mm = this.geoOf(model);
    let via: V2 | undefined;
    if (mm?.bays.length && b.built >= 1 && !b.abandoned) {
      const M = this.matrix(new THREE.Matrix4(), { b, model, slot: null });
      const s = b.zone ? b.fit : 1;
      const inv = new THREE.Matrix4().makeScale(1 / s, 1 / (s * (b.zone ? b.tall : 1)), 1 / s);
      const W = new THREE.Matrix4();
      mm.bays.forEach((bay, k) => {
        if (bayTaken(b, k)) return;
        const e = W.copy(M).multiply(bay).multiply(inv).elements;
        const L = Math.hypot(e[8], e[10]) || 1;
        bays.push({ p: { x: e[12], y: e[14] }, dir: { x: e[8] / L, y: e[10] / L } });
      });
      const rear = this.viaOf(b);
      if (rear) {
        const v = this.v3.set(rear[0], 0, rear[1]).applyMatrix4(M);
        via = { x: v.x, y: v.z };
      }
    }
    return { kerb, drive, into, h: 0, bays, via };
  }

  private siteWay(b: Building): LotWay {
    const f = siteFrame(b.c, b.rot, b.side, b.hd);
    const bays: LotWay["bays"] = [];
    const W = new THREE.Matrix4();
    for (const s of this.layoutOf(b).slots) {
      if (!s.role) continue;
      const mm = this.geoOf(s.model);
      if (!mm?.bays.length) continue;
      const M = this.slotMatrix(new THREE.Matrix4(), f, s, 1);
      mm.bays.forEach((bay, k) => {
        // (the plant's own car park keeps some cars parked; the truck yard is free)
        if (s.role === "core" && bayTaken(b, k)) return;
        const e = W.copy(M).multiply(bay).elements;
        const L = Math.hypot(e[8], e[10]) || 1;
        bays.push({ p: { x: e[12], y: e[14] }, dir: { x: e[8] / L, y: e[10] / L } });
      });
    }
    return { kerb: { ...b.front }, drive: add(f.gate, scale(f.into, 6)), into: f.into, h: 0, bays };
  }

  /** The driveways and front strips, laid out in slices, then in. */
  private *drivesJob(list: Building[]): Generator<void, void> {
    const plan = yield* this.drivesPlan(list);
    this.commitDrives(plan);
  }

  /** What the driveways and front strips will be (nothing drawn yet). */
  private *drivesPlan(list: Building[]) {
    const q = new Quads();
    for (const b of list) {
      if (this.late()) yield;
      if (b.placed && b.plant) {
        // a site: from the road's edge to its gate, as wide as its spine road (none till a road reaches it)
        if (!b.access) continue;
        const gate = siteFrame(b.c, b.rot, b.side, b.hd).gate;
        if (Math.hypot(gate.x - b.front.x, gate.y - b.front.y) < 0.6) continue;
        q.strip(b.front, gate, 7, 0.08);
        continue;
      }
      if (isHall(b.kind) || isCivic(b.kind)) continue; // a hall's path is its square's (rebuild); a civic building's, its apron's
      if (this.wallOf(b)) continue; // a front of the street wall stands on the pavement: no driveway
      const u = fromAngle(b.rot);
      const away = right(u); // * side points away from the road
      const reach = this.reachOf(b);
      // (a home's down the side of its lot, to its garage)
      const dx = this.driveX(b), al = { x: -away.y * b.side * dx, y: away.x * b.side * dx };
      const ex = { x: b.c.x - away.x * b.side * reach + al.x, y: b.c.y - away.y * b.side * reach + al.y };
      const a = { x: b.front.x + al.x, y: b.front.y + al.y };
      if (Math.hypot(ex.x - a.x, ex.y - a.y) < 0.6) continue;
      const w = isHall(b.kind) ? 2.4 : b.zone && b.hw > 14 ? 2.6 : 1.7;
      q.strip(a, ex, w * 2, 0.08);
    }
    const strips = yield* this.stripsPlan(list);
    return { drive: q.mesh(this.driveMat, 3), strips };
  }

  /** The driveways and front strips in (and the old taken out). */
  /** Takes many meshes out of the group at once (one by one, each would search a thousand children) and frees them. */
  private drop(xs: THREE.Object3D[]) {
    if (!xs.length) return;
    const gone = new Set(xs);
    this.group.children = this.group.children.filter((o) => !gone.has(o));
    for (const o of gone) {
      o.parent = null;
      o.dispatchEvent({ type: "removed" });
      if (o instanceof THREE.InstancedMesh) o.dispose();
    }
  }

  private commitDrives(plan: { drive: ReturnType<Quads["mesh"]>; strips: StripPlan }) {
    if (this.drives) { this.group.remove(this.drives); this.drives.geometry.dispose(); this.drives = null; }
    const m = plan.drive;
    if (m) {
      m.receiveShadow = true;
      this.drives = m;
      this.group.add(m);
    }
    this.commitStrips(plan.strips);
  }

  /**
   * The front strips (config ZONE_SETBACK): the ground between each home, shop and town square and its kerb. A home
   * has its lawn out to the pavement, many a hedge or a white picket fence along the pavement (open at the driveway)
   * and some a tree; a shop, office or filling station a paved apron; a town square its paving or lawn, and its path
   * on to the kerb. A corner lot's side runs on to the side street's pavement too. Drawn under the pavements and
   * roads, so a road widened over the strip simply covers it: the lawn narrows, and hedges and trees that no longer
   * fit go.
   */
  private *stripsPlan(list: Building[]): Generator<void, StripPlan> {
    const lawns: { m: THREE.Matrix4; c: number }[] = [];
    const paved: { m: THREE.Matrix4; c: number; pat: number[] }[] = [];
    const props: Record<"hedge" | "picket", THREE.Matrix4[]> = { hedge: [], picket: [] };
    // (the back gardens' are drawn apart, casting no shadow: behind the house it would hardly show, and they are many)
    const backs: Record<"hedge" | "picket", THREE.Matrix4[]> = { hedge: [], picket: [] };
    const trees: PlantedTree[] = [];
    const L = new THREE.Matrix4(), T = new THREE.Matrix4(), S = new THREE.Matrix4(), R = new THREE.Matrix4().makeRotationY(Math.PI / 2);
    /** A rect in a lot's frame (x along the road, z toward it), at height y (turned rot about its centre). */
    const rect = (b: Building, x0: number, x1: number, z0: number, z1: number, y: number, rot = 0) =>
      lotMatrix(L, b.c, b.rot, b.side, y).clone()
        .multiply(T.makeRotationY(rot).setPosition((x0 + x1) / 2, 0, (z0 + z1) / 2))
        .multiply(S.makeScale(Math.abs(x1 - x0), 1, Math.abs(z1 - z0)));
    for (const b of list) {
      if (this.late()) yield;
      if (!b.access || !(b.zone || isHall(b.kind) || isCivic(b.kind))) continue;
      const toward = scale(right(fromAngle(b.rot)), -b.side);
      const along = { x: toward.y, y: -toward.x };
      const rel = { x: b.front.x - b.c.x, y: b.front.y - b.c.y };
      // (xd: where the driveway crosses the strip, along the street from the lot's middle)
      const kd = dot(rel, toward), xd = dot(rel, along) + this.driveX(b);
      const pave = this.paveOf(b.access.seg);
      if (isHall(b.kind)) { this.squareStrip(b, kd, toward, along, rect, lawns, paved); continue; }
      const grp = ZONE_GROUP[b.zone!];
      const home = grp === "res";
      const site = b.built < 1;
      // (a front of the street wall: the pavement runs from its doors to the kerb, the whole width of the lot, and
      // is there before the building is)
      const wall = !!this.wallOf(b);
      const H = b.hw - 0.4, z0 = wall ? b.hd - 0.05 : b.hd - 0.4, Hs = wall ? b.hw : H;
      // the strip itself: lawn (or a construction site's bare earth) for a home, a paved apron for business
      const put = (m: THREE.Matrix4) => {
        if (wall) paved.push({ m, c: FORECOURT, pat: PAVE_FORECOURT });
        else if (home || site) lawns.push({ m, c: site ? SITE : YARD.res });
        else paved.push({ m, c: APRON, pat: PAVE_APRON });
      };
      if (kd - z0 > 0.2) put(rect(b, -Hs, Hs, z0, kd, 0.04));
      // a corner lot: its side on to the side street's kerb (a hair lower, so a neighbour's lot or strip wins)
      const sides = this.sidesOf(b, along, H);
      for (const [s, e] of [[1, sides[0]], [-1, sides[1]]] as const) if (e > 0.2) put(rect(b, s * Hs, s * (H + e), wall ? -b.hd : -z0, kd, 0.03));
      if (wall && !site) {
        // behind a front of the street wall, the rest of a deep lot is its court: a tree or two stand in it
        const back = b.hd * 2 - this.usedDepth(b);
        const nz = Math.floor((back - 2) / COURT_TREE), nx = Math.max(1, Math.floor((b.hw * 2 - 2) / COURT_TREE));
        lotMatrix(L, b.c, b.rot, b.side, 0);
        for (let i = 0; i < nx; i++) for (let j = 0; j < nz; j++) {
          const hh = Math.imul(b.id * 31 + i * 7 + j * 13 + 5, 2654435761) >>> 0;
          if (hh % 10 >= 6) continue;
          const x = -b.hw + ((i + 0.5) * b.hw * 2) / nx + (((hh >>> 8) % 100) / 100 - 0.5) * 2.4;
          const z = -b.hd + ((j + 0.5) * back) / nz + (((hh >>> 16) % 100) / 100 - 0.5) * 2.4;
          const w = this.v3.set(x, 0, z).applyMatrix4(L);
          trees.push({ x: w.x, y: w.z, r: 1.7 + ((hh >>> 4) % 10) * 0.12, style: "park" });
        }
      }
      if (!home || site || b.abandoned) continue;
      // the front garden: from the lot's edge to the back of the pavement
      const garden = kd - pave - b.hd;
      const h = Math.imul(b.id, 2654435761) >>> 0;
      const small = b.zone === "resLow" || b.zone === "resRow";
      const pick = h % 10;
      // (most front gardens are fenced or hedged along the pavement; the rest are open lawn)
      const kind = small ? (pick < 4 ? "picket" : pick < 8 ? "hedge" : null) : pick < 7 ? "hedge" : null;
      const dw = b.hw > 14 ? 2.6 : 1.7;
      if (kind && garden > (kind === "hedge" ? 1.0 : 0.6)) {
        const z = kd - pave - (kind === "hedge" ? 0.5 : 0.25);
        // along the pavement, open where the driveway crosses it
        const runs = [[-H - 0.2, xd - dw - 0.5], [xd + dw + 0.5, H + 0.2]];
        for (const [a, e] of runs) {
          const len = e - a;
          if (len < 1) continue;
          const n = Math.max(1, Math.round(len / FRONT_RUN));
          for (let k = 0; k < n; k++) {
            const x = a + ((k + 0.5) * len) / n;
            props[kind].push(lotMatrix(L, b.c, b.rot, b.side, 0).clone().multiply(T.makeTranslation(x, 0, z)).multiply(S.makeScale(len / n / FRONT_RUN, 1, 1)));
          }
        }
      }
      // a tree in a deep enough front lawn, clear of the driveway (on the roomier side of it)
      // (its crown clear of the hedge or fence, which stand taller than it is drawn)
      const lawn = garden - (kind ? 1 : 0);
      const r = Math.min(lawn / 2 - 0.2, 1.7 + ((h >>> 12) % 8) * 0.1);
      const off = dw + r + 0.6;
      const x = Math.abs(xd - off) <= Math.abs(xd + off) ? xd - off : xd + off;
      if (lawn >= 3.6 && ((h >>> 8) % 10) < 6 && Math.abs(x) <= H - r * 0.5) {
        const w = this.v3.set(x, 0, b.hd + lawn / 2 - 0.3).applyMatrix4(lotMatrix(L, b.c, b.rot, b.side, 0));
        trees.push({ x: w.x, y: w.z, r, style: "park" });
      }
      // the back garden: most are hedged or fenced across the lot some way behind the house (so a block's middle reads
      // as rows of gardens, not one lawn; a deep lot's far end is left to the field), and one deep enough has a tree
      // or two in it
      const backLen = this.lotBack(b);
      const gd = Math.min(backLen, 7 + ((h >>> 20) % 5));
      const zf = -b.hd + backLen - gd;
      const bk = small ? ((h >>> 16) % 10 < 5 ? "hedge" : (h >>> 16) % 10 < 8 ? "picket" : null) : (h >>> 16) % 10 < 6 ? "hedge" : null;
      if (bk && backLen >= 3) {
        // (in runs twice as long as a front's: seen past the house, it need not be as fine, and it is half the pieces)
        const len = H * 2, n = Math.max(1, Math.round(len / (2 * FRONT_RUN))), z = zf + (bk === "hedge" ? 0.6 : 0.3);
        for (let k = 0; k < n; k++) {
          const x = -H + ((k + 0.5) * len) / n;
          backs[bk].push(lotMatrix(L, b.c, b.rot, b.side, 0).clone().multiply(T.makeTranslation(x, 0, z)).multiply(S.makeScale(len / n / FRONT_RUN, 1, 1)));
        }
        // and up its one side to the back of the house (the other side is the next lot's, so a row of them shares
        // one fence between each two gardens)
        const side = backLen - (zf - -b.hd) - (bk === "hedge" ? 0.6 : 0.3);
        if (side >= 2) {
          backs[bk].push(lotMatrix(L, b.c, b.rot, b.side, 0).clone().multiply(T.makeTranslation(-H, 0, z + side / 2)).multiply(R).multiply(S.makeScale(side / FRONT_RUN, 1, 1)));
        }
      }
      if (gd >= 4.5) {
        const nb = gd >= 9 && H > 5 ? 2 : 1;
        for (let k = 0; k < nb; k++) {
          const hh = Math.imul(b.id * 17 + k * 101 + 3, 2654435761) >>> 0;
          if (hh % 10 >= 7) continue;
          const rb = Math.min(gd / 2 - 0.4, 1.8 + ((hh >>> 8) % 8) * 0.12);
          if (rb < 1.2) continue;
          const span = Math.max(0, H - rb - 0.4);
          const x = nb === 1 ? (((hh >>> 4) % 100) / 100 - 0.5) * 2 * span : (k ? 1 : -1) * span * (0.4 + ((hh >>> 4) % 60) / 100);
          const zt = zf + (bk ? 1 : 0.4) + rb + ((hh >>> 12) % 100) / 100 * Math.max(0, gd - 2 * rb - 1.4);
          const w = this.v3.set(x, 0, zt).applyMatrix4(lotMatrix(L, b.c, b.rot, b.side, 0));
          trees.push({ x: w.x, y: w.z, r: rb, style: "park" });
        }
      }
    }
    if (this.sideCache.size > list.length + 64) {
      const live = new Set(list.map((b) => b.id));
      for (const id of this.sideCache.keys()) if (!live.has(id)) this.sideCache.delete(id);
    }
    yield;
    // and their meshes, made now and shown at the commit
    const meshes: THREE.InstancedMesh[] = [];
    if (lawns.length) {
      const m = new THREE.InstancedMesh(this.yardGeo, this.yardMat, lawns.length);
      lawns.forEach((q, i) => { m.setMatrixAt(i, q.m); m.setColorAt(i, this.col.setHex(q.c)); });
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.computeBoundingSphere();
      meshes.push(m);
    }
    if (paved.length) {
      const m = new THREE.InstancedMesh(this.yardGeo.clone(), this.paveMat, paved.length);
      m.userData.ownGeo = true;
      const pat = new THREE.InstancedBufferAttribute(new Float32Array(paved.length * 2), 2);
      m.geometry.setAttribute("aPat", pat);
      paved.forEach((q, i) => { m.setMatrixAt(i, q.m); m.setColorAt(i, this.col.setHex(q.c)); pat.setXY(i, q.pat[0], q.pat[1]); });
      m.receiveShadow = true;
      m.renderOrder = 1;
      m.computeBoundingSphere();
      meshes.push(m);
    }
    // the hedges and fences: near in, by squares of the map (only those on screen are drawn); farther out, every one
    // at once as its far model (lod). Sorted by their square and written out once: the far mesh takes them all, each
    // near one its square's run (each one's square and its place in the list packed into one number, and sorted as
    // plain numbers: a sort with a compare function took some 25 ms over a big map's hundred thousand)
    for (const kind of ["hedge", "picket"] as const) {
      const mm = this.models.props.get(kind), far = this.models.props.get(`${kind}_far`) ?? mm;
      if (!mm || !far) continue;
      // (bounded as the bigger of the two models)
      for (const g of [mm.geo, far.geo]) if (!g.boundingSphere) g.computeBoundingSphere();
      const geo = mm.geo.boundingSphere!.radius >= far.geo.boundingSphere!.radius ? mm.geo : far.geo;
      for (const [list, shadow] of [[props[kind], true], [backs[kind], false]] as const) {
        if (!list.length) continue;
        yield;
        const n = list.length, sh = 2 ** Math.ceil(Math.log2(n + 1)), packed = new Float64Array(n);
        for (let i = 0; i < n; i++) {
          const e = list[i].elements;
          packed[i] = ((Math.floor(e[12] / STRIP_CHUNK) + 4096) * 8192 + Math.floor(e[14] / STRIP_CHUNK) + 4096) * sh + i;
        }
        packed.sort();
        const all = new Float32Array(n * 16), cuts = [0];
        let last = -1;
        for (let i = 0; i < n; i++) {
          const v = packed[i], at = v % sh, key = (v - at) / sh;
          if (i && key !== last) cuts.push(i);
          last = key;
          list[at].toArray(all, i * 16);
        }
        cuts.push(n);
        const add = (g: THREE.BufferGeometry, from: number, to: number, lod: "near" | "far") => {
          const m = new THREE.InstancedMesh(g, this.mat, to - from);
          (m.instanceMatrix.array as Float32Array).set(all.subarray(from * 16, to * 16));
          m.castShadow = shadow;
          m.receiveShadow = true;
          m.userData.lod = lod;
          meshes.push(m);
          return m;
        };
        const spheres: THREE.Sphere[] = [];
        for (let r = 0; r + 1 < cuts.length; r++) {
          if (this.late()) yield;
          const m = add(mm.geo, cuts[r], cuts[r + 1], "near");
          spheres.push((m.boundingSphere = sphereOf(geo, all, cuts[r], cuts[r + 1])));
        }
        add(far.geo, 0, n, "far").boundingSphere = sphereAround(spheres);
      }
    }
    return { meshes, trees };
  }

  /** The front strips in (and the old taken out). */
  private commitStrips(P: StripPlan) {
    // (the paving's own copy of the plane goes with it; the hedge and fence models are shared, and stay)
    for (const o of this.strips) if (o.userData.ownGeo) (o as THREE.Mesh).geometry.dispose();
    this.drop(this.strips);
    this.strips = P.meshes;
    this.stripTrees = P.trees;
    this.treeVersion++;
    for (const m of this.strips) if (m.userData.lod) m.visible = (m.userData.lod === "far") === this.far;
    for (const o of this.strips) this.group.add(o);
  }

  /** Drawing the garden hedges and fences as their far models (past STRIP_FAR_FROM metres a pixel). */
  private far = false;

  /** Every frame: the garden hedges and fences near in or far off, by how many metres a pixel is. */
  lod(mpp: number) {
    const near = mpp <= BUILD_NEAR_TO;
    if (near !== this.nearOn) {
      this.nearOn = near;
      for (const m of this.meshes.values()) m.visible = !near;
      for (const m of this.nearMeshes) m.visible = near;
    }
    const far = mpp > STRIP_FAR_FROM;
    if (far === this.far) return;
    this.far = far;
    for (const o of this.strips) if (o.userData.lod) o.visible = (o.userData.lod === "far") === far;
  }

  /**
   * A town square's strip: its ground (lawn or paving) out to the kerbs of the streets round it, and its path on from
   * the square's edge to the kerb in front.
   */
  private squareStrip(
    b: Building, kd: number, toward: V2, along: V2,
    rect: (b: Building, x0: number, x1: number, z0: number, z1: number, y: number, rot?: number) => THREE.Matrix4,
    lawns: { m: THREE.Matrix4; c: number }[], paved: { m: THREE.Matrix4; c: number; pat: number[] }[],
  ) {
    const plan = this.squareOf(b);
    const site = b.built < 1;
    const H = b.hw - 0.4;
    const put = (m: THREE.Matrix4, kind: string, pat: number[]) => {
      if (kind === "lawn") lawns.push({ m, c: site ? SITE : SQUARE_LAWN });
      else paved.push({ m, c: site && kind !== "path" ? SITE : kind === "path" ? SQUARE_PATH : SQUARE_PAVING, pat: site && kind !== "path" ? PAVE_NONE : pat });
    };
    const out = (dir: V2) => {
      const e = this.kerbOut(add(b.c, scale(dir, H)), dir, SQUARE_REACH);
      return e !== null && e > 0.2 ? e : 0;
    };
    const eF = Math.max(out(toward), kd - H), eB = out(scale(toward, -1)), eR = out(along), eL = out(scale(along, -1));
    // (its slabs, without the border band: that stays round the square)
    const pat = [PAVE_FIELD[0], 0];
    if (eF > 0) put(rect(b, -H - eL, H + eR, H, H + eF, 0.04), plan.base, pat);
    if (eB > 0) put(rect(b, -H - eL, H + eR, -H - eB, -H, 0.04), plan.base, pat);
    if (eR > 0) put(rect(b, H, H + eR, -H, H, 0.04), plan.base, pat);
    if (eL > 0) put(rect(b, -H - eL, -H, -H, H, 0.04), plan.base, pat);
    // the path, on from where the square's ends to the kerb
    const p = plan.rects.find((r) => r.kind === "path");
    if (!p) return;
    const ex = p.x + (Math.sin(p.rot) * p.d) / 2, ez = p.z + (Math.cos(p.rot) * p.d) / 2;
    const kx = dot({ x: b.front.x - b.c.x, y: b.front.y - b.c.y }, along);
    const len = Math.hypot(kx - ex, kd - ez);
    if (len < 0.3) return;
    const m = lotMatrix(new THREE.Matrix4(), b.c, b.rot, b.side, 0.07)
      .multiply(new THREE.Matrix4().makeRotationY(Math.atan2(kx - ex, kd - ez)).setPosition((ex + kx) / 2, 0, (ez + kd) / 2))
      .multiply(new THREE.Matrix4().makeScale(p.w, 1, len));
    put(m, "path", PAVE_PATH);
  }

  /**
   * How far out a lot's two sides (+x, -x in its frame) reach a side street's kerb (0: none in reach). Kept until the
   * roads or the lot change: a growing town rebuilds its buildings often, its roads seldom.
   */
  private sidesOf(b: Building, along: V2, H: number): [number, number] {
    const net = this.net, v = net?.version ?? 0, seg = b.access?.seg ?? -1;
    const got = this.sideCache.get(b.id);
    if (got && got.x === b.c.x && got.y === b.c.y && got.rot === b.rot && got.H === H && got.seg === seg) {
      if (got.v === v) return got.e;
      // (the roads changed somewhere: still good if none near it did, as most of a big map's lots find after an edit)
      if (net && got.deps && this.depsHold(got.deps)) { got.v = v; return got.e; }
    }
    const e = [1, -1].map((s) => {
      const dir = scale(along, s);
      return this.kerbOut(add(b.c, scale(dir, H)), dir, SIDE_REACH, b.access?.seg) ?? 0;
    }) as [number, number];
    this.sideCache.set(b.id, { v, x: b.c.x, y: b.c.y, rot: b.rot, H, seg, e, deps: net ? this.depsNear(b.c, H) : null });
    return e;
  }
  private sideCache = new Map<number, { v: number; x: number; y: number; rot: number; H: number; seg: number; e: [number, number]; deps: SegDeps | null }>();

  /**
   * The roads kerbOut can see from both sides of a lot (H either way of c): their ids and their geometry as it is now
   * (the network replaces a road's geometry whenever the road changes, its type included).
   */
  private depsNear(c: V2, H: number): SegDeps {
    const net = this.net!, r = H + SIDE_REACH + 12;
    const ids = [...net.segsNear(c.x - r, c.y - r, c.x + r, c.y + r)];
    return { c: { x: c.x, y: c.y }, r, ids, geos: ids.map((id) => net.segGeom.get(id)) };
  }

  /** Whether the roads near a lot are just as they were. */
  private depsHold(d: SegDeps): boolean {
    const net = this.net!;
    const now = net.segsNear(d.c.x - d.r, d.c.y - d.r, d.c.x + d.r, d.c.y + d.r);
    if (now.size !== d.ids.length) return false;
    for (let i = 0; i < d.ids.length; i++) if (!now.has(d.ids[i]) || net.segGeom.get(d.ids[i]) !== d.geos[i]) return false;
    return true;
  }

  /**
   * The way on down the road from p (a point in a lane), heading dir: the centreline ahead, kept at p's distance from
   * it, on through each junction by the road that turns least (a dead end or a sharp turn stops it), out to len m.
   * The way a contractor's truck drives off (construction3d).
   */
  private roadOut(p: V2, dir: V2, len: number): { x: number; y: number; h: number }[] | null {
    const net = this.net;
    if (!net) return null;
    let seg = -1, k = 0, t = 0, d2 = 30 * 30;
    for (const id of net.segsNear(p.x - 30, p.y - 30, p.x + 30, p.y + 30)) {
      const g = net.segGeom.get(id);
      if (!g) continue;
      const pts = g.center.pts;
      for (let i = 0; i < pts.length - 1; i++) {
        const q = pointSegDist2(p, pts[i], pts[i + 1]);
        if (q.d2 < d2) { d2 = q.d2; seg = id; k = i; t = q.t; }
      }
    }
    if (seg < 0) return null;
    // the centreline from the nearest point on, the way it is heading
    const line: { x: number; y: number; h: number }[] = [];
    const g0 = net.segGeom.get(seg)!, c0 = g0.center.pts;
    const fwd = dot({ x: c0[k + 1].x - c0[k].x, y: c0[k + 1].y - c0[k].y }, dir) >= 0;
    line.push({ x: c0[k].x + (c0[k + 1].x - c0[k].x) * t, y: c0[k].y + (c0[k + 1].y - c0[k].y) * t, h: g0.hs[k] + (g0.hs[k + 1] - g0.hs[k]) * t });
    const run = (id: number, ahead: boolean, from: number) => {
      const g = net.segGeom.get(id)!, c = g.center.pts;
      if (ahead) for (let i = from; i < c.length; i++) line.push({ x: c[i].x, y: c[i].y, h: g.hs[i] });
      else for (let i = from; i >= 0; i--) line.push({ x: c[i].x, y: c[i].y, h: g.hs[i] });
    };
    run(seg, fwd, fwd ? k + 1 : k);
    let at = fwd ? net.segs.get(seg)!.b : net.segs.get(seg)!.a, cur = seg, L = 0;
    const length = () => {
      L = 0;
      for (let i = 1; i < line.length; i++) L += Math.hypot(line[i].x - line[i - 1].x, line[i].y - line[i - 1].y);
      return L;
    };
    for (let hops = 0; hops < 12 && length() < len; hops++) {
      const n = line.length, hd = { x: line[n - 1].x - line[n - 2].x, y: line[n - 1].y - line[n - 2].y };
      const hl = Math.hypot(hd.x, hd.y) || 1;
      let best = -1, bestDot = Math.cos(Math.PI / 3), ahead = true;
      for (const s of net.segsAt(at)) {
        if (s.id === cur) continue;
        const c = net.segGeom.get(s.id)?.center.pts;
        if (!c || c.length < 2) continue;
        const out = s.a === at;
        const q0 = out ? c[0] : c[c.length - 1], q1 = out ? c[1] : c[c.length - 2];
        const ql = Math.hypot(q1.x - q0.x, q1.y - q0.y) || 1;
        const cs = ((q1.x - q0.x) * hd.x + (q1.y - q0.y) * hd.y) / (ql * hl);
        if (cs > bestDot) { bestDot = cs; best = s.id; ahead = out; }
      }
      if (best < 0) break;
      const c = net.segGeom.get(best)!.center.pts;
      run(best, ahead, ahead ? 0 : c.length - 1);
      const s = net.segs.get(best)!;
      at = ahead ? s.b : s.a;
      cur = best;
    }
    // over to p's side, as far out as p is: the lane it is driving in
    const h0 = { x: line[1].x - line[0].x, y: line[1].y - line[0].y }, h0l = Math.hypot(h0.x, h0.y) || 1;
    const off = (h0.x * (p.y - line[0].y) - h0.y * (p.x - line[0].x)) / h0l;
    const out: { x: number; y: number; h: number }[] = [];
    for (let i = 0; i < line.length; i++) {
      const a = line[Math.max(0, i - 1)], b = line[Math.min(line.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, tl = Math.hypot(tx, ty);
      if (tl < 1e-6) continue;
      const q = { x: line[i].x - (ty / tl) * off, y: line[i].y + (tx / tl) * off, h: line[i].h };
      const last = out[out.length - 1];
      if (!last || Math.hypot(q.x - last.x, q.y - last.y) > 0.05) out.push(q);
    }
    // (starting where the truck is, and cut at len)
    out[0] = { x: p.x, y: p.y, h: out[0]?.h ?? 0 };
    let acc = 0;
    for (let i = 1; i < out.length; i++) {
      const d = Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
      if (acc + d >= len) { const u = (len - acc) / d; out[i] = { x: out[i - 1].x + (out[i].x - out[i - 1].x) * u, y: out[i - 1].y + (out[i].y - out[i - 1].y) * u, h: out[i].h }; out.length = i + 1; break; }
      acc += d;
    }
    return out.length >= 2 ? out : null;
  }

  /** The pavement's width beside a road (none for a road without one). */
  private paveOf(seg: number): number {
    const s = this.net?.segs.get(seg);
    return s ? SIDEWALK[roadGroup(ROAD_TYPES[s.type])] : 0;
  }

  /**
   * How far out from p, along the unit dir, the nearest kerb of a road with a pavement lies (within reach m;
   * null: none, or one that runs off to the side rather than across dir). `skip` is a road not to count.
   */
  private kerbOut(p: V2, dir: V2, reach: number, skip = -1): number | null {
    const net = this.net;
    if (!net) return null;
    let best: number | null = null;
    const r = reach + 12;
    for (const id of net.segsNear(p.x - r, p.y - r, p.x + r, p.y + r)) {
      if (id === skip) continue;
      const s = net.segs.get(id), g = net.segGeom.get(id);
      if (!s || !g || !SIDEWALK[roadGroup(ROAD_TYPES[s.type])]) continue;
      const pts = g.center.pts;
      let d2 = Infinity, k = 0, t = 0;
      for (let i = 0; i < pts.length - 1; i++) {
        const q = pointSegDist2(p, pts[i], pts[i + 1]);
        if (q.d2 < d2) { d2 = q.d2; k = i; t = q.t; }
      }
      if (g.hs[k] > 0.3) continue;
      const q = { x: pts[k].x + (pts[k + 1].x - pts[k].x) * t - p.x, y: pts[k].y + (pts[k + 1].y - pts[k].y) * t - p.y };
      const d = Math.sqrt(d2);
      if (d < 1e-3 || dot(q, dir) / d < 0.9) continue;
      const e = d - g.width / 2;
      if (e <= reach && (best === null || e < best)) best = e;
    }
    return best;
  }

  /**
   * A piece's colour: its building's tint. A building getting its roof on is still raw timber, brick and concrete,
   * its paint going on as the roof does; a flat piece of a site comes up from the bare earth.
   */
  private colorOf(p: Piece): THREE.Color {
    const c = this.tintFn?.(p.b) ?? this.baseColor(p.b);
    const out = c === null ? this.col.set(1, 1, 1) : this.col.setHex(c);
    const prog = this.progressOf(p);
    if (prog < 1) {
      if (this.footOf(p.model)) out.lerp(this.raw, 0.55 * (1 - this.stageOfPiece(p).k));
      else out.lerp(this.site, 1 - this.rise(p));
    }
    return out;
  }
  private site = new THREE.Color(SITE);
  private raw = new THREE.Color(RAW);

  /** A piece going up, for the construction pieces (null: a flat piece, or one that is up). */
  private jobOf(p: Piece): ConJob | null {
    const f = this.footOf(p.model);
    if (!f) return null;
    const stage = this.stageOfPiece(p);
    if (stage.stage === "done") return null;
    const b = p.b;
    const base = new THREE.Matrix4();
    let [x0, x1, z0, z1, top] = f;
    let room: ConJob["room"] = null;
    if (p.slot) this.slotMatrix(base, siteFrame(b.c, b.rot, b.side, b.hd), p.slot, 1);
    else {
      lotMatrix(base, b.c, b.rot, b.side);
      room = { x0: -b.hw, x1: b.hw, z0: -b.hd, z1: b.hd };
      if (b.zone) {
        const dz = this.zOf(b), s = b.fit;
        x0 *= s; x1 *= s; z0 = z0 * s + dz; z1 = z1 * s + dz; top *= s * b.tall;
      }
    }
    const timber = p.slot ? (PLANTS[b.kind as PlantKind]?.tier ?? 2) <= 1 && top < 12 : TIMBER.has(b.kind) && top < TIMBER_TOP;
    const id = p.slot ? `${b.id}:${p.slot.x.toFixed(1)},${p.slot.y.toFixed(1)}` : `${b.id}`;
    return { id, base, x0, x1, z0, z1, top, heavy: !timber, stage, seed: (Math.imul(b.id + 1, 2654435761) >>> 20) / 4096 + (p.slot ? p.slot.x * 0.13 : 0), room };
  }

  /** Let go of the construction pieces' and the yards' instance buffers (a new world is loaded). */
  disposeExtras() {
    this.con.dispose();
    this.piles.dispose();
  }

  /** The construction pieces' moving parts (trucks, cranes), every frame. */
  frameConstruction() {
    this.con.frame(this.clock());
  }

  private applyColors() {
    for (const [model, ps] of this.order) {
      const mesh = this.meshes.get(model)!;
      ps.forEach((p, i) => {
        const c = this.colorOf(p);
        mesh.setColorAt(i, c);
        p.nm?.setColorAt(p.ni!, c);
      });
      if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    }
    for (const m of this.nearMeshes) if (m.instanceColor) m.instanceColor.needsUpdate = true;
  }

  /** Tint buildings (overlays). null = normal colours. */
  tint(fn: ((b: Building) => number | null) | null) {
    this.tintFn = fn;
    this.applyColors();
  }
}
