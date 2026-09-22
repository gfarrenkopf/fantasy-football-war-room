"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { formatRoundPick } from "@/lib/draft/snake";
import { samePicks } from "@/lib/draft/state";
import type { LeagueSettings } from "@/lib/draft/types";
import { listenForEspnPaired } from "@/lib/espn/channel";
import { requestActive, type LiveEvent, type LiveSnapshot, type LiveStatus, type PickRequestView } from "@/lib/espn/live";
import { myPlayers, positionCounts } from "@/lib/draft/roster";
import { computeTurnPlan } from "@/lib/draft/sim/turnPlan";
import { buildOverlayPlan } from "@/lib/espn/overlayPlan";
import { slotMismatch, syncMode, toDraftPicks } from "@/lib/espn/sync";
import { useAccount } from "./Account";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraft } from "./DraftProvider";
import { useToast } from "./Feedback";
import { useFlags } from "./Flags";
import type { PlanOdds } from "./FocusView";

export interface EspnSyncValue {
  leagueId: string | null;
  /** `off`: not signed in, feature off, or this league can't use it. */
  status: LiveStatus | "off";
  /** The board follows ESPN pick for pick; logging picks by hand is paused. */
  locked: boolean;
  /** ESPN has the user on the clock, so a pick can be made from War Room. */
  myTurn: boolean;
  /** The player armed to be drafted in ESPN (the first of two steps), if any. */
  armed: string | null;
  /** The latest pick made from War Room. */
  request: PickRequestView | null;
  /** Arms a player; arming the one already armed drafts him (double-click, or Enter twice). */
  arm(playerId: string): void;
  disarm(): void;
  /** Drafts the armed player in ESPN. */
  draftArmed(): void;
}

