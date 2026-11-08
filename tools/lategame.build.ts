/**
 * Builds a big late-game company for measuring the whole sim and the renderer: the starting town grown into a City
 * (LATE_POP, default 7000) with two more towns growing alongside, and a dozen industry sites on roads out to their
 * deposits (food, timber, coal, power, iron, limestone and cement), then the real sim run for LATE_HOURS (default 11)
 * so the trucks and commuters are out on the roads. Prints what each sim hour cost, and writes the save to
 * tools/out/lategame.json (load it in the browser with `app.loadGame(...)`).
 *
 *   npx vitest run --config tools/vitest.config.ts tools/lategame.build.ts
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { demandPerDay, gridPt, needsOf } from "../src/game/towns";
import { TOWN_SPACING, type Town } from "../src/game/settlements";
import { F } from "../src/world/gen";
import type { PlacedKind } from "../src/game/placed";
import type { Building } from "../src/game/buildings";
import { dist, v2, type V2 } from "../src/core/math";
import { layRoad } from "../tests/helpers";

const out: string[] = [];
const say = (...a: unknown[]) => { const l = a.join(" "); out.push(l); process.stdout.write(l + "\n"); };

/** A plant beside the street a-b, from fraction t0 of the way along, wherever it first fits (taken as built). */
function placeAlong(g: Game, kind: PlacedKind, a: V2, b: V2, t0 = 0.1): Building | null {
  const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
  for (let t = t0; t < 0.95; t += 12 / L) {
    const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
    for (const side of [1, -1]) for (const o of [35, 50, 70]) {
      const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
      if (!g.placedPlan(kind, p)?.ok) continue;
      const x = g.place(kind, p)!;
      if (x.plant) x.plant.site = undefined;
      x.built = 1;
      return x;
    }
  }
  say(`FAIL place ${kind}`);
  return null;
}

/** Spots on a deposit field from `from` to `to` m out from p, nearest first. */
function deposits(g: Game, field: number, p: V2, from: number, to: number): V2[] {
  const found: V2[] = [];
  for (let r = from; r < to && found.length < 8; r += 100) for (let k = 0; k < 96; k++) {
    const q = v2(p.x + Math.cos((k / 96) * Math.PI * 2) * r, p.y + Math.sin((k / 96) * Math.PI * 2) * r);
    if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q) || found.some((o) => dist(o, q) < 450)) continue;
    let ok = 0;
    for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
    if (ok >= 22) found.push(q);
  }
  return found;
}

/** The town's grid corner nearest `toward` (where a road out of it starts). */
function edgeTo(t: Town, toward: V2) {
  let best = gridPt(t.c, t.ang, 1, 0), bd = Infinity;
  for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
    const q = gridPt(t.c, t.ang, i, j);
    if (dist(q, toward) < bd) { bd = dist(q, toward); best = q; }
  }
  return best;
}

it("builds a late-game company", () => {
  const POP = Number(process.env.LATE_POP ?? 7000);
  const HOURS = Number(process.env.LATE_HOURS ?? 11);
  const g = new Game(7);
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

  // grow the towns: the start town into a City, the others into towns
  const t0 = performance.now();
  // (every town's needs are met, as fastForward meets the one it runs: they all grow, and none starves meanwhile;
  // the sim is here to be measured)
  const daily = g.towns.daily.bind(g.towns);
  g.towns.daily = () => {
    for (const t of g.towns.list) for (const p of needsOf(t.pop)) t.today[p] = Math.max(t.today[p] ?? 0, demandPerDay(p, t.pop));
    daily();
  };
  for (const [t, pop] of [[A, POP], [towns[1], 2500], [towns[2], 1500]] as const) {
    for (let d = 0; d < 120 && t.pop < pop; d++) g.fastForward(t.id, 24);
    say(`${t.name} ${g.towns.sizeName(t)} pop ${t.pop}`);
  }
  say(`grown in ${((performance.now() - t0) / 1000).toFixed(1)} s`);

  // industry: a road out to each deposit, plants along it (the ones that take its product too)
  const chains: [string, number, PlacedKind[]][] = [
    ["farmland", F.fert, ["farm", "farm", "farm", "foodplant"]],
    ["farmland", F.fert, ["farm", "farm", "foodplant"]],
    ["forest", F.forest, ["loggingcamp", "loggingcamp", "sawmill"]],
    ["coal", F.coal, ["coalmine", "coalplant", "smelter"]],
    ["iron ore", F.ore, ["ironmine"]],
    ["limestone", F.lime, ["quarry", "cementworks"]],
  ];
  const used: V2[] = [];
  /** The town's road nearest d (where a road out to it starts, past the town's last houses). */
  const nearestNode = (g: Game, t: Town, d: V2) => {
    let best = t.c, bd = Infinity;
    for (const n of g.net.nodes.values()) if (dist(n.p, t.c) < 2500 && n.p && dist(n.p, d) < bd) { bd = dist(n.p, d); best = n.p; }
    return best;
  };
  for (const [name, field, kinds] of chains) {
    let done = false;
    for (const d of deposits(g, field, A.c, 1500, 7000)) {
      if (done || used.some((u) => dist(u, d) < 900)) continue;
      for (const t of towns) {
        const a = nearestNode(g, t, d);
        const e = v2(d.x + (d.x - a.x) / dist(d, a) * 120, d.y + (d.y - a.y) / dist(d, a) * 120);
        const r = layRoad(g, a, e);
        if (typeof r === "string") continue;
        const [p, q] = r.legs[r.legs.length - 1];
        const got = kinds.map((k, i) => placeAlong(g, k, q, p, i === 0 ? 0.05 : 0.15 + 0.1 * i));
        say(`${name}: road ${(dist(a, e) / 1000).toFixed(1)} km from ${t.name}, ${got.filter(Boolean).length}/${kinds.length} plants`);
        used.push(d);
        done = true;
        break;
      }
    }
    if (!done) say(`FAIL no way out to the ${name}`);
  }

  // (no trucks to buy: each site's fleet comes with its level)

  // the real sim, for the trucks and commuters to come out
  for (let h = 1; h <= HOURS; h++) {
    const s0 = performance.now();
    for (let i = 0; i < HOUR * 30; i++) g.step(1 / 30);
    const ms = (performance.now() - s0) / (HOUR * 30);
    g.money = 1e9;
    const tw = g.towns.list.map((t) => `${t.pop}/${t.households}hh/${t.target.toFixed(0)}`).join(" ");
    say(`h${h} ${tw} abandoned ${g.buildings.list.filter((b) => b.abandoned).length} step ${ms.toFixed(2)} ms vehicles ${g.traffic.vehicles.length} trucks ${g.traffic.vehicles.filter((v) => v.trip.haul).length} failed ${g.failedTrips}`);
  }
  say(`segs ${g.net.segs.size} buildings ${g.buildings.list.length} plants ${g.buildings.list.filter((b) => b.plant).length} pop ${g.towns.list.map((t) => t.pop).join("/")}`);
  mkdirSync("tools/out", { recursive: true });
  writeFileSync("tools/out/lategame.log", out.join("\n"));
  writeFileSync("tools/out/lategame.json", JSON.stringify(g.serialize()));
}, 1800000);
