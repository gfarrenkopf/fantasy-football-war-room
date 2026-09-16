"use client";

import { useEffect, useRef } from "react";
import { getStores } from "@/lib/storage";
import { useAccount } from "./Account";
import { useConfirm, useToast } from "./Feedback";
import { useLeague } from "./LeagueProvider";

/**
 * After sign-in, offers to move leagues saved on this device while signed out into the account.
 * Declined leagues stay local-only and aren't offered again.
 */
export function ImportPrompt() {
  const user = useAccount();
  const { hydrated, reload } = useLeague();
  const confirm = useConfirm();
  const toast = useToast();
  const asked = useRef(false);

  useEffect(() => {
    const imports = getStores().imports;
    if (!user || !hydrated || !imports || asked.current) return;
    asked.current = true;
    void (async () => {
      const pending = await imports.pending();
      if (!pending.length) return;
      const names = pending.map((l) => l.name).join(", ");
      const one = pending.length === 1;
      const ok = await confirm({
        message: `${one ? "A league" : `${pending.length} leagues`} saved on this device before you signed in (${names}) ${one ? "isn't" : "aren't"} in your account. Add ${one ? "it" : "them"} so ${one ? "it syncs" : "they sync"} across devices?`,
        confirmLabel: one ? "Add to account" : `Add ${pending.length} leagues`,
        cancelLabel: "Keep on this device only",
      });
      const ids = pending.map((l) => l.id);
      if (!ok) return imports.dismiss(ids);
      await imports.importLeagues(ids);
      await reload();
      toast(one ? `${pending[0].name} added to your account` : `${pending.length} leagues added to your account`);
    })();
  }, [user, hydrated, confirm, toast, reload]);

  return null;
}
