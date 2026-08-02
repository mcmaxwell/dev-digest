import type { CSSProperties } from "react";

/** Co-located styles for SkillPreviewDrawer. */
export const s = {
  titleRow: { display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" } satisfies CSSProperties,
  footer: { display: "flex", alignItems: "center", gap: 10 } satisfies CSSProperties,
  footerRight: {
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
} as const;
