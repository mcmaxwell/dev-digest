/* hooks/smart-diff.ts — React Query hook for the L03 Smart Diff.
   The PR's changed files grouped core / wiring / boilerplate, with the latest
   review's findings marked. Deterministic and server-computed: no LLM call, so
   this is a plain cached read with no mutation counterpart. */
"use client";

import React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { SmartDiffResponse } from "@devdigest/shared";

/** Query keys for the smart diff — never hand-write these in a component. */
export const smartDiffKeys = {
  all: ["smart-diff"] as const,
  forPull: (prId: string | null | undefined) => ["smart-diff", prId] as const,
};

/**
 * The grouping depends on the PR's files (fixed at import) AND on the latest
 * review's findings, which change whenever a run finishes. Refetching the
 * reviews alone is not enough: `finding_lines` is the server's answer, so a
 * user sitting on the Files tab while a review completes would keep the old
 * line marks, badges and auto-open decisions. See `useInvalidateSmartDiff`.
 */
export function useSmartDiff(prId: string | null | undefined) {
  return useQuery({
    queryKey: smartDiffKeys.forPull(prId),
    queryFn: () => api.get<SmartDiffResponse>(`/pulls/${prId}/smart-diff`),
    enabled: !!prId,
  });
}

/**
 * Call after anything that changes the PR's findings — a finished run, or an
 * accept/dismiss. Mirrors `useInvalidateRunHistory` in `hooks/reviews.ts`.
 */
export function useInvalidateSmartDiff(prId: string | null | undefined) {
  const qc = useQueryClient();
  return React.useCallback(
    () => qc.invalidateQueries({ queryKey: smartDiffKeys.forPull(prId) }),
    [qc, prId],
  );
}
