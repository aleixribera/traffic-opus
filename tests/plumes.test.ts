// Smoke, steam and dust (render/plumes.ts, render/smoke.ts): a works smokes as hard as it is working, and stops when
// it stops; the homes' fires are lit in the cold; a dirt road raises dust at speed; every works' model says where its
// stacks are; and the pool of puffs never runs over.

import * as THREE from "three";
import { beforeAll, describe, expect, it } from "vitest";
import { Industry, PLANTS, type IndustryHost, type PlantKind } from "../src/game/industry";
import type { Building } from "../src/game/buildings";
import type { PendingSpawn } from "../src/sim/traffic";
import { F } from "../src/world/gen";
import { HOUR } from "../src/game/society";
import {
  DUST_TINT, FX_KINDS, LOOKS, PLANT_STEP, PULSE_STALE, STACK_TINT, due, feel, fireLit, hearth, liveOf, newPlume, newPulse,
  plumeOf, smokeOf, tintOf, trailRate, type FxEmitter, type FxKind,
} from "../src/render/plumes";
import { POOL, Smoke, zoomScale } from "../src/render/smoke";
import { holdWind, setWind } from "../src/render/wind";

/** Game seconds between the plants' steps (game/city.ts). */
const TICK = HOUR / 8;

/** A tiny world (as tests/industry.test.ts): plants on one road, fully staffed, nobody buying. */
function world() {
  const list: Building[] = [];
  const byId = new Map<number, Building>();
  const pending: PendingSpawn[] = [];
  const host: IndustryHost = {
    time: 0,
    buildings: { list, byId } as any,
    has: (f) => f === F.fert,
    connected: () => true,
    workersAt: (id) => byId.get(id)!.cap,
    get shops() { return [] as Building[]; },
    townOf: (b) => b.id,
    want: () => 10,
    sold: () => {},
    request: (p) => { pending.push(p); },
    trips: () => pending.map((p) => p.trip),
    held: () => new Map(),
    earn: () => {},
    spend: () => {},
  } as IndustryHost;
  const ind = new Industry(host);
  let id = 1;
  const plant = (kind: PlantKind): Building => {
    const b = { id: id++, kind, c: { x: id * 100, y: 0 }, rot: 0, hw: 10, hd: 10, front: { x: 0, y: 0 }, access: { seg: 1, t: 0.5 } as any, side: 1, level: 1, cap: 8, fit: 1, tall: 1, built: 1, abandoned: 0, lv: 0, upT: 0, badT: 0, problem: null, stock: 0, out: 0, prodT: 0, visits: 0, born: 0 } as unknown as Building;
    list.push(b);
    byId.set(b.id, b);
    ind.init(b, kind);
    return b;
  };
  return { host, ind, plant };
}

