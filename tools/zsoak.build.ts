import { readFileSync, writeFileSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { it } from "vitest";
import { Game } from "../src/game/city";
import { HOUR } from "../src/game/society";
import { stuckNow } from "../src/sim/traffic";

// late save for 10 days: hourly standing line, a snapshot every 6 h (last two kept), stop 3 h after a gridlock forms
it("soak probe", () => {
  const g = Game.load(JSON.parse(gunzipSync(readFileSync("tests/fixtures/lategame.json.gz")).toString()));
  const tr = g.traffic, out: string[] = [];
  const say = (s: string) => { out.push(s); writeFileSync("tools/zsoak.txt", out.join("\n")); };
  const t0 = tr.time;
  say(`start ${(t0 / HOUR).toFixed(1)} h`);
  let i = 0, hi = 0, onset = -1, snaps = 0;
  while (tr.time < t0 + 240 * HOUR) {
    g.step(1 / 30); i++;
    if (i % 300) continue;
    const st = tr.vehicles.filter((v) => stuckNow(v, 15)).length;
    hi = Math.max(hi, st);
    const h = Math.floor((tr.time - t0) / HOUR);
    if (i % 108000 === 0) {
      say(`+${h} h: vehicles ${tr.vehicles.length} standing max ${hi} now ${st} releases ${tr.cycleReleases} breaks ${tr.jamBreaks} quits ${tr.jamQuits} towns ${g.towns.list.map((t) => t.pop).join("/")}`);
      hi = 0;
      if (h % 6 === 0 && onset < 0) writeFileSync(`tools/out/snap${snaps++ % 2}.json`, JSON.stringify({ h, save: g.serialize() }));
    }
    if (onset < 0 && st >= 25) { onset = tr.time; say(`ONSET +${((tr.time - t0) / HOUR).toFixed(2)} h standing ${st}`); }
    if (onset >= 0 && tr.time > onset + 3 * HOUR) break;
  }
  say("end");
}, 7_000_000);
