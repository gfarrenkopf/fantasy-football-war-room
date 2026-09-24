import { and, eq } from "drizzle-orm";
import { espnSeasonLinks } from "@/lib/db/schema";
import type { Db } from "@/lib/db/types";

/** Which ESPN league a war room league follows during the season (10.3). */
export interface SeasonLink {
  leagueId: string;
  espnLeagueId: string;
  espnTeamId: number;
  season: number;
}

const columns = {
  leagueId: espnSeasonLinks.leagueId,
  espnLeagueId: espnSeasonLinks.espnLeagueId,
  espnTeamId: espnSeasonLinks.espnTeamId,
  season: espnSeasonLinks.season,
};

/** The link for one of the user's war room leagues. */
export async function findSeasonLink(db: Db, userId: string, leagueId: string): Promise<SeasonLink | null> {
  const [row] = await db.select(columns).from(espnSeasonLinks).where(and(eq(espnSeasonLinks.userId, userId), eq(espnSeasonLinks.leagueId, leagueId)));
  return row ?? null;
}

/** The war room league the user already follows this ESPN league with, this season. */
export async function findSeasonLinkByEspn(db: Db, userId: string, espnLeagueId: string, season: number): Promise<SeasonLink | null> {
  const [row] = await db
    .select(columns)
    .from(espnSeasonLinks)
    .where(and(eq(espnSeasonLinks.userId, userId), eq(espnSeasonLinks.espnLeagueId, espnLeagueId), eq(espnSeasonLinks.season, season)));
  return row ?? null;
}

/** Every linked league of the user's. */
export async function listSeasonLinks(db: Db, userId: string): Promise<SeasonLink[]> {
  return db.select(columns).from(espnSeasonLinks).where(eq(espnSeasonLinks.userId, userId));
}

/** Links (or relinks) a war room league to an ESPN league and team. */
export async function linkSeason(db: Db, userId: string, link: SeasonLink, now = new Date()): Promise<void> {
  // One war room league per ESPN league and season: drop any other league's link to it first.
  await db
    .delete(espnSeasonLinks)
    .where(and(eq(espnSeasonLinks.userId, userId), eq(espnSeasonLinks.espnLeagueId, link.espnLeagueId), eq(espnSeasonLinks.season, link.season)));
  await db
    .insert(espnSeasonLinks)
    .values({ ...link, userId, createdAt: now, updatedAt: now })
    .onConflictDoUpdate({ target: espnSeasonLinks.leagueId, set: { espnLeagueId: link.espnLeagueId, espnTeamId: link.espnTeamId, season: link.season, updatedAt: now } });
}
