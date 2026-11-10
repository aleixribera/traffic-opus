// The company's industry: extractors on deposits, plants that turn one product into another, and each building's
// own trucks, which carry every load over the player's roads (see docs/design.md, "Chains" and "Freight").
// Nothing here draws a route: a loaded truck goes to the customer worth most to the company, own plants short of
// an input first, then the shops of towns that still need the product today (see towns.ts), nearest and neediest
// first. The company is paid only for loads delivered to a town.

import type { V2 } from "../core/math";
import type { Building, Buildings } from "./buildings";
import { BUILDING_TYPES, ROAD_TYPES, type BuildingKind } from "../config";
import type { PendingSpawn, Trip, Vehicle } from "../sim/traffic";
import { F } from "../world/gen";
import { GROW_DECAY, SITE_LEVELS, growNeed, levelMult } from "./sites";
import { TRUCK_CLASS_ORDER, classOf, fleetMix, type FleetMix, type TruckClass } from "./trucks";
import type { BigKind, BigState } from "./convoys";
import { MEGA_PLANTS, megaValue, type LandmarkState, type MegaKind } from "./megaprojects";

export type Product =
  | "crops" | "logs" | "food" | "planks" | "ore" | "coal" | "lime" | "steel" | "cement"
  | "crude" | "sand" | "fuel" | "plastics" | "glass" | "goods" | "parts"
  | "copperore" | "copper" | "electronics" | "machinery"
  // deeper chains (docs/design.md "Supplies", "Perishables", "Alternate inputs"): supplies that feed back up the
  // chain, the Motor Works' rubber and cars, fresh milk and cheese, and two by-products another plant takes
  | "fertilizer" | "explosives" | "rubber" | "cars" | "milk" | "cheese" | "slag" | "chips";

export interface ProductDef {
  name: string;
  /** what a town pays for one truckload (0: only plants use it) */
  price: number;
  /** cargo tint on the trucks */
  color: number;
}

export const PRODUCTS: Record<Product, ProductDef> = {
  crops: { name: "Crops", price: 0, color: 0xd9b44a },
  logs: { name: "Logs", price: 0, color: 0x8a5a33 },
  food: { name: "Food", price: 700, color: 0xe2704a },
  planks: { name: "Planks", price: 650, color: 0xe8cf8f },
  ore: { name: "Iron ore", price: 0, color: 0x93603f },
  coal: { name: "Coal", price: 0, color: 0x3a3a3e },
  lime: { name: "Limestone", price: 0, color: 0xd9d3bd },
  // (steel goes to the construction plants: no town buys it)
  steel: { name: "Steel", price: 0, color: 0x8a96a3 },
  cement: { name: "Cement", price: 1000, color: 0xb9b6ae },
  // tier 3: fuel and household goods for towns of Town size, construction parts for the blocks they put up
  crude: { name: "Crude oil", price: 0, color: 0x2e2a26 },
  sand: { name: "Sand", price: 0, color: 0xe0c78e },
  fuel: { name: "Fuel", price: 1500, color: 0xd99a2b },
  // (plastics wait for the electronics plants of tier 4: until then the refinery flares what it can't store)
  plastics: { name: "Plastics", price: 0, color: 0x6fb7c9 },
  glass: { name: "Glass", price: 0, color: 0x9fd3d6 },
  goods: { name: "Household goods", price: 1600, color: 0xb0603e },
  parts: { name: "Construction parts", price: 1800, color: 0x7f8b6a },
  // tier 4: electronics and machinery for a City (electronics to its shops, machinery to its offices and towers)
  copperore: { name: "Copper ore", price: 0, color: 0x4f8a78 },
  copper: { name: "Copper", price: 0, color: 0xc4703a },
  electronics: { name: "Electronics", price: 2400, color: 0x3f5f8f },
  machinery: { name: "Machinery", price: 2600, color: 0xd8a22e },
  // supplies: the chemical works' fertilizer for the farms and explosives for the mines and wells (no town buys them)
  fertilizer: { name: "Fertilizer", price: 0, color: 0xb9c98a },
  explosives: { name: "Explosives", price: 0, color: 0xb8402e },
  // tier 5: rubber for the Motor Works, and its cars for the towns (each one more car on the roads)
  rubber: { name: "Rubber", price: 0, color: 0x34322f },
  cars: { name: "Cars", price: 4000, color: 0x7a2e2a },
  // perishables, in refrigerated trucks: worth less the longer they take to arrive (see freshness)
  milk: { name: "Milk", price: 900, color: 0xf2efe6 },
  cheese: { name: "Cheese", price: 1400, color: 0xe6bf55 },
  // by-products another plant takes instead of one of its inputs (PlantDef.alt)
  slag: { name: "Slag", price: 0, color: 0x5e5a54 },
  chips: { name: "Wood chips", price: 0, color: 0xc9a46a },
};

/**
 * Perishables (docs/design.md "Perishables"): how long a load keeps (sim s, from the truck setting off). It arrives
 * at full value within its shelf time, then loses value linearly down to SPOIL_FLOOR at twice that: milk keeps for a
 * good 5-6 km of street (a highway takes it further), cheese for about three times as far. A jam spoils it.
 */
export const SHELF: Partial<Record<Product, number>> = { milk: 540, cheese: 1500 };
/** The share of a perishable load's value left however late it arrives. */
export const SPOIL_FLOOR = 0.2;
/** A load handed over at `to`: what it paid, and for a perishable how fresh it arrived (0..1) and the value lost. */
export interface Delivery { to: Building; from?: Building; product: Product; n: number; pay: number; fresh: number; lost: number }

/** Share of its value a load keeps after `age` sim seconds on the road (1 for anything that doesn't perish). */
export function freshness(p: Product, age: number): number {
  const s = SHELF[p];
  if (!s || age <= s) return 1;
  return Math.max(SPOIL_FLOOR, 1 - ((1 - SPOIL_FLOOR) * (age - s)) / s);
}
/** Is it carried chilled (in a refrigerated truck)? */
export const perishable = (p: Product) => SHELF[p] !== undefined;

export type PlantKind =
  | "farm" | "loggingcamp" | "foodplant" | "sawmill"
  | "ironmine" | "coalmine" | "quarry" | "smelter" | "cementworks" | "coalplant"
  | "oilwell" | "sandpit" | "refinery" | "glassworks" | "furniture" | "constructionplant"
  | "coppermine" | "coppersmelter" | "electronics" | "machineworks"
  // deeper chains: the chemical works (supplies), the dairy and creamery (perishables), and the Motor Works (tier 5)
  | "chemworks" | "dairyfarm" | "creamery" | "rubberplant" | "motorworks"
  // logistics: buildings that store and pass on what the plants make (see "Logistics" below)
  | "warehouse" | "fueldepot"
  // landmarks: one-off megaprojects (megaprojects.ts)
  | MegaKind;

export interface PlantDef {
  kind: PlantKind;
  tier: number;
  /** extractors: the deposit (world field) the footprint must cover */
  deposit?: { field: number; name: string };
  inputs: Partial<Record<Product, number>>;
  outputs: Partial<Record<Product, number>>;
  /** sim seconds per batch, fully staffed (on a full deposit) */
  cycle: number;
  cost: number;
  /** per hour */
  upkeep: number;
  /** fewest trucks it runs (0: none, a power plant); the fleet itself is sized from its output (Industry.fleetAt) */
  trucks: number;
  /** loads each store holds (each input and each output) */
  store: number;
  /** power it draws at full work (MW); without it, it works at UNPOWERED of its pace (tier 2 on) */
  power?: number;
  /** a power plant: what it makes at full staff (MW) while it has coal to burn, and how far it reaches (m) */
  makes?: number;
  reach?: number;
  /** what its construction site waits for, trucked in (tier 2 on); tier 1 costs money only */
  site?: Partial<Record<Product, number>>;
  /** a logistics building: a warehouse (stores any product and re-ships it) or a fuel depot (fills passing trucks) */
  logistics?: "warehouse" | "depot";
  /** a landmark (megaprojects.ts): a one-off project whose site also waits for oversized pieces by convoy */
  mega?: boolean;
  pieces?: { kind: BigKind; n: number };
  /** inputs another product can stand in for: the plant uses the alternate first when it has it (slag for limestone) */
  alt?: Partial<Record<Product, Product>>;
  /** an output made on the side: it never keeps the plant working, and is flared when nothing takes it */
  byproduct?: Product;
  /** supplies it draws, each from a site level on (machinery at level 4 comes on top for every site: see suppliesAt) */
  supplies?: Partial<Record<Product, number>>;
  blurb: string;
}

const HOUR = 40;
const DAY_S = 24 * HOUR;
/** The longest a docked truck waits for a fuller load before it goes with what there is (sim s: a game hour). */
export const HOLD = HOUR;
/**
 * The send-ahead line (owner, 2026-11-09: "the factories receive the alert before the player sees the need and supply
 * automatically"). A town's load goes first, and without waiting for a full truck, once what has landed there would
 * read below "Enough" sooner than a truck sent now could land, with a spare: an invisible line above "Enough" set by
 * what the town gets through over the trip and the loading, so a town 10 km out is seen to earlier than one next door.
 * The spare: a share of the trip (traffic varies) and a couple of hours (loading, pulling out of the yard).
 */
export const SEND_SPARE = 0.25, SEND_PAD = 2 * HOUR;
/** What a town about to dip is worth over another customer of the same product (about 100 km of extra driving). */
const SEND_FIRST = 800;
/** A load on its way still counts for the send-ahead line (never for what the town shows) until this share of its
 *  trip past when it was due: a truck stuck in a jam well past that is no longer counted on. */
const DUE_GRACE = 0.5;
/**
 * Trucks a works keeps waiting at its own gate to pull out, at most (its own and the empty ones heading home from
 * it): the rest stay at the dock with their loads still in the yard, counted as at home. Before, every free truck
 * with a load joined the queue at a gate that could not let them out, was counted as out on the road, and after a
 * minute and a half gave up and put its load back, to be sent again (docs/playtest-2026-11-09.md, A1 and A17).
 */
export const GATE_QUEUE = 2;
/**
 * A customer is choked when this many trucks on their way to it stand in traffic (30 s and more), and they are at
 * least half of those on their way there: no more are sent into the same queue until they move. A town's shops count
 * together (their trucks share its roads).
 */
export const CHOKED = 2;
/**
 * The share of a works' output that goes to works' building sites while a town on its roads is short of the product
 * (below "Enough", or about to be before a truck could land): one load in four. A town's needs come first, and its
 * growth is the company's income; but a site is never left waiting for a town that is always short, so it gets this
 * share whatever happens. With no town short of it, the sites take all of it.
 */
export const SITE_SHARE = 0.25;
/** Game hours of deliveries a building site remembers (what its "about N hours at this rate" is worked out on). */
export const SITE_HOURS = 12;

