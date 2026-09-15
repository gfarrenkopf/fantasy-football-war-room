import { LATE_POSITIONS, type Player } from "./types";

export type ValueTagKind = "value" | "reach" | "even" | "na";

export interface ValueTag {
  kind: ValueTagKind;
  /**
   * adp - consensusRank. Positive means the platform drafts the player later than
   * experts rank him (a Value); negative means earlier (a Reach risk).
   */
  delta: number;
}

export const DEFAULT_VALUE_THRESHOLD = 10;

/**
 * Compares platform ADP with expert consensus, ported from the prototype's tagFor().
 * K and D/ST get "na": their ranks are too noisy for the comparison to mean anything.
 */
export function valueTag(
  player: Pick<Player, "pos" | "adp" | "consensusRank">,
  threshold = DEFAULT_VALUE_THRESHOLD,
): ValueTag {
  const delta = player.adp - player.consensusRank;
  if (LATE_POSITIONS.includes(player.pos)) return { kind: "na", delta };
  if (delta >= threshold) return { kind: "value", delta };
  if (delta <= -threshold) return { kind: "reach", delta };
  return { kind: "even", delta };
}

/** Card label, matching the prototype: "+46 Value", "-18 Reach Risk", "+3", "0". Empty for "na". */
export function valueTagLabel(tag: ValueTag): string {
  const signed = `${tag.delta > 0 ? "+" : ""}${tag.delta}`;
  switch (tag.kind) {
    case "value":
      return `${signed} Value`;
    case "reach":
      return `${signed} Reach Risk`;
    case "even":
      return signed;
    case "na":
      return "";
  }
}
