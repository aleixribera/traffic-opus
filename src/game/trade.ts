// Trade with the region's gateway cities (CS2's outside connections, given a character each). Every gateway the
// road network reaches is a trade partner: factories sell their goods there and buy their materials there, and
// what kind of city it is decides its prices and what it brings (migrants, office firms, cheap ore...).
// The start's motorway links two of them; the rest are kilometres away and are opened by building a road into them.

import type { GatewayKind } from "../world/gen";
import type { ZoneGroup } from "./zones";

export interface TradeTerms {
  /** what it pays for a load of goods, times the usual price */
  goods: number;
  /** what its materials cost the factories, times the usual price (lower is better) */
  materials: number;
  /** demand it adds while linked */
  demand: Partial<Record<ZoneGroup, number>>;
  /** what it brings, for the Trade window */
  blurb: string;
}

export const TRADE: Record<GatewayKind, TradeTerms> = {
  port: { goods: 1.25, materials: 0.85, demand: { com: 6, ind: 6 }, blurb: "Ships take goods overseas and bring materials in." },
  capital: { goods: 1.35, materials: 1.15, demand: { res: 10, com: 6 }, blurb: "The richest market, and people looking to move out of the big city." },
  industry: { goods: 0.95, materials: 0.75, demand: { ind: 10 }, blurb: "Cheap materials, and firms looking for a new site." },
  farm: { goods: 1.1, materials: 0.8, demand: { ind: 6 }, blurb: "Crops and timber for your factories." },
  mining: { goods: 1.05, materials: 0.65, demand: { ind: 8 }, blurb: "Ore and stone at the lowest prices." },
  tech: { goods: 1.2, materials: 1.05, demand: { off: 14 }, blurb: "Pays well for goods, and its firms want offices nearby." },
};

/** What a load of exported goods earns at the usual price (before tax). */
export const EXPORT_PRICE = 40;
/** How much of the materials saving the city sees in industry taxes. */
export const MATERIALS_PASS = 0.6;
/** Most demand a zone group can get from trade links. */
export const TRADE_DEMAND_CAP = 20;

/** Pick a partner, favouring better terms: weight^4 shares, so a clearly better one takes most of the trade. */
export function pickPartner<T>(items: T[], score: (t: T) => number, r: number): T | null {
  if (!items.length) return null;
  let total = 0;
  const w = items.map((t) => { const x = Math.pow(Math.max(0.01, score(t)), 4); total += x; return x; });
  let a = r * total;
  for (let i = 0; i < items.length; i++) { a -= w[i]; if (a <= 0) return items[i]; }
  return items[items.length - 1];
}

/** One gateway's trade over an hour. */
export interface TradeTally { exports: number; imports: number; earned: number }
