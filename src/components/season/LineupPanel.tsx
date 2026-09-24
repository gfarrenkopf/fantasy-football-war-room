"use client";

import type { Position } from "@/lib/draft/types";
import { compareLineups, isRuledOut } from "@/lib/season/lineup";
import type { LineupSlot } from "@/lib/season/types";
import type { SeasonView, ViewPlayer } from "@/lib/season/view";

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

const POS_TEXT: Record<Position, string> = { QB: "text-qb", RB: "text-rb", WR: "text-wr", TE: "text-te", K: "text-k", DST: "text-dst" };

/** ESPN's injury designations as the short tags ESPN itself shows. */
const INJURY_TAG: Record<string, string> = { QUESTIONABLE: "Q", DOUBTFUL: "D", OUT: "O", INJURY_RESERVE: "IR", SUSPENSION: "SSPD" };

const pts = (n: number) => n.toFixed(1);

/** This week's recommended lineup against what's set on ESPN (10.5). */
export function LineupPanel({ view }: { view: SeasonView }) {
  const mine = view.teams.find((t) => t.id === view.myTeamId);
  const byId = new Map((mine?.roster ?? []).map((p) => [p.playerId, p]));
  const { lineup } = view;
  const gain = lineup.total - lineup.currentTotal;
  const moved = new Set(lineup.moves.map((m) => m.playerId));
  const starts = lineup.moves.filter((m) => m.to !== "BN" && m.to !== "IR");
  const benches = lineup.moves.filter((m) => m.to === "BN");
  const rows = compareLineups(mine?.roster ?? [], lineup);

  if (!mine) return <p className="rounded-card border border-line bg-panel p-4 text-sm">ESPN didn&apos;t list your team in this league.</p>;

  return (
    <section className="space-y-3" aria-labelledby="lineup-title">
      <div className="rounded-card border border-line bg-panel p-4 space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <h2 id="lineup-title" className="font-semibold">
            Week {view.currentWeek} lineup
          </h2>
          <p className="text-sm tabular-nums text-muted">
            <span className="text-text font-semibold">{pts(lineup.total)}</span> projected
          </p>
        </div>
        {lineup.moves.length === 0 ? (
          <p className="text-sm text-mine">Your ESPN lineup is already the best one ESPN&apos;s projections allow.</p>
        ) : (
          <>
            <p className="text-sm text-muted">
              {lineup.moves.length === 1 ? "One change" : `${lineup.moves.length} changes`} on ESPN gets you{" "}
              <span className="font-semibold text-mine tabular-nums">+{pts(gain)}</span> projected points.
            </p>
            <ul className="space-y-1 text-sm">
              {starts.map((m) => (
                <li key={m.playerId}>
                  Start <b>{byId.get(m.playerId)?.name}</b> at {SLOT_LABEL[m.to]}
                </li>
              ))}
              {benches.map((m) => (
                <li key={m.playerId} className="text-muted">
                  Bench {byId.get(m.playerId)?.name}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div className="rounded-card border border-line bg-panel">
        <table className="w-full table-fixed text-sm">
          <caption className="sr-only">Your starters on ESPN now, and the recommended ones</caption>
          <colgroup>
            <col className="w-11" />
            <col />
            <col className="w-5" />
            <col />
          </colgroup>
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th scope="col" className="py-2 pl-3 font-normal">
                <span className="sr-only">Slot</span>
              </th>
              <th scope="col" className="py-2 pr-2 font-normal">
                On ESPN now <span className="tabular-nums text-text">{pts(lineup.currentTotal)}</span>
              </th>
              <th scope="col" aria-hidden />
              <th scope="col" className="py-2 pr-3 font-normal">
                Recommended <span className="tabular-nums font-semibold text-text">{pts(lineup.total)}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row, i) => {
              const now = row.now === null ? null : byId.get(row.now);
              const next = row.next === null ? null : byId.get(row.next);
              return (
                <tr key={`${row.key}-${i}`} className={`border-b border-row-line last:border-0 ${row.changed ? "bg-panel2" : ""}`}>
                  <th scope="row" className="py-2 pl-3 text-left align-top text-xs font-normal text-muted">
                    {SLOT_LABEL[row.key]}
                  </th>
                  <td className="py-2 pr-2 align-top">
                    <SlotCell player={now} tone={row.changed ? "out" : "same"} locked={row.locked && !row.changed} />
                  </td>
                  <td className="py-2 text-center align-top text-muted" aria-hidden>
                    {row.changed ? "→" : ""}
                  </td>
                  <td className="py-2 pr-3 align-top">
                    {row.changed ? <SlotCell player={next} tone="in" locked={row.locked} /> : <span className="text-xs text-dim">No change</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <div className="rounded-card border border-line bg-panel">
        <h3 className="px-4 pt-3 text-xs uppercase tracking-wider text-muted">Bench</h3>
        <ul>
          {lineup.bench.map((id) => {
            const p = byId.get(id);
            if (!p) return null;
            return (
              <li key={id} className="flex items-center gap-3 border-b border-row-line px-4 py-2 last:border-0">
                <span className="w-10 shrink-0 text-xs text-muted">BN</span>
                <PlayerCell player={p} changed={moved.has(id)} locked={p.locked} />
                <span className="w-12 text-right text-sm tabular-nums text-muted">{pts(p.points)}</span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}

/** One side of a lineup row: out (on ESPN, leaving), in (recommended, arriving), or unchanged. */
function SlotCell({ player, tone, locked }: { player: ViewPlayer | null | undefined; tone: "same" | "out" | "in"; locked: boolean }) {
  if (!player) return <span className="text-dim">{tone === "in" ? "Nobody available" : "Empty"}</span>;
  const tag = INJURY_TAG[player.injuryStatus];
  const name = tone === "in" ? "font-semibold text-mine" : tone === "out" ? "text-muted line-through decoration-reach/60" : undefined;
  return (
    <span className="block min-w-0">
      <span className="flex items-baseline gap-1.5">
        <span className={`truncate ${name ?? ""}`}>{player.name}</span>
        {tag && <span className={`text-xs font-semibold ${isRuledOut(player.injuryStatus) ? "text-reach-ink" : "text-warn-ink"}`}>{tag}</span>}
      </span>
      <span className="block truncate text-xs text-muted">
        <span className={POS_TEXT[player.pos]}>{player.pos === "DST" ? "D/ST" : player.pos}</span> · {player.team ?? "FA"} ·{" "}
        <span className="tabular-nums text-text">{pts(player.points)}</span>
        {player.points === 0 && player.projected && " · bye or no game"}
        {locked && " · locked"}
      </span>
    </span>
  );
}

function PlayerCell({ player, changed, locked }: { player: ViewPlayer; changed: boolean; locked: boolean }) {
  const tag = INJURY_TAG[player.injuryStatus];
  return (
    <span className="min-w-0 flex-1">
      <span className="block truncate text-sm">
        <span className={changed ? "font-semibold text-mine" : undefined}>{player.name}</span>
        {tag && <span className={`ml-1.5 text-xs font-semibold ${isRuledOut(player.injuryStatus) ? "text-reach-ink" : "text-warn-ink"}`}>{tag}</span>}
      </span>
      <span className="block text-xs text-muted">
        <span className={POS_TEXT[player.pos]}>{player.pos === "DST" ? "D/ST" : player.pos}</span> · {player.team ?? "FA"}
        {player.points === 0 && player.projected && " · bye or no game"}
        {!player.projected && " · no ESPN projection"}
        {locked && " · locked"}
      </span>
    </span>
  );
}
