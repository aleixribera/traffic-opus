// The towns' buildings (tools/blender/town_*.py, render/townmodels.ts): every model a kind may be drawn with is there
// and is that kind's size, so the game's lots, bays and saves hold whichever is picked; each has glass that lights at
// night; and for every lot a town grows, the renderer picks a model made for a lot like it, and not always the same.

import { describe, it, expect, beforeAll } from "vitest";
import { BUILDING_TYPES, type BuildingKind } from "../src/config";
import { ZONE_GROUP, ZONE_LOTS, modelFit } from "../src/game/growables";
import type { ZoneId } from "../src/game/zones";
import { TOWN_MODELS, TOWN_VARIANTS, townModel } from "../src/render/townmodels";
import { HOME_VARIANTS, LIT_KINDS, PROP_MODELS, litKind } from "../src/render/models";

// (node's fs, untyped here: the project's types are the browser's)
let readFileSync: (path: URL) => any;
beforeAll(async () => {
  const node = (m: string) => import(/* @vite-ignore */ m);
  ({ readFileSync } = await node("fs"));
});

interface Glb {
  /** the model's bounds, three's axes (x across the lot, y up, z out to the street) */
  min: number[]; max: number[];
  tris: number;
  materials: string[];
  /** the empties: name, place, scale */
  empties: { name: string; p: number[]; s: number[] }[];
}
const cache = new Map<string, Glb>();
function glb(model: string): Glb {
  const had = cache.get(model);
  if (had) return had;
  const buf = readFileSync(new URL(`../public/models/${model}.glb`, import.meta.url));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as {
    nodes: { name?: string; translation?: number[]; scale?: number[]; rotation?: number[]; mesh?: number }[];
    meshes: { primitives: { attributes: { POSITION: number }; indices: number; material?: number }[] }[];
    accessors: { count: number; min?: number[]; max?: number[] }[];
    materials?: { name: string }[];
  };
  const out: Glb = { min: [Infinity, Infinity, Infinity], max: [-Infinity, -Infinity, -Infinity], tris: 0, materials: [], empties: [] };
  for (const n of json.nodes) {
    if (n.mesh === undefined) { out.empties.push({ name: n.name ?? "", p: n.translation ?? [0, 0, 0], s: n.scale ?? [1, 1, 1] }); continue; }
    // (a model's meshes sit at its origin, unturned: their own bounds are the model's)
    expect(n.translation ?? [0, 0, 0], model).toEqual([0, 0, 0]);
    expect(n.scale ?? [1, 1, 1], model).toEqual([1, 1, 1]);
    for (const p of json.meshes[n.mesh].primitives) {
      const a = json.accessors[p.attributes.POSITION];
      for (let k = 0; k < 3; k++) { out.min[k] = Math.min(out.min[k], a.min![k]); out.max[k] = Math.max(out.max[k], a.max![k]); }
      out.tris += json.accessors[p.indices].count / 3;
      if (p.material !== undefined) out.materials.push(json.materials![p.material].name);
    }
  }
  cache.set(model, out);
  return out;
}
const empty = (g: Glb, re: RegExp) => g.empties.filter((e) => re.test(e.name));
/** A town model's design fit and tall (its `design_0` empty: Blender's x and y scale, three's x and z). */
const design = (model: string): [number, number] | undefined => {
  const d = empty(glb(model), /^design_?\d+/)[0];
  return d ? [d.s[0], d.s[2]] : undefined;
};

const KINDS = Object.keys(TOWN_MODELS) as BuildingKind[];
const ALL = KINDS.flatMap((k) => TOWN_MODELS[k].map((m) => [k, m] as const));

