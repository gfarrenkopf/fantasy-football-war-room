CREATE TABLE "espn_login_claims" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"espn_league_id" text NOT NULL,
	"season" integer NOT NULL,
	"consent_version" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE INDEX "espn_login_claims_expires_at_idx" ON "espn_login_claims" USING btree ("expires_at");