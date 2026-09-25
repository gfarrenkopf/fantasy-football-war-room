import { describe, expect, it } from "vitest";
import type { Crosswalk } from "./crosswalk";
import { importedPicks, parseFinishedDraft } from "./draftImport";

const pick = (overallPickNumber: number, teamId: number, playerId: number) => ({ overallPickNumber, teamId, playerId, roundId: 1, keeper: false });
const detail = (picks: unknown[], extra: Record<string, unknown> = {}) => ({ draftDetail: { drafted: true, inProgress: false, picks, ...extra } });

describe("parseFinishedDraft", () => {
  it("reads a finished draft's picks in pick order, D/ST's negative ids included", () => {
    expect(parseFinishedDraft(detail([pick(2, 4, -16034), pick(1, 1, 100)]))).toEqual([
      { overall: 1, teamId: 1, espnPlayerId: 100 },
      { overall: 2, teamId: 4, espnPlayerId: -16034 },
    ]);
  });

  it("is null for a draft still to come or underway, and for picks it can't replay", () => {
    expect(parseFinishedDraft(detail([pick(1, 1, 100)], { drafted: false }))).toBeNull();
    expect(parseFinishedDraft(detail([pick(1, 1, 100)], { inProgress: true }))).toBeNull();
    expect(parseFinishedDraft(detail([]))).toBeNull();
    expect(parseFinishedDraft(detail([pick(1, 1, 100), pick(3, 4, 200)]))).toBeNull(); // a gap
    expect(parseFinishedDraft(detail([pick(1, 1, 100), { overallPickNumber: 2 }]))).toBeNull(); // unreadable pick
    expect(parseFinishedDraft(detail([pick(1, 1, -1)]))).toBeNull(); // nobody taken
    expect(parseFinishedDraft({})).toBeNull();
  });
});

describe("importedPicks", () => {
  const walk: Crosswalk = (id) => (id === 100 ? { kind: "matched", playerId: "bijan-robinson-rb" } : { kind: "offBoard", player: { name: "Deep Sleeper", pos: "WR", team: "NYJ" } });
  const league = { teams: 2, roster: [{ key: "RB" as const, eligible: ["RB" as const] }] };

  it("turns ESPN's picks into board picks, marking the user's own and naming players off the board", () => {
    const picks = [
      { overall: 1, teamId: 3, espnPlayerId: 100 },
      { overall: 2, teamId: 7, espnPlayerId: 555 },
    ];
    expect(importedPicks(picks, walk, 3, league)).toEqual({
      ok: true,
      picks: [
        { playerId: "bijan-robinson-rb", mine: true },
        { playerId: "espn:555", mine: false, label: { name: "Deep Sleeper", pos: "WR", team: "NYJ" } },
      ],
    });
  });

  it("refuses a draft that doesn't fit the league's board", () => {
    expect(importedPicks([{ overall: 1, teamId: 3, espnPlayerId: 100 }], walk, 3, league)).toEqual({ ok: false, reason: "ESPN's draft has 1 picks; this league's board has 2" });
  });
});
