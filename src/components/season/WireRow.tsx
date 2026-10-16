"use client";

import type { ReactNode } from "react";
import type { SeasonView } from "@/lib/season/view";
import type { Pickup } from "@/lib/season/waivers";
import { AcquireReview } from "./AcquireReview";
import { LocalTime } from "./LocalTime";
import { PlayerLine, signed } from "./parts";
import s from "./season.module.css";

/**
 * One available player on the wire (APE-212, APE-410): who he is, whether he can be added now or
 * claimed, what he's worth, who he'd push off the roster, and the Add or Claim that opens the review
 * in place. The pickups, next week's fills and the free-agent search all list players this way.
 */
export function WireRow({
  view,
  leagueId,
  pickup,
  names,
  writeConsented,
  acting,
  gain,
  status,
  onAct,
  onDone,
}: {
  view: SeasonView;
  leagueId: string;
  pickup: Pickup;
  names: ReadonlyMap<number, string>;
  writeConsented: boolean;
  /** The player whose review is open, anywhere on the tab: one at a time. */
  acting: number | null;
  /** What he's worth, on the right: points a week by default. */
  gain: ReactNode;
  /** Under his name; says whether he's on waivers by default. */
  status?: ReactNode;
  onAct: (playerId: number | null) => void;
  onDone: (message: string) => void;
}) {
  const { player, drop } = pickup;
  const waivers = player.status === "WAIVERS";
  const bids = view.waiver.budget !== null;
  const open = acting === player.playerId;
  return (
    <li className={s.benchRow}>
      <span className={s.pickupWho}>
        <PlayerLine player={player} value="none" ownership live />
        <span className={s.pickupStatus} data-status={player.status}>
          {status ??
            (waivers ? (
              <>
                On waivers
                {player.waiverClears && (
                  <>
                    {" "}
                    · clears <LocalTime iso={player.waiverClears} />
                  </>
                )}
              </>
            ) : (
              "Free agent: add now"
            ))}
        </span>
      </span>
      <span className={s.wireSide}>
        {gain}
        {drop !== null && <span className={`${s.benchNote} block`}>Drop {names.get(drop) ?? "your weakest player"}</span>}
        {!open &&
          (waivers && bids ? (
            <span className={`${s.benchStatus} block`}>Claim with a FAAB bid on ESPN</span>
          ) : (
            <button type="button" className={`${s.button} ${s.pickupAct}`} onClick={() => onAct(player.playerId)} aria-label={`${waivers ? "Claim" : "Add"} ${player.name}`}>
              {waivers ? "Claim" : "Add"}
            </button>
          ))}
      </span>
      {open && <AcquireReview view={view} leagueId={leagueId} pickup={pickup} agreed={writeConsented} onCancel={() => onAct(null)} onDone={onDone} />}
    </li>
  );
}

/** Points a week he'd add to the best lineup, or that he'd only sit on the bench. */
export function WeeklyGain({ pickup }: { pickup: Pickup }) {
  if (pickup.perWeek < 0.05) return <span className={`${s.benchStatus} block`}>Wouldn&apos;t start</span>;
  return (
    <>
      <span className={`${s.pickupGain} tabular-nums`}>
        {signed(pickup.perWeek)}
        <span className={s.gainUnit}> a week</span>
      </span>
      <span className={`${s.benchStatus} block`}>
        <span className="tabular-nums">{signed(pickup.delta)}</span> rest of season
      </span>
    </>
  );
}
