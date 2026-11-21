import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";
import { changelogFile } from "./tools/changelog-file";
import BudgetReporter from "./tools/test-budget";
import DurationSequencer from "./tools/test-sequencer";

/**
 * All but one of the cores, at most 12 (CI: all four), each at idle priority (tests/setup/lowprio.ts) so a game on
 * the same machine keeps its CPU. TEST_WORKERS overrides the count.
 */
const CORES = availableParallelism();
const WORKERS = Math.max(1, Number(process.env.TEST_WORKERS) || (process.env.CI ? CORES : Math.min(12, CORES - 1)));

/**
 * The long traffic and town scenarios: each simulates minutes to hours of a busy map and takes 20 s to 3 min of CPU
 * (timed 2026-11-10; together two thirds of the suite's time). They guard the sim end to end, so they run at
 * integration (`npm run test:full`), not while working on something else. Everything not listed is the quick suite
 * (`npm test`, budget 20 s). A new test file that runs longer than about 3 s belongs here.
 */
export const SCENARIOS = [
  "gatecures", "junctionflow", "trailers", "rhythm", "gatejam", "signals", "saves", "roadtrain", "flow", "commerce",
  "city", "transit", "convoy", "townplan", "spawn", "terrain", "economy", "zonecache", "fleet", "lots", "streetwall", "deadlock",
  "gatering", "forecast", "density", "growth",
].map((n) => `tests/${n}.test.ts`);
const BALANCE = ["tests/balance.test.ts"];
/**
 * The late save run for ten game days, about 250 vehicles all the way (tests/latesave.test.ts): the soak test that
 * no deadlock lasts. Half an hour to an hour of CPU, so like the balance playthrough it runs on its own
 * (`npm run test:soak`), after a change to the traffic sim, not in the full suite or on the CI runner.
 */
const SOAK = ["tests/latesave.test.ts"];

export default defineConfig({
  // relative base so the build runs from any static host path (e.g. GitHub Pages)
  base: "./",
  // changelog.json beside index.html, for the home server's Arcade page
  plugins: [changelogFile()],
  server: { port: 5317 },
  build: { chunkSizeWarningLimit: 1200 }, // three.js is most of the bundle; one chunk loads fastest here
  test: {
    maxWorkers: WORKERS,
    setupFiles: ["tests/setup/lowprio.ts"],
    // longest file first, and `--shard` split by time not file count (CI): tests/durations.json
    sequence: { sequencer: DurationSequencer },
    // dots and failures only, plus a loud line past the time budget; `--reporter=verbose` lists each file's time
    reporters: ["dot", new BudgetReporter()],
    // a quick test is a few seconds at most: past 15 s it fails, so a slow one is moved or fixed, not lived with
    // (many files build a whole game in beforeAll, hence the hook time)
    testTimeout: 15000,
    hookTimeout: 30000,
    slowTestThreshold: 2000,
    projects: [
      { extends: true, test: { name: "quick", include: ["tests/**/*.test.ts"], exclude: [...SCENARIOS, ...BALANCE, ...SOAK] } },
      { extends: true, test: { name: "scenarios", include: SCENARIOS, testTimeout: 300000, hookTimeout: 300000 } },
      { extends: true, test: { name: "balance", include: BALANCE, testTimeout: 3600000, hookTimeout: 3600000 } },
      { extends: true, test: { name: "soak", include: SOAK, testTimeout: 7200000, hookTimeout: 300000 } },
    ],
  },
});
