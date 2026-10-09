"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { getStores, takeFarewell, type Farewell } from "@/lib/storage";

/**
 * What every face of the front door does before it says anything (the draft page and, in season,
 * the season page): sends a returning local user to their board, and reads the goodbye a sign-out
 * left for it.
 *
 * Returns the goodbye's contents: undefined while it's being read, null when there was none.
 */
export function useDoor(farewell: boolean): Farewell | null | undefined {
  const router = useRouter();

  /**
   * Returning local user: straight to their board. The page renders first and redirects when the
   * stores answer, rather than holding the markup behind a storage round trip — a door that ships
   * an empty document to a crawler, or to anyone without JavaScript, is not a door.
   */
  useEffect(() => {
    // Just signed out: stay for the goodbye, even with leagues saved on this device.
    if (farewell) return;
    let live = true;
    void getStores()
      .league.listLeagues()
      .then((leagues) => {
        if (live && leagues.length) router.replace(`/draft${window.location.search}`);
      });
    return () => {
      live = false;
    };
  }, [router, farewell]);

  /*
   * The goodbye's contents, handed over by the sign-out in this tab's sessionStorage. Read (and
   * the `?farewell=1` stripped) from a timeout: an effect cleaned up before it fires, as React's
   * development double-run does, then retries rather than losing the one-time hand-off.
   */
  const [goodbye, setGoodbye] = useState<Farewell | null | undefined>(undefined);
  useEffect(() => {
    if (!farewell) return;
    const t = setTimeout(() => {
      const url = new URL(window.location.href);
      url.searchParams.delete("farewell");
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
      setGoodbye(takeFarewell());
    }, 0);
    return () => clearTimeout(t);
  }, [farewell]);

  return goodbye;
}
