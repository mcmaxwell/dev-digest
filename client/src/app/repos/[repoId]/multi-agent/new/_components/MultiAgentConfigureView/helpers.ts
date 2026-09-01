import type { AgentRunEstimate } from "@devdigest/shared";

/**
 * The pre-run estimate for a selection, computed entirely client-side from the
 * one estimates response - so toggling a checkbox issues no request.
 *
 * Duration is the LARGEST of the selected medians because the agents run in
 * PARALLEL; cost is the SUM because every one of them is billed. An agent with
 * no successful run has no median, so it is left OUT of both numbers and the
 * result is marked partial rather than being quietly counted as free and fast.
 */
export interface SelectionEstimate {
  duration_ms: number;
  cost_usd: number;
  /** True when at least one selected agent had no history to contribute. */
  partial: boolean;
}

export function estimateSelection(
  selectedIds: string[],
  estimates: AgentRunEstimate[] | undefined,
): SelectionEstimate | null {
  if (selectedIds.length === 0 || !estimates) return null;
  const byId = new Map(estimates.map((e) => [e.agent_id, e]));
  const known = selectedIds
    .map((id) => byId.get(id))
    .filter((e): e is AgentRunEstimate => !!e && e.samples > 0);

  // No selected agent has ever succeeded: there is nothing to estimate FROM, and
  // an invented number would be worse than none (AC-14).
  if (known.length === 0) return null;

  return {
    duration_ms: Math.max(...known.map((e) => e.median_duration_ms ?? 0)),
    cost_usd: known.reduce((sum, e) => sum + (e.median_cost_usd ?? 0), 0),
    partial: known.length < selectedIds.length,
  };
}
