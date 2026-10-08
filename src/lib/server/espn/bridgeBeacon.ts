/**
 * The bridge's beacon (APE-331): one log line per bookmark click, error and pairing step, so a
 * bookmark that "does nothing" on someone's phone shows up in the droplet's journal. Nothing the
 * bridge sends is trusted: every field is checked against what the bridge can send, and anything
 * else is dropped rather than logged.
 */

const EVENTS = new Set(["load", "error", "pair"]);
const MODES = new Set(["own-site", "draft", "season", "other"]);
const PLATFORMS = new Set(["ios-safari", "ios-chrome", "android", "desktop"]);
const OUTCOMES = new Set(["opened", "blocked", "paired"]);

/** Beacon bodies above this are ignored: a real one is about 120 bytes. */
export const MAX_BEACON_BYTES = 1024;

export interface BeaconLine {
  line: string;
  /** An error in the bridge: logged where the alert job looks (deploy/warroom-alerts.sh). */
  problem: boolean;
}

/** The log line for a beacon, or null when it isn't one the bridge sends. */
export function beaconLine(body: unknown): BeaconLine | null {
  const b = (body ?? {}) as Record<string, unknown>;
  if (typeof b.event !== "string" || !EVENTS.has(b.event)) return null;
  if (typeof b.mode !== "string" || !MODES.has(b.mode)) return null;
  if (typeof b.platform !== "string" || !PLATFORMS.has(b.platform)) return null;
  const parts = [`event=${b.event}`, `mode=${b.mode}`, `platform=${b.platform}`];
  if (typeof b.espnLeagueId === "string" && /^\d{1,12}$/.test(b.espnLeagueId)) parts.push(`league=${b.espnLeagueId}`);
  if (b.again === "1") parts.push("again=1");
  if (b.event === "error") {
    if (typeof b.error !== "string" || !/^[A-Za-z]{1,40}$/.test(b.error)) return null;
    parts.push(`error=${b.error}`);
  }
  if (b.event === "pair") {
    if (typeof b.outcome !== "string" || !OUTCOMES.has(b.outcome)) return null;
    parts.push(`outcome=${b.outcome}`);
  }
  const problem = b.event === "error";
  return { line: `[espn-bridge]${problem ? " problem" : ""} ${parts.join(" ")}`, problem };
}

/**
 * At most `limit` lines per window, across everyone: the beacon is unauthenticated, so this is what
 * keeps a flood of fake ones from filling the journal or the alert inbox.
 */
export function logBudget(limit: number, windowMs: number, now: () => number = Date.now) {
  let start = 0;
  let used = 0;
  return () => {
    const t = now();
    if (t - start >= windowMs) {
      start = t;
      used = 0;
    }
    return used++ < limit;
  };
}
