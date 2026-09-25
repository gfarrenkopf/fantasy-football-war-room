CREATE TABLE "season_ai_outputs" (
	"league_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"kind" text NOT NULL,
	"key" text DEFAULT '' NOT NULL,
	"output" jsonb NOT NULL,
	"issues" jsonb NOT NULL,
	"provider" text NOT NULL,
	"model" text NOT NULL,
	"prompt_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_ai_outputs_league_id_season_week_kind_key_pk" PRIMARY KEY("league_id","season","week","kind","key")
);
--> statement-breakpoint
ALTER TABLE "ai_generations" ADD COLUMN "purpose" text DEFAULT 'plan' NOT NULL;--> statement-breakpoint
ALTER TABLE "season_ai_outputs" ADD CONSTRAINT "season_ai_outputs_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;