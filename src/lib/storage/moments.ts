/**
 * Game day's win and loss moments (APE-230) play in full once per league and week on a device; after
 * that they render still. Which ones have played is a device convenience, like Opening Night's
 * premiered leagues: lost storage only means a moment plays again.
 */

const KEY = "fwr:v1:moments";
/** Enough for every league a user follows over a season. */
const KEEP = 60;

export const momentKey = (leagueId: string, season: number, week: number) => `${leagueId}:${season}:${week}`;

function localStore(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

function read(storage: Storage | null): string[] {
  try {
    const parsed: unknown = JSON.parse(storage?.getItem(KEY) ?? "[]");
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string") : [];
  } catch {
    return [];
  }
}

export function hasPlayedMoment(key: string, storage: Storage | null = localStore()): boolean {
  return read(storage).includes(key);
}

export function markMomentPlayed(key: string, storage: Storage | null = localStore()): void {
  const played = read(storage).filter((k) => k !== key);
  played.push(key);
  try {
    storage?.setItem(KEY, JSON.stringify(played.slice(-KEEP)));
  } catch {
    // Full or blocked storage: the moment plays again next time.
  }
}
