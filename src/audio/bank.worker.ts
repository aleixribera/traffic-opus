// Renders the sound bank off the main thread (bank.ts): keys in, buffers out, one at a time so a key asked for in
// a hurry can jump the queue.

import { renderKey } from "./bank";

const queue: string[] = [];
let busy = false;

function pump() {
  if (busy) return;
  const key = queue.shift();
  if (key === undefined) return;
  busy = true;
  let data: Float32Array | null = null;
  try { data = renderKey(key); } catch { data = null; }
  const post = self.postMessage as (m: unknown, t?: Transferable[]) => void;
  if (data) post({ key, data }, [data.buffer]);
  else post({ key, data: null });
  busy = false;
  // (back to the event loop between sounds, so a rush order is seen)
  setTimeout(pump, 0);
}

self.onmessage = (e: MessageEvent<{ keys?: string[]; first?: string }>) => {
  if (e.data.keys) queue.push(...e.data.keys);
  if (e.data.first) {
    const i = queue.indexOf(e.data.first);
    if (i > 0) { queue.splice(i, 1); queue.unshift(e.data.first); }
  }
  pump();
};
