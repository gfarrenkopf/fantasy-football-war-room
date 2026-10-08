"use client";

import { useCallback, useEffect, useEffectEvent, useRef, useState } from "react";
import type { SessionUser } from "@/lib/auth/types";
import type { PublicFlags } from "@/lib/config";
import { DATASET_ID } from "@/lib/data";
import { totalPicks } from "@/lib/draft/snake";
import { configureStores } from "@/lib/storage";
import { AppBar } from "@/components/shell/AppBar";
import { LeagueMenu } from "@/components/shell/LeagueMenu";
import { AccountMenu, AccountProvider } from "./Account";
import { AiPlanProvider } from "./AiPlan";
import { CheckoutReturn } from "./Checkout";
import { MockControls, MockRoom, SimProvider, SPEEDS, useSim } from "./Simulator";
import { AvailabilityReport, type ReportData } from "./AvailabilityReport";
import { BestAvailableStrip } from "./BestAvailableStrip";
import { Board, matchesQuery, useBoardColumns } from "./Board";
import { cx, s } from "./cx";
import { DraftModelProvider, useModel } from "./DraftModel";
import { DraftProvider, useDraft } from "./DraftProvider";
import { EspnLeagueBar, EspnPickBar, EspnPlanPublisher, EspnSyncChip, EspnSyncProvider, useEspnSync } from "./EspnSync";
import { EspnAutopickAlert } from "./EspnAutopickAlert";
import { EspnTakeover } from "./EspnTakeover";
import { ConfirmProvider, ToastProvider, useToast } from "./Feedback";
import { SyncNotices } from "./SyncNotices";
import { DraftFinale } from "./DraftFinale";
import { OpeningNight } from "./OpeningNight";
import { useWelcomeHold, Welcome } from "./Welcome";
import { FlagsProvider } from "./Flags";
import { SeasonLinksProvider, useHasSeasonPage, useSeasonPrompt, useShell } from "./SeasonLinks";
import type { ShellData } from "@/lib/server/shell";
import { DraftBook } from "./DraftBook";
import { FocusView, PlanDrawer, type PlanDrawerTab, type PlanOdds } from "./FocusView";
import { Header, leagueSummary, PlanIcon, StatusChip, type DraftTool } from "./Header";
import { LeagueProvider, useLeague } from "./LeagueProvider";
import { LeagueSetupDialog } from "./LeagueSetupDialog";
import { PickCelebrationProvider } from "./PickCelebration";
import { PrefsProvider, usePrefs } from "./PrefsProvider";
import { useAvailability } from "./useAvailability";
import { PHONE, useMediaQuery } from "./useMediaQuery";
import { useDraftActions } from "./useDraftActions";

/** Mocks per availability report, as in the prototype. */
const REPORT_MOCKS = 300;
/** Mocks behind the live turn plan, rerun after every pick. */
const PLAN_MOCKS = 100;

