"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { DEFAULT_LEAGUE } from "@/lib/data";
import type { LeagueSettings } from "@/lib/draft/types";
import { getStores, newLeagueRecord, nowIso, type LeagueRecord } from "@/lib/storage";
import { usePrefs } from "./PrefsProvider";

interface LeagueContextValue {
  /** Every saved league, oldest first. */
  leagues: LeagueRecord[];
  /** The open league, or null before the first one is created. */
  active: LeagueRecord | null;
  /** The open league's settings, or the default league on first run. */
  league: LeagueSettings;
  /** False until saved leagues (and the device's choice among them) have loaded. */
  hydrated: boolean;
  /** True once a league has been saved. False on first run. */
  configured: boolean;
  /** Updates the open league. */
  updateLeague(patch: Partial<Pick<LeagueRecord, "name" | "settings" | "datasetId" | "draftAt">>): void;
  /** Saves a new league and opens it. */
  /** Makes a league and opens it. `draftAt` is the optional draft day (see draftDay.ts). */
  createLeague(name: string, settings: LeagueSettings, draftAt?: string | null): void;
  switchLeague(id: string): void;
  deleteLeague(id: string): void;
  /** Re-reads leagues from the store, e.g. after importing some. */
  reload(): Promise<void>;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

/** Loads and saves the user's leagues through the LeagueStore, and tracks which one is open on this device. */
export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const { prefs, hydrated: prefsHydrated, setPrefs } = usePrefs();
  const [leagues, setLeagues] = useState<LeagueRecord[]>([]);
  const [loaded, setLoaded] = useState(false);

  const reload = useCallback(async () => {
    const saved = await getStores().league.listLeagues();
    setLeagues(saved);
    setLoaded(true);
  }, []);

  useEffect(() => {
    let cancelled = false;
    getStores()
      .league.listLeagues()
      .then((saved) => {
        if (cancelled) return;
        setLeagues(saved);
        setLoaded(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // `/draft?league=<id>` opens that league: the season page's way back to its draft room (APE-194).
  // Read once, at mount.
  const requested = useRef<string | null>(null);
  useEffect(() => {
    requested.current = new URLSearchParams(window.location.search).get("league");
  }, []);
  useEffect(() => {
    const id = requested.current;
    if (!id || !loaded || !prefsHydrated) return;
    requested.current = null;
    if (leagues.some((l) => l.id === id) && prefs.activeLeagueId !== id) setPrefs({ activeLeagueId: id });
    const url = new URL(window.location.href);
    // A Stripe return carries `league` too; CheckoutReturn owns that query.
    if (url.searchParams.get("league") === id && !url.searchParams.has("checkout")) {
      url.searchParams.delete("league");
      window.history.replaceState(null, "", url.pathname + url.search + url.hash);
    }
  }, [loaded, prefsHydrated, leagues, prefs.activeLeagueId, setPrefs]);

  const active = leagues.find((l) => l.id === prefs.activeLeagueId) ?? leagues[0] ?? null;

  const updateLeague = useCallback<LeagueContextValue["updateLeague"]>(
    (patch) => {
      if (!active) return;
      const next: LeagueRecord = { ...active, ...patch, updatedAt: nowIso() };
      setLeagues((ls) => ls.map((l) => (l.id === next.id ? next : l)));
      void getStores().league.saveLeague(next);
    },
    [active],
  );

  const createLeague = useCallback(
    (name: string, settings: LeagueSettings, draftAt?: string | null) => {
      const record = { ...newLeagueRecord(name, settings), ...(draftAt ? { draftAt } : {}) };
      setLeagues((ls) => [...ls, record]);
      setPrefs({ activeLeagueId: record.id });
      void getStores().league.saveLeague(record);
    },
    [setPrefs],
  );

  const switchLeague = useCallback((id: string) => setPrefs({ activeLeagueId: id }), [setPrefs]);

  const deleteLeague = useCallback(
    (id: string) => {
      setLeagues((ls) => ls.filter((l) => l.id !== id));
      if (active?.id === id) setPrefs({ activeLeagueId: null });
      void getStores().league.deleteLeague(id);
    },
    [active, setPrefs],
  );

  const value = useMemo<LeagueContextValue>(
    () => ({
      leagues,
      active,
      league: active?.settings ?? DEFAULT_LEAGUE,
      hydrated: loaded && prefsHydrated,
      configured: active !== null,
      updateLeague,
      createLeague,
      switchLeague,
      deleteLeague,
      reload,
    }),
    [leagues, active, loaded, prefsHydrated, updateLeague, createLeague, switchLeague, deleteLeague, reload],
  );
  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used inside <LeagueProvider>");
  return ctx;
}
