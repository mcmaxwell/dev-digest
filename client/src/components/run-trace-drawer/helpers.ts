import type { LogLine } from "@devdigest/ui";
import type { RunTrace, SpecsReadEntry } from "@devdigest/shared";

interface RawEvent {
  t: string;
  kind: string;
  msg: string;
}

/** Map run-bus events to the LiveLogStream LogLine shape. */
export function eventsToLog(events: RawEvent[]): LogLine[] {
  return events.map((e) => ({ t: e.t, k: e.kind as LogLine["k"], m: e.msg }));
}

/** Map a persisted trace's log to the LiveLogStream LogLine shape. */
export function traceLog(trace: RunTrace | undefined): LogLine[] {
  return trace?.log.map((l) => ({ t: l.t, k: l.kind as LogLine["k"], m: l.msg })) ?? [];
}

/**
 * Normalise one `specs_read` item.
 *
 * `RunTrace.specs_read` is `Array<string | SpecsReadEntry>`: traces persisted
 * before L05 carry bare paths. Rendering the union straight into JSX throws
 * "Objects are not valid as a React child" on every post-L05 trace, and the
 * drawer parses nothing at runtime (`GET /runs/:id/trace` returns the stored
 * document uncast), so this is the only thing standing between an old trace and
 * a new one.
 */
export function toSpecsReadEntry(
  item: string | SpecsReadEntry,
): { path: string; status: SpecsReadEntry["status"] | null; tokens: number | null; origin: string | null } {
  if (typeof item === "string") {
    return { path: item, status: null, tokens: null, origin: null };
  }
  return { path: item.path, status: item.status, tokens: item.tokens, origin: item.origin };
}

/** Seconds-formatted duration. */
export function formatSeconds(ms: number): string {
  return `${(ms / 1000).toFixed(1)}s`;
}

/** Token in→out summary (e.g. "12k→1.5k"). */
export function formatTokens(tokensIn: number, tokensOut: number): string {
  return `${(tokensIn / 1000).toFixed(0)}k→${(tokensOut / 1000).toFixed(1)}k`;
}
