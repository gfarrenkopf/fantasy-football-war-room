CREATE TABLE "season_recaps" (
	"league_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"version" integer NOT NULL,
	"facts" jsonb NOT NULL,
	"saved_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "season_recaps_league_id_season_week_pk" PRIMARY KEY("league_id","season","week")
);
--> statement-breakpoint
ALTER TABLE "season_recaps" ADD CONSTRAINT "season_recaps_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;