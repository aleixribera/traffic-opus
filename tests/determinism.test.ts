// The sim gives the same game for the same steps, however fast the machine runs them: no clock, no Math.random.
// (A scenario that once failed on a loaded PC and passed alone: the sim was not the cause, it gives the same numbers
// with a clock a hundred times slower. Kept so it stays that way: the render may budget its frames by the clock,
// the game it draws may not.)

import { afterEach, describe, expect, it } from "vitest";
import { Game } from "../src/game/city";

/** The code that runs the game itself (not the render, the UI or the sound). */
const SIM_DIRS = ["src/sim", "src/game", "src/roads", "src/world", "src/core"];
/** Files there that may read the clock: not part of a step (save ids, yielding while a save is written). */
const ALLOWED = new Set(["src/game/saves.ts"]);
const CLOCK = /\b(?:performance\.now|Date\.now|Math\.random|setTimeout|setInterval|requestAnimationFrame|requestIdleCallback|crypto\.(?:getRandomValues|randomUUID))\b|\bnew Date\(/;

type Fs = { readFileSync(p: string, e: "utf8"): string; readdirSync(p: string): string[]; statSync(p: string): { isDirectory(): boolean } };
const node = (m: string) => import(/* @vite-ignore */ m);

function files(fs: Fs, dir: string): string[] {
  return fs.readdirSync(dir).flatMap((f) => {
    const p = `${dir}/${f}`;
    return fs.statSync(p).isDirectory() ? files(fs, p) : p.endsWith(".ts") ? [p] : [];
  });
}

describe("the sim is deterministic", () => {
  it("reads no clock and no Math.random", async () => {
    const fs = (await node("fs")) as Fs;
    const bad: string[] = [];
    for (const d of SIM_DIRS) for (const f of files(fs, d)) {
      if (ALLOWED.has(f)) continue;
      fs.readFileSync(f, "utf8").split("\n").forEach((line, i) => {
        // (comments may name them)
        const code = line.replace(/\/\/.*$/, "");
        if (CLOCK.test(code)) bad.push(`${f}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(bad).toEqual([]);
  });

  const real = { now: performance.now.bind(performance), date: Date.now, random: Math.random };
  afterEach(() => {
    performance.now = real.now;
    Date.now = real.date;
    Math.random = real.random;
  });

  /** A new game run for `steps` steps: where everything on the road is, and the company's books. */
  function play(steps: number) {
    const g = new Game(7);
    g.start();
    for (let i = 0; i < steps; i++) g.step(g.dt);
    const vs = g.traffic.vehicles.map((v) => `${v.id}:${v.edge.kind}:${v.s.toFixed(6)}:${v.v.toFixed(6)}:${v.look}`);
    return { t: g.time, vs, money: g.money, failed: g.failedTrips, buildings: g.buildings.list.length, pop: g.towns.list.map((t) => t.pop) };
  }

  it("plays the same with a clock a hundred times slower and other dice", () => {
    const N = 30 * 600; // (ten game minutes)
    const a = play(N);
    expect(a.vs.length).toBeGreaterThan(0);
    // every look at the clock 50 ms on, as on a PC too busy to keep up; and Math.random from another stream
    let t = real.now(), d = real.date();
    performance.now = () => (t += 50);
    Date.now = () => (d += 50);
    let k = 12345;
    Math.random = () => ((k = (k * 1103515245 + 12345) & 0x7fffffff) / 0x80000000);
    const b = play(N);
    expect(b).toEqual(a);
  });
});
