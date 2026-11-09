// What should be heard (docs/design.md, "Sound"): a pure function from a small summary of what is on screen (the
// Scene, made a few times a second by scene.ts) to the level of every layer and the pace of every kind of event.
// No AudioContext, no game objects: tests/audio.mixer.test.ts pins its rules (zoom in and the traffic swells while
// the wind drops; birds stop at night; a works that isn't running is silent; a pause ducks the world).

export const CLASSES = ["car", "light", "heavy", "train"] as const;
export type VClass = 0 | 1 | 2 | 3;

/** The works' beds: one loop per family of works (sounds.ts has the recipes). */
export const WORKS = ["saw", "furnace", "crusher", "turbine", "pumpjack", "hiss", "lightmach", "tractor", "kiln", "glass", "assembly"] as const;
export type WorksBed = (typeof WORKS)[number];
export const NW = WORKS.length;

/** Which bed each kind of works plays (a kind not listed is silent: a warehouse, a depot, a landmark). */
export const BED_OF: Record<string, WorksBed> = {
  sawmill: "saw", furniture: "saw",
  smelter: "furnace", coppersmelter: "furnace",
  ironmine: "crusher", coalmine: "crusher", coppermine: "crusher", quarry: "crusher", sandpit: "crusher",
  coalplant: "turbine",
  oilwell: "pumpjack",
  refinery: "hiss", chemworks: "hiss", rubberplant: "hiss",
  foodplant: "lightmach", creamery: "lightmach", electronics: "lightmach", constructionplant: "lightmach",
  farm: "tractor", dairyfarm: "tractor", loggingcamp: "tractor",
  cementworks: "kiln",
  glassworks: "glass",
  motorworks: "assembly", machineworks: "assembly",
};

/** What is on screen, as the ear needs it. Counts are weighted by how near the middle of the view a thing is. */
export interface Scene {
  /** half the view's height in metres: under ~100 is street level, over ~1500 the whole county */
  halfH: number;
  paused: boolean;
  speed: number;
  /** the hour shown, 0..24, and the season (0 spring .. 3 winter) */
  hour: number;
  season: number;
  /** vehicles in view by class (car, light truck, heavy truck, road train), and each class's mean speed (m/s) */
  n: number[];
  v: number[];
  /** vehicles standing in a queue, those standing a long while (a jam), and trucks turning in at a gate */
  idle: number;
  jam: number;
  gate: number;
  /** running works in view per bed (WORKS order), each counted by nearness and level */
  works: number[];
  /** works in view that have their own calls: logging camps, dairies, motor works, mines and quarries that blast */
  logging: number;
  dairy: number;
  farm: number;
  motor: number;
  pit: number;
  /** buildings going up */
  sites: number;
  /** homes and shops in view, the biggest town in view's people, and how near a town hall is (0..1) */
  homes: number;
  shops: number;
  pop: number;
  hall: number;
  /** share of the ground near the middle of the view that is forest, and water (0..1) */
  forest: number;
  water: number;
}

export function emptyScene(): Scene {
  return {
    halfH: 260, paused: false, speed: 1, hour: 12, season: 1, n: [0, 0, 0, 0], v: [0, 0, 0, 0], idle: 0, jam: 0, gate: 0,
    works: new Array(NW).fill(0), logging: 0, dairy: 0, farm: 0, motor: 0, pit: 0, sites: 0, homes: 0, shops: 0, pop: 0, hall: 0, forest: 0, water: 0,
  };
}

/** Levels (0..1, before each layer's own trim) and event paces (a minute). */
export interface Mix {
  /** the whole world bus: down while paused */
  duck: number;
  wind: number;
  /** the wind's whistle: where it sits (Hz), and how much thin high air is in it (winter) */
  windHz: number;
  air: number;
  /** the far hum of a working county, when zoomed right out */
  hum: number;
  /** bird phrases a minute, their level, and how much of it is the dawn chorus */
  birds: number;
  birdGain: number;
  crickets: number;
  owl: number;
  water: number;
  /** engine beds by class, and their pitch (playback rate) */
  eng: number[];
  rate: number[];
  tyres: number;
  tyreHz: number;
  idle: number;
  /** how much the nearest few vehicles are heard one by one (street level) */
  street: number;
  /** horns a minute (a jam), trucks' air brakes and doors a minute (a gate) */
  horn: number;
  gate: number;
  works: number[];
  /** the works' own events, a minute */
  clank: number;
  steam: number;
  blast: number;
  axe: number;
  rooster: number;
  cow: number;
  hornTest: number;
  clink: number;
  /** hammering and sawing on building sites, a minute */
  build: number;
  murmur: number;
  shopbell: number;
  dog: number;
  children: number;
  /** how loud a town hall's clock would strike now (0: none in earshot) */
  clock: number;
  /** how far the level of one-shots near the middle is cut for distance (zoom) */
  near: number;
}

