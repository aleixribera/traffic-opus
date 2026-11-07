// Map colours, in sRGB hex. Picked against the reference frames: cream ground, lime grass, pale sand,
// periwinkle water, grey terraced mountains; white roads with grey kerbs and a yellow centre line.

export const PAL = {
  ground: 0xf1efe7,
  grass: 0xc6f08f,
  sand: 0xf6e9ab,
  water: 0x9fbaf2,
  waterEdge: 0x8eaaea,
  mountain: [0x8d8c84, 0x9c9b93, 0xabaaa2, 0xbbbab2],
  forestFloor: 0xa9d57a,
  tree: 0x6fae4f,
  treeLight: 0x86c35c,
  // resources overlay
  resFert: 0xd8b44a,
  resForest: 0x3f8f45,
  resOre: 0xb4623a,
  resOil: 0x2c2c34,
  locked: 0x2a2a28,
  road: 0xfbfbf9,
  roadEdge: 0xa5aab0,
  lane: 0xbfc3c8,
  centre: 0xf0bd2c,
  // highways: darker asphalt, darker shoulders, white lines
  hwRoad: 0xc4c8ce,
  hwEdge: 0x7d838b,
  hwLane: 0xffffff,
  deckSide: 0x3c3f44,
  pillar: 0xd9dbdd,
  driveway: 0xe3e5e6,
  bg: 0xd9d6cc,
};

/** Elevation tints used by previews and badges (level 0..3). */
export const LEVEL_TINT = [0x58c8e6, 0x8fd14f, 0x4f8fe8, 0x9a6ae0];

export const CAR_COLORS = [
  0xe8545a, 0xf2a33a, 0xf6d04d, 0x58b368, 0x3fa7d6, 0x5b6fd8, 0xa070d8, 0xe27ab0, 0xf4f4f4, 0x5d6168, 0x2fb5a3, 0xd9875a,
];

export const CARGO_COLOR: Record<string, number> = { ore: 0xf07a2a, food: 0x7cc84a, goods: 0x4f8fe8 };
