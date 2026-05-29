import { describe, expect, it } from 'vitest';

import { normalizeWords } from './normalize';

describe('normalizeWords', () => {
  it('lowercases text and strips punctuation', () => {
    expect(normalizeWords('Goodnight, Moon!')).toEqual(['goodnight', 'moon']);
  });

  it('keeps apostrophes and digits as part of tokens', () => {
    expect(normalizeWords("it's 3 trucks")).toEqual(["it's", '3', 'trucks']);
  });

  it('collapses arbitrary whitespace and returns empty for blank input', () => {
    expect(normalizeWords('  the   crew  ')).toEqual(['the', 'crew']);
    expect(normalizeWords('   ')).toEqual([]);
  });
});