export function emptyMix(): Mix {
  return {
    duck: 1, wind: 0, windHz: 500, air: 0, hum: 0, birds: 0, birdGain: 0, crickets: 0, owl: 0, water: 0, eng: [0, 0, 0, 0], rate: [1, 1, 1, 1],
    tyres: 0, tyreHz: 1000, idle: 0, street: 0, horn: 0, gate: 0, works: new Array(NW).fill(0), clank: 0, steam: 0, blast: 0, axe: 0, rooster: 0, cow: 0,
    hornTest: 0, clink: 0, build: 0, murmur: 0, shopbell: 0, dog: 0, children: 0, clock: 0, near: 0,
  };
}

const clamp = (x: number, a = 0, b = 1) => (x < a ? a : x > b ? b : x);
const smooth = (a: number, b: number, x: number) => { const t = clamp((x - a) / (b - a)); return t * t * (3 - 2 * t); };
/** 0 at nothing, easing to 1: twice as many of a thing is not twice as loud */
const sat = (x: number) => 1 - Math.exp(-Math.max(0, x));
/** 1 when zoomed in to `a` metres of half height or closer, 0 from `b` out (eased on the zoom's log scale) */
const within = (halfH: number, a: number, b: number) => 1 - smooth(Math.log(a), Math.log(b), Math.log(Math.max(1, halfH)));

/** Daylight, 0..1: the working day. */
export const dayOf = (h: number) => smooth(5.5, 7.5, h) * (1 - smooth(19, 21.5, h));
/** The dawn chorus's hour. */
export const dawnOf = (h: number) => smooth(4.6, 5.6, h) * (1 - smooth(7, 8.5, h));
/** Deep night. */
export const nightOf = (h: number) => Math.max(smooth(20.5, 22, h), 1 - smooth(3.8, 5.2, h));

const BIRD_SEASON = [1, 0.8, 0.45, 0.12];
const CRICKET_SEASON = [0.25, 1, 0.35, 0];
/** each class's trim, and how many of it make a full bed */
const ENG_GAIN = [0.8, 0.9, 1, 1.05], ENG_FULL = [9, 5, 3.5, 2.5];
/** each works bed's trim (a saw cuts through; a turbine sits under) */
const WORKS_GAIN: Record<WorksBed, number> = { saw: 0.8, furnace: 1, crusher: 0.95, turbine: 0.75, pumpjack: 0.9, hiss: 0.7, lightmach: 0.7, tractor: 0.75, kiln: 0.95, glass: 0.8, assembly: 0.8 };

