// Map colours, in sRGB hex. A dry, sunlit grassland seen from above: olive grass in soft patches, round shrubs
// with shadows, dark asphalt with a double yellow centre line and white lanes, pale concrete kerbs.

export const PAL = {
  ground: 0xa39a5c,
  groundDark: 0x938c50,
  groundLight: 0xb3a96a,
  grass: 0x8f9a4e, // greener hollows
  sand: 0xc2b27e, // bare dry soil
  speck: 0x6f6a3a,
  shrub: 0x67883a,
  shrubLight: 0x86a24a,
  water: 0x6f9db2,
  waterEdge: 0x5d899e,
  mountain: [0x8f8775, 0x9c9481, 0xa9a18e, 0xb6ae9b],
  forestFloor: 0x7c7e45,
  tree: 0x557a32,
  treeLight: 0x739640,
  // resources overlay
  resFert: 0xe0c040,
  resForest: 0x2f7a3a,
  resOre: 0xc0622e,
  resOil: 0x4b2d63,
  resCoal: 0x2b2b2f,
  resLime: 0xf2eee0,
  resSand: 0xf3d36b,
  resCopper: 0x2fa58c,
  // the same deposits as they show on the ground: soil and rock, not paint
  soilOre: 0x93603f,
  soilCoal: 0x55514a,
  soilLime: 0xd9d3bd,
  soilSand: 0xd8c48a,
  soilOil: 0x4d483c,
  soilCopper: 0x7d9686,
  locked: 0x2a2a28,
  road: 0x3a3d43,
  roadEdge: 0xc9c3ad,
  lane: 0xeeeee8,
  centre: 0xe6b42c,
  // highways: the same asphalt a shade darker, pale shoulders, white lines
  hwRoad: 0x33363b,
  hwEdge: 0xbdb69e,
  hwLane: 0xf4f4ee,
  // town pavements: pale concrete with a darker outer edge against the grass
  sidewalk: 0xc8c2ab,
  sidewalkEdge: 0xa9a283,
  deckSide: 0x2b2d31,
  pillar: 0xb9b5a8,
  // a bridge's parapets: the cream of the Deco courses on its piers and pylons
  parapet: 0xe6dcc3,
  driveway: 0x77787a,
  // dirt roads: packed tan earth, paler gravel on the crown, darker wheel ruts, fading out into the grass
  dirt: 0xb09467,
  dirtLight: 0xc5ac80,
  dirtRut: 0x80664a,
  dirtEdge: 0xa59865,
  // country roads: a grey-tan gravel shoulder (pale chips, darker grit), then a mown verge
  gravel: 0xaa9f88,
  gravelLight: 0xc9bfa6,
  gravelDark: 0x897e69,
  bg: 0x9d955a,
};

/** Elevation tints used by previews and badges (level 0..3). */
export const LEVEL_TINT = [0x58c8e6, 0x8fd14f, 0x4f8fe8, 0x9a6ae0];

/** Parked cars: the same mix as the traffic. */
export const CAR_COLORS = [
  0xf1f1ee, 0xe4e5e3, 0xbfc2c5, 0x8d9095, 0x2a2c30, 0x45484e, 0xa8302c, 0x263f6b, 0x4c6f99, 0xc8b48c, 0x3e5640, 0xd6d8da,
];

/** Load colours on the trucks (match PRODUCTS in game/industry.ts). */
export const CARGO_COLOR: Record<string, number> = {
  crops: 0xd9b44a, logs: 0x8a5a33, food: 0xe2704a, planks: 0xe8cf8f,
  ore: 0x93603f, coal: 0x3a3a3e, lime: 0xd9d3bd, steel: 0x8a96a3, cement: 0xb9b6ae,
  crude: 0x2e2a26, sand: 0xe0c78e, fuel: 0xd99a2b, plastics: 0x6fb7c9, glass: 0x9fd3d6, goods: 0xb0603e, parts: 0x7f8b6a,
  copperore: 0x4f8a78, copper: 0xc4703a, electronics: 0x3f5f8f, machinery: 0xd8a22e,
  fertilizer: 0xb9c98a, explosives: 0xb8402e, rubber: 0x34322f, cars: 0x7a2e2a, milk: 0xf2efe6, cheese: 0xe6bf55,
  slag: 0x5e5a54, chips: 0xc9a46a,
};
/** The Motor Works' liveries (its cars on the streets and on the transporters): maroon, navy, racing green, cream. */
export const MOTOR_LIVERY = [0x7a2e2a, 0x2f4a6a, 0x3f5a3a, 0xd8ccb0];
