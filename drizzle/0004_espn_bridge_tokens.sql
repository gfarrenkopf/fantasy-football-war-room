CREATE TABLE "espn_bridge_tokens" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"league_id" text NOT NULL,
	"espn_league_id" text NOT NULL,
	"espn_team_id" integer NOT NULL,
	"season" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "espn_bridge_tokens" ADD CONSTRAINT "espn_bridge_tokens_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "espn_bridge_tokens" ADD CONSTRAINT "espn_bridge_tokens_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "espn_bridge_tokens_league_id_idx" ON "espn_bridge_tokens" USING btree ("league_id");--> statement-breakpoint
CREATE INDEX "espn_bridge_tokens_expires_at_idx" ON "espn_bridge_tokens" USING btree ("expires_at");