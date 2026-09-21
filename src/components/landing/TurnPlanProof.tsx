"use client";

import { dataset } from "@/lib/data";
import type { PlanEntry } from "@/lib/draft/sim";
import { formatRoundPick } from "@/lib/draft/snake";
import type { LeagueSettings } from "@/lib/draft/types";
import { cx, s } from "./cx";
import { PLAN_MOCKS, type FirstTurnPlan } from "./useFirstTurnPlan";

/**
 * The mechanism, stated as a question and answered with real numbers.
 *
 * The plan comes from the war room's own Monte Carlo worker, run over the hero board's own draft
 * at the instant after the visitor's first pick. Nothing here is written by hand: if the numbers
 * look good it is because the simulator says so.
 */
export function TurnPlanProof({ league, first }: { league: LeagueSettings; first: FirstTurnPlan }) {
  const { picks, plan, elapsedMs } = first;
  const mine = picks.length ? dataset.players.find((p) => p.id === picks[picks.length - 1]?.playerId) : null;

  return (
    <section className={s.proof} aria-labelledby="proof-title">
      <div className={s.proofHead}>
        <h2 id="proof-title" className={s.proofTitle}>
          Every draft tool tells you who&apos;s available. This one tells you who&apos;ll <em>still be there</em>.
        </h2>
        <p className={s.sub}>
          You took {mine ? <b>{mine.name}</b> : "your first pick"} at pick {league.mySlot}
          {plan && (
            <>
              . Your next turn is pick {plan.picks[0]} ({formatRoundPick(plan.picks[0], league.teams)})
              {plan.picks.length > 1 && `, then ${plan.picks[1]} right after`}
            </>
          )}
          . Here is what {PLAN_MOCKS} mock drafts of <em>your</em> league say about the wait.
        </p>
      </div>

      {!plan ? (
        <p className={s.pending}>Running {PLAN_MOCKS} mock drafts…</p>
      ) : (
        <div className={s.planGrid}>
          <PlanGroup title="Plan on these" note="60% or better" entries={plan.targets} kind="target" />
          <PlanGroup title="If they're gone" note="30% or better" entries={plan.fallbacks} kind="fallback" />
          <PlanGroup title="Don't count on it" note="under 30%" entries={plan.letGo} kind="letgo" />
        </div>
      )}
      <p className={s.provenance}>
        {plan && elapsedMs !== null ? `${PLAN_MOCKS} simulated drafts, computed in your browser in ${elapsedMs}ms. ` : ""}
        Odds are odds — {dataset.label}.
      </p>
    </section>
  );
}

function PlanGroup({ title, note, entries, kind }: { title: string; note: string; entries: PlanEntry[]; kind: string }) {
  return (
    <div className={cx("planCol", kind)}>
      <h3 className={s.planTitle}>
        {title}
        <span>{note}</span>
      </h3>
      {entries.length === 0 ? (
        <p className={s.planEmpty}>Nothing in this band for your slot.</p>
      ) : (
        <ul className={s.planList}>
          {entries.map((e) => (
            <li key={e.player.id} className={cx("planRow", e.player.pos)}>
              <span className={s.planName}>{e.player.name}</span>
              <span className={s.planMeta}>
                {e.player.pos} · {e.player.team}
              </span>
              <span className={s.odds}>
                <span className={s.oddsNum}>{Math.round(e.survival * 100)}</span>
                <span className={s.oddsPct}>%</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
