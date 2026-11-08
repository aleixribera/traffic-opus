// A town's needs in words a child can read (docs/design.md, "Towns grow into cities", 2026-11-08): per product one
// state ("Plenty", "Enough", "Running low", "None!"), a row of crates for the loads it is getting a day against the
// loads it wants, and one plain sentence of what to do. The same states tint the needs on the town's map label.
// Pure over the town, so tests check every word against the sim (towns.ts growthPerDay, settlements.ts hourly).

import { PRODUCTS, type Product } from "../game/industry";
import { ROLL_FULL, ROLL_MIN, served, type Town } from "../game/settlements";
import { SETTLING, demandPerDay, growthPerDay, needFrom, needsOf, nextNeed } from "../game/towns";

export type NeedState = "plenty" | "enough" | "low" | "none";

/** The one word for each state (never colour alone: the word says it too). */
export const NEED_WORD: Record<NeedState, string> = { plenty: "Plenty", enough: "Enough", low: "Running low", none: "None!" };

/** A need supplied this well lets the town grow (towns.ts growthPerDay: 80% of a day's needs and up). */
export const ENOUGH = 0.8;
/** Most crates drawn in a row; past that each crate stands for several loads (a round number of them). */
export const MAX_CRATES = 10;

/**
 * The state a share of a day's need (0..1+) reads as: "None!" while not one crate's worth is coming (`crate`: the
 * share one crate stands for), so the word and the picture always agree.
 */
export function needState(share: number, crate: number): NeedState {
  if (share >= 1 - 1e-9) return "plenty";
  if (share >= ENOUGH) return "enough";
  if (share < crate - 1e-9) return "none";
  return "low";
}

/** Loads one crate stands for, a round number, so a need of any size fits in MAX_CRATES: 1, 2, 3, 4, 5, 6, 8, 10, 20... */
export function loadsPerCrate(want: number): number {
  const need = want / MAX_CRATES;
  for (let k = 1; ; k *= 10) for (const m of [1, 2, 3, 4, 5, 6, 8]) if (m * k >= need - 1e-9) return m * k;
}

/**
 * Loads of a product a town is getting a day at the moment: the last day of hours its supply rolls on (settlements.ts
 * hourly), or, when it is more, that day with the hour under way in place of the oldest hour, so a load shows the
 * moment it lands. A town with fewer than a few hours behind it goes on yesterday and today.
 */
export function loadsLately(t: Town, p: Product): number {
  const hours = t.hours ?? [];
  if (hours.length < ROLL_MIN) return (t.yesterday[p] ?? 0) + (t.today[p] ?? 0);
  // (fewer than a day of hours: they stand for the day, as in the sim)
  const day = (hs: Partial<Record<Product, number>>[], extra: number) => {
    let n = extra;
    for (const h of hs) n += h[p] ?? 0;
    return n * (24 / Math.max(hs.length + (extra ? 1 : 0), ROLL_FULL));
  };
  const now = t.hourNow?.[p] ?? 0;
  return Math.max(day(hours, 0), now ? day(hours.slice(-23), now) : 0);
}

export interface NeedView {
  p: Product;
  name: string;
  state: NeedState;
  word: string;
  /** loads a day it gets, and wants to grow */
  got: number;
  want: number;
  /** whole loads a day still missing to fill every crate (0 when full) */
  more: number;
  /** the crates: how many, how many filled, and the loads each stands for */
  crates: { n: number; full: number; per: number };
  /** the one plain sentence: what to do */
  say: string;
}

const loads = (n: number) => (n === 1 ? "load" : "loads");

