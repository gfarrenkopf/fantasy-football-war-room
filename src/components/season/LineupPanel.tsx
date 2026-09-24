"use client";

import { lineupEmphasis, type Emphasis } from "@/lib/season/emphasis";
import { compareLineups, isRuledOut, type LineupRow } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";
import { ArrowRight, Check, External, Swap } from "./Icons";
import { Gain, PlayerLine, pts, signed } from "./parts";
import s from "./season.module.css";

const SLOT_LABEL: Record<LineupSlot, string> = {
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

const HEADLINE: Record<Emphasis, string> = {
  rest: "Your ESPN lineup is already the best one",
  trim: "A small tweak",
  gain: "Worth changing",
  swing: "A real swing this week",
  must: "Don't leave these points on your bench",
};

const lastName = (name: string) => name.split(" ").filter((w) => !/^(jr\.?|sr\.?|ii|iii|iv)$/i.test(w)).pop() ?? name;

/** Why a slot changes, in the words a manager would use. */
function reason(row: LineupRow, now: ViewPlayer | undefined, next: ViewPlayer | undefined): { text: string; kind?: "out" } {
  if (!now) return { text: `Your ${SLOT_LABEL[row.key]} slot is empty on ESPN` };
  if (!next) return { text: "Nobody on your roster can play this slot" };
  if (isRuledOut(now.injuryStatus)) return { text: `${now.name} is ruled out`, kind: "out" };
  if (now.points === 0 && now.projected) return { text: `${now.name} has no game this week`, kind: "out" };
  return { text: `${signed(next.points - now.points)} projected over ${lastName(now.name)}` };
}

/** This week's lineup: what's set on ESPN against War Room's, and the moves between them (10.5, 10.8). */
export function LineupPanel({ view }: { view: SeasonView }) {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  if (!mine) return <p className={`${s.panel} ${s.note}`}>ESPN didn&apos;t list your team in this league.</p>;

  const byId = new Map(mine.roster.map((p) => [p.playerId, p]));
  const get = (id: number | null) => (id === null ? undefined : byId.get(id));
  const { lineup } = view;
  const rows = compareLineups(mine.roster, lineup);
  const changed = rows.filter((r) => r.changed);
  const gain = lineup.total - lineup.currentTotal;
  const level = changed.length ? lineupEmphasis(gain) : "rest";
  const benched = new Set(changed.flatMap((r) => (r.now === null ? [] : [r.now])));
  const bench = lineup.bench
    .flatMap((id) => get(id) ?? [])
    .sort((a, b) => Number(benched.has(b.playerId)) - Number(benched.has(a.playerId)) || b.points - a.points);
  const espnTeam = `https://fantasy.espn.com/football/team?leagueId=${view.espnLeagueId}&seasonId=${view.season}&teamId=${view.myTeamId}`;

  return (
    <div className={s.lineup}>
      <div className={s.stack}>
        <Gain
          className={s.orderGain}
          level={level}
          value={gain}
          unit="pts"
          headline={HEADLINE[level]}
          detail={
            changed.length ? (
              <>
                {changed.length === 1 ? "1 change" : `${changed.length} changes`} on ESPN takes you from{" "}
                <span className="tabular-nums">{pts(lineup.currentTotal)}</span> to{" "}
                <b className="tabular-nums">{pts(lineup.total)}</b> projected points in week {view.currentWeek}.
              </>
            ) : (
              <>
                <b className="tabular-nums">{pts(lineup.total)}</b> projected points in week {view.currentWeek}. Check back before kickoff: injury news can
                change it.
              </>
            )
          }
        />

        <section className={`${s.panel} ${s.orderTable}`} aria-label="Your lineup">
          <table className={s.compare}>
            <caption>Your starters on ESPN now, and War Room&apos;s lineup</caption>
            <colgroup>
              <col className={s.colSlot} />
              <col />
              <col className={s.colArrow} />
              <col />
              <col className={s.colDelta} />
            </colgroup>
            <thead>
              <tr>
                <th scope="col" className={s.slot}>
                  <span className="sr-only">Slot</span>
                </th>
                <th scope="col">
                  On ESPN <span className={`${s.headTotal} tabular-nums`}>{pts(lineup.currentTotal)}</span>
                </th>
                <th scope="col" aria-hidden />
                <th scope="col">
                  War Room <span className={`${s.headTotal} ${s.headOurs} tabular-nums`}>{pts(lineup.total)}</span>
                </th>
                <th scope="col" className={s.delta}>
                  <span className="sr-only">Gain</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => {
                const now = get(row.now);
                const next = get(row.next);
                return (
                  <tr key={`${row.key}-${i}`} data-changed={row.changed}>
                    <th scope="row" className={s.slot}>
                      {SLOT_LABEL[row.key]}
                    </th>
                    <td>{now ? <PlayerLine player={now} tone={row.changed ? "out" : "same"} locked={row.locked && !row.changed} /> : <span className={s.fine}>Empty</span>}</td>
                    <td className={s.arrow}>{row.changed && <ArrowRight />}</td>
                    <td>
                      {row.changed ? (
                        next ? (
                          <PlayerLine player={next} tone="in" locked={row.locked} />
                        ) : (
                          <span className={s.fine}>Nobody available</span>
                        )
                      ) : (
                        <span className={s.keep}>
                          <Check />
                          <span className={s.keepLabel}>Keep</span>
                        </span>
                      )}
                    </td>
                    <td className={`${s.delta} tabular-nums`}>{row.changed && next ? signed(next.points - (now?.points ?? 0)) : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      </div>

      <div className={s.stack}>
        <section className={`${s.panel} ${s.orderMoves}`} aria-labelledby="moves-title">
          <div className={s.panelHead}>
            <h2 id="moves-title" className={s.panelTitle}>
              {changed.length ? "Make these moves on ESPN" : "Nothing to change on ESPN"}
            </h2>
            {changed.length > 0 && <span className={s.panelNote}>{changed.length === 1 ? "1 swap" : `${changed.length} swaps`}</span>}
          </div>
          {changed.length > 0 && (
            <ol className={s.moves}>
              {changed.map((row, i) => {
                const now = get(row.now);
                const next = get(row.next);
                const why = reason(row, now, next);
                return (
                  <li key={`${row.key}-${i}`} className={s.move}>
                    <span className={s.moveIcon}>
                      <Swap />
                    </span>
                    <span className={s.moveText}>
                      {next ? (
                        <>
                          Start <b>{next.name}</b> at {SLOT_LABEL[row.key]}
                          {now ? `, bench ${now.name}` : ""}
                        </>
                      ) : (
                        <>Bench {now?.name}</>
                      )}
                    </span>
                    <span className={s.moveWhy} data-kind={why.kind}>
                      {why.text}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}
          <a className={s.espnLink} href={espnTeam} target="_blank" rel="noreferrer">
            Open my team on ESPN <External />
          </a>
        </section>

        <section className={`${s.panel} ${s.orderBench}`} aria-labelledby="bench-title">
          <div className={s.panelHead}>
            <h2 id="bench-title" className={s.panelTitle}>
              Bench
            </h2>
            <span className={s.panelNote}>{bench.length} players</span>
          </div>
          <ul className={s.bench}>
            {bench.map((p) => (
              <li key={p.playerId} className={s.benchRow} data-moved={benched.has(p.playerId)}>
                <PlayerLine player={p} locked={p.locked} value="none" />
                <span className="text-right">
                  <span className={`${s.benchPts} tabular-nums`}>{pts(p.points)}</span>
                  {benched.has(p.playerId) && <span className={`${s.benchNote} block`}>To the bench</span>}
                </span>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
