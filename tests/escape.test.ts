import { describe, expect, it } from "vitest";
import { ESC_ORDER, escLayer, type EscLayer, type EscState } from "../src/ui/escape";

const open = (...on: EscLayer[]): EscState => Object.fromEntries(ESC_ORDER.map((k) => [k, on.includes(k)])) as EscState;

/** Press Esc until nothing is left: the layers it put away, in order. */
function presses(s: EscState): EscLayer[] {
  const out: EscLayer[] = [];
  for (let l = escLayer(s); l; l = escLayer(s)) { out.push(l); s = { ...s, [l]: false }; }
  return out;
}

describe("one Esc, one layer (play-test 2026-11-09, A9)", () => {
  it("with nothing open there is nothing to put away: only then the pause menu", () => {
    expect(escLayer(open())).toBeNull();
  });

  it("a building in hand with the catalog open takes two presses, the tool first", () => {
    // (it took one, so the second press, meant for the catalog, opened the pause menu)
    expect(presses(open("tool", "catalog"))).toEqual(["tool", "catalog"]);
  });

  it("the tool, then the catalog, then the panel, then the window, then a view left on", () => {
    expect(presses(open("view", "window", "selection", "catalog", "tool"))).toEqual(["tool", "catalog", "selection", "window", "view"]);
  });

  it("a banner is read before the tool is touched, and the tool is still dropped by the next press", () => {
    // (Esc once dismissed a milestone banner and left the Add-lane tool armed with nothing saying so: now the
    // next press is the tool's, never the pause menu's)
    expect(presses(open("banner", "tool"))).toEqual(["banner", "tool"]);
  });

  it("a dialog is on top of everything", () => {
    expect(escLayer(open("dialog", "banner", "popover", "tool", "catalog", "selection", "window", "view"))).toBe("dialog");
  });

  it("puts away exactly one layer a press, whatever is open", () => {
    const n = ESC_ORDER.length;
    for (let m = 0; m < 1 << n; m++) {
      const on = ESC_ORDER.filter((_, i) => m & (1 << i));
      const got = presses(open(...on));
      expect(got).toEqual(on);
    }
  });
});
