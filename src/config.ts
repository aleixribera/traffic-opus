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

export type RoadTypeId = "street" | "avenue" | "boulevard" | "streetM" | "avenueM" | "boulevardM" | "one1" | "one2" | "hw2" | "one3" | "one4";

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
  one1: { id: "one1", name: "One-way", short: "1", fwd: 1, bwd: 0, speed: kmh(50), costPerM: 4, minRadius: 8, allowsAccess: true, rank: 1, hint: "One lane, drawn direction only. Ideal for ramps and loops." },
  one2: { id: "one2", name: "One-way 2", short: "2", fwd: 2, bwd: 0, speed: kmh(70), costPerM: 9, minRadius: 16, allowsAccess: true, rank: 2, hint: "Two lanes, drawn direction only." },
  hw2: { id: "hw2", name: "Highway 2", short: "2", fwd: 2, bwd: 0, speed: kmh(100), costPerM: 12, minRadius: 60, allowsAccess: false, rank: 3, hint: "Two-lane motorway carriageway. Build pairs, link with ramps." },
  one3: { id: "one3", name: "Highway 3", short: "3", fwd: 3, bwd: 0, speed: kmh(90), costPerM: 15, minRadius: 30, allowsAccess: false, rank: 3, hint: "Three-lane carriageway. Build pairs for a motorway." },
  one4: { id: "one4", name: "Highway 4", short: "4", fwd: 4, bwd: 0, speed: kmh(100), costPerM: 21, minRadius: 40, allowsAccess: false, rank: 4, hint: "Four-lane carriageway for the heaviest flows." },
};

export const ROAD_ORDER: RoadTypeId[] = ["one1", "street", "streetM", "one2", "avenue", "avenueM", "hw2", "one3", "boulevard", "boulevardM", "one4"];

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
  | "house" | "terrace" | "apartments"
  | "shop" | "store" | "mall"
  | "office" | "tower"
  | "mine" | "farm" | "works" | "foodplant";
export type Zone = "res" | "com" | "work" | "ind";
export type Cargo = "ore" | "food" | "goods";

export interface BuildingType {
  kind: BuildingKind;
  name: string;
  zone: Zone;
  w: number; // frontage along the road
  d: number; // depth away from the road
  residents: number;
  jobs: number;
  produces?: Cargo;
  consumes?: Cargo;
  pollution: number; // radius in metres, 0 = clean
  needsMountain?: boolean; // rear of the plot must sit in a mountain
  parking: number; // visible parking bays in front
  blurb: string;
}

export const BUILDING_TYPES: Record<BuildingKind, BuildingType> = {
  house: { kind: "house", name: "Small Residential", zone: "res", w: 12, d: 15, residents: 2, jobs: 0, pollution: 0, parking: 1, blurb: "A family home. Residents visit shops and commute to work." },
  terrace: { kind: "terrace", name: "Medium Residential", zone: "res", w: 24, d: 17, residents: 5, jobs: 0, pollution: 0, parking: 3, blurb: "A row of townhouses." },
  apartments: { kind: "apartments", name: "Large Residential", zone: "res", w: 30, d: 30, residents: 12, jobs: 0, pollution: 0, parking: 6, blurb: "Apartment block. Lots of trips from one driveway." },
  shop: { kind: "shop", name: "Small Commercial", zone: "com", w: 18, d: 20, residents: 0, jobs: 3, consumes: "goods", pollution: 0, parking: 4, blurb: "Needs customers, staff and deliveries of goods." },
  store: { kind: "store", name: "Medium Commercial", zone: "com", w: 30, d: 28, residents: 0, jobs: 7, consumes: "goods", pollution: 0, parking: 8, blurb: "A bigger store that draws customers from further away." },
  mall: { kind: "mall", name: "Large Commercial", zone: "com", w: 48, d: 40, residents: 0, jobs: 14, consumes: "goods", pollution: 0, parking: 14, blurb: "Shopping centre. Expect heavy traffic at the entrance." },
  office: { kind: "office", name: "Small Office", zone: "work", w: 20, d: 22, residents: 0, jobs: 10, pollution: 0, parking: 5, blurb: "Clean workplace. Needs commuters." },
  tower: { kind: "tower", name: "Medium Office", zone: "work", w: 30, d: 30, residents: 0, jobs: 22, pollution: 0, parking: 9, blurb: "Office block with many jobs." },
  mine: { kind: "mine", name: "Copper Mine", zone: "ind", w: 26, d: 30, residents: 0, jobs: 8, produces: "ore", pollution: 70, needsMountain: true, parking: 2, blurb: "Must be dug into a mountain. Ships copper ore to Copper Works." },
  farm: { kind: "farm", name: "Farm", zone: "ind", w: 40, d: 40, residents: 0, jobs: 4, produces: "food", pollution: 0, parking: 2, blurb: "Grows food for Food Plants. Dislikes pollution." },
  works: { kind: "works", name: "Copper Works", zone: "ind", w: 36, d: 32, residents: 0, jobs: 14, consumes: "ore", produces: "goods", pollution: 130, parking: 4, blurb: "Turns copper ore into consumer goods. Polluting." },
  foodplant: { kind: "foodplant", name: "Food Plant", zone: "ind", w: 32, d: 30, residents: 0, jobs: 12, consumes: "food", produces: "goods", pollution: 90, parking: 4, blurb: "Turns food into consumer goods." },
};

export const ZONE_LABEL: Record<Zone, string> = { res: "Residential", com: "Commercial", work: "Workplace", ind: "Industry" };
export const CARGO_LABEL: Record<Cargo, string> = { ore: "copper ore", food: "food", goods: "consumer goods" };

// ---------- Simulation ----------

export const SIM = {
  dt: 1 / 30,
  idm: { a: 2.0, b: 2.6, s0: 2.2, T: 1.1 },
  carLen: 4.4,
  truckLen: 8.5,
  laneChangeTime: 2.2,
  junctionCheckTime: 4.5,
  yieldGap: 3.2,
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
