/**
 * The stored form of the brief's prose (AC-21).
 *
 * The three-sentence rule lived only in the prompt, which is a request rather
 * than an enforcement: a model that writes four sentences used to have all four
 * persisted. These cases fix the observation the criterion names — sentence-
 * terminating marks in the stored `what` and `why` — onto the clamp itself.
 */
import { describe, expect, it } from 'vitest';
import { clampProse } from './service.js';
import { MAX_PROSE_CHARS, MAX_PROSE_SENTENCES } from './constants.js';

/** The criterion's own observation, counted the way the clamp counts. */
function terminators(text: string): number {
  return text.match(/[.!?]+(?=\s|$)/g)?.length ?? 0;
}

describe('clampProse', () => {
  it('stores a four-sentence field as three', () => {
    const out = clampProse('One thing. Two things. Three things. Four things.');
    expect(out).toBe('One thing. Two things. Three things.');
    expect(terminators(out)).toBe(MAX_PROSE_SENTENCES);
  });

  it('leaves a field that is already within the cap untouched', () => {
    const text = 'It touches the rate limiter. It runs before auth. Read the 429 branch.';
    expect(clampProse(text)).toBe(text);
  });

  it('truncates rather than rejecting, so a wordy model still produces a brief', () => {
    // The four degraded gates exist for missing facts, never for long prose.
    expect(() => clampProse('A. B. C. D. E. F.')).not.toThrow();
    expect(clampProse('A. B. C. D. E. F.')).toBe('A. B. C.');
  });

  it('does not treat the dot in a file path as the end of a sentence', () => {
    // This prose is ABOUT paths, so a bare `[.!?]` count would cut here.
    const text =
      'It changes src/config.ts and src/middleware/ratelimit.ts. ' +
      'Both are reached by the public API server. It adds no route.';
    expect(clampProse(text)).toBe(text);
  });

  it('keeps a trailing unterminated sentence off the end', () => {
    expect(clampProse('One. Two. Three. A fourth that never ends')).toBe('One. Two. Three.');
  });

  it('counts a run of marks once, so an ellipsis typed as dots is one sentence', () => {
    expect(clampProse('One... Two. Three. Four.')).toBe('One... Two. Three.');
  });

  it('still applies the character cap, and applies it to what survives', () => {
    const long = `${'a'.repeat(MAX_PROSE_CHARS * 2)}. Second. Third. Fourth.`;
    const out = clampProse(long);
    expect(out.length).toBe(MAX_PROSE_CHARS);
    expect(out.endsWith('…')).toBe(true);
  });

  it('trims before it counts, so leading whitespace cannot smuggle a sentence in', () => {
    expect(clampProse('  One. Two. Three. Four.  ')).toBe('One. Two. Three.');
  });
});
