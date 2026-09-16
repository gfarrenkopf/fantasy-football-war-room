"use client";

import { useMemo } from "react";
import { computeTurnPlan, type PlanEntry, type TurnPlan } from "@/lib/draft/sim";
import { POS_COLOR } from "./Board";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import type { PlanOdds } from "./FocusView";

/** A plan entry's odds of surviving to its turn, as a percentage. */
export const pct = (e: PlanEntry) => `${Math.round(e.survival * 100)}%`;

/**
 * The algorithmic turn plan for every remaining turn, from the live mock-draft odds. Shown in the
 * plan drawer's Live odds tab, and in the AI tab whenever the AI plan can't be (APE-102).
 */
export function LiveTurnPlans({ planOdds }: { planOdds: PlanOdds | null }) {
  const model = useModel();
  const plans: TurnPlan[] = useMemo(
    () => (planOdds ? planOdds.result.turns.map((_, i) => computeTurnPlan(planOdds.picks, planOdds.result, model.ctx, i)).filter((p): p is TurnPlan => !!p) : []),
    [planOdds, model.ctx],
  );

  const name = (e: PlanEntry) => {
    const tk = model.taken.get(e.player.id);
    return (
      <span key={e.player.id} style={{ color: POS_COLOR[e.player.pos] }}>
        {tk ? <span className={s.struck}>{e.player.name}</span> : e.player.name}
        {tk?.mine ? " ✓" : ""} <span className={s.lbl}>({pct(e)})</span>
      </span>
    );
  };
  const list = (entries: PlanEntry[]) => entries.map((e, i) => [i > 0 && ", ", name(e)]);

  return (
    <>
      {!planOdds && <p>Estimating…</p>}
      {plans.map((pl, i) => (
        <section key={pl.picks[0]} className={cx("planSection", i === 0 && "now")}>
          <h4>
            Pick{pl.picks.length > 1 ? "s" : ""} {pl.picks.join(" & ")}
          </h4>
          <ul>
            <li>
              <b>Targets:</b> {pl.targets.length ? list(pl.targets) : "—"}
            </li>
            {pl.fallbacks.length > 0 && (
              <li>
                <b>Fallbacks:</b> {list(pl.fallbacks)}
              </li>
            )}
            {pl.letGo.length > 0 && (
              <li>
                <b>Let go:</b> {list(pl.letGo)}
              </li>
            )}
          </ul>
        </section>
      ))}
    </>
  );
}
