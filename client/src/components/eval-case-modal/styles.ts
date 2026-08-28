import type { CSSProperties } from "react";

/** Co-located styles for EvalCaseModal. */
export const s = {
  body: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, padding: 20 } satisfies CSSProperties,
  col: { minWidth: 0, display: "flex", flexDirection: "column", gap: 14 } satisfies CSSProperties,
  label: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.03em",
    color: "var(--text-muted)",
    marginBottom: 6,
    display: "block",
  } satisfies CSSProperties,
  diff: {
    width: "100%",
    minHeight: 210,
    fontFamily: "var(--font-mono, monospace)",
    fontSize: 12,
    lineHeight: 1.55,
    padding: 10,
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    color: "var(--text-primary)",
    resize: "vertical",
  } satisfies CSSProperties,
  preview: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
    maxHeight: 260,
    overflowY: "auto",
  } satisfies CSSProperties,
  expRow: {
    display: "grid",
    gridTemplateColumns: "minmax(0,1.1fr) minmax(0,1.4fr) 62px 62px 30px",
    gap: 6,
    alignItems: "center",
  } satisfies CSSProperties,
  expList: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  hint: { fontSize: 11.5, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  warn: { fontSize: 12, color: "var(--warn)", marginTop: 6 } satisfies CSSProperties,
  err: { fontSize: 12, color: "var(--crit)", marginTop: 6 } satisfies CSSProperties,
  footer: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "14px 20px",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  footerRight: { marginLeft: "auto", display: "flex", gap: 8 } satisfies CSSProperties,
} as const;
