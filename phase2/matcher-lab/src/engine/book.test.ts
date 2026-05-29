import { describe, expect, it } from 'vitest';

import { constructionChristmasBookText, constructionChristmasBookTokens } from './book';
import { normalizeWords } from '../normalize';

describe('construction-christmas book fixture', () => {
  it('tokenizes to exactly 202 tokens with the same normalizer the matcher uses', () => {
    expect(constructionChristmasBookTokens).toEqual(normalizeWords(constructionChristmasBookText));
    expect(constructionChristmasBookTokens).toHaveLength(202);
  });

  it('puts each trigger phrase at its recorded first-token wordIndex', () => {
    expect(constructionChristmasBookTokens[67]).toBe('deadline');
    expect(constructionChristmasBookTokens[87]).toBe('pushes');
    expect(constructionChristmasBookTokens[121]).toBe('massive');
    expect(constructionChristmasBookTokens[122]).toBe('gift');
  });
});
