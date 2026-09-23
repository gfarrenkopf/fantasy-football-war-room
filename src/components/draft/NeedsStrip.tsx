"use client";

import { rosterNeeds } from "@/lib/draft/roster";
import { roundOf } from "@/lib/draft/snake";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";

/** Starter dots (filled when the slot is filled) plus small bench dots; open slots amber, pulsing when urgent. Ported from renderNeeds(). */
export function NeedsStrip() {
  const model = useModel();
  const round = Math.min(model.ctx.rounds, roundOf(Math.min(model.current, model.total), model.league.teams));
  const needs = rosterNeeds(model.slots, round, model.ctx.rounds);

  return (
    <div className={cx("needs", needs.allStartersFilled && "done")} aria-label="Roster needs">
      {needs.groups.map((g) => (
        <span
          key={g.key}
          className={cx("np", g.open && "open", g.urgent && "urgent")}
          title={`${g.label}: ${g.filled.filter(Boolean).length} of ${g.filled.length} starter slot${g.filled.length > 1 ? "s" : ""} filled${
            g.benchCount ? `, ${g.benchCount} on the bench` : ""
          }`}
        >
          <b>{g.label}</b>
          {g.filled.map((f, i) => (
            <i key={i} className={cx(f && "f")} />
          ))}
          {g.benchCount > 0 && (
            <>
              <span className={s.gap} />
              {Array.from({ length: g.benchCount }, (_, i) => (
                <i key={`b${i}`} className={s.b} />
              ))}
            </>
          )}
        </span>
      ))}
      <span className={s.np} title="Bench: large dots are starters, small dots are bench players at that position">
        <b>BN</b>
        {needs.bench.filled}/{needs.bench.total}
      </span>
      <span className={s.nxt}>
        {needs.allStartersFilled
          ? "Starters set"
          : needs.need.length
            ? `Need: ${needs.need.join(", ")}`
            : "Starters set for now"}
      </span>
    </div>
  );
}
