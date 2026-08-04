/* hooks/conventions.ts — React Query hooks for the L02 Conventions extractor. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type {
  ConventionCandidate,
  ConventionSkillDraft,
  ConventionsPage,
} from "@devdigest/shared";

/** Query keys for conventions — never hand-write these in a component. */
export const conventionsKeys = {
  all: ["conventions"] as const,
  forRepo: (repoId: string | null | undefined) => ["conventions", repoId] as const,
};

/** How often to re-read while a scan is running (the job has no SSE channel). */
const SCAN_POLL_MS = 2_000;

/**
 * The whole page in one read. Polls only while a scan is in flight, so an idle
 * page costs nothing.
 */
export function useConventions(repoId: string | null | undefined) {
  return useQuery({
    queryKey: conventionsKeys.forRepo(repoId),
    queryFn: () => api.get<ConventionsPage>(`/repos/${repoId}/conventions`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.scan?.status === "running" ? SCAN_POLL_MS : false,
  });
}

export function useExtractConventions(repoId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () =>
      api.post<{ scanId: string; jobId: string | null }>(
        `/repos/${repoId}/conventions/extract`,
      ),
    // Refetch immediately so the page flips to its scanning state without
    // waiting a full poll interval.
    onSuccess: () => qc.invalidateQueries({ queryKey: conventionsKeys.forRepo(repoId) }),
  });
}

export interface UpdateConventionInput {
  id: string;
  patch: { status?: ConventionCandidate["status"]; rule?: string; category?: string };
}

export function useUpdateConvention(
  repoId: string | null | undefined,
  /** Called on a failed PATCH — accept/reject must never fail silently. */
  onError?: () => void,
) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, patch }: UpdateConventionInput) =>
      api.patch<ConventionCandidate>(`/conventions/${id}`, patch),
    onError,
    onSuccess: (updated) => {
      // Patch the row in place: re-fetching the page would reorder the list
      // under the cursor while the user is working through the candidates.
      qc.setQueryData<ConventionsPage>(conventionsKeys.forRepo(repoId), (prev) =>
        prev
          ? {
              ...prev,
              candidates: prev.candidates.map((c) => (c.id === updated.id ? updated : c)),
            }
          : prev,
      );
    },
  });
}

export interface SkillDraftInput {
  candidateIds: string[];
  mode?: "merged" | "per_category";
}

/** Render accepted candidates into an editable skill draft. Persists nothing. */
export function useConventionSkillDraft(repoId: string | null | undefined) {
  return useMutation({
    mutationFn: ({ candidateIds, mode = "merged" }: SkillDraftInput) =>
      api.post<ConventionSkillDraft[]>(`/repos/${repoId}/conventions/skill-draft`, {
        candidate_ids: candidateIds,
        mode,
      }),
  });
}
