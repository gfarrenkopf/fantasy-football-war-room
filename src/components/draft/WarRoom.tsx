"use client";

import { useCallback, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import type { PublicFlags } from "@/lib/config";
import { roomFor } from "@/lib/draft/sim";
import { totalPicks } from "@/lib/draft/snake";
import { AvailabilityReport, type ReportData } from "./AvailabilityReport";
import { BestAvailableStrip } from "./BestAvailableStrip";
import { Board, matchesQuery, useBoardColumns } from "./Board";
import { cx, s } from "./cx";
import { DraftModelProvider, useModel } from "./DraftModel";
import { DraftProvider, useDraft } from "./DraftProvider";
import { ConfirmProvider, ToastProvider, useToast } from "./Feedback";
import { FlagsProvider } from "./Flags";
import { FocusView, PlanDrawer, type PlanOdds } from "./FocusView";
import { Header } from "./Header";
import { LeagueProvider, useLeague } from "./LeagueProvider";
import { LeagueSetupDialog } from "./LeagueSetupDialog";
import { NeedsStrip } from "./NeedsStrip";
import { PrefsProvider, usePrefs } from "./PrefsProvider";
import { useAvailability } from "./useAvailability";
import { useDraftActions } from "./useDraftActions";

/** Mocks per availability report, as in the prototype. */
const REPORT_MOCKS = 300;
/** Mocks behind the live turn plan, rerun after every pick. */
const PLAN_MOCKS = 100;

/** The war room app: providers plus the active view. */
export function WarRoom({ flags }: { flags: PublicFlags }) {
  return (
    <FlagsProvider flags={flags}>
      <ToastProvider>
        <ConfirmProvider>
          <PrefsProvider>
            <LeagueProvider>
              <LeagueGate />
            </LeagueProvider>
          </PrefsProvider>
        </ConfirmProvider>
      </ToastProvider>
    </FlagsProvider>
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
  const { state, hydrated } = useDraft();
  const model = useModel();
  const { prefs, setPrefs } = usePrefs();
  const { configured } = useLeague();
  const { draftWithIntent, intentFrom, undo } = useDraftActions();
  const toast = useToast();
  const columns = useBoardColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const room = useMemo(() => roomFor(prefs.room, model.league.teams), [prefs.room, model.league.teams]);

  const [setupOpen, setSetupOpen] = useState(false);
  const showSetup = setupOpen || !configured; // first run: setup until a league is saved
  const [drawerOpen, setDrawerOpen] = useState(false);

  /* ---- auto-switch plan / best available when the turn changes (prototype refresh()) ---- */
  const lastOnClock = useRef<boolean | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    if (lastOnClock.current !== null && lastOnClock.current !== model.onClock) setPrefs({ center: model.onClock ? "plan" : "ba" });
    lastOnClock.current = model.onClock;
  }, [hydrated, model.onClock, setPrefs]);

  /* ---- live turn plan: rerun mocks after every pick ---- */
  const runPlan = useAvailability();
  const [planOdds, setPlanOdds] = useState<PlanOdds | null>(null);
  useEffect(() => {
    if (!hydrated) return;
    const picks = state.picks;
    void runPlan(picks, room, PLAN_MOCKS).then((result) => {
      if (result) setPlanOdds({ picks, result });
    });
  }, [state.picks, room, hydrated, runPlan]);
  const planStale = !!planOdds && planOdds.picks !== state.picks;

  /* ---- availability report ---- */
  const runReport = useAvailability();
  const [report, setReport] = useState<{ open: boolean; running: boolean; data: ReportData | null }>({ open: false, running: false, data: null });
  const closeReport = useCallback(() => setReport({ open: false, running: false, data: null }), []);
  const openReport = async () => {
    const picks = state.picks;
    setReport({ open: true, running: true, data: null });
    const result = await runReport(picks, room, REPORT_MOCKS);
    if (result) setReport((r) => (r.open ? { open: true, running: false, data: { result, picks, room } } : r));
  };

  /* ---- search ---- */
  const hit = q ? columns.flatMap((c) => c.players).find((p) => !model.taken.has(p.id) && matchesQuery(p, q)) ?? null : null;
  const hint = q ? (hit ? `Enter → ${hit.name} (${model.onClock ? "you" : "another team"})` : "no available match") : "";
  const onQueryChange = (value: string) => {
    setQuery(value);
    if (value.trim() && prefs.view !== "board") setPrefs({ view: "board" });
  };
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

  /* ---- global keys ---- */
  const onGlobalKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.defaultPrevented || showSetup) return;
    if (e.key === "Escape") {
      setDrawerOpen(false);
      return;
    }
    if (isTyping()) return;
    if (e.key === "/") {
      e.preventDefault();
      searchRef.current?.focus();
    } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "z") {
      e.preventDefault();
      undo();
    } else if ((e.key === "1" || e.key === "2") && !e.ctrlKey && !e.metaKey && !e.altKey) {
      setPrefs({ view: e.key === "1" ? "focus" : "board" });
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
        onQueryChange={onQueryChange}
        onQueryKeyDown={onQueryKeyDown}
        hint={hint}
        onOpenLeague={() => setSetupOpen(true)}
        needs={<NeedsStrip />}
        actions={
          <>
            <button className={cx("btn", "primary")} onClick={() => void openReport()} title={`${REPORT_MOCKS} mocks from the current pick`}>
              Availability report
            </button>
            <button className={cx("btn", "plan")} onClick={() => setDrawerOpen(true)}>
              Turn plan
            </button>
          </>
        }
      >
        <div className={s.seg} role="tablist" aria-label="View">
          {(["focus", "board"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={prefs.view === v} className={cx(prefs.view === v && "on")} onClick={() => setPrefs({ view: v })}>
              {v === "focus" ? "Focus" : "Board"}
            </button>
          ))}
        </div>
      </Header>
      {!hydrated ? (
        <div className={s.loading}>Loading your draft…</div>
      ) : prefs.view === "focus" ? (
        <FocusView planOdds={planOdds} planStale={planStale} />
      ) : (
        <div className={s.boardView}>
          <BestAvailableStrip />
          <Board query={q} hitId={hit?.id ?? null} />
        </div>
      )}
      {drawerOpen && <PlanDrawer planOdds={planOdds} onClose={() => setDrawerOpen(false)} />}
      {report.open && <AvailabilityReport data={report.data} running={report.running} onClose={closeReport} />}
      {showSetup && <LeagueSetupDialog dataset={model.dataset} firstRun={!configured} onClose={() => setSetupOpen(false)} />}
    </div>
  );
}
