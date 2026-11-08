// Buildings that grow on zoned land: which lot sizes each zone uses, which model stands on them, and how many
// households or jobs a lot holds at each level. Lots are measured in zone cells (8 m).

import type { BuildingKind } from "../config";
import { CELL, type ZoneGroup, type ZoneId } from "./zones";

export interface LotTemplate {
  w: number; // cells along the road
  d: number; // cells deep
  model: BuildingKind;
  /** Height multiplier range for the model (tall versions on high density). */
  tall?: [number, number];
}

/**
 * Largest first: growth tries the biggest lot that fits, with some randomness. Every zone ends in a small lot (two
 * or three cells), so any leftover piece of zoned land deep and wide enough to zone at all grows something.
 *
 * Each density is an era of building (docs/design.md, "Towns grow into cities"): houses and high-street shop-houses
 * in a hamlet, terraces in a village, 1960s blocks, stores and offices in a town, modern flats, malls and office
 * towers in a city, apartment and glass towers in a metropolis core. Tall zones use the tall models (a model is
 * only stretched a little, for a varied skyline).
 */
export const ZONE_LOTS: Record<ZoneId, LotTemplate[]> = {
  resLow: [{ w: 2, d: 3, model: "house" }, { w: 2, d: 2, model: "house" }],
  resRow: [{ w: 3, d: 3, model: "terrace" }, { w: 3, d: 2, model: "terrace" }, { w: 2, d: 2, model: "terrace" }],
  resMed: [{ w: 4, d: 4, model: "apartments" }, { w: 4, d: 3, model: "terrace", tall: [1.5, 1.8] }, { w: 3, d: 3, model: "apartments" }, { w: 2, d: 2, model: "terrace", tall: [1.4, 1.6] }],
  resHigh: [{ w: 4, d: 4, model: "modernflats", tall: [0.95, 1.15] }, { w: 3, d: 3, model: "modernflats", tall: [1.1, 1.3] }, { w: 2, d: 2, model: "terrace", tall: [1.6, 1.9] }],
  resTower: [{ w: 4, d: 4, model: "aptower", tall: [0.85, 1.2] }, { w: 3, d: 3, model: "aptower", tall: [0.9, 1.1] }, { w: 2, d: 2, model: "apartments", tall: [1.6, 2] }],
  comLow: [{ w: 3, d: 3, model: "highstreet" }, { w: 2, d: 3, model: "highstreet" }, { w: 2, d: 2, model: "shop" }],
  comMid: [{ w: 4, d: 4, model: "store" }, { w: 3, d: 3, model: "office" }, { w: 3, d: 3, model: "store" }, { w: 2, d: 2, model: "shop" }],
  comHigh: [{ w: 6, d: 5, model: "mall" }, { w: 4, d: 4, model: "tower" }, { w: 4, d: 4, model: "glasstower", tall: [0.7, 0.85] }, { w: 3, d: 3, model: "office", tall: [1.3, 1.6] }, { w: 2, d: 2, model: "shop", tall: [1.4, 1.8] }],
  comTower: [{ w: 4, d: 4, model: "glasstower", tall: [0.95, 1.35] }, { w: 4, d: 4, model: "tower", tall: [1.3, 1.7] }, { w: 3, d: 3, model: "glasstower", tall: [0.9, 1.1] }, { w: 2, d: 2, model: "office", tall: [1.6, 2] }],
};

/** Households (residential) or jobs (everything else) per lot cell at level 1. */
const PER_CELL: Record<ZoneId, number> = {
  resLow: 0, // one household, whatever the lot
  resRow: 0, // one per column
  resMed: 0.75,
  resHigh: 1.7,
  resTower: 3.4,
  comLow: 0.45,
  comMid: 0.6,
  comHigh: 0.9,
  comTower: 1.5,
};

export const ZONE_GROUP: Record<ZoneId, ZoneGroup> = {
  resLow: "res", resRow: "res", resMed: "res", resHigh: "res", resTower: "res",
  comLow: "com", comMid: "com", comHigh: "com", comTower: "com",
};

/** Households or jobs on a lot of w x d cells at a level (1-5). */
export function capacity(zone: ZoneId, w: number, d: number, level: number, tall = 1): number {
  const lv = 1 + 0.18 * (level - 1);
  if (zone === "resLow") return 1;
  if (zone === "resRow") return w;
  return Math.max(1, Math.round(w * d * PER_CELL[zone] * tall * lv));
}

/** Land value needed to reach each level (index = level to reach). */
export const LEVEL_LV = [0, 0, 22, 38, 56, 76];

/** Model scale that fits the lot, leaving a front yard for the driveway. */
export function modelFit(t: LotTemplate, mw: number, md: number): number {
  return Math.min((t.w * CELL - 1.5) / mw, (t.d * CELL - 3) / md, 1.25);
}
