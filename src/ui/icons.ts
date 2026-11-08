import { ROAD_TYPES, isHighway, type BuildingKind, type RoadTypeId } from "../config";

/**
 * The pictograms, drawn in one flat period style (docs/ui-style.md, "Icons"): bold silhouettes on a 28 grid (16 for
 * products), cream masses with one or two signal colours, no outlines thinner than 1.2 units, no gradients. They sit
 * on the navy plates, so every shape is light against dark; a dark shape (coal) gets a cream rim.
 * Road icons show the actual lane layout of each type.
 */

/** The icon palette: the theme's colours plus a few material ones. */
const C = {
  cream: "#f3ead6", cream2: "#cfc4ab", ochre: "#e0a833", ochreD: "#a87a1f", brick: "#c0533a", brickD: "#8e3523",
  navy: "#0c1524", slate: "#5d7093", steel: "#9fb0c8", olive: "#7e9f4e", oliveD: "#56702f", wood: "#a8743f",
  woodL: "#d9ad6a", coal: "#2a2f38", ore: "#b0623a", sand: "#e6c98a", glass: "#8fd0d6", fire: "#f08a3a", asphalt: "#46566f",
  copper: "#d07a45", verdigris: "#6fb39a",
};

/** A 16-unit cog outline, shared by the machinery product and the machine works. */
const GEAR = "M6.9 1.5h2.2l.4 1.9 1.3.6 1.6-1.1 1.6 1.6-1.1 1.6.6 1.3 1.9.4v2.2l-1.9.4-.6 1.3 1.1 1.6-1.6 1.6-1.6-1.1-1.3.6-.4 1.9H6.9l-.4-1.9-1.3-.6-1.6 1.1-1.6-1.6 1.1-1.6-.6-1.3-1.9-.4V6.9l1.9-.4.6-1.3-1.1-1.6 1.6-1.6 1.6 1.1 1.3-.6z";

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${body}</svg>`;

export function roadIcon(id: RoadTypeId): string {
  const T = ROAD_TYPES[id];
  const n = T.fwd + T.bwd;
  const med = T.median ? 3 : 0;
  const lw = n + med / 5 > 6 ? 4 : 5;
  const W = n * lw + 4 + med;
  const x0 = (28 - W) / 2;
  // asphalt with cream kerbs; a highway gets the hard shoulder lines too
  const hw = isHighway(T);
  let b = `<rect x="${x0}" y="2" width="${W}" height="24" rx="1" fill="${hw ? "#33415a" : C.asphalt}" stroke="${C.cream2}" stroke-width="1.3"/>`;
  if (hw) b += `<line x1="${x0 + 1.4}" y1="3" x2="${x0 + 1.4}" y2="25" stroke="${C.cream}" stroke-width="0.9"/><line x1="${x0 + W - 1.4}" y1="3" x2="${x0 + W - 1.4}" y2="25" stroke="${C.cream}" stroke-width="0.9"/>`;
  // lanes left of the median sit at x0 + 2 + k * lw; the ones past it shift over by the median
  const lineX = (k: number) => x0 + 2 + k * lw + (med && k > T.bwd ? med : 0);
  for (let k = 1; k < n; k++) {
    const centre = T.bwd > 0 && k === T.bwd;
    if (centre && med) b += `<rect x="${lineX(k)}" y="2.6" width="${med}" height="22.8" fill="${C.olive}"/>`;
    else b += centre
      ? `<line x1="${lineX(k)}" y1="3" x2="${lineX(k)}" y2="25" stroke="${C.ochre}" stroke-width="1.4"/>`
      : `<line x1="${lineX(k)}" y1="4" x2="${lineX(k)}" y2="24" stroke="${C.cream2}" stroke-width="0.9" stroke-dasharray="3 2.4"/>`;
  }
  // direction arrows
  for (let k = 0; k < n; k++) {
    const cx = lineX(k) + (med && k === T.bwd ? med : 0) + lw / 2;
    const up = k >= T.bwd;
    b += up
      ? `<path d="M${cx - 1.6} 12 L${cx} 9 L${cx + 1.6} 12" fill="none" stroke="${C.cream}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`
      : `<path d="M${cx - 1.6} 16 L${cx} 19 L${cx + 1.6} 16" fill="none" stroke="${C.cream}" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>`;
  }
  return svg(28, 28, b);
}

/** A building's pictogram: a company site's own, else a plain gabled house. */
export function buildingIcon(kind: BuildingKind, _zone: string): string {
  const own = placedIcon(kind);
  return own === FALLBACK ? svg(28, 28, `<path d="M5 13 L14 5 L23 13 V24 H5 Z" fill="${C.cream}"/><path d="M3.5 13.5 L14 4.2 L24.5 13.5" fill="none" stroke="${C.brick}" stroke-width="2.4" stroke-linejoin="round"/><rect x="11.5" y="16" width="5" height="8" fill="${C.navy}"/>`) : own;
}

const FALLBACK = svg(28, 28, `<rect x="6" y="6" width="16" height="16" fill="${C.cream2}" transform="rotate(45 14 14)"/>`);

