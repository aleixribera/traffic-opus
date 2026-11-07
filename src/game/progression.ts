// Milestones. Each one unlocks road types, features and land, and pays a grant. The company's tier-1 extractors and
// plants, founding towns and the basic roads are open from the start (see placed.ts for each building's unlock).
// TODO(milestones): still reached by total population; the design's achievement ladder replaces this list.

import type { RoadTypeId } from "../config";

export interface Milestone {
  pop: number;
  name: string;
  roads: RoadTypeId[];
  features: ("roundabout" | "signals" | "grid" | "parallel" | "transit")[];
  tiles: number; // tile slots granted (total ownable tiles grows by this)
  grant: number;
}

export const MILESTONES: Milestone[] = [
  { pop: 0, name: "Crossroads", roads: ["street", "one1", "hw1", "hw2"], features: ["grid", "parallel"], tiles: 9, grant: 0 },
  { pop: 120, name: "Hamlet", roads: ["avenue", "one2", "streetM"], features: ["roundabout", "signals"], tiles: 2, grant: 8000 },
  { pop: 400, name: "Village", roads: ["one3", "avenueM"], features: ["transit"], tiles: 2, grant: 15000 },
  { pop: 1000, name: "Small town", roads: ["boulevard", "boulevardM"], features: [], tiles: 3, grant: 30000 },
  { pop: 2500, name: "Town", roads: ["one4"], features: [], tiles: 3, grant: 60000 },
  { pop: 5000, name: "Large town", roads: [], features: [], tiles: 4, grant: 100000 },
  { pop: 10000, name: "City", roads: [], features: [], tiles: 5, grant: 180000 },
  { pop: 20000, name: "Large city", roads: [], features: [], tiles: 6, grant: 300000 },
  { pop: 40000, name: "Metropolis", roads: [], features: [], tiles: 8, grant: 500000 },
  { pop: 80000, name: "Megalopolis", roads: [], features: [], tiles: 10, grant: 800000 },
];

export function milestoneFor(pop: number): number {
  let m = 0;
  for (let i = 0; i < MILESTONES.length; i++) if (pop >= MILESTONES[i].pop) m = i;
  return m;
}

export function unlockedRoads(m: number): Set<RoadTypeId> {
  return new Set(MILESTONES.slice(0, m + 1).flatMap((x) => x.roads));
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
