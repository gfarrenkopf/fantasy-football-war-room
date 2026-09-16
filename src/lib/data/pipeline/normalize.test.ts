import { describe, expect, it } from "vitest";
import { POSITIONS } from "@/lib/draft/types";
import { validateDataset } from "../loadDataset";
import { FIXTURE_SEASON, fixtureSnapshot } from "./fixtures";
import { normalize, playerId, slugifyName } from "./normalize";

const run = () => normalize(fixtureSnapshot(), { season: FIXTURE_SEASON, label: "test run" });

describe("slugifyName", () => {
  it("lowercases and dashes", () => {
    expect(slugifyName("Jahmyr Gibbs")).toBe("jahmyr-gibbs");
  });

  it("drops punctuation rather than encoding it", () => {
    expect(slugifyName("Ja'Marr Chase")).toBe("jamarr-chase");
    expect(slugifyName("D.J. Moore")).toBe("dj-moore");
  });

  it("strips accents", () => {
    expect(slugifyName("Equanimeous St. Brown")).toBe("equanimeous-st-brown");
  });

  it("drops generational suffixes, so gaining or losing one doesn't change the id", () => {
    // The source data is inconsistent about these, and an id change orphans saved picks.
    expect(slugifyName("Marvin Harrison Jr.")).toBe(slugifyName("Marvin Harrison"));
    expect(slugifyName("Michael Pittman Jr")).toBe("michael-pittman");
    expect(slugifyName("Odell Beckham III")).toBe("odell-beckham");
  });

  it("keeps a name that is only a suffix rather than returning nothing", () => {
    expect(slugifyName("Jr")).not.toBe("");
  });
});

describe("playerId", () => {
  it("matches the format documented for self-hosters", () => {
    expect(playerId("Jahmyr Gibbs", "RB", "DET")).toBe("jahmyr-gibbs-rb-det");
  });

  it("distinguishes same-named players at different positions or teams", () => {
    expect(playerId("Josh Allen", "QB", "BUF")).not.toBe(playerId("Josh Allen", "LB" as never, "JAX"));
  });
});

describe("normalize", () => {
  it("produces a dataset that passes the shipped validator", () => {
    const { dataset } = run();
    expect(() => validateDataset(dataset)).not.toThrow();
    expect(dataset.players.length).toBeGreaterThan(100);
  });

  it("maps every position, including DEF to DST", () => {
    const { dataset } = run();
    const present = new Set(dataset.players.map((p) => p.pos));
    for (const pos of POSITIONS) expect(present, `missing ${pos}`).toContain(pos);
    expect(dataset.players.some((p) => (p as { pos: string }).pos === "DEF")).toBe(false);
  });

  it("gives every player a bye week matching byeWeeks[team]", () => {
    const { dataset } = run();
    const wrong = dataset.players.filter((p) => dataset.byeWeeks[p.team] !== p.bye);
    expect(wrong).toEqual([]);
  });

  it("drops free agents and records why", () => {
    // The capture script already filters these out, so the fixture has none; add one.
    const snapshot = fixtureSnapshot();
    const template = snapshot.fantasyPlayers[0];
    snapshot.fantasyPlayers.push({ ...template, PlayerID: -1, Name: "Free Agent", Team: "FA" });
    snapshot.fantasyPlayers.push({ ...template, PlayerID: -2, Name: "No Team", Team: null });

    const { dataset, dropped } = normalize(snapshot, { season: FIXTURE_SEASON, label: "t" });
    expect(dropped.filter((d) => d.reason === "no team (free agent)").map((d) => d.name)).toEqual(["Free Agent", "No Team"]);
    expect(dataset.players.some((p) => p.name === "Free Agent")).toBe(false);
  });

  it("drops rows whose position it doesn't recognise", () => {
    const snapshot = fixtureSnapshot();
    snapshot.fantasyPlayers.push({ ...snapshot.fantasyPlayers[0], PlayerID: -3, Name: "Long Snapper", Position: "LS" });
    const { dropped } = normalize(snapshot, { season: FIXTURE_SEASON, label: "t" });
    expect(dropped.some((d) => d.name === "Long Snapper" && d.reason.includes("LS"))).toBe(true);
  });

  it("emits byte-identical ids across two runs", () => {
    // The whole point: saved drafts are keyed by id.
    const a = run().dataset.players.map((p) => p.id);
    const b = run().dataset.players.map((p) => p.id);
    expect(b).toEqual(a);
  });

  it("emits a fully identical dataset across two runs", () => {
    expect(JSON.stringify(run().dataset)).toEqual(JSON.stringify(run().dataset));
  });

  it("ships adp as a rank on the same scale as consensusRank", () => {
    // Raw ADP is measured over a much larger pool than we keep. Comparing the two
    // directly made ~92% of the board "Value"; both must be dense ranks over this
    // dataset for `adp - consensusRank` to mean anything.
    const { dataset } = run();
    const maxAdp = Math.max(...dataset.players.map((p) => p.adp));
    const maxRank = Math.max(...dataset.players.map((p) => p.consensusRank));
    expect(maxAdp).toBeLessThanOrEqual(maxRank);
    expect(dataset.players.every((p) => Number.isInteger(p.adp))).toBe(true);
  });

  it("orders players by consensus rank", () => {
    const { dataset } = run();
    const ranks = dataset.players.map((p) => p.consensusRank);
    expect(ranks).toEqual([...ranks].sort((a, b) => a - b));
  });

  it("only claims the scoring formats it was told it supports", () => {
    const { dataset } = normalize(fixtureSnapshot(), { season: FIXTURE_SEASON, label: "t", scoring: ["ppr"] });
    expect(dataset.scoring).toEqual(["ppr"]);
  });

  it("prefers the Byes endpoint over the per-player ByeWeek field", () => {
    const snapshot = fixtureSnapshot();
    const target = snapshot.fantasyPlayers.find((p) => p.Team && p.Team !== "FA")!;
    const authoritative = snapshot.byes.find((b) => b.Team === target.Team)!;
    target.ByeWeek = 99;
    const { dataset } = normalize(snapshot, { season: FIXTURE_SEASON, label: "t" });
    const player = dataset.players.find((p) => p.team === target.Team);
    expect(player?.bye).toBe(authoritative.Week);
  });

  it("drops a player whose team has no bye week anywhere", () => {
    const snapshot = fixtureSnapshot();
    snapshot.byes = [];
    for (const p of snapshot.fantasyPlayers) p.ByeWeek = null;
    const { dataset, dropped } = normalize(snapshot, { season: FIXTURE_SEASON, label: "t" });
    expect(dataset.players).toEqual([]);
    expect(dropped.every((d) => d.reason.startsWith("no bye week") || d.reason === "no team (free agent)")).toBe(true);
  });

  it("reports a duplicate id instead of silently overwriting", () => {
    const snapshot = fixtureSnapshot();
    const first = snapshot.fantasyPlayers.find((p) => p.Team && p.Team !== "FA")!;
    snapshot.fantasyPlayers.push({ ...first, PlayerID: first.PlayerID + 100_000 });
    const { dropped } = normalize(snapshot, { season: FIXTURE_SEASON, label: "t" });
    expect(dropped.some((d) => d.reason.startsWith("duplicate id"))).toBe(true);
  });
});
