"use client";

import { biggestSurprises, type ProjectionAccuracy, type ProjectionCall } from "@/lib/season/accuracy";
import { gameProgress, leftToPlay, matchupDecided, matchupLive, pace, type GameDayPhase, type Pace } from "@/lib/season/gameday";
import { compareLineups } from "@/lib/season/lineup";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { MatchupMoment } from "./MatchupMoment";
import { PlayerLine, pts, signed, SLOT_LABEL } from "./parts";
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
 */
export function GameDayPanel({
  leagueId,
  view,
  phase,
  accuracy,
  onLineupTools,
}: {
  leagueId: string;
  view: SeasonView;
  phase: Exclude<GameDayPhase, "lineup">;
  /** ESPN's pre-game projections against what was scored (APE-229); null when none were read. */
  accuracy: ProjectionAccuracy | null;
  onLineupTools(): void;
}) {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return <p className={`${s.panel} ${s.note}`}>ESPN didn&apos;t list your team in this league.</p>;

  const byId = new Map(mine.roster.map((p) => [p.playerId, p]));
  // The lineup as set on ESPN, in slot order: those are the points that count.
  const starters = compareLineups(mine.roster, view.lineup).map((row) => ({ key: row.key, player: row.now === null ? undefined : byId.get(row.now) }));
  const bench = mine.roster.filter((p) => p.slot === "BN").sort((a, b) => (b.actual ?? -1) - (a.actual ?? -1) || b.points - a.points);
  const benchPoints = bench.reduce((sum, p) => sum + (p.actual ?? 0), 0);

  return (
    <div className={s.lineup}>
      <div className={s.stack}>
        {view.matchup &&
          (phase === "results" && matchupDecided(view) ? <MatchupMoment leagueId={leagueId} view={view} accuracy={accuracy} /> : <Scoreboard view={view} phase={phase} />)}
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
      </div>
      <div className={s.stack}>
        {accuracy && <EspnCall view={view} accuracy={accuracy} />}
        <section className={s.panel} aria-labelledby="gameday-bench-title">
          <div className={s.panelHead}>
            <h2 id="gameday-bench-title" className={s.panelTitle}>
              Bench
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
  );
}

/**
 * The matchup as the page's hero: both scores at 44px, the lead between them in tone, each side's
 * projection and starters still to play, and ESPN's win probability as a split bar.
 */
function Scoreboard({ view, phase }: { view: SeasonView; phase: Exclude<GameDayPhase, "lineup"> }) {
  const { me, them } = view.matchup!;
  const opponent = view.teams.find((t) => t.id === them.teamId)?.name ?? "Your opponent";
  const lead = me.points - them.points;
  const decided = matchupDecided(view);
  const theirLeft = leftToPlay(view, them.teamId);
  const toPlay = leftToPlay(view, me.teamId) + theirLeft;
  // Live while a game is on; between games (Sunday night, before Monday's) it says what's left.
  const status = matchupLive(view) ? "Live" : decided ? "Final" : phase === "live" ? `${toPlay} to play` : `${theirLeft} left for ${opponent}`;
  const win = me.winProbability === null ? null : Math.round(me.winProbability * 100);
  const side = (name: string, team: typeof me, mine: boolean) => {
    const left = leftToPlay(view, team.teamId);
    return (
      <div className={s.scoreSide} data-mine={mine}>
        <span className={s.sideName}>{name}</span>
        <b className={`${s.scoreBig} tabular-nums`}>{pts(team.points)}</b>
        <span className={s.sideSub}>
          proj <span className="tabular-nums">{pts(team.projected)}</span>
          {!decided && ` · ${left ? `${left} to play` : "done"}`}
        </span>
      </div>
    );
  };
  return (
    <section className={`${s.panel} ${s.scoreboard}`} data-lead={lead > 0 ? "up" : lead < 0 ? "down" : "even"} aria-labelledby="scoreboard-title">
      <div className={s.panelHead}>
        <h2 id="scoreboard-title" className={s.panelTitle}>
          Week {view.currentWeek} · <span className={s.scoreStatus}>{status}</span>
        </h2>
        <span className={s.panelNote}>ESPN&apos;s numbers</span>
      </div>
      <div className={s.scoreSides}>
        {side("You", me, true)}
        <span className={s.scoreLead} role="status">
          {lead === 0 ? "Tied" : `${lead > 0 ? (decided ? "Won by" : "Up") : decided ? "Lost by" : "Down"} ${pts(Math.abs(lead))}`}
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
  const lean = season && Math.abs(season.meanBias) >= 0.5 ? `, ${season.meanBias > 0 ? "underrating" : "overrating"} you by ${pts(Math.abs(season.meanBias))} on average` : "";
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
                  {names.get(best.playerId)} <span className={s.callGap} data-sign="over">{signed(best.actual! - best.projected)}</span>
                </>
              )}
              {best && worst && " · "}
              {worst && (
                <>
                  {names.get(worst.playerId)} <span className={s.callGap} data-sign="under">{signed(worst.actual! - worst.projected)}</span>
                </>
              )}
            </span>
          </li>
        )}
      </ul>
      {season && (
        <p className={`${s.fine} ${s.callFoot}`}>
          Over {season.weeks} {season.weeks === 1 ? "week" : "weeks"}, ESPN has missed your score by <b className="tabular-nums">{pts(season.meanMiss)}</b> a week{lean}.
        </p>
      )}
    </section>
  );
}

/** One player on game day: his line and game on the left, his points large on the right over his projection and pace. */
function ScoreRow({ player, slot }: { player: ViewPlayer; slot?: string }) {
  const level = pace(player);
  const started = level !== "pre";
  const actual = player.actual ?? 0;
  const share = player.points > 0 ? Math.min(1, Math.max(0, actual / player.points)) : 0;
  const due = player.game?.state === "in" ? gameProgress(player.game) : null;
  return (
    <li className={s.scoreRow} data-pace={level} data-slotted={slot !== undefined}>
      {slot !== undefined && <span className={s.scoreSlot}>{slot}</span>}
      <PlayerLine player={player} value="none" news live />
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
              <span className={s.scoreOver}>{signed(actual - player.points)}</span> over <span className="tabular-nums">{pts(player.points)}</span>
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
    </li>
  );
}
