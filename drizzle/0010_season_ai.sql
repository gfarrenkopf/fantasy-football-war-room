CREATE TABLE "season_ai_trials" (
	"user_id" text NOT NULL,
	"season" integer NOT NULL,
	"first_week" integer NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_ai_trials_user_id_season_pk" PRIMARY KEY("user_id","season")
);
--> statement-breakpoint
CREATE TABLE "season_ai_uses" (
	"league_id" text NOT NULL,
	"season" integer NOT NULL,
	"week" integer NOT NULL,
	"kind" text NOT NULL,
	"used_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "season_ai_uses_league_id_season_week_kind_pk" PRIMARY KEY("league_id","season","week","kind")
);
--> statement-breakpoint
ALTER TABLE "season_ai_trials" ADD CONSTRAINT "season_ai_trials_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "season_ai_uses" ADD CONSTRAINT "season_ai_uses_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;