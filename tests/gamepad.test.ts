import { describe, expect, it } from "vitest";
import { B, PadReader, deadzone, pickDir, REPEAT_DELAY_MS, REPEAT_MS, type PadLike } from "../src/ui/padRead";

const pad = (index: number, down: number[] = [], axes = [0, 0, 0, 0]): PadLike => ({
  index, connected: true, mapping: "standard", axes,
  buttons: Array.from({ length: 17 }, (_, i) => ({ pressed: down.includes(i), value: down.includes(i) ? 1 : 0 })),
});

describe("pad reader", () => {
  it("sees a press once, and its release", () => {
    const r = new PadReader();
    expect(r.read([pad(0)], 0).pressed.size).toBe(0);
    expect([...r.read([pad(0, [B.cross])], 16).pressed]).toEqual([B.cross]);
    expect(r.read([pad(0, [B.cross])], 32).pressed.size).toBe(0);
    expect([...r.read([pad(0)], 48).released]).toEqual([B.cross]);
  });

  it("follows the pad used last, not the first one (Steam's virtual pad beside the real one)", () => {
    const r = new PadReader();
    r.read([pad(0), pad(1)], 0);
    const f = r.read([pad(0), pad(1, [B.circle])], 16);
    expect(f.index).toBe(1);
    expect(f.pressed.has(B.circle)).toBe(true);
    // the idle pad 0 never takes it back; a stick on pad 1 is read
    const g = r.read([pad(0), pad(1, [], [0.8, 0, 0, 0])], 32);
    expect(g.index).toBe(1);
    expect(g.lx).toBeGreaterThan(0.5);
    // pad 0 used: it is followed from then on
    const h = r.read([pad(0, [B.triangle]), pad(1)], 48);
    expect(h.index).toBe(0);
    expect(h.pressed.has(B.triangle)).toBe(true);
  });

  it("keeps the followed pad when a twin presses in the same frame", () => {
    const r = new PadReader();
    r.read([pad(0), pad(1)], 0);
    r.read([pad(0), pad(1, [B.cross])], 16);
    r.read([pad(0), pad(1)], 32);
    const f = r.read([pad(0, [B.cross]), pad(1, [B.cross])], 48);
    expect(f.index).toBe(1);
    expect(f.pressed.has(B.cross)).toBe(true);
  });

  it("never reads a twin's echo of a press, a frame later, as a second press", () => {
    const r = new PadReader();
    r.read([pad(0), pad(1)], 0);
    expect(r.read([pad(0, [B.cross]), pad(1)], 16).pressed.has(B.cross)).toBe(true);
    const echo = r.read([pad(0, [B.cross]), pad(1, [B.cross])], 32);
    expect(echo.pressed.size).toBe(0);
    // (the echo after the first pad let go is the same press too)
    const r2 = new PadReader();
    r2.read([pad(0), pad(1)], 0);
    r2.read([pad(0, [B.cross]), pad(1)], 16);
    expect(r2.read([pad(0), pad(1, [B.cross])], 32).pressed.size).toBe(0);
    // a real new press on the twin later is one
    r2.read([pad(0), pad(1)], 400);
    expect(r2.read([pad(0), pad(1, [B.cross])], 420).pressed.has(B.cross)).toBe(true);
  });

  it("leaves other devices alone: pedals resting off centre wake nothing, a standard pad wins", () => {
    const r = new PadReader();
    const pedals: PadLike = { ...pad(0, [], [0, 0, -1, 0, 0, -1]), mapping: "" };
    expect(r.read([pedals], 0).active).toBe(false);
    expect(r.read([pedals], 16).active).toBe(false);
    const stuck: PadLike = { ...pad(2, [5]), mapping: "" };
    const r2 = new PadReader();
    r2.read([stuck], 0);
    expect(r2.read([stuck], 16).active).toBe(false);
    const f = new PadReader().read([pedals, pad(1, [B.circle])], 0);
    expect(f.index).toBe(1);
  });

  it("ignores a drifting stick and rescales past the dead zone", () => {
    expect(deadzone(0.1, -0.12)).toEqual([0, 0]);
    const [x] = deadzone(1, 0);
    expect(x).toBeCloseTo(1);
    expect(deadzone(0.6, 0)[0]).toBeGreaterThan(0.4);
    const r = new PadReader();
    expect(r.read([pad(0, [], [0.1, 0.1, 0.05, 0])], 0).active).toBe(false);
  });

  it("repeats a held direction in menus after a delay", () => {
    const r = new PadReader();
    expect(r.read([pad(0, [B.down])], 0).nav).toBe("down");
    expect(r.read([pad(0, [B.down])], 100).nav).toBe(null);
    expect(r.read([pad(0, [B.down])], REPEAT_DELAY_MS + 1).nav).toBe("down");
    expect(r.read([pad(0, [B.down])], REPEAT_DELAY_MS + 20).nav).toBe(null);
    expect(r.read([pad(0, [B.down])], REPEAT_DELAY_MS + REPEAT_MS + 2).nav).toBe("down");
    // the stick pushed over works as the d-pad
    expect(r.read([pad(0, [], [-0.9, 0.1, 0, 0])], 2000).nav).toBe("left");
  });

  it("reads the triggers as analog", () => {
    const r = new PadReader();
    const p = pad(0);
    (p.buttons as { pressed: boolean; value: number }[])[B.r2] = { pressed: false, value: 0.5 };
    const f = r.read([p], 0);
    expect(f.r2).toBeCloseTo(0.5);
    expect(f.held.has(B.r2)).toBe(true);
  });
});

describe("focus moves by where things sit", () => {
  const box = (l: number, t: number, w = 100, h = 30) => ({ left: l, top: t, right: l + w, bottom: t + h });
  // a column of menu rows, and a button to the right of the second
  const rows = [box(0, 0), box(0, 40), box(0, 80), box(150, 40, 60)];
  it("goes down a column and across a row", () => {
    expect(pickDir(rows[0], rows, "down")).toBe(1);
    expect(pickDir(rows[1], rows, "down")).toBe(2);
    expect(pickDir(rows[1], rows, "right")).toBe(3);
    expect(pickDir(rows[3], rows, "left")).toBe(1);
    expect(pickDir(rows[0], rows, "up")).toBe(-1);
  });
  it("in a grid of cards, keeps to the column", () => {
    const g = [box(0, 0), box(110, 0), box(220, 0), box(0, 40), box(110, 40), box(220, 40)];
    expect(pickDir(g[1], g, "down")).toBe(4);
    expect(pickDir(g[5], g, "up")).toBe(2);
    expect(pickDir(g[3], g, "right")).toBe(4);
  });
});

describe("the words for the pad", () => {
  it("says Press for Click", async () => {
    const { padWords } = await import("../src/ui/padRead");
    expect(padWords("Click again to demolish 2 buildings")).toBe("Press ✕ again to demolish 2 buildings");
    expect(padWords("Click a junction")).toBe("Press ✕ on a junction");
    expect(padWords("right click ends the chain")).toBe("press ○ ends the chain");
    expect(padWords("Farm built for $8,000")).toBe("Farm built for $8,000");
  });
});
