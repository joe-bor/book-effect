import { describe, expect, it } from 'vitest';

import { findPhraseInRecentText } from './baseline';

describe('findPhraseInRecentText (baseline substring)', () => {
  it('finds a normalized phrase inside recent ASR text', () => {
    expect(findPhraseInRecentText('then the truck went BOOM loudly', 'truck went boom')).toBe(true);
  });

  it('does not match a phrase that is absent', () => {
    expect(findPhraseInRecentText('quiet snow fell', 'truck went boom')).toBe(false);
  });

  it('matches the clean carrier for each Phase 1 trigger', () => {
    expect(findPhraseInRecentText('THE WORD IS DEADLINE', 'deadline')).toBe(true);
    expect(
      findPhraseInRecentText(
        'WORKING AT FULL SPEED ALL DAY HE PUSHES HARD TO CLEAR THE WAY',
        'pushes hard to clear the way',
      ),
    ).toBe(true);
  });

  // The three Sherpa miss shapes from docs/03 — baseline must MISS these by design;
  // they are the recovery targets for P2.
  it('misses a split compound (DEAD LINE vs deadline)', () => {
    expect(findPhraseInRecentText('THE WORD IS DEAD LINE', 'deadline')).toBe(false);
  });

  it('misses a one-token substitution (MASSIVE GUEST vs massive gift)', () => {
    expect(findPhraseInRecentText('IN HIS WAY A MASSIVE GUEST', 'massive gift')).toBe(false);
  });

  it('misses a dropped leading token (S HARD TO CLEAR THE WAY)', () => {
    expect(findPhraseInRecentText("'S HARD TO CLEAR THE WAY", 'pushes hard to clear the way')).toBe(
      false,
    );
  });
});
