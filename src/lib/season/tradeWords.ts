import { tradeEmphasis, type Emphasis } from "./emphasis";
import type { TradeVerdict } from "./trade";

/** A trade's verdict in words, as the Trades tab tells it on the web and in the app (19.6). */

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

/** How the trade lands for the user, in words, on the gain ladder's steps. */
export function tradeHeadline(verdict: TradeVerdict) {
  const you = verdict.a.perWeek;
  const level = tradeEmphasis(you);
  const headline = you >= 0 ? GOOD[level] : BAD[level];
  return level !== "rest" && you > 0 && verdict.b.perWeek > 0.05 ? `${headline}, and for them` : headline;
}
