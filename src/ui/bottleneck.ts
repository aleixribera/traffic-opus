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
import { HIST_HOURS, Industry, PLANTS, PRODUCTS, powerPace, type PlantKind, type Product } from "../game/industry";
import { unlockedBy } from "../game/progression";
import { served, type Town } from "../game/settlements";
import { SITE_LEVELS } from "../game/sites";
import { HOUR } from "../game/society";
import { SETTLING, demandPerDay, needsOf } from "../game/towns";
import { loadsLately, townNeeds } from "./needs";

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

/**
 * Loads an hour a works reads as making, beside what it can make: the one pace its panel, its status and the town's
 * advice all go by (paceOf). Never above what it can make: its output comes in whole batches, so the hours read can
 * hold one more than its pace allows (a camp read "0.7/h, can 0.6": owner, 2026-11-10), and a works the status
 * calls "At full output" shows exactly what it can make. Null: nothing made yet.
 */
export function shownRate(g: Game, b: Building, p: Product): { rate: number | null; can: number } {
  const can = canPerDay(g, b, p) / 24;
  const x = paceOf(b, p);
  if (x) return { rate: flatOut(g, b, p) ? can : Math.min(can, x.made / x.hours), can };
  // (no pace yet: over the hours since its first load, fewer than PACE_HOURS of them)
  const by = Industry.madeLately(b, p).byHour, first = by.findIndex((v) => v > 0);
  if (first < 0) return { rate: null, can };
  const w = by.slice(first);
  return { rate: Math.min(can, w.reduce((a, v) => a + v, 0) / w.length), can };
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
  if (waiting) return { p, made, can, works: waiting, nextLevel, fix: ceilingFix({ works: nameOf(k), product: lower(p), taker: `Your ${startUp(g, waiting) ? "new " : ""}${nameOf(waiting.kind)}`, nextLevel }) };
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
  // (one in real trouble before one only starting up, so the advice does not flick between the two as loads land)
  const helds = up.filter((b) => steadyProblem(g, b));
  const held = helds.find((b) => !startUp(g, b));
  const starting = helds.filter((b) => startUp(g, b));
  // (one new works starting up beside others flat out: the advice is still how many more, the new one counted in.
  // The late save's Food row talked about the new Food Plant's first load with 1,055 loads a day still short)
  const rest = up.filter((b) => !starting.includes(b));
  if (!held && starting.length && rest.length && up.length === mine.length && rest.every((b) => flatOut(g, b, p))) {
    const each = rest.reduce((a, b) => a + canPerDay(g, b, p), 0) / rest.length;
    const n = worksFor(Math.max(0, total - starting.reduce((a, b) => a + canPerDay(g, b, p), 0)), each);
    const also = `Your new ${nameOf(starting[0].kind)} is starting up${starting.length > 1 ? `, and ${starting.length - 1} more` : ""}.`;
    if (n > 0) return { kind: "full", build: kind, n, works: rest[0].id, say: `${needHelpSay({ kind: "full", works: nameOf(rest[0].kind), have: rest.length, n })} ${also}` };
  }
  if (!held && starting.length) {
    // (a works that has made nothing yet is starting up: it says when its first load comes, not that it is held up)
    const su = startUp(g, starting[0])!;
    return { kind: "held", works: starting[0].id, say: `Your ${nameOf(starting[0].kind)} is starting up. ${su.fix}` };
  }
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
 * The one piece of advice a town's panel gives (owner, 2026-11-10: a joined town said the same thing three times,
 * once on its status line, once per need as a sentence and once per need as advice). About one need only: the first
 * that has none coming, else the first running low, else the one its growth stands on. It says what to do (the works
 * to build or to look at: needHelp), or failing that how much to bring. `works`: the one to show. Null when the town
 * has what it needs, or is still settling in.
 */