describe("the towns' models", () => {
  it("every kind's own model comes first, and every other one is loaded", () => {
    for (const k of KINDS) {
      expect(TOWN_MODELS[k][0]).toBe(k);
      expect(new Set(TOWN_MODELS[k]).size).toBe(TOWN_MODELS[k].length);
      for (const m of TOWN_MODELS[k].slice(1)) expect(TOWN_VARIANTS, m).toContain(m);
    }
    expect(HOME_VARIANTS).toEqual(TOWN_VARIANTS);
    // (two or three models a kind, at the least, but the one filling station)
    for (const k of KINDS) if (k !== "fuelstation") expect(TOWN_MODELS[k].length, k).toBeGreaterThanOrEqual(3);
  });

  it("each is its kind's footprint, centred on the lot, standing on the ground", () => {
    for (const [k, m] of ALL) {
      const g = glb(m), T = BUILDING_TYPES[k];
      expect(g.max[0] - g.min[0], `${m} width`).toBeCloseTo(T.w, 0);
      expect(Math.abs(g.max[0] - g.min[0] - T.w), `${m} width`).toBeLessThan(0.12);
      expect(Math.abs(g.max[2] - g.min[2] - T.d), `${m} depth`).toBeLessThan(0.12);
      expect(Math.abs(g.min[0] + T.w / 2), `${m} centred across`).toBeLessThan(0.12);
      expect(Math.abs(g.min[2] + T.d / 2), `${m} centred deep`).toBeLessThan(0.12);
      expect(Math.abs(g.min[1]), `${m} on the ground`).toBeLessThan(0.01);
      expect(g.max[1], `${m} height`).toBeGreaterThan(4);
    }
  });

  it("each stays within the triangles a town of two thousand buildings can afford", () => {
    for (const [, m] of ALL) expect(glb(m).tris, m).toBeLessThanOrEqual(2000);
    // (a street of houses is most of a town)
    for (const m of TOWN_MODELS.house) expect(glb(m).tris, m).toBeLessThanOrEqual(700);
  });

  it("each has glass that lights at night: a home's windows, a shop's, an office's", () => {
    for (const [k, m] of ALL) {
      const kinds = new Set(glb(m).materials.map((x) => LIT_KINDS[litKind(x)]).filter((x) => x !== undefined));
      expect(kinds.size, `${m} has no lit glass`).toBeGreaterThan(0);
      if (BUILDING_TYPES[k].zone === "res") expect(kinds.has("home"), `${m} home windows`).toBe(true);
      else expect(kinds.has("shop") || kinds.has("office"), `${m} shop or office windows`).toBe(true);
    }
  });

  it("each has its parking bays on its own lot, and says where its building and its alley are", () => {
    for (const [k, m] of ALL) {
      const g = glb(m), T = BUILDING_TYPES[k];
      const bays = empty(g, /^park_\d+/);
      expect(bays.length, `${m} bays`).toBeGreaterThan(0);
      for (const b of bays) {
        expect(Math.abs(b.p[0]), `${m} ${b.name}`).toBeLessThan(T.w / 2 - 0.8);
        expect(Math.abs(b.p[2]), `${m} ${b.name}`).toBeLessThan(T.d / 2 - 0.8);
      }
      if (k === "house") continue;
      // made for a lot: its design fit and tall, and its building's box within the lot
      const d = design(m);
      expect(d, `${m} design`).toBeDefined();
      expect(d![0]).toBeGreaterThan(0.4);
      expect(d![0]).toBeLessThanOrEqual(1.25);
      expect(d![1]).toBeGreaterThanOrEqual(0.7);
      expect(d![1]).toBeLessThanOrEqual(2);
      const body = empty(g, /^body_?\d+/)[0];
      expect(body, `${m} body`).toBeDefined();
      expect(Math.abs(body.p[0]) + body.s[0], `${m} body across`).toBeLessThanOrEqual(T.w / 2 + 0.05);
      expect(Math.abs(body.p[2]) + body.s[2], `${m} body deep`).toBeLessThanOrEqual(T.d / 2 + 0.05);
      expect(body.p[1], `${m} body top`).toBeGreaterThan(3);
      // its yard is behind it, down an alley beside it (but a filling station's forecourt)
      const via = empty(g, /^via_?\d+/)[0];
      if (k === "fuelstation") { expect(via).toBeUndefined(); continue; }
      expect(via, `${m} alley`).toBeDefined();
      expect(Math.abs(via.p[0]), `${m} alley on the lot`).toBeLessThan(T.w / 2);
      // (three's z runs out to the street: the yard is behind the building, at lower z)
      for (const b of bays) expect(b.p[2], `${m} ${b.name} behind`).toBeLessThan(body.p[2] + body.s[2]);
    }
  });

  it("the homes and the rows have chimneys for their smoke", () => {
    for (const m of [...TOWN_MODELS.house, "terrace", "terrace_b", "terrace_c", "highstreet"]) {
      const es = empty(glb(m), /^chimney_?\d+/);
      expect(es.length, m).toBeGreaterThan(0);
      for (const e of es) expect(e.p[1], m).toBeGreaterThan(3);
    }
  });
});

