"use client";

import { useMemo } from "react";
import { dataset } from "@/lib/data";
import { computeTiers, TIER_LABELS, type Tier } from "@/lib/draft/tiers";
import { POSITIONS, type LeagueSettings, type Player, type Position } from "@/lib/draft/types";
import { valueTag, valueTagLabel } from "@/lib/draft/value";
import { cx, s } from "./cx";
import type { LiveMock } from "./useLiveMock";

/** Players per column. Enough that the column still has depth once a few rounds are gone. */
const DEPTH = 26;

/**
 * The board, full-bleed behind the entry panel, with a real mock draft moving through it.
 *
 * Same grammar as the war room's own board — position rail, rank badge, tier bands, Value/Reach
 * verdict — because this is the product, not a picture of it. It is aria-hidden: a board that
 * changes every 1.4s is noise to a screen reader, and the sections below carry the same claims
 * as text.
 */
export function LiveBoard({ league, mock }: { league: LeagueSettings; mock: LiveMock }) {
  const columns = useMemo(() => {
    const tiers = computeTiers(dataset.players, league);
    const byPos = new Map<Position, Player[]>(POSITIONS.map((p) => [p, []]));
    for (const p of [...dataset.players].sort((a, b) => a.consensusRank - b.consensusRank)) {
      const list = byPos.get(p.pos);
      if (list && list.length < DEPTH) list.push(p);
    }
    return POSITIONS.map((pos) => ({ pos, players: byPos.get(pos) ?? [], tiers }));
  }, [league]);

  return (
    <div className={s.board} aria-hidden="true">
      {columns.map(({ pos, players, tiers }) => (
        <section key={pos} className={s.col}>
          <h3 className={s.colTitle}>
            <span className={cx("dot", pos)} />
            {pos}
          </h3>
          <ol className={s.colList}>
            {players.map((p, i) => {
              const tier = tiers.get(p.id) ?? (5 as Tier);
              const prev = i > 0 ? (tiers.get(players[i - 1].id) ?? 5) : null;
              const taken = mock.taken.get(p.id);
              const tag = valueTag(p, league.valueThreshold);
              const label = valueTagLabel(tag);
              return (
                <li key={p.id} className={s.cell}>
                  {tier !== prev && <div className={s.tier}>{TIER_LABELS[tier]}</div>}
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
              );
            })}
          </ol>
        </section>
      ))}
    </div>
  );
}
