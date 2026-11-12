/**
 * Builds a late-game company for measuring the whole sim and the renderer, and for the late-save traffic test
 * (tests/latesave.test.ts): the starting town grown to a Town of LATE_POP (default 1600) and two more to a Village and
 * a Hamlet, then the industry that supplies all three on their own (food, timber, cement, glass, household goods and
 * fuel, with the coal, limestone, sand, oil and power behind them). The company then runs LATE_WARM game hours (36)
 * with the towns held where they are, so its works are stocked and its trucks out, and then the real sim LATE_HOURS
 * (48), the towns living on what it delivers: about 250 vehicles on the roads by day, most of them trucks. Prints what
 * each sim hour cost and each town's supply, and writes the save to tools/out/lategame.json (load it in the browser
 * with `app.loadGame(...)`) and, gzipped, to tests/fixtures/lategame.json.gz (the soak test's copy).
 *
 *   npx vitest run --config tools/vitest.config.ts tools/lategame.build.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { gzipSync } from "node:zlib";
import { it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { blockOf, demandPerDay, gridPt, needsOf } from "../src/game/towns";
import { type Town } from "../src/game/settlements";
import { F } from "../src/world/gen";
import type { PlacedKind } from "../src/game/placed";
import type { Building } from "../src/game/buildings";
import { dist, v2, type V2 } from "../src/core/math";
import { layRoad } from "../tests/helpers";
import { stuckNow } from "../src/sim/traffic";

const out: string[] = [];
const say = (...a: unknown[]) => { const l = a.join(" "); out.push(l); process.stdout.write(l + "\n"); };

/**
 * Take a site the game would let the player place at p (on its deposit, with a road at its gate or one the game
 * lays to it, and never over a town's homes or shops), as built and at `level`. Null where it doesn't fit.
 */
function tryPlace(g: Game, kind: PlacedKind, p: V2, level: number, rich = 0): Building | null {
  const pl = g.placedPlan(kind, p);
  if (!pl?.ok || pl.clears?.length || (!pl.access && !pl.link) || (pl.deposit?.share ?? 1) < rich) return null;
  const x = g.place(kind, p);
  if (!x) return null;
  if (x.plant) x.plant.site = undefined;
  x.built = 1;
  while (x.plant && x.plant.level < level) g.industry.levelUp(x);
  return x;
}

/**
 * A site round p (spiralling out to R m), wherever it first fits: an extractor where its deposit is rich (a site on
 * the edge of one, a quarter of it off the deposit, makes three quarters as much), or anywhere on it if none is.
 */
function placeNear(g: Game, kind: PlacedKind, p: V2, level: number, R = 700): Building | null {
  for (const rich of [0.95, 0]) {
    for (let r = 0; r <= R; r += 45) {
      const n = Math.max(1, Math.round((2 * Math.PI * r) / 60));
      for (let k = 0; k < n; k++) {
        const a = (k / n) * Math.PI * 2;
        const x = tryPlace(g, kind, v2(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r), level, rich);
        if (x) return x;
      }
    }
  }
  return null;
}

/** Spots on a deposit field from `from` to `to` m out from p, nearest first. */
function deposits(g: Game, field: number, p: V2, from: number, to: number, cover = 22): V2[] {
  const found: V2[] = [];
  for (let r = from; r < to && found.length < 12; r += 100) for (let k = 0; k < 96; k++) {
    const q = v2(p.x + Math.cos((k / 96) * Math.PI * 2) * r, p.y + Math.sin((k / 96) * Math.PI * 2) * r);
    if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q) || found.some((o) => dist(o, q) < 450)) continue;
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
    if (ok >= cover) found.push(q);
  }
  return found;
}

/** The town's grid corner nearest `toward` (where a road out of it starts). */
function edgeTo(t: Town, toward: V2) {
  let best = gridPt(t.c, t.ang, 1, 0, blockOf(t)), bd = Infinity;
  for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const q = gridPt(t.c, t.ang, i, j, blockOf(t));
    if (dist(q, toward) < bd) { bd = dist(q, toward); best = q; }
  }
  return best;
}

