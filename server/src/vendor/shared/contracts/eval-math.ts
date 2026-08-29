/**
 * L06 - the two derived eval metrics, as pure arithmetic.
 *
 * A SEPARATE file with ZERO imports, and that is the whole point of it.
 *
 * The client's copy of these contracts is, in practice, a types-only copy:
 * every other client import of `@devdigest/shared` is `import type`, which the
 * compiler erases. These two are the first RUNTIME values the browser bundle
 * needs, and importing them through the barrel makes webpack follow the
 * barrel's `./contracts/*.js` specifiers - the NodeNext extensions tsc
 * understands and Next's webpack does not - which fails the build with a wall
 * of "Can't resolve './contracts/brief.js'".
 *
 * Keeping the arithmetic in a file that imports nothing lets the client deep
 * import `@devdigest/shared/contracts/eval-math` and resolve exactly one
 * module. The server still reaches them through the barrel, so there is one
 * implementation, and the number the server computes is by construction the
 * number the client prints.
 */

/**
 * The harmonic mean of precision and recall, and `0` when both are `0`.
 *
 * The headline metric, because precision and recall are each gameable alone: an
 * agent that emits nothing scores precision 1.0, one that flags every line
 * scores recall 1.0, and only their harmonic mean punishes both.
 */
export function evalF1(precision: number, recall: number): number {
  if (precision + recall === 0) return 0;
  return (2 * precision * recall) / (precision + recall);
}

/** z for a 95% two-sided interval. */
const WILSON_Z = 1.959963984540054;

/**
 * The Wilson score interval on a pass rate, as `[lo, hi]`.
 *
 * Shown next to every pass rate because an eval set of a dozen cases resolves
 * nothing finer than one case, and a bare "17/20" invites reading a single
 * flipped case as progress. Wilson rather than the normal approximation because
 * the normal one is worst exactly where this set lives - small n, proportions
 * near 0 or 1, where it returns bounds outside [0, 1].
 */
export function evalWilson(passed: number, total: number): [number, number] {
  if (total <= 0) return [0, 1];
  const p = passed / total;
  const z2 = WILSON_Z * WILSON_Z;
  const denom = 1 + z2 / total;
  const centre = (p + z2 / (2 * total)) / denom;
  const margin =
    (WILSON_Z / denom) * Math.sqrt((p * (1 - p)) / total + z2 / (4 * total * total));
  return [Math.max(0, centre - margin), Math.min(1, centre + margin)];
}
