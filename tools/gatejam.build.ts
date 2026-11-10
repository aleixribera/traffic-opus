/**
 * The play-test's dead company (docs/playtest-2026-11-09.md, A1, A2, A17, B2, E1), the long run: one sawmill on a
 * single road feeding two towns and the steel chain's building sites, for six game days, with the report's four
 * sites and with eight (the overload). Prints, every four game hours: vehicles standing five game minutes and more,
 * the sawmill's trucks out against the loads it makes an hour, what the towns have landed of their planks, and how
 * far the sites are; then the real minutes at 1x to the first mine, to every site built, and to the first steel.
 * The short version, held as a test, is tests/gatejam.test.ts.
 *
 *   npx vitest run --config tools/vitest.config.ts tools/gatejam.build.ts
 *   GATEJAM_DAYS=6 GATEJAM_POP=600 GATEJAM_MILL=3 GATEJAM_SITES=1 (or 2; default both) ...
 */
import { expect, it } from "vitest";
import { buildGateJam, runGateJam } from "../tests/gatejam.scenario";

declare const process: { env: Record<string, string | undefined>; stdout: { write(s: string): void } };
const say = (s: string) => process.stdout.write(s + "\n");
const DAYS = Number(process.env.GATEJAM_DAYS ?? 6);
const only = process.env.GATEJAM_SITES ? [Number(process.env.GATEJAM_SITES)] : [1, 2];

for (const sites of only) {
  it(`the gate jam, ${sites === 1 ? "four sites" : "eight sites"}`, () => {
    const s = buildGateJam({ sites, pop: Number(process.env.GATEJAM_POP ?? 600), millLevel: Number(process.env.GATEJAM_MILL ?? 3) });
    say(`\n== ${sites * 4} building sites, ${DAYS} game days; towns of ${s.A.pop} and ${s.B.pop}; sawmill level ${s.mill.plant!.level}`);
    say("day    standing longest  trucks out (loaded/home/gate, held)  planks/h yard  town A  town B  sites");
    const r = runGateJam(s, DAYS, (st) => {
      if (Math.round(st.day * 24) % 4) return;
      say(`${st.day.toFixed(2).padStart(5)}  ${String(st.standing).padStart(4)}/${String(st.vehicles).padEnd(4)} ${String(st.longest).padStart(5)} s  ${String(st.trucksOut).padStart(2)}/${st.fleet} (${st.out}/${st.back}/${st.atGate}, ${st.held})`.padEnd(62) + `${st.perHour.toFixed(1).padStart(5)} ${String(st.yard).padStart(5)}  ${String(st.planksA).padStart(4)} %  ${String(st.planksB).padStart(4)} %  ${st.sites}`);
    });
    say(`worst: ${r.standing} standing 5 game minutes, longest stand ${r.longest} s, ${r.held} of the sawmill's trucks held at once, ${r.trucksOut} trucks out at once`);
    say(`towns' planks never below: ${r.minA} % and ${r.minB} %; jam breaks ${r.breaks}, drivers giving up ${r.quits}`);
    say(`first mine: ${r.firstMine ?? "not in the run"} real min; every site built: ${r.allSites ?? "not in the run"}; first steel: ${r.firstSteel ?? "not in the run"}`);
    expect(r.standing).toBe(0);
    // (the report's own setup: the first heavy chain inside about 90 real minutes)
    if (sites === 1 && DAYS >= 5.7) expect(r.firstSteel ?? Infinity).toBeLessThan(90);
  });
}
