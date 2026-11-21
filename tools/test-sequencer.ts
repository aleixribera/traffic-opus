import { readFileSync } from "node:fs";
import { relative } from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Orders and shards test files by how long each took (tests/durations.json, ms on a CI runner; refresh it with
 * `node tools/durations.mjs <vitest json report>...`). Longest first, so the slow scenarios start at once instead of
 * last; and `--shard i/n` splits the files into n even piles of time (longest file to the lightest pile), not of file
 * count, so every CI shard ends together. A file not listed counts as 3 s.
 */
const DURATIONS: Record<string, number> = JSON.parse(readFileSync(new URL("../tests/durations.json", import.meta.url), "utf8"));
const UNKNOWN = 3000;

const rel = (spec: TestSpecification) => relative(spec.project.config.root, spec.moduleId).replace(/\\/g, "/");
const cost = (spec: TestSpecification) => DURATIONS[rel(spec)] ?? UNKNOWN;
const byCost = (a: TestSpecification, b: TestSpecification) => cost(b) - cost(a) || (rel(a) < rel(b) ? -1 : 1);

export default class DurationSequencer extends BaseSequencer {
  async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { index, count } = this.ctx.config.shard!;
    const piles = Array.from({ length: count }, () => ({ t: 0, files: [] as TestSpecification[] }));
    for (const f of [...files].sort(byCost)) {
      const p = piles.reduce((a, b) => (b.t < a.t ? b : a));
      p.t += cost(f);
      p.files.push(f);
    }
    return piles[index - 1].files;
  }

  async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    // (the longest file first, whatever its project: the quick files fill the workers round the long scenarios)
    return [...files].sort((a, b) => a.project.config.sequence.groupOrder - b.project.config.sequence.groupOrder || byCost(a, b));
  }
}
