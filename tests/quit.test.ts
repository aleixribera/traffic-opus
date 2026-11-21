import { describe, expect, it } from "vitest";
import { QUIT_MESSAGE, quitGame, type QuitWindow } from "../src/ui/quit";

const win = (framed: boolean) => {
  const log: string[] = [];
  const timers: (() => void)[] = [];
  const w: QuitWindow & { log: string[]; timers: (() => void)[] } = {
    log, timers, parent: null, closed: false,
    close() { log.push("close"); },
    location: { origin: "https://arcade.test", assign(u: string) { log.push("assign " + u); } },
    setTimeout(fn: () => void) { timers.push(fn); return 0; },
  };
  w.parent = framed ? { postMessage: (m: unknown, o: string) => log.push(`post ${JSON.stringify(m)} ${o}`) } : w;
  return w;
};

describe("Quit", () => {
  it("saves first, then tells the arcade's page that frames the game", () => {
    const w = win(true);
    quitGame(() => w.log.push("save"), w);
    expect(w.log).toEqual(["save", `post ${JSON.stringify(QUIT_MESSAGE)} https://arcade.test`]);
  });
  it("on its own, closes the window, else goes to the front page", () => {
    const w = win(false);
    quitGame(() => w.log.push("save"), w);
    expect(w.log).toEqual(["save", "close"]);
    w.timers[0]();
    expect(w.log).toEqual(["save", "close", "assign /"]);
    const w2 = win(false);
    quitGame(() => {}, w2);
    w2.closed = true;
    w2.timers[0]();
    expect(w2.log).toEqual(["close"]);
  });
  it("still quits when the save fails", () => {
    const w = win(true);
    quitGame(() => { throw new Error("quota"); }, w);
    expect(w.log[0]).toMatch(/^post/);
  });
});
