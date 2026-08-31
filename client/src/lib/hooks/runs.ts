/* hooks/runs.ts - L07 companion: ONE agent's own run log.
   GET /agents/:id/runs returns at most 50 rows plus `has_more`, newest first.
   The trace of a row is NOT fetched here - the drawer's own useRunTrace does
   that, and only once a row is opened. */
"use client";

import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { AgentRunsPage } from "@devdigest/shared";

// ---- Query-key factory - the single source of truth for these keys. Import
// this instead of hand-writing ["agent-runs", agentId] elsewhere, or the two
// copies will silently drift. ----
export const agentRunsKeys = {
  list: (agentId: string | null | undefined) => ["agent-runs", agentId] as const,
};

/** Rows per request; the server caps it at 50 too. */
const PAGE_SIZE = 50;

/**
 * One agent's runs, newest first, paged by the `ran_at` of the last row already
 * shown. `useInfiniteQuery` rather than a plain query because the load-more
 * control must APPEND a page: re-querying with a new `before` would replace the
 * list and drop the rows the user is looking at.
 */
export function useAgentRuns(agentId: string | null | undefined) {
  return useInfiniteQuery({
    queryKey: agentRunsKeys.list(agentId),
    queryFn: ({ pageParam }) =>
      api.get<AgentRunsPage>(
        `/agents/${agentId}/runs?limit=${PAGE_SIZE}` +
          (pageParam ? `&before=${encodeURIComponent(pageParam)}` : ""),
      ),
    initialPageParam: "",
    // The cursor is the oldest row of the page just received; `has_more` is
    // what the server derived by reading one row past the limit.
    getNextPageParam: (last: AgentRunsPage) =>
      last.has_more && last.runs.length > 0 ? last.runs[last.runs.length - 1]!.ran_at : undefined,
    enabled: !!agentId,
  });
}
