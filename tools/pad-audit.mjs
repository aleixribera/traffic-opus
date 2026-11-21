// The controller audit: walks every screen of the game with a scripted pad, in a headless Chromium, and reports
// for each one where the focus starts, which buttons the d-pad cannot reach, what can be clicked but never focused,
// and screenshots. Then it proves Quit (framed and alone) and that a page closed mid-game keeps its last change.
//
//   node tools/pad-audit.mjs            (needs PWCORE=<path to playwright-core>, CHROME=<chromium binary> optional)
//
// Output: tools/out/pad/report.json and tools/out/pad/*.png. Runs its own vite on port 5600.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const { chromium } = await import(process.env.PWCORE ?? "playwright-core");
const OUT = "tools/out/pad";
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const PORT = 5600, BASE = `http://localhost:${PORT}`;
const only = process.argv[2] ?? "all";

function chrome() {
  if (process.env.CHROME) return process.env.CHROME;
  const root = process.platform === "win32" ? path.join(process.env.LOCALAPPDATA, "ms-playwright") : path.join(os.homedir(), ".cache/ms-playwright");
  // (the headless shell first: no browser window to draw, lighter on a busy machine)
  for (const d of fs.readdirSync(root).filter((n) => n.startsWith("chromium")).sort().reverse()) {
    // (on Windows the full Chromium: its headless shell drops the 3D view)
    const subs = process.platform === "win32" ? ["chrome-win64/chrome.exe", "chrome-win/chrome.exe"] : [ "chrome-headless-shell-linux64/chrome-headless-shell", "chrome-headless-shell-win64/chrome-headless-shell.exe", "chrome-linux64/chrome", "chrome-linux/chrome"];
    for (const sub of subs) {
      const p = path.join(root, d, sub);
      if (fs.existsSync(p)) return p;
    }
  }
  throw new Error("no chromium");
}

const vite = spawn(process.execPath, ["node_modules/vite/bin/vite.js", "--port", String(PORT), "--strictPort"], { stdio: ["ignore", "pipe", "pipe"] });
vite.stderr.on("data", (d) => process.stderr.write("[vite] " + d));
const stopVite = () => { try { vite.kill(); } catch { /* gone */ } };
process.on("exit", stopVite);
for (let k = 0; ; k++) {
  try { if ((await fetch(BASE)).ok) break; } catch { /* not yet */ }
  if (k > 120) throw new Error("vite did not start");
  await new Promise((r) => setTimeout(r, 500));
}

