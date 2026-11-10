// The game names the bottleneck (play-test 2026-11-09: B1 "Village took 83 minutes because nothing said build a
// second Food Plant", D2, D4, A13, E2). A works at the top of what it can make, with a town still asking for more,
// used to read "Working normally"; the town read "Enough". Both were true and neither was any help. Here are the
// plain-word lines the panels, the tip and the Towns list say instead, and the arithmetic under them. The wording
// and the sums are pure (tests/bottleneck.test.ts); the functions that read the game only gather their figures.

import { BUILDING_TYPES, ROAD_TYPES } from "../config";
import type { Building } from "../game/buildings";
import { SEASONAL, seasonMult } from "../game/calendar";
import type { Game } from "../game/city";
import { buildTime } from "../game/construction";
import { Industry, PLANTS, PRODUCTS, type PlantKind, type Product } from "../game/industry";
import { served, type Town } from "../game/settlements";
import { SITE_LEVELS } from "../game/sites";
import { HOUR } from "../game/society";
import { demandPerDay, needsOf } from "../game/towns";
import { loadsLately } from "./needs";

// ------------------------------------------------------------------------------------------- the sums (pure)

/** From this share of what it can make, a works is at full output: the last tenth is the hour it happened to be read. */
export const FULL_OUTPUT = 0.9;
/** Hours of output a works must remember before its pace is called: a new one is still filling its first trucks. */
export const PACE_HOURS = 3;

export const atFullOutput = (madePerDay: number, canPerDay: number): boolean => canPerDay > 0 && madePerDay >= canPerDay * FULL_OUTPUT;

/** How many more works of a kind cover a shortfall (loads a day), each making `each` a day: at least one. */
export const worksFor = (more: number, each: number): number => (each > 0 && more > 0 ? Math.max(1, Math.ceil(more / each - 0.15)) : 0);

/** A wait in words: "under an hour", "about 6 hours", "about 2 days". */
export function aboutHours(h: number): string {
  if (h < 0.75) return "under an hour";
  if (h < 36) { const n = Math.max(1, Math.round(h)); return `about ${n} hour${n === 1 ? "" : "s"}`; }
  return `about ${Math.round(h / 24)} days`;
}

/**
 * Hours till a building site opens: the loads still to come at the pace they have been coming, then the build
 * itself. Null when nothing has come yet to judge a pace by.
 */
export function siteHours(left: number, perHour: number, buildHours: number): number | null {
  if (left <= 0) return buildHours;
  return perHour > 0 ? left / perHour + buildHours : null;
}

/** A building site's line: "13 of 50 loads delivered, about 6 hours to go". */
export function siteLine(got: number, need: number, hours: number | null): string {
  const n = `${Math.floor(got)} of ${need} loads delivered`;
  if (got >= need) return `All ${need} loads delivered, going up: ${aboutHours(hours ?? 0)} to go`;
  return hours === null ? n : `${n}, ${aboutHours(hours)} to go`;
}

const an = (name: string) => (/^[aeiou]/i.test(name) ? "an" : "a");
const many = (n: number, name: string) => (n === 1 ? name : /(works|s)$/i.test(name) ? name : /[^aeiou]y$/i.test(name) ? `${name.slice(0, -1)}ies` : `${name}s`);
/** A list of works by name, the same ones counted: "2 Coal Mines, Smelter", and past `max` kinds "and 3 more". */
export function tally(names: readonly string[], max = 3): string {
  const n = new Map<string, number>();
  for (const x of names) n.set(x, (n.get(x) ?? 0) + 1);
  const all = [...n].map(([name, k]) => (k > 1 ? `${k} ${many(k, name)}` : name));
  const rest = [...n].slice(max).reduce((a, [, k]) => a + k, 0);
  return all.slice(0, max).join(", ") + (rest ? ` and ${rest} more` : "");
}

const loads = (n: number) => `${n.toLocaleString("en-US")} more load${n === 1 ? "" : "s"}`;

/**
 * What a works at full output says under its status (B1): who would take more and how much, and the two ways out.
 * `taker`: the town or works that wants more; `more`: loads a day it would take (left out for one of the company's
 * own works, which just waits); `others`: more towns that want it too; `nextLevel`: the level it is growing to, if
 * it still grows.
 */
