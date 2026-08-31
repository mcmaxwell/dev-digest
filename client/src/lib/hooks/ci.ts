/* hooks/ci.ts - React Query hooks for L06 Export to CI.

   A bundle is a pure derivation of the agent, not a record: the endpoint has no
   side effects and there is nothing to invalidate afterwards. It is a mutation
   rather than a query because it is triggered by a button and parameterized by
   a body the user assembles in the wizard. */
"use client";

import { useMutation } from "@tanstack/react-query";
import { api } from "@/lib/api";
import type { CiBundle, CiBundleInputBody } from "@devdigest/shared";

export function useCiBundle(agentId: string | null | undefined) {
  return useMutation({
    mutationFn: (input: CiBundleInputBody) =>
      api.post<CiBundle>(`/agents/${agentId}/ci-bundle`, input),
  });
}
