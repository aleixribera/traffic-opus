/**
 * Builds the showcase city that plays behind the main menu, with the game's own tools (planner, zoning, services),
 * grows it for a few game days and writes it as a save to public/showcase.json.
 *
 *   npx vitest run --config tools/vitest.config.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { MILESTONES } from "../src/game/progression";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import type { ServiceKind } from "../src/game/services";
import type { ZoneId } from "../src/game/zones";
import { LEVEL_H, TILE, type RoadTypeId } from "../src/config";
import { add, cubicAt, dist, dot, norm, scale, sub, v2, type V2 } from "../src/core/math";
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
    service(kind: ServiceKind, p: V2) {
      // look around p for a spot that fits
      for (let r = 0; r <= 120; r += 10) {
        for (let k = 0; k < (r ? 12 : 1); k++) {
          const q = add(p, v2(Math.cos((k * Math.PI) / 6) * r, Math.sin((k * Math.PI) / 6) * r));
          if (g.placeService(kind, q)) { say(`service ${kind} at ${q.x.toFixed(0)},${q.y.toFixed(0)}`); return true; }
        }
      }
      say(`FAIL service ${kind} near ${p.x},${p.y}`);
      return false;
    },
  };
  return B;
}

/** The motorway near a point: centre, direction of travel of each carriageway, and which side each is on. */
function motorwayFrame(g: Game, near: V2) {
  let best: { p: V2; dir: V2; id: number }[] = [];
  for (const s of g.net.segs.values()) {
    if (s.type !== "hw2") continue;
    let bp = s.c.p0, bd = Infinity, bt = 0;
    for (let i = 0; i <= 64; i++) { const p = cubicAt(s.c, i / 64); const d = dist(p, near); if (d < bd) { bd = d; bp = p; bt = i / 64; } }
    if (bd < 120) {
      const dir = norm(sub(cubicAt(s.c, Math.min(1, bt + 0.01)), cubicAt(s.c, Math.max(0, bt - 0.01))));
      best.push({ p: bp, dir, id: s.id });
    }
  }
  best.sort((a, b) => dist(a.p, near) - dist(b.p, near));
  // one point per carriageway (opposite directions)
  const c1 = best[0];
  const c2 = best.find((b) => dot(b.dir, c1.dir) < 0)!;
  const centre = scale(add(c1.p, c2.p), 0.5);
  const u = c1.dir; // along carriageway 1's travel
  const n = v2(-u.y, u.x);
  return { centre, u, n, cw: [c1, c2] };
}

