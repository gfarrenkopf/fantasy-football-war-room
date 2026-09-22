/**
 * Frames of ESPN's live draft socket, as the page's own socket receives them.
 *
 * Unofficial and reverse-engineered (see docs/espn-protocol.md): ESPN can change any of this
 * without notice. So parsing never throws. A frame we don't recognise is `unknown`, a frame we
 * recognise with fields we can't read is `malformed`, and both are counted so a change in the
 * protocol shows up as drift rather than as silently missing picks.
 *
 * Pure: no DOM, no sockets, no env. The bridge relays raw frame text; the server parses it.
 */

export type EspnFrame =
  /** Full room state on join, as an opaque base64 blob. */
  | { kind: "init" }
  /** Join accepted; echoes the join credentials, which we deliberately don't keep. */
  | { kind: "token" }
  | { kind: "joined"; teamId: number; memberId: string }
  | { kind: "left"; teamId: number; memberId: string }
  /** Sent every 5s. `state` 0 is the pre-draft countdown, with team 0; during the draft it names the team on the clock. After the draft it's a bare `CLOCK 4`, with no time left and no team. */
  | { kind: "clock"; state: number; teamId: number; msRemaining: number }
  /** 1 = draft started, 2 = draft complete. */
  | { kind: "state"; state: number }
  | { kind: "selecting"; teamId: number; msAllowed: number }
  | { kind: "autosuggest"; playerId: number }
  | { kind: "autodraft"; teamId: number; on: boolean }
  /** A pick. memberId is the drafter's GUID for a human pick and null for an autopick. */
  | { kind: "selected"; teamId: number; playerId: number; rosterSlot: number; memberId: string | null }
  /**
   * Not ESPN's: the bridge's own frame, one per pick it recovered from INIT when it attached late
   * (8.12). ESPN's blob stays in the tab; only these ids come out.
   */
  | { kind: "catchup"; overall: number; teamId: number; playerId: number }
  | { kind: "pong" }
  | { kind: "error"; code: number; message: string }
  | { kind: "malformed"; raw: string }
  | { kind: "unknown"; raw: string };

const GUID = /^\{[0-9A-Fa-f-]{36}\}$/;

const int = (s: string | undefined): number | null => (s !== undefined && /^-?\d+$/.test(s) ? Number(s) : null);

function decode(s: string): string {
  try {
    return decodeURIComponent(s.replace(/\+/g, " "));
  } catch {
    return s;
  }
}

export function parseFrame(raw: string): EspnFrame {
  const text = raw.trim();
  const [head, ...rest] = text.split(" ");
  const bad: EspnFrame = { kind: "malformed", raw: text };
  switch (head) {
    case "INIT":
      return { kind: "init" };
    case "TOKEN":
      return { kind: "token" };
    case "JOINED":
    case "LEFT": {
      const teamId = int(rest[0]);
      const memberId = rest[1];
      if (teamId === null || !memberId || !GUID.test(memberId)) return bad;
      return { kind: head === "JOINED" ? "joined" : "left", teamId, memberId };
    }
    case "CLOCK": {
      // CLOCK <state> [msRemaining] [teamId]: state 0 is the pre-draft countdown (no team), 6 a live pick,
      // and after the draft ESPN sends a bare "CLOCK 4" every 20s.
      const state = int(rest[0]);
      const msRemaining = rest[1] === undefined ? 0 : int(rest[1]);
      const teamId = rest[2] === undefined ? 0 : int(rest[2]);
      return state === null || msRemaining === null || teamId === null ? bad : { kind: "clock", state, teamId, msRemaining };
    }
    case "STATE": {
      const state = int(rest[0]);
      return state === null ? bad : { kind: "state", state };
    }
    case "SELECTING": {
      const teamId = int(rest[0]);
      const msAllowed = int(rest[1]);
      return teamId === null || msAllowed === null ? bad : { kind: "selecting", teamId, msAllowed };
    }
    case "AUTOSUGGEST": {
      const playerId = int(rest[0]);
      return playerId === null ? bad : { kind: "autosuggest", playerId };
    }
    case "AUTODRAFT": {
      // Inbound frames always name the team; the outbound "AUTODRAFT true" never reaches us.
      const teamId = int(rest[0]);
      if (teamId === null || (rest[1] !== "true" && rest[1] !== "false")) return bad;
      return { kind: "autodraft", teamId, on: rest[1] === "true" };
    }
    case "SELECTED": {
      const teamId = int(rest[0]);
      const playerId = int(rest[1]);
      const rosterSlot = int(rest[2]);
      const memberId = rest[3] ?? null;
      if (teamId === null || playerId === null || rosterSlot === null) return bad;
      if (memberId !== null && !GUID.test(memberId)) return bad;
      return { kind: "selected", teamId, playerId, rosterSlot, memberId };
    }
    case "WR_CATCHUP": {
      const overall = int(rest[0]);
      const teamId = int(rest[1]);
      const playerId = int(rest[2]);
      if (overall === null || teamId === null || playerId === null || overall < 1) return bad;
      return { kind: "catchup", overall, teamId, playerId };
    }
    case "PONG":
      return { kind: "pong" };
    case "ERROR": {
      const code = int(rest[0]);
      return code === null ? bad : { kind: "error", code, message: decode(rest.slice(1).join(" ")) };
    }
    default:
      return { kind: "unknown", raw: text };
  }
}
