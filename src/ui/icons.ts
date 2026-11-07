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

const ZONE_FILL: Record<string, string> = { res: "#62c043", com: "#2f86e0", work: "#7f62cc", ind: "#8f949c" };

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
    case "office":
      return svg(28, 28, `<rect x="7" y="5" width="14" height="18" fill="${f}"/><path d="M7 9 h14 M7 13 h14 M7 17 h14" stroke="#c9bdf0" stroke-width="1.2"/>`);
    case "tower":
      return svg(28, 28, `<rect x="5" y="9" width="18" height="14" fill="#6b51b8"/><rect x="9" y="3" width="10" height="20" fill="${f}"/><path d="M9 7 h10 M9 11 h10 M9 15 h10" stroke="#c9bdf0"/>`);
    case "mine":
      return svg(28, 28, `<path d="M3 23 L11 9 L16 15 L19 11 L26 23 Z" fill="#7c7b72"/><rect x="8" y="16" width="10" height="7" fill="${f}"/><rect x="8" y="16" width="10" height="2.5" fill="#f07a2a"/>`);
    case "farm":
      return svg(28, 28, `<rect x="3" y="4" width="22" height="20" fill="#cfe59a"/><path d="M3 9 h22 M3 14 h22 M3 19 h22" stroke="#8cc152" stroke-width="2"/><rect x="16" y="15" width="7" height="7" fill="${f}"/>`);
    case "works":
      return svg(28, 28, `<rect x="3" y="11" width="22" height="12" fill="${f}"/><rect x="6" y="4" width="3" height="8" fill="#6d7178"/><rect x="12" y="6" width="3" height="6" fill="#6d7178"/><path d="M3 15 h22" stroke="#f07a2a" stroke-width="2.4"/>`);
    case "foodplant":
      return svg(28, 28, `<rect x="3" y="11" width="16" height="12" fill="${f}"/><circle cx="22" cy="15" r="4" fill="#d9dbdd"/><path d="M3 15 h16" stroke="#f2c230" stroke-width="2.4"/>`);
    default:
      return serviceIcon(kind);
  }
}

/** Service pictograms (build menu, inspector and map notifications). */
export function serviceIcon(kind: string): string {
  switch (kind) {
    case "garbage":
      return svg(28, 28, `<rect x="8" y="9" width="12" height="15" rx="1.2" fill="#7d8a3c"/><rect x="6" y="6.5" width="16" height="3" rx="1" fill="#5d682b"/><rect x="12" y="4" width="4" height="2.6" rx="0.8" fill="#5d682b"/><path d="M11.5 12 v9 M16.5 12 v9" stroke="#b9c47a" stroke-width="1.2"/>`);
    case "firestation":
      return svg(28, 28, `<path d="M14 3 C16 8 21 10 21 16.5 A7 7 0 0 1 7 16.5 C7 12.5 10 11 10.5 7.5 C12.5 9.5 12.5 11.5 12.5 12.5 C14.5 10.5 15 7 14 3 Z" fill="#e5484d"/><path d="M14 13 C15.5 15.5 17 16.5 17 18.5 A3 3 0 0 1 11 18.5 C11 16.5 13 15.5 14 13 Z" fill="#f6b13c"/>`);
    case "police":
      return svg(28, 28, `<path d="M14 3 L23 6.5 V13 C23 19 19 23 14 25 C9 23 5 19 5 13 V6.5 Z" fill="#2f5fd0"/><path d="M14 9 l1.6 3.3 3.6 0.5 -2.6 2.5 0.6 3.6 -3.2 -1.7 -3.2 1.7 0.6 -3.6 -2.6 -2.5 3.6 -0.5 Z" fill="#f2d24a"/>`);
    case "clinic":
    case "hospital":
      return svg(28, 28, `<rect x="4" y="4" width="20" height="20" rx="3" fill="${kind === "hospital" ? "#c7314a" : "#e0475f"}"/><path d="M14 8 v12 M8 14 h12" stroke="#fff" stroke-width="4"/>`);
    case "school":
      return svg(28, 28, `<path d="M4 12 L14 5 L24 12 Z" fill="#c9832e"/><rect x="6" y="12" width="16" height="11" fill="#e8a24a"/><rect x="12" y="16" width="4" height="7" fill="#7a4d17"/><circle cx="14" cy="9.5" r="1.4" fill="#fff3d6"/>`);
    case "highschool":
    case "university":
      return svg(28, 28, `<path d="M2 11 L14 5 L26 11 L14 17 Z" fill="${kind === "university" ? "#6a3fb5" : "#c9832e"}"/><path d="M7 13.5 V19 C9 22 19 22 21 19 V13.5 L14 17 Z" fill="${kind === "university" ? "#8c64d4" : "#e8a24a"}"/><path d="M24 11 V18" stroke="#3a3f45" stroke-width="1.2"/><circle cx="24" cy="18.5" r="1.3" fill="#3a3f45"/>`);
    case "park":
      return svg(28, 28, `<rect x="13" y="16" width="2.4" height="8" fill="#7a5a33"/><circle cx="14.2" cy="11" r="7" fill="#4fa64a"/><circle cx="11.5" cy="9" r="2.4" fill="#6cc066"/>`);
    case "parklarge":
      return svg(28, 28, `<ellipse cx="18" cy="20" rx="7" ry="3.6" fill="#5fb3e0"/><rect x="8" y="15" width="2" height="8" fill="#7a5a33"/><circle cx="9" cy="11" r="6" fill="#4fa64a"/><circle cx="19.5" cy="9.5" r="4.6" fill="#3f8f3c"/><rect x="18.8" y="12" width="1.6" height="5" fill="#7a5a33"/>`);
    case "sick":
      return svg(28, 28, `<rect x="4" y="4" width="20" height="20" rx="3" fill="#e0475f"/><path d="M14 8 v12 M8 14 h12" stroke="#fff" stroke-width="4"/>`);
    case "crime":
      return svg(28, 28, `<path d="M14 3 L23 6.5 V13 C23 19 19 23 14 25 C9 23 5 19 5 13 V6.5 Z" fill="#2f5fd0"/><path d="M14 8 v9" stroke="#fff" stroke-width="3" stroke-linecap="round"/><circle cx="14" cy="21" r="1.7" fill="#fff"/>`);
    default:
      return svg(28, 28, `<circle cx="14" cy="14" r="9" fill="#9aa0a6"/>`);
  }
}

