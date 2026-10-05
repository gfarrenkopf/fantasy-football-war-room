import { describe, expect, it } from "vitest";
import { hasPlayedMoment, markMomentPlayed, momentKey } from "./moments";
import { memoryStorage } from "./testing";

describe("game day moments", () => {
  it("remembers a played moment per league and week", () => {
    const storage = memoryStorage();
    const key = momentKey("league-a", 2026, 4);
    expect(hasPlayedMoment(key, storage)).toBe(false);
    markMomentPlayed(key, storage);
    expect(hasPlayedMoment(key, storage)).toBe(true);
    expect(hasPlayedMoment(momentKey("league-a", 2026, 5), storage)).toBe(false);
  });

  it("keeps only the most recent ones, and survives bad or missing storage", () => {
    const storage = memoryStorage();
    for (let week = 0; week < 70; week++) markMomentPlayed(momentKey("l", 2026, week), storage);
    expect(hasPlayedMoment(momentKey("l", 2026, 0), storage)).toBe(false);
    expect(hasPlayedMoment(momentKey("l", 2026, 69), storage)).toBe(true);
    storage.setItem("fwr:v1:moments", "{not json");
    expect(hasPlayedMoment("x", storage)).toBe(false);
    expect(hasPlayedMoment("x", null)).toBe(false);
    expect(() => markMomentPlayed("x", null)).not.toThrow();
  });
});
