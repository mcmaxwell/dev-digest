import type { CSSProperties } from "react";
import type { ConventionCandidate } from "@devdigest/shared";

/** Co-located styles for ConventionCard. */
const accentFor = (status: ConventionCandidate["status"]): string =>
  status === "accepted"
    ? "var(--accent)"
    : status === "rejected"
      ? "var(--border)"
      : "var(--border-strong)";

export const s = {
  card: (status: ConventionCandidate["status"]): CSSProperties => ({
    display: "flex",
    gap: 14,
    padding: 16,
    borderRadius: 9,
    border: "1px solid var(--border)",
    borderLeft: `3px solid ${accentFor(status)}`,
    background: "var(--bg-elevated)",
    // A rejected card stays visible (so the verdict is reversible) but recedes.
    opacity: status === "rejected" ? 0.5 : 1,
  }),
  main: { flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  ruleRow: { display: "flex", alignItems: "flex-start", gap: 8 } satisfies CSSProperties,
  rule: {
    flex: 1,
    fontSize: 14,
    fontWeight: 600,
    fontStyle: "italic",
    lineHeight: 1.45,
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rationale: { fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
  evidence: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  evidenceBlock: {
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  evidenceHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 10px",
    borderBottom: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  evidencePath: {
    flex: 1,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } satisfies CSSProperties,
  snippet: {
    margin: 0,
    padding: "9px 10px",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-primary)",
    overflowX: "auto",
    whiteSpace: "pre",
  } satisfies CSSProperties,
  moreEvidence: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  metaRow: { display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" } satisfies CSSProperties,
  strengthLabel: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  strengthBar: { width: 140 } satisfies CSSProperties,
  strengthValue: { fontSize: 12, fontWeight: 600 } satisfies CSSProperties,
  actions: {
    display: "flex",
    flexDirection: "column",
    gap: 8,
    width: 150,
    flexShrink: 0,
  } satisfies CSSProperties,
  editRow: { display: "flex", gap: 8, justifyContent: "flex-end" } satisfies CSSProperties,
} as const;
