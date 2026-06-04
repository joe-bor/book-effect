import { describe, expect, it } from 'vitest';

import type { AsrChunk, Trigger } from './types';
import { BaselineMatcher } from './baseline';

function partial(text: string): AsrChunk {
  return { kind: 'partial', text, wallClock: '' };
}
function final(text: string): AsrChunk {
  return { kind: 'final', text, wallClock: '' };
}

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

describe('BaselineMatcher.run', () => {
  it('fires a trigger at the first chunk whose text contains the phrase', () => {
    const chunks = [
      partial('THE'),
      partial('THE WORD IS'),
      partial('THE WORD IS DEAD'),
      partial('THE WORD IS DEADLINE'),
      final('THE WORD IS DEADLINE'),
    ];

    const fires = new BaselineMatcher().run(chunks, [deadline]);

    expect(fires).toEqual([{ triggerId: 'trigger-1', chunkIndex: 3 }]);
  });

  it('does not fire when the phrase never appears (split compound)', () => {
    const chunks = [partial('THE WORD IS DEAD'), final('THE WORD IS DEAD LINE')];

    expect(new BaselineMatcher().run(chunks, [deadline])).toEqual([]);
  });

  it('fires each trigger at most once', () => {
    const chunks = [partial('DEADLINE'), partial('DEADLINE AGAIN'), final('DEADLINE AGAIN')];

    expect(new BaselineMatcher().run(chunks, [deadline])).toEqual([
      { triggerId: 'trigger-1', chunkIndex: 0 },
    ]);
  });

  it('fires only the matching trigger when several are armed', () => {
    const chunks = [final('THE WORD IS DEADLINE')];

    expect(new BaselineMatcher().run(chunks, [deadline, massiveGift])).toEqual([
      { triggerId: 'trigger-1', chunkIndex: 0 },
    ]);
  });
});