/** The war room app: providers plus the active view. */
export function WarRoom({ flags, user, shell = null }: { flags: PublicFlags; user: SessionUser | null; shell?: ShellData | null }) {
  // Chooses local or server-backed persistence before any provider below reads from it. Idempotent.
  configureStores({ cloudEnabled: flags.cloudEnabled, userId: user?.userId ?? null });
  return (
    <FlagsProvider flags={flags}>
      <SeasonLinksProvider shell={shell}>
        {/* Keyed by user: signing in or out swaps the stores, so every provider below reloads from the new ones. */}
        <AccountProvider key={user?.userId ?? "signed-out"} user={user}>
          <ToastProvider>
            <SyncNotices />
            <CheckoutReturn />
            <ConfirmProvider>
              <PrefsProvider>
                <LeagueProvider>
                  <Welcome>
                    <OpeningNight />
                    <LeagueGate />
                  </Welcome>
                </LeagueProvider>
              </PrefsProvider>
            </ConfirmProvider>
          </ToastProvider>
        </AccountProvider>
      </SeasonLinksProvider>
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
      <EspnSyncProvider leagueId={active?.id ?? null} league={league}>
        <DraftModelProvider league={league}>
          <SimProvider>
            <AiPlanProvider leagueId={active?.id ?? null}>
              <PickCelebrationProvider>
                <WarRoomView />
                <DraftFinale />
              </PickCelebrationProvider>
            </AiPlanProvider>
          </SimProvider>
        </DraftModelProvider>
      </EspnSyncProvider>
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
  const { prefs, setPrefs, hydrated: prefsHydrated } = usePrefs();
  const { configured, active, leagues, switchLeague } = useLeague();
  const welcomeHold = useWelcomeHold();
  const { draftWithIntent, intentFrom, undo, reset } = useDraftActions();
  const toast = useToast();
  const columns = useBoardColumns();
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const q = query.trim().toLowerCase();
  const phone = useMediaQuery(PHONE);
  const sim = useSim();
  const { room } = sim;

  const [setup, setSetup] = useState<"edit" | "create" | null>(null);
  // First run: setup until a league is saved, once any sign-in arrival has settled (see Welcome.tsx).
  const setupMode = configured ? setup : welcomeHold ? null : "create";
  const closeSetup = useCallback(() => setSetup(null), [setSetup]);
  const showSetup = setupMode !== null;

  /* ---- the app bar's league menu (Epic 15) ---- */
  const shell = useShell();
  const hasSeasonPage = useHasSeasonPage(active?.id);
  // A finished draft with no season page offers to connect ESPN (Epic 15).
  const connectSeason = useSeasonPrompt(active?.id) === "connect" && model.done;
  // A league that's linked and drafted opens on its season page; any other switches here.
  const pickLeague = (id: string) => {
    const home = shell.leagues.find((l) => l.id === id)?.home;
    if (home?.startsWith("/season/")) window.location.assign(home);
    else switchLeague(id);
  };
  const openSettings = () => setSetup("edit");
  // A league that follows ESPN takes its settings from ESPN, so its League settings goes there.
  const espnSettings = shell.leagues.find((l) => l.id === active?.id)?.espnSettings ?? null;

  /* ---- the draft tools menu (Epic 15): only what applies to this draft now ---- */
  const espnSync = useEspnSync();
  // A finished draft that came from ESPN is ESPN's record: nothing here should rewrite it.
  const syncedDone = model.done && hasSeasonPage;
  // A finished draft has nothing left to mock, so mock mode stays off once every pick is in.
  const mocking = prefs.mockOn && !model.done;
  const [roomOpen, setRoomOpen] = useState(false);
  /** "How picking works" brings the first-run click tip back. */
  const [tipAsked, setTipAsked] = useState(false);
  const tools: DraftTool[] = [
    ...(espnSync.status === "waiting" && !model.done ? [{ label: "Sync ESPN draft", href: "/espn", external: true }] : []),
    ...(!model.done
      ? [
          {
            label: "Mock draft",
            checked: prefs.mockOn,
            onToggle: () => {
              if (prefs.mockOn) sim.stop();
              setPrefs({ mockOn: !prefs.mockOn });
            },
          },
        ]
      : []),
    // The mock draft's occasional controls (APE-322); the sims themselves sit in the bar.
    ...(mocking
      ? [
          { label: "Availability report", onSelect: () => void openReport() },
          { label: "Sim speed", value: sim.speed, options: SPEEDS.map((o) => ({ value: o.ms, label: o.label })), onChange: sim.setSpeed },
          { label: "Room setup", checked: roomOpen, onToggle: () => setRoomOpen((o) => !o) },
        ]
      : []),
    ...(!model.done ? [{ label: "How picking works", onSelect: () => setTipAsked(true) }] : []),
    ...(!syncedDone ? [{ label: "Reset draft", danger: true, onSelect: () => void reset() }] : []),
  ];
  // The season page's League settings and + New league land here as `?settings=1` and `?new=1`,
  // once `?league=` (LeagueProvider) has switched to the league they're for.
  useEffect(() => {
    const url = new URL(window.location.href);
    const want = url.searchParams.get("settings") === "1" ? "edit" : url.searchParams.get("new") === "1" ? "create" : null;
    if (!want || url.searchParams.has("league")) return;
    // Stripped and acted on together, from a timeout, as AccountMenu does with `?error=`: an effect
    // cleaned up before it fires (StrictMode) leaves the URL to retry.
    const t = setTimeout(() => {
      url.searchParams.delete("settings");
      url.searchParams.delete("new");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
      setSetup(want);
    }, 0);
    return () => clearTimeout(t);
  }, [active?.id]);

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
  const lastPickCount = useRef(0);
  /** Counts the times a logged pick put the user on the clock; the header and hero replay their arrival on each. */
  const [arrival, setArrival] = useState(0);
  useEffect(() => {
    if (!hydrated) return;
    const was = lastOnClock.current;
    const advanced = state.picks.length > lastPickCount.current;
    lastOnClock.current = model.onClock;
    lastPickCount.current = state.picks.length;
    if (was === null || was === model.onClock) return;
    setPrefs({ center: model.onClock ? "plan" : "ba" });
    // Not on first load, not on an undo back onto the clock, and not while a full mock drafts for the user.
    if (model.onClock && advanced && sim.running !== "all") {
      setArrival((n) => n + 1);
      navigator.vibrate?.([30, 60, 30, 60, 60]);
    }
  }, [hydrated, model.onClock, state.picks.length, sim.running, setPrefs]);

  /* ---- the tab title says so too, for the second-screen user whose draft is in another window ---- */
  const baseTitle = useRef<string | null>(null);
  const { onClock, current } = model;
  useEffect(() => {
    baseTitle.current ??= document.title;
    document.title = hydrated && onClock ? `● Pick ${current}: you're on the clock · ${baseTitle.current}` : baseTitle.current;
  }, [hydrated, onClock, current]);
  useEffect(
    () => () => {
      if (baseTitle.current !== null) document.title = baseTitle.current;
    },
    [],
  );

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
  // Enter drafts the first available match in reading order: left to right across the board's
  // columns, or top to bottom in the phone's single consensus-ordered results list.
  const searchOrder = phone ? model.ctx.byConsensus : columns.flatMap((c) => c.players);
  const hit = q ? searchOrder.find((p) => !model.taken.has(p.id) && matchesQuery(p, q)) ?? null : null;
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

  // The first-run tip waits for saved prefs, so a device that dismissed it never sees it flash.
  const showTip = prefsHydrated && hydrated && configured && !model.done && (tipAsked || !prefs.seenClickTip);
  const closeTip = () => {
    setTipAsked(false);
    if (!prefs.seenClickTip) setPrefs({ seenClickTip: true });
  };
  const statusChip = <StatusChip arrival={arrival} compact={phone} tip={showTip} onTipClose={closeTip} />;

  return (
    <div className={s.root}>
      <AppBar
        status={phone ? statusChip : null}
        league={
          active ? (
            <LeagueMenu
              leagues={leagues}
              currentId={active.id}
              currentName={active.name}
              title={leagueSummary(model.league)}
              onPick={pickLeague}
              actions={[
                ...(hasSeasonPage ? [{ label: "Season", href: `/season/${encodeURIComponent(active.id)}` }] : []),
                ...(connectSeason ? [{ label: "Manage your season", href: "/espn" }] : []),
                espnSettings ? { label: "League settings on ESPN", href: espnSettings, external: true } : { label: "League settings", onSelect: openSettings },
              ]}
              onNewLeague={() => setSetup("create")}
            />
          ) : null
        }
        account={<AccountMenu leagueSettings={!active ? null : espnSettings ? { name: active.name, href: espnSettings, external: true } : { name: active.name, onSelect: openSettings }} espn={shell.espn} />}
      />
      <Header
        ref={searchRef}
        query={query}
        onQueryChange={onQueryChange}
        onQueryKeyDown={onQueryKeyDown}
        hint={hint}
        phone={phone}
        status={phone ? null : statusChip}
        mock={mocking ? <MockControls menu={phone} /> : null}
        sync={<EspnSyncChip />}
        tools={tools}
        canUndo={!syncedDone}
        actions={
          // Once every pick is in there's no turn left to plan.
          model.done ? null : (
            <button className={cx("btn", "plan")} onClick={() => setDrawer((tab) => tab ?? "live")} title="Turn plan">
              <PlanIcon />
              <span className={s.btnLabel}>Turn plan</span>
            </button>
          )
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
      <EspnAutopickAlert />
      <EspnLeagueBar />
      <EspnTakeover />
      <EspnPickBar />
      <EspnPlanPublisher planOdds={planStale ? null : planOdds} />
      {mocking && roomOpen && <MockRoom />}
      {!hydrated ? (
        <div className={s.loading}>Loading your draft…</div>
      ) : prefs.view === "focus" && model.done ? (
        <DraftBook />
      ) : prefs.view === "focus" ? (
        <FocusView arrival={arrival} planOdds={planOdds} planStale={planStale} onOpenAiPlan={() => setDrawer("ai")} />
      ) : (
        <div className={s.boardView}>
          {/* On a phone the search results take the strip's place, directly under the search field. */}
          {!(phone && q) && <BestAvailableStrip />}
          <Board query={q} hitId={hit?.id ?? null} onClearQuery={() => setQuery("")} />
        </div>
      )}
      {drawer && <PlanDrawer planOdds={planOdds} tab={drawer} onTab={setDrawer} onClose={() => setDrawer(null)} />}
      {report.open && <AvailabilityReport data={report.data} running={report.running} onClose={closeReport} />}
      {setupMode && <LeagueSetupDialog key={setupMode} dataset={model.dataset} mode={setupMode} firstRun={!configured} onClose={closeSetup} />}
    </div>
  );
}
