// A town's needs in words a child can read (docs/design.md, "Towns grow into cities", 2026-11-08): per product one
// state ("Plenty", "Enough", "Running low", "None!"), a bar of the loads a day it is getting against the loads a day
// it wants, and one plain sentence of what to do. Goods are counted in one unit wherever a player sees them: loads a
// day (design audit 2026-11-10, F05 and F25: the crates read as a second unit). The same states tint the needs on the town's map label.
// Pure over the town, so tests check every word against the sim (towns.ts growthPerDay, settlements.ts hourly).

import { PRODUCTS, type Product } from "../game/industry";
import { served, townGrowth, type Town } from "../game/settlements";
import { ENOUGH, deliveredLately } from "../game/supply";
import { HOLD_FROM, SETTLING, SUPPLY_HOURS, SUPPLY_WARMUP, demandPerDay, needFrom, needsOf, nextNeed, type GrowthBand } from "../game/towns";

export type NeedState = "plenty" | "enough" | "low" | "none";

/** The one word for each state (never colour alone: the word says it too). */
export const NEED_WORD: Record<NeedState, string> = { plenty: "Plenty", enough: "Enough", low: "Running low", none: "None!" };

// (a need supplied this well lets the town grow: supply.ts ENOUGH, 85% of a day's needs and up)
export { ENOUGH };
/** A need is read in at most this many steps: under one step's worth coming, it reads "None!". */
export const STEPS = 10;

/**
 * The state a share of a day's need (0..1+) reads as: "None!" while not one step's worth is coming (`step`: the
 * share one step stands for, a round number of loads: loadStep), so a trickle of one load into a city reads "None!".
 */
export function needState(share: number, step: number): NeedState {
  if (share >= 1 - 1e-9) return "plenty";
  if (share >= ENOUGH) return "enough";
  if (share < step - 1e-9) return "none";
  return "low";
}

/**
 * How far under a full day's need "Plenty" may slip and keep its word (down to 95%). It is only earned at 100%. Why:
 * what has landed lately moves with every hourly reading, so a town fed just about right read "Plenty", then
 * "Enough", then "Plenty" again each game hour (coordinator, 2026-11-09: "reads as flicker"). Both words mean
 * "growing", so holding one is harmless. The "Enough" line has no band: under it the town is short for growth, and
 * the panel must say so. The grace (supply.ts GRACE) already covers a short dip there.
 */
export const HOLD_BAND = 0.05;

// the word each town's need showed last, so the next reading can hold it (display only: not in the save, gone with the town)
const shownLast = new WeakMap<Town, Partial<Record<Product, NeedState>>>();

/** The state to show, given the one shown last: "Plenty" keeps its word through a slip of less than HOLD_BAND. */
export function heldState(share: number, step: number, last: NeedState | undefined): NeedState {
  const now = needState(share, step);
  if (last === "plenty" && now === "enough" && share >= 1 - HOLD_BAND - 1e-9) return "plenty";
  return now;
}

/** Loads one step stands for, a round number, so a need of any size reads in STEPS: 1, 2, 3, 4, 5, 6, 8, 10, 20... */
export function loadStep(want: number): number {
  const need = want / STEPS;
  for (let k = 1; ; k *= 10) for (const m of [1, 2, 3, 4, 5, 6, 8]) if (m * k >= need - 1e-9) return m * k;
}

/**
 * Loads a day a supply comes to, read over the hours since its first load in the two days kept (never fewer than
 * SUPPLY_WARMUP), the hour under way included: the way the town's growth reads it (towns.ts averageSupply: "the
 * hours before there was any are no shortfall"). 0 when nothing has landed in that time.
 */
