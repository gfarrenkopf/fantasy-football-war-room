import { describe, expect, it } from "vitest";
import { parseFrame } from "./protocol";

const ME = "{00000000-0000-0000-0000-000000000001}";

describe("parseFrame", () => {
  it("reads a human pick, with the drafter's member id", () => {
    expect(parseFrame(`SELECTED 1 4362628 4 ${ME}\n`)).toEqual({
      kind: "selected",
      teamId: 1,
      playerId: 4362628,
      rosterSlot: 4,
      memberId: ME,
    });
  });

  it("reads an autopick, which names no member", () => {
    expect(parseFrame("SELECTED 4 4429795 2\n")).toEqual({ kind: "selected", teamId: 4, playerId: 4429795, rosterSlot: 2, memberId: null });
  });

  it("reads negative D/ST player ids", () => {
    expect(parseFrame("SELECTED 4 -16034 8")).toMatchObject({ kind: "selected", playerId: -16034 });
  });

  it("reads the bridge's own catch-up frames", () => {
    expect(parseFrame("WR_CATCHUP 1 4 4429795")).toEqual({ kind: "catchup", overall: 1, teamId: 4, playerId: 4429795 });
    // D/ST ids are negative.
    expect(parseFrame("WR_CATCHUP 12 2 -16034")).toEqual({ kind: "catchup", overall: 12, teamId: 2, playerId: -16034 });
    expect(parseFrame("WR_CATCHUP 0 2 5")).toMatchObject({ kind: "malformed" });
    expect(parseFrame("WR_CATCHUP 1 2")).toMatchObject({ kind: "malformed" });
  });

  it("reads the clock, state, selecting, autosuggest and autodraft frames", () => {
    expect(parseFrame("CLOCK 0 759977")).toEqual({ kind: "clock", state: 0, teamId: 0, msRemaining: 759977 });
    // During the draft the team on the clock is the third field (seen live: "CLOCK 6 85495 1" after "SELECTING 1 90000").
    expect(parseFrame("CLOCK 6 85495 1")).toEqual({ kind: "clock", state: 6, teamId: 1, msRemaining: 85495 });
    // After the draft, a bare CLOCK 4 every 20s: no time left, no team. Not malformed.
    expect(parseFrame("CLOCK 4")).toEqual({ kind: "clock", state: 4, teamId: 0, msRemaining: 0 });
    expect(parseFrame("STATE 1")).toEqual({ kind: "state", state: 1 });
    expect(parseFrame("SELECTING 4 60000")).toEqual({ kind: "selecting", teamId: 4, msAllowed: 60000 });
    expect(parseFrame("AUTOSUGGEST 4429795")).toEqual({ kind: "autosuggest", playerId: 4429795 });
    expect(parseFrame("AUTODRAFT 2 true")).toEqual({ kind: "autodraft", teamId: 2, on: true });
    expect(parseFrame("AUTODRAFT 1 false")).toEqual({ kind: "autodraft", teamId: 1, on: false });
  });

  it("reads presence frames", () => {
    expect(parseFrame(`JOINED 1 ${ME}`)).toEqual({ kind: "joined", teamId: 1, memberId: ME });
    expect(parseFrame(`LEFT 4 ${ME} 1`)).toEqual({ kind: "left", teamId: 4, memberId: ME });
  });

  it("decodes ERROR messages", () => {
    expect(parseFrame("ERROR 1 Invalid+security+code%3B+access+is+refused.")).toEqual({
      kind: "error",
      code: 1,
      message: "Invalid security code; access is refused.",
    });
  });

  it("keeps nothing from INIT or TOKEN", () => {
    expect(parseFrame("INIT AAAAAQAAAAEwSuJN")).toEqual({ kind: "init" });
    expect(parseFrame(`TOKEN 1:810213965:1:${ME}:123456789`)).toEqual({ kind: "token" });
  });

  it("marks recognised frames with unreadable fields as malformed", () => {
    expect(parseFrame("SELECTED 1 notanumber 4").kind).toBe("malformed");
    expect(parseFrame("SELECTED 1 4362628").kind).toBe("malformed");
    expect(parseFrame("SELECTED 1 4362628 4 not-a-guid").kind).toBe("malformed");
    expect(parseFrame("AUTODRAFT 1 maybe").kind).toBe("malformed");
    expect(parseFrame("CLOCK").kind).toBe("malformed");
    expect(parseFrame("CLOCK 6 85495 x").kind).toBe("malformed");
  });

  it("marks frames it doesn't know as unknown, and never throws", () => {
    expect(parseFrame("TRADE 1 2 3")).toEqual({ kind: "unknown", raw: "TRADE 1 2 3" });
    expect(parseFrame("").kind).toBe("unknown");
    expect(parseFrame("ERROR 1 %E0%A4%A")).toMatchObject({ kind: "error", message: "%E0%A4%A" });
  });
});
