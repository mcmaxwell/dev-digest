/**
 * Minimal logging port. Services depend on THIS, not on Fastify's logger, so
 * the application layer stays free of transport types; `app.log` (Pino) is
 * structurally compatible and is what routes pass in.
 */
export interface Logger {
  warn(obj: unknown, msg?: string): void;
}

/** Drop-in for callers with nothing to log to (tests, jobs). */
export const noopLogger: Logger = { warn: () => {} };
