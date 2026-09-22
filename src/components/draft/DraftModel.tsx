"use client";

import { createContext, useContext, useMemo } from "react";
import { dataset } from "@/lib/data";
import { buildRoster, byeClash, conflicts, type ByeConflict, type FilledSlot } from "@/lib/draft/roster";
import { isMyPick, nextMyPick } from "@/lib/draft/snake";
import { createSimContext, type SimContext } from "@/lib/draft/sim";
import { currentPick, takenMap } from "@/lib/draft/state";
import { computeTiers, type Tier } from "@/lib/draft/tiers";
import type { Dataset, LeagueSettings, Player } from "@/lib/draft/types";
import { offBoardPlayer } from "@/lib/espn/sync";
import { useDraft } from "./DraftProvider";

export interface DraftModel {
  dataset: Dataset;
  league: LeagueSettings;
  ctx: SimContext;
  tiers: Map<string, Tier>;
  taken: Map<string, { mine: boolean; n: number }>;
  /** Pick on the clock (1-based); greater than total when the draft is complete. */
  current: number;
  total: number;
  done: boolean;
  /** The user is on the clock. */
  onClock: boolean;
  /** The user's next pick at or after `current`. */
  next: number;
  slots: FilledSlot[];
  conflicts: Map<string, ByeConflict>;
  /** Starter bye conflict drafting this available player would create, or null. Memoized per draft state. */
  byeClashFor(player: Player): ByeConflict | null;
  player(id: string): Player | undefined;
}

const ModelContext = createContext<DraftModel | null>(null);

/** Derives everything the war room renders from the draft state and league, once per change. */
export function DraftModelProvider({ league, children }: { league: LeagueSettings; children: React.ReactNode }) {
  const { state } = useDraft();

  const ctx = useMemo(() => createSimContext(league, dataset.players), [league]);
  const tiers = useMemo(() => computeTiers(dataset.players, league), [league]);

  const model = useMemo<DraftModel>(() => {
    const taken = takenMap(state);
    const current = currentPick(state);
    // Off-board picks (e.g. deep ESPN picks) stand in as players, so rosters and needs count them.
    const offBoard = new Map<string, Player>();
    state.picks.forEach((pick, i) => {
      if (!pick.label || ctx.byId.has(pick.playerId)) return;
      const stand = offBoardPlayer(pick, dataset.byeWeeks, i);
      if (stand) offBoard.set(stand.id, stand);
    });
    const lookup = (id: string) => ctx.byId.get(id) ?? offBoard.get(id);
    const { slots } = buildRoster(state.picks, lookup, league.roster);
    const clashCache = new Map<string, ByeConflict | null>();
    return {
      dataset,
      league,
      ctx,
      tiers,
      taken,
      current,
      total: ctx.total,
      done: current > ctx.total,
      onClock: current <= ctx.total && isMyPick(current, league),
      next: nextMyPick(current, league),
      slots,
      conflicts: conflicts(slots),
      byeClashFor(player) {
        if (taken.has(player.id)) return null;
        if (!clashCache.has(player.id)) clashCache.set(player.id, byeClash(player, state.picks, lookup, league.roster));
        return clashCache.get(player.id)!;
      },
      player: lookup,
    };
  }, [state, league, ctx, tiers]);

  return <ModelContext.Provider value={model}>{children}</ModelContext.Provider>;
}

export function useModel(): DraftModel {
  const m = useContext(ModelContext);
  if (!m) throw new Error("useModel must be used inside <DraftModelProvider>");
  return m;
}
