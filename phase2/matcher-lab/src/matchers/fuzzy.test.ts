import { describe, expect, it } from 'vitest';

import { editBudget, FuzzyMatcher } from './fuzzy';
import type { AsrChunk, Trigger } from './types';

const final = (text: string): AsrChunk => ({ kind: 'final', text, wallClock: '' });
const partial = (text: string): AsrChunk => ({ kind: 'partial', text, wallClock: '' });

const deadline: Trigger = {
  id: 'trigger-1',
  phrase: 'deadline',
  wordIndex: 67,
  type: 'single-word',
};
const massiveGift: Trigger = {
  id: 'trigger-2',
  phrase: 'massive gift',
  wordIndex: 121,
  type: 'phrase',
};
const pushesHard: Trigger = {
  id: 'trigger-3',
  phrase: 'pushes hard to clear the way',
  wordIndex: 87,
  type: 'phrase',
};

describe('editBudget', () => {
  it('is strict for single words and scales with phrase length', () => {
    expect(editBudget(1)).toBe(0);
    expect(editBudget(2)).toBe(1);
    expect(editBudget(3)).toBe(1);
    expect(editBudget(4)).toBe(2);
    expect(editBudget(6)).toBe(2);
    expect(editBudget(9)).toBe(3);
  });
});

describe('FuzzyMatcher.run', () => {
  it('recovers a split compound and fires at the chunk where it first appears', () => {
    const chunks = [
      partial('THE WORD IS DEAD'),
      partial('THE WORD IS DEAD LINE'),
      final('THE WORD IS DEAD LINE'),
    ];
    expect(new FuzzyMatcher().run(chunks, [deadline])).toEqual([
      { triggerId: 'trigger-1', chunkIndex: 1 },
    ]);
  });

  it('does not fire a single-word trigger on a bare fragment (INE)', () => {
    expect(new FuzzyMatcher().run([final('INE')], [deadline])).toEqual([]);
  });

  it('recovers a one-token substitution (MASSIVE GUEST)', () => {
    expect(new FuzzyMatcher().run([final('IN HIS WAY A MASSIVE GUEST')], [massiveGift])).toEqual([
      { triggerId: 'trigger-2', chunkIndex: 0 },
    ]);
  });

  it('recovers a dropped leading token', () => {
    expect(new FuzzyMatcher().run([final("'S HARD TO CLEAR THE WAY")], [pushesHard])).toEqual([
      { triggerId: 'trigger-3', chunkIndex: 0 },
    ]);
  });

  it('fires only the matching trigger when all three are armed', () => {
    expect(
      new FuzzyMatcher().run([final('THE WORD IS DEADLINE')], [deadline, massiveGift, pushesHard]),
    ).toEqual([{ triggerId: 'trigger-1', chunkIndex: 0 }]);
  });

  it('fires each trigger at most once', () => {
    expect(new FuzzyMatcher().run([final('DEADLINE'), final('DEADLINE')], [deadline])).toEqual([
      { triggerId: 'trigger-1', chunkIndex: 0 },
    ]);
  });
});
