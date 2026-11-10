// The vehicles of 1925-1940 (tools/blender/vehicles_*.py, render/carlook.ts, render/parked3d.ts): every kind the
// renderer draws has its model, made the way the renderer reads it; each model is exactly the footprint the sim
// drives (its length, its width, its origin, its axles), so nothing in the sim knows the fleet was rebuilt; a car's
// look and a parked car's hours are the same every time; and no bay stands a car on the road or in a wall.

import { describe, it, expect, beforeAll } from "vitest";
import * as THREE from "three";
import { BUILDING_TYPES, SIM, type BuildingKind } from "../src/config";
import { CONVOY_UNITS } from "../src/game/convoys";
import { HERALD_COLORS, HERALD_PAIRS } from "../src/game/company";
import { TRUCK_CLASSES } from "../src/game/trucks";
import { CAR_BODIES, CAR_KINDS, CAR_PAINTS, VAN_PAINTS, carLook, fleetLivery, parkedAt } from "../src/render/carlook";
import { BUILDING_MODELS, HOME_VARIANTS, PAINT_ROLES, SITE_PIECES, VEHICLE_MODELS, type VehicleKind } from "../src/render/models";
import { TOWN_MODELS } from "../src/render/townmodels";

// (node's fs, untyped here: the project's types are the browser's)
let readFileSync: (path: URL) => any;
beforeAll(async () => {
  const node = (m: string) => import(/* @vite-ignore */ m);
  ({ readFileSync } = await node("fs"));
});

interface Part { node: string; material: string; pos: Float32Array }
interface Glb { parts: Part[]; empties: { name: string; p: number[]; q: number[] }[] }
const cache = new Map<string, Glb>();
/** A model's triangles (three's axes: x across, y up, +z the front), by node and material, and its empties. */
function glb(model: string): Glb {
  const had = cache.get(model);
  if (had) return had;
  const buf = readFileSync(new URL(`../public/models/${model}.glb`, import.meta.url));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as {
    nodes: { name?: string; translation?: number[]; rotation?: number[]; scale?: number[]; mesh?: number }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices: number; material?: number }[] }[];
    accessors: { bufferView: number; byteOffset?: number; componentType: number; count: number }[];
    bufferViews: { byteOffset?: number; byteStride?: number }[];
    materials?: { name: string }[];
  };
  const bin = buf.subarray(20 + len + 8);
  const out: Glb = { parts: [], empties: [] };
  for (const n of json.nodes) {
    if (n.mesh === undefined) { out.empties.push({ name: n.name ?? "", p: n.translation ?? [0, 0, 0], q: n.rotation ?? [0, 0, 0, 1] }); continue; }
    // (a model's meshes sit at its origin, unturned)
    expect(n.translation ?? [0, 0, 0], model).toEqual([0, 0, 0]);
    expect(n.rotation ?? [0, 0, 0, 1], model).toEqual([0, 0, 0, 1]);
    for (const p of json.meshes[n.mesh].primitives) {
      const pa = json.accessors[p.attributes.POSITION], pv = json.bufferViews[pa.bufferView];
      const ia = json.accessors[p.indices], iv = json.bufferViews[ia.bufferView];
      const p0 = (pv.byteOffset ?? 0) + (pa.byteOffset ?? 0), stride = pv.byteStride ?? 12;
      const i0 = (iv.byteOffset ?? 0) + (ia.byteOffset ?? 0);
      const pos = new Float32Array(ia.count * 3);
      for (let i = 0; i < ia.count; i++) {
        const k = ia.componentType === 5125 ? bin.readUInt32LE(i0 + i * 4) : ia.componentType === 5123 ? bin.readUInt16LE(i0 + i * 2) : bin.readUInt8(i0 + i);
        for (let c = 0; c < 3; c++) pos[i * 3 + c] = bin.readFloatLE(p0 + k * stride + c * 4);
      }
      out.parts.push({ node: n.name ?? "", material: p.material === undefined ? "" : json.materials![p.material].name, pos });
    }
  }
  cache.set(model, out);
  return out;
}
const near = (g: Glb) => g.parts.filter((p) => p.node !== "far");
function bounds(parts: Part[]) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
  for (const p of parts) for (let i = 0; i < p.pos.length; i++) { min[i % 3] = Math.min(min[i % 3], p.pos[i]); max[i % 3] = Math.max(max[i % 3], p.pos[i]); }
  return { min, max };
}
const tris = (parts: Part[]) => parts.reduce((n, p) => n + p.pos.length / 9, 0);

