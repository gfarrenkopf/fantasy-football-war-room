import type { GameState } from "./scoreboard";
import type { SeasonView, ViewPlayer } from "./view";

/**
 * Game day (APE-226, APE-227). While any of the user's players is in a game, the season page is a
 * scoreboard rather than a lineup tool; once the starters are all final it shows the week's result,
 * until Wednesday morning brings the lineup tools back for the next week. Before Sunday (a Friday after
 * the Thursday game, a Sunday morning) the page stays on the lineup, which is what those hours are
 * for; from Sunday's games on it stays the scoreboard, Sunday night waiting on Monday included.
 */

export type GameDayPhase = "lineup" | "live" | "results";

/** How a player is doing against his projection: not started, behind it, on it, ahead of it, or past all of it (boom). */
export type Pace = "pre" | "behind" | "on" | "ahead" | "boom";

/**
 * The page goes back to the lineup tools at 9 AM on Wednesday, Eastern, after the week's last game:
 * a whole day after Monday night (APE-251). ESPN moves to the next week early Tuesday, so from then
 * the result is read from last week (inResultHold()).
 */
const RESET_ZONE = "America/New_York";
const RESET_WEEKDAY = 3;
const RESET_HOUR = 9;

/** Tuesday, Eastern: the day after the week's last game, when ESPN has moved on but the result holds. */
const HOLD_WEEKDAY = 2;

/** Sunday and Monday, Eastern: once a game on these days is final, the week is under way. */
const GAME_DAYS = new Set([0, 1]);

const QUARTER_SECONDS = 15 * 60;
const REGULATION_SECONDS = 4 * QUARTER_SECONDS;

/** How far a player can sit from his pace and still be on it: 15% of it, and never under 1.5 points. */
const PACE_BAND = 0.15;
const PACE_FLOOR = 1.5;

/** A team's players who can score this week: anyone not on IR. */
const active = (roster: readonly ViewPlayer[]) => roster.filter((p) => p.slot !== "IR");

/** Starters: the players whose points count. */
const starting = (roster: readonly ViewPlayer[]) => roster.filter((p) => p.slot !== "BN" && p.slot !== "IR");

const rosterOf = (view: SeasonView, teamId: number) => view.teams.find((t) => t.id === teamId)?.roster ?? [];

export function gameDayPhase(view: SeasonView, now: number): GameDayPhase {
  const roster = active(rosterOf(view, view.myTeamId));
  const games = roster.flatMap((p) => (p.game ? [p.game] : []));
  const kickoffs = games.flatMap((g) => (g.kickoff ? [Date.parse(g.kickoff)] : []));
  // Only starters score, and once they're all final no bench player can be swapped in: a bench
  // player still playing Monday night doesn't hold the result back (APE-245).
  const starterGames = starting(roster).flatMap((p) => (p.game ? [p.game] : []));
  if (starterGames.length && starterGames.every((g) => g.state === "post")) {
    // Without kickoffs there's no Wednesday to count to; ESPN moving to the next week ends the results instead.
    if (!kickoffs.length) return "results";
    return now < nextReset(Math.max(...kickoffs)) ? "results" : "lineup";
  }
  if (games.some((g) => g.state === "in")) return "live";
  if (!starterGames.length) return "lineup";
  const played = games.flatMap((g) => (g.state === "post" && g.kickoff ? [Date.parse(g.kickoff)] : []));
  return played.some((at) => GAME_DAYS.has(wallClock(at).weekday)) ? "live" : "lineup";
}

/** How much of the game has been played, 0–1. Overtime counts as all of it. */
export function gameProgress(game: GameState): number {
  if (game.state === "pre") return 0;
  if (game.state === "post" || game.period > 4) return 1;
  if (game.period < 1) return 0;
  const played = (game.period - 1) * QUARTER_SECONDS + (QUARTER_SECONDS - game.clockSeconds);
  return Math.min(1, Math.max(0, played / REGULATION_SECONDS));
}

