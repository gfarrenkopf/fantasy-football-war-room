"use client";

import { createContext, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import type { PublicFlags } from "@/lib/config";
import { DEFAULT_LEAGUE } from "@/lib/data";
import { totalPicks } from "@/lib/draft/snake";
import { BestAvailableStrip } from "./BestAvailableStrip";
import { Board, matchesQuery, useBoardColumns } from "./Board";
import { s } from "./cx";
import { DraftModelProvider, useModel } from "./DraftModel";
import { DraftProvider, useDraft } from "./DraftProvider";
import { ConfirmProvider, ToastProvider, useToast } from "./Feedback";
import { Header } from "./Header";
import { useDraftActions } from "./useDraftActions";

const FlagsContext = createContext<PublicFlags>({ cloudEnabled: false, aiEnabled: false, paymentsEnabled: false, dataPipelineEnabled: false });
/** Hosted-feature flags from the server (see src/lib/config.ts). */
export const useFlags = () => useContext(FlagsContext);

/** The war room app: providers plus the active view. */
export function WarRoom({ flags }: { flags: PublicFlags }) {
  const league = DEFAULT_LEAGUE;
  return (
    <FlagsContext.Provider value={flags}>
      <ToastProvider>
        <ConfirmProvider>
          <DraftProvider totalPicks={totalPicks(league)}>
            <DraftModelProvider league={league}>
              <WarRoomView />
            </DraftModelProvider>
          </DraftProvider>
        </ConfirmProvider>
      </ToastProvider>
    </FlagsContext.Provider>
  );
}

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
};

function WarRoomView() {
  const { hydrated } = useDraft();
  const model = useModel();
  const { draftWithIntent, intentFrom, undo } = useDraftActions();
  const toast = useToast();
  const columns = useBoardColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();

  // First available player matching the search, in board order.
  const hit = q ? columns.flatMap((c) => c.players).find((p) => !model.taken.has(p.id) && matchesQuery(p, q)) ?? null : null;
  const hint = q ? (hit ? `Enter → ${hit.name} (${model.onClock ? "you" : "another team"})` : "no available match") : "";

  const onQueryKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      setQuery("");
      e.currentTarget.blur();
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (!hit) return toast("No available player matches");
      void draftWithIntent(hit.id, intentFrom(e));
      setQuery("");
    }
  };

  const onGlobalKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented) return;
    if (e.key === "/" && !isTyping()) {
      e.preventDefault();
      searchRef.current?.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z" && !isTyping()) {
      e.preventDefault();
      undo();
    }
  });

  useEffect(() => {
    const listener = (e: KeyboardEvent) => onGlobalKey(e);
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);

  return (
    <div className={s.root}>
      <Header ref={searchRef} query={query} onQueryChange={setQuery} onQueryKeyDown={onQueryKeyDown} hint={hint} />
      {hydrated ? (
        <div className={s.boardView}>
          <BestAvailableStrip />
          <Board query={q} hitId={hit?.id ?? null} />
        </div>
      ) : (
        <div className={s.loading}>Loading your draft…</div>
      )}
    </div>
  );
}
