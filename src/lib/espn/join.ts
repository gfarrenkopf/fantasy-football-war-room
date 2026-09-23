/**
 * Joining ESPN's draft socket from War Room's own server (Epic 9), and the bits of the bridge
 * (public/espn-bridge.js) the server-side client needs too: frame sanitizing and the INIT catch-up
 * decoder. The bridge is a plain script with no build step, so these are ports, kept in step by a
 * parity test in bridge.test.ts. Protocol details are in docs/espn-protocol.md §3 and §4.1.
 *
 * Pure: no sockets, no env.
 */

/** ESPN answers a join without a browser User-Agent with HTTP 403, before any frame. */
export const ESPN_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";
export const ESPN_SOCKET_ORIGIN = "https://fantasy.espn.com";

/** How often the page pings. */
export const PING_MS = 15_000;

export interface JoinParams {
  espnLeagueId: string;
  espnTeamId: number;
  /** `{GUID}` */
  swid: string;
  /** The draft room's join code; can be negative. */
  code: string;
}

/** The draft socket URL, exactly as ESPN's own page builds it. */
export function joinUrl({ espnLeagueId: league, espnTeamId: team, swid, code }: JoinParams, nocache = Math.random()): string {
  return (
    `wss://fantasydraft.espn.com/game-1/league-${league}/JOIN?1=1&2=${league}&3=${team}&4=${swid}` +
    `&5=1:${league}:${team}:${swid}:${code}&6=false&7=false&8=KONA&nocache=${nocache}`
  );
}

/** The heartbeat. It must end in a newline: without one ESPN drops the client after about a minute. */
export const pingFrame = (ms: number) => `PING PING%20${ms}\n`;

/** A pick, as ESPN's own Draft button sends it. */
export const selectFrame = (espnPlayerId: number) => `SELECT ${espnPlayerId}\n`;

/** Switches ESPN's autopick for the user's own team, as the toggle in ESPN's Pick Queue panel does. */
export const autodraftFrame = (on: boolean) => `AUTODRAFT ${on}\n`;

/** Sets ESPN's pick queue to these players, in order, replacing whatever was queued. */
export const draftListFrame = (espnPlayerIds: readonly number[]) => `DRAFT_LIST ${espnPlayerIds.join(" ")}\n`;

const ZERO_GUID = "{00000000-0000-0000-0000-000000000000}";

/**
 * What of a frame goes into the relay: the bridge's `sanitize()`. INIT and TOKEN go as bare names
 * (TOKEN echoes the join credential), PONG and blanks are dropped, and member GUIDs are zeroed.
 */
export function sanitizeFrame(raw: string): string | null {
  const text = String(raw).trim();
  const head = text.split(" ", 1)[0];
  if (head === "PONG" || head === "") return null;
  if (head === "INIT" || head === "TOKEN") return head;
  return text.replace(/\{[0-9A-Fa-f-]{36}\}/g, ZERO_GUID);
}

/**
 * The drafted player ids in INIT, in pick order, or null if this isn't the layout we know: the
 * bridge's `decodeInitPicks()` (8.12). One 45-byte record per pick slot, the player id as a
 * big-endian int32 at the top and the league id 33 bytes in.
 */
export function decodeInitPicks(b64: string, league: number): number[] | null {
  const STRIDE = 45;
  const LEAGUE_AT = 33;
  let bytes: Uint8Array;
  try {
    // "INIT <base64> ####…": base64 without its = padding, then a run of # padding.
    const clean = String(b64).split(/\s+/)[0].replace(/[^A-Za-z0-9+/]/g, "");
    const raw = atob(clean + "=".repeat((4 - (clean.length % 4)) % 4));
    bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  } catch {
    return null;
  }
  const view = new DataView(bytes.buffer);
  const int = (at: number) => view.getInt32(at);
  // Player ids are positive; D/ST are -16000 - proTeamId; -1 means the slot isn't drafted yet.
  const plausible = (v: number) => v === -1 || (v >= 1000 && v <= 9_999_999) || (v <= -16_000 && v >= -16_100);

  const runs: number[][] = [];
  let run: number[] = [];
  for (let k = 0; k + 4 <= bytes.length; k++) {
    if (int(k) !== league) continue;
    if (run.length && k - run[run.length - 1] !== STRIDE) {
      runs.push(run);
      run = [];
    }
    run.push(k);
  }
  if (run.length) runs.push(run);
  runs.sort((a, b) => b.length - a.length);

  for (const candidate of runs) {
    // A record before the table shares the tag, so try both alignments and let the shape decide.
    for (const [first, total] of [
      [candidate[0] - LEAGUE_AT, candidate.length],
      [candidate[0] - LEAGUE_AT + STRIDE, candidate.length - 1],
    ]) {
      if (first < 0 || total < 1 || first + STRIDE * total > bytes.length) continue;
      const ids: number[] = [];
      for (let k = 0; k < total; k++) ids.push(int(first + STRIDE * k));
      if (!ids.every(plausible)) continue;
      const made = ids.filter((v) => v !== -1);
      if (made.some((v, i) => ids[i] !== v)) continue;
      if (made.length) return made;
    }
  }
  return null;
}

/**
 * The bridge's catch-up frames: one `WR_CATCHUP <overall> <team> <player>` per recovered pick.
 * Empty without an owner for every pick, because a board that credits the wrong team is worse than
 * one that says it's missing picks.
 */
export function catchUpFrames(ids: readonly number[], pickTeams: readonly number[] | null): string[] {
  if (!pickTeams || pickTeams.length < ids.length) return [];
  return ids.map((id, i) => `WR_CATCHUP ${i + 1} ${pickTeams[i]} ${id}`);
}
