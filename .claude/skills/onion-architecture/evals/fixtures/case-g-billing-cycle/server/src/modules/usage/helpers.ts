import { INCLUDED_RUNS, OVERAGE_CENTS_PER_RUN } from './constants.js';

/** L13 — usage pure helpers. */

/** Runs beyond the included allowance. */
export function overageRuns(totalRuns: number): number {
  return Math.max(0, totalRuns - INCLUDED_RUNS);
}

/** Cents owed for the overage, or 0 when inside the allowance. */
export function overageCents(totalRuns: number): number {
  return overageRuns(totalRuns) * OVERAGE_CENTS_PER_RUN;
}

/** Start of the billing period a date falls in (calendar month, UTC). */
export function periodStart(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
}
