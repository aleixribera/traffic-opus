// Tunables in one place. Distances in metres, times in seconds, speeds in m/s.

import { CIVICS, type CivicKind } from "./game/civics";

export const LANE_W = 3.5;
export const SHOULDER = 0.7;
export const LEVEL_H = 6; // height of one elevation level
export const MAX_LEVEL = 3;
export const MAX_GRADE = 0.11; // rise / run on ramps
export const CLEARANCE = 4.6; // vertical clearance needed between crossing roads
export const MIN_SEG_LEN = 7;
export const MIN_ARM_ANGLE = (24 * Math.PI) / 180;
export const NODE_SNAP_PX = 18;
export const ROAD_SNAP_PX = 14;

export type RoadTypeId = "dirt" | "street" | "avenue" | "boulevard" | "streetM" | "avenueM" | "boulevardM" | "one1" | "one2" | "hw1" | "hw2" | "one3" | "one4";

export interface RoadType {
  id: RoadTypeId;
  name: string;
  short: string;
  fwd: number; // lanes in the drawing direction
  bwd: number; // lanes against it (0 = one-way)
  speed: number; // m/s
  costPerM: number;
  minRadius: number;
  allowsAccess: boolean; // buildings can attach driveways
  rank: number; // priority at unsignalled junctions
  hint: string;
  /** Width of a planted median between the two directions (m). Nobody crosses it: driveways are right-in, right-out. */
  median?: number;
  /**
   * Packed earth, not asphalt (the dirt road): no markings, kerbs or pavement, only on the ground (a bridge on it is
   * built as a paved street deck), and heavy trucks take it slower still.
   */
  unpaved?: boolean;
}

const kmh = (k: number) => k / 3.6;

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  // (as wide as a street, so paving it is a change of surface that moves no lot; rank 0: it gives way to every paved road)
  dirt: { id: "dirt", name: "Dirt road", short: "1+1", fwd: 1, bwd: 1, speed: kmh(32), costPerM: 1.5, minRadius: 9, allowsAccess: true, rank: 0, unpaved: true, hint: "Packed earth at a quarter of a street's price, paved later by drawing a Street over it." },
  street: { id: "street", name: "Street", short: "1+1", fwd: 1, bwd: 1, speed: kmh(50), costPerM: 6, minRadius: 9, allowsAccess: true, rank: 1, hint: "The town street that houses and shops face." },
  avenue: { id: "avenue", name: "Avenue", short: "2+2", fwd: 2, bwd: 2, speed: kmh(60), costPerM: 13, minRadius: 14, allowsAccess: true, rank: 2, hint: "Two lanes each way that buildings can still face." },
  boulevard: { id: "boulevard", name: "Boulevard", short: "3+3", fwd: 3, bwd: 3, speed: kmh(70), costPerM: 21, minRadius: 20, allowsAccess: false, rank: 3, hint: "Three lanes each way, too busy for driveways." },
  streetM: { id: "streetM", name: "Divided street", short: "1|1", fwd: 1, bwd: 1, speed: kmh(50), costPerM: 9, minRadius: 10, allowsAccess: true, rank: 1, median: 2.5, hint: "A planted median that stops turns across it, so cars U-turn at junctions." },
  avenueM: { id: "avenueM", name: "Divided avenue", short: "2|2", fwd: 2, bwd: 2, speed: kmh(60), costPerM: 17, minRadius: 16, allowsAccess: true, rank: 2, median: 3.5, hint: "An avenue with a median, where buildings get right in and right out." },
  boulevardM: { id: "boulevardM", name: "Divided boulevard", short: "3|3", fwd: 3, bwd: 3, speed: kmh(70), costPerM: 26, minRadius: 22, allowsAccess: false, rank: 3, median: 5, hint: "A wide median between three lanes each way, for a city's main artery." },
  one1: { id: "one1", name: "One-way", short: "1", fwd: 1, bwd: 0, speed: kmh(50), costPerM: 4, minRadius: 8, allowsAccess: true, rank: 1, hint: "A town street that runs the way you draw it." },
  one2: { id: "one2", name: "One-way 2", short: "2", fwd: 2, bwd: 0, speed: kmh(70), costPerM: 9, minRadius: 16, allowsAccess: true, rank: 2, hint: "Two lanes that run the way you draw them." },
  hw1: { id: "hw1", name: "Highway 1", short: "1", fwd: 1, bwd: 0, speed: kmh(100), costPerM: 8, minRadius: 25, allowsAccess: false, rank: 2, hint: "A ramp on or off a highway, which gets a slip lane beside it." },
  hw2: { id: "hw2", name: "Highway 2", short: "2", fwd: 2, bwd: 0, speed: kmh(120), costPerM: 12, minRadius: 60, allowsAccess: false, rank: 3, hint: "A highway carriageway, built in pairs and linked by ramps." },
  one3: { id: "one3", name: "Highway 3", short: "3", fwd: 3, bwd: 0, speed: kmh(120), costPerM: 15, minRadius: 30, allowsAccess: false, rank: 3, hint: "A three-lane carriageway, built in pairs for a highway." },
  one4: { id: "one4", name: "Highway 4", short: "4", fwd: 4, bwd: 0, speed: kmh(120), costPerM: 21, minRadius: 40, allowsAccess: false, rank: 4, hint: "A four-lane carriageway for the heaviest flows." },
};

