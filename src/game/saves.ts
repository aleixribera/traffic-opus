import { unzlibSync, zlibSync } from "fflate";
import { SAVE_V, type Game } from "./city";
import type { Company } from "./company";

export interface SaveMeta {
  id: string;
  name: string;
  level: number; // milestones reached
  playtime: number;
  residents: number;
  savedAt: number;
  thumb?: string;
  auto?: boolean;
  v?: number; // save format (see SAVE_V; older ones can't be loaded)
  company?: Company; // whose save it is (saves from before companies had names have none)
}

const INDEX = "flowtown.saves";
const PREFIX = "flowtown.save.";

/** Marks a compressed save: "z1:<byte length>:" then the zlib bytes, 15 bits to a character. */
const Z = "z1:";

/**
 * Bytes as text localStorage keeps exactly: 15 bits to a character, from U+0020 up, so never a lone surrogate. Half
 * the characters base64 would take.
 */
export function packBytes(u: Uint8Array): string {
  const codes = new Uint16Array(Math.ceil((u.length * 8) / 15));
  let acc = 0, bits = 0, n = 0;
  for (let i = 0; i < u.length; i++) {
    acc = ((acc << 8) | u[i]) & 0x7fffff;
    bits += 8;
    if (bits >= 15) { bits -= 15; codes[n++] = ((acc >> bits) & 0x7fff) + 0x20; }
  }
  if (bits > 0) codes[n++] = ((acc << (15 - bits)) & 0x7fff) + 0x20;
  let s = "";
  for (let i = 0; i < n; i += 8192) s += String.fromCharCode.apply(null, codes.subarray(i, Math.min(n, i + 8192)) as unknown as number[]);
  return Z + u.length + ":" + s;
}

export function unpackBytes(s: string): Uint8Array {
  const at = s.indexOf(":", Z.length);
  const u = new Uint8Array(Number(s.slice(Z.length, at)));
  let acc = 0, bits = 0, n = 0;
  for (let i = at + 1; i < s.length && n < u.length; i++) {
    acc = ((acc << 15) | (s.charCodeAt(i) - 0x20)) & 0x7fffff;
    bits += 15;
    while (bits >= 8 && n < u.length) { bits -= 8; u[n++] = (acc >> bits) & 0xff; }
  }
  return u;
}

/** A save as stored: compressed (a late-game company is ~5 MB of JSON, more than the whole quota, and ~0.6 M characters packed). */
const pack = (json: string) => packBytes(zlibSync(new TextEncoder().encode(json), { level: 1 }));
/** Compressed off the frame: the browser's own deflate, a chunk at a time, instead of ~65 ms of script in one go. */
async function packAsync(json: string): Promise<string> {
  if (typeof CompressionStream === "undefined") return pack(json);
  const blob = new Blob([json]);
  await nextFrame();
  const z = blob.stream().pipeThrough(new CompressionStream("deflate"));
  return packBytes(new Uint8Array(await new Response(z).arrayBuffer()));
}
const newId = () => "s" + Date.now().toString(36);
const nextFrame = () => new Promise<void>((r) => setTimeout(r, 0));
/** What a stored save holds (old saves are plain JSON). */
const unpack = (raw: string): string => (raw.startsWith(Z) ? new TextDecoder().decode(unzlibSync(unpackBytes(raw))) : raw);

/**
 * localStorage saves, compressed. Writes go to a scratch key first and are read back before they replace the
 * real slot, so a full quota or a crash mid-write never corrupts an existing save.
 * Autosave alternates between two slots for the same reason.
 */
export class Saves {
  private autoFlip = 0;
  /** Per slot, the latest save begun into it: a save still compressing when a newer one begins isn't written. */
  private ticket = new Map<string, number>();
  private tickets = 0;
  thumb: (() => string | undefined) | null = null;

  list(): SaveMeta[] {
    try {
      const raw = localStorage.getItem(INDEX);
      const l = raw ? (JSON.parse(raw) as SaveMeta[]) : [];
      return l.sort((a, b) => b.savedAt - a.savedAt);
    } catch {
      return [];
    }
  }

  private writeIndex(l: SaveMeta[]) {
    localStorage.setItem(INDEX, JSON.stringify(l));
  }

  /** Saves now, in this frame (leaving the game or the tab): null if it can't be written. */
  save(game: Game, name: string, id = newId(), auto = false): SaveMeta | null {
    this.ticket.set(id, ++this.tickets);
    const meta = this.meta(game, name, id, auto);
    meta.thumb = this.thumb?.(); // ~192x120 jpeg: a few ms, worth it so saves are recognisable
    return this.write(id, pack(JSON.stringify(game.serialize())), meta) ? meta : null;
  }

  /**
   * Saves while playing on: the company is copied out now (~35 ms for a late-game one), and the thumbnail taken,
   * compressed and written over the next frames. Resolves to what was saved, or null if storage is full or a newer
   * save into the same slot came first.
   */
  async saveSoon(game: Game, name: string, id = newId(), auto = false): Promise<SaveMeta | null> {
    const ticket = ++this.tickets;
    this.ticket.set(id, ticket);
    const meta = this.meta(game, name, id, auto);
    const json = JSON.stringify(game.serialize());
    await nextFrame();
    meta.thumb = this.thumb?.();
    let data: string;
    try { data = await packAsync(json); } catch { data = pack(json); }
    if (this.ticket.get(id) !== ticket) return null;
    return this.write(id, data, meta) ? meta : null;
  }

  private meta(game: Game, name: string, id: string, auto: boolean): SaveMeta {
    return { id, name, level: game.progress.done.length, playtime: game.playtime, residents: game.people.stats.population, savedAt: Date.now(), auto, v: SAVE_V, company: game.company && { name: game.company.name, herald: { ...game.company.herald } } };
  }

  private write(id: string, data: string, meta: SaveMeta): boolean {
    try {
      localStorage.setItem(PREFIX + "tmp", data);
      if (localStorage.getItem(PREFIX + "tmp")?.length !== data.length) throw new Error("verify failed");
      localStorage.setItem(PREFIX + id, data);
      localStorage.removeItem(PREFIX + "tmp");
      const l = this.list().filter((m) => m.id !== id);
      l.push(meta);
      this.writeIndex(l);
      return true;
    } catch {
      try { localStorage.removeItem(PREFIX + "tmp"); } catch { /* ignore */ }
      return false;
    }
  }

  autosave(game: Game) {
    this.autoFlip = 1 - this.autoFlip;
    return this.save(game, `${game.cityName}, autosave`, "auto" + this.autoFlip, true);
  }

  /** The periodic autosave, while playing (see saveSoon). */
  autosaveSoon(game: Game) {
    this.autoFlip = 1 - this.autoFlip;
    return this.saveSoon(game, `${game.cityName}, autosave`, "auto" + this.autoFlip, true);
  }

  load(id: string): ReturnType<Game["serialize"]> | null {
    try {
      const raw = localStorage.getItem(PREFIX + id);
      return raw ? JSON.parse(unpack(raw)) : null;
    } catch {
      return null;
    }
  }

  latest(): SaveMeta | null {
    return this.list()[0] ?? null;
  }

  remove(id: string) {
    try {
      localStorage.removeItem(PREFIX + id);
      this.writeIndex(this.list().filter((m) => m.id !== id));
    } catch { /* ignore */ }
  }
}
