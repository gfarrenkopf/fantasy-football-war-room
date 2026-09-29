import { PRO_TEAMS } from "@/lib/espn/proTeams";

/**
 * Where each NFL game stands this week, from ESPN's public NFL scoreboard (APE-196). The
 * scoreboard's team ids are ESPN's pro-team ids, the same as `PRO_TEAMS`, so a player's `team`
 * finds his game.
 */

export interface GameState {
  /** pre: not kicked off. in: under way. post: over. */
  state: "pre" | "in" | "post";
  /** ESPN's short status line: "4:12 - 3rd", "Halftime", "Final", "Final/OT". */
  detail: string;
}

/** Game state by team abbreviation, for one NFL week. */
export type Scoreboard = ReadonlyMap<string, GameState>;

const isObject = (x: unknown): x is Record<string, unknown> => typeof x === "object" && x !== null && !Array.isArray(x);
const STATES = new Set(["pre", "in", "post"]);

/** Parses the scoreboard. A malformed event, or a team War Room doesn't know, is left out. */
export function parseScoreboard(raw: unknown): Scoreboard {
  const events = isObject(raw) && Array.isArray(raw.events) ? raw.events : [];
  const games = new Map<string, GameState>();
  for (const event of events) {
    if (!isObject(event) || !isObject(event.status) || !isObject(event.status.type)) continue;
    const { state, shortDetail } = event.status.type;
    if (typeof state !== "string" || !STATES.has(state)) continue;
    const game: GameState = { state: state as GameState["state"], detail: typeof shortDetail === "string" ? shortDetail : "" };
    const competitions = Array.isArray(event.competitions) ? event.competitions : [];
    for (const competition of competitions) {
      const competitors = isObject(competition) && Array.isArray(competition.competitors) ? competition.competitors : [];
      for (const c of competitors) {
        const id = isObject(c) && isObject(c.team) ? Number(c.team.id) : NaN;
        const team = PRO_TEAMS[id];
        if (team) games.set(team, game);
      }
    }
  }
  return games;
}
