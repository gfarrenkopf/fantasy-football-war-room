import { useId } from "react";
import type { Emphasis } from "@/lib/season/emphasis";
import { isRuledOut } from "@/lib/season/lineup";
import type { LineupSlot, Standing } from "@/lib/season/types";
import { likelyOut, onBye, type ViewPlayer } from "@/lib/season/view";
import { Check, Lock, Note } from "./Icons";
import { LocalTime } from "./LocalTime";
import s from "./season.module.css";

/** Shared pieces of the season page: the gain verdict and a player's line. */

export const pts = (n: number) => n.toFixed(1);

const ordinal = (n: number) => {
  const tens = n % 100;
  const suffix = tens >= 11 && tens <= 13 ? "th" : (["th", "st", "nd", "rd"][n % 10] ?? "th");
  return `${n}${suffix}`;
};

/** A team's record and seed, as a manager says it: "3–1, 2nd of 10". */
export function recordText(standing: Standing, teams: number): string {
  const record = `${standing.wins}–${standing.losses}${standing.ties ? `–${standing.ties}` : ""}`;
  return standing.seed ? `${record}, ${ordinal(standing.seed)} of ${teams}` : record;
}
/** A position as ESPN writes it. */
export const posLabel = (pos: ViewPlayer["pos"]) => (pos === "DST" ? "D/ST" : pos);

/** Slot names as ESPN shows them. */
export const SLOT_LABEL: Record<LineupSlot, string> = {
  QB: "QB",
  RB: "RB",
  WR: "WR",
  TE: "TE",
  FLEX: "FLEX",
  SUPERFLEX: "OP",
  DST: "D/ST",
  K: "K",
  BN: "Bench",
  IR: "IR",
};

export const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** ESPN's injury designations as the short tags ESPN itself shows. */
export const INJURY_TAG: Record<string, string> = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };

/**
 * The page's verdict: a signed number that grows louder the more it's worth (src/lib/season/emphasis.ts).
 * At rest it's a check, not a zero.
 */
export function Gain({
  level,
  value,
  unit,
  headline,
  detail,
  aside,
  compact = false,
  inline = false,
  className,
}: {
  level: Emphasis;
  value: number;
  unit: string;
  headline: string;
  detail: React.ReactNode;
  /** Under the number, as part of the verdict: what it does to a total (the lineup's "99.5 → 117.5"). */
  aside?: React.ReactNode;
  compact?: boolean;
  /** Part of a card rather than a surface of its own. */
  inline?: boolean;
  className?: string;
}) {
  const number = (
    <p className={s.gainNumber} key={`${level}:${value.toFixed(1)}`}>
      {level === "rest" ? (
        <Check />
      ) : (
        <>
          <span className="tabular-nums">{signed(value)}</span>
          <span className={s.gainUnit}>{unit}</span>
        </>
      )}
    </p>
  );
  return (
    <div
      className={[s.gain, compact && s.gainCompact, inline && s.gainInline, className].filter(Boolean).join(" ")}
      data-level={level}
      data-sign={value < 0 ? "loss" : "gain"}
      role="status"
    >
      {aside ? (
        <div className={s.gainLead}>
          {number}
          {aside}
        </div>
      ) : (
        number
      )}
      <p className={s.gainHeadline}>{headline}</p>
      <div className={s.gainDetail}>{detail}</div>
    </div>
  );
}

/** Whether the player's game this week has kicked off, going by ESPN's scoreboard or his points. */
export const hasStarted = (player: ViewPlayer) => player.actual !== null || player.game?.state === "in" || player.game?.state === "post";

/**
 * The player's NFL game this week: who it's against (APE-211) and where it stands (APE-196). Before
 * kickoff, the opponent and kickoff in muted ink; while it's on, the score from his team's side and
 * the clock in Terminal Sky behind a still dot; once it's over, a muted "W 24–17 · Final" (APE-228).
 * Nothing when the scoreboard didn't load.
 */
export function GameStatus({ player }: { player: ViewPlayer }) {
  const game = player.game;
  if (!game) return null;
  const opponent = game.opponent && `${game.home ? "vs" : "@"} ${game.opponent}`;
  const score = game.score && `${game.score.team}–${game.score.opponent}`;
  if (game.state === "in") {
    return (
      <span className={s.live}>
        <span className={s.liveDot} aria-hidden />
        <span className="sr-only">Playing now: </span>
        {[opponent, score, game.detail || "Live"].filter(Boolean).join(" · ")}
      </span>
    );
  }
  if (game.state === "post") {
    const result = game.score && `${game.score.team > game.score.opponent ? "W" : game.score.team < game.score.opponent ? "L" : "T"} ${score}`;
    return <span className={s.final}>{[opponent, result, game.detail || "Final"].filter(Boolean).join(" · ")}</span>;
  }
  return (
    <span className={s.pregame}>
      {opponent}
      {opponent && game.kickoff && " · "}
      {game.kickoff && <LocalTime iso={game.kickoff} />}
    </span>
  );
}

