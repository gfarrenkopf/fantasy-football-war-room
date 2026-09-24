"use client";

import { createContext, useContext } from "react";
import type { PublicFlags } from "@/lib/config";

const OFF: PublicFlags = {
  cloudEnabled: false,
  googleAuthEnabled: false,
  emailAuthEnabled: false,
  aiEnabled: false,
  paymentsEnabled: false,
  dataPipelineEnabled: false,
  espnSyncEnabled: false,
  espnServerClientEnabled: false,
  espnSeasonEnabled: false,
};

const FlagsContext = createContext<PublicFlags>(OFF);

/** Provides the server's hosted-feature flags (see src/lib/config.ts) to client components. */
export function FlagsProvider({ flags, children }: { flags: PublicFlags; children: React.ReactNode }) {
  return <FlagsContext.Provider value={flags}>{children}</FlagsContext.Provider>;
}

export const useFlags = () => useContext(FlagsContext);