/** Motorway carriageways and ramps: one-way and closed to driveways. Drawn in darker asphalt with solid edge lines. */
export const isHighway = (t: RoadType): boolean => t.bwd === 0 && !t.allowsAccess;

/**
 * A company site's gate can open onto it: any road a house can face, and a boulevard too (no driveways for homes, but
 * a site's gate is a proper entrance, turned into from either side like any driveway). Never a motorway.
 */
export const takesGate = (t: RoadType): boolean => t.allowsAccess || t.bwd > 0;

/** No turning across it into or out of a driveway or gate: a median (cars U-turn at the junctions instead). */
export const rightOnly = (t: RoadType): boolean => (t.median ?? 0) > 0;

/** A dirt road: packed earth, no markings, kerbs or pavement, only on the ground. */
export const isUnpaved = (t: RoadType): boolean => !!t.unpaved;
/** What a dirt road becomes where it has to leave the ground (a bridge and its ramps): a plain paved street. */
export const PAVED_DECK: RoadTypeId = "street";

/** The road families of the build menu; each has its own look. */
export type RoadGroup = "small" | "medium" | "large" | "highway";
export function roadGroup(t: RoadType): RoadGroup {
  if (isHighway(t)) return "highway";
  const m = Math.max(t.fwd, t.bwd);
  return m <= 1 ? "small" : m === 2 ? "medium" : "large";
}
/**
 * Pavement along each side of a town road (m). Drawn in the gap buildings already keep from the kerb for their
 * driveways, so it moves no lot or building. Highways have none.
 */
export const SIDEWALK: Record<RoadGroup, number> = { small: 1.5, medium: 1.9, large: 2.2, highway: 0 };
/** Street trees on the pavement: spacing and crown radius (m). */
export const STREET_TREES: Record<RoadGroup, { every: number; r: number } | null> = {
  small: null, medium: { every: 15, r: 2.1 }, large: { every: 12, r: 2.6 }, highway: null,
};

export function roadWidth(t: RoadType): number {
  return (t.fwd + t.bwd) * LANE_W + SHOULDER * 2 + (t.median ?? 0);
}

/**
 * Homes and shops stand this far back from a street's centreline (m), behind a front strip their driveways cross:
 * room for the street to be upgraded to any road that still takes driveways (up to a divided avenue, with its
 * pavement) without touching them. About 11.7 m: a 96 m town block keeps five rows of lots on one side and four on
 * the other (src/game/zones.ts, DEPTH).
 */
export const ZONE_SETBACK = Math.max(
  ...Object.values(ROAD_TYPES).filter((t) => t.allowsAccess).map((t) => roadWidth(t) / 2 + SIDEWALK[roadGroup(t)] + 0.3),
);

export const ELEVATED_COST_MULT = [1, 2.2, 2.8, 3.4];
export const WATER_BRIDGE_MULT = 1.6;
export const BULLDOZE_REFUND = 0.75;
export const ROUNDABOUT_COST = 900;
/** Compensation for each home or shop a new road demolishes, per level of the building (TF2 charges for clearing land). */
export const DEMOLISH_PER_LEVEL = 150;
export const SIGNAL_COST = 300;

// ---------- Buildings ----------