const noop = () => {};
const OFF: EspnSyncValue = { leagueId: null, status: "off", locked: false, myTurn: false, armed: null, request: null, arm: noop, disarm: noop, draftArmed: noop };
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
      setSnapshot((cur) =>
        cur && pick.n === cur.picks.length + 1 ? { ...cur, status: cur.status === "waiting" ? "live" : cur.status, picks: [...cur.picks, pick] } : cur,
      ),
    );
    on("clock", ({ onClock }) => setSnapshot((cur) => cur && { ...cur, onClock }));
    on("status", ({ status, draft }) => setSnapshot((cur) => cur && { ...cur, status, draft }));
    on("request", ({ request }) => setSnapshot((cur) => cur && { ...cur, request }));
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

  /* ---- picking from War Room (8.13) ---- */
  const [armedId, setArmed] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const myTurn = !!snapshot && snapshot.status === "live" && snapshot.espnTeamId !== null && snapshot.onClock?.teamId === snapshot.espnTeamId;
  const request = snapshot?.request ?? null;
  // Derived, so the arm lapses by itself the moment the clock moves on or a pick is on its way.
  const armed = myTurn && !sending && !requestActive(request) ? armedId : null;

  const draftPlayer = useCallback(
    async (playerId: string) => {
      setArmed(null);
      setSending(true);
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId!)}/espn/pick`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ playerId }),
      }).catch(() => null);
      setSending(false);
      if (!res) return toast("Couldn't reach War Room. Make this pick in ESPN.");
      if (res.status === 202) {
        const { request: sent } = (await res.json()) as { request: PickRequestView };
        return setSnapshot((cur) => cur && { ...cur, request: sent });
      }
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      toast(body.error ?? "Couldn't send that pick. Make it in ESPN.");
    },
    [leagueId, toast],
  );

  const arm = useCallback(
    (playerId: string) => {
      if (!myTurn) return;
      if (armed === playerId) void draftPlayer(playerId);
      else setArmed(playerId);
    },
    [myTurn, armed, draftPlayer],
  );
  const disarm = useCallback(() => setArmed(null), []);
  const draftArmed = useCallback(() => {
    if (armed) void draftPlayer(armed);
  }, [armed, draftPlayer]);

  // Say how a War Room pick turned out; a confirmed one simply appears on the board.
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!request || told.current === `${request.id}:${request.state}`) return;
    told.current = `${request.id}:${request.state}`;
    if (request.state === "superseded") toast("ESPN had already made a pick for you");
    else if (request.state === "refused") toast("ESPN didn't have you on the clock. Check your ESPN tab.");
    else if (request.state === "expired") toast("ESPN didn't confirm that pick. Check your ESPN tab and pick there.");
  }, [request, toast]);

  const value = useMemo<EspnSyncValue>(() => {
    if (!snapshot) return OFF;
    return {
      leagueId,
      status: snapshot.status,
      locked: snapshot.status === "live" && syncMode(snapshot) === "replace",
      myTurn,
      armed,
      request: sending ? { id: "sending", playerId: armedId ?? "", espnPlayerId: 0, state: "pending" } : request,
      arm,
      disarm,
      draftArmed,
    };
  }, [leagueId, snapshot, myTurn, armed, armedId, sending, request, arm, disarm, draftArmed]);

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

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
};

/**
 * The second step of drafting from War Room: names the armed player and sends him to ESPN. Enter
 * drafts and Escape cancels, unless the user is typing (the search box has its own Enter). Also
 * shows a pick on its way.
 */
export function EspnPickBar() {
  const { armed, request, draftArmed, disarm } = useEspnSync();
  const model = useModel();

  useEffect(() => {
    if (!armed) return;
    const onKey = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === "Enter") {
        e.preventDefault();
        draftArmed();
      } else if (e.key === "Escape") disarm();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [armed, draftArmed, disarm]);

  if (armed) {
    const player = model.player(armed);
    return (
      <div className={s.espnArm} role="region" aria-label="Draft in ESPN">
        <span className={s.espnArmText}>
          {player?.name ?? "This player"} {player && <>({player.pos}, {player.team})</>}
          <small>Click him again or press Enter to draft him in ESPN.</small>
        </span>
        <button className={cx("btn", "espnGo")} onClick={draftArmed} autoFocus>
          Draft in ESPN
        </button>
        <button className={s.btn} onClick={disarm}>
          Cancel
        </button>
      </div>
    );
  }
  if (request && requestActive(request)) {
    const player = model.player(request.playerId);
    return (
      <div className={s.espnArm} role="status">
        <span className={s.espnArmText}>
          Drafting {player?.name ?? "your pick"} in ESPN…<small>It lands on your board as soon as ESPN confirms it.</small>
        </span>
      </div>
    );
  }
  return null;
}

/**
 * Publishes the war room's turn plan to the ESPN overlay while a bridge is live (8.14), so the user
 * can see it, and draft from it, without leaving ESPN's draft room. The same computation as the plan
 * panel; published only when it changes, and again whenever the connection comes back live.
 */
export function EspnPlanPublisher({ planOdds }: { planOdds: PlanOdds | null }) {
  const { status, leagueId } = useEspnSync();
  const model = useModel();
  const { state } = useDraft();

  const body = useMemo(() => {
    if (status !== "live" || !planOdds) return null;
    const now = computeTurnPlan(planOdds.picks, planOdds.result, model.ctx, 0);
    if (!now) return null;
    const plan = buildOverlayPlan({
      now,
      next: computeTurnPlan(planOdds.picks, planOdds.result, model.ctx, 1),
      onClock: model.onClock,
      taken: new Set(model.taken.keys()),
      counts: positionCounts(myPlayers(state.picks, model.player)),
      current: model.current,
      ctx: model.ctx,
      valueThreshold: model.league.valueThreshold,
    });
    return JSON.stringify(plan);
  }, [status, planOdds, model, state.picks]);

  const published = useRef<string | null>(null);
  useEffect(() => {
    if (status !== "live") published.current = null; // publish again once the bridge is back
    if (!body || !leagueId || body === published.current) return;
    published.current = body;
    void fetch(`/api/leagues/${encodeURIComponent(leagueId)}/espn/plan`, { method: "PUT", headers: { "content-type": "application/json" }, body }).catch(() => {
      published.current = null;
    });
  }, [body, status, leagueId]);

  return null;
}
