import { defineConfig } from "vitest/config";

// Runs only the build scripts in tools/ (not part of the test suite).
export default defineConfig({ test: { include: ["tools/*.build.ts"], testTimeout: 3600000, root: "." } });
