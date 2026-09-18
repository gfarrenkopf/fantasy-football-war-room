"use client";

import { Fragment, useMemo } from "react";
import { TIER_LABELS, type Tier } from "@/lib/draft/tiers";
import type { Player, Position } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { PlayerCard } from "./PlayerCard";
import { ByePanel, RosterPanel } from "./RosterPanels";
import { PHONE, useMediaQuery } from "./useMediaQuery";

export const POS_COLOR: Record<Position, string> = {
  QB: "var(--color-qb)",
  RB: "var(--color-rb)",
  WR: "var(--color-wr)",
  TE: "var(--color-te)",
  K: "var(--color-k)",
  DST: "var(--color-dst)",
};

type ColumnKey = "QB" | "RB" | "WR" | "TE" | "KDST";
const COLUMNS: { key: ColumnKey; label: string; positions: Position[]; compact: boolean }[] = [
  { key: "QB", label: "QB", positions: ["QB"], compact: true },
  { key: "RB", label: "RB", positions: ["RB"], compact: false },
  { key: "WR", label: "WR", positions: ["WR"], compact: false },
  { key: "TE", label: "TE", positions: ["TE"], compact: true },
  { key: "KDST", label: "K and D/ST", positions: ["K", "DST"], compact: true },
];

export const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

export const matchesQuery = (p: Player, q: string) => !q || p.name.toLowerCase().includes(q) || p.team.toLowerCase() === q;

/** Board columns in display order (tier, then consensus rank). Also used to pick the top search hit. */
export function useBoardColumns() {
  const { dataset, tiers } = useModel();
  return useMemo(
    () =>
      COLUMNS.map((col) => ({
        ...col,
        players: dataset.players
          .filter((p) => col.positions.includes(p.pos))
          .sort((a, b) => (tiers.get(a.id) ?? 5) - (tiers.get(b.id) ?? 5) || a.consensusRank - b.consensusRank),
      })),
    [dataset, tiers],
  );
}

/**
 * The Board view: one column per position with tier headers, plus roster and byes. On a phone a
 * search replaces the carousel with one list of matches, since filtering the pages in place left
 * the hits two swipes away behind empty columns.
 */
export function Board({ query, hitId, onClearQuery }: { query: string; hitId: string | null; onClearQuery(): void }) {
  const model = useModel();
  const columns = useBoardColumns();
  const phone = useMediaQuery(PHONE);
  const { rounds } = model.ctx;

  if (phone && query) return <SearchResults query={query} hitId={hitId} onPicked={onClearQuery} />;

  return (
    <div className={s.board}>
      {columns.map((col) => {
        const left = col.players.filter((p) => !model.taken.has(p.id)).length;
        const mine = col.players.filter((p) => model.taken.get(p.id)?.mine).length;
        const visible = col.players.filter((p) => matchesQuery(p, query));
        return (
          <section key={col.key} className={cx("col", col.compact && "compact")} aria-label={`${col.label} column`}>
            <h2 className={s.colTitle}>
              <span className={s.dot} style={{ background: POS_COLOR[col.positions[0]] }} />
              {col.label}
              <span className={s.mineCount}>{mine ? `${mine} mine` : ""}</span>
              <span className={s.leftCount}>{left} left</span>
            </h2>
            <div className={s.scroll}>
              {col.key === "KDST" ? (
                <>
                  <GroupHeader title="D/ST" meta={`draft rounds ${rounds - 2}–${rounds - 1}`} />
                  {visible.filter((p) => p.pos === "DST").map((p) => (
                    <PlayerCard key={p.id} player={p} hit={p.id === hitId} />
                  ))}
                  <GroupHeader title="Kickers" meta="last two rounds" />
                  {visible.filter((p) => p.pos === "K").map((p) => (
                    <PlayerCard key={p.id} player={p} hit={p.id === hitId} />
                  ))}
                </>
              ) : (
                <TieredList players={visible} allPlayers={col.players} hitId={hitId} />
              )}
            </div>
          </section>
        );
      })}
      <aside className={s.side}>
        <RosterPanel />
        <ByePanel />
      </aside>
    </div>
  );
}

/** Every player matching the search, available first, each by consensus rank. */
function SearchResults({ query, hitId, onPicked }: { query: string; hitId: string | null; onPicked(): void }) {
  const { ctx, taken } = useModel();
  const matches = ctx.byConsensus.filter((p) => matchesQuery(p, query));
  // Available first; `sort` is stable, so each group keeps its consensus order.
  matches.sort((a, b) => Number(taken.has(a.id)) - Number(taken.has(b.id)));

  return (
    <section className={cx("panel", "results")} aria-label="Search results">
      <h2 className={s.panelTitle}>
        {matches.length ? `${matches.length} ${matches.length === 1 ? "match" : "matches"}` : "No players match"}
      </h2>
      {/* A card handles its tap first (draft, ✕, or put back); after that the search has done its job. */}
      <div className={s.scroll} onClick={(e) => (e.target as HTMLElement).closest("[data-player-id]") && onPicked()}>
        {matches.map((p) => (
          <PlayerCard key={p.id} player={p} hit={p.id === hitId} />
        ))}
      </div>
    </section>
  );
}

function GroupHeader({ title, meta }: { title: string; meta: string }) {
  return (
    <div className={s.tier}>
      <b>{title}</b>
      <span className={s.tierMeta}>{meta}</span>
    </div>
  );
}

function TieredList({ players, allPlayers, hitId }: { players: Player[]; allPlayers: Player[]; hitId: string | null }) {
  const { tiers } = useModel();
  const tierOf = (p: Player) => (tiers.get(p.id) ?? 5) as Tier;
  return (
    <>
      {players.map((p, i) => {
        const t = tierOf(p);
        const header = i === 0 || tierOf(players[i - 1]) !== t;
        return (
          <Fragment key={p.id}>
            {header && <GroupHeader title={TIER_LABELS[t]} meta={plural(allPlayers.filter((x) => tierOf(x) === t).length, "player")} />}
            <PlayerCard player={p} hit={p.id === hitId} />
          </Fragment>
        );
      })}
    </>
  );
}