const STUB = () => {
  const mk = (i) => ({ index: i, connected: true, mapping: "standard", id: "stub " + i, timestamp: 0,
    buttons: Array.from({ length: 17 }, () => ({ pressed: false, value: 0, touched: false })), axes: [0, 0, 0, 0] });
  window.__pad = mk(1);
  window.__pads = [mk(0), window.__pad];
  navigator.getGamepads = () => window.__pads;
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  window.__sleep = sleep;
  // (held for two drawn frames at least: a slow frame never misses a press)
  const frames = (n) => new Promise((r) => { const f = () => (--n <= 0 ? r() : requestAnimationFrame(f)); requestAnimationFrame(f); });
  window.__press = async (i, ms = 50) => { const b = __pad.buttons[i]; b.pressed = true; b.value = 1; await frames(2); await sleep(ms); b.pressed = false; b.value = 0; await frames(2); await sleep(ms); };
  window.__cursor = () => { const t = document.querySelector(".pad-cursor")?.style.transform.match(/-?[\d.]+/g); return t ? [+t[0], +t[1]] : null; };
  window.__goto = async (x, y, tol = 3) => {
    for (let k = 0; k < 500; k++) {
      const c = __cursor();
      if (!c) { __pad.axes = [0.6, 0, 0, 0]; await sleep(30); continue; }
      const dx = x - c[0], dy = y - c[1], d = Math.hypot(dx, dy);
      if (d <= tol) { __pad.axes = [0, 0, 0, 0]; await sleep(40); return k; }
      const m = Math.min(1, 0.24 + d / 500);
      __pad.axes = [dx / d * m, dy / d * m, 0, 0];
      await sleep(16);
    }
    __pad.axes = [0, 0, 0, 0];
    return -1;
  };
  window.__focus = () => { const e = document.querySelector(".pad-focus"); return e ? (e.getAttribute("aria-label") || e.textContent || e.className).trim().replace(/\s+/g, " ").slice(0, 40) : null; };
  // walk the focus down (or another way) until it sits on a control whose words start with `label`
  window.__walkTo = async (label, dir = 13, max = 30) => {
    const trail = [];
    for (let k = 0; k < max; k++) {
      const at = __focus() ?? "";
      if (at.startsWith(label)) return k;
      if (trail[trail.length - 1] !== at) trail.push(at);
      // (stuck at the end of the menu: give up)
      if (trail.length > 1 && k > 3 && trail.slice(-1)[0] === trail.slice(-2)[0]) break;
      await __press(dir);
      await sleep(60);
    }
    console.warn("walkTo " + label + " missed: " + trail.join(" > "));
    return -1;
  };
  // where the d-pad can take the focus in the screen up now: every control, reached or not
  window.__audit = async () => {
    const { pickDir } = await import("/src/ui/padRead.ts");
    const c = window.__padctl;
    const roots = c.scope();
    if (!roots) return { scope: "map" };
    const cands = c.candidates(roots);
    const lab = (e) => (e.getAttribute("aria-label") || e.textContent || e.getAttribute("title") || e.className).trim().replace(/\s+/g, " ").slice(0, 44);
    const start = document.querySelector(".pad-focus") ?? c.firstOf(cands, roots);
    const box = (e) => e.getBoundingClientRect();
    const seen = new Set(start ? [start] : []), q = start ? [start] : [];
    while (q.length) {
      const el = q.shift();
      for (const d of ["up", "down", "left", "right"]) {
        if (el.matches("input[type=range]") && (d === "left" || d === "right")) continue;
        const others = cands.filter((x) => x !== el);
        const j = pickDir(box(el), others.map(box), d);
        if (j >= 0 && !seen.has(others[j])) { seen.add(others[j]); q.push(others[j]); }
      }
    }
    const FOC = "button, a[href], input, select, summary, textarea, [tabindex]:not([tabindex='-1'])";
    const dead = [];
    for (const r of roots) for (const e of r.querySelectorAll("*")) {
      if (e.matches(FOC) || e.closest(FOC) || e.closest("[hidden]")) continue;
      const b = e.getBoundingClientRect();
      if (b.width < 1 || b.height < 1) continue;
      if (getComputedStyle(e).cursor === "pointer" && !(e.parentElement && getComputedStyle(e.parentElement).cursor === "pointer" && !e.parentElement.matches(FOC))) dead.push(lab(e));
    }
    const texts = [...roots].flatMap((r) => [...r.querySelectorAll("input:not([type]), input[type=text], textarea")]).map((e) => e.name || lab(e));
    const off = cands.filter((e) => { const b = box(e); return b.bottom > innerHeight || b.right > innerWidth || b.top < 0; }).length;
    return { scope: roots.map((r) => r.className.split(" ").slice(0, 2).join(".")).join(" + "), start: start ? lab(start) : null,
      controls: cands.length, unreachable: cands.filter((e) => !seen.has(e)).map(lab), clickableNotFocusable: dead, textInputs: texts, offScreen: off };
  };
};

const report = [];
const log = (name, r) => { report.push({ name, ...r }); console.log(name.padEnd(28), JSON.stringify(r)); };

const browser = await chromium.launch({ executablePath: chrome(), args: ["--mute-audio", ...(process.platform === "win32" ? [] : ["--use-angle=swiftshader", "--enable-unsafe-swiftshader"]), "--ignore-gpu-blocklist"] });
browser.on("disconnected", () => { console.log("[browser gone]"); });

async function newPage(ctx, url = BASE + "/") {
  const page = await ctx.newPage();
  page.on("console", (m) => { if (m.type() === "warning" && m.text().startsWith("walkTo")) console.log("[" + m.text() + "]"); });
  page.on("pageerror", (e) => console.log("[pageerror]", e.message));
  page.on("crash", () => console.log("[crash]", url));
  await page.goto(url);
  return page;
}
const ready = (page) => page.waitForFunction(() => window.app && window.__padctl && window.app.mode, null, { timeout: 120000 });
// (L3 wakes the pad without moving the focus)
const wake = (page) => page.evaluate(async () => { await __press(10); await __sleep(300); });
async function screen(page, name, open, arg) {
  const shot = true;
  if (open) await page.evaluate(open, arg);
  await page.waitForTimeout(450);
  const r = await page.evaluate(() => __audit());
  if (shot) await page.screenshot({ path: `${OUT}/${name}.png`, timeout: 180000 });
  log(name, r);
  return r;
}
const back = (page) => page.evaluate(async () => { await __press(1); await __sleep(250); });

