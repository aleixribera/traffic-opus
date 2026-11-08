/**
 * Profiles a town growing into a City: what each street it lays costs (and where the time goes), and what each town
 * tick costs as the town gets big. Writes the grown game to tools/out/city.json (a save; load it in the browser with
 * `app.loadGame(...)`) for measuring the whole sim and the renderer late in the game.
 *
 *   npx vitest run --config tools/vitest.config.ts tools/perf.build.ts
 *   PERF_POP=2000 ... to stop earlier
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { it } from "vitest";
import { Game } from "../src/game/city";
import { sizeOf } from "../src/game/towns";

const now = () => performance.now();
const out: string[] = [];
const say = (...a: unknown[]) => { const l = a.join(" "); out.push(l); process.stdout.write(l + "\n"); };

/** Wrap obj[name] to add its time to acc[label] (only the outermost call counts when it nests in itself). */
function timeIt(acc: Map<string, number>, obj: any, name: string, label = name) {
  const real = obj[name];
  let depth = 0;
  obj[name] = function (...a: unknown[]) {
    if (depth++) { try { return real.apply(this, a); } finally { depth--; } }
    const t0 = now();
    try { return real.apply(this, a); } finally { depth--; acc.set(label, (acc.get(label) ?? 0) + now() - t0); }
  };
}

it("grows a town into a city and times its streets", () => {
  const stop = Number(process.env.PERF_POP ?? 6500);
  const g = new Game(7);
  g.start();
  const t = g.towns.list[0];
  const acc = new Map<string, number>();
  const T: any = g.towns, G: any = g;
  timeIt(acc, T, "planEdge");
  timeIt(acc, g, "buildFree");
  timeIt(acc, g.net, "rebuild", "net.rebuild");
  timeIt(acc, g.traffic, "onNetworkChange", "traffic.onNetworkChange");
  timeIt(acc, g.zones, "onNetworkChange", "zones.onNetworkChange");
  timeIt(acc, g.buildings, "reattach", "buildings.reattach");
  timeIt(acc, G, "clearRoadsOverLots");
  timeIt(acc, T, "zone", "towns.zone");
  timeIt(acc, G, "candidates");
  timeIt(acc, G, "freeLots");
  timeIt(acc, G, "growIn");
  timeIt(acc, G, "moveInto");
  timeIt(acc, G, "moveOutOf");
  timeIt(acc, T, "redevelop");
  timeIt(acc, T, "census");
  timeIt(acc, G, "rebuildLots");
  timeIt(acc, G, "zoneCells");
  // each street: its own cost (laying it) and the next tick's (the re-zoning it causes)
  const streets: { pop: number; lay: number; tick: number; parts: Record<string, number> }[] = [];
  let pending: { pop: number; lay: number; parts: Record<string, number> } | null = null;
  const realLay = T.layEdge.bind(T);
  T.layEdge = (tt: any, e: any) => {
    const before = new Map(acc);
    const t0 = now();
    const ok = realLay(tt, e);
    const dt = now() - t0;
    if (ok) {
      const parts: Record<string, number> = {};
      for (const [k, v] of acc) { const d = v - (before.get(k) ?? 0); if (d > 0.05) parts[k] = +d.toFixed(2); }
      pending = { pop: tt.pop, lay: dt, parts };
    }
    return ok;
  };
  const ticks: { pop: number; ms: number; street: boolean }[] = [];
  const realTick = T.tick.bind(T);
  let afterStreet: typeof pending = null;
  T.tick = () => {
    const before = new Map(acc);
    const t0 = now();
    realTick();
    const ms = now() - t0;
    const street = !!pending;
    ticks.push({ pop: t.pop, ms, street });
    if (afterStreet) {
      // the tick after a street: re-zoning and lots
      const parts: Record<string, number> = { ...afterStreet.parts };
      for (const [k, v] of acc) { const d = v - (before.get(k) ?? 0); if (d > 0.05) parts["next:" + k] = +d.toFixed(2); }
      streets.push({ pop: afterStreet.pop, lay: afterStreet.lay, tick: ms, parts });
      afterStreet = null;
    }
    if (pending) { afterStreet = pending; pending = null; }
  };
  const t0 = now();
  let day = 0;
  for (; day < 160 && t.pop < stop; day++) {
    g.fastForward(t.id, 24);
    const recent = streets.filter((s) => s.pop >= t.pop * 0.8);
    const avg = (f: (s: (typeof streets)[0]) => number) => recent.length ? (recent.reduce((a, s) => a + f(s), 0) / recent.length).toFixed(1) : "-";
    say(`day ${day}: pop ${t.pop} (${["Hamlet", "Village", "Town", "City", "Metropolis"][sizeOf(t.pop)]}), buildings ${g.buildings.list.length}, cells ${[...g.zones.allCells()].length}, streets ${t.built.size}, last streets lay ${avg((s) => s.lay)} ms + next tick ${avg((s) => s.tick)} ms, ${((now() - t0) / 1000).toFixed(0)} s`);
  }
  // where the time goes per street, at the end (the biggest town)
  const late = streets.filter((s) => s.pop >= t.pop * 0.7);
  const sum: Record<string, number> = {};
  for (const s of late) for (const [k, v] of Object.entries(s.parts)) sum[k] = (sum[k] ?? 0) + v / late.length;
  say(`\n${late.length} late streets (pop >= ${Math.round(t.pop * 0.7)}): lay ${(late.reduce((a, s) => a + s.lay, 0) / late.length).toFixed(1)} ms, next tick ${(late.reduce((a, s) => a + s.tick, 0) / late.length).toFixed(1)} ms`);
  for (const [k, v] of Object.entries(sum).sort((a, b) => b[1] - a[1])) say(`  ${k.padEnd(34)} ${v.toFixed(2)} ms`);
  const lt = ticks.filter((x) => x.pop >= t.pop * 0.7 && !x.street);
  const srt = lt.map((x) => x.ms).sort((a, b) => a - b);
  say(`town ticks without a street (late): mean ${(srt.reduce((a, b) => a + b, 0) / srt.length).toFixed(2)} ms, p95 ${srt[Math.floor(srt.length * 0.95)]?.toFixed(2)} ms, max ${srt[srt.length - 1]?.toFixed(2)} ms`);
  const tot: Record<string, number> = {};
  for (const [k, v] of acc) tot[k] = +(v / 1000).toFixed(2);
  say("total seconds per part over the whole run:", JSON.stringify(tot));
  const homes = g.buildings.list.filter((b) => b.zone && b.town === t.id);
  say(`end: day ${day}, pop ${t.pop}, households ${t.households}, homes cap ${t.homes}, shops ${t.shops}, buildings ${homes.length}`);
  mkdirSync("tools/out", { recursive: true });
  writeFileSync("tools/out/perf.log", out.join("\n") + "\n");
  writeFileSync("tools/out/city.json", JSON.stringify(g.serialize()));
}, 3_600_000);
