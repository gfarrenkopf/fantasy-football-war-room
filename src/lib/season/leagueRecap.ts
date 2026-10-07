import { weekSwing, type WeekSwing } from "./swing";
import { factsView, type FactPlayer, type FactStanding, type WeekFacts } from "./weekFacts";

/**
 * A week told as the whole league's story (APE-307), after ESPN's matchup recap: the user's result
 * with a few written lines, the standings, the week's top scorers, the one performance that decided
 * a matchup, the best points left on a bench, and the starters who let their teams down. Pure, and
 * built from a week's stored facts, so the archive tells every week the same way. The writing is
 * templated: picked by what happened, never at random.
 */

/** A player, the fantasy team he played for, and how far he ran from ESPN's projection. */
export interface RecapPlayer extends FactPlayer {
  teamId: number;
  teamName: string;
  /** Points over (or, negative, under) ESPN's projection. */
  gap: number;
}

export interface MyWeek {
  result: "win" | "loss" | "tie";
  me: number;
  them: number;
  margin: number;
  opponent: string;
  /** What ESPN projected each lineup that played to score: the sum of its starters' projections. */
  projected: { me: number; them: number };
  starters: FactPlayer[];
  /** The starter who most beat his projection; failing that, the top scorer. */
  star: { player: FactPlayer; beat: boolean } | null;
}

export interface StandingRow extends FactStanding {
  name: string;
  mine: boolean;
}

export interface GameChanger {
  player: RecapPlayer;
  /** His team's winning margin, smaller than his points over projection. */
  margin: number;
  opponent: string;
  /** The final, his team's side first. */
  score: { his: number; theirs: number };
}

export interface LeagueRecap {
  week: number;
  /** Null when the user had a bye or ESPN didn't list their matchup. */
  mine: MyWeek | null;
  /** A few sentences on the user's week; empty without a matchup. */
  story: string;
  standings: StandingRow[];
  topScorers: RecapPlayer[];
  gameChanger: GameChanger | null;
  /** MVB: the most valuable benchwarmers. */
  benchwarmers: RecapPlayer[];
  /** False starters: the starters who fell furthest short of their projections. */
  falseStarters: RecapPlayer[];
}

/** A kept week as the archive shows it (APE-250): its recap, and how the user's matchup swung. */
export interface ArchiveWeek {
  season: number;
  week: number;
  recap: LeagueRecap;
  swing: WeekSwing | null;
}

export function archiveWeek(facts: WeekFacts): ArchiveWeek {
  return { season: facts.season, week: facts.week, recap: leagueRecap(facts), swing: weekSwing(factsView(facts), null) };
}

const TOP_SCORERS = 5;
const BENCHWARMERS = 3;
const FALSE_STARTERS = 3;

/** Within this many points, a result is a nail-biter; past this many, a rout. */
const CLOSE = 3;
const ROUT = 40;
/** A star who beat ESPN by this much gets the line about ESPN. */
const BIG_BEAT = 10;

const round1 = (n: number) => Math.round(n * 10) / 10;
const isStarter = (p: FactPlayer) => p.slot !== "BN" && p.slot !== "IR";
const fmt = (n: number) => n.toFixed(1);

export function leagueRecap(facts: WeekFacts): LeagueRecap {
  const teams = new Map(facts.teams.map((t) => [t.id, t]));
  const nameOf = (id: number) => teams.get(id)?.name ?? `Team ${id}`;
  const everyone: RecapPlayer[] = facts.teams.flatMap((t) =>
    t.players.map((p) => ({ ...p, teamId: t.id, teamName: t.name, gap: round1(p.points - p.projected) })),
  );
  const starters = everyone.filter(isStarter);
  const byPlayer = (a: RecapPlayer, b: RecapPlayer) => a.playerId - b.playerId;

  const mine = myWeek(facts, nameOf);
  return {
    week: facts.week,
    mine,
    story: mine ? story(facts, mine) : "",
    standings: facts.standings.map((s) => ({ ...s, name: nameOf(s.teamId), mine: s.teamId === facts.myTeamId })),
    topScorers: [...starters].sort((a, b) => b.points - a.points || byPlayer(a, b)).slice(0, TOP_SCORERS),
    gameChanger: gameChanger(facts, starters, nameOf),
    benchwarmers: everyone
      .filter((p) => p.slot === "BN" && p.points > 0)
      .sort((a, b) => b.points - a.points || byPlayer(a, b))
      .slice(0, BENCHWARMERS),
    falseStarters: starters
      .filter((p) => p.projected > 0 && p.gap < 0)
      .sort((a, b) => a.gap - b.gap || byPlayer(a, b))
      .slice(0, FALSE_STARTERS),
  };
}

