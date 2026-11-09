// The game to Town size, played headless: a scripted company on seed 7 plays from the start the way a player would
// (a food chain, timber, a road to each town that springs up, then tier 2's mines, power plant, smelter, quarry and cement works, then tier
// 3's oil, sand, glass, household goods and construction parts) and spends only what it has. Like a player watching
// the Towns window, it adds a plant to a chain a town goes short of, and a truck to a plant whose yard is full. It
// checks the milestones come in the ladder's order, that the company stays solvent all the way and that money is
// never what holds it up once tier 3 opens, and prints the timeline: the numbers docs/design.md's "Pacing" is judged
// on. (`npx vitest run tests/balance.test.ts --disableConsoleIntercept` shows it; with BALANCE_T3=1 it plays tier 3 too,
// with BALANCE_T4=1 on through tier 4's copper, electronics and machinery, and with BALANCE_T5=1 on through the deeper
// chains: the dairy and creamery, the chemical works' supplies, the rubber plant and the Motor Works' first car.)

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import type { Trip } from "../src/sim/traffic";
import { DAY, HOUR } from "../src/game/society";
import { BLOCK, TOWN_SIZES, gridPt, needsOf, sizeOf } from "../src/game/towns";
import { type Town } from "../src/game/settlements";
import { PLANTS, PRODUCTS, type PlantKind, type Product } from "../src/game/industry";
import { MILESTONES, OPEN_AT_ONCE } from "../src/game/progression";
import { F } from "../src/world/gen";
import { BUILDING_TYPES } from "../src/config";
import { add, dist, norm, scale, sub, v2, type V2 } from "../src/core/math";
import { layRoad, roadErrors } from "./helpers";
import type { Building } from "../src/game/buildings";

/** (the test runs in Node; the project has no Node types) */
declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };

/**
 * BALANCE_T4=1 plays on past tier 3 into tier 4: a copper mine far out in the ranges, a copper smelter, an electronics
 * plant and a machine works, until the first electronics and machinery are made (or the days run out). It implies
 * BALANCE_T3 and takes longer still.
 */
/**
 * BALANCE_T5=1 plays on past tier 4 through the deeper chains: a dairy on the soil and a creamery by the farms, a
 * chemical works at the hub feeding fertilizer and explosives back to the farms and mines, then a rubber plant and the
 * Motor Works, until the first car is sold to a town. It implies BALANCE_T4 and is the longest run of all.
 */
const T5 = !!process.env.BALANCE_T5;
/**
 * SHOWCASE=1 builds the city behind the main menu instead of checking the pace: it plays into tier 4, founds up to five
 * towns (past the milestone slots: it is a picture, never a player's save) and stops once the five hold
 * SHOWCASE_POP people between them (3000 by default), writing the save to tools/out/showcase.json (copy it to public/).
 */
const SHOWCASE = !!process.env.SHOWCASE;
const SHOWCASE_POP = Number(process.env.SHOWCASE_POP ?? 3000);
const T4 = !!process.env.BALANCE_T4 || T5 || SHOWCASE;
/**
 * BALANCE_DAYS=n stops the run after n days: a quick smoke check that the scripted company's plan runs without throwing
 * and stays solvent. The milestone expectations, which need the full run, are skipped.
 */
const DAYS_CAP = Number(process.env.BALANCE_DAYS) || 0;
const MAX_DAYS = DAYS_CAP || (SHOWCASE ? 240 : T5 ? 170 : T4 ? 120 : 70);
/**
 * BALANCE_T3=1 plays on past first cement through tier 3 to a supplied Town and checks that leg too. It runs an hour or
 * more (the towns grow to thousands of people, all driving), so the everyday suite stops at first cement.
 */
const T3 = !!process.env.BALANCE_T3 || T4;
/** BALANCE_LIVE=1 prints the timeline as it happens too (a long run shows where it is). */
const LIVE = !!process.env.BALANCE_LIVE;
/**
 * The pace the game is held to: a Village, first steel and first cement, first fuel and goods, and a Town, by these
 * days (a day is 16 minutes at 1x; docs/design.md "Pacing" wants a Village in 20-30 minutes, steel and cement in
 * about an hour and a half: these leave the scripted company some slack). Steel has two more days of it since
 * construction got five times the loads (2026-11-08: a mine waits for 30 planks, a power plant 40, a smelter 50,
 * 150 trucked out before the first steel where it was 30): with that bill the company makes it on day 9 or so.
 */
const VILLAGE_BY = 3, STEEL_BY = 10, CEMENT_BY = 10, FUEL_BY = 40, GOODS_BY = 45, TOWN_BY = 60;
/** What the company keeps in hand for wages and fuel: it doesn't build with its last dollars. */
const RESERVE = 8000;
/** What makes each product: the plant a chain short of it gets another of. */
const MAKER: Partial<Record<Product, PlantKind>> = {
  food: "foodplant", crops: "farm", planks: "sawmill", logs: "loggingcamp", cement: "cementworks", lime: "quarry",
  coal: "coalmine", ore: "ironmine", steel: "smelter", crude: "oilwell", fuel: "refinery", sand: "sandpit",
  glass: "glassworks", goods: "furniture", parts: "constructionplant",
  copperore: "coppermine", copper: "coppersmelter", electronics: "electronics", machinery: "machineworks",
  fertilizer: "chemworks", explosives: "chemworks", milk: "dairyfarm", cheese: "creamery", rubber: "rubberplant",
  cars: "motorworks",
};

