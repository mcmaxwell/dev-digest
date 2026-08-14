import type { CSSProperties } from "react";

/** Co-located styles for ConfigTab. */
export const s = {
  wrap: { maxWidth: 720 } satisfies CSSProperties,
  untrustedNotice: {
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--warn)",
    background: "var(--warn-bg)",
    border: "1px solid var(--warn)",
    borderRadius: 7,
    padding: "10px 12px",
    marginBottom: 16,
  } satisfies CSSProperties,
  actions: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginTop: 20,
    paddingTop: 16,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,
  actionsRight: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 14,
  } satisfies CSSProperties,
  enabledLabel: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
} as const;
