// How the catalog lays out a tab's cards (owner, 2026-11-10: "the Industry catalog leaves an empty navy band on
// tabs with few cards"). The window is as wide as it is whatever the tab holds, so the cards are fitted to the
// window and not the other way round: a few cards become wide plates that say what each is, more share the row in
// equal columns, and a tab too long for one row is split into even rows. Pure, so the rule is a test.

/** Cards in one row at most, and the most that are laid out as wide plates with their description. */
export const CARDS_PER_ROW = 8, WIDE_CARDS = 4;

export interface CatalogLayout {
  /** equal columns across the window */
  cols: number;
  rows: number;
  /** wide plates: the icon beside the name, what it is in a sentence, then what it takes and costs */
  wide: boolean;
}

/**
 * The layout for n cards. Up to WIDE_CARDS: one row of wide plates. Up to a row's worth: one row, each card an equal
 * share of the width. More: as few rows as hold them, the cards spread evenly over the rows (nine are five and
 * four, never eight and one alone).
 */
export function catalogLayout(n: number, perRow = CARDS_PER_ROW): CatalogLayout {
  if (n <= 0) return { cols: 1, rows: 0, wide: false };
  if (n <= WIDE_CARDS) return { cols: n, rows: 1, wide: true };
  const rows = Math.ceil(n / perRow);
  return { cols: Math.ceil(n / rows), rows, wide: false };
}
