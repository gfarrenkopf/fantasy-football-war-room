"use client";

import { useEffect } from "react";
import { formatRoundPick, roundOf } from "@/lib/draft/snake";
import { computeAllTurnPlans, slotForRoomIndex, survival, type AvailabilityResult } from "@/lib/draft/sim";
import { LATE_POSITIONS, type CpuStyle, type DraftPick, type Player } from "@/lib/draft/types";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { posLabel } from "./PlayerCard";

export interface ReportData {
  result: AvailabilityResult;
  /** Picks the run started from. */
  picks: DraftPick[];
  room: CpuStyle[];
}

const band = (v: number) => (v >= 75 ? "hi" : v >= 40 ? "mid" : "lo");

/**
 * The availability report: for each of the user's upcoming turns, the chance each player is still on
 * the board. Ported from the prototype's runReport() table; the "plan" section uses computed turn plans.
 */
export function AvailabilityReport({ data, running, onClose }: { data: ReportData | null; running: boolean; onClose(): void }) {
  const model = useModel();
  const { league, ctx } = model;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !e.defaultPrevented && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  let body: React.ReactNode = <p className={s.lbl}>{running ? "Running mocks…" : "No picks left for you to report on."}</p>;
  let meta = running ? "Running mocks…" : "";

  if (data && data.result.turns.length) {
    const { result, picks, room } = data;
    const turns = result.turns;
    const taken = new Set(picks.map((p) => p.playerId));
    const cur = picks.length + 1;
    meta = `${result.n} mocks from pick ${cur}, ${Math.round(result.elapsedMs)} ms. % = chance the player is still on the board when your pick comes up. Room: ${room
      .map((st, i) => `${slotForRoomIndex(i, league.mySlot)}:${st}`)
      .join(" ")}.`;

    const head = (
      <tr>
        <th>Player</th>
        {turns.map((t, j) => (
          <th key={t[0]} className={cx(j === 0 && "next")}>
            at {t.join("/")}
            <br />
            <span className={s.thSub}>
              rd {roundOf(t[0], league.teams)} · {formatRoundPick(t[0], league.teams)}
            </span>
          </th>
        ))}
      </tr>
    );

    const row = (p: Player) => {
      const odds = result.players.get(p.id);
      return (
        <tr key={p.id}>
          <td className={s.reportName}>
            <i style={{ color: POS_COLOR[p.pos] }}>{posLabel(p.pos)}</i>
            {p.name}
            <span className={s.reportSub}>
              {model.dataset.adpSource} {p.adp} / ECR {p.consensusRank}
            </span>
          </td>
          {turns.map((t, j) => {
            if (!odds || taken.has(p.id)) return <td key={t[0]} className={cx("gone")}>—</td>;
            if (odds.mine[j] >= 0.5) {
              return (
                <td key={t[0]} className={cx("gone", j === 0 && "next")} title="You usually draft him before this pick">
                  yours
                </td>
              );
            }
            const v = Math.round(survival(odds, j) * 100);
            return (
              <td key={t[0]} className={cx(band(v), j === 0 && "next")}>
                {v}%
              </td>
            );
          })}
        </tr>
      );
    };

    const seen = new Set<string>();
    const planRows = computeAllTurnPlans(picks, result, ctx).flatMap((plan) => {
      const players = [...plan.targets, ...plan.fallbacks].map((e) => e.player).filter((p) => !seen.has(p.id));
      if (!players.length) return [];
      players.forEach((p) => seen.add(p.id));
      return [
        <tr key={`g-${plan.picks[0]}`} className={s.grp}>
          <td colSpan={turns.length + 1}>
            Plan for pick{plan.picks.length > 1 ? "s" : ""} {plan.picks.join(" & ")}: targets {plan.targets.map((e) => e.player.name).join(", ") || "—"}
            {plan.fallbacks.length ? `; fallbacks ${plan.fallbacks.map((e) => e.player.name).join(", ")}` : ""}
          </td>
        </tr>,
        ...players.map(row),
      ];
    });
    const top = ctx.byConsensus.filter((p) => !taken.has(p.id) && !LATE_POSITIONS.includes(p.pos)).slice(0, 60);

    body = (
      <>
        <h4 className={s.reportH}>Your turn plans: targets and fallbacks</h4>
        <table className={s.reportTable}>
          <thead>{head}</thead>
          <tbody>{planRows}</tbody>
        </table>
        <h4 className={s.reportH}>Top 60 available by expert consensus</h4>
        <table className={s.reportTable}>
          <thead>{head}</thead>
          <tbody>{top.map(row)}</tbody>
        </table>
        <p className={s.reportLegend}>
          Green ≥ 75%, amber 40–74%, red &lt; 40%. % = among mocks where you had not already drafted him, the share where the other{" "}
          {league.teams - 1} teams also left him alone, i.e. &quot;would he survive to this pick?&quot; &quot;yours&quot; means your simulated
          picks usually take him earlier. Columns are the first pick of each of your turns
          {turns.some((t) => t.length > 1) ? "; the second pick of a back-to-back turn sees one more player gone" : ""}. Re-run after each real
          pick; the numbers tighten as the board fills.
        </p>
      </>
    );
  }

  return (
    <>
      <div className={s.scrim} onClick={onClose} />
      <div className={s.report} role="dialog" aria-modal="true" aria-labelledby="report-title">
        <div className={s.reportHead}>
          <b id="report-title">Availability report</b>
          <span className={s.reportMeta}>{meta}</span>
          <button className={s.btn} onClick={onClose}>
            Close
          </button>
        </div>
        <div className={s.reportBody}>{body}</div>
      </div>
    </>
  );
}
