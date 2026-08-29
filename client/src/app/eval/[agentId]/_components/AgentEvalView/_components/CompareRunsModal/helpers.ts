/** One rendered line of the prompt diff. */
export interface PromptDiffLine {
  text: string;
  state: "same" | "added" | "removed";
}

/**
 * A line-set diff of two system prompts.
 *
 * Deliberately set-based rather than a real LCS: the question this view answers
 * is "which instructions did we add or drop", and the prompts are short lists of
 * sentences whose ORDER carries no meaning. An LCS would additionally render a
 * moved line as one removal plus one addition, which reads as a change that did
 * not happen.
 */
export function diffPromptLines(left: string, right: string): PromptDiffLine[] {
  const l = left.split("\n");
  const r = right.split("\n");
  const leftSet = new Set(l.map((x) => x.trim()));
  const rightSet = new Set(r.map((x) => x.trim()));

  const out: PromptDiffLine[] = [];
  for (const line of l) {
    if (!rightSet.has(line.trim())) out.push({ text: line, state: "removed" });
  }
  for (const line of r) {
    out.push({ text: line, state: leftSet.has(line.trim()) ? "same" : "added" });
  }
  return out;
}
