// The game to Town size, played headless: a scripted company on seed 7 plays from the start the way a player would
// (a food chain, timber, a second town, then tier 2's mines, power plant, smelter, quarry and cement works, then tier
// 3's oil, sand, glass, household goods and construction parts) and spends only what it has. Like a player watching
// the Towns window, it adds a plant to a chain a town goes short of, and a truck to a plant whose yard is full. It
// checks the milestones come in the ladder's order, that the company stays solvent all the way and that money is
// never what holds it up once tier 3 opens, and prints the timeline: the numbers docs/design.md's "Pacing" is judged
// on. (`npx vitest run tests/balance.test.ts --disableConsoleIntercept` shows it; with BALANCE_T3=1 it plays tier 3 too.)

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { Game, START_MONEY } from "../src/game/city";
import type { Trip } from "../src/sim/traffic";
import { DAY, HOUR } from "../src/game/society";
import { BLOCK, TOWN_SIZES, gridPt, needsOf, sizeOf } from "../src/game/towns";
import { TOWN_COST, TOWN_SPACING, type Town } from "../src/game/settlements";
import { PLANTS, PRODUCTS, type PlantKind, type Product } from "../src/game/industry";
import { MILESTONES, OPEN_AT_ONCE, tilePrice } from "../src/game/progression";
import { F } from "../src/world/gen";
import { BUILDING_TYPES } from "../src/config";
import { add, dist, norm, scale, sub, v2, type V2 } from "../src/core/math";
import { layRoad, roadErrors } from "./helpers";
import type { Building, PlaceOpts } from "../src/game/buildings";

/** (the test runs in Node; the project has no Node types) */
declare const process: { env: Record<string, string | undefined>; stderr: { write(s: string): void } };

const MAX_DAYS = Number(process.env.BALANCE_DAYS ?? 70);
/**
 * BALANCE_T3=1 plays on past first cement through tier 3 to a supplied Town and checks that leg too. It runs an hour or
 * more (the towns grow to thousands of people, all driving), so the everyday suite stops at first cement.
 */
