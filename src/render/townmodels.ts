// The models a town's grown buildings are drawn with (tools/blender/town_*.py).
//
// The game stands a grown building on its lot scaled to fit it (`fit`, 0.43 to 1.25) and stretched in height
// (`tall`, 0.7 to 2): one model per kind made a row of houses on a small lot a row of dolls' houses, and a
// stretched one a tower of tall windows. So each kind has several models, every one built for a lot (its
// `design` fit and tall, carried in its GLB): the renderer draws a building with one of those made nearest its own
// fit and tall, and picks among equals by the building's id, so a street is not one model stamped along it; and of
// those it takes one that no building of the kind near it has (Variety), so two of a model never stand side by side
// while there is another to take.
// All of a kind's models share its footprint; their yards, bays and alleys are their own (read from each GLB).

/** A grown kind's models, the kind's own first. */
export const TOWN_MODELS: Record<string, string[]> = {
  house: ["house", "house_b", "house_c", "house_d", "house_e"],
  terrace: ["terrace", "terrace_b", "terrace_c", "terrace_s", "terrace_n", "terrace_t"],
  apartments: ["apartments", "apartments_b", "apartments_m", "apartments_n", "apartments_s"],
  modernflats: ["modernflats", "modernflats_b", "modernflats_m"],
  aptower: ["aptower", "aptower_b", "aptower_m"],
  highstreet: ["highstreet", "highstreet_b", "highstreet_c", "highstreet_d"],
  shop: ["shop", "shop_b", "shop_c", "shop_t", "shop_u"],
  store: ["store", "store_b", "store_c", "store_d", "store_e", "store_m", "store_n"],
  office: ["office", "office_b", "office_c", "office_t", "office_u", "office_s"],
  mall: ["mall", "mall_b", "mall_c"],
  tower: ["tower", "tower_b", "tower_t", "tower_u"],
  glasstower: ["glasstower", "glasstower_b", "glasstower_c", "glasstower_m"],
  fuelstation: ["fuelstation"],
};

/**
 * The models of the street wall (tools/blender/town_g_wall.py; docs/design.md "The street wall"): fronts built to the
 * pavement, each exactly as wide as its lot (its `design` fit is its width in zone cells), with no alley and no
 * parking, so neighbours share a wall. `mid`: for anywhere in a row. `left` and `right`: corner buildings, a second
 * front on the side street that passes on that side (seen from the street in front).
 */
export const WALL_MODELS: Record<string, { mid: string[]; left: string[]; right: string[] }> = {
  highstreet: {
    mid: ["highstreet_wa", "highstreet_wb", "highstreet_wc", "highstreet_wd", "highstreet_we", "highstreet_wf", "highstreet_wg"],
    left: ["highstreet_wk", "highstreet_wm"],
    right: ["highstreet_wl", "highstreet_wn"],
  },
  shop: { mid: ["shop_wa", "shop_wb", "shop_wc", "shop_wt", "shop_wu"], left: [], right: [] },
  office: { mid: ["office_wa", "office_wb", "office_wc", "office_wd", "office_we", "office_wt"], left: ["office_wk"], right: ["office_wl"] },
  store: { mid: ["store_wa", "store_wb"], left: [], right: [] },
  tower: { mid: ["tower_wa", "tower_wb", "tower_wc", "tower_wd", "tower_wt"], left: [], right: [] },
  glasstower: { mid: ["glasstower_wa", "glasstower_wb", "glasstower_wt"], left: [], right: [] },
};

/** The models to load besides the kinds' own. */
export const TOWN_VARIANTS: string[] = [
  ...Object.entries(TOWN_MODELS).flatMap(([kind, ms]) => ms.filter((m) => m !== kind)),
  ...Object.values(WALL_MODELS).flatMap((w) => [...w.mid, ...w.left, ...w.right]),
];

/** How far (in log scale, fit and tall together) a model may be from the best match and still be picked. */
const NEAR = 0.07;

/**
 * The models a building of `kind` standing at `fit` and `tall` may be drawn with: those of the kind's models made
 * nearest that, the one its `id` picks first and the rest in turn after it. `design` gives a model's own fit and tall
 * (undefined: not loaded, or a model made at the footprint's own size).
 */
export function townChoices(kind: string, fit: number, tall: number, id: number, design: (model: string) => [number, number] | undefined): string[] {
  const ms = TOWN_MODELS[kind];
  if (!ms) return [kind];
  const cost: [string, number][] = [];
  for (const m of ms) {
    const d = design(m);
    if (d) cost.push([m, Math.abs(Math.log(fit / d[0])) + Math.abs(Math.log(tall / d[1]))]);
  }
  const h = Math.imul(id + 7, 2246822519) >>> 0;
  if (!cost.length) return [ms[h % ms.length]];
  const best = Math.min(...cost.map((c) => c[1]));
  const near = cost.filter((c) => c[1] <= best + NEAR).map((c) => c[0]);
  const k = h % near.length;
  return [...near.slice(k), ...near.slice(0, k)];
}

