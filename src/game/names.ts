// Names for the "Industry Booming America" look: original, plausible American place names for towns, and period
// company names (1920s-40s haulage and industry). Curated part lists, never whole real names of famous cities.

import { mulberry32 } from "../core/noise";

/** Longest town name we make: it has to fit a map label. */
export const TOWN_NAME_MAX = 16;

const SURNAMES = [
  "Carver", "Halston", "Whitaker", "Bramwell", "Pruitt", "Calloway", "Danner", "Ellery", "Fenton", "Garrity",
  "Hadley", "Iverson", "Jessup", "Kimball", "Lathrop", "Mercer", "Norwood", "Oakley", "Prescott", "Quimby",
  "Rowland", "Sutter", "Tolliver", "Vance", "Waverly", "Yates", "Ashby", "Barlow", "Colter", "Dorsey",
  "Emmett", "Granger", "Holloway", "Kessler", "Merritt", "Pickett", "Sheldon", "Talbot", "Whitcomb", "Bixby",
  "Coburn", "Delaney", "Farrow", "Hensley", "McCall", "Stanton", "Ridley", "Marlow", "Corbin", "Tate",
  "Hollis", "Gaines", "Pryor", "Bowman", "Langley", "Thayer", "Crandall", "Dunmore", "Ballard", "Keene",
];

/** Short first syllables for joined names (Ashburg, Claybrook, Mercerville). */
const STEMS = [
  "Ash", "Bell", "Clay", "Elm", "Glen", "Hart", "Mill", "Oak", "Pine", "Stan", "Sum", "Ware", "Win", "Cran",
  "Dun", "Hollis", "Carver", "Mercer", "Wil", "Kirk", "Brad", "Crest", "Lyn", "Bel", "Thorn", "Maple",
  "Hamp", "Shel", "Fen", "Lock", "Stock", "Wex", "Mel", "Har", "Tal", "Rock", "Spring", "Haw", "Ever",
];
const JOINED = ["ville", "burg", "ton", "field", "wood", "dale", "boro", "brook", "mont", "ford"];

const FEATURES = [
  "Falls", "Junction", "Springs", "City", "Crossing", "Ridge", "Bluff", "Hollow", "Mills", "Forks", "Landing",
  "Gap", "Station", "Flats", "Grove", "Point", "Bend", "Corners",
];
const TREES = ["Cedar", "Willow", "Hickory", "Walnut", "Sycamore", "Cypress", "Aspen", "Juniper", "Birch", "Pecan", "Poplar", "Magnolia", "Alder", "Chestnut", "Cottonwood"];
const TREE_WATER = ["Creek", "Hollow", "Grove", "Springs", "Bend", "Ridge", "Run", "Flats"];
const ADJ = ["Red", "Black", "Copper", "Iron", "Clear", "Cold", "Long", "Stony", "Sandy", "Lone", "Twin", "Pleasant", "Sweet", "Muddy", "High", "Bitter", "Silver", "Antler"];
const LANDFORMS = ["Rock", "Bluff", "Creek", "Lake", "Prairie", "Butte", "Mesa", "Fork", "Run", "Hill", "Valley", "Wells", "Gulch", "Pass", "Point"];

/** Real cities too famous to borrow whole (the parts above can't make most of them; this catches the rest). */
const FAMOUS = new Set([
  "Springfield", "Bellville", "Kirkwood", "Burbank", "Hampton", "Stanford", "Shelton", "Glendale", "Oakwood", "Elmwood",
  "Oakdale", "Pinewood", "Bradford", "Ashford", "Milford", "Winston", "Brookfield", "Fort Worth", "Port Arthur",
  "Red Rock", "Silver City", "Iron Mountain", "Rock Springs", "Cedar Rapids", "Cold Spring", "Long Valley", "Lake City",
  "Little Rock", "Black Hills", "Twin Falls", "Sandy Hook", "Stony Point", "Clear Lake", "Copper Mountain",
  "Willow Creek", "Bitter Creek", "Cedar City", "New Holland", "Fort Myers", "Fort Smith", "Fort Dodge",
  "Belmont", "Fairmont", "Rockford", "Rockville", "Rockton", "Harrisburg", "Allentown", "Morton", "Tallahassee", "Grandview",
]);