export const PLANTS: Record<PlantKind, PlantDef> = {
  farm: {
    kind: "farm", tier: 1, deposit: { field: F.fert, name: "fertile soil" }, inputs: {}, outputs: { crops: 1 },
    cycle: HOUR * 1.5, cost: 8000, upkeep: 12, trucks: 2, store: 8, supplies: { fertilizer: 3 },
    blurb: "Grows crops on fertile soil for your food plants.",
  },
  loggingcamp: {
    kind: "loggingcamp", tier: 1, deposit: { field: F.forest, name: "forest" }, inputs: {}, outputs: { logs: 1 },
    cycle: HOUR * 1.5, cost: 7000, upkeep: 10, trucks: 2, store: 8,
    blurb: "Fells forest timber into logs for your sawmills.",
  },
  foodplant: {
    kind: "foodplant", tier: 1, inputs: { crops: 1 }, outputs: { food: 1 },
    cycle: HOUR, cost: 15000, upkeep: 25, trucks: 2, store: 8,
    blurb: "Turns crops into food for the towns' shops.",
  },
  sawmill: {
    kind: "sawmill", tier: 1, inputs: { logs: 1 }, outputs: { planks: 1, chips: 1 }, byproduct: "chips",
    cycle: HOUR, cost: 14000, upkeep: 22, trucks: 2, store: 8,
    blurb: "Saws logs into planks, with wood chips left over for power plants.",
  },
  ironmine: {
    kind: "ironmine", tier: 2, deposit: { field: F.ore, name: "iron ore" }, inputs: {}, outputs: { ore: 1 },
    cycle: HOUR * 1.5, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 12 }, supplies: { explosives: 3 },
    blurb: "Digs iron ore for your smelters.",
  },
  coalmine: {
    kind: "coalmine", tier: 2, deposit: { field: F.coal, name: "coal" }, inputs: {}, outputs: { coal: 1 },
    cycle: HOUR * 1.2, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 12 }, supplies: { explosives: 3 },
    blurb: "Digs coal for smelters, cement works and power plants.",
  },
  quarry: {
    kind: "quarry", tier: 2, deposit: { field: F.lime, name: "limestone" }, inputs: {}, outputs: { lime: 1 },
    cycle: HOUR * 1.5, cost: 20000, upkeep: 26, trucks: 4, store: 8, power: 6, site: { planks: 12 }, supplies: { explosives: 3 },
    blurb: "Quarries limestone for cement and chemical works.",
  },
  smelter: {
    kind: "smelter", tier: 2, inputs: { ore: 1, coal: 1 }, outputs: { steel: 1, slag: 1 }, byproduct: "slag",
    cycle: HOUR * 1.5, cost: 45000, upkeep: 50, trucks: 2, store: 8, power: 14, site: { planks: 24 },
    blurb: "Smelts iron ore with coal into steel, with slag left over for cement.",
  },
  cementworks: {
    kind: "cementworks", tier: 2, inputs: { lime: 1, coal: 1 }, alt: { lime: "slag" }, outputs: { cement: 1 },
    cycle: HOUR, cost: 40000, upkeep: 45, trucks: 3, store: 8, power: 10, site: { planks: 24 },
    blurb: "Burns limestone or slag with coal into cement for the towns.",
  },
  coalplant: {
    kind: "coalplant", tier: 2, inputs: { coal: 1 }, alt: { coal: "chips" }, outputs: {},
    cycle: HOUR * 3, cost: 32000, upkeep: 35, trucks: 0, store: 8, makes: 40, reach: 4000, site: { planks: 20 },
    blurb: "Burns coal or wood chips to power the works on its roads within 4 km.",
  },
  // tier 3: the building sites wait for planks and cement
  oilwell: {
    kind: "oilwell", tier: 3, deposit: { field: F.oil, name: "oil" }, inputs: {}, outputs: { crude: 1 },
    cycle: HOUR * 1.2, cost: 28000, upkeep: 30, trucks: 4, store: 8, site: { planks: 30, cement: 20 }, supplies: { explosives: 3 },
    blurb: "Pumps crude oil for your refineries.",
  },
  sandpit: {
    kind: "sandpit", tier: 3, deposit: { field: F.sand, name: "sand" }, inputs: {}, outputs: { sand: 1 },
    cycle: HOUR * 1.2, cost: 22000, upkeep: 24, trucks: 4, store: 8, site: { planks: 30, cement: 20 }, supplies: { explosives: 3 },
    blurb: "Digs sand by the water for your glassworks.",
  },
  refinery: {
    kind: "refinery", tier: 3, inputs: { crude: 1 }, outputs: { fuel: 1, plastics: 1 },
    cycle: HOUR, cost: 60000, upkeep: 60, trucks: 4, store: 8, power: 16, site: { planks: 60, cement: 50 },
    blurb: "Splits crude oil into plastics and fuel for filling stations.",
  },
  glassworks: {
    kind: "glassworks", tier: 3, inputs: { sand: 1, coal: 1 }, outputs: { glass: 1 },
    cycle: HOUR, cost: 48000, upkeep: 50, trucks: 3, store: 8, power: 12, site: { planks: 50, cement: 40 },
    blurb: "Melts sand with coal into glass for your furniture factories.",
  },
  furniture: {
    kind: "furniture", tier: 3, inputs: { planks: 1, glass: 1 }, outputs: { goods: 1 },
    cycle: HOUR, cost: 42000, upkeep: 45, trucks: 3, store: 8, site: { planks: 50, cement: 30 },
    blurb: "Builds household goods from planks and glass for the towns' shops.",
  },
  constructionplant: {
    kind: "constructionplant", tier: 3, inputs: { steel: 1, cement: 1 }, outputs: { parts: 1 },
    cycle: HOUR, cost: 52000, upkeep: 55, trucks: 3, store: 8, power: 14, site: { planks: 50, cement: 50 },
    blurb: "Casts steel and cement into the parts towns build their blocks from.",
  },
  // tier 4: the building sites wait for construction parts as well as planks and cement
  coppermine: {
    kind: "coppermine", tier: 4, deposit: { field: F.copper, name: "copper ore" }, inputs: {}, outputs: { copperore: 1 },
    cycle: HOUR * 1.2, cost: 34000, upkeep: 34, trucks: 4, store: 8, site: { planks: 30, cement: 20, parts: 15 }, supplies: { explosives: 3 },
    blurb: "Digs copper ore in the high ranges for your copper smelters.",
  },
  coppersmelter: {
    kind: "coppersmelter", tier: 4, inputs: { copperore: 1, coal: 1 }, outputs: { copper: 1 },
    cycle: HOUR * 1.2, cost: 62000, upkeep: 60, trucks: 3, store: 8, power: 16, site: { planks: 50, cement: 40, parts: 30 },
    blurb: "Smelts copper ore with coal for electronics plants and machine works.",
  },
  electronics: {
    kind: "electronics", tier: 4, inputs: { copper: 1, plastics: 1 }, outputs: { electronics: 1 },
    cycle: HOUR, cost: 70000, upkeep: 62, trucks: 3, store: 8, power: 12, site: { planks: 50, cement: 40, parts: 30 },
    blurb: "Builds electronics from copper and plastics for city shops.",
  },
  machineworks: {
    kind: "machineworks", tier: 4, inputs: { steel: 1, copper: 1 }, outputs: { machinery: 1 },
    cycle: HOUR * 1.2, cost: 72000, upkeep: 64, trucks: 3, store: 8, power: 14, site: { planks: 60, cement: 50, parts: 40 },
    blurb: "Builds machinery from steel and copper for city offices and towers.",
  },
  // supplies (docs/design.md "Supplies"): limestone burnt with coal makes lime-nitrogen fertilizer for the farms and,
  // from the coal tar, explosives for the mines, quarries, pits and wells, which need them to grow past level 2
  chemworks: {
    kind: "chemworks", tier: 3, inputs: { lime: 1, coal: 1 }, outputs: { fertilizer: 1, explosives: 1 },
    cycle: HOUR, cost: 50000, upkeep: 50, trucks: 3, store: 8, power: 12, site: { planks: 50, cement: 40 },
    blurb: "Burns limestone with coal into fertilizer and explosives, which farms and mines need past level 2.",
  },
  // perishables (docs/design.md "Perishables"): milk from a herd on fertile soil, in refrigerated trucks; the
  // creamery's cheese keeps about three times as long
  dairyfarm: {
    kind: "dairyfarm", tier: 2, deposit: { field: F.fert, name: "fertile soil" }, inputs: {}, outputs: { milk: 1 },
    cycle: HOUR * 1.2, cost: 16000, upkeep: 16, trucks: 2, store: 6, site: { planks: 12 }, supplies: { fertilizer: 3 },
    blurb: "Milks a herd on fertile pasture for fresh milk, which spoils on long trips.",
  },
  creamery: {
    kind: "creamery", tier: 2, inputs: { milk: 1 }, outputs: { cheese: 1 },
    cycle: HOUR, cost: 30000, upkeep: 32, trucks: 2, store: 8, power: 8, site: { planks: 16 },
    blurb: "Turns milk into cheese, which keeps three times as long.",
  },
  // tier 5 (docs/design.md "Motor Works"): the refinery's plastics with coal make rubber; steel, glass, rubber and
  // electronics make cars, and every car a town buys puts more of its people on the road
  rubberplant: {
    kind: "rubberplant", tier: 5, inputs: { plastics: 1, coal: 1 }, outputs: { rubber: 1 },
    cycle: HOUR, cost: 68000, upkeep: 58, trucks: 3, store: 8, power: 14, site: { planks: 50, cement: 40, parts: 30 },
    blurb: "Makes rubber from plastics and coal for your Motor Works.",
  },
  motorworks: {
    kind: "motorworks", tier: 5, inputs: { steel: 1, glass: 1, rubber: 1, electronics: 1 }, outputs: { cars: 1 },
    cycle: HOUR * 1.2, cost: 120000, upkeep: 90, trucks: 3, store: 8, power: 20, site: { planks: 60, cement: 60, parts: 50 },
    blurb: "Builds cars from steel, glass, rubber and electronics, and stops when one runs out.",
  },
  // logistics (docs/design.md "Freight"): a warehouse buffers any product and its own trucks carry it on; a fuel
  // depot takes fuel from the refineries and fills the company's trucks that pass it at cost
  warehouse: {
    kind: "warehouse", tier: 2, inputs: {}, outputs: {}, logistics: "warehouse",
    cycle: HOUR, cost: 18000, upkeep: 18, trucks: 12, store: 60, site: { planks: 12 },
    blurb: "Stores any load and ships it on with its own trucks.",
  },
  fueldepot: {
    kind: "fueldepot", tier: 3, inputs: { fuel: 1 }, outputs: {}, logistics: "depot",
    cycle: HOUR, cost: 14000, upkeep: 10, trucks: 0, store: 8, site: { planks: 20, cement: 10 },
    blurb: "Fills your trucks passing within 1.5 km with fuel at cost.",
  },
  // landmarks (docs/design.md "Landmarks"): defined with the rest of the megaprojects
  ...MEGA_PLANTS,
};

/** A wait in words: "under an hour", "about 6 hours", "about 2 days". */
export function aboutHours(h: number): string {
  if (h < 0.75) return "under an hour";
  if (h < 36) { const n = Math.max(1, Math.round(h)); return `about ${n} hour${n === 1 ? "" : "s"}`; }
  return `about ${Math.round(h / 24)} days`;
}

export const PLANT_KINDS = Object.keys(PLANTS) as PlantKind[];
// One voice for what a works does (review 2026-11-10, B5: the Power Plant's card said "Burns coal" while its banner
// and the hand bar said "coal or wood chips"): the catalog card, the panel and the tooltip read BUILDING_TYPES, and
// a works' line there is its recipe's own, set here from PLANTS (config.ts leaves it empty).
for (const k of PLANT_KINDS) BUILDING_TYPES[k].blurb = PLANTS[k].blurb;
export const isPlantKind = (k: BuildingKind | string): k is PlantKind => k in PLANTS;
/** What each worker is paid per hour. */
export const WAGE = 1;
/** Least share of an extractor's lot that must sit on its deposit. */
export const MIN_DEPOSIT = 0.35;
/** Fuel and wear per km a light truck drives (both ways), charged when it sets off. */
export const FUEL_PER_KM = 4;
/**
 * What each unit of cargo already on its way to a town's shop takes off that shop's worth, against the town's
 * least-served one (about 4 km of extra driving a unit): the next truck goes to another counter in the same town.
 */
export const SHARE_OUT = 30;
/**
 * The haul a site's fleet is sized for (m, one way): at every level it has the trucks to carry its whole output,
 * fully staffed, this far over streets, with the smallest truck and load. Nothing to buy: the fleet grows with the
 * site, and bigger truck classes stretch the same fleet over longer hauls. Idle trucks wait in the yard,
 * so a fleet bigger than a short haul needs puts no extra traffic on the road.
 */
