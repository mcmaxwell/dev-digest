import type { Severity } from "@devdigest/shared";

/** The columns/tabs preference, remembered per browser. */
export const VIEW_STORAGE_KEY = "dd-multi-agent-view";

export const VIEW_MODES = ["columns", "tabs"] as const;
export type ViewMode = (typeof VIEW_MODES)[number];

/**
 * The narrowest a single agent column may be drawn. Below it a column drops
 * under ~30 characters of finding title at the card's own padding, which is the
 * point the spec calls "compressed below readability".
 *
 * It is a MINIMUM per column, not a viewport breakpoint: the columns view falls
 * back to tabs when `agentCount x COLUMN_MIN_WIDTH` (plus the gaps) does not fit
 * the space actually available, so five agents on a wide screen fall back too.
 */
export const COLUMN_MIN_WIDTH = 300;

/** The gap between two columns, shared with `styles.ts` so the fit check and
    the layout cannot drift apart. */
export const COLUMN_GAP = 12;

/* The per-agent palette is defined one level up, on the shared
   `multi-agent/_components/` ancestor, because the configure screen paints the
   same colours and lint forbids it importing this feature's `_components/`.
   Re-exported here so the results view has one place to import from. */
export { AGENT_COLORS, agentColor } from "../../../_components/agent-colors";

/**
 * Severity colour. Decoration ONLY: every cell that uses one also prints the
 * severity as text, because colour alone must not be the carrier of a finding's
 * severity on the most information-dense screen in the product.
 */
export const SEV_COLOR: Record<Severity, string> = {
  CRITICAL: "var(--sev-critical, #ef4444)",
  WARNING: "var(--sev-warning, #f59e0b)",
  SUGGESTION: "var(--sev-suggestion, #3b82f6)",
};

/** Most severe first - the order a column's findings are listed in. */
export const SEVERITY_ORDER: Record<Severity, number> = {
  CRITICAL: 0,
  WARNING: 1,
  SUGGESTION: 2,
};
