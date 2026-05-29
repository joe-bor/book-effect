import type { Trigger } from './matchers/types';

// Copied from spike/src/books/constructionChristmas.ts (the only Phase 1 trigger set).
// The live spike armed all three on every trial; replay does the same for fidelity.
export const constructionChristmasTriggers: Trigger[] = [
  { id: 'trigger-1', phrase: 'deadline', wordIndex: 67, type: 'single-word' },
  { id: 'trigger-2', phrase: 'massive gift', wordIndex: 121, type: 'phrase' },
  { id: 'trigger-3', phrase: 'pushes hard to clear the way', wordIndex: 87, type: 'phrase' },
];
