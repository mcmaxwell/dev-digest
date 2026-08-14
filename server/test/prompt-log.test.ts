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

/**
 * L06 asks two things of this module that the block above does not pin:
 *
 *   AC-55  ONE structured line per generation, carrying the section names,
 *          their token counts, the MODEL and the CORRELATION ID.
 *   AC-70  secret-shaped strings are scrubbed from every line — and the only
 *          channel that can carry a line of a repository file is the verbose
 *          outline, so that is where the scrub has to be observed rather than
 *          on `scrubSecrets` in isolation.
 */
describe('prompt-log — the onboarding generation line (AC-55, AC-70)', () => {
  const ONBOARDING_META = {
    correlationId: '7b1f0f7a-6a2b-4a0a-9b8d-1f2e3d4c5b6a',
    call: 'onboarding' as const,
    provider: 'openrouter',
    model: 'deepseek/deepseek-v4-flash',
  };

  it('names the call, the correlation id and the model on the record itself', () => {
    const rec = buildPromptLogRecord(ONBOARDING_META, SECTIONS, count, 'summary');
    expect(rec).toMatchObject({
      event: 'prompt.assembled',
      call: 'onboarding',
      correlation_id: ONBOARDING_META.correlationId,
      provider: 'openrouter',
      model: 'deepseek/deepseek-v4-flash',
    });
    // No review-only ids leak onto a generation's line.
    expect(rec).not.toHaveProperty('pr_id');
    expect(rec).not.toHaveProperty('run_id');
    expect(rec).not.toHaveProperty('agent');
  });

  it('counts tokens per named section, which is what makes the line actionable', () => {
    const rec = buildPromptLogRecord(ONBOARDING_META, SECTIONS, count, 'summary');
    for (const row of rec.sections) {
      expect(row.tokens).toBe(count(SECTIONS.find((s) => s.section === row.section)!.text!));
      expect(row.tokens).toBeGreaterThan(0);
    }
    expect(rec.totals.tokens).toBe(rec.sections.reduce((n, s) => n + s.tokens, 0));
  });

  it('redacts a secret carried inside a heading the verbose outline keeps', () => {
    // The exact AC-70 scenario: a README whose heading holds an example API
    // key. The heading is structure, so the outline keeps the LINE — which is
    // why the scrub, not the outline filter, is what protects the log here.
    const key = ['sk', 'abcdefghij0123456789ABCD'].join('-');
    const readme = [
      '<untrusted source="README.md">',
      `# Set OPENAI_API_KEY=${key} before starting`,
      '</untrusted>',
    ].join('\n');

    const rec = buildPromptLogRecord(
      ONBOARDING_META,
      [{ section: 'readme', source: 'clone:README.md', text: readme }],
      count,
      'verbose',
    );
    const outline = rec.sections[0]!.outline!.join('\n');

    // The heading survived and only the key was replaced — otherwise the key's
    // absence would prove nothing but that the whole line was dropped.
    expect(outline).toContain('before starting');
    expect(outline).toContain('[redacted:openai-key]');
    expect(JSON.stringify(rec)).not.toContain(key);
  });

  it('redacts every vendor shape it claims to know', () => {
    const cases: Array<[string, string]> = [
      [['github_pat', 'abcdefghij0123456789ABCDEF'].join('_'), '[redacted:github-pat]'],
      [`AWS_ACCESS_KEY_ID=${['AKIA', 'IOSFODNN7EXAMPLE'].join('')}`, '[redacted:aws-key]'],
      [['-----BEGIN RSA', 'PRIVATE KEY-----'].join(' '), '[redacted:private-key]'],
      [
        ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dozjgNryP4J3jVmNHl0w5N_XgL0'].join('.'),
        '[redacted:jwt]',
      ],
    ];
    for (const [input, label] of cases) {
      expect(scrubSecrets(input), input.slice(0, 12)).toContain(label);
    }
  });

  it('hands the caller the same record it logged, and nothing without a logger', () => {
    const seen: { obj: unknown; msg?: string }[] = [];
    const record = logPromptAssembly(
      { info: (obj: unknown, msg?: string) => seen.push({ obj, msg }) },
      'summary',
      ONBOARDING_META,
      SECTIONS,
      count,
    );

    expect(seen).toHaveLength(1);
    expect(seen[0]!.obj).toBe(record);
    expect(seen[0]!.msg).toBe('prompt assembled (onboarding)');

    expect(logPromptAssembly(undefined, 'summary', ONBOARDING_META, SECTIONS, count)).toBeUndefined();
  });
});
