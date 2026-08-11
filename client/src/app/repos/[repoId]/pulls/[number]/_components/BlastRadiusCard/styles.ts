import type { CSSProperties } from "react";

export const s = {
  /** The four counts. Plain divs, not `Chip`: a Chip is a `<button>`, and a
   *  number that does nothing when clicked should not be one. */
  statRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 10,
    marginBottom: 16,
  } satisfies CSSProperties,

  stat: {
    display: "inline-flex",
    alignItems: "center",
    gap: 7,
    padding: "5px 12px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    fontSize: 13,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  statValue: {
    fontWeight: 700,
    color: "var(--text-primary)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  /** One changed symbol and its downstream. */
  symbolBlock: {
    padding: "12px 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  symbolHead: {
    display: "flex",
    alignItems: "baseline",
    flexWrap: "wrap",
    gap: 10,
  } satisfies CSSProperties,

  symbolName: {
    fontSize: 14,
    fontWeight: 600,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  symbolFile: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  callerCount: {
    marginLeft: "auto",
    fontSize: 12,
    color: "var(--text-muted)",
    fontVariantNumeric: "tabular-nums",
  } satisfies CSSProperties,

  /** Indented and rule-marked: the view is called "tree", so the callers have
   *  to read as children of the symbol above them, not as siblings. */
  callerList: {
    margin: "8px 0 0",
    padding: "0 0 0 12px",
    borderLeft: "1px solid var(--border)",
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 4,
  } satisfies CSSProperties,

  callerRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13,
  } satisfies CSSProperties,

  callerSymbol: {
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  /** `file:line` with no link available: text, never an inert button. */
  inertLocation: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 13,
    color: "var(--text-secondary)",
    cursor: "default",
  } satisfies CSSProperties,

  factRow: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "baseline",
    gap: 8,
    marginTop: 8,
  } satisfies CSSProperties,

  factLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  quiet: {
    margin: 0,
    fontSize: 13,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  /** The collapsed "N symbols have no known callers" block, when sections
   *  precede it: separated by the same rule the sections use so it reads as the
   *  last row of the list rather than as a footnote about the card. */
  quietBlock: {
    padding: "12px 0 0",
    borderTop: "1px solid var(--border)",
  } satisfies CSSProperties,

  /** The partial-index banner: present but quiet - a caveat, not an error. */
  notice: {
    marginBottom: 14,
    padding: "10px 12px",
    borderRadius: 6,
    border: "1px dashed var(--border)",
    fontSize: 12.5,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  noticeTitle: {
    fontWeight: 700,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  caveat: {
    marginTop: 14,
    fontSize: 11.5,
    lineHeight: 1.55,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  summary: {
    margin: 0,
    padding: "0 0 0 14px",
    borderLeft: "2px solid var(--border)",
    fontSize: 14,
    lineHeight: 1.55,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  summaryFoot: {
    marginTop: 8,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,

  headerRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  toggle: {
    display: "inline-flex",
    padding: 2,
    borderRadius: 6,
    border: "1px solid var(--border)",
    background: "var(--bg-elevated)",
  } satisfies CSSProperties,
} as const;

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
