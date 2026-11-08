import { ROAD_TYPES, isHighway, type BuildingKind, type RoadTypeId } from "../config";

/** Small hand-drawn SVG pictograms. Road icons show the actual lane layout of each type. */

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${body}</svg>`;

export function roadIcon(id: RoadTypeId): string {
  const T = ROAD_TYPES[id];
  const n = T.fwd + T.bwd;
  const med = T.median ? 3 : 0;
  const lw = n + med / 5 > 6 ? 4 : 5;
  const W = n * lw + 4 + med;
  const x0 = (28 - W) / 2;
  // highways in the map's darker asphalt with white lines, town roads white with grey ones
  const hw = isHighway(T);
  let b = `<rect x="${x0}" y="2" width="${W}" height="24" rx="1.5" fill="${hw ? "#c4c8ce" : "#fff"}" stroke="${hw ? "#6f757d" : "#8d939a"}" stroke-width="1.2"/>`;
  if (hw) b += `<line x1="${x0 + 1.3}" y1="3" x2="${x0 + 1.3}" y2="25" stroke="#fff" stroke-width="0.8"/><line x1="${x0 + W - 1.3}" y1="3" x2="${x0 + W - 1.3}" y2="25" stroke="#fff" stroke-width="0.8"/>`;
  // lanes left of the median sit at x0 + 2 + k * lw; the ones past it shift over by the median
  const lineX = (k: number) => x0 + 2 + k * lw + (med && k > T.bwd ? med : 0);
  for (let k = 1; k < n; k++) {
    const centre = T.bwd > 0 && k === T.bwd;
    if (centre && med) b += `<rect x="${lineX(k)}" y="2.6" width="${med}" height="22.8" fill="#8fc46a" stroke="#6f9a52" stroke-width="0.6"/>`;
    else b += centre
      ? `<line x1="${lineX(k)}" y1="3" x2="${lineX(k)}" y2="25" stroke="#e9b32a" stroke-width="1.3"/>`
      : `<line x1="${lineX(k)}" y1="4" x2="${lineX(k)}" y2="24" stroke="${hw ? "#fff" : "#a9aeb4"}" stroke-width="0.9" stroke-dasharray="3 2.4"/>`;
  }
  // direction arrows
  for (let k = 0; k < n; k++) {
    const cx = lineX(k) + (med && k === T.bwd ? med : 0) + lw / 2;
    const up = k >= T.bwd;
    b += up
      ? `<path d="M${cx - 1.5} 11.5 L${cx} 9 L${cx + 1.5} 11.5" fill="none" stroke="#5b6168" stroke-width="0.9" stroke-linecap="round"/>`
      : `<path d="M${cx - 1.5} 16.5 L${cx} 19 L${cx + 1.5} 16.5" fill="none" stroke="#5b6168" stroke-width="0.9" stroke-linecap="round"/>`;
  }
  return svg(28, 28, b);
}

const ZONE_FILL: Record<string, string> = { res: "#62c043", com: "#2f86e0", ind: "#8f949c" };