/** Pictograms of the buildings the player places (Industry catalog and inspector). */
export function placedIcon(kind: string): string {
  switch (kind) {
    case "farm":
      // a field of wheat in rows, a red barn and a silo
      return svg(28, 28, `<rect x="2" y="15" width="24" height="10" fill="${C.ochre}"/><path d="M2 18.4 H26 M2 21.8 H26" stroke="${C.ochreD}" stroke-width="1.4"/><path d="M4 15 V9 L9.5 4.6 L15 9 V15 Z" fill="${C.brick}"/><path d="M3.2 9.6 L9.5 4.4 L15.8 9.6" fill="none" stroke="${C.cream}" stroke-width="1.4" stroke-linejoin="round"/><rect x="8" y="10.5" width="3" height="4.5" fill="${C.navy}"/><rect x="18" y="5" width="5" height="10" rx="2.5" fill="${C.cream}"/>`);
    case "loggingcamp":
      // two firs and a stack of logs, end grain showing
      return svg(28, 28, `<path d="M8 2 L13.5 11 H2.5 Z M8 6.5 L14.5 16.5 H1.5 Z" fill="${C.olive}"/><rect x="7" y="16.5" width="2" height="3.5" fill="${C.wood}"/><path d="M19 4 L23.5 11.5 H14.5 Z M19 8 L24.5 16 H13.5 Z" fill="${C.oliveD}"/><circle cx="13" cy="22.6" r="2.9" fill="${C.wood}"/><circle cx="19" cy="22.6" r="2.9" fill="${C.wood}"/><circle cx="25" cy="22.6" r="2.9" fill="${C.wood}"/><circle cx="16" cy="18.2" r="2.9" fill="${C.wood}"/><circle cx="22" cy="18.2" r="2.9" fill="${C.wood}"/><g fill="${C.woodL}"><circle cx="13" cy="22.6" r="1.4"/><circle cx="19" cy="22.6" r="1.4"/><circle cx="25" cy="22.6" r="1.4"/><circle cx="16" cy="18.2" r="1.4"/><circle cx="22" cy="18.2" r="1.4"/></g>`);
    case "foodplant":
      // a sawtooth works shed, a silo, and a crate of food at the door
      return svg(28, 28, `<path d="M2 25 V12 L6.5 8 V12 L11 8 V12 L15.5 8 V25 Z" fill="${C.cream}"/><rect x="18" y="4" width="7" height="21" rx="3.5" fill="${C.steel}"/><path d="M18 10 H25" stroke="${C.slate}" stroke-width="1.2"/><rect x="5" y="17" width="9" height="8" fill="${C.brick}"/><path d="M5 21 H14 M9.5 17 V25" stroke="${C.cream}" stroke-width="1.2"/>`);
    case "sawmill":
      // a long shed, a saw blade and a stack of planks
      return svg(28, 28, `<path d="M2 21 V10 L10 5 L18 10 V21 Z" fill="${C.cream}"/><rect x="6" y="13" width="8" height="8" fill="${C.navy}"/><circle cx="22" cy="10" r="4.6" fill="${C.steel}"/><path d="M22 4.2 L23.4 6 M27.8 10 L26 11.4 M22 15.8 L20.6 14 M16.2 10 L18 8.6" stroke="${C.steel}" stroke-width="1.6"/><circle cx="22" cy="10" r="1.4" fill="${C.navy}"/><rect x="4" y="21" width="22" height="2.4" fill="${C.woodL}"/><rect x="6" y="23.6" width="20" height="2.4" fill="${C.wood}"/>`);
    case "ironmine":
    case "coalmine": {
      // a headframe over the shaft, its winding wheel, and a heap of what comes up: rust-red ore or black coal
      const heap = kind === "ironmine" ? `fill="${C.ore}"` : `fill="${C.coal}" stroke="${C.cream2}" stroke-width="1.2"`;
      return svg(28, 28, `<path d="M4.5 25 L10 5.5 L15.5 25" fill="none" stroke="${C.cream}" stroke-width="2.4" stroke-linejoin="round"/><path d="M7 16 H13" stroke="${C.cream}" stroke-width="2"/><circle cx="10" cy="6" r="3.2" fill="${C.ochre}"/><circle cx="10" cy="6" r="1.1" fill="${C.navy}"/><rect x="2" y="23" width="15" height="2.6" fill="${C.cream2}"/><path d="M14 25.4 Q19.5 12.5 26.5 25.4 Z" ${heap}/>`);
    }
    case "quarry":
      // stepped pale rock benches cut into the ground, a dump truck on the top step
      return svg(28, 28, `<path d="M2 25.5 H26 V20.5 H21 V15.5 H15 V10.5 H9 V5.5 H2 Z" fill="${C.cream2}"/><path d="M2 10.5 H9 M2 15.5 H15 M2 20.5 H21" stroke="#9c927b" stroke-width="1.2"/><path d="M17 6 H25 V10 H17 Z" fill="${C.ochre}"/><path d="M17 6 L19 3.5 H24 L25 6" fill="${C.ochreD}"/><circle cx="19" cy="11" r="1.4" fill="${C.navy}"/><circle cx="23.5" cy="11" r="1.4" fill="${C.navy}"/>`);
    case "smelter":
      // a blast furnace with its glowing mouth, the casting shed beside it
      return svg(28, 28, `<path d="M4 25 L6.5 9 H13.5 L16 25 Z" fill="${C.cream}"/><rect x="8" y="2.5" width="4" height="6.5" fill="${C.cream2}"/><rect x="7.5" y="17" width="5" height="5" fill="${C.fire}"/><path d="M16 25 V14 L21 10.5 L26 14 V25 Z" fill="${C.steel}"/><rect x="18.5" y="18" width="5" height="3" fill="${C.navy}"/>`);
    case "cementworks":
      // a preheater tower, the long kiln sloping away, a cement silo
      return svg(28, 28, `<rect x="2.5" y="6" width="7" height="19" fill="${C.cream}"/><rect x="4.5" y="2.5" width="3" height="3.5" fill="${C.cream2}"/><path d="M4 11 H8 M4 15.5 H8" stroke="${C.navy}" stroke-width="1.4"/><path d="M9.5 19.5 L21 16.5 V21 L9.5 24 Z" fill="${C.steel}"/><rect x="20" y="6" width="6" height="19" rx="3" fill="${C.cream2}"/><path d="M20 11.5 H26" stroke="#9c927b" stroke-width="1.2"/>`);
    case "coalplant":
      // a cooling tower, the boiler house and its smoking stack
      return svg(28, 28, `<path d="M15.5 25 C16.5 19 17.4 13.5 15.8 8 H25.2 C23.6 13.5 24.5 19 25.5 25 Z" fill="${C.cream}"/><rect x="2" y="14" width="13" height="11" fill="${C.steel}"/><rect x="6" y="5" width="3.4" height="9" fill="${C.cream2}"/><rect x="4.5" y="18" width="3" height="3" fill="${C.ochre}"/><rect x="9.5" y="18" width="3" height="3" fill="${C.ochre}"/><circle cx="8.6" cy="3.2" r="2" fill="${C.cream2}"/><circle cx="12" cy="2.4" r="1.5" fill="${C.cream2}"/>`);
    case "oilwell":
      // a pumpjack nodding over the well, a squat tank beside it
      return svg(28, 28, `<rect x="2" y="23" width="24" height="2.6" fill="${C.cream2}"/><path d="M6 23 L10 10.5 L14 23" fill="none" stroke="${C.cream}" stroke-width="2.2" stroke-linejoin="round"/><path d="M2.8 9 L19 12" stroke="${C.ochre}" stroke-width="2.8" stroke-linecap="round"/><path d="M2.6 7.2 Q0.8 9.2 2.6 13 L4.4 12.4 Q3.2 9.8 4.4 7.8 Z" fill="${C.ochre}"/><path d="M3.2 12.8 V23" stroke="${C.cream}" stroke-width="1.2"/><circle cx="10" cy="10.6" r="1.4" fill="${C.navy}"/><rect x="18" y="14" width="7" height="9" rx="1" fill="${C.steel}"/><path d="M18 17 H25" stroke="${C.slate}" stroke-width="1.2"/>`);
    case "sandpit":
      // a pale sand heap in a pit, a conveyor feeding it
      return svg(28, 28, `<path d="M2 25.5 H26 L23 19.5 H5 Z" fill="${C.wood}"/><path d="M4 22.5 Q11 8 18 22.5 Z" fill="${C.sand}"/><path d="M14.5 12.5 L25 7" stroke="${C.cream}" stroke-width="2" stroke-linecap="round"/><path d="M24 7 V19.5" stroke="${C.cream}" stroke-width="1.4"/><rect x="19" y="18" width="6" height="4" fill="${C.ochre}"/>`);
    case "warehouse":
      // a long low shed with a row of dock doors, a trailer backed up to the last one
      return svg(28, 28, `<path d="M2 12.5 L14 6.5 L26 12.5 V25 H2 Z" fill="${C.cream}"/><path d="M1.2 12.8 L14 6.4 L26.8 12.8" fill="none" stroke="${C.cream2}" stroke-width="1.4" stroke-linejoin="round"/><g fill="${C.navy}"><rect x="4" y="16.5" width="4" height="8.5"/><rect x="10" y="16.5" width="4" height="8.5"/><rect x="16" y="16.5" width="4" height="8.5"/></g><path d="M4 19 H8 M10 19 H14 M16 19 H20" stroke="${C.slate}" stroke-width="1.2"/><rect x="21" y="18" width="6" height="7" fill="${C.ochre}"/><path d="M21 21.5 H27" stroke="${C.ochreD}" stroke-width="1.2"/>`);
    case "fueldepot":
      // a horizontal bulk tank on saddles, and a pump under a brick canopy
      return svg(28, 28, `<rect x="2" y="8.5" width="15" height="8.5" rx="4.25" fill="${C.cream}"/><path d="M6 8.5 V17 M13 8.5 V17" stroke="${C.cream2}" stroke-width="1.2"/><path d="M4 17 V22 M13.5 17 V22" stroke="${C.steel}" stroke-width="2.4"/><rect x="2" y="22" width="24" height="3" fill="${C.cream2}"/><rect x="17.5" y="4.5" width="9" height="3" fill="${C.brick}"/><path d="M19 7.5 V22" stroke="${C.cream2}" stroke-width="1.4"/><rect x="21" y="13" width="4.4" height="9" fill="${C.ochre}"/><rect x="22" y="14.4" width="2.4" height="2.4" fill="${C.navy}"/>`);
    case "refinery":
      // a fractionating column, a flare stack burning, two round tanks
      return svg(28, 28, `<rect x="4.5" y="4" width="5.5" height="21" rx="1.5" fill="${C.cream}"/><path d="M4.5 9 H10 M4.5 14 H10 M4.5 19 H10" stroke="${C.navy}" stroke-width="1.2"/><rect x="12" y="8" width="2.2" height="17" fill="${C.cream2}"/><path d="M13.1 8 Q11.2 5 13.1 1.8 Q15 5 13.1 8 Z" fill="${C.fire}"/><rect x="16.4" y="15" width="9.2" height="10" rx="1.5" fill="${C.steel}"/><path d="M16.4 18.5 H25.6" stroke="${C.slate}" stroke-width="1.2"/>`);
    case "glassworks":
      // a furnace hall with a stack, panes of glass leaning on a rack
      return svg(28, 28, `<path d="M2 25 V11 L9 6.5 L16 11 V25 Z" fill="${C.cream}"/><rect x="11.5" y="2" width="3" height="7" fill="${C.cream2}"/><rect x="5" y="16" width="5" height="4" fill="${C.fire}"/><path d="M18 25 L20.6 9.5 H25.4 L22.8 25 Z" fill="${C.glass}"/><path d="M21 14 L24 11.5" stroke="${C.cream}" stroke-width="1.2"/>`);
    case "furniture":
      // a workshop roof, a chair and a table in front
      return svg(28, 28, `<path d="M2 15 V7.5 L7.5 3.5 L13 7.5 L18.5 3.5 L26 7.5 V15 Z" fill="${C.cream}"/><rect x="5" y="9" width="4" height="6" fill="${C.navy}"/><path d="M5.5 25 V17 H8.5 M5.5 21 H11 V25" fill="none" stroke="${C.brick}" stroke-width="2.2" stroke-linejoin="round"/><rect x="14" y="18" width="12" height="2.4" fill="${C.woodL}"/><path d="M15.5 20 V25 M24.5 20 V25" stroke="${C.woodL}" stroke-width="2"/>`);
    case "constructionplant":
      // a yard crane over a stack of prefab panels, a mixer silo
      return svg(28, 28, `<path d="M6 25 V4.5 H24" fill="none" stroke="${C.ochre}" stroke-width="2.4"/><path d="M6 9 L10.5 4.5" stroke="${C.ochre}" stroke-width="1.6"/><path d="M19.5 4.5 V11" stroke="${C.cream2}" stroke-width="1.2"/><rect x="16" y="11" width="7" height="2.6" fill="${C.steel}"/><rect x="10" y="20.4" width="15" height="2.8" fill="${C.cream2}"/><rect x="11" y="17.2" width="13" height="2.8" fill="${C.steel}"/><rect x="1.5" y="14" width="3.5" height="11" rx="1.75" fill="${C.cream}"/>`);
    case "coppermine":
      // an open pit stepped down into the hillside, a conveyor up to a heap of green copper ore
      return svg(28, 28, `<path d="M2 25.5 H17 V21 H13 V16.5 H9 V12 H5.5 V7.5 H2 Z" fill="${C.cream2}"/><path d="M2 12 H5.5 M2 16.5 H9 M2 21 H13" stroke="#9c927b" stroke-width="1.2"/><path d="M13.5 17.5 L21.5 8.5" stroke="${C.cream}" stroke-width="2" stroke-linecap="round"/><path d="M20.5 8.5 V14" stroke="${C.cream}" stroke-width="1.3"/><path d="M14.5 25.5 Q21 11.5 27 25.5 Z" fill="${C.verdigris}"/><rect x="3" y="21.6" width="6" height="3" fill="${C.ochre}"/>`);
    case "coppersmelter":
      // a smelter stack banded in copper, the casting shed, and copper ingots cooling in front
      return svg(28, 28, `<path d="M4 25 L6 8.5 H11 L13 25 Z" fill="${C.cream}"/><rect x="7" y="2.5" width="3" height="6" fill="${C.cream2}"/><path d="M5.3 13.5 H11.7" stroke="${C.copper}" stroke-width="2.2"/><rect x="6.5" y="18" width="4" height="3.6" fill="${C.fire}"/><path d="M13 25 V12.5 L19.5 8.5 L26 12.5 V25 Z" fill="${C.steel}"/><path d="M14.5 24.5 L15.6 21.4 H19.6 L20.7 24.5 Z M20.3 24.5 L21.4 21.4 H25.4 L26.5 24.5 Z" fill="${C.copper}"/><path d="M15.6 21.4 H19.6 M21.4 21.4 H25.4" stroke="${C.cream}" stroke-width="1.2"/>`);
    case "electronics":
      // a clean assembly hall with a glazed sawtooth roof, and a circuit chip in front
      return svg(28, 28, `<path d="M2 21 V12 L6.5 7 V12 L11 7 V12 L15.5 7 V12 L20 7 V12 H26 V21 Z" fill="${C.cream}"/><path d="M6.5 7 V12 M11 7 V12 M15.5 7 V12 M20 7 V12" stroke="${C.glass}" stroke-width="1.6"/><path d="M13 16 V14 M16 16 V14 M19 16 V14 M13 25 V27 M16 25 V27 M19 25 V27 M10 18.5 H8 M10 22.5 H8 M22 18.5 H24 M22 22.5 H24" stroke="${C.cream2}" stroke-width="1.3"/><rect x="10" y="16" width="12" height="9" fill="${C.slate}"/><rect x="13.5" y="18.4" width="5" height="4.2" fill="${C.ochre}"/>`);
    case "machineworks":
      // a tall machine hall under a gantry crane, and a cog in front
      return svg(28, 28, `<path d="M2 25 V10 L12 5.5 L22 10 V25 Z" fill="${C.steel}"/><rect x="5" y="13" width="14" height="3" fill="${C.slate}"/><path d="M4 25 V3.5 M24.5 25 V3.5 M2.5 3.5 H26" fill="none" stroke="${C.ochre}" stroke-width="2"/><path d="M17 3.5 V9" stroke="${C.cream}" stroke-width="1.3"/><rect x="15" y="9" width="4" height="2.2" fill="${C.cream}"/><g transform="translate(4 13.5) scale(0.78)"><path d="${GEAR}" fill="${C.cream}"/><circle cx="8" cy="8" r="2.4" fill="${C.navy}"/></g>`);
    case "hydrodam":
      // the river held back behind a curved concrete wall, a powerhouse at its foot and the spillway's white water
      return svg(28, 28, `<path d="M2 3 H26 V9 Q14 13 2 9 Z" fill="${C.slate}"/><path d="M2 9 Q14 13 26 9 V13 Q14 17 2 13 Z" fill="${C.cream}"/><path d="M9 12.6 V16 M14 13.8 V17 M19 12.6 V16" stroke="${C.cream2}" stroke-width="1.2"/><rect x="8" y="17" width="12" height="7.5" fill="${C.steel}"/><path d="M8 17 H20 L18.5 15.5 H9.5 Z" fill="${C.ochre}"/><path d="M10.5 19 V22.5 M14 19 V22.5 M17.5 19 V22.5" stroke="${C.navy}" stroke-width="1.4"/><path d="M21.5 16 Q23 20 21 25 M24 15 Q25.5 20 24 25" fill="none" stroke="${C.glass}" stroke-width="1.8" stroke-linecap="round"/><path d="M2 25.5 H26" stroke="${C.cream2}" stroke-width="1.6"/>`);
    case "skylinetower":
      // a stepped tower in setbacks under a spire, gilt at each step
      return svg(28, 28, `<path d="M14 1 V6" stroke="${C.ochre}" stroke-width="1.6"/><path d="M11.5 6 H16.5 V10 H18.5 V15 H20.5 V25.5 H7.5 V15 H9.5 V10 H11.5 Z" fill="${C.cream}"/><path d="M11.5 10 H16.5 M9.5 15 H18.5" stroke="${C.ochre}" stroke-width="1.8"/><path d="M12 18 V24 M14 17.5 V24 M16 18 V24 M12.8 7.5 V9 M15.2 7.5 V9" stroke="${C.slate}" stroke-width="1.2"/><path d="M3 25.5 H25" stroke="${C.cream2}" stroke-width="1.6"/>`);
    case "exposition":
      // the fair: a domed hall, the Tower of Light beside it, and a flag
      return svg(28, 28, `<path d="M3 25 V17 H17 V25 Z" fill="${C.cream}"/><path d="M5 17 A5 5 0 0 1 15 17 Z" fill="${C.ochre}"/><path d="M6.5 19.5 V23.5 M10 19.5 V23.5 M13.5 19.5 V23.5" stroke="${C.slate}" stroke-width="1.3"/><path d="M20 25 L21.2 6.5 H22.8 L24 25 Z" fill="${C.cream}"/><circle cx="22" cy="4.8" r="2" fill="${C.ochre}"/><path d="M10 12 V9.5" stroke="${C.cream2}" stroke-width="1"/><path d="M10 9.5 L13.2 10.3 L10 11.1 Z" fill="${C.brick}"/><path d="M2 25.5 H26" stroke="${C.cream2}" stroke-width="1.6"/>`);
    case "chemworks":
      // a reaction column and spherical tanks beside a works shed, a hazard-red drum in front
      return svg(28, 28, `<rect x="3" y="12" width="11" height="13" fill="${C.steel}"/><path d="M3 12 L8.5 8 L14 12 Z" fill="${C.slate}"/><rect x="15.5" y="3" width="4" height="22" rx="1.4" fill="${C.steel}" stroke="${C.slate}" stroke-width="0.8"/><path d="M15.5 8 H19.5 M15.5 13 H19.5" stroke="${C.slate}" stroke-width="0.8"/><circle cx="23.5" cy="19" r="3.4" fill="${C.cream}" stroke="${C.steel}" stroke-width="0.8"/><rect x="21.6" y="22" width="1" height="3" fill="${C.steel}"/><rect x="24.4" y="22" width="1" height="3" fill="${C.steel}"/><rect x="5.5" y="18" width="5" height="6" rx="1" fill="${C.brick}"/><path d="M5.5 20 H10.5 M5.5 22 H10.5" stroke="${C.brickD}" stroke-width="0.7"/>`);
    case "dairyfarm":
      // a gambrel-roofed cow barn, a silo and a fenced green pasture
      return svg(28, 28, `<rect x="2" y="16" width="24" height="9" fill="${C.olive}"/><path d="M2 19 H26 M2 23 H26" stroke="${C.cream}" stroke-width="0.9"/><path d="M4 16 V9 L6.5 6 H13.5 L16 9 V16 Z" fill="${C.brick}"/><path d="M8 16 V11.5 H12 V16" fill="${C.cream}"/><rect x="18" y="4" width="5" height="12" rx="2.5" fill="${C.cream2}" stroke="${C.steel}" stroke-width="0.7"/><ellipse cx="21" cy="21" rx="2.6" ry="1.5" fill="${C.cream}" stroke="${C.slate}" stroke-width="0.7"/><circle cx="21.6" cy="20.8" r="0.7" fill="${C.slate}"/>`);
    case "creamery":
      // a white dairy hall with steel milk silos, and a wheel of cheese
      return svg(28, 28, `<rect x="3" y="11" width="14" height="14" fill="${C.cream}" stroke="${C.steel}" stroke-width="0.8"/><path d="M3 11 L10 6.5 L17 11 Z" fill="${C.steel}"/><rect x="18" y="5" width="3.6" height="20" rx="1.8" fill="${C.cream2}" stroke="${C.steel}" stroke-width="0.6"/><rect x="22.4" y="7" width="3.6" height="18" rx="1.8" fill="${C.cream2}" stroke="${C.steel}" stroke-width="0.6"/><path d="M5 21 L12.5 16.5 L15 21 Z" fill="${C.ochre}" stroke="${C.ochreD}" stroke-width="0.8" stroke-linejoin="round"/><circle cx="10" cy="19.5" r="0.7" fill="${C.ochreD}"/>`);
    case "rubberplant":
      // a curing hall under a stack, and a stack of black tyres
      return svg(28, 28, `<rect x="2" y="10" width="15" height="15" fill="${C.steel}"/><path d="M2 10 L9.5 5.5 L17 10 Z" fill="${C.slate}"/><rect x="12" y="2" width="3" height="8" fill="${C.slate}"/><rect x="5" y="15" width="5" height="4" fill="${C.ochre}"/><g fill="${C.coal}" stroke="${C.steel}" stroke-width="0.6"><ellipse cx="22" cy="23" rx="4.2" ry="1.8"/><ellipse cx="22" cy="19.6" rx="4.2" ry="1.8"/><ellipse cx="22" cy="16.2" rx="4.2" ry="1.8"/></g><ellipse cx="22" cy="16.2" rx="1.6" ry="0.6" fill="${C.steel}"/>`);
    case "motorworks":
      // a long sawtooth assembly hall, and a finished motor car rolling off the line
      return svg(28, 28, `<path d="M2 14 L6 9 V14 L10 9 V14 L14 9 V14 L18 9 V14 L22 9 V14 H26 V20 H2 Z" fill="${C.steel}" stroke="${C.slate}" stroke-width="0.8" stroke-linejoin="round"/><path d="M6 9 V14 M10 9 V14 M14 9 V14 M18 9 V14" stroke="${C.cream}" stroke-width="0.9"/><path d="M6 25 V22.5 L8 20 H16 L18.5 22.5 H21 V25 Z" fill="${C.brick}" stroke="${C.brickD}" stroke-width="0.7" stroke-linejoin="round"/><rect x="9" y="20.8" width="5.6" height="1.8" fill="${C.glass}"/><circle cx="9" cy="25" r="1.6" fill="${C.coal}"/><circle cx="17.5" cy="25" r="1.6" fill="${C.coal}"/>`);
    default:
      return FALLBACK;
  }
}

