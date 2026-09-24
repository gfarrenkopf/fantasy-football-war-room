"use client";

import type { Position } from "@/lib/draft/types";
import { isRuledOut } from "@/lib/season/lineup";
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
        <h3 className="px-4 pt-3 text-xs uppercase tracking-wider text-muted">Starters</h3>
        <ul>
          {lineup.starters.map((s, i) => {
            const p = s.playerId === null ? null : byId.get(s.playerId);
            return (
              <li key={`${s.key}-${i}`} className="flex items-center gap-3 border-b border-row-line px-4 py-2 last:border-0">
                <span className="w-10 shrink-0 text-xs text-muted">{SLOT_LABEL[s.key]}</span>
                {p ? <PlayerCell player={p} changed={moved.has(p.playerId)} locked={s.locked} /> : <span className="flex-1 text-sm text-dim">Nobody available</span>}
                <span className="w-12 text-right text-sm tabular-nums">{p ? pts(p.points) : "–"}</span>
              </li>
            );
          })}
        </ul>
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