const BODIES = ["truck", "tipper", "tanker", "flatbed", "reefer", "carrier"] as const;
const CARS: VehicleKind[] = [...CAR_BODIES, "van", "motorcar"];
/** The width each model has always had (m): the lanes, the bays and the lots were sized round them. */
const WIDTH: Record<string, number> = {
  car: 1.85, car_coupe: 1.85, car_tourer: 1.85, car_pickup: 1.85, van: 2, motorcar: 1.84, bus: 2.575, escort_car: 1.9,
  truck: 2.5, tipper: 2.7, tanker: 2.46, flatbed: 2.52, reefer: 2.58, carrier: 2.58,
  rt_tractor: 2.7, ll_tractor: 2.64, ll_trailer_turbine: 3.4, ll_trailer_girder: 2.5,
  rt_truck: 2.54, rt_tipper: 2.7, rt_tanker: 2.44, rt_flatbed: 2.52, rt_reefer: 2.58, rt_carrier: 2.58,
};
const widthOf = (k: string) => WIDTH[k] ?? (k.startsWith("heavy_") ? 2.7 : WIDTH[k.replace(/_[ab]$/, "")]);
/** The length the sim drives each model at (m). */
function lengthOf(k: string): number {
  const RT = TRUCK_CLASSES.roadtrain.units!;
  if (k === "rt_tractor") return RT[0].len;
  if (/^rt_.*_a$/.test(k)) return RT[1].len;
  if (/^rt_.*_b$/.test(k)) return RT[2].len;
  if (k.startsWith("heavy_")) return TRUCK_CLASSES.heavy.len;
  if (k === "escort_car") return CONVOY_UNITS[0].len;
  if (k === "ll_tractor") return CONVOY_UNITS[1].len;
  if (k.startsWith("ll_trailer")) return CONVOY_UNITS[2].len;
  if ((BODIES as readonly string[]).includes(k)) return SIM.truckLen;
  // (the van and the Motor Works car have always been drawn longer than the 4.4 m the sim keeps for every car, and
  // the bus 0.17 m longer than its 12 m: their models keep the lengths they had)
  return ({ van: 5, motorcar: 4.92, bus: 12.17 } as Record<string, number>)[k] ?? SIM.carLen;
}
/**
 * Where a model's axles are, front first (m behind its front bumper). A wheel is a drum with a flat on the ground:
 * the two ends of each axle's flat are the only tyre vertices down there, so they pair off, front to back.
 */
function axles(k: string): number[] {
  const g = glb(k), front = bounds(near(g)).max[2];
  const zs: number[] = [];
  for (const p of near(g)) if (p.material === "v_tyre") for (let i = 0; i < p.pos.length; i += 3) if (p.pos[i + 1] < 0.01) zs.push(front - p.pos[i + 2]);
  zs.sort((a, b) => a - b);
  const ends = zs.filter((z, i) => i === 0 || z - zs[i - 1] > 0.01);
  expect(ends.length % 2, `${k} wheels' flats`).toBe(0);
  const out: number[] = [];
  for (let i = 0; i < ends.length; i += 2) out.push((ends[i] + ends[i + 1]) / 2);
  return out;
}
const mean = (a: number[]) => a.reduce((x, y) => x + y, 0) / a.length;

