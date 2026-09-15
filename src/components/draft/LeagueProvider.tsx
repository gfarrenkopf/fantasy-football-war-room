"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { DEFAULT_LEAGUE } from "@/lib/data";
import { parseStoredLeague } from "@/lib/draft/league";
import type { LeagueSettings } from "@/lib/draft/types";
import { getStores } from "@/lib/storage";

interface LeagueContextValue {
  league: LeagueSettings;
  /** False until the saved league (if any) has loaded. */
  hydrated: boolean;
  /** True when the user has saved league settings at least once. False on first run. */
  configured: boolean;
  saveLeague(league: LeagueSettings): void;
}

const LeagueContext = createContext<LeagueContextValue | null>(null);

/** Loads and saves the user's league settings through the LeagueStore. */
export function LeagueProvider({ children }: { children: React.ReactNode }) {
  const [league, setLeague] = useState<LeagueSettings>(DEFAULT_LEAGUE);
  const [hydrated, setHydrated] = useState(false);
  const [configured, setConfigured] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getStores()
      .league.getLeague()
      .then((raw) => {
        if (cancelled) return;
        const saved = parseStoredLeague(raw);
        if (saved) {
          setLeague(saved);
          setConfigured(true);
        }
        setHydrated(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saveLeague = useCallback((next: LeagueSettings) => {
    setLeague(next);
    setConfigured(true);
    void getStores().league.saveLeague(next);
  }, []);

  const value = useMemo(() => ({ league, hydrated, configured, saveLeague }), [league, hydrated, configured, saveLeague]);
  return <LeagueContext.Provider value={value}>{children}</LeagueContext.Provider>;
}

export function useLeague(): LeagueContextValue {
  const ctx = useContext(LeagueContext);
  if (!ctx) throw new Error("useLeague must be used inside <LeagueProvider>");
  return ctx;
}
