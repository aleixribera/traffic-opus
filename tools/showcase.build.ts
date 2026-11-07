/**
 * Builds the showcase city that plays behind the main menu, with the game's own tools (planner, zoning, a power
 * plant), grows it for a few game days and writes it as a save to tools/out/showcase.json (copy it to public/).
 *
 *   npx vitest run --config tools/vitest.config.ts tools/showcase.build.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { milestoneFor } from "../src/game/progression";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import type { PlacedKind } from "../src/game/placed";
import type { ZoneId } from "../src/game/zones";
import { LEVEL_H, type RoadTypeId } from "../src/config";
import { add, dist, dot, scale, sub, v2, type V2 } from "../src/core/math";
import { planGrid, planRoad, planRoundabout, snap, type CurveMode, type Snap } from "../src/roads/planner";

const log: string[] = [];
const say = (s: string) => { log.push(s); console.log(s); };

function mk(g: Game) {
  const sn = (p: V2, level: number, type: RoadTypeId): Snap => {
    const s = snap(g.net, p, { mpp: 0.4, level, type });
    return s.node !== undefined || s.seg !== undefined ? s : { p, h: level * LEVEL_H, guides: [] };
  };
  const B = {
    /** A road from a to b, joining whatever is there. levels: [start, end]. */
    road(name: string, a: V2, b: V2, type: RoadTypeId, o: { la?: number; lb?: number; mode?: CurveMode; ctrl?: V2 } = {}) {
      const start = sn(a, o.la ?? 0, type), end = sn(b, o.lb ?? 0, type);
      const plan = planRoad(g.net, g.world, { start, end, mode: o.mode ?? (o.ctrl ? "curve" : "straight"), type, ctrl: o.ctrl });
      if (plan.errors.length) { say(`FAIL road ${name}: ${plan.errors.map((e) => e.msg).join("; ")}`); return false; }
      if (!g.build(plan)) { say(`FAIL build ${name}`); return false; }
      return true;
    },
    /** A road through several points, each piece joining the last. */
    path(name: string, pts: V2[], type: RoadTypeId, levels?: number[]) {
      for (let i = 0; i + 1 < pts.length; i++) B.road(`${name}#${i}`, pts[i], pts[i + 1], type, { la: levels?.[i] ?? 0, lb: levels?.[i + 1] ?? 0 });
    },
    grid(name: string, a: V2, b: V2, axis: V2, type: RoadTypeId) {
      const plan = planGrid(g.net, g.world, a, b, axis, type, 0);
      if (plan.errors.length) { say(`FAIL grid ${name}: ${plan.errors.map((e) => e.msg).join("; ")}`); return false; }
      if (!g.build(plan)) { say(`FAIL build grid ${name}`); return false; }
      return true;
    },
    roundabout(name: string, c: V2, size: 1 | 2 | 3 | 4) {
      const plan = planRoundabout(g.net, g.world, c, size, 0);
      if (plan.errors.length) { say(`FAIL roundabout ${name}: ${plan.errors.map((e) => e.msg).join("; ")}`); return false; }
      if (!g.build(plan)) { say(`FAIL build roundabout ${name}`); return false; }
      return true;
    },
    /** Zone every free cell within the polygon-ish test. */
    zone(name: string, zone: ZoneId, inside: (p: V2) => boolean) {
      const cells = [...g.zones.allCells()].filter((c) => c.ok && !c.zone && inside(c.c));
      const n = g.zonePaint(cells, zone);
      say(`zone ${name} ${zone}: ${n} cells`);
    },
    place(kind: PlacedKind, p: V2) {
      // look around p for a spot that fits
      for (let r = 0; r <= 120; r += 10) {
        for (let k = 0; k < (r ? 12 : 1); k++) {
          const q = add(p, v2(Math.cos((k * Math.PI) / 6) * r, Math.sin((k * Math.PI) / 6) * r));
          if (g.place(kind, q)) { say(`place ${kind} at ${q.x.toFixed(0)},${q.y.toFixed(0)}`); return true; }
        }
      }
      say(`FAIL place ${kind} near ${p.x},${p.y}`);
      return false;
    },
  };
  return B;
}

/**
 * The town's frame: X runs east from the industrial side into the town, Y south towards the lake. (It is where the
 * old pre-built motorway ran, so the districts sit on the land they were planned for.)
 */
