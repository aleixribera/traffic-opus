// Refreshes tests/durations.json (what tools/test-sequencer.ts orders and shards by) from vitest JSON reports:
//   npx vitest run --project quick --project scenarios --reporter=json --outputFile.json=.scratch/t.json
//   node tools/durations.mjs .scratch/t.json [more.json...]
// Times are ms per file, as measured; keep them from one kind of machine (the CI runner's are what shard best).
import { readFileSync, writeFileSync } from "node:fs";

const out = {};
for (const f of process.argv.slice(2)) {
  for (const r of JSON.parse(readFileSync(f, "utf8")).testResults) {
    const name = r.name.replace(/\\/g, "/").replace(/^.*?\/tests\//, "tests/");
    out[name] = Math.round(r.endTime - r.startTime);
  }
}
const sorted = Object.fromEntries(Object.entries(out).sort((a, b) => b[1] - a[1]));
writeFileSync(new URL("../tests/durations.json", import.meta.url), JSON.stringify(sorted, null, 1) + "\n");
console.log(`${Object.keys(sorted).length} files, ${(Object.values(sorted).reduce((a, b) => a + b, 0) / 1000).toFixed(0)} s in all`);
