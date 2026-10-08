-- Custom SQL migration file, put your code below! --
-- APE-329: mark leagues connected to ESPN before `leagues.espn` existed (APE-325).
-- A season link first: it names the team ESPN confirmed the user owns.
UPDATE "leagues" AS l
SET "espn" = jsonb_build_object('espnLeagueId', s."espn_league_id", 'espnTeamId', s."espn_team_id", 'season', s."season")
FROM "espn_season_links" AS s
WHERE s."league_id" = l."id" AND s."user_id" = l."user_id" AND l."espn" IS NULL;
--> statement-breakpoint
-- Then the newest live sync pairing. Expired tokens are kept 30 days, so pairings older than that are gone.
UPDATE "leagues" AS l
SET "espn" = jsonb_build_object('espnLeagueId', t."espn_league_id", 'espnTeamId', t."espn_team_id", 'season', t."season")
FROM (
  SELECT DISTINCT ON ("league_id") "league_id", "user_id", "espn_league_id", "espn_team_id", "season"
  FROM "espn_bridge_tokens"
  ORDER BY "league_id", "created_at" DESC
) AS t
WHERE t."league_id" = l."id" AND t."user_id" = l."user_id" AND l."espn" IS NULL;
