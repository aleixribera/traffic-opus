// The main menu's "What's new" and the version in the corner read src/changelog.ts: newest first, one entry per tag.

import { describe, expect, it } from "vitest";
import { CHANGELOG, VERSION } from "../src/changelog";

const num = (v: string) => v.slice(1).split(".").map(Number);
const newer = (a: string, b: string) => { const x = num(a), y = num(b); for (let i = 0; i < 3; i++) if (x[i] !== y[i]) return x[i] > y[i]; return false; };

describe("changelog", () => {
  it("lists every release once, newest first, each with a date, a title and its key changes", () => {
    expect(VERSION).toBe(CHANGELOG[0].v);
    for (let i = 0; i < CHANGELOG.length; i++) {
      const r = CHANGELOG[i];
      expect(r.v).toMatch(/^v\d+\.\d+\.\d+$/);
      expect(r.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(r.title.trim().length).toBeGreaterThan(2);
      expect(r.notes.length).toBeGreaterThan(0);
      for (const n of r.notes) expect(n.trim().length).toBeGreaterThan(8);
      if (i > 0) {
        expect(newer(CHANGELOG[i - 1].v, r.v)).toBe(true);
        expect(CHANGELOG[i - 1].date >= r.date).toBe(true);
      }
    }
  });
});
