import type { AgentColumn, Conflict, FindingRecord } from "@devdigest/shared";
import { SEVERITY_ORDER, VIEW_MODES, VIEW_STORAGE_KEY, type ViewMode } from "./constants";

/** Most severe first, so a column leads with what matters. */
export function sortFindings(findings: FindingRecord[]): FindingRecord[] {
  return [...findings].sort(
    (a, b) => (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9),
  );
}

/**
 * The remembered columns/tabs choice.
 *
 * Validated against `VIEW_MODES` rather than cast: a stale or hand-edited value
 * in local storage would otherwise render neither view.
 */
export function readViewMode(): ViewMode {
  try {
    const stored = localStorage.getItem(VIEW_STORAGE_KEY);
    return VIEW_MODES.includes(stored as ViewMode) ? (stored as ViewMode) : "columns";
  } catch {
    return "columns";
  }
}

export function writeViewMode(mode: ViewMode): void {
  try {
    localStorage.setItem(VIEW_STORAGE_KEY, mode);
  } catch {
    /* ignore - a private-mode browser simply forgets the choice */
  }
}

/**
 * The show-only-conflicts filter, applied client-side over the clusters the
 * server already decided were divergent.
 *
 * A conflict is two or more agents reporting findings of DIFFERENT severities.
 * One agent flagging where the rest were silent is a divergence but not a
 * conflict, because nobody contradicted it.
 */
export function onlyConflicts(conflicts: Conflict[]): Conflict[] {
  return conflicts.filter((c) => {
    const flagged = c.takes.filter(
      (t) => t.verdict !== "did_not_flag" && t.verdict !== "no_opinion",
    );
    return flagged.length >= 2 && flagged.some((t) => t.verdict !== flagged[0]!.verdict);
  });
}

/** A failed agent shows its error INSTEAD of a score and a findings list. */
export function isFailed(column: AgentColumn): boolean {
  return column.status === "failed" || column.status === "cancelled";
}
