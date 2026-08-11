import type { CSSProperties } from "react";

export const s = {
  /** Stats and the view toggle share the card's first row, as in the design. */
  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    flexWrap: "wrap",
    marginBottom: 12,
  } satisfies CSSProperties,

  /** Inline counts, not bordered chips: four boxes read as four controls, and
   *  none of these is clickable. */
  statRow: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    fontSize: 12.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
  } satisfies CSSProperties,

  statValue: {
    fontWeight: 700,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  /** The open symbol's body: callers, pills, and where it is declared. */
  symbolBody: {
    padding: "2px 0 12px 26px",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  symbolName: {
    fontSize: 13,
    fontWeight: 600,
    color: "var(--text-primary)",
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  callerCount: {
    marginLeft: "auto",
    paddingLeft: 10,
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  callerList: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 3,
  } satisfies CSSProperties,

  callerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 6,
    fontSize: 13,
    minWidth: 0,
  } satisfies CSSProperties,

  /** The `↳` tree connector. Decorative, so it is aria-hidden at the call site. */
  branch: {
    color: "var(--text-muted)",
    fontSize: 12,
    flexShrink: 0,
  } satisfies CSSProperties,

  /** `file:line` with no link available: text, never an inert button. */
  inertLocation: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "default",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  factRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 6,
  } satisfies CSSProperties,

  /** Where the changed symbol itself lives - quiet, because the callers are the
   *  answer and this is only provenance. */
  declaredIn: {
    margin: 0,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  declaredLink: {
    color: "var(--text-muted)",
    textDecoration: "none",
    borderBottom: "1px dotted var(--border)",
  } satisfies CSSProperties,

  quiet: {
    margin: 0,
    fontSize: 12.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  /** The collapsed "N symbols have no callers" block, when rows precede it. */
  quietBlock: {
    marginTop: 10,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  /** The partial-index banner: present but quiet - a caveat, not an error. */
  notice: {
    marginBottom: 12,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px dashed var(--border)",
    fontSize: 12,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  noticeTitle: {
    fontWeight: 700,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  caveat: {
    marginTop: 12,
    fontSize: 11,
    lineHeight: 1.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  summaryBlock: {
    marginTop: 12,
    paddingTop: 10,
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  summary: {
    margin: "8px 0 0",
    fontSize: 13,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  summaryFoot: {
    marginTop: 6,
    fontSize: 11,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  summaryHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  sectionCaption: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  toggle: {
    display: "inline-flex",
    padding: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;

/** One symbol's disclosure header. Highlighted while open, as in the design. */
export function symbolRowStyle(open: boolean): CSSProperties {
  return {
    display: "flex",
    alignItems: "center",
    gap: 8,
    width: "100%",
    padding: "7px 10px",
    border: "none",
    borderRadius: 6,
    background: open ? "var(--bg-hover)" : "transparent",
    cursor: "pointer",
    textAlign: "left",
    minWidth: 0,
  };
}

/** One segment of the tree/graph toggle. */
export function toggleBtnFor(active: boolean): CSSProperties {
  return {
    border: "none",
    borderRadius: 4,
    padding: "3px 12px",
    fontSize: 12,
    fontWeight: 600,
    cursor: "pointer",
    textTransform: "capitalize",
    background: active ? "var(--accent-bg)" : "transparent",
    color: active ? "var(--accent-text)" : "var(--text-muted)",
  };
}
