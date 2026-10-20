-- Custom SQL migration file, put your code below! --
-- APE-341: stamp the accounts that connected a season before the stamp existed, while the in-season
-- beta was open, at their first connect, so they stay in once it closes and keep the 2026 AI.
UPDATE "users" AS u
SET "season_access_at" = s."first_at", "season_access_via" = 'open'
FROM (
  SELECT "user_id", MIN("created_at") AS "first_at"
  FROM "espn_season_links"
  GROUP BY "user_id"
) AS s
WHERE s."user_id" = u."id" AND u."season_access_at" IS NULL;
