// The company herald as an SVG badge: a Deco shield, roundel, winged roundel or lozenge in the company's two
// colours, with its monogram in a geometric face. Drawn here as vector shapes (no images).

import { HERALD_COLORS, monogram, type Herald } from "../game/company";

const FONT = `'Futura','Century Gothic','Avenir Next','Trebuchet MS',Arial,sans-serif`;

/** The badge's shapes on a 64 x 64 box: field, emblem in ink, and where the monogram sits. */
function body(h: Herald): { art: string; cy: number; fs: number } {
  const F = HERALD_COLORS[h.field], I = HERALD_COLORS[h.ink];
  switch (h.shape) {
    case "shield":
      // flat-topped Deco shield with a stepped crest and an inset rule
      return {
        art: `<path d="M6 5h52v25c0 16-12 25-26 31C18 55 6 46 6 30z" fill="${F}" stroke="${I}" stroke-width="2.5"/>
          <path d="M12 11h40v19c0 12-9 19-20 24-11-5-20-12-20-24z" fill="none" stroke="${I}" stroke-width="1.2"/>
          <path d="M22 11v-6M32 11v-6M42 11v-6" stroke="${I}" stroke-width="2"/>`,
        cy: 32, fs: 19,
      };
    case "roundel":
      // a ring with a rule inside and a chevron of rays above and below
      return {
        art: `<circle cx="32" cy="32" r="29" fill="${F}" stroke="${I}" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="22.5" fill="none" stroke="${I}" stroke-width="1.2"/>
          <path d="M26 7.5l6 3.5 6-3.5M26 56.5l6-3.5 6 3.5" fill="none" stroke="${I}" stroke-width="2"/>`,
        cy: 32, fs: 19,
      };
    case "wings":
      // a small roundel with stepped speed-wings either side
      return {
        art: `<g fill="${F}" stroke="${I}" stroke-width="1.4">
            <path d="M2 23h20v5H6zM5 30h17v5H9zM9 37h13v4.5H12z"/>
            <path d="M62 23H42v5h16zM59 30H42v5h13zM55 37H42v4.5h10z"/>
          </g>
          <circle cx="32" cy="32" r="18" fill="${F}" stroke="${I}" stroke-width="2.5"/>
          <circle cx="32" cy="32" r="13.5" fill="none" stroke="${I}" stroke-width="1"/>`,
        cy: 32, fs: 14,
      };
    case "lozenge":
      // a diamond with a stepped inner diamond
      return {
        art: `<path d="M32 2l30 30-30 30L2 32z" fill="${F}" stroke="${I}" stroke-width="2.5"/>
          <path d="M32 10l22 22-22 22-22-22z" fill="none" stroke="${I}" stroke-width="1.2"/>`,
        cy: 32, fs: 16,
      };
  }
}

/** The herald as an inline SVG string, `size` px square. Decorative unless `label` is given. */
export function heraldSvg(h: Herald, name: string, size = 32, label?: string): string {
  const m = monogram(name);
  const { art, cy, fs } = body(h);
  const k = m.length > 1 ? 0.84 : 1;
  const a11y = label ? `role="img" aria-label="${label.replace(/[&<>"]/g, "")}"` : `aria-hidden="true"`;
  return `<svg class="herald" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}" ${a11y}>${art}`
    + `<text x="32" y="${cy}" dy="0.36em" text-anchor="middle" font-family="${FONT}" font-weight="700" font-size="${fs * k}" letter-spacing="${m.length > 1 ? 0.5 : 0}" fill="${HERALD_COLORS[h.ink]}">${m}</text></svg>`;
}
