import { describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import type { LeagueSettings } from "@/lib/draft/types";
import { draftAtOf, leagueDifferences, slotOf, toLeagueSettings } from "./league";

/** ESPN's own shape, from league 110222051's mSettings on 2026-09-22. */
const SETTINGS = {
  size: 4,
  draftSettings: { type: "SNAKE", pickOrder: [1, 3, 4, 2], timePerSelection: 300 },
  rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "4": 2, "6": 1, "16": 1, "17": 1, "20": 7, "21": 1, "23": 1 } },
  scoringSettings: { scoringItems: [{ statId: 42, points: 0.04 }, { statId: 53, points: 1 }] },
};

const settings = (over: Record<string, unknown> = {}) => ({ ...SETTINGS, ...over });

describe("importing an ESPN league (8.8)", () => {
  it("reads teams, slot, scoring and roster from ESPN's own settings", () => {
    const got = toLeagueSettings(settings(), 4);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.league.teams).toBe(4);
    // Team 4 sits third in [1,3,4,2].
    expect(got.league.mySlot).toBe(3);
    expect(got.league.scoring).toBe("ppr");
    // Slots come back in our canonical order, and IR (21) isn't drafted.
    expect(got.league.roster.map((s) => s.key)).toEqual(["QB", "RB", "RB", "WR", "WR", "TE", "FLEX", "DST", "K", ...Array(7).fill("BN")]);
    expect(got.rounds).toBe(16);
  });

  it("takes the whole settings document or just the settings object", () => {
    expect(toLeagueSettings({ settings: SETTINGS }, 1)).toMatchObject({ ok: true });
    expect(toLeagueSettings(SETTINGS, 1)).toMatchObject({ ok: true });
  });

  it("reads the scoring format from the reception item", () => {
    const scoring = (points: number) => {
      const got = toLeagueSettings(settings({ scoringSettings: { scoringItems: [{ statId: 53, points }] } }), 1);
      return got.ok ? got.league.scoring : null;
    };
    expect(scoring(1)).toBe("ppr");
    expect(scoring(0.5)).toBe("half");
    expect(scoring(0)).toBe("std");
    // No reception item at all is standard scoring.
    expect(toLeagueSettings(settings({ scoringSettings: { scoringItems: [] } }), 1)).toMatchObject({ ok: true, league: { scoring: "std" } });
  });

  it("maps superflex and a second flex", () => {
    const got = toLeagueSettings(settings({ rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "4": 2, "7": 1, "20": 5, "23": 2 } } }), 1);
    expect(got.ok && got.league.roster.filter((s) => s.key === "SUPERFLEX")).toHaveLength(1);
    expect(got.ok && got.league.roster.filter((s) => s.key === "FLEX")).toHaveLength(2);
  });

  it("refuses what it can't represent, in words the user can act on", () => {
    expect(toLeagueSettings(settings({ draftSettings: { type: "AUCTION", pickOrder: [1] } }), 1)).toEqual({
      ok: false,
      error: "War Room doesn't do auction drafts yet.",
    });
    // An IDP league: ESPN slot 11 is a linebacker.
    expect(toLeagueSettings(settings({ rosterSettings: { lineupSlotCounts: { "0": 1, "11": 2, "20": 5 } } }), 1)).toEqual({
      ok: false,
      error: "This league starts a linebacker, which War Room can't draft for yet.",
    });
    expect(toLeagueSettings(settings({ rosterSettings: {} }), 1)).toMatchObject({ ok: false });
    expect(toLeagueSettings({ nothing: true }, 1)).toEqual({ ok: false, error: "That doesn't look like an ESPN league." });
  });

  it("says so when the draft order hasn't been drawn, or isn't this team's", () => {
    const notYet = toLeagueSettings(settings({ draftSettings: { type: "SNAKE" } }), 1);
    expect(notYet).toEqual({ ok: false, error: "ESPN hasn't set the draft order yet. It's drawn when the draft room opens, about an hour before." });
    expect(toLeagueSettings(settings(), 99)).toMatchObject({ ok: false });
  });

  it("carries ESPN's scheduled draft time, even before the pick order is drawn", () => {
    const date = Date.UTC(2026, 8, 28, 0, 0);
    expect(draftAtOf({ draftSettings: { date } })).toBe("2026-09-28T00:00:00.000Z");
    expect(draftAtOf({ draftSettings: { date: 0 } })).toBeNull();
    expect(draftAtOf({})).toBeNull();
    expect(toLeagueSettings(settings({ draftSettings: { type: "SNAKE", pickOrder: [1, 3, 4, 2], date } }), 4)).toMatchObject({ ok: true, draftAt: "2026-09-28T00:00:00.000Z" });
    // No pick order yet (the lobby opens an hour before): still not importable, but the date comes through.
    expect(toLeagueSettings(settings({ draftSettings: { type: "SNAKE", date } }), 4)).toMatchObject({ ok: false, draftAt: "2026-09-28T00:00:00.000Z" });
    expect(toLeagueSettings(settings(), 4)).not.toHaveProperty("draftAt");
  });

  it("re-reads the slot, because ESPN redraws the order when the lobby opens", () => {
    expect(slotOf(SETTINGS, 2)).toBe(4);
    // The same league after a redraw.
    expect(slotOf({ ...SETTINGS, draftSettings: { pickOrder: [2, 1, 3, 4] } }, 2)).toBe(1);
    expect(slotOf({}, 2)).toBeNull();
  });
});

describe("what an import would change", () => {
  const current: LeagueSettings = { teams: 12, mySlot: 1, scoring: "half", roster: standardRoster(), valueThreshold: 12 };

  it("names each difference the way a person would say it", () => {
    const imported = toLeagueSettings(settings(), 4);
    // This ESPN league happens to have the same roster as our default, so only the rest differ.
    expect(imported.ok && leagueDifferences(current, imported.league)).toEqual(["4 teams, not 12", "you pick at 3, not 1", "full PPR, not half PPR"]);
  });

  it("counts rounds when the rosters are different lengths", () => {
    const shorter = toLeagueSettings(settings({ rosterSettings: { lineupSlotCounts: { "0": 1, "2": 2, "4": 2, "20": 3 } } }), 4);
    expect(shorter.ok && leagueDifferences(current, shorter.league)).toContain(`8 rounds, not ${current.roster.length}`);
  });

  it("is silent when the board already matches ESPN", () => {
    const imported = toLeagueSettings(settings(), 4);
    if (!imported.ok) throw new Error("expected an import");
    expect(leagueDifferences({ ...imported.league, valueThreshold: 12 }, imported.league)).toEqual([]);
  });

  it("notices a roster of the same length but a different shape", () => {
    const imported = toLeagueSettings(settings(), 4);
    if (!imported.ok) throw new Error("expected an import");
    const swapped = { ...imported.league, roster: [...imported.league.roster].reverse() };
    expect(leagueDifferences({ ...swapped, valueThreshold: 12 }, imported.league)).toEqual(["a different roster"]);
  });
});
