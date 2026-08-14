import type { CSSProperties } from "react";

export const s = {
  badgeRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    flexWrap: "wrap",
  } satisfies CSSProperties,

  /**
   * The one paragraph of generated prose. `what` and `why` are stored apart
   * because they are graded by different rules, but they read as one paragraph
   * — the Overview tab carries exactly one.
   */
  prose: {
    margin: 0,
    fontSize: 14.5,
    lineHeight: 1.6,
    color: "var(--text-primary)",
  } satisfies CSSProperties,

  block: {
    marginTop: 20,
  } satisfies CSSProperties,

  columnLabel: {
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
    marginBottom: 8,
    display: "flex",
    alignItems: "center",
    gap: 8,
  } satisfies CSSProperties,

  list: {
    margin: 0,
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 10,
  } satisfies CSSProperties,

  riskRow: {
    display: "flex",
    flexDirection: "column",
    gap: 4,
    padding: "8px 10px",
    borderRadius: 6,
    border: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,

  riskHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    minWidth: 0,
  } satisfies CSSProperties,

  riskTitle: {
    fontSize: 13.5,
    fontWeight: 600,
    color: "var(--text-primary)",
    // A risk title far longer than the mockup's must truncate rather than
    // break the card's layout; the full text stays reachable via `title`.
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  riskBody: {
    margin: 0,
    fontSize: 13,
    lineHeight: 1.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,

  refRow: {
    display: "flex",
    flexWrap: "wrap",
    gap: 8,
    marginTop: 2,
  } satisfies CSSProperties,

  /**
   * A file reference: a real anchor, so it is announced as a link, reachable by
   * Tab and activated by Enter for free. `overflowWrap: anywhere` is what keeps
   * an unbroken deep monorepo path from widening the card.
   */
  fileLink: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12.5,
    color: "var(--accent-text, #60a5fa)",
    textDecoration: "none",
    borderBottom: "1px solid transparent",
    overflowWrap: "anywhere",
    minWidth: 0,
  } satisfies CSSProperties,

  focusRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13.5,
    lineHeight: 1.5,
    minWidth: 0,
  } satisfies CSSProperties,

  /** The `▸` marker. Decorative, so it is aria-hidden at the call site. */
  marker: {
    color: "var(--text-muted)",
    fontSize: 11,
    flexShrink: 0,
  } satisfies CSSProperties,

  focusReason: {
    color: "var(--text-secondary)",
    minWidth: 0,
  } satisfies CSSProperties,

  emptyLine: {
    margin: 0,
    fontSize: 13.5,
    color: "var(--text-muted)",
    fontStyle: "italic",
  } satisfies CSSProperties,

  /** The degraded notice and the dropped-count notice: quiet caveats, not errors. */
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

  noticeActions: {
    marginTop: 8,
  } satisfies CSSProperties,

  historyToggle: {
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    padding: "4px 8px",
    marginLeft: -8,
    border: "none",
    borderRadius: 6,
    background: "transparent",
    color: "var(--text-muted)",
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: "0.07em",
    textTransform: "uppercase",
    cursor: "pointer",
  } satisfies CSSProperties,

  timeline: {
    margin: "8px 0 0",
    padding: 0,
    listStyle: "none",
    display: "flex",
    flexDirection: "column",
    gap: 8,
  } satisfies CSSProperties,

  timelineRow: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    fontSize: 13,
    minWidth: 0,
  } satisfies CSSProperties,

  sha: {
    fontFamily: "var(--font-mono, ui-monospace, monospace)",
    fontSize: 12,
    color: "var(--text-muted)",
    flexShrink: 0,
  } satisfies CSSProperties,

  timelineWhat: {
    color: "var(--text-secondary)",
    minWidth: 0,
    overflowWrap: "anywhere",
  } satisfies CSSProperties,

  footnote: {
    marginTop: 16,
    fontSize: 11.5,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
} as const;