describe("a works' pulse", () => {
  it("the plants step as often as the pulse expects", () => {
    expect(PLANT_STEP).toBe(TICK);
  });

  it("reads 1 off a level 1 works flat out, and 0 once it starves: the stack dies away", () => {
    const w = world();
    const fp = w.plant("foodplant");
    const P = fp.plant!, d = PLANTS.foodplant;
    for (const [p, n] of Object.entries(d.inputs)) (P.stock as Record<string, number>)[p] = n! * 6;
    const pulse = newPulse();
    let t = 0;
    const speeds: number[] = [];
    // (six batches' worth of inputs: it works through them, then stands)
    for (let i = 0; i < (d.cycle * 6) / TICK + 30; i++) {
      w.ind.tick(TICK);
      t += TICK;
      // the smoke looks at it every frame, several times between the plants' steps
      for (let f = 1; f <= 4; f++) speeds.push(feel(pulse, P.prog, t + (f / 4) * TICK * 0.99, d.cycle));
    }
    const working = speeds.slice(8, Math.floor(((d.cycle * 5) / TICK) * 4));
    for (const s of working) expect(s).toBeCloseTo(1, 5);
    expect(smokeOf(working[0])).toBeCloseTo(1, 5);
    // starved: within two steps of the last batch the pulse is flat, and stays flat
    const tail = speeds.slice(-60);
    for (const s of tail) expect(s).toBe(0);
    expect(smokeOf(0)).toBe(0);
  });

  it("reads a bigger site as working harder, and a starved one as stopped whatever its level", () => {
    const pace = (level: number) => {
      const w = world();
      const farm = w.plant("farm");
      farm.plant!.level = level;
      const pulse = newPulse();
      let t = 0, s = 0;
      for (let i = 0; i < 12; i++) { w.ind.tick(TICK); t += TICK; s = feel(pulse, farm.plant!.prog, t, PLANTS.farm.cycle); }
      return s;
    };
    const one = pace(1), top = pace(4);
    expect(one).toBeCloseTo(1, 5);
    expect(top).toBeGreaterThan(one * 1.5);
    expect(smokeOf(top)).toBeGreaterThan(smokeOf(one));
    // (but a level 4 site does not smoke four times as hard: the plume grows, it does not smother the map)
    expect(smokeOf(top)).toBeLessThanOrEqual(2.2);
  });

  it("holds while the game is paused, and goes flat when nothing has moved for two steps", () => {
    const p = newPulse();
    feel(p, 0.1, 100, 60);
    expect(feel(p, 0.1 + 5 / 60, 105, 60)).toBeCloseTo(1, 6);
    // paused: the clock stands, the progress stands, the stack goes on smoking in the still frame
    for (let i = 0; i < 50; i++) expect(feel(p, 0.1 + 5 / 60, 105, 60)).toBeCloseTo(1, 6);
    // running again with no progress: stopped
    expect(feel(p, 0.1 + 5 / 60, 105 + PULSE_STALE - 0.1, 60)).toBeCloseTo(1, 6);
    expect(feel(p, 0.1 + 5 / 60, 105 + PULSE_STALE + 0.1, 60)).toBe(0);
  });

  it("takes a finished batch as work done and a dropped one as a stop", () => {
    const p = newPulse();
    feel(p, 0.95, 0, 60);
    // (the batch finished and the next began: 0.95 -> 0.0333 is a twelfth of a batch, not a step back)
    expect(feel(p, 0.95 + 5 / 60 - 1, 5, 60)).toBeCloseTo(1, 5);
    // (a 0 is a batch that ended on the step, or one dropped for want of an input: the pace holds till the next step
    // tells which)
    expect(feel(p, 0, 10, 60)).toBeCloseTo(1, 5);
    expect(feel(p, 5 / 60, 15, 60)).toBeCloseTo(1, 5);
    expect(feel(p, 0, 20, 60)).toBeCloseTo(1, 5);
    expect(feel(p, 0, 25, 60)).toBeCloseTo(1, 5);
    expect(feel(p, 0, 20 + PULSE_STALE + 0.1, 60)).toBe(0);
    // (and work that starts again from nothing is read at once)
    expect(feel(p, 10 / 60, 200, 60)).toBeCloseTo(2, 5);
    // a loaded game whose clock is earlier starts the pulse afresh instead of reading a pace off the jump
    feel(p, 0.4, 20, 60);
    expect(feel(p, 0.6, 3, 60)).toBe(feel(p, 0.6, 3, 60));
    expect(feel(p, 0.6 + 5 / 60, 8, 60)).toBeCloseTo(1, 5);
  });

  it("smokes thinly at part pace and never negatively", () => {
    expect(smokeOf(-1)).toBe(0);
    expect(smokeOf(NaN)).toBe(0);
    let last = 0;
    for (let s = 0.05; s <= 6; s += 0.05) {
      const k = smokeOf(s);
      expect(k).toBeGreaterThanOrEqual(last);
      last = k;
    }
    expect(smokeOf(0.4)).toBeGreaterThan(0.3);
    expect(smokeOf(0.4)).toBeLessThan(0.6);
  });
});