/** Work the mix out for a scene (into `m`, which is returned: nothing is allocated). */
export function mixFor(s: Scene, m: Mix = emptyMix()): Mix {
  const h = s.hour, winter = s.season === 3;
  const close = within(s.halfH, 100, 1500), far = 1 - close;
  const closeW = within(s.halfH, 150, 2600), closeT = within(s.halfH, 150, 1800), closeB = within(s.halfH, 300, 2500);
  const day = dayOf(h), dawn = dawnOf(h), night = nightOf(h);
  const live = s.paused ? 0 : 1;
  // faster game: the same sounds, more often (never higher)
  const dense = s.speed >= 4 ? 2 : s.speed >= 2 ? 1.5 : 1;

  m.duck = s.paused ? 0.25 : 1;
  m.near = close;

  // ---- air
  m.wind = (0.22 + 0.58 * far) * (winter ? 0.8 : 1) * (1 + 0.1 * night);
  m.windHz = (420 + 380 * far) * (winter ? 0.8 : 1);
  m.air = winter ? 0.55 : 0.12;
  const total = s.n[0] + s.n[1] + s.n[2] + s.n[3];
  let worksAll = 0;
  for (let i = 0; i < NW; i++) worksAll += s.works[i];
  m.hum = far ** 1.5 * (0.12 + 0.5 * sat(total / 60 + worksAll / 4));
  // (forest is the land's, as the map has it: where a town has been built over it, most of the trees are gone)
  const woods = s.forest * (1 - 0.8 * sat((s.homes + s.shops) / 6));
  const trees = clamp(woods * 1.6 + 0.3 * sat(s.homes / 40) + 0.06);
  m.birds = 16 * trees * BIRD_SEASON[s.season] * (day + 2.2 * dawn) * closeB;
  if (day + dawn < 0.02) m.birds = 0;
  m.birdGain = closeB * (0.55 + 0.45 * close);
  const rural = 1 - 0.7 * sat((s.homes + s.shops) / 40);
  m.crickets = CRICKET_SEASON[s.season] * night * rural * closeB;
  m.owl = 0.6 * night * (winter ? 0.4 : 1) * clamp(woods * 3) * closeB;
  m.water = sat(s.water * 5) * within(s.halfH, 200, 1800);

  // ---- traffic
  let vSum = 0;
  for (let c = 0; c < 4; c++) {
    const moving = 0.35 + 0.65 * clamp(s.v[c] / 12);
    m.eng[c] = close ** 1.3 * ENG_GAIN[c] * sat(s.n[c] / ENG_FULL[c]) * moving;
    m.rate[c] = 0.8 + 0.45 * clamp(s.v[c] / 20);
    vSum += s.n[c] * s.v[c];
  }
  const vAvg = total > 0 ? vSum / total : 0;
  m.tyres = close ** 1.3 * sat(total / 14) * clamp(vAvg / 22) ** 1.5;
  m.tyreHz = 800 + 900 * clamp(vAvg / 25);
  m.idle = close ** 1.2 * sat(s.idle / 6);
  m.street = within(s.halfH, 90, 280);
  m.horn = s.jam > 2 ? live * close * Math.min(3, 0.5 + s.jam * 0.12) * dense : 0;
  m.gate = live * closeW * Math.min(4, s.gate * 6) * dense;

  // ---- works
  for (let i = 0; i < NW; i++) {
    const k = WORKS[i];
    // (a tractor works the fields by day only)
    m.works[i] = closeW ** 1.2 * WORKS_GAIN[k] * sat(s.works[i] / 1.6) * (k === "tractor" ? day : 1);
  }
  const W = (k: WorksBed) => s.works[WORKS.indexOf(k)];
  const ev = live * closeW * dense;
  m.clank = ev * 9 * sat(W("furnace") + 0.3 * W("assembly"));
  m.steam = ev * 1.6 * sat(W("furnace") + 0.5 * W("hiss"));
  m.blast = ev * 0.25 * sat(s.pit) * day;
  m.axe = ev * 4 * sat(s.logging) * day;
  m.rooster = live * closeW * 1.6 * sat(s.farm + s.dairy) * dawn;
  m.cow = ev * 1.2 * sat(s.dairy) * (0.2 + 0.8 * day);
  m.hornTest = ev * 0.8 * sat(s.motor);
  m.clink = ev * 3 * sat(W("glass"));
  m.build = ev * 6 * sat(s.sites / 2) * day;

  // ---- towns
  const awake = smooth(6, 8.5, h) * (1 - smooth(19.5, 22.5, h));
  const size = sat(s.pop / 1500) ** 0.6, built = sat((s.homes + 2 * s.shops) / 25);
  m.murmur = closeT * awake * size * built;
  const open = smooth(7.5, 8.5, h) * (1 - smooth(17.5, 18.5, h));
  m.shopbell = live * closeT * dense * 2.5 * sat(s.shops / 6) * open;
  m.dog = live * closeT * dense * 0.8 * sat(s.homes / 15) * (0.3 + 0.7 * day);
  m.children = live * closeT * 0.7 * sat(s.homes / 20) * smooth(14, 15, h) * (1 - smooth(17, 18, h)) * (winter ? 0.4 : 1);
  m.clock = live * s.hall * within(s.halfH, 400, 4000);
  return m;
}

/** How many strokes the clock gives at an hour (1..12); at a faster game speed it strikes once. */
export function strokes(hour: number, speed: number): number {
  if (speed > 1) return 1;
  const h = ((Math.round(hour) % 12) + 12) % 12;
  return h === 0 ? 12 : h;
}
