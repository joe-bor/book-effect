import { describe, expect, it } from 'vitest';

import {
  constructionChristmasBookTokens,
  constructionChristmasTriggers,
} from './constructionChristmas.fixture';
import { normalizeWords } from './normalize';
import { injectErrors, readStream } from './readStream.test-helper';
import { DEFAULT_SESSION_OPTIONS, SessionTracker, type SessionOptions } from './sessionTracker';
import type { AsrChunk, FireDecision, Trigger } from './types';

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

const assertInCorridor = (
  tracker: SessionTracker,
  triggers: Trigger[],
  opts: { armLead: number; maxLookback: (trigger: Trigger) => number } = {
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
    expect(tracker.fires).toHaveLength(3);
    assertInCorridor(tracker, constructionChristmasTriggers);
    assertMonotonic(tracker.cursorHistory);
    expect(tracker.cursor).toBe(trueTokens.length);
  });
});

describe('realistic full read-through', () => {
  it('still fires all three in-corridor under split/drop/substitution errors', () => {
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

describe('off-script / silence stretch mid-read', () => {
  it('does not drift the cursor or fire during garbage, then re-acquires and finishes', () => {
    const partA = readStream(trueTokens.slice(0, 80), 6);
    const garbage: AsrChunk[] = [
      { kind: 'final', text: 'um what should we have for dinner tonight' },
      { kind: 'partial', text: '' },
      { kind: 'final', text: '' },
      { kind: 'final', text: 'hey can you grab the remote please' },
    ];
    const partB = readStream(trueTokens.slice(80), 6);

    const tracker = new SessionTracker(trueTokens, constructionChristmasTriggers);
    partA.forEach((chunk) => tracker.process(chunk));
    const cursorBeforeGarbage = tracker.cursor;
    const firesBeforeGarbage = tracker.fires.length;

    garbage.forEach((chunk) => tracker.process(chunk));
    expect(tracker.cursor).toBe(cursorBeforeGarbage);
    expect(tracker.fires.length).toBe(firesBeforeGarbage);

    partB.forEach((chunk) => tracker.process(chunk));
    assertMonotonic(tracker.cursorHistory);
    expect(tracker.fires.map((f) => f.triggerId).sort()).toEqual([
      'trigger-1',
      'trigger-2',
      'trigger-3',
    ]);
    assertInCorridor(tracker, constructionChristmasTriggers);
  });
});

describe('repeated-phrase stress', () => {
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
    const take = (count: number): void => {
      for (let i = 0; i < count; i += 1) tokens.push(POOL[pool++] as string);
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
    expect(tracker.fires).toHaveLength(3);
    assertInCorridor(tracker, triggers, {
      armLead: repeatedOpts.armLead as number,
      maxLookback: () => repeatedOpts.maxLookbackPhrase as number,
    });
  });

  it('does not re-fire on a stale echo of the phrase after all occurrences have fired', () => {
    const { tokens, triggers } = buildRepeatedBook();
    const chunks = [...readStream(tokens, 6), ...readStream(normalizeWords('goodnight moon'), 6)];
    const tracker = runOver(tokens, triggers, chunks, repeatedOpts);

    expect(tracker.fires).toHaveLength(3);
  });
});