// ---------------------------------------------------------------------------------------------- every screen
if (only === "all" || only.startsWith("screens")) {
  for (const [w, h] of [[1920, 1080], [1440, 900]]) {
    const tag = `${w}`;
    const ctx = await browser.newContext({ viewport: { width: w, height: h } });
    await ctx.addInitScript(STUB);
    const page = await newPage(ctx);
    await ready(page);
    await wake(page);
    await screen(page, `${tag}-title-fresh`);
    await screen(page, `${tag}-title-controls`, async () => { await __walkTo("Controls"); await __press(0); });
    await back(page);
    await screen(page, `${tag}-title-load-empty`, async () => { await __walkTo("Load game"); await __press(0); });
    await back(page);
    await screen(page, `${tag}-title-news`, async () => { await __walkTo("New in"); await __press(0); });
    await back(page);
    // a new company: its name and badge first
    await screen(page, `${tag}-new-company`, async () => { await __walkTo("New company", 12); await __walkTo("New company"); await __press(0); await __sleep(800); });
    await page.evaluate(async () => { await __press(0); await __sleep(600); });
    log(`${tag}-after-start`, await page.evaluate(() => ({ mode: app.mode, modal: !!document.querySelector("[aria-modal='true']") })));
    // the pause menu and everything in it
    await screen(page, `${tag}-pause`, async () => { await __press(9); });
    for (const item of ["Company", "Save game", "Load game", "Controls", "Sound"]) {
      await screen(page, `${tag}-pause-${item.replace(/ /g, "-").toLowerCase()}`, async (it) => { await __walkTo(it, 13); await __press(0); await __sleep(300); }, item);
      await back(page);
      log(`${tag}-back-from-${item}`, await page.evaluate(() => ({ focus: __focus() })));
      await page.evaluate(async () => { await __walkTo("Resume", 12); });
    }
    await screen(page, `${tag}-pause-bottom`, async () => { await __walkTo("Quit", 13); });
    await back(page);
    // the panels and buttons on screen (Share), and each window from the top bar
    await screen(page, `${tag}-hud`, async () => { await __press(8); });
    for (const w of ["info", "progression", "economy", "city", "transport", "camera"]) {
      await screen(page, `${tag}-win-${w}`, async (k) => { app.hud.toggleWin(k); }, w);
    }
    await page.evaluate(async () => { app.hud.closeWin?.(); await __press(8); await __sleep(200); });
    // the build menu, each category
    for (const c of ["roads", "industry", "transport"]) {
      await screen(page, `${tag}-build-${c}`, async (k) => { if (__padctl.ui !== "build") { await __press(3); await __sleep(300); } if (app.hud.catOpen !== k) app.hud.catKey(k); __padctl.ui = "build"; __padctl.scopeKey = null; await __sleep(200); }, c);
    }
    await page.evaluate(async () => { await __press(3); await __sleep(200); });
    // a town's panel and a building's
    await screen(page, `${tag}-town`, async () => { app.hud.openTown(app.game.towns.list[0].id); await __press(8); await __sleep(200); });
    await page.evaluate(async () => { await __press(8); await __press(1); });
    await screen(page, `${tag}-building`, async () => { const b = app.game.buildings.list.find((x) => x.kind !== "house") ?? app.game.buildings.list[0]; app.hud.openBuilding(b); await __press(8); await __sleep(200); });
    await page.evaluate(async () => { await __press(8); await __press(1); });
    // the moments: a milestone, a town sprung up, a town grown
    await screen(page, `${tag}-banner-milestone`, async () => { const { MILESTONES } = await import("/src/game/progression.ts"); app.hud.milestone(MILESTONES[3]); });
    log(`${tag}-banner-continue`, await page.evaluate(async () => { const f = __focus(); await __press(0); await __sleep(400); return { focus: f, still: !!document.querySelector(".hud > .banner:not([hidden]) button") }; }));
    await screen(page, `${tag}-banner-grew`, async () => { app.hud.townGrew(app.game.towns.list[0].id, 2); });
    await page.evaluate(async () => { await __press(0); await __sleep(400); });
    // Explore, from the title menu
    await screen(page, `${tag}-explore`, async () => { app.openMenu(); await __sleep(600); await __walkTo("Explore"); await __press(0); await __sleep(800); await __press(8); });
    await page.evaluate(async () => { await __press(8); });
    await ctx.close();
    if (w === 1920 && only === "screens1") break;
  }
}


// a road drawn with the pad, step by step (to debug the proof's road)
if (only === "probe") {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(STUB);
  const page = await newPage(ctx);
  await ready(page); await wake(page);
  await page.evaluate(async () => { await __walkTo("New company"); await __press(0); await __sleep(800); await __press(0); await __sleep(1500); });
  const st = () => page.evaluate(() => ({ mode: app.mode, ui: __padctl.ui, tool: app.st.tool, cat: app.hud.catOpen, focus: __focus(), cur: __cursor(), segs: app.game.net.segs.size }));
  log("probe-start", await st());
  await page.evaluate(async () => { await __press(3); await __sleep(400); }); log("probe-tri", await st());
  await page.screenshot({ path: `${OUT}/probe-tri.png`, timeout: 180000 });
  await page.evaluate(async () => { await __press(0); await __sleep(400); }); log("probe-cross", await st());
  await page.evaluate(async () => { await __goto(760, 380); await __press(0); await __sleep(300); }); log("probe-p1", await st());
  await page.evaluate(async () => { await __goto(1060, 400); await __press(0); await __sleep(400); }); log("probe-p2", await st());
  await page.screenshot({ path: `${OUT}/probe-p2.png`, timeout: 180000 });
  await ctx.close();
}

