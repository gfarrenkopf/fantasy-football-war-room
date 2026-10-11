"use client";

import { biggestSurprises, trackRecord, type ProjectionAccuracy, type ProjectionCall, type SeasonCalls } from "@/lib/season/accuracy";
import { gameProgress, headToHead, leftToPlay, matchupDecided, matchupLive, pace, type GameDayPhase, type HeadToHeadRow, type Pace } from "@/lib/season/gameday";
import { compareLineups } from "@/lib/season/lineup";
import { weekRecap } from "@/lib/season/recap";
import type { MatchupSide } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import type { ArchiveWeek } from "@/lib/season/leagueRecap";
import { MatchupMoment } from "./MatchupMoment";
import { PlayerLine, posLabel, pts, signed, SLOT_LABEL } from "./parts";
import { RecapArchive } from "./RecapArchive";
import s from "./season.module.css";

/** What the pace meter says, for a screen reader. */
const PACE_TEXT: Record<Pace, string> = {
  pre: "not started",
  behind: "behind his projection",
  on: "on pace with his projection",
  ahead: "ahead of his projection",
  boom: "past his whole projection",
};

/**
 * Game day (APE-226, APE-228): the matchup as a scoreboard, then every player on the user's team,
 * starters and bench alike, with what he's scored set large on the right and his projection under it.
 * A thin meter shows how much of his projection he has, and a tick where the game clock says he should be.
 * Between weeks (APE-306) the scoreboard previews the next matchup, and ESPN's season on the user's
 * team and last week's result come before the players.
 */
export function GameDayPanel({
  leagueId,
  view,
  phase,
  accuracy,
  previous,
  archive,
  onLineupTools,
}: {
  leagueId: string;
  view: SeasonView;
  phase: GameDayPhase;
  /** ESPN's pre-game projections against what was scored (APE-229); null when none were read. */
  accuracy: ProjectionAccuracy | null;
  /** Last week and ESPN's calls on it, between weeks. */
  previous?: { view: SeasonView; accuracy: ProjectionAccuracy | null };
  /** The league's kept weeks, for the recap archive (APE-250); shown whenever no game is on. */
  archive: ArchiveWeek[];
  onLineupTools(): void;
}) {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return <p className={`${s.panel} ${s.note}`}>ESPN didn&apos;t list your team in this league.</p>;

  const byId = new Map(mine.roster.map((p) => [p.playerId, p]));
  // The lineup as set on ESPN, in slot order: those are the points that count.
  const starters = compareLineups(mine.roster, view.lineup).map((row) => ({ key: row.key, player: row.now === null ? undefined : byId.get(row.now) }));
  const bench = mine.roster.filter((p) => p.slot === "BN").sort((a, b) => (b.actual ?? -1) - (a.actual ?? -1) || b.points - a.points);
  const benchPoints = bench.reduce((sum, p) => sum + (p.actual ?? 0), 0);

  const offDay = phase === "lineup";
  // The archive tells last week in full once it's kept; until then, its final stands in.
  // While the result card tells this week, the archive starts from the week before.
  const shownAbove = phase === "results" && matchupDecided(view);
  const lastKept = previous && archive.some((w) => w.season === previous.view.season && w.week === previous.view.currentWeek);

  return (
    <>
      <div className={s.lineup}>
        {/* The matchup: the score over both lineups, slot by slot (APE-343). */}
        <div className={s.stack}>
          {view.matchup ? (
            shownAbove ? (
              <>
                <MatchupMoment leagueId={leagueId} view={view} accuracy={accuracy} />
                <section className={`${s.panel} ${s.h2h}`} aria-labelledby="h2h-title">
                  <div className={s.panelHead}>
                    <h2 id="h2h-title" className={s.panelTitle}>
                      Head to head
                    </h2>
                    <span className={s.panelNote}>As set on ESPN</span>
                  </div>
                  <HeadToHead view={view} teams />
                </section>
              </>
            ) : (
              <Scoreboard view={view} phase={phase}>
                <HeadToHead view={view} />
              </Scoreboard>
            )
          ) : (
            <section className={s.panel} aria-labelledby="starters-title">
              <div className={s.panelHead}>
                <h2 id="starters-title" className={s.panelTitle}>
                  Starters
                </h2>
                <span className={s.panelNote}>As set on ESPN</span>
              </div>
              <ul className={s.scoreList}>
                {starters.map(({ key, player }, i) =>
                  player ? (
                    <ScoreRow key={player.playerId} player={player} slot={SLOT_LABEL[key]} />
                  ) : (
                    <li key={`empty-${i}`} className={s.scoreRow} data-pace="pre">
                      <span className={s.scoreSlot}>{SLOT_LABEL[key]}</span>
                      <span className={s.fine}>Empty on ESPN</span>
                    </li>
                  ),
                )}
              </ul>
            </section>
          )}
        </div>
        {/* Beside it: what ESPN expected (its season and last week, between weeks), the rest of the league, and the bench. */}
        <div className={s.stack}>
          {offDay ? (
            <>
              {accuracy?.season && <TrackRecord view={view} season={accuracy.season} />}
              {previous && !lastKept && <LastWeek view={previous.view} accuracy={previous.accuracy} />}
            </>
          ) : (
            accuracy && <EspnCall view={view} accuracy={accuracy} />
          )}
          {phase === "live" && <AroundTheLeague view={view} />}
          <section className={s.panel} aria-labelledby="gameday-bench-title">
            <div className={s.panelHead}>
              <h2 id="gameday-bench-title" className={s.panelTitle}>
                Your bench
              </h2>
              <span className={s.panelNote}>
                {benchPoints > 0 ? (
                  <>
                    <span className="tabular-nums">{pts(benchPoints)}</span> points on the bench
                  </>
                ) : (
                  `${bench.length} players`
                )}
              </span>
            </div>
            <ul className={s.scoreList}>
              {bench.map((p) => (
                <ScoreRow key={p.playerId} player={p} />
              ))}
            </ul>
          </section>
          <button type="button" className={`${s.button} ${s.lineupTools}`} onClick={onLineupTools}>
            Lineup tools
          </button>
        </div>
      </div>
      {phase !== "live" && <RecapArchive league={view.name} weeks={shownAbove ? archive.filter((w) => !(w.season === view.season && w.week === view.currentWeek)) : archive} />}
    </>
  );
}

