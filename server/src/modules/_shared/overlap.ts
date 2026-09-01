/**
 * Shared location overlap - pure, no DB, no model call. Lives in `_shared`
 * because BOTH the eval module (does a finding sit at an expectation's
 * location?) and the reviews module (do two agents' findings belong in the same
 * cluster?) ask exactly the same question, and `no-cross-module-imports` forbids
 * either one importing the other's internals.
 *
 * Moved here verbatim from `modules/eval/scoring.ts`, which still re-exports it
 * so every existing call site and `test/eval-scoring.test.ts` keep compiling.
 * Same move `rollupSeverities` made from `pulls/status.ts` to `_shared/severity.ts`,
 * for the same reason.
 */

/** A location, in the only two fields the matcher reads. */
export interface Located {
  file: string;
  start_line: number;
  end_line: number;
}

/**
 * Does a finding sit at an expectation's location?
 *
 * Same file, and the two line ranges intersect. Deliberately NOT an exact line
 * match: a model that reports lines 12-14 for a secret declared on line 12 has
 * found the thing, and a scorer that says otherwise measures formatting.
 *
 * Ranges are normalised first, because nothing stops a model from emitting
 * `start_line` above `end_line`.
 */
export function overlaps(a: Located, b: Located): boolean {
  if (a.file !== b.file) return false;
  const aLo = Math.min(a.start_line, a.end_line);
  const aHi = Math.max(a.start_line, a.end_line);
  const bLo = Math.min(b.start_line, b.end_line);
  const bHi = Math.max(b.start_line, b.end_line);
  return aLo <= bHi && bLo <= aHi;
}
