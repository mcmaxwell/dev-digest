ALTER TABLE "onboarding" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "onboarding" ADD COLUMN "status" text DEFAULT 'ready' NOT NULL;