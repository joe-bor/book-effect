import { describe, expect, it } from 'vitest';

import { approxSubstringAlign, phraseEditDistance } from './align';

const toks = (text: string): string[] => text.split(' ');

describe('phraseEditDistance', () => {
  it('is 0 for an exact contiguous occurrence', () => {
    expect(phraseEditDistance(toks('deadline'), toks('the word is deadline'))).toBe(0);
  });

  it('is 0 for a split compound via adjacent-token merge', () => {
    expect(phraseEditDistance(toks('deadline'), toks('the word is dead line'))).toBe(0);
  });

  it('stays positive when only a fragment survives', () => {
    expect(phraseEditDistance(toks('deadline'), toks('ine'))).toBe(1);
  });

  it('is 1 for a one-token substitution', () => {
    expect(phraseEditDistance(toks('massive gift'), toks('in his way a massive guest'))).toBe(1);
  });

  it('is 1 for a split token phrase', () => {
    expect(phraseEditDistance(toks('massive gift'), toks('in his way a mass is gift'))).toBe(1);
  });

  it('is 1 for a dropped leading token', () => {
    expect(
      phraseEditDistance(toks('pushes hard to clear the way'), toks("'s hard to clear the way")),
    ).toBe(1);
  });

  it('is 2 for a dropped leading token plus a substitution', () => {
    expect(
      phraseEditDistance(toks('pushes hard to clear the way'), toks("'s heart to clear the way")),
    ).toBe(2);
  });
});

describe('approxSubstringAlign', () => {
  it('reports the index of the last token consumed by an exact match', () => {
    expect(
      approxSubstringAlign(toks('big construction site'), toks('the big construction site')),
    ).toEqual({ distance: 0, end: 3 });
  });

  it('leaves trailing window tokens free', () => {
    expect(approxSubstringAlign(toks('big'), toks('the big construction site'))).toEqual({
      distance: 0,
      end: 1,
    });
  });

  it('counts a one-token substitution but ends on the last exact anchor', () => {
    expect(approxSubstringAlign(toks('massive gift'), toks('a massive guest here'))).toEqual({
      distance: 1,
      end: 1,
    });
  });

  it('absorbs a split compound and ends on the second half', () => {
    expect(approxSubstringAlign(toks('deadline'), toks('the word is dead line'))).toEqual({
      distance: 0,
      end: 4,
    });
  });

  it('returns end -1 for an empty pattern', () => {
    expect(approxSubstringAlign([], toks('a b c'))).toEqual({ distance: 0, end: -1 });
  });

  it('breaks ties toward the earliest end', () => {
    expect(approxSubstringAlign(toks('the'), toks('the big the'))).toEqual({
      distance: 0,
      end: 0,
    });
  });
});
