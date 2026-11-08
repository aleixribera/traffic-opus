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
import { GROW_DECAY, GROW_NEED, SITE_LEVELS, levelMult } from "./sites";
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

export const PLANTS: Record<PlantKind, PlantDef> = {
  farm: {
    kind: "farm", tier: 1, deposit: { field: F.fert, name: "fertile soil" }, inputs: {}, outputs: { crops: 1 },
    cycle: HOUR * 1.5, cost: 8000, upkeep: 12, trucks: 2, store: 8, supplies: { fertilizer: 3 },
    blurb: "Grows crops on fertile soil. Its trucks take them to your food plants.",
  },
  loggingcamp: {
    kind: "loggingcamp", tier: 1, deposit: { field: F.forest, name: "forest" }, inputs: {}, outputs: { logs: 1 },
    cycle: HOUR * 1.5, cost: 7000, upkeep: 10, trucks: 2, store: 8,
    blurb: "Fells timber in the forest. Its trucks take the logs to your sawmills.",
  },
  foodplant: {
    kind: "foodplant", tier: 1, inputs: { crops: 1 }, outputs: { food: 1 },
    cycle: HOUR, cost: 15000, upkeep: 25, trucks: 2, store: 8,
    blurb: "Turns crops into food. Its trucks sell the food to the towns' shops.",
  },
  sawmill: {
    kind: "sawmill", tier: 1, inputs: { logs: 1 }, outputs: { planks: 1, chips: 1 }, byproduct: "chips",
    cycle: HOUR, cost: 14000, upkeep: 22, trucks: 2, store: 8,
    blurb: "Saws logs into planks. Its trucks sell the planks to the towns and take them to your building sites; the wood chips go to your power plants, which burn them in place of coal.",
  },
  ironmine: {
    kind: "ironmine", tier: 2, deposit: { field: F.ore, name: "iron ore" }, inputs: {}, outputs: { ore: 1 },
    cycle: HOUR * 1.5, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 6 }, supplies: { explosives: 3 },
    blurb: "Digs iron ore. Its trucks take it to your smelters.",
  },
  coalmine: {
    kind: "coalmine", tier: 2, deposit: { field: F.coal, name: "coal" }, inputs: {}, outputs: { coal: 1 },
    cycle: HOUR * 1.2, cost: 24000, upkeep: 30, trucks: 4, store: 8, power: 6, site: { planks: 6 }, supplies: { explosives: 3 },
    blurb: "Digs coal for your smelters, cement works and power plants.",
  },
  quarry: {
    kind: "quarry", tier: 2, deposit: { field: F.lime, name: "limestone" }, inputs: {}, outputs: { lime: 1 },
    cycle: HOUR * 1.5, cost: 20000, upkeep: 26, trucks: 4, store: 8, power: 6, site: { planks: 6 }, supplies: { explosives: 3 },
    blurb: "Quarries limestone. Its trucks take it to your cement works.",
  },
  smelter: {
    kind: "smelter", tier: 2, inputs: { ore: 1, coal: 1 }, outputs: { steel: 1, slag: 1 }, byproduct: "slag",
    cycle: HOUR * 1.5, cost: 45000, upkeep: 50, trucks: 2, store: 8, power: 14, site: { planks: 10 },
    blurb: "Smelts iron ore with coal into steel, for the construction plants to come. Its slag goes to your cement works, which grind it in place of limestone.",
  },
  cementworks: {
    kind: "cementworks", tier: 2, inputs: { lime: 1, coal: 1 }, alt: { lime: "slag" }, outputs: { cement: 1 },
    cycle: HOUR, cost: 40000, upkeep: 45, trucks: 3, store: 8, power: 10, site: { planks: 10 },
    blurb: "Burns limestone (or the smelters' slag in its place) with coal into cement. Its trucks sell it to villages that are building in concrete.",
  },
  coalplant: {
    kind: "coalplant", tier: 2, inputs: { coal: 1 }, alt: { coal: "chips" }, outputs: {},
    cycle: HOUR * 3, cost: 32000, upkeep: 35, trucks: 0, store: 8, makes: 40, reach: 4000, site: { planks: 8 },
    blurb: "Burns coal (or the sawmills' wood chips) for power. It powers your tier 2 buildings on its roads within 4 km; without power they work at 40%.",
  },
  // tier 3: the building sites wait for planks and cement
  oilwell: {
    kind: "oilwell", tier: 3, deposit: { field: F.oil, name: "oil" }, inputs: {}, outputs: { crude: 1 },
    cycle: HOUR * 1.2, cost: 28000, upkeep: 30, trucks: 4, store: 8, site: { planks: 6, cement: 4 }, supplies: { explosives: 3 },
    blurb: "Pumps crude oil. Its tankers take it to your refineries.",
  },
  sandpit: {
    kind: "sandpit", tier: 3, deposit: { field: F.sand, name: "sand" }, inputs: {}, outputs: { sand: 1 },
    cycle: HOUR * 1.2, cost: 22000, upkeep: 24, trucks: 4, store: 8, site: { planks: 6, cement: 4 }, supplies: { explosives: 3 },
    blurb: "Digs sand by the water. Its tippers take it to your glassworks.",
  },
  refinery: {
    kind: "refinery", tier: 3, inputs: { crude: 1 }, outputs: { fuel: 1, plastics: 1 },
    cycle: HOUR, cost: 60000, upkeep: 60, trucks: 4, store: 8, power: 16, site: { planks: 12, cement: 10 },
    blurb: "Splits crude oil into fuel and plastics. Its tankers sell the fuel to the towns' filling stations.",
  },
  glassworks: {
    kind: "glassworks", tier: 3, inputs: { sand: 1, coal: 1 }, outputs: { glass: 1 },
    cycle: HOUR, cost: 48000, upkeep: 50, trucks: 3, store: 8, power: 12, site: { planks: 10, cement: 8 },
    blurb: "Melts sand with coal into glass for your furniture factories.",
  },
  furniture: {
    kind: "furniture", tier: 3, inputs: { planks: 1, glass: 1 }, outputs: { goods: 1 },
    cycle: HOUR, cost: 42000, upkeep: 45, trucks: 3, store: 8, site: { planks: 10, cement: 6 },
    blurb: "Builds furniture and fittings from planks and glass: household goods for the towns' shops.",
  },
  constructionplant: {
    kind: "constructionplant", tier: 3, inputs: { steel: 1, cement: 1 }, outputs: { parts: 1 },
    cycle: HOUR, cost: 52000, upkeep: 55, trucks: 3, store: 8, power: 14, site: { planks: 10, cement: 10 },
    blurb: "Casts steel and cement into construction parts: towns put up their blocks and towers from them.",
  },
  // tier 4: the building sites wait for construction parts as well as planks and cement
  coppermine: {
    kind: "coppermine", tier: 4, deposit: { field: F.copper, name: "copper ore" }, inputs: {}, outputs: { copperore: 1 },
    cycle: HOUR * 1.2, cost: 34000, upkeep: 34, trucks: 4, store: 8, site: { planks: 6, cement: 4, parts: 3 }, supplies: { explosives: 3 },
    blurb: "Digs copper ore in the high ranges. Its tippers take it to your copper smelters.",
  },
  coppersmelter: {
    kind: "coppersmelter", tier: 4, inputs: { copperore: 1, coal: 1 }, outputs: { copper: 1 },
    cycle: HOUR * 1.2, cost: 62000, upkeep: 60, trucks: 3, store: 8, power: 16, site: { planks: 10, cement: 8, parts: 6 },
    blurb: "Smelts copper ore with coal into copper, for your electronics plants and machine works.",
  },
  electronics: {
    kind: "electronics", tier: 4, inputs: { copper: 1, plastics: 1 }, outputs: { electronics: 1 },
    cycle: HOUR, cost: 70000, upkeep: 62, trucks: 3, store: 8, power: 12, site: { planks: 10, cement: 8, parts: 6 },
    blurb: "Builds electronics from copper and plastics. Its trucks sell them to the shops of your cities.",
  },
  machineworks: {
    kind: "machineworks", tier: 4, inputs: { steel: 1, copper: 1 }, outputs: { machinery: 1 },
    cycle: HOUR * 1.2, cost: 72000, upkeep: 64, trucks: 3, store: 8, power: 14, site: { planks: 12, cement: 10, parts: 8 },
    blurb: "Builds machinery from steel and copper. Its flatbeds take it to the offices and towers of your cities.",
  },
  // supplies (docs/design.md "Supplies"): limestone burnt with coal makes lime-nitrogen fertilizer for the farms and,
  // from the coal tar, explosives for the mines, quarries, pits and wells, which need them to grow past level 2
  chemworks: {
    kind: "chemworks", tier: 3, inputs: { lime: 1, coal: 1 }, outputs: { fertilizer: 1, explosives: 1 },
    cycle: HOUR, cost: 50000, upkeep: 50, trucks: 3, store: 8, power: 12, site: { planks: 10, cement: 8 },
    blurb: "Burns limestone with coal into fertilizer and explosives. Your farms need fertilizer, and your mines, quarries, pits and wells explosives, to grow past level 2 and keep up their pace.",
  },
  // perishables (docs/design.md "Perishables"): milk from a herd on fertile soil, in refrigerated trucks; the
  // creamery's cheese keeps about three times as long
  dairyfarm: {
    kind: "dairyfarm", tier: 2, deposit: { field: F.fert, name: "fertile soil" }, inputs: {}, outputs: { milk: 1 },
    cycle: HOUR * 1.2, cost: 16000, upkeep: 16, trucks: 2, store: 6, site: { planks: 4 }, supplies: { fertilizer: 3 },
    blurb: "Milks a herd on fertile pasture. Its refrigerated trucks sell the milk to villages and towns, or take it to your creameries; it spoils if the trip runs long.",
  },
  creamery: {
    kind: "creamery", tier: 2, inputs: { milk: 1 }, outputs: { cheese: 1 },
    cycle: HOUR, cost: 30000, upkeep: 32, trucks: 2, store: 8, power: 8, site: { planks: 8 },
    blurb: "Turns milk into cheese, which keeps about three times as long: its refrigerated trucks sell it further afield.",
  },
  // tier 5 (docs/design.md "Motor Works"): the refinery's plastics with coal make rubber; steel, glass, rubber and
  // electronics make cars, and every car a town buys puts more of its people on the road
  rubberplant: {
    kind: "rubberplant", tier: 5, inputs: { plastics: 1, coal: 1 }, outputs: { rubber: 1 },
    cycle: HOUR, cost: 68000, upkeep: 58, trucks: 3, store: 8, power: 14, site: { planks: 10, cement: 8, parts: 6 },
    blurb: "Makes synthetic rubber from the refinery's plastics with coal, for your Motor Works' tyres.",
  },
  motorworks: {
    kind: "motorworks", tier: 5, inputs: { steel: 1, glass: 1, rubber: 1, electronics: 1 }, outputs: { cars: 1 },
    cycle: HOUR * 1.2, cost: 120000, upkeep: 90, trucks: 3, store: 8, power: 20, site: { planks: 12, cement: 12, parts: 10 },
    blurb: "Builds motor cars from steel, glass, rubber and electronics, and stops when any of the four runs out. Towns buy the cars, and every one sold puts more traffic on their roads.",
  },
  // logistics (docs/design.md "Freight"): a warehouse buffers any product and its own trucks carry it on; a fuel
  // depot takes fuel from the refineries and fills the company's trucks that pass it at cost
  warehouse: {
    kind: "warehouse", tier: 2, inputs: {}, outputs: {}, logistics: "warehouse",
    cycle: HOUR, cost: 18000, upkeep: 18, trucks: 12, store: 60, site: { planks: 6 },
    blurb: "Stores any product your buildings send it and re-ships it with its own trucks: it takes the overflow, or splits a long haul into two legs as a feeder.",
  },
  fueldepot: {
    kind: "fueldepot", tier: 3, inputs: { fuel: 1 }, outputs: {}, logistics: "depot",
    cycle: HOUR, cost: 14000, upkeep: 10, trucks: 0, store: 8, site: { planks: 4, cement: 2 },
    blurb: "Takes fuel from your refineries. Your trucks whose run passes within 1.5 km fill up here at cost instead of paying the market price.",
  },
  // landmarks (docs/design.md "Landmarks"): defined with the rest of the megaprojects
  ...MEGA_PLANTS,
};

