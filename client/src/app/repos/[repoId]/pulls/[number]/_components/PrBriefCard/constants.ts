import type { IconName } from "@devdigest/ui";
import type { RiskSeverity } from "@devdigest/shared";

/**
 * One icon per severity, paired with the colour below.
 *
 * WCAG AA, and the spec's "colour independence" NFR: a severity is never
 * distinguished by colour alone. The icon and the written level carry the
 * meaning; the colour only reinforces it. This is the same pairing
 * `IntentCard/constants.ts` uses for risk-area kinds.
 */
export const SEVERITY_ICON: Record<RiskSeverity, IconName> = {
  high: "AlertOctagon",
  medium: "AlertTriangle",
  low: "Info",
};

export const SEVERITY_COLOR: Record<RiskSeverity, string> = {
  high: "var(--sev-critical, #f87171)",
  medium: "var(--sev-warning, #fbbf24)",
  low: "var(--text-muted)",
};
