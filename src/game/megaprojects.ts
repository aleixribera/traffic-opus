// Landmarks (docs/design.md, "Landmarks"): one-off megaprojects the company builds once milestones open them. Each
// is a building site the size of a plant that waits for huge totals of materials, trucked in over days by the
// usual automatic freight, and for oversized pieces that come by convoy from a machine works (convoys.ts). Trucks
// from every chain converge on the one site: a traffic crunch the player plans for, with a payoff for good.
//
//   Hydro Dam          on a river: a big power station with no coal to feed, reaching far along the roads
//   Skyline Tower      in a City: the city grows faster and its shops buy more
//   Grand Exposition   beside a town: that town grows much faster, and visitors settle in every other town too
//
// A landmark is one of the company's plants (PLANTS, `mega`): it is placed, fenced and connected like any site, and
// its construction is a plant's building site (PlantState.site) plus the pieces it waits for. Its state lives on
// its PlantState, so it saves with it. Deliveries to it earn nothing: it is the company's own project.

import { dist, type V2 } from "../core/math";
import type { Building } from "./buildings";
import type { BigKind } from "./convoys";
import type { PlantDef, Product } from "./industry";

export type MegaKind = "hydrodam" | "skylinetower" | "exposition";
export const MEGA_KINDS: MegaKind[] = ["hydrodam", "skylinetower", "exposition"];

const HOUR = 40;

export interface MegaDef {
  /** what the finished landmark does, in a sentence (the panel and the catalog) */
  reward: string;
  /** where it may stand, in a sentence (null: anywhere a site may) */
  where: string | null;
  /** the oversized pieces it waits for, besides its materials */
  pieces: { kind: BigKind; n: number };
  /** the town it stands in or beside grows this much faster, and its shops buy this much more */
  growth?: number;
  demand?: number;
  /** every other town of the company's grows this much faster (visitors who stay) */
  growthAll?: number;
}

export const MEGAS: Record<MegaKind, MegaDef> = {
  hydrodam: {
    reward: "A power station on the river with no coal to feed: 360 MW for every building on its roads within 15 km. Your coal plants can be retired.",
    where: "on a river or lake shore",
    pieces: { kind: "turbine", n: 3 },
  },
  skylinetower: {
    reward: "The city it stands in grows half as fast again, and its shops and offices buy 30% more of everything.",
    where: "in a City (6,000+ people)",
    pieces: { kind: "girder", n: 4 },
    growth: 1.5, demand: 1.3,
  },
  exposition: {
    reward: "The town beside it grows twice as fast while the fair draws crowds, and visitors who stay make every other town grow 20% faster.",
    where: "beside a town (within 800 m of its edge)",
    pieces: { kind: "girder", n: 2 },
    growth: 2, growthAll: 1.2,
  },
};

/** The landmarks as company plants: no inputs or outputs, no trucks; a building site with huge totals. */
export const MEGA_PLANTS: Record<MegaKind, PlantDef> = {
  hydrodam: {
    kind: "hydrodam", tier: 4, inputs: {}, outputs: {}, cycle: HOUR, cost: 250000, upkeep: 40, trucks: 0, store: 8,
    makes: 360, reach: 15000, mega: true, pieces: MEGAS.hydrodam.pieces,
    site: { cement: 160, steel: 100, parts: 60, machinery: 30 },
    blurb: "A dam and power station across the river. Waits for cement, steel, construction parts, machinery and three turbines.",
  },
  skylinetower: {
    kind: "skylinetower", tier: 4, inputs: {}, outputs: {}, cycle: HOUR, cost: 400000, upkeep: 60, trucks: 0, store: 8,
    mega: true, pieces: MEGAS.skylinetower.pieces,
    site: { steel: 120, glass: 80, parts: 100, electronics: 30 },
    blurb: "A stepped skyscraper for a City. Waits for steel, glass, construction parts, electronics and four steel girders.",
  },
  exposition: {
    kind: "exposition", tier: 4, inputs: {}, outputs: {}, cycle: HOUR, cost: 500000, upkeep: 80, trucks: 0, store: 8,
    mega: true, pieces: MEGAS.exposition.pieces,
    site: { planks: 100, glass: 60, parts: 60, goods: 50, electronics: 40 },
    blurb: "A world's fair of pavilions round a great hall and a tower. Waits for planks, glass, parts, household goods, electronics and two girders.",
  },
};

