import type { CSSProperties } from "react";

/** Co-located styles for MultiAgentLandingView. */
export const s = {
  wrap: { maxWidth: 880, margin: "0 auto", padding: "36px 28px 60px" } satisfies CSSProperties,
  title: { fontSize: 24, fontWeight: 700, letterSpacing: "-0.02em" } satisfies CSSProperties,
  subtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 8,
    maxWidth: 620,
    lineHeight: 1.55,
  } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginTop: 32,
    marginBottom: 14,
  } satisfies CSSProperties,
  h2: { fontSize: 15, fontWeight: 700 } satisfies CSSProperties,
  actions: { marginLeft: "auto" } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "13px 15px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    textAlign: "left",
    width: "100%",
    cursor: "pointer",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rowMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  pr: {
    fontSize: 13.5,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  sub: { fontSize: 12, color: "var(--text-muted)", marginTop: 4 } satisfies CSSProperties,
  badges: { display: "flex", gap: 6, alignItems: "center", flexShrink: 0 } satisfies CSSProperties,
  meta: {
    display: "flex",
    // Narrow viewport: the secondary numbers wrap rather than being dropped.
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "2px 10px",
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexShrink: 0,
    maxWidth: 230,
  } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", padding: "22px 2px" } satisfies CSSProperties,
} as const;
