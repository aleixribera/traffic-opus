import { availableParallelism } from "node:os";
import { defineConfig } from "vitest/config";

/**
 * Tests share this PC with games, so they stay small: at most 3 workers (a quarter of a 12-thread CPU), each at idle
 * priority (tests/setup/lowprio.ts). TEST_WORKERS overrides the count, e.g. TEST_WORKERS=6 when nothing else runs.
 */
const WORKERS = Math.max(1, Number(process.env.TEST_WORKERS) || Math.min(3, Math.floor(availableParallelism() / 4)));

/**
 * The long traffic and town scenarios: each simulates minutes to hours of a busy map and takes 20 s to 3 min of CPU
 * (timed 2026-11-10; together two thirds of the suite's time). They guard the sim end to end, so they run at
 * integration (`npm run test:full`), not while working on something else. Everything not listed is the quick suite
 * (`npm test`). A new test file that runs longer than about 20 s belongs here.
 */
export const SCENARIOS = [
  "gatecures", "junctionflow", "trailers", "rhythm", "gatejam", "signals", "saves", "roadtrain", "flow", "commerce",
  "city", "transit", "convoy", "townplan", "spawn", "terrain", "economy", "zonecache", "fleet", "lots", "streetwall", "deadlock",
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
  server: { port: 5317 },
  build: { chunkSizeWarningLimit: 1200 }, // three.js is most of the bundle; one chunk loads fastest here
  test: {
    maxWorkers: WORKERS,
    setupFiles: ["tests/setup/lowprio.ts"],
    // the traffic tests simulate minutes of busy junctions: give them time on a loaded or slower test machine
    testTimeout: 30000,
    hookTimeout: 30000, // many files build a whole game in beforeAll; under load that passes vitest's default 10 s
    projects: [
      { extends: true, test: { name: "quick", include: ["tests/**/*.test.ts"], exclude: [...SCENARIOS, ...BALANCE, ...SOAK] } },
      { extends: true, test: { name: "scenarios", include: SCENARIOS, testTimeout: 300000, hookTimeout: 300000 } },
      { extends: true, test: { name: "balance", include: BALANCE, testTimeout: 3600000, hookTimeout: 3600000 } },
      { extends: true, test: { name: "soak", include: SOAK, testTimeout: 7200000, hookTimeout: 300000 } },
    ],
  },
});