const FRAME = { centre: v2(635, 20), nx: v2(-0.8738, -0.4863), uy: v2(-0.4863, 0.8738) };

it("builds the showcase city", () => {
  const g = new Game(7);
  g.milestone = 9; // everything unlocked while it is built
  g.money = 1e9;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) g.tiles.add(`${i},${j}`);
  g.zones.rebuildAll();
  g.cityName = "Brightwater";
  const B = mk(g);

  // City frame: X metres into the town from the strip between it and the works, Y metres along it (south is +Y,
  // towards the lake).
  const { centre, nx, uy } = FRAME;
  const P = (X: number, Y: number) => add(add(centre, scale(nx, X)), scale(uy, Y));
  const XY = (p: V2) => ({ X: dot(sub(p, centre), nx), Y: dot(sub(p, centre), uy) });

  // ---------------------------------------------------------------- the spine: one avenue from the works to the far side of town
  B.path("main avenue", [P(-640, 0), P(-360, 0), P(-200, 0), P(300, 0), P(550, 0), P(800, 0), P(1100, 0), P(1450, 0)], "avenueM");

  // ---------------------------------------------------------------- arterials
  B.path("frontage", [P(300, -380), P(300, 0), P(300, 650), P(300, 1050)], "avenue");
  B.path("central avenue", [P(800, -380), P(800, 0), P(800, 650), P(800, 1050)], "avenue");
  B.path("riverside", [P(300, -380), P(550, -380), P(800, -380), P(1100, -380), P(1450, -380)], "avenue");
  B.path("outer", [P(1450, -380), P(1450, 0), P(1450, 650), P(1450, 1050)], "street");
  B.path("south boulevard", [P(300, 650), P(550, 650), P(800, 650), P(1100, 650), P(1450, 650)], "boulevardM");
  B.path("south edge", [P(300, 1050), P(800, 1050), P(1450, 1050)], "street");

  // ---------------------------------------------------------------- downtown (X 300..800, Y -380..650)
  B.path("market street", [P(550, -380), P(550, 0), P(550, 650)], "avenue");
  for (const X of [425, 675]) B.path(`downtown ${X}`, [P(X, -380), P(X, 0), P(X, 650)], "street");
  // a one-way pair through the core
  B.road("couplet east", P(300, -190), P(800, -190), "one2");
  B.road("couplet west", P(800, -100), P(300, -100), "one2");
  for (const Y of [-285, 110, 220, 330, 440, 545]) B.road(`downtown cross ${Y}`, P(300, Y), P(800, Y), "street");

  // ---------------------------------------------------------------- north-east suburbs: curving streets
  B.road("crescent 1", P(800, -280), P(1450, -280), "street", { ctrl: P(1125, -200) });
  B.road("crescent 2", P(800, -130), P(1450, -130), "street", { ctrl: P(1125, -60) });
  B.road("crescent link", P(1125, -380), P(1125, 0), "street");

  // ---------------------------------------------------------------- south-east: row houses round a roundabout
  B.roundabout("central roundabout", P(800, 650), 3);
  for (const X of [960, 1120, 1290]) B.road(`row street ${X}`, P(X, 0), P(X, 650), "street");
  for (const Y of [160, 320, 480]) B.road(`row cross ${Y}`, P(800, Y), P(1450, Y), "street");

  // ---------------------------------------------------------------- far south: a quiet loop of low homes
  B.road("south loop a", P(550, 650), P(550, 1050), "street", { ctrl: P(500, 850) });
  B.road("south loop b", P(1125, 650), P(1125, 1050), "street", { ctrl: P(1180, 850) });
  B.road("south cross", P(300, 850), P(1450, 850), "street", { ctrl: P(875, 800) });

  // ---------------------------------------------------------------- industry across the green strip
  B.path("works avenue", [P(-360, -330), P(-360, 0), P(-360, 330), P(-360, 600)], "avenue");
  B.path("works outer", [P(-640, -330), P(-640, 0), P(-640, 330), P(-640, 600)], "street");
  for (const Y of [-170, 170]) B.road(`works cross ${Y}`, P(-360, Y), P(-640, Y), "street");
  for (const Y of [-330, 330, 600]) B.road(`works cross ${Y}`, P(-200, Y), P(-640, Y), "street");
  B.road("works link", P(-200, 330), P(-200, 600), "street");
  // a second way from the works into town, so works traffic to the south of the city needn't all use the main avenue
  B.path("south link", [P(-200, 600), P(50, 625), P(300, 650)], "avenue");
  B.path("north link", [P(-200, -330), P(50, -355), P(300, -380)], "street");

  // where the avenues cross the main one carries the most turning traffic: signals, as any CS player would add
  for (const J of [P(300, 0), P(800, 0), P(-360, 0)]) {
    let id = -1, bd = 25;
    for (const [nid, n] of g.net.nodes) { const d = dist(n.p, J); if (d < bd) { bd = d; id = nid; } }
    const pl = id >= 0 ? g.defaultSignal(id) : null;
    say(pl && g.setSignal(id, pl) ? `signals at node ${id}` : `FAIL signals near ${J.x.toFixed(0)},${J.y.toFixed(0)}`);
  }

  // ---------------------------------------------------------------- a power plant out by the works (before zoning, so it gets a good spot)
  B.place("coalplant", P(-560, -230));

  // ---------------------------------------------------------------- zoning by district
  const z = (name: string, zone: ZoneId, f: (X: number, Y: number) => boolean) => B.zone(name, zone, (p) => { const q = XY(p); return f(q.X, q.Y); });
  z("main avenue shops", "comHigh", (X, Y) => X > 300 && X < 800 && Math.abs(Y) < 55);
  z("big stores", "comHigh", (X, Y) => X > 240 && X < 560 && Y > -380 && Y < 120);
  z("downtown towers", "resHigh", (X, Y) => X > 240 && X < 820 && Y > -380 && Y < 330);
  z("riverside flats", "resMed", (X, Y) => Y < -370);
  z("central shops", "comLow", (X, Y) => Math.abs(X - 800) < 50 || Math.abs(Y - 650) < 55);
  z("downtown south", "resMed", (X, Y) => X > 240 && X < 820 && Y >= 330 && Y < 660);
  z("suburbs north", "resLow", (X, Y) => X > 800 && Y < 0);
  z("row houses", "resRow", (X, Y) => X > 800 && Y >= 0 && Y < 650);
  z("south homes", "resLow", (X, Y) => X > 240 && Y >= 650);
  z("works", "ind", (X, Y) => X < 0);

  say(`zoned cells ${[...g.zones.allCells()].filter((c) => c.zone).length}`);

  // ---------------------------------------------------------------- grow it
  const HOURS = Number(process.env.SHOWCASE_HOURS ?? 120);
  // why trips fail while the city grows (logged every 4 hours)
  const why: Record<string, number> = {};
  const tev = (g.traffic as any).ev, fail0 = tev.fail;
  tev.fail = (trip: any, reason: string, now: number) => { const k = `${reason}/${trip.kind}`; why[k] = (why[k] ?? 0) + 1; fail0(trip, reason, now); };
  const t0 = Date.now();
  for (let h = 1; h <= HOURS; h++) {
    for (let i = 0; i < HOUR * 30; i++) g.step(1 / 30);
    g.money = 1e9;
    if (h % 4 === 0) {
      const st = g.people.stats;
      say(`h${h} pop ${st.population} buildings ${g.buildings.list.length} cars ${g.traffic.vehicles.length} failed ${g.failedTrips} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
      if (Object.keys(why).length) say(`  fails ${JSON.stringify(why)}`);
      say(`  demand ${(["res", "com", "ind"] as const).map((k) => `${k} ${g.demand[k].v} [${g.demand[k].factors.map((f) => `${f.label} ${f.v}`).join(", ")}]`).join(" | ")}`);
      const u = g.utilities.stats;
      say(`  power made ${u.power.made.toFixed(1)} used ${u.power.used.toFixed(1)} short ${u.power.short.toFixed(1)}`);
    }
  }
  // what a city this size would have reached, and a treasury to match
  g.milestone = milestoneFor(g.people.stats.population);
  g.money = 240_000;
  say(`segs ${g.net.segs.size} buildings ${g.buildings.list.length} milestone ${g.milestone}`);
  mkdirSync("tools/out", { recursive: true });
  writeFileSync("tools/out/showcase.log", log.join("\n"));
  writeFileSync("tools/out/showcase.json", JSON.stringify(g.serialize()));
}, 1800000);
