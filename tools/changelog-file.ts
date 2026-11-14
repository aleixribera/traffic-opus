import type { Plugin } from "vite";
import { CHANGELOG } from "../src/changelog";

/** The changelog as a file of the build, beside index.html: the home server's Arcade page reads it from GitHub Pages. */
export function changelogFile(): Plugin {
  return {
    name: "changelog-file",
    generateBundle() {
      this.emitFile({ type: "asset", fileName: "changelog.json", source: JSON.stringify(CHANGELOG) });
    },
  };
}
