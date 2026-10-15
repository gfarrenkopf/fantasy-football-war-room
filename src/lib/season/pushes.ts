import type { PushAlert } from "@/lib/server/push";
import type { LeagueSummary } from "./email";

/**
 * The push notification for each season alert (21.3): the email's news in a title and a line, and
 * where a tap opens in the app (`leagueId` plus `tab`). Pure, like email.ts beside it.
 */

/** Where a tap goes: the app opens this league on this tab, with this player's slot picked. */
const open = (leagueId: string | undefined, tab: "gameday" | "lineup", playerId?: number | null) =>
  leagueId ? { leagueId, tab, ...(playerId != null ? { playerId: String(playerId) } : {}) } : undefined;
/** One league's alerts stack together on the phone. */
const thread = (leagueId: string | undefined) => (leagueId ? `league-${leagueId}` : undefined);

const first = <T,>(list: readonly T[]) => (list.length === 1 ? list[0] : undefined);

export function sundayPush(leagues: (LeagueSummary & { leagueId: string })[]): PushAlert {
  const hole = leagues.flatMap((l) => l.holes ?? [])[0];
  const one = first(leagues);
  const title = hole ? (one ? "Your Sunday lineup has a hole" : "A hole in your Sunday lineups") : one ? "Your Sunday lineup is ready" : "Your Sunday lineups are ready";
  const body = one ? `${one.name}: ${one.holes?.[0] ?? one.moves[0] ?? "your ESPN lineup already matches it."}` : `${leagues.map((l) => l.name).join(", ")}. Set them on ESPN before kickoff.`;
  const target = one ?? leagues.find((l) => l.holes?.length);
  return { title, body, data: open(target?.leagueId, "lineup"), threadId: thread(one?.leagueId), collapseId: "sunday-lineup" };
}

export function reconnectPush(): PushAlert {
  return { title: "Reconnect ESPN", body: "ESPN signed Draft Room out, so this morning's AI lineup couldn't be written. Open the app to reconnect.", collapseId: "reconnect" };
}

export function earlyPush({ kickoff, leagues }: { kickoff: string; leagues: { leagueId: string; name: string; moves: string[] }[] }): PushAlert {
  const one = first(leagues);
  return {
    title: `Set your lineup before ${kickoff}`,
    body: one ? `${one.name}: ${one.moves[0]}` : `${leagues.map((l) => l.name).join(", ")} have changes for that game.`,
    data: open(leagues[0]?.leagueId, "lineup"),
    threadId: thread(one?.leagueId),
  };
}

export function draftPush(leagues: { name: string; time: string }[]): PushAlert {
  const one = first(leagues);
  return {
    title: one ? `Your ESPN draft room is open: ${one.name}` : "Your ESPN draft rooms are open",
    body: `${one ? `Drafts at ${one.time}. ` : ""}Open it on ESPN and tap your Draft Room bookmark to follow along.`,
  };
}

/** A starter in a late game ruled out after the Sunday lineup (APE-347), with the hole it leaves. */
export interface RuledOut {
  leagueId: string;
  league: string;
  playerId: number | null;
  /** The player's name; null for a slot left empty. */
  name: string | null;
  /** The hole in words, with the pickup that fills it when the wire read (holeLines()). */
  line: string;
}

/**
 * "Puka Nacua is out": a starter ruled out too late for the Sunday lineup (21.4). Time-sensitive, so
 * it gets through Focus: the slot locks at kickoff. A tap opens the Lineup tab on that player's slot.
 */
export function ruledOutPush({ kickoff, holes }: { kickoff: string; holes: RuledOut[] }): PushAlert {
  const one = first(holes);
  const named = holes.filter((h) => h.name);
  const title = one ? (one.name ? `${one.name} is out` : `A hole in ${one.league}`) : named.length === holes.length ? `${named.map((h) => h.name).join(" and ")} are out` : `${holes.length} holes in your lineups`;
  const body = one ? `${one.line} Fill it before ${kickoff}.` : `Fill them before ${kickoff}. ${holes.map((h) => h.league).filter((l, i, all) => all.indexOf(l) === i).join(", ")}.`;
  return {
    title,
    body,
    data: open(holes[0]?.leagueId, "lineup", one?.playerId),
    threadId: thread(first([...new Set(holes.map((h) => h.leagueId))])),
    category: "lineup-hole",
    timeSensitive: true,
  };
}

/** "Your lineup has a hole": before the week's first kickoff (21.4), for holes the kickoff alert doesn't cover. */
export function reminderPush(leagues: { leagueId: string; name: string; lines: string[] }[]): PushAlert {
  const one = first(leagues);
  return {
    title: one ? "Your lineup has a hole" : "Your lineups have holes",
    body: one ? `${one.name}: ${one.lines[0]}` : `${leagues.map((l) => l.name).join(", ")}. Fix them before kickoff.`,
    data: open(leagues[0]?.leagueId, "lineup"),
    threadId: thread(one?.leagueId),
    category: "lineup-hole",
    collapseId: "lineup-reminder",
  };
}