export function ceilingFix(o: { works: string; product: string; taker: string; more?: number; others?: number; nextLevel?: number | null }): string {
  const who = o.others ? `${o.taker} and ${o.others} more town${o.others === 1 ? "" : "s"}` : o.taker;
  const want = o.more ? `${who} would take ${loads(o.more)} of ${o.product} a day` : `${who} is waiting for ${o.product}`;
  return `${want}. Build another ${o.works}${o.nextLevel ? `, or wait for level ${o.nextLevel}` : ""}.`;
}

/** What to do about a town's short need (the town panel's row, the Towns list, the tip). */
export type NeedHelp =
  /** nothing the company owns makes it */
  | { kind: "none"; say: string; build: PlantKind }
  /** its makers are all at full output: more of them */
  | { kind: "full"; say: string; build: PlantKind; n: number; works: number }
  /** one of its makers is held up: that is the thing to look at */
  | { kind: "held"; say: string; works: number };

/** The sentence for each case, from plain figures. */
export function needHelpSay(o: { kind: "none"; works: string; product: string } | { kind: "full"; works: string; have: number; n: number } | { kind: "held"; works: string; problem: string }): string {
  if (o.kind === "none") return `Nothing of yours makes ${o.product} yet. Build ${an(o.works)} ${o.works}.`;
  if (o.kind === "full") return `Your ${o.have > 1 ? `${o.have} ${many(o.have, o.works)} are` : `${o.works} is`} at full output. Build ${o.n === 1 ? "another" : `about ${o.n} more`}.`;
  return `Your ${o.works} is held up: ${o.problem[0].toLowerCase()}${o.problem.slice(1)}.`;
}

// ------------------------------------------------------------------------------------------- reading the game

const nameOf = (k: string) => BUILDING_TYPES[k as PlantKind].name;
const lower = (p: Product) => PRODUCTS[p].name.toLowerCase();
const working = (b: Building) => !!b.plant && !b.plant.site && b.built >= 1;

/** Hours of output a pace is read over: long enough that a farm's one load every three hours still counts as a pace. */
export const PACE_WINDOW = 12;

/**
 * What a works made over the hours its pace is read from: since its first load, the last PACE_WINDOW of them. Null
 * while it has no pace yet. `lump`: the most it made in one of those hours (output comes in whole batches, so a
 * count over a few hours is off by up to one of them).
 */
export function paceOf(b: Building, p: Product): { made: number; hours: number; lump: number } | null {
  const by = Industry.madeLately(b, p).byHour;
  const first = by.findIndex((v) => v > 0);
  if (first < 0) return null;
  const w = by.slice(Math.max(first, by.length - PACE_WINDOW));
  if (w.length < PACE_HOURS) return null;
  return { made: w.reduce((a, v) => a + v, 0), hours: w.length, lump: Math.max(...w) };
}

/** Loads of p a works made a day lately, or null while it has no pace yet. */
export function madePerDay(b: Building, p: Product): number | null {
  const x = paceOf(b, p);
  return x ? (x.made / x.hours) * 24 : null;
}

/** Under this share of what it can make, no batch that fell outside the hours read makes a works flat out. */
export const FLAT_FLOOR = 0.6;

/**
 * Is a works making all it can (give or take the batch that happened to fall outside the hours read)? Never on
 * that one batch alone: a Sawmill at a third of its pace, read over its first few hours, is not at full output.
 */
export function flatOut(g: Game, b: Building, p: Product): boolean {
  const x = paceOf(b, p);
  if (!x) return false;
  const can = canPerDay(g, b, p);
  return (x.made / x.hours) * 24 >= can * FLAT_FLOOR && atFullOutput(((x.made + x.lump) / x.hours) * 24, can);
}

/** What it can make a day now: its level, its ground, the season. */
export function canPerDay(g: Game, b: Building, p: Product): number {
  return Industry.perDay(b, p) * (SEASONAL[b.kind] ? seasonMult(b.kind, g.time) : 1);
}

/** The main product of a works (not its side product). */
export function mainOf(k: PlantKind): Product | undefined {
  const D = PLANTS[k];
  return (Object.keys(D.outputs) as Product[]).find((p) => p !== D.byproduct);
}

/** The kind of works that makes a product as its main line (a Food Plant for food). */
export function makerKind(p: Product): PlantKind | undefined {
  const ks = Object.keys(PLANTS) as PlantKind[];
  return ks.find((k) => mainOf(k) === p) ?? ks.find((k) => (PLANTS[k].outputs[p] ?? 0) > 0);
}