/**
 * ESPN's outlook for a player this week (APE-213): a small "News" tag beside his name that opens the
 * note in a popover. A tap, not a hover, so it works in the hand.
 */
function NewsNote({ player }: { player: ViewPlayer }) {
  const id = useId();
  if (!player.news) return null;
  return (
    <>
      <button type="button" className={s.newsTag} popoverTarget={id} aria-label={`ESPN's news on ${player.name}`}>
        <Note className={s.newsIcon} />
        <span className={s.newsLabel}>News</span>
      </button>
      <div id={id} popover="auto" className={s.newsNote}>
        <p className={s.newsHead}>
          <b>{player.name}</b>
          {player.news.at && (
            <span className={s.newsWhen}>
              ESPN · <LocalTime iso={player.news.at} />
            </span>
          )}
        </p>
        <p className={s.newsBody}>{player.news.note}</p>
        <button type="button" className={s.button} popoverTarget={id} popoverTargetAction="hide">
          Close
        </button>
      </div>
    </>
  );
}

/** A player's name, injury tag and lock, over their position, team and projection, and on game day what he's done. */
export function PlayerLine({
  player,
  tone = "same",
  locked = false,
  value = "points",
  live = false,
  news = false,
  ownership = false,
  pos = true,
  stats = false,
  stacked = false,
}: {
  player: ViewPlayer;
  tone?: "same" | "out" | "in";
  locked?: boolean;
  /** Which projection the second line shows: this week's, or the rest of the season's. */
  value?: "points" | "none";
  /** Show this week's game once it kicks off: points scored so far and where the game stands. */
  live?: boolean;
  /** Offer ESPN's outlook for him this week, when there is one. */
  news?: boolean;
  /** Add how widely he's rostered and started across ESPN. */
  ownership?: boolean;
  /** Show his position. Off where a slot label already says it; his team then leads his game (APE-247). */
  pos?: boolean;
  /** Add a line of the stats behind his points once his game starts (APE-247). */
  stats?: boolean;
  /** His game and ownership take a line each at every width, as on ESPN's roster (APE-249). */
  stacked?: boolean;
}) {
  const tag = INJURY_TAG[player.injuryStatus];
  const bye = onBye(player);
  const sitting = likelyOut(player);
  const started = live && hasStarted(player);
  const status = live && player.game !== null;
  return (
    <span className={s.player} data-tone={tone} data-stacked={stacked || undefined}>
      <span className={s.playerLine}>
        <span className={s.name}>{player.name}</span>
        {tag && (
          <span className={s.tag} data-kind={isRuledOut(player.injuryStatus) ? "out" : "warn"}>
            {tag}
          </span>
        )}
        {news && <NewsNote player={player} />}
        {locked && (
          <>
            <Lock className={s.lock} />
            <span className="sr-only">(locked: game started)</span>
          </>
        )}
      </span>
      <span className={s.facts}>
        {(pos || !status) && (
          <>
            {pos && (
              <>
                <span className={s.pos} data-pos={player.pos}>
                  {posLabel(player.pos)}
                </span>{" "}
                ·{" "}
              </>
            )}
            {player.team ?? "FA"}
          </>
        )}
        {value === "points" &&
          (started ? (
            <span className={s.factsPoints}>
              <span className={s.factsSep}> · </span>
              <span className={`${s.actual} tabular-nums`}>{pts(player.actual ?? 0)}</span>
              <span className="sr-only"> points so far,</span> {player.game?.state === "in" ? "of" : "· proj"}{" "}
              <span className="tabular-nums">{pts(player.points)}</span>
            </span>
          ) : (
            <>
              {" "}
              · <span className={`${s.pts} tabular-nums`}>{pts(player.points)}</span>
              {bye && " · bye"}
              {sitting && " · likely out"}
              {!player.projected && " · no projection"}
            </>
          ))}
        {status && (
          <span className={s.factsGame}>
            {pos ? <span className={s.factsSep}> · </span> : `${player.team ?? "FA"} `}
            <GameStatus player={player} />
          </span>
        )}
        {ownership && player.ownership && (
          <span className={s.factsOwn}>
            <span className={s.factsSep}> · </span>
            <span className="tabular-nums">{player.ownership.owned}%</span> own · <span className="tabular-nums">{player.ownership.started}%</span> start
          </span>
        )}
      </span>
      {stats && player.statLine && <span className={`${s.factsStats} tabular-nums`}>{player.statLine}</span>}
    </span>
  );
}
