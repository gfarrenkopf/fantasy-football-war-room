import { tradeEmphasis, type Emphasis } from "@/lib/season/emphasis";
import type { TradeVerdict } from "@/lib/season/trade";
import type { SeasonView } from "@/lib/season/view";
import { Gain, signed } from "./parts";

/** A trade's verdict as the Trades tab tells it: in the builder, on offers from ESPN, and on trade ideas. */

const GOOD: Record<Emphasis, string> = {
  rest: "About even for you",
  trim: "Slightly better for you",
  gain: "Better for you",
  swing: "A strong trade for you",
  must: "A steal for you",
};
const BAD: Record<Emphasis, string> = {
  rest: "About even for you",
  trim: "Slightly worse for you",
  gain: "Costs you",
  swing: "Costs you a lot",
  must: "Lopsided against you",
};

export const teamName = (view: SeasonView, id: number) => view.teams.find((t) => t.id === id)?.name ?? `Team ${id}`;

/** How the trade lands for the user, in words, on the gain ladder's steps. */
export function tradeHeadline(verdict: TradeVerdict) {
  const you = verdict.a.perWeek;
  const level = tradeEmphasis(you);
  const headline = you >= 0 ? GOOD[level] : BAD[level];
  return level !== "rest" && you > 0 && verdict.b.perWeek > 0.05 ? `${headline}, and for them` : headline;
}

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