describe("a plume", () => {
  it("is bigger from a bigger mouth and at a harder pace, and is nothing from a works that stands", () => {
    const a = plumeOf("stack", 1.2, 1, newPlume()), b = plumeOf("stack", 3.6, 1, newPlume()), c = plumeOf("stack", 3.6, 2, newPlume());
    expect(b.size).toBeGreaterThan(a.size * 2);
    expect(b.grow).toBeGreaterThan(a.grow);
    expect(b.life).toBeGreaterThan(a.life);
    expect(c.size).toBeGreaterThan(b.size);
    expect(c.rate).toBeGreaterThan(b.rate);
    const off = plumeOf("stack", 3.6, 0, newPlume());
    expect(off.rate).toBe(0);
    expect(off.opacity).toBe(0);
  });

  it("thins and pales at part pace without breaking up: the puffs still follow one another", () => {
    const full = plumeOf("stack", 2.8, 1, newPlume()), part = plumeOf("stack", 2.8, 0.3, newPlume());
    expect(part.size).toBeLessThan(full.size);
    expect(part.opacity).toBeLessThan(full.opacity);
    expect(part.rate).toBeGreaterThan(full.rate * 0.5);
    // (the gap between two puffs as they leave the mouth, at 1.45 times the rise speed, is about a puff's width)
    for (const p of [full, part]) expect((1.45 * p.rise) / p.rate).toBeLessThan(p.size * 1.5);
    expect(part.rise).toBeLessThan(full.rise);
  });

  it("every kind of puff has a look, and a works' own smoke its own colour", () => {
    for (const k of [...FX_KINDS, "flame", "trail"] as const) {
      const L = LOOKS[k];
      expect(L.rate).toBeGreaterThan(0);
      expect(L.life).toBeGreaterThan(0);
      expect(L.opacity).toBeGreaterThan(0);
      expect(L.opacity).toBeLessThanOrEqual(1);
    }
    expect(tintOf("stack", "rubberplant")).toBe(STACK_TINT.rubberplant);
    expect(tintOf("stack", "nosuchworks")).toBe(LOOKS.stack.colour);
    expect(tintOf("dust", "coalmine")).toBe(DUST_TINT.coalmine);
    expect(tintOf("steam", "coalplant")).toBe(LOOKS.steam.colour);
    // (steam is the lightest thing in the sky, coal dust the darkest)
    const lum = (c: number) => ((c >> 16) & 255) + ((c >> 8) & 255) + (c & 255);
    for (const c of Object.values(STACK_TINT)) expect(lum(c)).toBeLessThan(lum(LOOKS.steam.colour));
  });

  it("counts the puffs that come due without losing a fraction", () => {
    const o = { n: 0, acc: 0 };
    let acc = 0, n = 0;
    for (let i = 0; i < 600; i++) { due(acc, 2.3, 1 / 60, o); acc = o.acc; n += o.n; }
    expect(n + acc).toBeCloseTo(23, 6);
    expect(liveOf({ rate: 2, life: 10, rise: 0, size: 1, grow: 0, opacity: 1 })).toBe(20);
  });
});

describe("the homes' fires and the dirt roads' dust", () => {
  it("fires are lit all winter, on cold nights in spring and autumn, never in summer", () => {
    // (bare, snow, lush, night)
    expect(hearth(1, 1, 0, 0)).toBe(1);
    expect(hearth(1, 0, 0, 0)).toBe(1);
    expect(hearth(0, 0, 1, 0)).toBe(0);
    expect(hearth(0, 0, 1, 1)).toBe(0);
    expect(hearth(0, 0, 0, 0)).toBe(0);
    expect(hearth(0, 0, 0, 1)).toBeGreaterThan(0.5);
    expect(hearth(0, 0, 0.5, 1)).toBeLessThan(hearth(0, 0, 0, 1));
  });

  it("the same homes light theirs each cold spell, more of them the colder it is", () => {
    const lit = (level: number) => Array.from({ length: 2000 }, (_, id) => fireLit(id, level));
    const cool = lit(0.3), cold = lit(1);
    expect(lit(0).some(Boolean)).toBe(false);
    const n = (a: boolean[]) => a.filter(Boolean).length;
    expect(n(cool)).toBeGreaterThan(500);
    expect(n(cold)).toBeGreaterThan(n(cool) + 400);
    expect(n(cold)).toBeLessThan(2000);
    // (every home with a fire on a cool night has one in the dead of winter)
    for (let i = 0; i < 2000; i++) if (cool[i]) expect(cold[i]).toBe(true);
    expect(lit(1)).toEqual(cold);
  });

  it("a crawl raises no dust, a truck at speed the most", () => {
    expect(trailRate(0, false)).toBe(0);
    expect(trailRate(2.5, true)).toBe(0);
    expect(trailRate(5, false)).toBeGreaterThan(0);
    expect(trailRate(9, false)).toBe(LOOKS.trail.rate);
    expect(trailRate(9, true)).toBeGreaterThan(trailRate(9, false));
    expect(trailRate(30, false)).toBe(trailRate(9, false));
  });
});

