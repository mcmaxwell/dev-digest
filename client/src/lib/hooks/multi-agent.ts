/* hooks/multi-agent.ts - L07 Multi-Agent Review.
   Three reads and one write:
     GET  /agents/run-estimates          the pre-run estimate for every agent
     GET  /repos/:id/multi-agent-runs    a repository's recent runs (headers only)
     GET  /multi-agent-runs/:id          the WHOLE results screen in one request
     POST /pulls/:id/multi-agent-run     start a run
   The results read polls while any column is running; no SSE stream, because the
   screen needs the whole aggregate re-derived, not an event feed. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  AgentRunEstimate,
  MultiAgentRun,
  MultiAgentRunSummary,
} from "@devdigest/shared";

// ---- Query-key factory - the single source of truth for these keys. Import
// this instead of hand-writing ["multi-agent-run", id] elsewhere, or the two
// copies will silently drift. ----
export const multiAgentKeys = {
  estimates: () => ["agent-run-estimates"] as const,
  /** Every repo's list at once - the start mutation knows a pull request, not a repo. */
  allRepoRuns: () => ["repo-multi-agent-runs"] as const,
  repoRuns: (repoId: string | null | undefined) => ["repo-multi-agent-runs", repoId] as const,
  run: (runId: string | null | undefined) => ["multi-agent-run", runId] as const,
};

/** How often the results screen re-reads while any agent is still running. */
const POLL_MS = 4000;

/**
 * Every enabled agent's median duration and cost over its last ten successful
 * runs. ONE request for the whole configure screen: the estimate is recomputed
 * client-side as the selection changes, so toggling a checkbox issues nothing.
 */
export function useAgentRunEstimates() {
  return useQuery({
    queryKey: multiAgentKeys.estimates(),
    queryFn: () => api.get<AgentRunEstimate[]>("/agents/run-estimates"),
  });
}

/** A repository's recent multi-agent runs, newest first - the landing list. */
export function useRepoMultiAgentRuns(repoId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKeys.repoRuns(repoId),
    queryFn: () => api.get<MultiAgentRunSummary[]>(`/repos/${repoId}/multi-agent-runs`),
    enabled: !!repoId,
  });
}

/**
 * One multi-agent run: header, columns and clusters, in one request.
 * Polls while any column is `running` so the screen self-updates, and stops on
 * its own once every agent has settled.
 */
export function useMultiAgentRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: multiAgentKeys.run(runId),
    queryFn: () => api.get<MultiAgentRun>(`/multi-agent-runs/${runId}`),
    enabled: !!runId,
    refetchInterval: (query) =>
      (query.state.data?.columns ?? []).some((c) => c.status === "running") ? POLL_MS : false,
  });
}

/** Start a multi-agent run. Resolves with the created run, every column running. */
export function useStartMultiAgentRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (vars: { prId: string; agentIds: string[] }) =>
      api.post<MultiAgentRun>(`/pulls/${vars.prId}/multi-agent-run`, {
        agent_ids: vars.agentIds,
      }),
    onSuccess: (run) => {
      // Seed the results cache so the screen the user lands on paints from the
      // response instead of flashing a spinner for one poll interval.
      qc.setQueryData(multiAgentKeys.run(run.id), run);
      qc.invalidateQueries({ queryKey: multiAgentKeys.allRepoRuns() });
    },
  });
}
