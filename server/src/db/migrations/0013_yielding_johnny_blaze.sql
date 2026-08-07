CREATE TABLE "convention_scans" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"status" text DEFAULT 'running' NOT NULL,
	"sha" text,
	"provider" text,
	"model" text,
	"sample_count" integer DEFAULT 0 NOT NULL,
	"candidate_count" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"finished_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "scan_id" uuid;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "category" text DEFAULT 'structure' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rationale" text;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "rule_key" text NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "evidence" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "probe" jsonb;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "adherence" double precision;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "support" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "violations" integer;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "origin" text DEFAULT 'llm' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "status" text DEFAULT 'pending' NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "edited" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "created_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "conventions" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "convention_scans" ADD CONSTRAINT "convention_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "convention_scans_repo_idx" ON "convention_scans" USING btree ("repo_id");--> statement-breakpoint
ALTER TABLE "conventions" ADD CONSTRAINT "conventions_scan_id_convention_scans_id_fk" FOREIGN KEY ("scan_id") REFERENCES "public"."convention_scans"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "conventions_repo_idx" ON "conventions" USING btree ("repo_id");--> statement-breakpoint
CREATE UNIQUE INDEX "conventions_repo_rule_key_uq" ON "conventions" USING btree ("repo_id","rule_key");