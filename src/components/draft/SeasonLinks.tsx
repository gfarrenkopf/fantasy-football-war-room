"use client";

import { createContext, useContext } from "react";
import type { ShellData } from "@/lib/server/shell";

/**
 * What the server knows about the user's leagues for the app bar (Epic 15): which follow an ESPN
 * league this season (10.3), where picking each one lands, and the user's ESPN connection.
 * Empty when signed out or self-hosted.
 */
const ShellContext = createContext<ShellData>({ leagues: [], espn: null });

export function SeasonLinksProvider({ shell, children }: { shell: ShellData | null; children: React.ReactNode }) {
  return <ShellContext.Provider value={shell ?? { leagues: [], espn: null }}>{children}</ShellContext.Provider>;
}

export const useShell = () => useContext(ShellContext);

/** Whether this league has a season page to go to. */
export const useHasSeasonPage = (leagueId: string | null | undefined) => {
  const { leagues } = useShell();
  return !!leagueId && leagues.some((l) => l.id === leagueId && l.linked);
};
