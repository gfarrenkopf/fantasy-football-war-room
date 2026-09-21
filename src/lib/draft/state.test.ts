import { describe, expect, it } from "vitest";
import { currentPick, draftReducer, emptyDraftState, takenMap, type DraftAction } from "./state";
import type { DraftPick, DraftState } from "./types";

const run = (...actions: DraftAction[]): DraftState => actions.reduce(draftReducer, emptyDraftState());
const draft = (playerId: string, mine = false, totalPicks = 192): DraftAction => ({ type: "draft", playerId, mine, totalPicks });
const ids = (s: DraftState) => s.picks.map((p) => `${p.playerId}${p.mine ? "*" : ""}`);

describe("draftReducer", () => {
  it("appends picks in order", () => {
    const s = run(draft("gibbs", true), draft("bijan"), draft("chase"));
    expect(ids(s)).toEqual(["gibbs*", "bijan", "chase"]);
    expect(currentPick(s)).toBe(4);
  });

  it("ignores a player who is already taken", () => {
    const s = run(draft("gibbs", true), draft("gibbs", false));
    expect(ids(s)).toEqual(["gibbs*"]);
  });

  it("ignores picks once the draft is full", () => {
    const s = run(draft("a", false, 2), draft("b", false, 2), draft("c", false, 2));
    expect(ids(s)).toEqual(["a", "b"]);
  });

  it("setMine moves a taken player between rosters and keeps his pick number", () => {
    const s = run(draft("a"), draft("b"), { type: "setMine", playerId: "a", mine: true });
    expect(ids(s)).toEqual(["a*", "b"]);
    const unchanged = draftReducer(s, { type: "setMine", playerId: "a", mine: true });
    expect(unchanged).toBe(s);
    expect(draftReducer(s, { type: "setMine", playerId: "zzz", mine: true })).toBe(s);
  });

  it("untake removes a player from anywhere in the list", () => {
    const s = run(draft("a"), draft("b", true), draft("c"), { type: "untake", playerId: "b" });
    expect(ids(s)).toEqual(["a", "c"]);
  });

  it("undo removes the last pick, reset clears everything", () => {
    expect(ids(run(draft("a"), draft("b"), { type: "undo" }))).toEqual(["a"]);
    expect(run({ type: "undo" })).toEqual(emptyDraftState());
    expect(ids(run(draft("a"), draft("b"), { type: "reset" }))).toEqual([]);
  });

  it("appendPicks adds simulated picks, stopping at a duplicate or a full draft", () => {
    const base = run(draft("a"));
    const sim = draftReducer(base, {
      type: "appendPicks",
      totalPicks: 4,
      picks: [
        { playerId: "b", mine: true },
        { playerId: "c", mine: false },
        { playerId: "d", mine: false },
        { playerId: "e", mine: false },
      ],
    });
    expect(ids(sim)).toEqual(["a", "b*", "c", "d"]);
    const dup = draftReducer(base, { type: "appendPicks", totalPicks: 10, picks: [{ playerId: "b", mine: false }, { playerId: "a", mine: false }, { playerId: "c", mine: false }] });
    expect(ids(dup)).toEqual(["a", "b"]);
  });

  it("hydrate replaces the state", () => {
    const loaded: DraftState = { version: 1, picks: [{ playerId: "x", mine: true }] };
    expect(run(draft("a"), { type: "hydrate", state: loaded })).toBe(loaded);
  });

  it("never mutates the previous state", () => {
    const before = run(draft("a"), draft("b"));
    const snapshot = structuredClone(before);
    draftReducer(before, draft("c"));
    draftReducer(before, { type: "setMine", playerId: "a", mine: true });
    draftReducer(before, { type: "untake", playerId: "a" });
    expect(before).toEqual(snapshot);
  });
});

describe("takenMap", () => {
  it("maps player ids to owner and 1-based pick number", () => {
    const m = takenMap(run(draft("a"), draft("b", true)));
    expect(m.get("a")).toEqual({ mine: false, n: 1 });
    expect(m.get("b")).toEqual({ mine: true, n: 2 });
    expect(m.has("c")).toBe(false);
  });
});

describe("syncExternal", () => {
  const sync = (picks: DraftPick[], mode: "replace" | "merge", totalPicks = 192): DraftAction => ({ type: "syncExternal", picks, mode, totalPicks });
  const offBoard: DraftPick = { playerId: "espn:4685702", mine: false, label: { name: "Deep Sleeper", pos: "WR", team: "SEA" } };

  it("replace makes the board match the external draft exactly", () => {
    const s = run(draft("hand-logged", true), sync([{ playerId: "gibbs", mine: false }, offBoard], "replace"));
    expect(s.picks).toEqual([{ playerId: "gibbs", mine: false }, offBoard]);
  });

  it("replace keeps the same state object when nothing changed, labels included", () => {
    const s = run(sync([{ playerId: "gibbs", mine: false }, offBoard], "replace"));
    expect(draftReducer(s, sync([{ playerId: "gibbs", mine: false }, { ...offBoard, label: { ...offBoard.label! } }], "replace"))).toBe(s);
    expect(draftReducer(s, sync([{ playerId: "gibbs", mine: false }, { ...offBoard, label: { ...offBoard.label!, team: "LAR" } }], "replace"))).not.toBe(s);
  });

  it("replace never goes past the end of the draft", () => {
    expect(ids(run(sync([{ playerId: "a", mine: false }, { playerId: "b", mine: false }, { playerId: "c", mine: false }], "replace", 2)))).toEqual(["a", "b"]);
  });

  it("merge keeps picks logged by hand and appends only players not taken yet", () => {
    const s = run(draft("gibbs", true), draft("bijan"), sync([{ playerId: "bijan", mine: false }, { playerId: "chase", mine: false }, offBoard], "merge"));
    expect(ids(s)).toEqual(["gibbs*", "bijan", "chase", "espn:4685702"]);
    expect(s.picks.at(-1)).toEqual(offBoard);
    expect(draftReducer(s, sync([{ playerId: "chase", mine: false }], "merge"))).toBe(s);
  });
});