export function townAdvice(g: Game, t: Town, joined: boolean): { p: Product; say: string; works?: number } | null {
  if (t.pop < SETTLING || (t.spawned && !served(t))) return null;
  const views = townNeeds(t);
  const short = views.filter((v) => v.state === "none" || v.state === "low");
  const worst = views.find((v) => v.state === "none") ?? short[0] ?? (t.trend < 0.5 && t.limit ? views.find((v) => v.p === t.limit && v.state !== "plenty") : undefined);
  if (!worst) return null;
  const nh = joined ? needHelp(g, t, worst.p) : null;
  // (several short: which to see to first, so the line under the status is still one piece of advice)
  const lead = short.length > 1 ? `Start with ${lower(worst.p)}. ` : "";
  return { p: worst.p, say: lead + (nh ? nh.say : worst.say), works: nh && "works" in nh ? nh.works : undefined };
}

/**
 * The order to build a set of newly unlocked works in. A works that powers the others comes first, when it can burn
 * something the company already has (the Power Plant runs on the sawmills' wood chips): every works that draws
 * power stands at 40% without it, so it is needed before any of them, not third (owner, 2026-11-10). After that, one
 * that feeds another comes before it, and what feeds the power plant before the rest (the coal mine, then the iron
 * mine, then the smelter). Play-test 2026-11-09, B5: "which first? what feeds what?"
 */
