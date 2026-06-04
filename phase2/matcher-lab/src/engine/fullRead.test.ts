import { describe, expect, it } from 'vitest';

import { constructionChristmasBookTokens } from './book';
import { readStream, injectErrors } from './readStream';
import { DEFAULT_SESSION_OPTIONS, SessionTracker, type SessionOptions } from './sessionTracker';
import { constructionChristmasTriggers } from '../triggers';
import { normalizeWords } from '../normalize';
import type { AsrChunk, FireDecision, Trigger } from '../matchers/types';

const D = DEFAULT_SESSION_OPTIONS;
const trueTokens = [...constructionChristmasBookTokens];

const maxLookback = (trigger: Trigger): number =>
  trigger.type === 'single-word' ? D.maxLookbackSingleWord : D.maxLookbackPhrase;

const runOver = (
  bookTokens: readonly string[],
  triggers: Trigger[],
  chunks: AsrChunk[],
  opts?: SessionOptions,
): SessionTracker => {
  const tracker = new SessionTracker(bookTokens, triggers, opts);
  for (const chunk of chunks) tracker.process(chunk);
  return tracker;
};

const assertMonotonic = (history: readonly number[]): void => {
  for (let i = 1; i < history.length; i += 1) {
    expect(history[i]).toBeGreaterThanOrEqual(history[i - 1] as number);
  }
};

// A fire is "in-corridor" when the cursor at the firing chunk sits inside the trigger's
// [wordIndex - armLead, wordIndex + maxLookback] window — i.e. armed and not yet expired.
const assertInCorridor = (
  tracker: SessionTracker,
  triggers: Trigger[],
  opts: { armLead: number; maxLookback: (t: Trigger) => number } = {
    armLead: D.armLead,
    maxLookback,
  },
): void => {
  for (const trigger of triggers) {
    const fire = tracker.fires.find((f) => f.triggerId === trigger.id);
    expect(fire, `${trigger.id} should fire`).toBeDefined();
    const cursorAtFire = tracker.cursorHistory[(fire as FireDecision).chunkIndex] as number;
    expect(cursorAtFire, `${trigger.id} armed`).toBeGreaterThanOrEqual(
      trigger.wordIndex - opts.armLead,
    );
    expect(cursorAtFire, `${trigger.id} not stale`).toBeLessThanOrEqual(
      trigger.wordIndex + opts.maxLookback(trigger),
    );
  }
};

describe('full clean read-through', () => {
  it('fires all three triggers in-corridor, with a monotonic cursor that reaches the end', () => {
    const tracker = runOver(trueTokens, constructionChristmasTriggers, readStream(trueTokens, 6));

    expect(tracker.fires.map((f) => f.triggerId).sort()).toEqual([
      'trigger-1',
      'trigger-2',
      'trigger-3',
    ]);
    expect(tracker.fires).toHaveLength(3); // exactly one fire per trigger -> 0 wrong-occurrence
    assertInCorridor(tracker, constructionChristmasTriggers);
    assertMonotonic(tracker.cursorHistory);
    expect(tracker.cursor).toBe(trueTokens.length); // advanced to the end of the book
  });
});

describe('realistic full read-through (P2 sherpa miss shapes injected at the triggers)', () => {
  it('still fires all three in-corridor under split/drop/substitution errors', () => {
    // deadline (67) heard as "dead line"; pushes (87) dropped; gift (122) heard as "guest".
    const spoken = injectErrors(trueTokens, [
      { at: 67, replaceWith: ['dead', 'line'] },
      { at: 87, replaceWith: [] },
      { at: 122, replaceWith: ['guest'] },
    ]);
    const tracker = runOver(trueTokens, constructionChristmasTriggers, readStream(spoken, 6));

    expect(tracker.fires.map((f) => f.triggerId).sort()).toEqual([
      'trigger-1',
      'trigger-2',
      'trigger-3',
    ]);
    expect(tracker.fires).toHaveLength(3);
    assertInCorridor(tracker, constructionChristmasTriggers);
    assertMonotonic(tracker.cursorHistory);
  });
});