describe("the vehicles' models", () => {
  it("every kind the renderer draws has its model, made of the parts the renderer reads", () => {
    const own = new Set(["v_glass", "v_black", "v_tyre", "v_frame", "v_chrome", "v_wood", "v_wood2", "v_canvas", "v_tan", "v_insul", "v_steel",
      "v_cream", "v_yellow", "v_flag", "v_turbine", "v_turbine2", "v_girder", "v_girder2", "v_chain", "lamp", "tail", "beacon"]);
    for (const k of VEHICLE_MODELS) {
      const g = glb(k);
      const nodes = new Set(g.parts.map((p) => p.node));
      expect([...nodes].sort(), k).toEqual(CARS.includes(k) ? ["far", "model"] : ["model"]);
      for (const p of g.parts) expect(own.has(p.material) || (PAINT_ROLES as readonly string[]).includes(p.material), `${k}: ${p.material}`).toBe(true);
      const mats = new Set(near(g).map((p) => p.material));
      // (every vehicle but the convoy's warning-yellow car wears a paint the game gives it)
      if (k !== "escort_car") expect(mats.has("body"), `${k} body paint`).toBe(true);
      // what leads has headlamps, what ends has tail lamps (the night's lights hang on them)
      const trailer = /^(rt_.*_[ab]|ll_trailer_.*)$/.test(k);
      expect(mats.has("lamp"), `${k} headlamps`).toBe(!trailer);
      expect(mats.has("tail"), `${k} tail lamps`).toBe(true);
      expect(mats.has("beacon"), `${k} beacons`).toBe(k === "escort_car" || k.startsWith("ll_"));
    }
    // the company's lorries: its colour, its lettering colour, and a load to tell the bodies apart
    for (const b of BODIES) for (const k of [b, `heavy_${b}`, `rt_${b}_a`, `rt_${b}_b`]) {
      const mats = new Set(near(glb(k)).map((p) => p.material));
      expect(mats.has("second"), `${k} lettering`).toBe(true);
      expect(mats.has("cargo"), `${k} load`).toBe(true);
    }
  });

  it("each is the footprint the sim drives: its length and width, centred on its origin, wheels on the ground", () => {
    for (const k of VEHICLE_MODELS) {
      for (const parts of [near(glb(k)), glb(k).parts.filter((p) => p.node === "far")]) {
        if (!parts.length) continue;
        const far = parts[0].node === "far";
        const b = bounds(parts), L = lengthOf(k), W = widthOf(k);
        // (a far model is a few boxes inside the full one's footprint)
        if (far) {
          expect(b.max[2] - b.min[2], `${k} far length`).toBeLessThanOrEqual(L + 0.03);
          expect(b.max[2] - b.min[2], `${k} far length`).toBeGreaterThan(L - 0.4);
          expect(b.max[0] - b.min[0], `${k} far width`).toBeLessThanOrEqual(W + 0.03);
          expect(b.max[0] - b.min[0], `${k} far width`).toBeGreaterThan(W - 0.3);
        } else {
          expect(Math.abs(b.max[2] - b.min[2] - L), `${k} length ${b.max[2] - b.min[2]} for ${L}`).toBeLessThan(0.03);
          expect(Math.abs(b.max[0] - b.min[0] - W), `${k} width ${b.max[0] - b.min[0]} for ${W}`).toBeLessThan(0.03);
          expect(Math.abs(b.min[1]), `${k} on the ground`).toBeLessThan(0.01);
        }
        expect(Math.abs(b.max[2] + b.min[2]) / 2, `${k} centred along`).toBeLessThan(far ? 0.12 : 0.02);
        expect(Math.abs(b.max[0] + b.min[0]) / 2, `${k} centred across`).toBeLessThan(0.02);
      }
    }
  });

  it("the pieces the sim swings through a bend have their axles where it turns them", () => {
    // (to within a hand: the models keep the axles the old ones had, which were built to these numbers by eye)
    const at = (got: number, want: number, what = "") => expect(Math.abs(got - want), `${what} at ${got.toFixed(2)} for ${want}`).toBeLessThan(0.16);
    // a heavy rigid: its twin steering axles about its pivot, its tandem about its axle
    const H = TRUCK_CLASSES.heavy.units![0];
    for (const b of BODIES) {
      const a = axles(`heavy_${b}`);
      expect(a.length, `heavy_${b} axles`).toBe(4);
      at(mean(a.slice(0, 2)), H.pivot, `heavy_${b} steer`);
      at(mean(a.slice(2)), H.axle, `heavy_${b} tandem`);
      // (and the light lorry is the two-axle truck its class says it is)
      expect(axles(b).length, `${b} axles`).toBe(2);
    }
    // a road train: the tractor's steering axle at its pivot, each piece's tandem at its axle
    const RT = TRUCK_CLASSES.roadtrain.units!;
    const t = axles("rt_tractor");
    expect(t.length).toBe(3);
    at(t[0], RT[0].pivot);
    at(mean(t.slice(1)), RT[0].axle);
    for (const b of BODIES) for (const [s, u] of [["a", RT[1]], ["b", RT[2]]] as const) {
      const a = axles(`rt_${b}_${s}`);
      expect(a.length, `rt_${b}_${s} axles`).toBe(2);
      expect(Math.abs(mean(a) - u.axle), `rt_${b}_${s} tandem at ${mean(a)} for ${u.axle}`).toBeLessThan(0.15);
    }
    // the convoy: the tractor's tandem, the low-loader's bogie, the escort car's back axle
    const C = CONVOY_UNITS;
    const lt = axles("ll_tractor");
    at(lt[0], C[1].pivot);
    at(mean(lt.slice(1)), C[1].axle);
    for (const p of ["turbine", "girder"]) {
      const a = axles(`ll_trailer_${p}`);
      expect(a.length, `${p} low-loader axles`).toBe(4);
      at(mean(a), C[2].axle, `${p} low-loader bogie`);
    }
    const e = axles("escort_car");
    expect(e.length).toBe(2);
    at(e[0], C[0].pivot);
    at(e[1], C[0].axle);
  });

  it("each stays within the triangles a street of them can afford, and a car has its few-triangle far model", () => {
    for (const k of VEHICLE_MODELS) {
      const g = glb(k), n = tris(near(g));
      const freight = /^(rt_|ll_|heavy_)/.test(k) || (BODIES as readonly string[]).includes(k);
      expect(n, `${k} triangles`).toBeLessThanOrEqual(freight ? 840 : k === "bus" || k === "escort_car" ? 640 : 420);
      if (CARS.includes(k)) expect(tris(g.parts.filter((p) => p.node === "far")), `${k} far triangles`).toBeLessThanOrEqual(70);
    }
  });
});

