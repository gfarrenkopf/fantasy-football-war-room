CREATE TABLE "espn_season_links" (
	"league_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"espn_league_id" text NOT NULL,
	"espn_team_id" integer NOT NULL,
	"season" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "espn_season_links" ADD CONSTRAINT "espn_season_links_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "espn_season_links" ADD CONSTRAINT "espn_season_links_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "espn_season_links_user_espn_idx" ON "espn_season_links" USING btree ("user_id","espn_league_id","season");