const T3 = !!process.env.BALANCE_T3;
/** BALANCE_LIVE=1 prints the timeline as it happens too (a long run shows where it is). */
const LIVE = !!process.env.BALANCE_LIVE;
/** The pace the game is held to: first steel and first cement, first fuel and goods, and a Town, by these days. */
const STEEL_BY = 18, CEMENT_BY = 22, FUEL_BY = 40, GOODS_BY = 45, TOWN_BY = 60;
/** What the company keeps in hand for wages and fuel: it doesn't build with its last dollars. */
const RESERVE = 8000;
/** What makes each product: the plant a chain short of it gets another of. */
const MAKER: Partial<Record<Product, PlantKind>> = {
  food: "foodplant", crops: "farm", planks: "sawmill", logs: "loggingcamp", cement: "cementworks", lime: "quarry",
  coal: "coalmine", ore: "ironmine", steel: "smelter", crude: "oilwell", fuel: "refinery", sand: "sandpit",
  glass: "glassworks", goods: "furniture", parts: "constructionplant",
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
  g.on((e) => {
    if (e.t === "milestone") { reached.push({ id: e.m.id, t: g.time }); say(`MILESTONE ${e.m.name} (${e.m.id}) · $${Math.round(g.money).toLocaleString("en-US")}`); }
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
        let pl = g.placedPlan(kind, p);
        if (pl && !pl.ok && pl.reason?.startsWith("Not your land") && buyLand(kind, p) === true) pl = g.placedPlan(kind, p);
        if (pl?.ok) {
          const x = g.place(kind, p)!;
          say(`place ${kind}${x.plant!.yld < 1 ? ` (${Math.round(x.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(p, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
          return x;
        }
      }
    }
    return null;
  };
  /**
   * Buy the tile under the middle of a site at p (all a site needs), only when it would then stand there, on its
   * deposit (a player sees that while placing), with money to spare. "money": not for now.
   */
  const buyLand = (kind: PlantKind, p: V2, opts?: PlaceOpts): boolean | "money" => {
    const pl = g.placedPlan(kind, p, opts);
    if (!pl) return false;
    const [i, j] = g.tileOf(pl.c), key = `${i},${j}`;
    // (more of a chain it already has doesn't take the last tile slot: the next chain's deposit may need it)
    if (g.tiles.has(key) || g.tileSlotsLeft < (growing ? 2 : 1) || g.tileBlock(i, j)?.startsWith("Must border")) return false;
    const price = tilePrice(g.tiles.size);
    if (price + PLANTS[kind].cost > g.money - RESERVE) { poor(); return "money"; }
    g.tiles.add(key);
    const fits = !!g.placedPlan(kind, p, opts)?.ok;
    g.tiles.delete(key);
    if (!fits || !g.unlockTile(i, j)) return false;
    say(`bought 1 tile of land for $${price.toLocaleString("en-US")}`);
    return true;
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
  /** The town's street end nearest a point (where a road out of it starts). */
  const edge = (t: Town, toward: V2) => {
    let best = gridPt(t.c, t.ang, 1, 0), bd = Infinity;
    for (const [i, j] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]]) {
      const q = gridPt(t.c, t.ang, i, j);
      if (dist(q, toward) < bd) { bd = dist(q, toward); best = q; }
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
  const tier2: Record<string, V2[]> = { ore: spots(F.ore), coal: spots(F.coal), lime: spots(F.lime), oil: spots(F.oil, 5500, 16000), sand: spots(F.sand, 5500, 16000, 15) };
  const km1 = (l: V2[]) => (l.length ? `${(dist(l[0], A.c) / 1000).toFixed(1)} km` : "none");
  say(`deposits from ${A.name}: soil ${(dist(soil, A.c) / 1000).toFixed(1)} km, forest ${(dist(wood, A.c) / 1000).toFixed(1)} km, iron ore ${km1(tier2.ore)}, coal ${km1(tier2.coal)}, limestone ${km1(tier2.lime)}, oil ${km1(tier2.oil)}, sand ${km1(tier2.sand)}`);
  /** When a deposit had no way through (a player tries again later, once there is land or money for it). */
  const blocked = new Map<string, number>();
  /** Set while the company adds to chains it already has (see buyLand). */
  let growing = false;
  /** Where a new road to q starts: the nearest of the company's road ends and the towns' street ends. */
  const startFor = (q: V2): V2 =>
    [edge(A, q), ...(B ? [edge(B, q)] : []), ...extra.map((t) => edge(t, q)), ...Object.values(roads).flat()].sort((x, y) => dist(x, q) - dist(y, q))[0];
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
      let pl = g.placedPlan(kind, q, opts);
      if (pl && !pl.ok && pl.reason?.startsWith("Not your land")) {
        const got = buyLand(kind, q, opts);
        // (land it can't pay for yet: it waits rather than settle for a worse plot)
        if (got === "money") return "money";
        if (got) pl = g.placedPlan(kind, q, opts);
      }
      if (!pl?.ok) { siteWhy.set(pl?.reason ?? "no plan", (siteWhy.get(pl?.reason ?? "no plan") ?? 0) + 1); continue; }
      tries++;
      const b = g.place(kind, q, opts)!;
      const done = () => {
        say(`place ${kind}${b.plant!.yld < 1 ? ` (${Math.round(b.plant!.yld * 100)}% on its deposit)` : ""}, ${(dist(b.c, A.c) / 1000).toFixed(1)} km from ${A.name} · $${Math.round(g.money).toLocaleString("en-US")} left`);
        return b;
      };
      if (b.access) return done();
      // a street to 4 m past the kerb in front of its gate
      const e = add(b.front, scale(norm(sub(b.front, b.c)), 4));
      const r = road(`to the ${T.name.toLowerCase()}`, a, e);
      if (r !== true) { siteWhy.set(`road ${r}: ${roadErrors[0] ?? ""}`, (siteWhy.get(`road ${r}: ${roadErrors[0] ?? ""}`) ?? 0) + 1); g.undo(); if (r === "money") return "money"; continue; }
      if (key && !roads[key]) { roads[key] = [a, e]; paths[key] = lastLegs; }
      return done();
    }
    return null;
  };
  /** A tier 2 mine on the nearest patch of its deposit a street reaches. */
  const mine = (key: "ore" | "coal" | "lime" | "oil" | "sand", kind: PlantKind, field: number, name: string) => {
    if (has(kind) || g.time - (blocked.get(key) ?? -1e9) < DAY) return;
    if (g.money < RESERVE + PLANTS[kind].cost + 8000) { poor(); return; }
    for (const d of tier2[key]) {
      // (land out there can only be bought once one of the company's roads is in it: a road into the deposit first)
      if (!roads[key] || dist(roads[key][1], d) > 600) {
        const a = startFor(d);
        const r = road(`to the ${name}`, a, d);
        if (r === "money") return;
        if (r !== true) continue;
        roads[key] = [a, d];
        paths[key] = lastLegs;
      }
      const r = site(kind, field, d, key, 500);
      if (r) return;
    }
    say(`no way through to the ${name}`);
    blocked.set(key, g.time);
  };

  // (the hub: halfway along the road from the ore to the coal, so both hauls are short)
  const hub = (k: PlantKind) => {
    const mines = g.buildings.list.filter((b) => b.kind === "ironmine" || b.kind === "coalmine").map((b) => b.c);
    const opts: { r: [V2, V2]; t: number; d: number }[] = [];
    for (const r of [...(paths.ore ?? []), ...(paths.coal ?? [])]) for (let t = 0; t <= 1; t += 0.05) {
      const q = v2(r[0].x + (r[1].x - r[0].x) * t, r[0].y + (r[1].y - r[0].y) * t);
      opts.push({ r, t, d: mines.reduce((s, m) => s + dist(m, q), 0) });
    }
    opts.sort((x, y) => x.d - y.d);
    // (the best few spots, apart: a big site beside the road may not fit by a river)
    const tried: V2[] = [];
    for (const o of opts) {
      if (tried.length >= 6) break;
      const q = v2(o.r[0].x + (o.r[1].x - o.r[0].x) * o.t, o.r[0].y + (o.r[1].y - o.r[0].y) * o.t);
      if (tried.some((p) => dist(p, q) < 300)) continue;
      tried.push(q);
      const x = place(k, ...o.r, Math.max(0, o.t - 0.1), Math.min(1, o.t + 0.15));
      if (x) return x;
    }
    return null;
  };
  const roads: Record<string, [V2, V2]> = {};
  const paths: Record<string, [V2, V2][]> = {};
  let B: Town | null = null;
  let lastFarm = 0, lastCamp = 0;
  let low = g.money;
  const plan = () => {
    const u = g.progress.unlocked.buildings;
    // tier 1: food first (the hamlet's only need), a second town to sell to, then timber as the hamlet nears
    // Village size (the goals and tips lead a player the same way)
    if (count("farm") < 1) site("farm", F.fert, soil, "farm");
    if (roads.farm && has("farm") && !has("foodplant")) place("foodplant", ...roads.farm, 0.1, 0.5);
    const timber = Math.max(...g.towns.list.map((t) => t.pop)) >= 200;
    if (has("foodplant") && timber && !has("loggingcamp")) site("loggingcamp", F.forest, wood, "wood");
    if (has("loggingcamp") && !has("sawmill")) place("sawmill", ...roads.wood, 0.15, 0.6);
    // a second farm with the second town, and more (one every two days) while the towns go short of food
    if (B && count("farm") < 2) site("farm", F.fert, soil);
    // (as a player watching the Towns window would: a town short of food gets another farm, and a food plant
    // for every two farms)
    const hungry = g.towns.list.some((t) => t.pop > 40 && (t.supply.food ?? 1) < 0.8);
    if (hungry && count("farm") >= 2 && g.time - lastFarm > DAY) {
      if (count("farm") < 2 * count("foodplant")) {
        if (g.money > PLANTS.farm.cost + RESERVE) { lastFarm = g.time; site("farm", F.fert, soil, undefined, 1200); }
      } else if (g.money > PLANTS.foodplant.cost + RESERVE) { lastFarm = g.time; place("foodplant", ...(roads.towns ?? roads.farm!), 0.3, 0.7); }
    }
    // the same for timber once the towns want planks: another camp, and a sawmill for every two camps
    const noPlanks = g.towns.list.some((t) => t.supply.planks !== undefined && t.supply.planks < 0.8);
    if (noPlanks && roads.wood && has("sawmill") && g.time - lastCamp > DAY) {
      if (count("loggingcamp") < 2 * count("sawmill")) {
        if (g.money > PLANTS.loggingcamp.cost + RESERVE) { lastCamp = g.time; site("loggingcamp", F.forest, wood, undefined, 1200); }
      } else if (g.money > PLANTS.sawmill.cost + RESERVE) { lastCamp = g.time; place("sawmill", ...roads.wood, 0.2, 0.4); }
    }
    // a second town, down the road, once there is money for it
    if (has("foodplant") && !B && g.money > TOWN_COST + RESERVE + 7000 && g.townSlots > 1) {
      for (let r = TOWN_SPACING + 100; r < 2600 && !B; r += 100) for (let k = 0; k < 24 && !B; k++) {
        const an = A.ang + Math.PI + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (Math.PI / 12);
        const q = v2(A.c.x + Math.cos(an) * r, A.c.y + Math.sin(an) * r);
        if (g.towns.foundBlock(q) || g.terrain.has(F.fert, q) || g.terrain.has(F.forest, q)) continue;
        const t = g.towns.found(q);
        if (typeof t !== "string") { B = t; say(`found ${t.name}, ${(dist(A.c, t.c) / 1000).toFixed(1)} km away`); }
      }
    }
    if (B && !roads.towns) { const a = edge(A, B.c), b = edge(B, A.c); if (road("between the towns", a, b) === true) roads.towns = [a, b]; }
    if (roads.towns && has("sawmill") && count("foodplant") < 2) place("foodplant", ...roads.towns, 0.3, 0.7);
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
    // more towns as the milestones allow, a few kilometres out and joined by road
    if (g.towns.list.length < Math.min(3, g.townSlots) && g.money > TOWN_COST + RESERVE + 20000) foundTown();
  };

  /** A town founded 2-4 km from the first, away from the deposits, joined to the nearest road end. */
  const foundTown = () => {
    for (let r = 2200; r < 4200; r += 150) for (let k = 0; k < 24; k++) {
      const an = A.ang + Math.PI / 2 + (k / 24) * Math.PI * 2;
      const q = v2(A.c.x + Math.cos(an) * r, A.c.y + Math.sin(an) * r);
      if (g.towns.foundBlock(q) || g.terrain.has(F.fert, q) || g.terrain.has(F.forest, q)) continue;
      const t = g.towns.found(q);
      if (typeof t === "string") continue;
      say(`found ${t.name}, ${(dist(A.c, t.c) / 1000).toFixed(1)} km away`);
      extra.push(t);
      // (the nearest road end first; a river or a site in the way: the next nearest)
      const ends = [edge(A, t.c), ...(B ? [edge(B, t.c)] : []), ...extra.filter((e) => e !== t).map((e) => edge(e, t.c)), ...Object.values(roads).flat()].sort((x, y) => dist(x, t.c) - dist(y, t.c));
      const got: string[] = [];
      for (const a of ends.slice(0, 6)) { const r = road(`to ${t.name}`, a, edge(t, a)); if (r === true) return; got.push(r); }
      say(`no road to ${t.name}: ${got.join(", ")} (last: ${roadErrors.join(" / ")})`);
      return;
    }
  };

  // ---------------------------------------------------------------- keeping up with the towns
  const lastAdd: Partial<Record<PlantKind, number>> = {};
    let lastPower = -1e9;
  const FIELD: Partial<Record<PlantKind, number>> = { farm: F.fert, loggingcamp: F.forest, ironmine: F.ore, coalmine: F.coal, quarry: F.lime, oilwell: F.oil, sandpit: F.sand };
  const HUB: PlantKind[] = ["smelter", "cementworks", "coalplant", "refinery", "glassworks", "constructionplant"];
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
    const r = k === "foodplant" ? roads.towns ?? roads.farm : roads.wood;
    return (r ? place(k, ...r, 0.1, 0.9) : null) ?? hub(k);
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
    if (g.time - (lastAdd[k] ?? -1e9) < HOUR * 4) return;
    lastAdd[k] = g.time;
    another(k);
  };
  const scaleUp = () => {
    growing = true;
    // (a full yard is not the company's to fix with trucks: a site's fleet comes with its level)
    trucks = g.buildings.list.filter((b) => b.plant && b.problem?.startsWith("Full of") && b.problem.includes("trucks")).length;
    // short of power: another power plant at the hub
    const dark = g.buildings.list.some((b) => b.plant && /power: working/.test(b.problem ?? ""));
    const plants = g.buildings.list.filter((b) => b.kind === "coalplant");
    if (dark && plants.some((b) => b.problem === "Waiting for coal")) grow("coal");
    else if (dark && g.time - lastPower > HOUR * 8 && !plants.some((b) => b.plant!.site || b.built < 1)) { lastPower = g.time; hub("coalplant"); }
    // a town short of something it needs, plant sites short of materials for a day, blocks waiting for parts
    for (const t of g.towns.list) if (t.pop > 100) for (const p of needsOf(t.pop)) if ((t.supply[p] ?? 1) < 0.8) grow(p);
    if (g.buildings.list.some((b) => b.plant?.site && g.time - b.born > DAY)) { grow("planks"); grow("cement"); }
    if (g.buildings.list.filter((b) => b.site).length > 4) grow("parts");
    growing = false;
  };
  let trucks = 0;
  const extra: Town[] = [];
  // trucks that gave up on a trip today, by why
  const gaveUp = new Map<string, number>();
  const ev = (g.traffic as unknown as { ev: { fail(t: Trip, r: string, now: number): void } }).ev, fail0 = ev.fail;
  ev.fail = (t, r, now) => { if (t.haul) gaveUp.set(r, (gaveUp.get(r) ?? 0) + 1); fail0(t, r, now); };

  // ---------------------------------------------------------------- the clock
  let steel = -1, cement = -1, fuel = -1, goods = -1, parts = -1, town = -1;
  const started = Date.now();
  for (let h = 0; h < MAX_DAYS * 24; h++) {
    plan();
    for (let i = 0; i < HOUR * 30; i++) {
      g.step(1 / 30);
      if (g.money < low) low = g.money;
    }
    const made = g.progress.made;
    if (steel < 0 && (made.steel ?? 0) >= 1) { steel = g.time; say("FIRST STEEL"); }
    if (cement < 0 && (made.cement ?? 0) >= 1) { cement = g.time; say("FIRST CEMENT"); }
    if (fuel < 0 && (made.fuel ?? 0) >= 1) { fuel = g.time; say("FIRST FUEL"); }
    if (goods < 0 && (made.goods ?? 0) >= 1) { goods = g.time; say("FIRST HOUSEHOLD GOODS"); }
    if (parts < 0 && (g.progress.sold.parts ?? 0) >= 1) { parts = g.time; say("FIRST PARTS AT A BUILDING SITE"); }
    if (town < 0 && g.towns.list.some((t) => sizeOf(t.pop) >= 2)) { town = g.time; say(`A TOWN: ${g.towns.list.find((t) => sizeOf(t.pop) >= 2)!.name}`); }
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
    if (T3 ? g.progress.isDone("townSupplied") : cement >= 0) break;
  }
  const supplied = reached.find((r) => r.id === "townSupplied")?.t ?? -1;
  return { g, lines, reached, low, steel, cement, fuel, goods, parts, town, supplied, poorHours };
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

  it(`a scripted company reaches steel and cement${T3 ? ", then fuel, goods and a supplied Town," : ""} in ladder order, and stays solvent`, () => {
    const t0 = Date.now();
    const r = play();
    const { g, lines, reached, low, steel, cement } = r;
    const ids = reached.map((x) => x.id);
    const day = (t: number) => (t < 0 ? "never" : (t / DAY).toFixed(2));
    console.log(["", "Balance timeline (seed 7):", ...lines,
      `milestones: ${reached.map((x) => `${x.id}@${(x.t / DAY).toFixed(2)}`).join(" ")}`,
      `first steel day ${day(steel)}, first cement day ${day(cement)}, first fuel day ${day(r.fuel)}, first goods day ${day(r.goods)}, first parts day ${day(r.parts)}, a Town day ${day(r.town)}, a Town supplied day ${day(r.supplied)}`,
      `lowest balance $${Math.round(low).toLocaleString("en-US")}; hours a build waited for money in tier 3: ${r.poorHours}; ${((Date.now() - t0) / 1000).toFixed(0)} s`].join("\n"));
    // solvent all the way
    expect(low).toBeGreaterThanOrEqual(0);
    expect(g.money).toBeGreaterThan(0);
    // first steel and first cement made, at a pace that keeps the early game moving (a day is 4 minutes at 4x)
    expect(steel).toBeGreaterThan(0);
    expect(cement).toBeGreaterThan(0);
    expect(steel / DAY).toBeLessThan(STEEL_BY);
    expect(cement / DAY).toBeLessThan(CEMENT_BY);
    // the milestones in the ladder's order where one gates the next
    const at = (id: string) => ids.indexOf(id);
    for (const id of ["food10", "town2", "planks10", "village", "supplied", "steel", "cement"]) expect(at(id), id).toBeGreaterThanOrEqual(0);
    expect(at("food10")).toBeLessThan(at("village"));
    expect(at("village")).toBeLessThan(at("steel"));
    expect(at("supplied")).toBeLessThan(at("cement"));
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
  }, T3 ? 7_200_000 : 1_800_000);
});
