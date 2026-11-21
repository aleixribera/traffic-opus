// Quit, in the title menu and the pause menu. The game is saved first. Inside the arcade's play page (the game in a
// frame) the page is told, and it removes the frame, syncs the saves and goes back (on the TV it closes the kiosk
// window). On its own, the window closes, or, where the browser won't close a window it didn't open, goes to the
// site's front page.

/** The part of the window Quit uses (a test hands in its own). */
export interface QuitWindow {
  parent: unknown;
  closed: boolean;
  close(): void;
  location: { origin: string; assign(url: string): void };
  setTimeout(fn: () => void, ms: number): unknown;
}

export const QUIT_MESSAGE = { type: "arcade:quit" } as const;

export function quitGame(save: () => void, w: QuitWindow = window as unknown as QuitWindow): void {
  // (a save that fails never keeps the player in)
  try { save(); } catch (err) { console.error(err); }
  if (w.parent && w.parent !== w) {
    (w.parent as { postMessage(m: unknown, origin: string): void }).postMessage(QUIT_MESSAGE, w.location.origin);
    return;
  }
  w.close();
  w.setTimeout(() => { if (!w.closed) w.location.assign("/"); }, 300);
}