/** Loads of p a day a town would still take to fill every crate (0: it has plenty, or does not buy it yet). */
export function townWants(t: Town, p: Product): number {
  if (!needsOf(t.pop).includes(p)) return 0;
  const want = demandPerDay(p, t.pop), got = loadsLately(t, p);
  return got >= want - 1e-9 ? 0 : Math.max(1, Math.ceil(want - got - 1e-6));
}

/** The towns the company's trucks can sell to: all but one that sprang up and has had nothing yet. */
const markets = (g: Game) => g.towns.list.filter((t) => !t.spawned || served(t));

/**
 * Is a works of the company's short of an input: running under what it could make, with next to none of it in its
 * yard? Steadier than its problem line, which comes and goes with every load that lands.
 */
export function hungryFor(g: Game, o: Building, p: Product): boolean {
  if (!working(o)) return false;
  const D = PLANTS[o.kind as PlantKind], need = D.inputs[p] ?? 0;
  if (!need || o.problem?.includes("stuck in traffic")) return false;
  if ((o.plant!.stock[p] ?? 0) >= need * 2) return false;
  // (held up by something else: that is its own story)
  if (o.problem && !o.problem.startsWith(`Waiting for ${lower(p)}`)) return false;
  const q = mainOf(o.kind as PlantKind);
  return !q || !flatOut(g, o, q);
}

/**
 * The input a working works is short of, if any, once it has made something: what its panel and its mark on the map
 * go by, so they do not flick between "Waiting for logs" and "Working normally" with every load that lands.
 */
export function shortOf(g: Game, b: Building): Product | null {
  if (!working(b) || !hasMade(b)) return null;
  return (Object.keys(PLANTS[b.kind as PlantKind].inputs) as Product[]).find((p) => hungryFor(g, b, p)) ?? null;
}

/** The trouble line of a works for the map's marks: its own, or the steady "Waiting for logs" while it is short. */
export function steadyProblem(g: Game, b: Building): string | null {
  if (b.problem || !b.plant) return b.problem;
  const p = shortOf(g, b);
  return p ? `Waiting for ${lower(p)}` : null;
}

/**
 * The company's works that make p, when every one of them is open and flat out (so more of them is the way on):
 * nearest to `near` first, with the level the nearest is growing to. Null when one is held up, still being built or
 * under its pace, or when there are none.
 */
export function makersFlatOut(g: Game, p: Product, near: Building): { works: Building[]; nextLevel: number | null } | null {
  const d = (o: Building) => Math.hypot(o.c.x - near.c.x, o.c.y - near.c.y);
  const mine = g.industry.plants().filter((o) => o.id !== near.id && mainOf(o.kind as PlantKind) === p).sort((a, c) => d(a) - d(c));
  if (!mine.length || !mine.every((o) => working(o) && !o.problem && flatOut(g, o, p))) return null;
  const L = mine[0].plant!.level ?? 1;
  return { works: mine, nextLevel: L < SITE_LEVELS && !mine[0].plant!.why ? L + 1 : null };
}

export interface Ceiling {
  p: Product;
  /** loads a day: made lately, and the most it can make */
  made: number; can: number;
  /** the town that would take the most more, with how much; and how many other towns want more too */
  town?: { t: Town; more: number; others: number; total: number };
  /** one of the company's works waiting for it */
  works?: Building;
  /** the level it is growing to (null: fully grown, or held at its level) */
  nextLevel: number | null;
  /** the line under "At full output" */
  fix: string;
}

/**
 * A works at the top of what it can make while somebody would take more: null when it is held up (its problem line
 * says by what), still finding its pace, or when nobody is short of what it makes.
 */
