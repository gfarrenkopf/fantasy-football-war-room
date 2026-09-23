import "server-only";
import { randomBytes } from "node:crypto";
import WebSocket from "ws";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import type { ServerClientView } from "@/lib/espn/live";
import { draftListFrame, selectFrame } from "@/lib/espn/join";
import { createEspnClient, type Connect, type EndInfo, type EndReason, type EspnClient, type EspnSocket } from "./client";
import { getRelay } from "./live";
import { deleteCredential, hasCredential, listHolding, loadCredential, setServerClientState } from "./serverClients";

/**
 * The server-side ESPN clients running in this process (9.2), one per user at most. Like the relay,
 * they live on globalThis: one Next process serves the hosted app (deploy/warroom.service).
 *
 * The client's state is mirrored twice: into the relay, so every war room watching sees it, and into
 * the database, so a restarted process knows which drafts it was holding (9.5).
 */

interface Running {
  leagueId: string;
  client: EspnClient;
  hardStop: ReturnType<typeof setTimeout>;
}

const g = globalThis as { __espnClients?: Map<string, Running>; __espnStarting?: Set<string> };
const running = () => (g.__espnClients ??= new Map());
/** Users whose take-over is waiting on their ESPN tab to stand down, so a second tap doesn't start a second client. */
const starting = () => (g.__espnStarting ??= new Set());

/**
 * How long a take-over waits for an open ESPN tab's bridge to hear that War Room is taking over.
 * The bridge checks in at least every 5s; told first, it keeps ESPN's page from reconnecting and
 * taking the connection straight back.
 */
export const STAND_DOWN_MS = 7_000;
/** After the bridge is told: time for it to close the page's own socket before War Room joins. */
const STAND_DOWN_GRACE_MS = 750;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Concurrent clients per process. Each is one socket and a few timers; this bounds a runaway. */
export const MAX_CLIENTS = 200;

/** `ws` behind the client's small socket interface. */
export const wsConnect: Connect = (url, headers) => {
  const ws = new WebSocket(url, { headers, perMessageDeflate: true, handshakeTimeout: 15_000 });
  const socket: EspnSocket = {
    on(event, listener) {
      const emit = listener as (...args: unknown[]) => void;
      if (event === "message") ws.on("message", (data: WebSocket.RawData) => emit(data.toString()));
      else if (event === "unexpected-response") ws.on("unexpected-response", (_req, res) => emit(res.statusCode ?? 0));
      else if (event === "close") ws.on("close", (code: number, reason: Buffer) => emit(code, reason.toString().slice(0, 120)));
      else ws.on(event, emit);
    },
    send: (data) => ws.send(data),
    close: () => ws.close(),
  };
  return socket;
};

export type TakeOverResult = { ok: true } | { ok: false; reason: "unavailable" | "no-credential" | "busy" };

function view(userId: string, leagueId: string, next: ServerClientView | null) {
  getRelay().setServerClient(userId, leagueId, next);
}

/** Logs a failed bookkeeping write. Never the credential: nothing here has it in scope. */
const logFailure = (what: string) => (err: unknown) => console.error(`[espn-client] ${what}: ${(err as Error).message}`);

/**
 * Joins ESPN's draft room for this league with the stored join code. Idempotent for a league that's
 * already held; a client for the user's other league is handed back first (one per user).
 */
export async function takeOver(
  db: Db,
  userId: string,
  leagueId: string,
  { connect = wsConnect, resuming = false, standDownMs = STAND_DOWN_MS } = {},
): Promise<TakeOverResult> {
  const key = config.espnCodeKey;
  if (!config.espnServerClientEnabled || !key) return { ok: false, reason: "unavailable" };
  const current = running().get(userId);
  if (current?.leagueId === leagueId || starting().has(userId)) return { ok: true };
  const stored = await loadCredential(db, key, userId, leagueId);
  if (!stored) return { ok: false, reason: "no-credential" };
  if (current) await handBack(db, userId, current.leagueId);
  if (running().size >= MAX_CLIENTS) return { ok: false, reason: "busy" };

  const relay = getRelay();
  const { scope } = stored;
  // After a restart the relay knows nothing about this draft; the settings the bridge handed over say what league it is.
  if (stored.leagueSettings) relay.setLeague(scope, stored.leagueSettings);
  view(userId, leagueId, resuming ? { state: "connecting", reason: "War Room restarted. Rejoining your ESPN draft room…" } : { state: "connecting" });
  await setServerClientState(db, userId, leagueId, "holding");

  // An ESPN tab left open would reconnect and take the connection straight back. Tell its bridge
  // first, so it keeps the page from reconnecting, then join.
  starting().add(userId);
  try {
    if (relay.requestHold(userId, leagueId).bridgeLive) {
      const until = Date.now() + standDownMs;
      while (!relay.bridgeStoodDown(userId, leagueId) && Date.now() < until) await sleep(100);
      if (relay.bridgeStoodDown(userId, leagueId)) await sleep(STAND_DOWN_GRACE_MS);
    }
  } finally {
    starting().delete(userId);
  }

  const session = `srv${randomBytes(9).toString("hex")}`;
  let detach = () => relay.releaseHold(userId, leagueId);
  const client = createEspnClient({
    connect,
    relay,
    scope,
    session,
    credential: { code: stored.code, swid: stored.swid },
    pickTeams: stored.pickTeams,
    onJoin: () => {
      // Joined: this connection is the draft now, and War Room's picks go out on it (9.3).
      detach = relay.attachSender(
        userId,
        leagueId,
        { select: (espnPlayerId) => client.send(selectFrame(espnPlayerId)), setQueue: (ids) => client.send(draftListFrame(ids)) },
        session,
      );
      view(userId, leagueId, { state: "holding" });
    },
    onEnd: (reason, detail, info) => {
      detach();
      ended(db, userId, leagueId, client, reason, detail, info);
    },
  });
  // A draft never outlives its credential.
  const hardStop = setTimeout(() => client.stop("War Room's hold on this draft ran out of time."), Math.max(0, stored.expiresAt.getTime() - Date.now()));
  running().set(userId, { leagueId, client, hardStop });
  return { ok: true };
}

