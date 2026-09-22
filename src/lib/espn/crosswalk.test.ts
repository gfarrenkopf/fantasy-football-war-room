import { describe, expect, it } from "vitest";
import sample from "@/lib/data/sample-2026.json";
import type { Player } from "@/lib/draft/types";
import { buildCrosswalk, parseEspnPlayers, type EspnPlayer } from "./crosswalk";
import espnPool from "./__fixtures__/espn-players-2026.json";
import { canonicalTeam, dstTeam } from "./proTeams";

const players = sample.players as Player[];
const pool = parseEspnPlayers(espnPool);
const crosswalk = buildCrosswalk(pool, players);
const espnNamed = (name: string) => pool.find((p) => p.fullName === name)!;

describe("buildCrosswalk against ESPN's real player list and the bundled sample", () => {
  it("matches almost every sample player ESPN lists", () => {
    const skill = players.filter((p) => p.pos !== "DST");
    const matched = new Set(pool.map((e) => crosswalk(e.id)).flatMap((r) => (r.kind === "matched" ? [r.playerId] : [])));
    const missed = skill.filter((p) => !matched.has(p.id));
    expect(missed.length / skill.length).toBeLessThan(0.02);
  });

  it("resolves every D/ST by team, including sources that spell teams differently", () => {
    for (const dst of players.filter((p) => p.pos === "DST")) {
      const espn = pool.find((e) => e.defaultPositionId === 16 && dstTeam(e.id) === canonicalTeam(dst.team))!;
      expect(crosswalk(espn.id)).toEqual({ kind: "matched", playerId: dst.id });
    }
    expect(crosswalk(-16034)).toEqual({ kind: "matched", playerId: "texans-d-st-dst-hou" });
  });

  it("matches through a nickname difference on last name, position and team", () => {
    // ESPN says Kenny Gainwell; the sample says Kenneth.
    const kenny = espnNamed("Kenny Gainwell");
    expect(crosswalk(kenny.id)).toEqual({ kind: "matched", playerId: "kenneth-gainwell-rb-tb" });
  });

  it("puts players the dataset doesn't have off the board, with enough to render", () => {
    const offBoard = pool.map((e) => [e, crosswalk(e.id)] as const).filter(([, r]) => r.kind === "offBoard");
    // The sample has ~200 players; ESPN lists ~1,000 draftable ones.
    expect(offBoard.length).toBeGreaterThan(700);
    const [deep, resolution] = offBoard.find(([e]) => e.proTeamId !== 0 && e.defaultPositionId === 4)!;
    expect(resolution).toEqual({ kind: "offBoard", player: { name: deep.fullName, pos: "TE", team: expect.any(String) } });
    // A free agent has no team.
    expect(crosswalk(espnNamed("Kenny Yeboah").id)).toMatchObject({ kind: "offBoard", player: { team: null } });
  });

  it("puts ids ESPN's list doesn't have off the board instead of failing", () => {
    expect(crosswalk(99999999)).toEqual({ kind: "offBoard", player: { name: "ESPN player 99999999", pos: null, team: null } });
  });
});

describe("buildCrosswalk matching rules", () => {
  const p = (id: string, name: string, pos: Player["pos"], team: string) => ({ id, name, pos, team }) as Player;
  const e = (id: number, fullName: string, defaultPositionId: number, proTeamId: number): EspnPlayer => ({ id, fullName, defaultPositionId, proTeamId });

  it("still matches a traded player: team only breaks ties", () => {
    const walk = buildCrosswalk([e(1, "Davante Adams", 3, 14)], [p("davante-adams-wr-lv", "Davante Adams", "WR", "LV")]);
    expect(walk(1)).toEqual({ kind: "matched", playerId: "davante-adams-wr-lv" });
  });

  it("breaks a name tie by team, and refuses to guess when team doesn't settle it", () => {
    const twins = [p("mike-williams-wr-nyj", "Mike Williams", "WR", "NYJ"), p("mike-williams-wr-pit", "Mike Williams", "WR", "PIT")];
    expect(buildCrosswalk([e(1, "Mike Williams", 3, 23)], twins)(1)).toEqual({ kind: "matched", playerId: "mike-williams-wr-pit" });
    expect(buildCrosswalk([e(1, "Mike Williams", 3, 1)], twins)(1).kind).toBe("offBoard");
  });

  it("ignores suffixes and punctuation, as our player ids do", () => {
    const walk = buildCrosswalk([e(1, "Marvin Harrison Jr.", 3, 22)], [p("marvin-harrison-wr-ari", "Marvin Harrison", "WR", "ARI")]);
    expect(walk(1)).toEqual({ kind: "matched", playerId: "marvin-harrison-wr-ari" });
  });

  it("doesn't match across positions", () => {
    const walk = buildCrosswalk([e(1, "Taysom Hill", 1, 18)], [p("taysom-hill-te-no", "Taysom Hill", "TE", "NO")]);
    expect(walk(1).kind).toBe("offBoard");
  });

  it("names an unknown D/ST from its team", () => {
    expect(buildCrosswalk([], [])(-16001)).toEqual({ kind: "offBoard", player: { name: "ATL D/ST", pos: "DST", team: "ATL" } });
  });
});

describe("parseEspnPlayers", () => {
  it("keeps well-formed rows and drops the rest", () => {
    expect(parseEspnPlayers([{ id: 1, fullName: "A", proTeamId: 2, defaultPositionId: 3, extra: true }, { id: "x" }, null])).toEqual([
      { id: 1, fullName: "A", proTeamId: 2, defaultPositionId: 3 },
    ]);
  });

  it("throws on a response that isn't a list", () => {
    expect(() => parseEspnPlayers({ players: [] })).toThrow();
  });
});