// ---- the models say where they smoke

/** The empties in a GLB that are emitters: kind, place (three's axes, m) and width. */
// (node's fs, untyped here: the project's types are the browser's)
let readFileSync: (path: URL) => any;
beforeAll(async () => {
  const node = (m: string) => import(/* @vite-ignore */ m);
  ({ readFileSync } = await node("fs"));
});

function emittersIn(model: string): { kind: FxKind; p: number[]; size: number }[] {
  const buf = readFileSync(new URL(`../public/models/${model}.glb`, import.meta.url));
  const len = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + len).toString("utf8")) as { nodes: { name?: string; translation?: number[]; scale?: number[]; mesh?: number }[] };
  const out: { kind: FxKind; p: number[]; size: number }[] = [];
  for (const n of json.nodes) {
    const m = /^(stack|steam|dust|haze|flare|chimney)_?\d+/i.exec(n.name ?? "");
    if (m && n.mesh === undefined) out.push({ kind: m[1].toLowerCase() as FxKind, p: n.translation ?? [0, 0, 0], size: n.scale?.[0] ?? 1 });
  }
  return out;
}

describe("the models' emitters (tools/blender/build_models.py)", () => {
  /** what each works gives off, at least */
  const WORKS: Record<string, FxKind[]> = {
    smelter: ["stack", "steam"], coalplant: ["stack", "steam"], cementworks: ["stack", "dust"], glassworks: ["stack"],
    refinery: ["flare", "stack"], chemworks: ["stack", "steam"], motorworks: ["stack"], foodplant: ["stack"],
    coppersmelter: ["stack", "steam"], machineworks: ["stack"], rubberplant: ["stack", "steam"], works: ["stack"],
    ironmine: ["dust"], coalmine: ["dust"], coppermine: ["dust"], quarry: ["dust"], sandpit: ["dust"], constructionplant: ["dust"],
    sawmill: ["haze", "stack"], furniture: ["haze"], creamery: ["steam"], electronics: ["steam"],
  };

  it("every works that burns, boils, crushes or saws has its emitters, up where the stack ends", () => {
    for (const [model, kinds] of Object.entries(WORKS)) {
      const es = emittersIn(model);
      for (const k of kinds) expect(es.some((e) => e.kind === k), `${model} ${k}`).toBe(true);
      for (const e of es) {
        expect(e.p[1], `${model} ${e.kind} height`).toBeGreaterThan(0.3);
        expect(e.p[1]).toBeLessThan(80);
        expect(e.size).toBeGreaterThan(0.3);
        expect(e.size).toBeLessThan(16);
        // (a stack's smoke leaves from well above the yard)
        if (e.kind === "stack" || e.kind === "flare") expect(e.p[1], `${model} ${e.kind} height`).toBeGreaterThan(8);
      }
    }
  });

  it("the homes have chimneys", () => {
    for (const model of ["house", "house_b", "house_c", "terrace", "highstreet"]) {
      const es = emittersIn(model);
      expect(es.length, model).toBeGreaterThan(0);
      for (const e of es) {
        expect(e.kind).toBe("chimney");
        expect(e.p[1]).toBeGreaterThan(3);
        expect(e.size).toBeLessThan(1.2);
      }
    }
  });
});

// ---- the pool