describe('off-script / silence stretch mid-read (hard-freeze holds)', () => {
  it('does not drift the cursor or fire during garbage, then re-acquires and finishes', () => {
    const partA = readStream(trueTokens.slice(0, 80), 6); // through deadline (67), before pushes (87)
    const garbage: AsrChunk[] = [
      { kind: 'final', text: 'um what should we have for dinner tonight', wallClock: '' },
      { kind: 'partial', text: '', wallClock: '' },
      { kind: 'final', text: '', wallClock: '' },
      { kind: 'final', text: 'hey can you grab the remote please', wallClock: '' },
    ];
    const partB = readStream(trueTokens.slice(80), 6);

    const tracker = new SessionTracker(trueTokens, constructionChristmasTriggers);
    partA.forEach((c) => tracker.process(c));
    const cursorBeforeGarbage = tracker.cursor;
    const firesBeforeGarbage = tracker.fires.length;

    garbage.forEach((c) => tracker.process(c));
    expect(tracker.cursor).toBe(cursorBeforeGarbage); // no forward drift on off-script/silence
    expect(tracker.fires.length).toBe(firesBeforeGarbage); // no spurious fire during garbage

    partB.forEach((c) => tracker.process(c));
    assertMonotonic(tracker.cursorHistory);
    expect(tracker.fires.map((f) => f.triggerId).sort()).toEqual([
      'trigger-1',
      'trigger-2',
      'trigger-3',
    ]); // deadline fired in partA; pushes + massive gift re-acquired in partB
    assertInCorridor(tracker, constructionChristmasTriggers);
  });
});

describe('repeated-phrase stress (goodnight x12 analog)', () => {
  // A constructed book where one trigger phrase appears at several wordIndex positions. All filler
  // tokens are unique multi-character words so the cursor cannot conflate positions via fuzzy
  // single-char equality, and occurrences are spaced wider than the corridor so only one arms at a time.
  const POOL = [
    'alpha',
    'bravo',
    'charlie',
    'delta',
    'echo',
    'foxtrot',
    'golf',
    'hotel',
    'india',
    'juliet',
    'kilo',
    'lima',
    'mike',
    'november',
    'oscar',
    'papa',
    'quebec',
    'romeo',
    'sierra',
    'tango',
    'uniform',
    'victor',
    'whiskey',
    'yankee',
    'zulu',
    'anchor',
    'basket',
    'candle',
    'dragon',
    'ember',
    'falcon',
    'garden',
    'harbor',
    'ivory',
    'jacket',
    'kettle',
    'lantern',
    'marble',
    'needle',
    'orchid',
    'pebble',
    'quartz',
    'ribbon',
    'saddle',
    'tunnel',
    'velvet',
    'walnut',
    'xenon',
    'yarrow',
    'zephyr',
    'meadow',
    'cactus',
  ];
  const repeatedOpts: SessionOptions = {
    lookAhead: 60,
    lookBehind: 6,
    recentWindow: 8,
    advanceThreshold: 0.5,
    armLead: 6,
    maxLookbackSingleWord: 4,
    maxLookbackPhrase: 6,
    freezeAfter: 3,
    cooldownChunks: 3,
  };

  const buildRepeatedBook = (): { tokens: string[]; triggers: Trigger[] } => {
    const phrase = ['goodnight', 'moon'];
    const lead = 10;
    const gap = 14;
    const tokens: string[] = [];
    let pool = 0;
    const take = (n: number): void => {
      for (let i = 0; i < n; i += 1) tokens.push(POOL[pool++] as string);
    };
    const triggers: Trigger[] = [];
    take(lead);
    for (let occurrence = 0; occurrence < 3; occurrence += 1) {
      triggers.push({
        id: `goodnight-${occurrence}`,
        phrase: 'goodnight moon',
        wordIndex: tokens.length,
        type: 'phrase',
      });
      tokens.push(...phrase);
      if (occurrence < 2) take(gap);
    }
    take(8);
    return { tokens, triggers };
  };

  it('fires only the occurrence whose corridor is active, each exactly once', () => {
    const { tokens, triggers } = buildRepeatedBook();
    const tracker = runOver(tokens, triggers, readStream(tokens, 6), repeatedOpts);

    expect(tracker.fires.map((f) => f.triggerId)).toEqual([
      'goodnight-0',
      'goodnight-1',
      'goodnight-2',
    ]);
    expect(tracker.fires).toHaveLength(3); // each occurrence once, in order -> 0 wrong-occurrence
    assertInCorridor(tracker, triggers, {
      armLead: repeatedOpts.armLead as number,
      maxLookback: () => repeatedOpts.maxLookbackPhrase as number,
    });
  });

  it('does not re-fire on a stale echo of the phrase after all occurrences have fired', () => {
    const { tokens, triggers } = buildRepeatedBook();
    const chunks = [...readStream(tokens, 6), ...readStream(normalizeWords('goodnight moon'), 6)];
    const tracker = runOver(tokens, triggers, chunks, repeatedOpts);

    expect(tracker.fires).toHaveLength(3); // the trailing echo fires nothing (all fired/expired)
  });
});
