CREATE TABLE "season_projections" (
	"league_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"subject" text NOT NULL,
	"projected" double precision NOT NULL,
	"actual" double precision,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"settled_at" timestamp with time zone,
	CONSTRAINT "season_projections_league_id_season_week_subject_pk" PRIMARY KEY("league_id","season","week","subject")
);
--> statement-breakpoint
ALTER TABLE "season_projections" ADD CONSTRAINT "season_projections_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;