export function buildingIcon(kind: BuildingKind, zone: string): string {
  const f = ZONE_FILL[zone];
  const d = "#00000022";
  switch (kind) {
    case "house":
      return svg(28, 28, `<rect x="7" y="13" width="14" height="10" fill="${f}"/><path d="M5 14 L14 6 L23 14 Z" fill="${f}" stroke="${d}"/>`);
    case "terrace":
      return svg(28, 28, `<rect x="3" y="13" width="22" height="10" fill="${f}"/><path d="M2 14 L7.5 8 L13 14 M10 14 L15.5 8 L21 14 M17 14 L21.5 9 L26 14" fill="${f}" stroke="${d}"/>`);
    case "apartments":
      return svg(28, 28, `<rect x="5" y="5" width="18" height="18" fill="#2e8b3e"/><path d="M5 5 L23 23 M23 5 L5 23" stroke="#5fbf6e" stroke-width="1.4"/>`);
    case "shop":
      return svg(28, 28, `<rect x="5" y="9" width="18" height="13" fill="${f}"/><path d="M5 9 h18 M5 12.5 h18 M5 16 h18" stroke="#1d6bbd" stroke-width="1"/>`);
    case "store":
      return svg(28, 28, `<rect x="3" y="7" width="12" height="15" fill="${f}"/><rect x="15" y="10" width="10" height="12" fill="#3b93ea"/><path d="M3 11 h12 M3 15 h12 M15 14 h10" stroke="#1d6bbd"/>`);
    case "mall":
      return svg(28, 28, `<rect x="2" y="6" width="24" height="17" fill="${f}"/><rect x="5" y="9" width="5" height="4" fill="#dfe9f6"/><rect x="12" y="9" width="5" height="4" fill="#dfe9f6"/><rect x="19" y="9" width="4" height="4" fill="#dfe9f6"/>`);
    case "farm":
      return svg(28, 28, `<rect x="3" y="4" width="22" height="20" fill="#cfe59a"/><path d="M3 9 h22 M3 14 h22 M3 19 h22" stroke="#8cc152" stroke-width="2"/><rect x="16" y="15" width="7" height="7" fill="${f}"/>`);
    case "foodplant":
      return svg(28, 28, `<rect x="3" y="11" width="16" height="12" fill="${f}"/><circle cx="22" cy="15" r="4" fill="#d9dbdd"/><path d="M3 15 h16" stroke="#f2c230" stroke-width="2.4"/>`);
    default:
      return placedIcon(kind);
  }
}