export function sinceFirstLoad(t: Town, p: Product): number {
  const hs = (t.hours ?? []).slice(-SUPPLY_HOURS), now = t.hourNow?.[p] ?? 0;
  let n = now, since = now > 0 ? 1 : 0;
  // (oldest first: the first hour with a load sets how long the supply has been coming, the hour under way included)
  for (let i = hs.length - 1; i >= 0; i--) {
    const k = hs[i][p] ?? 0;
    if (k > 0) { n += k; since = hs.length - i + 1; }
  }
  return since ? (n * 24) / Math.max(since, SUPPLY_WARMUP) : 0;
}

/**
 * Loads of a product a town is getting a day at the moment, as its people see it: what has landed lately (supply.ts
 * deliveredLately), or, while a need that has just fallen below "Enough" is in its grace, what it read before.
 *
 * A supply less than two days old is read over the hours since its first load (sinceFirstLoad), as the town's growth
 * reads it. Before, the panel spread a new plant's first loads over the whole day gone by: a hamlet with a Food
 * Plant sending 24 loads a day against the 10 it wants read "Running low, bring 7 more", was told to build a second
 * plant, and said "Growing fast" on the line above, because its growth already counted the supply in full (owner,
 * 2026-11-10: "numbers that disagree side by side").
 */
export function loadsLately(t: Town, p: Product): number {
  return Math.max(t.grace?.[p]?.got ?? deliveredLately(t, p), sinceFirstLoad(t, p));
}

export interface NeedView {
  p: Product;
  name: string;
  state: NeedState;
  word: string;
  /** loads a day it gets, and wants to grow */
  got: number;
  want: number;
  /** whole loads a day still missing for "Plenty" (0 when it has plenty) */
  more: number;
  /** how full its bar is, 0..1: what it gets of what it wants (1 when the word is "Plenty", held or not) */
  fill: number;
  /** the one plain sentence: what to do */
  say: string;
}

const loads = (n: number) => (n === 1 ? "load" : "loads");
/** "is" or "are" for a product's name: planks are coming, food is. */
export const isAre = (name: string) => (/[^s]s$/i.test(name) ? "are" : "is");

/**
 * One need of a town, read out. `joined`: a town that sprang up already has a road to the company's roads (it is
 * only waiting for its first load: play-test 2026-11-09, A10, it read "No road yet" for six hours after the road).
 */
export function needView(t: Town, p: Product, joined = false): NeedView {
  const want = demandPerDay(p, t.pop), got = loadsLately(t, p);
  const share = want > 0 ? got / want : 1;
  // (a "Plenty" held for the eye: HOLD_BAND. The bar follows the word, so a held "Plenty" is still a full bar)
  const last = shownLast.get(t) ?? {};
  const state = heldState(share, want > 0 ? loadStep(want) / want : 0, last[p]);
  last[p] = state;
  shownLast.set(t, last);
  const fill = state === "plenty" ? 1 : Math.max(0, Math.min(1, share));
  const more = state === "plenty" ? 0 : Math.max(1, Math.ceil(want - got - 1e-6));
  const name = PRODUCTS[p].name, low = name.toLowerCase();
  let say: string;
  if (t.spawned && !served(t)) say = joined ? `A road reaches it now. It waits for its first load of ${low}.` : `No road reaches it yet. Lay one, then bring ${low}.`;
  else if (state === "plenty") say = `${name} is fine.`;
  // (the need its proven supply runs out on, with the town stood still at what that supply carries: "Enough" holds
  // it, a little more lets it grow again)
  else if (state === "enough" && t.limit === p && t.trend < 0.5) say = `Just enough to hold steady. ${more} more ${loads(more)} a day and it grows again.`;
  else if (state === "enough") say = `Enough to grow. ${more} more ${loads(more)} a day and it has plenty.`;
  else if (state === "low") say = `Bring ${more} more ${loads(more)} of ${low} a day.`;
  else if (got < 0.05) say = `No ${low} ${isAre(low)} coming. Bring ${more} ${loads(more)} a day.`;
  else say = `Almost no ${low} ${isAre(low)} coming. Bring ${more} more ${loads(more)} a day.`;
  return { p, name, state, word: NEED_WORD[state], got, want, more, fill, say };
}

