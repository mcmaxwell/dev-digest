import type {
  ConventionCategory,
  ConventionEvidence,
  ConventionOrigin,
} from '@devdigest/shared';

/**
 * Demo convention candidates for the seeded repo (L02).
 *
 * The real pipeline needs a cloned repo and a model key; these give
 * `/conventions` something to show on a fresh install and keep the browser e2e
 * flow deterministic — the same role the seeded review + findings already play
 * for the PR page.
 *
 * They mirror what a real scan produces: a mix of origins, one rule with a
 * MEASURED adherence and one without, and evidence that carries a `file:line`.
 */

/** Must match the seeded scan row's sha in seed.ts — evidence links pin to it. */
export const SEED_SCAN_SHA = 'a1b2c3d4e5f6';

export interface SeedConvention {
  category: ConventionCategory;
  rule: string;
  /**
   * Precomputed `ruleKeyFor(rule)`. Stored rather than computed so `db/` never
   * imports application code from `modules/` — `test/seed-conventions.test.ts`
   * asserts these stay in step with the real function.
   */
  ruleKey: string;
  rationale: string;
  evidence: ConventionEvidence[];
  confidence: number;
  adherence: number | null;
  support: number | null;
  violations: number | null;
  origin: ConventionOrigin;
}

export const SEED_CONVENTIONS: SeedConvention[] = [
  {
    category: 'async',
    rule: 'Always use `async`/`await` instead of `.then()` chains.',
    ruleKey: 'async-await-chain-instead-then',
    rationale:
      'Every data-access path in the sampled files awaits directly; a promise chain reads as foreign here and loses stack context on rejection.',
    evidence: [
      {
        path: 'src/api/users.ts',
        line: 23,
        snippet: 'const user = await db.users.find(id);',
        verified: 'exact',
        sha: SEED_SCAN_SHA,
      },
      {
        path: 'src/api/public/webhooks.ts',
        line: 41,
        snippet: 'const events = await queue.drain({ limit: 50 });',
        verified: 'exact',
        sha: SEED_SCAN_SHA,
      },
    ],
    confidence: 0.91,
    adherence: 0.94,
    support: 47,
    violations: 3,
    origin: 'llm',
  },
  {
    category: 'api-contract',
    rule: 'All public route handlers return a typed `Result<T, ApiError>` rather than throwing.',
    ruleKey: 'apierror-handler-public-rather-result-return-rout-than-throw-typ',
    rationale:
      'The public API layer converts failures into an explicit error value so the envelope stays uniform for callers.',
    evidence: [
      {
        path: 'src/api/public/index.ts',
        line: 14,
        snippet: 'function handler(): Result<Item[], ApiError> {',
        verified: 'exact',
        sha: SEED_SCAN_SHA,
      },
      {
        path: 'src/api/public/webhooks.ts',
        line: 9,
        snippet: 'export function receive(): Result<Ack, ApiError> {',
        verified: 'relocated',
        sha: SEED_SCAN_SHA,
      },
    ],
    confidence: 0.78,
    adherence: null,
    support: null,
    violations: null,
    origin: 'llm',
  },
  {
    category: 'structure',
    rule: 'Redis access goes through the `src/lib/redis.ts` singleton — never construct a client inline.',
    ruleKey: 'acces-client-construct-goe-inlin-redi-singleton-src/lib/redis.ts-through',
    rationale:
      'One shared connection is created at module load; an inline client leaks a socket per request under the new rate limiter.',
    evidence: [
      {
        path: 'src/lib/redis.ts',
        line: 1,
        snippet: 'export const redis = new Redis(config.redisUrl);',
        verified: 'exact',
        sha: SEED_SCAN_SHA,
      },
      {
        path: 'src/middleware/ratelimit.ts',
        line: 7,
        snippet: "import { redis } from '../lib/redis';",
        verified: 'exact',
        sha: SEED_SCAN_SHA,
      },
    ],
    confidence: 0.85,
    adherence: 0.88,
    support: 22,
    violations: 3,
    origin: 'llm',
  },
];
