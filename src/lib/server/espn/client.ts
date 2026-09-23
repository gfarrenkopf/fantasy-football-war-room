import { catchUpFrames, decodeInitPicks, ESPN_SOCKET_ORIGIN, ESPN_USER_AGENT, joinUrl, PING_MS, pingFrame, sanitizeFrame } from "@/lib/espn/join";
import type { CommandResult, IngestResult, RelayScope } from "./relay";

/**
 * War Room's own client for ESPN's draft socket (9.2): what the bookmarklet does from the user's
 * ESPN tab, done from our server with the join code the user handed over (9.1), so they can draft
 * from a phone with no ESPN tab open anywhere.
 *
 * It feeds the relay exactly like a bridge session: sanitized frames by offset, a heartbeat every
 * 5s, and INIT catch-up when it joins mid-draft. Everything downstream (the feed, crosswalk, picks,
 * the clock) is the bridge's path, unchanged.
 *
 * ESPN allows one connection per team, so joining disconnects the user's own ESPN draft room. That
 * cost is why this never reconnects on its own: a close we didn't ask for ends the client as `lost`,
 * and the user decides what happens next (9.4).
 *
 * No `ws`, `config` or database here: the socket and relay are injected so tests can drive it.
 */

/** A socket's events and their arguments. `message` data is text. */
export interface EspnSocketEvents {
  open: [];
  message: [data: string];
  close: [];
  error: [err: Error];
  /** The join was answered with an HTTP status instead of a socket, e.g. 403 without a browser User-Agent. */
  "unexpected-response": [status: number];
}

/** Just what the client needs of a socket. */
export interface EspnSocket {
  on<E extends keyof EspnSocketEvents>(event: E, listener: (...args: EspnSocketEvents[E]) => void): void;
  send(data: string): void;
  close(): void;
}

export type Connect = (url: string, headers: Record<string, string>) => EspnSocket;

/**
 * Why the client ended:
 * - `complete`: the draft finished (STATE 2).
 * - `refused`: ESPN wouldn't let it join (a bad or expired code, or an HTTP error).
 * - `lost`: the socket closed or went quiet without us closing it.
 * - `stopped`: we stopped it (the user handed back, or it ran out of time).
 */
export type EndReason = "complete" | "refused" | "lost" | "stopped";

export interface EspnClientOptions {
  connect: Connect;
  relay: { ingest(scope: RelayScope, session: string, seq: number, frames: readonly string[], result?: CommandResult): Promise<IngestResult> };
  scope: RelayScope;
  credential: { code: string; swid: string };
  /** Who owns each overall pick, for catching up from INIT. */
  pickTeams: readonly number[] | null;
  now?: () => number;
  session?: string;
  /** Joined: ESPN accepted the code and the draft is arriving. */
  onJoin?: () => void;
  /** Called once. `detail` is words for the user; it never contains the join code. */
  onEnd?: (reason: EndReason, detail: string) => void;
  /** A pick command the relay handed back; the client sends it and reports on the next check-in (9.3). */
  onCommand?: (command: { id: string; select: number }) => CommandResult;
}

export interface EspnClient {
  readonly session: string;
  /** Sends a frame on ESPN's socket. False unless joined. */
  send(frame: string): boolean;
  /** Ends the client as `stopped` and closes the socket. */
  stop(detail?: string): void;
  /** Delivers queued frames now instead of on the next tick. */
  flush(): Promise<void>;
  joined(): boolean;
}

export const FLUSH_MS = 250;
export const HEARTBEAT_MS = 5_000;
/** ESPN sends a CLOCK frame every 5s and answers every PING; this much silence means the socket is dead. */
export const SILENCE_MS = 60_000;
/** How long a join may take before it counts as refused. */
export const JOIN_TIMEOUT_MS = 20_000;
const MAX_BATCH = 500;