// ---------------------------------------------------------------------------------------------- the proofs
if (only === "all" || only === "proof") {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  await ctx.addInitScript(STUB);
  let page = await newPage(ctx);
  await ready(page);
  await wake(page);
  // a new company, then a road drawn with the pad
  await page.evaluate(async () => { await __walkTo("New company", 12); await __walkTo("New company"); await __press(0); await __sleep(800); await __press(0); await __sleep(800); });
  const road = async (p, y) => p.evaluate(async (yy) => {
    const before = app.game.net.segs.size;
    await __press(3); await __sleep(400); await __press(0); await __sleep(300);
    await __goto(1280, yy); await __press(0); await __sleep(200); await __goto(1560, yy + 40); await __press(0); await __sleep(400);
    await __press(1); await __press(1); await __press(1); await __sleep(200);
    return { before, after: app.game.net.segs.size, mode: app.mode };
  }, y);
  const r1 = await road(page, 640);
  log("proof-road-built", r1);
  // closed mid-game straight after the change, no menu opened
  await page.close();
  page = await newPage(ctx);
  await ready(page);
  const cont = async (p) => p.evaluate(async () => { await __press(10); await __sleep(300); await __walkTo("Continue", 12); await __press(0); await __sleep(2500); return { mode: app.mode, segs: app.game.net.segs.size }; });
  const back1 = await cont(page);
  log("proof-reopened-after-close", { ...back1, kept: back1.segs === r1.after });
  // killed outright (a crash, the TV's PS-button hold) ten seconds after a change
  const r2 = await road(page, 760);
  log("proof-road-2", r2);
  await page.waitForTimeout(13000);
  const cdp = await ctx.newCDPSession(page);
  void cdp.send("Page.crash").catch(() => {}); await new Promise((r) => setTimeout(r, 1500));
  await Promise.race([page.close().catch(() => {}), new Promise((r) => setTimeout(r, 5000))]);
  page = await newPage(ctx);
  await ready(page);
  const back2 = await cont(page);
  log("proof-reopened-after-crash", { ...back2, kept: back2.segs === r2.after });
  // Quit with the pad, from the pause menu and the title menu, standalone: the window closes or goes to "/"
  const qs = await page.evaluate(async () => {
    window.__marker = 1;
    await __press(9); await __sleep(400);
    const k = await __walkTo("Quit", 13);
    return { steps: k, focus: __focus() };
  });
  await page.screenshot({ path: `${OUT}/proof-pause-quit.png`, timeout: 180000 });
  await page.evaluate(async () => { await __press(0); });
  await page.waitForTimeout(1500);
  const after = page.isClosed() ? { closed: true } : await page.evaluate(() => ({ reloaded: window.__marker === undefined, path: location.pathname }));
  log("proof-quit-standalone", { ...qs, ...after });
  await page.close().catch(() => {});
  // inside the arcade's play page: a parent page frames the game and hears the quit
  await ctx.route(BASE + "/__arcade.html", (route) => route.fulfill({ contentType: "text/html",
    body: `<!doctype html><body style="margin:0"><iframe id="g" src="/" style="border:0;width:100vw;height:100vh"></iframe><script>window.__msgs=[];addEventListener("message",(e)=>__msgs.push({data:e.data,origin:e.origin}));</script></body>` }));
  for (const where of ["title", "pause"]) {
    page = await newPage(ctx, BASE + "/__arcade.html");
    const fr = await (await page.waitForSelector("#g")).contentFrame();
    await fr.waitForFunction(() => window.app && window.__padctl && window.app.mode, null, { timeout: 120000 });
    const q = await fr.evaluate(async (w) => {
      await __press(10); await __sleep(300);
      if (w === "pause") { await __walkTo("Continue", 12); await __press(0); await __sleep(2500); await __press(9); await __sleep(400); }
      const k = await __walkTo("Quit", 13);
      return { steps: k, focus: __focus(), mode: app.mode };
    }, where);
    await page.screenshot({ path: `${OUT}/proof-framed-${where}-quit.png`, timeout: 180000 });
    await fr.evaluate(async () => { await __press(0); await __sleep(300); });
    const msgs = await page.evaluate(() => window.__msgs);
    log(`proof-quit-framed-${where}`, { ...q, msgs });
    await page.close();
  }
  await ctx.close();
}

await browser.close();
stopVite();
fs.writeFileSync(`${OUT}/report.json`, JSON.stringify(report, null, 2));
process.exit(0);
