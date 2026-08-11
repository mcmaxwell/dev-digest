import type { CSSProperties } from "react";

/** Co-located styles for StatsTab. */
export const s = {
  wrap: { maxWidth: 720, display: "flex", flexDirection: "column", gap: 16 } satisfies CSSProperties,
  tiles: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(140px, 1fr))",
    gap: 12,
  } satisfies CSSProperties,
  tile: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-surface)",
    padding: "14px 16px",
  } satisfies CSSProperties,
  tileValue: { fontSize: 24, fontWeight: 700 } satisfies CSSProperties,
  tileLabel: { fontSize: 12, color: "var(--text-secondary)", marginTop: 2 } satisfies CSSProperties,
  lastRun: { fontSize: 13, color: "var(--text-secondary)" } satisfies CSSProperties,
  sectionTitle: { fontSize: 14, fontWeight: 700, marginTop: 8 } satisfies CSSProperties,
  agentList: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    overflow: "hidden",
  } satisfies CSSProperties,
  agentRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
  agentName: { fontSize: 13, fontWeight: 600 } satisfies CSSProperties,
  agentRowRight: { marginLeft: "auto" } satisfies CSSProperties,
  note: { fontSize: 12, color: "var(--text-muted)", lineHeight: 1.5 } satisfies CSSProperties,
} as const;
