CREATE TABLE "eval_suite_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"owner_kind" text NOT NULL,
	"owner_id" uuid NOT NULL,
	"agent_version" integer,
	"model" text,
	"ran_at" timestamp with time zone DEFAULT now() NOT NULL,
	"recall" double precision,
	"precision" double precision,
	"citation_accuracy" double precision,
	"traces_passed" integer,
	"traces_total" integer,
	"repeats" integer DEFAULT 1 NOT NULL,
	"duration_ms" integer,
	"cost_usd" double precision
);
--> statement-breakpoint
ALTER TABLE "eval_runs" ADD COLUMN "suite_run_id" uuid;--> statement-breakpoint
ALTER TABLE "eval_suite_runs" ADD CONSTRAINT "eval_suite_runs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_suite_runs_owner_idx" ON "eval_suite_runs" USING btree ("owner_id","ran_at");--> statement-breakpoint
CREATE INDEX "eval_suite_runs_workspace_idx" ON "eval_suite_runs" USING btree ("workspace_id","ran_at");--> statement-breakpoint
ALTER TABLE "eval_runs" ADD CONSTRAINT "eval_runs_suite_run_id_eval_suite_runs_id_fk" FOREIGN KEY ("suite_run_id") REFERENCES "public"."eval_suite_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "eval_runs_case_idx" ON "eval_runs" USING btree ("case_id","ran_at");--> statement-breakpoint
CREATE INDEX "eval_runs_suite_idx" ON "eval_runs" USING btree ("suite_run_id");