import type { CSSProperties } from "react";

/** Co-located styles for CiRunsView. */
export const s = {
  wrap: { padding: "28px 32px", maxWidth: 1180 } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "flex-start",
    gap: 16,
    marginBottom: 18,
  } satisfies CSSProperties,
  h1: { fontSize: 26, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  sub: { fontSize: 13.5, color: "var(--text-muted)", marginTop: 6 } satisfies CSSProperties,
  spacer: { marginLeft: "auto" } satisfies CSSProperties,
  filters: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,
  table: {
    width: "100%",
    borderCollapse: "collapse",
    fontSize: 13,
    border: "1px solid var(--border)",
    borderRadius: 11,
    overflow: "hidden",
  } satisfies CSSProperties,
  th: {
    textAlign: "left",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.05em",
    color: "var(--text-muted)",
    padding: "10px 14px",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  td: { padding: "11px 14px", borderTop: "1px solid var(--border)" } satisfies CSSProperties,
  mono: { fontFamily: "var(--font-mono, monospace)", fontSize: 12.5 } satisfies CSSProperties,
  view: {
    display: "inline-flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12.5,
    color: "var(--accent)",
    textDecoration: "none",
  } satisfies CSSProperties,
} as const;
