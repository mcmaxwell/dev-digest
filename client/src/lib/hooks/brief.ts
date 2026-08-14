/* hooks/brief.ts - React Query hooks for the L07 PR Brief card.
   Read the stored brief, or ask for a new one. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PrBriefResponse } from "@devdigest/shared";

/** Query keys for the PR brief - never hand-write these in a component. */
export const briefKeys = {
  all: ["pr-brief"] as const,
  forPull: (prId: string | null | undefined) => ["pr-brief", prId] as const,
};

/**
 * The PR's stored brief.
 *
 * A plain `useQuery` with no polling and no auto-generation: the read never
 * spends a token, and a PR that has never had a brief answers 200 with
 * `{ brief: null }` rather than a 404 - so this hook's error state means a real
 * failure, and the card can tell "not generated yet" apart from "could not
 * load".
 */
export function usePrBrief(prId: string | null | undefined) {
  return useQuery({
    queryKey: briefKeys.forPull(prId),
    queryFn: () => api.get<PrBriefResponse>(`/pulls/${prId}/brief`),
    enabled: !!prId,
  });
}

/**
 * Generate (or regenerate) the brief. One LLM call, so it is a mutation with a
 * visible pending state, never something that fires on render.
 *
 * The endpoint answers with the WHOLE envelope rather than just the new fields,
 * which is what lets this seed the complete cache entry in the same tick instead
 * of flashing back to the previous state while a refetch is in flight - the same
 * trick `useBlastSummary` and `useDetectIntent` use.
 */
export function useGenerateBrief(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBriefResponse>(`/pulls/${prId}/brief`),
    onSuccess: (data) => qc.setQueryData(briefKeys.forPull(prId), data),
  });
}
