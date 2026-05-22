import { describe, expect, it } from 'vitest';
import { findPhraseInRecentText, normalizeWords } from './naiveMatcher';

describe('normalizeWords', () => {
  it('lowercases text and strips punctuation', () => {
    expect(normalizeWords('Goodnight, Moon!')).toEqual(['goodnight', 'moon']);
  });
});

describe('findPhraseInRecentText', () => {
  it('finds a normalized phrase inside recent ASR text', () => {
    expect(findPhraseInRecentText('then the truck went BOOM loudly', 'truck went boom')).toBe(true);
  });

  it('does not match missing phrases', () => {
    expect(findPhraseInRecentText('quiet snow fell', 'truck went boom')).toBe(false);
  });
});
