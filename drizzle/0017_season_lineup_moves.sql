CREATE TABLE "season_lineup_moves" (
	"league_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"player_id" integer NOT NULL,
	"from_slot" text NOT NULL,
	"to_slot" text NOT NULL,
	"gain" double precision NOT NULL,
	"applied_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_lineup_moves_league_id_season_week_player_id_pk" PRIMARY KEY("league_id","season","week","player_id")
);
--> statement-breakpoint
ALTER TABLE "season_lineup_moves" ADD CONSTRAINT "season_lineup_moves_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;