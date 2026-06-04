import { describe, expect, it } from 'vitest';

import { SessionTracker, type SessionOptions } from './sessionTracker';
import { normalizeWords } from '../normalize';
import type { AsrChunk, Trigger } from '../matchers/types';

const final = (text: string): AsrChunk => ({ kind: 'final', text, wallClock: '' });
const partial = (text: string): AsrChunk => ({ kind: 'partial', text, wallClock: '' });
const toks = (text: string): readonly string[] => normalizeWords(text);

// Test books use distinct multi-character words on purpose: single letters are all within one
// char-edit of each other, which `fuzzyTokenEqual` would treat as the same token and let the
// cursor race ahead.
//
// Tight corridors + small windows so unit tests can drive each transition deterministically.
const tight: SessionOptions = {
  lookAhead: 60,
  lookBehind: 2,
  recentWindow: 6,
  advanceThreshold: 0.5,
  armLead: 2,
  maxLookbackSingleWord: 2,
  maxLookbackPhrase: 3,
  freezeAfter: 2,
  cooldownChunks: 2,
};

const run = (
  book: string,
  triggers: Trigger[],
  chunks: AsrChunk[],
  opts = tight,
): SessionTracker => {
  const tracker = new SessionTracker(toks(book), triggers, opts);
  for (const chunk of chunks) tracker.process(chunk);
  return tracker;
};

describe('SessionTracker cursor', () => {
  it('advances forward through a clean read and reaches the end', () => {
    const tracker = run(
      'alpha bravo charlie delta echo foxtrot golf hotel',
      [],
      [final('alpha bravo'), final('charlie delta'), final('echo foxtrot'), final('golf hotel')],
    );
    expect([...tracker.cursorHistory]).toEqual([2, 4, 6, 8]);
    expect(tracker.cursor).toBe(8);
  });

  it('never rewinds and holds when a jump-back is low-confidence', () => {
    // Read forward to foxtrot, then the reader jumps back to the start: the early tokens fall
    // outside the forward window, so confidence drops and the cursor holds instead of rewinding.
    const tracker = run(
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet',
      [],
      [final('alpha bravo charlie'), final('delta echo foxtrot'), final('alpha bravo charlie')],
    );
    const history = [...tracker.cursorHistory];
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i]).toBeGreaterThanOrEqual(history[i - 1] as number);
    }
    expect(tracker.cursor).toBe(history[1]); // unchanged by the jump-back chunk
  });
});

describe('SessionTracker arming + firing', () => {
  const boom: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 4, type: 'single-word' };

  it('arms a trigger as the cursor enters its corridor and fires when the phrase is heard', () => {
    const tracker = run(
      'one two three four boom six seven eight',
      [boom],
      [final('one two'), final('three four'), final('boom six')],
    );
    expect([...tracker.fires]).toEqual([{ triggerId: 'boom', chunkIndex: 2 }]);
    expect(tracker.stateOf('boom')).toBe('fired');
  });

  it('does not fire a trigger whose corridor the cursor has not reached yet', () => {
    // Trigger boom is at index 11; an earlier narrative "boom" is heard while the cursor is near
    // the start, far below the corridor [9, 13], so the trigger is still pending.
    const farBoom: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 11, type: 'single-word' };
    const tracker = run(
      'alpha boom charlie delta echo foxtrot golf hotel india juliet kilo boom mike',
      [farBoom],
      [final('alpha boom')],
    );
    expect(tracker.stateOf('boom')).toBe('pending');
    expect([...tracker.fires]).toEqual([]);
  });

  it('fires each trigger at most once even when the phrase lingers in the buffer', () => {
    const tracker = run(
      'one two three four boom six seven eight',
      [boom],
      [final('three four'), final('boom'), partial('boom'), final('boom six')],
    );
    expect([...tracker.fires]).toEqual([{ triggerId: 'boom', chunkIndex: 1 }]);
  });
});

describe('SessionTracker expiry (false-stale guard)', () => {
  it('expires an unmatched trigger and refuses a late stale fire', () => {
    const boom: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const tracker = run(
      'alpha bravo charlie delta boom foxtrot golf hotel india juliet',
      [boom],
      [
        final('alpha bravo charlie delta'),
        final('foxtrot golf hotel'), // reads past boom without saying it -> cursor leaves the corridor
        final('boom'), // stale echo arrives too late
      ],
    );
    expect(tracker.stateOf('boom')).toBe('expired');
    expect([...tracker.fires]).toEqual([]);
  });
});

describe('SessionTracker repeated phrase (wrong-occurrence guard)', () => {
  it('fires only the occurrence whose corridor is active, each once', () => {
    const first: Trigger = { id: 'first', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const second: Trigger = { id: 'second', phrase: 'boom', wordIndex: 12, type: 'single-word' };
    const tracker = run(
      'alpha bravo charlie delta boom foxtrot golf hotel india juliet kilo lima boom november oscar',
      [first, second],
      [
        final('alpha bravo charlie delta'),
        final('boom foxtrot'),
        final('golf hotel'),
        final('india juliet'),
        final('kilo lima'),
        final('boom november'),
      ],
    );
    const fired = [...tracker.fires];
    expect(fired.map((f) => f.triggerId)).toEqual(['first', 'second']);
    expect((fired[0] as { chunkIndex: number }).chunkIndex).toBeLessThan(
      (fired[1] as { chunkIndex: number }).chunkIndex,
    );
  });
});

describe('SessionTracker hard-freeze', () => {
  const boom: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 4, type: 'single-word' };

  it('freezes after a low-confidence streak and suppresses firing until re-acquired', () => {
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta boom foxtrot golf hotel'),
      [boom],
      tight,
    );
    tracker.process(final('alpha bravo charlie delta')); // confident, arms boom
    expect(tracker.frozen).toBe(false);
    expect(tracker.stateOf('boom')).toBe('armed');

    tracker.process(final('xxxx yyyy')); // off-script
    tracker.process(final('zzzz wwww')); // off-script -> streak hits freezeAfter
    expect(tracker.frozen).toBe(true);

    tracker.process(final('qqqq boom')); // boom is armed + in buffer, but we are frozen
    expect([...tracker.fires]).toEqual([]);

    tracker.process(final('foxtrot golf hotel')); // confident forward read -> re-acquire
    expect(tracker.frozen).toBe(false);
  });
});
