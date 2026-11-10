// One Esc, one layer (docs/design.md, "Controls"; play-test 2026-11-09, A9: "Esc goes from close straight to the
// pause menu"). Each press of Esc puts away exactly one thing, the one on top, and the pause menu only opens once
// nothing is left. Pure, so the order is a test (tests/escape.test.ts) and not a habit of the HUD's code.

/** The things Esc can put away, from the top down. */
export const ESC_ORDER = [
  /** a dialog over everything: the pause menu and what opens from it, the company's name */
  "dialog",
  /** a banner waiting to be read: a milestone, a new town */
  "banner",
  /** the season popover on the clock */
  "popover",
  /** the tool in hand (a road being drawn goes with it) */
  "tool",
  /** the build catalog above the bar */
  "catalog",
  /** the panel of the thing selected on the map */
  "selection",
  /** a window opened from the top-left buttons (it takes the info view it turned on with it) */
  "window",
  /** an info view left on with no window open */
  "view",
] as const;

export type EscLayer = (typeof ESC_ORDER)[number];

/** What is open now. */
export type EscState = Record<EscLayer, boolean>;

/** The one layer this press of Esc puts away, or null when nothing is open (then, and only then, the pause menu). */
export function escLayer(s: EscState): EscLayer | null {
  return ESC_ORDER.find((k) => s[k]) ?? null;
}