/** Pictograms of the buildings the player places (build menu and inspector). */
export function placedIcon(kind: string): string {
  switch (kind) {
    case "farm":
      // a field in rows and a barn
      return svg(28, 28, `<rect x="2" y="12" width="24" height="13" rx="1" fill="#d9b44a"/><path d="M4 15 H24 M4 18.5 H24 M4 22 H24" stroke="#a9862b" stroke-width="1.2"/><path d="M5 12 V7 L10 3.5 L15 7 V12 Z" fill="#b2473a"/><rect x="8.5" y="8" width="3" height="4" fill="#fff"/>`);
    case "loggingcamp":
      // two firs and a stack of logs
      return svg(28, 28, `<path d="M8 2 L13 12 H3 Z M8 7 L14 17 H2 Z" fill="#2f7a3a"/><rect x="7" y="17" width="2" height="4" fill="#6b4a2b"/><path d="M19 4 L23 12 H15 Z M19 8 L24 16 H14 Z" fill="#3b8a45"/><circle cx="14" cy="23" r="2.6" fill="#8a5a33"/><circle cx="19.5" cy="23" r="2.6" fill="#8a5a33"/><circle cx="24.5" cy="23" r="2.6" fill="#8a5a33"/><circle cx="14" cy="23" r="1" fill="#d6b98a"/><circle cx="19.5" cy="23" r="1" fill="#d6b98a"/><circle cx="24.5" cy="23" r="1" fill="#d6b98a"/>`);
    case "foodplant":
      // a works shed with a silo, and a crate of food
      return svg(28, 28, `<rect x="3" y="11" width="15" height="13" fill="#7d8790"/><path d="M3 11 L7.5 7 L12 11 L16.5 7 L18 8.5 V11 Z" fill="#5b6168"/><rect x="19" y="5" width="6" height="19" rx="3" fill="#c9cdd2"/><rect x="6" y="16" width="9" height="8" fill="#e2704a"/><path d="M6 19.5 H15" stroke="#fff" stroke-width="1"/>`);
    case "sawmill":
      // a long shed, a saw blade and planks
      return svg(28, 28, `<rect x="2" y="9" width="17" height="14" fill="#8a6a45"/><path d="M2 9 L10.5 4 L19 9 Z" fill="#5b4630"/><circle cx="22" cy="12" r="4.4" fill="#c9cdd2" stroke="#6d737a" stroke-width="1"/><circle cx="22" cy="12" r="1.2" fill="#6d737a"/><rect x="5" y="18" width="21" height="2.4" fill="#e8cf8f" stroke="#a9862b" stroke-width="0.6"/><rect x="7" y="21" width="19" height="2.4" fill="#e8cf8f" stroke="#a9862b" stroke-width="0.6"/>`);
    case "ironmine":
    case "coalmine": {
      // a headframe over the shaft and a heap of what comes up: rust-red ore or black coal
      const heap = kind === "ironmine" ? "#93603f" : "#34353a";
      return svg(28, 28, `<path d="M5 24 L10 6 L15 24" fill="none" stroke="#545a61" stroke-width="2" stroke-linejoin="round"/><path d="M7 16 H13" stroke="#545a61" stroke-width="1.6"/><circle cx="10" cy="6" r="2.6" fill="#c9cdd2" stroke="#545a61" stroke-width="1.2"/><rect x="3" y="22" width="14" height="3" fill="#7d8790"/><path d="M14 25 Q19.5 13 26 25 Z" fill="${heap}"/>`);
    }
    case "quarry":
      // stepped pale rock benches cut into the ground
      return svg(28, 28, `<path d="M2 25 H26 V20 H21 V15 H15 V10 H9 V5 H2 Z" fill="#d9d3bd" stroke="#8e8670" stroke-width="1"/><path d="M2 10 H9 M2 15 H15 M2 20 H21" stroke="#b5ad94" stroke-width="1"/><rect x="18" y="5" width="7" height="4" rx="1" fill="#e0a526"/><circle cx="19.5" cy="10" r="1.2" fill="#3c3f44"/><circle cx="23.5" cy="10" r="1.2" fill="#3c3f44"/>`);
    case "smelter":
      // a blast furnace stack beside the casting shed, glowing
      return svg(28, 28, `<path d="M5 25 L7 9 H13 L15 25 Z" fill="#6d737a"/><rect x="8" y="3" width="4" height="6" fill="#545a61"/><rect x="15" y="14" width="11" height="11" fill="#7d8790"/><path d="M15 14 L20.5 10 L26 14 Z" fill="#5b6168"/><rect x="7.5" y="18" width="5" height="4" fill="#f08a3a"/><rect x="18" y="19" width="5" height="2" fill="#8a96a3"/>`);
    case "cementworks":
      // a long kiln, a preheater tower and a cement silo
      return svg(28, 28, `<rect x="3" y="6" width="6" height="19" fill="#7d8790"/><rect x="4.5" y="3" width="3" height="3" fill="#545a61"/><path d="M8 20 L22 17 V21 L8 24 Z" fill="#9aa0a6" stroke="#6d737a" stroke-width="0.8"/><rect x="20" y="7" width="6" height="18" rx="3" fill="#c9c6bd"/><path d="M20 12 H26" stroke="#a9a69d" stroke-width="1"/>`);
    case "coalplant":
      return svg(28, 28, `<path d="M17 24 C17.8 18 18.5 13 17.2 8 H24.8 C23.5 13 24.2 18 25 24 Z" fill="#9aa0a6"/><rect x="3" y="14" width="13" height="10" fill="#6d737a"/><rect x="7" y="5" width="3" height="9" fill="#545a61"/><circle cx="9" cy="3.6" r="2" fill="#c9cdd2"/><circle cx="12" cy="2.6" r="1.5" fill="#dde0e3"/>`);
    case "oilwell":
      // a pumpjack nodding over the well, a squat tank beside it
      return svg(28, 28, `<rect x="2" y="23" width="24" height="2.4" fill="#7d8790"/><path d="M6 23 L10 10 L14 23" fill="none" stroke="#545a61" stroke-width="1.8" stroke-linejoin="round"/><path d="M2.5 9 L19 12" stroke="#3c4148" stroke-width="2.6" stroke-linecap="round"/><path d="M2.5 7.5 Q1 9 2.5 12.5 L4 12 Q3 9.5 4 8 Z" fill="#3c4148"/><path d="M3 12.5 V23" stroke="#3c4148" stroke-width="1"/><circle cx="10" cy="10.5" r="1.3" fill="#d9b13a"/><rect x="18" y="14" width="7" height="9" rx="1" fill="#dde0e4" stroke="#8d939a" stroke-width="0.8"/>`);
    case "sandpit":
      // a pale sand heap in a pit, a conveyor feeding it
      return svg(28, 28, `<path d="M2 25 H26 L23 19 H5 Z" fill="#b8a77a"/><path d="M4 22 Q11 8 18 22 Z" fill="#e0c78e" stroke="#b39a5c" stroke-width="0.8"/><path d="M15 12 L25 7" stroke="#545a61" stroke-width="1.8" stroke-linecap="round"/><path d="M24 7 V19" stroke="#545a61" stroke-width="1.2"/><rect x="19" y="18" width="6" height="4" rx="0.8" fill="#e0a526"/>`);
    case "refinery":
      // a fractionating column with a flare stack and two round tanks
      return svg(28, 28, `<rect x="5" y="4" width="5" height="21" rx="1.4" fill="#b0b5bc" stroke="#6d737a" stroke-width="0.8"/><path d="M5 9 H10 M5 14 H10 M5 19 H10" stroke="#6d737a" stroke-width="0.8"/><rect x="12" y="7" width="2" height="18" fill="#545a61"/><path d="M13 7 Q11.4 4.6 13 2.2 Q14.6 4.6 13 7 Z" fill="#f08a3a"/><ellipse cx="21" cy="17" rx="4.6" ry="1.6" fill="#eef0f2"/><rect x="16.4" y="17" width="9.2" height="7" fill="#dde0e4"/><ellipse cx="21" cy="24" rx="4.6" ry="1.4" fill="#c9cdd2"/>`);
    case "glassworks":
      // a furnace hall with a stack, panes of glass leaning on a rack
      return svg(28, 28, `<rect x="3" y="11" width="14" height="14" fill="#7d8790"/><path d="M3 11 L10 6 L17 11 Z" fill="#5b6168"/><rect x="12" y="2" width="3" height="9" fill="#545a61"/><rect x="6" y="17" width="5" height="3.4" fill="#f08a3a"/><path d="M19 25 L21.5 10 H25.5 L23 25 Z" fill="#9fd3d6" stroke="#4f8f96" stroke-width="0.9"/><path d="M21 14 L23.5 12" stroke="#fff" stroke-width="0.9"/>`);
    case "furniture":
      // a workshop roof and a chair and a table in front
      return svg(28, 28, `<rect x="3" y="7" width="22" height="9" fill="#a37a52"/><path d="M3 7 L8.5 3 L14 7 L19.5 3 L25 7 Z" fill="#6b4a2b"/><path d="M6 25 V17 H9 M6 21 H11 V25" fill="none" stroke="#b0603e" stroke-width="1.8" stroke-linejoin="round"/><rect x="14" y="18" width="11" height="2" fill="#b0603e"/><path d="M15.5 20 V25 M23.5 20 V25" stroke="#b0603e" stroke-width="1.8"/>`);
    case "constructionplant":
      // a yard crane over a stack of prefab panels and a mixer silo
      return svg(28, 28, `<path d="M6 25 V5 H23" fill="none" stroke="#d9b13a" stroke-width="2"/><path d="M6 9 L10 5" stroke="#d9b13a" stroke-width="1.4"/><path d="M19 5 V11" stroke="#545a61" stroke-width="1"/><rect x="15.5" y="11" width="7" height="2.4" fill="#7f8b6a"/><rect x="10" y="20" width="15" height="2.4" fill="#9aa48a" stroke="#5f6a4c" stroke-width="0.6"/><rect x="11" y="17.2" width="13" height="2.4" fill="#9aa48a" stroke="#5f6a4c" stroke-width="0.6"/><rect x="2" y="15" width="3" height="10" rx="1.5" fill="#c9c6bd"/>`);
    default:
      return svg(28, 28, `<circle cx="14" cy="14" r="9" fill="#9aa0a6"/>`);
  }
}