/** Compares a player's points with the share of his projection the game so far should have brought. */
export function pace(player: Pick<ViewPlayer, "actual" | "points" | "game">): Pace {
  const { game } = player;
  if (!game || (game.state === "pre" && player.actual === null)) return "pre";
  const actual = player.actual ?? 0;
  const projected = player.points;
  if (projected > 0 && actual > projected) return "boom";
  const expected = projected * gameProgress(game);
  const band = Math.max(PACE_FLOOR, Math.abs(expected) * PACE_BAND);
  if (actual > expected + band) return "ahead";
  if (actual < expected - band) return "behind";
  return "on";
}

/** Starters on a team still to finish: their game hasn't kicked off or is under way. */
export function leftToPlay(view: SeasonView, teamId: number): number {
  return starting(rosterOf(view, teamId)).filter((p) => p.game && p.game.state !== "post").length;
}

/** Whether every starter on both sides of the user's matchup is done, so the score is final. */
export function matchupDecided(view: SeasonView): boolean {
  if (!view.matchup) return false;
  const players = [view.matchup.me.teamId, view.matchup.them.teamId].flatMap((id) => starting(rosterOf(view, id)));
  const games = players.flatMap((p) => (p.game ? [p.game] : []));
  return games.length > 0 && games.every((g) => g.state === "post");
}

/**
 * Whether the week is over for the whole league: every starter on every team whose game the
 * scoreboard knows has finished (APE-308). False when it knows none.
 */
export function weekFinal(view: SeasonView): boolean {
  const games = view.teams.flatMap((t) => starting(t.roster).flatMap((p) => (p.game ? [p.game] : [])));
  return games.length > 0 && games.every((g) => g.state === "post");
}

/** Whether any game on either side of the matchup is under way, which is when the page keeps itself fresh. */
export function matchupLive(view: SeasonView): boolean {
  const ids = view.matchup ? [view.matchup.me.teamId, view.matchup.them.teamId] : [view.myTeamId];
  return ids.some((id) => active(rosterOf(view, id)).some((p) => p.game?.state === "in"));
}

/**
 * Whether ESPN may have moved past a week whose result is still up: Tuesday, or Wednesday before
 * 9 AM, Eastern. Last week is then worth reading for its result (APE-251).
 */
export function inResultHold(now: number): boolean {
  const wall = wallClock(now);
  return wall.weekday === HOLD_WEEKDAY || (wall.weekday === RESET_WEEKDAY && wall.hour < RESET_HOUR);
}

/** The first Wednesday 9 AM Eastern after an instant, as epoch ms. */
export function nextReset(after: number): number {
  const wall = wallClock(after);
  const days = (RESET_WEEKDAY - wall.weekday + 7) % 7 || (wall.hour < RESET_HOUR ? 0 : 7);
  const target = Date.UTC(wall.year, wall.month - 1, wall.day + days, RESET_HOUR);
  return fromWallClock(target);
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

const FORMAT = new Intl.DateTimeFormat("en-US", {
  timeZone: RESET_ZONE,
  hourCycle: "h23",
  weekday: "short",
  year: "numeric",
  month: "numeric",
  day: "numeric",
  hour: "numeric",
  minute: "numeric",
  second: "numeric",
});

/** An instant's date and time on Eastern clocks. */
function wallClock(at: number) {
  const parts = Object.fromEntries(FORMAT.formatToParts(at).map((p) => [p.type, p.value]));
  return {
    weekday: WEEKDAYS[parts.weekday],
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
  };
}

/** How far Eastern clocks are ahead of UTC at an instant, in ms (negative: -4 or -5 hours). */
function offset(at: number): number {
  const w = wallClock(at);
  return Date.UTC(w.year, w.month - 1, w.day, w.hour, w.minute, w.second) - Math.floor(at / 1000) * 1000;
}

/** The instant an Eastern wall-clock time (given as if it were UTC) happens. */
function fromWallClock(wall: number): number {
  const guess = wall - offset(wall);
  return wall - offset(guess);
}
