CREATE TABLE "espn_server_clients" (
	"league_id" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"espn_league_id" text NOT NULL,
	"espn_team_id" integer NOT NULL,
	"season" integer NOT NULL,
	"sealed" text NOT NULL,
	"league_settings" jsonb,
	"pick_teams" jsonb,
	"consent_version" integer NOT NULL,
	"state" text DEFAULT 'stored' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "espn_server_clients" ADD CONSTRAINT "espn_server_clients_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "espn_server_clients" ADD CONSTRAINT "espn_server_clients_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "espn_server_clients_state_idx" ON "espn_server_clients" USING btree ("state");--> statement-breakpoint
CREATE INDEX "espn_server_clients_expires_at_idx" ON "espn_server_clients" USING btree ("expires_at");