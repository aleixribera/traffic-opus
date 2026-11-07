// Buildings the player places (rather than ones that grow on zoned land): what each costs to build and keep, when
// it unlocks, and what it does. Placed buildings take workers like any workplace (see Society.matchJobs).

import { BUILDING_TYPES, type BuildingKind } from "../config";

export type PlacedKind = "coalplant";
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

export const PLACED: Record<PlacedKind, PlacedDef> = {
  coalplant: { kind: "coalplant", cost: 36000, upkeep: 330, unlock: 1, utility: "power", out: 70 },
};

export const PLACED_KINDS = Object.keys(PLACED) as PlacedKind[];
export const isPlacedKind = (k: BuildingKind | string): k is PlacedKind => k in PLACED;

/** Build-menu tabs for placed buildings. */
export const PLACED_TABS: { id: string; label: string; kinds: PlacedKind[]; blurb: string }[] = [
  { id: "power", label: "Electricity", kinds: ["coalplant"], blurb: "Power runs along the roads to every building connected to a plant." },
];

/** Display name of a placed kind. */
export const placedName = (k: PlacedKind) => BUILDING_TYPES[k].name;
