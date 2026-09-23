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

  it("stops the clock while the draft is paused, and doesn't count the pause as drift", () => {
    const paused = foldFrames(["CLOCK 0 5000", "STATE 1", "SELECTING 2 60000", ...Array.from({ length: 30 }, () => "CLOCK")]);
    expect(paused.onClock).toBeNull();
    expect(paused.malformedFrames).toBe(0);
    expect(foldFrames(["CLOCK 6 41000 2"], paused).onClock).toEqual({ teamId: 2, msRemaining: 41000 });
  });

  it("records an ERROR frame", () => {
    expect(foldFrames(["ERROR 1 Invalid+security+code"]).error).toEqual({ code: 1, message: "Invalid security code" });
  });

  it("counts a refused pick apart from errors: the socket stays open and the feed is fine", () => {
    const feed = foldFrames(["ERROR 1 Invalid+selection+team+%281%29%3B+team+4+is+currently+on+the+clock."]);
    expect(feed.error).toBeNull();
    expect(feed.refusedPicks).toBe(1);
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

describe("catch-up frames (8.12)", () => {
  const CATCHUP = ["WR_CATCHUP 1 4 101", "WR_CATCHUP 2 1 102", "WR_CATCHUP 3 2 103"];

  it("seeds the draft a late bridge missed, and anchors it so later picks get real numbers", () => {
    const feed = foldFrames([...CATCHUP, "SELECTING 3 60000", "SELECTED 3 104 2"]);
    expect(feed.anchored).toBe(true);
    expect(feed.picks.map((p) => [p.overall, p.teamId, p.espnPlayerId])).toEqual([
      [1, 4, 101],
      [2, 1, 102],
      [3, 2, 103],
      [4, 3, 104],
    ]);
  });

  it("ignores catch-up that repeats or skips, so a re-sent log can't invent picks", () => {
    expect(foldFrames([...CATCHUP, ...CATCHUP]).picks).toHaveLength(3);
    expect(foldFrames(["WR_CATCHUP 2 1 102"]).picks).toHaveLength(0);
    // Re-folding the whole log is what the relay does after a restart: same feed, every time.
    const once = foldFrames([...CATCHUP, "SELECTED 3 104 2"]);
    expect(foldFrames([...CATCHUP, "SELECTED 3 104 2"])).toEqual(once);
  });

  it("leaves a finished draft alone", () => {
    expect(foldFrames(["STATE 2", ...CATCHUP]).picks).toHaveLength(0);
  });
});
