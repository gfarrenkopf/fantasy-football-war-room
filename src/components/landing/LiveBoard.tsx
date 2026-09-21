"use client";

import { Fragment, useEffect, useMemo, useRef } from "react";
import { dataset } from "@/lib/data";
import { computeTiers, TIER_LABELS, type Tier } from "@/lib/draft/tiers";
import { LATE_POSITIONS, POSITIONS, type LeagueSettings, type Player, type Position } from "@/lib/draft/types";
import { valueTag, valueTagLabel } from "@/lib/draft/value";
import { cx, s } from "./cx";
import type { LiveMock } from "./useLiveMock";

/** Players per column: deep enough that the column still has names left late in a long draft. */
const DEPTH = 64;
/** Chips in the best-available strip. */
const STRIP = 8;
/** Pixels of the room's history kept above the first open player: one struck row, under the tier band. */
const HISTORY = 64;

/**
 * The board, full-bleed behind the entry panel, with a real mock draft moving through it.
 *
 * Same grammar as the war room's own board view — the best-available strip on top, then one column
 * per position ordered by tier and rank, with the position rail, rank badge, Value/Reach verdict
 * and sticky tier bands — because this is the product, not a picture of it. As the room drafts,
 * each column scrolls itself to keep its first open player in view, so the tier bands pin and
 * drain the way they do on draft day.
 *
 * It is aria-hidden: a board that changes every second is noise to a screen reader, and the
 * sections below carry the same claims as text.
 */
export function LiveBoard({ league, mock, reduced }: { league: LeagueSettings; mock: LiveMock; reduced: boolean }) {
  const { columns, tiers } = useMemo(() => {
    const tiers = computeTiers(dataset.players, league);
    const tierOf = (p: Player) => (tiers.get(p.id) ?? 5) as Tier;
    const byPos = new Map<Position, Player[]>(POSITIONS.map((p) => [p, []]));
    for (const p of dataset.players) byPos.get(p.pos)?.push(p);
    // Tier first, then rank — the war room's order (useBoardColumns()), so each tier is one band.
    const columns = POSITIONS.map((pos) => ({
      pos,
      players: (byPos.get(pos) ?? []).sort((a, b) => tierOf(a) - tierOf(b) || a.consensusRank - b.consensusRank).slice(0, DEPTH),
    }));
    return { columns, tiers };
  }, [league]);

  const best = useMemo(
    () =>
      [...dataset.players]
        .sort((a, b) => a.consensusRank - b.consensusRank)
        .filter((p) => !mock.taken.has(p.id) && !LATE_POSITIONS.includes(p.pos))
        .slice(0, STRIP),
    [mock.taken],
  );

  return (
    <div className={s.boardLayer} aria-hidden="true">
      <div className={s.strip}>
        <span className={s.stripLabel}>Best available</span>
        {best.map((p) => (
          <span key={p.id} className={s.chip}>
            <i className={cx("chipPos", p.pos)}>{p.pos}</i>
            {p.name}
            <span className={s.chipRank}>{p.consensusRank}</span>
          </span>
        ))}
      </div>
      <div className={s.board}>
        {columns.map(({ pos, players }) => (
          <Column key={pos} pos={pos} players={players} tiers={tiers} league={league} mock={mock} reduced={reduced} />
        ))}
      </div>
    </div>
  );
}

function Column({
  pos,
  players,
  tiers,
  league,
  mock,
  reduced,
}: {
  pos: Position;
  players: Player[];
  tiers: Map<string, Tier>;
  league: LeagueSettings;
  mock: LiveMock;
  reduced: boolean;
}) {
  const list = useRef<HTMLOListElement>(null);
  const tierOf = (p: Player) => (tiers.get(p.id) ?? 5) as Tier;
  const firstOpen = players.find((p) => !mock.taken.has(p.id))?.id ?? null;

  // Follow the room down the column. Only this column's scroller moves, never the page.
  useEffect(() => {
    const el = list.current;
    if (!el || !firstOpen) return;
    const row = el.querySelector<HTMLElement>(`[data-id="${CSS.escape(firstOpen)}"]`);
    if (!row) return;
    el.scrollTo({ top: Math.max(0, row.offsetTop - HISTORY), behavior: reduced ? "auto" : "smooth" });
  }, [firstOpen, reduced]);

  const left = (t: Tier) => players.filter((p) => tierOf(p) === t && !mock.taken.has(p.id)).length;
  const size = (t: Tier) => players.filter((p) => tierOf(p) === t).length;

  return (
    <section className={s.col}>
      <h3 className={s.colTitle}>
        <span className={cx("dot", pos)} />
        {pos}
      </h3>
      <ol className={s.colList} ref={list}>
        {players.map((p, i) => {
          const tier = tierOf(p);
          const header = i === 0 || tierOf(players[i - 1]) !== tier;
          const taken = mock.taken.get(p.id);
          const tag = valueTag(p, league.valueThreshold);
          const label = valueTagLabel(tag);
          const remaining = header ? left(tier) : 0;
          return (
            <Fragment key={p.id}>
              {/* A sibling of the rows, not inside one, so it can pin to the top of the column. */}
              {header && (
                <li className={cx("tier", remaining === 0 && "tierGone")}>
                  <span>{TIER_LABELS[tier]}</span>
                  <span className={s.tierLeft}>{remaining === 0 ? "gone" : `${remaining} of ${size(tier)} left`}</span>
                </li>
              )}
              <li className={s.cell} data-id={p.id}>
                <div
                  className={cx("card", pos, taken && "taken", taken?.mine && "mine")}
                  /* Capped so the last column doesn't arrive half a minute after the first. */
                  style={{ animationDelay: `${Math.min(i * 22, 620)}ms` }}
                >
                  <span className={s.rank}>{taken?.mine ? "✓" : p.consensusRank}</span>
                  <span className={s.name}>{p.name}</span>
                  <span className={s.meta}>
                    {p.team} · {p.bye}
                  </span>
                  {/* K and D/ST have no verdict; an empty bordered pill would be a box that means nothing. */}
                  {label ? <span className={cx("tag", tag.kind)}>{label}</span> : <span />}
                </div>
              </li>
            </Fragment>
          );
        })}
      </ol>
    </section>
  );
}
