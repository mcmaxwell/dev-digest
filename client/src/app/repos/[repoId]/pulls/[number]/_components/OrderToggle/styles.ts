import type { CSSProperties } from "react";

/** Co-located styles for the diff order toggle. */
export const s = {
  toggle: {
    display: "inline-flex",
    padding: 2,
    gap: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-surface)",
  } satisfies CSSProperties,
} as const;

/** One segment of the order toggle. */
export function toggleBtnFor(active: boolean): CSSProperties {
  return {
    padding: "4px 10px",
    borderRadius: 4,
    border: "none",
    cursor: "pointer",
    fontFamily: "inherit",
    fontSize: 12,
    fontWeight: 600,
    color: active ? "var(--text-primary)" : "var(--text-muted)",
    background: active ? "var(--bg-elevated)" : "transparent",
  };
}
