/* hooks/blast.ts - React Query hooks for the L04 Blast Radius card.
   Read what a PR can reach, or ask for a one-paragraph impact summary. */
"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { PrBlastResponse } from "@devdigest/shared";

/** Query keys for the blast radius - never hand-write these in a component. */
export const blastKeys = {
  all: ["pr-blast"] as const,
  forPull: (prId: string | null | undefined) => ["pr-blast", prId] as const,
};

/**
 * The PR's blast radius.
 *
 * A plain `useQuery` with no polling: the answer is a pure read of an index that
 * only changes when the repo is re-analyzed, and it costs nothing, so there is
 * nothing to debounce and no model call to guard against.
 *
 * An unindexed repository is a 200 with `index.status === "degraded"`, not a
 * 404 - so this hook's error state means a real failure, and the card can tell
 * "not analyzed yet" apart from "could not load".
 */
export function usePrBlast(prId: string | null | undefined) {
  return useQuery({
    queryKey: blastKeys.forPull(prId),
    queryFn: () => api.get<PrBlastResponse>(`/pulls/${prId}/blast`),
    enabled: !!prId,
  });
}

/**
 * Ask a model to summarise the impact. One LLM call, so it is a mutation with a
 * visible pending state, never something that fires on render.
 *
 * The endpoint answers with the WHOLE envelope rather than just the summary,
 * which is what lets this seed the complete cache entry in the same tick instead
 * of flashing back to the previous state while a refetch is in flight - the same
 * trick `useDetectIntent` uses.
 */
export function useBlastSummary(prId: string | null | undefined) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api.post<PrBlastResponse>(`/pulls/${prId}/blast/summary`),
    onSuccess: (data) => qc.setQueryData(blastKeys.forPull(prId), data),
  });
}
