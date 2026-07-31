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
