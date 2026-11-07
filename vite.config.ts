import { defineConfig } from "vitest/config";

export default defineConfig({
  // relative base so the build runs from any static host path (e.g. GitHub Pages)
  base: "./",
  server: { port: 5317 },
  build: { chunkSizeWarningLimit: 1200 }, // three.js is most of the bundle; one chunk loads fastest here
  // the traffic tests simulate minutes of busy junctions: give them time on a loaded or slower test machine
  test: { include: ["tests/**/*.test.ts"], testTimeout: 30000 },
});
