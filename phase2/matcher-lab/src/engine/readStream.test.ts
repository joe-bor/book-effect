import { describe, expect, it } from 'vitest';

import { injectErrors, readStream } from './readStream';

describe('readStream', () => {
  it('emits growing partials then a final per segment, in order', () => {
    expect(readStream(['alpha', 'bravo', 'charlie'], 2)).toEqual([
      { kind: 'partial', text: 'alpha', wallClock: '' },
      { kind: 'partial', text: 'alpha bravo', wallClock: '' },
      { kind: 'final', text: 'alpha bravo', wallClock: '' },
      { kind: 'partial', text: 'charlie', wallClock: '' },
      { kind: 'final', text: 'charlie', wallClock: '' },
    ]);
  });

  it('reconstructs the spoken tokens from the finals in order', () => {
    const spoken = ['one', 'two', 'three', 'four', 'five'];
    const finals = readStream(spoken, 2)
      .filter((c) => c.kind === 'final')
      .flatMap((c) => c.text.split(' '));
    expect(finals).toEqual(spoken);
  });
});

describe('injectErrors', () => {
  it('replaces a token with a split compound, drops one, and substitutes another', () => {
    const truth = ['be', 'fore', 'deadline', 'mid', 'pushes', 'gift', 'end'];
    const spoken = injectErrors(truth, [
      { at: 2, replaceWith: ['dead', 'line'] },
      { at: 4, replaceWith: [] },
      { at: 5, replaceWith: ['guest'] },
    ]);
    expect(spoken).toEqual(['be', 'fore', 'dead', 'line', 'mid', 'guest', 'end']);
  });
});
