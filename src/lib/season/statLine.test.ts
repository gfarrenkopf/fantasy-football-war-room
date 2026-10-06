import { describe, expect, it } from "vitest";
import type { Position } from "@/lib/draft/types";
import rows from "./__fixtures__/espn-actual-stats-2026.json";
import { summarizeStats } from "./statLine";

/** Real week-4 actual rows from ESPN (stats and appliedStats), in a PPR league with tiered D/ST scoring. */
const line = (name: keyof typeof rows) => {
  const row = rows[name];
  return summarizeStats(row.pos as Position, row.stats, row.appliedStats);
};

describe("summarizeStats", () => {
  it("shows a QB's three biggest swings in passing-then-rushing order", () => {
    // 253 yds 10.1, rush TD 6, pass TD 4 beat INT −2 and 4 rush yds.
    expect(line("Josh Allen")).toBe("253 YDS, TD, RUSH TD");
    // 3 TD 12, 269 yds 10.8, 54 rush yds 5.4 beat the INT, the fumble and the 2-pt conversion.
    expect(line("Drake Maye")).toBe("269 YDS, 3 TD, 54 RUSH YDS");
  });

  it("merges a runner or catcher's rushing and receiving yards and TDs", () => {
    expect(line("Jahmyr Gibbs")).toBe("77 YDS, TD, 4 REC");
    // 189 receiving less 6 rushing.
    expect(line("CeeDee Lamb")).toBe("17 REC, 183 YDS, TD");
  });

  it("breaks a tie by the position's order", () => {
    expect(line("Saquon Barkley")).toBe("10 YDS, 1 REC");
  });

  it("shows a kicker's made over tried, with a miss counting toward the FG swing", () => {
    expect(line("Brandon Aubrey")).toBe("2/4 FG, 4/4 XP");
  });

  it("weighs a defense's points and yards allowed by the tier it landed in", () => {
    expect(line("Vikings D/ST")).toBe("10 PA, 198 YA, 2 SACK");
    // A negative tier counts by its size.
    expect(line("Broncos D/ST")).toBe("358 YA, BLK");
  });

  it("counts a negative stat by its size", () => {
    expect(summarizeStats("QB", { "3": 20, "20": 2 }, { "3": 0.8, "20": -4 })).toBe("20 YDS, 2 INT");
  });

  it("stops at three stats", () => {
    expect(summarizeStats("RB", { "24": 100, "25": 2, "53": 5, "4": 1, "72": 1 }, { "24": 10, "25": 12, "53": 5, "4": 4, "72": -2 })).toBe("100 YDS, 2 TD, 5 REC");
  });

  it("shows a non-QB's passing as passing", () => {
    expect(summarizeStats("WR", { "3": 30, "4": 1, "53": 1, "42": 5 }, { "3": 1.2, "4": 4, "53": 1, "42": 0.5 })).toBe("1 REC, 30 PASS YDS, PASS TD");
  });

  it("falls back to the position's main stat when he played but scored nothing", () => {
    const quiet = { "210": 1 };
    const positions: Position[] = ["QB", "RB", "WR", "TE", "K"];
    expect(positions.map((pos) => summarizeStats(pos, quiet, {}))).toEqual(["0 YDS", "0 YDS", "0 REC", "0 REC", "0/0 FG"]);
    expect(summarizeStats("DST", { "120": 24, "127": 300 }, { "122": 0 })).toBe("24 PA");
  });

  it("leaves out stats it has no name for, and shows nothing without stats", () => {
    expect(summarizeStats("WR", { "53": 1, "63": 1 }, { "53": 1, "63": 6 })).toBe("1 REC");
    expect(line("Terry McLaurin")).toBeNull();
  });
});
