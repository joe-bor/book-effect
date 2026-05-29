import { describe, expect, it } from 'vitest';

import { phraseEditDistance } from './align';

const toks = (s: string): string[] => s.split(' ');

describe('phraseEditDistance (approx substring with adjacent-token merge)', () => {
  it('is 0 for an exact contiguous occurrence', () => {
    expect(phraseEditDistance(toks('deadline'), toks('the word is deadline'))).toBe(0);
  });

  it('is 0 for a split compound via adjacent-token merge (dead line -> deadline)', () => {
    expect(phraseEditDistance(toks('deadline'), toks('the word is dead line'))).toBe(0);
  });

  it('stays positive when only a fragment survives (INE)', () => {
    expect(phraseEditDistance(toks('deadline'), toks('ine'))).toBe(1);
  });

  it('is 1 for a one-token substitution (gift vs guest)', () => {
    expect(phraseEditDistance(toks('massive gift'), toks('in his way a massive guest'))).toBe(1);
  });

  it('is 1 for mass is gift', () => {
    expect(phraseEditDistance(toks('massive gift'), toks('in his way a mass is gift'))).toBe(1);
  });

  it('is 1 for a dropped leading token', () => {
    expect(
      phraseEditDistance(toks('pushes hard to clear the way'), toks("'s hard to clear the way")),
    ).toBe(1);
  });

  it('is 2 for a dropped leading token plus a substitution (heart/hard)', () => {
    expect(
      phraseEditDistance(toks('pushes hard to clear the way'), toks("'s heart to clear the way")),
    ).toBe(2);
  });
});