function myWeek(facts: WeekFacts, nameOf: (id: number) => string): MyWeek | null {
  const matchup = facts.matchups.find((m) => m.away && (m.home.teamId === facts.myTeamId || m.away.teamId === facts.myTeamId));
  if (!matchup?.away) return null;
  const [me, them] = matchup.home.teamId === facts.myTeamId ? [matchup.home, matchup.away] : [matchup.away, matchup.home];
  const lineup = (id: number) => facts.teams.find((t) => t.id === id)?.players.filter(isStarter) ?? [];
  const projected = (id: number) => round1(lineup(id).reduce((sum, p) => sum + p.projected, 0));
  const starters = lineup(me.teamId);
  const scored = starters.filter((p) => p.points !== 0);
  const beat = [...scored].sort((a, b) => b.points - b.projected - (a.points - a.projected))[0];
  const top = [...scored].sort((a, b) => b.points - a.points)[0];
  return {
    result: me.points > them.points ? "win" : me.points < them.points ? "loss" : "tie",
    me: me.points,
    them: them.points,
    margin: round1(Math.abs(me.points - them.points)),
    opponent: nameOf(them.teamId),
    projected: { me: projected(me.teamId), them: projected(them.teamId) },
    starters,
    star: beat && beat.points > beat.projected ? { player: beat, beat: true } : top ? { player: top, beat: false } : null,
  };
}

/**
 * The starter whose points over his projection were the most of anyone's on a winning team, and more
 * than the margin his team won by: without them it would have lost. Null when no one's were.
 */
function gameChanger(facts: WeekFacts, starters: readonly RecapPlayer[], nameOf: (id: number) => string): GameChanger | null {
  let best: GameChanger | null = null;
  for (const { home, away } of facts.matchups) {
    if (!away || home.points === away.points) continue;
    const [won, lost] = home.points > away.points ? [home, away] : [away, home];
    const margin = round1(won.points - lost.points);
    for (const p of starters) {
      if (p.teamId !== won.teamId || p.gap <= margin) continue;
      if (!best || p.gap > best.player.gap || (p.gap === best.player.gap && p.playerId < best.player.playerId)) {
        best = { player: p, margin, opponent: nameOf(lost.teamId), score: { his: won.points, theirs: lost.points } };
      }
    }
  }
  return best;
}

/** A few sentences on the user's week: how it went, who carried it, and where it leaves them. */
function story(facts: WeekFacts, w: MyWeek): string {
  const highest = Math.max(...facts.matchups.flatMap((m) => [m.home.points, m.away?.points ?? 0]));
  const lines: string[] = [];

  // The score sits right above the story, so the story says what the score can't.
  if (w.result === "tie") lines.push(`A dead heat with ${w.opponent}, to the tenth of a point.`);
  else if (w.result === "win") {
    const underdog = w.projected.them - w.projected.me;
    if (w.margin < CLOSE) lines.push(`Survived. A ${fmt(w.margin)}-point finish nobody's heart needed.`);
    else if (underdog >= CLOSE) lines.push(`ESPN had ${w.opponent} by ${fmt(underdog)}. You won anyway.`);
    else if (w.margin >= ROUT) lines.push(`No contest. You ran ${w.opponent} off the field by ${fmt(w.margin)}.`);
    else lines.push(`A ${fmt(w.margin)}-point win over ${w.opponent}.`);
  } else {
    if (w.margin < CLOSE) lines.push(`Brutal. ${w.opponent} got you by ${fmt(w.margin)}.`);
    else if (w.them === highest) lines.push(`You ran into the week's best score.`);
    else if (w.margin >= ROUT) lines.push(`Rough one. ${w.opponent} won by ${fmt(w.margin)}.`);
    else lines.push(`${w.opponent} took this one by ${fmt(w.margin)}.`);
  }

  const star = w.star?.player;
  if (star) {
    const gap = star.points - star.projected;
    if (w.star?.beat && gap >= BIG_BEAT) lines.push(`${star.name} blew past ESPN's ${fmt(star.projected)} with ${fmt(star.points)}.`);
    else if (w.result === "loss") lines.push(`${star.name}'s ${fmt(star.points)} deserved better.`);
    else lines.push(`${star.name} led the way with ${fmt(star.points)}.`);
  }
  if (w.me === highest && w.result !== "tie") lines.push("Nobody in the league scored more.");

  const standing = facts.standings.find((s) => s.teamId === facts.myTeamId);
  if (standing) {
    const record = `${standing.wins}–${standing.losses}${standing.ties ? `–${standing.ties}` : ""}`;
    const first = standing.rank === 1;
    lines.push(first ? `That's ${record}, and first in the league.` : `That's ${record}, ${ordinal(standing.rank)} in the league.`);
  }
  return lines.join(" ");
}

function ordinal(n: number): string {
  const tens = n % 100;
  if (tens >= 11 && tens <= 13) return `${n}th`;
  return `${n}${["th", "st", "nd", "rd"][n % 10] ?? "th"}`;
}
