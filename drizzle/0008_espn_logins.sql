CREATE TABLE "espn_logins" (
	"user_id" text PRIMARY KEY NOT NULL,
	"sealed" text NOT NULL,
	"season" integer NOT NULL,
	"consent_version" integer NOT NULL,
	"status" text DEFAULT 'connected' NOT NULL,
	"verified_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
ALTER TABLE "espn_logins" ADD CONSTRAINT "espn_logins_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "espn_logins_expires_at_idx" ON "espn_logins" USING btree ("expires_at");