export function ceilingOf(g: Game, b: Building): Ceiling | null {
  if (!working(b) || b.problem || !b.placed) return null;
  const k = b.kind as PlantKind, D = PLANTS[k];
  if (D.logistics || D.mega || D.makes) return null;
  const p = mainOf(k);
  if (!p) return null;
  const made = madePerDay(b, p), can = canPerDay(g, b, p);
  if (made === null || !flatOut(g, b, p)) return null;
  const L = b.plant!.level ?? 1;
  // (held at its level by a goal, or fully grown: there is no next level to wait for)
  const nextLevel = L < SITE_LEVELS && !b.plant!.why ? L + 1 : null;
  if (PRODUCTS[p].price > 0) {
    const short = markets(g).map((t) => ({ t, more: townWants(t, p) })).filter((x) => x.more > 0).sort((a, c) => c.more - a.more);
    if (short.length) {
      const total = short.reduce((a, x) => a + x.more, 0);
      const town = { t: short[0].t, more: short[0].more, others: short.length - 1, total };
      return { p, made, can, town, nextLevel, fix: ceilingFix({ works: nameOf(k), product: lower(p), taker: town.t.name, more: total, others: town.others, nextLevel }) };
    }
  }
  // one of the company's own works standing idle for it
  const waiting = g.industry.plants().find((o) => o.id !== b.id && hungryFor(g, o, p));
  if (waiting) return { p, made, can, works: waiting, nextLevel, fix: ceilingFix({ works: nameOf(k), product: lower(p), taker: `Your ${nameOf(waiting.kind)}`, nextLevel }) };
  return null;
}

/** The first works at its ceiling, for the tip: the one whose customers are shortest. */
export function worstCeiling(g: Game): { b: Building; c: Ceiling } | null {
  let best: { b: Building; c: Ceiling } | null = null;
  for (const b of g.industry.plants()) {
    const c = ceilingOf(g, b);
    if (c && (!best || (c.town?.total ?? 0) > (best.c.town?.total ?? 0))) best = { b, c };
  }
  return best;
}

/**
 * What to do about a town's short need: build the works that makes it, build more of them (how many), or look at
 * the one that is held up. Null when the need is met, or when its makers are simply still getting going.
 */
export function needHelp(g: Game, t: Town, p: Product): NeedHelp | null {
  const more = townWants(t, p);
  if (!more) return null;
  const kind = makerKind(p);
  if (!kind) return null;
  const mine = g.industry.plants().filter((b) => (PLANTS[b.kind as PlantKind].outputs[p] ?? 0) > 0 && mainOf(b.kind as PlantKind) === p);
  if (!mine.length) return { kind: "none", build: kind, say: needHelpSay({ kind: "none", works: nameOf(kind), product: lower(p) }) };
  const near = (a: Building, c: Building) => Math.hypot(a.c.x - t.c.x, a.c.y - t.c.y) - Math.hypot(c.c.x - t.c.x, c.c.y - t.c.y);
  const up = mine.filter(working).sort(near);
  // (every town's shortfall of it: new works feed them all)
  const total = Math.max(more, markets(g).reduce((a, x) => a + townWants(x, p), 0));
  // (a jam or a missing input: that works is the thing to look at, not another one)
  const held = up.find((b) => steadyProblem(g, b));
  if (held) {
    const problem = steadyProblem(g, held)!;
    // (short of an input whose makers are all flat out: the works to build is one of those, a step up the chain)
    const q = problem.includes("stuck in traffic") ? undefined : (Object.keys(PLANTS[held.kind as PlantKind].inputs) as Product[]).find((x) => problem.startsWith(`Waiting for ${lower(x)}`));
    const full = q ? makersFlatOut(g, q, held) : null;
    if (q && full) {
      const k = full.works[0].kind as PlantKind, D = PLANTS[held.kind as PlantKind];
      // how many: enough of the input for what the works that take it could still make (no more than the towns want)
      const spare = up.reduce((a, b) => a + Math.max(0, canPerDay(g, b, p) - (madePerDay(b, p) ?? 0)), 0);
      const each = full.works.reduce((a, b) => a + canPerDay(g, b, q), 0) / full.works.length;
      const n = Math.max(1, worksFor((Math.min(total, spare) * (D.inputs[q] ?? 1)) / (D.outputs[p] ?? 1), each));
      return { kind: "full", build: k, n, works: full.works[0].id, say: `Your ${nameOf(held.kind)} is short of ${lower(q)}. ${needHelpSay({ kind: "full", works: nameOf(k), have: full.works.length, n })}` };
    }
    return { kind: "held", works: held.id, say: needHelpSay({ kind: "held", works: nameOf(held.kind), problem: problem.split(": ")[0] }) };
  }
  if (up.length && up.length === mine.length && up.every((b) => flatOut(g, b, p))) {
    const each = up.reduce((a, b) => a + canPerDay(g, b, p), 0) / up.length;
    const n = worksFor(total, each);
    return { kind: "full", build: kind, n, works: up[0].id, say: needHelpSay({ kind: "full", works: nameOf(up[0].kind), have: up.length, n }) };
  }
  return null;
}

