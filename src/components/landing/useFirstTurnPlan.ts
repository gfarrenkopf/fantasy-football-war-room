"use client";

import { useEffect, useMemo, useState } from "react";
import { dataset } from "@/lib/data";
import { computeTurnPlan, createSimContext, defaultRoom, type TurnPlan } from "@/lib/draft/sim";
import type { DraftPick, LeagueSettings } from "@/lib/draft/types";
import { useAvailabilityFor } from "@/components/draft/useAvailability";

/** Mocks behind the live turn plan, the same number the war room runs after every pick. */
export const PLAN_MOCKS = 100;

export interface FirstTurnPlan {
  /** The board the instant after the visitor's first pick. */
  picks: DraftPick[];
  plan: TurnPlan | null;
  /** How long the mocks took, measured, for the provenance line. */
  elapsedMs: number | null;
}

/**
 * The war room's live turn plan, computed for the moment right after the visitor's first pick:
 * who is likely to still be there when the draft snakes back to them.
 *
 * Runs the war room's own Monte Carlo worker over the landing board's own draft, so the pick card
 * that lands in the hero and the proof section below it tell the same true story.
 */
export function useFirstTurnPlan(league: LeagueSettings, full: DraftPick[]): FirstTurnPlan {
  const run = useAvailabilityFor(league, dataset.players);
  const picks = useMemo(() => full.slice(0, league.mySlot), [full, league.mySlot]);
  const [result, setResult] = useState<{ picks: DraftPick[]; plan: TurnPlan | null; elapsedMs: number } | null>(null);

  useEffect(() => {
    if (picks.length < league.mySlot) return;
    let live = true;
    void run(picks, defaultRoom(league.teams), PLAN_MOCKS).then((odds) => {
      if (!live || !odds) return;
      setResult({ picks, plan: computeTurnPlan(picks, odds, createSimContext(league, dataset.players), 0), elapsedMs: Math.round(odds.elapsedMs) });
    });
    return () => {
      live = false;
    };
  }, [picks, league, run]);

  // A result computed for a previous league shape is stale the moment the shape changes.
  const current = result && result.picks === picks ? result : null;
  return { picks, plan: current?.plan ?? null, elapsedMs: current?.elapsedMs ?? null };
}
