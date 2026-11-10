import { describe, expect, it } from "vitest";
import { compose } from "../src/audio/music/compose";
import { noteAt, sheetBuffers, sheetOf } from "../src/audio/music/sheet";

describe("a tune packed for the wireless (written off the main thread)", () => {
  it("reads back every note as compose wrote it", () => {
    for (const [seed, mood] of [[3, "day"], [11, "night"], [42, "winterNight"]] as const) {
      const T = compose(seed, mood, { towns: ["Alder Run", "Marlow"], company: "Carver & Sons Haulage" });
      const s = sheetOf(T);
      expect(s.count).toBe(T.notes.length);
      expect([s.name, s.bpm, s.swing, s.lead, s.beats]).toEqual([T.name, T.bpm, T.swing, T.lead, T.beats]);
      T.notes.forEach((n, k) => {
        const r = noteAt(s, k);
        expect([r.t, r.d, r.m, r.i, r.bend]).toEqual([n.t, n.d, n.m, n.i, n.bend]);
        expect(r.v).toBeCloseTo(n.v, 6);
      });
    }
  });

  it("hands over its arrays whole, each on its own buffer", () => {
    const s = sheetOf(compose(5, "day"));
    const bufs = sheetBuffers(s);
    expect(new Set(bufs).size).toBe(bufs.length);
    const copy = structuredClone(s, { transfer: bufs });
    expect(copy.count).toBe(s.count);
    expect(s.t.length).toBe(0); // (moved, not copied)
    expect(noteAt(copy, 0).i).toBeTruthy();
  });
});
