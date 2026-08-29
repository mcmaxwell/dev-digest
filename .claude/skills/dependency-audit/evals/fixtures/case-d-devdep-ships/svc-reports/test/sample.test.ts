import { describe, it, expect } from 'vitest';
import { fillMissingRows } from '../src/sample.js';

describe('fillMissingRows', () => {
  it('pads up to the requested length', () => {
    expect(fillMissingRows([], 3)).toHaveLength(3);
  });
});
