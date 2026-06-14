import { describe, expect, it } from 'vitest';

import { normalizeWords } from './normalize';
import { SessionTracker, type SessionOptions } from './sessionTracker';
import type { AsrChunk, Trigger } from './types';

const final = (text: string): AsrChunk => ({ kind: 'final', text });
const partial = (text: string): AsrChunk => ({ kind: 'partial', text });
const toks = (text: string): readonly string[] => normalizeWords(text);

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
    const tracker = run(
      'alpha bravo charlie delta echo foxtrot golf hotel india juliet',
      [],
      [final('alpha bravo charlie'), final('delta echo foxtrot'), final('alpha bravo charlie')],
    );
    const history = [...tracker.cursorHistory];
    for (let i = 1; i < history.length; i += 1) {
      expect(history[i]).toBeGreaterThanOrEqual(history[i - 1] as number);
    }
    expect(tracker.cursor).toBe(history[1]);
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

  it('fires a trigger heard in a long final chunk before expiring stale triggers', () => {
    const tracker = run(
      'alpha bravo charlie delta boom foxtrot golf hotel',
      [boom],
      [final('alpha bravo charlie delta boom foxtrot golf hotel')],
    );

    expect([...tracker.fires]).toEqual([{ triggerId: 'boom', chunkIndex: 0 }]);
    expect(tracker.stateOf('boom')).toBe('fired');
  });
});

