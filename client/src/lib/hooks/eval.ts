/* hooks/eval.ts — React Query hooks for the L06 eval harness: the case set, the
   suite runs, the paired comparison, and the workspace dashboard. */
"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  EvalCaseBodyInput,
  EvalCaseRecord,
  EvalDashboardIndex,
  EvalRunRecord,
  EvalSuiteCompare,
  EvalSuiteRunDetail,
  EvalSuiteRunRecord,
} from "@devdigest/shared";

/** Query keys for the eval harness — never hand-write these in a component. */
export const evalKeys = {
  all: ["eval"] as const,
  cases: (agentId: string | null | undefined) => ["eval", "cases", agentId] as const,
  case: (caseId: string | null | undefined) => ["eval", "case", caseId] as const,
  runs: (agentId: string | null | undefined) => ["eval", "runs", agentId] as const,
  run: (runId: string | null | undefined) => ["eval", "run", runId] as const,
  compare: (left: string | null | undefined, right: string | null | undefined) =>
    ["eval", "compare", left, right] as const,
  dashboard: () => ["eval", "dashboard"] as const,
};

// ---- cases ----------------------------------------------------------------

export function useEvalCases(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.cases(agentId),
    queryFn: () => api.get<EvalCaseRecord[]>(`/agents/${agentId}/eval-cases`),
    enabled: !!agentId,
  });
}

export function useEvalCase(caseId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.case(caseId),
    queryFn: () => api.get<EvalCaseRecord>(`/eval-cases/${caseId}`),
    enabled: !!caseId,
  });
}

export function useCreateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: EvalCaseBodyInput) =>
      api.post<EvalCaseRecord>(`/agents/${agentId}/eval-cases`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) }),
  });
}

export function useUpdateEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: { id: string; patch: EvalCaseBodyInput }) =>
      api.put<EvalCaseRecord>(`/eval-cases/${id}`, patch),
    // Patched in place rather than invalidated: the list is sorted by name and
    // a refetch would reorder rows under a user working down the set.
    onSuccess: (updated) => {
      qc.setQueryData<EvalCaseRecord[]>(evalKeys.cases(agentId), (prev) =>
        prev ? prev.map((c) => (c.id === updated.id ? updated : c)) : prev,
      );
    },
  });
}

export function useDeleteEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.del<{ deleted: boolean }>(`/eval-cases/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) }),
  });
}

// ---- running --------------------------------------------------------------

/**
 * Run one case. Invalidates the case list so the row's last-run state refreshes.
 */
export function useRunEvalCase(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (caseId: string) => api.post<EvalRunRecord>(`/eval-cases/${caseId}/run`),
    onSuccess: () => qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) }),
  });
}

/**
 * Run the whole set. This spends money - one model call per case, times
 * `repeats` - so the caller is expected to keep the button disabled while
 * `isPending`, and the route is rate limited behind it either way.
 */
export function useRunEvalSuite(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repeats: number) =>
      api.post<EvalSuiteRunRecord>(`/agents/${agentId}/eval-runs`, { repeats }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: evalKeys.cases(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.runs(agentId) });
      void qc.invalidateQueries({ queryKey: evalKeys.dashboard() });
    },
  });
}

// ---- history and comparison ----------------------------------------------

export function useEvalRuns(agentId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.runs(agentId),
    queryFn: () => api.get<EvalSuiteRunRecord[]>(`/agents/${agentId}/eval-runs`),
    enabled: !!agentId,
  });
}

export function useEvalRun(runId: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.run(runId),
    queryFn: () => api.get<EvalSuiteRunDetail>(`/eval-runs/${runId}`),
    enabled: !!runId,
  });
}

/** Two runs, paired case by case. Idle until both ids are chosen. */
export function useEvalCompare(left: string | null | undefined, right: string | null | undefined) {
  return useQuery({
    queryKey: evalKeys.compare(left, right),
    queryFn: () => api.get<EvalSuiteCompare>(`/eval-runs/compare?left=${left}&right=${right}`),
    enabled: !!left && !!right,
  });
}

// ---- dashboard ------------------------------------------------------------

export function useEvalDashboard() {
  return useQuery({
    queryKey: evalKeys.dashboard(),
    queryFn: () => api.get<EvalDashboardIndex>("/eval/dashboard"),
  });
}