export const FLEET_HAUL = 3000;
/** Round trip (s) behind FLEET_HAUL: there and back at a truck's street pace, plus loading, junctions and yards. */
const FLEET_TRIP = (2 * FLEET_HAUL) / (ROAD_TYPES.street.speed * 0.85) + 45;
/** What a km of fuel costs a truck that fills up at one of the company's depots (at cost, not the market price). */
export const FUEL_AT_COST = 1;
/** How far off a truck's run (the straight line from its yard to its customer) a depot may be and still fill it (m). */
export const DEPOT_REACH = 1500;
/** Light-truck km one load of fuel lasts, from a depot. */
export const DEPOT_KM = 400;
/** Pace of a building that needs power and has none (it scales up to 1 with the share of power it gets). */
export const UNPOWERED = 0.4;
/** Pace from the share of power a building gets. */
export const powerPace = (share: number) => UNPOWERED + (1 - UNPOWERED) * Math.max(0, Math.min(1, share));

// ------------------------------------------------------------------ supplies, alternates and by-products
// (docs/design.md "Supplies" and "Alternate inputs")

/** Loads of each supply a site keeps in its store. */
export const SUPPLY_STORE = 4;
/** Loads of each supply a site uses up per batch it makes at a level that needs it. */
export const SUPPLY_USE = 0.2;
/** The level every site needs machinery from (its fitters' spares), on top of its own supplies. */
export const MACHINERY_LEVEL = 4;

/**
 * The supplies a site of this kind draws at a level: its own (fertilizer for a farm, explosives for a mine, from
 * level 3), and machinery at level 4 (except a building that makes machinery itself). Logistics need none.
 */
export function suppliesAt(kind: PlantKind, level: number): Product[] {
  const d = PLANTS[kind];
  if (!d || d.logistics) return [];
  const out = entries(d.supplies ?? {}).filter(([, from]) => level >= from).map(([p]) => p);
  if (level >= MACHINERY_LEVEL && !d.outputs.machinery && !out.includes("machinery")) out.push("machinery");
  return out;
}

/** Products that stand in for an input at a plant of this kind (slag at a cement works). */
export const altsOf = (kind: PlantKind): Product[] => Object.values(PLANTS[kind]?.alt ?? {}) as Product[];

/** Does a plant of this kind take this product in, as an input or as the alternate for one? */
export const takesIn = (kind: PlantKind, p: Product): boolean => !!PLANTS[kind]?.inputs[p] || altsOf(kind).includes(p);

/** Does a site of this kind draw this product as a supply at any level? */
export const suppliedWith = (kind: PlantKind, p: Product): boolean => suppliesAt(kind, MACHINERY_LEVEL).includes(p);

/** A plant's working state (kept on its Building, so it saves with it). */
export interface PlantState {
  /** input stores, in loads */
  stock: Partial<Record<Product, number>>;
  /** output waiting for a truck, in loads */
  out: Partial<Record<Product, number>>;
  /** progress through the current batch, 0..1 */
  prog: number;
  /** share of the lot on its deposit (1 for plants) */
  yld: number;
  /** (saves from before fleets came from the site's level: trucks it owned and how many were bought; unused) */
  trucks?: number;
  bought?: number;
  /** a construction site: the materials it waits for, and what has arrived */
  site?: {
    need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>>;
    /** loads that landed this game hour, and in each of the last SITE_HOURS full hours, oldest first (see siteEta) */
    hour?: number; hours?: number[];
  };
  /**
   * per product, the loads it has sent to works' building sites and to towns short of it since both wanted it at
   * once (the fair share: SITE_SHARE); unset while only one of the two does
   */
  split?: Partial<Record<Product, { site: number; town: number }>>;
  /** this hour's and the last full hour's books */
  now: PlantBooks;
  last: PlantBooks;
  /** the site's level (1-4, docs/design.md "Industry sites"): output, jobs and trucks grow with it */
  level: number;
  /** working time (s) toward the next level */
  grow: number;
  /** sim time it last grew (its new buildings go up for a while after) */
  upAt: number;
  /** what keeps it from growing now (null: it is growing, or at the top level) */
  why?: string | null;
  /** a warehouse: the products it takes (all when not set), and those it is a feeder for (sent to it first) */
  takes?: Product[];
  feeds?: Product[];
  /** a fuel depot: trucks it filled and what that saved against the market price, all time */
  served?: number;
  saved?: number;
  /** per product, the sim time its docked truck began waiting for a fuller load (unset: none waiting) */
  hold?: Partial<Record<Product, number>>;
  /** loads of each product it made in each of the last HIST_HOURS game hours, oldest first */
  hist?: Partial<Record<Product, number>>[];
  /** a machine works: the oversized piece it is building besides its machinery, and those waiting (convoys.ts) */
  big?: BigState;
  /** a power plant: turbines delivered by convoy, each adding to its output for good */
  turbines?: number;
  /** a landmark: pieces delivered, when it was finished, the town it serves (megaprojects.ts) */
  landmark?: LandmarkState;
  /** perishables it shipped (docs/design.md "Perishables"): loads delivered, and those that arrived fresh, all time */
  perish?: number;
  fresh?: number;
}

/** Hours of output a plant remembers (its panel's "a day" figures and chart). */
export const HIST_HOURS = 24;

export interface PlantBooks {
  made: number; sent: number; earned: number; spent: number;
  /** loads made of each product */
  by?: Partial<Record<Product, number>>;
  /** a depot: trucks filled, money saved */
  served?: number; saved?: number;
  /** its perishable loads delivered, those that arrived fresh, and the value lost to spoiling on the way */
  perish?: number; fresh?: number; spoiled?: number;
}
const books = (): PlantBooks => ({ made: 0, sent: 0, earned: 0, spent: 0 });

/** What a truck of the company's is doing (on Trip.haul). */
export interface HaulRun {
  plant: number;
  leg: "out" | "back";
  product: Product;
  n: number;
  /** the building it delivers to (out) or came from (back) */
  dest: number;
  /** the class of truck making the run (light when not set) */
  cls?: TruckClass;
  /** an escorted convoy carrying an oversized piece (convoys.ts): not one of the building's trucks */
  big?: BigKind;
  /** the leg ended (arrived or failed): traffic can report a trip twice */
  done?: boolean;
  /** sim time it is due to land (out), from the trips its plant has made there before or the distance */
  eta?: number;
}

/** What the industry needs from the game. */
export interface IndustryHost {
  readonly time: number;
  readonly buildings: Buildings;
  /** has the world field `f` at p (a deposit) */
  has(f: number, p: V2): boolean;
  connected(segA: number, segB: number): boolean;
  workersAt(id: number): number;
  /** buildings that sell to a town's residents */
  readonly shops: Building[];
  /** the town a shop belongs to (null: none) */
  townOf(b: Building): number | null;
  /** loads of a product a town still wants today (0 or less: it has enough; -Infinity: it doesn't use it) */
  want(town: number, p: Product): number;
  /** loads a town still needs to grow (its shops buy up to its demand and no more; this part comes first), 0 if none */
  short?(town: number, p: Product): number;
  /**
   * sim s until what has landed of a need in a town would read below "Enough" with only the loads `arriving` (sim time
   * each lands) still to come: 0 when it does already, Infinity when not soon or not a need (settlements.ts dipIn)
   */
  dipIn?(town: number, p: Product, arriving: readonly { at: number; n: number }[]): number;
  /** a load reached one of a town's shops */
  sold(town: number, p: Product, n: number): void;
  /**
   * a load was handed over (to a town's shop or another plant): what it paid, and for a perishable how fresh it
   * arrived and the value lost on the way (the map pops the money; a spoiled load is called out)
   */
  delivered?(d: Delivery): void;
  /** a plant sent a by-product out to another plant (the map shows it leave as its own cargo) */
  shipped?(from: Building, to: Building, p: Product, n: number): void;
  request(p: PendingSpawn): void;
  /** vehicles on the road and trips waiting to set off */
  trips(): Iterable<Trip>;
  /** the trips held up now: in a yard whose first truck out can't find a gap in the traffic ("gate"), or standing in
   *  traffic 30 s and more ("road") */
  held?(): Map<Trip, "gate" | "road">;
  /** the share of a need a town reads as supplied on what has landed (0..1; its panel's figure) */
  supply?(town: number, p: Product): number;
  /** per building, the company's trucks waiting in its yard to pull out of its gate (none: not listed) */
  queued?(): Map<number, number>;
  earn(v: number): void;
  spend(v: number, what: "wages" | "upkeep" | "fuel"): void;
  /** the level a kind of site may grow to now, and the goal that clears it for the next (none: it is at the top) */
  levelCap?(kind: PlantKind, level: number): { level: number; goal?: string };
  /** the best class of truck unlocked (every fleet runs it) */
  truckClass?(): TruckClass;
  /** share of the power a building needs that it gets (0..1) */
  power?(b: Building): number;
  /** a power plant has buildings within reach that want its power (it only burns coal then) */
  wanted?(b: Building): boolean;
  /** a plant made loads of a product (the company's tallies) */
  made?(p: Product, n: number): void;
  /** a site grew a level */
  grew?(b: Building, level: number): void;
  /** a building made loads of a product (a machine works builds its oversized pieces alongside) */
  madeAt?(b: Building, p: Product, n: number): void;
  /** a kind's pace now against its year-round average (the harvest seasons: calendar.ts) */
  season?(kind: PlantKind): number;
  /**
   * can the company make this product yet (a building that makes it is unlocked)? A supply is only required once it
   * can (as a town's blocks wait for construction parts only once the construction plant is unlocked); none without
   */
  canMake?(p: Product): boolean;
}

export interface Customer {
  b: Building; value: number; /** loads it can take */ room: number;
  /** a town about to dip below "Enough": its load goes without waiting at the dock for a full truck */
  urgent?: boolean;
  /** a works' building site (not a landmark's): it shares the output with towns short of the product (SITE_SHARE) */
  site?: boolean;
  /** a town short of the product: below "Enough", or about to be before a truck could land */
  need?: boolean;
  /** (a town short of it) the share of the need it reads as supplied, 0..1: the shortest comes first on the towns' turn */
  has?: number;
  /** both a works' site and a town short of it want this product now: the load counts toward the fair share */
  shared?: boolean;
}

/** How far along a building site's deliveries are (Industry.siteEta). */
export interface SiteEta {
  /** loads landed, and loads its bill asks for (all materials together) */
  got: number; need: number;
  /** loads an hour it has been getting (over the game hours it remembers, up to SITE_HOURS) */
  perHour: number;
  /** game hours until the last load lands at that rate (0: all in; null: nothing has landed lately) */
  hours: number | null;
}

export class Industry {
  constructor(private h: IndustryHost) {}