export const isMega = (k: string): k is MegaKind => k in MEGAS;

/** A landmark's state on its PlantState: pieces delivered, when it was finished, the town it serves. */
export interface LandmarkState { pieces: number; done?: number; town?: number }

/**
 * What a load is worth to a landmark's site, against the other customers (Industry.customers): after the company's
 * own plants short of it (they keep the chains running) and a town that needs it to grow, ahead of a town's extra
 * sales and of any warehouse. So it drinks up the surplus without starving a chain.
 */
export function megaValue(price: number, km: number): number {
  return (price > 0 ? price + 200 : 5000) - km * 8;
}

/** How far along a landmark's site is, 0..1: every load and piece delivered against everything it needs. */
export function megaProgress(b: Building, def: PlantDef): number {
  const P = b.plant;
  if (!P) return 0;
  if (!P.site) return 1;
  let need = 0, got = 0;
  for (const [p, n] of Object.entries(P.site.need) as [Product, number][]) { need += n; got += Math.min(n, P.site.got[p] ?? 0); }
  // (a piece counts as much as 10 loads: it is a convoy's worth of effort)
  const pn = def.pieces?.n ?? 0;
  need += pn * 10;
  got += Math.min(pn, P.landmark?.pieces ?? 0) * 10;
  return need > 0 ? got / need : 1;
}

/** The stage a landmark's model shows: 1 foundations, 2 rising, 3 finished. */
export function megaStage(b: Building, def: PlantDef): 1 | 2 | 3 {
  if (!b.plant?.site) return 3;
  return megaProgress(b, def) < 0.4 ? 1 : 2;
}

/** Pieces a landmark's site still waits for. */
export function piecesLeft(b: Building, def: PlantDef | undefined): { kind: BigKind; n: number } | null {
  if (!def?.mega || !def.pieces || !b.plant?.site) return null;
  const n = def.pieces.n - (b.plant.landmark?.pieces ?? 0);
  return n > 0 ? { kind: def.pieces.kind, n } : null;
}

/** A town, as far as landmarks are concerned. */
export interface TownLike { id: number; c: V2; reach: number; pop: number }

/** Why a landmark can't stand here (null: it can). */
export function megaBlock(kind: MegaKind, c: V2, towns: TownLike[], sizeOf: (pop: number) => number, built: Building[]): string | null {
  if (built.some((b) => b.kind === kind)) return "Only one of each landmark";
  if (kind === "skylinetower") {
    const t = townAt(c, towns, 0);
    if (!t || sizeOf(t.pop) < 3) return "Has to stand in a City (6,000+ people)";
  }
  if (kind === "exposition" && !townAt(c, towns, 800)) return "Has to stand beside a town (within 800 m of its edge)";
  return null;
}

/** The town whose land reaches within `extra` of p (the nearest centre), or null. */
export function townAt(p: V2, towns: TownLike[], extra: number): TownLike | null {
  let best: TownLike | null = null, bd = Infinity;
  for (const t of towns) {
    const d = dist(t.c, p);
    if (d <= t.reach + extra && d < bd) { bd = d; best = t; }
  }
  return best;
}

export interface TownBoost { growth: number; demand: number }
const NONE: TownBoost = { growth: 1, demand: 1 };

/** What the company's finished landmarks do for a town: how much faster it grows and how much more it buys. */
export function townBoost(town: number, buildings: Building[]): TownBoost {
  let out: TownBoost | null = null;
  for (const b of buildings) {
    const L = b.plant?.landmark;
    if (!L?.done || !isMega(b.kind)) continue;
    const M = MEGAS[b.kind];
    const mine = L.town === town;
    const g = mine ? (M.growth ?? 1) : (M.growthAll ?? 1);
    const d = mine ? (M.demand ?? 1) : 1;
    if (g === 1 && d === 1) continue;
    out ??= { ...NONE };
    out.growth *= g;
    out.demand *= d;
  }
  return out ?? NONE;
}
