import type { CSSProperties } from "react";

export const s = {
  /**
   * The summary is the PR's own claim, so it reads as a quotation — italic and
   * rule-marked — rather than as something DevDigest asserts.
   */
  summary: {
    margin: 0,
    padding: "0 0 0 14px",
    borderLeft: "2px solid var(--border)",
    fontSize: 15,
    fontStyle: "italic",
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  /**
   * Two columns that collapse to one when narrow. `auto-fit` + `minmax` does it
   * with no media query and no measurement, so it also survives the card being
   * dropped into a future two-column page grid.
   */
  scopeGrid: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
    gap: 20,
    marginTop: 18,
  } satisfies CSSProperties,

  columnLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
  } satisfies CSSProperties,

  list: {
    margin: 0,
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 6,
    fontSize: 13.5,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  emptyList: {
    margin: 0,
    fontSize: 13.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  chipRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 8,
  } satisfies CSSProperties,

  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  /** The missing-context notice: present but quiet — a caveat, not an error. */
  missing: {
    marginTop: 18,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px dashed var(--border)",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  missingList: {
    margin: "6px 0 0",
    paddingLeft: 18,
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,

  footnote: {
    marginTop: 14,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
