import type { BuildingKind } from "../config";

export interface LevelDef {
  /** buildings handed to the player when the level starts */
  give: Partial<Record<BuildingKind, number>>;
  satisfaction: number; // required average building satisfaction (0..1)
  flow: number; // required city-wide traffic flow (0..1)
  money: number; // road budget granted at the start of the level
  tiles: number; // map tiles that may be unlocked
  note?: string; // one line shown when the level starts
}

/**
 * Hand-tuned first levels (mirrors the pacing in the footage: a starter street of houses with a
 * shop and an office, then industry chains, then density). After the table runs out the levels
 * keep growing procedurally.
 */
export const LEVELS: LevelDef[] = [
  { give: { house: 14, shop: 1, office: 1 }, satisfaction: 0.95, flow: 0.95, money: 16000, tiles: 0, note: "Connect the homes to a shop and an office." },
  { give: { house: 10, mine: 1, works: 1, shop: 1 }, satisfaction: 0.94, flow: 0.94, money: 8000, tiles: 1, note: "Copper ore goes from the mine to the works by truck. Shops need the goods." },
  { give: { house: 8, terrace: 2, office: 1, shop: 1 }, satisfaction: 0.93, flow: 0.93, money: 8000, tiles: 0 },
  { give: { house: 10, terrace: 2, store: 1, office: 1 }, satisfaction: 0.92, flow: 0.92, money: 9000, tiles: 1 },
  { give: { farm: 1, foodplant: 1, house: 8, apartments: 1, shop: 1 }, satisfaction: 0.91, flow: 0.91, money: 10000, tiles: 0, note: "Farms feed the food plant. Keep farms away from pollution." },
  { give: { apartments: 2, terrace: 3, tower: 1, shop: 1 }, satisfaction: 0.9, flow: 0.9, money: 11000, tiles: 1 },
  { give: { house: 12, apartments: 2, office: 1, mine: 1, store: 1 }, satisfaction: 0.89, flow: 0.89, money: 12000, tiles: 0 },
  { give: { apartments: 3, tower: 1, mall: 1, works: 1 }, satisfaction: 0.88, flow: 0.88, money: 14000, tiles: 1, note: "A mall pulls customers from far away. Plan its entrance." },
  { give: { house: 14, terrace: 4, farm: 1, foodplant: 1, store: 1 }, satisfaction: 0.87, flow: 0.87, money: 15000, tiles: 1 },
  { give: { apartments: 4, tower: 2, mall: 1, shop: 2 }, satisfaction: 0.86, flow: 0.86, money: 16000, tiles: 1 },
];

export function levelDef(n: number): LevelDef {
  if (n <= LEVELS.length) return LEVELS[n - 1];
  const k = n - LEVELS.length;
  return {
    give: { apartments: 3 + (k >> 1), terrace: 3, house: 8, tower: 1 + (k % 2), shop: 1, store: k % 3 === 0 ? 1 : 0, mine: k % 4 === 1 ? 1 : 0, works: k % 4 === 1 ? 1 : 0 },
    satisfaction: 0.85,
    flow: 0.85,
    money: 16000 + k * 1500,
    tiles: k % 2,
  };
}
