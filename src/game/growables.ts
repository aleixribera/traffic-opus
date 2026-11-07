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

/** Largest first: growth tries the biggest lot that fits, with some randomness. */
export const ZONE_LOTS: Record<ZoneId, LotTemplate[]> = {
  resLow: [{ w: 2, d: 3, model: "house" }, { w: 2, d: 2, model: "house" }],
  resRow: [{ w: 3, d: 3, model: "terrace" }, { w: 3, d: 2, model: "terrace" }],
  resMed: [{ w: 4, d: 4, model: "apartments" }, { w: 4, d: 3, model: "terrace", tall: [1.5, 1.8] }],
  resHigh: [{ w: 5, d: 5, model: "apartments", tall: [1.8, 3.2] }, { w: 4, d: 4, model: "apartments", tall: [1.6, 2.6] }],
  comLow: [{ w: 4, d: 4, model: "store" }, { w: 3, d: 3, model: "shop" }],
  comHigh: [{ w: 6, d: 5, model: "mall" }, { w: 4, d: 4, model: "store", tall: [1.6, 2.4] }],
  ind: [{ w: 5, d: 4, model: "works" }, { w: 4, d: 4, model: "foodplant" }],
  offLow: [{ w: 3, d: 3, model: "office" }],
  offHigh: [{ w: 4, d: 4, model: "tower", tall: [1.6, 3] }],
};

/** Households (residential) or jobs (everything else) per lot cell at level 1. */
const PER_CELL: Record<ZoneId, number> = {
  resLow: 0, // one household, whatever the lot
  resRow: 0, // one per column
  resMed: 0.75,
  resHigh: 1.7,
  comLow: 0.45,
  comHigh: 0.9,
  ind: 0.7,
  offLow: 1.1,
  offHigh: 2.6,
};

export const ZONE_GROUP: Record<ZoneId, ZoneGroup> = {
  resLow: "res", resRow: "res", resMed: "res", resHigh: "res",
  comLow: "com", comHigh: "com", ind: "ind", offLow: "off", offHigh: "off",
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
