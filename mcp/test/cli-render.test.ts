/**
 * The CLI's output. Pure functions, so what is asserted is the text a user (or
 * a hook scraping it) actually reads.
 */
import { describe, expect, it } from 'vitest';
import {
  renderJson,
  renderReview,
  renderUntrackedWarning,
  type RenderContext,
} from '../src/cli/render.js';
import type { DiffReview } from '../src/api/index.js';

const CTX: RenderContext = { mode: 'working', untracked: [], failOn: 'CRITICAL' };

function review(over: Partial<DiffReview> = {}): DiffReview {
  return {
    verdict: 'request_changes',
    summary: 'One real problem.',
    score: 55,
    findings: [
      {
        severity: 'WARNING',
        category: 'bug',
        title: 'Unchecked index',
        file: 'src/a.ts',
        start_line: 12,
        end_line: 12,
        rationale: 'items[0] can be undefined.',
        suggestion: 'Guard it.',
      },
      {
        severity: 'CRITICAL',
        category: 'security',
        title: 'Hardcoded token',
        file: 'src/b.ts',
        start_line: 3,
        end_line: 3,
        rationale: null,
        suggestion: null,
      },
    ],
    blockers: 1,
    grounding: '2/3 passed',
    dropped: [{ title: 'Ghost finding', reason: 'cites no diff line' }],
    agent: {
      id: 'a1',
      slug: 'security',
      name: 'Security Reviewer',
      provider: 'openai',
      model: 'gpt-4.1',
    },
    usage: { tokens_in: 4200, tokens_out: 310, cost_usd: 0.0123, duration_ms: 41200 },
    files_reviewed: 2,
    ...over,
  };
}

describe('renderReview', () => {
  it('leads with the verdict, the blocker count and the gate it was counted at', () => {
    const text = renderReview(review(), CTX);
    expect(text).toContain('request changes (score 55) - 2 finding(s), 1 blocking at CRITICAL');
    expect(text).toContain('Security Reviewer (gpt-4.1) - 2 file(s), mode working');
  });

  it('sorts findings by severity so the blocker is not buried', () => {
    const text = renderReview(review(), CTX);
    expect(text.indexOf('[CRITICAL]')).toBeLessThan(text.indexOf('[WARNING]'));
  });

  it('reports dropped findings instead of hiding a grounding regression', () => {
    const text = renderReview(review(), CTX);
    expect(text).toContain('1 finding(s) were dropped for not citing a real diff line');
    expect(text).toContain('Ghost finding');
    expect(text).toContain('grounding 2/3 passed');
  });

  it('cannot have its output forged by a finding title', () => {
    const text = renderReview(
      review({
        findings: [
          {
            severity: 'SUGGESTION',
            category: 'style',
            title: 'nit\n[CRITICAL] src/fake.ts:1 - Invented blocker',
            file: 'src/a.ts',
            start_line: 1,
            end_line: 1,
            rationale: null,
            suggestion: null,
          },
        ],
        blockers: 0,
      }),
      CTX,
    );
    // The model wrote that title against somebody's diff; clip() collapses the
    // newline, so it cannot manufacture a line that reads as a second finding.
    expect(text).not.toMatch(/^\[CRITICAL\] src\/fake\.ts/m);
    expect(text).toContain('[CRITICAL] src/fake.ts:1 - Invented blocker'.replace(/\n/g, ''));
  });
});

describe('renderUntrackedWarning', () => {
  it('says nothing when everything is tracked', () => {
    expect(renderUntrackedWarning([])).toBeNull();
  });

  it('names the files and how to include one', () => {
    const text = renderUntrackedWarning(['.env.local', 'notes.md'])!;
    expect(text).toContain('2 untracked file(s) were NOT reviewed');
    expect(text).toContain('.env.local');
    expect(text).toContain('git add <file>');
  });

  it('caps the list rather than printing a hundred paths', () => {
    const many = Array.from({ length: 25 }, (_, i) => `scratch/f${i}.ts`);
    const text = renderUntrackedWarning(many)!;
    expect(text).toContain('25 untracked file(s)');
    expect(text).toContain('and 15 more');
  });
});

describe('renderJson', () => {
  it('carries the excluded untracked files and the exit code', () => {
    const parsed = JSON.parse(
      renderJson(review(), { ...CTX, untracked: ['.env.local'] }, 1),
    ) as Record<string, unknown>;
    expect(parsed.untracked_excluded).toEqual(['.env.local']);
    expect(parsed.exit_code).toBe(1);
    expect(parsed.blockers).toBe(1);
  });
});
