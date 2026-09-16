"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from "react";
import { draftReducer, emptyDraftState, type DraftAction } from "@/lib/draft/state";
import type { DraftPick, DraftState } from "@/lib/draft/types";
import { getStores } from "@/lib/storage";

interface DraftContextValue {
  state: DraftState;
  /** False until the saved draft has been loaded. Render a placeholder instead of an empty board. */
  hydrated: boolean;
  draft(playerId: string, mine: boolean): void;
  setMine(playerId: string, mine: boolean): void;
  untake(playerId: string): void;
  undo(): void;
  reset(): void;
  appendPicks(picks: DraftPick[]): void;
}

const DraftContext = createContext<DraftContextValue | null>(null);

/**
 * Owns the draft state for the war room: loads it from the store on mount and saves every change.
 * Components use useDraft() and never see the storage implementation.
 */
export function DraftProvider({
  totalPicks,
  draftKey,
  children,
}: {
  totalPicks: number;
  /** The league whose draft this is. Null before any league exists: the draft is kept in memory only. */
  draftKey: string | null;
  children: React.ReactNode;
}) {
  const [state, dispatch] = useReducer(draftReducer, undefined, emptyDraftState);
  // The draft key whose saved state has been loaded into the reducer.
  const [loadedKey, setLoadedKey] = useState<string | null>(null);
  // Without a league there's nothing to load: the draft starts (and stays) empty in memory.
  const hydrated = draftKey === null || loadedKey === draftKey;

  useEffect(() => {
    if (draftKey === null) return;
    let cancelled = false;
    getStores()
      .draft.getDraftState(draftKey)
      .then((saved) => {
        if (cancelled) return;
        dispatch({ type: "hydrate", state: saved ?? emptyDraftState() });
        setLoadedKey(draftKey);
      });
    return () => {
      cancelled = true;
    };
  }, [draftKey]);

  useEffect(() => {
    // Don't overwrite the saved draft with the empty initial state before it has loaded.
    if (!hydrated || draftKey === null) return;
    void getStores().draft.saveDraftState(draftKey, state);
  }, [state, hydrated, draftKey]);

  const act = useCallback((action: DraftAction) => dispatch(action), []);

  const value = useMemo<DraftContextValue>(
    () => ({
      state,
      hydrated,
      draft: (playerId, mine) => act({ type: "draft", playerId, mine, totalPicks }),
      setMine: (playerId, mine) => act({ type: "setMine", playerId, mine }),
      untake: (playerId) => act({ type: "untake", playerId }),
      undo: () => act({ type: "undo" }),
      reset: () => act({ type: "reset" }),
      appendPicks: (picks) => act({ type: "appendPicks", picks, totalPicks }),
    }),
    [state, hydrated, act, totalPicks],
  );

  return <DraftContext.Provider value={value}>{children}</DraftContext.Provider>;
}

export function useDraft(): DraftContextValue {
  const ctx = useContext(DraftContext);
  if (!ctx) throw new Error("useDraft must be used inside <DraftProvider>");
  return ctx;
}
