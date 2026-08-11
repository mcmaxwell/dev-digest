/**
 * Truncation is never silent. A model that gets 20 of 143 findings and is not
 * told so will confidently report "the PR has 20 issues"; the counts below are
 * always computed from the FULL set, so the hint it reads is actionable.
 */

export interface Taken<T> {
  shown: T[];
  total: number;
  withheld: number;
}

export function take<T>(items: readonly T[], limit: number): Taken<T> {
  const shown = items.slice(0, limit);
  return { shown, total: items.length, withheld: items.length - shown.length };
}

/** Clip a markdown body to keep one finding from swallowing the response. */
export function clip(text: string, max = 200): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length <= max ? flat : `${flat.slice(0, max).trimEnd()}...`;
}
