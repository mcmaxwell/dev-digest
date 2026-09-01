/** Shared number formatters (see also model-label.ts for per-1M price labels). */

/**
 * USD amount for run-cost surfaces (PR list, timeline, trace stats).
 * Unknown cost (null/undefined) renders as an em dash — never "$0.00", which
 * would read as "free" instead of "unpriced".
 * Sub-dollar amounts keep 2 significant digits so typical run costs stay
 * readable: $0.06, $0.014, $0.0013.
 */
export function formatUsd(usd: number | null | undefined): string {
  if (usd == null) return "—";
  if (usd === 0) return "$0.00";
  if (usd >= 1) return `$${usd.toFixed(2)}`;
  return `$${Number(usd.toPrecision(2))}`;
}

/**
 * A run's timestamp for a list row: the date and the time, with NO seconds.
 * The default `toLocaleString()` renders `8/28/2026, 8:55:16 PM`, and the
 * seconds of a run's start are noise on every surface that lists runs.
 *
 * The locale is the runtime's own, like every other date on these screens.
 * An unparseable value is handed back untouched rather than shown as
 * "Invalid Date".
 */
export function formatRunTime(when: string | number | Date): string {
  const d = when instanceof Date ? when : new Date(when);
  if (Number.isNaN(d.getTime())) return String(when);
  return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}
