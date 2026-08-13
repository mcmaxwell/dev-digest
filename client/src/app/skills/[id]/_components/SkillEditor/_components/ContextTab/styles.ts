import type { CSSProperties } from "react";

export const s = {
  manifest: {
    maxWidth: 760,
    marginTop: 22,
    padding: "12px 14px",
    borderRadius: 8,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  manifestLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: 0.4,
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,
  manifestRow: { fontSize: 12.5, color: "var(--text-secondary)", lineHeight: 1.8 } satisfies CSSProperties,
  manifestEmpty: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
};