/** A wall model fits a lot of its own width only (fit, in log scale). */
const WALL_FIT = 0.03;

/**
 * The models a front of the street wall may be drawn with: those of its kind made for a lot exactly as wide as its
 * own, the nearest its height; a corner building's (`corner`: -1 a side street on its left, 1 on its right, 0 none)
 * where there is one that wide. Empty: none is loaded for that width (it is then drawn as a detached building).
 */
export function wallChoices(kind: string, fit: number, tall: number, id: number, corner: -1 | 0 | 1, design: (model: string) => [number, number] | undefined): string[] {
  const W = WALL_MODELS[kind];
  if (!W) return [];
  const near = (ms: string[], limit = Infinity): string[] => {
    const cost: [string, number][] = [];
    for (const m of ms) {
      const d = design(m);
      if (d && Math.abs(Math.log(fit / d[0])) <= WALL_FIT) cost.push([m, Math.abs(Math.log(tall / d[1]))]);
    }
    if (!cost.length) return [];
    const best = Math.min(...cost.map((c) => c[1]));
    return best > limit ? [] : cost.filter((c) => c[1] <= best + NEAR).map((c) => c[0]);
  };
  // (a corner building only where one stands about as tall as the lot wants)
  const side = corner < 0 ? near(W.left, 0.12) : corner > 0 ? near(W.right, 0.12) : [];
  const ms = side.length ? side : near(W.mid);
  if (!ms.length) return [];
  const k = (Math.imul(id + 7, 2246822519) >>> 0) % ms.length;
  return [...ms.slice(k), ...ms.slice(0, k)];
}

/** The model for a building, by its lot, height and id alone (the first of its choices). */
export function townModel(kind: string, fit: number, tall: number, id: number, design: (model: string) => [number, number] | undefined): string {
  return townChoices(kind, fit, tall, id, design)[0];
}

interface Spot { id: number; x: number; y: number; kind: string; model: string }
const CELL = 64;
const cellOf = (x: number, y: number) => (Math.floor(x / CELL) + 32768) * 65536 + (Math.floor(y / CELL) + 32768);

/**
 * Which model each building standing was given, so the next of its kind near it takes another: a street of one kind
 * is not the same house twice running, nor a square the same store on two corners. A building keeps what it was
 * given for as long as it stands.
 */
export class Variety {
  private cells = new Map<number, Spot[]>();
  private spots = new Map<number, Spot>();

  /**
   * The model for building `id` of `kind` at (x, y), from `choices` (the first is its own pick): the first that no
   * building of the kind within `reach` m has; if they are all taken, the one whose nearest twin is farthest off.
   */
  pick(id: number, kind: string, x: number, y: number, reach: number, choices: string[]): string {
    this.drop(id);
    let model = choices[0];
    if (choices.length > 1) {
      const nearest = new Map<string, number>();
      const c0 = Math.floor((x - reach) / CELL), c1 = Math.floor((x + reach) / CELL);
      const r0 = Math.floor((y - reach) / CELL), r1 = Math.floor((y + reach) / CELL);
      for (let cx = c0; cx <= c1; cx++) {
        for (let cy = r0; cy <= r1; cy++) {
          for (const s of this.cells.get((cx + 32768) * 65536 + (cy + 32768)) ?? []) {
            if (s.kind !== kind) continue;
            const d = Math.hypot(s.x - x, s.y - y);
            if (d <= reach && d < (nearest.get(s.model) ?? Infinity)) nearest.set(s.model, d);
          }
        }
      }
      let far = -1;
      for (const m of choices) {
        const d = nearest.get(m) ?? Infinity;
        if (d > far) { far = d; model = m; }
        if (d === Infinity) break;
      }
    }
    const spot = { id, x, y, kind, model }, key = cellOf(x, y);
    this.spots.set(id, spot);
    const list = this.cells.get(key);
    if (list) list.push(spot); else this.cells.set(key, [spot]);
    return model;
  }

  /** Building `id` is gone (or is to be given a model again). */
  drop(id: number) {
    const s = this.spots.get(id);
    if (!s) return;
    this.spots.delete(id);
    const key = cellOf(s.x, s.y), list = this.cells.get(key)!;
    list.splice(list.indexOf(s), 1);
    if (!list.length) this.cells.delete(key);
  }
}
