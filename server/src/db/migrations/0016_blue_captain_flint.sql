CREATE TABLE "pr_blast_summary" (
	"pr_id" uuid PRIMARY KEY NOT NULL,
	"text" text NOT NULL,
	"head_sha" text,
	"indexed_sha" text,
	"provider" text,
	"model" text,
	"generated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "pr_blast_summary" ADD CONSTRAINT "pr_blast_summary_pr_id_pull_requests_id_fk" FOREIGN KEY ("pr_id") REFERENCES "public"."pull_requests"("id") ON DELETE cascade ON UPDATE no action;