import { describe, expect, it } from "vitest";
import { standardRoster } from "@/lib/data";
import { parseLeagueRecord } from "./records";

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
