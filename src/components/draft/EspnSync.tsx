"use client";

import { createContext, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { formatRoundPick } from "@/lib/draft/snake";
import { samePicks } from "@/lib/draft/state";
import type { LeagueSettings } from "@/lib/draft/types";
import { listenForEspnPaired } from "@/lib/espn/channel";
import type { LiveEvent, LiveSnapshot, LiveStatus } from "@/lib/espn/live";
import { slotMismatch, syncMode, toDraftPicks } from "@/lib/espn/sync";
import { useAccount } from "./Account";
import { cx } from "./cx";
import { useDraft } from "./DraftProvider";
import { useToast } from "./Feedback";
import { useFlags } from "./Flags";

export interface EspnSyncValue {
  /** `off`: not signed in, feature off, or this league can't use it. */
  status: LiveStatus | "off";
  /** The board follows ESPN pick for pick; logging picks by hand is paused. */
  locked: boolean;
}

const OFF: EspnSyncValue = { status: "off", locked: false };
const EspnSyncContext = createContext<EspnSyncValue>(OFF);

export const useEspnSync = () => useContext(EspnSyncContext);

/**
 * ESPN live sync for the open league (8.4): listens to the relay's event stream and applies its
 * picks to the draft through the same reducer as a click, so the board, roster, plan and simulator
 * all follow without knowing where picks came from. ESPN is authoritative while it's live.
 *
 * Signed in, feature on and the league allowed: the stream stays open; it's idle until a bridge
 * connects. A 402/403 closes it for good (EventSource doesn't retry a non-200 response).
 */
export function EspnSyncProvider({ leagueId, league, children }: { leagueId: string | null; league: LeagueSettings; children: React.ReactNode }) {
  const flags = useFlags();
  const user = useAccount();
  const toast = useToast();
  const { state, hydrated, syncExternal } = useDraft();
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  const [connection, setConnection] = useState(0);
  const enabled = flags.espnSyncEnabled && !!user && !!leagueId;

  // A league connected in the pairing popup: reconnect so its bridge's picks flow right away.
  useEffect(() => listenForEspnPaired((id) => id === leagueId && setConnection((n) => n + 1)), [leagueId]);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/leagues/${encodeURIComponent(leagueId!)}/espn/stream`);
    const on = <T extends LiveEvent["type"]>(type: T, apply: (event: Extract<LiveEvent, { type: T }>) => void) =>
      source.addEventListener(type, (e) => apply(JSON.parse((e as MessageEvent<string>).data)));
    on("snapshot", (e) => setSnapshot(e.snapshot));
    on("pick", ({ pick }) =>
      setSnapshot((s) => (s && pick.n === s.picks.length + 1 ? { ...s, status: s.status === "waiting" ? "live" : s.status, picks: [...s.picks, pick] } : s)),
    );
    on("clock", ({ onClock }) => setSnapshot((s) => s && { ...s, onClock }));
    on("status", ({ status, draft }) => setSnapshot((s) => s && { ...s, status, draft }));
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) setSnapshot(null);
    };
    return () => {
      source.close();
      setSnapshot(null);
    };
  }, [enabled, leagueId, connection]);

  /* ---- apply live picks to the board ---- */
  const toldReplaced = useRef(false);
  const toldMismatch = useRef(false);
  const apply = useEffectEvent((live: LiveSnapshot) => {
    const mode = syncMode(live);
    if (!mode) return;
    const picks = toDraftPicks(live.picks);
    const local = state.picks;
    if (mode === "replace" && !toldReplaced.current && local.length && !samePicks(local.slice(0, picks.length), picks.slice(0, local.length))) {
      toldReplaced.current = true;
      toast("Your board now matches your ESPN draft");
    }
    syncExternal(picks, mode);

    const off = live.anchored ? slotMismatch(live.picks, league) : null;
    if (off && !toldMismatch.current) {
      toldMismatch.current = true;
      toast(`ESPN had your pick at ${formatRoundPick(off.n, league.teams)}, which this league gives to another team. Check teams and draft slot in league settings.`);
    }
  });
  useEffect(() => {
    if (hydrated && snapshot) apply(snapshot);
  }, [snapshot, hydrated]);

  const value = useMemo<EspnSyncValue>(() => {
    if (!snapshot) return OFF;
    return { status: snapshot.status, locked: snapshot.status === "live" && syncMode(snapshot) === "replace" };
  }, [snapshot]);

  return <EspnSyncContext.Provider value={value}>{children}</EspnSyncContext.Provider>;
}

const CHIP: Record<Exclude<LiveStatus, "waiting">, { label: string; title: string }> = {
  live: { label: "● ESPN live", title: "Picks from your ESPN draft land here as they're made. Logging picks by hand is paused." },
  "bridge-offline": { label: "ESPN tab closed", title: "Your ESPN draft tab stopped checking in. Log picks by hand, or reopen the tab and click the War Room bookmark." },
  complete: { label: "ESPN draft done", title: "Your ESPN draft is complete." },
};

/** Header control: the sync state, or the way to set it up. */
export function EspnSyncChip() {
  const { status } = useEspnSync();
  if (status === "off") return null;
  if (status === "waiting") {
    return (
      <a className={cx("btn")} href="/espn" target="_blank" rel="noreferrer" title="Have picks from your ESPN draft land on this board automatically">
        Sync ESPN draft
      </a>
    );
  }
  const chip = CHIP[status];
  return (
    <span className={cx("btn", status === "live" && "on")} title={chip.title} role="status">
      {chip.label}
    </span>
  );
}
