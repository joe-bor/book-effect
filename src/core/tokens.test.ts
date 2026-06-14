import { describe, expect, it } from 'vitest';

import { charEditDistance, fuzzyTokenEqual } from './tokens';

describe('charEditDistance', () => {
  it('is 0 for identical tokens', () => {
    expect(charEditDistance('hard', 'hard')).toBe(0);
  });

  it('counts substitutions, insertions, and deletions', () => {
    expect(charEditDistance('hard', 'heart')).toBe(2);
    expect(charEditDistance('gift', 'guest')).toBe(3);
    expect(charEditDistance('a', '')).toBe(1);
  });
});

describe('fuzzyTokenEqual', () => {
  it('treats identical and one-edit tokens as equal', () => {
    expect(fuzzyTokenEqual('hard', 'hard')).toBe(true);
    expect(fuzzyTokenEqual('clear', 'cleer')).toBe(true);
  });

  it('treats larger differences as not equal', () => {
    expect(fuzzyTokenEqual('gift', 'guest')).toBe(false);
    expect(fuzzyTokenEqual('massive', 'mass')).toBe(false);
    expect(fuzzyTokenEqual('hard', 'heart')).toBe(false);
  });
});