const pick = <T>(r: () => number, l: readonly T[]): T => l[Math.floor(r() * l.length)];

/** One American place name from a random source (any length; see townName for the map-label limit). */
function placeName(r: () => number): string {
  const k = r();
  if (k < 0.24) return `${pick(r, SURNAMES)} ${pick(r, FEATURES)}`;
  if (k < 0.44) return pick(r, STEMS) + pick(r, JOINED);
  if (k < 0.58) return `${pick(r, TREES)} ${pick(r, TREE_WATER)}`;
  if (k < 0.72) return `${pick(r, ADJ)} ${pick(r, LANDFORMS)}`;
  if (k < 0.8) return `New ${pick(r, SURNAMES)}`;
  if (k < 0.88) return `Fort ${pick(r, SURNAMES)}`;
  if (k < 0.94) return `Port ${pick(r, SURNAMES)}`;
  return `${pick(r, SURNAMES)}${pick(r, ["ville", "burg", "ton"])}`.replace(/(.)\1(ville|burg|ton)$/, "$1$2");
}

/**
 * A town's name: plausible, original, short enough for a label. Takes exactly two draws from `rnd` (as the old
 * name maker did, so the rest of a seeded game runs the same) and works from its own generator after that.
 * `taken` names are avoided.
 */
export function townName(rnd: () => number, taken: ReadonlySet<string> = new Set()): string {
  const r = mulberry32(Math.floor(rnd() * 0x7fffffff) ^ Math.floor(rnd() * 0x3fffffff) * 7);
  for (let k = 0; k < 400; k++) {
    const n = placeName(r);
    if (n.length <= TOWN_NAME_MAX && !FAMOUS.has(n) && !taken.has(n)) return n;
  }
  // (only reachable with thousands of towns: a numbered one, still unique)
  for (let i = 2; ; i++) {
    const n = `${pick(r, STEMS)}${pick(r, JOINED)} ${i}`;
    if (!taken.has(n)) return n;
  }
}

// ---------------------------------------------------------------------------------------------
// companies
// ---------------------------------------------------------------------------------------------

const REGIONS = [
  "Great Western", "Northern Star", "Prairie State", "Golden Valley", "Keystone", "Midland", "Continental",
  "Pioneer", "Frontier", "Liberty", "Empire", "Sterling", "Summit", "Atlantic & Plains", "Tri-State", "Interstate",
  "Overland", "Iron Range", "Great Plains", "Red River", "Blue Ridge", "Cumberland", "Big Sky", "Twin Rivers",
];
const TRADES = ["Freight Co.", "Haulage Co.", "Motor Freight", "Transport Co.", "Hauling Co.", "Truck Lines", "Express Co.", "Cartage Co."];
const HEAVY = ["Iron & Rail", "Steel & Freight", "Coal & Coke", "Iron Works", "Mining & Haulage", "Lumber & Coal", "Oil & Freight"];

/** A period company name, like "Carver & Sons Haulage" or "Great Western Freight Co.". */
export function companyName(r: () => number): string {
  for (let k = 0; k < 50; k++) {
    const s = pick(r, SURNAMES), k2 = r();
    let n: string;
    if (k2 < 0.2) n = `${s} & Sons ${pick(r, ["Haulage", "Freight", "Trucking", "Cartage"])}`;
    else if (k2 < 0.42) n = `${pick(r, REGIONS)} ${pick(r, TRADES)}`;
    else if (k2 < 0.58) n = `${s} ${pick(r, HEAVY)}`;
    else if (k2 < 0.72) n = `${s} Brothers ${pick(r, ["Transfer", "Freight", "Haulage", "Motor Co."])}`;
    else if (k2 < 0.86) { const t = pick(r, SURNAMES); n = t === s ? `${s} Motor Freight` : `${s} & ${t} ${pick(r, ["Haulage", "Freight", "Co."])}`; }
    else n = `${s}-${pick(r, ["Western", "National", "Union", "American", "Pacific"])} ${pick(r, ["Lines", "Freight", "Transport"])}`;
    if (n.length <= 30) return n;
  }
  return "Great Western Freight Co.";
}
