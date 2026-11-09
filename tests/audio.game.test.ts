// The game's sound as the game calls it (audio/index.ts GameAudio), on a stand-in for the browser's audio context:
// nodes that connect to nothing and a clock the test moves. What is checked is what was asked to play, and when.

import { beforeAll, describe, expect, it } from "vitest";
import { GameAudio } from "../src/audio";

/** An audio node (or the context's destination): every parameter can be set and scheduled, every call does nothing. */
function fakeNode(): unknown {
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {}, cancelScheduledValues() {} });
  const calls = new Set(["connect", "disconnect", "start", "stop", "setPeriodicWave"]);
  return new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) { if (!(k in t)) t[k] = calls.has(k as string) ? () => {} : param(); return t[k]; },
    set(t, k, v) { t[k] = v; return true; },
  });
}

/** The context: running, at whatever time the test says. */
function fakeContext() {
  const ctx = { currentTime: 0, state: "running", sampleRate: 48000, destination: fakeNode(), resume: async () => {}, suspend: async () => {} };
  return new Proxy(ctx as typeof ctx & Record<string, unknown>, {
    get(t, k: string) { return k in t ? t[k] : k.startsWith("create") ? fakeNode : undefined; },
  });
}

beforeAll(() => {
  // (a buffer is only ever asked for its length here)
  (globalThis as unknown as { AudioBuffer: unknown }).AudioBuffer = class {
    length: number; sampleRate: number; duration: number;
    private data: Float32Array;
    constructor(o: { length: number; sampleRate: number }) { this.length = o.length; this.sampleRate = o.sampleRate; this.duration = o.length / o.sampleRate; this.data = new Float32Array(o.length); }
    getChannelData() { return this.data; }
  };
});

/** The sound, started on a stand-in context, with these sounds made. */
function started(keys: string[]) {
  const audio = new GameAudio({ worker: false });
  audio.bank.bake(keys);
  const ctx = fakeContext();
  audio.start(ctx as unknown as BaseAudioContext);
  const at = (t: number) => { ctx.currentTime = t; };
  const played = () => audio.debug().played;
  return { audio, at, played };
}

describe("the moments' stings", () => {
  it("spoiled goods are a moment, not every late truck: once, then not again for half a minute", () => {
    // (a dairy on a road too slow for its milk lands every load late: app.ts asks for the sting at each delivery)
    const { audio, at, played } = started(["sting:spoil", "sting:milestone"]);
    at(10);
    audio.sting("spoil");
    expect(played()).toBe(1);
    for (const t of [13, 16, 19, 25, 39]) { at(t); audio.sting("spoil"); }
    expect(played()).toBe(1);
    // other moments are not held up by it
    at(39.5);
    audio.sting("milestone");
    expect(played()).toBe(2);
    at(41);
    audio.sting("spoil");
    expect(played()).toBe(3);
  });

  it("two moments at once never talk over each other: the second waits its turn, and is dropped if the wait is long", () => {
    const { audio, at, played } = started(["sting:milestone", "sting:townGrew", "sting:newTown", "sting:landmark"]);
    at(5);
    for (const id of ["milestone", "townGrew", "newTown", "landmark", "milestone", "townGrew", "newTown", "landmark"] as const) audio.sting(id);
    // (each sting is a few seconds long: only those that can start within 5 s are kept)
    expect(played()).toBeGreaterThanOrEqual(2);
    expect(played()).toBeLessThan(8);
  });
});

describe("the interface", () => {
  it("a road being laid does not silence the desk: an undo, a knock or the next road half a second on is heard", () => {
    const { audio, at, played } = started(["bed:gravel", "ui:roadEnd", "ui:undo", "ui:error"]);
    at(10);
    // (320 m: 1.2 s of gravel, and the thump as it stops)
    audio.road(320);
    expect(played()).toBe(2);
    at(10.5);
    audio.play("undo");
    expect(played()).toBe(3);
    at(10.9);
    audio.road(40);
    expect(played()).toBe(5);
    // still never two within 40 ms
    at(10.92);
    audio.play("error");
    expect(played()).toBe(5);
    at(11);
    audio.play("error");
    expect(played()).toBe(6);
  });
});
