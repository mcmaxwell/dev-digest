import type { ConventionCandidate, ConventionCategory } from "@devdigest/shared";
import { CATEGORY_ORDER } from "./constants";

/** Pure helpers for the conventions page. */

/**
 * A candidate's strength bar. Adherence is a MEASUREMENT of the repo; the
 * model's confidence is only an opinion — so prefer the measurement whenever we
 * have one.
 */
export function strengthOf(c: ConventionCandidate): number {
  return c.adherence ?? c.confidence;
}

export function strengthColor(value: number): string {
  if (value >= 0.85) return "var(--ok)";
  if (value >= 0.7) return "var(--warn)";
  return "var(--text-muted)";
}

/** Rejected candidates sink to the bottom; otherwise strongest first. */
export function sortCandidates(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return [...candidates].sort((a, b) => {
    const rejected = Number(a.status === "rejected") - Number(b.status === "rejected");
    if (rejected !== 0) return rejected;
    return strengthOf(b) - strengthOf(a);
  });
}

/** Group into the display order, dropping categories with nothing in them. */
export function groupByCategory(
  candidates: ConventionCandidate[],
): Array<{ category: ConventionCategory; items: ConventionCandidate[] }> {
  const byCategory = new Map<ConventionCategory, ConventionCandidate[]>();
  for (const c of candidates) {
    const arr = byCategory.get(c.category);
    if (arr) arr.push(c);
    else byCategory.set(c.category, [c]);
  }

  const ordered = [
    ...CATEGORY_ORDER.filter((c) => byCategory.has(c)),
    // Any category not in the display order still renders, at the end.
    ...[...byCategory.keys()].filter((c) => !CATEGORY_ORDER.includes(c)),
  ];
  return ordered.map((category) => ({
    category,
    items: sortCandidates(byCategory.get(category) ?? []),
  }));
}

export function acceptedOf(candidates: ConventionCandidate[]): ConventionCandidate[] {
  return candidates.filter((c) => c.status === "accepted");
}

/** "3 minutes ago" / "1h ago" for the scan header — no date library needed. */
export function relativeTime(iso: string | null | undefined, now = Date.now()): string {
  if (!iso) return "";
  const diffMs = now - new Date(iso).getTime();
  if (!Number.isFinite(diffMs) || diffMs < 0) return "just now";
  const mins = Math.floor(diffMs / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}
