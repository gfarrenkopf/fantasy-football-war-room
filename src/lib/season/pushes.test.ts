import { describe, expect, it } from "vitest";
import { reminderPush, ruledOutPush, sundayPush } from "./pushes";

const hole = (league: string, name: string | null, playerId: number | null) => ({ leagueId: `id-${league}`, league, name, playerId, line: `Hole at RB: ${name ?? "nobody"}.` });

describe("season pushes", () => {
  it("names one ruled-out starter and opens his slot", () => {
    expect(ruledOutPush({ kickoff: "Sunday's 8:20 PM ET kickoff", holes: [hole("A", "Puka Nacua", 7)] })).toMatchObject({
      title: "Puka Nacua is out",
      body: "Hole at RB: Puka Nacua. Fill it before Sunday's 8:20 PM ET kickoff.",
      data: { leagueId: "id-A", tab: "lineup", playerId: "7" },
      timeSensitive: true,
    });
  });

  it("sums up several, opening the first league without picking a slot", () => {
    const two = ruledOutPush({ kickoff: "the kickoff", holes: [hole("A", "Puka Nacua", 7), hole("B", "Sam LaPorta", 8)] });
    expect(two).toMatchObject({ title: "Puka Nacua and Sam LaPorta are out", body: "Fill them before the kickoff. A, B.", data: { leagueId: "id-A", tab: "lineup" }, threadId: undefined });
    expect(two.data).not.toHaveProperty("playerId");
    expect(ruledOutPush({ kickoff: "k", holes: [hole("A", "Puka Nacua", 7), hole("A", null, null)] }).title).toBe("2 holes in your lineups");
  });

  it("words the reminder and the Sunday lineup for one league or many", () => {
    expect(reminderPush([{ leagueId: "a", name: "A", lines: ["Hole at TE: nobody on your team can play TE."] }]).body).toBe("A: Hole at TE: nobody on your team can play TE.");
    expect(reminderPush([{ leagueId: "a", name: "A", lines: ["x"] }, { leagueId: "b", name: "B", lines: ["y"] }])).toMatchObject({ title: "Your lineups have holes", data: { leagueId: "a", tab: "lineup" } });
    expect(sundayPush([{ leagueId: "a", name: "A", url: "", gain: 3, moves: ["Start X at FLEX"] }])).toMatchObject({ title: "Your Sunday lineup is ready", body: "A: Start X at FLEX" });
  });
});
