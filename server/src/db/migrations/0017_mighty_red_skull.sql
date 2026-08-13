CREATE TABLE "agent_context_docs" (
	"agent_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "agent_context_docs_agent_id_repo_id_path_pk" PRIMARY KEY("agent_id","repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "project_doc_scans" (
	"repo_id" uuid PRIMARY KEY NOT NULL,
	"status" text NOT NULL,
	"scanned_at" timestamp with time zone DEFAULT now() NOT NULL,
	"doc_count" integer DEFAULT 0 NOT NULL,
	"tokens_total" integer DEFAULT 0 NOT NULL,
	"skipped_too_large" integer DEFAULT 0 NOT NULL,
	"bounded" integer DEFAULT 0 NOT NULL,
	"error" text
);
--> statement-breakpoint
CREATE TABLE "project_docs" (
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"category" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"tokens" integer NOT NULL,
	CONSTRAINT "project_docs_repo_id_path_pk" PRIMARY KEY("repo_id","path")
);
--> statement-breakpoint
CREATE TABLE "skill_context_docs" (
	"skill_id" uuid NOT NULL,
	"repo_id" uuid NOT NULL,
	"path" text NOT NULL,
	"order" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "skill_context_docs_skill_id_repo_id_path_pk" PRIMARY KEY("skill_id","repo_id","path")
);
--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_agent_id_agents_id_fk" FOREIGN KEY ("agent_id") REFERENCES "public"."agents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "agent_context_docs" ADD CONSTRAINT "agent_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_doc_scans" ADD CONSTRAINT "project_doc_scans_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "project_docs" ADD CONSTRAINT "project_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_skill_id_skills_id_fk" FOREIGN KEY ("skill_id") REFERENCES "public"."skills"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "skill_context_docs" ADD CONSTRAINT "skill_context_docs_repo_id_repos_id_fk" FOREIGN KEY ("repo_id") REFERENCES "public"."repos"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_context_docs_agent_idx" ON "agent_context_docs" USING btree ("agent_id","order");--> statement-breakpoint
CREATE INDEX "agent_context_docs_repo_idx" ON "agent_context_docs" USING btree ("repo_id");--> statement-breakpoint
CREATE INDEX "skill_context_docs_skill_idx" ON "skill_context_docs" USING btree ("skill_id","order");--> statement-breakpoint
CREATE INDEX "skill_context_docs_repo_idx" ON "skill_context_docs" USING btree ("repo_id");