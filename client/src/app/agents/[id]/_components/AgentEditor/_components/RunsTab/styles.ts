import type { CSSProperties } from "react";

/** Co-located styles for RunsTab. */
export const s = {
  wrap: { maxWidth: 900 } satisfies CSSProperties,
  head: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginBottom: 14,
  } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  count: {
    fontSize: 12,
    fontWeight: 600,
    letterSpacing: "0.04em",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: {
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "11px 14px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    textAlign: "left",
    width: "100%",
    cursor: "pointer",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  rowMain: { minWidth: 0, flex: 1 } satisfies CSSProperties,
  when: {
    fontSize: 13.5,
    fontWeight: 600,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  pr: {
    fontSize: 12.5,
    color: "var(--text-secondary)",
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  noPr: { fontSize: 12.5, color: "var(--text-muted)", marginTop: 3 } satisfies CSSProperties,
  error: {
    fontSize: 12,
    color: "var(--sev-critical, #ef4444)",
    marginTop: 5,
    // A provider error is one long line; wrap it rather than widening the row.
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  meta: {
    display: "flex",
    // Narrow viewport: the secondary fields wrap onto a second line rather
    // than being dropped (companion spec, Edge cases).
    flexWrap: "wrap",
    justifyContent: "flex-end",
    gap: "2px 10px",
    fontSize: 11.5,
    color: "var(--text-muted)",
    flexShrink: 0,
    maxWidth: 260,
  } satisfies CSSProperties,
  badges: { display: "flex", gap: 6, alignItems: "center", flexShrink: 0 } satisfies CSSProperties,
  more: { marginTop: 14, display: "flex", justifyContent: "center" } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", padding: "22px 2px" } satisfies CSSProperties,
} as const;
