// The wireless's dedications (audio/dedication.ts): what the announcer says, and that one goes out only now and then.

import { describe, expect, it } from "vitest";
import { CLEAR_FOR, DEDICATION_GAP, DEDICATION_SETTLE, DedicationDesk, JAM_LONG, JAM_NEAR, JamWatch, dedicationFor, lineOf, numberOf } from "../src/audio/dedication";
import { compose, tuneName } from "../src/audio/music/compose";
import { rnd } from "../src/audio/dsp";

describe("radio dedications", () => {
  it("say the time of day the way an announcer would", () => {
    expect(numberOf(7)).toBe("This morning's number");
    expect(numberOf(14)).toBe("This afternoon's number");
    expect(numberOf(19)).toBe("This evening's number");
    expect(numberOf(23)).toBe("Tonight's number");
    expect(numberOf(2)).toBe("Tonight's number");
  });

  it("name the town and why, in plain words, with no dashes", () => {
    const at = 22;
    const lines = [
      lineOf(dedicationFor({ k: "townSize", town: "Poplar Creek", size: "Town" }, at)),
      lineOf(dedicationFor({ k: "newTown", town: "Ashby" }, at)),
      lineOf(dedicationFor({ k: "goal", name: "First steel", company: "Tri-State Motor Freight", town: "Alder Run" }, at)),
      lineOf(dedicationFor({ k: "convoy", load: "Turbine", to: "Coal Power Plant", town: "Alder Run" }, at)),
      lineOf(dedicationFor({ k: "jam", town: "Alder Run" }, at)),
      lineOf(dedicationFor({ k: "landmark", what: "World's Fair", town: "Alder Run" }, at)),
    ];
    expect(lines[0]).toBe("Tonight's number goes out to Poplar Creek, a Town now.");
    expect(lines[1]).toBe("Tonight's number goes out to the first folks of Ashby, new on the map.");
    expect(lines[2]).toBe("Tonight's number goes out to everyone at Tri-State Motor Freight: First steel, and well earned.");
    expect(lines[3]).toBe("Tonight's number goes out to the convoy crew hauling a turbine to the Coal Power Plant.");
    expect(lines[4]).toBe("Tonight's number goes out to the drivers of Alder Run: the road is moving again.");
    expect(lines[5]).toBe("Tonight's number goes out to Alder Run and its new World's Fair.");
    for (const l of lines) expect(l).not.toMatch(/[–—]/);
    expect(dedicationFor({ k: "townSize", town: "Ely", size: "Village" }, 9).why).toBe("a Village now");
  });

  it("go out at most once every few minutes, and not as a game opens", () => {
    const d = new DedicationDesk();
    d.open(100);
    expect(d.offer(100 + DEDICATION_SETTLE - 1)).toBe(false);
    expect(d.offer(100 + DEDICATION_SETTLE + 1)).toBe(true);
    expect(d.offer(100 + DEDICATION_SETTLE + 30)).toBe(false);
    expect(d.offer(100 + DEDICATION_SETTLE + DEDICATION_GAP + 2)).toBe(true);
    // another game opened: a pause again
    d.open(5000);
    expect(d.offer(5005)).toBe(false);
  });

  it("the dedicated tune is always named for the town", () => {
    for (let s = 0; s < 200; s++) {
      expect(tuneName(rnd(s), s % 2 ? "night" : "day", "aaba", { towns: ["Poplar Creek"], company: "Tri-State Motor Freight", dedicate: true })).toContain("Poplar Creek");
    }
    expect(compose(5, "day", { towns: ["Poplar Creek"], company: "Tri-State", dedicate: true }).name).toContain("Poplar Creek");
  });

  describe("a long jam cleared", () => {
    const town = () => "Alder Run";
    const at = (x: number, worst: number) => ({ c: { x, y: 0 }, worst });

    it("is told once nobody near the spot has been stuck for a little while", () => {
      const w = new JamWatch();
      // (a short wait is no jam)
      expect(w.step(100, [at(0, JAM_LONG - 1)], town)).toBeNull();
      expect(w.step(101, [], town)).toBeNull();
      expect(w.step(101 + CLEAR_FOR + 1, [], town)).toBeNull();
      // a long one, still standing: nothing yet
      expect(w.step(200, [at(0, JAM_LONG + 30)], town)).toBeNull();
      expect(w.step(210, [at(20, JAM_LONG + 40)], town)).toBeNull();
      // it clears, then has to stay clear for CLEAR_FOR
      expect(w.step(220, [], town)).toBeNull();
      expect(w.step(220 + CLEAR_FOR - 1, [], town)).toBeNull();
      expect(w.step(220 + CLEAR_FOR, [], town)).toBe("Alder Run");
      // and only once
      expect(w.step(220 + CLEAR_FOR + 5, [], town)).toBeNull();
    });

    it("cars stuck near the spot hold it; a jam elsewhere does not", () => {
      const w = new JamWatch();
      w.step(0, [at(0, JAM_LONG)], town);
      w.step(5, [], town);
      // (stuck again near it: the clearing starts over)
      expect(w.step(5 + CLEAR_FOR - 2, [at(JAM_NEAR - 10, 30)], town)).toBeNull();
      expect(w.step(5 + CLEAR_FOR + 1, [], town)).toBeNull();
      // (stuck far away does not hold it)
      expect(w.step(5 + 2 * CLEAR_FOR + 2, [at(JAM_NEAR + 500, 30)], town)).toBe("Alder Run");
    });

    it("a clock that jumps (a load) forgets the jam", () => {
      const w = new JamWatch();
      w.step(1000, [at(0, JAM_LONG)], town);
      expect(w.step(500, [], town)).toBeNull();
      expect(w.step(500 + CLEAR_FOR + 1, [], town)).toBeNull();
      const v = new JamWatch();
      v.step(1000, [at(0, JAM_LONG)], town);
      expect(v.step(1000 + 4000, [], town)).toBeNull();
      expect(v.step(1000 + 4000 + CLEAR_FOR + 1, [], town)).toBeNull();
    });

    it("no town to name it after: nothing", () => {
      const w = new JamWatch();
      w.step(0, [at(0, JAM_LONG)], () => undefined);
      expect(w.step(1, [], town)).toBeNull();
      expect(w.step(1 + CLEAR_FOR + 1, [], town)).toBeNull();
    });
  });
});