export const ICON = {
  // public transport: the bar's category (a bus seen from the front), a stop sign on its pole, and a line
  busCat: svg(28, 28, `<rect x="6" y="4" width="16" height="18" rx="3" fill="#5b6168"/><rect x="8.5" y="7" width="11" height="6.5" rx="1" fill="#fff"/><circle cx="10" cy="17.5" r="1.4" fill="#fff"/><circle cx="18" cy="17.5" r="1.4" fill="#fff"/><rect x="8" y="22" width="3" height="3" rx="0.8" fill="#5b6168"/><rect x="17" y="22" width="3" height="3" rx="0.8" fill="#5b6168"/>`),
  busStop: svg(28, 28, `<rect x="3" y="21" width="22" height="3" fill="#d6d8d4"/><path d="M8 21 V7" stroke="#3c4148" stroke-width="1.8"/><rect x="4" y="3" width="8" height="7" rx="1.2" fill="#2f6fd0"/><rect x="5.6" y="5.6" width="4.8" height="1.8" fill="#fff"/><path d="M13 9 H25 V11 H13 Z" fill="#9aa0a6"/><path d="M14.5 11 V21 M23.5 11 V21" stroke="#3c4148" stroke-width="1.4"/><rect x="15.5" y="12" width="7" height="8" fill="#cfe6f2"/>`),
  busLine: svg(28, 28, `<path d="M5 22 L11 9 L20 18 L24 6" fill="none" stroke="#e0533d" stroke-width="3" stroke-linejoin="round" stroke-linecap="round"/><circle cx="5" cy="22" r="2.8" fill="#fff" stroke="#3c4148" stroke-width="1.4"/><circle cx="11" cy="9" r="2.8" fill="#fff" stroke="#3c4148" stroke-width="1.4"/><circle cx="20" cy="18" r="2.8" fill="#fff" stroke="#3c4148" stroke-width="1.4"/><circle cx="24" cy="6" r="2.8" fill="#fff" stroke="#3c4148" stroke-width="1.4"/>`),
  grid: svg(28, 28, `<rect x="4" y="4" width="20" height="20" rx="2" fill="none" stroke="#5b6168" stroke-width="1.6"/><path d="M4 11 h20 M4 17 h20 M11 4 v20 M17 4 v20" stroke="#5b6168" stroke-width="1.2"/>`),
  roundabout: svg(28, 28, `<circle cx="14" cy="14" r="8" fill="none" stroke="#5b6168" stroke-width="3.2"/><path d="M14 2 v4 M14 22 v4 M2 14 h4 M22 14 h4" stroke="#5b6168" stroke-width="3"/>`),
  junction: svg(28, 28, `<rect x="10" y="3" width="8" height="22" rx="1" fill="#fff" stroke="#8d939a"/><rect x="3" y="10" width="22" height="8" rx="1" fill="#fff" stroke="#8d939a"/><circle cx="14" cy="14" r="2.6" fill="#34c25a"/><circle cx="20.5" cy="7" r="2" fill="#e5484d"/>`),
  lane: svg(28, 28, `<path d="M11 25 V16 L6 11 V3 H21 V25 Z" fill="#fff" stroke="#8d939a"/><path d="M13.5 3 V12" stroke="#8d939a" stroke-width="1.2" stroke-dasharray="2 1.6"/><path d="M9.6 10.5 V7.4 Q9.6 5.6 7.8 5.6" fill="none" stroke="#34c25a" stroke-width="1.7" stroke-linecap="round"/><path d="M9 4.3 L7.3 5.6 L9 6.9" fill="none" stroke="#34c25a" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/><path d="M17.3 22 V7" stroke="#5b6168" stroke-width="1.6" stroke-linecap="round"/><path d="M15.3 9 L17.3 6.6 L19.3 9" fill="none" stroke="#5b6168" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  upgrade: svg(28, 28, `<path d="M6 21 L14 7 L22 21" fill="none" stroke="#5b6168" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 7 v15" stroke="#5b6168" stroke-width="1.4" stroke-dasharray="2.4 2"/>`),
  bulldoze: svg(28, 28, `<path d="M4 19 h13 l3 -6 h-6 l-2 -5 h-5 z" fill="#f2b632" stroke="#6b5314" stroke-width="1"/><circle cx="8" cy="21" r="2.4" fill="#3c3f44"/><circle cx="15" cy="21" r="2.4" fill="#3c3f44"/><path d="M20 13 l4 8 h-4" fill="#9aa0a6"/>`),
  undo: svg(20, 20, `<path d="M7 5 L3 9 L7 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M3.5 9 H12 a4.5 4.5 0 0 1 0 9 H9" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  redo: svg(20, 20, `<path d="M13 5 L17 9 L13 13" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M16.5 9 H8 a4.5 4.5 0 0 0 0 9 H11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  pause: svg(16, 16, `<rect x="4" y="3" width="3" height="10" rx="0.6" fill="currentColor"/><rect x="9" y="3" width="3" height="10" rx="0.6" fill="currentColor"/>`),
  play: svg(16, 16, `<path d="M5 3 L13 8 L5 13 Z" fill="currentColor"/>`),
  fast: svg(16, 16, `<path d="M2 3 L8 8 L2 13 Z M8 3 L14 8 L8 13 Z" fill="currentColor"/>`),
  fastest: svg(18, 16, `<path d="M1 3 L6 8 L1 13 Z M6 3 L11 8 L6 13 Z M11 3 L16 8 L11 13 Z" fill="currentColor"/>`),
  magnifier: svg(14, 14, `<circle cx="6" cy="6" r="4" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M9 9 L12.5 12.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>`),
  check: svg(14, 14, `<circle cx="7" cy="7" r="6.5" fill="#3fb45a"/><path d="M4 7.2 L6.1 9.2 L10 5" fill="none" stroke="#fff" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/>`),
  open: svg(14, 14, `<circle cx="7" cy="7" r="5.8" fill="none" stroke="#a7acb2" stroke-width="1.4"/>`),
  caret: svg(10, 10, `<path d="M2 3.5 L5 6.5 L8 3.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>`),
  menu: svg(16, 16, `<path d="M3 4.5 h10 M3 8 h10 M3 11.5 h10" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>`),
  straight: svg(22, 22, `<path d="M4 18 L18 4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  arc: svg(22, 22, `<path d="M4 18 Q4 4 18 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  smooth: svg(22, 22, `<path d="M3 17 C11 17 11 5 19 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  curve: svg(22, 22, `<path d="M4 18 Q4 4 18 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="4" cy="4" r="1.6" fill="currentColor"/>`),
  complex: svg(22, 22, `<path d="M3 18 C3 6 19 16 19 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><path d="M3 18 V9 M19 4 V12" stroke="currentColor" stroke-width="1" stroke-dasharray="1.6 1.6"/>`),
  continuous: svg(22, 22, `<path d="M3 18 H8 Q13 18 13 12 Q13 5 19 5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/><circle cx="8" cy="18" r="1.5" fill="currentColor"/><circle cx="13" cy="12" r="1.5" fill="currentColor"/>`),
  gridMode: svg(22, 22, `<rect x="3.5" y="3.5" width="15" height="15" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M3.5 11 h15 M11 3.5 v15" stroke="currentColor" stroke-width="1.4"/>`),
  replace: svg(22, 22, `<path d="M4 8 H16 M13 5 L16 8 L13 11" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/><path d="M18 15 H6 M9 12 L6 15 L9 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`),
  parallel: svg(22, 22, `<path d="M5 19 L15 3 M10 19 L20 3" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>`),
  magnet: svg(18, 18, `<path d="M4 3 V9 a5 5 0 0 0 10 0 V3" fill="none" stroke="currentColor" stroke-width="2.4"/><path d="M2.8 4.5 h2.4 M12.8 4.5 h2.4" stroke="#fff" stroke-width="1.2"/>`),
  north: svg(22, 22, `<path d="M11 2 L15 12 H7 Z" fill="#d6453d"/><path d="M7 12 H15 L11 20 Z" fill="#9aa0a6"/>`),
  angle: svg(12, 12, `<path d="M2 10 H10 M2 10 L8 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  // the build bar's company categories: a factory with a chimney, and a town of roofs round a centre
  industry: svg(28, 28, `<path d="M3 25 V13 L9 9 V13 L15 9 V13 L21 9 V25 Z" fill="#6d737a"/><rect x="21" y="4" width="4" height="21" fill="#545a61"/><rect x="6" y="17" width="3" height="3" fill="#f2c94c"/><rect x="12" y="17" width="3" height="3" fill="#f2c94c"/><circle cx="23" cy="2.6" r="1.6" fill="#c9cdd2"/>`),
  town: svg(28, 28, `<path d="M2 25 V15 L7 11 L12 15 V25 Z" fill="#c9875a"/><path d="M10 25 V10 L15.5 5 L21 10 V25 Z" fill="#b2473a"/><path d="M18 25 V16 L22 12.5 L26 16 V25 Z" fill="#d9a066"/><rect x="13.5" y="16" width="4" height="9" fill="#fff"/><rect x="5" y="18" width="3" height="3" fill="#fff"/>`),
  people: svg(14, 14, `<circle cx="7" cy="4.3" r="2.6" fill="currentColor"/><path d="M2 13 a5 5 0 0 1 10 0 Z" fill="currentColor"/>`),
  lock: svg(10, 12, `<rect x="1" y="5" width="8" height="6.5" rx="1" fill="currentColor"/><path d="M3 5 V3.6 a2 2 0 0 1 4 0 V5" fill="none" stroke="currentColor" stroke-width="1.4"/>`),
  layers: svg(18, 18, `<path d="M9 2.5 L16 6 L9 9.5 L2 6 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 9.5 L9 13 L16 9.5 M2 12.5 L9 16 L16 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  flag: svg(18, 18, `<path d="M4 16 V2.5 M4 3 H14 L11.5 6.5 L14 10 H4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`),
  coins: svg(18, 18, `<ellipse cx="7" cy="5" rx="4.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 5 v3.5 c0 1.1 2 2 4.5 2 M2.5 8.5 v3.5 c0 1.1 2 2 4.5 2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12.5" cy="11.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
  chart: svg(18, 18, `<path d="M2.5 15.5 H15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="3.5" y="9" width="2.6" height="5" fill="currentColor"/><rect x="7.7" y="5" width="2.6" height="9" fill="currentColor"/><rect x="11.9" y="2.5" width="2.6" height="11.5" fill="currentColor"/>`),
  car: svg(18, 18, `<path d="M3 11 L4.4 6.6 C4.7 5.7 5.4 5.2 6.3 5.2 H11.7 C12.6 5.2 13.3 5.7 13.6 6.6 L15 11 V14 H3 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6" cy="11" r="1.1" fill="currentColor"/><circle cx="12" cy="11" r="1.1" fill="currentColor"/>`),
  power: svg(28, 28, `<path d="M15.5 2.5 L7 15.5 H13 L11 25.5 L21 11.5 H15 L18 2.5 Z" fill="#5b6168"/>`),
  roadCat: svg(28, 28, `<path d="M9 26 L12 2 M19 26 L16 2" stroke="#5b6168" stroke-width="2" stroke-linecap="round"/><path d="M14 5 v3.5 M14 12 v4 M14 19.5 v4" stroke="#e9b32a" stroke-width="1.8" stroke-linecap="round"/>`),
  keys: svg(18, 18, `<rect x="2" y="4.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 7.5 h1 M8.5 7.5 h1 M12 7.5 h1 M5.5 10.8 h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  close: svg(14, 14,`<path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
};

/** Small pictograms of what towns buy (town panel, Towns list, map labels), 16 px. */
export function productIcon(p: string): string {
  switch (p) {
    case "food":
      // an apple
      return svg(16, 16, `<path d="M8 4.6c-1.7-1.3-5.6-1-5.6 3.1 0 3.3 2.3 6.1 3.9 6.1.7 0 1-.4 1.7-.4s1 .4 1.7.4c1.6 0 3.9-2.8 3.9-6.1 0-4.1-3.9-4.4-5.6-3.1z" fill="#d4553a"/><path d="M8 4.6C8 3.1 8.6 2.1 9.7 1.5" stroke="#5a3b1e" stroke-width="1.2" fill="none" stroke-linecap="round"/><path d="M8.7 3.1c1-1.4 3-1.5 3.5-.9-1 1.1-2.3 1.2-3.5.9z" fill="#4f8a3a"/>`);
    case "planks":
      // a stack of boards
      return svg(16, 16, `<g stroke="#7d5a26" stroke-width=".9"><rect x="1.5" y="10.6" width="13" height="3" rx=".5" fill="#c99a52"/><rect x="2.5" y="7.1" width="12" height="3" rx=".5" fill="#ddb470"/><rect x="1" y="3.6" width="12.5" height="3" rx=".5" fill="#e8cf8f"/></g>`);
    case "cement":
      // a sack
      return svg(16, 16, `<path d="M4 3h8l1.3 2.2-.7 8.8H3.4l-.7-8.8z" fill="#cfccc3" stroke="#625f58" stroke-width=".9" stroke-linejoin="round"/><path d="M5.2 7.2h5.6M5.6 9.6h4.8" stroke="#625f58" stroke-width=".9"/>`);
    case "fuel":
      // a jerrycan
      return svg(16, 16, `<path d="M4 3.5h5.5l3 2.8v7.2H4z" fill="#d99a2b" stroke="#7a5512" stroke-width=".9" stroke-linejoin="round"/><path d="M6 3.5V2h2.5v1.5" fill="none" stroke="#7a5512" stroke-width=".9"/><path d="M5.6 6.6l5 5M10.6 6.6l-5 5" stroke="#7a5512" stroke-width=".8"/>`);
    case "goods":
      // an armchair
      return svg(16, 16, `<path d="M3.5 4.5a1.5 1.5 0 0 1 1.5-1.5h6a1.5 1.5 0 0 1 1.5 1.5v4h-9z" fill="#c4744f" stroke="#6b3a24" stroke-width=".9"/><rect x="1.6" y="7.6" width="12.8" height="4" rx="1.2" fill="#b0603e" stroke="#6b3a24" stroke-width=".9"/><path d="M3.5 11.6v2M12.5 11.6v2" stroke="#6b3a24" stroke-width="1.2" stroke-linecap="round"/>`);
    case "parts":
      // a steel I-beam over a precast panel
      return svg(16, 16, `<rect x="2" y="9" width="12" height="5" rx=".4" fill="#b8bfa8" stroke="#5f6a4c" stroke-width=".9"/><path d="M5 11.5h2M9 11.5h2" stroke="#5f6a4c" stroke-width=".9"/><path d="M1.5 2.5h13v1.6h-5.6v1.8h5.6v1.6h-13V5.9h5.6V4.1H1.5z" fill="#8a96a3" stroke="#4b5560" stroke-width=".7" stroke-linejoin="round"/>`);
    default:
      return svg(16, 16, `<circle cx="8" cy="8" r="5.5" fill="#9aa0a6"/>`);
  }
}