it("builds a late-game company", () => {
  const POP = Number(process.env.LATE_POP ?? 1600);
  mkdirSync("tools/out", { recursive: true });
  const HOURS = Number(process.env.LATE_HOURS ?? 48);
  const WARM_HOURS = Number(process.env.LATE_WARM ?? 36);
  // (seed 33: every deposit a late company needs within 6 km of the start town, sand and oil included)
  const g = new Game(Number(process.env.LATE_SEED ?? 33));
  g.start();
  g.unlockAll();
  g.money = 1e9;
  const A = g.towns.list[0];

  // two more towns, a road from the start town to each
  const towns = [A];
  for (const turn of [Math.PI, Math.PI / 2]) {
    let site: V2 | null = null;
    for (let r = 3200; r < 5000 && !site; r += 100) for (let k = 0; k < 24 && !site; k++) {
      const a = A.ang + turn + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
      const q = v2(A.c.x + Math.cos(a) * r, A.c.y + Math.sin(a) * r);
      if (!g.towns.foundBlock(q) && !g.terrain.has(F.fert, q)) site = q;
    }
    const T = g.towns.found(site!);
    if (typeof T === "string") throw new Error(T);
    const r = layRoad(g, edgeTo(A, T.c), edgeTo(T, A.c));
    say(`town ${T.name} ${(dist(A.c, T.c) / 1000).toFixed(1)} km out, road ${typeof r === "string" ? r : "ok"}`);
    towns.push(T);
  }

  // grow the towns together: each fed in full while under its size and at a level that holds it (between the
  // holding and the growing bands) once there, so none starves while another grows (Game.fastForward feeds only the
  // town it runs; the supply rolls hour by hour)
  const t0 = performance.now();
  const want = new Map([[A.id, POP], [towns[1].id, Math.round(POP * 0.28)], [towns[2].id, Math.round(POP * 0.16)]]);
  const share = (t: Town) => (t.pop < want.get(t.id)! ? 1 : 0.8);
  const daily = g.towns.daily.bind(g.towns), hourly = g.towns.hourly.bind(g.towns);
  g.towns.daily = () => {
    for (const t of g.towns.list) for (const p of needsOf(t.pop)) t.today[p] = Math.max(t.today[p] ?? 0, share(t) * demandPerDay(p, t.pop));
    daily();
  };
  g.towns.hourly = () => {
    for (const t of g.towns.list) t.hourNow = Object.fromEntries(needsOf(t.pop).map((p) => [p, (share(t) * demandPerDay(p, t.pop)) / 24]));
    hourly();
  };
  for (let d = 0; d < 400; d++) {
    const t = towns.find((u) => u.pop < want.get(u.id)!);
    if (!t) break;
    g.fastForward(t.id, 24, share(t));
  }
  // (a day more at the holding level for all: the last one grown settles in)
  g.fastForward(A.id, 24, share(A));
  for (const t of towns) say(`${t.name} ${g.towns.sizeName(t)} pop ${t.pop} target ${t.target.toFixed(0)} households ${t.households}`);
  say(`grown in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  // industry, laid out as a player who knows the game would. Short hauls: at 40 s a game hour a truck covers under
  // half a km an hour, so the trucks out on the roads are the loads a day times the days each haul takes. And each
  // kind of works in one place, sized to what the towns use and no more: a works' inputs, and a town's goods, go to
  // whichever customer has the most room, however far (Industry.customers), so two food plants a town apart would
  // trade crops across the map, a surplus of planks goes to the town farthest off, and a second customer for coal (a
  // glassworks making more glass than the furniture uses) takes half of it from the cement. So: the food, the timber,
  // the cement, the glass and the furniture at a hub between the three towns, with a road to each, and a power plant
  // there burning the sawmill's chips (it burns them first: the coal it takes is one store's worth), which powers the
  // hub and the quarry; the limestone by Juniper Run, the coal south-east of Alder Hollow (the only coal near, its
  // mines unpowered at 40%), sand and oil out past Hollis Forks, the refinery beside the wells (unpowered: enough).
  // Extractors on the rich part of their deposit at level 2 (past it they need fertilizer or explosives), plants at
  // up to level 3; the sites grow on from there on their own. In loads a day the towns take food 87, planks 45 (and 9
  // more for the furniture), cement 27, goods 9 and fuel 8.
  const hub = v2(towns.reduce((s, t) => s + t.c.x, 0) / 3, towns.reduce((s, t) => s + t.c.y, 0) / 3);
  const clusters: { name: string; field: number; at: number | "hub"; ext: [PlacedKind, number, number]; plants: [PlacedKind, number][]; cover?: number }[] = [
    { name: "farmland", field: F.fert, at: "hub", ext: ["farm", 2, 4], plants: [["foodplant", 3], ["foodplant", 2], ["furniture", 1], ["cementworks", 2], ["glassworks", 1]] },
    { name: "forest", field: F.forest, at: "hub", ext: ["loggingcamp", 2, 2], plants: [["sawmill", 2], ["coalplant", 1]] },
    { name: "limestone", field: F.lime, at: 2, ext: ["quarry", 2, 1], plants: [] },
    { name: "coal", field: F.coal, at: 0, ext: ["coalmine", 2, 3], plants: [] },
    // (sand lies in strips along the water)
    { name: "sand", field: F.sand, at: 1, ext: ["sandpit", 1, 1], plants: [], cover: 12 },
    { name: "oil", field: F.oil, at: 1, ext: ["oilwell", 1, 1], plants: [["refinery", 2]] },
  ];
  const used: { d: V2; field: number }[] = [];
  /** The town's road nearest d (where a road out to it starts, past the town's last houses). */
  const nearestNode = (g: Game, t: Town, d: V2) => {
    let best = t.c, bd = Infinity;
    for (const n of g.net.nodes.values()) if (dist(n.p, t.c) < 2500 && n.p && dist(n.p, d) < bd) { bd = dist(n.p, d); best = n.p; }
    return best;
  };
  for (const ch of clusters) {
    const [ext, extLevel, n] = ch.ext;
    const from = ch.at === "hub" ? hub : towns[ch.at].c;
    let left = n, plants = [...ch.plants];
    for (const d of deposits(g, ch.field, from, ch.at === "hub" ? 0 : towns[ch.at].reach + 150, 7000, ch.cover)) {
      if (left <= 0) break;
      if (used.some((u) => u.field === ch.field && dist(u.d, d) < 800) || g.towns.townAt(d)) continue;
      // (a road from the nearest town, past the deposit; a hub's from each town)
      const by = ch.at === "hub" ? [...towns].sort((p, q) => dist(p.c, d) - dist(q.c, d)) : [towns[ch.at]];
      const a = nearestNode(g, by[0], d);
      const e = v2(d.x + (d.x - a.x) / dist(d, a) * 120, d.y + (d.y - a.y) / dist(d, a) * 120);
      const had = new Set(g.net.segs.keys());
      if (typeof layRoad(g, a, e) === "string") continue;
      const links = by.slice(1).map((t) => layRoad(g, nearestNode(g, t, d), d));
      // (a hub's roads carry all three towns' freight in and out, through the junction where its links meet: as a
      // street they queued 20 to 30 trucks round the clock, so the player widens them to avenues, as one would)
      if (ch.at === "hub") for (const id of [...g.net.segs.keys()].filter((id) => !had.has(id))) g.upgradeFree(id, "avenue");
      used.push({ d, field: ch.field });
      let got = 0;
      for (; left > 0; left--, got++) if (!placeNear(g, ext, d, extLevel, 1000)) break;
      // (the works that take its product beside it)
      const placed = plants.filter(([k, lv]) => !!placeNear(g, k, d, lv, 1200));
      plants = plants.filter((x) => !placed.includes(x));
      say(`${ch.name}: road ${(dist(a, e) / 1000).toFixed(1)} km from ${by[0].name}${links.map((r, i) => `, ${by[i + 1].name} ${typeof r === "string" ? r : "linked"}`).join("")}, ${got} ${ext}, ${placed.map(([k]) => k).join(" ") || "no plants"}`);
    }
    if (left > 0) say(`FAIL ${left} ${ext} short`);
    if (plants.length) say(`FAIL no room for ${plants.map(([k]) => k).join(" ")}`);
  }

  // (no trucks to buy: each site's fleet comes with its level)

  // the company runs a day and a half with the towns still held where they are, so its works are stocked and its
  // trucks out on the roads (as in a game that has run for hours) before the towns live on what it delivers
  const t1 = performance.now();
  for (let i = 0; i < WARM_HOURS * HOUR * 30; i++) g.step(1 / 30);
  say(`warmed up ${WARM_HOURS} h in ${((performance.now() - t1) / 1000).toFixed(1)} s: vehicles ${g.traffic.vehicles.length}`);
  g.towns.daily = daily;
  g.towns.hourly = hourly;

  // the real sim, the towns living on what the company delivers
  let peak = 0;
  for (let h = 1; h <= HOURS; h++) {
    const s0 = performance.now();
    let most = 0;
    for (let i = 0; i < HOUR * 30; i++) { g.step(1 / 30); if (i % 30 === 0) most = Math.max(most, g.traffic.vehicles.length); }
    const ms = (performance.now() - s0) / (HOUR * 30);
    peak = Math.max(peak, most);
    g.money = 1e9;
    const tw = g.towns.list.map((t) => `${t.pop}/${t.households}hh/${t.target.toFixed(0)}@${Math.round((t.level ?? 0) * 100)}%`).join(" ");
    const tr = g.traffic, still = tr.vehicles.filter((v) => stuckNow(v, 15));
    const longest = Math.max(0, ...tr.vehicles.map((v) => (stuckNow(v, 0) ? v.stuck : 0)));
    say(`h${h} ${g.hour.toFixed(0)}:00 ${tw} step ${ms.toFixed(2)} ms vehicles ${tr.vehicles.length} (most ${most}) trucks ${tr.vehicles.filter((v) => v.trip.haul).length} failed ${g.failedTrips} standing ${still.length} longest ${longest.toFixed(0)} s rings ${tr.waitCycles(15).length} releases ${tr.cycleReleases} breaks ${tr.jamBreaks} quits ${tr.jamQuits}`);
    if (process.env.LATE_DIAG && still.length > 10) {
      // where they stand: by the junction each waits at (or the lane end it stands on)
      const at = new Map<string, { n: number; p: V2; worst: number }>();
      for (const v of still) {
        const node = v.next ? (v.next as { node?: number }).node : undefined;
        const k = node !== undefined ? `node ${node}` : `edge ${(v.edge as { seg?: number }).seg}`;
        const e = at.get(k) ?? { n: 0, p: v2(v.x, v.y), worst: 0 };
        e.n++; e.worst = Math.max(e.worst, v.stuck);
        at.set(k, e);
      }
      for (const [k, e] of [...at].sort((a, b) => b[1].n - a[1].n).slice(0, 6)) say(`    ${k} at ${e.p.x.toFixed(0)},${e.p.y.toFixed(0)}: ${e.n} standing, worst ${e.worst.toFixed(0)} s`);
    }
    if (process.env.LATE_SNAP && h === Number(process.env.LATE_SNAP)) writeFileSync("tools/out/snap.json", JSON.stringify(g.serialize()));
    if (h % 24 === 0) for (const t of g.towns.list) say(`  ${t.name} yesterday ${needsOf(t.pop).map((p) => `${p} ${(t.yesterday?.[p] ?? 0).toFixed(0)}/${demandPerDay(p, t.pop).toFixed(0)}`).join(", ")}`);
  }
  const sites = g.buildings.list.filter((b) => b.plant);
  say(`segs ${g.net.segs.size} buildings ${g.buildings.list.length} plants ${sites.length} pop ${g.towns.list.map((t) => t.pop).join("/")} peak vehicles ${peak}`);
  for (const b of sites) say(`  ${b.kind} L${b.plant!.level} yield ${b.plant!.yld.toFixed(2)}: ${b.problem ?? ""} ${b.plant!.why ?? ""}`);
  writeFileSync("tools/out/lategame.log", out.join("\n"));
  const json = JSON.stringify(g.serialize());
  writeFileSync("tools/out/lategame.json", json);
  writeFileSync("tests/fixtures/lategame.json.gz", gzipSync(json, { level: 9 }));
}, 3600000);
