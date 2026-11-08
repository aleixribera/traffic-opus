// When the next town springs up (docs/design.md "Towns": the player never founds one, a milestone brings it). The
// Towns window says which goal it comes with and how far along that is.

import type { Game } from "../game/city";
import { MILESTONES, OPEN_AT_ONCE, type Milestone } from "../game/progression";

export interface NextTown {
  /** the next goal that brings towns */
  m: Milestone;
  have: number;
  need: number;
  /** how many goals have to be reached before it opens (0: it is open now) */
  before: number;
}

export function nextTown(g: Game): NextTown | null {
  const left = MILESTONES.filter((m) => !g.progress.isDone(m.id));
  const i = left.findIndex((m) => (m.unlocks.towns ?? 0) > 0);
  if (i < 0) return null;
  const m = left[i];
  const [have, need] = m.measure(g.progressView());
  return { m, have: Math.min(have, need), need, before: Math.max(0, i - OPEN_AT_ONCE + 1) };
}