export type BuildingKind =
  | "house" | "terrace" | "apartments" | "modernflats" | "aptower"
  | "highstreet" | "shop" | "store" | "office" | "mall" | "tower" | "glasstower" | "fuelstation"
  // each town's hall at its centre, rebuilt bigger at each size (see game/settlements.ts)
  | "hamlethall" | "villagehall" | "townhall" | "cityhall"
  // placed by the player (see game/placed.ts): the company's extractors and plants, and power
  | "farm" | "loggingcamp" | "foodplant" | "sawmill"
  | "ironmine" | "coalmine" | "quarry" | "smelter" | "cementworks" | "coalplant"
  | "oilwell" | "sandpit" | "refinery" | "glassworks" | "furniture" | "constructionplant"
  | "coppermine" | "coppersmelter" | "electronics" | "machineworks"
  // deeper chains: the chemical works, the dairy and creamery, and the Motor Works with its rubber plant
  | "chemworks" | "dairyfarm" | "creamery" | "rubberplant" | "motorworks"
  // the company's logistics: a store that buffers deliveries, and a depot that fuels trucks at cost
  | "warehouse" | "fueldepot"
  // the company's landmarks, one of each, built once over days (see game/megaprojects.ts)
  | "hydrodam" | "skylinetower" | "exposition"
  // a town's civic buildings, each the reward of one of its orders (see game/civics.ts, game/orders.ts)
  | CivicKind;
export type Zone = "res" | "com" | "placed";

export interface BuildingType {
  kind: BuildingKind;
  name: string;
  zone: Zone;
  /** frontage along the road; for the company's buildings, the whole fenced site (docs/design.md "Industry sites") */
  w: number;
  d: number; // depth away from the road
  residents: number;
  jobs: number;
  /** keeps food on its shelves, restocked by the company's food trucks (a shop) */
  shelves?: boolean;
  /** a filling station: sells the town its fuel (and takes no other deliveries) */
  fuel?: boolean;
  pollution: number; // radius in metres, 0 = clean
  parking: number; // visible parking bays in front
  blurb: string;
}

