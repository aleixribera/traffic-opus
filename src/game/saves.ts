import type { Game } from "./city";

export interface SaveMeta {
  id: string;
  name: string;
  level: number;
  playtime: number;
  residents: number;
  savedAt: number;
  thumb?: string;
  auto?: boolean;
  v?: number; // save format (2 = zoned cities)
}

const INDEX = "flowtown.saves";
const PREFIX = "flowtown.save.";

/**
 * localStorage saves. Writes go to a scratch key first and are read back before they replace the
 * real slot, so a full quota or a crash mid-write never corrupts an existing save.
 * Autosave alternates between two slots for the same reason.
 */
export class Saves {
  private autoFlip = 0;
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

  save(game: Game, name: string, id = "s" + Date.now().toString(36), auto = false): SaveMeta | null {
    const data = JSON.stringify(game.serialize());
    const meta: SaveMeta = {
      id, name, level: game.milestone, playtime: game.playtime, residents: game.people.stats.population, savedAt: Date.now(), auto, v: 2,
      thumb: this.thumb?.(), // ~192x120 jpeg: a few ms, worth it so autosaves are recognisable
    };
    try {
      localStorage.setItem(PREFIX + "tmp", data);
      if (localStorage.getItem(PREFIX + "tmp")?.length !== data.length) throw new Error("verify failed");
      localStorage.setItem(PREFIX + id, data);
      localStorage.removeItem(PREFIX + "tmp");
      const l = this.list().filter((m) => m.id !== id);
      l.push(meta);
      this.writeIndex(l);
      return meta;
    } catch {
      try { localStorage.removeItem(PREFIX + "tmp"); } catch { /* ignore */ }
      return null;
    }
  }

  autosave(game: Game) {
    this.autoFlip = 1 - this.autoFlip;
    return this.save(game, "Autosave", "auto" + this.autoFlip, true);
  }

  load(id: string): ReturnType<Game["serialize"]> | null {
    try {
      const raw = localStorage.getItem(PREFIX + id);
      return raw ? JSON.parse(raw) : null;
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
