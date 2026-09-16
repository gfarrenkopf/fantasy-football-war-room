"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/types";
import type { PublicFlags } from "@/lib/config";
import { DATASET_ID } from "@/lib/data";
import { totalPicks } from "@/lib/draft/snake";
import { configureStores } from "@/lib/storage";
import { AccountMenu, AccountProvider } from "./Account";
import { AiPlanProvider } from "./AiPlan";
import { CheckoutReturn } from "./Checkout";
import { MockBar, SimProvider, useSim } from "./Simulator";
import { AvailabilityReport, type ReportData } from "./AvailabilityReport";
import { BestAvailableStrip } from "./BestAvailableStrip";
import { Board, matchesQuery, useBoardColumns } from "./Board";
import { cx, s } from "./cx";
import { DraftModelProvider, useModel } from "./DraftModel";
import { DraftProvider, useDraft } from "./DraftProvider";
import { ConfirmProvider, ToastProvider, useToast } from "./Feedback";
import { SyncNotices } from "./SyncNotices";
import { FlagsProvider } from "./Flags";
import { FocusView, PlanDrawer, type PlanDrawerTab, type PlanOdds } from "./FocusView";
import { Header } from "./Header";
import { ImportPrompt } from "./ImportPrompt";
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
export function WarRoom({ flags, user }: { flags: PublicFlags; user: SessionUser | null }) {
  // Chooses local or server-backed persistence before any provider below reads from it. Idempotent.
  configureStores({ cloudEnabled: flags.cloudEnabled, userId: user?.userId ?? null });
  return (
    <FlagsProvider flags={flags}>
      {/* Keyed by user: signing in or out swaps the stores, so every provider below reloads from the new ones. */}
      <AccountProvider key={user?.userId ?? "signed-out"} user={user}>
        <ToastProvider>
          <SyncNotices />
          <CheckoutReturn />
          <ConfirmProvider>
            <PrefsProvider>
              <LeagueProvider>
                <ImportPrompt />
                <LeagueGate />
              </LeagueProvider>
            </PrefsProvider>
          </ConfirmProvider>
        </ToastProvider>
      </AccountProvider>
    </FlagsProvider>
  );
}

/** Waits for the saved league, then mounts the draft for it. */
function LeagueGate() {
  const { league, active, hydrated } = useLeague();
  if (!hydrated) return <div className={cx("root", "loading")}>Loading your league…</div>;
  // Keyed by league so switching leagues remounts the draft, model and simulator from scratch.
  return (
    <DraftProvider key={active?.id ?? "new"} draftKey={active?.id ?? null} totalPicks={totalPicks(league)}>
      <DraftModelProvider league={league}>
        <SimProvider>
          <AiPlanProvider leagueId={active?.id ?? null}>
            <WarRoomView />
          </AiPlanProvider>
        </SimProvider>
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
  const { configured, active } = useLeague();
  const { draftWithIntent, intentFrom, undo } = useDraftActions();
  const toast = useToast();
  const columns = useBoardColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const sim = useSim();
  const { room } = sim;

  const [setup, setSetup] = useState<"edit" | "create" | null>(null);
  const setupMode = configured ? setup : "create"; // first run: setup until a league is saved
  const closeSetup = useCallback(() => setSetup(null), [setSetup]);
  const showSetup = setupMode !== null;

  /* ---- flag picks logged against different player data (e.g. sample data swapped for a live run) ---- */
  const staleWarned = useRef(false);
  useEffect(() => {
    if (!hydrated || !active || staleWarned.current || active.datasetId === DATASET_ID) return;
    const missing = state.picks.filter((p) => !model.player(p.playerId)).length;
    if (!missing) return;
    staleWarned.current = true;
    toast(`${missing} logged pick${missing === 1 ? " is" : "s are"} for players missing from the current player data`);
  }, [hydrated, active, state.picks, model, toast]);
  /** The plan drawer's open tab, or null when closed. */
  const [drawer, setDrawer] = useState<PlanDrawerTab | null>(null);

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
      setDrawer(null);
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
        onOpenLeague={() => setSetup("edit")}
        onNewLeague={() => setSetup("create")}
        needs={<NeedsStrip />}
        actions={
          <>
            <button
              className={cx("btn", prefs.mockOn && "on")}
              title="Mock draft mode: CPU teams make the other picks"
              aria-pressed={prefs.mockOn}
              onClick={() => {
                if (prefs.mockOn) sim.stop();
                setPrefs({ mockOn: !prefs.mockOn });
              }}
            >
              Mock draft
            </button>
            <button className={cx("btn", "plan")} onClick={() => setDrawer((tab) => tab ?? "live")}>
              Turn plan
            </button>
          </>
        }
        account={<AccountMenu />}
      >
        <div className={s.seg} role="tablist" aria-label="View">
          {(["focus", "board"] as const).map((v) => (
            <button key={v} role="tab" aria-selected={prefs.view === v} className={cx(prefs.view === v && "on")} onClick={() => setPrefs({ view: v })}>
              {v === "focus" ? "Focus" : "Board"}
            </button>
          ))}
        </div>
      </Header>
      {prefs.mockOn && <MockBar onReport={() => void openReport()} reportMocks={REPORT_MOCKS} />}
      {!hydrated ? (
        <div className={s.loading}>Loading your draft…</div>
      ) : prefs.view === "focus" ? (
        <FocusView planOdds={planOdds} planStale={planStale} onOpenAiPlan={() => setDrawer("ai")} />
      ) : (
        <div className={s.boardView}>
          <BestAvailableStrip />
          <Board query={q} hitId={hit?.id ?? null} />
        </div>
      )}
      {drawer && <PlanDrawer planOdds={planOdds} tab={drawer} onTab={setDrawer} onClose={() => setDrawer(null)} />}
      {report.open && <AvailabilityReport data={report.data} running={report.running} onClose={closeReport} />}
      {setupMode && <LeagueSetupDialog key={setupMode} dataset={model.dataset} mode={setupMode} firstRun={!configured} onClose={closeSetup} />}
    </div>
  );
}
