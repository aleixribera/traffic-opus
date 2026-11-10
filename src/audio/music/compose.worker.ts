// Writes the wireless's next tune off the main thread (music/player.ts): an ask in, a sheet out, its arrays handed
// over rather than copied. Writing a tune takes a few milliseconds, and the first one of a session several more
// while the browser compiles the composer; none of that lands on a frame.

import { compose, type Mood, type NameSource } from "./compose";
import { sheetBuffers, sheetOf } from "./sheet";

export interface WriteAsk { id: number; seed: number; mood: Mood; src: NameSource; avoid: string[] }

self.onmessage = (e: MessageEvent<WriteAsk>) => {
  const a = e.data;
  const sheet = sheetOf(compose(a.seed, a.mood, a.src, new Set(a.avoid)));
  (self.postMessage as (m: unknown, t?: Transferable[]) => void)({ id: a.id, sheet }, sheetBuffers(sheet));
};