/**
 * The order to build a set of newly unlocked works in: one that feeds another comes before it (the mines, then the
 * power plant that burns the coal, then the smelter). Play-test 2026-11-09, B5: "which first? what feeds what?"
 */
export function buildOrder(ks: readonly PlantKind[]): PlantKind[] {
  const left = [...ks], out: PlantKind[] = [];
  const makes = (k: PlantKind, p: string) => (PLANTS[k].outputs[p as Product] ?? 0) > 0;
  while (left.length) {
    const i = left.findIndex((k) => !Object.keys(PLANTS[k].inputs).some((p) => left.some((o) => o !== k && makes(o, p))));
    out.push(...left.splice(Math.max(0, i), 1));
  }
  return out;
}

/** One thing the towns are short of, across the map: the job the Goals card names once every goal is reached (E2). */
export interface Shortfall { p: Product; more: number; towns: number; worst: Town; say: string }

/**
 * What the towns are short of, the biggest first, each with what to do about it ("Your 5 Food Plants are at full
 * output. Build about 3 more."). The figures the town panels already show, added up into works to build.
 */
export function shortfalls(g: Game, max = 3): Shortfall[] {
  const by = new Map<Product, { more: number; towns: number; worst: Town; top: number }>();
  for (const t of markets(g)) for (const p of needsOf(t.pop)) {
    const more = townWants(t, p);
    if (!more) continue;
    const e = by.get(p);
    if (!e) by.set(p, { more, towns: 1, worst: t, top: more });
    else { e.more += more; e.towns++; if (more > e.top) { e.top = more; e.worst = t; } }
  }
  return [...by].sort((a, b) => b[1].more - a[1].more).slice(0, max).map(([p, e]) => {
    const who = e.towns > 1 ? `${e.worst.name} and ${e.towns - 1} more town${e.towns === 2 ? "" : "s"}` : e.worst.name;
    const help = needHelp(g, e.worst, p);
    return { p, more: e.more, towns: e.towns, worst: e.worst, say: help ? `${who}. ${help.say}` : `${who}. Your works are still getting up to pace.` };
  });
}

// ------------------------------------------------------------------------------------------- held in traffic

/** Why a junction holds a vehicle, in plain words (the sim's own names were shown raw: "Held at the junction ahead: box"). */
const BLOCK_WORDS: Record<string, string> = {
  box: "the road past the junction is full, so it waits for room",
  red: "the light is red",
  yield: "it gives way to traffic that has priority",
  stop: "it is at a stop sign, waiting for a gap",
  courtesy: "it is letting another vehicle out",
  crossing: "traffic is crossing ahead of it",
  reserved: "another vehicle has the junction, and it waits its turn",
};
export const blockWords = (why: string | undefined): string => (why && BLOCK_WORDS[why]) || "it waits for the junction ahead to clear";
/** What to do about each, where there is something to do. */
const BLOCK_FIX: Record<string, string> = {
  box: "The jam starts further on: follow the queue to its head",
  yield: "A turn lane, lights or a roundabout here gives it its turn",
  stop: "A turn lane, lights or a roundabout here gives it its turn",
  crossing: "A turn lane, lights or a roundabout here gives it its turn",
};
export const blockFix = (why: string | undefined): string => (why && BLOCK_FIX[why]) || "Open the junction to see its queues";

// ------------------------------------------------------------------------------------------- building sites

// (what each site had when it was last looked at, an hour of game time apart: display only, gone with the building)
const seen = new WeakMap<Building, { t: number; got: number }[]>();
const siteGot = (b: Building) => {
  const s = b.plant!.site!;
  let got = 0, need = 0;
  for (const p of Object.keys(s.need) as Product[]) { need += s.need[p]!; got += Math.min(s.need[p]!, s.got[p] ?? 0); }
  return { got, need };
};

/** Note how far each building site has come (call it a few times a second: it keeps one reading an hour). */
export function watchSites(g: Game) {
  for (const b of g.industry.plants()) {
    if (!b.plant?.site) continue;
    const h = seen.get(b) ?? [];
    const last = h[h.length - 1];
    if (last && g.time < last.t) h.length = 0; // (a game loaded from before)
    if (h.length && g.time - h[h.length - 1].t < HOUR) continue;
    h.push({ t: g.time, got: siteGot(b).got });
    if (h.length > 9) h.shift();
    seen.set(b, h);
  }
}

