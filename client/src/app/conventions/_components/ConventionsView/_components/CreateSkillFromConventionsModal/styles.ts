import type { CSSProperties } from "react";

/** Co-located styles for CreateSkillFromConventionsModal. */
export const s = {
  body: { display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  notice: {
    display: "flex",
    gap: 10,
    padding: "11px 13px",
    borderRadius: 8,
    background: "var(--accent-bg)",
    color: "var(--text-secondary)",
    fontSize: 13,
    lineHeight: 1.5,
  } satisfies CSSProperties,
  noticeIcon: { color: "var(--accent)", flexShrink: 0, marginTop: 2 } satisfies CSSProperties,
  row: { display: "flex", gap: 16 } satisfies CSSProperties,
  rowItem: { flex: 1, minWidth: 0 } satisfies CSSProperties,
  bodyHeader: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    color: "var(--text-muted)",
    marginBottom: 6,
  } satisfies CSSProperties,
  filename: { color: "var(--text-secondary)" } satisfies CSSProperties,
  footer: { display: "flex", gap: 10, justifyContent: "flex-end" } satisfies CSSProperties,
  error: { fontSize: 13, color: "var(--crit)" } satisfies CSSProperties,
} as const;
