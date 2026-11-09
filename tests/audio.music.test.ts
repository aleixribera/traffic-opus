import { describe, expect, it } from "vitest";
import {
  BLUES, EXT, FORM_BARS, RANGE, chordAt, chorus, compose, firmShort, inScale, isTone, moodFor, swung, tuneName,
  type Chord, type Mood, type Note, type Tune,
} from "../src/audio/music/compose";
import { mulberry32 } from "../src/core/noise";

const MOODS: Mood[] = ["day", "night", "winterDay", "winterNight"];
const SRC = { towns: ["Alder Run", "Cobb's Ferry", "Marlow"], company: "Carver & Sons Haulage" };
const pc = (m: number) => ((m % 12) + 12) % 12;
const pcDist = (a: number, b: number) => { const d = pc(a - b); return Math.min(d, 12 - d); };
const same = (a: Chord, b: Chord) => a.root === b.root && a.q === b.q;

const TUNES: Tune[] = [];
for (let seed = 1; seed <= 40; seed++) for (const mood of MOODS) TUNES.push(compose(seed, mood, SRC));
const of = (t: Tune, i: Note["i"]) => t.notes.filter((n) => n.i === i);

describe("the wireless: composition", () => {
  it("is deterministic for a seed, and no two seeds write the same tune", () => {
    expect(compose(11, "day", SRC)).toEqual(compose(11, "day", SRC));
    const sig = (t: Tune) => of(t, "lead").map((n) => `${n.t}:${n.m}`).join(",");
    const seen = new Set<string>();
    for (const t of TUNES.filter((x) => x.mood === "day")) {
      const s = `${t.form}|${t.key}|${t.bpm}|${sig(t)}`;
      expect(seen.has(s)).toBe(false);
      seen.add(s);
    }
    // not just a transposition of one another either: the melodies' shapes differ
    const shape = (t: Tune) => of(t, "lead").slice(0, 24).map((n, i, a) => (i ? n.m - a[i - 1].m : 0)).join(",");
    expect(new Set(TUNES.filter((x) => x.mood === "day").map(shape)).size).toBe(40);
  });

  it("forms have the right number of bars", () => {
    const r = mulberry32(3);
    for (const f of ["blues", "aaba", "minorBlues", "ballad"] as const) {
      for (const last of [false, true]) {
        const c = chorus(f, 5, r, last);
        expect(c.length).toBe(FORM_BARS[f]);
        for (const bar of c) { expect(bar.length).toBeGreaterThanOrEqual(1); expect(bar.length).toBeLessThanOrEqual(2); }
        // starts on the tonic; the last chorus ends on it
        expect(c[0][0].root).toBe(5);
        if (last) expect(c[c.length - 1][0].root).toBe(5);
      }
    }
    expect(FORM_BARS).toEqual({ blues: 12, aaba: 32, minorBlues: 12, ballad: 16 });
    for (const t of TUNES) {
      const N = FORM_BARS[t.form];
      // every head and solo chorus runs its bars in order, and a chorus that starts at the top is whole
      const heads = t.bars.filter((b) => b.sec === "head");
      expect(heads.length % N).toBe(0);
      expect(heads.length).toBeGreaterThanOrEqual(N);
      heads.forEach((b, i) => expect(b.idx).toBe(i % N));
      for (let i = 1; i < t.bars.length; i++) {
        const a = t.bars[i - 1], b = t.bars[i];
        if (b.idx > 0 && a.sec === b.sec) expect(b.idx).toBe(a.idx + 1);
      }
      // intro, head, solos, out, tag, a last bar: in that order
      const order = ["intro", "head", "solo", "out", "tag", "end"];
      const secs = t.bars.map((b) => order.indexOf(b.sec));
      for (let i = 1; i < secs.length; i++) expect(secs[i]).toBeGreaterThanOrEqual(secs[i - 1]);
      expect(new Set(secs).size).toBe(6);
      expect(t.bars[t.bars.length - 1].sec).toBe("end");
      expect(t.bars[t.bars.length - 1].chords[0].root).toBe(t.key);
      expect(t.beats).toBe(t.bars.length * 4 + 4);
    }
  });

  it("blues is a blues: I, IV in bar five, V in bar ten", () => {
    for (const t of TUNES.filter((x) => x.form === "blues" || x.form === "minorBlues")) {
      const h = t.bars.filter((b) => b.sec === "head");
      expect(h[0].chords[0].root).toBe(t.key);
      expect(h[4].chords[0].root).toBe(pc(t.key + 5));
      expect(h[9].chords[0].root).toBe(pc(t.key + 7));
      expect(h[6].chords[0].root).toBe(t.key);
    }
  });

  it("moods: day swings at a medium tempo, night is slow, winter is sparse", () => {
    const by = (m: Mood) => TUNES.filter((t) => t.mood === m);
    for (const t of by("day")) { expect(t.bpm).toBeGreaterThanOrEqual(112); expect(t.bpm).toBeLessThanOrEqual(176); expect(["blues", "aaba"]).toContain(t.form); expect(t.minor).toBe(false); }
    for (const t of [...by("night"), ...by("winterNight")]) { expect(t.bpm).toBeLessThanOrEqual(84); expect(t.bpm).toBeGreaterThanOrEqual(56); }
    for (const t of by("winterDay")) expect(t.bpm).toBeLessThanOrEqual(106);
    const density = (ts: Tune[]) => ts.reduce((a, t) => a + of(t, "lead").length + of(t, "piano").length, 0) / ts.reduce((a, t) => a + t.beats, 0);
    expect(density(by("winterDay"))).toBeLessThan(density(by("day")) * 0.85);
    // every form and both horns turn up
    expect(new Set(TUNES.map((t) => t.form)).size).toBe(4);
    expect(new Set(TUNES.map((t) => t.lead)).size).toBe(2);
    // keys the stings' F major sits with
    for (const t of TUNES) expect(t.minor ? [2, 7, 9] : [5, 10, 0, 7]).toContain(t.key);
    for (const t of TUNES) { expect(t.swing).toBeGreaterThanOrEqual(0.58); expect(t.swing).toBeLessThanOrEqual(0.67); }
  });

  it("every note is accounted for by its chord", () => {
    for (const t of TUNES) {
      const melody = (voice: "lead" | "piano") => of(t, voice);
      for (const voice of ["lead", "piano"] as const) {
        const ns = melody(voice);
        ns.forEach((n, i) => {
          const ch = chordAt(t.bars, n.t), why = `${t.name} (${t.seed} ${t.mood}) ${voice} t=${n.t} m=${n.m} ${n.role}`;
          expect(n.m, why).toBeGreaterThanOrEqual(RANGE[voice][0]);
          expect(n.m, why).toBeLessThanOrEqual(RANGE[voice][1]);
          if (n.role === "root") expect(pc(n.m), why).toBe(ch.root);
          else if (n.role === "tone") expect(isTone(ch, n.m), why).toBe(true);
          else if (n.role === "scale") expect(inScale(ch, n.m), why).toBe(true);
          else if (n.role === "blue") expect(BLUES, why).toContain(pc(n.m - t.key));
          else if (n.role === "approach") {
            // a semitone under the chord tone it leads to
            const next = ns[i + 1];
            expect(next, why).toBeDefined();
            expect(next.m - n.m, why).toBe(1);
            expect(isTone(chordAt(t.bars, next.t), next.m), why).toBe(true);
          } else throw new Error(`no role: ${why}`);
        });
      }
      for (const n of of(t, "comp")) {
        const ch = n.ch!;
        expect(ch, "a comping note names its chord").toBeDefined();
        const iv = pc(n.m - ch.root);
        expect(isTone(ch, n.m) || EXT[ch.q].includes(iv), `${t.name} comp ${n.m} on ${ch.root}${ch.q}`).toBe(true);
        expect(n.m).toBeGreaterThanOrEqual(RANGE.comp[0]);
        expect(n.m).toBeLessThanOrEqual(RANGE.comp[1]);
        // the chord it voices is the one sounding, or the one about to (a push)
        const now = chordAt(t.bars, n.t), soon = chordAt(t.bars, n.t + 0.5);
        expect(same(ch, now) || same(ch, soon)).toBe(true);
      }
    }
  });

  it("melodies land: long notes and strong beats are chord tones", () => {
    let strong = 0, onTone = 0, blue = 0, all = 0, encl = 0;
    for (const t of TUNES) {
      for (const n of [...of(t, "lead"), ...of(t, "piano")]) {
        all++;
        if (n.role === "blue") blue++;
        if (n.role === "approach") encl++;
        if (n.d >= 1.4) { strong++; if (n.role === "root" || n.role === "tone") onTone++; }
      }
    }
    expect(onTone / strong).toBeGreaterThan(0.85);
    // blue notes and enclosures are there, as colour
    expect(blue / all).toBeGreaterThan(0.01);
    expect(blue / all).toBeLessThan(0.25);
    expect(encl).toBeGreaterThan(40);
  });

  it("the bass plays the root on the downbeat of every change, and walks by small steps", () => {
    let bigLeaps = 0, steps = 0;
    for (const t of TUNES) {
      const bass = of(t, "bass");
      const at = new Map(bass.map((n) => [n.t, n]));
      let prev: Chord | null = null;
      t.bars.forEach((bar, b) => {
        bar.chords.forEach((ch, k) => {
          const beat = b * 4 + k * 2;
          if (!prev || !same(prev, ch)) {
            const n = at.get(beat);
            expect(n, `${t.name} (${t.seed} ${t.mood}): bass at beat ${beat}`).toBeDefined();
            expect(pc(n!.m), `${t.name} (${t.seed} ${t.mood}): beat ${beat}`).toBe(ch.root);
          }
          prev = ch;
        });
        // and something on the first beat of every bar
        expect(at.has(b * 4)).toBe(true);
      });
      bass.forEach((n, i) => {
        const ch = chordAt(t.bars, n.t), why = `${t.name} (${t.seed} ${t.mood}) bass t=${n.t} m=${n.m} ${n.role}`;
        expect(n.m, why).toBeGreaterThanOrEqual(RANGE.bass[0]);
        expect(n.m, why).toBeLessThanOrEqual(RANGE.bass[1]);
        if (n.role === "root") expect(pc(n.m), why).toBe(ch.root);
        else if (n.role === "tone") expect(isTone(ch, n.m), why).toBe(true);
        else if (n.role === "scale") expect(inScale(ch, n.m), why).toBe(true);
        else if (n.role === "approach") {
          // leads into the next note from a step away at most
          const next = bass[i + 1];
          expect(next, why).toBeDefined();
          expect(pcDist(n.m, next.m), why).toBeLessThanOrEqual(2);
        } else throw new Error(`no role: ${why}`);
        if (i) { steps++; if (Math.abs(n.m - bass[i - 1].m) > 9) bigLeaps++; }
      });
      // four in the bar where it walks, two where it doesn't
      t.bars.forEach((bar, b) => {
        if (bar.sec === "end") return;
        const inBar = bass.filter((n) => n.t >= b * 4 && n.t < b * 4 + 4 && n.t % 1 === 0).length;
        expect(inBar, `${t.name} bar ${b}`).toBe(bar.feel === "four" ? 4 : 2);
      });
    }
    expect(bigLeaps / steps).toBeLessThan(0.03);
  });

  it("phrases breathe: the horn rests, and never plays two notes at once", () => {
    for (const t of TUNES) {
      for (const voice of ["lead", "piano"] as const) {
        const ns = of(t, voice);
        expect(ns.length, `${t.name} ${voice}`).toBeGreaterThan(12);
        let sounding = 0, rests = 0, longest = 0, run = 0;
        ns.forEach((n, i) => {
          expect(n.d).toBeGreaterThan(0.15);
          sounding += n.d;
          const next = ns[i + 1];
          if (!next) return;
          expect(n.t + n.d, `${t.name} ${voice} overlaps at ${n.t}`).toBeLessThanOrEqual(next.t + 1e-9);
          const gap = next.t - (n.t + n.d);
          run += n.d;
          if (gap >= 1) { rests++; longest = Math.max(longest, run); run = 0; }
        });
        longest = Math.max(longest, run);
        if (voice === "lead") {
          // the horn is out for a good part of the tune (rests, the piano's choruses), and breathes within its own
          expect(sounding / t.beats, `${t.name} lead share`).toBeLessThan(0.6);
          expect(sounding / t.beats, `${t.name} lead share`).toBeGreaterThan(0.08);
          expect(rests, `${t.name} lead rests`).toBeGreaterThanOrEqual(t.bars.length / 8);
          // no line longer than a breath: eleven beats of unbroken sound at most
          expect(longest, `${t.name} (${t.seed} ${t.mood}) longest line`).toBeLessThanOrEqual(11);
        }
      }
    }
  });

  it("the head's motif comes back", () => {
    // the first phrase of the head is heard again later with the same rhythm
    let back = 0;
    for (const t of TUNES) {
      const b0 = t.bars.findIndex((b) => b.sec === "head"), N = FORM_BARS[t.form];
      const span = t.form === "aaba" ? 2 : t.form === "ballad" ? 2 : 2;
      const rhythm = (bar: number) => t.notes.filter((n) => (n.i === "lead" || n.i === "piano") && n.role !== undefined && n.t >= bar * 4 && n.t < (bar + span) * 4 && n.v > 0.6)
        .map((n) => (n.t - bar * 4).toFixed(1)).join(" ");
      const first = rhythm(b0);
      const again = t.form === "blues" || t.form === "minorBlues" ? b0 + 4 : t.form === "aaba" ? b0 + 8 : b0 + 4;
      expect(first.length).toBeGreaterThan(0);
      if (rhythm(again) === first) back++;
      void N;
    }
    expect(back / TUNES.length).toBeGreaterThan(0.85);
  });

  it("the horn and the piano trade the tune", () => {
    for (const t of TUNES) {
      const solos = t.bars.filter((b) => b.sec === "solo");
      expect(solos.length).toBeGreaterThanOrEqual(8);
      const who = new Set(t.bars.filter((b) => b.sec === "solo" || b.sec === "head" || b.sec === "out").map((b) => b.solo));
      expect(who.has("lead")).toBe(true);
      expect(who.has("piano")).toBe(true);
      // in a horn's solo bars the piano's right hand lays out (answers aside), and the other way about
      const b0 = t.bars.findIndex((b) => b.sec === "solo" && b.solo === "piano");
      if (b0 >= 0) {
        let e = b0; while (t.bars[e].sec === "solo" && t.bars[e].solo === "piano") e++;
        const horn = of(t, "lead").filter((n) => n.t >= b0 * 4 + 2 && n.t < e * 4);
        expect(horn.length, `${t.name}: horn in the piano's chorus`).toBe(0);
        expect(of(t, "piano").filter((n) => n.t >= b0 * 4 && n.t < e * 4).length).toBeGreaterThan(3);
      }
    }
  });

  it("ends with a tag and a held last chord", () => {
    for (const t of TUNES) {
      const end = (t.bars.length - 1) * 4;
      const last = of(t, "lead").filter((n) => n.t >= end);
      expect(last.length).toBe(1);
      expect(pc(last[0].m)).toBe(t.key);
      expect(last[0].d).toBeGreaterThan(3);
      expect(of(t, "cym").length).toBe(1);
      expect(of(t, "bass").at(-1)!.d).toBe(4);
      expect(pc(of(t, "bass").at(-1)!.m)).toBe(t.key);
      // nothing sounds after the tune's stated length
      for (const n of t.notes) expect(n.t + n.d).toBeLessThanOrEqual(t.beats + 1e-9);
      // the notes come in time order
      for (let i = 1; i < t.notes.length; i++) expect(t.notes[i].t).toBeGreaterThanOrEqual(t.notes[i - 1].t);
    }
  });

  it("the rhythm section keeps time: hi-hat on two and four, a ride pattern at a swing tempo", () => {
    for (const t of TUNES) {
      const hats = of(t, "hat");
      for (const n of hats) expect(n.t % 2).toBe(1);
      expect(hats.length).toBe((t.bars.length - 1) * 2);
      const taps = of(t, "tap");
      if (t.mood === "day") {
        // ding, ding-a: the off-beat eighths before one and three
        const skip = taps.filter((n) => n.t % 2 === 1.5).length;
        expect(skip).toBeGreaterThanOrEqual((t.bars.length - 1) * 2);
      }
      for (const n of t.notes) { expect(n.v).toBeGreaterThan(0); expect(n.v).toBeLessThanOrEqual(1); expect((n.t * 2) % 1).toBe(0); }
    }
  });

  it("a tune runs about two to four minutes", () => {
    for (const t of TUNES) {
      const secs = (t.beats * 60) / t.bpm;
      expect(secs, `${t.name} ${t.form} ${t.bpm}`).toBeGreaterThan(70);
      expect(secs, `${t.name} ${t.form} ${t.bpm}`).toBeLessThan(260);
    }
  });

  it("swing pushes the off-beat late and leaves the beat alone", () => {
    expect(swung(3, 0.667)).toBe(3);
    expect(swung(3.5, 0.667)).toBeCloseTo(3.667, 6);
    expect(swung(3.5, 0.5)).toBeCloseTo(3.5, 6);
    expect(swung(2.25, 0.6)).toBeCloseTo(2.3, 6);
    for (let t = 0; t < 8; t += 0.25) expect(swung(t + 0.25, 0.64)).toBeGreaterThan(swung(t, 0.64));
  });

  it("names its tunes after the save's towns and company", () => {
    const names = TUNES.map((t) => t.name);
    expect(new Set(names).size).toBeGreaterThan(70);
    // and the wireless never gives a name it used lately
    const used = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) { const t = compose(seed, "day", SRC, used); expect(used.has(t.name), t.name).toBe(false); used.add(t.name); }
    expect(names.some((n) => /Alder Run|Cobb's Ferry|Marlow/.test(n))).toBe(true);
    expect(names.some((n) => n.includes("Carver"))).toBe(true);
    for (const n of names) { expect(n).not.toMatch(/[{}]/); expect(n).not.toContain("—"); expect(n.length).toBeLessThanOrEqual(36); }
    expect(firmShort("Carver & Sons Haulage")).toBe("Carver");
    expect(firmShort("The Alder Freight Co.")).toBe("Alder");
    expect(firmShort("")).toBe("Company");
    // a save with no town and no company yet still gets a name
    const bare = tuneName(mulberry32(5), "day", "blues", { towns: [], company: "" });
    expect(bare).not.toMatch(/[{}]/);
    expect(bare.length).toBeGreaterThan(3);
    // night and winter get their own kind of name
    expect(TUNES.filter((t) => t.mood === "night").some((t) => /Blues|Moan|Diesel|Serenade|Lullaby|Moon|Lamps|Evening|Goodnight|Home|Depot|Long Way/.test(t.name))).toBe(true);
  });

  it("the mood follows the hour and the season", () => {
    expect(moodFor(12, 1)).toBe("day");
    expect(moodFor(23, 1)).toBe("night");
    expect(moodFor(3, 0)).toBe("night");
    expect(moodFor(12, 3)).toBe("winterDay");
    expect(moodFor(1, 3)).toBe("winterNight");
  });
});
