// Tunables in one place. Distances in metres, times in seconds, speeds in m/s.

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

export type RoadTypeId = "street" | "avenue" | "boulevard" | "streetM" | "avenueM" | "boulevardM" | "one1" | "one2" | "hw1" | "hw2" | "one3" | "one4";

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
}

const kmh = (k: number) => k / 3.6;

export const ROAD_TYPES: Record<RoadTypeId, RoadType> = {
  street: { id: "street", name: "Street", short: "1+1", fwd: 1, bwd: 1, speed: kmh(50), costPerM: 6, minRadius: 9, allowsAccess: true, rank: 1, hint: "Two-way, one lane each way. Houses and shops can face it." },
  avenue: { id: "avenue", name: "Avenue", short: "2+2", fwd: 2, bwd: 2, speed: kmh(60), costPerM: 13, minRadius: 14, allowsAccess: true, rank: 2, hint: "Two-way, two lanes each way. Buildings can still face it." },
  boulevard: { id: "boulevard", name: "Boulevard", short: "3+3", fwd: 3, bwd: 3, speed: kmh(70), costPerM: 21, minRadius: 20, allowsAccess: false, rank: 3, hint: "Two-way, three lanes each way. Too busy for driveways." },
  streetM: { id: "streetM", name: "Divided street", short: "1|1", fwd: 1, bwd: 1, speed: kmh(50), costPerM: 9, minRadius: 10, allowsAccess: true, rank: 1, median: 2.5, hint: "One lane each way split by a planted median. No turning across it: cars U-turn at junctions." },
  avenueM: { id: "avenueM", name: "Divided avenue", short: "2|2", fwd: 2, bwd: 2, speed: kmh(60), costPerM: 17, minRadius: 16, allowsAccess: true, rank: 2, median: 3.5, hint: "Two lanes each way with a median. Safer and faster than an avenue; buildings get right-in, right-out." },
  boulevardM: { id: "boulevardM", name: "Divided boulevard", short: "3|3", fwd: 3, bwd: 3, speed: kmh(70), costPerM: 26, minRadius: 22, allowsAccess: false, rank: 3, median: 5, hint: "Three lanes each way either side of a wide median. A city's main artery." },
  one1: { id: "one1", name: "One-way", short: "1", fwd: 1, bwd: 0, speed: kmh(50), costPerM: 4, minRadius: 8, allowsAccess: true, rank: 1, hint: "One-lane town street, drawn direction only. Houses and shops can face it." },
  one2: { id: "one2", name: "One-way 2", short: "2", fwd: 2, bwd: 0, speed: kmh(70), costPerM: 9, minRadius: 16, allowsAccess: true, rank: 2, hint: "Two lanes, drawn direction only." },
  hw1: { id: "hw1", name: "Highway 1", short: "1", fwd: 1, bwd: 0, speed: kmh(100), costPerM: 8, minRadius: 25, allowsAccess: false, rank: 2, hint: "One-lane highway ramp. Ramps off a motorway get a slip lane beside it; draw on along the motorway from where a slip lane starts to lengthen it, or to join it to the next one." },
  hw2: { id: "hw2", name: "Highway 2", short: "2", fwd: 2, bwd: 0, speed: kmh(120), costPerM: 12, minRadius: 60, allowsAccess: false, rank: 3, hint: "Two-lane motorway carriageway. Build pairs, link with ramps." },
  one3: { id: "one3", name: "Highway 3", short: "3", fwd: 3, bwd: 0, speed: kmh(120), costPerM: 15, minRadius: 30, allowsAccess: false, rank: 3, hint: "Three-lane carriageway. Build pairs for a motorway." },
  one4: { id: "one4", name: "Highway 4", short: "4", fwd: 4, bwd: 0, speed: kmh(120), costPerM: 21, minRadius: 40, allowsAccess: false, rank: 4, hint: "Four-lane carriageway for the heaviest flows." },
};

export const ROAD_ORDER: RoadTypeId[] = ["one1", "street", "streetM", "one2", "avenue", "avenueM", "hw1", "hw2", "one3", "boulevard", "boulevardM", "one4"];

/** Motorway carriageways and ramps: one-way and closed to driveways. Drawn in darker asphalt with solid edge lines. */
export const isHighway = (t: RoadType): boolean => t.bwd === 0 && !t.allowsAccess;

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

export const ELEVATED_COST_MULT = [1, 2.2, 2.8, 3.4];
export const WATER_BRIDGE_MULT = 1.6;
export const BULLDOZE_REFUND = 0.75;
export const ROUNDABOUT_COST = 900;
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
  | "coppermine" | "coppersmelter" | "electronics" | "machineworks";
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