describe("the smoke's pool of puffs", () => {
  /** a camera looking straight down on (x, y), `half` m from the middle to the top of the screen */
  const cameraOver = (x: number, y: number, half: number) => {
    const c = new THREE.OrthographicCamera(-half * 1.6, half * 1.6, half, -half, -3000, 6000);
    c.position.set(x, 900, y);
    c.up.set(0, 0, -1);
    c.lookAt(x, 0, y);
    c.updateProjectionMatrix();
    c.updateMatrixWorld();
    return c;
  };
  const works = (kind: string, id: number, x: number) => {
    const b = { id, kind, built: 1, abandoned: 0, plant: { prog: 0.5, level: 1 } } as unknown as Building;
    const e: FxEmitter = { b, kind: "stack", x, y: 0, h: 30, size: 2.8, up: () => true };
    return { b, e };
  };
  /** run the smoke for `secs` with the works' progress going at `pace` batches a cycle */
  const run = (s: Smoke, cam: THREE.OrthographicCamera, bs: Building[], pace: number, secs: number, t0: number) => {
    const dt = 1 / 60;
    let t = t0;
    for (let i = 0; i < secs * 60; i++) {
      t += dt;
      if (Math.floor(t / PLANT_STEP) !== Math.floor((t - dt) / PLANT_STEP)) {
        for (const b of bs) b.plant!.prog = pace > 0 ? (b.plant!.prog + (pace * PLANT_STEP) / 60) % 1 || 0.001 : 0;
      }
      setWind(t, t);
      s.update(cam, (cam.top * 2) / 900, dt, t, null);
    }
    return t;
  };

  it("a running works in view puffs steadily; out of view, or stopped, it does not", () => {
    holdWind(0, 0.4);
    const s = new Smoke();
    const { b, e } = works("smelter", 1, 0);
    s.setEmitters([e]);
    const here = cameraOver(0, 0, 160), away = cameraOver(5000, 5000, 160);
    // (first seen: the pulse has no pace yet)
    let t = run(s, here, [b], 1, 12, 0);
    const P = plumeOf("stack", e.size, 1, newPlume());
    const before = s.emitted;
    t = run(s, here, [b], 1, 20, t);
    const got = s.emitted - before;
    expect(got).toBeGreaterThan(P.rate * 20 * 0.8);
    expect(got).toBeLessThan(P.rate * 20 * 1.2);
    // looking elsewhere: nothing is spent on it
    const n1 = s.emitted;
    t = run(s, away, [b], 1, 10, t);
    expect(s.emitted).toBe(n1);
    // back: its plume is there at once (as if it had never stopped), then steady again
    t = run(s, here, [b], 1, 1 / 60, t);
    expect(s.emitted - n1).toBeGreaterThan(liveOf(P) * 0.7);
    // starved: the stack dies away in well under a minute (a step to notice, two to be sure, then the fire sinks)
    t = run(s, here, [b], 0, 40, t);
    const n2 = s.emitted;
    t = run(s, here, [b], 0, 20, t);
    expect(s.emitted).toBe(n2);
    holdWind();
    s.dispose();
  });

  it("holds still while the game is paused", () => {
    const s = new Smoke();
    const { b, e } = works("coalplant", 2, 0);
    s.setEmitters([e]);
    const cam = cameraOver(0, 0, 160);
    const t = run(s, cam, [b], 1, 15, 0);
    const n = s.emitted;
    for (let i = 0; i < 120; i++) s.update(cam, 0.36, 0, t, null);
    expect(s.emitted).toBe(n);
    s.dispose();
  });

  it("never runs over: a map full of works at once is thinned to fit", () => {
    const s = new Smoke();
    const all = Array.from({ length: 400 }, (_, i) => works("coppersmelter", i + 1, (i % 20) * 12 - 120));
    for (const w of all) w.e.size = 3.6;
    s.setEmitters(all.map((w) => w.e));
    const cam = cameraOver(0, 0, 160);
    run(s, cam, all.map((w) => w.b), 1, 60, 0);
    // (what the mouths ask for at once settles under the pool)
    expect(s.demand).toBeLessThan(POOL);
    expect(s.demand).toBeGreaterThan(POOL * 0.5);
    s.dispose();
  });

  it("draws a plume bigger than life from far off, life-size near in, with no jump between", () => {
    expect(zoomScale(0.18)).toBe(1);
    expect(zoomScale(0.36)).toBe(1);
    expect(zoomScale(3.3)).toBeGreaterThan(2.5);
    expect(zoomScale(20)).toBeLessThanOrEqual(3.2);
    for (let m = 0.2; m < 6; m += 0.05) expect(zoomScale(m + 0.05) - zoomScale(m)).toBeLessThan(0.08);
  });
});
