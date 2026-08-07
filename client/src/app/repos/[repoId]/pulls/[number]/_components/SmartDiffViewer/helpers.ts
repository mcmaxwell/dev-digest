import type { PrFile, ReviewRecord, SmartDiffFile } from "@devdigest/shared";
import type { Severity } from "@devdigest/ui";

/**
 * Which lines the server flagged is the server's answer (`finding_lines`); what
 * COLOUR each one gets is looked up here, from the reviews the PR page already
 * has in cache. Keeping severity out of the contract means the endpoint stays a
 * pure grouping of files, and the marks stay in step with the findings list the
 * user is looking at — including one they just dismissed.
 */

/**
 * Mirrors the server's `latestReviewFindings`: newest review first, and when it
 * belongs to a run, every review from that same run (so a multi-agent run
 * contributes all of its agents). Summaries carry no findings and are skipped.
 */
export function latestReviews(reviews: readonly ReviewRecord[] | undefined): ReviewRecord[] {
  const real = (reviews ?? []).filter((r) => r.kind === "review");
  const newest = real[0];
  if (!newest) return [];
  return newest.run_id ? real.filter((r) => r.run_id === newest.run_id) : [newest];
}

/**
 * `path → (line → severity)`. Only the latest review's live findings count; a
 * dismissed one is gone from the diff the moment it is dismissed. When two
 * findings land on the same line the more severe one wins the colour.
 */
export function severityByPath(
  reviews: readonly ReviewRecord[] | undefined,
): Map<string, Map<number, Severity>> {
  const rank: Severity[] = ["CRITICAL", "WARNING", "SUGGESTION", "INFO"];
  const out = new Map<string, Map<number, Severity>>();
  for (const review of latestReviews(reviews)) {
    for (const f of review.findings) {
      if (f.dismissed_at) continue;
      let byLine = out.get(f.file);
      if (!byLine) out.set(f.file, (byLine = new Map()));
      const current = byLine.get(f.start_line);
      const severity = f.severity as Severity;
      if (!current || rank.indexOf(severity) < rank.indexOf(current)) {
        byLine.set(f.start_line, severity);
      }
    }
  }
  return out;
}

/**
 * The `flags` map for one file: every line the SERVER flagged, coloured from
 * the reviews where we have them. A line with no matching review finding still
 * gets a mark (INFO) rather than disappearing — the server is the authority on
 * which lines are flagged, so a colour lookup miss must not silently drop one.
 */
export function flagsFor(
  file: SmartDiffFile,
  severities: Map<string, Map<number, Severity>>,
): Map<number, Severity> {
  const byLine = severities.get(file.path);
  return new Map(file.finding_lines.map((line) => [line, byLine?.get(line) ?? "INFO"]));
}

/**
 * Smart Diff carries no patch text — it is a grouping of paths — so each entry
 * is rejoined to the `PrFile` the PR detail already loaded. A grouped file with
 * no matching `PrFile` is dropped rather than rendered patchless: it can only
 * mean the two responses disagree, and an empty card would look like a bug in
 * the diff rather than a stale fetch.
 */
export function toPrFiles(
  group: readonly SmartDiffFile[],
  files: readonly PrFile[],
): { entry: SmartDiffFile; file: PrFile }[] {
  const byPath = new Map(files.map((f) => [f.path, f]));
  return group.flatMap((entry) => {
    const file = byPath.get(entry.path);
    return file ? [{ entry, file }] : [];
  });
}
