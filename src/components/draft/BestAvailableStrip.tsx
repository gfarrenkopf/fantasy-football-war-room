"use client";

import { LATE_POSITIONS } from "@/lib/draft/types";
import { POS_COLOR } from "./Board";
import { s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraftActions } from "./useDraftActions";

/** Top 9 available skill players by consensus, as one-click chips. Ported from the prototype's #strip. */
export function BestAvailableStrip() {
  const model = useModel();
  const { draftWithIntent, intentFrom, draft } = useDraftActions();
  const best = model.ctx.byConsensus.filter((p) => !model.taken.has(p.id) && !LATE_POSITIONS.includes(p.pos)).slice(0, 9);

  return (
    <div className={s.strip}>
      <span className={s.stripLabel}>Best available (ECR), click to log the pick:</span>
      {best.map((p) => {
        const clash = model.byeClashFor(p);
        return (
          <button
            key={p.id}
            className={s.chip}
            data-player-id={p.id}
            onClick={(e) => void draftWithIntent(p.id, intentFrom(e))}
            onContextMenu={(e) => {
              e.preventDefault();
              void draft(p.id, false);
            }}
            title={`${p.name} — click: log for whoever is on the clock; Cmd/Ctrl-click or right-click: another team; Shift-click: yours${
              clash ? `. ⚠ ${clash.n} starters out week ${p.bye} (with ${clash.who.join(", ")})` : ""
            }`}
          >
            <i style={{ background: POS_COLOR[p.pos] }}>{p.pos}</i>
            {p.name}
            <span className={s.chipRanks}>
              {p.consensusRank}/{p.adp}
            </span>
            {clash && <span className={s.chipWarn}>⚠</span>}
          </button>
        );
      })}
    </div>
  );
}