export const ICON = {
  // public transport: the bar's category (a bus from the front), a stop sign on its pole, and a line
  busCat: svg(28, 28, `<rect x="5.5" y="3.5" width="17" height="19" rx="3" fill="${C.cream}"/><rect x="8" y="6.5" width="12" height="7" rx="1" fill="${C.navy}"/><rect x="8" y="16" width="3.4" height="2.4" fill="${C.ochre}"/><rect x="16.6" y="16" width="3.4" height="2.4" fill="${C.ochre}"/><rect x="7.5" y="22" width="3.4" height="3.5" fill="${C.cream2}"/><rect x="17.1" y="22" width="3.4" height="3.5" fill="${C.cream2}"/>`),
  busStop: svg(28, 28, `<rect x="2" y="22.5" width="24" height="2.6" fill="${C.cream2}"/><path d="M7.5 22.5 V9" stroke="${C.cream}" stroke-width="2"/><circle cx="7.5" cy="7" r="4.6" fill="${C.ochre}"/><rect x="5" y="6" width="5" height="2" fill="${C.navy}"/><path d="M13 9.5 H26 V12 H13 Z" fill="${C.cream}"/><path d="M14.5 12 V22.5 M24.5 12 V22.5" stroke="${C.cream}" stroke-width="1.6"/><rect x="16" y="13.5" width="7" height="7" fill="${C.slate}"/>`),
  busLine: svg(28, 28, `<path d="M5 22 L11 9 L20 18 L24 6" fill="none" stroke="${C.ochre}" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><g fill="${C.cream}" stroke="${C.navy}" stroke-width="1.4"><circle cx="5" cy="22" r="3"/><circle cx="11" cy="9" r="3"/><circle cx="20" cy="18" r="3"/><circle cx="24" cy="6" r="3"/></g>`),
  grid: svg(28, 28, `<rect x="4" y="4" width="20" height="20" fill="none" stroke="${C.cream}" stroke-width="2"/><path d="M4 11 h20 M4 17 h20 M11 4 v20 M17 4 v20" stroke="${C.cream2}" stroke-width="1.4"/>`),
  roundabout: svg(28, 28, `<path d="M14 2 v5 M14 21 v5 M2 14 h5 M21 14 h5" stroke="${C.cream2}" stroke-width="3.4"/><circle cx="14" cy="14" r="7.5" fill="${C.olive}" stroke="${C.cream}" stroke-width="3"/>`),
  junction: svg(28, 28, `<rect x="10" y="2" width="8" height="24" fill="${C.asphalt}"/><rect x="2" y="10" width="24" height="8" fill="${C.asphalt}"/><rect x="18.5" y="2.5" width="6" height="12" rx="1.5" fill="${C.navy}" stroke="${C.cream}" stroke-width="1.2"/><circle cx="21.5" cy="5.6" r="1.7" fill="${C.brick}"/><circle cx="21.5" cy="11.2" r="1.7" fill="${C.olive}"/>`),
  lane: svg(28, 28, `<path d="M11 26 V16 L5.5 10.5 V2 H22 V26 Z" fill="${C.asphalt}"/><path d="M13.6 2.5 V12" stroke="${C.cream2}" stroke-width="1.2" stroke-dasharray="2 1.6"/><path d="M9.4 10.5 V7.4 Q9.4 5.6 7.6 5.6" fill="none" stroke="${C.ochre}" stroke-width="1.9" stroke-linecap="round"/><path d="M8.9 4 L7 5.6 L8.9 7.2" fill="none" stroke="${C.ochre}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.6 23 V7" stroke="${C.cream}" stroke-width="1.8" stroke-linecap="round"/><path d="M15.4 9.2 L17.6 6.6 L19.8 9.2" fill="none" stroke="${C.cream}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`),
  upgrade: svg(28, 28, `<path d="M6 21 L14 7 L22 21" fill="none" stroke="${C.cream}" stroke-width="2.4" stroke-linejoin="round"/><path d="M14 7 v15" stroke="${C.ochre}" stroke-width="1.6" stroke-dasharray="2.4 2"/>`),
  bulldoze: svg(28, 28, `<path d="M3 19.5 H17 L19.5 13.5 H14 L12.5 8 H6.5 Z" fill="${C.ochre}"/><rect x="8" y="9.5" width="3.5" height="3.5" fill="${C.navy}"/><rect x="3" y="19.5" width="16" height="4.5" rx="2.25" fill="${C.cream2}"/><circle cx="7" cy="21.75" r="1.2" fill="${C.navy}"/><circle cx="15" cy="21.75" r="1.2" fill="${C.navy}"/><path d="M20 12 L25.5 21.5 H20.5 Z" fill="${C.steel}"/>`),
  undo: svg(20, 20, `<path d="M7 5 L3 9 L7 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 9 H12 a4.5 4.5 0 0 1 0 9 H9" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  redo: svg(20, 20, `<path d="M13 5 L17 9 L13 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 9 H8 a4.5 4.5 0 0 0 0 9 H11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  pause: svg(16, 16, `<rect x="4" y="3" width="3" height="10" fill="currentColor"/><rect x="9" y="3" width="3" height="10" fill="currentColor"/>`),
  play: svg(16, 16, `<path d="M5 3 L13 8 L5 13 Z" fill="currentColor"/>`),
  fast: svg(16, 16, `<path d="M2 3 L8 8 L2 13 Z M8 3 L14 8 L8 13 Z" fill="currentColor"/>`),
  fastest: svg(18, 16, `<path d="M1 3 L6 8 L1 13 Z M6 3 L11 8 L6 13 Z M11 3 L16 8 L11 13 Z" fill="currentColor"/>`),
  magnifier: svg(14, 14, `<circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M9 9 L12.5 12.5" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  check: svg(14, 14, `<circle cx="7" cy="7" r="6.5" fill="${C.oliveD}"/><path d="M4 7.2 L6.1 9.2 L10 5" fill="none" stroke="${C.cream}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  open: svg(14, 14, `<circle cx="7" cy="7" r="5.6" fill="none" stroke="${C.cream2}" stroke-width="1.6"/>`),
  caret: svg(10, 10, `<path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  menu: svg(16, 16, `<path d="M2.5 4 h11 M2.5 8 h11 M2.5 12 h11" stroke="currentColor" stroke-width="1.8"/>`),
  straight: svg(22, 22, `<path d="M4 18 L18 4" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  arc: svg(22, 22, `<path d="M4 18 Q4 4 18 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  smooth: svg(22, 22, `<path d="M3 17 C11 17 11 5 19 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  curve: svg(22, 22, `<path d="M4 18 Q4 4 18 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="4" cy="4" r="1.8" fill="currentColor"/>`),
  complex: svg(22, 22, `<path d="M3 18 C3 6 19 16 19 4" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><path d="M3 18 V9 M19 4 V12" stroke="currentColor" stroke-width="1.2" stroke-dasharray="1.6 1.6"/>`),
  continuous: svg(22, 22, `<path d="M3 18 H8 Q13 18 13 12 Q13 5 19 5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/><circle cx="8" cy="18" r="1.7" fill="currentColor"/><circle cx="13" cy="12" r="1.7" fill="currentColor"/>`),
  gridMode: svg(22, 22, `<rect x="3.5" y="3.5" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2"/><path d="M3.5 11 h15 M11 3.5 v15" stroke="currentColor" stroke-width="1.5"/>`),
  replace: svg(22, 22, `<path d="M4 8 H16 M13 5 L16 8 L13 11" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 15 H6 M9 12 L6 15 L9 18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`),
  parallel: svg(22, 22, `<path d="M5 19 L15 3 M10 19 L20 3" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/>`),
  magnet: svg(18, 18, `<path d="M4 3 V9 a5 5 0 0 0 10 0 V3" fill="none" stroke="currentColor" stroke-width="2.6"/><path d="M2.8 4.5 h2.4 M12.8 4.5 h2.4" stroke="${C.ochre}" stroke-width="1.4"/>`),
  // (north: a Deco compass needle, brick to the north)
  north: svg(22, 22, `<path d="M11 1.5 L15 11 H7 Z" fill="${C.brick}"/><path d="M7 11 H15 L11 20.5 Z" fill="${C.cream2}"/><circle cx="11" cy="11" r="1.6" fill="${C.navy}"/>`),
  angle: svg(12, 12, `<path d="M2 10 H10 M2 10 L8 3" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  // the build bar's company categories: a works with a chimney, and a town of roofs round a spire
  industry: svg(28, 28, `<path d="M2 25 V13 L8 9 V13 L14 9 V13 L20 9 V25 Z" fill="${C.cream}"/><rect x="20.5" y="4" width="4.5" height="21" fill="${C.cream2}"/><rect x="5" y="17" width="3.2" height="3.2" fill="${C.ochre}"/><rect x="11" y="17" width="3.2" height="3.2" fill="${C.ochre}"/><rect x="20.5" y="7" width="4.5" height="1.6" fill="${C.brick}"/><circle cx="22.8" cy="2.4" r="1.7" fill="${C.cream2}"/>`),
  town: svg(28, 28, `<path d="M2 25 V15.5 L6.5 11.5 L11 15.5 V25 Z" fill="${C.cream2}"/><path d="M10 25 V10 L15 3 L20 10 V25 Z" fill="${C.cream}"/><path d="M19 25 V15.5 L22.5 12 L26 15.5 V25 Z" fill="${C.cream2}"/><path d="M10 10 L15 3 L20 10" fill="none" stroke="${C.brick}" stroke-width="2" stroke-linejoin="round"/><rect x="13.5" y="17" width="3" height="8" fill="${C.navy}"/><circle cx="15" cy="12.5" r="1.6" fill="${C.ochre}"/>`),
  people: svg(14, 14, `<circle cx="7" cy="4.3" r="2.6" fill="currentColor"/><path d="M2 13 a5 5 0 0 1 10 0 Z" fill="currentColor"/>`),
  lock: svg(10, 12, `<rect x="1" y="5" width="8" height="6.5" rx="0.6" fill="currentColor"/><path d="M3 5 V3.6 a2 2 0 0 1 4 0 V5" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
  layers: svg(18, 18, `<path d="M9 2.5 L16 6 L9 9.5 L2 6 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M2 9.5 L9 13 L16 9.5 M2 12.5 L9 16 L16 12.5" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/>`),
  flag: svg(18, 18, `<path d="M4 16.5 V2.5 M4 3 H14 L11.5 6.5 L14 10 H4" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round"/>`),
  coins: svg(18, 18, `<ellipse cx="7" cy="5" rx="4.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M2.5 5 v3.5 c0 1.1 2 2 4.5 2 M2.5 8.5 v3.5 c0 1.1 2 2 4.5 2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12.5" cy="11.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.7"/>`),
  chart: svg(18, 18, `<path d="M2.5 15.5 H15.5" stroke="currentColor" stroke-width="1.7"/><rect x="3.5" y="9" width="2.8" height="5" fill="currentColor"/><rect x="7.6" y="5" width="2.8" height="9" fill="currentColor"/><rect x="11.7" y="2.5" width="2.8" height="11.5" fill="currentColor"/>`),
  car: svg(18, 18, `<path d="M3 11 L4.4 6.6 C4.7 5.7 5.4 5.2 6.3 5.2 H11.7 C12.6 5.2 13.3 5.7 13.6 6.6 L15 11 V14 H3 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><circle cx="6" cy="11" r="1.2" fill="currentColor"/><circle cx="12" cy="11" r="1.2" fill="currentColor"/>`),
  power: svg(28, 28, `<path d="M15.5 2.5 L7 15.5 H13 L11 25.5 L21 11.5 H15 L18 2.5 Z" fill="${C.ochre}"/>`),
  roadCat: svg(28, 28, `<path d="M8 26 L12 2 H16 L20 26 Z" fill="${C.asphalt}"/><path d="M8 26 L12 2 M20 26 L16 2" stroke="${C.cream}" stroke-width="1.8" stroke-linecap="round"/><path d="M14 5 v3.5 M14 12 v4 M14 19.5 v4.5" stroke="${C.ochre}" stroke-width="2" stroke-linecap="round"/>`),
  keys: svg(18, 18, `<rect x="2" y="4.5" width="14" height="9" rx="1" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M5 7.5 h1 M8.5 7.5 h1 M12 7.5 h1 M5.5 10.8 h7" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  /** a company lorry seen from the side: ochre cab, cream box, dark wheels (the inspector's trucks) */
  truck: svg(28, 28, `<rect x="2" y="7" width="15" height="12" fill="${C.cream}"/><path d="M2 10.5 H17" stroke="${C.cream2}" stroke-width="1.2"/><path d="M17.5 10 H22.5 L26 14.5 V19 H17.5 Z" fill="${C.ochre}"/><path d="M19 11.5 H22 L24.2 14.4 H19 Z" fill="${C.navy}"/><rect x="1.5" y="19" width="25" height="2.4" fill="${C.slate}"/><circle cx="7" cy="22" r="2.7" fill="${C.coal}" stroke="${C.cream2}" stroke-width="1.2"/><circle cx="21" cy="22" r="2.7" fill="${C.coal}" stroke="${C.cream2}" stroke-width="1.2"/>`),
  /** a 1930s sedan from the side (the inspector's cars) */
  sedan: svg(28, 28, `<path d="M2.5 19 V15.5 L6 14.6 L9.5 9.2 H18 L22 14.2 L25.5 15 V19 Z" fill="${C.steel}"/><path d="M10.6 10.6 H13.4 V14 H8.6 Z M14.8 10.6 H17.4 L19.8 14 H14.8 Z" fill="${C.navy}"/><path d="M2.5 16.6 H25.5" stroke="${C.cream}" stroke-width="1"/><circle cx="7.5" cy="19.4" r="2.8" fill="${C.coal}" stroke="${C.cream2}" stroke-width="1.2"/><circle cx="20.5" cy="19.4" r="2.8" fill="${C.coal}" stroke="${C.cream2}" stroke-width="1.2"/>`),
  /** the camera follows it: a sight (control glyph, takes the button's colour) */
  follow: svg(18, 18, `<circle cx="9" cy="9" r="5.2" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="9" r="1.7" fill="currentColor"/><path d="M9 1 V4.2 M9 13.8 V17 M1 9 H4.2 M13.8 9 H17" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
  close: svg(14, 14, `<path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/>`),
};

/** Small pictograms of what towns buy (town panel, Towns list, map labels), 16 px. */
export function productIcon(p: string): string {
  switch (p) {
    case "food":
      // an apple
      return svg(16, 16, `<path d="M8 4.6c-1.7-1.3-5.6-1-5.6 3.1 0 3.3 2.3 6.1 3.9 6.1.7 0 1-.4 1.7-.4s1 .4 1.7.4c1.6 0 3.9-2.8 3.9-6.1 0-4.1-3.9-4.4-5.6-3.1z" fill="${C.brick}"/><path d="M8 4.6C8 3.1 8.6 2.1 9.7 1.5" stroke="${C.cream2}" stroke-width="1.3" fill="none" stroke-linecap="round"/><path d="M8.7 3.1c1-1.4 3-1.5 3.5-.9-1 1.1-2.3 1.2-3.5.9z" fill="${C.olive}"/><circle cx="5.6" cy="7.4" r="1" fill="${C.cream}" opacity=".7"/>`);
    case "planks":
      // a stack of boards
      return svg(16, 16, `<rect x="1.5" y="11" width="13" height="3" fill="${C.wood}"/><rect x="2.5" y="7.4" width="12" height="3" fill="${C.woodL}"/><rect x="1" y="3.8" width="12.5" height="3" fill="${C.sand}"/>`);
    case "cement":
      // a sack, tied at the top
      return svg(16, 16, `<path d="M4 3h8l1.4 2.2-.8 8.8H3.4l-.8-8.8z" fill="${C.cream2}"/><path d="M5.2 7.6h5.6M5.6 10h4.8" stroke="${C.navy}" stroke-width="1.1"/><path d="M5 3 L8 1.6 L11 3" fill="none" stroke="${C.cream}" stroke-width="1.1"/>`);
    case "fuel":
      // a jerrycan
      return svg(16, 16, `<path d="M4 3.5h5.5l3 2.8v7.2H4z" fill="${C.ochre}"/><path d="M6 3.5V2h2.5v1.5" fill="none" stroke="${C.ochre}" stroke-width="1.2"/><path d="M5.6 6.8l5 5M10.6 6.8l-5 5" stroke="${C.navy}" stroke-width="1.1"/>`);
    case "goods":
      // an armchair
      return svg(16, 16, `<path d="M3.5 4.5a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v4h-9z" fill="${C.brick}"/><rect x="1.6" y="7.6" width="12.8" height="4" rx="1.2" fill="${C.ore}"/><path d="M3.5 11.6v2M12.5 11.6v2" stroke="${C.cream2}" stroke-width="1.4" stroke-linecap="round"/>`);
    case "parts":
      // a steel I-beam over a precast panel
      return svg(16, 16, `<rect x="2" y="9" width="12" height="5" fill="${C.cream2}"/><path d="M5 11.5h2M9 11.5h2" stroke="${C.navy}" stroke-width="1.1"/><path d="M1.5 2.5h13v1.8h-5.4v1.6h5.4v1.8h-13V5.9h5.4V4.3H1.5z" fill="${C.steel}"/>`);
    case "electronics":
      // a chip on its pins
      return svg(16, 16, `<path d="M5.5 1.5v2.5M8 1.5v2.5M10.5 1.5v2.5M5.5 12v2.5M8 12v2.5M10.5 12v2.5M1.5 5.5h2.5M1.5 8h2.5M1.5 10.5h2.5M12 5.5h2.5M12 8h2.5M12 10.5h2.5" stroke="${C.cream2}" stroke-width="1.3"/><rect x="3.6" y="3.6" width="8.8" height="8.8" fill="${C.steel}"/><rect x="6" y="6" width="4" height="4" fill="${C.ochre}"/>`);
    case "machinery":
      // a cog
      return svg(16, 16, `<path d="${GEAR}" fill="${C.ochre}"/><circle cx="8" cy="8" r="2.4" fill="${C.navy}"/>`);
    case "milk":
      // a milk churn
      return svg(16, 16, `<path d="M5.6 2h4.8v1.4l1.4 1.8v8.3a1 1 0 0 1-1 1H5.2a1 1 0 0 1-1-1V5.2l1.4-1.8z" fill="${C.cream}" stroke="${C.slate}" stroke-width=".9" stroke-linejoin="round"/><path d="M4.2 7.4h7.6" stroke="${C.slate}" stroke-width=".9"/><rect x="5.6" y="1.2" width="4.8" height="1.4" rx=".5" fill="${C.steel}"/>`);
    case "cheese":
      // a wedge of cheese
      return svg(16, 16, `<path d="M1.8 12.5 L13 5.5 L14.4 12.5 Z" fill="${C.ochre}" stroke="${C.ochreD}" stroke-width=".9" stroke-linejoin="round"/><path d="M1.8 12.5 L13 5.5 L9 4 Z" fill="${C.ochre}" stroke="${C.ochreD}" stroke-width=".9" stroke-linejoin="round"/><circle cx="9.5" cy="10.4" r=".9" fill="${C.ochreD}"/><circle cx="12.2" cy="11.2" r=".6" fill="${C.ochreD}"/>`);
    case "cars":
      // a motor car from the side
      return svg(16, 16, `<path d="M1.5 12 V9.6 L3.6 9 L5.4 6 H10.2 L12.4 9 L14.5 9.6 V12 Z" fill="${C.brick}" stroke="${C.brickD}" stroke-width=".9" stroke-linejoin="round"/><path d="M6 6.8 H9.8 L11.3 9 H5.2 Z" fill="${C.glass}"/><circle cx="4.6" cy="12" r="1.7" fill="${C.coal}"/><circle cx="11.4" cy="12" r="1.7" fill="${C.coal}"/>`);
    case "fertilizer":
      // a sack with a sprout on it
      return svg(16, 16, `<path d="M4 3h8l1.3 2.2-.7 8.8H3.4l-.7-8.8z" fill="${C.cream2}" stroke="${C.oliveD}" stroke-width=".9" stroke-linejoin="round"/><path d="M8 12.2V8.2M8 9.6c-1.8 0-2.6-1-2.6-2.4 1.8 0 2.6 1 2.6 2.4zM8 8.8c1.6 0 2.4-.9 2.4-2.2-1.6 0-2.4.9-2.4 2.2z" fill="${C.olive}" stroke="${C.oliveD}" stroke-width=".7"/>`);
    case "explosives":
      // a crate of blasting charges
      return svg(16, 16, `<rect x="1.8" y="6.4" width="12.4" height="7.4" rx=".6" fill="${C.wood}" stroke="${C.wood}" stroke-width=".9"/><path d="M1.8 9.2h12.4" stroke="${C.wood}" stroke-width=".8"/><g fill="${C.brick}" stroke="${C.brickD}" stroke-width=".6"><rect x="3.4" y="2.6" width="2.4" height="4"/><rect x="6.8" y="2.6" width="2.4" height="4"/><rect x="10.2" y="2.6" width="2.4" height="4"/></g>`);
    case "rubber":
      // a tyre
      return svg(16, 16, `<circle cx="8" cy="8" r="6.2" fill="${C.coal}" stroke="${C.coal}" stroke-width=".8"/><circle cx="8" cy="8" r="2.8" fill="${C.steel}" stroke="${C.coal}" stroke-width=".8"/><path d="M8 1.8v2M8 12.2v2M1.8 8h2M12.2 8h2M3.6 3.6l1.4 1.4M11 11l1.4 1.4M3.6 12.4 5 11M11 5l1.4-1.4" stroke="${C.asphalt}" stroke-width=".9"/>`);
    case "slag":
      // a grey heap of slag
      return svg(16, 16, `<path d="M1 13.5 Q4 4.5 8 4.2 Q12 4.5 15 13.5 Z" fill="${C.asphalt}" stroke="${C.coal}" stroke-width=".9"/><circle cx="6" cy="9.6" r=".9" fill="${C.steel}"/><circle cx="9.6" cy="8" r=".7" fill="${C.steel}"/><circle cx="10.4" cy="11.4" r=".9" fill="${C.steel}"/>`);
    case "chips":
      // a pile of wood chips
      return svg(16, 16, `<path d="M1 13.5 Q4 5.5 8 5.2 Q12 5.5 15 13.5 Z" fill="${C.woodL}" stroke="${C.wood}" stroke-width=".9"/><path d="M4.6 10.4l1.6-.8M8 8.2l1.4.6M9.6 11.2l1.8-.4M6.4 12l1-.9" stroke="${C.wood}" stroke-width=".9" stroke-linecap="round"/>`);
    default:
      return svg(16, 16, `<rect x="4" y="4" width="8" height="8" fill="${C.cream2}" transform="rotate(45 8 8)"/>`);
  }
}