/**
 * Both lineups at once (APE-343): the user's starters on the left and their opponent's mirrored on
 * the right, paired by slot down a narrow spine, each with his game, his stats and his points over
 * his projection. Under the scoreboard, its two sides already name the teams; under the result card,
 * a row of its own does.
 */
function HeadToHead({ view, teams = false }: { view: SeasonView; teams?: boolean }) {
  const opponent = view.teams.find((t) => t.id === view.matchup?.them.teamId)?.name ?? "Your opponent";
  return (
    <div className={s.h2hBody}>
      {teams && (
        <div className={s.h2hTeams} aria-hidden>
          <span className={s.h2hMine}>You</span>
          <span className={s.h2hTheirs} title={opponent}>
            {opponent}
          </span>
        </div>
      )}
      <ul className={s.h2hList} aria-label="Starters, slot by slot">
        {headToHead(view).map((row, i) => (
          <li key={i} className={s.h2hRow}>
            <span className={s.h2hSlot}>{SLOT_LABEL[row.key]}</span>
            <H2HSide player={row.me} side="me" />
            <H2HSide player={row.them} side="them" opponent={opponent} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** One side of a head-to-head slot: the player's line and his points, the points toward the spine. */
function H2HSide({ player, side, opponent }: { player: HeadToHeadRow["me"]; side: "me" | "them"; opponent?: string }) {
  const whose = side === "me" ? "Yours: " : `${opponent}'s: `;
  if (!player) {
    return (
      <div className={s.h2hSide} data-side={side} data-pace="pre">
        <span className={s.h2hEmpty}>
          <span className="sr-only">{whose}</span>Empty
        </span>
      </div>
    );
  }
  return (
    <div className={s.h2hSide} data-side={side} data-pace={pace(player)}>
      <span className="sr-only">{whose}</span>
      <PlayerLine player={player} value="none" news={side === "me"} live stats short pos={false} />
      <ScoreCell player={player} />
    </div>
  );
}

/**
 * The league's other matchups while games are on (APE-309): one small card each, both teams' short
 * names and live scores, the leader bright. Scrolls sideways; nothing to tap.
 */
function AroundTheLeague({ view }: { view: SeasonView }) {
  const mine = new Set(view.matchup ? [view.matchup.me.teamId, view.matchup.them.teamId] : [view.myTeamId]);
  const others = view.matchups.flatMap(({ home, away }) => (away && !mine.has(home.teamId) ? [{ home, away }] : []));
  if (!others.length) return null;
  const team = (id: number) => view.teams.find((t) => t.id === id);
  const side = (one: MatchupSide, other: MatchupSide) => {
    const t = team(one.teamId);
    return (
      <span className={s.aroundSide} data-lead={one.points > other.points} title={t?.name}>
        <span className={s.aroundTeam}>{t?.abbrev || t?.name || `Team ${one.teamId}`}</span>
        <b className="tabular-nums">{pts(one.points)}</b>
      </span>
    );
  };
  return (
    <section aria-label="Around the league">
      <ul className={s.aroundList}>
        {others.map(({ home, away }) => {
          const left = leftToPlay(view, home.teamId) + leftToPlay(view, away.teamId);
          const label = `${team(home.teamId)?.name ?? "Home"} ${pts(home.points)}, ${team(away.teamId)?.name ?? "Away"} ${pts(away.points)}, ${left ? `${left} to play` : "done"}`;
          return (
            <li key={home.teamId} className={s.aroundCard} aria-label={label}>
              {side(home, away)}
              {side(away, home)}
              <span className={s.aroundLeft}>{left ? `${left} to play` : "Done"}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * ESPN's season on the user's team (APE-306), for the days between weeks: how far its call has run
 * from the score, which way it leans, how often it called the team too high, and the rostered
 * players it has read most and least closely.
 */
function TrackRecord({ view, season }: { view: SeasonView; season: SeasonCalls }) {
  const names = new Map(view.teams.find((t) => t.id === view.myTeamId)?.roster.map((p) => [p.playerId, p.name]));
  const record = trackRecord(season, new Set(names.keys()));
  const leans = Math.abs(season.meanBias) >= 0.5;
  return (
    <section className={s.panel} aria-labelledby="track-title">
      <div className={s.panelHead}>
        <h2 id="track-title" className={s.panelTitle}>
          ESPN on your team
        </h2>
        <span className={s.panelNote}>
          {season.weeks} {season.weeks === 1 ? "week" : "weeks"}
        </span>
      </div>
      <ul className={s.callList}>
        <li className={s.callRow}>
          <span className={s.callWho}>Misses by</span>
          <span>
            <b className="tabular-nums">{pts(season.meanMiss)}</b> a week
            {leans && (
              <>
                {" · "}
                <span className={s.callGap} data-sign={season.meanBias > 0 ? "over" : "under"}>
                  calls you {season.meanBias > 0 ? "low" : "high"}
                </span>
              </>
            )}
          </span>
        </li>
        <li className={s.callRow}>
          <span className={s.callWho}>Called high</span>
          <span>
            <b className="tabular-nums">{season.overcalled}</b> of {season.weeks} {season.weeks === 1 ? "week" : "weeks"}
          </span>
        </li>
        {record && (
          <>
            <li className={s.callRow}>
              <span className={s.callWho}>Surest read</span>
              <span>
                {names.get(record.surest.playerId)} · off <b className="tabular-nums">{pts(record.surest.meanMiss)}</b> a week
              </span>
            </li>
            <li className={s.callRow}>
              <span className={s.callWho}>Shakiest</span>
              <span>
                {names.get(record.shakiest.playerId)} · off <b className="tabular-nums">{pts(record.shakiest.meanMiss)}</b> a week
              </span>
            </li>
          </>
        )}
      </ul>
    </section>
  );
}

/** Last week's result between weeks (APE-306): the final, the margin, and the star. */
function LastWeek({ view, accuracy }: { view: SeasonView; accuracy: ProjectionAccuracy | null }) {
  const recap = weekRecap(view, accuracy);
  if (!recap) return null;
  const star = recap.star?.player;
  return (
    <section className={s.panel} aria-labelledby="last-week-title">
      <div className={s.panelHead}>
        <h2 id="last-week-title" className={s.panelTitle}>
          Week {recap.week}
        </h2>
        <span className={s.panelNote}>Final</span>
      </div>
      <p className={s.lastResult} data-result={recap.result}>
        <b>{recap.result === "win" ? "Won" : recap.result === "loss" ? "Lost" : "Tied"}</b>{" "}
        <span className="tabular-nums">
          {pts(recap.me)}–{pts(recap.them)}
        </span>{" "}
        <span className={s.lastOpponent}>vs {recap.opponent}</span>
      </p>
      {star && (
        <ul className={s.callList}>
          <li className={s.callRow}>
            <span className={s.callWho}>Star</span>
            <span>
              {star.name} <b className="tabular-nums">{pts(star.points)}</b>{" "}
              {recap.star?.beat && (
                <span className={s.callGap} data-sign="over">
                  {signed(star.points - star.projected)}
                </span>
              )}
            </span>
          </li>
        </ul>
      )}
    </section>
  );
}

/**
 * The matchup as the page's hero: both scores at 44px, the lead between them in tone, each side's
 * projection and starters still to play, and ESPN's win probability as a split bar. The head-to-head
 * hangs under it in the same panel (APE-343): the score and the rows that make it read as one thing.
 */
function Scoreboard({ view, phase, children }: { view: SeasonView; phase: GameDayPhase; children?: React.ReactNode }) {
  const { me, them } = view.matchup!;
  const opponent = view.teams.find((t) => t.id === them.teamId)?.name ?? "Your opponent";
  const lead = me.points - them.points;
  const decided = matchupDecided(view);
  const theirLeft = leftToPlay(view, them.teamId);
  const toPlay = leftToPlay(view, me.teamId) + theirLeft;
  // Before the matchup's first kickoff (Wednesday to Thursday night) it's a preview: no score to tie.
  const started = view.teams.some(
    (t) => (t.id === me.teamId || t.id === them.teamId) && t.roster.some((p) => p.slot !== "BN" && p.slot !== "IR" && p.game && p.game.state !== "pre"),
  );
  // Live while a game is on; between games (Sunday night, before Monday's) it says what's left.
  const status = matchupLive(view)
    ? "Live"
    : decided
      ? "Final"
      : phase === "results"
        ? `${theirLeft} left for ${opponent}`
        : started
          ? `${toPlay} to play`
          : "Up next";
  const win = me.winProbability === null ? null : Math.round(me.winProbability * 100);
  const side = (name: string, team: typeof me, mine: boolean) => {
    const left = leftToPlay(view, team.teamId);
    return (
      <div className={s.scoreSide} data-mine={mine}>
        <span className={s.sideName}>{name}</span>
        {/* Before kickoff the projection is the number: a pair of zeros says nothing. */}
        <b className={`${s.scoreBig} tabular-nums`}>{pts(started ? team.points : team.projected)}</b>
        <span className={s.sideSub}>
          {started ? (
            <>
              proj <span className="tabular-nums">{pts(team.projected)}</span>
              {!decided && ` · ${left ? `${left} to play` : "done"}`}
            </>
          ) : (
            "projected"
          )}
        </span>
      </div>
    );
  };
  return (
    <section className={`${s.panel} ${s.scoreboard} ${children ? s.h2h : ""}`} data-lead={lead > 0 ? "up" : lead < 0 ? "down" : "even"} aria-labelledby="scoreboard-title">
      <div className={s.panelHead}>
        <h2 id="scoreboard-title" className={s.panelTitle}>
          Week {view.currentWeek} · <span className={s.scoreStatus}>{status}</span>
        </h2>
        <span className={s.panelNote}>ESPN&apos;s numbers</span>
      </div>
      <div className={s.scoreSides}>
        {side("You", me, true)}
        <span className={s.scoreLead} role="status">
          {lead === 0 ? (started ? "Tied" : "vs") : `${lead > 0 ? (decided ? "Won by" : "Up") : decided ? "Lost by" : "Down"} ${pts(Math.abs(lead))}`}
        </span>
        {side(opponent, them, false)}
      </div>
      {win !== null && !decided && (
        <div className={s.winOdds}>
          <span className={s.winBar} role="img" aria-label={`ESPN gives you a ${win}% chance to win`}>
            <span className={s.winFill} style={{ width: `${win}%` }} />
          </span>
          <span className={s.fine}>
            ESPN: <b className="tabular-nums">{win}%</b> to win
          </span>
        </div>
      )}
      {children}
    </section>
  );
}

/**
 * ESPN's call (APE-229): what ESPN projected before kickoff for both sides and for the user's players,
 * against what they scored, and how far ESPN has been off on the user's team this season. Compact on
 * purpose: one line a side, one line for the players who most beat and missed it, one for the season.
 */
function EspnCall({ view, accuracy }: { view: SeasonView; accuracy: ProjectionAccuracy }) {
  const { me, them, season } = accuracy;
  if (!me && !them && !season) return null;
  const opponent = view.teams.find((t) => t.id === view.matchup?.them.teamId)?.name ?? "Your opponent";
  const names = new Map(view.teams.find((t) => t.id === view.myTeamId)?.roster.map((p) => [p.playerId, p.name]));
  const { best, worst } = biggestSurprises(accuracy.players.filter((p) => names.has(p.playerId)));
  const line = (who: string, call: ProjectionCall | null, now: number | undefined) =>
    call && (
      <li className={s.callRow}>
        <span className={s.callWho}>{who}</span>
        <span className="tabular-nums">
          ESPN had <b>{pts(call.projected)}</b>
          {call.actual !== null ? (
            <>
              {" "}
              · scored <b>{pts(call.actual)}</b>{" "}
              <span className={s.callGap} data-sign={call.actual >= call.projected ? "over" : "under"}>
                ({signed(call.actual - call.projected)})
              </span>
            </>
          ) : (
            now !== undefined && (
              <>
                {" "}
                · <b>{pts(now)}</b> so far
              </>
            )
          )}
        </span>
      </li>
    );
  const lean =
    season && Math.abs(season.meanBias) >= 0.5
      ? `, ${season.meanBias > 0 ? "underrating" : "overrating"} you by ${pts(Math.abs(season.meanBias))} on average`
      : "";
  return (
    <section className={s.panel} aria-labelledby="call-title">
      <div className={s.panelHead}>
        <h2 id="call-title" className={s.panelTitle}>
          ESPN&apos;s call
        </h2>
        <span className={s.panelNote}>Before kickoff</span>
      </div>
      <ul className={s.callList}>
        {line("You", me, view.matchup?.me.points)}
        {line(opponent, them, view.matchup?.them.points)}
        {(best || worst) && (
          <li className={s.callRow}>
            <span className={s.callWho}>Surprises</span>
            <span>
              {best && (
                <>
                  {names.get(best.playerId)}{" "}
                  <span className={s.callGap} data-sign="over">
                    {signed(best.actual! - best.projected)}
                  </span>
                </>
              )}
              {best && worst && " · "}
              {worst && (
                <>
                  {names.get(worst.playerId)}{" "}
                  <span className={s.callGap} data-sign="under">
                    {signed(worst.actual! - worst.projected)}
                  </span>
                </>
              )}
            </span>
          </li>
        )}
      </ul>
      {season && (
        <p className={`${s.fine} ${s.callFoot}`}>
          Over {season.weeks} {season.weeks === 1 ? "week" : "weeks"}, ESPN has missed your score by <b className="tabular-nums">{pts(season.meanMiss)}</b> a
          week{lean}.
        </p>
      )}
    </section>
  );
}

/** One player on game day: his line, game and stats on the left, his points large on the right over his projection and pace. */
function ScoreRow({ player, slot }: { player: ViewPlayer; slot?: string }) {
  return (
    <li className={s.scoreRow} data-pace={pace(player)} data-slotted={slot !== undefined}>
      {slot !== undefined && <span className={s.scoreSlot}>{slot}</span>}
      {/* A slot that names his position says it already; the bench and FLEX/OP still show it. */}
      <PlayerLine player={player} value="none" news live stats pos={slot !== posLabel(player.pos)} />
      <ScoreCell player={player} />
    </li>
  );
}

/** What a player has scored, large, over his projection, with a meter of how much of it he has and a tick where the clock says he should be. */
function ScoreCell({ player }: { player: ViewPlayer }) {
  const level = pace(player);
  const started = level !== "pre";
  const actual = player.actual ?? 0;
  const share = player.points > 0 ? Math.min(1, Math.max(0, actual / player.points)) : 0;
  const due = player.game?.state === "in" ? gameProgress(player.game) : null;
  return (
    <span className={s.scoreCell}>
      {/* Keyed on boom, so the flare plays once when he passes his projection, not on every refresh. */}
      <b key={level === "boom" ? "boom" : "pts"} className={`${s.scoreNow} tabular-nums`}>
        {pts(started ? actual : player.points)}
      </b>
      <span className={s.scoreProj}>
        {!started ? (
          "proj"
        ) : level === "boom" && player.points > 0 ? (
          <>
            <span className={s.scoreOver}>{signed(actual - player.points)}</span>
            <span className={s.scoreOverOf}>
              {" "}
              over <span className="tabular-nums">{pts(player.points)}</span>
            </span>
          </>
        ) : (
          <>
            of <span className="tabular-nums">{pts(player.points)}</span>
          </>
        )}
      </span>
      {started && player.points > 0 && (
        <span className={s.paceMeter} aria-hidden>
          <span className={s.paceFill} style={{ width: `${share * 100}%` }} />
          {due !== null && <span className={s.paceTick} style={{ left: `${due * 100}%` }} />}
        </span>
      )}
      <span className="sr-only">, {PACE_TEXT[level]}</span>
    </span>
  );
}
