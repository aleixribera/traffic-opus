import type { BuildingKind } from "../config";
import type { Building } from "./buildings";
import { HOUR } from "./society";
import { PLANTS, isPlantKind, type Product } from "./industry";

/**
 * How a building goes up (docs/design.md "Construction"). A plot is cleared and staked out while its materials come
 * in, then a crew pours the slab, raises the frame (timber for homes and shops, a riveted steel skeleton for blocks,
 * towers and works), closes the walls behind a scaffold and puts the roof on. Each step is a share of the building's
 * own build time, which grows with its size: a house goes up in an afternoon, a tower over two days.
 */
export type Stage = "staked" | "slab" | "frame" | "walls" | "roof" | "done";

export const STAGES: readonly Stage[] = ["staked", "slab", "frame", "walls", "roof", "done"];

/** Where each step starts, as a share of the building's build progress (0..1). */
export const STAGE_AT: Record<Exclude<Stage, "done">, number> = { staked: 0, slab: 0.08, frame: 0.25, walls: 0.5, roof: 0.78 };

export interface StageInfo {
  stage: Stage;
  /** how far through this step (0..1) */
  k: number;
  /** share of the materials trucked in so far (1 when the site waits for none) */
  got: number;
}

/** The game hours a building of this kind takes to go up once its materials are in. */
const HOURS: Partial<Record<BuildingKind, number>> = {
  house: 3, terrace: 4, highstreet: 3.5, shop: 3.5, fuelstation: 4,
  apartments: 6, store: 6, office: 6,
  modernflats: 9, mall: 9, tower: 9,
  aptower: 12, glasstower: 12,
  hamlethall: 4, villagehall: 6, townhall: 9, cityhall: 12,
  warehouse: 5, fueldepot: 4,
};

/** A company works: its tier's crew time (a first farm in an hour of play's first minutes, a motor works over a day). */
const PLANT_HOURS = [0, 3, 6, 8, 10, 12];

export function buildTime(kind: BuildingKind): number {
  if (isPlantKind(kind)) return HOUR * (PLANT_HOURS[PLANTS[kind].tier] ?? 8);
  return HOUR * (HOURS[kind] ?? 4);
}

/** Share of a site's material loads that have come in (1 when it waits for none). */
export function deliveredShare(site: { need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>> } | undefined): number {
  if (!site) return 1;
  let need = 0, got = 0;
  for (const [p, n] of Object.entries(site.need) as [Product, number][]) {
    if (!(n > 0)) continue;
    need += n;
    got += Math.min(n, site.got[p] ?? 0);
  }
  return need > 0 ? got / need : 1;
}

/** The step a build is at, from its progress (0..1); `got` is the share of its materials in so far. */
export function stageAt(progress: number, got = 1): StageInfo {
  if (got < 1) return { stage: "staked", k: got, got };
  if (progress >= 1) return { stage: "done", k: 1, got };
  const p = Math.max(0, progress);
  for (let i = STAGES.length - 2; i >= 0; i--) {
    const s = STAGES[i] as Exclude<Stage, "done">;
    const a = STAGE_AT[s];
    if (p >= a) {
      const next = i + 1 < STAGES.length - 1 ? STAGE_AT[STAGES[i + 1] as Exclude<Stage, "done">] : 1;
      return { stage: s, k: (p - a) / (next - a), got };
    }
  }
  return { stage: "staked", k: 0, got };
}

/** The step a building is at: waiting for its materials (a town block, or a works), or going up. */
export function stageOf(b: Building): StageInfo {
  const wait = b.site ?? b.plant?.site;
  if (wait) return stageAt(0, Math.min(0.999, deliveredShare(wait)));
  return stageAt(b.built);
}

/** Per-tick progress for a building going up over `span` seconds (its own build time). */
export function buildStep(b: Building, span: number): number {
  return span / buildTime(b.kind);
}
