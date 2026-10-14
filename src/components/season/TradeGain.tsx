import { tradeEmphasis } from "@/lib/season/emphasis";
import type { TradeVerdict } from "@/lib/season/trade";
import { tradeHeadline } from "@/lib/season/tradeWords";
import type { SeasonView } from "@/lib/season/view";
import { Gain, signed } from "./parts";

/** A trade's verdict as the Trades tab tells it: in the builder, on offers from ESPN, and on trade ideas. */

export const teamName = (view: SeasonView, id: number) => view.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

/** The verdict for the user, told on the same scale as the lineup's gain. */
export function TradeGain({ verdict, partner, compact, inline }: { verdict: TradeVerdict; partner: string; compact?: boolean; inline?: boolean }) {
  const you = verdict.a.perWeek;
  const them = verdict.b.perWeek;
  return (
    <Gain
      compact={compact}
      inline={inline}
      level={tradeEmphasis(you)}
      value={you}
      unit="a week"
      headline={tradeHeadline(verdict)}
      detail={
        <>
          {partner} <span className="tabular-nums">{signed(them)}</span> a week · you <span className="tabular-nums">{signed(verdict.a.delta)}</span> over the{" "}
          {verdict.weeks} weeks left
        </>
      }
    />
  );
}