describe("the model a lot is drawn with", () => {
  /** every lot a town grows: its kind, fit and the heights it comes in */
  const lots = (Object.keys(ZONE_LOTS) as ZoneId[]).flatMap((zone) => ZONE_LOTS[zone].map((t) => {
    const T = BUILDING_TYPES[t.model];
    const talls = t.tall ? [t.tall[0], (t.tall[0] + t.tall[1]) / 2, t.tall[1]] : [1];
    return { zone, t, fit: modelFit(t, T.w, T.d), talls };
  }));

  it("is one made for a lot and a height near its own", () => {
    for (const { zone, t, fit, talls } of lots) {
      for (const tall of talls) {
        for (let id = 1; id < 40; id++) {
          const m = townModel(t.model, fit, tall, id, design);
          expect(TOWN_MODELS[t.model], `${zone} ${t.w}x${t.d}`).toContain(m);
          const d = design(m);
          if (!d) { expect(t.model).toBe("house"); continue; }
          // (drawn no more than a third bigger or smaller than it was made, nor stretched by more than a third)
          const where = `${zone} ${t.model} ${t.w}x${t.d} tall ${tall}: ${m}`;
          expect(Math.abs(Math.log(fit / d[0])), where).toBeLessThan(Math.log(1.34));
          expect(Math.abs(Math.log(tall / d[1])), where).toBeLessThan(Math.log(1.34));
        }
      }
    }
  });

  it("is not always the same one: a street of a kind is at least two models, a street of houses five", () => {
    const seen = new Map<string, Set<string>>();
    for (const { t, fit, talls } of lots) {
      for (const tall of talls) {
        const s = seen.get(t.model) ?? new Set<string>();
        seen.set(t.model, s);
        for (let id = 1; id < 200; id++) s.add(townModel(t.model, fit, tall, id, design));
      }
    }
    for (const [k, s] of seen) expect(s.size, `${k}: ${[...s]}`).toBeGreaterThanOrEqual(k === "house" ? 5 : 2);
    // and every model made is drawn somewhere
    const used = new Set([...seen.values()].flatMap((s) => [...s]));
    for (const [k, m] of ALL) if (k !== "fuelstation") expect(used.has(m), `${m} is never drawn`).toBe(true);
  });

  it("is the same one for a building every time, and its kind's own for a kind with no others", () => {
    const fit = modelFit(ZONE_LOTS.comMid[0], 30, 28);
    expect(townModel("store", fit, 1, 77, design)).toBe(townModel("store", fit, 1, 77, design));
    expect(townModel("factory", 1, 1, 5, design)).toBe("factory");
    expect(ZONE_GROUP.comMid).toBe("com");
  });
});

describe("the roadside furniture's models", () => {
  it("are there, light, and the billboards' posters are lit signs", () => {
    for (const m of ["telegraphpole", "telegraphwire", "billboard_a", "billboard_b", "billboard_c"]) {
      expect(PROP_MODELS as readonly string[]).toContain(m);
      expect(glb(m).tris, m).toBeLessThanOrEqual(400);
    }
    for (const m of ["billboard_a", "billboard_b", "billboard_c"]) {
      expect(glb(m).materials.filter((x) => LIT_KINDS[litKind(x)] === "sign").length, m).toBeGreaterThanOrEqual(3);
    }
    // a span of wire is a metre long from its origin, out along three's +z, and hangs between the poles' arms
    const w = glb("telegraphwire");
    expect(w.min[2]).toBeCloseTo(0, 3);
    expect(w.max[2]).toBeCloseTo(1, 3);
    expect(w.min[1]).toBeGreaterThan(6);
    expect(w.max[1]).toBeLessThan(glb("telegraphpole").max[1]);
  });
});
