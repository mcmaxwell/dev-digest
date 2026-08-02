import type { CSSProperties } from "react";

/** Co-located styles for SkillsTab. */
export const s = {
  wrap: { maxWidth: 760 } satisfies CSSProperties,
  header: { display: "flex", alignItems: "center", gap: 12, marginBottom: 8 } satisfies CSSProperties,
  h2: { fontSize: 17, fontWeight: 700 } satisfies CSSProperties,
  filter: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "7px 11px",
    borderRadius: 7,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
    width: 190,
  } satisfies CSSProperties,
  filterIcon: { color: "var(--text-muted)" } satisfies CSSProperties,
  filterInput: {
    flex: 1,
    fontSize: 13,
    background: "transparent",
    border: "none",
    outline: "none",
    color: "var(--text-primary)",
  } satisfies CSSProperties,
  orderHint: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16 } satisfies CSSProperties,
  list: { display: "flex", flexDirection: "column", gap: 8 } satisfies CSSProperties,
  row: (attached: boolean, globallyDisabled: boolean): CSSProperties => ({
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderRadius: 8,
    border: "1px solid " + (attached ? "var(--border-strong)" : "var(--border)"),
    background: attached ? "var(--bg-elevated)" : "var(--bg-surface)",
    opacity: globallyDisabled ? 0.55 : 1,
  }),
  dragHandle: (draggable: boolean): CSSProperties => ({
    color: "var(--text-muted)",
    cursor: draggable ? "grab" : "default",
    opacity: draggable ? 1 : 0.25,
    display: "inline-flex",
  }),
  rowName: { fontSize: 13, fontWeight: 600, color: "var(--text-primary)" } satisfies CSSProperties,
  rowSpacer: { flex: 1 } satisfies CSSProperties,
} as const;
