import type { CSSProperties } from "react";
import { COLUMN_GAP, COLUMN_MIN_WIDTH } from "./constants";

/** Co-located styles for MultiAgentResultsView. */
export const s = {
  wrap: { padding: "20px 24px 60px" } satisfies CSSProperties,
  header: {
    display: "flex",
    alignItems: "center",
    flexWrap: "wrap",
    gap: 12,
    paddingBottom: 12,
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  title: { fontSize: 19, fontWeight: 700, letterSpacing: "-0.01em" } satisfies CSSProperties,
  meta: { fontSize: 12.5, color: "var(--text-muted)" } satisfies CSSProperties,
  headerRight: { marginLeft: "auto", display: "flex", gap: 8, alignItems: "center" } satisfies CSSProperties,
  prLine: {
    display: "flex",
    alignItems: "baseline",
    gap: 10,
    padding: "10px 0 18px",
    fontSize: 13.5,
    minWidth: 0,
  } satisfies CSSProperties,
  prTitle: {
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,

  // ---- columns view -------------------------------------------------------
  // The view only renders when every column fits at `COLUMN_MIN_WIDTH`, so the
  // scroll below is a safety net that a correct fit check never engages - it is
  // not the answer to too many agents; the tabs fallback is.
  columns: {
    display: "flex",
    gap: COLUMN_GAP,
    overflowX: "auto",
    alignItems: "stretch",
    paddingBottom: 8,
  } satisfies CSSProperties,
  // Columns SHARE the available width instead of being pinned to their minimum,
  // so two agents fill the strip and five stop exactly at readability.
  column: {
    flex: "1 1 0",
    minWidth: COLUMN_MIN_WIDTH,
    display: "flex",
    flexDirection: "column",
    border: "1px solid var(--border)",
    borderRadius: 10,
    background: "var(--bg-surface)",
    overflow: "hidden",
  } satisfies CSSProperties,
  /** The agent's colour identity, on the card's top edge. */
  columnAccent: (color: string): CSSProperties => ({
    height: 3,
    background: color,
    flexShrink: 0,
  }),
  columnHead: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "12px 14px",
    borderBottom: "1px solid var(--border)",
  } satisfies CSSProperties,
  columnName: { fontSize: 13.5, fontWeight: 700, minWidth: 0 } satisfies CSSProperties,
  columnStat: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 2,
    fontFamily: "var(--font-mono, monospace)",
  } satisfies CSSProperties,
  // A 200-finding column scrolls within its own bounds; its neighbours keep
  // their height.
  columnBody: {
    padding: 10,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    maxHeight: 460,
    overflowY: "auto",
    flex: 1,
  } satisfies CSSProperties,
  columnFoot: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "10px 14px",
    borderTop: "1px solid var(--border)",
    fontSize: 12,
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  findingRow: (color: string): CSSProperties => ({
    borderLeft: `2px solid ${color}`,
    padding: "8px 10px",
    borderRadius: 6,
    background: "var(--bg-elevated)",
  }),
  findingTitle: {
    fontSize: 12.5,
    fontWeight: 600,
    // A 200-character title truncates here and is shown in full on the card.
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  findingWhere: {
    fontSize: 11,
    color: "var(--text-muted)",
    marginTop: 3,
    fontFamily: "var(--font-mono, monospace)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  columnError: {
    fontSize: 12,
    color: "var(--sev-critical, #ef4444)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  columnNote: { fontSize: 12, color: "var(--text-muted)" } satisfies CSSProperties,

  // ---- tabs view ----------------------------------------------------------
  tabStrip: {
    display: "flex",
    gap: 4,
    overflowX: "auto",
    borderBottom: "1px solid var(--border)",
    marginBottom: 16,
  } satisfies CSSProperties,
  // The active tab is underlined in that AGENT's colour, not in one shared
  // accent - which is what makes five tabs tell each other apart.
  tab: (active: boolean, color: string): CSSProperties => ({
    padding: "9px 14px",
    fontSize: 13,
    fontWeight: active ? 700 : 500,
    color: active ? "var(--text-primary)" : "var(--text-secondary)",
    background: "none",
    border: "none",
    borderBottom: `2px solid ${active ? color : "transparent"}`,
    cursor: "pointer",
    whiteSpace: "nowrap",
  }),
  verdictBar: (color: string): CSSProperties => ({
    display: "flex",
    alignItems: "flex-start",
    gap: 12,
    padding: "12px 14px",
    borderRadius: 9,
    border: "1px solid var(--border)",
    // The same agent colour the tab carries, so the card belongs to the tab.
    borderTop: `3px solid ${color}`,
    background: "var(--bg-surface)",
    marginBottom: 14,
  }),
  // AC-35 keeps the persisted summary VERBATIM, so a six-line paragraph is
  // clamped in CSS only - the whole string stays in the DOM either way.
  summary: (clamped: boolean): CSSProperties => ({
    fontSize: 13,
    color: "var(--text-secondary)",
    lineHeight: 1.5,
    ...(clamped
      ? {
          overflow: "hidden",
          display: "-webkit-box",
          WebkitLineClamp: 2,
          WebkitBoxOrient: "vertical",
        }
      : null),
  }) as CSSProperties,
  summaryToggle: {
    marginTop: 4,
    padding: 0,
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--accent)",
    fontSize: 12,
  } satisfies CSSProperties,
  cards: { display: "flex", flexDirection: "column", gap: 10 } satisfies CSSProperties,

  // ---- disagreement -------------------------------------------------------
  section: { marginTop: 30 } satisfies CSSProperties,
  sectionHead: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    marginBottom: 12,
  } satisfies CSSProperties,
  sectionTitle: {
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: "0.06em",
    textTransform: "uppercase",
    color: "var(--text-muted)",
  } satisfies CSSProperties,
  toggleGroup: {
    marginLeft: "auto",
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12.5,
    color: "var(--text-secondary)",
  } satisfies CSSProperties,
  cluster: {
    border: "1px solid var(--border)",
    borderRadius: 10,
    overflow: "hidden",
    marginBottom: 10,
  } satisfies CSSProperties,
  clusterHead: {
    display: "flex",
    alignItems: "baseline",
    gap: 12,
    padding: "11px 14px",
    background: "var(--bg-elevated)",
    borderBottom: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  clusterWhere: {
    fontSize: 12.5,
    fontFamily: "var(--font-mono, monospace)",
    color: "var(--text-secondary)",
    overflowWrap: "anywhere",
  } satisfies CSSProperties,
  clusterTitle: {
    fontSize: 13,
    fontWeight: 600,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    minWidth: 0,
  } satisfies CSSProperties,
  // On a narrow viewport this collapses to one agent per line, with the agent
  // name as the label - the columns never shrink below readability.
  takes: {
    display: "grid",
    gridTemplateColumns: "repeat(auto-fit, minmax(210px, 1fr))",
  } satisfies CSSProperties,
  take: {
    padding: "11px 14px",
    borderRight: "1px solid var(--border)",
    minWidth: 0,
  } satisfies CSSProperties,
  takeAgent: {
    fontSize: 12.5,
    fontWeight: 600,
    marginBottom: 5,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  } satisfies CSSProperties,
  takeVerdict: (color: string): CSSProperties => ({
    display: "inline-flex",
    alignItems: "center",
    gap: 6,
    fontSize: 11.5,
    fontWeight: 700,
    letterSpacing: "0.04em",
    color,
  }),
  takeSilent: { fontSize: 11.5, color: "var(--text-muted)" } satisfies CSSProperties,
  takeNote: {
    fontSize: 11.5,
    color: "var(--text-muted)",
    marginTop: 5,
    // An unbroken 500-character token wraps inside the cell rather than
    // widening the whole cluster row.
    overflowWrap: "anywhere",
    overflow: "hidden",
    display: "-webkit-box",
    WebkitLineClamp: 1,
    WebkitBoxOrient: "vertical",
  } as CSSProperties,
  empty: {
    fontSize: 13,
    color: "var(--text-muted)",
    padding: "18px 14px",
    border: "1px dashed var(--border)",
    borderRadius: 9,
  } satisfies CSSProperties,
  note: { fontSize: 13, color: "var(--text-muted)", padding: "22px 2px" } satisfies CSSProperties,
} as const;