describe('SessionTracker expiry (false-stale guard)', () => {
  it('expires an unmatched trigger and refuses a late stale fire', () => {
    const boom: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const tracker = run(
      'alpha bravo charlie delta boom foxtrot golf hotel india juliet',
      [boom],
      [final('alpha bravo charlie delta'), final('foxtrot golf hotel'), final('boom')],
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

  it('does not fire a close repeated trigger from the previous phrase still in the buffer', () => {
    const first: Trigger = { id: 'first', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const second: Trigger = { id: 'second', phrase: 'boom', wordIndex: 8, type: 'single-word' };
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta boom foxtrot golf hotel boom india juliet'),
      [first, second],
      tight,
    );

    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(final('boom foxtrot'));
    tracker.process(final('golf hotel'));

    expect([...tracker.fires]).toEqual([{ triggerId: 'first', chunkIndex: 1 }]);

    tracker.process(final('boom india'));

    expect([...tracker.fires]).toEqual([
      { triggerId: 'first', chunkIndex: 1 },
      { triggerId: 'second', chunkIndex: 3 },
    ]);
  });

  it('does not treat a restated partial prefix as a new close repeated phrase', () => {
    const first: Trigger = { id: 'first', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const second: Trigger = { id: 'second', phrase: 'boom', wordIndex: 8, type: 'single-word' };
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta boom foxtrot golf hotel boom india juliet'),
      [first, second],
      tight,
    );

    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(partial('boom foxtrot'));
    tracker.process(partial('boom foxtrot golf hotel'));
    tracker.process(final('boom foxtrot golf hotel'));

    expect([...tracker.fires]).toEqual([{ triggerId: 'first', chunkIndex: 1 }]);

    tracker.process(partial('boom india'));

    expect([...tracker.fires]).toEqual([
      { triggerId: 'first', chunkIndex: 1 },
      { triggerId: 'second', chunkIndex: 4 },
    ]);
  });

  it('does not fire a close repeated phrase trigger from an old phrase plus a new filler token', () => {
    const first: Trigger = { id: 'first', phrase: 'goodnight moon', wordIndex: 4, type: 'phrase' };
    const second: Trigger = {
      id: 'second',
      phrase: 'goodnight moon',
      wordIndex: 8,
      type: 'phrase',
    };
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta goodnight moon foxtrot golf goodnight moon india'),
      [first, second],
      tight,
    );

    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(final('goodnight moon'));
    tracker.process(final('foxtrot'));

    expect([...tracker.fires]).toEqual([{ triggerId: 'first', chunkIndex: 1 }]);

    tracker.process(final('golf goodnight moon'));

    expect([...tracker.fires]).toEqual([
      { triggerId: 'first', chunkIndex: 1 },
      { triggerId: 'second', chunkIndex: 3 },
    ]);
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
    tracker.process(final('alpha bravo charlie delta'));
    expect(tracker.frozen).toBe(false);
    expect(tracker.stateOf('boom')).toBe('armed');

    tracker.process(final('xxxx yyyy'));
    tracker.process(final('zzzz wwww'));
    expect(tracker.frozen).toBe(true);

    tracker.process(final('qqqq boom'));
    expect([...tracker.fires]).toEqual([]);

    tracker.process(final('foxtrot golf hotel'));
    expect(tracker.frozen).toBe(false);
  });
});

describe('SessionTracker forceReacquire', () => {
  const opts: SessionOptions = {
    ...tight,
    lookAhead: 4,
    reacquireLookAhead: 18,
    reacquireChunks: 3,
  };

  it('clears a hard-freeze and lets a widened forward search re-acquire', () => {
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta echo foxtrot golf hotel india juliet kilo lima mike'),
      [],
      opts,
    );
    tracker.process(final('alpha bravo'));
    tracker.process(final('noise words'));
    tracker.process(final('more noise'));
    tracker.process(final('extra junk'));
    expect(tracker.frozen).toBe(true);

    tracker.forceReacquire();
    tracker.process(final('juliet kilo lima'));

    expect(tracker.frozen).toBe(false);
    expect(tracker.cursor).toBeGreaterThanOrEqual(12);
  });

  it('never rewinds after force re-acquire', () => {
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta echo foxtrot golf hotel india juliet'),
      [],
      opts,
    );
    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(final('echo foxtrot'));
    const before = tracker.cursor;

    tracker.forceReacquire();
    tracker.process(final('alpha bravo charlie'));

    expect(tracker.cursor).toBe(before);
    expect([...tracker.cursorHistory]).toEqual([...tracker.cursorHistory].sort((a, b) => a - b));
  });

  it('does not resurrect an expired trigger after force re-acquire', () => {
    const trigger: Trigger = { id: 'boom', phrase: 'boom', wordIndex: 4, type: 'single-word' };
    const tracker = new SessionTracker(
      toks('alpha bravo charlie delta boom foxtrot golf hotel india juliet kilo'),
      [trigger],
      opts,
    );
    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(final('foxtrot golf hotel india'));
    expect(tracker.stateOf('boom')).toBe('expired');

    tracker.process(final('off script'));
    tracker.process(final('still off'));
    tracker.forceReacquire();
    tracker.process(final('boom'));

    expect(tracker.stateOf('boom')).toBe('expired');
    expect([...tracker.fires]).toEqual([]);
  });

  it('does not fire the wrong repeated occurrence after manual recovery', () => {
    const triggers: Trigger[] = [
      { id: 'first', phrase: 'goodnight moon', wordIndex: 4, type: 'phrase' },
      { id: 'second', phrase: 'goodnight moon', wordIndex: 14, type: 'phrase' },
    ];
    const tracker = new SessionTracker(
      toks(
        'alpha bravo charlie delta goodnight moon foxtrot golf hotel india juliet kilo lima mike goodnight moon november oscar',
      ),
      triggers,
      { ...opts, maxLookbackPhrase: 4, armLead: 3 },
    );

    tracker.process(final('alpha bravo charlie delta'));
    tracker.process(final('noise foxtrot golf hotel'));
    tracker.process(final('india juliet'));
    expect(tracker.stateOf('first')).toBe('expired');

    tracker.process(final('garbage words'));
    tracker.process(final('more garbage'));
    tracker.forceReacquire();
    tracker.process(final('lima mike goodnight moon'));

    expect(tracker.fires.map((f) => f.triggerId)).toEqual(['second']);
  });
});