export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  house: { kind: "house", name: "Small Residential", zone: "res", w: 12, d: 15, residents: 2, jobs: 0, pollution: 0, parking: 1, blurb: "A family home. Residents visit shops and commute to work." },
  terrace: { kind: "terrace", name: "Medium Residential", zone: "res", w: 24, d: 17, residents: 5, jobs: 0, pollution: 0, parking: 3, blurb: "A row of townhouses." },
  apartments: { kind: "apartments", name: "Large Residential", zone: "res", w: 30, d: 30, residents: 12, jobs: 0, pollution: 0, parking: 6, blurb: "Apartment block. Lots of trips from one driveway." },
  modernflats: { kind: "modernflats", name: "Modern Flats", zone: "res", w: 30, d: 30, residents: 24, jobs: 0, pollution: 0, parking: 6, blurb: "A modern block of flats round a courtyard." },
  aptower: { kind: "aptower", name: "Apartment Tower", zone: "res", w: 30, d: 30, residents: 50, jobs: 0, pollution: 0, parking: 6, blurb: "A residential tower in a city core." },
  highstreet: { kind: "highstreet", name: "High Street Shop", zone: "com", w: 18, d: 20, residents: 0, jobs: 3, shelves: true, pollution: 0, parking: 3, blurb: "An old shop-house on the high street: a shop below, the owners above." },
  shop: { kind: "shop", name: "Small Commercial", zone: "com", w: 18, d: 20, residents: 0, jobs: 3, shelves: true, pollution: 0, parking: 4, blurb: "Sells the town its food: needs customers, staff and the company's food deliveries." },
  store: { kind: "store", name: "Medium Commercial", zone: "com", w: 30, d: 28, residents: 0, jobs: 7, shelves: true, pollution: 0, parking: 8, blurb: "A bigger store that draws customers from further away." },
  office: { kind: "office", name: "Offices", zone: "com", w: 20, d: 22, residents: 0, jobs: 8, shelves: true, pollution: 0, parking: 5, blurb: "Offices with a shop on the ground floor." },
  mall: { kind: "mall", name: "Large Commercial", zone: "com", w: 48, d: 40, residents: 0, jobs: 14, shelves: true, pollution: 0, parking: 14, blurb: "Shopping centre. Expect heavy traffic at the entrance." },
  tower: { kind: "tower", name: "Office Tower", zone: "com", w: 30, d: 30, residents: 0, jobs: 20, shelves: true, pollution: 0, parking: 9, blurb: "An office tower with shops at its foot." },
  fuelstation: { kind: "fuelstation", name: "Filling Station", zone: "com", w: 24, d: 24, residents: 0, jobs: 3, fuel: true, pollution: 0, parking: 2, blurb: "Sells the town its fuel: the company's tankers fill its tanks. A town of 1,500 opens one; a big town two." },
  glasstower: { kind: "glasstower", name: "Glass Tower", zone: "com", w: 30, d: 30, residents: 0, jobs: 30, shelves: true, pollution: 0, parking: 6, blurb: "A glass office tower: the city's skyline." },
  hamlethall: { kind: "hamlethall", name: "Hamlet Hall", zone: "placed", w: 20, d: 18, residents: 0, jobs: 0, pollution: 0, parking: 2, blurb: "The hamlet's hall on its green, with a bell cupola." },
  villagehall: { kind: "villagehall", name: "Village Hall", zone: "placed", w: 28, d: 24, residents: 0, jobs: 0, pollution: 0, parking: 3, blurb: "The village's arcaded market hall on its square." },
  townhall: { kind: "townhall", name: "Town Hall", zone: "placed", w: 40, d: 36, residents: 0, jobs: 0, pollution: 0, parking: 4, blurb: "The town's domed hall round a courtyard." },
  cityhall: { kind: "cityhall", name: "City Hall", zone: "placed", w: 60, d: 50, residents: 0, jobs: 0, pollution: 0, parking: 6, blurb: "The city's hall, belfry and copper spire, on a square with fountains." },
  farm: { kind: "farm", name: "Farm", zone: "placed", w: 290, d: 270, residents: 0, jobs: 8, pollution: 0, parking: 2, blurb: "Grows crops on fertile soil. Its trucks take them to your food plants." },
  loggingcamp: { kind: "loggingcamp", name: "Logging Camp", zone: "placed", w: 250, d: 230, residents: 0, jobs: 8, pollution: 0, parking: 2, blurb: "Fells timber in the forest. Its trucks take the logs to your sawmills." },
  foodplant: { kind: "foodplant", name: "Food Plant", zone: "placed", w: 180, d: 160, residents: 0, jobs: 12, pollution: 90, parking: 4, blurb: "Turns crops into food. Its trucks sell the food to the towns' shops." },
  sawmill: { kind: "sawmill", name: "Sawmill", zone: "placed", w: 200, d: 180, residents: 0, jobs: 12, pollution: 60, parking: 3, blurb: "Saws logs into planks. Its trucks sell the planks to the towns." },
  ironmine: { kind: "ironmine", name: "Iron Mine", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 80, parking: 2, blurb: "Digs iron ore. Its trucks take it to your smelters." },
  coalmine: { kind: "coalmine", name: "Coal Mine", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 90, parking: 2, blurb: "Digs coal for your smelters, cement works and power plants." },
  quarry: { kind: "quarry", name: "Quarry", zone: "placed", w: 260, d: 240, residents: 0, jobs: 10, pollution: 80, parking: 2, blurb: "Quarries limestone. Its trucks take it to your cement works." },
  smelter: { kind: "smelter", name: "Smelter", zone: "placed", w: 220, d: 210, residents: 0, jobs: 16, pollution: 150, parking: 4, blurb: "Smelts iron ore with coal into steel." },
  cementworks: { kind: "cementworks", name: "Cement Works", zone: "placed", w: 210, d: 200, residents: 0, jobs: 14, pollution: 130, parking: 4, blurb: "Burns limestone with coal into cement for the villages." },
  oilwell: { kind: "oilwell", name: "Oil Well", zone: "placed", w: 240, d: 220, residents: 0, jobs: 8, pollution: 60, parking: 2, blurb: "Pumps crude oil. Its tankers take it to your refineries." },
  sandpit: { kind: "sandpit", name: "Sand Pit", zone: "placed", w: 260, d: 240, residents: 0, jobs: 8, pollution: 40, parking: 2, blurb: "Digs sand by the water. Its tippers take it to your glassworks." },
  refinery: { kind: "refinery", name: "Refinery", zone: "placed", w: 290, d: 260, residents: 0, jobs: 18, pollution: 160, parking: 5, blurb: "Splits crude oil into fuel and plastics." },
  glassworks: { kind: "glassworks", name: "Glassworks", zone: "placed", w: 210, d: 190, residents: 0, jobs: 14, pollution: 110, parking: 4, blurb: "Melts sand with coal into glass." },
  furniture: { kind: "furniture", name: "Furniture Factory", zone: "placed", w: 200, d: 180, residents: 0, jobs: 14, pollution: 30, parking: 4, blurb: "Builds household goods from planks and glass." },
  constructionplant: { kind: "constructionplant", name: "Construction Plant", zone: "placed", w: 220, d: 200, residents: 0, jobs: 16, pollution: 90, parking: 4, blurb: "Casts steel and cement into construction parts." },
  coppermine: { kind: "coppermine", name: "Copper Mine", zone: "placed", w: 250, d: 230, residents: 0, jobs: 12, pollution: 90, parking: 2, blurb: "Digs copper ore in the high ranges. Its tippers take it to your copper smelters." },
  coppersmelter: { kind: "coppersmelter", name: "Copper Smelter", zone: "placed", w: 230, d: 210, residents: 0, jobs: 16, pollution: 150, parking: 4, blurb: "Smelts copper ore with coal into copper." },
  electronics: { kind: "electronics", name: "Electronics Plant", zone: "placed", w: 200, d: 180, residents: 0, jobs: 18, pollution: 30, parking: 5, blurb: "Builds electronics from copper and plastics." },
  machineworks: { kind: "machineworks", name: "Machine Works", zone: "placed", w: 220, d: 200, residents: 0, jobs: 18, pollution: 80, parking: 4, blurb: "Builds machinery from steel and copper." },
  coalplant: { kind: "coalplant", name: "Power Plant", zone: "placed", w: 220, d: 200, residents: 0, jobs: 12, pollution: 140, parking: 5, blurb: "Burns coal for power: the buildings that need it on its roads within 4 km work at full pace. Its smoke drags land value down for a few hundred metres." },
};

export const ZONE_LABEL: Record<Zone, string> = { res: "Residential", com: "Commercial", placed: "Company building" };

// ---------- Simulation ----------

export const SIM = {
  dt: 1 / 30,
  idm: { a: 2.0, b: 2.6, s0: 2.2, T: 1.1 },
  carLen: 4.4,
  truckLen: 8.5,
  busLen: 12,
  laneChangeTime: 2.2,
  junctionCheckTime: 4.5,
  yieldGap: 3.2,
  /** Sideways acceleration drivers take bends and turns at (m/s²): turn speed = sqrt(turnLat * radius). */
  turnLat: 3.2,
  dwellMin: 25,
  dwellMax: 55,
  tripInterval: [70, 130] as [number, number],
  shopTarget: 90,
  workTarget: 150,
  deliveryInterval: 55,
};

/** Land tile size in metres. Tile (i, j) is centred on (i * TILE, j * TILE); the start tile is centred on the origin. */
export const TILE = 640;
/** Tiles owned at the start: the 3x3 block around the origin (CS2 starts with 9 tiles). */
export const START_TILES: [number, number][] = [-1, 0, 1].flatMap((i) => [-1, 0, 1].map((j) => [i, j] as [number, number]));
