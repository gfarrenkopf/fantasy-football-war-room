import { describe, expect, it } from "vitest";
import { DEFAULT_LEAGUE } from "@/lib/data";
import { totalPicks } from "@/lib/draft/snake";
import type { DraftState } from "@/lib/draft/types";
import { farewellMood, farewellOrder, saveFarewell, summarizeLeague, takeFarewell, type Farewell } from "./farewell";
import { newLeagueRecord } from "./newLeague";
import { memoryStorage } from "./testing";

const league = newLeagueRecord("Apeman Dynasty", DEFAULT_LEAGUE);
const total = totalPicks(DEFAULT_LEAGUE);
const draftOf = (n: number, mineEvery = DEFAULT_LEAGUE.teams): DraftState => ({
  version: n,
  picks: Array.from({ length: n }, (_, i) => ({ playerId: `p${i + 1}`, mine: i % mineEvery === 0 })),
});

describe("summarizeLeague", () => {
  it("counts the draft and keeps the user's first three picks, in order", () => {
    const line = summarizeLeague(league, draftOf(40));
    expect(line).toMatchObject({ name: "Apeman Dynasty", teams: DEFAULT_LEAGUE.teams, total, logged: 40 });
    expect(line.mine).toEqual(["p1", `p${DEFAULT_LEAGUE.teams + 1}`, `p${2 * DEFAULT_LEAGUE.teams + 1}`]);
  });

  it("reads a league that was never started as zero picks", () => {
    expect(summarizeLeague(league, null)).toMatchObject({ logged: 0, mine: [] });
  });
});

describe("farewellMood", () => {
  const with_ = (...logged: number[]): Farewell => ({ email: null, leagues: logged.map((n) => summarizeLeague(league, draftOf(n))) });

  it("puts a paused draft first", () => {
    expect(farewellMood(with_(total, 30))).toBe("unfinished");
  });
  it("sends a finished room into the season", () => {
    expect(farewellMood(with_(total, 0))).toBe("done");
  });
  it("is gentle when nothing was drafted, or nothing was handed over", () => {
    expect(farewellMood(with_(0))).toBe("fresh");
    expect(farewellMood(null)).toBe("fresh");
  });
});

describe("farewellOrder", () => {
  it("lists paused drafts first, furthest along first, then finished, then waiting", () => {
    const at = (name: string, n: number) => ({ ...summarizeLeague(league, draftOf(n)), name });
    const order = farewellOrder([at("waiting", 0), at("done", total), at("early", 10), at("late", 150)]);
    expect(order.map((l) => l.name)).toEqual(["late", "early", "done", "waiting"]);
  });
});

describe("saveFarewell / takeFarewell", () => {
  it("hands the goodbye across once", () => {
    const storage = memoryStorage();
    const farewell: Farewell = { email: "fan@example.com", leagues: [summarizeLeague(league, draftOf(12))] };
    saveFarewell(farewell, storage);
    expect(takeFarewell(storage)).toEqual(farewell);
    expect(takeFarewell(storage)).toBeNull();
  });

  it("drops anything that isn't a goodbye", () => {
    const storage = memoryStorage();
    storage.setItem("fwr:v1:farewell", "{not json");
    expect(takeFarewell(storage)).toBeNull();
    storage.setItem("fwr:v1:farewell", JSON.stringify({ email: 3, leagues: [] }));
    expect(takeFarewell(storage)).toBeNull();
    storage.setItem("fwr:v1:farewell", JSON.stringify({ email: null, leagues: [{ name: "x" }, summarizeLeague(league, null)] }));
    expect(takeFarewell(storage)?.leagues).toHaveLength(1);
  });
});
