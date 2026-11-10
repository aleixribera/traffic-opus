import "./ui/hud.css";
import { App } from "./app";
import { loadModels } from "./render/models";
import { Hud } from "./ui/hud";
import { MainMenu } from "./ui/menu";
import { TILT_MIN } from "./ui/cameraSetting";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const loading = document.getElementById("loading")!;
  const bar = loading.querySelector("i") as HTMLElement;
  const models = await loadModels((k) => (bar.style.width = `${Math.round(k * 70)}%`));
  const app = new App(canvas, models);
  const hud = new Hud(app, document.body);
  app.attachHud(hud);
  app.saves.thumb = () => {
    // (a save's picture is always the Diorama, at the player's own pitch: from the Map view the camera tips over
    // for this one frame. Far out it has risen to straight down in either view, and the picture shows that)
    const v = app.view, pitch = v.pitch, tip = pitch < TILT_MIN;
    if (tip) { v.pitch = app.dioPitch; app.terrain3d.update(v); }
    v.render();
    const src = v.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = 192;
    c.height = 120;
    const g = c.getContext("2d")!;
    const s = Math.max(c.width / src.width, c.height / src.height);
    const w = src.width * s, h = src.height * s;
    g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    // (and back, drawn again, so the tipped frame never reaches the screen)
    if (tip) { v.pitch = pitch; app.terrain3d.update(v); v.render(); }
    return c.toDataURL("image/jpeg", 0.7);
  };
  app.saves.where = () => app.savedView();
  app.saves.menuPaused = () => hud.menuPaused;
  const menu = new MainMenu(app, hud);
  app.openMenu = () => void menu.open();
  const q = new URLSearchParams(location.search);
  // ?new (a fresh city, ?seed=N), ?play (the last city): straight into a game, no title menu
  const direct = q.has("new") || q.has("play") || q.has("seed");
  if (direct || !(await menu.open((k) => (bar.style.width = `${Math.round(70 + k * 30)}%`)))) {
    const last = app.saves.latest();
    const data = last && !q.has("new") ? app.saves.load(last.id) : null;
    if (data) {
      try { app.loadGame(data, app.saves.viewOf(last!.id)); } catch { app.newGame(); }
    } else app.newGame(Number(q.get("seed")) || 7);
    app.setMode("play");
  }
  app.bindInput(canvas);
  hud.refresh();
  app.start();
  loading.style.opacity = "0";
  setTimeout(() => loading.remove(), 320);
  (window as unknown as { app: App }).app = app;
  // ?audiotest: the sound's measuring bench (audio/harness.ts), never loaded otherwise
  if (q.has("audiotest")) void import("./audio/harness");
}

/**
 * A plain notice over the game, with one way on (the start-up failure and a graphics card that drops the game's
 * picture). A browser out of 3D contexts (many tabs or games open, a GPU that crashed) says only "Error creating
 * WebGL context": the player is told what to do about it, not that.
 */
function notice(title: string, body: string, act: string, go: () => void) {
  document.getElementById("loading")?.remove();
  const n = document.createElement("div");
  n.className = "loading gl-notice";
  n.setAttribute("role", "alertdialog");
  n.innerHTML = `<div><h2></h2><p></p><button class="btn" type="button"></button></div>`;
  n.querySelector("h2")!.textContent = title;
  n.querySelector("p")!.textContent = body;
  const b = n.querySelector("button")!;
  b.textContent = act;
  b.onclick = go;
  document.body.append(n);
  b.focus();
}

const GL_FIX = "Close a few browser tabs or other games and try again. If it keeps happening, restart the browser and check that hardware acceleration is on in its settings.";

boot().catch((e) => {
  console.error(e);
  const msg = String(e?.message ?? e);
  if (/webgl/i.test(msg)) notice("The game couldn't start its 3D view", `Your browser didn't give it the graphics it needs. ${GL_FIX}`, "Try again", () => location.reload());
  else notice("The game couldn't start", msg, "Try again", () => location.reload());
});

// the graphics card dropped the game's picture mid-game (a driver reset, too many 3D tabs): the game is saved and
// comes back where it was on a reload of the last city
document.getElementById("game")?.addEventListener("webglcontextlost", (e) => {
  e.preventDefault();
  const app = (window as unknown as { app?: App }).app;
  try { if (app?.game && app.mode === "play") app.saves.autosave(app.game); } catch (err) { console.error(err); }
  notice("The 3D view stopped", `The graphics card dropped the game's picture. Your city is saved. ${GL_FIX}`, "Reload my city", () => {
    const u = new URL(location.href);
    u.searchParams.delete("new");
    u.searchParams.set("play", "");
    location.href = u.toString();
  });
}, false);
