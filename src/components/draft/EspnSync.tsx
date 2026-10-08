"use client";

import { createContext, useCallback, useContext, useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { formatRoundPick } from "@/lib/draft/snake";
import { samePicks } from "@/lib/draft/state";
import type { LeagueSettings } from "@/lib/draft/types";
import { listenForEspnPaired } from "@/lib/espn/channel";
import { leagueDifferences } from "@/lib/espn/league";
import { clockDeadline, clockUrgency, formatClock, requestActive, type ClockDeadline, type DriftReport, type EspnLeague, type LiveEvent, type LiveSnapshot, type LiveStatus, type PickRequestView, type ServerClientView, resyncOnWake } from "@/lib/espn/live";
import { myPlayers, positionCounts } from "@/lib/draft/roster";
import { computeTurnPlan } from "@/lib/draft/sim/turnPlan";
import { buildOverlayPlan } from "@/lib/espn/overlayPlan";
import { slotMismatch, syncMode, toDraftPicks } from "@/lib/espn/sync";
import { useAccount } from "./Account";
import { cx, s } from "./cx";
import { useModel } from "./DraftModel";
import { useDraft } from "./DraftProvider";
import { useLeague } from "./LeagueProvider";
import { useToast } from "./Feedback";
import { useFlags } from "./Flags";
import type { PlanOdds } from "./FocusView";
import { espnSetup } from "@/lib/espn/pages";

export interface EspnSyncValue {
  leagueId: string | null;
  /** `off`: not signed in, feature off, or this league can't use it. */
  status: LiveStatus | "off";
  /** War Room's own event stream, as opposed to the ESPN draft: shown when we're the broken part. */
  link: "idle" | "open" | "retrying" | "lost";
  /** ESPN's feed stopped making sense (8.6): picks are no longer applied and the board is the user's again. */
  degraded: DriftReport | null;
  /** How many times the ESPN tab has reconnected. More than one means picks may have been missed in between. */
  sessions: number;
  /** The board follows ESPN pick for pick; logging picks by hand is paused. */
  locked: boolean;
  /** ESPN has the user on the clock, so a pick can be made from War Room. */
  myTurn: boolean;
  /** The player armed to be drafted in ESPN (the first of two steps), if any. */
  armed: string | null;
  /** The latest pick made from War Room. */
  request: PickRequestView | null;
  /** ESPN's pick clock while the draft is live; `mine` when it's the user's team. Changes only when a clock frame arrives, so it's cheap to read. */
  clock: (ClockDeadline & { mine: boolean }) | null;
  /** This league as ESPN has it (8.8), once a bridge has read its settings. */
  espnLeague: EspnLeague | null;
  /** War Room's own connection to the user's ESPN draft room (Epic 9), once they've handed over a join code. */
  serverClient: ServerClientView | null;
  /** Asks War Room to take over, or hand back, the ESPN connection. Resolves with an error to show, or null. */
  serverClientAction(action: "take-over" | "hand-back"): Promise<string | null>;
  /** Sets ESPN's pick queue to the turn plan now, or keeps it synced (9.3). Resolves with an error to show, or null. */
  queuePlan(sync?: boolean): Promise<string | null>;
  /** ESPN has autopick on for the user's team: ESPN picks for them as soon as they're on the clock. */
  autopick: boolean;
  /** Turns ESPN's autopick off through War Room's connection. Resolves with an error to show, or null. */
  turnOffAutopick(): Promise<string | null>;
  /** Arms a player; arming the one already armed drafts him (double-click, or Enter twice). */
  arm(playerId: string): void;
  disarm(): void;
  /** Drafts the armed player in ESPN. */
  draftArmed(): void;
}

const noop = () => {};
const unavailable = async () => "ESPN live sync isn't connected";
const OFF: EspnSyncValue = {
  leagueId: null,
  status: "off",
  link: "idle",
  degraded: null,
  sessions: 0,
  locked: false,
  myTurn: false,
  armed: null,
  request: null,
  clock: null,
  espnLeague: null,
  serverClient: null,
  serverClientAction: unavailable,
  queuePlan: unavailable,
  autopick: false,
  turnOffAutopick: unavailable,
  arm: noop,
  disarm: noop,
  draftArmed: noop,
};
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
  const { state, hydrated, syncExternal, reload } = useDraft();
  const [snapshot, setSnapshot] = useState<LiveSnapshot | null>(null);
  // Stamped on arrival, so the countdown runs on this device's clock.
  const [clock, setClock] = useState<ClockDeadline | null>(null);
  const [connection, setConnection] = useState(0);
  /** The stream itself, as opposed to the draft: `lost` means War Room, not ESPN, is unreachable. */
  const [link, setLink] = useState<"idle" | "open" | "retrying" | "lost">("idle");
  const attempt = useRef(0);
  const enabled = flags.espnSyncEnabled && !!user && !!leagueId;

  // A league connected in the pairing popup: reconnect so its bridge's picks flow right away.
  useEffect(() => listenForEspnPaired((id) => id === leagueId && setConnection((n) => n + 1)), [leagueId]);

  // A phone coming back from a locked screen (9.7): the stream may be dead or frozen, and the clock
  // with it. Reopening starts with a fresh snapshot, which also resets the countdown.
  const streamOpen = useRef(false);
  /** Set while reopening on wake: the board keeps what it shows until the new snapshot replaces it, rather than unlocking for a moment. */
  const keepSnapshot = useRef(false);
  useEffect(() => {
    if (!enabled) return;
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const reopen = () => {
      attempt.current = 0;
      keepSnapshot.current = true;
      setConnection((n) => n + 1);
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt ??= Date.now();
        return;
      }
      if (resyncOnWake(hiddenAt, Date.now(), streamOpen.current)) reopen();
      hiddenAt = null;
    };
    // Restored from the back/forward cache: the page's old connections are gone.
    const onPageShow = (e: PageTransitionEvent) => e.persisted && reopen();
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
    };
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    const source = new EventSource(`/api/leagues/${encodeURIComponent(leagueId!)}/espn/stream`);
    const on = <T extends LiveEvent["type"]>(type: T, apply: (event: Extract<LiveEvent, { type: T }>) => void) =>
      source.addEventListener(type, (e) => apply(JSON.parse((e as MessageEvent<string>).data)));
    on("snapshot", (e) => {
      setSnapshot(e.snapshot);
      setClock(clockDeadline(e.snapshot.onClock, Date.now()));
    });
    on("pick", ({ pick }) =>
      setSnapshot((cur) =>
        cur && pick.n === cur.picks.length + 1 ? { ...cur, status: cur.status === "waiting" ? "live" : cur.status, picks: [...cur.picks, pick] } : cur,
      ),
    );
    on("clock", ({ onClock }) => {
      setSnapshot((cur) => cur && { ...cur, onClock });
      setClock(clockDeadline(onClock, Date.now()));
    });
    on("status", ({ status, draft }) => setSnapshot((cur) => cur && { ...cur, status, draft }));
    on("request", ({ request }) => setSnapshot((cur) => cur && { ...cur, request }));
    on("league", ({ espnLeague }) => setSnapshot((cur) => cur && { ...cur, espnLeague }));
    on("degraded", ({ degraded }) => setSnapshot((cur) => cur && { ...cur, degraded }));
    on("serverClient", ({ serverClient }) => setSnapshot((cur) => cur && { ...cur, serverClient }));
    on("autopick", ({ autopick }) => setSnapshot((cur) => cur && { ...cur, autopick }));
    // The server locked the board to ESPN's finished draft (APE-325).
    on("final", () => void reload());

    let retry: ReturnType<typeof setTimeout> | undefined;
    source.onopen = () => {
      attempt.current = 0;
      streamOpen.current = true;
      setLink("open");
    };
    source.onerror = () => {
      if (source.readyState !== EventSource.CLOSED) return; // still retrying by itself
      streamOpen.current = false;
      source.close();
      setSnapshot(null);
      setClock(null);
      // EventSource gives up for good on a non-200 (402/403 here), and never retries a closed
      // stream. A stream that opened at least once is a blip worth retrying; one that never did is
      // the server saying no, and retrying would only hammer it.
      if (!attempt.current && link === "idle") return setLink("lost");
      const wait = Math.min(30_000, 1000 * 2 ** attempt.current++);
      setLink("retrying");
      retry = setTimeout(() => setConnection((n) => n + 1), wait);
    };
    return () => {
      clearTimeout(retry);
      streamOpen.current = false;
      source.close();
      if (keepSnapshot.current) return void (keepSnapshot.current = false);
      setSnapshot(null);
      setClock(null);
    };
    // `link` is read inside onerror but must not re-open the stream; the ref carries the retry count.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled, leagueId, connection]);

  /* ---- apply live picks to the board ---- */
  const toldReplaced = useRef(false);
  const toldMismatch = useRef(false);
  const toldPartial = useRef(false);
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

    // Joined mid-draft with no catch-up: ESPN's picks arrive in order but their pick numbers are
    // this feed's, not the draft's. Say so rather than showing a board that's quietly short.
    if (mode === "merge" && !toldPartial.current) {
      toldPartial.current = true;
      toast("Picks made before you connected aren't on this board. Log them by hand, or reconnect from the start of a draft.");
    }

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
      if (!res) return toast("Couldn't reach Draft Room. Make this pick in ESPN.");
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

  /* ---- War Room's own ESPN connection (Epic 9) ---- */
  const post = useCallback(
    async (path: string, body: unknown): Promise<string | null> => {
      const res = await fetch(`/api/leagues/${encodeURIComponent(leagueId!)}/espn/${path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }).catch(() => null);
      if (!res) return "Couldn't reach Draft Room. Try again.";
      if (res.ok) return null;
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      return data.error ?? "That didn't work. Try again.";
    },
    [leagueId],
  );
  const serverClientAction = useCallback((action: "take-over" | "hand-back") => post("server-client", { action }), [post]);
  const queuePlan = useCallback((sync?: boolean) => post("queue", sync === undefined ? {} : { sync }), [post]);
  const turnOffAutopick = useCallback(() => post("autopick", {}), [post]);

  const toldDrift = useRef(false);
  useEffect(() => {
    if (!snapshot?.degraded || toldDrift.current) return;
    toldDrift.current = true;
    toast(`${snapshot.degraded.reason}. Log picks by hand from here; everything so far is kept.`);
  }, [snapshot?.degraded, toast]);

  // Say how a War Room pick turned out; a confirmed one simply appears on the board.
  const holding = snapshot?.serverClient?.state === "holding";
  const told = useRef<string | null>(null);
  useEffect(() => {
    if (!request || told.current === `${request.id}:${request.state}`) return;
    told.current = `${request.id}:${request.state}`;
    if (request.state === "superseded") toast("ESPN had already made a pick for you");
    else if (request.state === "refused") toast(holding ? "ESPN didn't have you on the clock." : "ESPN didn't have you on the clock. Check your ESPN tab.");
    else if (request.state === "expired") toast(holding ? "ESPN didn't confirm that pick. Try again, or hand back and pick in ESPN." : "ESPN didn't confirm that pick. Check your ESPN tab and pick there.");
  }, [request, toast, holding]);

  // Losing the connection War Room held is worth a toast wherever the user is looking.
  const serverClient = snapshot?.serverClient ?? null;
  const toldLost = useRef<string | null>(null);
  useEffect(() => {
    if (serverClient?.state !== "lost") return void (toldLost.current = null);
    if (toldLost.current) return;
    toldLost.current = serverClient.reason ?? "lost";
    toast(serverClient.reason ?? "Draft Room's connection to ESPN ended.");
  }, [serverClient, toast]);

  const value = useMemo<EspnSyncValue>(() => {
    if (!snapshot) return OFF;
    return {
      leagueId,
      status: snapshot.status,
      locked: snapshot.status === "live" && syncMode(snapshot) === "replace",
      myTurn,
      armed,
      request: sending ? { id: "sending", playerId: armedId ?? "", espnPlayerId: 0, state: "pending" } : request,
      clock: snapshot.status === "live" && clock ? { ...clock, mine: clock.teamId === snapshot.espnTeamId } : null,
      espnLeague: snapshot.espnLeague,
      serverClient: flags.espnServerClientEnabled ? snapshot.serverClient : null,
      serverClientAction,
      queuePlan,
      autopick: snapshot.status === "live" && snapshot.autopick,
      turnOffAutopick,
      link,
      degraded: snapshot.degraded,
      sessions: snapshot.sessions,
      arm,
      disarm,
      draftArmed,
    };
  }, [leagueId, snapshot, clock, link, myTurn, armed, armedId, sending, request, arm, disarm, draftArmed, flags.espnServerClientEnabled, serverClientAction, queuePlan, turnOffAutopick]);

  return <EspnSyncContext.Provider value={value}>{children}</EspnSyncContext.Provider>;
}

const CHIP: Record<Exclude<LiveStatus, "waiting">, { label: string; title: string }> = {
  live: { label: "● ESPN live", title: "Picks from your ESPN draft land here as they're made. Logging picks by hand is paused." },
  "bridge-offline": { label: "ESPN tab closed", title: "Your ESPN draft tab stopped checking in. Log picks by hand, or reopen the tab and click the Draft Room bookmark." },
  complete: { label: "ESPN draft done", title: "Your ESPN draft is complete." },
};

/**
 * Header status: the sync state while it's set up. Setting it up ("Sync ESPN draft") is a row in the
 * draft tools menu instead (Epic 15), so a waiting sync shows nothing here. A final draft (APE-325)
 * says so, live sync or not: it's why the board can't be edited.
 */
export function EspnSyncChip() {
  const { status, link, degraded, sessions, serverClient } = useEspnSync();
  const { state } = useDraft();
  if (state.final && status !== "live") {
    return (
      <span className={s.btn} title="This board is your ESPN draft, pick for pick. It's final, so it can't be edited here." role="status">
        ESPN draft final
      </span>
    );
  }
  if (status === "off") return null;
  if (degraded) {
    return (
      <span className={s.btn} title={`${degraded.reason}. Picks are yours to log again; nothing captured so far is lost.`} role="status">
        ESPN sync paused
      </span>
    );
  }
  if (link === "retrying" || link === "lost") {
    return (
      <span className={s.btn} title={link === "retrying" ? "Reaching Draft Room again. Your board still works." : "Draft Room's live connection dropped. Reload to try again."} role="status">
        {link === "retrying" ? "Reconnecting…" : "Sync disconnected"}
      </span>
    );
  }
  if (status === "waiting") return null;
  if (serverClient?.state === "holding" && status === "live") {
    return (
      <span className={cx("btn", "on")} title="Draft Room holds your ESPN draft connection: draft here, on any device. Your ESPN draft is disconnected until you hand back." role="status">
        ● Drafting via Draft Room
      </span>
    );
  }
  const chip = CHIP[status];
  // A reload of the ESPN tab starts a new bridge session, and picks made while it was away are
  // missing from the board, so it's worth saying rather than hiding in a snapshot field.
  const reconnected = sessions > 1 ? ` Your ESPN tab reconnected ${sessions - 1} time${sessions > 2 ? "s" : ""}; picks made in between may be missing.` : "";
  return (
    <span className={cx("btn", status === "live" && "on")} title={chip.title + reconnected} role="status">
      {chip.label}
    </span>
  );
}

/** The countdown's own prefix on the tab title, so it can be swapped each tick without touching the rest. */
const TITLE_CLOCK = /^\d+:\d\d · /;

/**
 * ESPN's pick clock, counted down locally between the 5s clock frames (8.17). The only thing that
 * re-renders each tick. On the user's turn it's big, goes amber at 30s and red at 10s, buzzes a
 * phone once at 10s, and puts the time at the front of the tab title.
 */
export function EspnClock() {
  const { clock } = useEspnSync();
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!clock) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0); // `now` may be from long before this clock arrived
    const id = setInterval(tick, 250);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, [clock]);

  const left = clock ? clock.deadline - now : 0;
  const mine = !!clock?.mine;
  const text = formatClock(left);

  const buzzed = useRef(false);
  useEffect(() => {
    if (!mine) buzzed.current = false;
    else if (left <= 10_000 && left > 0 && !buzzed.current) {
      buzzed.current = true;
      navigator.vibrate?.([80, 80, 80]);
    }
  }, [mine, left]);

  useEffect(() => {
    const bare = document.title.replace(TITLE_CLOCK, "");
    document.title = mine ? `${text} · ${bare}` : bare;
  }, [mine, text]);
  useEffect(() => () => void (document.title = document.title.replace(TITLE_CLOCK, "")), []);

  if (!clock) return null;
  return (
    <span className={cx("espnClock", mine && "mine", mine && clockUrgency(left))} title={mine ? "Time left on your ESPN pick" : "Time left for the team on the clock in ESPN"} aria-hidden="true">
      {text}
    </span>
  );
}

const isTyping = () => {
  const el = document.activeElement;
  return !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || (el as HTMLElement).isContentEditable);
};

/**
 * ESPN's league settings, followed (8.8, APE-325). A league connected to ESPN is ESPN's: when the
 * bridge reads settings or a name that differ from the board's, the board takes them, keeping only
 * its own Value/Reach threshold. The server saves them too, so this only keeps the open board in step.
 * Even mid-draft: the picks come from ESPN, and they mean what ESPN's settings say they mean.
 */
export function EspnLeagueFollower() {
  const { espnLeague } = useEspnSync();
  const { league, active, updateLeague } = useLeague();
  const { state } = useDraft();
  const toast = useToast();

  const take = useEffectEvent((settings: Omit<LeagueSettings, "valueThreshold">) => {
    const differences = leagueDifferences(league, settings);
    if (!active || !differences.length) return;
    updateLeague({ settings: { ...settings, valueThreshold: league.valueThreshold } });
    toast(`League settings updated from ESPN: ${differences.join(", ")}`);
  });
  const settings = espnLeague?.ok ? espnLeague.settings : null;
  const key = settings && JSON.stringify(settings);
  useEffect(() => {
    if (settings) take(settings);
    // `key` stands for `settings`, which is a new object on every snapshot.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const espnName = espnLeague?.name;
  const rename = useEffectEvent((name: string) => {
    if (active && active.name !== name) updateLeague({ name });
  });
  useEffect(() => {
    if (espnName) rename(espnName);
  }, [espnName]);

  // ESPN is the authority on when a paired league drafts: before the first pick, when the
  // commissioner sets or moves the draft, the board follows without asking. Only on a change from
  // ESPN — a date the user types afterwards stands until ESPN moves the draft again.
  const espnDraftAt = espnLeague?.draftAt;
  const followed = useRef<string | undefined>(undefined);
  const follow = useEffectEvent((at: string) => {
    if (state.picks.length || !active || active.draftAt === at) return;
    updateLeague({ draftAt: at });
    toast("Draft time updated from ESPN");
  });
  useEffect(() => {
    if (!espnDraftAt || followed.current === espnDraftAt) return;
    followed.current = espnDraftAt;
    follow(espnDraftAt);
  }, [espnDraftAt]);

  return null;
}

const MINUTE = 60 * 1000;

/**
 * Draft day for a league connected to ESPN (APE-336): from when ESPN opens the draft room, an hour
 * before the draft, until a little after it starts, and while the draft isn't connected yet, a
 * banner says it's time to tap the bookmark in ESPN's draft. The email says the same to anyone away
 * from Draft Room (src/lib/server/seasonDraftDay.ts). Only for a draft time with a time of day.
 */
export function EspnDraftDay() {
  const user = useAccount();
  const { active } = useLeague();
  const { state } = useDraft();
  const { status } = useEspnSync();
  const at = active?.espn && active.draftAt?.includes("T") ? Date.parse(active.draftAt) : NaN;
  const pending = !!user && Number.isFinite(at) && !state.picks.length && !state.final && (status === "off" || status === "waiting");
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    if (!pending) return;
    const tick = () => setNow(Date.now());
    const first = setTimeout(tick, 0);
    const every = setInterval(tick, 30_000);
    return () => {
      clearTimeout(first);
      clearInterval(every);
    };
  }, [pending]);

  if (!pending || !active || now === null || now < at - 60 * MINUTE || now > at + 30 * MINUTE) return null;
  return (
    <div className={s.espnArm} role="region" aria-label="Your ESPN draft room is open">
      <span className={s.espnArmText}>
        Your ESPN draft room is open
        <small>Open your draft on ESPN and tap your Draft Room bookmark there, so every pick lands on this board as it happens.</small>
      </span>
      <a className={cx("btn", "espnGo")} href={espnSetup("draft", active.id)} target="_blank" rel="noreferrer">
        Connect your ESPN draft
      </a>
    </div>
  );
}

/** What `POST /api/leagues/:id/espn/reconcile` did (src/lib/server/espn/draftImport.ts). */
type Reconciled = { kind: "imported" | "already-final" | "not-finished" | "no-login" | "no-league" } | { kind: "mismatch"; reason: string };

/**
 * A connected league's finished draft, made ESPN's (APE-325). The server locks the board when ESPN
 * says the draft is over; this catches every other way a draft finishes: a draft room opened after
 * it (or before this existed), or a live feed that couldn't vouch for every pick. Asked once per
 * league per visit, and only once the draft may have happened. Without a way to read ESPN's
 * record, it offers to connect the season, which brings one.
 */
export function EspnFinalDraft() {
  const user = useAccount();
  const { active } = useLeague();
  const { state, hydrated, reload } = useDraft();
  const model = useModel();
  const { status } = useEspnSync();
  const toast = useToast();
  const [result, setResult] = useState<Reconciled | null>(null);
  const asked = useRef<string | null>(null);
  /** Bumped to ask again once a live draft has finished. */
  const [retry, setRetry] = useState(0);

  const leagueId = active?.espn ? active.id : null;
  const draftAt = active?.draftAt ? Date.parse(active.draftAt) : NaN;
  const ask = !!user && hydrated && !!leagueId && !state.final;
  const over = model.done || status === "complete";

  const reconcile = useEffectEvent(async (id: string) => {
    const res = await fetch(`/api/leagues/${encodeURIComponent(id)}/espn/reconcile`, { method: "POST" }).catch(() => null);
    const body = res?.ok ? ((await res.json().catch(() => null)) as { result?: Reconciled } | null) : null;
    if (!body?.result || asked.current !== id) return;
    setResult(body.result);
    if (body.result.kind === "imported") {
      await reload();
      toast("Your board now matches your ESPN draft");
    } else if (body.result.kind === "mismatch") {
      toast(`Your ESPN draft doesn't fit this league's board: ${body.result.reason}.`);
    }
  });
  useEffect(() => {
    // Not before the draft could have happened: a draft day still ahead means there's nothing to read.
    if (!ask || !leagueId || asked.current === leagueId || (!over && draftAt > Date.now())) return;
    asked.current = leagueId;
    setResult(null);
    void reconcile(leagueId);
  }, [ask, leagueId, over, draftAt, retry]);

  // A live feed that just finished: the server locks the board itself when it can. If it hasn't
  // shortly after, ask again, which says what's missing.
  useEffect(() => {
    if (status !== "complete" || state.final || !leagueId) return;
    const t = setTimeout(() => {
      asked.current = null;
      setRetry((n) => n + 1);
    }, 20_000);
    return () => clearTimeout(t);
  }, [status, state.final, leagueId]);

  if (!ask || result?.kind !== "no-login" || !over) return null;
  return (
    <div className={s.espnArm} role="region" aria-label="Final ESPN draft results">
      <span className={s.espnArmText}>
        Lock in your ESPN draft
        <small>Connect your ESPN league for the season, and Draft Room makes this board your ESPN draft, pick for pick.</small>
      </span>
      <a className={cx("btn", "espnGo")} href={espnSetup("season")} target="_blank" rel="noreferrer">
        Sync final results from ESPN
      </a>
    </div>
  );
}

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
