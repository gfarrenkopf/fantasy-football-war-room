"use client";

import { useEffect, useRef, useState, type CSSProperties } from "react";
import { CountUp, StageConfetti, useReducedMotion } from "@/components/draft/stageKit";
import type { LockIn as Moment } from "@/lib/season/lockIn";
import { lineupEmphasis } from "@/lib/season/emphasis";
import { lockInHeadline } from "@/lib/season/lockIn";
import type { ViewPlayer, WarRoomMove } from "@/lib/season/view";
import { hasPlayedMoment, markMomentPlayed, momentKey } from "@/lib/storage/moments";
import { Check } from "./Icons";
import { pts, signed, SLOT_LABEL } from "./parts";
import s from "./season.module.css";

/** A War Room move still to make, as the lineup hero names it. */
export interface LeftMove {
  key: string;
  slot: string;
  into?: ViewPlayer;
  out?: ViewPlayer;
  gain: number;
}

/**
 * The lineup locked in (APE-294): the hero's verdict turns into what the user banked. The panel lights
 * green with one sweep, the ✓ stamps in, and ESPN's total counts up from where it was; War Room's rows
 * draw their bars beside it (LineupPanel). The user's own moves stand with War Room's, as their call.
 * A partial apply celebrates what landed and keeps what's left in view, a tap from being made. No
 * overlay and nothing to dismiss: the next edit, or a reload, puts the ordinary verdict back.
 */