/** Everything a town needs now, read out, in the order the needs opened. */
export const townNeeds = (t: Town, joined = false): NeedView[] => needsOf(t.pop).map((p) => needView(t, p, joined));

/** The need(s) a town will have next and the population they open at (null: none ahead). */
export function comingNeeds(pop: number): { products: Product[]; pop: number } | null {
  const nn = nextNeed(pop);
  if (!nn) return null;
  const products = Object.keys(PRODUCTS).filter((p) => needFrom(p as Product) === nn.pop) as Product[];
  return { products: products.length ? products : [nn.p], pop: nn.pop };
}

// ------------------------------------------------------------------ how it grows, in words

/**
 * How a town is growing, as the sim decides it and in its words (settlements.ts townGrowth, owner 2026-11-10: no
 * second rule here): its band ("fast", "slow", "hold", "shrink"), the word that leads its line ("Holding steady"),
 * and the line with the need that holds it named ("Holding steady: 72% supplied with food, grows from 85%"). Red
 * below HOLD_FROM, where it is short and soon shrinks; green at its full pace.
 */
export function growthOf(t: Town): { band: GrowthBand; word: string; tone: "good" | "bad" | ""; line: string; by: Product | null } {
  const tg = townGrowth(t);
  const i = tg.line.indexOf(": ");
  const word = i > 0 ? tg.line.slice(0, i) : tg.line;
  // (its supply level is its worst-supplied need's: name that need, "72% supplied with food")
  const name = tg.by && tg.band !== "fast" ? PRODUCTS[tg.by].name.toLowerCase() : "";
  const line = name ? tg.line.replace(/(\d+%) supplied/, `$1 supplied with ${name}`) : tg.line;
  const tone = tg.band === "fast" ? "good" : tg.band === "shrink" || tg.level < HOLD_FROM ? "bad" : "";
  return { band: tg.band, word, tone: t.pop < SETTLING ? "" : tone, line, by: tg.by };
}

/**
 * What a town's map label shows: nothing when all is well, its needs tinted by state when one isn't, or that no road
 * reaches it yet (`joined`: one does now, and it waits for its first load).
 */
export type LabelNeeds = { kind: "calm" } | { kind: "noroad"; needs: Product[]; joined: boolean } | { kind: "needs"; needs: { p: Product; state: NeedState }[] };

/**
 * What a town's map label says in one chip when zoomed far out, where a row of need discs is too small to read and
 * heaps on its neighbours (design audit 2026-11-10, F27, F41, F42): the needs in trouble named, "Needs food and
 * planks", past two counted, "Short of 3 needs", in the words of the town's own growth line. "bad" while one has none
 * coming. Null: nothing to say.
 */
export function labelSummary(ln: LabelNeeds): { text: string; tone: "bad" | "low" | "" } | null {
  if (ln.kind === "calm") return null;
  if (ln.kind === "noroad") return { text: ln.joined ? "First load due" : "No road yet", tone: "" };
  const short = ln.needs.filter((n) => n.state === "low" || n.state === "none");
  if (!short.length) return null;
  const names = short.map((n) => PRODUCTS[n.p].name.toLowerCase());
  const text = short.length > 2 ? `Short of ${short.length} needs` : `Needs ${names.join(" and ")}`;
  return { text, tone: short.some((n) => n.state === "none") ? "bad" : "low" };
}

export function labelNeeds(t: Town, joined = false): LabelNeeds {
  if (t.spawned && !served(t)) return { kind: "noroad", needs: needsOf(t.pop), joined };
  // (a settlement fills its first streets whatever comes: nothing to ask of the player yet)
  if (t.pop < SETTLING) return { kind: "calm" };
  const needs = townNeeds(t).map((v) => ({ p: v.p, state: v.state }));
  return needs.some((n) => n.state === "low" || n.state === "none") ? { kind: "needs", needs } : { kind: "calm" };
}
