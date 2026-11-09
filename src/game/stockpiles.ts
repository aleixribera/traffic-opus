import type { Building } from "./buildings";
import { Industry, PLANTS, type PlantKind, type Product } from "./industry";

/**
 * A works' yards drawn as full as its stores (docs/design.md "Stockpiles"): an ore, coal, limestone, sand or copper
 * bay holds two heaps, a log yard five stacks. What a yard holds is the works' store and waiting output of its
 * product, over what one store holds; the piles of every yard of that product at the works fill one after another,
 * so a half-full store shows full heaps and empty bays rather than every heap half height.
 */
export interface YardDef {
  /** what it holds: the first of these the works takes in or turns out */
  holds: Product[];
  /** its piles: heaps of material, or stacks of logs */
  piles: number;
  logs?: boolean;
}

export const YARDS: Record<string, YardDef> = {
  site_logyard: { holds: ["logs", "planks"], piles: 5, logs: true },
  site_heap_ore: { holds: ["ore"], piles: 2 },
  site_heap_coal: { holds: ["coal"], piles: 2 },
  site_heap_lime: { holds: ["lime", "slag"], piles: 2 },
  site_heap_sand: { holds: ["sand"], piles: 2 },
  site_heap_cu: { holds: ["copperore"], piles: 2 },
};

/** A yard of a product the works doesn't handle is dressed as this full (it is scenery there). */
export const SCENERY_FILL = 0.6;
/** A bay is never swept quite clean: the last scrapings stay (share of the yard's piles). */
const SCRAPINGS = 0.05;
/** ...but no more than a low heap, or a single layer of logs, however many yards the works has. */
const SCRAPINGS_MAX = 0.3;

/** The product a yard holds at this works, or null when it handles none of them. */
export function yardProduct(kind: string, yard: string): Product | null {
  const def = YARDS[yard], plant = PLANTS[kind as PlantKind];
  if (!def || !plant) return null;
  return def.holds.find((p) => plant.inputs[p] !== undefined || plant.outputs[p] !== undefined) ?? null;
}

/** How full (0..1) a works' store of a product is: what it holds to work with and what waits for a truck. */
export function storeFill(b: Building, p: Product, store = Industry.storeOf(b)): number {
  if (!b.plant || store <= 0) return 0;
  const n = (b.plant.stock[p] ?? 0) + (b.plant.out[p] ?? 0);
  return Math.min(1, Math.max(0, n / store));
}

/**
 * How full each pile of each of a works' building slots is (0: none, 1: a full heap or stack), by slot, in the
 * order given: null for a slot that is no yard.
 */
export function pileFills(b: Building, slots: string[], store = Industry.storeOf(b)): (number[] | null)[] {
  // the piles of each product, in slot order
  const total = new Map<string, number>();
  for (const s of slots) {
    const def = YARDS[s];
    if (!def) continue;
    const key = yardProduct(b.kind, s) ?? "scenery:" + s;
    total.set(key, (total.get(key) ?? 0) + def.piles);
  }
  const seen = new Map<string, number>();
  return slots.map((s) => {
    const def = YARDS[s];
    if (!def) return null;
    const p = yardProduct(b.kind, s);
    const key = p ?? "scenery:" + s;
    const n = total.get(key)!;
    const f = p ? storeFill(b, p, store) : SCENERY_FILL;
    // (in piles: how many the store fills, or at least the scrapings in its first bay)
    const full = Math.max(Math.min(SCRAPINGS * n, SCRAPINGS_MAX), f * n);
    const first = seen.get(key) ?? 0;
    seen.set(key, first + def.piles);
    return Array.from({ length: def.piles }, (_, i) => Math.min(1, Math.max(0, full - (first + i))));
  });
}
