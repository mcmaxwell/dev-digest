import type { PrBlastRadius } from "@devdigest/shared";
import {
  GRAPH_MAX_CALLERS_PER_SYMBOL,
  GRAPH_MAX_LABEL,
  GRAPH_MAX_SYMBOLS,
} from "./constants";

/**
 * PURE: a blast radius -> a mermaid flowchart string.
 *
 * THIS FUNCTION IS WHERE THE GRAPH'S SAFETY LIVES, and it is pure so it can be
 * tested as one. Every label on this diagram is a symbol name or a file path
 * from somebody else's repository, i.e. attacker-influenced text, and mermaid's
 * source is a small language with its own syntax.
 *
 * Two properties, both asserted in the tests:
 *
 *  1. NODE IDS ARE SYNTHETIC (`n0`, `n1`, …), never derived from data. An id
 *     built from a name is the direct route from `A"];click B` to injected
 *     diagram syntax.
 *  2. LABELS ARE ESCAPED AND CLAMPED. Quotes, backticks, brackets, newlines and
 *     control characters are removed or replaced before the label is wrapped in
 *     quotes, so no label can terminate its own node.
 *
 * `securityLevel: "strict"` in `MermaidDiagram` is a second layer, not the
 * boundary: it stops script execution, not a forged edge that misrepresents the
 * code. Neither layer is enough alone.
 */
export function toMermaid(blast: PrBlastRadius): string {
  const lines = ["flowchart LR"];
  let seq = 0;
  const idFor = new Map<string, string>();
  /** Synthetic id per unique label key. NEVER derived from the text itself. */
  const node = (key: string, label: string): string => {
    const existing = idFor.get(key);
    if (existing) return existing;
    const id = `n${seq++}`;
    idFor.set(key, id);
    lines.push(`  ${id}["${escapeLabel(label)}"]`);
    return id;
  };

  const symbols = blast.downstream.slice(0, GRAPH_MAX_SYMBOLS);
  let edges = 0;

  for (const down of symbols) {
    const symbolId = node(`s:${down.symbol}`, down.symbol);
    for (const caller of down.callers.slice(0, GRAPH_MAX_CALLERS_PER_SYMBOL)) {
      const callerId = node(`f:${caller.file}`, shortenPath(caller.file));
      // Direction points the way IMPACT travels: the caller depends on the
      // changed symbol, so a change flows from the symbol out to the caller.
      lines.push(`  ${symbolId} --> ${callerId}`);
      edges += 1;
    }
    for (const endpoint of down.endpoints_affected.slice(0, GRAPH_MAX_CALLERS_PER_SYMBOL)) {
      const endpointId = node(`e:${endpoint}`, endpoint);
      lines.push(`  ${symbolId} -.-> ${endpointId}`);
      edges += 1;
    }
  }

  // A diagram with nodes and no edges is a row of disconnected boxes, which
  // tells a reader less than a sentence does. The caller renders `graph.empty`.
  return edges === 0 ? "" : lines.join("\n");
}

/**
 * Everything mermaid could read as syntax, plus everything a terminal or the DOM
 * could read as structure. Whitespace collapses first, so a multi-line name
 * cannot become multiple diagram statements.
 */
function escapeLabel(text: string): string {
  const flat = text
    // Control characters first: a name carrying a newline must not become
    // two diagram statements.
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/["'`]/g, "")
    .replace(/[[\]{}()<>|;#]/g, "")
    .trim();
  const clamped =
    flat.length <= GRAPH_MAX_LABEL ? flat : `${flat.slice(0, GRAPH_MAX_LABEL - 1)}…`;
  // A label that escaped to nothing still needs a node, or the edge dangles.
  return clamped.length > 0 ? clamped : "?";
}

/** `src/api/routes/charges.ts` -> `routes/charges.ts`: enough to recognise. */
function shortenPath(path: string): string {
  const parts = path.split("/");
  return parts.length <= 2 ? path : parts.slice(-2).join("/");
}