it("builds the showcase city", () => {
  const g = new Game(7);
  g.milestone = MILESTONES.length - 1;
  g.money = 1e9;
  for (let i = -3; i <= 3; i++) for (let j = -3; j <= 3; j++) g.tiles.add(`${i},${j}`);
  g.zones.rebuildAll();
  g.cityName = "Brightwater";
  const B = mk(g);

  // City frame: X metres west of the motorway (the city side), Y metres along it (south is +Y, towards the lake).
  const F = motorwayFrame(g, v2(600, 0));
  const west = dot(sub(v2(0, 0), F.centre), F.n) > 0 ? 1 : -1;
  const nx = scale(F.n, west), uy = F.u;
  const P = (X: number, Y: number) => add(add(F.centre, scale(nx, X)), scale(uy, Y));
  const XY = (p: V2) => ({ X: dot(sub(p, F.centre), nx), Y: dot(sub(p, F.centre), uy) });
  say(`motorway centre ${F.centre.x.toFixed(0)},${F.centre.y.toFixed(0)}`);

  // ---------------------------------------------------------------- the interchange: a diamond with an overpass
  const JW = P(230, 0), JE = P(-230, 0);
  B.path("main avenue", [P(-560, 0), JE, P(-90, 0), P(90, 0), JW, P(300, 0), P(550, 0), P(800, 0), P(1100, 0), P(1450, 0)], "avenueM", [0, 0, 1, 1, 0, 0, 0, 0, 0, 0]);
  for (const c of F.cw) {
    const side = dot(sub(c.p, F.centre), nx) > 0 ? 1 : -1;
    const J = side > 0 ? JW : JE;
    const onCw = (s: number) => add(c.p, scale(c.dir, s));
    // ramp: a slip curve off the carriageway, then a short leg that meets the cross road square-ish
    const up = dot(c.dir, uy) > 0 ? -1 : 1; // the Y side traffic on this carriageway comes from
    B.road(`exit ${side}`, onCw(-340), P(side * 150, up * 120), "hw1", { mode: "continuous" });
    B.road(`exit leg ${side}`, P(side * 150, up * 120), J, "hw1", { mode: "continuous" });
    B.road(`entry leg ${side}`, J, P(side * 150, -up * 120), "hw1", { mode: "continuous" });
    B.road(`entry ${side}`, P(side * 150, -up * 120), onCw(340), "hw1", { mode: "continuous" });
  }

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

  // ---------------------------------------------------------------- industry across the motorway
  B.path("works avenue", [P(-360, -330), P(-360, 0), P(-360, 330), P(-360, 600)], "avenue");
  B.path("works outer", [P(-640, -330), P(-640, 0), P(-640, 330), P(-640, 600)], "street");
  for (const Y of [-170, 170]) B.road(`works cross ${Y}`, P(-360, Y), P(-640, Y), "street");
  for (const Y of [-330, 330, 600]) B.road(`works cross ${Y}`, P(-200, Y), P(-640, Y), "street");
  B.road("works link", P(-200, 330), P(-200, 600), "street");

  // ---------------------------------------------------------------- services (before zoning, so they get good spots)
  B.service("hospital", P(870, 90));
  B.service("firestation", P(490, 60));
  B.service("police", P(740, -240));
  B.service("clinic", P(1200, 560));
  B.service("school", P(1050, -210));
  B.service("school", P(700, 760));
  B.service("highschool", P(1300, 250));
  B.service("university", P(1250, 950));
  B.service("parklarge", P(650, -470));
  B.service("park", P(1040, -440));
  B.service("park", P(480, 380));
  B.service("park", P(960, 950));
  B.service("garbage", P(-520, 450));

  // ---------------------------------------------------------------- zoning by district
  const z = (name: string, zone: ZoneId, f: (X: number, Y: number) => boolean) => B.zone(name, zone, (p) => { const q = XY(p); return f(q.X, q.Y); });
  z("main avenue shops", "comHigh", (X, Y) => X > 300 && X < 800 && Math.abs(Y) < 55);
  z("offices", "offHigh", (X, Y) => X > 240 && X < 560 && Y > -380 && Y < 330);
  z("downtown towers", "resHigh", (X, Y) => X > 540 && X < 820 && Y > -380 && Y < 330);
  z("riverside flats", "resMed", (X, Y) => Y < -370);
  z("central shops", "comLow", (X, Y) => Math.abs(X - 800) < 50 || Math.abs(Y - 650) < 55);
  z("downtown south", "resMed", (X, Y) => X > 240 && X < 820 && Y >= 330 && Y < 660);
  z("suburbs north", "resLow", (X, Y) => X > 800 && Y < 0);
  z("row houses", "resRow", (X, Y) => X > 800 && Y >= 0 && Y < 650);
  z("south homes", "resLow", (X, Y) => X > 240 && Y >= 650);
  z("works offices", "offLow", (X, Y) => X < 0 && X > -360 && Math.abs(Y) < 60);
  z("works", "ind", (X, Y) => X < 0);

  say(`zoned cells ${[...g.zones.allCells()].filter((c) => c.zone).length}`);

  // ---------------------------------------------------------------- grow it
  const HOURS = Number(process.env.SHOWCASE_HOURS ?? 24);
  const t0 = Date.now();
  for (let h = 1; h <= HOURS; h++) {
    for (let i = 0; i < HOUR * 30; i++) g.step(1 / 30);
    g.money = 1e9;
    if (h % 4 === 0) {
      const st = g.people.stats;
      say(`h${h} pop ${st.population} buildings ${g.buildings.list.length} cars ${g.traffic.vehicles.length} failed ${g.failedTrips} ${((Date.now() - t0) / 1000).toFixed(0)}s`);
    }
  }
  say(`segs ${g.net.segs.size} buildings ${g.buildings.list.length}`);
  mkdirSync("tools/out", { recursive: true });
  writeFileSync("tools/out/showcase.log", log.join("\n"));
  writeFileSync("tools/out/showcase.json", JSON.stringify(g.serialize()));
}, 600000);
