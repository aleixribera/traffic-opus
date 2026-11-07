// Milestones by population, the CS2 way: each one unlocks road types, zones and land, and pays a grant.

import type { RoadTypeId } from "../config";
import type { ZoneId } from "./zones";

export interface Milestone {
  pop: number;
  name: string;
  roads: RoadTypeId[];
  zones: ZoneId[];
  features: ("roundabout" | "signals" | "grid" | "parallel")[];
  tiles: number; // tile slots granted (total ownable tiles grows by this)
  grant: number;
}

export const MILESTONES: Milestone[] = [
  { pop: 0, name: "Crossroads", roads: ["street", "one1", "hw1", "hw2"], zones: ["resLow", "resRow", "comLow", "ind"], features: ["grid", "parallel"], tiles: 9, grant: 0 },
  { pop: 120, name: "Hamlet", roads: ["avenue", "one2", "streetM"], zones: [], features: ["roundabout", "signals"], tiles: 2, grant: 8000 },
  { pop: 400, name: "Village", roads: ["one3", "avenueM"], zones: ["resMed", "offLow"], features: [], tiles: 2, grant: 15000 },
  { pop: 1000, name: "Small town", roads: ["boulevard", "boulevardM"], zones: ["comHigh"], features: [], tiles: 3, grant: 30000 },
  { pop: 2500, name: "Town", roads: ["one4"], zones: ["resHigh", "offHigh"], features: [], tiles: 3, grant: 60000 },
  { pop: 5000, name: "Large town", roads: [], zones: [], features: [], tiles: 4, grant: 100000 },
  { pop: 10000, name: "City", roads: [], zones: [], features: [], tiles: 5, grant: 180000 },
  { pop: 20000, name: "Large city", roads: [], zones: [], features: [], tiles: 6, grant: 300000 },
  { pop: 40000, name: "Metropolis", roads: [], zones: [], features: [], tiles: 8, grant: 500000 },
  { pop: 80000, name: "Megalopolis", roads: [], zones: [], features: [], tiles: 10, grant: 800000 },
];

export function milestoneFor(pop: number): number {
  let m = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (pop >= MILESTONES[i].pop) m = i;
  return m;
}

export function unlockedRoads(m: number): Set<RoadTypeId> {
  return new Set(MILESTONES.slice(0, m + 1).flatMap((x) => x.roads));
}

export function unlockedZones(m: number): Set<ZoneId> {
  return new Set(MILESTONES.slice(0, m + 1).flatMap((x) => x.zones));
}

export function unlockedFeature(m: number, f: Milestone["features"][number]): boolean {
  return MILESTONES.slice(0, m + 1).some((x) => x.features.includes(f));
}

export function tileSlots(m: number): number {
  return MILESTONES.slice(0, m + 1).reduce((a, x) => a + x.tiles, 0);
}

/** Price of the next tile when `owned` are already owned. */
export function tilePrice(owned: number): number {
  return Math.round((6000 + Math.max(0, owned - 9) * 2500) / 500) * 500;
}
