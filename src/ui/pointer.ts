// One line at the pointer (owner, 2026-11-10: "seven chips at the pointer on a long road"). A tool has many things to
// say about a click (how long, what it joins, how steep, the bridge, the angle, the cost), and said all at once by
// the cursor none of them is read. The pointer says the one that matters now, with the price beside it; the rest are
// notes for the tool options card, where they hold still. Pure, so the choice is a test and not a habit.

export interface PointerChip {
  text: string;
  /** `dear`: a cost that is a large share of the company's cash */
  kind: "info" | "error" | "cost" | "dear";
  /** an error-coloured line that does not stop the click (it demolishes buildings: click again) */
  warn?: boolean;
  /** how much this note matters among the notes: the highest leads the line (what the road joins beats its length) */
  lead?: number;
  /**
   * it says its own price (the dirt road offered to a works' gate): leading the line, the click's price does not sit
   * beside it, where it read as the note's (review 2026-11-12, C4)
   */
  priced?: boolean;
}

export interface PointerLine<C> {
  /** the one thing that matters now */
  head: C | null;
  /** what the click costs, beside it (never beside something that stops the click) */
  cost: C | null;
  /** everything else, in the order it was said: for the tool options card */
  rest: C[];
}

/**
 * The line for the pointer out of everything a tool says about a click. First whatever stops the click, alone:
 * nothing gets built, so its price is no news. Else a warning (buildings come down), else the note that matters
 * most (`lead`, the first said among equals), each with the price beside it.
 */
export function pointerLine<C extends PointerChip>(list: readonly C[]): PointerLine<C> {
  if (!list.length) return { head: null, cost: null, rest: [] };
  const stop = list.find((c) => c.kind === "error" && !c.warn);
  const price = list.find((c) => c.kind === "cost" || c.kind === "dear") ?? null;
  let head: C;
  if (stop) head = stop;
  else {
    const warn = list.find((c) => c.kind === "error");
    const notes = list.filter((c) => c.kind === "info");
    head = warn ?? notes.reduce<C | null>((a, c) => (!a || (c.lead ?? 0) > (a.lead ?? 0) ? c : a), null) ?? price ?? list[0];
  }
  // (beside a note with its own price, the click's price only when it is a large share of the cash: a warning that
  // must reach the pointer, and its words say whose it is)
  const cost = stop || price === head || (head.priced && price?.kind !== "dear") ? null : price;
  return { head, cost, rest: list.filter((c) => c !== head && c !== cost) };
}
