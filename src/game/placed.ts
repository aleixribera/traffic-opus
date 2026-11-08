// Buildings the player places (rather than ones that grow in towns): what each costs to build and keep, and where
// it goes in the build menu. Every placed building is one of the company's extractors and plants (industry.ts has
// what they take and make); the milestones (progression.ts) say when each unlocks. Placed buildings take workers
// like any workplace (see Society.matchJobs).

import type { BuildingKind } from "../config";
import { PLANTS, type PlantKind } from "./industry";

export type PlacedKind = PlantKind;

export interface PlacedDef {
  kind: PlacedKind;
  cost: number;
  upkeep: number; // per game hour
  /** one per company */
  unique?: boolean;
  /** has to stand on the shore of a river or lake */
  shore?: boolean;
}

/** How close to water (m from the lot's edge) a shore building has to be. */
export const SHORE_REACH = 24;

const plant = (k: PlantKind): PlacedDef => ({ kind: k, cost: PLANTS[k].cost, upkeep: PLANTS[k].upkeep });

export const PLACED: Record<PlacedKind, PlacedDef> = {
  farm: plant("farm"),
  loggingcamp: plant("loggingcamp"),
  foodplant: plant("foodplant"),
  sawmill: plant("sawmill"),
  ironmine: plant("ironmine"),
  coalmine: plant("coalmine"),
  quarry: plant("quarry"),
  smelter: plant("smelter"),
  cementworks: plant("cementworks"),
  coalplant: plant("coalplant"),
  oilwell: plant("oilwell"),
  sandpit: plant("sandpit"),
  refinery: plant("refinery"),
  glassworks: plant("glassworks"),
  furniture: plant("furniture"),
  constructionplant: plant("constructionplant"),
  coppermine: plant("coppermine"),
  coppersmelter: plant("coppersmelter"),
  electronics: plant("electronics"),
  machineworks: plant("machineworks"),
  warehouse: plant("warehouse"),
  fueldepot: plant("fueldepot"),
};

export const isPlacedKind = (k: BuildingKind | string): k is PlacedKind => k in PLACED;

/** Build-menu tabs of the Industry category. */
export const PLACED_TABS: { id: string; label: string; kinds: PlacedKind[]; blurb: string }[] = [
  { id: "extraction", label: "Extraction", kinds: ["farm", "loggingcamp", "ironmine", "coalmine", "quarry", "oilwell", "sandpit", "coppermine"], blurb: "Extractors stand on a deposit and send what they win to your plants." },
  { id: "processing", label: "Processing", kinds: ["foodplant", "sawmill", "smelter", "cementworks", "refinery", "glassworks", "furniture", "constructionplant", "coppersmelter", "electronics", "machineworks"], blurb: "Plants turn one product into another and sell finished goods to the towns." },
  { id: "logistics", label: "Logistics", kinds: ["warehouse", "fueldepot"], blurb: "Warehouses hold what nobody can take yet; fuel depots fill passing trucks at cost." },
  { id: "power", label: "Power", kinds: ["coalplant"], blurb: "Power plants burn coal and power the buildings that need it on their roads within reach." },
];
