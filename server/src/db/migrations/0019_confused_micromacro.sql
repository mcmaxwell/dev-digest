CREATE TABLE "pr_brief_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pr_id" uuid NOT NULL,
	"head_sha" text NOT NULL,
	"risk_level" text NOT NULL,
	"what" text NOT NULL,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "head_sha" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "indexed_sha" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "provider" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "model" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "status" text DEFAULT 'ok' NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "degraded_reason" text;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "generated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "pr_brief" ADD COLUMN "trace" jsonb;--> statement-breakpoint
ALTER TABLE "pr_brief_history" ADD CONSTRAINT "pr_brief_history_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "pr_brief_history_pr_idx" ON "pr_brief_history" USING btree ("pr_id","generated_at");