describe("what a vehicle wears", () => {
  it("a townsperson's look is always the same car in the same paint, and the street is a mix", () => {
    const kinds = new Map<string, number>(), paints = new Map<number, number>();
    const N = 6000;
    for (let look = 0; look < N; look++) {
      const a = carLook(look), b = carLook(look);
      expect(a).toEqual(b);
      // (one in six a van, as the sim has always had it)
      expect(a.kind === "van", `look ${look}`).toBe(look % 6 === 0);
      expect(CAR_KINDS).toContain(a.kind);
      const from = a.kind === "van" ? VAN_PAINTS : CAR_PAINTS;
      expect(from.some((p) => p[0] === a.body), `look ${look} paint`).toBe(true);
      kinds.set(a.kind, (kinds.get(a.kind) ?? 0) + 1);
      if (a.kind !== "van") paints.set(a.body, (paints.get(a.body) ?? 0) + 1);
    }
    // every body is seen, the saloon most, none of them rare
    for (const k of CAR_BODIES) expect(kinds.get(k) ?? 0, k).toBeGreaterThan(N * 0.1);
    expect(kinds.get("car")!).toBeGreaterThan(kinds.get("car_coupe")!);
    // every paint is seen, and no one colour is more than about a quarter of the street (black, the commonest)
    const cars = N - kinds.get("van")!;
    for (const p of CAR_PAINTS) expect(paints.get(p[0]) ?? 0, `paint ${p[0].toString(16)}`).toBeGreaterThan(cars * 0.02);
    for (const n of paints.values()) expect(n).toBeLessThan(cars * 0.3);
    // (and big, scattered numbers, as the sim's looks are, work as well as small ones)
    const big = new Set<string>();
    for (let i = 0; i < 400; i++) big.add(carLook((i * 2654435761) >>> 0).kind + carLook((i * 2654435761) >>> 0).body);
    expect(big.size).toBeGreaterThan(25);
  });

  it("the company's lorries wear its herald: the field as their paint, the ink as their lettering", () => {
    for (const [field, ink] of HERALD_PAIRS) {
      const l = fleetLivery({ shape: "shield", field, ink });
      expect(l.body).toBe(parseInt(HERALD_COLORS[field].slice(1), 16));
      expect(l.second).toBe(parseInt(HERALD_COLORS[ink].slice(1), 16));
      expect(l.body).not.toBe(l.second);
    }
    expect(fleetLivery(null).body).not.toBe(fleetLivery(null).second);
  });

  it("a home's bays are full at night and thin by day; a shop's or a works' the other way round", () => {
    const share = (home: boolean, hour: number) => {
      let n = 0;
      for (let h = 0; h < 4000; h++) if (parkedAt(h * 7919 + 13, home, hour)) n++;
      return n / 4000;
    };
    expect(share(true, 2)).toBeGreaterThan(0.97);
    expect(share(true, 22)).toBeGreaterThan(0.97);
    expect(share(true, 12)).toBeLessThan(0.45);
    expect(share(true, 12)).toBeGreaterThan(0.2);
    expect(share(false, 12)).toBeGreaterThan(0.97);
    expect(share(false, 2)).toBeLessThan(0.2);
    expect(share(false, 2)).toBeGreaterThan(0.05);
    // a lot fills and empties over a couple of hours, not at a stroke
    for (const home of [true, false]) {
      for (let hour = 0; hour < 24; hour += 0.5) expect(Math.abs(share(home, hour + 0.5) - share(home, hour)), `${home} at ${hour}`).toBeLessThan(0.2);
    }
    // (and the same car keeps the same hours)
    for (let h = 0; h < 50; h++) expect(parkedAt(h, true, 9.3)).toBe(parkedAt(h, true, 9.3));
  });
});