export const PLANT_KINDS = Object.keys(PLANTS) as PlantKind[];
export const isPlantKind = (k: BuildingKind | string): k is PlantKind => k in PLANTS;
/** What each worker is paid per hour. */
export const WAGE = 1;
/** Least share of an extractor's lot that must sit on its deposit. */
export const MIN_DEPOSIT = 0.35;
/** Fuel and wear per km a light truck drives (both ways), charged when it sets off. */
export const FUEL_PER_KM = 4;
/**
 * The haul a site's fleet is sized for (m, one way): at every level it has the trucks to carry its whole output,
 * fully staffed, this far over streets, with the smallest truck and load. Nothing to buy: the fleet grows with the
 * site, and bigger loads and truck classes stretch the same fleet over longer hauls. Idle trucks wait in the yard,
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
/** Time to put a building up once its site has every material (and a tier 1 building, from the start). */
export const BUILD_TIME = HOUR * 1.5;
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
  site?: { need: Partial<Record<Product, number>>; got: Partial<Record<Product, number>> };
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
  /** loads a town still needs today to grow (its shops buy more than that; this part comes first), 0 if none */
  short?(town: number, p: Product): number;
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
  earn(v: number): void;
  spend(v: number, what: "wages" | "upkeep" | "fuel"): void;
  /** truck bays every building has gained from milestones, on top of its own trucks */
  bays?(): number;
  /** loads one truck carries */
  load?(): number;
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

