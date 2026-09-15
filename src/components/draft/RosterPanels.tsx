"use client";

import { byeRelevantStarters, byeWeekList, myPlayers, positionCounts, starterByeCounts } from "@/lib/draft/roster";
import { POSITIONS, type Position } from "@/lib/draft/types";
import { useDraft } from "./DraftProvider";
import { useModel } from "./DraftModel";
import { cx, s } from "./cx";
import { posLabel } from "./PlayerCard";

/** Roster count chips + slot rows with bye-conflict badges. Ported from renderRoster(). */
export function RosterPanel() {
  const { state } = useDraft();
  const model = useModel();
  const mine = myPlayers(state.picks, model.player);
  const counts = positionCounts(mine);
  const { rules } = model.ctx;

  // Chip thresholds from the roster rules: red below the starters needed, grey at the ideal count.
  const ideal = (pos: Position) => (pos === "RB" || pos === "WR" ? rules[pos].soft - 1 : rules[pos].cap);

  return (
    <div className={cx("panel", "panelGrow")}>
      <h3 className={s.panelTitle}>
        My roster{" "}
        <span>
          {mine.length} / {model.ctx.rounds}
        </span>
      </h3>
      <div className={s.counts}>
        {POSITIONS.filter((pos) => rules[pos].need > 0 || counts[pos] > 0).map((pos) => {
          const min = rules[pos].need;
          const max = Math.max(min, ideal(pos));
          const cls = counts[pos] < min ? "need" : counts[pos] >= max ? "full" : "ok";
          return (
            <span key={pos} className={cx("cnt", cls)}>
              {posLabel(pos)} <b>{counts[pos]}</b>/{min}
              {max > min ? `–${max}` : ""}
            </span>
          );
        })}
      </div>
      <div className={s.scroll}>
        {model.slots.map(({ slot, player: p }, i) => {
          const conf = p ? model.conflicts.get(p.id) : undefined;
          return (
            <div key={i} className={cx("row", !!conf && "conflict", (conf?.n ?? 0) >= 3 && "conflict3")} data-player-id={p?.id}>
              <div className={cx("sl", slot.key)}>{slot.key === "DST" ? "D/ST" : slot.key === "SUPERFLEX" ? "SFLX" : slot.key}</div>
              <div className={s.who}>
                {p ? (
                  <>
                    <div className={s.n}>
                      <span>{p.name}</span>
                      {conf && (
                        <span className={cx("badge", conf.n >= 3 && "red")} title={`Week ${p.bye}: ${conf.n} starters out — ${conf.who.join(", ")}`}>
                          ⚠ {conf.n} out wk {p.bye}
                        </span>
                      )}
                    </div>
                    <div className={s.m}>
                      {p.pos} {p.posRank}, {p.team}, bye {p.bye}
                    </div>
                  </>
                ) : (
                  <span className={s.empty}>open</span>
                )}
              </div>
              <div className={s.pk}>{p ? `#${p.pickNo}` : ""}</div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/** Starters out per bye week, with a summary footer. Ported from renderRoster(). */
export function ByePanel() {
  const model = useModel();
  const weeks = byeWeekList(model.dataset.byeWeeks);
  const counts = starterByeCounts(model.slots, weeks);
  const starters = byeRelevantStarters(model.slots);
  const gaps = weeks.length ? Array.from({ length: weeks.at(-1)! - weeks[0] + 1 }, (_, i) => weeks[0] + i).filter((w) => !weeks.includes(w)) : [];

  const stacked = counts.filter((c) => c.n >= 2).map((c) => `wk ${c.week} (${c.n})`);
  const flexIds = new Set(model.slots.filter((x) => x.slot.eligible.length > 1 && x.player).map((x) => x.player!.id));
  const hot = [...new Set(starters.filter((p) => p.pos !== "QB").map((p) => `${flexIds.has(p.id) ? `${p.pos}/FLEX` : p.pos} wk ${p.bye}`))].join(", ");
  const foot = !starters.length
    ? "Draft a starter to populate. A card whose bye would put 2+ starters out the same week gets an amber ⚠ chip (red at 3+)."
    : `${stacked.length ? `Stacked weeks: ${stacked.join(", ")}. ` : "No two starters share a bye. "}${hot ? `Starter byes: ${hot}.` : ""}`;

  return (
    <div className={s.panel}>
      <h3 className={s.panelTitle}>
        Starter byes{" "}
        <span>
          {weeks.length ? `weeks ${weeks[0]}–${weeks.at(-1)}` : ""}
          {gaps.length ? `, no byes wk ${gaps.join(", ")}` : ""}
        </span>
      </h3>
      <div className={s.byes} style={{ "--weeks": weeks.length } as React.CSSProperties}>
        {counts.map(({ week, n }) => (
          <div key={week} className={cx("bw", n >= 2 ? "two" : n === 1 && "one")}>
            wk {week}
            <b>{n || "–"}</b>
          </div>
        ))}
      </div>
      <div className={s.foot}>{foot}</div>
    </div>
  );
}
