// Buildings the player places (rather than ones that grow in towns): what each costs to build and keep, when it
// unlocks, and what it does. Placed buildings take workers like any workplace (see Society.matchJobs). The
// company's extractors and plants are placed buildings too; their costs come from industry.ts (PLANTS).

import type { BuildingKind } from "../config";
import { PLANTS, type PlantKind } from "./industry";

export type PlacedKind = "coalplant" | PlantKind;
/** What a placed building supplies along the roads (see game/utilities.ts). */
export type UtilityId = "power";

export interface PlacedDef {
  kind: PlacedKind;
  cost: number;
  upkeep: number; // per game hour
  unlock: number; // milestone index
  /** utilities: which one it makes, and how much an hour at full staff (MW) */
  utility?: UtilityId;
  out?: number;
  /** one per city */
  unique?: boolean;
  /** has to stand on the shore of a river or lake */
  shore?: boolean;
}

/** How close to water (m from the lot's edge) a shore building has to be. */
export const SHORE_REACH = 24;

const plant = (k: PlantKind): PlacedDef => ({ kind: k, cost: PLANTS[k].cost, upkeep: PLANTS[k].upkeep, unlock: 0 });

export const PLACED: Record<PlacedKind, PlacedDef> = {
  farm: plant("farm"),
  loggingcamp: plant("loggingcamp"),
  foodplant: plant("foodplant"),
  sawmill: plant("sawmill"),
  coalplant: { kind: "coalplant", cost: 36000, upkeep: 330, unlock: 1, utility: "power", out: 70 },
};

export const isPlacedKind = (k: BuildingKind | string): k is PlacedKind => k in PLACED;

/** Build-menu tabs of the Industry category. */
export const PLACED_TABS: { id: string; label: string; kinds: PlacedKind[]; blurb: string }[] = [
  { id: "extraction", label: "Extraction", kinds: ["farm", "loggingcamp"], blurb: "Extractors stand on a deposit and send what they win to your plants." },
  { id: "processing", label: "Processing", kinds: ["foodplant", "sawmill"], blurb: "Plants turn one product into another and sell finished goods to the towns." },
  { id: "power", label: "Power", kinds: ["coalplant"], blurb: "Power runs along the roads to every building connected to a plant." },
];
