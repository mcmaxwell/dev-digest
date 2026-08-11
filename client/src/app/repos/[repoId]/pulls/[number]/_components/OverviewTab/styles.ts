import type { CSSProperties } from "react";

export const s = {
  /**
   * Intent | Blast Radius, side by side. `auto-fit` + `minmax` gives the
   * two-column layout on a wide screen and one column below ~800px without a
   * media query — and `align-items: start` keeps a short card from stretching to
   * match a tall neighbour, which would leave a half-empty box.
   */
  briefGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(380px, 1fr))",
    alignItems: "start",
    gap: 24,
  } satisfies CSSProperties,

  descriptionBox: {
    border: "1px solid var(--border)",
    borderRadius: 8,
    background: "var(--bg-elevated)",
    padding: 18,
    fontSize: 14,
    color: "var(--text-secondary)",
    whiteSpace: "pre-wrap",
    lineHeight: 1.55,
  } satisfies CSSProperties,
} as const;
