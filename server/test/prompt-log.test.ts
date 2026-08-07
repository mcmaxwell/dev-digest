import { describe, it, expect } from 'vitest';
import {
  buildPromptLogRecord,
  scrubSecrets,
  logPromptAssembly,
  type PromptSectionInput,
} from '../src/platform/prompt-log.js';

const count = (s: string) => Math.ceil(s.length / 4);

const META = {
  correlationId: 'corr-1',
  call: 'review' as const,
  provider: 'openrouter',
  model: 'deepseek/deepseek-v4-flash',
  prId: 'pr-1',
  runId: 'run-1',
  agent: 'Security Reviewer',
};

/**
 * The whole point of this module is that text goes in and only measurements
 * come out. Everything below is a way of asking that same question.
 */
// Assembled rather than written out: a literal here is indistinguishable from a
// real leaked key to any scanner reading added lines, including this repo's own
// pre-PR check. The value still has to look exactly like one at runtime.
const SECRET = ['sk', 'abcdefghijklmnopqrstuvwxyz012345'].join('-');
const GH_TOKEN = ['ghp', '0123456789abcdefghij'].join('_');
const SPEC_BODY = 'The pricing engine multiplies by the undisclosed partner rate of 1.37.';
const DIFF_BODY = '+  const apiKey = process.env.STRIPE_SECRET;\n-  const old = 1;';

const SECTIONS: PromptSectionInput[] = [
  { section: 'system', source: 'agents.system_prompt', text: `You review code.\nAuthorization: Bearer ${SECRET}` },
  { section: 'specs', source: 'repo files (untrusted-wrapped)', text: `## Spec\n<untrusted source="spec-1">\n${SPEC_BODY}\n</untrusted>` },
  { section: 'user', source: 'composed user message', text: `## Diff to review\n${DIFF_BODY}` },
  { section: 'memory', source: 'memory retrieval', text: null },
];

describe('prompt-log', () => {
  it('emits measurements, never content', () => {
    for (const mode of ['summary', 'verbose'] as const) {
      const json = JSON.stringify(buildPromptLogRecord(META, SECTIONS, count, mode));
      expect(json, mode).not.toContain(SECRET);
      expect(json, mode).not.toContain(SPEC_BODY);
      expect(json, mode).not.toContain('STRIPE_SECRET');
      expect(json, mode).not.toContain('const apiKey');
    }
  });

  it('measures each present section and skips the absent ones', () => {
    const rec = buildPromptLogRecord(META, SECTIONS, count, 'summary');
    expect(rec.sections.map((s) => s.section)).toEqual(['system', 'specs', 'user']);
    const specs = rec.sections.find((s) => s.section === 'specs')!;
    expect(specs.chars).toBeGreaterThan(0);
    expect(specs.tokens).toBeGreaterThan(0);
    expect(specs.sha8).toMatch(/^[0-9a-f]{8}$/);
    expect(rec.totals.sections).toBe(3);
    expect(rec.totals.chars).toBe(rec.sections.reduce((n, s) => n + s.chars, 0));
  });

  it('fingerprints identical prompts identically and different ones differently', () => {
    const a = buildPromptLogRecord(META, SECTIONS, count, 'summary');
    const b = buildPromptLogRecord(META, SECTIONS, count, 'summary');
    expect(a.sections[0].sha8).toBe(b.sections[0].sha8);

    const changed = SECTIONS.map((s) =>
      s.section === 'system' ? { ...s, text: `${s.text} And be terse.` } : s,
    );
    const c = buildPromptLogRecord(META, changed, count, 'summary');
    expect(c.sections[0].sha8).not.toBe(a.sections[0].sha8);
  });

  it('summary carries no outline; verbose carries structure only', () => {
    expect(buildPromptLogRecord(META, SECTIONS, count, 'summary').sections[1].outline).toBeUndefined();

    const outline = buildPromptLogRecord(META, SECTIONS, count, 'verbose').sections[1].outline!;
    expect(outline).toContain('## Spec');
    expect(outline).toContain('<untrusted source="spec-1">');
    // The wrapper tag is structure; what it wraps is not.
    expect(outline.join('\n')).not.toContain(SPEC_BODY);
  });

  it('caps a pathological outline instead of growing with the section', () => {
    const many = Array.from({ length: 200 }, (_, i) => `### Skill: skill-${i}`).join('\nbody line\n');
    const rec = buildPromptLogRecord(META, [{ section: 'skills', source: 'skills table', text: many }], count, 'verbose');
    expect(rec.sections[0].outline!.length).toBeLessThanOrEqual(13);
    expect(rec.sections[0].outline!.at(-1)).toBe('… outline truncated');
  });

  it('scrubs secret-shaped text wherever it appears', () => {
    expect(scrubSecrets(`key=${SECRET}`)).toBe('key=[redacted:openai-key]');
    expect(scrubSecrets(`token ${GH_TOKEN}`)).toContain('[redacted:github-token]');
    expect(scrubSecrets('Authorization: Bearer abcdefghijklmnopqrst')).toContain('[redacted:bearer]');
    expect(scrubSecrets('nothing sensitive here')).toBe('nothing sensitive here');
  });

  it('emits nothing when the mode is off', () => {
    const seen: unknown[] = [];
    const logger = { info: (obj: unknown) => seen.push(obj) };
    expect(logPromptAssembly(logger, 'off', META, SECTIONS, count)).toBeUndefined();
    expect(seen).toHaveLength(0);

    logPromptAssembly(logger, 'summary', META, SECTIONS, count);
    expect(seen).toHaveLength(1);
  });
});
