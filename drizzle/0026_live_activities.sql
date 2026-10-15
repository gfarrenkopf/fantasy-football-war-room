CREATE TABLE "live_activities" (
	"token" text PRIMARY KEY NOT NULL,
	"user_id" text NOT NULL,
	"league_id" text NOT NULL,
	"session_token" text NOT NULL,
	"environment" text NOT NULL,
	"week" integer NOT NULL,
	"state" jsonb,
	"sent_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "device_tokens" ADD COLUMN "start_token" text;--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "live_activities" ADD CONSTRAINT "live_activities_session_token_sessions_session_token_fk" FOREIGN KEY ("session_token") REFERENCES "public"."sessions"("session_token") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "live_activities_league_id_idx" ON "live_activities" USING btree ("league_id");