/** Loads an hour a site has been getting, over the hours it has been watched (0: none yet, or not watched long). */
export function sitePace(b: Building, now: number): number {
  const h = seen.get(b);
  if (!h?.length || !b.plant?.site) return 0;
  const span = (now - h[0].t) / HOUR;
  return span >= 1 ? Math.max(0, siteGot(b).got - h[0].got) / span : 0;
}

/**
 * A works held up for an input says where its next load is (A13: a new Food Plant read "Waiting for crops: build or
 * connect a plant that makes it" for nine hours with two farms full): the nearest of the company's works that
 * makes it, and about how long till a load is here. `first`: it has never had any, so this is it starting up.
 */
export function nextLoad(g: Game, b: Building, p: Product): { from: Building | null; hours: number | null; building: boolean; say: string } {
  const makes = (o: Building) => o.id !== b.id && !!o.plant && (PLANTS[o.kind as PlantKind].outputs[p] ?? 0) > 0;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const mine = g.industry.plants().filter(makes).sort((x, y) => d(x) - d(y));
  const name = lower(p);
  if (!mine.length) {
    const k = makerKind(p);
    return { from: null, hours: null, building: false, say: `Nothing of yours makes ${name} yet${k ? `. Build ${an(nameOf(k))} ${nameOf(k)}` : ""}` };
  }
  const where = (o: Building) => `${nameOf(o.kind)} (${d(o) < 950 ? `${Math.round(d(o) / 10) * 10} m` : `${(d(o) / 1000).toFixed(1)} km`})`;
  // a load already on the road to it
  let best: { o: Building; s: number } | null = null;
  const drive = (m: number) => (m * 1.35) / (ROAD_TYPES.street.speed * 0.8) + 30;
  for (const tr of g.trips()) {
    const h = tr.haul;
    if (!h || h.done || h.leg !== "out" || h.dest !== b.id || h.product !== p) continue;
    const o = g.buildings.byId.get(h.plant);
    if (!o) continue;
    // (how long it has left: the whole drive, less the time it has been out)
    const s = Math.max(60, drive(d(o)) - Math.max(0, g.time - tr.startT));
    if (!best || s < best.s) best = { o, s };
  }
  if (best) return { from: best.o, hours: best.s / HOUR, building: false, say: `A load of ${name} is on the way from your ${where(best.o)}: ${aboutHours(best.s / HOUR)}` };
  const up = mine.filter(working);
  if (!up.length) return { from: mine[0], hours: null, building: true, say: `Your ${where(mine[0])} is still being built. It sends ${name} once it opens` };
  // none on the road: the nearest works that makes it, its next batch and the drive
  const o = up[0], P = o.plant!, D = PLANTS[o.kind as PlantKind];
  const perDay = canPerDay(g, o, p);
  const batch = perDay > 0 ? ((D.outputs[p] ?? 1) * 24 * HOUR) / perDay : D.cycle;
  const wait = (P.out[p] ?? 0) >= 1 ? 0 : (1 - Math.min(1, P.prog)) * batch;
  const hours = (wait + drive(d(o))) / HOUR;
  return { from: o, hours, building: false, say: `Your ${where(o)} sends the next ${name}: ${aboutHours(hours)}` };
}

/** Has a works made anything yet (false: it is starting up, not in trouble)? */
export function hasMade(b: Building): boolean {
  const k = b.kind as PlantKind;
  return (Object.keys(PLANTS[k].outputs) as Product[]).some((p) => Industry.madeLately(b, p).made > 0) || (b.plant?.last.made ?? 0) > 0 || (b.plant?.now.made ?? 0) > 0;
}

/** The whole line for a company building site: loads in, and about how long till it opens. */
export function siteStatus(g: Game, b: Building): { line: string; hours: number | null; slow: boolean } {
  const { got, need } = siteGot(b);
  const pace = sitePace(b, g.time);
  const hours = siteHours(need - got, pace, buildTime(b.kind) / HOUR);
  return { line: siteLine(got, need, hours), hours, slow: hours !== null && hours > 36 };
}
