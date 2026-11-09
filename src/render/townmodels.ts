// The models a town's grown buildings are drawn with (tools/blender/town_*.py).
//
// The game stands a grown building on its lot scaled to fit it (`fit`, 0.43 to 1.25) and stretched in height
// (`tall`, 0.7 to 2): one model per kind made a row of houses on a small lot a row of dolls' houses, and a
// stretched one a tower of tall windows. So each kind has several models, every one built for a lot (its
// `design` fit and tall, carried in its GLB): the renderer draws a building with one of those made nearest its own
// fit and tall, and picks among equals by the building's id, so a street is not one model stamped along it.
// All of a kind's models share its footprint; their yards, bays and alleys are their own (read from each GLB).

/** A grown kind's models, the kind's own first. */
export const TOWN_MODELS: Record<string, string[]> = {
  house: ["house", "house_b", "house_c"],
  terrace: ["terrace", "terrace_b", "terrace_c", "terrace_s", "terrace_n", "terrace_t"],
  apartments: ["apartments", "apartments_b", "apartments_m", "apartments_n", "apartments_s"],
  modernflats: ["modernflats", "modernflats_b", "modernflats_m"],
  aptower: ["aptower", "aptower_b", "aptower_m"],
  highstreet: ["highstreet", "highstreet_b", "highstreet_c", "highstreet_d"],
  shop: ["shop", "shop_b", "shop_c", "shop_t", "shop_u"],
  store: ["store", "store_b", "store_m", "store_n"],
  office: ["office", "office_b", "office_c", "office_t", "office_u", "office_s"],
  mall: ["mall", "mall_b", "mall_c"],
  tower: ["tower", "tower_b", "tower_t", "tower_u"],
  glasstower: ["glasstower", "glasstower_b", "glasstower_c", "glasstower_m"],
  fuelstation: ["fuelstation"],
};

/** The models to load besides the kinds' own. */
export const TOWN_VARIANTS: string[] = Object.entries(TOWN_MODELS).flatMap(([kind, ms]) => ms.filter((m) => m !== kind));

/** How far (in log scale, fit and tall together) a model may be from the best match and still be picked. */
const NEAR = 0.07;

/**
 * The model for a building of `kind` standing at `fit` and `tall`: one of the kind's models made nearest those,
 * chosen among the near-equal ones by `id`. `design` gives a model's own fit and tall (undefined: not loaded, or a
 * model made at the footprint's own size).
 */
export function townModel(kind: string, fit: number, tall: number, id: number, design: (model: string) => [number, number] | undefined): string {
  const ms = TOWN_MODELS[kind];
  if (!ms) return kind;
  const cost: [string, number][] = [];
  for (const m of ms) {
    const d = design(m);
    if (d) cost.push([m, Math.abs(Math.log(fit / d[0])) + Math.abs(Math.log(tall / d[1]))]);
  }
  if (!cost.length) return ms[(Math.imul(id + 7, 2246822519) >>> 0) % ms.length];
  const best = Math.min(...cost.map((c) => c[1]));
  const near = cost.filter((c) => c[1] <= best + NEAR);
  return near[(Math.imul(id + 7, 2246822519) >>> 0) % near.length][0];
}
