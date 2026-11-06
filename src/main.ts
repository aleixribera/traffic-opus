import "./ui/hud.css";
import { App } from "./app";
import { loadModels } from "./render/models";
import { Hud } from "./ui/hud";

async function boot() {
  const canvas = document.getElementById("game") as HTMLCanvasElement;
  const loading = document.getElementById("loading")!;
  const bar = loading.querySelector("i") as HTMLElement;
  const models = await loadModels((k) => (bar.style.width = `${Math.round(k * 100)}%`));
  const app = new App(canvas, models);
  const hud = new Hud(app, document.body);
  app.attachHud(hud);
  app.saves.thumb = () => {
    app.view.render();
    const src = app.view.renderer.domElement;
    const c = document.createElement("canvas");
    c.width = 192;
    c.height = 120;
    const g = c.getContext("2d")!;
    const s = Math.max(c.width / src.width, c.height / src.height);
    const w = src.width * s, h = src.height * s;
    g.drawImage(src, (c.width - w) / 2, (c.height - h) / 2, w, h);
    return c.toDataURL("image/jpeg", 0.7);
  };
  const last = app.saves.latest();
  const data = last ? app.saves.load(last.id) : null;
  if (data && !location.search.includes("new")) {
    try { app.loadGame(data); } catch { app.newGame(); }
  } else app.newGame(Number(new URLSearchParams(location.search).get("seed")) || 7);
  app.bindInput(canvas);
  hud.refresh();
  app.start();
  loading.style.opacity = "0";
  setTimeout(() => loading.remove(), 320);
  (window as unknown as { app: App }).app = app;
}

boot().catch((e) => {
  console.error(e);
  const l = document.getElementById("loading");
  if (l) l.textContent = "Couldn't start the game: " + (e?.message ?? e);
});
