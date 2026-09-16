CREATE TABLE "ai_plans" (
	"league_id" text PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"job_id" text,
	"input_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"lease_expires_at" timestamp with time zone,
	"error_kind" text,
	"plan" jsonb,
	"plan_input_hash" text,
	"issues" jsonb,
	"provider" text,
	"model" text,
	"prompt_version" integer,
	"requested_at" timestamp with time zone DEFAULT now() NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "ai_plans" ADD CONSTRAINT "ai_plans_league_id_leagues_id_fk" FOREIGN KEY ("league_id") REFERENCES "public"."leagues"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_plans_status_idx" ON "ai_plans" USING btree ("status");