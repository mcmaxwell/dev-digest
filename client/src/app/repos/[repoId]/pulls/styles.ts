import type { CSSProperties } from "react";
import { GRID } from "./constants";

/** Co-located styles for the PR list page (extracted from inline styles). */
export const s = {
  /**
   * `isLast` rounds the bottom corners itself instead of relying on the card to
   * clip them. The card cannot clip: it holds the FINDINGS hover card, and
   * `overflow: hidden` on an ancestor clips absolutely-positioned descendants —
   * which cut the popover off mid-card. See `tableCard`.
   */
  row: (hover: boolean, isLast = false): CSSProperties => ({
    display: "grid",
    gridTemplateColumns: GRID,
    alignItems: "center",
    gap: 14,
    padding: "12px 20px",
    // The card's own border already draws the last row's bottom edge.
    borderBottom: isLast ? "none" : "1px solid var(--border)",
    borderBottomLeftRadius: isLast ? 10 : undefined,
    borderBottomRightRadius: isLast ? 10 : undefined,
    cursor: "pointer",
    background: hover ? "var(--bg-surface)" : "transparent",
    transition: "background .1s",
  }),
  rowTitleCell: {
    minWidth: 0,
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  rowIcon: (color: string): CSSProperties => ({ color, flexShrink: 0 }),
  rowTitleWrap: { minWidth: 0 } satisfies CSSProperties,
  rowTitle: (hover: boolean): CSSProperties => ({
    fontSize: 14,
    fontWeight: 550,
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
    color: hover ? "var(--accent-text)" : "var(--text-primary)",
  }),
  rowNumber: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,
  authorCell: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  sizeBadgeBorder: (color: string): CSSProperties => ({ border: `1px solid ${color}` }),
  scoreCell: { display: "flex", alignItems: "center" } satisfies CSSProperties,
  findingsCell: { display: "flex", alignItems: "center", gap: 6 } satisfies CSSProperties,
  updatedCell: {
    fontSize: 12,
    color: "var(--text-muted)",
    textAlign: "right",
  } satisfies CSSProperties,
  costCell: { fontSize: 12, color: "var(--text-secondary)" } satisfies CSSProperties,
  muted: { color: "var(--text-muted)" } satisfies CSSProperties,
  filterBar: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "16px 20px",
    borderBottom: "1px solid var(--border)",
    flexWrap: "wrap",
  } satisfies CSSProperties,
  filterChips: { display: "flex", gap: 8 } satisfies CSSProperties,
  filterActions: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 12,
  } satisfies CSSProperties,
  pageHeader: {
    padding: "24px 32px 10px",
    display: "flex",
    alignItems: "flex-end",
    gap: 16,
  } satisfies CSSProperties,
  pageTitle: {
    fontSize: 24,
    fontWeight: 700,
    letterSpacing: "-0.02em",
  } satisfies CSSProperties,
  pageSubtitle: {
    fontSize: 14,
    color: "var(--text-secondary)",
    marginTop: 4,
  } satisfies CSSProperties,
  headerActions: {
    marginLeft: "auto",
    display: "flex",
    gap: 10,
    alignItems: "center",
  } satisfies CSSProperties,
  tableCard: {
    margin: "14px 32px 44px",
    border: "1px solid var(--border)",
    borderRadius: 10,
    // Deliberately NOT `overflow: hidden`. The FINDINGS column opens a hover
    // card that is positioned absolutely and extends past the last row; any
    // clipping ancestor cuts it off inside the table. The corners it used to
    // clip are rounded by the last row itself — see `row(hover, isLast)`.
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
  headRow: {
    display: "grid",
    gridTemplateColumns: GRID,
    gap: 14,
    padding: "10px 20px",
    borderBottom: "1px solid var(--border)",
    background: "var(--bg-surface)",
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    color: "var(--text-muted)",
    textTransform: "uppercase",
  } satisfies CSSProperties,
  headCell: (alignRight: boolean): CSSProperties => ({
    textAlign: alignRight ? "right" : "left",
  }),
  loadingStack: {
    padding: 20,
    display: "flex",
    flexDirection: "column",
    gap: 14,
  } satisfies CSSProperties,
} as const;