export interface Customer { b: Building; value: number; /** loads it can take */ room: number }

export class Industry {
  constructor(private h: IndustryHost) {}

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

  /** Trucks a plant runs: its site level's fleet (Industry.fleetAt) and the bays milestones added (a power plant has none). */
  trucksOf(b: Building): number {
    const P = b.plant!;
    const n = Industry.fleetAt(b.kind as PlantKind, P.level, P.yld);
    return n > 0 ? n + (this.h.bays?.() ?? 0) : 0;
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

  /** Loads a truck of a class carries (the best unlocked when not given): its payload times the company's load per truck. */
  capOf(_b?: Building, cls: TruckClass = this.fleetClass()): number {
    return classOf(cls).payload * Math.max(1, this.h.load?.() ?? 1);
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

  /** Trucks out per plant (in all and by class), and loads on their way to each customer (counted fresh each tick). */
  private census() {
    const busy = new Map<number, number>(), busyBy = new Map<number, Partial<FleetMix>>(), coming = new Map<number, Map<Product, number>>();
    for (const t of this.h.trips()) {
      const r = t.haul;
      // (a convoy with an oversized piece is not one of its works' trucks: convoys.ts keeps its own count)
      if (!r || r.done || r.big) continue;
      busy.set(r.plant, (busy.get(r.plant) ?? 0) + 1);
      let by = busyBy.get(r.plant);
      if (!by) busyBy.set(r.plant, (by = {}));
      const c = r.cls ?? "light";
      by[c] = (by[c] ?? 0) + 1;
      if (r.leg !== "out") continue;
      let m = coming.get(r.dest);
      if (!m) coming.set(r.dest, (m = new Map()));
      m.set(r.product, (m.get(r.product) ?? 0) + r.n);
    }
    return { busy, busyBy, coming };
  }

  tick(span: number) {
    const { busy, busyBy, coming } = this.census();
    for (const b of this.plants()) {
      this.produce(b, span, busy.get(b.id) ?? 0);
      this.dispatch(b, busy, busyBy, coming);
    }
  }

  /**
   * Work through the current batch: staff, deposit, power and inputs on hand set the pace; a full store stops it.
   * A power plant's batch is the coal it burns, and it burns only while something within reach wants power.
   */
  produce(b: Building, span: number, out = 0) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.site) {
      const left = entries(P.site.need).map(([p, n]) => [p, n - (P.site!.got[p] ?? 0)] as [Product, number]).filter(([, n]) => n > 0);
      const parts = left.map(([p, n]) => `${n} load${n === 1 ? "" : "s"} of ${PRODUCTS[p].name.toLowerCase()}`);
      const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts[parts.length - 1]}` : parts[0];
      b.problem = left.length ? `Building site: waiting for ${list}` : null;
      return;
    }
    if (b.built < 1) { b.problem = null; return; }
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
      : f ? (PRODUCTS[f].price > 0 ? `Full of ${fname}: its trucks can't keep up (a long or jammed haul), or nobody to sell to`
        : Industry.isSupply(f) && !this.wants(f) ? `Full of ${fname}: it goes to sites growing past level 2 (${Industry.takers(f)})`
        : this.used(f) ? `Full of ${fname}: its trucks can't keep up (a long or jammed haul), or no ${Industry.takers(f)} on its roads`
        : `Full of ${fname}: nothing uses it until tier ${Industry.laterTier(f)}`)
      : staff <= 0 ? "No workers"
      : s ? `Waiting for ${sname}`
      : idle ? "Idle: no building within reach needs power"
      : staff < 0.5 ? "Not enough workers"
      : pw <= 0 ? `No power: working at ${Math.round(UNPOWERED * 100)}%`
      : pw < 0.999 ? `Short of power: working at ${Math.round(powerPace(pw) * 100)}%`
      : lack.length ? `Out of ${listText(lack.map((p) => PRODUCTS[p].name.toLowerCase()))}: working at its level ${pace} pace`
      : null;
    this.growth(b, span, working, staff, pw, store);
  }

  /**
   * A site grows a level after working near capacity for most of a few days: fully staffed (near enough), powered,
   * its inputs coming in and its output shipped. Idle time takes some of the progress back; it never shrinks.
   */
  private growth(b: Building, span: number, working: boolean, staff: number, pw: number, store: number) {
    const P = b.plant!, d = PLANTS[b.kind as PlantKind];
    if (P.level >= SITE_LEVELS) { P.why = null; P.grow = 0; return; }
    // (only the main product counts: the refinery flares the plastics it can't ship and grows on its fuel)
    const main = entries(d.outputs)[0]?.[0];
    const piled = !!main && (P.out[main] ?? 0) > store * 0.75;
    // (growing a level needs the supplies of the level it grows to in its store: fertilizer before a farm's level 3)
    const lack = this.lacking(b, P.level + 1);
    const why = !b.access ? "No road to the gate"
      : !working ? (b.problem ?? "Not working")
      : staff < 0.8 ? "Needs more workers"
      : d.power && pw < 0.9 ? "Short of power"
      : piled ? "Output piling up: a long or jammed haul, or no buyers"
      : lack.length ? (b.problem?.startsWith("Out of ") ? b.problem : `Needs ${listText(lack.map((p) => PRODUCTS[p].name.toLowerCase()))} to grow to level ${P.level + 1}`)
      : null;
    P.why = why;
    P.grow = why ? Math.max(0, P.grow - span * GROW_DECAY) : P.grow + span;
    if (P.grow >= GROW_NEED) this.levelUp(b);
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
        const room = Industry.siteLeft(o, product) - on(o.id);
        if (room >= 1) out.push({ b: o, value: PLANTS[o.kind as PlantKind].mega ? megaValue(price, km(o)) : 20000 + room * 100 - km(o) * FUEL_PER_KM * 2, room });
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
      for (const o of shops) {
        if (!o.access || o.abandoned || o.built < 1 || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        const l = t === null ? 0 : left.get(t)!;
        if (l < 1) continue;
        // a town still short of what it needs to grow comes first (within ~50 km of extra driving), then nearest
        // first; a town further short, and a shop with emptier shelves, a little ahead
        const short = t === null ? 0 : (shortLeft.get(t) ?? 0);
        out.push({ b: o, value: price - km(o) * FUEL_PER_KM * 2 + (short >= 1 ? 400 : 0) + Math.min(3, l) * 15 - (product === "food" ? o.stock * 15 : 0), room: Math.ceil(l) });
      }
    }
    out.sort((a, b) => b.value - a.value);
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
      while (free > 0 && (src[p] ?? 0) >= 1) {
        const c = this.customers(b, p, coming)[0];
        if (!c) {
          if (!store && !side && (src[p] ?? 0) >= 2 && b.access && !b.problem?.startsWith("Full of")) b.problem = this.noBuyer(b, p);
          break;
        }
        const cls = Industry.nextClass(mix, by);
        if (!cls) { free = 0; break; }
        const load = this.capOf(b, cls);
        const n = Math.max(1, Math.min(load, Math.floor(src[p]!), c.room));
        if (n < Math.min(load, c.room, Math.max(1, Math.floor(yard / 2)))) {
          // (not full yet: it waits at the dock, up to HOLD)
          hold[p] ??= this.h.time;
          if (this.h.time - hold[p]! < HOLD) break;
        }
        this.send(b, c.b, p, n, cls);
        delete hold[p];
        src[p]! -= n;
        free--;
        by[cls] = (by[cls] ?? 0) + 1;
        busy.set(b.id, (busy.get(b.id) ?? 0) + 1);
        let m = coming.get(c.b.id);
        if (!m) coming.set(c.b.id, (m = new Map()));
        m.set(p, (m.get(p) ?? 0) + n);
      }
    }
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
        if (!o.plant.site) return `Your plants that use ${name} have all they can store, with the loads on their way`;
        site = true;
      }
      if (site) return `The plants that will use ${name} are still building sites`;
    }
    // (construction parts: towns build with them once they put up blocks, from Town size)
    if (p === "parts") return `No town on your roads is putting up a block: towns build with ${name} from Town size`;
    // (a City's needs: no town on its roads uses them yet)
    if ((p === "electronics" || p === "machinery") && seg !== undefined && !this.h.shops.some((o) => {
      const t = o.access && this.h.connected(seg, o.access.seg) ? this.h.townOf(o) : null;
      return t !== null && Number.isFinite(this.h.want(t, p));
    })) return `No town on your roads uses ${name} yet: towns want it from City size`;
    if (PRODUCTS[p].price > 0 && seg !== undefined) {
      for (const o of this.h.shops) {
        if (!o.access || !this.h.connected(seg, o.access.seg)) continue;
        const t = this.h.townOf(o);
        if (t !== null && Number.isFinite(this.h.want(t, p))) return `Towns on your roads have all the ${name} they need today`;
      }
    }
    if (!this.used(p) && PRODUCTS[p].price <= 0) return `Nothing uses ${name} until tier ${Industry.laterTier(p)}: it stays in the yard`;
    if (Industry.isSupply(p)) return `No ${Industry.takers(p)} on your roads needs ${name} yet: sites take it as they grow past level 2`;
    if (PRODUCTS[p].price <= 0) return `No ${Industry.takers(p)} on your roads takes ${name}`;
    return `Nobody your roads reach buys ${name}`;
  }

  private send(from: Building, to: Building, product: Product, n: number, cls: TruckClass = this.fleetClass()) {
    const fuel = this.fuelFor(from, to, classOf(cls).fuel);
    this.h.spend(fuel, "fuel");
    from.plant!.now.spent += fuel;
    from.plant!.now.sent += n;
    if (product === PLANTS[from.kind as PlantKind]?.byproduct) this.h.shipped?.(from, to, product, n);
    this.h.request({
      from: from.access!, fromSide: from.side, to: to.access!, toSide: to.side, truck: true, tries: 0, wait: 0, ...Industry.body(cls),
      trip: { kind: "cargo", from: from.id, to: to.id, resident: -1, cargo: product, startT: this.h.time, freeFlow: 0, haul: { plant: from.id, leg: "out", product, n, dest: to.id, ...(cls !== "light" ? { cls } : {}) } },
    });
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
        Industry.finishSite(to);
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

  /** Wages and upkeep, and the hour's books (a building site costs nothing to keep). */
  hourly() {
    for (const b of this.plants()) {
      const P = b.plant!;
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
function listText(xs: string[]): string {
  return xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}` : xs[0] ?? "";
}

/** Distance from p to the segment a-b. */
function segDist(p: V2, a: V2, b: V2): number {
  const dx = b.x - a.x, dy = b.y - a.y, L = dx * dx + dy * dy;
  const t = L > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L)) : 0;
  return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t));
}
