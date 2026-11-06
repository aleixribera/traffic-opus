import { defineConfig } from "vitest/config";

export default defineConfig({
  // relative base so the build runs from any static host path (e.g. GitHub Pages)
  base: "./",
  server: { port: 5317 },
  build: { chunkSizeWarningLimit: 1200 }, // three.js is most of the bundle; one chunk loads fastest here
  test: { include: ["tests/**/*.test.ts"] },
});