function ended(db: Db, userId: string, leagueId: string, client: EspnClient, reason: EndReason, detail: string, info: EndInfo) {
  const entry = running().get(userId);
  if (entry?.client === client) {
    clearTimeout(entry.hardStop);
    running().delete(userId);
  }
  // Why a connection ended, for telling ESPN taking it back from a network drop. Never the code.
  const heldFor = info.joinedForMs === null ? "never-joined" : `${Math.round(info.joinedForMs / 1000)}s`;
  console.log(`[espn-client] ended ${reason} league=${leagueId} held=${heldFor} close=${info.closeCode ?? "-"}${info.closeReason ? ` "${info.closeReason}"` : ""}`);
  if (reason === "complete") {
    view(userId, leagueId, { state: "complete" });
    void deleteCredential(db, userId, leagueId).catch(logFailure("deleting a completed draft's code"));
  } else if (reason === "stopped") {
    view(userId, leagueId, { state: "released" });
    void setServerClientState(db, userId, leagueId, "released").catch(logFailure("releasing"));
  } else {
    view(userId, leagueId, { state: "lost", reason: detail, ...(reason === "refused" ? { refused: true } : {}) });
    void setServerClientState(db, userId, leagueId, "lost").catch(logFailure("marking lost"));
  }
}

/**
 * Rejoins every draft this process's predecessor was holding (9.5): a deploy or crash restarts the
 * process, and the socket dies with it. Picks made in the gap come back through INIT catch-up. The
 * user's clock doesn't wait for this, which is what ESPN's queue (9.3) is for.
 */
export async function resumeServerClients(db: Db, { connect = wsConnect } = {}): Promise<number> {
  if (!config.espnServerClientEnabled) return 0;
  const holding = await listHolding(db);
  let resumed = 0;
  for (const { userId, leagueId } of holding) {
    const result = await takeOver(db, userId, leagueId, { connect, resuming: true }).catch((err: unknown) => {
      logFailure("resuming a draft")(err);
      return null;
    });
    if (result?.ok) resumed++;
    else if (result) await setServerClientState(db, userId, leagueId, "lost").catch(logFailure("marking lost"));
  }
  if (holding.length) console.log(`[espn-client] resumed ${resumed} of ${holding.length} held drafts`);
  return resumed;
}

/** Closes War Room's connection, so the user can reconnect in ESPN. */
export async function handBack(db: Db, userId: string, leagueId: string): Promise<void> {
  const entry = running().get(userId);
  if (entry?.leagueId === leagueId) {
    entry.client.stop();
    await entry.client.flush();
  } else {
    // Nothing running here (e.g. it was lost): just record that the user took it back.
    await setServerClientState(db, userId, leagueId, "released");
    view(userId, leagueId, (await hasCredential(db, userId, leagueId)) ? { state: "released" } : null);
  }
}

/** The running client for a league, if this process holds its ESPN connection. */
export function clientFor(userId: string, leagueId: string): EspnClient | null {
  const entry = running().get(userId);
  return entry?.leagueId === leagueId ? entry.client : null;
}

/**
 * Tells the relay about a league's stored credential: after a hand-over (`fresh`, a new code the user
 * can take over with), or when a war room opens and the relay doesn't know yet, e.g. after a restart.
 * A `holding` row with no client in this process is a draft it isn't holding (9.5 rejoins those at
 * boot), so it shows as lost.
 */
export async function noteCredential(db: Db, userId: string, leagueId: string, { fresh = false } = {}): Promise<void> {
  if (!config.espnServerClientEnabled || clientFor(userId, leagueId)) return;
  if (!fresh && getRelay().serverClient(userId, leagueId)) return;
  const row = await hasCredential(db, userId, leagueId);
  if (!row) return;
  const next: ServerClientView =
    fresh || row.state === "stored"
      ? { state: "stored" }
      : row.state === "released"
        ? { state: "released" }
        : { state: "lost", reason: row.state === "holding" ? "War Room restarted and isn't holding your ESPN connection." : "War Room's connection to ESPN ended." };
  view(userId, leagueId, next);
}
