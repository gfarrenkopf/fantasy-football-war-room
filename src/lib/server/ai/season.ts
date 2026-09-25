import "server-only";
import type { PlanModel } from "@/lib/ai/provider";
import { SEASON_NEEDS_PURCHASE, type SeasonAiAccessView, type SeasonAiState } from "@/lib/ai/season/state";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import type { SeasonView } from "@/lib/season/view";
import { mayUseSeason } from "@/lib/server/espn/seasonAccess";
import { loadSeasonView } from "@/lib/server/espn/seasonView";
import { error, json } from "@/lib/server/http";
import { findLeague } from "@/lib/server/leagues";
import { startTrial, TRIAL_WEEKS, usedSeasonAi, type SeasonAiAccess } from "@/lib/server/seasonAi";
import { findAiLineups } from "@/lib/server/seasonAiOutputs";
import { getPlanModel, seasonAiAccess } from ".";

/** In-season AI for the season page and its routes (11.2), with the configuration filled in. */

interface Who {
  userId: string;
  email: string | null;
}

function accessView(access: Exclude<SeasonAiAccess, { kind: "not-allowed" }>): SeasonAiAccessView {
  if (access.kind === "needs-purchase") return { kind: "needs-purchase" };
  return access.via === "trial" ? { kind: "trial", trialWeek: access.trialWeek, trialWeeks: TRIAL_WEEKS } : { kind: "allowed" };
}

/** What the season page shows of in-season AI, or null when it's off or not for this account. */
export async function seasonAiState(db: Db, who: Who, league: { id: string; season: number }, view: SeasonView): Promise<SeasonAiState | null> {
  if (!getPlanModel()) return null;
  const access = await seasonAiAccess(db, { ...who, leagueId: league.id, leagueSeason: league.season, season: view.season, week: view.currentWeek });
  if (access.kind === "not-allowed") return null;
  const [lineups, used] = await Promise.all([findAiLineups(db, league.id, view.season, view.currentWeek), usedSeasonAi(db, league.id, view.season, view.currentWeek)]);
  return { access: accessView(access), lineups, midweekUsed: used.includes("lineup-midweek") };
}

export interface SeasonAiRequest {
  model: PlanModel;
  view: SeasonView;
  access: Extract<SeasonAiAccess, { kind: "allowed" }>;
  /** Starts the account's trial, if this request is its first AI use. Call it once something was written. */
  began(): Promise<void>;
}

/**
 * Everything an in-season AI route checks before it asks the model, or the response to send instead:
 * 404 when in-season AI is off or the league isn't the user's, 403 for accounts not allowed yet,
 * 409 when ESPN can't be read (the page explains why), 503 without projections (the lineup would be
 * all zeros), and 402 once the trial is over and the league has no pass.
 */
export async function seasonAiRequest(db: Db, who: Who, leagueId: string): Promise<SeasonAiRequest | Response> {
  const model = getPlanModel();
  if (!config.espnSeasonEnabled || !config.espnCodeKey || !model) return error(404, "Not found");
  if (!mayUseSeason(config.espnSyncAllowlist, who.email)) return error(403, "In-season help isn't available on this account yet");
  const league = await findLeague(db, who.userId, leagueId);
  if (!league) return error(404, "League not found");
  const load = await loadSeasonView(db, config.espnCodeKey, who.userId, leagueId);
  if (load.kind !== "ok") return json(409, { error: "ESPN couldn't be read for this league", problem: load.kind });
  if (load.projectionsMissing) return error(503, "ESPN's projections didn't load. Try again in a minute.");
  const { view } = load;
  const access = await seasonAiAccess(db, { ...who, leagueId, leagueSeason: league.season, season: view.season, week: view.currentWeek });
  if (access.kind === "not-allowed") return error(403, "In-season AI isn't available on this account yet");
  if (access.kind === "needs-purchase") return json(402, SEASON_NEEDS_PURCHASE);
  return {
    model,
    view,
    access,
    began: async () => {
      if (access.via === "trial" && !access.started) await startTrial(db, who.userId, view.season, view.currentWeek);
    },
  };
}
