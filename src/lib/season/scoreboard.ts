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
  /** The team they play (APE-211), and whether at home; null when ESPN didn't list both teams. */
  opponent: string | null;
  home: boolean;
  /** Kickoff, as an ISO instant; null when ESPN didn't give one. */
  kickoff: string | null;
  /** The quarter (5 and up is overtime) and the seconds left in it, once the game is under way (APE-227). */
  period: number;
  clockSeconds: number;
  /** The game's score from this team's side, once ESPN gives one; null before kickoff. */
  score: { team: number; opponent: number } | null;
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
    const period = typeof event.status.period === "number" ? event.status.period : 0;
    const clockSeconds = typeof event.status.clock === "number" ? event.status.clock : 0;
    if (typeof state !== "string" || !STATES.has(state)) continue;
    const detail = typeof shortDetail === "string" ? shortDetail : "";
    const at = typeof event.date === "string" && !Number.isNaN(Date.parse(event.date)) ? new Date(event.date).toISOString() : null;
    const competitions = Array.isArray(event.competitions) ? event.competitions : [];
    for (const competition of competitions) {
      const competitors = isObject(competition) && Array.isArray(competition.competitors) ? competition.competitors : [];
      const teams = competitors.map((c) => ({
        team: isObject(c) && isObject(c.team) ? (PRO_TEAMS[Number(c.team.id)] ?? null) : null,
        home: isObject(c) && c.homeAway === "home",
        points: isObject(c) ? parsePoints(c.score) : null,
      }));
      for (const { team, home, points } of teams) {
        if (!team) continue;
        const other = teams.length === 2 ? teams.find((t) => t.team !== team) : undefined;
        const opponent = other?.team ?? null;
        // ESPN lists 0-0 before kickoff, which isn't a score yet.
        const score = state !== "pre" && points !== null && other?.points != null ? { team: points, opponent: other.points } : null;
        games.set(team, { state: state as GameState["state"], detail, opponent, home, kickoff: at, period, clockSeconds, score });
      }
    }
  }
  return games;
}

/** ESPN sends a competitor's score as a string ("21"). */
function parsePoints(raw: unknown): number | null {
  const n = typeof raw === "number" ? raw : typeof raw === "string" && raw.trim() !== "" ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : null;
}
