import { and, count, countDistinct, desc, gte, lt, max, sql, sum } from "drizzle-orm";
import { aiGenerations } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/**
 * What AI plans cost over a date range, from the `ai_generations` log (APE-103). The number that
 * matters for pricing is `avgUsdPerLeague`: everything spent on a league's plans (retries,
 * regenerations and failures included) against what one league pays. Printed by `npm run ai:costs`.
 */

export interface ModelCosts {
  provider: string;
  model: string;
  generations: number;
  totalUsd: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  maxOutputTokens: number;
}

export interface CostReport {
  from: Date;
  to: Date;
  /** Model calls, whatever their outcome. */
  generations: number;
  /** Leagues with at least one call. */
  leagues: number;
  totalUsd: number;
  avgUsdPerLeague: number | null;
  avgUsdPerGeneration: number | null;
  /** Calls without a price (unknown model, or no usage reported); not in the totals. */
  unpriced: number;
  /** Calls by outcome: ready, superseded, or a failure kind. */
  outcomes: Record<string, number>;
  models: ModelCosts[];
}

const num = (value: unknown) => Number(value ?? 0);

/** Costs for generations logged from `from` (inclusive) up to `to` (exclusive). */
export async function costReport(db: Db, { from, to }: { from: Date; to: Date }): Promise<CostReport> {
  const inRange = and(gte(aiGenerations.createdAt, from), lt(aiGenerations.createdAt, to));

  const [totals] = await db
    .select({
      generations: count(),
      leagues: countDistinct(aiGenerations.leagueId),
      totalUsd: sum(aiGenerations.costUsd),
      unpriced: sql<number>`count(*) filter (where ${aiGenerations.costUsd} is null)`,
    })
    .from(aiGenerations)
    .where(inRange);

  const outcomeRows = await db
    .select({ outcome: aiGenerations.outcome, n: count() })
    .from(aiGenerations)
    .where(inRange)
    .groupBy(aiGenerations.outcome);

  const modelRows = await db
    .select({
      provider: aiGenerations.provider,
      model: aiGenerations.model,
      generations: count(),
      totalUsd: sum(aiGenerations.costUsd),
      avgInputTokens: sql<number>`avg(${aiGenerations.inputTokens})`,
      avgOutputTokens: sql<number>`avg(${aiGenerations.outputTokens})`,
      maxOutputTokens: max(aiGenerations.outputTokens),
    })
    .from(aiGenerations)
    .where(inRange)
    .groupBy(aiGenerations.provider, aiGenerations.model)
    .orderBy(desc(count()));

  const generations = num(totals.generations);
  const leagues = num(totals.leagues);
  const totalUsd = num(totals.totalUsd);
  return {
    from,
    to,
    generations,
    leagues,
    totalUsd,
    avgUsdPerLeague: leagues ? totalUsd / leagues : null,
    avgUsdPerGeneration: generations ? totalUsd / generations : null,
    unpriced: num(totals.unpriced),
    outcomes: Object.fromEntries(outcomeRows.map((row) => [row.outcome, num(row.n)])),
    models: modelRows.map((row) => ({
      provider: row.provider,
      model: row.model,
      generations: num(row.generations),
      totalUsd: num(row.totalUsd),
      avgInputTokens: Math.round(num(row.avgInputTokens)),
      avgOutputTokens: Math.round(num(row.avgOutputTokens)),
      maxOutputTokens: num(row.maxOutputTokens),
    })),
  };
}
