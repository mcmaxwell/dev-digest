import type { IconName } from "@devdigest/ui";
import type { IntentConfidence, RiskAreaKind } from "@devdigest/shared";

/**
 * One icon per risk-area kind. WCAG AA: a chip is never distinguished by colour
 * alone — the icon and the label carry the meaning, the colour only reinforces it.
 */
export const RISK_ICON: Record<RiskAreaKind, IconName> = {
  security: "Shield",
  dependency: "Boxes",
  performance: "Gauge",
  data: "Database",
  other: "Info",
};

export const RISK_COLOR: Record<RiskAreaKind, string> = {
  security: "var(--sev-critical, #f87171)",
  dependency: "var(--text-secondary)",
  performance: "var(--sev-warning, #fbbf24)",
  data: "var(--accent-text, #60a5fa)",
  other: "var(--text-muted)",
};

/** Confidence is a hedge, not a verdict — low is muted, not alarming. */
export const CONFIDENCE_COLOR: Record<IntentConfidence, string> = {
  high: "var(--sev-ok, #34d399)",
  medium: "var(--sev-warning, #fbbf24)",
  low: "var(--text-muted)",
};