// (the company's works leave `blurb` empty: industry.ts sets it from their recipe's own line, PLANTS, so the card,
// the banner and the hand bar can't disagree. Review 2026-11-10, B5)
export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  house: { kind: "house", name: "Family Home", zone: "res", w: 12, d: 15, residents: 2, jobs: 0, pollution: 0, parking: 1, blurb: "A family home with a porch and a back yard." },
  terrace: { kind: "terrace", name: "Row Houses", zone: "res", w: 24, d: 17, residents: 5, jobs: 0, pollution: 0, parking: 3, blurb: "A row of brick houses with stoops on the pavement." },
  apartments: { kind: "apartments", name: "Apartment House", zone: "res", w: 30, d: 30, residents: 12, jobs: 0, pollution: 0, parking: 6, blurb: "Brick walk-up apartments that send many trips down one alley." },
  modernflats: { kind: "modernflats", name: "Courtyard Apartments", zone: "res", w: 30, d: 30, residents: 24, jobs: 0, pollution: 0, parking: 6, blurb: "A six-storey apartment house round a garden court." },
  aptower: { kind: "aptower", name: "Apartment Tower", zone: "res", w: 30, d: 30, residents: 50, jobs: 0, pollution: 0, parking: 6, blurb: "A setback apartment tower in a city core." },
  highstreet: { kind: "highstreet", name: "Main Street Shops", zone: "com", w: 18, d: 20, residents: 0, jobs: 3, shelves: true, pollution: 0, parking: 3, blurb: "Shop-houses on Main Street with the owners living above." },
  shop: { kind: "shop", name: "Small Shops", zone: "com", w: 18, d: 20, residents: 0, jobs: 3, shelves: true, pollution: 0, parking: 4, blurb: "Sells the town the food your trucks deliver." },
  store: { kind: "store", name: "Department Store", zone: "com", w: 30, d: 28, residents: 0, jobs: 7, shelves: true, pollution: 0, parking: 8, blurb: "A department store or a five-and-dime that draws customers from further away." },
  office: { kind: "office", name: "Office Block", zone: "com", w: 20, d: 22, residents: 0, jobs: 8, shelves: true, pollution: 0, parking: 5, blurb: "A brick and terracotta office block with a shop on the ground floor." },
  mall: { kind: "mall", name: "Grand Store", zone: "com", w: 48, d: 40, residents: 0, jobs: 14, shelves: true, pollution: 0, parking: 14, blurb: "The big department store or covered market, with heavy traffic at its doors." },
  tower: { kind: "tower", name: "Office Tower", zone: "com", w: 30, d: 30, residents: 0, jobs: 20, shelves: true, pollution: 0, parking: 9, blurb: "A setback office tower with shops at its foot." },
  fuelstation: { kind: "fuelstation", name: "Filling Station", zone: "com", w: 24, d: 24, residents: 0, jobs: 3, fuel: true, pollution: 0, parking: 2, blurb: "Sells the town the fuel your tankers bring, from 1,500 people." },
  glasstower: { kind: "glasstower", name: "Skyscraper", zone: "com", w: 30, d: 30, residents: 0, jobs: 30, shelves: true, pollution: 0, parking: 6, blurb: "A stepped stone skyscraper under a lit crown." },
  hamlethall: { kind: "hamlethall", name: "Hamlet Hall", zone: "placed", w: 20, d: 18, residents: 0, jobs: 0, pollution: 0, parking: 2, blurb: "The hamlet's hall on its green, with a bell cupola." },
  villagehall: { kind: "villagehall", name: "Village Hall", zone: "placed", w: 28, d: 24, residents: 0, jobs: 0, pollution: 0, parking: 3, blurb: "The village's arcaded market hall on its square." },
  townhall: { kind: "townhall", name: "Town Hall", zone: "placed", w: 40, d: 36, residents: 0, jobs: 0, pollution: 0, parking: 4, blurb: "The town's domed hall round a courtyard." },
  cityhall: { kind: "cityhall", name: "City Hall", zone: "placed", w: 60, d: 50, residents: 0, jobs: 0, pollution: 0, parking: 6, blurb: "The city's hall, belfry and copper spire, on a square with fountains." },
  farm: { kind: "farm", name: "Farm", zone: "placed", w: 290, d: 270, residents: 0, jobs: 8, pollution: 0, parking: 2, blurb: "" },
  loggingcamp: { kind: "loggingcamp", name: "Logging Camp", zone: "placed", w: 250, d: 230, residents: 0, jobs: 8, pollution: 0, parking: 2, blurb: "" },
  foodplant: { kind: "foodplant", name: "Food Plant", zone: "placed", w: 180, d: 160, residents: 0, jobs: 12, pollution: 90, parking: 4, blurb: "" },
  sawmill: { kind: "sawmill", name: "Sawmill", zone: "placed", w: 200, d: 180, residents: 0, jobs: 12, pollution: 60, parking: 3, blurb: "" },
  ironmine: { kind: "ironmine", name: "Iron Mine", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 80, parking: 2, blurb: "" },
  coalmine: { kind: "coalmine", name: "Coal Mine", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 90, parking: 2, blurb: "" },
  quarry: { kind: "quarry", name: "Quarry", zone: "placed", w: 260, d: 240, residents: 0, jobs: 10, pollution: 80, parking: 2, blurb: "" },
  smelter: { kind: "smelter", name: "Smelter", zone: "placed", w: 220, d: 210, residents: 0, jobs: 16, pollution: 150, parking: 4, blurb: "" },
  cementworks: { kind: "cementworks", name: "Cement Works", zone: "placed", w: 210, d: 200, residents: 0, jobs: 14, pollution: 130, parking: 4, blurb: "" },
  oilwell: { kind: "oilwell", name: "Oil Well", zone: "placed", w: 240, d: 220, residents: 0, jobs: 8, pollution: 60, parking: 2, blurb: "" },
  sandpit: { kind: "sandpit", name: "Sand Pit", zone: "placed", w: 260, d: 240, residents: 0, jobs: 8, pollution: 40, parking: 2, blurb: "" },
  refinery: { kind: "refinery", name: "Refinery", zone: "placed", w: 290, d: 260, residents: 0, jobs: 18, pollution: 160, parking: 5, blurb: "" },
  glassworks: { kind: "glassworks", name: "Glassworks", zone: "placed", w: 210, d: 190, residents: 0, jobs: 14, pollution: 110, parking: 4, blurb: "" },
  furniture: { kind: "furniture", name: "Furniture Factory", zone: "placed", w: 200, d: 180, residents: 0, jobs: 14, pollution: 30, parking: 4, blurb: "" },
  constructionplant: { kind: "constructionplant", name: "Construction Plant", zone: "placed", w: 220, d: 200, residents: 0, jobs: 16, pollution: 90, parking: 4, blurb: "" },
  coppermine: { kind: "coppermine", name: "Copper Mine", zone: "placed", w: 250, d: 230, residents: 0, jobs: 12, pollution: 90, parking: 2, blurb: "" },
  coppersmelter: { kind: "coppersmelter", name: "Copper Smelter", zone: "placed", w: 230, d: 210, residents: 0, jobs: 16, pollution: 150, parking: 4, blurb: "" },
  electronics: { kind: "electronics", name: "Electronics Plant", zone: "placed", w: 200, d: 180, residents: 0, jobs: 18, pollution: 30, parking: 5, blurb: "" },
  machineworks: { kind: "machineworks", name: "Machine Works", zone: "placed", w: 220, d: 200, residents: 0, jobs: 18, pollution: 80, parking: 4, blurb: "" },
  chemworks: { kind: "chemworks", name: "Chemical Works", zone: "placed", w: 220, d: 200, residents: 0, jobs: 16, pollution: 140, parking: 4, blurb: "" },
  dairyfarm: { kind: "dairyfarm", name: "Dairy Farm", zone: "placed", w: 290, d: 270, residents: 0, jobs: 8, pollution: 0, parking: 2, blurb: "" },
  creamery: { kind: "creamery", name: "Creamery", zone: "placed", w: 190, d: 170, residents: 0, jobs: 12, pollution: 20, parking: 4, blurb: "" },
  rubberplant: { kind: "rubberplant", name: "Rubber Plant", zone: "placed", w: 210, d: 190, residents: 0, jobs: 14, pollution: 120, parking: 4, blurb: "" },
  motorworks: { kind: "motorworks", name: "Motor Works", zone: "placed", w: 290, d: 260, residents: 0, jobs: 30, pollution: 90, parking: 8, blurb: "" },
  warehouse: { kind: "warehouse", name: "Warehouse", zone: "placed", w: 110, d: 84, residents: 0, jobs: 0, pollution: 0, parking: 3, blurb: "" },
  fueldepot: { kind: "fueldepot", name: "Fuel Depot", zone: "placed", w: 64, d: 52, residents: 0, jobs: 0, pollution: 10, parking: 1, blurb: "" },
  hydrodam: { kind: "hydrodam", name: "Hydro Dam", zone: "placed", w: 200, d: 170, residents: 0, jobs: 12, pollution: 0, parking: 3, blurb: "" },
  skylinetower: { kind: "skylinetower", name: "Skyline Tower", zone: "placed", w: 140, d: 140, residents: 0, jobs: 40, pollution: 0, parking: 6, blurb: "" },
  exposition: { kind: "exposition", name: "Grand Exposition", zone: "placed", w: 220, d: 200, residents: 0, jobs: 30, pollution: 0, parking: 8, blurb: "" },
  ...civicTypes(),
  coalplant: { kind: "coalplant", name: "Power Plant", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 140, parking: 5, blurb: "" },
};

/** The towns' civic buildings as building types: the town's own, on a lot of its streets (zone "placed", as a hall). */
function civicTypes(): Record<CivicKind, BuildingType> {
  const out = {} as Record<CivicKind, BuildingType>;
  for (const c of Object.values(CIVICS)) {
    out[c.kind] = { kind: c.kind, name: c.name, zone: "placed", w: c.w * 8, d: c.d * 8, residents: 0, jobs: 0, pollution: 0, parking: 0, blurb: c.blurb };
  }
  return out;
}

// ---------- Simulation ----------

export const SIM = {
  dt: 1 / 30,
  idm: { a: 2.6, b: 2.6, s0: 2.2, T: 1.0 },
  carLen: 4.4,
  truckLen: 8.5,
  busLen: 12,
  laneChangeTime: 2.2,
  yieldGap: 3.2,
  /** Sideways acceleration drivers take bends and turns at (m/s²): turn speed = sqrt(turnLat * radius). */
  turnLat: 3.6,
  /** The same round a roundabout's ring, held the whole way round, so a touch gentler (a 2-lane ring stays under ~30 km/h). */
  ringLat: 3.2,
  /** The steady braking (m/s²) a car slows on towards a junction or bend's speed. */
  approachDecel: 2.0,
};
