DROP INDEX "settings_ws_user_key_uq";--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_run_id_agent_runs_id_fk" FOREIGN KEY ("run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_uq" ON "users" USING btree ("email");--> statement-breakpoint
CREATE INDEX "pr_commits_pr_idx" ON "pr_commits" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "pr_files_pr_idx" ON "pr_files" USING btree ("pr_id");--> statement-breakpoint
CREATE INDEX "findings_review_idx" ON "findings" USING btree ("review_id");--> statement-breakpoint
CREATE INDEX "reviews_pr_idx" ON "reviews" USING btree ("pr_id","created_at");--> statement-breakpoint
CREATE INDEX "reviews_run_idx" ON "reviews" USING btree ("run_id");--> statement-breakpoint
CREATE INDEX "agent_runs_pr_idx" ON "agent_runs" USING btree ("pr_id","ran_at");--> statement-breakpoint
ALTER TABLE "settings" ADD CONSTRAINT "settings_ws_user_key_uq" UNIQUE NULLS NOT DISTINCT("workspace_id","user_id","key");