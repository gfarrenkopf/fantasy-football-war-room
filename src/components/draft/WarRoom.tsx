"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useRef, useState } from "react";
import type { PublicFlags } from "@/lib/config";
import { defaultRoom } from "@/lib/draft/sim";
import { totalPicks } from "@/lib/draft/snake";
import { AvailabilityReport, type ReportData } from "./AvailabilityReport";
import { useAvailability } from "./useAvailability";

/** Mocks per availability report, as in the prototype. */
const REPORT_MOCKS = 300;
import { BestAvailableStrip } from "./BestAvailableStrip";
import { Board, matchesQuery, useBoardColumns } from "./Board";
import { cx, s } from "./cx";
import { LeagueProvider, useLeague } from "./LeagueProvider";
import { LeagueSetupDialog } from "./LeagueSetupDialog";
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
  return (
    <FlagsContext.Provider value={flags}>
      <ToastProvider>
        <ConfirmProvider>
          <LeagueProvider>
            <LeagueGate />
          </LeagueProvider>
        </ConfirmProvider>
      </ToastProvider>
    </FlagsContext.Provider>
  );
}

/** Waits for the saved league, then mounts the draft for it. */
function LeagueGate() {
  const { league, hydrated } = useLeague();
  if (!hydrated) return <div className={cx("root", "loading")}>Loading your league…</div>;
  return (
    <DraftProvider totalPicks={totalPicks(league)}>
      <DraftModelProvider league={league}>
        <WarRoomView />
      </DraftModelProvider>
    </DraftProvider>
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
  const { configured } = useLeague();
  const { state } = useDraft();
  const runAvailability = useAvailability();
  const [report, setReport] = useState<{ open: boolean; running: boolean; data: ReportData | null }>({ open: false, running: false, data: null });
  const [setupOpen, setSetupOpen] = useState(false);
  const closeReport = useCallback(() => setReport({ open: false, running: false, data: null }), []);

  const openReport = async () => {
    const picks = state.picks;
    const room = defaultRoom(model.league.teams);
    setReport({ open: true, running: true, data: null });
    const result = await runAvailability(picks, room, REPORT_MOCKS);
    if (result) setReport((r) => (r.open ? { open: true, running: false, data: { result, picks, room } } : r));
  };
  // First run: show setup until the user saves a league.
  const showSetup = setupOpen || !configured;
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
    if (e.defaultPrevented || showSetup) return;
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
      <Header
        ref={searchRef}
        query={query}
        onQueryChange={setQuery}
        onQueryKeyDown={onQueryKeyDown}
        hint={hint}
        onOpenLeague={() => setSetupOpen(true)}
        actions={
          <button className={cx("btn", "primary")} onClick={() => void openReport()} title={`${REPORT_MOCKS} mocks from the current pick`}>
            Availability report
          </button>
        }
      />
      {hydrated ? (
        <div className={s.boardView}>
          <BestAvailableStrip />
          <Board query={q} hitId={hit?.id ?? null} />
        </div>
      ) : (
        <div className={s.loading}>Loading your draft…</div>
      )}
      {report.open && <AvailabilityReport data={report.data} running={report.running} onClose={closeReport} />}
      {showSetup &&<LeagueSetupDialog dataset={model.dataset} firstRun={!configured} onClose={() => setSetupOpen(false)} />}
    </div>
  );
}