export function LockIn({
  moment,
  settled,
  left,
  leftGain,
  name,
  leagueId,
  season,
  week,
  onFinish,
  className,
}: {
  moment: Moment;
  /** ESPN's lineup has been read back, so `left` and `leftGain` are current. */
  settled: boolean;
  left: readonly LeftMove[];
  leftGain: number;
  name: (id: number) => string;
  leagueId: string;
  season: number;
  week: number;
  /** Stage the rest of War Room's lineup and open the review. */
  onFinish: () => void;
  className?: string;
}) {
  const reduced = useReducedMotion();
  const root = useRef<HTMLDivElement>(null);
  const key = `${momentKey(leagueId, season, week)}:lineup`;
  // Confetti once a week per league, and only for a big gain with no big gain left behind.
  const [confetti] = useState(() => moment.confetti && !hasPlayedMoment(key));
  const remaining = settled ? leftGain : moment.leftover;
  const owed = moment.banked + remaining;

  useEffect(() => {
    if (confetti) markMomentPlayed(key);
    navigator.vibrate?.([18, 50, 28]);
    // On a phone the user is down at the apply panel: bring the moment to them.
    const el = root.current;
    if (el) {
      const { top, bottom } = el.getBoundingClientRect();
      if (top < 0 || bottom > window.innerHeight)
        el.scrollIntoView({
          behavior: reduced ? "auto" : "smooth",
          block: "start",
        });
    }
    // Once, when the moment arrives.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const spoken = [
    "Lineup set on ESPN.",
    `War Room's moves add ${pts(moment.banked)} projected points.`,
    remaining >= 0.05 ? `${pts(remaining)} more points are still on your bench.` : "",
  ].join(" ");

  return (
    <div ref={root} className={`${s.gain} ${s.lockIn} ${className ?? ""}`} data-level={moment.level} data-sign="gain" data-still={reduced || undefined}>
      <p className="sr-only" role="status">
        {spoken}
      </p>
      <div className={s.gainLead} aria-hidden>
        <p className={s.gainNumber}>
          <span className="tabular-nums">
            +
            <CountUp to={moment.banked} delay={150} still={reduced} decimals={1} ms={760} />
          </span>
          <span className={s.gainUnit}>pts</span>
        </p>
        <p className={s.gainShift}>
          <span className={`${s.gainShiftFrom} ${s.lockFrom} tabular-nums`}>{pts(moment.before)}</span>{" "}
          <b className="tabular-nums">
            <CountUp from={moment.before} to={moment.after} delay={150} still={reduced} decimals={1} ms={760} />
          </b>
          <span className={s.gainShiftNote}>on ESPN · week {week}</span>
        </p>
      </div>
      <p className={`${s.gainHeadline} ${s.lockHead}`}>
        <span className={s.lockStamp}>
          <Check />
        </span>
        {lockInHeadline(moment.level, moment.banked)}
      </p>
      <div className={s.gainDetail}>
        <ul className={s.gainMoves}>
          {moment.warRoom.map((m) => (
            <li key={m.playerId}>
              <span className={s.gainMoveText}>
                <b>{name(m.playerId)}</b> in at {SLOT_LABEL[m.to]}
              </span>
              <b className={`${s.gainMoveGain} tabular-nums`}>{signed(m.gain)}</b>
            </li>
          ))}
          {moment.own.map((m) => (
            <li key={m.playerId} className={s.lockOwn}>
              <span className={s.gainMoveText}>
                <b>{name(m.playerId)}</b> in at {SLOT_LABEL[m.to]} <span className={s.lockCall}>Your call</span>
              </span>
              <b className={`${s.gainMoveGain} tabular-nums`} data-loss={m.delta < 0 || undefined}>
                {signed(m.delta)}
              </b>
            </li>
          ))}
        </ul>

        {remaining >= 0.05 && (
          <div className={s.lockLeft}>
            <p className={s.lockLeftHead}>
              <b>Still on your bench</b>
              <span>
                You banked <b className="tabular-nums">{pts(moment.banked)}</b> of War Room&apos;s <b className="tabular-nums">{pts(owed)}</b>
              </span>
            </p>
            <span
              className={s.lockMeter}
              style={
                {
                  "--banked": `${(moment.banked / owed) * 100}%`,
                } as CSSProperties
              }
            >
              <i />
            </span>
            {settled && left.length > 0 && (
              <ul className={s.gainMoves}>
                {left.map((m) => (
                  <li key={m.key}>
                    <span className={s.gainMoveText}>
                      {m.into ? (
                        <>
                          Start <b>{m.into.name}</b>
                        </>
                      ) : (
                        <>Leave {m.slot} empty</>
                      )}
                      {m.out && <> over {m.out.name}</>}
                    </span>
                    <b className={`${s.gainMoveGain} tabular-nums`}>{signed(m.gain)}</b>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
      {remaining >= 0.05 && settled && left.length > 0 && (
        <button type="button" className={`${s.primary} ${s.lockFinish}`} onClick={onFinish}>
          {left.length === 1 ? "Make the last move" : `Make these ${left.length} moves`}
        </button>
      )}
      {confetti && !reduced && <StageConfetti from="bottom" life={2000} density={0.55} className={s.lockConfetti} />}
    </div>
  );
}

/**
 * The rest of the week, once War Room's lineup is on ESPN (APE-294): the verdict keeps the reward,
 * still. The points War Room's moves banked lead in green, the ✓ sits beside "Your lineup is set", and
 * the moves that earned them are listed. No sweep, no count: the user sees this every visit.
 */
export function Banked({ moves, total, week, name, className }: { moves: readonly WarRoomMove[]; total: number; week: number; name: (id: number) => string; className?: string }) {
  const banked = moves.reduce((sum, m) => sum + m.gain, 0);
  return (
    <div className={`${s.gain} ${s.lockIn} ${s.lockSettled} ${className ?? ""}`} data-level={lineupEmphasis(banked)} data-sign="gain" role="status">
      <div className={s.gainLead}>
        <p className={s.gainNumber}>
          <span className="tabular-nums">{signed(banked)}</span>
          <span className={s.gainUnit}>pts</span>
        </p>
        <p className={s.gainShift}>
          <b className="tabular-nums">{pts(total)}</b>
          <span className={s.gainShiftNote}>on ESPN · week {week}</span>
        </p>
      </div>
      <p className={`${s.gainHeadline} ${s.lockHead}`}>
        <span className={s.lockStamp}>
          <Check />
        </span>
        Your lineup is set
      </p>
      <div className={s.gainDetail}>
        <ul className={s.gainMoves}>
          {moves.map((m) => (
            <li key={m.playerId}>
              <span className={s.gainMoveText}>
                <b>{name(m.playerId)}</b> in at {SLOT_LABEL[m.slot]}
              </span>
              <b className={`${s.gainMoveGain} tabular-nums`}>{signed(m.gain)}</b>
            </li>
          ))}
        </ul>
        <p className={s.lockFoot}>War Room&apos;s moves banked these points. Check back before kickoff: injury news can change it.</p>
      </div>
    </div>
  );
}
