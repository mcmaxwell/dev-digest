-- Custom (hand-written) data migration — runs BEFORE the FK constraints added in
-- 0012. reviews.agent_id / reviews.run_id were bare uuid columns with no FK, so an
-- existing local database can hold rows pointing at deleted agents/runs. Adding the
-- constraints would fail validation on those rows, so heal them first.

UPDATE "reviews" r
   SET "agent_id" = NULL
 WHERE r."agent_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "agents" a WHERE a."id" = r."agent_id");
--> statement-breakpoint

-- run_id gets ON DELETE CASCADE, so the equivalent healing is to drop reviews whose
-- run is already gone — that is what the manual compensation in deleteAgentRun did.
DELETE FROM "reviews" r
 WHERE r."run_id" IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM "agent_runs" ar WHERE ar."id" = r."run_id");
--> statement-breakpoint

-- users.email gains a UNIQUE index in 0012; de-duplicate any pre-existing rows by
-- keeping the oldest user per address.
DELETE FROM "users" u
 WHERE EXISTS (
   SELECT 1 FROM "users" k
    WHERE k."email" = u."email"
      AND (k."created_at" < u."created_at" OR (k."created_at" = u."created_at" AND k."id" < u."id"))
 );
