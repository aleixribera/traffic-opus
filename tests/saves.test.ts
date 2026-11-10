// Saves in localStorage: a late-game company is ~5 MB of JSON, and Chromium gives a site 10 MiB of UTF-16 (about
// 5.2 M characters) for all of them together, so plain JSON (written to a scratch key, then its slot) didn't fit
// at all and the autosave failed silently. Saves are stored compressed now.

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Saves, packBytes, unpackBytes } from "../src/game/saves";
import { Game } from "../src/game/city";
import { DAY, HOUR } from "../src/game/society";
import type { Lane } from "../src/roads/network";
import type { Vehicle } from "../src/sim/traffic";
import { buildGateJam, feed } from "./gatejam.scenario";

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

  it("a save remembers where the camera was, and gives it back to open on", async () => {
    const saves = new Saves();
    let at = { cx: 1234.5, cy: -678.9, halfH: 180 };
    saves.where = () => at;
    saves.save(stubGame(bigState(20)), "A", "a");
    at = { cx: 10, cy: 20, halfH: 900 };
    await saves.saveSoon(stubGame(bigState(20)), "Quicksave", "quick");
    expect(saves.viewOf("a")).toEqual({ cx: 1234.5, cy: -678.9, halfH: 180 });
    expect(saves.viewOf("quick")).toEqual({ cx: 10, cy: 20, halfH: 900 });
    // a save from before the camera was kept, one made with no view of the player's own, a broken one: none
    saves.where = null;
    saves.save(stubGame(bigState(20)), "B", "b");
    expect(saves.viewOf("b")).toBeNull();
    saves.where = () => undefined;
    saves.save(stubGame(bigState(20)), "C", "c");
    expect(saves.viewOf("c")).toBeNull();
    saves.where = () => ({ cx: NaN, cy: 0, halfH: 100 });
    saves.save(stubGame(bigState(20)), "D", "d");
    expect(saves.viewOf("d")).toBeNull();
    expect(saves.viewOf("nope")).toBeNull();
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

// ---------------------------------------------------------------------------------------------------------------
// A save keeps the traffic (docs/playtest-2026-11-09.md, A3 and A4): F5 then F9 with 190 vehicles on the road left
// none, every load in transit went back to its yard, and the game came back at 1x under a menu that said "Paused".

/** Loads on the road and waiting to leave, by product (the "out" legs of every haul trip). */
function inTransit(g: Game): Record<string, number> {
  const m: Record<string, number> = {};
  for (const t of g.trips()) if (t.haul && !t.haul.done && t.haul.leg === "out") m[t.haul.product] = (m[t.haul.product] ?? 0) + t.haul.n;
  return m;
}
const where = (v: Vehicle) => (v.edge.kind === "lane" ? (v.edge as Lane).key : `conn@${(v.edge as unknown as { node: number }).node}`);
const round = (g: Game) => Game.load(JSON.parse(JSON.stringify(g.serialize())));

describe("a save keeps the traffic", () => {
  // the play-test's company (one sawmill, two towns, four building sites on one road), a busy morning in
  const s = buildGateJam({ sites: 1, pop: 600 });
  const g = s.g;
  for (const end = g.time + 2 * DAY; g.time < end && g.traffic.vehicles.length < 70;) { feed(g); g.step(g.dt); }

  it("every vehicle is back where it was, with its load, its route and what it was doing; every waiting trip too", () => {
    g.speed = 4;
    const h = round(g);
    expect(g.traffic.vehicles.length).toBeGreaterThan(60);
    expect(h.traffic.vehicles.length).toBe(g.traffic.vehicles.length);
    expect(h.traffic.pending.length).toBe(g.traffic.pending.length);
    expect(Object.keys(inTransit(g)).length).toBeGreaterThan(0);
    expect(inTransit(h)).toEqual(inTransit(g));
    const byId = new Map(h.traffic.vehicles.map((v) => [v.id, v]));
    let trains = 0;
    for (const v of g.traffic.vehicles) {
      const w = byId.get(v.id)!;
      expect(w, `vehicle ${v.id}`).toBeDefined();
      expect(where(w)).toBe(where(v));
      expect(w.s).toBeCloseTo(v.s, 6);
      expect(w.v).toBeCloseTo(v.v, 6);
      expect(w.route.slice(w.ri)).toEqual(v.route.slice(v.ri)); // (the way on from here)
      expect(w.trip).toEqual(v.trip);
      expect(!!w.next).toBe(!!v.next);
      expect(w.granted).toBe(v.granted);
      expect(w.stuck).toBeCloseTo(v.stuck, 6);
      // drawn where it was: the body (it is laid again along the way it came; a car half out of its driveway to
      // within half a metre), and a road train's last trailer
      expect(Math.hypot(w.x - v.x, w.y - v.y), `vehicle ${v.id} moved`).toBeLessThan(0.6);
      if (v.uPose && w.uPose) {
        trains++;
        const o = v.uPose.length - 4;
        // (one still coming out of its driveway: as its body above)
        expect(Math.hypot(w.uPose[o] - v.uPose[o], w.uPose[o + 1] - v.uPose[o + 1]), `trailer of ${v.id} moved`).toBeLessThan(v.lat !== 0 && !v.lcFrom ? 0.6 : 0.25);
      }
    }
    expect(trains).toBeGreaterThan(3);
    // the works' books are as they were: nothing went back to a yard
    for (const b of g.buildings.list) if (b.plant) expect(h.buildings.byId.get(b.id)!.plant!.out, b.kind).toEqual(b.plant.out);
    // the people driving are on their way, not at home
    const drivers = [...g.trips()].filter((t) => t.resident >= 0);
    expect(drivers.length).toBeGreaterThan(5);
    for (const t of drivers) expect(h.people.citizens.get(t.resident)!.st, `resident ${t.resident}`).toBe(g.people.citizens.get(t.resident)!.st);
    // and the clock as the player had it
    expect(h.speed).toBe(4);
    expect(h.paused).toBe(false);
    g.paused = true;
    expect(round(g).paused).toBe(true);
    g.paused = false;
    g.speed = 1;
  }, 120000);

  it("the loaded game carries on: every load that was on the road lands, none is lost and nobody stands", () => {
    const h = round(g);
    const runs = [...h.trips()].filter((t) => t.haul && !t.haul.done && t.haul.leg === "out").map((t) => t.haul!);
    expect(runs.length).toBeGreaterThan(5);
    let landed = 0;
    h.on((e) => { if (e.t === "delivery") landed++; });
    const failed = h.failedTrips, quits = h.traffic.jamQuits, breaks = h.traffic.jamBreaks;
    let worst = 0;
    for (const end = h.time + 1.5 * DAY; h.time < end;) {
      feed(h); h.step(h.dt);
      for (const v of h.traffic.vehicles) if (v.stuck > worst) worst = v.stuck;
    }
    for (const r of runs) expect(r.done, `${r.n} ${r.product} for #${r.dest}`).toBe(true);
    expect(landed).toBeGreaterThanOrEqual(runs.length);
    expect(h.failedTrips).toBe(failed);
    expect(h.traffic.jamQuits).toBe(quits);
    expect(h.traffic.jamBreaks).toBe(breaks);
    expect(worst).toBeLessThan(120);
  }, 120000);

  it("a save from before vehicles were saved still loads: empty roads that fill again", () => {
    const old = JSON.parse(JSON.stringify(g.serialize()));
    delete old.traffic; delete old.speed; delete old.paused;
    const h = Game.load(old);
    expect(h.traffic.vehicles.length).toBe(0);
    expect(h.traffic.pending.length).toBe(0);
    expect(h.speed).toBe(1);
    expect(h.paused).toBe(false);
    for (const end = h.time + 2 * HOUR; h.time < end;) { feed(h); h.step(h.dt); }
    expect(h.traffic.vehicles.length).toBeGreaterThan(4);
  }, 120000);
});