export function createEspnClient({
  connect,
  relay,
  scope,
  credential,
  pickTeams,
  now = Date.now,
  session = `srv${now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
  onJoin,
  onEnd,
  onCommand,
}: EspnClientOptions): EspnClient {
  const log: string[] = [];
  let sent = 0;
  let inFlight: Promise<void> | null = null;
  let lastPost = -Infinity;
  let lastHeard = now();
  let open = false;
  let joined = false;
  let caughtUp = false;
  let ended = false;
  let result: CommandResult | undefined;
  const timers: ReturnType<typeof setInterval>[] = [];

  const socket = connect(
    joinUrl({ espnLeagueId: scope.espnLeagueId, espnTeamId: scope.espnTeamId, swid: credential.swid, code: credential.code }),
    { Origin: ESPN_SOCKET_ORIGIN, "User-Agent": ESPN_USER_AGENT },
  );

  function end(reason: EndReason, detail: string) {
    if (ended) return;
    ended = true;
    open = false;
    for (const t of timers) clearInterval(t);
    try {
      socket.close();
    } catch {
      /* already closed */
    }
    // Whatever arrived last still goes to the relay, STATE 2 above all. Nothing to send means no
    // check-in either: a client that never joined mustn't make the draft look live.
    const last = sent < log.length || inFlight ? flush() : Promise.resolve();
    void last.finally(() => onEnd?.(reason, detail));
  }

  async function post(): Promise<void> {
    const frames = log.slice(sent, sent + MAX_BATCH);
    const reporting = result;
    lastPost = now();
    let reply: IngestResult;
    try {
      reply = await relay.ingest(scope, session, sent, frames, reporting);
    } catch (err) {
      console.warn(`[espn-client] relay refused frames league=${scope.espnLeagueId}: ${(err as Error).message}`);
      return;
    }
    if (reply.status === 413) return end("stopped", "This draft sent more frames than War Room keeps.");
    sent = Math.min(Math.max(0, reply.have), log.length);
    if (result === reporting) result = undefined;
    if (reply.status === 200 && reply.command && onCommand && !ended) {
      result = onCommand(reply.command);
      lastPost = -Infinity; // report it straight away
    }
  }

  function flush(): Promise<void> {
    if (inFlight) return inFlight;
    if (sent >= log.length && result === undefined && now() - lastPost < HEARTBEAT_MS) return Promise.resolve();
    inFlight = (async () => {
      try {
        // Until the relay has everything, as long as each post makes progress (a failing relay can't spin this).
        let before;
        do {
          before = sent;
          await post();
        } while (sent > before && sent < log.length);
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  socket.on("open", () => {
    if (ended) return;
    open = true;
    lastHeard = now();
    timers.push(setInterval(() => open && socket.send(pingFrame(now())), PING_MS));
  });

  socket.on("message", (data) => {
    if (ended) return;
    lastHeard = now();
    const text = String(data);
    const head = text.trim().split(" ", 1)[0];
    if (head === "INIT" || head === "TOKEN") {
      if (!joined) {
        joined = true;
        onJoin?.();
      }
    }
    // INIT is the draft so far: only useful before any pick of our own arrived, i.e. we joined late.
    if (head === "INIT" && !caughtUp && !log.some((f) => f.startsWith("SELECTED "))) {
      caughtUp = true;
      const ids = decodeInitPicks(text.trim().slice(5), Number(scope.espnLeagueId));
      if (ids) log.push(...catchUpFrames(ids, pickTeams));
    }
    // A refused join isn't draft data: relaying it would mark the whole draft's feed untrustworthy (8.6),
    // including a bookmarklet that's still working fine.
    if (head === "ERROR" && !joined) return end("refused", "ESPN refused War Room's connection to your draft room. Run the bookmarklet again to hand over a fresh code.");
    const frame = sanitizeFrame(text);
    if (!frame) return;
    log.push(frame);
    if (frame === "STATE 2") return end("complete", "The draft is complete.");
    void flush();
  });

  socket.on("unexpected-response", (status) => end("refused", `ESPN refused War Room's connection (HTTP ${status}).`));
  socket.on("error", () => {
    // Always followed by `close`, which says what it means for the user.
  });
  socket.on("close", () =>
    end(
      joined ? "lost" : "refused",
      joined
        ? "ESPN closed War Room's connection. If you reconnected in ESPN, you're drafting there now."
        : "Couldn't join your ESPN draft room. It opens about an hour before the draft.",
    ),
  );

  timers.push(
    setInterval(() => {
      if (ended) return;
      if (!joined && now() - lastHeard > JOIN_TIMEOUT_MS) return end("refused", "ESPN didn't answer War Room's connection.");
      if (joined && now() - lastHeard > SILENCE_MS) return end("lost", "ESPN stopped answering War Room's connection.");
      if (joined) void flush();
    }, FLUSH_MS),
  );

  return {
    session,
    send(frame) {
      if (!open || !joined || ended) return false;
      socket.send(frame);
      return true;
    },
    stop(detail = "Handed back to you.") {
      end("stopped", detail);
    },
    flush,
    joined: () => joined && !ended,
  };
}
