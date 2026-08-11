import type { IconName } from "@devdigest/ui";

/** The two ways to read the same data. `tree` is the default: it is complete,
 *  the graph is a capped overview. */
export const BLAST_VIEWS = ["tree", "graph"] as const;
export type BlastView = (typeof BLAST_VIEWS)[number];

/** The four stat chips, in the order the mock puts them. */
export const STAT_ICONS: Record<"symbols" | "callers" | "endpoints" | "crons", IconName> = {
  symbols: "Code",
  callers: "GitBranch",
  endpoints: "Globe",
  crons: "Clock",
};

/**
 * Graph caps. A mermaid diagram past roughly this size stops being a picture and
 * becomes a wall, and the tree view is the complete answer anyway - so the graph
 * is deliberately an overview and says so by showing the most-called symbols.
 */
export const GRAPH_MAX_SYMBOLS = 12;
export const GRAPH_MAX_CALLERS_PER_SYMBOL = 6;
/** Node labels longer than this are clamped; identifiers are short by nature. */
export const GRAPH_MAX_LABEL = 40;
