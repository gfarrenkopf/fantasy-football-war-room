"use client";

import { createContext, useContext } from "react";

/** The user's war room leagues that follow an ESPN league this season (10.3), from the server. */
const SeasonLinksContext = createContext<readonly string[]>([]);

export function SeasonLinksProvider({ leagueIds, children }: { leagueIds: readonly string[]; children: React.ReactNode }) {
  return <SeasonLinksContext.Provider value={leagueIds}>{children}</SeasonLinksContext.Provider>;
}

/** Whether this league has a season page to go to. */
export const useHasSeasonPage = (leagueId: string | null | undefined) => {
  const ids = useContext(SeasonLinksContext);
  return !!leagueId && ids.includes(leagueId);
};
