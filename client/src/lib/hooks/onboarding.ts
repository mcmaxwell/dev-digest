/* hooks/onboarding.ts — React Query hooks for L06 Onboarding Tour: the
   repository-scoped generated tour, its provenance and its cost. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { OnboardingPage } from "@/lib/types";

/** How often the page re-reads while a generation is in flight. */
const GENERATING_POLL_MS = 1500;

/** Query keys for the onboarding tour — never hand-write these in a component. */
export const onboardingKeys = {
  page: (repoId: string | null | undefined) => ["onboarding", repoId] as const,
};

/**
 * The whole tour page in one read.
 *
 * A generation runs on the server's job queue, not in the request, so the
 * generating state advances by POLLING the same query rather than by a stream:
 * AC-39 needs a phase name and five headings, and the run bus is a whole
 * subscription surface for that.
 */
export function useOnboarding(repoId: string | null | undefined) {
  return useQuery({
    queryKey: onboardingKeys.page(repoId),
    queryFn: () => api.get<OnboardingPage>(`/repos/${repoId}/onboarding`),
    enabled: !!repoId,
    refetchInterval: (query) =>
      query.state.data?.generation.status === "running" ? GENERATING_POLL_MS : false,
  });
}

/**
 * Generate (or regenerate) the tour. The server refuses a second generation
 * while one is in flight, so the returned page is written straight into the
 * cache and the poll above takes over from there.
 */
export function useGenerateOnboarding() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: string) =>
      api.post<OnboardingPage>(`/repos/${repoId}/onboarding/generate`),
    onSuccess: (data, repoId) => {
      qc.setQueryData(onboardingKeys.page(repoId), data);
    },
  });
}
