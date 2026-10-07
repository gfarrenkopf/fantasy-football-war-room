"use client";

import { createContext, useContext } from "react";
import type { ShellData } from "@/lib/server/shell";
import { useAccount } from "./Account";
import { useFlags } from "./Flags";

/**
 * What the server knows about the user's leagues for the app bar (Epic 15): which follow an ESPN
 * league this season (10.3), where picking each one lands, and the user's ESPN connection.
 * Empty when signed out or self-hosted.
 */
const EMPTY: ShellData = { leagues: [], espn: null, season: false };
const ShellContext = createContext<ShellData>(EMPTY);

export function SeasonLinksProvider({ shell, children }: { shell: ShellData | null; children: React.ReactNode }) {
  return <ShellContext.Provider value={shell ?? EMPTY}>{children}</ShellContext.Provider>;
}

export const useShell = () => useContext(ShellContext);

/** Whether this league has a season page to go to. */
export const useHasSeasonPage = (leagueId: string | null | undefined) => {
  const { leagues } = useShell();
  return !!leagueId && leagues.some((l) => l.id === leagueId && l.linked);
};

/**
 * What a league with no season page offers instead (Epic 15): connecting ESPN when the user is
 * signed in and in-season tools are on for them; signing in when they're signed out and in-season
 * tools are open to everyone; nothing otherwise (a self-hosted install has no season to manage).
 */
export function useSeasonPrompt(leagueId: string | null | undefined): "connect" | "sign-in" | null {
  const shell = useShell();
  const user = useAccount();
  const flags = useFlags();
  const linked = useHasSeasonPage(leagueId);
  if (linked || !leagueId) return null;
  if (user) return shell.season ? "connect" : null;
  const canSignIn = flags.emailAuthEnabled || flags.googleAuthEnabled;
  return flags.cloudEnabled && flags.espnSeasonOpen && canSignIn ? "sign-in" : null;
}