/** One need of a town, read out. */
export function needView(t: Town, p: Product): NeedView {
  const want = demandPerDay(p, t.pop), got = loadsLately(t, p);
  const share = want > 0 ? got / want : 1;
  const per = loadsPerCrate(want), n = Math.max(1, Math.ceil(want / per - 1e-6));
  const state = needState(share, per / want);
  const full = state === "plenty" ? n : Math.min(n, Math.floor(got / per + 1e-6));
  const more = state === "plenty" ? 0 : Math.max(1, Math.ceil(want - got - 1e-6));
  const name = PRODUCTS[p].name, low = name.toLowerCase();
  let say: string;
  if (t.spawned && !served(t)) say = `No road reaches it yet. Lay one, then bring ${low}.`;
  else if (state === "plenty") say = `${name} is fine.`;
  else if (state === "enough") say = `Enough to grow. ${more} more ${loads(more)} a day fills every crate.`;
  else if (state === "low") say = `Bring ${more} more ${loads(more)} of ${low} a day.`;
  else if (got < 0.05) say = `No ${low} is coming. Bring ${more} ${loads(more)} a day.`;
  else say = `Almost no ${low} is coming. Bring ${more} more ${loads(more)} a day.`;
  return { p, name, state, word: NEED_WORD[state], got, want, more, crates: { n, full, per }, say };
}

/** Everything a town needs now, read out, in the order the needs opened. */
export const townNeeds = (t: Town): NeedView[] => needsOf(t.pop).map((p) => needView(t, p));

/** The need(s) a town will have next and the population they open at (null: none ahead). */
export function comingNeeds(pop: number): { products: Product[]; pop: number } | null {
  const nn = nextNeed(pop);
  if (!nn) return null;
  const products = Object.keys(PRODUCTS).filter((p) => needFrom(p as Product) === nn.pop) as Product[];
  return { products: products.length ? products : [nn.p], pop: nn.pop };
}

// ------------------------------------------------------------------ how it grows, in words

export type GrowthWord = "Settling in" | "Shrinking" | "Not growing" | "Growing slowly" | "Growing" | "Growing fast";

/** Its pace against its best (every need met in full) at or above which a town is "Growing fast", and "Growing". */
export const GROW_FAST = 0.95, GROW_OK = 0.5;

/**
 * How a town is growing, in a word and no numbers (docs/design.md, 2026-11-08): its pace now against the pace it would
 * have with every need met in full (towns.ts growthPerDay), so the words mean the same in a hamlet and a city. All
 * needs "Enough" reads "Growing", all "Plenty" "Growing fast"; one running low holds it to a trickle, "Growing slowly".
 * Below its best it says why, in the needs' own words ("needs food").
 */
export function growthOf(t: Town): { word: GrowthWord; tone: "good" | "bad" | ""; why: string } {
  if (t.pop < SETTLING) return { word: "Settling in", tone: "", why: "" };
  const short = townNeeds(t).filter((v) => v.state === "low" || v.state === "none").map((v) => v.name.toLowerCase());
  const why = short.length ? `needs ${short.length > 1 ? `${short.slice(0, -1).join(", ")} and ${short[short.length - 1]}` : short[0]}` : "";
  if (t.trend <= -0.5) return { word: "Shrinking", tone: "bad", why };
  if (t.trend < 0.5) return { word: "Not growing", tone: short.length ? "bad" : "", why };
  const best = growthPerDay(t.pop);
  const k = best > 0 ? t.trend / best : 1;
  if (k >= GROW_FAST) return { word: "Growing fast", tone: "good", why: "" };
  if (k >= GROW_OK) return { word: "Growing", tone: "good", why: "" };
  return { word: "Growing slowly", tone: "", why: short.length ? why.replace(/^needs /, "needs more ") : "" };
}

/** What a town's map label shows: nothing when all is well, its needs tinted by state when one isn't, or no road. */
export type LabelNeeds = { kind: "calm" } | { kind: "noroad"; needs: Product[] } | { kind: "needs"; needs: { p: Product; state: NeedState }[] };

export function labelNeeds(t: Town): LabelNeeds {
  if (t.spawned && !served(t)) return { kind: "noroad", needs: needsOf(t.pop) };
  // (a settlement fills its first streets whatever comes: nothing to ask of the player yet)
  if (t.pop < SETTLING) return { kind: "calm" };
  const needs = townNeeds(t).map((v) => ({ p: v.p, state: v.state }));
  return needs.some((n) => n.state === "low" || n.state === "none") ? { kind: "needs", needs } : { kind: "calm" };
}
