import type { Severity } from '../api/index.js';

/** Ordered weakest to strongest, so `severity_min` reads as a floor. */
export const SEVERITY_ORDER: readonly Severity[] = ['SUGGESTION', 'WARNING', 'CRITICAL'];

export function atLeast(severity: Severity, min: Severity): boolean {
  return SEVERITY_ORDER.indexOf(severity) >= SEVERITY_ORDER.indexOf(min);
}

/** The next stricter floor, or undefined when already at CRITICAL. */
export function stricterThan(min: Severity): Severity | undefined {
  return SEVERITY_ORDER[SEVERITY_ORDER.indexOf(min) + 1];
}
