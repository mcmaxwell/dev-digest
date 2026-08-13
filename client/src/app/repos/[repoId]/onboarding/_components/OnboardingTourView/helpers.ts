import type { Onboarding, OnboardingSection } from "@/lib/types";
import { MAX_PATH_CHARS } from "./constants";

/**
 * Keep the filename whole and middle-truncate the directory part.
 *
 * `src/modules/repo-intel/pipeline/incremental.ts` is a real path in this
 * product and it crowds a row at any sane width — but the FILENAME is the part
 * a reader scans for, so it is the part that must never be cut. The full path
 * still travels in `title` and `aria-label`.
 */
export function truncatePath(path: string, max = MAX_PATH_CHARS): string {
  if (path.length <= max) return path;
  const slash = path.lastIndexOf("/");
  if (slash === -1) return path;
  const file = path.slice(slash + 1);
  const dir = path.slice(0, slash);
  const room = max - file.length - 2; // 2 for the "…/" we always keep
  if (room <= 3) return `…/${file}`;
  const head = Math.ceil(room / 2);
  const tail = Math.floor(room / 2);
  return `${dir.slice(0, head)}…${dir.slice(dir.length - tail)}/${file}`;
}

/** Thousands separators, so "12450 files" reads as a number rather than a code. */
export function formatCount(n: number): string {
  return n.toLocaleString("en-US");
}

/** Short sha, as the header and every permalink use it. */
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

/**
 * A dollar amount, or null when the provider returned none.
 *
 * Null is deliberately NOT rendered as `$0.0000`: a provider without pricing
 * and a generation that genuinely cost nothing are different facts, and only
 * one of them is true here (AC-54).
 */
export function formatCost(costUsd: number | null): string | null {
  if (costUsd == null) return null;
  return `$${costUsd.toFixed(4)}`;
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * The whole tour as Markdown, for the clipboard (AC-45).
 *
 * Deliberately assembled from the STORED document rather than scraped from the
 * DOM: what the user pastes should be the tour, not the page's furniture.
 */
export function tourToMarkdown(tour: Onboarding, repoFullName: string): string {
  const out: string[] = [
    `# Onboarding tour — ${repoFullName}`,
    "",
    `Generated at \`${tour.head_sha}\` on ${tour.generated_at}.`,
    `Index of ${formatCount(tour.files_indexed)} files (${formatCount(tour.files_skipped)} skipped).`,
  ];
  if (tour.degraded_reasons.length > 0) {
    out.push("", `Degraded: ${tour.degraded_reasons.join(", ")}.`);
  }
  for (const section of tour.sections) {
    out.push("", `## ${section.title}`, "");
    if (section.body.trim().length > 0) out.push(section.body, "");
    out.push(...sectionRowsAsMarkdown(section));
    if (section.links.length > 0) {
      out.push("", ...section.links.map((l) => `- ${l.label}: \`${l.path}\``));
    }
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}

function sectionRowsAsMarkdown(section: OnboardingSection): string[] {
  switch (section.kind) {
    case "architecture":
      return section.diagram ? ["```mermaid", section.diagram, "```"] : [];
    case "critical_paths":
      return section.items.map((i) => `- \`${i.path}\` — ${i.reason}`);
    case "run_locally":
      return section.items.map((i) => `${i.step}. \`${i.command}\` (from \`${i.source}\`)`);
    case "reading_path":
      return section.items.map((i) => `${i.order}. \`${i.path}\` — ${i.reason}`);
    case "first_tasks":
      return section.items.map((i) =>
        i.origin === "issue"
          ? `- ${i.title} (issue #${i.issue_number})`
          : `- ${i.title} (\`${i.path}\`:${i.line})`,
      );
  }
}

/** A section carries content when it has prose, rows, or a diagram. */
export function sectionHasContent(section: OnboardingSection): boolean {
  if (section.body.trim().length > 0) return true;
  if (section.kind === "architecture") return section.diagram != null;
  return section.items.length > 0;
}
