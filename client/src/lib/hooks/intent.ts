/* hooks/intent.ts — React Query hooks for the L03 Intent Layer.
   Read a PR's derived intent, or (re-)detect it on demand. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PrIntentResponse } from "@devdigest/shared";

/** Query keys for intent — never hand-write these in a component. */
export const intentKeys = {
  all: ["pr-intent"] as const,
  forPull: (prId: string | null | undefined) => ["pr-intent", prId] as const,
};

/**
 * The PR's derived intent, or `null` when it has none yet.
 *
 * The endpoint returns `{ intent: null }` rather than a 404 precisely so this
 * hook can distinguish "no intent yet" (an empty state with a button) from a
 * real failure (an error state) — `apiFetch` turns any non-2xx into a throw.
 */
export function usePrIntent(prId: string | null | undefined) {
  return useQuery({
    queryKey: intentKeys.forPull(prId),
    queryFn: () => api.get<PrIntentResponse>(`/pulls/${prId}/intent`),
    enabled: !!prId,
  });
}

/**
 * Classify (or re-classify) the PR's intent. One LLM call, so it is a mutation
 * with a visible pending state, never something that fires on render.
 */
export function useDetectIntent(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrIntentResponse>(`/pulls/${prId}/intent`),
    // The response already IS the fresh intent — seed it straight into the cache
    // so the card updates in the same tick instead of flashing back to its
    // previous (possibly stale) state while a refetch is in flight.
    onSuccess: (data) => qc.setQueryData(intentKeys.forPull(prId), data),
  });
}
