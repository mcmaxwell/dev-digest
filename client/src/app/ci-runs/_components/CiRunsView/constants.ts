/** Constants for CiRunsView. They live here rather than in the route file,
 *  because a Next `page.tsx` may export nothing but the route contract. */

/** The sentinel a dropdown uses for "do not filter on this column". */
export const ALL = "__all__";

/**
 * The time windows the first dropdown offers, in the order it offers them.
 *
 * `days: null` is "all time" - the list the server returns is already capped,
 * so no window means everything the page was given, not an unbounded read.
 */
export const TIME_WINDOWS = [
  { key: "last24Hours", days: 1 },
  { key: "last7Days", days: 7 },
  { key: "last30Days", days: 30 },
  { key: "allTime", days: null },
] as const;

/** Default window: the same one the mockup's dropdown opens on. */
export const DEFAULT_WINDOW = "last7Days";

/** `CiRunStatus`, paired with its message key (`no_findings` is not camelCase). */
export const STATUSES = [
  { value: "succeeded", key: "succeeded" },
  { value: "no_findings", key: "noFindings" },
  { value: "failed", key: "failed" },
  { value: "running", key: "running" },
] as const;
