import type { CSSProperties } from "react";

/** Co-located styles for HistoryTab. */
export const s = {
  wrap: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,
  row: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  rowHeader: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
  } satisfies CSSProperties,
  date: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  rowRight: { marginLeft: "auto" } satisfies CSSProperties,
  bodyPreview: {
    margin: 0,
    padding: "12px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    lineHeight: 1.6,
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
    maxHeight: 320,
    overflow: "auto",
    background: "var(--bg)",
  } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
