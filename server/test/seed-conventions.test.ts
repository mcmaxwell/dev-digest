import { describe, it, expect } from 'vitest';
import { SEED_CONVENTIONS, SEED_SCAN_SHA } from '../src/db/seed-conventions.js';
import { ruleKeyFor } from '../src/modules/conventions/dedupe.js';

/**
 * `seed-conventions.ts` ships PRECOMPUTED rule keys so that `db/` never imports
 * application code from `modules/`. That trade only holds while the constants
 * match what the real function produces — a rule text edited without updating
 * its key would make the seeded row invisible to the upsert, and a re-scan
 * would silently fork the card.
 */
describe('seed conventions', () => {
  it('carries the rule key ruleKeyFor() actually derives', () => {
    for (const c of SEED_CONVENTIONS) {
      expect(c.ruleKey, `stale ruleKey for: ${c.rule}`).toBe(ruleKeyFor(c.rule));
    }
  });

  it('pins every evidence item to the sha of the seeded scan', () => {
    // The card links `path:line` to GitHub at this sha; a mismatch would point
    // the user at a commit the snippet was never verified against.
    for (const c of SEED_CONVENTIONS) {
      expect(c.evidence.length).toBeGreaterThan(0);
      for (const e of c.evidence) expect(e.sha).toBe(SEED_SCAN_SHA);
    }
  });
});
