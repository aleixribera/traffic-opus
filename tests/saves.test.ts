// Saves in localStorage: a late-game company is ~5 MB of JSON, and Chromium gives a site 10 MiB of UTF-16 (about
// 5.2 M characters) for all of them together, so plain JSON (written to a scratch key, then its slot) didn't fit
// at all and the autosave failed silently. Saves are stored compressed now.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Saves, packBytes, unpackBytes } from "../src/game/saves";
import type { Game } from "../src/game/city";

const QUOTA = (10 * 1024 * 1024) / 2; // characters

/** localStorage as Chromium keeps it: keys and values count against one quota, and a write that won't fit throws. */
class FakeStorage {
  m = new Map<string, string>();
  used() { let n = 0; for (const [k, v] of this.m) n += k.length + v.length; return n; }
  getItem(k: string) { return this.m.get(k) ?? null; }
  setItem(k: string, v: string) {
    const old = this.m.get(k);
    if (this.used() - (old === undefined ? 0 : k.length + old.length) + k.length + v.length > QUOTA) throw new Error("QuotaExceededError");
    this.m.set(k, v);
  }
  removeItem(k: string) { this.m.delete(k); }
}

/** A company's save, made up: `n` buildings with the fields and float noise of real ones (~430 characters each). */
function bigState(n: number, seed = 1) {
  let s = seed;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const buildings = [];
  for (let i = 0; i < n; i++) {
    buildings.push({
      id: i, town: 1 + (i % 3), kind: ["house", "terrace", "shop", "office"][i % 4], c: { x: r() * 8000 - 4000, y: r() * 8000 - 4000 },
      rot: r() * 6.28 - 3.14, hw: 12, hd: 20, front: { x: r() * 8000, y: r() * 8000 }, access: null, side: -1, zone: "resRow",
      lot: { block: `${(r() * 900) | 0}:-1`, col0: (r() * 9) | 0, w: 3, d: 5 }, level: 1, cap: 3, fit: r(), tall: 1, built: 1, abandoned: 0,
      lv: (r() * 100) | 0, upT: 400, badT: 0, problem: null, stock: 0, prodT: 0, visits: 0, born: (r() * 20000) | 0, health: 1,
    });
  }
  const zones = [];
  for (let i = 0; i < n * 15; i++) zones.push([Math.round(r() * 80000) / 10, Math.round(r() * 80000) / 10, "comMid"]);
  return { v: 1, buildings, zones };
}

function stubGame(state: unknown): Game {
  return { serialize: () => state, progress: { done: [] }, playtime: 100, people: { stats: { population: 25000 } }, cityName: "Elton" } as unknown as Game;
}

let store: FakeStorage;
beforeEach(() => { store = new FakeStorage(); (globalThis as { localStorage?: unknown }).localStorage = store; });
afterEach(() => { delete (globalThis as { localStorage?: unknown }).localStorage; });

describe("saves", () => {
  it("pack bytes into text and back, at every length", () => {
    for (let n = 0; n < 70; n++) {
      const u = new Uint8Array(n).map((_, i) => (i * 97 + n * 31) & 0xff);
      if (n > 3) u[n - 1] = 0xff;
      const s = packBytes(u);
      for (let i = 0; i < s.length; i++) { const c = s.charCodeAt(i); expect(c < 0xd800 || c > 0xdfff).toBe(true); }
      expect([...unpackBytes(s)]).toEqual([...u]);
    }
  });

  it("a late-game company saves, twice over in the autosave slots and once more, and loads back the same", () => {
    const state = bigState(11000);
    const json = JSON.stringify(state);
    expect(json.length).toBeGreaterThan(QUOTA * 0.9); // more than one save alone could take uncompressed
    const saves = new Saves();
    const g = stubGame(state);
    expect(saves.autosave(g)).not.toBeNull();
    expect(saves.autosave(g)).not.toBeNull();
    expect(saves.save(g, "Quicksave", "quick")).not.toBeNull();
    for (const id of ["auto0", "auto1", "quick"]) expect(JSON.stringify(saves.load(id))).toBe(json);
    expect(saves.list().map((m) => m.id).sort()).toEqual(["auto0", "auto1", "quick"]);
    expect(store.getItem("flowtown.save.tmp")).toBeNull();
  });

  it("the periodic autosave compresses off the frame and loads back the same", async () => {
    const state = bigState(3000, 7);
    const saves = new Saves();
    const m = await saves.autosaveSoon(stubGame(state));
    expect(m?.id).toBe("auto1");
    expect(saves.load("auto1")).toEqual(state);
  });

  it("a save made while an autosave is being compressed wins: the stale one isn't written", async () => {
    const saves = new Saves();
    const old = bigState(2000, 3), now = bigState(2000, 4);
    const late = saves.autosaveSoon(stubGame(old)); // slot auto1, still compressing
    saves.save(stubGame(now), "Elton, autosave", "auto1", true);
    expect(await late).toBeNull();
    expect(saves.load("auto1")).toEqual(now);
  });

  it("saves into different slots at once are all written", async () => {
    const saves = new Saves();
    const a = bigState(1500, 5), b = bigState(1500, 6);
    const [ma, mb] = await Promise.all([saves.autosaveSoon(stubGame(a)), saves.saveSoon(stubGame(b), "Quicksave", "quick")]);
    expect(ma?.id).toBe("auto1");
    expect(mb?.id).toBe("quick");
    expect(saves.load("auto1")).toEqual(a);
    expect(saves.load("quick")).toEqual(b);
  });

  it("saves from before compression still load", () => {
    const state = bigState(50);
    store.setItem("flowtown.save.old", JSON.stringify(state));
    expect(new Saves().load("old")).toEqual(state);
  });

  it("a save that can't fit fails without touching the one already there", () => {
    const saves = new Saves();
    expect(saves.save(stubGame(bigState(100)), "A", "a")).not.toBeNull();
    const before = store.getItem("flowtown.save.a");
    store.setItem("filler", "x".repeat(QUOTA - store.used() - 2000));
    expect(saves.save(stubGame(bigState(4000, 9)), "A", "a")).toBeNull();
    expect(store.getItem("flowtown.save.a")).toBe(before);
    expect(store.getItem("flowtown.save.tmp")).toBeNull();
  });
});
