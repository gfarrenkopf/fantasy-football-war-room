import type { Emphasis } from "@/lib/season/emphasis";
import { isRuledOut } from "@/lib/season/lineup";
import type { ViewPlayer } from "@/lib/season/view";
import { Check, Lock } from "./Icons";
import s from "./season.module.css";

/** Shared pieces of the season page: the gain verdict and a player's line. */

export const pts = (n: number) => n.toFixed(1);
export const signed = (n: number) => `${n >= 0 ? "+" : "−"}${Math.abs(n).toFixed(1)}`;

/** ESPN's injury designations as the short tags ESPN itself shows. */
const INJURY_TAG: Record<string, string> = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "OUT", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };

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
  compact = false,
  inline = false,
  className,
}: {
  level: Emphasis;
  value: number;
  unit: string;
  headline: string;
  detail: React.ReactNode;
  compact?: boolean;
  /** Part of a card rather than a surface of its own. */
  inline?: boolean;
  className?: string;
}) {
  return (
    <div
      className={[s.gain, compact && s.gainCompact, inline && s.gainInline, className].filter(Boolean).join(" ")}
      data-level={level}
      data-sign={value < 0 ? "loss" : "gain"}
      role="status"
    >
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
      <p className={s.gainHeadline}>{headline}</p>
      <p className={s.gainDetail}>{detail}</p>
    </div>
  );
}

/** A player's name, injury tag and lock, over their position, team and projection. */
export function PlayerLine({
  player,
  tone = "same",
  locked = false,
  value = "points",
}: {
  player: ViewPlayer;
  tone?: "same" | "out" | "in";
  locked?: boolean;
  /** Which projection the second line shows: this week's, or the rest of the season's. */
  value?: "points" | "none";
}) {
  const tag = INJURY_TAG[player.injuryStatus];
  const bye = player.points === 0 && player.projected;
  return (
    <span className={s.player} data-tone={tone}>
      <span className={s.playerLine}>
        <span className={s.name}>{player.name}</span>
        {tag && (
          <span className={s.tag} data-kind={isRuledOut(player.injuryStatus) ? "out" : "warn"}>
            {tag}
          </span>
        )}
        {locked && (
          <>
            <Lock className={s.lock} />
            <span className="sr-only">(locked: game started)</span>
          </>
        )}
      </span>
      <span className={s.facts}>
        <span className={s.pos} data-pos={player.pos}>
          {player.pos === "DST" ? "D/ST" : player.pos}
        </span>{" "}
        · {player.team ?? "FA"}
        {value === "points" && (
          <>
            {" "}
            · <span className={`${s.pts} tabular-nums`}>{pts(player.points)}</span>
            {bye && " · bye"}
            {!player.projected && " · no projection"}
          </>
        )}
      </span>
    </span>
  );
}
