import { totalPicks } from "@/lib/draft/snake";
import type { DraftPick, LeagueSettings } from "@/lib/draft/types";
import type { Crosswalk } from "./crosswalk";
import { toDraftPicks } from "./sync";

/**
 * A finished ESPN draft, as board picks (APE-193). A league connected for the season after its
 * draft would otherwise open on an empty board, and premiere as if the draft were still to come.
 * Pure: the server reads `mDraftDetail` with the user's login and saves what this returns.
 */

export interface EspnDraftPick {
  overall: number;
  teamId: number;
  espnPlayerId: number;
}

const isObject = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** `mDraftDetail`'s picks, in pick order, or null when ESPN's draft isn't finished (or can't be read). */
export function parseFinishedDraft(raw: unknown): EspnDraftPick[] | null {
  const detail = isObject(raw) && isObject(raw.draftDetail) ? raw.draftDetail : null;
  if (!detail || detail.drafted !== true || detail.inProgress === true || !Array.isArray(detail.picks)) return null;
  // D/ST ids are negative (-16000 - team); -1 is a slot nobody has taken (docs/espn-protocol.md).
  const picks = detail.picks.flatMap((p): EspnDraftPick[] =>
    isObject(p) && typeof p.overallPickNumber === "number" && typeof p.teamId === "number" && Number.isInteger(p.playerId) && p.playerId !== 0 && p.playerId !== -1
      ? [{ overall: p.overallPickNumber, teamId: p.teamId, espnPlayerId: p.playerId as number }]
      : [],
  );
  picks.sort((a, b) => a.overall - b.overall);
  // Every pick, numbered 1..n with no gaps: anything else isn't a draft the board can replay.
  if (!picks.length || picks.length !== detail.picks.length || picks.some((p, i) => p.overall !== i + 1)) return null;
  return picks;
}

/**
 * The board's picks for a finished ESPN draft, or why they can't be used. The league must be the
 * same shape as ESPN's draft: picks beyond the board, or a draft that isn't every team's every round,
 * would put players in the wrong seats.
 */
export function importedPicks(
  picks: readonly EspnDraftPick[],
  crosswalk: Crosswalk,
  espnTeamId: number,
  league: Pick<LeagueSettings, "teams" | "roster">,
): { ok: true; picks: DraftPick[] } | { ok: false; reason: string } {
  const total = totalPicks(league);
  if (picks.length !== total) return { ok: false, reason: `ESPN's draft has ${picks.length} picks; this league's board has ${total}` };
  return {
    ok: true,
    picks: toDraftPicks(
      picks.map((p) => {
        const r = crosswalk(p.espnPlayerId);
        return {
          n: p.overall,
          teamId: p.teamId,
          mine: p.teamId === espnTeamId,
          auto: false,
          espnPlayerId: p.espnPlayerId,
          playerId: r.kind === "matched" ? r.playerId : null,
          offBoard: r.kind === "offBoard" ? r.player : null,
        };
      }),
    ),
  };
}