  /** Per building, this tick: its trucks held at its own gate or in traffic, and loads on their way to it held up. */
  private jam = new Map<number, { gate: number; road: number; on: Partial<Record<Product, number>>; held: Partial<Record<Product, number>> }>();
  /** Per plant, this tick: loads for works' building sites still in its yard behind its jammed gate ("dest:product"). */
  private gated = new Map<number, Map<string, number>>();
  /** Loads of `p` for `dest` that `from` has waiting behind its own jammed gate (counted on by it alone). */
  private stuckFor(from: number, dest: number, p: Product): number {
    return this.gated.get(from)?.get(`${dest}:${p}`) ?? 0;
  }
  /** Per customer, this tick: the company's loaded trucks on their way to it, and those of them standing in traffic. */
  private inbound = new Map<number, { on: number; held: number }>();
  /** Per building, this tick: trucks waiting in its yard to pull out of its gate. */
  private queue = new Map<number, number>();
  /** A customer's key in `inbound`: a works by its id; a town's shops together (their trucks share its roads). */
  private destKey(o: Building): number {
    const t = o.plant ? null : this.h.townOf(o);
    return t === null ? o.id : -1 - t;
  }
  /** Are the trucks on their way to a customer held up in traffic (see CHOKED)? One more would only join the queue. */
  choked(o: Building): boolean {
    const i = this.inbound.get(this.destKey(o));
    return !!i && i.held >= CHOKED && i.held * 2 >= i.on;
  }
  /** Per works, this tick: its empty trucks on their way home, and those of them standing in traffic. */
  private homing = new Map<number, { on: number; held: number }>();
  /**
   * Are a works' own trucks held up in traffic on their way home (see CHOKED)? The way to its gate is full: the
   * trucks at the dock wait, rather than pull out into the same junction and add to it.
   */
  homeChoked(b: Building): boolean {
    const i = this.homing.get(b.id);
    return !!i && i.held >= CHOKED && i.held * 2 >= i.on;
  }
  /** Trucks waiting in a works' yard to pull out of its gate now (GATE_QUEUE of them at most are sent to wait there). */
  atGate(b: Building): number {
    return this.queue.get(b.id) ?? 0;
  }
  private jamOf(id: number) {
    let j = this.jam.get(id);
    if (!j) this.jam.set(id, (j = { gate: 0, road: 0, on: {}, held: {} }));
    return j;
  }

  /** The company's extractors and plants. */
  plants(): Building[] {
    return this.h.buildings.list.filter((b) => b.plant);
  }

  /** Share of a lot (centre c, turned rot, half sizes) that sits on a deposit field. */
  depositShare(field: number, c: V2, rot: number, hw: number, hd: number): number {
    const u = { x: Math.cos(rot), y: Math.sin(rot) }, v = { x: -u.y, y: u.x };
    let n = 0, on = 0;
    for (let i = 0; i < 5; i++) for (let j = 0; j < 5; j++) {
      const a = -hw + ((i + 0.5) / 5) * 2 * hw, b = -hd + ((j + 0.5) / 5) * 2 * hd;
      n++;
      if (this.h.has(field, { x: c.x + u.x * a + v.x * b, y: c.y + u.y * a + v.y * b })) on++;
    }
    return on / n;
  }

  /** Make a freshly placed building one of the company's plants (from tier 2, a site waiting for its materials). */
  init(b: Building, kind: PlantKind, yld = 1) {
    const d = PLANTS[kind];
    b.plant = { stock: {}, out: {}, prog: 0, yld, now: books(), last: books(), level: 1, grow: 0, upAt: -1e9 };
    if (d.site) b.plant.site = { need: { ...d.site }, got: {} };
    if (d.mega) b.plant.landmark = { pieces: 0 };
  }

  /** Trucks a plant runs: its site level's fleet (Industry.fleetAt; a power plant has none). */
  trucksOf(b: Building): number {
    const P = b.plant!;
    return Industry.fleetAt(b.kind as PlantKind, P.level, P.yld);
  }

  /**
   * The fleet a site of this kind runs at a level: enough trucks to carry everything it makes, fully staffed on
   * a deposit of this yield, FLEET_HAUL away and back (never fewer than its kind's least).
   */
  static fleetAt(kind: PlantKind, level: number, yld = 1): number {
    const d = PLANTS[kind];
    if (d.trucks <= 0) return 0;
    let per = 0;
    // (a by-product rides on the trucks the main product leaves free: it doesn't size the fleet)
    for (const [p, n] of entries(d.outputs)) if (p !== d.byproduct) per += n ?? 0;
    const perSec = (per * levelMult(level) * yld) / d.cycle;
    return Math.max(d.trucks, Math.ceil(perSec * FLEET_TRIP));
  }

  /** Loads of a product a plant makes in a game day at its level, fully staffed and powered, never held up. */
  static perDay(b: Building, p: Product): number {
    const d = PLANTS[b.kind as PlantKind], n = d?.outputs[p] ?? 0;
    if (!n || !b.plant) return 0;
    return (n * levelMult(b.plant.level) * b.plant.yld * DAY_S) / d.cycle;
  }

  /** Loads of a product it made over the hours it remembers (up to a day), and how many hours that is. */
  static madeLately(b: Building, p: Product): { made: number; hours: number; byHour: number[] } {
    const h = b.plant?.hist ?? [];
    const byHour = h.map((x) => x[p] ?? 0);
    return { made: byHour.reduce((a, v) => a + v, 0), hours: h.length, byHour };
  }

  /** Loads each of a plant's stores holds (the yard grows with the site). */
  static storeOf(b: Building): number {
    return Math.round(PLANTS[b.kind as PlantKind].store * levelMult(b.plant?.level ?? 1));
  }

  /** Jobs at a site of this kind and level. */
  static jobsAt(jobs: number, level: number): number {
    return Math.round(jobs * levelMult(level));
  }

  /**
   * The class of truck the company's fleets run: the best one unlocked, for every building at once (no picking per
   * building). A trip keeps the class it set off with, so trucks out on the road finish their run as they are.
   */
  fleetClass(): TruckClass {
    return this.h.truckClass?.() ?? "light";
  }

  /** Loads a truck of a class carries (the best unlocked when not given): bigger trucks carry more, nothing else does. */
  capOf(_b?: Building, cls: TruckClass = this.fleetClass()): number {
    return classOf(cls).payload;
  }

  /** A site's trucks of each class: the mix its level runs, up to the best class unlocked (a warehouse: level 3's). */
  mixOf(b: Building): FleetMix {
    const level = Industry.logisticsOf(b) === "warehouse" ? 3 : b.plant?.level ?? 1;
    return fleetMix(this.trucksOf(b), level, this.fleetClass());
  }

  /**
   * The class to load next: of those with a truck in the yard, the one with the most of its trucks at home (the
   * furthest behind its share of the work); ties go to the bigger class.
   */
  static nextClass(mix: FleetMix, out: Partial<FleetMix>): TruckClass | null {
    let best: TruckClass | null = null, bestUse = Infinity;
    for (const c of TRUCK_CLASS_ORDER) {
      const n = mix[c], o = out[c] ?? 0;
      if (n - o <= 0) continue;
      const use = o / n;
      if (use <= bestUse) { best = c; bestUse = use; }
    }
    return best;
  }

  /** A logistics building's kind, if it is one. */
  static logisticsOf(b: Building): PlantDef["logistics"] {
    return PLANTS[b.kind as PlantKind]?.logistics;
  }

  /** Loads a warehouse holds now, all products together. */
  static stored(b: Building): number {
    let n = 0;
    for (const k of Object.values(b.plant?.stock ?? {})) n += k ?? 0;
    return n;
  }

  /** Is it up and working (not a site, not being built)? */
  static running(b: Building): boolean {
    return !!b.plant && !b.plant.site && b.built >= 1;
  }

  /** Loads of a material a site (a plant's, or a town building's) still waits for (not counting what is on its way). */
  static siteLeft(b: Building, p: Product): number {
    const s = b.plant?.site ?? b.site;
    return s ? (s.need[p] ?? 0) - (s.got[p] ?? 0) : 0;
  }

  /**
   * The output that stops a plant: its one output when full, or with two, the first once both are full. A by-product
   * never keeps it working (nor stops it: a full one is flared).
   */
  static fullOf(b: Building, store = Industry.storeOf(b)): Product | undefined {
    const D = PLANTS[b.kind as PlantKind];
    const outs = entries(D.outputs).filter(([p]) => p !== D.byproduct);
    if (!outs.length) return undefined;
    return outs.every(([p]) => (b.plant!.out[p] ?? 0) >= store) ? outs[0][0] : undefined;
  }

  /** A side product with a full store while the plant works on (flared until something uses it), if any. */
  static flaring(b: Building): Product | undefined {
    const outs = entries(PLANTS[b.kind as PlantKind].outputs);
    if (outs.length < 2 || !b.plant || Industry.fullOf(b)) return undefined;
    const store = Industry.storeOf(b);
    return outs.find(([p]) => (b.plant!.out[p] ?? 0) >= store)?.[0];
  }

  /** The tier whose plants first use a product nobody uses yet. */
  static laterTier(p: Product): number {
    return p === "plastics" ? 4 : 3;
  }

