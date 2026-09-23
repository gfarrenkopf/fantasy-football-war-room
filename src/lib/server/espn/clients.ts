import "server-only";
import WebSocket from "ws";
import { config } from "@/lib/config";
import type { Db } from "@/lib/db/types";
import type { ServerClientView } from "@/lib/espn/live";
import { draftListFrame, selectFrame } from "@/lib/espn/join";
import { createEspnClient, type Connect, type EndReason, type EspnClient, type EspnSocket } from "./client";
import { getRelay } from "./live";
import { deleteCredential, hasCredential, loadCredential, setServerClientState } from "./serverClients";

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
  detach: () => void;
}

const g = globalThis as { __espnClients?: Map<string, Running> };
const running = () => (g.__espnClients ??= new Map());

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
export async function takeOver(db: Db, userId: string, leagueId: string, { connect = wsConnect } = {}): Promise<TakeOverResult> {
  const key = config.espnCodeKey;
  if (!config.espnServerClientEnabled || !key) return { ok: false, reason: "unavailable" };
  const current = running().get(userId);
  if (current?.leagueId === leagueId) return { ok: true };
  const stored = await loadCredential(db, key, userId, leagueId);
  if (!stored) return { ok: false, reason: "no-credential" };
  if (current) await handBack(db, userId, current.leagueId);
  if (running().size >= MAX_CLIENTS) return { ok: false, reason: "busy" };

  const relay = getRelay();
  const { scope } = stored;
  // After a restart the relay knows nothing about this draft; the settings the bridge handed over say what league it is.
  if (stored.leagueSettings) relay.setLeague(scope, stored.leagueSettings);
  view(userId, leagueId, { state: "connecting" });
  await setServerClientState(db, userId, leagueId, "holding");

  const client = createEspnClient({
    connect,
    relay,
    scope,
    credential: { code: stored.code, swid: stored.swid },
    pickTeams: stored.pickTeams,
    onJoin: () => view(userId, leagueId, { state: "holding" }),
    onEnd: (reason, detail) => ended(db, userId, leagueId, client, reason, detail),
  });
  // Picks and queue updates from War Room go straight out on this socket (9.3).
  const detach = relay.attachSender(userId, leagueId, {
    select: (espnPlayerId) => client.send(selectFrame(espnPlayerId)),
    setQueue: (ids) => client.send(draftListFrame(ids)),
  });
  // A draft never outlives its credential.
  const hardStop = setTimeout(() => client.stop("War Room's hold on this draft ran out of time."), Math.max(0, stored.expiresAt.getTime() - Date.now()));
  running().set(userId, { leagueId, client, hardStop, detach });
  return { ok: true };
}

function ended(db: Db, userId: string, leagueId: string, client: EspnClient, reason: EndReason, detail: string) {
  const entry = running().get(userId);
  if (entry?.client === client) {
    clearTimeout(entry.hardStop);
    entry.detach();
    running().delete(userId);
  }
  if (reason === "complete") {
    view(userId, leagueId, { state: "complete" });
    void deleteCredential(db, userId, leagueId).catch(logFailure("deleting a completed draft's code"));
  } else if (reason === "stopped") {
    view(userId, leagueId, { state: "released" });
    void setServerClientState(db, userId, leagueId, "released").catch(logFailure("releasing"));
  } else {
    view(userId, leagueId, { state: "lost", reason: detail });
    void setServerClientState(db, userId, leagueId, "lost").catch(logFailure("marking lost"));
    console.warn(`[espn-client] ${reason} league=${leagueId}`);
  }
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
