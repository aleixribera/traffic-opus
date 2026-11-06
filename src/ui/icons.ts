import { ROAD_TYPES, type BuildingKind, type RoadTypeId } from "../config";

/** Small hand-drawn SVG pictograms. Road icons show the actual lane layout of each type. */

const svg = (w: number, h: number, body: string) =>
  `<svg viewBox="0 0 ${w} ${h}" width="${w}" height="${h}" aria-hidden="true" focusable="false">${body}</svg>`;

export function roadIcon(id: RoadTypeId): string {
  const T = ROAD_TYPES[id];
  const n = T.fwd + T.bwd;
  const lw = 5;
  const W = n * lw + 4;
  const x0 = (28 - W) / 2;
  let b = `<rect x="${x0}" y="2" width="${W}" height="24" rx="1.5" fill="#fff" stroke="#8d939a" stroke-width="1.2"/>`;
  const lineX = (k: number) => x0 + 2 + k * lw;
  for (let k = 1; k < n; k++) {
    const centre = T.bwd > 0 && k === T.bwd;
    b += centre
      ? `<line x1="${lineX(k)}" y1="3" x2="${lineX(k)}" y2="25" stroke="#e9b32a" stroke-width="1.3"/>`
      : `<line x1="${lineX(k)}" y1="4" x2="${lineX(k)}" y2="24" stroke="#a9aeb4" stroke-width="0.9" stroke-dasharray="3 2.4"/>`;
  }
  // direction arrows
  for (let k = 0; k < n; k++) {
    const cx = lineX(k) + lw / 2;
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
  angle: svg(12, 12, `<path d="M2 10 H10 M2 10 L8 3" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>`),
  close: svg(14, 14, `<path d="M3.5 3.5 L10.5 10.5 M10.5 3.5 L3.5 10.5" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/>`),
};