  /** The plants that take a product in (as an input, its alternate or a supply), by name: "glassworks or furniture factory". */
  static takers(p: Product): string {
    const ks = PLANT_KINDS.filter((k) => takesIn(k, p) || (p !== "machinery" && suppliedWith(k, p)));
    const xs = ks.map((k) => BUILDING_TYPES[k].name.toLowerCase());
    return (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} or ${xs[xs.length - 1]}` : xs[0]) || (p === "machinery" ? "site of level 3 or more" : "plant");
  }

  /** The plants that take a product, three at most: "smelter or power plant", "smelter, cement works or another works". */
  static takersShort(p: Product): string {
    const xs = Industry.takers(p).split(/, | or /);
    return xs.length <= 3 ? Industry.takers(p) : `${xs[0]}, ${xs[1]} or another works`;
  }

  /** Does any building of the company's take this product in (as an input, its alternate, a supply or a building material)? */
  static usedBy(p: Product): boolean {
    return PLANT_KINDS.some((k) => takesIn(k, p) || suppliedWith(k, p) || PLANTS[k].site?.[p]);
  }

  // ---------------------------------------------------------------- supplies (docs/design.md "Supplies")

  /** Is it only ever a supply (fertilizer, explosives), never a plant's input or a town's purchase? */
  static isSupply(p: Product): boolean {
    return PRODUCTS[p].price <= 0 && PLANT_KINDS.some((k) => suppliedWith(k, p)) && !PLANT_KINDS.some((k) => takesIn(k, p));
  }

  /** Is a supply required yet (the company can make it)? */
  private required(p: Product): boolean {
    return this.h.canMake?.(p) ?? false;
  }

  /** The supplies a site's level needs that it is out of (only those the company can make yet). */
  lacking(b: Building, level = b.plant!.level): Product[] {
    const P = b.plant!;
    return suppliesAt(b.kind as PlantKind, level).filter((p) => this.required(p) && (P.stock[p] ?? 0) < SUPPLY_USE - 1e-9);
  }

  /**
   * The level a site works at: its own while it has every supply its level needs; otherwise the highest level whose
   * supplies it has, and never below level 2 (a farm out of fertilizer works at its level-2 pace, not at nothing).
   */
  paceLevel(b: Building): number {
    const L = b.plant!.level;
    for (let k = L; k > 2; k--) if (!this.lacking(b, k).length) return k;
    return Math.min(L, 2);
  }

  /**
   * A site's supplies for its panel (only those the company can make yet): each one's stock, and whether its level
   * draws it now or it is only needed in store to grow to the next.
   */
  supplyRows(b: Building): { p: Product; stock: number; now: boolean }[] {
    const P = b.plant!, now = suppliesAt(b.kind as PlantKind, P.level);
    return Industry.wantsSupply(b).filter((p) => this.required(p)).map((p) => ({ p, stock: P.stock[p] ?? 0, now: now.includes(p) }));
  }

  /**
   * What each supply in store adds to a site's pace (docs/design.md "Supplies"): the % more it makes than it would
   * without that one supply (a farm at level 3 with fertilizer, a level-4 mine with explosives and machinery).
   */
  boosts(b: Building): { p: Product; pct: number }[] {
    const P = b.plant;
    if (!P || P.site || b.built < 1) return [];
    const pace = this.paceLevel(b), out: { p: Product; pct: number }[] = [];
    for (const p of suppliesAt(b.kind as PlantKind, pace)) {
      if (!this.required(p)) continue;
      // (the pace it would work at with this one supply run out)
      const had = P.stock[p];
      P.stock[p] = 0;
      const without = this.paceLevel(b);
      if (had === undefined) delete P.stock[p]; else P.stock[p] = had;
      if (without < pace) out.push({ p, pct: Math.round((levelMult(pace) / levelMult(without) - 1) * 100) });
    }
    return out;
  }

  /** The supplies a site keeps a store of: those its level needs, and those it needs to grow to the next. */
  static wantsSupply(b: Building): Product[] {
    const P = b.plant;
    if (!P || P.site || b.built < 1) return [];
    return suppliesAt(b.kind as PlantKind, Math.min(SITE_LEVELS, P.level + 1));
  }

  /**
   * Trucks out per plant (in all and by class), and loads on their way to each customer (counted fresh each tick).
   * Also how many of each plant's trucks are held up, at its gate or out in traffic, and how many loads on their way
   * to each customer are: what tells a jammed haul (the roads' fault) from a long one or no buyer.
   */
  private census() {
    const busy = new Map<number, number>(), busyBy = new Map<number, Partial<FleetMix>>(), coming = new Map<number, Map<Product, number>>();
    const held = this.h.held?.();
    this.jam.clear();
    this.due.clear();
    this.gated.clear();
    this.inbound.clear();
    this.homing.clear();
    this.queue = this.h.queued?.() ?? new Map();
    for (const t of this.h.trips()) {
      const r = t.haul;
      // (a convoy with an oversized piece is not one of its works' trucks: convoys.ts keeps its own count)
      if (!r || r.done || r.big) continue;
      busy.set(r.plant, (busy.get(r.plant) ?? 0) + 1);
      const h = held?.get(t);
      // (an empty truck waiting at its customer's gate to come back isn't held up on the haul)
      if (h === "road") this.jamOf(r.plant).road++;
      else if (h === "gate" && r.leg === "out") this.jamOf(r.plant).gate++;
      if (held && r.leg === "out") {
        const d = this.jamOf(r.dest);
        d.on[r.product] = (d.on[r.product] ?? 0) + r.n;
        if (h) d.held[r.product] = (d.held[r.product] ?? 0) + r.n;
      }
      let by = busyBy.get(r.plant);
      if (!by) busyBy.set(r.plant, (by = {}));
      const c = r.cls ?? "light";
      by[c] = (by[c] ?? 0) + 1;
      if (r.leg !== "out") {
        let i = this.homing.get(r.plant);
        if (!i) this.homing.set(r.plant, (i = { on: 0, held: 0 }));
        i.on++;
        if (h === "road") i.held++;
        continue;
      }
      const dest = this.h.buildings.byId.get(r.dest);
      if (dest) {
        const k = this.destKey(dest);
        let i = this.inbound.get(k);
        if (!i) this.inbound.set(k, (i = { on: 0, held: 0 }));
        i.on++;
        if (h === "road") i.held++;
      }
      // (a load for a works' building site still in its yard behind a jammed gate isn't counted on there: another
      // plant whose trucks can get out sends it, or the site's last loads wait on that one gate for days; its own
      // plant still counts it, so it doesn't pile more into the same queue: see stuckFor)
      if (h === "gate" && dest?.plant?.site) {
        let s = this.gated.get(r.plant);
        if (!s) this.gated.set(r.plant, (s = new Map()));
        const k = `${r.dest}:${r.product}`;
        s.set(k, (s.get(k) ?? 0) + r.n);
        continue;
      }
      let m = coming.get(r.dest);
      if (!m) coming.set(r.dest, (m = new Map()));
      m.set(r.product, (m.get(r.product) ?? 0) + r.n);
      this.expect(r.dest, r.product, r.n, t.startT, r.eta);
    }
    return { busy, busyBy, coming };
  }

  /**
   * Loads on their way to each town, by product, and when each is due (for the send-ahead line only: a town has what
   * has landed). Counted fresh with the trips each tick.
   */
  private due = new Map<number, Map<Product, { at: number; n: number }[]>>();
  /** Average trip time from a plant to a town (sim s, keyed "plant>town"), from the trucks that got there (not saved). */
  private tripTime = new Map<string, number>();

  /** A load set off at `start` for `dest`, due at `eta`: counted on for its town while it is on time. */
  private expect(dest: number, p: Product, n: number, start: number, eta: number | undefined) {
    const o = this.h.buildings.byId.get(dest);
    const town = o && !o.plant ? this.h.townOf(o) : null;
    if (town === null || eta === undefined) return;
    // (a truck stuck in a jam well past when it was due isn't counted on any more: the town may be sent another)
    if (this.h.time > eta + (eta - start) * DUE_GRACE) return;
    let m = this.due.get(town);
    if (!m) this.due.set(town, (m = new Map()));
    let l = m.get(p);
    if (!l) m.set(p, (l = []));
    l.push({ at: Math.max(eta, this.h.time), n });
  }

  /** How long a truck takes from a plant to a building (sim s): as its last trips there took, or by the distance. */
  tripTo(from: Building, to: Building, cls?: TruckClass): number {
    const town = to.plant ? null : this.h.townOf(to);
    const seen = town === null ? undefined : this.tripTime.get(`${from.id}>${town}`);
    if (seen !== undefined) return seen;
    // (roads wind: a third more than the straight line, at a truck's pace on streets, and a minute out of the yard)
    const d = Math.hypot(to.c.x - from.c.x, to.c.y - from.c.y);
    return (d * 1.35) / (ROAD_TYPES.street.speed * classOf(cls).speed) + 30;
  }

  tick(span: number) {
    const { busy, busyBy, coming } = this.census();
    for (const b of this.plants()) {
      this.produce(b, span, busy.get(b.id) ?? 0, coming);
      this.dispatch(b, busy, busyBy, coming);
    }
  }

  /**
   * Work through the current batch: staff, deposit, power and inputs on hand set the pace; a full store stops it.
   * A power plant's batch is the coal it burns, and it burns only while something within reach wants power.
   */
  produce(b: Building, span: number, out = 0, coming: Map<number, Map<Product, number>> = new Map()) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.site) {
      const left = entries(P.site.need).map(([p, n]) => [p, n - (P.site!.got[p] ?? 0)] as [Product, number]).filter(([, n]) => n > 0);
      const parts = left.map(([p, n]) => `${n} load${n === 1 ? "" : "s"} of ${PRODUCTS[p].name.toLowerCase()}`);
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
      b.problem = left.length ? `Building site: waiting for ${list}` : null;
      return;
    }
    // (going up: nothing to make yet, but a gate with no road to it is worth saying while the crews work)
    if (b.built < 1) { b.problem = !b.access ? "No road to the gate" : null; return; }
    if (d.logistics) { this.logistic(b, out); return; }
    // (a finished landmark makes nothing and never grows: megaprojects.ts says what it does)
    if (d.mega) { b.problem = !b.access ? "No road to the gate" : null; P.why = null; P.grow = 0; return; }
    const staff = b.cap ? Math.min(1, this.h.workersAt(b.id) / b.cap) : 1;
    const pw = d.power ? (this.h.power?.(b) ?? 1) : 1;
    const idle = !!d.makes && !(this.h.wanted?.(b) ?? true);
    const store = Industry.storeOf(b);
    // (an input is on hand when its store, or its alternate's, holds a batch's worth: slag stands in for limestone)
    const alt = d.alt ?? {};
    const has = (p: Product, n: number) => (P.stock[p] ?? 0) >= n || (!!alt[p] && (P.stock[alt[p]!] ?? 0) >= n);
    const short = () => entries(d.inputs).find(([p, n]) => !has(p, n))?.[0];
    // (a plant with two outputs stops only once both are full: a full side product is flared, the rest goes on)
    const full = () => Industry.fullOf(b, store);
    const working = !!b.access && staff > 0 && !idle && !short() && !full();
    // a site out of a supply its level needs works at the pace of the highest level it has them all for (level 2 at least)
    const pace = this.paceLevel(b);
    if (working) {
      P.prog += (span * staff * P.yld * powerPace(pw) * levelMult(pace) * (this.h.season?.(b.kind as PlantKind) ?? 1)) / d.cycle;
      while (P.prog >= 1) {
        P.prog -= 1;
        // (the alternate is used first: it is the by-product that would otherwise be flared)
        for (const [p, n] of entries(d.inputs)) {
          const a = alt[p];
          if (a && (P.stock[a] ?? 0) >= n) P.stock[a] = P.stock[a]! - n;
          else P.stock[p] = (P.stock[p] ?? 0) - n;
        }
        for (const p of suppliesAt(b.kind as PlantKind, pace)) if (this.required(p)) P.stock[p] = Math.max(0, (P.stock[p] ?? 0) - SUPPLY_USE);
        for (const [p, n] of entries(d.outputs)) {
          const k = Math.min(n, Math.max(0, store - (P.out[p] ?? 0)));
          if (k <= 0) continue;
          P.out[p] = (P.out[p] ?? 0) + k; P.now.made += k; this.h.made?.(p, k); this.h.madeAt?.(b, p, k);
          const by = (P.now.by ??= {}); by[p] = (by[p] ?? 0) + k;
        }
        if (short() || full()) { P.prog = 0; break; }
      }
    }
    // the most pressing thing that holds it up (the trucks may add "nobody buys" when they find no customer)
    const s = short(), f = full();
    const fname = f && PRODUCTS[f].name.toLowerCase();
    const sname = s && (alt[s] ? `${PRODUCTS[s].name.toLowerCase()} or ${PRODUCTS[alt[s]!].name.toLowerCase()}` : PRODUCTS[s].name.toLowerCase());
    const lack = pace < P.level ? this.lacking(b, pace + 1) : [];
    b.problem = !b.access ? (b.placed ? "No road to the gate" : "No road access")
      : f && this.jammed(b, out) ? `Full of ${fname}: ${this.jammed(b, out)}`
      // (full with somewhere to send it: its trucks are too few for the haul; with nowhere, the reason why, in the
      // words its trucks use when they find nobody: a town that has all it takes for now is a full buyer, not none)
      : f ? `Full of ${fname}: ${this.fullWhy(b, f, coming)}`
      : staff <= 0 ? "No workers"
      : s ? `Waiting for ${sname}${this.stuckIn(b, s) ? ": the loads on their way are stuck in traffic" : ""}`
      : idle ? "Idle: no building within reach needs power"
      : staff < 0.5 ? "Not enough workers"
      : pw <= 0 ? `No power: working at ${Math.round(UNPOWERED * 100)}%`
      : pw < 0.999 ? `Short of power: working at ${Math.round(powerPace(pw) * 100)}%`
      : lack.length ? `Out of ${listText(lack.map((p) => PRODUCTS[p].name.toLowerCase()))}: working at its level ${pace} pace`
      : null;
    this.growth(b, span, working, staff, pw, store);
  }

  /**
   * Why a full site's trucks can't keep up, when it is the roads: a good share of them (out of `out` on the road or
   * waiting to set off) held at its gate, or standing in traffic. Null when they are moving (a long haul, or no buyer).
   */
  private jammed(b: Building, out: number): string | null {
    const j = this.jam.get(b.id);
    if (!j || out <= 0) return null;
    const many = (n: number) => n >= 2 && n >= out / 4;
    // (the queue at the gate is GATE_QUEUE long at most: full and not moving, the rest are held at the dock behind it)
    if (j.gate >= GATE_QUEUE || many(j.gate)) return "the road at its gate is jammed, its trucks can't get out";
    if (many(j.road)) return "its trucks are stuck in traffic on a jammed road";
    return null;
  }

  /** Most of the loads of `p` on their way to `b` are held up in traffic (or at their yard's gate). */
  private stuckIn(b: Building, p: Product): boolean {
    const j = this.jam.get(b.id);
    const held = j?.held[p] ?? 0;
    return held >= 1 && held * 2 >= (j!.on[p] ?? 0);
  }

  /**
   * A site grows a level after working near capacity for most of a few days: fully staffed (near enough), powered,
   * its inputs coming in and its output shipped. Idle time takes some of the progress back; it never shrinks.
   */
  private growth(b: Building, span: number, working: boolean, staff: number, pw: number, store: number) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.level >= SITE_LEVELS) { P.why = null; P.grow = 0; return; }
    // (a kind of site grows past its first levels once a goal clears it for the next)
    const cap = this.h.levelCap?.(b.kind as PlantKind, P.level);
    if (cap && P.level >= cap.level) {
      P.why = cap.goal ? `Level ${P.level + 1} opens with the goal "${cap.goal}"` : null;
      P.grow = 0;
      return;
    }
    // (only the main product counts: the refinery flares the plastics it can't ship and grows on its fuel)
    const main = entries(d.outputs)[0]?.[0];
    const piled = !!main && (P.out[main] ?? 0) > store * 0.75;
    // (growing a level needs the supplies of the level it grows to in its store: fertilizer before a farm's level 3)
    const lack = this.lacking(b, P.level + 1);
    const why = !b.access ? "No road to the gate"
      : !working ? (b.problem ?? "Not working")
      : staff < 0.8 ? "Needs more workers"
      : d.power && pw < 0.9 ? "Short of power"
      : piled ? (main && this.stocked(b, main) ? "Towns want no more for now" : "Output piling up")
      : lack.length ? (b.problem?.startsWith("Out of ") ? b.problem : `Needs ${listText(lack.map((p) => PRODUCTS[p].name.toLowerCase()))} to grow to level ${P.level + 1}`)
      : null;
    P.why = why;
    P.grow = why ? Math.max(0, P.grow - span * GROW_DECAY) : P.grow + span;
    if (P.grow >= growNeed(P.level)) this.levelUp(b);
  }

  /** Grow a site one level: more output, jobs and trucks, and its next buildings go up. */
  levelUp(b: Building) {
    const P = b.plant!;
    if (P.level >= SITE_LEVELS) return;
    P.level++;
    P.grow = 0;
    P.upAt = this.h.time;
    b.cap = Industry.jobsAt(BUILDING_TYPES[b.kind].jobs, P.level);
    this.h.grew?.(b, P.level);
  }

  /** A warehouse or a fuel depot: what holds it up (it makes nothing and never grows); `out`: its trucks on the road. */
  private logistic(b: Building, out: number) {
    const P = b.plant!;
    P.why = null;
    P.grow = 0;
    if (!b.access) { b.problem = b.placed ? "No road to the gate" : "No road access"; return; }
    if (PLANTS[b.kind as PlantKind].logistics === "depot") {
      b.problem = (P.stock.fuel ?? 0) < 0.05 ? "Out of fuel: waiting for a refinery's tankers" : null;
      return;
    }
    // (full with its trucks all out: it needs more of them; full with them parked: nothing wants what it holds)
    b.problem = Industry.stored(b) < Industry.storeOf(b) - 0.5 ? null
      : out >= this.trucksOf(b) ? "Full: its trucks can't ship the stock as fast as it comes in"
      : "Full: nothing needs more of what it holds right now";
  }

  /** Does any building of the company's take this product in (as an input or as a building material)? */
  private used(p: Product): boolean {
    return Industry.usedBy(p);
  }

  /** Is there a buyer for a product in the game at all: a town, or a plant that takes it? */
  static useful(p: Product): boolean {
    return PRODUCTS[p].price > 0 || Industry.usedBy(p);
  }

  /** Does the company have a buyer for a side product: a town (it has a price), or one of its own plants that takes it in? */
  wants(p: Product): boolean {
    return PRODUCTS[p].price > 0 || this.plants().some((o) => takesIn(o.kind as PlantKind, p) || Industry.wantsSupply(o).includes(p));
  }

  /**
   * The town buildings that take a product in: fuel goes to filling stations (or, in a town with none standing yet,
   * to its shops); machinery to offices and office towers (the same: to its shops while it has none); construction
   * parts to no shop at all (only to building sites); everything else to the shops.
   */
  private outlets(product: Product): Building[] {
    // (construction parts go to the towns' building sites, never over a shop counter)
    if (product === "parts") return [];
    const isStation = (o: Building) => !!BUILDING_TYPES[o.kind].fuel;
    const special = product === "fuel" ? isStation : product === "machinery" ? Industry.isOffice : null;
    const shops = this.h.shops.filter((o) => !isStation(o) || special === isStation);
    if (!special) return shops;
    const has = new Set<number>();
    for (const o of shops) if (special(o) && o.built >= 1 && !o.abandoned && o.town !== undefined) has.add(o.town);
    return shops.filter((o) => special(o) || o.town === undefined || !has.has(o.town));
  }

  /** The town buildings that take machinery: offices and office towers, the firms that fit out a city's works. */
  static isOffice(o: Building): boolean {
    return o.kind === "office" || o.kind === "tower" || o.kind === "glasstower";
  }

  /** Who would take a load of `product` from `from`, best first. */
  customers(from: Building, product: Product, coming: Map<number, Map<Product, number>> = this.census().coming): Customer[] {
    const out: Customer[] = [];
    const seg = from.access?.seg;
    if (seg === undefined) return out;
    const on = (id: number) => coming.get(id)?.get(product) ?? 0;
    // (a warehouse's own trucks never take a load to another warehouse: stock moves on to where it is used or sold)
    const fromStore = Industry.logisticsOf(from) === "warehouse";
    const feeders: Customer[] = [];
    const km = (o: Building) => Math.hypot(o.c.x - from.c.x, o.c.y - from.c.y) / 1000;
    const price = PRODUCTS[product].price;
    for (const o of this.h.buildings.list) {
      // a town's building site waiting for materials (a block or tower put up from construction parts): the town
      // pays for them, and its new building goes up once they are in
      if (!o.plant && o.site && price > 0) {
        if (!o.access || o.abandoned || !this.h.connected(seg, o.access.seg)) continue;
        const room = Industry.siteLeft(o, product) - on(o.id);
        if (room >= 1) out.push({ b: o, value: price + 400 - km(o) * FUEL_PER_KM * 2, room });
        continue;
      }
      if (!o.plant || o.id === from.id || !o.access || !this.h.connected(seg, o.access.seg)) continue;
      // building sites waiting for it come first: a plant that isn't built makes nothing (a landmark's site comes
      // after the chains and the towns' growth: it takes what is left over, see megaValue)
      if (o.plant.site) {
        const room = Industry.siteLeft(o, product) - on(o.id) - this.stuckFor(from.id, o.id, product);
        // (the site nearest done first: one works finished and running is worth more than four half supplied)
        const mega = !!PLANTS[o.kind as PlantKind].mega;
        if (room >= 1) out.push({ b: o, value: mega ? megaValue(price, km(o)) : 20000 - room * 100 - km(o) * FUEL_PER_KM * 2, room, ...(mega ? {} : { site: true }) });
        continue;
      }
      // a warehouse takes what nobody else wants now (after the plants and towns), unless it is a feeder for the
      // product: then it comes first, ahead of the plants it will pass it on to
      if (PLANTS[o.kind as PlantKind].logistics === "warehouse") {
        // (nor a perishable: a warehouse has no cold store, and milk goes straight to where it is wanted)
        if (fromStore || o.built < 1 || perishable(product)) continue;
        if (o.plant.takes && !o.plant.takes.includes(product)) continue;
        let onAll = 0;
        for (const k of coming.get(o.id)?.values() ?? []) onAll += k;
        const room = Math.floor(Industry.storeOf(o) - Industry.stored(o) - onAll);
        if (room < 1) continue;
        if (o.plant.feeds?.includes(product)) feeders.push({ b: o, value: 15000 - km(o) * FUEL_PER_KM * 2, room });
        // (overflow: below every plant and town, however far, so it only gets what nobody else can take now)
        else out.push({ b: o, value: -1e6 - km(o) * FUEL_PER_KM * 2, room });
        continue;
      }
      // own plants short of it: they keep the chain running (worth more than any sale); an alternate input has its own
      // store, and a supply (fertilizer, explosives, machinery for a grown site) a small one, routed like an input
      const kind = o.kind as PlantKind;
      const supply = !takesIn(kind, product) && Industry.wantsSupply(o).includes(product);
      if (!supply && !takesIn(kind, product)) continue;
      const room = (supply ? SUPPLY_STORE : Industry.storeOf(o)) - (o.plant.stock[product] ?? 0) - on(o.id);
      if (room < 1) continue;
      out.push({ b: o, value: 10000 + room * 100 - km(o) * FUEL_PER_KM * 2, room });
    }
    // the towns' shops (and filling stations) buy finished products, as much as each town uses in a day
    if (price > 0) {
      const shops = this.outlets(product);
      // what each town still wants today, less what is already on its way to any of its shops
      const left = new Map<number, number>(), shortLeft = new Map<number, number>();
      for (const o of shops) {
        const t = this.h.townOf(o);
        if (t === null) continue;
        left.set(t, (left.get(t) ?? this.h.want(t, product)) - on(o.id));
        shortLeft.set(t, (shortLeft.get(t) ?? (this.h.short?.(t, product) ?? 0)) - on(o.id));
      }
      // (how soon each town would read below "Enough" on what has landed there, with the loads on time to it)
      const dip = new Map<number, number>();
      let slow: TruckClass | undefined;
      const slowest = () => (slow ??= from.plant ? [...TRUCK_CLASS_ORDER].reverse().find((c) => this.mixOf(from)[c] > 0) ?? "light" : "light");
      const open = (o: Building) => !!o.access && !o.abandoned && o.built >= 1 && this.h.connected(seg, o.access.seg);
      // (the loads on their way to a town's least-served shop: the others count theirs above it, so the trucks share
      // a town's counters out instead of all queueing at the one nearest the works)
      const least = new Map<number, number>();
      for (const o of shops) {
        const t = this.h.townOf(o);
        if (t !== null && open(o)) least.set(t, Math.min(least.get(t) ?? Infinity, on(o.id)));
      }
      for (const o of shops) {
        if (!open(o)) continue;
        const t = this.h.townOf(o);
        const l = t === null ? 0 : left.get(t)!;
        // (a part load left counts: the load that completes its demand is taken whole, see settlements.ts roomFor)
        if (l <= 1e-6) continue;
        // a town still short of what it needs to grow comes first (within ~50 km of extra driving), then nearest
        // first; a town further short, and a shop with emptier shelves, a little ahead
        const short = t === null ? 0 : (shortLeft.get(t) ?? 0);
        // and ahead of those, a town that would dip below "Enough" (or, in its grace, show it) before a truck sent now
        // could land, with a spare: the send-ahead line. Its truck isn't kept waiting at the dock for a full load. (One
        // already showing short goes on the shortfall above: sending every truck there half empty, and the nearer
        // towns' loads after it, set the first Village back five minutes, measured 2026-11-09.)
        let soon = Infinity;
        if (t !== null && this.h.dipIn) {
          if (!dip.has(t)) dip.set(t, this.h.dipIn(t, product, this.due.get(t)?.get(product) ?? []));
          soon = dip.get(t)!;
        }
        // (on its slowest trucks, till one has made the run)
        const trip = soon < Infinity ? this.tripTo(from, o, slowest()) : 0;
        const ahead = soon > 0 && soon <= trip * (1 + SEND_SPARE) + SEND_PAD;
        // (short of it: below "Enough" on what has landed, or about to be; with no supply line to read, short of its day's)
        const need = t !== null && short >= 1 && (this.h.dipIn ? ahead || soon <= 0 : true);
        out.push({
          b: o, value: price - km(o) * FUEL_PER_KM * 2 + (short >= 1 ? 400 : 0) + (ahead ? SEND_FIRST : 0) + Math.min(3, l) * 15 - (product === "food" ? o.stock * 15 : 0)
            - (t === null ? 0 : on(o.id) - least.get(t)!) * SHARE_OUT,
          room: Math.ceil(l), ...(ahead ? { urgent: true } : {}), ...(need ? { need: true, has: this.h.supply?.(t!, product) ?? 0 } : {}),
        });
      }
    }
    out.sort((a, b) => b.value - a.value);
    // A town's needs come first on what a works makes, and its building sites take the rest: all of it while no town
    // on its roads is short, one load in four (SITE_SHARE) while one is, so neither waits for the other for ever.
    // Before, every load went to the sites until the last was built, and a town went from "Enough" to "None"
    // (docs/playtest-2026-11-09.md, B2).
    // (on the towns' turn the one that reads shortest goes first, not the nearest: with the sites taking their share
    // there may not be enough for every town, and the far one must not be the one left with none)
    const site = out.find((c) => c.site);
    let town: Customer | undefined;
    if (site) for (const c of out) if (c.need && (!town || (c.has ?? 0) < (town.has ?? 0) - 0.02)) town = c;
    if (site && town) {
      site.shared = town.shared = true;
      const sp = from.plant?.split?.[product];
      const sitesTurn = !!sp && sp.site < (sp.site + sp.town) * SITE_SHARE;
      // (the town's turn: its load goes just ahead of the sites')
      if (!sitesTurn) { out.splice(out.indexOf(town), 1); out.splice(out.indexOf(site), 0, town); }
    }
    // a feeder only takes from buildings it is nearer to than where the load would go otherwise (a mine beside its
    // smelter doesn't send its ore round by a feeder kilometres away)
    if (feeders.length) {
      const best = out.find((c) => Industry.logisticsOf(c.b) !== "warehouse");
      const near = feeders.filter((f) => !best || km(f.b) < km(best.b));
      if (near.length) out.unshift(...near.sort((a, b) => b.value - a.value));
    }
    return out;
  }

  /**
   * Send free trucks off with whatever is waiting. The site's trucks take turns by class (the one furthest behind its
   * share of the work goes next), and the truck at the dock waits for a full load, as much as the customer takes, or
   * half the yard, whichever is least, for up to HOLD: a road train doesn't set off with one load on board.
   */
  private dispatch(b: Building, busy: Map<number, number>, busyBy: Map<number, Partial<FleetMix>>, coming: Map<number, Map<Product, number>>) {
    const P = b.plant!;
    if (!b.access || P.site) return;
    let free = this.trucksOf(b) - (busy.get(b.id) ?? 0);
    if (free <= 0) { P.hold = undefined; return; }
    // (its gate has a queue already: the next truck stays at the dock, its load in the yard, till one has pulled out)
    // (nor while its own trucks stand in traffic on their way home: the way to its gate is full)
    if (this.homeChoked(b)) return;
    let gate = this.atGate(b);
    const gateRoom = this.h.queued ? GATE_QUEUE : Infinity;
    const hold = (P.hold ??= {});
    const mix = this.mixOf(b);
    let by = busyBy.get(b.id);
    if (!by) busyBy.set(b.id, (by = {}));
    // a warehouse ships what it has in store; a plant what it made
    const store = Industry.logisticsOf(b) === "warehouse";
    if (store && b.built < 1) return;
    const src = store ? P.stock : P.out;
    const outs: [Product, number][] = store ? entries(P.stock).filter(([, n]) => n >= 1).sort((x, y) => y[1] - x[1]) : entries(PLANTS[b.kind as PlantKind].outputs);
    const yard = Industry.storeOf(b);
    for (const [p] of outs) {
      // (a side product none of the company's plants takes stays in the yard without a word: the panel says it is
      // flared; and one with nowhere to go now is flared too, never the plant's problem)
      const side = !store && outs.length > 1 && p !== outs[0][0];
      // (the main product with nowhere to go says why, as a one-output plant's does: the smelter's steel, not its slag)
      if (side && !this.wants(p)) continue;
      while (free > 0 && gate < gateRoom && (src[p] ?? 0) >= 1) {
        const all = this.customers(b, p, coming);
        if (!all.length) {
          if (!store && !side && (src[p] ?? 0) >= 2 && b.access && !b.problem?.startsWith("Full of")) b.problem = this.noBuyer(b, p);
          if (P.split) delete P.split[p];
          break;
        }
        // (not to a customer whose trucks stand in traffic on the way: the load waits at the dock, or goes to the next)
        const c = all.find((x) => !this.choked(x.b));
        if (!c) break;
        const cls = Industry.nextClass(mix, by);
        if (!cls) { free = 0; break; }
        const load = this.capOf(b, cls);
        const n = Math.max(1, Math.min(load, Math.floor(src[p]!), c.room));
        // (not full yet: it waits at the dock, up to HOLD; but not for a town about to dip, which it would reach late)
        if (n < Math.min(load, c.room, Math.max(1, Math.floor(yard / 2))) && !c.urgent) {
          hold[p] ??= this.h.time;
          if (this.h.time - hold[p]! < HOLD) break;
        }
        const r = this.send(b, c.b, p, n, cls);
        this.expect(c.b.id, p, n, this.h.time, r.eta);
        delete hold[p];
        // (the fair share between works' sites and towns short of it, counted while both want it)
        if (c.shared) {
          const sp = ((P.split ??= {})[p] ??= { site: 0, town: 0 });
          if (c.site) sp.site += n; else if (c.need) sp.town += n;
          // (only the recent run counts: an old lead isn't paid back in one go)
          if (sp.site + sp.town > 24) { sp.site /= 2; sp.town /= 2; }
        } else if (P.split?.[p] && !all.some((x) => x.shared)) delete P.split[p];
        src[p]! -= n;
        free--;
        gate++;
        by[cls] = (by[cls] ?? 0) + 1;
        busy.set(b.id, (busy.get(b.id) ?? 0) + 1);
        let m = coming.get(c.b.id);
        if (!m) coming.set(c.b.id, (m = new Map()));
        m.set(p, (m.get(p) ?? 0) + n);
      }
    }
  }

  /**
   * A works whose goods are all spoken for by the loads already on their way to the works that use them, said as
   * those loads (review 2026-11-10: the Smelter read "waiting for coal" beside the Coal Mine's "your plants have all
   * they can store", which read as a contradiction): "3 loads on the way to the Smelter; the next lands in about 2
   * hours". Null when none are on the road (then they are full, and the plain words are right).
   */
  private spokenFor(seg: number, p: Product): string | null {
    let n = 0, next = Infinity;
    const to = new Map<number, number>();
    for (const t of this.h.trips()) {
      const r = t.haul;
      if (!r || r.done || r.big || r.leg !== "out" || r.product !== p) continue;
      const o = this.h.buildings.byId.get(r.dest);
      if (!o?.plant || o.plant.site || !o.access || !this.h.connected(seg, o.access.seg)) continue;
      n += r.n;
      to.set(o.id, (to.get(o.id) ?? 0) + r.n);
      if (r.eta !== undefined) next = Math.min(next, r.eta);
    }
    if (n < 1) return null;
    const ids = [...to.keys()];
    const kinds = new Set(ids.map((id) => this.h.buildings.byId.get(id)!.kind));
    const where = kinds.size === 1 ? `the ${BUILDING_TYPES[[...kinds][0]].name}${ids.length > 1 ? "s" : ""}` : "your plants that use it";
    const h = Number.isFinite(next) ? Math.max(0, next - this.h.time) / HOUR : null;
    const when = h === null ? "" : h > 0.75 ? `. The next lands in ${aboutHours(h)}` : ". The next lands within the hour";
    const k = Math.round(n);
    return `${k === 1 ? "1 load" : `${k} loads`} on the way to ${where}${when}`;
  }

  /**
   * Why a full works' yard is full of p: its trucks can't keep up while somewhere takes it and loads of it are out on
   * the road; the road to its buyers is jammed when every one of them is; else why nowhere takes it (noBuyer, in the
   * words its trucks use). Never "can't keep up" beside a fleet that stands parked (review, v0.0.105).
   */
  private fullWhy(b: Building, p: Product, coming: Map<number, Map<Product, number>>): string {
    const cs = this.customers(b, p, coming);
    if (cs.length && cs.every((c) => this.choked(c.b))) return "the road to its buyers is jammed";
    let hauling = false;
    for (const t of this.h.trips()) if (t.haul && !t.haul.done && !t.haul.big && t.haul.leg === "out" && t.haul.plant === b.id && t.haul.product === p) { hauling = true; break; }
    if (cs.length || (hauling && this.takersOn(b, p).length)) return "its trucks can't keep up";
    return decap(this.noBuyer(b, p));
  }

  /** The works of the company's on `from`'s roads, built and open, that take p in, whether or not they have room now. */
  takersOn(from: Building, p: Product): Building[] {
    const seg = from.access?.seg;
    if (seg === undefined) return [];
    return this.h.buildings.list.filter((o) => o.plant && !o.plant.site && o.built >= 1 && o.id !== from.id && o.access && this.h.connected(seg, o.access.seg)
      && (takesIn(o.kind as PlantKind, p) || Industry.wantsSupply(o).includes(p)));
  }

  /** Why a load has nowhere to go: no town on its roads uses it, or they all have enough for today. */
  private noBuyer(from: Building, p: Product): string {
    const name = PRODUCTS[p].name.toLowerCase();
    const seg = from.access?.seg;
    if (seg !== undefined) {
      let site = false;
      for (const o of this.h.buildings.list) {
        if (!o.plant || !o.access || !this.h.connected(seg, o.access.seg)) continue;
        if (!takesIn(o.kind as PlantKind, p) && !(o.plant.site ? false : Industry.wantsSupply(o).includes(p))) continue;
        // (one still going up is a building site too: it takes nothing till it opens)
        if (!o.plant.site && o.built >= 1) return this.spokenFor(seg, p) ?? `Your plants that use ${name} have all they can store, with the loads on their way`;
        site = true;
      }
      if (site) return `The plants that will use ${name} are still building sites`;
    }
    // (construction parts: towns build with them once they put up blocks, from Town size)
    if (p === "parts") return `No town on your roads is putting up a block: towns build with ${name} from Town size`;
    // (a City's needs: no town on its roads uses them yet)
    const towns = this.buyersOf(from, p).length > 0;
    if ((p === "electronics" || p === "machinery") && seg !== undefined && !towns) return `No town on your roads uses ${name} yet: towns want it from City size`;
    if (PRODUCTS[p].price > 0 && towns) return `Towns on your roads have all the ${name} they take for now`;
    if (!this.used(p) && PRODUCTS[p].price <= 0) return `Nothing uses ${name} until tier ${Industry.laterTier(p)}: it stays in the yard`;
    if (Industry.isSupply(p)) return `No ${Industry.takersShort(p)} on your roads needs ${name} yet: sites take it from level 3`;
    if (PRODUCTS[p].price <= 0) return `No ${Industry.takersShort(p)} on your roads takes ${name}`;
    return `Nobody your roads reach buys ${name}`;
  }

  /**
   * The shops on a works' roads whose towns buy p at all (TownSystem.want finite), one per town: its buyers, whether
   * or not they want more today. A town that has all it takes for now (settlements.ts roomFor) is one of them: a full
   * buyer, never "no buyer" (v0.0.105).
   */
  buyersOf(from: Building, p: Product): Building[] {
    const seg = from.access?.seg;
    if (seg === undefined || PRODUCTS[p].price <= 0) return [];
    const seen = new Set<number>(), out: Building[] = [];
    for (const o of this.h.shops) {
      if (!o.access || !this.h.connected(seg, o.access.seg)) continue;
      const t = this.h.townOf(o);
      // (a shop still going up, or abandoned, takes nothing: customers() skips it too)
      if (o.built < 1 || o.abandoned || t === null || seen.has(t) || !Number.isFinite(this.h.want(t, p))) continue;
      seen.add(t);
      out.push(o);
    }
    return out;
  }

  /** Has a works its towns' fill of p for now: they buy it, and nothing on its roads would take another load today? */
  stocked(from: Building, p: Product): boolean {
    return this.buyersOf(from, p).length > 0 && !this.customers(from, p, new Map()).length;
  }

  private send(from: Building, to: Building, product: Product, n: number, cls: TruckClass = this.fleetClass()): HaulRun {
    const fuel = this.fuelFor(from, to, classOf(cls).fuel);
    this.h.spend(fuel, "fuel");
    from.plant!.now.spent += fuel;
    from.plant!.now.sent += n;
    if (product === PLANTS[from.kind as PlantKind]?.byproduct) this.h.shipped?.(from, to, product, n);
    const haul: HaulRun = { plant: from.id, leg: "out", product, n, dest: to.id, ...(cls !== "light" ? { cls } : {}), eta: this.h.time + this.tripTo(from, to, cls) };
    this.h.request({
      from: from.access!, fromSide: from.side, to: to.access!, toSide: to.side, truck: true, tries: 0, wait: 0, ...Industry.body(cls),
      trip: { kind: "cargo", from: from.id, to: to.id, resident: -1, cargo: product, startT: this.h.time, freeFlow: 0, haul },
    });
    return haul;
  }

  /** How a class of truck drives (length, pace, the pieces it is drawn in), for the traffic sim. */
  static body(cls: TruckClass | undefined): Pick<PendingSpawn, "len" | "vf" | "af" | "units"> {
    if (!cls || cls === "light") return {};
    const C = classOf(cls);
    return { len: C.len, vf: C.speed, af: C.accel, ...(C.units ? { units: C.units } : {}) };
  }

  /**
   * The fuel for a round trip from `from` to `to`, paid as the truck sets off: at the market price, or at cost when
   * a stocked depot of the company's is on the way (within DEPOT_REACH of the straight run, on the same roads).
   */
  private fuelFor(from: Building, to: Building, mult: number): number {
    const km = Math.hypot(to.c.x - from.c.x, to.c.y - from.c.y) / 1000;
    const market = km * 2 * FUEL_PER_KM * mult;
    const need = (km * 2 * mult) / DEPOT_KM;
    const d = need > 0 ? this.depotFor(from, to, need) : null;
    if (!d) return market;
    const paid = km * 2 * FUEL_AT_COST * mult;
    const P = d.plant!;
    P.stock.fuel = Math.max(0, (P.stock.fuel ?? 0) - need);
    P.served = (P.served ?? 0) + 1;
    P.saved = (P.saved ?? 0) + market - paid;
    P.now.served = (P.now.served ?? 0) + 1;
    P.now.saved = (P.now.saved ?? 0) + market - paid;
    return paid;
  }

  /** The stocked depot nearest a truck's run from `from` to `to` that can fill it (`need` loads of fuel), if any. */
  depotFor(from: Building, to: Building, need: number): Building | null {
    const seg = from.access?.seg;
    if (seg === undefined) return null;
    let best: Building | null = null, bd = DEPOT_REACH;
    for (const o of this.h.buildings.list) {
      if (!o.plant || PLANTS[o.kind as PlantKind]?.logistics !== "depot" || !Industry.running(o) || !o.access) continue;
      if ((o.plant.stock.fuel ?? 0) < need || !this.h.connected(seg, o.access.seg)) continue;
      const d = segDist(o.c, from.c, to.c);
      if (d <= bd) { bd = d; best = o; }
    }
    return best;
  }

  /** A company truck arrived: unload and head home, or it is home. */
  onArrive(v: Vehicle) {
    const r = v.trip.haul!;
    if (r.done) return;
    r.done = true;
    if (r.leg === "back") return;
    const to = this.h.buildings.byId.get(r.dest);
    const home = this.h.buildings.byId.get(r.plant);
    // (how long the run to a town took, out of the yard and through whatever traffic: the next one is sent ahead on it)
    const town = to && !to.plant ? this.h.townOf(to) : null;
    if (town !== null) {
      const k = `${r.plant}>${town}`, took = this.h.time - v.trip.startT, was = this.tripTime.get(k);
      this.tripTime.set(k, was === undefined ? took : was * 0.6 + took * 0.4);
    }
    // (a perishable load is worth what is left of it after its time on the road, from setting off: see freshness)
    if (to) this.deliver(to, r.product, r.n, home, this.h.time - v.trip.startT);
    // (the buyer was pulled down while the truck was on its way: the load goes back to the yard, to be sold elsewhere)
    else if (home?.plant) {
      const back = Industry.logisticsOf(home) === "warehouse" ? home.plant.stock : home.plant.out;
      back[r.product] = (back[r.product] ?? 0) + r.n;
    }
    if (to?.access && home?.access) {
      this.h.request({
        from: to.access, fromSide: to.side, to: home.access, toSide: home.side, truck: true, tries: 0, wait: 0, ...Industry.body(r.cls),
        trip: { kind: "empty", from: to.id, to: home.id, resident: -1, startT: this.h.time, freeFlow: 0, haul: { plant: home.id, leg: "back", product: r.product, n: 0, dest: to.id, ...(r.cls ? { cls: r.cls } : {}) } },
      });
    }
  }

  /** A truck gave up or lost its road: its load goes back to the yard, and the truck with it. */
  onFail(trip: Trip) {
    const r = trip.haul!;
    if (r.done) return;
    r.done = true;
    const home = this.h.buildings.byId.get(r.plant);
    // (a warehouse's loads go back into store, where it ships from)
    if (r.leg === "out" && home?.plant) { const s = Industry.logisticsOf(home) === "warehouse" ? home.plant.stock : home.plant.out; s[r.product] = (s[r.product] ?? 0) + r.n; }
  }

  /**
   * Hand a load over: a building site takes its materials (and starts going up once it has them all), a plant
   * stocks it, a shop pays for it and its town counts it toward its need. A perishable load `age` sim seconds on the
   * road arrives part spoiled: a plant stocks only what is still good, a shop pays only for that, and the sender's
   * books count the loss.
   */
  deliver(to: Building, product: Product, n: number, from?: Building, age = 0) {
    const fresh = freshness(product, age), lost = perishable(product) ? PRODUCTS[product].price * n * (1 - fresh) : 0;
    if (perishable(product) && from?.plant) {
      const P = from.plant;
      P.now.perish = (P.now.perish ?? 0) + n;
      P.perish = (P.perish ?? 0) + n;
      if (fresh >= 0.999) { P.now.fresh = (P.now.fresh ?? 0) + n; P.fresh = (P.fresh ?? 0) + n; }
      if (lost > 0) P.now.spoiled = (P.now.spoiled ?? 0) + lost;
    }
    if (to.plant && !to.plant.site && fresh < 1) {
      // (what spoiled on the way is thrown out at the gate)
      to.plant.stock[product] = (to.plant.stock[product] ?? 0) + n * fresh;
      this.h.delivered?.({ to, from, product, n, pay: 0, fresh, lost });
      return;
    }
    if (to.plant) {
      const s = to.plant.site;
      if (s) {
        // (dispatch never sends more than is left; should two trucks still race, the spare load is left on the ground)
        const take = Math.min(n, Math.max(0, Industry.siteLeft(to, product)));
        s.got[product] = (s.got[product] ?? 0) + take;
        s.hour = (s.hour ?? 0) + take;
        Industry.finishSite(to);
        return;
      }
      // (a load for a works' site that another plant's truck finished first: the works has no use for it, so it goes
      // back to its own yard, as when a buyer is pulled down, rather than clog the works' store)
      const kind = to.kind as PlantKind;
      if (!PLANTS[kind].logistics && !takesIn(kind, product) && !suppliedWith(kind, product)) {
        if (from?.plant) { const back = Industry.logisticsOf(from) === "warehouse" ? from.plant.stock : from.plant.out; back[product] = (back[product] ?? 0) + n; }
        return;
      }
      to.plant.stock[product] = (to.plant.stock[product] ?? 0) + n;
      if (perishable(product)) this.h.delivered?.({ to, from, product, n, pay: 0, fresh, lost });
      return;
    }
    // a town's building site: it takes what it still waits for (the town pays for it) and goes up once it has all
    if (to.site) {
      n = Math.min(n, Math.max(0, Industry.siteLeft(to, product)));
      to.site.got[product] = (to.site.got[product] ?? 0) + n;
      if (entries(to.site.need).every(([p, k]) => (to.site!.got[p] ?? 0) >= k)) delete to.site;
      if (n <= 0) return;
    }
    const pay = PRODUCTS[product].price * n * fresh;
    // (the shelves hold food; other products go on to the town's builders and homes)
    if (product === "food") to.stock = Math.min(6, to.stock + 3 * n);
    const t = this.h.townOf(to);
    if (t !== null) this.h.sold(t, product, n);
    this.h.earn(pay);
    if (from?.plant) from.plant.now.earned += pay;
    this.h.delivered?.({ to, from, product, n, pay, fresh, lost });
  }

  /**
   * A plant's building site with every material in (and, a landmark's, every oversized piece) starts going up.
   * True when it did.
   */
  static finishSite(b: Building): boolean {
    const P = b.plant, s = P?.site;
    if (!P || !s) return false;
    if (!entries(s.need).every(([p, k]) => (s.got[p] ?? 0) >= k)) return false;
    const pieces = PLANTS[b.kind as PlantKind]?.pieces?.n ?? 0;
    if ((P.landmark?.pieces ?? 0) < pieces) return false;
    delete P.site;
    b.built = 0;
    return true;
  }

  /**
   * How a works' building site is doing: loads landed of those its bill asks for, the rate they have been landing at
   * (over the last game hours, up to SITE_HOURS; the hour under way counts once it beats that), and the game hours the
   * rest would take at that rate. Null when it is not a site. The one source of these figures: the interface puts
   * them into words (src/ui/bottleneck.ts siteStatus), it keeps no count of its own.
   */
  static siteEta(b: Building): SiteEta | null {
    const s = b.plant?.site;
    if (!s) return null;
    let got = 0, need = 0;
    for (const [p, n] of entries(s.need)) { need += n; got += Math.min(n, s.got[p] ?? 0); }
    const hs = s.hours ?? [];
    const past = hs.length ? hs.reduce((a, v) => a + v, 0) / hs.length : 0;
    // (the first loads of a site that has no full hour behind it yet: the hour under way stands in)
    const perHour = Math.max(past, hs.length ? (hs.reduce((a, v) => a + v, 0) + (s.hour ?? 0)) / (hs.length + 1) : s.hour ?? 0);
    const left = need - got;
    return { got, need, perHour, hours: left <= 0 ? 0 : perHour > 0 ? left / perHour : null };
  }

  /** Wages and upkeep, and the hour's books (a building site costs nothing to keep). */
  hourly() {
    for (const b of this.plants()) {
      const P = b.plant!;
      if (P.site) {
        // (its deliveries, hour by hour, from the first load on: an empty site has no rate to speak of)
        const s = P.site;
        if (s.hours || s.hour) { (s.hours ??= []).push(s.hour ?? 0); if (s.hours.length > SITE_HOURS) s.hours.splice(0, s.hours.length - SITE_HOURS); }
        s.hour = 0;
      }
      if (!P.site) {
        const wages = this.h.workersAt(b.id) * WAGE, up = PLANTS[b.kind as PlantKind].upkeep * levelMult(P.level);
        this.h.spend(wages, "wages");
        this.h.spend(up, "upkeep");
        P.now.spent += wages + up;
      }
      const h = (P.hist ??= []);
      h.push(P.now.by ?? {});
      if (h.length > HIST_HOURS) h.splice(0, h.length - HIST_HOURS);
      P.last = P.now;
      P.now = books();
    }
  }
}

function entries(o: Partial<Record<Product, number>>): [Product, number][] {
  return Object.entries(o) as [Product, number][];
}

/** "a", "a and b", "a, b and c". */
/** A sentence as the second half of a line: "Towns on your roads..." → "towns on your roads...". */
const decap = (x: string) => x[0].toLowerCase() + x.slice(1);

function listText(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "";
}

/** Distance from p to the segment a-b. */
function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