function play() {
  const g = new Game(7);
  g.start();
  const lines: string[] = [];
  const stamp = () => `day ${(g.time / DAY).toFixed(2).padStart(5)}`;
  const put = (s: string) => { lines.push(s); if (LIVE) process.stderr.write(s + "\n"); };
  const say = (s: string) => put(`${stamp()}  ${s}`);
  /** Hours a build waited for money once tier 3 was open (money should never be the wall by then). */
  let poorHours = 0, poorAt = -1;
  const poor = () => { if (g.progress.unlocked.buildings.has("oilwell") && poorAt !== Math.floor(g.time / HOUR)) { poorAt = Math.floor(g.time / HOUR); poorHours++; } };
  const reached: { id: string; t: number }[] = [];
  /** the towns that sprang up (a milestone's reward): when, how far from the nearest town, and joined yet */
  const spawned: { t: Town; at: number; dist: number; joined: number }[] = [];
  g.on((e) => {
    if (e.t === "milestone") { reached.push({ id: e.m.id, t: g.time }); say(`MILESTONE ${e.m.name} (${e.m.id}) · $${Math.round(g.money).toLocaleString("en-US")}`); }
    if (e.t === "townSpawned") {
      const t = g.towns.byId.get(e.town)!;
      spawned.push({ t, at: g.time, dist: e.dist, joined: -1 });
      say(`NEW TOWN ${t.name}: ${(e.dist / 1000).toFixed(1)} km ${e.dir} of ${e.from === null ? "nowhere" : g.towns.byId.get(e.from)!.name}, ${(dist(t.c, A.c) / 1000).toFixed(1)} km from ${A.name}`);
    }
  });

  // ---------------------------------------------------------------- building, as a player would, with the money there is
  /** The straight legs of the last road built (one, two round an obstacle, or three over a bridge). */
  let lastLegs: [V2, V2][] = [];
  /** why the last site() found no plot (plan refusals, counted) */
  const siteWhy = new Map<string, number>();
  /** A street from a to b, as a player would get one through (round an obstacle, or over a bridge): built, too dear for now, or no way through. */
  const road = (name: string, a: V2, b: V2): true | "money" | "blocked" => {
    const r = layRoad(g, a, b, g.money - RESERVE);
    if (r === "money") poor();
    if (typeof r === "string") return r;
    say(`road ${name}: ${(dist(a, b) / 1000).toFixed(2)} km${r.bridge ? ` with a ${Math.round(r.bridge)} m bridge` : ""}, $${Math.round(r.cost).toLocaleString("en-US")}`);
    lastLegs = r.legs;
    return true;
  };
  /** A plant beside the street a-b, from fraction t0 of the way along toward t1. */
  const place = (kind: PlantKind, a: V2, b: V2, t0 = 0.5, t1 = 0.95): Building | null => {
    if (PLANTS[kind].cost > g.money - RESERVE) { poor(); return null; }
    const L = dist(a, b), n = v2(-(b.y - a.y) / L, (b.x - a.x) / L);
    const steps = Math.ceil(Math.abs(t1 - t0) * L / 12);
    for (let k = 0; k <= steps; k++) {
      const t = t0 + (t1 - t0) * (k / steps);
      const q = v2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
      for (const side of [1, -1]) for (const o of [35, 50]) {
        const p = v2(q.x + side * n.x * o, q.y + side * n.y * o);
        const pl = g.placedPlan(kind, p);
        if (pl?.ok) {
          const x = g.place(kind, p)!;
          say(`place ${kind}${x.plant!.yld < 1 ? ` (${Math.round(x.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(p, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
          return x;
        }
      }
    }
    return null;
  };
  /** The nearest spot to p (from `from` m out) whose 75 m square is mostly on a deposit field. */
  const deposit = (field: number, p: V2, from: number, to: number): V2 | null => {
    for (let r = from; r < to; r += 50) for (let k = 0; k < 96; k++) {
      const q = v2(p.x + Math.cos((k / 96) * Math.PI * 2) * r, p.y + Math.sin((k / 96) * Math.PI * 2) * r);
      if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q)) continue;
      let ok = 0;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
      if (ok >= 23) return q;
    }
    return null;
  };
  const isBuilt = (q: V2) => [...g.net.nodes.values()].some((n) => dist(n.p, q) < 3 && g.net.segsAt(n.id).length > 0);
  /**
   * The town's street end nearest a point (where a road out of it starts). `built`: only a junction the town has
   * already built (a corner of its grid it hasn't reached yet would leave the road short of its streets, the way a
   * player wouldn't).
   */
  const edge = (t: Town, toward: V2, built = false) => {
    let best = gridPt(t.c, t.ang, 1, 0), bd = Infinity;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const q = gridPt(t.c, t.ang, i, j);
      const d = dist(q, toward) + (built && !isBuilt(q) ? 1e5 : 0);
      if (d < bd) { bd = d; best = q; }
    }
    return best;
  };
  const has = (k: PlantKind) => g.buildings.list.some((b) => b.kind === k);
  const count = (k: PlantKind) => g.buildings.list.filter((b) => b.kind === k).length;

  const A = g.towns.list[0];
  say(`start: ${A.name}, ${A.pop} people, $${START_MONEY.toLocaleString("en-US")}`);
  const soil = deposit(F.fert, gridPt(A.c, A.ang, 1 + 320 / BLOCK, 0), 60, 1500)!;
  const wood = deposit(F.forest, A.c, 400, 3000)!;
  /** Spots on a deposit field, nearest the start first (one per patch or so). */
  const spots = (field: number, from = 2500, to = 8000, need = 23): V2[] => {
    const out: V2[] = [];
    for (let r = from; r < to && out.length < 8; r += 100) for (let k = 0; k < 96; k++) {
      const q = v2(A.c.x + Math.cos((k / 96) * Math.PI * 2) * r, A.c.y + Math.sin((k / 96) * Math.PI * 2) * r);
      if (!g.world.inBounds(q) || g.world.isWater(q) || g.world.isMountain(q) || out.some((o) => dist(o, q) < 450)) continue;
      let ok = 0;
      for (let i = -2; i <= 2; i++) for (let j = -2; j <= 2; j++) if (g.terrain.has(field, v2(q.x + i * 15, q.y + j * 15))) ok++;
      if (ok >= need) out.push(q);
    }
    return out;
  };
  const tier2: Record<string, V2[]> = {
    ore: spots(F.ore), coal: spots(F.coal), lime: spots(F.lime), oil: spots(F.oil, 5500, 16000), sand: spots(F.sand, 5500, 16000, 15),
    ...(T4 ? { copper: spots(F.copper, 9000, 21000) } : {}),
  };
  const km1 = (l: V2[]) => (l.length ? `${(dist(l[0], A.c) / 1000).toFixed(1)} km` : "none");
  say(`deposits from ${A.name}: soil ${(dist(soil, A.c) / 1000).toFixed(1)} km, forest ${(dist(wood, A.c) / 1000).toFixed(1)} km, iron ore ${km1(tier2.ore)}, coal ${km1(tier2.coal)}, limestone ${km1(tier2.lime)}, oil ${km1(tier2.oil)}, sand ${km1(tier2.sand)}`);
  /** When a deposit had no way through (a player tries again later, once there is money for it). */
  const blocked = new Map<string, number>();
  /** Where a new road to q starts: the nearest of the company's road ends and the towns' street ends. */
  const startsFor = (q: V2): V2[] =>
    [edge(A, q), ...joined().map((t) => edge(t, q)), ...Object.values(roads).flat()].sort((x, y) => dist(x, q) - dist(y, q));
  const startFor = (q: V2): V2 => startsFor(q)[0];
  /**
   * A site on a deposit, the way a player places one: the plot near `near` with the most of the field under it,
   * standing free with its gate toward the nearest road end, then a street from there to the gate. (With no street
   * through, the site is taken back and the next plot tried.) "money": not for now.
   */
  const site = (kind: PlantKind, field: number, near: V2, key?: string, R = 700): Building | null | "money" => {
    if (PLANTS[kind].cost > g.money - RESERVE) { poor(); return "money"; }
    const T = BUILDING_TYPES[kind];
    const plots: { q: V2; s: number }[] = [];
    for (let x = -R; x <= R; x += 50) for (let y = -R; y <= R; y += 50) {
      const q = v2(near.x + x, near.y + y);
      if (Math.hypot(x, y) > R || !g.world.inBounds(q) || !g.terrain.has(field, q)) continue;
      const sh = g.industry.depositShare(field, q, 0, T.w / 2, T.d / 2);
      if (sh >= 0.5) plots.push({ q, s: sh - 0.3 * dist(q, near) / R });
    }
    plots.sort((x, y) => y.s - x.s);
    siteWhy.clear();
    siteWhy.set(`${plots.length} plots`, 1);
    let tries = 0;
    for (const { q } of plots) {
      if (tries >= 10) break;
      const a = startFor(q);
      const opts = { down: norm(sub(a, q)) };
      const pl = g.placedPlan(kind, q, opts);
      if (!pl?.ok) { siteWhy.set(pl?.reason ?? "no plan", (siteWhy.get(pl?.reason ?? "no plan") ?? 0) + 1); continue; }
      tries++;
      const b = g.place(kind, q, opts)!;
      const done = () => {
        say(`place ${kind}${b.plant!.yld < 1 ? ` (${Math.round(b.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(b.c, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
        return b;
      };
      // a street to 4 m past the kerb in front of its gate
      const e = add(b.front, scale(norm(sub(b.front, b.c)), 4));
      // (placing it laid its own street to the gate: that is the deposit's road now, for the plants beside it)
      if (b.access) {
        if (key && !roads[key]) { roads[key] = [a, e]; paths[key] = [[a, e]]; }
        return done();
      }
      // (from the nearest road end, or the next ones if houses or a river block the way from there)
      let r: ReturnType<typeof road> = "blocked";
      for (const st of [a, ...startsFor(q).filter((x) => dist(x, a) > 50).slice(0, 2)]) {
        r = road(`to the ${T.name.toLowerCase()}`, st, e);
        if (r !== "blocked") break;
      }
      if (r !== true) { siteWhy.set(`road ${r}: ${roadErrors[0] ?? ""}`, (siteWhy.get(`road ${r}: ${roadErrors[0] ?? ""}`) ?? 0) + 1); g.undo(); if (r === "money") return "money"; continue; }
      if (key && !roads[key]) { roads[key] = [a, e]; paths[key] = lastLegs; }
      return done();
    }
    return null;
  };
  /** A tier 2 mine on the nearest patch of its deposit a street reaches. */
  const mine = (key: "ore" | "coal" | "lime" | "oil" | "sand" | "copper", kind: PlantKind, field: number, name: string) => {
    if (has(kind) || g.time - (blocked.get(key) ?? -1e9) < DAY) return;
    if (g.money < RESERVE + PLANTS[kind].cost + 8000) { poor(); return; }
    const why: string[] = [];
    for (const d of tier2[key]) {
      // (a road into the deposit first: the site faces it)
      if (!roads[key] || dist(roads[key][1], d) > 600) {
        // (from the nearest road end, or the next ones if a road from there is blocked: houses along the road it
        // would run beside, a river it can't bridge there)
        let a = startFor(d), r: ReturnType<typeof road> = "blocked";
        for (const st of startsFor(d).filter((x, i, xs) => xs.findIndex((y) => dist(x, y) < 50) === i).slice(0, 6)) {
          a = st;
          r = road(`to the ${name}`, a, d);
          if (r === true || r === "money") break;
        }
        if (r === "money") return;
        if (r !== true) { why.push(`road ${(dist(a, d) / 1000).toFixed(1)} km: ${roadErrors[0] ?? r}`); continue; }
        roads[key] = [a, d];
        paths[key] = lastLegs;
      }
      const r = site(kind, field, d, key, 500);
      if (r) return;
      why.push(`site: ${[...siteWhy].map(([k, n]) => (n > 1 ? `${k} x${n}` : k)).join(", ")}`);
    }
    say(`no way through to the ${name}: ${roadErrors[0] ?? [...siteWhy].map(([w, n]) => `${w}${n > 1 ? ` x${n}` : ""}`).join(", ")}`);
    blocked.set(key, g.time);
  };

  // (the hub: halfway along the road from the ore to the coal, so both hauls are short)
  const hub = (k: PlantKind) => {
    // (by the mines, and by the roads to its own other inputs: once the mine roads are lined with sites, a cement
    // works still finds room along the quarry's road)
    // (only inputs with a road of their own count; anything else picks spots exactly as by the mines alone)
    const ins = (Object.keys(PLANTS[k].inputs) as Product[]).filter((p) => p !== "ore" && p !== "coal" && paths[p]);
    const more = ins.length ? 12 : 6;
    const srcKinds = new Set<string>(["ironmine", "coalmine", ...ins.map((p) => MAKER[p]).filter((x): x is PlantKind => !!x)]);
    const mines = g.buildings.list.filter((b) => srcKinds.has(b.kind)).map((b) => b.c);
    const opts: { r: [V2, V2]; t: number; d: number }[] = [];
    for (const r of [...(paths.ore ?? []), ...(paths.coal ?? []), ...ins.flatMap((p) => paths[p] ?? [])]) for (let t = 0; t <= 1; t += 0.05) {
      const q = v2(r[0].x + (r[1].x - r[0].x) * t, r[0].y + (r[1].y - r[0].y) * t);
      opts.push({ r, t, d: mines.reduce((s, m) => s + dist(m, q), 0) });
    }
    opts.sort((x, y) => x.d - y.d);
    // (the best few spots, apart: a big site beside the road may not fit by a river, or plants of the chains
    // already there fill the best ones; then further along the mine roads)
    const tried: V2[] = [];
    for (const o of opts) {
      if (tried.length >= more) break;
      const q = v2(o.r[0].x + (o.r[1].x - o.r[0].x) * o.t, o.r[0].y + (o.r[1].y - o.r[0].y) * o.t);
      if (tried.some((p) => dist(p, q) < 300)) continue;
      tried.push(q);
      const x = place(k, ...o.r, Math.max(0, o.t - 0.1), Math.min(1, o.t + 0.15));
      if (x) return x;
    }
    // (why not, at the best spot: a missing hub plant stalls its whole chain, so the log says so)
    if (opts.length && PLANTS[k].cost <= g.money - RESERVE) {
      const o = opts[0], q = v2(o.r[0].x + (o.r[1].x - o.r[0].x) * o.t, o.r[0].y + (o.r[1].y - o.r[0].y) * o.t);
      say(`no spot for a ${k} by the mines (${tried.length} tried): ${g.placedPlan(k, q)?.reason ?? "no plan"}`);
    } else if (!opts.length) say(`no spot for a ${k}: no road to the mines yet`);
    return null;
  };
  const roads: Record<string, [V2, V2]> = {};
  const paths: Record<string, [V2, V2][]> = {};
  /** the first town to spring up, once the company's road reaches it (its road is where more food plants go) */
  let B: Town | null = null;
  const joined = () => spawned.filter((s) => s.joined >= 0).map((s) => s.t);
  let lastFarm = 0, lastCamp = 0;
  let low = g.money;
  const plan = () => {
    const u = g.progress.unlocked.buildings;
    // tier 1: food first (the hamlet's only need), timber as the hamlet nears 100 people (when it starts wanting
    // planks), and a road to each town that springs up (the goals and tips lead a player the same way)
    if (count("farm") < 1) site("farm", F.fert, soil, "farm");
    if (roads.farm && has("farm") && !has("foodplant")) place("foodplant", ...roads.farm, 0.1, 0.5);
    joinTowns();
    const timber = Math.max(...g.towns.list.map((t) => t.pop)) >= 80;
    if (has("foodplant") && timber && !has("loggingcamp")) site("loggingcamp", F.forest, wood, "wood");
    if (has("loggingcamp") && !has("sawmill")) place("sawmill", ...roads.wood, 0.15, 0.6);
    // a second farm as the hamlet grows or a second town joins, and more while the towns go short of food
    if ((B || A.pop >= 60) && has("foodplant") && count("farm") < 2) site("farm", F.fert, soil);
    // (as a player watching the Towns window would: a town short of food gets another farm, and a food plant
    // for every two farms; past the first few, scaleUp grows the chains where their plants' panels say they're short)
    // (or one held back by its food: grown to what its supply supports, the Towns window says so)
    const hungry = g.towns.list.some((t) => t.pop > 40 && ((t.supply.food ?? 1) < 0.8 || t.limit === "food"));
    if (hungry && count("farm") >= 2 && count("farm") < 4 && g.time - lastFarm > HOUR * 8) {
      if (count("farm") < 2 * count("foodplant")) {
        if (g.money > PLANTS.farm.cost + RESERVE) { lastFarm = g.time; if (!site("farm", F.fert, soil, undefined, 1200)) say(`no plot for another farm: ${[...siteWhy].map(([w, n]) => `${w}${n > 1 ? ` x${n}` : ""}`).join(", ")}`); }
      } else if (g.money > PLANTS.foodplant.cost + RESERVE) { lastFarm = g.time; byFood("foodplant"); }
    }
    // the same for timber once the towns want planks: another camp, and a sawmill for every two camps
    const noPlanks = g.towns.list.some((t) => (t.supply.planks !== undefined && t.supply.planks < 0.8) || t.limit === "planks");
    if (noPlanks && roads.wood && has("sawmill") && count("loggingcamp") < 4 && g.time - lastCamp > HOUR * 8) {
      if (count("loggingcamp") < 2 * count("sawmill")) {
        if (g.money > PLANTS.loggingcamp.cost + RESERVE) { lastCamp = g.time; site("loggingcamp", F.forest, wood, undefined, 1200); }
      } else if (g.money > PLANTS.sawmill.cost + RESERVE) { lastCamp = g.time; place("sawmill", ...roads.wood, 0.2, 0.95); }
    }
    if (roads.towns && has("sawmill") && count("foodplant") < 2) byFood("foodplant");
    // tier 2: the mines first (they wait as building sites for planks), then the power plant and the smelter
    if (u.has("ironmine") && has("sawmill")) mine("ore", "ironmine", F.ore, "iron ore");
    if (u.has("coalmine") && has("ironmine")) mine("coal", "coalmine", F.coal, "coal");
    if (u.has("coalplant") && has("coalmine") && !has("coalplant")) hub("coalplant");
    if (u.has("smelter") && has("coalmine") && !has("smelter")) hub("smelter");
    if (u.has("quarry") && has("smelter")) mine("lime", "quarry", F.lime, "limestone");
    if (u.has("cementworks") && has("quarry") && !has("cementworks")) hub("cementworks");
    // (as a player watching the Towns window would: trucks for full yards, and more plants for the chains a town goes short of)
    scaleUp();
    if (!g.progress.isDone("cement")) return;
    // tier 3: oil far out and a refinery at the hub (it draws power); sand by the water, a glassworks at the hub and a
    // furniture factory by the sawmills; a construction plant at the hub, beside the smelter and the cement works
    if (u.has("oilwell")) mine("oil", "oilwell", F.oil, "oil field");
    if (u.has("refinery") && has("oilwell") && !has("refinery")) hub("refinery");
    if (u.has("sandpit")) mine("sand", "sandpit", F.sand, "sand");
    if (u.has("glassworks") && has("sandpit") && !has("glassworks")) hub("glassworks");
    if (u.has("furniture") && has("glassworks") && !has("furniture")) place("furniture", ...roads.wood!, 0.1, 0.7);
    if (u.has("constructionplant") && !has("constructionplant")) hub("constructionplant");
    if (!T4) return;
    // tier 4: copper far out in the ranges; the copper smelter, electronics plant and machine works at the hub, by the
    // coal, the refinery's plastics and the smelter's steel
    if (u.has("coppermine")) mine("copper", "coppermine", F.copper, "copper ore");
    if (u.has("coppersmelter") && has("coppermine") && !has("coppersmelter")) hub("coppersmelter");
    if (u.has("electronics") && has("coppersmelter") && !has("electronics")) hub("electronics");
    if (u.has("machineworks") && has("coppersmelter") && !has("machineworks")) hub("machineworks");
    if (!T5) return;
    // the deeper chains: a dairy on the soil and a creamery on the farm road (milk spoils, so close by); the chemical
    // works at the hub by the quarry's lime; then the rubber plant beside the refinery and the Motor Works beside the
    // smelter, the glassworks and the electronics plant
    if (u.has("dairyfarm") && !has("dairyfarm")) site("dairyfarm", F.fert, soil, undefined, 1500);
    if (u.has("creamery") && has("dairyfarm") && !has("creamery") && roads.farm) place("creamery", ...roads.farm, 0.1, 0.6);
    if (u.has("chemworks") && !has("chemworks")) hub("chemworks");
    if (u.has("rubberplant") && !has("rubberplant")) hub("rubberplant");
    if (u.has("motorworks") && has("rubberplant") && !has("motorworks")) hub("motorworks");
  };

  /**
   * A road to each town that has sprung up and has none yet, as a player would join it: from the nearest of the
   * company's road ends and the joined towns' street ends (a river or a site in the way: the next nearest). Too dear for
   * now: again in a few hours.
   */
  let lastJoin = -1e9;
  const joinTowns = () => {
    const s = spawned.find((x) => x.joined < 0);
    if (!s || g.time - lastJoin < HOUR * 3) return;
    // (the towns the company already serves come first: a new town's road, and its share of the food, wait for up
    // to a day until there is money for the next food plant too, as a player saving for both would)
    if (g.time - s.at < DAY && g.money < RESERVE + PLANTS.foodplant.cost + 20000) return;
    lastJoin = g.time;
    const t = s.t;
    // (from the network's loose ends nearest the town, the dead ends of a town's streets and the company's roads
    // first, spread out so a river or a built-up block in one direction doesn't stop every try; to the new town's
    // own street end facing it)
    const deg = new Map<number, number>(), mine = new Set<number>();
    for (const x of g.net.segs.values()) {
      for (const n of [x.a, x.b]) deg.set(n, (deg.get(n) ?? 0) + 1);
      if (x.town === t.id) { mine.add(x.a); mine.add(x.b); }
    }
    const loose = [...g.net.nodes.values()].filter((n) => !mine.has(n.id) && n.h === 0)
      .sort((x, y) => (deg.get(x.id) === 1 ? 0 : 400) + dist(x.p, t.c) - (deg.get(y.id) === 1 ? 0 : 400) - dist(y.p, t.c));
    const ends: V2[] = [];
    for (const n of loose) if (ends.length < 10 && ends.every((e) => dist(e, n.p) > 150)) ends.push(n.p);
    const own = [...g.net.nodes.values()].filter((n) => mine.has(n.id));
    const got: string[] = [];
    for (const a of ends) {
      const b = own.length ? own.reduce((u, v) => ((deg.get(u.id) === 1 ? 0 : 60) + dist(u.p, a) <= (deg.get(v.id) === 1 ? 0 : 60) + dist(v.p, a) ? u : v)).p : edge(t, a);
      const r = road(`to ${t.name}`, a, b);
      if (r === true) {
        s.joined = g.time;
        if (!B) { B = t; roads.towns = [a, b]; }
        return;
      }
      got.push(r);
      if (r === "money") return;
    }
    say(`no road to ${t.name}: ${got.join(", ")} (last: ${roadErrors.join(" / ")})`);
  };

  // ---------------------------------------------------------------- keeping up with the towns
  const lastAdd: Partial<Record<PlantKind, number>> = {};
  let lastPower = -1e9;
  const FIELD: Partial<Record<PlantKind, number>> = { farm: F.fert, dairyfarm: F.fert, loggingcamp: F.forest, ironmine: F.ore, coalmine: F.coal, quarry: F.lime, oilwell: F.oil, sandpit: F.sand, coppermine: F.copper };
  const HUB: PlantKind[] = ["smelter", "cementworks", "coalplant", "refinery", "glassworks", "constructionplant", "coppersmelter", "electronics", "machineworks", "chemworks", "rubberplant", "motorworks"];
  /** Another plant of a kind beside the ones already there. */
  const another = (k: PlantKind) => {
    const near = g.buildings.list.filter((b) => b.kind === k).at(-1)!.c;
    const f = FIELD[k];
    if (f !== undefined) {
      const r = site(k, f, near, undefined, 1500);
      if (!r) say(`no plot for another ${k}: ${[...siteWhy].map(([w, n]) => `${w}${n > 1 ? ` x${n}` : ""}`).join(", ")}`);
      return r;
    }
    if (HUB.includes(k)) return hub(k);
    // (a food plant by the road to the towns, or failing a spot there by the road to the farms)
    if (k === "foodplant" || k === "creamery") return byFood(k) ?? hub(k);
    const x = roads.wood ? place(k, ...roads.wood, 0.1, 0.9) : null;
    return x ?? hub(k);
  };
  /**
   * A food plant (or creamery) by the road to the towns, else along the road out to the farms, leg by leg (a town's
   * own streets can run beside the straight line from its edge to the farm, where a player would pick the next stretch).
   */
  const byFood = (k: PlantKind): Building | null => {
    if (roads.towns) { const x = place(k, ...roads.towns, 0.3, 0.7); if (x) return x; }
    for (const r of [roads.farm, ...(paths.farm ?? [])]) { const x = r ? place(k, ...r, 0.1, 0.9) : null; if (x) return x; }
    return null;
  };
  /** A chain short of p: another plant at its weakest link (the input most of its plants wait for). */
  const grow = (p: Product, depth = 0): void => {
    const k = MAKER[p];
    if (!k || depth > 4 || !g.progress.unlocked.buildings.has(k)) return;
    const all = g.buildings.list.filter((b) => b.kind === k);
    if (!all.length || all.some((b) => b.plant!.site || b.built < 1)) return;
    for (const q of Object.keys(PLANTS[k].inputs) as Product[]) {
      if (all.filter((b) => b.problem === `Waiting for ${PRODUCTS[q].name.toLowerCase()}`).length * 2 >= all.length) return grow(q, depth + 1);
    }
    // (half its yards full already: the hauls are what's short, not the plants, as the plants' panels say)
    if (all.filter((b) => b.problem?.startsWith("Full of") || b.problem?.includes("have all they can store")).length * 2 >= all.length) return;
    // (a plant needs its makers first: no more food plants than farms, nor sawmills than logging camps)
    const src: Partial<Record<PlantKind, [PlantKind, Product]>> = { foodplant: ["farm", "crops"], sawmill: ["loggingcamp", "logs"] };
    const s = src[k];
    if (s && all.length >= count(s[0])) return grow(s[1], depth + 1);
    if (g.time - (lastAdd[k] ?? -1e9) < HOUR * 4) return;
    lastAdd[k] = g.time;
    another(k);
  };
  /** a chain's next plant is open but not yet placed (a player saves for it before another power plant) */
  const saving = () => { const u = g.progress.unlocked.buildings; return (u.has("smelter") && has("coalmine") && !has("smelter")) || (u.has("cementworks") && has("quarry") && !has("cementworks")); };
  const scaleUp = () => {
    // (a full yard is not the company's to fix with trucks: a site's fleet comes with its level)
    trucks = g.buildings.list.filter((b) => b.plant && b.problem?.startsWith("Full of") && b.problem.includes("trucks")).length;
    // short of power: another power plant at the hub
    const dark = g.buildings.list.some((b) => b.plant && /power: working/.test(b.problem ?? ""));
    const plants = g.buildings.list.filter((b) => b.kind === "coalplant");
    if (dark && plants.some((b) => b.problem === "Waiting for coal")) grow("coal");
    else if (dark && has("coalmine") && !saving() && g.time - lastPower > HOUR * 8 && !plants.some((b) => b.plant!.site || b.built < 1)) { lastPower = g.time; hub("coalplant"); }
    // a town short of something it needs, plant sites short of materials for a day, blocks waiting for parts
    for (const t of g.towns.list) if (t.pop > 100) for (const p of needsOf(t.pop)) if ((t.supply[p] ?? 1) < 0.8 || t.limit === p) grow(p);
    if (g.buildings.list.some((b) => b.plant?.site && g.time - b.born > DAY)) { grow("planks"); grow("cement"); if (T4) grow("parts"); }
    if (g.buildings.list.filter((b) => b.site).length > 4) grow("parts");
  };
  let trucks = 0;
  // trucks that gave up on a trip today, by why
  const gaveUp = new Map<string, number>();
  const ev = (g.traffic as unknown as { ev: { fail(t: Trip, r: string, now: number): void } }).ev, fail0 = ev.fail;
  ev.fail = (t, r, now) => { if (t.haul) gaveUp.set(r, (gaveUp.get(r) ?? 0) + 1); fail0(t, r, now); };

  // ---------------------------------------------------------------- the clock
  let first = -1, steel = -1, cement = -1, fuel = -1, goods = -1, parts = -1, town = -1, copper = -1, electronics = -1, machinery = -1, milk = -1, supplies = -1, car = -1;
  const started = Date.now();
  for (let h = 0; h < MAX_DAYS * 24; h++) {
    plan();
    for (let i = 0; i < HOUR * 30; i++) {
      g.step(1 / 30);
      if (g.money < low) low = g.money;
    }
    const made = g.progress.made;
    if (first < 0 && (g.progress.sold.food ?? 0) >= 1) { first = g.time; say("FIRST DELIVERY"); }
    if (steel < 0 && (made.steel ?? 0) >= 1) { steel = g.time; say("FIRST STEEL"); }
    if (cement < 0 && (made.cement ?? 0) >= 1) { cement = g.time; say("FIRST CEMENT"); }
    if (fuel < 0 && (made.fuel ?? 0) >= 1) { fuel = g.time; say("FIRST FUEL"); }
    if (goods < 0 && (made.goods ?? 0) >= 1) { goods = g.time; say("FIRST HOUSEHOLD GOODS"); }
    if (parts < 0 && (g.progress.sold.parts ?? 0) >= 1) { parts = g.time; say("FIRST PARTS AT A BUILDING SITE"); }
    if (town < 0 && g.towns.list.some((t) => sizeOf(t.pop) >= 2)) { town = g.time; say(`A TOWN: ${g.towns.list.find((t) => sizeOf(t.pop) >= 2)!.name}`); }
    if (copper < 0 && (made.copper ?? 0) >= 1) { copper = g.time; say("FIRST COPPER"); }
    if (electronics < 0 && (made.electronics ?? 0) >= 1) { electronics = g.time; say("FIRST ELECTRONICS"); }
    if (machinery < 0 && (made.machinery ?? 0) >= 1) { machinery = g.time; say("FIRST MACHINERY"); }
    if (milk < 0 && (g.progress.sold.milk ?? 0) >= 1) { milk = g.time; say("FIRST MILK SOLD"); }
    if (supplies < 0 && ((made.fertilizer ?? 0) >= 1 || (made.explosives ?? 0) >= 1)) { supplies = g.time; say("FIRST SUPPLIES FROM THE CHEMICAL WORKS"); }
    if (car < 0 && (g.progress.sold.cars ?? 0) >= 1) { car = g.time; say("FIRST CAR SOLD"); }
    if (h % 24 === 23) {
      const pct = (o: Partial<Record<Product, number>>) => Object.entries(o).map(([p, v]) => `${p} ${Math.round(v! * 100)}%`).join(" ");
      const towns = g.towns.list.map((t) => `${t.name} ${t.pop} (${pct(t.supply)})`).join(", ");
      const sites = g.buildings.list.filter((b) => b.plant?.site).map((b) => `${b.kind} ${Object.entries(b.plant!.site!.need).map(([p, n]) => `${b.plant!.site!.got[p as Product] ?? 0}/${n}`).join("+")}`).join(", ");
      const plants = new Map<string, number>();
      for (const b of g.buildings.list) if (b.plant) plants.set(b.kind, (plants.get(b.kind) ?? 0) + 1);
      say(`end of day: $${Math.round(g.money).toLocaleString("en-US")} · ${towns} · plants ${[...plants].map(([k, n]) => `${k} ${n}`).join(", ")} · yards short of trucks ${trucks}${sites ? ` · sites ${sites}` : ""} · ${((Date.now() - started) / 1000).toFixed(0)} s`);
      // what holds the plants up, grouped
      const why = new Map<string, number>();
      for (const b of g.buildings.list) if (b.plant && b.problem) why.set(`${b.kind}: ${b.problem}`, (why.get(`${b.kind}: ${b.problem}`) ?? 0) + 1);
      for (const [k, n] of why) put(`             ${k}${n > 1 ? ` (x${n})` : ""}`);
      const waiting = g.buildings.list.filter((b) => b.site).length;
      if (waiting) put(`             town blocks waiting for parts: ${waiting}`);
      // where the company's trucks are: driving, stood still in traffic, or waiting at a gate to set off
      const tv = g.traffic.vehicles.filter((v) => v.trip.haul), tp = g.traffic.pending.filter((p) => p.trip.haul);
      const still = tv.filter((v) => v.v < 0.3).length, jammed = tv.filter((v) => v.stuck > 30).length;
      const gate = tp.length ? tp.reduce((s, p) => s + p.wait, 0) / tp.length : 0;
      put(`             trucks: ${tv.length} on the road (${still} stood still, ${jammed} stuck 30 s+), ${tp.length} waiting to set off (avg ${gate.toFixed(0)} s)${[...gaveUp].map(([k, n]) => ` · ${k} ${n}`).join("")}`);
      gaveUp.clear();
    }
    if (SHOWCASE && g.towns.list.length >= 5 && g.towns.list.reduce((s, t) => s + t.pop, 0) >= SHOWCASE_POP) break;
    if (SHOWCASE) continue;
    if (T5 ? car >= 0 : T4 ? electronics >= 0 && machinery >= 0 : T3 ? g.progress.isDone("townSupplied") : cement >= 0 && steel >= 0) break;
  }
  const supplied = reached.find((r) => r.id === "townSupplied")?.t ?? -1;
  return { g, lines, reached, spawned, first, low, steel, cement, fuel, goods, parts, town, supplied, poorHours, copper, electronics, machinery, milk, supplies, car };
}

describe("Balance: the game to Town size", () => {
  // traffic draws a few things at random (car looks, lane picks): a seeded stand-in keeps the timeline the same each run
  beforeAll(() => {
    let x = 0x2f6b1d3;
    vi.spyOn(Math, "random").mockImplementation(() => {
      x ^= x << 13; x ^= x >>> 17; x ^= x << 5;
      return (x >>> 0) / 4294967296;
    });
  });
  afterAll(() => vi.restoreAllMocks());

  it(`a scripted company reaches steel and cement${T3 ? ", then fuel, goods and a supplied Town," : ""}${T4 ? " then copper, electronics and machinery," : ""}${T5 ? " then milk, supplies and a car," : ""} in ladder order, and stays solvent`, async () => {
    const t0 = Date.now();
    const r = play();
    const { g, lines, reached, low, steel, cement } = r;
    const ids = reached.map((x) => x.id);
    if (SHOWCASE) {
      console.log(`showcase: ${g.towns.list.map((t) => `${t.name} ${t.pop}`).join(", ")} · ${g.buildings.list.filter((b) => b.plant).length} plants · day ${(g.time / DAY).toFixed(1)}`);
      // (node's fs, loaded by name: the tests are typed for the browser)
      const fs = await import(/* @vite-ignore */ ["node", "fs"].join(":"));
      fs.mkdirSync("tools/out", { recursive: true });
      fs.writeFileSync("tools/out/showcase.json", JSON.stringify(g.serialize()));
      fs.writeFileSync("tools/out/showcase.log", lines.join("\n"));
      return;
    }
    const day = (t: number) => (t < 0 ? "never" : (t / DAY).toFixed(2));
    /** real minutes at 1x (a day is 16 of them) */
    const min = (t: number) => (t < 0 ? "never" : `${Math.round((t / DAY) * 16)} min`);
    const at1 = (id: string) => reached.find((x) => x.id === id)?.t ?? -1;
    /** when a line of the log was said (its "day  x.xx" stamp) */
    const said = (re: RegExp) => { const l = lines.find((x) => re.test(x)); return l ? Number(l.slice(4, 9)) * DAY : -1; };
    console.log(["", "Balance timeline (seed 7):", ...lines,
      `milestones: ${reached.map((x) => `${x.id}@${(x.t / DAY).toFixed(2)}`).join(" ")}`,
      `first steel day ${day(steel)}, first cement day ${day(cement)}, first fuel day ${day(r.fuel)}, first goods day ${day(r.goods)}, first parts day ${day(r.parts)}, a Town day ${day(r.town)}, a Town supplied day ${day(r.supplied)}${T4 ? `, first copper day ${day(r.copper)}, first electronics day ${day(r.electronics)}, first machinery day ${day(r.machinery)}` : ""}${T5 ? `, first milk sold day ${day(r.milk)}, first supplies day ${day(r.supplies)}, first car day ${day(r.car)}` : ""}`,
      `at 1x: first delivery ${min(r.first)}, sawmill placed ${min(said(/place sawmill/))}, planks10 ${min(at1("planks10"))}, Village ${min(at1("village"))}, first steel ${min(steel)}, first cement ${min(cement)}`,
      `new towns: ${r.spawned.map((s) => `${s.t.name} at ${min(s.at)} (day ${day(s.at)}), ${(s.dist / 1000).toFixed(1)} km from the nearest town, joined ${s.joined < 0 ? "never" : min(s.joined)}`).join("; ") || "none"}`,
      `lowest balance $${Math.round(low).toLocaleString("en-US")}; hours a build waited for money in tier 3: ${r.poorHours}; ${((Date.now() - t0) / 1000).toFixed(0)} s`].join("\n"));
    // solvent all the way
    expect(low).toBeGreaterThanOrEqual(0);
    expect(g.money).toBeGreaterThan(0);
    if (DAYS_CAP) return;
    // first steel and first cement made, at a pace that keeps the early game moving (a day is 4 minutes at 4x)
    expect(steel).toBeGreaterThan(0);
    expect(cement).toBeGreaterThan(0);
    expect((reached.find((x) => x.id === "village")?.t ?? Infinity) / DAY).toBeLessThan(VILLAGE_BY);
    expect(steel / DAY).toBeLessThan(STEEL_BY);
    expect(cement / DAY).toBeLessThan(CEMENT_BY);
    // the milestones in the ladder's order where one gates the next
    const at = (id: string) => ids.indexOf(id);
    for (const id of ["food10", "hamlet150", "planks10", "village", "heavy", "steel", "cement"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    // the first new town springs up from the hamlet growing, and the company's road reaches it
    expect(r.spawned.length).toBeGreaterThanOrEqual(1);
    expect(r.spawned[0].joined).toBeGreaterThan(0);
    expect(at("food10")).toBeLessThan(at("village"));
    expect(at("village")).toBeLessThan(at("steel"));
    expect(at("heavy")).toBeLessThan(at("cement"));
    expect(at("steel")).toBeLessThan(at("cement"));
    // never more than OPEN_AT_ONCE ahead of the first one not reached
    for (const [i, id] of ids.entries()) expect(MILESTONES.findIndex((m) => m.id === id)).toBeLessThan(i + OPEN_AT_ONCE + 1);
    if (!T3) return;
    // tier 3: fuel and household goods, then a Town, supplied in everything including its goods and fuel
    expect(r.fuel).toBeGreaterThan(0);
    expect(r.goods).toBeGreaterThan(0);
    expect(r.fuel / DAY).toBeLessThan(FUEL_BY);
    expect(r.goods / DAY).toBeLessThan(GOODS_BY);
    expect(r.town).toBeGreaterThan(0);
    expect(r.town / DAY).toBeLessThan(TOWN_BY);
    expect(r.supplied).toBeGreaterThan(0);
    const big = g.towns.list.find((t) => t.pop >= TOWN_SIZES[2].pop)!;
    expect(big).toBeDefined();
    // money is never what holds the company up once tier 3 opens: a build waits for it a few hours at most
    expect(r.poorHours).toBeLessThan(12);
    for (const id of ["pop1000", "fuel1", "goods1", "town", "townSupplied"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    expect(at("pop1000")).toBeLessThan(at("fuel1"));
    expect(at("fuel1")).toBeLessThan(at("townSupplied"));
    expect(at("goods1")).toBeLessThan(at("townSupplied"));
    if (!T4) return;
    // tier 4: copper, then the first electronics and machinery
    expect(r.copper).toBeGreaterThan(0);
    expect(r.electronics).toBeGreaterThan(0);
    expect(r.machinery).toBeGreaterThan(0);
    for (const id of ["townSupplied", "pop4000"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    if (!T5) return;
    // the deeper chains: milk sold fresh, the chemical works' supplies, and the Motor Works' first car, in ladder order
    expect(r.milk).toBeGreaterThan(0);
    expect(r.supplies).toBeGreaterThan(0);
    expect(r.car).toBeGreaterThan(0);
    for (const id of ["villages2", "town", "worldsfair", "cars1"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    expect(at("worldsfair")).toBeLessThan(at("cars1"));
  }, T5 ? 12_000_000 : T4 ? 9_000_000 : T3 ? 7_200_000 : 1_800_000);
});
