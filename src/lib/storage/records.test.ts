import { describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import { migrateDraftState, parseLeagueRecord } from "./records";

const valid = {
  id: "0123abcd",
  name: "  Home league  ",
  season: 2026,
  datasetId: "2026-deadbeef",
  settings: { teams: 12, mySlot: 1, scoring: "ppr", valueThreshold: 10, roster: standardRoster() },
  createdAt: "2026-09-01T00:00:00.000Z",
  updatedAt: "2026-09-02T00:00:00.000Z",
};

describe("parseLeagueRecord", () => {
  it("accepts a valid record, trimming the name and dropping unknown fields", () => {
    const parsed = parseLeagueRecord({ ...valid, userId: "someone-else" });
    expect(parsed).toMatchObject({ id: "0123abcd", name: "Home league", season: 2026 });
    expect(parsed).not.toHaveProperty("userId");
  });

  it("names an unnamed league", () => {
    expect(parseLeagueRecord({ ...valid, name: "   " })?.name).toBe("Untitled league");
  });

  it.each([
    ["missing id", { id: undefined }],
    ["id with path characters", { id: "../etc" }],
    ["overlong id", { id: "a".repeat(65) }],
    ["non-integer season", { season: 2026.5 }],
    ["bad settings", { settings: { teams: 12 } }],
    ["bad timestamp", { updatedAt: "yesterday" }],
  ])("rejects %s", (_, patch) => {
    expect(parseLeagueRecord({ ...valid, ...patch })).toBeNull();
  });

  it("rejects non-objects", () => {
    expect(parseLeagueRecord(null)).toBeNull();
    expect(parseLeagueRecord("league")).toBeNull();
  });
});

describe("migrateDraftState with off-board picks", () => {
  const label = { name: "Deep Sleeper", pos: "WR", team: "SEA" };

  it("keeps a valid label and drops unknown fields inside it", () => {
    expect(migrateDraftState({ version: 1, picks: [{ playerId: "espn:1", mine: false, label: { ...label, extra: 1 } }] })).toEqual({
      version: 1,
      picks: [{ playerId: "espn:1", mine: false, label }],
    });
    expect(migrateDraftState({ version: 1, picks: [{ playerId: "espn:1", mine: false, label: { name: "Free Agent", pos: null, team: null } }] })).not.toBeNull();
  });

  it("rejects a draft with a malformed label", () => {
    for (const bad of [{ ...label, pos: "LB" }, { ...label, name: 5 }, { ...label, team: "TOOLONG" }, "WR"]) {
      expect(migrateDraftState({ version: 1, picks: [{ playerId: "espn:1", mine: false, label: bad }] })).toBeNull();
    }
  });
});