export function buildOrder(ks: readonly PlantKind[]): PlantKind[] {
  const makes = (k: PlantKind, p: string) => (PLANTS[k].outputs[p as Product] ?? 0) > 0;
  const draws = ks.some((k) => PLANTS[k].power);
  // (its other fuel is made by a works from an earlier goal: nothing in this set has to come before it)
  const power = draws ? ks.filter((k) => PLANTS[k].makes && Object.keys(PLANTS[k].inputs).every((p) => !!PLANTS[k].alt?.[p as Product] && !ks.some((o) => makes(o, PLANTS[k].alt![p as Product]!)))) : [];
  const left = ks.filter((k) => !power.includes(k)), out: PlantKind[] = [...power];
  const feedsPower = (k: PlantKind) => power.some((w) => Object.keys(PLANTS[w].inputs).some((p) => makes(k, p)));
  while (left.length) {
    const free = left.filter((k) => !Object.keys(PLANTS[k].inputs).some((p) => left.some((o) => o !== k && makes(o, p))));
    const next = free.find(feedsPower) ?? free[0] ?? left[0];
    out.push(...left.splice(left.indexOf(next), 1));
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

// ------------------------------------------------------------------------------------------- starting up, and waiting

const where = (o: Building, from: Building) => {
  const d = Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y);
  return `${nameOf(o.kind)} (${d < 950 ? `${Math.round(d / 10) * 10} m` : `${(d / 1000).toFixed(1)} km`})`;
};

/** Does a kind of works take a product in (as an input, or in place of one)? */
const takes = (k: PlantKind, p: Product) => (PLANTS[k].inputs[p] ?? 0) > 0 || Object.values(PLANTS[k].alt ?? {}).includes(p);

/**
 * Hours a works takes over one batch of p: `whole` fully staffed and powered, and `left` for the batch in hand at
 * the staff and power it has now (null: nobody at work). The sim's own sum (industry.ts produce), read out.
 */
export function batchHours(g: Game, b: Building, p: Product): { whole: number; left: number | null } {
  const D = PLANTS[b.kind as PlantKind], P = b.plant!;
  const can = canPerDay(g, b, p);
  const whole = can > 0 ? ((D.outputs[p] ?? 1) * 24) / can : D.cycle / HOUR;
  const staff = b.cap ? Math.min(1, g.people.workersAt(b.id) / b.cap) : 1;
  const pw = D.power ? powerPace(g.utilities.supplyOf(b)) : 1;
  return { whole, left: staff * pw > 0 ? ((1 - Math.min(1, P.prog)) * whole) / (staff * pw) : null };
}

/** Game hours a new works may stand without staff before that is trouble: its first workers are on their way. */
export const START_HOURS = 6;
// when each works was first seen open with nothing made yet (display only: not in the save)
const openedAt = new WeakMap<Building, number>();

/** Where the first load of a works will go, as the end of its starting-up line. */
function firstTruck(g: Game, b: Building, p: Product): string {
  if (PRODUCTS[p].price > 0) return " Then its first truck leaves for the shops.";
  const mine = g.industry.plants().filter((o) => o.id !== b.id && takes(o.kind as PlantKind, p));
  const near = (a: Building, c: Building) => Math.hypot(a.c.x - b.c.x, a.c.y - b.c.y) - Math.hypot(c.c.x - b.c.x, c.c.y - b.c.y);
  const up = mine.filter(working).sort(near)[0];
  if (up) return ` Then its first truck leaves for your ${where(up, b)}.`;
  const going = [...mine].sort(near)[0];
  if (going) return ` Your ${where(going, b)} takes it once it opens.`;
  const k = (Object.keys(PLANTS) as PlantKind[]).find((x) => takes(x, p) && g.placedUnlocked(x));
  return k ? ` Nothing of yours takes ${lower(p)} yet: build ${an(nameOf(k))} ${nameOf(k)} on its roads.` : "";
}

/**
 * A works that is open and has made nothing yet is starting up, not in trouble (owner, 2026-11-10: "the first ten
 * game hours are quiet": a new Farm read "No workers" in red, then "Working normally, 0.0/h"). It says what it is
 * doing and when its first truck leaves: its workers on their way, the load of an input it waits for, or the batch in
 * hand and how long that has to go. Null once it has made something, and for anything that is real trouble (no
 * road, no works that makes its input, loads stuck in traffic, no staff after START_HOURS).
 */
export function startUp(g: Game, b: Building): { fix: string; hours: number | null } | null {
  if (!working(b) || !b.placed || !b.access || hasMade(b)) return null;
  // (a day on and still nothing made is no start-up any more, whatever holds it: its problem line says what)
  if ((b.plant!.hist?.length ?? 0) >= HIST_HOURS) return null;
  const k = b.kind as PlantKind, D = PLANTS[k];
  if (D.logistics || D.mega || D.makes) return null;
  const p = mainOf(k);
  if (!p) return null;
  if (!openedAt.has(b)) openedAt.set(b, g.time);
  const pr = b.problem ?? "", bh = batchHours(g, b, p);
  // (nobody at work yet, whether or not the sim has said so this hour)
  if (pr.startsWith("No workers") || (!pr && bh.left === null)) {
    if (pr && g.time - openedAt.get(b)! > START_HOURS * HOUR) return null;
    return { hours: null, fix: `Its first workers are on their way from town. Once they start, its first load of ${lower(p)} takes ${aboutHours(bh.whole)}.` };
  }
  if (pr.startsWith("Waiting for")) {
    if (pr.includes("stuck in traffic")) return null;
    const q = (Object.keys(D.inputs) as Product[]).find((x) => pr.startsWith(`Waiting for ${lower(x)}`));
    const next = q ? nextLoad(g, b, q) : null;
    // (nothing of the company's makes it: that is the thing to build, not a wait)
    if (!next?.from) return null;
    return { hours: next.hours === null ? null : next.hours + bh.whole, fix: `${next.say}. Its first load of ${lower(p)} follows ${aboutHours(bh.whole)} after that.` };
  }
  if ((pr && !pr.startsWith("Not enough workers")) || bh.left === null) return null;
  return { hours: bh.left, fix: `Its first load of ${lower(p)} is ready in ${aboutHours(bh.left)}.${firstTruck(g, b, p)}` };
}

/** What a works going up says about after it opens: when its first load follows, or what it will wait for. */
export function afterOpening(g: Game, b: Building): string {
  const k = b.kind as PlantKind, D = PLANTS[k];
  const p = mainOf(k);
  if (!p || D.logistics || D.mega || D.makes) return "";
  const q = (Object.keys(D.inputs) as Product[])[0];
  if (!q) return ` Its first load of ${lower(p)} follows ${aboutHours(batchHours(g, b, p).whole)} later.`;
  const next = nextLoad(g, b, q);
  return next.from && !next.building ? ` Then it takes ${lower(q)} from your ${where(next.from, b)}.` : ` ${next.say}.`;
}

/**
 * A works whose yard fills because the works that will take its product is not open yet: it is waiting for that one,
 * and says how far along it is (owner, 2026-11-10: an Iron Mine read "no smelter on its roads" with the Smelter a
 * building site two fields away). `show`: the works it waits for. Null when one of the company's works that takes
 * it is open (then the haul is the story), or the product is one the towns buy.
 */
export function waitsForSite(g: Game, b: Building): { text: string; tone: "bad" | ""; fix: string; show?: number } | null {
  if (!working(b) || !b.problem) return null;
  const m = /^Full of (.+?): its trucks can't keep up .*or no .+ on its roads$/.exec(b.problem) ?? /^The plants that will use (.+) are still building sites$/.exec(b.problem);
  if (!m) return null;
  const p = (Object.keys(PLANTS[b.kind as PlantKind].outputs) as Product[]).find((q) => lower(q) === m[1]);
  if (!p || PRODUCTS[p].price > 0) return null;
  const mine = g.industry.plants().filter((o) => o.id !== b.id && takes(o.kind as PlantKind, p));
  if (mine.some(working)) return null;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const o = [...mine].sort((x, y) => d(x) - d(y))[0];
  if (o) {
    const how = o.plant!.site ? `is a building site: ${siteStatus(o).line}` : `is going up: it opens in ${aboutHours(((1 - o.built) * buildTime(o.kind)) / HOUR)}`;
    return { text: `Waiting for your ${nameOf(o.kind)} to open`, tone: "", fix: `Your ${where(o, b)} ${how}. It takes ${lower(p)} once it opens. Until then this yard fills.`, show: o.id };
  }
  const ks = (Object.keys(PLANTS) as PlantKind[]).filter((x) => takes(x, p));
  const k = ks.find((x) => g.placedUnlocked(x));
  if (k) return { text: `Nothing of yours takes ${lower(p)} yet`, tone: "bad", fix: `Build ${an(nameOf(k))} ${nameOf(k)} on its roads: it takes ${lower(p)}. Until then this yard fills.` };
  const goal = ks.length ? unlockedBy((u) => u.buildings?.includes(ks[0])) : undefined;
  const a = ks.length ? an(nameOf(ks[0])) : "";
  return ks.length ? { text: `Nothing takes ${lower(p)} yet`, tone: "", fix: `${a[0].toUpperCase()}${a.slice(1)} ${nameOf(ks[0])} takes it${goal ? `: that opens with the goal “${goal.name}”` : ""}. Until then this yard fills.` } : null;
}

/**
 * What to do about a works short of power, said for the map as it is (owner, 2026-11-10: a Coal Mine read "Build a
 * power plant within reach" with one 290 m away, standing dark for want of coal). The power plant that reaches it
 * and why it gives too little; else the one going up; else the one too far off; else build one. `show`: the power
 * plant to look at; `back`: its power came back since the sim's hourly line was written. Null when it is not short of
 * power.
 */
export function powerFix(g: Game, b: Building): { fix: string; show?: number; back?: boolean } | null {
  if (!b.problem || !/^(No power|Short of power)/.test(b.problem)) return null;
  const d = (o: Building) => Math.hypot(o.c.x - b.c.x, o.c.y - b.c.y);
  const makers = g.buildings.list.filter((o) => o.plant && (PLANTS[o.kind as PlantKind]?.makes ?? 0) > 0).sort((x, y) => d(x) - d(y));
  const reach = (o: Building) => PLANTS[o.kind as PlantKind].reach ?? 0;
  const near = makers.filter((o) => working(o) && g.utilities.reaches(o, b));
  if (near.length) {
    // (its problem line is the sim's hourly one; power is shared out eight times an hour: it can be back already)
    if (g.utilities.supplyOf(b) >= 0.999) return { fix: "It is up to pace again within the hour.", show: near[0].id, back: true };
    // (out of fuel: the trouble is its coal, so say where the next load is; making some but not enough: another)
    const dark = near.find((o) => g.utilities.outputOf(o) <= 0);
    if (dark) {
      const P = dark.plant!, D = PLANTS[dark.kind as PlantKind];
      if (!D.mega && (P.stock.coal ?? 0) < 1) {
        const next = nextLoad(g, dark, "coal");
        // (the coal it waits for is this very mine's, coming slowly for want of the power it would give back)
        const then = !next.from ? "It burns coal, or your sawmills' wood chips: join one to it by road."
          : next.from.id === b.id ? `This mine sends it coal${next.hours !== null ? `: the next load in ${aboutHours(next.hours)}` : ""}. Without power that comes slowly; wood chips from a sawmill would start it sooner.`
          : `Its next coal comes from your ${nameOf(next.from.kind)}${next.hours !== null ? `: ${aboutHours(next.hours)}` : ""}.`;
        return { fix: `Your ${where(dark, b)} has nothing to burn. ${then}`, show: dark.id };
      }
      return { fix: `Your ${where(dark, b)} makes no power: ${dark.problem ? dark.problem.split(": ")[0].toLowerCase() : "it has nobody at work"}.`, show: dark.id };
    }
    return { fix: `Your ${where(near[0], b)} cannot power everything in its reach. Build another Power Plant nearby.`, show: near[0].id };
  }
  const going = makers.find((o) => !working(o) && d(o) <= reach(o));
  if (going) {
    const how = going.plant!.site ? `is a building site: ${siteStatus(going).line}` : `is going up: it opens in ${aboutHours(((1 - going.built) * buildTime(going.kind)) / HOUR)}`;
    return { fix: `Your ${where(going, b)} ${how}. It powers this works once it opens.`, show: going.id };
  }
  const far = makers.find(working);
  if (far) {
    const r = reach(far);
    const why = d(far) > r ? `is too far: power reaches ${r / 1000} km` : "is not on the same roads";
    return { fix: `Your ${where(far, b)} ${why}. Build a Power Plant within ${PLANTS.coalplant.reach! / 1000} km of this works, on its roads.`, show: far.id };
  }
  return { fix: `Build a Power Plant within ${PLANTS.coalplant.reach! / 1000} km of it, on its roads. It burns coal, or your sawmills' wood chips.` };
}

/** Has a works made anything yet (false: it is starting up, not in trouble)? */
export function hasMade(b: Building): boolean {
  const k = b.kind as PlantKind;
  return (Object.keys(PLANTS[k].outputs) as Product[]).some((p) => Industry.madeLately(b, p).made > 0) || (b.plant?.last.made ?? 0) > 0 || (b.plant?.now.made ?? 0) > 0;
}

/**
 * The whole line for a company building site: loads in, and about how long till it opens. The count and the pace
 * are the sim's own (Industry.siteEta: one source, so the panel, the goal line and the tests read the same figures);
 * the words and the build time added on are the interface's.
 */
export function siteStatus(b: Building): { line: string; got: number; need: number; hours: number | null; slow: boolean } {
  const e = Industry.siteEta(b) ?? { got: 0, need: 0, perHour: 0, hours: 0 };
  const hours = siteHours(e.need - e.got, e.perHour, buildTime(b.kind) / HOUR);
  return { line: siteLine(e.got, e.need, hours), got: e.got, need: e.need, hours, slow: hours !== null && hours > 36 };
}