export const ICON = {
  grid: svg(28, 28, `<rect x="4" y="4" width="20" height="20" rx="2" fill="none" stroke="#5b6168" stroke-width="1.6"/><path d="M4 11 h20 M4 17 h20 M11 4 v20 M17 4 v20" stroke="#5b6168" stroke-width="1.2"/>`),
  roundabout: svg(28, 28, `<circle cx="14" cy="14" r="8" fill="none" stroke="#5b6168" stroke-width="3.2"/><path d="M14 2 v4 M14 22 v4 M2 14 h4 M22 14 h4" stroke="#5b6168" stroke-width="3"/>`),
  junction: svg(28, 28, `<rect x="10" y="3" width="8" height="22" rx="1" fill="#fff" stroke="#8d939a"/><rect x="3" y="10" width="22" height="8" rx="1" fill="#fff" stroke="#8d939a"/><circle cx="14" cy="14" r="2.6" fill="#34c25a"/><circle cx="20.5" cy="7" r="2" fill="#e5484d"/>`),
  upgrade: svg(28, 28, `<path d="M6 21 L14 7 L22 21" fill="none" stroke="#5b6168" stroke-width="2.2" stroke-linejoin="round"/><path d="M14 7 v15" stroke="#5b6168" stroke-width="1.4" stroke-dasharray="2.4 2"/>`),
  bulldoze: svg(28, 28, `<path d="M4 19 h13 l3 -6 h-6 l-2 -5 h-5 z" fill="#f2b632" stroke="#6b5314" stroke-width="1"/><circle cx="8" cy="21" r="2.4" fill="#3c3f44"/><circle cx="15" cy="21" r="2.4" fill="#3c3f44"/><path d="M20 13 l4 8 h-4" fill="#9aa0a6"/>`),
  unlock: svg(28, 28, `<rect x="4" y="4" width="20" height="20" rx="2" fill="none" stroke="#5b6168" stroke-width="1.4" stroke-dasharray="3 2"/><path d="M14 9 v10 M9 14 h10" stroke="#2f86e0" stroke-width="2.4" stroke-linecap="round"/>`),
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
  zone: svg(28, 28, `<rect x="4" y="5" width="9" height="8" fill="#6cc56a"/><rect x="15" y="5" width="9" height="8" fill="#4f9be8"/><rect x="4" y="15" width="9" height="8" fill="#e2b23a"/><rect x="15" y="15" width="9" height="8" fill="#a77be0"/>`),
  people: svg(14, 14, `<circle cx="7" cy="4.3" r="2.6" fill="currentColor"/><path d="M2 13 a5 5 0 0 1 10 0 Z" fill="currentColor"/>`),
  lock: svg(10, 12, `<rect x="1" y="5" width="8" height="6.5" rx="1" fill="currentColor"/><path d="M3 5 V3.6 a2 2 0 0 1 4 0 V5" fill="none" stroke="currentColor" stroke-width="1.4"/>`),
  fill: svg(22, 22, `<path d="M5 10 L11 4 L18 11 L12 17 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M5 10 h13" stroke="currentColor" stroke-width="1.2"/><path d="M18.5 14 q1.6 2.4 0 3.6 q-1.6 -1.2 0 -3.6 Z" fill="currentColor"/>`),
  brush: svg(22, 22, `<circle cx="11" cy="11" r="7" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="2.6 2"/><circle cx="11" cy="11" r="2.4" fill="currentColor"/>`),
  marquee: svg(22, 22, `<rect x="4" y="5" width="14" height="12" fill="none" stroke="currentColor" stroke-width="1.7" stroke-dasharray="3 2"/>`),
  erase: svg(22, 22, `<path d="M4 15 L12 7 L17 12 L10 19 H6 Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/><path d="M8 11 L13 16" stroke="currentColor" stroke-width="1.5"/><path d="M10 19 H18" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`),
  land: svg(28, 28, `<path d="M4 9 L14 4 L24 9 L24 20 L14 25 L4 20 Z" fill="#e8e4d5" stroke="#8d939a" stroke-width="1.3"/><path d="M14 10 v9 M9.5 14.5 h9" stroke="#2f86e0" stroke-width="2.4" stroke-linecap="round"/>`),
  layers: svg(18, 18, `<path d="M9 2.5 L16 6 L9 9.5 L2 6 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><path d="M2 9.5 L9 13 L16 9.5 M2 12.5 L9 16 L16 12.5" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/>`),
  flag: svg(18, 18, `<path d="M4 16 V2.5 M4 3 H14 L11.5 6.5 L14 10 H4" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round"/>`),
  coins: svg(18, 18, `<ellipse cx="7" cy="5" rx="4.5" ry="2" fill="none" stroke="currentColor" stroke-width="1.5"/><path d="M2.5 5 v3.5 c0 1.1 2 2 4.5 2 M2.5 8.5 v3.5 c0 1.1 2 2 4.5 2" fill="none" stroke="currentColor" stroke-width="1.5"/><circle cx="12.5" cy="11.5" r="3.6" fill="none" stroke="currentColor" stroke-width="1.5"/>`),
  chart: svg(18, 18, `<path d="M2.5 15.5 H15.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/><rect x="3.5" y="9" width="2.6" height="5" fill="currentColor"/><rect x="7.7" y="5" width="2.6" height="9" fill="currentColor"/><rect x="11.9" y="2.5" width="2.6" height="11.5" fill="currentColor"/>`),
  car: svg(18, 18, `<path d="M3 11 L4.4 6.6 C4.7 5.7 5.4 5.2 6.3 5.2 H11.7 C12.6 5.2 13.3 5.7 13.6 6.6 L15 11 V14 H3 Z" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/><circle cx="6" cy="11" r="1.1" fill="currentColor"/><circle cx="12" cy="11" r="1.1" fill="currentColor"/>`),
  tiles: svg(18, 18, `<path d="M2.5 2.5 H15.5 V15.5 H2.5 Z M2.5 9 H15.5 M9 2.5 V15.5" fill="none" stroke="currentColor" stroke-width="1.5"/><rect x="9.8" y="9.8" width="4.9" height="4.9" fill="currentColor" opacity=".45"/>`),
  services: svg(28, 28, `<path d="M3 11 L14 4 L25 11 Z" fill="#5b6168"/><rect x="5" y="11" width="18" height="2" fill="#5b6168"/><path d="M7.5 14 v7 M12 14 v7 M16 14 v7 M20.5 14 v7" stroke="#5b6168" stroke-width="2.2"/><rect x="4" y="22" width="20" height="2.4" fill="#5b6168"/>`),
  roadCat: svg(28, 28, `<path d="M9 26 L12 2 M19 26 L16 2" stroke="#5b6168" stroke-width="2" stroke-linecap="round"/><path d="M14 5 v3.5 M14 12 v4 M14 19.5 v4" stroke="#e9b32a" stroke-width="1.8" stroke-linecap="round"/>`),
  keys: svg(18, 18, `<rect x="2" y="4.5" width="14" height="9" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.4"/><path d="M5 7.5 h1 M8.5 7.5 h1 M12 7.5 h1 M5.5 10.8 h7" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  close: svg(14, 14,`<path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
};
