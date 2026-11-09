import { describe, expect, it } from "vitest";
import { SR, dc, maxStep, peak, rms, rnd } from "../src/audio/dsp";
import { BEDS, SHOTS, finish, type BedId, type ShotId } from "../src/audio/sounds";
import { DRUMS, bassNote, pianoNote, type DrumId } from "../src/audio/instruments";
import { STING_IDS, renderSting } from "../src/audio/stings";
import { UI, UI_IDS } from "../src/audio/uisounds";

const finite = (x: Float32Array) => { for (let i = 0; i < x.length; i++) if (!Number.isFinite(x[i])) return false; return true; };
/** the biggest sample-to-sample jump in the first and last few milliseconds of a one-shot */
const edge = (x: Float32Array) => Math.max(Math.abs(x[0]), Math.abs(x[x.length - 1]));

describe("sound recipes", () => {
  for (const id of Object.keys(BEDS) as BedId[]) {
    it(`bed ${id}: a level, seamless loop`, () => {
      const x = finish(BEDS[id](rnd(7)), true);
      expect(finite(x)).toBe(true);
      expect(x.length / SR).toBeGreaterThan(1.9);
      expect(peak(x)).toBeLessThanOrEqual(0.951);
      expect(rms(x)).toBeGreaterThan(0.03);
      expect(Math.abs(dc(x))).toBeLessThan(0.002);
      // the jump from the last sample back to the first is no bigger than the jumps inside the loop
      const seam = Math.abs(x[0] - x[x.length - 1]);
      expect(seam).toBeLessThanOrEqual(maxStep(x) + 1e-6);
      // and the level in the first and last 100 ms is like the rest (no hole or bump at the seam)
      const n = Math.round(0.1 * SR);
      const ends = Math.sqrt((rms(x.subarray(0, n)) ** 2 + rms(x.subarray(x.length - n)) ** 2) / 2);
      expect(ends).toBeGreaterThan(rms(x) * 0.2);
      expect(ends).toBeLessThan(rms(x) * 4);
    });
  }

  for (const id of Object.keys(SHOTS) as ShotId[]) {
    it(`one-shot ${id}: starts and ends at rest`, () => {
      for (const seed of [1, 2, 3]) {
        const x = finish(SHOTS[id](rnd(seed * 31)), false);
        expect(finite(x)).toBe(true);
        expect(peak(x)).toBeGreaterThan(0.2);
        expect(peak(x)).toBeLessThanOrEqual(0.951);
        expect(edge(x)).toBeLessThan(0.01);
        expect(x.length / SR).toBeLessThan(3.2);
      }
    });
  }

  it("the interface's sounds are short and quiet at the edges", () => {
    for (const id of UI_IDS) {
      const x = finish(UI[id](rnd(3)), false);
      expect(finite(x)).toBe(true);
      expect(x.length / SR, id).toBeLessThanOrEqual(0.62);
      expect(peak(x), id).toBeGreaterThan(0.25);
      expect(peak(x), id).toBeLessThanOrEqual(0.75);
      expect(edge(x), id).toBeLessThan(0.01);
    }
  });

  it("the stings render, under four and a half seconds each", () => {
    for (const id of STING_IDS) {
      const x = finish(renderSting(id), false);
      expect(finite(x)).toBe(true);
      expect(x.length / SR, id).toBeLessThan(4.5);
      expect(peak(x), id).toBeLessThanOrEqual(0.75);
      expect(rms(x), id).toBeGreaterThan(0.02);
      expect(edge(x), id).toBeLessThan(0.01);
    }
  });

  it("the band's notes: struck, then dying away", () => {
    for (const m of [36, 48, 60, 72, 84]) {
      const x = finish(pianoNote(m, rnd(m)), false);
      expect(finite(x)).toBe(true);
      const q = Math.floor(x.length / 4);
      expect(rms(x.subarray(0, q)), `piano ${m}`).toBeGreaterThan(rms(x.subarray(3 * q)) * 3);
      expect(edge(x)).toBeLessThan(0.01);
    }
    for (const m of [28, 40, 52]) {
      const x = finish(bassNote(m, rnd(m)), false);
      const q = Math.floor(x.length / 4);
      expect(rms(x.subarray(0, q)), `bass ${m}`).toBeGreaterThan(rms(x.subarray(3 * q)) * 3);
    }
    for (const id of Object.keys(DRUMS) as DrumId[]) {
      const x = finish(DRUMS[id](rnd(5)), false);
      expect(finite(x)).toBe(true);
      expect(edge(x), id).toBeLessThan(0.01);
    }
  });

  it("is cheap to make: no recipe takes long", () => {
    let worst = 0, name = "";
    const time = (n: string, f: () => unknown) => { const t = performance.now(); f(); const d = performance.now() - t; if (d > worst) { worst = d; name = n; } };
    for (const id of Object.keys(BEDS) as BedId[]) time(id, () => BEDS[id](rnd(1)));
    for (const id of Object.keys(SHOTS) as ShotId[]) time(id, () => SHOTS[id](rnd(1)));
    for (const id of STING_IDS) time(id, () => renderSting(id));
    time("piano", () => pianoNote(48, rnd(1)));
    expect(worst, name).toBeLessThan(400);
  });
});