describe("parked cars", () => {
  // A parked car is the car model stood on a bay (a `park_N` empty of a building's model; Buildings3D), so where the
  // bays are is where the cars are: each must be on the model's own lot (a lot never reaches the road: tests/lots,
  // tests/setback) and clear of everything on it that a car would be standing in.
  const HALF_W = 1.85 / 2, HALF_L = SIM.carLen / 2;
  /** A bay's car as a rectangle on the ground: its middle, and its half length and half width as vectors. */
  function carOn(e: Glb["empties"][number]) {
    const q = new THREE.Quaternion(e.q[0], e.q[1], e.q[2], e.q[3]);
    const f = new THREE.Vector3(0, 0, 1).applyQuaternion(q), r = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
    return { c: [e.p[0], e.p[2]], f: [f.x, f.z], r: [r.x, r.z] };
  }
  /** Whether a triangle (on the ground plane) and a rectangle overlap (separating axes). */
  function overlap(t: number[][], c: number[], f: number[], r: number[], hl: number, hw: number): boolean {
    const axes = [f, r];
    for (let i = 0; i < 3; i++) {
      const a = t[i], b = t[(i + 1) % 3], ex = b[0] - a[0], ez = b[1] - a[1], l = Math.hypot(ex, ez);
      if (l > 1e-6) axes.push([-ez / l, ex / l]);
    }
    for (const ax of axes) {
      const pc = c[0] * ax[0] + c[1] * ax[1];
      const pr = Math.abs(f[0] * ax[0] + f[1] * ax[1]) * hl + Math.abs(r[0] * ax[0] + r[1] * ax[1]) * hw;
      let lo = Infinity, hi = -Infinity;
      for (const p of t) { const d = p[0] * ax[0] + p[1] * ax[1]; lo = Math.min(lo, d); hi = Math.max(hi, d); }
      if (lo > pc + pr || hi < pc - pr) return false;
    }
    return true;
  }
  const withBays = () => [...new Set<string>([...BUILDING_MODELS, ...HOME_VARIANTS, ...SITE_PIECES])].filter((m) => glb(m).empties.some((e) => /^park_?\d+/i.test(e.name)));

  it("every bay is on its model's own ground, a whole car of it", () => {
    const models = withBays();
    expect(models.length).toBeGreaterThan(40);
    for (const m of models) {
      const b = bounds(glb(m).parts);
      for (const e of glb(m).empties.filter((x) => /^park_?\d+/i.test(x.name))) {
        const { c, f, r } = carOn(e);
        for (const sf of [-1, 1]) for (const sr of [-1, 1]) {
          const x = c[0] + f[0] * HALF_L * sf + r[0] * HALF_W * sr, z = c[1] + f[1] * HALF_L * sf + r[1] * HALF_W * sr;
          expect(x > b.min[0] - 0.05 && x < b.max[0] + 0.05 && z > b.min[2] - 0.05 && z < b.max[2] + 0.05, `${m} ${e.name} corner at ${x.toFixed(2)}, ${z.toFixed(2)}`).toBe(true);
        }
        expect(Math.abs(e.p[1]), `${m} ${e.name} on the ground`).toBeLessThan(0.3);
      }
    }
  });

  it("no bay stands its car in a wall, a fence or anything else as tall as a car", () => {
    const bad: string[] = [];
    for (const m of withBays()) {
      const g = glb(m);
      for (const e of g.empties.filter((x) => /^park_?\d+/i.test(x.name))) {
        const { c, f, r } = carOn(e);
        let hit = false;
        for (const p of g.parts) {
          // (a yard's own tree may hang its lowest leaves over a car's nose)
          if (/^(trunk|leaf|bush|needle|bare)/.test(p.material)) continue;
          for (let i = 0; i < p.pos.length && !hit; i += 9) {
            const y = [p.pos[i + 1], p.pos[i + 4], p.pos[i + 7]];
            // (only what a car's body would be standing in: above the kerbs and the painted lines, below a canopy)
            if (Math.min(...y) - e.p[1] > 1.1 || Math.max(...y) - e.p[1] < 0.5) continue;
            const t = [[p.pos[i], p.pos[i + 2]], [p.pos[i + 3], p.pos[i + 5]], [p.pos[i + 6], p.pos[i + 8]]];
            // (a hand's breadth of grace: a car may stand right up against a wall)
            if (overlap(t, c, f, r, HALF_L - 0.25, HALF_W - 0.2)) hit = true;
          }
          if (hit) break;
        }
        if (hit) bad.push(`${m} ${e.name}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it("the homes of a town have somewhere to stand a car, and so do its shops", () => {
    for (const k of ["house", "terrace", "shop", "office"] as BuildingKind[]) {
      expect(BUILDING_TYPES[k].parking, k).toBeGreaterThan(0);
      for (const m of TOWN_MODELS[k]) expect(glb(m).empties.filter((e) => /^park_?\d+/i.test(e.name)).length, m).toBeGreaterThan(0);
    }
  });
});
