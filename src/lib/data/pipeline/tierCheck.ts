import { computeTiers, LATE_TIER, type Tier } from "@/lib/draft/tiers";
import { LATE_POSITIONS, type Dataset, type LeagueSettings } from "@/lib/draft/types";
import { valueTag, type ValueTagKind } from "@/lib/draft/value";
import { LEAGUE_PRESETS } from "../presets";
import { ranksMatchAdp } from "./ranks";
import type { Finding } from "./qa";

/**
 * Tier and Value/Reach validation (2.3).
 *
 * This is a data-quality check, not a precomputation step. Tiers are league-dependent
 * — `computeTiers` cuts off at `teams × round(rounds × 10/16)` — so there is no single
 * canonical tiering to store, and the UI already memoizes per league. What's worth doing
 * at ingestion is proving the tiering logic produces a sane board for every preset, and
 * catching the one failure mode that would silently gut the product: `consensusRank`
 * collapsing into `adp`, which makes every player "even".
 */

export interface PresetSummary {
  preset: string;
  teams: number;
  /** Players per tier, index 0 = tier 1. */
  tierCounts: number[];
  /** Share of comparable (non-K/DST) players per tag. */
  tagShares: Record<ValueTagKind, number>;
}

export interface TierCheckReport {
  presets: PresetSummary[];
  findings: Finding[];
  ok: boolean;
}

/** Above this share of "even" tags, the two rank columns have effectively merged. */
const DEGENERATE_EVEN_SHARE = 0.9;

/**
 * Above this share of any single tag, the board is useless in the other direction.
 * A run that calls 92% of players "Value" is not finding value, it's mis-scaled: the
 * usual cause is `adp` arriving as a raw average draft position measured over a much
 * larger player pool than `consensusRank` covers. See normalize.ts.
 */
const DEGENERATE_TAG_SHARE = 0.6;

function summarize(dataset: Dataset, league: LeagueSettings, label: string): PresetSummary {
  const tiers = computeTiers(dataset.players, league);
  const tierCounts = [0, 0, 0, 0, 0];
  for (const p of dataset.players) tierCounts[(tiers.get(p.id) ?? LATE_TIER) - 1]++;

  const comparable = dataset.players.filter((p) => !LATE_POSITIONS.includes(p.pos));
  const counts: Record<ValueTagKind, number> = { value: 0, reach: 0, even: 0, na: 0 };
  for (const p of comparable) counts[valueTag(p, league.valueThreshold).kind]++;
  const tagShares = Object.fromEntries(
    Object.entries(counts).map(([k, n]) => [k, comparable.length ? n / comparable.length : 0]),
  ) as Record<ValueTagKind, number>;

  return { preset: label, teams: league.teams, tierCounts, tagShares };
}

export function checkTiers(dataset: Dataset): TierCheckReport {
  const findings: Finding[] = [];
  const add = (severity: Finding["severity"], message: string) => findings.push({ severity, check: "tier-value", message });

  const presets = LEAGUE_PRESETS.map((p) => summarize(dataset, { ...p.league, scoring: dataset.scoring[0] }, p.label));

  for (const s of presets) {
    // Every real tier should have somebody in it; an empty tier 1 means natural breaks
    // had nothing to work with.
    const emptyReal = s.tierCounts.slice(0, 4).findIndex((n) => n === 0);
    if (emptyReal >= 0) add("failure", `${s.preset}: tier ${emptyReal + 1} is empty`);

    if (s.tagShares.even > DEGENERATE_EVEN_SHARE) {
      add(
        "failure",
        `${s.preset}: ${Math.round(s.tagShares.even * 100)}% of players tagged "even" — consensusRank and adp have collapsed into the same signal, so Value/Reach is dead`,
      );
    }

    for (const tag of ["value", "reach"] as const) {
      if (s.tagShares[tag] > DEGENERATE_TAG_SHARE) {
        add(
          "failure",
          `${s.preset}: ${Math.round(s.tagShares[tag] * 100)}% of players tagged "${tag}" — adp and consensusRank are probably on different scales (see normalize.ts)`,
        );
      }
    }
  }

  if (ranksMatchAdp(dataset.players)) {
    add("failure", "consensusRank is a copy of adp for almost every player — see pipeline/ranks.ts");
  }

  return { presets, findings, ok: !findings.some((f) => f.severity === "failure") };
}

/** Board-order spot check: the top N players by consensus rank, for eyeballing a run. */
export function topBoard(dataset: Dataset, n = 20): string[] {
  return dataset.players
    .slice()
    .sort((a, b) => a.consensusRank - b.consensusRank)
    .slice(0, n)
    .map((p, i) => `${String(i + 1).padStart(2)}. ${p.name} (${p.pos} ${p.team}) adp=${p.adp} proj=${p.projPoints ?? "—"}`);
}

export type { Tier };
