/* hooks/ci.ts - React Query hooks for L06 Export to CI.

   Two shapes of call live here, and the difference matters:
   - `useCiBundle` is a MUTATION over an endpoint with no side effects. A bundle
     is a pure derivation of the agent, so there is nothing to invalidate; it is
     a mutation only because it is triggered by a button and parameterized by a
     body the user assembles in the wizard.
   - `useExportCi` is a mutation that really writes: it opens a pull request and
     records an installation, which is why it invalidates the installations
     query and `useCiInstallations` exists to be invalidated. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  CiBundle,
  CiBundleInputBody,
  CiExport,
  CiExportInputBody,
  CiInstallation,
  CiRun,
} from "@devdigest/shared";

/** How often the CI Runs page re-reads the list while it is open. */
const CI_RUNS_REFETCH_MS = 15_000;

/** Query keys for Export to CI - never hand-write these in a component. */
export const ciKeys = {
  all: ["ci"] as const,
  installations: (agentId: string | null | undefined) =>
    ["ci", "installations", agentId] as const,
  runs: () => ["ci", "runs"] as const,
};

/**
 * Every CI run in the workspace, newest first.
 *
 * Polled rather than pushed: a run is recorded by a workflow on someone else's
 * machine, so there is no SSE stream to subscribe to and nothing to invalidate
 * locally when one lands. The endpoint caps the list, so this is a bounded read.
 */
export function useCiRuns() {
  return useQuery({
    queryKey: ciKeys.runs(),
    queryFn: () => api.get<CiRun[]>("/ci-runs"),
    refetchInterval: CI_RUNS_REFETCH_MS,
  });
}

export function useCiBundle(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: CiBundleInputBody) =>
      api.post<CiBundle>(`/agents/${agentId}/ci-bundle`, input),
  });
}

/** The repositories this agent is installed into, newest first. */
export function useCiInstallations(agentId: string | null | undefined) {
  return useQuery({
    queryKey: ciKeys.installations(agentId),
    queryFn: () => api.get<CiInstallation[]>(`/agents/${agentId}/ci-installations`),
    enabled: !!agentId,
  });
}

/** Install the agent into a repository: commit the files, open the PR, record it. */
export function useExportCi(agentId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (input: CiExportInputBody) =>
      api.post<CiExport>(`/agents/${agentId}/export-ci`, input),
    onSuccess: () => qc.invalidateQueries({ queryKey: ciKeys.installations(agentId) }),
  });
}
