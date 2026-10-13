CREATE TABLE "deleted_account_purchases" (
	"source" text PRIMARY KEY NOT NULL,
	"kind" text NOT NULL,
	"amount_total" integer,
	"currency" text,
	"granted_at" timestamp with time zone NOT NULL,
	"deleted_at" timestamp with time zone DEFAULT now() NOT NULL
);
