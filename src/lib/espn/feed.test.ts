import { describe, expect, it } from "vitest";
import { emptyFeed, foldFrames } from "./feed";

const ME = "{00000000-0000-0000-0000-000000000001}";

/** The opening of the spike draft, frame for frame (heartbeats trimmed, member id sanitized). */
const OPENING = [
  "INIT AAAAAQAAAAEwSuJN",
  `TOKEN 1:810213965:1:${ME}:123456789`,
  "CLOCK 0 759977",
  "AUTOSUGGEST 4429795",
  `JOINED 1 ${ME}`,
  "PONG PING%201790010141036",
  "STATE 1",
  "SELECTING 4 60000",
  "AUTODRAFT 4 true",
  "SELECTED 4 4429795 2",
  "AUTOSUGGEST 4430807",
  "SELECTING 2 60000",
  "AUTODRAFT 2 true",
  "SELECTED 2 4430807 2",
  "AUTOSUGGEST 4362628",
  "SELECTING 1 60000",
  `SELECTED 1 4362628 4 ${ME}`,
  "AUTOSUGGEST 4426515",
  "SELECTING 3 60000",
  "AUTODRAFT 3 true",
  "SELECTED 3 4426515 4",
].map((f) => `${f}\n`);

describe("foldFrames", () => {
  it("waits until the draft starts", () => {
    const feed = foldFrames(OPENING.slice(0, 6));
    expect(feed.status).toBe("waiting");
    expect(feed.onClock).toBeNull();
    expect(feed.picks).toEqual([]);
  });

  it("numbers picks in order and tells autopicks from human picks", () => {
    const feed = foldFrames(OPENING);
    expect(feed.status).toBe("live");
    expect(feed.picks).toEqual([
      { overall: 1, teamId: 4, espnPlayerId: 4429795, auto: true },
      { overall: 2, teamId: 2, espnPlayerId: 4430807, auto: true },
      { overall: 3, teamId: 1, espnPlayerId: 4362628, auto: false },
      { overall: 4, teamId: 3, espnPlayerId: 4426515, auto: true },
    ]);
    expect(feed.autodraft).toEqual([2, 3, 4]);
  });

  it("tracks who is on the clock", () => {
    expect(foldFrames([...OPENING, "SELECTING 3 60000", "CLOCK 6 55000 3"]).onClock).toEqual({ teamId: 3, msRemaining: 55000 });
    // The clock ticking never moves the turn to the wrong team.
    expect(foldFrames([...OPENING, "SELECTING 1 90000", "CLOCK 6 85495 1", "CLOCK 6 80489 1"]).onClock).toEqual({ teamId: 1, msRemaining: 80489 });
  });

  it("tracks autopick being switched off", () => {
    expect(foldFrames([...OPENING, "AUTODRAFT 3 false"]).autodraft).toEqual([2, 4]);
  });

  it("completes on STATE 2", () => {
    const feed = foldFrames([...OPENING, "STATE 2"]);
    expect(feed.status).toBe("complete");
    expect(feed.onClock).toBeNull();
  });

  it("counts unknown and malformed frames without losing picks", () => {
    const feed = foldFrames([...OPENING, "SOMETHINGNEW 1", "SELECTED x y z", "SELECTED 1 4430878 5"]);
    expect(feed.unknownFrames).toBe(1);
    expect(feed.malformedFrames).toBe(1);
    expect(feed.picks.at(-1)).toEqual({ overall: 5, teamId: 1, espnPlayerId: 4430878, auto: true });
  });

  it("is anchored when it saw the draft from before the first pick", () => {
    expect(foldFrames(OPENING).anchored).toBe(true);
    expect(foldFrames(["STATE 1", "SELECTING 4 60000", "SELECTED 4 1 2"]).anchored).toBe(true);
  });

  it("isn't anchored when it joined mid-draft, so its pick numbers are only relative", () => {
    const joinedLate = OPENING.slice(OPENING.indexOf("SELECTING 1 60000\n"));
    const feed = foldFrames(joinedLate);
    expect(feed.anchored).toBe(false);
    expect(feed.picks[0].overall).toBe(1);
    // A later countdown or STATE 1 can't anchor picks already counted.
    expect(foldFrames(["CLOCK 0 1000", "STATE 1"], feed).anchored).toBe(false);
  });

  it("records an ERROR frame", () => {
    expect(foldFrames(["ERROR 1 Invalid+security+code"]).error).toEqual({ code: 1, message: "Invalid security code" });
  });

  it("is deterministic, so re-folding a re-sent log rebuilds the same feed", () => {
    expect(foldFrames(OPENING)).toEqual(foldFrames(OPENING));
    const half = foldFrames(OPENING.slice(0, 12));
    expect(foldFrames(OPENING.slice(12), half)).toEqual(foldFrames(OPENING));
  });

  it("starts empty", () => {
    expect(foldFrames([])).toEqual(emptyFeed());
  });
});
